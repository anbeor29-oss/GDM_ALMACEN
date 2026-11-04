/**
 * Cuentas duplicadas — detecta y FUSIONA cuentas del catálogo que comparten el
 * MISMO código (dos ids con el mismo `codigo`). Pasa en catálogos viejos donde no
 * regía la restricción de unicidad `(company_id, codigo)`: un import dejó el
 * catálogo por duplicado y, con el tiempo, las pólizas se asentaron repartidas
 * entre las dos copias. El resultado son balanzas con cada cuenta dos veces.
 *
 * La FUSIÓN consolida cada código en UNA sola cuenta (la canónica = la de más
 * hijos, luego más movimientos, luego más antigua) y reapunta TODO lo que colgaba
 * de las copias:
 *   · journal_lines.account_id        → canónica (RESTRICT: hay que mover antes de borrar)
 *   · accounting_period_balances      → se SUMAN a la canónica por periodo (UNIQUE periodo+cuenta)
 *   · accounting_accounts.parent_id   → los hijos de las mayores duplicadas cuelgan de la canónica
 *   · cualquier otra FK a la cuenta   → canónica (conciliación, tarjetas, cuentas fijas… por information_schema)
 *   · equivalences                    → caen solas (ON DELETE CASCADE con la copia)
 * y al final BORRA las copias. Todo en UNA transacción: si algo choca (p. ej. el
 * índice parcial de subcuentas por tercero), se revierte entero y no deja a medias.
 *
 * NO recalcula saldos por sí mismo (la SUMA ya deja la balanza correcta); conviene
 * «Reconstruir» después para que los meses con pólizas se re-deriven consolidados.
 */
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

export interface GrupoDuplicado {
  codigo: string;
  nombre: string;
  tipo: string;
  copias: number;
  canonica: { id: string; codigoRaw: string; movimientos: number; hijos: number; saldo: number };
  duplicadas: Array<{ id: string; codigoRaw: string; movimientos: number; hijos: number; saldo: number }>;
}

/**
 * Los grupos de cuentas que son la MISMA cuenta aunque el código esté escrito
 * distinto (vacío si no hay). Se agrupan por el código NORMALIZADO —sin separadores
 * ni espacios—, porque el catálogo las guarda de dos formas que se ven iguales en
 * pantalla: unas en dígitos puros (`31080000`, que la máscara pinta como
 * `3-10-80-000`) y otras ya con guiones (`3-10-80-000`, que se muestra tal cual).
 * Son strings distintos —por eso la restricción de unicidad no las frena y un
 * match EXACTO no las encuentra— pero contablemente son la misma cuenta.
 */
export async function detectar(companyId: string): Promise<{
  grupos: GrupoDuplicado[]; totalCodigos: number; totalCuentasSobrantes: number;
}> {
  const r = await query<any>(
    `WITH norm AS (
       SELECT a.id, a.codigo, a.nombre, a.tipo, a.created_at,
              regexp_replace(a.codigo, '[^0-9A-Za-z]', '', 'g') AS cod_norm
         FROM accounting_accounts a
        WHERE a.company_id = $1
     )
     SELECT n.id, n.codigo, n.cod_norm, n.nombre, n.tipo, n.created_at,
            (SELECT count(*)::int FROM journal_lines l WHERE l.account_id = n.id)                 AS movimientos,
            (SELECT count(*)::int FROM accounting_accounts h WHERE h.parent_id = n.id)            AS hijos,
            (SELECT COALESCE(SUM(b.saldo_final),0)::float FROM accounting_period_balances b
               WHERE b.account_id = n.id)                                                         AS saldo
       FROM norm n
      WHERE n.cod_norm <> ''
        AND n.cod_norm IN (SELECT cod_norm FROM norm WHERE cod_norm <> '' GROUP BY cod_norm HAVING count(*) > 1)
      -- La PRIMERA de cada código (más hijos → más movimientos → más antigua) es la canónica.
      ORDER BY n.cod_norm, hijos DESC, movimientos DESC, n.created_at ASC, n.id ASC`,
    [companyId]);

  const porNorm = new Map<string, any[]>();
  for (const a of r.rows) {
    if (!porNorm.has(a.cod_norm)) porNorm.set(a.cod_norm, []);
    porNorm.get(a.cod_norm)!.push(a);
  }
  const grupos: GrupoDuplicado[] = [];
  for (const cuentas of porNorm.values()) {
    const [canonica, ...duplicadas] = cuentas;
    grupos.push({
      codigo: canonica.codigo, nombre: canonica.nombre, tipo: canonica.tipo, copias: cuentas.length,
      canonica: { id: canonica.id, codigoRaw: canonica.codigo, movimientos: canonica.movimientos, hijos: canonica.hijos, saldo: r2(canonica.saldo) },
      duplicadas: duplicadas.map((d) => ({ id: d.id, codigoRaw: d.codigo, movimientos: d.movimientos, hijos: d.hijos, saldo: r2(d.saldo) })),
    });
  }
  grupos.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true }));
  return {
    grupos,
    totalCodigos: grupos.length,
    totalCuentasSobrantes: grupos.reduce((a, g) => a + (g.copias - 1), 0),
  };
}

