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
  canonica: { id: string; movimientos: number; hijos: number; saldo: number };
  duplicadas: Array<{ id: string; movimientos: number; hijos: number; saldo: number }>;
}

/** Los grupos de cuentas con el MISMO código en la empresa (vacío si no hay). */
export async function detectar(companyId: string): Promise<{
  grupos: GrupoDuplicado[]; totalCodigos: number; totalCuentasSobrantes: number;
}> {
  const r = await query<any>(
    `SELECT a.id, a.codigo, a.nombre, a.tipo, a.created_at,
            (SELECT count(*)::int FROM journal_lines l WHERE l.account_id = a.id)                 AS movimientos,
            (SELECT count(*)::int FROM accounting_accounts h WHERE h.parent_id = a.id)            AS hijos,
            (SELECT COALESCE(SUM(b.saldo_final),0)::float FROM accounting_period_balances b
               WHERE b.account_id = a.id)                                                         AS saldo
       FROM accounting_accounts a
      WHERE a.company_id = $1
        AND a.codigo IN (
          SELECT codigo FROM accounting_accounts WHERE company_id = $1
           GROUP BY codigo HAVING count(*) > 1
        )
      -- La PRIMERA de cada código (más hijos → más movimientos → más antigua) es la canónica.
      ORDER BY a.codigo, hijos DESC, movimientos DESC, a.created_at ASC, a.id ASC`,
    [companyId]);

  const porCodigo = new Map<string, any[]>();
  for (const a of r.rows) {
    if (!porCodigo.has(a.codigo)) porCodigo.set(a.codigo, []);
    porCodigo.get(a.codigo)!.push(a);
  }
  const grupos: GrupoDuplicado[] = [];
  for (const [codigo, cuentas] of porCodigo) {
    const [canonica, ...duplicadas] = cuentas;
    grupos.push({
      codigo, nombre: canonica.nombre, tipo: canonica.tipo, copias: cuentas.length,
      canonica: { id: canonica.id, movimientos: canonica.movimientos, hijos: canonica.hijos, saldo: r2(canonica.saldo) },
      duplicadas: duplicadas.map((d) => ({ id: d.id, movimientos: d.movimientos, hijos: d.hijos, saldo: r2(d.saldo) })),
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

    // 2) Saldos por periodo: SUMAR a la canónica (misma cuenta, un solo saldo por periodo), luego borrar los de la copia.
    await transactionQuery(client, `
      INSERT INTO accounting_period_balances (company_id, periodo_id, account_id, saldo_inicial, cargos, abonos, saldo_final)
        SELECT b.company_id, b.periodo_id, f.canon, b.saldo_inicial, b.cargos, b.abonos, b.saldo_final
          FROM accounting_period_balances b JOIN _fusion f ON f.dupe = b.account_id
      ON CONFLICT (periodo_id, account_id) DO UPDATE SET
        saldo_inicial = accounting_period_balances.saldo_inicial + EXCLUDED.saldo_inicial,
        cargos        = accounting_period_balances.cargos        + EXCLUDED.cargos,
        abonos        = accounting_period_balances.abonos        + EXCLUDED.abonos,
        saldo_final   = accounting_period_balances.saldo_final   + EXCLUDED.saldo_final,
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
