/**
 * Póliza de pasivo de nómina — coloca cada concepto del recibo TIMBRADO en su
 * cuenta (PLAN_CONTABILIDAD §2.4 F). No calcula importes: los da el recibo.
 *
 *   Percepciones            → CARGO a gasto 601.xx (por su clave del Anexo 20)
 *   Subsidio al empleo       → CARGO a 110.01 (activo: saldo a favor vs ISR)
 *   Deducciones (ISR, IMSS…) → ABONO a pasivo 216.xx / 205 (retención al trabajador)
 *   Neto por pagar           → ABONO a 210.01 (provisión de sueldos por pagar)
 *
 * SIEMPRE cuadra: por construcción del CFDI, neto = percepciones + otros pagos −
 * deducciones, así que Σcargo (perc + subsidio) = Σabono (deducciones + neto).
 *
 * Pensada para el FINIQUITO (un recibo timbrado de un periodo especial), pero
 * sirve para cualquier recibo timbrado. Idempotente por el UUID del CFDI: un
 * recibo = una póliza.
 */
import { query } from '../../config/database';
import { crearPoliza, LineaPoliza } from '../accounting/polizas.service';
import { conceptosConCuenta } from './conceptos-cuenta.service';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';

const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

export interface ReciboPoliza {
  id: string; uuid: string | null; estatus: string | null;
  num_empleado: string; nombre: string; rfc: string; dias: number;
  total_percepciones: number; total_deducciones: number; total_otros_pagos: number;
  total_gravado: number; total_exento: number; isr: number; imss: number; neto: number;
  percepciones: Array<{ clave: string; concepto: string; gravado: number; exento: number }>;
  deducciones: Array<{ clave: string; concepto: string; importe: number }>;
  periodo_id: string; periodo_numero: number; periodo_concepto: string;
  fecha_inicio: string; fecha_fin: string; finiquito_tipo: string | null;
}

async function cargarRecibo(companyId: string, reciboId: string): Promise<ReciboPoliza> {
  const r = await query<any>(
    `SELECT r.id, r.uuid, r.estatus, r.num_empleado, r.nombre, r.rfc, r.dias,
            r.total_percepciones, r.total_deducciones, COALESCE(r.total_otros_pagos,0) AS total_otros_pagos,
            r.total_gravado, r.total_exento, r.isr, r.imss, r.neto,
            r.percepciones, r.deducciones, r.periodo_id,
            p.numero AS periodo_numero, p.concepto AS periodo_concepto,
            TO_CHAR(p.fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,
            TO_CHAR(p.fecha_fin,'YYYY-MM-DD') AS fecha_fin, p.finiquito_tipo
       FROM nomina_recibos r
       JOIN nomina_periodos p ON p.id = r.periodo_id
      WHERE r.id = $1 AND r.company_id = $2`,
    [reciboId, companyId]);
  if (r.rows.length === 0) throw new NotFoundError('No encontré ese recibo de nómina');
  const x = r.rows[0];
  return {
    ...x,
    percepciones: Array.isArray(x.percepciones) ? x.percepciones : [],
    deducciones: Array.isArray(x.deducciones) ? x.deducciones : [],
  };
}

/** Los finiquitos/liquidaciones TIMBRADOS (con UUID): lo que se puede contabilizar. */
export async function finiquitosTimbrados(companyId: string) {
  const r = await query<any>(
    `SELECT r.id AS recibo_id, r.uuid, r.nombre, r.num_empleado, r.neto,
            p.numero AS periodo_numero, p.finiquito_tipo,
            TO_CHAR(p.fecha_fin,'YYYY-MM-DD') AS fecha_baja,
            TO_CHAR(r.timbrado_at,'YYYY-MM-DD HH24:MI') AS timbrado_at,
            EXISTS (SELECT 1 FROM journal_entries e
                     WHERE e.company_id = r.company_id AND e.origen_uuid = r.uuid) AS con_poliza
       FROM nomina_recibos r
       JOIN nomina_periodos p ON p.id = r.periodo_id
      WHERE r.company_id = $1 AND p.finiquito_tipo IS NOT NULL AND r.uuid IS NOT NULL
      ORDER BY p.fecha_fin DESC, r.nombre`,
    [companyId]);
  return r.rows;
}