/** Consolida todas las cuentas duplicadas de la empresa en una sola por código. */
export async function fusionar(companyId: string): Promise<{ fusionadas: number; codigos: number; mensaje: string }> {
  const { grupos } = await detectar(companyId);
  if (!grupos.length) return { fusionadas: 0, codigos: 0, mensaje: 'No hay cuentas duplicadas que fusionar.' };

  const pares: Array<{ dupe: string; canon: string }> = [];
  for (const g of grupos) for (const d of g.duplicadas) pares.push({ dupe: d.id, canon: g.canonica.id });

  await transaction(async (client) => {
    await transactionQuery(client,
      `CREATE TEMP TABLE _fusion (dupe uuid PRIMARY KEY, canon uuid NOT NULL) ON COMMIT DROP`);
    const vals = pares.map((_, i) => `($${i * 2 + 1}::uuid, $${i * 2 + 2}::uuid)`).join(',');
    await transactionQuery(client, `INSERT INTO _fusion (dupe, canon) VALUES ${vals}`,
      pares.flatMap((p) => [p.dupe, p.canon]));

    // 1) Movimientos de pólizas → cuenta canónica.
    await transactionQuery(client,
      `UPDATE journal_lines l SET account_id = f.canon FROM _fusion f WHERE l.account_id = f.dupe`);

    // 2) Saldos por periodo → a la canónica (un solo saldo por periodo).
    //    OJO: las copias son la MISMA cuenta, así que su SALDO INICIAL (la apertura
    //    importada) está REPETIDO, no es dinero distinto: sumarlo lo DOBLARÍA (y
    //    «Reconstruir» no lo arregla porque salta los meses de apertura). Por eso el
    //    saldo inicial/final se toma UNA vez (el de mayor magnitud —las copias lo
    //    comparten; si una no lo tenía, gana la que sí). En cambio los CARGOS y
    //    ABONOS vienen de pólizas DISTINTAS repartidas entre las copias: ésos SÍ se
    //    suman. Se pre-agrega por (periodo, canónica) para no tocar la misma fila dos
    //    veces cuando un código tiene 3+ copias.
    await transactionQuery(client, `
      INSERT INTO accounting_period_balances (company_id, periodo_id, account_id, saldo_inicial, cargos, abonos, saldo_final)
        SELECT b.company_id, b.periodo_id, f.canon,
               (array_agg(b.saldo_inicial ORDER BY ABS(b.saldo_inicial) DESC, b.account_id))[1],
               SUM(b.cargos), SUM(b.abonos),
               (array_agg(b.saldo_final   ORDER BY ABS(b.saldo_final)   DESC, b.account_id))[1]
          FROM accounting_period_balances b JOIN _fusion f ON f.dupe = b.account_id
         GROUP BY b.company_id, b.periodo_id, f.canon
      ON CONFLICT (periodo_id, account_id) DO UPDATE SET
        saldo_inicial = CASE WHEN ABS(EXCLUDED.saldo_inicial) > ABS(accounting_period_balances.saldo_inicial)
                             THEN EXCLUDED.saldo_inicial ELSE accounting_period_balances.saldo_inicial END,
        cargos        = accounting_period_balances.cargos + EXCLUDED.cargos,
        abonos        = accounting_period_balances.abonos + EXCLUDED.abonos,
        saldo_final   = CASE WHEN ABS(EXCLUDED.saldo_final) > ABS(accounting_period_balances.saldo_final)
                             THEN EXCLUDED.saldo_final ELSE accounting_period_balances.saldo_final END,
        updated_at    = NOW()`);
    await transactionQuery(client,
      `DELETE FROM accounting_period_balances b USING _fusion f WHERE b.account_id = f.dupe`);

    // 3) Hijos de las mayores duplicadas → cuelgan de la canónica.
    await transactionQuery(client,
      `UPDATE accounting_accounts a SET parent_id = f.canon FROM _fusion f WHERE a.parent_id = f.dupe`);

    // 4) Cualquier otra FK a accounting_accounts(id) (conciliación, tarjetas, cuentas fijas, terceros…),
    //    descubierta por el catálogo del sistema para no depender de una lista fija.
    const fks = await transactionQuery<any>(client, `
      SELECT tc.table_name AS t, kcu.column_name AS c
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND ccu.table_name = 'accounting_accounts' AND ccu.column_name = 'id'`);
    const yaManejadas = new Set([
      'journal_lines.account_id', 'accounting_period_balances.account_id',
      'accounting_account_equivalences.account_id', 'accounting_accounts.parent_id',
    ]);
    for (const fk of fks.rows) {
      if (yaManejadas.has(`${fk.t}.${fk.c}`)) continue;
      await transactionQuery(client,
        `UPDATE "${fk.t}" x SET "${fk.c}" = f.canon FROM _fusion f WHERE x."${fk.c}" = f.dupe`);
    }

    // 5) Borrar las copias (sus equivalencias caen por ON DELETE CASCADE).
    await transactionQuery(client, `DELETE FROM accounting_accounts a USING _fusion f WHERE a.id = f.dupe`);
  });

  return {
    fusionadas: pares.length,
    codigos: grupos.length,
    mensaje: `Se fusionaron ${pares.length} cuenta(s) duplicada(s) en ${grupos.length} código(s). ` +
      `Reconstruye la balanza (Contabilidad → Balanza → «Reconstruir año») para re-derivar los saldos consolidados.`,
  };
}
