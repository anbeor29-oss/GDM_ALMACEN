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
  // Cuentas de RESULTADOS: por `tipo`, O por su AGRUPADOR SAT (4=ingresos,
  // 5=costos, 6/7=gastos). El agrupador cubre catálogos importados cuyo `tipo`
  // quedó mal clasificado (si no, el cierre no encontraba nada que cerrar).
  const r = await query<any>(
    `SELECT a.id, a.codigo, a.nombre, a.tipo, a.naturaleza, a.codigo_agrupador,
            COALESCE(SUM(l.cargo),0)::float AS cargos,
            COALESCE(SUM(l.abono),0)::float AS abonos
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounting_accounts a ON a.id = l.account_id
      WHERE e.company_id=$1 AND EXTRACT(YEAR FROM e.fecha)=$2
        AND ($3::int IS NULL OR EXTRACT(MONTH FROM e.fecha)=$3)
        AND (a.tipo IN ('INGRESO','COSTO','GASTO')
             OR LEFT(COALESCE(a.codigo_agrupador,''),1) IN ('4','5','6','7'))
        AND COALESCE(e.regla,'') NOT LIKE 'cierre%'
      GROUP BY a.id, a.codigo, a.nombre, a.tipo, a.naturaleza, a.codigo_agrupador
      HAVING COALESCE(SUM(l.cargo),0) <> 0 OR COALESCE(SUM(l.abono),0) <> 0
      ORDER BY a.codigo`, [companyId, anio, mes ?? null]);
  return r.rows.map((x: any) => {
    const cargos = r2(x.cargos), abonos = r2(x.abonos);
    // Ingreso vs egreso: el agrupador manda (4=ingreso acreedor; 5/6/7=gasto
    // deudor); si no hay agrupador, la naturaleza de la cuenta.
    const agr1 = String(x.codigo_agrupador || '')[0];
    const acreedora = agr1 === '4' ? true : ['5', '6', '7'].includes(agr1) ? false : x.naturaleza === 'ACREEDORA';
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

  /* Operaciones en MONEDA EXTRANJERA del periodo, con el tipo de cambio con que
   * se registraron. Sirve para el aviso del cierre: si el cliente operó en USD/EUR,
   * quien cierra ve a qué tipo de cambio quedaron los pesos. Sale de los CFDI del
   * periodo (moneda ≠ MXN). Si todo fue en pesos, la lista viene vacía. */
  const mon = await query<any>(
    `SELECT COALESCE(moneda,'MXN') AS moneda, COUNT(*)::int AS n,
            MIN(NULLIF(tipo_cambio,0)) AS tc_min, MAX(tipo_cambio) AS tc_max
       FROM cfdi_recibidos
      WHERE company_id=$1 AND EXTRACT(YEAR FROM fecha_emision)=$2
        AND ($3::int IS NULL OR EXTRACT(MONTH FROM fecha_emision)=$3)
        AND COALESCE(moneda,'MXN') NOT IN ('MXN','XXX','')
      GROUP BY moneda ORDER BY moneda`,
    [companyId, anio, mes ?? null]);
  const monedaExtranjera = mon.rows.map((x: any) => ({
    moneda: x.moneda, operaciones: x.n,
    tcMin: x.tc_min != null ? Number(x.tc_min) : null,
    tcMax: x.tc_max != null ? Number(x.tc_max) : null,
  }));

  return {
    anio, mes: mes ?? null, ingresos, egresos, resultado, utilidad: resultado >= 0,
    cuentas,
    cierreAsentado: cierre ? { folio: cierre.folio, fecha: cierre.fecha } : null,
    monedaExtranjera,
  };
}

/** Los meses del año que YA tienen póliza de cierre (para reabrir y corregir). */
export async function mesesCerrados(companyId: string, anio: number): Promise<number[]> {
  const uuids = Array.from({ length: 12 }, (_, i) => uuidMesDe(anio, i + 1));
  const r = await query<any>(
    `SELECT origen_uuid FROM journal_entries WHERE company_id=$1 AND origen_uuid = ANY($2::text[])`,
    [companyId, uuids]);
  const set = new Set(r.rows.map((x: any) => x.origen_uuid));
  const out: number[] = [];
  for (let m = 1; m <= 12; m++) if (set.has(uuidMesDe(anio, m))) out.push(m);
  return out;
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
  companyId: string, anio: number, utilidad: boolean, cuentaForzadaId?: string,
): Promise<{ id: string; codigo: string; creada: boolean } | { error: string }> {
  // Si el usuario eligió/capturó una cuenta para acumular el resultado, se usa ESA
  // (siempre que acepte movimientos). Evita que el automático caiga en una 305.01/
  // 305.02 que sólo existe como control (agrupador) y no deja registrar.
  if (cuentaForzadaId) {
    const c = (await query<any>(
      `SELECT id, codigo, permite_movimientos FROM accounting_accounts WHERE company_id=$1 AND id=$2`,
      [companyId, cuentaForzadaId])).rows[0];
    if (!c) return { error: 'La cuenta de resultado elegida no existe en esta empresa.' };
    if (!c.permite_movimientos) {
      return { error: `La cuenta ${c.codigo} es de control (no acepta movimientos): elige o captura una cuenta de detalle del bloque de capital.` };
    }
    return { id: c.id, codigo: c.codigo, creada: false };
  }

  const nombre = `Resultado del ejercicio ${anio}`;

  /* 1) USAR la cuenta de resultado de ESTE año si ya existe —incluida la que el
   *    usuario capturó a mano—. Match FLEXIBLE (con o sin «del», mayúsc./minúsc.),
   *    bajo cualquier 305, y SIN importar el signo: la utilidad y la pérdida van a
   *    la MISMA cuenta (un número con signo), NO a ramas 305.01/305.02 separadas.
   *    Así la pérdida se acumula bajo «RESULTADO DE EJERCICIOS» como los demás años. */
  const ya = (await query<any>(
    `SELECT id, codigo FROM accounting_accounts
      WHERE company_id=$1 AND permite_movimientos AND codigo_agrupador LIKE '305%'
        AND lower(nombre) LIKE $2
      ORDER BY codigo LIMIT 1`, [companyId, `%resultado%${anio}%`])).rows[0];
  if (ya) return { id: ya.id, codigo: ya.codigo, creada: false };

  /* 2) Crear bajo el MISMO padre donde viven los resultados de los OTROS años
   *    (p.ej. «3-2-00-00 RESULTADO DE EJERCICIOS»), heredando su naturaleza —así
   *    todos los ejercicios quedan juntos y el reporte los consolida—. Si no hay
   *    hermanos, se cuelga del control 305. */
  const hermano = (await query<any>(
    `SELECT parent_id FROM accounting_accounts
      WHERE company_id=$1 AND permite_movimientos AND codigo_agrupador LIKE '305%'
        AND lower(nombre) LIKE '%resultado%' AND parent_id IS NOT NULL
      ORDER BY codigo DESC LIMIT 1`, [companyId])).rows[0];
  let mayor: any = null;
  if (hermano?.parent_id) {
    mayor = (await query<any>(
      `SELECT id, codigo, nivel, naturaleza, codigo_agrupador FROM accounting_accounts WHERE id=$1`,
      [hermano.parent_id])).rows[0];
  }
  if (!mayor) {
    mayor = (await query<any>(
      `SELECT id, codigo, nivel, naturaleza, codigo_agrupador FROM accounting_accounts
        WHERE company_id=$1 AND NOT permite_movimientos AND codigo_agrupador LIKE '305%'
        ORDER BY nivel DESC, codigo LIMIT 1`, [companyId])).rows[0];
  }
  if (!mayor) {
    return { error: 'No hay una cuenta de capital de «Resultado de ejercicios» (agrupador 305) en el catálogo. Créala primero en el bloque 3 de capital.' };
  }

  const natur = mayor.naturaleza || 'ACREEDORA';
  // Agrupador: el del padre si es un detalle (305.01/305.02); si el padre es el
  // genérico «305», se usa 305.01 (rubro de resultado del ejercicio).
  const agr = (mayor.codigo_agrupador && mayor.codigo_agrupador !== '305') ? mayor.codigo_agrupador : '305.01';
  const codigo = await siguienteCodigoHijo(companyId, String(mayor.codigo), mayor.id);
  if (!codigo) return { error: `No se pudo generar un código libre bajo «${mayor.codigo}».` };

  const ins = (await query<any>(
    `INSERT INTO accounting_accounts
       (company_id, parent_id, codigo, nombre, codigo_agrupador, tipo, naturaleza,
        es_complementaria, nivel, permite_movimientos, requiere_tercero, moneda, activa)
     VALUES ($1,$2,$3,$4,$5,'CAPITAL',$6,false,$7,true,false,'MXN',true)
     RETURNING id, codigo`,
    [companyId, mayor.id, codigo, nombre, agr, natur, (mayor.nivel || 1) + 1])).rows[0];
  return { id: ins.id, codigo: ins.codigo, creada: true };
}

/**
 * Siguiente código LIBRE para un hijo de `padreCodigo`, respetando la MÁSCARA: toma
 * el hijo de mayor código e incrementa su ÚLTIMO segmento (3-2-00-04 → 3-2-00-05);
 * si no hay hijos, pone «1» en el último segmento del padre. Para códigos SIN
 * separadores (p.ej. «305») cae a «305»+«01», «02»… como antes.
 */
async function siguienteCodigoHijo(companyId: string, padreCodigo: string, padreId: string): Promise<string | null> {
  const hijos = (await query<any>(
    `SELECT codigo FROM accounting_accounts WHERE company_id=$1 AND parent_id=$2`, [companyId, padreId])).rows;
  const existe = async (cod: string) =>
    (await query<any>(`SELECT 1 FROM accounting_accounts WHERE company_id=$1 AND codigo=$2`, [companyId, cod])).rows[0];

  const sepMatch = padreCodigo.match(/[.\-\s/]/);
  if (sepMatch) {
    const sep = sepMatch[0];
    const partes = padreCodigo.split(/[.\-\s/]/);
    const ancho = (partes[partes.length - 1] || '00').length || 2;
    let maxUlt = 0;
    for (const h of hijos) {
      const hp = String(h.codigo).split(/[.\-\s/]/);
      if (hp.length === partes.length) maxUlt = Math.max(maxUlt, Number(hp[hp.length - 1]) || 0);
    }
    for (let i = maxUlt + 1; i <= 99999; i++) {
      const cand = [...partes.slice(0, -1), String(i).padStart(ancho, '0')].join(sep);
      if (!(await existe(cand))) return cand;
    }
    return null;
  }
  // Sin separadores: padre + 01, 02, …
  const base = padreCodigo.replace(/0+$/, '') || padreCodigo;
  for (let i = 1; i <= 99; i++) {
    const cand = `${base}${String(i).padStart(2, '0')}`;
    if (!(await existe(cand))) return cand;
  }
  return null;
}

/** Genera (o REGENERA) la póliza de cierre del año. Re-ejecutable. */
export async function generarPolizaDeCierre(companyId: string, anio: number, userId?: string, cuentaResultadoId?: string) {
  const det = await determinarResultado(companyId, anio);
  if (!det.cuentas.length) return { error: `No hay movimientos de resultados en ${anio}: no hay nada que cerrar.` };

  const c305 = await resolverCuentaResultado(companyId, anio, det.resultado >= 0, cuentaResultadoId);
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
export async function generarPolizaDeCierreMes(companyId: string, anio: number, mes: number, userId?: string, cuentaResultadoId?: string) {
  if (!(mes >= 1 && mes <= 12)) return { error: 'mes inválido (1-12).' };
  const det = await determinarResultado(companyId, anio, mes);
  if (!det.cuentas.length) return { error: `No hay movimientos de resultados en ${mes}/${anio}: no hay nada que cerrar.` };

  const c305 = await resolverCuentaResultado(companyId, anio, det.resultado >= 0, cuentaResultadoId);
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