/**
 * La representación del finiquito: el ingreso por concepto con su parte gravada
 * y exenta, el ISR y el neto a cobrar. Es lo que se enseña y va al PDF.
 */
export async function representacionFiniquito(companyId: string, reciboId: string) {
  const r = await cargarRecibo(companyId, reciboId);
  const percepciones = r.percepciones.map((p) => ({
    clave: p.clave, concepto: p.concepto,
    gravado: round2(p.gravado), exento: round2(p.exento),
    importe: round2((Number(p.gravado) || 0) + (Number(p.exento) || 0)),
  }));
  return {
    empleado: { num_empleado: r.num_empleado, nombre: r.nombre, rfc: r.rfc },
    periodo: {
      numero: r.periodo_numero, concepto: r.periodo_concepto,
      fecha_inicio: r.fecha_inicio, fecha_fin: r.fecha_fin,
      tipo: r.finiquito_tipo, dias: r.dias, uuid: r.uuid,
    },
    percepciones,
    deducciones: r.deducciones.map((d) => ({ clave: d.clave, concepto: d.concepto, importe: round2(d.importe) })),
    subsidio: round2(r.total_otros_pagos),
    totales: {
      percepciones: round2(r.total_percepciones),
      gravado: round2(r.total_gravado),
      exento: round2(r.total_exento),
      isr: round2(r.isr),
      deducciones: round2(r.total_deducciones),
      neto: round2(r.neto),
    },
  };
}

/**
 * Arma las partidas de la póliza (sin escribir): resuelve cada concepto a su
 * cuenta por el mapeo de la empresa. Lo que no tenga cuenta se reporta como
 * faltante en vez de armar una póliza incompleta.
 */
export async function armarPoliza(companyId: string, reciboId: string) {
  const r = await cargarRecibo(companyId, reciboId);
  const cfg = await conceptosConCuenta(companyId);
  const cuentaDe = (grupo: string, clave: string) =>
    cfg.find((c: any) => c.grupo === grupo && c.clave === clave)?.cuenta || null;

  const lineas: Array<LineaPoliza & { codigo?: string; nombre?: string }> = [];
  const faltantes: Array<{ grupo: string; clave: string; concepto: string; importe: number; sugerida: string | null }> = [];

  const pushFaltante = (grupo: string, clave: string, concepto: string, importe: number) =>
    faltantes.push({
      grupo, clave, concepto, importe: round2(importe),
      sugerida: cfg.find((c: any) => c.grupo === grupo && c.clave === clave)?.sugerida || null,
    });

  // Resuelve un código de cuenta a su id y nombre (debe existir y admitir movimientos).
  const resolver = async (codigo: string): Promise<{ id: string; nombre: string } | null> => {
    const q = await query<any>(
      `SELECT id, nombre FROM accounting_accounts
        WHERE company_id=$1 AND codigo=$2 AND activa=true AND permite_movimientos=true LIMIT 1`,
      [companyId, codigo]);
    return q.rows[0] ? { id: q.rows[0].id, nombre: q.rows[0].nombre } : null;
  };

  // ── Percepciones → cargo 601.xx ──
  for (const p of r.percepciones) {
    const importe = round2((Number(p.gravado) || 0) + (Number(p.exento) || 0));
    if (importe <= 0) continue;
    const cod = cuentaDe('PERCEPCION', p.clave);
    if (!cod) { pushFaltante('PERCEPCION', p.clave, p.concepto, importe); continue; }
    const cta = await resolver(cod);
    if (!cta) { pushFaltante('PERCEPCION', p.clave, `${p.concepto} (cuenta ${cod} inexistente)`, importe); continue; }
    lineas.push({ account_id: cta.id, codigo: cod, nombre: cta.nombre, cargo: importe, concepto: p.concepto, uuid_cfdi: r.uuid });
  }

  // ── Subsidio al empleo entregado → cargo 110.01 (activo) ──
  const subsidio = round2(r.total_otros_pagos);
  if (subsidio > 0) {
    const cod = cuentaDe('PERCEPCION', 'SUBSIDIO');
    const cta = cod ? await resolver(cod) : null;
    if (!cta) pushFaltante('PERCEPCION', 'SUBSIDIO', 'Subsidio al empleo por aplicar', subsidio);
    else lineas.push({ account_id: cta.id, codigo: cod!, nombre: cta.nombre, cargo: subsidio, concepto: 'Subsidio al empleo por aplicar', uuid_cfdi: r.uuid });
  }

  // ── Deducciones → abono 216.xx / 205 ──
  for (const d of r.deducciones) {
    const importe = round2(d.importe);
    if (importe <= 0) continue;
    const cod = cuentaDe('DEDUCCION', d.clave);
    if (!cod) { pushFaltante('DEDUCCION', d.clave, d.concepto, importe); continue; }
    const cta = await resolver(cod);
    if (!cta) { pushFaltante('DEDUCCION', d.clave, `${d.concepto} (cuenta ${cod} inexistente)`, importe); continue; }
    lineas.push({ account_id: cta.id, codigo: cod, nombre: cta.nombre, abono: importe, concepto: d.concepto, uuid_cfdi: r.uuid });
  }

  // ── Neto por pagar → abono 210.01 ──
  const neto = round2(r.neto);
  if (neto > 0) {
    const cod = cuentaDe('NETO', 'NETO');
    const cta = cod ? await resolver(cod) : null;
    if (!cta) pushFaltante('NETO', 'NETO', 'Neto por pagar (provisión de sueldos)', neto);
    else lineas.push({ account_id: cta.id, codigo: cod!, nombre: cta.nombre, abono: neto, concepto: 'Neto por pagar', uuid_cfdi: r.uuid });
  }

  const sumaCargo = round2(lineas.reduce((a, l) => a + (l.cargo || 0), 0));
  const sumaAbono = round2(lineas.reduce((a, l) => a + (l.abono || 0), 0));

  return {
    recibo: { id: r.id, uuid: r.uuid, nombre: r.nombre, periodo_numero: r.periodo_numero, fecha: r.fecha_fin, finiquito_tipo: r.finiquito_tipo },
    lineas, faltantes,
    sumaCargo, sumaAbono,
    cuadra: faltantes.length === 0 && Math.abs(sumaCargo - sumaAbono) <= 0.02,
    yaGenerada: r.uuid ? await existePoliza(companyId, r.uuid) : false,
  };
}

