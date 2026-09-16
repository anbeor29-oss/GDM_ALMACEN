/**
 * Cierre del ejercicio (determinación del resultado) — proceso de ADMIN.
 *
 * QUÉ HACE
 * Determina la utilidad o pérdida del año (ingresos − costos − gastos) y arma la
 * PÓLIZA DE CIERRE: salda las cuentas de resultados (4xx/5xx/6xx/7xx) contra la
 * cuenta de capital «Resultado del ejercicio» (agrupador 305), que se crea al
 * vuelo si el catálogo no la trae.
 *
 * REGLAS (pedidas por el usuario)
 *  - El ISR y la PTU se capturan ANTES, a mano, como pólizas de ajuste; el cierre
 *    toma el resultado tal cual quede.
 *  - Es RE-EJECUTABLE N veces: cada corrida borra su póliza de cierre anterior y la
 *    regenera con lo que haya (incluidas pólizas manuales nuevas).
 *  - La póliza de cierre se marca con `regla='cierre_ejercicio'` y se EXCLUYE de la
 *    balanza reconstruida (periodos.service), para no dejar el estado de resultados
 *    del año en ceros. Es un asiento formal aparte.
 */
import { query, transaction, transactionQuery } from '../../config/database';
import { crearPoliza } from './polizas.service';
import type { PoolClient } from 'pg';

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const REGLA = 'cierre_ejercicio';
const REGLA_MES = 'cierre_mensual';
const uuidDe = (anio: number) => `CIERRE:${anio}`;
const uuidMesDe = (anio: number, mes: number) => `CIERREMES:${anio}-${String(mes).padStart(2, '0')}`;
const finDeMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);

export interface CuentaResultado {
  id: string; codigo: string; nombre: string; tipo: string; naturaleza: string;
  cargos: number; abonos: number; saldo: number; acreedora: boolean;
}

/** Los saldos de las cuentas de RESULTADOS (ingresos, costos, gastos) del año —o
 *  de UN mes si se pasa `mes`—, excluyendo TODA póliza de cierre (anual o mensual)
 *  para no contarlas doble. El saldo es el natural de la cuenta. */
async function saldosDeResultados(companyId: string, anio: number, mes?: number): Promise<CuentaResultado[]> {
  const r = await query<any>(
    `SELECT a.id, a.codigo, a.nombre, a.tipo, a.naturaleza,
            COALESCE(SUM(l.cargo),0)::float AS cargos,
            COALESCE(SUM(l.abono),0)::float AS abonos
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounting_accounts a ON a.id = l.account_id
      WHERE e.company_id=$1 AND EXTRACT(YEAR FROM e.fecha)=$2
        AND ($3::int IS NULL OR EXTRACT(MONTH FROM e.fecha)=$3)
        AND a.tipo IN ('INGRESO','COSTO','GASTO')
        AND COALESCE(e.regla,'') NOT LIKE 'cierre%'
      GROUP BY a.id, a.codigo, a.nombre, a.tipo, a.naturaleza
      HAVING COALESCE(SUM(l.cargo),0) <> 0 OR COALESCE(SUM(l.abono),0) <> 0
      ORDER BY a.codigo`, [companyId, anio, mes ?? null]);
  return r.rows.map((x: any) => {
    const cargos = r2(x.cargos), abonos = r2(x.abonos);
    const acreedora = x.naturaleza === 'ACREEDORA';
    return {
      id: x.id, codigo: x.codigo, nombre: x.nombre, tipo: x.tipo, naturaleza: x.naturaleza,
      cargos, abonos, acreedora,
      saldo: acreedora ? r2(abonos - cargos) : r2(cargos - abonos),
    };
  });
}

/** Utilidad o pérdida del ejercicio —o de UN mes si se pasa `mes`— (sólo cálculo). */
export async function determinarResultado(companyId: string, anio: number, mes?: number) {
  const cuentas = await saldosDeResultados(companyId, anio, mes);
  const ingresos = r2(cuentas.filter((c) => c.acreedora).reduce((a, c) => a + c.saldo, 0));
  const egresos  = r2(cuentas.filter((c) => !c.acreedora).reduce((a, c) => a + c.saldo, 0));
  const resultado = r2(ingresos - egresos);
  const uuid = mes ? uuidMesDe(anio, mes) : uuidDe(anio);
  const cierre = (await query<any>(
    `SELECT id, folio, TO_CHAR(fecha,'YYYY-MM-DD') AS fecha, created_at
       FROM journal_entries WHERE company_id=$1 AND origen_uuid=$2 LIMIT 1`,
    [companyId, uuid])).rows[0] || null;
  return {
    anio, mes: mes ?? null, ingresos, egresos, resultado, utilidad: resultado >= 0,
    cuentas,
    cierreAsentado: cierre ? { folio: cierre.folio, fecha: cierre.fecha } : null,
  };
}

