/**
 * Autofacturación (Anexo 20 / RMF Sección 2.7.3) — el ADQUIRENTE emite el CFDI
 * por cuenta del ENAJENANTE (vendedor que no factura).
 *
 * En el CFDI el EMISOR es el enajenante (sector primario, régimen 622 AGAPES,
 * etc.) y el RECEPTOR es nuestra empresa (adquirente) — al revés de una factura
 * normal. Si el enajenante no tiene RFC se usa el genérico nacional y se registra
 * su nombre + CURP (RMF 2.7.3).
 *
 * QUÉ HACE HOY: registra enajenantes, captura la erogación, calcula impuestos y
 * ARMA el JSON CFDI 4.0 (previsualización, estado BORRADOR).
 *
 * QUÉ NO HACE (gated a propósito): TIMBRAR. El timbrado por cuenta del adquirente
 * NO es la emisión normal: necesita el «rol de facturación a través del
 * adquirente» ante el SAT y un PAC con servicio de adquirentes (el sellado no usa
 * el CSD del emisor, que aquí no existe). `timbrarComprobante` lo explica y no
 * emite nada hasta activarlo.
 */
import { query } from '../../config/database';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler';
import { fmtFechaSAT } from '../cfdi/build-cfdi-json.service';
import * as pac from '../pac/pac.service';

/** RFC genérico nacional para enajenantes sin RFC (RMF 2.7.3 / c_RFC). */
export const RFC_GENERICO = 'XAXX010101000';

/** Sectores de la RMF 2.7.3 que pueden comprobarse por el adquirente. */
export const SECTORES = [
  'primario', 'arrendamiento', 'minero', 'artesano',
  'vehiculos', 'desperdicios', 'arte', 'antiguedades',
] as const;
export type Sector = typeof SECTORES[number];

const money = (n: any, d = 2): string => (Number(n) || 0).toFixed(d);
const qty = (n: any): string => (Number(n) || 0).toFixed(6);
const round2 = (n: any): number => Math.round((Number(n) || 0) * 100) / 100;

/* ─────────────────────────── ENAJENANTES ─────────────────────────── */

export async function listarEnajenantes(companyId: string) {
  const r = await query<any>(
    `SELECT id, nombre, curp, rfc, regimen_fiscal, cp_fiscal, sector, clabe, activo
       FROM autofactura_enajenantes
      WHERE company_id = $1
      ORDER BY activo DESC, nombre`,
    [companyId]);
  return r.rows;
}

interface EnajenanteInput {
  nombre: string; curp?: string | null; rfc?: string | null;
  regimenFiscal?: string; cpFiscal?: string | null; sector?: string; clabe?: string | null;
}

function normalizarEnajenante(d: EnajenanteInput) {
  const nombre = (d.nombre || '').trim();
  if (!nombre) throw new ValidationError('El nombre del enajenante es obligatorio.');
  const rfc = (d.rfc || '').trim().toUpperCase() || null;
  const curp = (d.curp || '').trim().toUpperCase() || null;
  // Sin RFC, la CURP identifica a la persona física (RMF 2.7.3).
  if (!rfc && !curp) throw new ValidationError('Sin RFC, la CURP es obligatoria para identificar al enajenante.');
  if (rfc && rfc !== RFC_GENERICO && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) {
    throw new ValidationError(`RFC con formato inválido: ${rfc}`);
  }
  if (curp && !/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(curp)) {
    throw new ValidationError(`CURP con formato inválido: ${curp}`);
  }
  const sector = (d.sector || 'primario').trim();
  if (!SECTORES.includes(sector as Sector)) throw new ValidationError(`Sector no válido: ${sector}`);
  return {
    nombre, rfc, curp, sector,
    regimenFiscal: (d.regimenFiscal || '622').trim(),
    cpFiscal: (d.cpFiscal || '').trim() || null,
    clabe: (d.clabe || '').trim() || null,
  };
}