async function existePoliza(companyId: string, uuid: string): Promise<boolean> {
  const q = await query(
    `SELECT 1 FROM journal_entries WHERE company_id=$1 AND origen_uuid=$2 LIMIT 1`,
    [companyId, uuid]);
  return (q.rowCount || 0) > 0;
}

/** Crea la póliza de pasivo del recibo. Idempotente por el UUID del CFDI. */
export async function generarPoliza(companyId: string, reciboId: string, userId?: string) {
  const armado = await armarPoliza(companyId, reciboId);
  if (!armado.recibo.uuid) throw new ValidationError('El recibo no está timbrado: sin UUID no hay póliza.');
  if (armado.yaGenerada) return { creada: false, motivo: 'Ya existía la póliza de este recibo.' };
  if (armado.faltantes.length > 0) {
    throw new ValidationError(
      `Faltan ${armado.faltantes.length} concepto(s) por asignar cuenta: ` +
      armado.faltantes.map((f) => `${f.concepto}`).join(', ').slice(0, 200));
  }
  if (!armado.cuadra) throw new ValidationError(`La póliza no cuadra: cargo ${armado.sumaCargo} vs abono ${armado.sumaAbono}.`);

  const etiqueta = armado.recibo.finiquito_tipo === 'LIQUIDACION' ? 'Liquidación' : 'Finiquito';
  const poliza = await crearPoliza(companyId, {
    tipo: 'DIARIO', fecha: armado.recibo.fecha,
    concepto: `${etiqueta} de ${armado.recibo.nombre} — periodo ${armado.recibo.periodo_numero}`.slice(0, 200),
    origen: 'NOMINA', origen_uuid: armado.recibo.uuid, regla: 'nomina_pasivo_v1',
    lineas: armado.lineas,
  }, userId);
  return { creada: true, poliza };
}