/**
 * Cuenta de capital del RESULTADO del ejercicio, por AÑO y según el signo:
 *   · utilidad → agrupador 305.01, naturaleza ACREEDORA
 *   · pérdida  → agrupador 305.02, naturaleza DEUDORA
 * Se llama «Resultado Ejercicio {año}» (una por año). Si ya existe la de ese año y
 * el resultado cambió de signo entre corridas, se le corrige agrupador/naturaleza.
 * Si no existe, se crea colgada de su mayor 305 (o 305.01/305.02 si están como control).
 */
async function resolverCuentaResultado(
  companyId: string, anio: number, utilidad: boolean,
): Promise<{ id: string; codigo: string; creada: boolean } | { error: string }> {
  const agr = utilidad ? '305.01' : '305.02';
  const natur = utilidad ? 'ACREEDORA' : 'DEUDORA';
  const nombre = `Resultado Ejercicio ${anio}`;

  // ¿Ya existe la cuenta de resultado de ESTE año? (por nombre, bajo el 305).
  const ya = (await query<any>(
    `SELECT id, codigo, codigo_agrupador FROM accounting_accounts
      WHERE company_id=$1 AND permite_movimientos AND codigo_agrupador LIKE '305%' AND nombre=$2
      LIMIT 1`, [companyId, nombre])).rows[0];
  if (ya) {
    if (ya.codigo_agrupador !== agr) {
      // El signo cambió (utilidad↔pérdida) entre corridas: corrige el rubro.
      await query(`UPDATE accounting_accounts SET codigo_agrupador=$2, naturaleza=$3 WHERE id=$1`, [ya.id, agr, natur]);
    }
    return { id: ya.id, codigo: ya.codigo, creada: false };
  }

  // Mayor del que cuelga: 305.01/305.02 como control si existe; si no, el 305.
  const mayor = (await query<any>(
    `SELECT id, codigo, nivel FROM accounting_accounts
      WHERE company_id=$1 AND NOT permite_movimientos AND codigo_agrupador IN ($2,'305')
      ORDER BY (codigo_agrupador=$2) DESC, nivel DESC LIMIT 1`, [companyId, agr])).rows[0];

  const base = (mayor?.codigo ? String(mayor.codigo).replace(/\D+$/, '') : '305');
  let codigo = '';
  for (let i = 1; i <= 99; i++) {
    const cand = `${base}${String(i).padStart(2, '0')}`;
    const existe = (await query<any>(`SELECT 1 FROM accounting_accounts WHERE company_id=$1 AND codigo=$2`, [companyId, cand])).rows[0];
    if (!existe) { codigo = cand; break; }
  }
  if (!codigo) return { error: 'no se pudo generar un código libre para la cuenta 305 (Resultado del ejercicio).' };

  const ins = (await query<any>(
    `INSERT INTO accounting_accounts
       (company_id, parent_id, codigo, nombre, codigo_agrupador, tipo, naturaleza,
        es_complementaria, nivel, permite_movimientos, requiere_tercero, moneda, activa)
     VALUES ($1,$2,$3,$4,$5,'CAPITAL',$6,false,$7,true,false,'MXN',true)
     RETURNING id, codigo`,
    [companyId, mayor?.id || null, codigo, nombre, agr, natur, mayor ? mayor.nivel + 1 : 1])).rows[0];
  return { id: ins.id, codigo: ins.codigo, creada: true };
}

/** Genera (o REGENERA) la póliza de cierre del año. Re-ejecutable. */
export async function generarPolizaDeCierre(companyId: string, anio: number, userId?: string) {
  const det = await determinarResultado(companyId, anio);
  if (!det.cuentas.length) return { error: `No hay movimientos de resultados en ${anio}: no hay nada que cerrar.` };

  const c305 = await resolverCuentaResultado(companyId, anio, det.resultado >= 0);
  if ('error' in c305) return c305;

  const lineas: any[] = [];
  for (const c of det.cuentas) {
    const netCargo = r2(c.cargos - c.abonos);   // >0 saldo deudor · <0 saldo acreedor
    if (Math.abs(netCargo) < 0.005) continue;
    if (netCargo > 0) lineas.push({ account_id: c.id, abono: netCargo, concepto: `Cierre ${anio} · ${c.codigo}` });
    else lineas.push({ account_id: c.id, cargo: r2(-netCargo), concepto: `Cierre ${anio} · ${c.codigo}` });
  }
  if (det.resultado >= 0) lineas.push({ account_id: c305.id, abono: r2(det.resultado), concepto: `Resultado del ejercicio ${anio} (utilidad)` });
  else lineas.push({ account_id: c305.id, cargo: r2(-det.resultado), concepto: `Resultado del ejercicio ${anio} (pérdida)` });
  if (lineas.length < 2) return { error: 'El resultado es cero: no se genera póliza de cierre.' };

  // Re-ejecutable: se borra la póliza de cierre anterior de ese año (el UNIQUE de
  // origen_uuid no deja dos), y se vuelve a asentar con lo que haya hoy.
  await query(`DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE company_id=$1 AND origen_uuid=$2)`, [companyId, uuidDe(anio)]);
  await query(`DELETE FROM journal_entries WHERE company_id=$1 AND origen_uuid=$2`, [companyId, uuidDe(anio)]);

  const pol = await crearPoliza(companyId, {
    tipo: 'DIARIO', fecha: `${anio}-12-31`,
    concepto: `Cierre del ejercicio ${anio} — ${det.resultado >= 0 ? 'utilidad' : 'pérdida'} ${Math.abs(det.resultado).toFixed(2)}`,
    origen: 'MANUAL', origen_uuid: uuidDe(anio), regla: REGLA, lineas,
  } as any, userId);

  return {
    ok: true as const, folio: pol.folio, cuenta305: c305.codigo, cuenta305Creada: c305.creada,
    resultado: det.resultado, utilidad: det.resultado >= 0, ingresos: det.ingresos, egresos: det.egresos,
    renglones: lineas.length,
  };
}

