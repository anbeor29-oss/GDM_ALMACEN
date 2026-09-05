/**
 * Conciliación banco → contabilidad.
 *
 * La contabilidad se arma CUADRANDO el estado de cuenta contra los XML: cada
 * movimiento del banco se casa con su comprobante (por importe y fecha) y genera
 * una póliza banco↔contraparte. Lo que el banco cobra o paga por su cuenta
 * (comisiones y su IVA) va a cuentas fijas que la empresa elige una sola vez.
 *
 * Reglas del match (las pidió el usuario):
 *  - Fecha del comprobante dentro de ±2 días del movimiento.
 *  - Importe igual; si difiere hasta ±10 centavos se SUGIERE (el usuario confirma);
 *    exacto (≤ ½ centavo) se marca listo. Más de 10 centavos no es match.
 *  - Depósito → comprobante EMITIDO (cobro a cliente). Retiro → RECIBIDO (pago a
 *    proveedor). Un concepto de comisión (o su IVA) no busca XML: va a su cuenta fija.
 */
import { query } from '../../config/database';
import { crearPoliza } from '../accounting/polizas.service';
import { resolverOCrearSubcuentaTercero } from '../accounting/catalogo-terceros.service';

const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const TOL = 0.10;             // ±10 centavos: dentro de esto se pregunta
const EXACTO = 0.005;         // ≤ ½ centavo: se da por bueno solo
const DIA = 86_400_000;

const esComisionTxt = (c: string) => /COMIS/i.test(c || '');
const esIvaTxt = (c: string) =>
  /\bI\.?\s?V\.?\s?A\.?\b/i.test(c || '') || /IMPUESTO AL VALOR/i.test(c || '');

/* ── Cuentas fijas de comisiones (una vez por empresa) ─────────────────────── */
export async function getConfig(companyId: string) {
  const r = await query<any>(
    `SELECT bc.cuenta_comisiones_id, bc.cuenta_iva_comisiones_id,
            cc.codigo AS comisiones_codigo, cc.nombre AS comisiones_nombre,
            ci.codigo AS iva_codigo, ci.nombre AS iva_nombre
       FROM bancos_config bc
       LEFT JOIN accounting_accounts cc ON cc.id = bc.cuenta_comisiones_id
       LEFT JOIN accounting_accounts ci ON ci.id = bc.cuenta_iva_comisiones_id
      WHERE bc.company_id=$1`, [companyId]);
  const x = r.rows[0] || {};
  return {
    cuentaComisionesId: x.cuenta_comisiones_id || null,
    cuentaIvaComisionesId: x.cuenta_iva_comisiones_id || null,
    comisionesCodigo: x.comisiones_codigo || null,
    comisionesNombre: x.comisiones_nombre || null,
    ivaCodigo: x.iva_codigo || null,
    ivaNombre: x.iva_nombre || null,
  };
}

export async function setCuentasComisiones(
  companyId: string, comisionesId: string | null, ivaId: string | null,
) {
  await query(
    `INSERT INTO bancos_config (company_id, cuenta_comisiones_id, cuenta_iva_comisiones_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (company_id) DO UPDATE SET
       cuenta_comisiones_id = EXCLUDED.cuenta_comisiones_id,
       cuenta_iva_comisiones_id = EXCLUDED.cuenta_iva_comisiones_id, updated_at=NOW()`,
    [companyId, comisionesId || null, ivaId || null]);
  return getConfig(companyId);
}