export async function crearEnajenante(companyId: string, d: EnajenanteInput) {
  const n = normalizarEnajenante(d);
  const r = await query<any>(
    `INSERT INTO autofactura_enajenantes
       (company_id, nombre, curp, rfc, regimen_fiscal, cp_fiscal, sector, clabe)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [companyId, n.nombre, n.curp, n.rfc, n.regimenFiscal, n.cpFiscal, n.sector, n.clabe]);
  return { id: r.rows[0].id };
}

export async function actualizarEnajenante(companyId: string, id: string, d: EnajenanteInput) {
  const n = normalizarEnajenante(d);
  const r = await query<any>(
    `UPDATE autofactura_enajenantes
        SET nombre=$3, curp=$4, rfc=$5, regimen_fiscal=$6, cp_fiscal=$7, sector=$8, clabe=$9, updated_at=NOW()
      WHERE id=$1 AND company_id=$2 RETURNING id`,
    [id, companyId, n.nombre, n.curp, n.rfc, n.regimenFiscal, n.cpFiscal, n.sector, n.clabe]);
  if (!r.rows.length) throw new NotFoundError('Enajenante no encontrado');
  return { id };
}

export async function borrarEnajenante(companyId: string, id: string) {
  // No se borra si ya tiene comprobantes: se desactiva (conserva el histórico).
  const usos = await query<any>(
    `SELECT 1 FROM autofactura_comprobantes WHERE enajenante_id=$1 AND company_id=$2 LIMIT 1`,
    [id, companyId]);
  if (usos.rows.length) {
    await query(`UPDATE autofactura_enajenantes SET activo=false, updated_at=NOW() WHERE id=$1 AND company_id=$2`, [id, companyId]);
    return { desactivado: true };
  }
  const r = await query<any>(`DELETE FROM autofactura_enajenantes WHERE id=$1 AND company_id=$2 RETURNING id`, [id, companyId]);
  if (!r.rows.length) throw new NotFoundError('Enajenante no encontrado');
  return { borrado: true };
}

/* ─────────────────────────── COMPROBANTES ─────────────────────────── */

interface ConceptoInput {
  claveProdServ: string; noIdentificacion?: string; cantidad: number;
  claveUnidad: string; descripcion: string; valorUnitario: number;
  /** IVA: número (0.16), 0, o -1 = exento. */
  ivaTasa?: number; retIvaTasa?: number; retIsrTasa?: number;
}
interface ComprobanteInput {
  enajenanteId: string; fecha: string; serie?: string; folio?: string;
  formaPago?: string; metodoPago?: string; usoCfdi?: string;
  conceptos: ConceptoInput[];
}

/** Calcula importes por concepto y arma los renglones + resumen de impuestos. */
function calcular(conceptos: ConceptoInput[]) {
  let subtotal = 0, iva = 0, retIva = 0, retIsr = 0;
  const trasladosResumen = new Map<string, { Base: number; Impuesto: string; TipoFactor: string; TasaOCuota?: string; Importe: number }>();
  const retencionesResumen = new Map<string, { Impuesto: string; Importe: number }>();

  const filas = conceptos.map((c) => {
    const importe = round2((Number(c.cantidad) || 0) * (Number(c.valorUnitario) || 0));
    subtotal += importe;
    const exento = c.ivaTasa === -1;
    const tasaIva = exento ? 0 : (Number(c.ivaTasa) || 0);
    const tasaRetIva = Number(c.retIvaTasa) || 0;
    const tasaRetIsr = Number(c.retIsrTasa) || 0;
    const objetoImp = (exento || tasaIva > 0 || tasaRetIva > 0 || tasaRetIsr > 0) ? '02' : '01';

    const traslados: any[] = [];
    const retenciones: any[] = [];
    if (objetoImp === '02') {
      if (exento) {
        traslados.push({ Base: money(importe), Impuesto: '002', TipoFactor: 'Exento' });
        const k = '002-Exento';
        const cur = trasladosResumen.get(k) || { Base: 0, Impuesto: '002', TipoFactor: 'Exento', Importe: 0 };
        cur.Base += importe; trasladosResumen.set(k, cur);
      } else if (tasaIva > 0) {
        const imp = round2(importe * tasaIva); iva += imp;
        traslados.push({ Base: money(importe), Impuesto: '002', TipoFactor: 'Tasa', TasaOCuota: tasaIva.toFixed(6), Importe: money(imp) });
        const k = `002-Tasa-${tasaIva.toFixed(6)}`;
        const cur = trasladosResumen.get(k) || { Base: 0, Impuesto: '002', TipoFactor: 'Tasa', TasaOCuota: tasaIva.toFixed(6), Importe: 0 };
        cur.Base += importe; cur.Importe += imp; trasladosResumen.set(k, cur);
      }
      if (tasaRetIva > 0) {
        const imp = round2(importe * tasaRetIva); retIva += imp;
        retenciones.push({ Base: money(importe), Impuesto: '002', TipoFactor: 'Tasa', TasaOCuota: tasaRetIva.toFixed(6), Importe: money(imp) });
        const cur = retencionesResumen.get('002') || { Impuesto: '002', Importe: 0 }; cur.Importe += imp; retencionesResumen.set('002', cur);
      }
      if (tasaRetIsr > 0) {
        const imp = round2(importe * tasaRetIsr); retIsr += imp;
        retenciones.push({ Base: money(importe), Impuesto: '001', TipoFactor: 'Tasa', TasaOCuota: tasaRetIsr.toFixed(6), Importe: money(imp) });
        const cur = retencionesResumen.get('001') || { Impuesto: '001', Importe: 0 }; cur.Importe += imp; retencionesResumen.set('001', cur);
      }
    }

    const concepto: any = {
      ClaveProdServ: c.claveProdServ || '01010101',
      Cantidad: qty(c.cantidad),
      ClaveUnidad: c.claveUnidad || 'H87',
      Descripcion: (c.descripcion || 'Producto').substring(0, 1000),
      ValorUnitario: money(c.valorUnitario, 6),
      Importe: money(importe, 2),
      ObjetoImp: objetoImp,
    };
    if (c.noIdentificacion) concepto.NoIdentificacion = c.noIdentificacion;
    if (traslados.length || retenciones.length) {
      concepto.Impuestos = {
        ...(traslados.length ? { Traslados: traslados } : {}),
        ...(retenciones.length ? { Retenciones: retenciones } : {}),
      };
    }
    return concepto;
  });

  const impuestos: any = {};
  if (trasladosResumen.size) {
    impuestos.Traslados = Array.from(trasladosResumen.values()).map((t) => ({
      Base: money(t.Base), Impuesto: t.Impuesto, TipoFactor: t.TipoFactor,
      ...(t.TasaOCuota ? { TasaOCuota: t.TasaOCuota, Importe: money(t.Importe) } : {}),
    }));
    impuestos.TotalImpuestosTrasladados = money(iva);
  }
  if (retencionesResumen.size) {
    impuestos.Retenciones = Array.from(retencionesResumen.values()).map((r) => ({ Impuesto: r.Impuesto, Importe: money(r.Importe) }));
    impuestos.TotalImpuestosRetenidos = money(retIva + retIsr);
  }

  const total = round2(subtotal + iva - retIva - retIsr);
  return { filas, impuestos, subtotal: round2(subtotal), iva: round2(iva), retIva: round2(retIva), retIsr: round2(retIsr), total };
}

/** Empresa adquirente (el RECEPTOR del CFDI). */
async function empresaAdquirente(companyId: string) {
  const r = await query<any>(`SELECT rfc, business_name, fiscal_regime, postal_code FROM companies WHERE id=$1`, [companyId]);
  if (!r.rows.length) throw new NotFoundError('Empresa no encontrada');
  const c = r.rows[0];
  if (!c.postal_code) throw new ValidationError('La empresa adquirente no tiene CP fiscal.');
  if (!c.fiscal_regime) throw new ValidationError('La empresa adquirente no tiene régimen fiscal.');
  return c;
}

/** Arma el JSON CFDI 4.0 con EMISOR = enajenante y RECEPTOR = adquirente. */
function construirJson(enaj: any, comp: any, calc: ReturnType<typeof calcular>, meta: ComprobanteInput) {
  const doc: any = {
    Version: '4.0',
    Serie: meta.serie || undefined,
    Folio: meta.folio || undefined,
    Fecha: fmtFechaSAT(new Date()),
    FormaPago: meta.formaPago || '03',
    MetodoPago: meta.metodoPago || 'PUE',
    SubTotal: money(calc.subtotal),
    Moneda: 'MXN',
    Total: money(calc.total),
    TipoDeComprobante: 'I',
    Exportacion: '01',
    LugarExpedicion: enaj.cp_fiscal || comp.postal_code,  // CP del emisor (enajenante)
    // EMISOR = ENAJENANTE (sin RFC → genérico nacional).
    Emisor: {
      Rfc: enaj.rfc || RFC_GENERICO,
      Nombre: (enaj.nombre || '').toUpperCase(),
      RegimenFiscal: enaj.regimen_fiscal || '622',
    },
    // RECEPTOR = ADQUIRENTE (nuestra empresa).
    Receptor: {
      Rfc: comp.rfc,
      Nombre: (comp.business_name || '').toUpperCase(),
      DomicilioFiscalReceptor: comp.postal_code,
      RegimenFiscalReceptor: comp.fiscal_regime,
      UsoCFDI: meta.usoCfdi || 'G03',
    },
    Conceptos: calc.filas,
  };
  if (calc.impuestos.Traslados || calc.impuestos.Retenciones) doc.Impuestos = calc.impuestos;
  return doc;
}

export async function crearComprobante(companyId: string, d: ComprobanteInput) {
  if (!d.enajenanteId) throw new ValidationError('Falta el enajenante.');
  if (!d.fecha) throw new ValidationError('Falta la fecha.');
  if (!Array.isArray(d.conceptos) || d.conceptos.length === 0) throw new ValidationError('Captura al menos un concepto.');

  const eR = await query<any>(`SELECT * FROM autofactura_enajenantes WHERE id=$1 AND company_id=$2`, [d.enajenanteId, companyId]);
  if (!eR.rows.length) throw new NotFoundError('Enajenante no encontrado');
  const enaj = eR.rows[0];
  const comp = await empresaAdquirente(companyId);

  const calc = calcular(d.conceptos);
  const json = construirJson(enaj, comp, calc, d);

  const r = await query<any>(
    `INSERT INTO autofactura_comprobantes
       (company_id, enajenante_id, fecha, serie, folio, conceptos, subtotal, iva, ret_iva, ret_isr,
        total, forma_pago, metodo_pago, uso_cfdi, estado, json_cfdi)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,'BORRADOR',$15::jsonb)
     RETURNING id`,
    [companyId, d.enajenanteId, d.fecha, d.serie || null, d.folio || null,
     JSON.stringify(d.conceptos), calc.subtotal, calc.iva, calc.retIva, calc.retIsr,
     calc.total, d.formaPago || '03', d.metodoPago || 'PUE', d.usoCfdi || 'G03', JSON.stringify(json)]);
  return { id: r.rows[0].id, total: calc.total, json };
}

export async function listarComprobantes(companyId: string, anio?: number, mes?: number) {
  const cond: string[] = ['c.company_id = $1'];
  const params: any[] = [companyId];
  if (anio) { params.push(anio); cond.push(`EXTRACT(YEAR FROM c.fecha) = $${params.length}`); }
  if (mes) { params.push(mes); cond.push(`EXTRACT(MONTH FROM c.fecha) = $${params.length}`); }
  const r = await query<any>(
    `SELECT c.id, c.fecha, c.serie, c.folio, c.subtotal, c.iva, c.ret_iva, c.ret_isr, c.total,
            c.estado, c.uuid, c.metodo_pago, c.forma_pago,
            e.nombre AS enajenante, e.rfc AS enajenante_rfc, e.sector
       FROM autofactura_comprobantes c
       JOIN autofactura_enajenantes e ON e.id = c.enajenante_id
      WHERE ${cond.join(' AND ')}
      ORDER BY c.fecha DESC, c.created_at DESC`,
    params);
  return r.rows;
}

export async function obtenerComprobante(companyId: string, id: string) {
  const r = await query<any>(
    `SELECT c.*, e.nombre AS enajenante, e.rfc AS enajenante_rfc, e.curp, e.sector, e.regimen_fiscal
       FROM autofactura_comprobantes c
       JOIN autofactura_enajenantes e ON e.id = c.enajenante_id
      WHERE c.id=$1 AND c.company_id=$2`,
    [id, companyId]);
  if (!r.rows.length) throw new NotFoundError('Comprobante no encontrado');
  return r.rows[0];
}

export async function borrarComprobante(companyId: string, id: string) {
  const c = await query<any>(`SELECT estado FROM autofactura_comprobantes WHERE id=$1 AND company_id=$2`, [id, companyId]);
  if (!c.rows.length) throw new NotFoundError('Comprobante no encontrado');
  if (c.rows[0].estado === 'TIMBRADO') throw new ValidationError('Un comprobante timbrado no se borra: se cancela ante el SAT.');
  await query(`DELETE FROM autofactura_comprobantes WHERE id=$1 AND company_id=$2`, [id, companyId]);
  return { borrado: true };
}

/** Configuración de autofacturación de la empresa (el rol ante el SAT + ambiente). */
export async function obtenerConfig(companyId: string) {
  const r = await query<any>(
    `SELECT autofactura_rol_sat, timbrado_ambiente FROM companies WHERE id=$1`, [companyId]);
  const c = r.rows[0] || {};
  return {
    rol: c.autofactura_rol_sat || '',
    ambiente: c.timbrado_ambiente || 'PRUEBAS',
    habilitado: !!c.autofactura_rol_sat,   // con rol capturado ya se puede intentar timbrar
  };
}

/** Captura/actualiza el «rol de facturación por cuenta del adquirente» ante el SAT. */
export async function guardarRol(companyId: string, rol: string) {
  await query(
    `UPDATE companies SET autofactura_rol_sat=$2, updated_at=NOW() WHERE id=$1`,
    [companyId, (rol || '').trim() || null]);
  return obtenerConfig(companyId);
}

/** Valida que el CFDI armado esté COMPLETO antes de mandarlo al PAC: si algo falta,
 *  no se emite (evita mandar un comprobante mal armado al SAT). */
function validarParaTimbrar(json: any): string[] {
  const faltan: string[] = [];
  if (!json?.Emisor?.Rfc) faltan.push('RFC del enajenante (emisor)');
  if (!json?.Receptor?.Rfc) faltan.push('RFC del adquirente (receptor)');
  if (!json?.LugarExpedicion) faltan.push('lugar de expedición (CP)');
  if (!Array.isArray(json?.Conceptos) || json.Conceptos.length === 0) faltan.push('conceptos');
  if (!(Number(json?.Total) > 0)) faltan.push('total mayor a cero');
  return faltan;
}

/**
 * TIMBRAR autofacturación. Dos candados ANTES de mandar nada al PAC:
 *   1. La empresa debe tener capturado el ROL de adquirente ante el SAT (RMF 2.7.3).
 *   2. El comprobante debe estar correcto (si no, no se emite).
 * Si ambos pasan, se manda al PAC con el ambiente/credenciales de la empresa. En
 * PRUEBAS el SW sólo acepta su RFC de prueba, así que no sale un CFDI real por
 * accidente: para timbrar en vivo la empresa debe estar en PRODUCCIÓN (Súper Admin)
 * y el PAC con el servicio de adquirentes configurado.
 */
export async function timbrarComprobante(companyId: string, id: string) {
  const comp = await obtenerComprobante(companyId, id);
  if (comp.estado === 'TIMBRADO') throw new ValidationError('Este comprobante ya está timbrado.');

  // Candado 1: rol ante el SAT.
  const { rol } = await obtenerConfig(companyId);
  if (!rol) {
    throw new ValidationError(
      'No se timbra: falta capturar el «rol de facturación por cuenta del adquirente» ante el SAT ' +
      '(Autofacturación → Configuración). Sin ese rol el SAT no autoriza la emisión.');
  }

  // Candado 2: el código de autofacturación debe estar correcto.
  const json = comp.json_cfdi || {};
  const faltan = validarParaTimbrar(json);
  if (faltan.length) {
    throw new ValidationError(`No se timbra: el comprobante de autofacturación no está correcto — falta ${faltan.join(', ')}.`);
  }

  const r = await pac.stampJsonPayload(companyId, json);
  if (!r.success) throw new ValidationError(`Timbrado fallido: ${(r.errors || []).join('; ')}`);

  await query(
    `UPDATE autofactura_comprobantes
        SET estado='TIMBRADO', uuid=$3, xml=$4, fecha_timbrado=NOW()
      WHERE id=$1 AND company_id=$2`,
    [id, companyId, r.uuid || null, r.xml_stamped || null]);
  return { timbrado: true, uuid: r.uuid };
}