/** Deshace la póliza de cierre del año (por si se generó de más). */
export async function revertirCierre(companyId: string, anio: number) {
  const del = await query<any>(
    `DELETE FROM journal_entries WHERE company_id=$1 AND origen_uuid=$2 RETURNING id`,
    [companyId, uuidDe(anio)]);
  return { revertida: del.rows.length > 0 };
}

/**
 * Cierre MENSUAL — determina la utilidad/pérdida del MES y arma su póliza formal
 * (salda las nominales del mes contra la 305.01/305.02). Es re-ejecutable y va con
 * `regla='cierre_mensual'`, así que —igual que el anual— se EXCLUYE de la balanza
 * operativa y del arrastre de saldos al año siguiente (no duplica ni descuadra el
 * estado de resultados). Sirve para dejar asentado el resultado del mes (pagos
 * provisionales). El cierre que pasa a capital al cruzar de año es el ANUAL.
 */
export async function generarPolizaDeCierreMes(companyId: string, anio: number, mes: number, userId?: string) {
  if (!(mes >= 1 && mes <= 12)) return { error: 'mes inválido (1-12).' };
  const det = await determinarResultado(companyId, anio, mes);
  if (!det.cuentas.length) return { error: `No hay movimientos de resultados en ${mes}/${anio}: no hay nada que cerrar.` };

  const c305 = await resolverCuentaResultado(companyId, anio, det.resultado >= 0);
  if ('error' in c305) return c305;

  const lineas: any[] = [];
  for (const c of det.cuentas) {
    const netCargo = r2(c.cargos - c.abonos);
    if (Math.abs(netCargo) < 0.005) continue;
    if (netCargo > 0) lineas.push({ account_id: c.id, abono: netCargo, concepto: `Cierre ${mes}/${anio} · ${c.codigo}` });
    else lineas.push({ account_id: c.id, cargo: r2(-netCargo), concepto: `Cierre ${mes}/${anio} · ${c.codigo}` });
  }
  if (det.resultado >= 0) lineas.push({ account_id: c305.id, abono: r2(det.resultado), concepto: `Resultado del mes ${mes}/${anio} (utilidad)` });
  else lineas.push({ account_id: c305.id, cargo: r2(-det.resultado), concepto: `Resultado del mes ${mes}/${anio} (pérdida)` });
  if (lineas.length < 2) return { error: 'El resultado del mes es cero: no se genera póliza.' };

  await query(`DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE company_id=$1 AND origen_uuid=$2)`, [companyId, uuidMesDe(anio, mes)]);
  await query(`DELETE FROM journal_entries WHERE company_id=$1 AND origen_uuid=$2`, [companyId, uuidMesDe(anio, mes)]);

  const pol = await crearPoliza(companyId, {
    tipo: 'DIARIO', fecha: finDeMes(anio, mes),
    concepto: `Cierre mensual ${mes}/${anio} — ${det.resultado >= 0 ? 'utilidad' : 'pérdida'} ${Math.abs(det.resultado).toFixed(2)}`,
    origen: 'MANUAL', origen_uuid: uuidMesDe(anio, mes), regla: REGLA_MES, lineas,
  } as any, userId);

  return {
    ok: true as const, folio: pol.folio, cuenta305: c305.codigo, cuenta305Creada: c305.creada,
    resultado: det.resultado, utilidad: det.resultado >= 0, ingresos: det.ingresos, egresos: det.egresos,
    renglones: lineas.length,
  };
}

/** Deshace la póliza de cierre de un mes. */
export async function revertirCierreMes(companyId: string, anio: number, mes: number) {
  const del = await query<any>(
    `DELETE FROM journal_entries WHERE company_id=$1 AND origen_uuid=$2 RETURNING id`,
    [companyId, uuidMesDe(anio, mes)]);
  return { revertida: del.rows.length > 0 };
}