/* ── Sugerir: analiza todos los movimientos de un estado y les pone su match ── */
export async function sugerir(companyId: string, estadoId: string) {
  const est = await query<any>(
    `SELECT id, cuenta_id FROM bancos_estados_cuenta WHERE id=$1 AND company_id=$2`,
    [estadoId, companyId]);
  if (!est.rows[0]) return { error: 'no se encontró el estado de cuenta' };

  const movs = (await query<any>(
    `SELECT id, fecha, concepto, retiro, deposito, poliza_id, concil_estado
       FROM bancos_movimientos
      WHERE company_id=$1 AND estado_id=$2 AND inferido=false
      ORDER BY orden, fecha`, [companyId, estadoId])).rows;
  if (!movs.length) return { revisados: 0, sugeridos: 0, confirmados: 0, comisiones: 0, otros: 0 };

  const tiempos = movs.map((m: any) => new Date(m.fecha).getTime()).filter((t: number) => !isNaN(t));
  const desde = new Date(Math.min(...tiempos) - 2 * DIA).toISOString().slice(0, 10);
  const hasta = new Date(Math.max(...tiempos) + 2 * DIA).toISOString().slice(0, 10);

  const cargar = async (direccion: 'emitidos' | 'recibidos') => (await query<any>(
    `SELECT uuid, total, fecha_emision::date AS fecha
       FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion=$2 AND tipo_comprobante='I'
        AND (estado_sat IS NULL OR estado_sat<>'Cancelado') AND total IS NOT NULL
        AND fecha_emision::date BETWEEN $3 AND $4`, [companyId, direccion, desde, hasta])).rows;
  const emit = await cargar('emitidos');
  const recib = await cargar('recibidos');

  // No re-usar un XML ya amarrado a un movimiento contabilizado.
  const usados = new Set<string>((await query<any>(
    `SELECT DISTINCT cfdi_uuid FROM bancos_movimientos
      WHERE company_id=$1 AND cfdi_uuid IS NOT NULL AND poliza_id IS NOT NULL`, [companyId]))
    .rows.map((r: any) => String(r.cfdi_uuid)));

  const matchear = (monto: number, fechaMov: Date, cands: any[]) => {
    let best: any = null, bestDiff = Infinity, bestDia = Infinity;
    for (const c of cands) {
      if (usados.has(c.uuid)) continue;
      const diff = Math.abs(round2(c.total) - round2(monto));
      if (diff > TOL) continue;
      const dd = Math.abs(fechaMov.getTime() - new Date(c.fecha).getTime()) / DIA;
      if (dd > 2) continue;
      if (diff < bestDiff - 1e-4 || (Math.abs(diff - bestDiff) < 1e-4 && dd < bestDia)) {
        best = c; bestDiff = diff; bestDia = dd;
      }
    }
    return best ? { uuid: best.uuid, diff: round2(bestDiff) } : null;
  };

  let sugeridos = 0, confirmados = 0, comisiones = 0, otros = 0;
  for (const m of movs) {
    if (m.poliza_id || m.concil_estado === 'omitido') continue;   // ya cerrado por el usuario
    const fecha = new Date(m.fecha);
    const dep = round2(m.deposito), ret = round2(m.retiro);
    let clasificacion = 'otro', cfdi: string | null = null, estado = 'pendiente', diff: number | null = null;

    if (esComisionTxt(m.concepto)) {
      clasificacion = esIvaTxt(m.concepto) ? 'iva_comision' : 'comision';
      estado = 'confirmado'; comisiones++;
    } else if (dep > 0) {
      const hit = matchear(dep, fecha, emit);
      if (hit) { clasificacion = 'cobro'; cfdi = hit.uuid; diff = hit.diff; usados.add(hit.uuid); estado = hit.diff <= EXACTO ? 'confirmado' : 'sugerido'; estado === 'confirmado' ? confirmados++ : sugeridos++; }
      else { otros++; }
    } else if (ret > 0) {
      const hit = matchear(ret, fecha, recib);
      if (hit) { clasificacion = 'pago'; cfdi = hit.uuid; diff = hit.diff; usados.add(hit.uuid); estado = hit.diff <= EXACTO ? 'confirmado' : 'sugerido'; estado === 'confirmado' ? confirmados++ : sugeridos++; }
      else { otros++; }
    } else { otros++; }

    await query(
      `UPDATE bancos_movimientos SET clasificacion=$2, cfdi_uuid=$3, concil_estado=$4, concil_diff=$5
        WHERE id=$1`, [m.id, clasificacion, cfdi, estado, diff]);
  }
  return { revisados: movs.length, sugeridos, confirmados, comisiones, otros };
}

/* ── Los movimientos de un estado, con su match y su póliza (para la pantalla) ─ */
export async function listarMovimientos(companyId: string, estadoId: string) {
  return (await query<any>(
    `SELECT bm.id, bm.fecha, bm.concepto, bm.retiro, bm.deposito, bm.saldo,
            bm.clasificacion, bm.cfdi_uuid, bm.concil_estado, bm.concil_diff,
            bm.poliza_id, bm.contra_cuenta_id,
            cf.rfc_emisor, cf.nombre_emisor, cf.rfc_receptor, cf.nombre_receptor,
            cf.total AS cfdi_total, cf.fecha_emision::date AS cfdi_fecha,
            je.folio AS poliza_folio, ca.codigo AS contra_codigo, ca.nombre AS contra_nombre
       FROM bancos_movimientos bm
       LEFT JOIN cfdi_recibidos cf ON cf.company_id=bm.company_id AND cf.uuid=bm.cfdi_uuid
       LEFT JOIN journal_entries je ON je.id = bm.poliza_id
       LEFT JOIN accounting_accounts ca ON ca.id = bm.contra_cuenta_id
      WHERE bm.company_id=$1 AND bm.estado_id=$2 AND bm.inferido=false
      ORDER BY bm.orden, bm.fecha`, [companyId, estadoId])).rows;
}

/* ── Marcar a mano: confirmar un sugerido, omitir, cambiar clasificación/contra ─ */
export async function marcar(
  companyId: string, movId: string,
  d: { clasificacion?: string; cfdiUuid?: string | null; concilEstado?: string; contraCuentaId?: string | null },
) {
  const campos: string[] = []; const args: any[] = [movId, companyId];
  const set = (c: string, v: any) => { args.push(v); campos.push(`${c}=$${args.length}`); };
  if (d.clasificacion !== undefined) set('clasificacion', d.clasificacion);
  if (d.cfdiUuid !== undefined) set('cfdi_uuid', d.cfdiUuid);
  if (d.concilEstado !== undefined) set('concil_estado', d.concilEstado);
  if (d.contraCuentaId !== undefined) set('contra_cuenta_id', d.contraCuentaId);
  if (!campos.length) return { error: 'nada que cambiar' };
  await query(
    `UPDATE bancos_movimientos SET ${campos.join(', ')}
      WHERE id=$1 AND company_id=$2 AND poliza_id IS NULL`, args);
  return { ok: true };
}

/* ── Contabilizar un movimiento: genera la póliza banco↔contraparte ─────────── */
export async function contabilizar(
  companyId: string, movId: string, opts?: { contraCuentaId?: string }, userId?: string,
): Promise<{ ok: true; folio: number } | { yaContabilizado: true } | { error: string }> {
  const m = (await query<any>(
    `SELECT bm.*, bc.cuenta_contable_id AS banco_cuenta_id
       FROM bancos_movimientos bm
       JOIN bancos_cuentas bc ON bc.id = bm.cuenta_id
      WHERE bm.id=$1 AND bm.company_id=$2`, [movId, companyId])).rows[0];
  if (!m) return { error: 'no se encontró el movimiento' };
  if (m.poliza_id) return { yaContabilizado: true };
  if (!m.banco_cuenta_id) return { error: 'define la cuenta contable (102-xx) de esta cuenta bancaria antes de contabilizar' };

  const dep = round2(m.deposito), ret = round2(m.retiro);
  const bankId = m.banco_cuenta_id;
  const fecha = String(m.fecha).slice(0, 10);
  const concepto = (m.concepto || 'Movimiento bancario').toString().slice(0, 180);
  const cfg = await getConfig(companyId);
  const lineas: any[] = [];
  let tipo: 'INGRESO' | 'EGRESO' | 'DIARIO' = dep > 0 ? 'INGRESO' : 'EGRESO';

  if (m.clasificacion === 'cobro') {
    if (!m.cfdi_uuid) return { error: 'falta el XML del cobro' };
    const c = (await query<any>(`SELECT rfc_receptor, nombre_receptor FROM cfdi_recibidos WHERE company_id=$1 AND uuid=$2 LIMIT 1`, [companyId, m.cfdi_uuid])).rows[0];
    if (!c) return { error: 'no se encontró el XML del cobro' };
    const cli = await resolverOCrearSubcuentaTercero(companyId, 'cliente', c.rfc_receptor, c.nombre_receptor);
    if ('error' in cli) return { error: `cliente: ${cli.error}` };
    lineas.push({ account_id: bankId, cargo: dep, concepto, uuid_cfdi: m.cfdi_uuid });
    lineas.push({ account_id: cli.id, abono: dep, concepto: 'Cobro cliente', uuid_cfdi: m.cfdi_uuid, party_rfc: c.rfc_receptor });
  } else if (m.clasificacion === 'pago') {
    if (!m.cfdi_uuid) return { error: 'falta el XML del pago' };
    const c = (await query<any>(`SELECT rfc_emisor, nombre_emisor FROM cfdi_recibidos WHERE company_id=$1 AND uuid=$2 LIMIT 1`, [companyId, m.cfdi_uuid])).rows[0];
    if (!c) return { error: 'no se encontró el XML del pago' };
    const prov = await resolverOCrearSubcuentaTercero(companyId, 'proveedor', c.rfc_emisor, c.nombre_emisor);
    if ('error' in prov) return { error: `proveedor: ${prov.error}` };
    lineas.push({ account_id: prov.id, cargo: ret, concepto: 'Pago proveedor', uuid_cfdi: m.cfdi_uuid, party_rfc: c.rfc_emisor });
    lineas.push({ account_id: bankId, abono: ret, concepto, uuid_cfdi: m.cfdi_uuid });
  } else if (m.clasificacion === 'comision') {
    if (!cfg.cuentaComisionesId) return { error: 'elige la cuenta de comisiones (arriba, en «Cuentas de comisiones»)' };
    lineas.push({ account_id: cfg.cuentaComisionesId, cargo: ret, concepto });
    lineas.push({ account_id: bankId, abono: ret, concepto });
  } else if (m.clasificacion === 'iva_comision') {
    if (!cfg.cuentaIvaComisionesId) return { error: 'elige la cuenta de IVA de comisiones (arriba, en «Cuentas de comisiones»)' };
    lineas.push({ account_id: cfg.cuentaIvaComisionesId, cargo: ret, concepto });
    lineas.push({ account_id: bankId, abono: ret, concepto });
  } else {
    const contra = opts?.contraCuentaId || m.contra_cuenta_id;
    if (!contra) return { error: 'elige la cuenta contra la que va este movimiento' };
    if (dep > 0) { lineas.push({ account_id: bankId, cargo: dep, concepto }); lineas.push({ account_id: contra, abono: dep, concepto }); }
    else { lineas.push({ account_id: contra, cargo: ret, concepto }); lineas.push({ account_id: bankId, abono: ret, concepto }); }
    tipo = 'DIARIO';
    await query(`UPDATE bancos_movimientos SET contra_cuenta_id=$2 WHERE id=$1`, [movId, contra]);
  }

  const pol = await crearPoliza(companyId, {
    tipo, fecha, concepto, origen: 'BANCO', origen_uuid: `BANCO:${movId}`, regla: 'conciliacion_banco', lineas,
  }, userId);
  await query(`UPDATE bancos_movimientos SET poliza_id=$2, concil_estado='contabilizado' WHERE id=$1`, [movId, pol.id]);
  return { ok: true, folio: pol.folio };
}

/* ── Contabilizar de golpe lo confirmado del estado ────────────────────────── */
export async function contabilizarLote(companyId: string, estadoId: string, userId?: string) {
  const movs = (await query<any>(
    `SELECT id FROM bancos_movimientos
      WHERE company_id=$1 AND estado_id=$2 AND poliza_id IS NULL
        AND concil_estado='confirmado'
        AND clasificacion IN ('cobro','pago','comision','iva_comision')
      ORDER BY orden`, [companyId, estadoId])).rows;
  let contabilizadas = 0; const errores: Array<{ id: string; error: string }> = [];
  for (const m of movs) {
    const r = await contabilizar(companyId, m.id, undefined, userId);
    if ('ok' in r) contabilizadas++;
    else if ('error' in r) errores.push({ id: m.id, error: r.error });
  }
  return { contabilizadas, errores };
}

/* ── Deshacer: borra la póliza de un movimiento (para rehacerlo) ────────────── */
export async function descontabilizar(companyId: string, movId: string) {
  const m = (await query<any>(`SELECT poliza_id FROM bancos_movimientos WHERE id=$1 AND company_id=$2`, [movId, companyId])).rows[0];
  if (!m) return { error: 'no se encontró el movimiento' };
  if (m.poliza_id) {
    await query(`DELETE FROM journal_lines WHERE entry_id=$1`, [m.poliza_id]);
    await query(`DELETE FROM journal_entries WHERE id=$1 AND company_id=$2`, [m.poliza_id, companyId]);
  }
  await query(`UPDATE bancos_movimientos SET poliza_id=NULL, concil_estado='confirmado' WHERE id=$1`, [movId]);
  return { ok: true };
}
