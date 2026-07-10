/**
 * Serializer: modelo interno del ERP → JSON CFDI 4.0 (formato SW Sapien).
 *
 * SW Sapien acepta un JSON con las mismas keys que los atributos y nodos del
 * XML del Anexo 20 (Version, Emisor.Rfc, Conceptos[].ClaveProdServ, etc.).
 * Endpoint: POST /v3/cfdi33/issue/json/v4  (Content-Type: application/jsontoxml).
 *
 * SW se encarga de:
 *   1) Convertir este JSON en XML CFDI 4.0
 *   2) Sellar el XML con el .key del emisor (cargado en swpanel.mx)
 *   3) Timbrar ante el SAT
 *   4) Devolver el XML timbrado + UUID + sellos SAT
 *
 * IMPORTANTE: NO enviamos Sello, NoCertificado ni Certificado — SW los inyecta
 * con el CSD que tenemos cargado en su vault para ese RFC emisor.
 *
 * Referencias:
 *   · https://developers.sw.com.mx/knowledge-base/emision-timbrado-json-cfdi/
 *   · Anexo 20 SAT — CFDI 4.0
 */

import { query } from '../../config/database';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler';

interface CFDIJson {
  Version: '4.0';
  Serie: string;
  Folio: string;
  Fecha: string;                 // "YYYY-MM-DDTHH:MM:SS" (local, sin zona)
  FormaPago: string;             // c_FormaPago (01, 03, 99, ...)
  MetodoPago: string;            // PUE | PPD
  CondicionesDePago?: string;
  SubTotal: string;
  Descuento?: string;
  Moneda: string;                // MXN, USD, ...
  TipoCambio?: string;
  Total: string;
  TipoDeComprobante: 'I' | 'E' | 'P' | 'N' | 'T';
  Exportacion: string;           // "01" = no aplica
  LugarExpedicion: string;       // CP del emisor
  Emisor: {
    Rfc: string;
    Nombre: string;
    RegimenFiscal: string;
  };
  Receptor: {
    Rfc: string;
    Nombre: string;
    DomicilioFiscalReceptor: string;
    RegimenFiscalReceptor: string;
    UsoCFDI: string;
  };
  Conceptos: Array<Concepto>;
  Impuestos?: {
    TotalImpuestosTrasladados?: string;
    TotalImpuestosRetenidos?: string;
    Traslados?: Array<TrasladoTotal>;
    Retenciones?: Array<RetencionTotal>;
  };
}

interface Concepto {
  ClaveProdServ: string;
  NoIdentificacion?: string;
  Cantidad: string;
  ClaveUnidad: string;
  Unidad?: string;
  Descripcion: string;
  ValorUnitario: string;
  Importe: string;
  Descuento?: string;
  ObjetoImp: string;             // "01" = no objeto, "02" = sí objeto, "03" = sí no obligado
  Impuestos?: {
    Traslados?: Array<TrasladoConcepto>;
    Retenciones?: Array<RetencionConcepto>;
  };
}
interface TrasladoConcepto {
  Base: string;
  Impuesto: string;              // c_Impuesto: 001=ISR, 002=IVA, 003=IEPS
  TipoFactor: 'Tasa' | 'Cuota' | 'Exento';
  TasaOCuota?: string;
  Importe?: string;
}
interface RetencionConcepto {
  Base: string;
  Impuesto: string;
  TipoFactor: 'Tasa' | 'Cuota';
  TasaOCuota: string;
  Importe: string;
}
interface TrasladoTotal {
  Base: string;
  Impuesto: string;
  TipoFactor: 'Tasa' | 'Cuota' | 'Exento';
  TasaOCuota?: string;
  Importe?: string;
}
interface RetencionTotal {
  Impuesto: string;
  Importe: string;
}

const IMPUESTO_CODE: Record<string, string> = { IVA: '002', IEPS: '003', ISR: '001' };

function money(n: number | string | null | undefined, decimals = 2): string {
  const v = Number(n) || 0;
  return v.toFixed(decimals);
}

function qty(n: number | string | null | undefined): string {
  const v = Number(n) || 0;
  return v.toFixed(6);
}

/**
 * Fecha local sin milisegundos ni zona: "YYYY-MM-DDTHH:MM:SS".
 * SAT NO acepta 'Z' final, ni ±HH:MM offset, ni milisegundos.
 *
 * OJO: SAT valida contra hora de México (America/Mexico_City), NO contra UTC.
 * Nuestros servers (Render) corren en UTC, así que si usáramos getHours()
 * quedaríamos 5–6h adelantados y el PAC rechaza con
 * "La fecha de emisión no se encuentra en el rango permitido".
 * Por eso forzamos la zona horaria explícitamente con toLocaleString.
 */
function fmtFechaSAT(d: Date = new Date()): string {
  // 'sv-SE' (Suecia) usa formato ISO por default: "YYYY-MM-DD HH:MM:SS"
  // Con timeZone convertimos correctamente aunque corramos en UTC.
  const s = d.toLocaleString('sv-SE', {
    timeZone: 'America/Mexico_City',
    hour12: false,
  });
  return s.replace(' ', 'T');
}

/**
 * Construye el JSON CFDI 4.0 listo para enviar a SW Sapien.
 * Lee de la BD: factura + items + emisor + receptor.
 */
export async function buildCFDIJson(companyId: string, invoiceId: string): Promise<CFDIJson> {
  // 1) Factura + items
  const invR = await query<any>(
    `SELECT i.*, c.rfc AS cust_rfc, c.business_name AS cust_name,
            c.postal_code AS cust_cp, c.fiscal_regime AS cust_regime
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
      WHERE i.id = $1 AND i.company_id = $2 AND i.deleted_at IS NULL`,
    [invoiceId, companyId]
  );
  if (invR.rows.length === 0) throw new NotFoundError('Factura no encontrada');
  const inv = invR.rows[0];

  const itemsR = await query<any>(
    `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY line_number`,
    [invoiceId]
  );
  const items = itemsR.rows;
  if (items.length === 0) throw new ValidationError('La factura no tiene conceptos');

  // 2) Empresa emisora
  const compR = await query<any>(
    `SELECT rfc, business_name, fiscal_regime, postal_code FROM companies WHERE id = $1`,
    [companyId]
  );
  if (compR.rows.length === 0) throw new NotFoundError('Empresa no encontrada');
  const comp = compR.rows[0];

  // 3) Validaciones básicas antes de enviar al PAC
  if (!inv.cust_rfc)         throw new ValidationError('El cliente no tiene RFC configurado');
  if (!inv.cust_cp)          throw new ValidationError('El cliente no tiene CP fiscal');
  if (!inv.cust_regime)      throw new ValidationError('El cliente no tiene régimen fiscal');
  if (!comp.postal_code)     throw new ValidationError('La empresa emisora no tiene CP fiscal (Datos del Emisor)');
  if (!comp.fiscal_regime)   throw new ValidationError('La empresa emisora no tiene régimen fiscal');

  // 4) Construir conceptos con sus impuestos
  const conceptos: Concepto[] = [];
  let totalTraslado = 0;
  let totalRetencionIva = 0;
  let totalRetencionIsr = 0;
  let totalIeps = 0;

  const trasladosResumen = new Map<string, { Base: number; Impuesto: string; TipoFactor: string; TasaOCuota: string; Importe: number }>();
  const retencionesResumen = new Map<string, { Impuesto: string; Importe: number }>();

  for (const it of items) {
    const base = Number(it.subtotal) || 0;
    const rateIva = Number(it.tax_rate) || 0;
    const retIva = Number(it.ret_iva_rate) || 0;
    const retIsr = Number(it.ret_isr_rate) || 0;
    const ieps = Number(it.ieps_rate) || 0;
    const isExempt = !!it.is_exempt || rateIva === 0 && it.tax_type === 'IVA'; // decide TipoFactor

    const objetoImp = base > 0 ? '02' : '01';
    const concepto: Concepto = {
      ClaveProdServ: it.clave_sat || '01010101',
      NoIdentificacion: undefined,
      Cantidad: qty(it.quantity),
      ClaveUnidad: it.unit_code || 'H87',
      Descripcion: (it.description || 'Servicio').substring(0, 1000),
      ValorUnitario: money(it.unit_price, 6),
      Importe: money(base, 6),
      Descuento: undefined,
      ObjetoImp: objetoImp,
    };

    if (objetoImp === '02') {
      const traslados: TrasladoConcepto[] = [];
      const retenciones: RetencionConcepto[] = [];

      // Traslado IVA (o exento)
      if (it.tax_type === 'IVA' || !it.tax_type) {
        if (isExempt) {
          traslados.push({
            Base: money(base, 2),
            Impuesto: '002',
            TipoFactor: 'Exento',
          });
        } else {
          const imp = base * rateIva;
          traslados.push({
            Base: money(base, 2),
            Impuesto: '002',
            TipoFactor: 'Tasa',
            TasaOCuota: rateIva.toFixed(6),
            Importe: money(imp, 2),
          });
          totalTraslado += imp;
          const key = `002-Tasa-${rateIva.toFixed(6)}`;
          const cur = trasladosResumen.get(key) || { Base: 0, Impuesto: '002', TipoFactor: 'Tasa', TasaOCuota: rateIva.toFixed(6), Importe: 0 };
          cur.Base += base; cur.Importe += imp;
          trasladosResumen.set(key, cur);
        }
      }

      // IEPS trasladado
      if (ieps > 0) {
        const impIeps = base * ieps;
        traslados.push({
          Base: money(base, 2),
          Impuesto: '003',
          TipoFactor: 'Tasa',
          TasaOCuota: ieps.toFixed(6),
          Importe: money(impIeps, 2),
        });
        totalIeps += impIeps;
        const key = `003-Tasa-${ieps.toFixed(6)}`;
        const cur = trasladosResumen.get(key) || { Base: 0, Impuesto: '003', TipoFactor: 'Tasa', TasaOCuota: ieps.toFixed(6), Importe: 0 };
        cur.Base += base; cur.Importe += impIeps;
        trasladosResumen.set(key, cur);
      }

      // Retención IVA
      if (retIva > 0) {
        const impRetIva = base * retIva;
        retenciones.push({
          Base: money(base, 2),
          Impuesto: '002',
          TipoFactor: 'Tasa',
          TasaOCuota: retIva.toFixed(6),
          Importe: money(impRetIva, 2),
        });
        totalRetencionIva += impRetIva;
        const cur = retencionesResumen.get('002') || { Impuesto: '002', Importe: 0 };
        cur.Importe += impRetIva;
        retencionesResumen.set('002', cur);
      }
      // Retención ISR
      if (retIsr > 0) {
        const impRetIsr = base * retIsr;
        retenciones.push({
          Base: money(base, 2),
          Impuesto: '001',
          TipoFactor: 'Tasa',
          TasaOCuota: retIsr.toFixed(6),
          Importe: money(impRetIsr, 2),
        });
        totalRetencionIsr += impRetIsr;
        const cur = retencionesResumen.get('001') || { Impuesto: '001', Importe: 0 };
        cur.Importe += impRetIsr;
        retencionesResumen.set('001', cur);
      }

      concepto.Impuestos = {
        Traslados: traslados.length ? traslados : undefined,
        Retenciones: retenciones.length ? retenciones : undefined,
      };
    }

    conceptos.push(concepto);
  }

  // 5) Impuestos globales (agregados)
  const impuestosGlobal: CFDIJson['Impuestos'] = {};
  if (trasladosResumen.size > 0) {
    impuestosGlobal.Traslados = Array.from(trasladosResumen.values()).map((t) => ({
      Base: money(t.Base, 2),
      Impuesto: t.Impuesto,
      TipoFactor: t.TipoFactor as any,
      TasaOCuota: t.TasaOCuota,
      Importe: money(t.Importe, 2),
    }));
    impuestosGlobal.TotalImpuestosTrasladados = money(totalTraslado + totalIeps, 2);
  }
  if (retencionesResumen.size > 0) {
    impuestosGlobal.Retenciones = Array.from(retencionesResumen.values()).map((r) => ({
      Impuesto: r.Impuesto,
      Importe: money(r.Importe, 2),
    }));
    impuestosGlobal.TotalImpuestosRetenidos = money(totalRetencionIva + totalRetencionIsr, 2);
  }

  // 6) Ensamblar el CFDI JSON
  const doc: CFDIJson = {
    Version: '4.0',
    Serie: inv.serie || 'A',
    Folio: String(inv.folio || '1'),
    Fecha: fmtFechaSAT(new Date()),   // La CFDI debe ir con fecha actual al timbrar
    FormaPago: inv.payment_form || '99',
    MetodoPago: inv.payment_method || 'PPD',
    SubTotal: money(inv.subtotal, 2),
    Moneda: inv.currency || 'MXN',
    Total: money(inv.total, 2),
    TipoDeComprobante: (inv.cfdi_type || 'I') as 'I',
    Exportacion: '01',
    LugarExpedicion: comp.postal_code,
    Emisor: {
      Rfc: comp.rfc,
      Nombre: comp.business_name.toUpperCase(),
      RegimenFiscal: comp.fiscal_regime,
    },
    Receptor: {
      Rfc: inv.cust_rfc,
      Nombre: (inv.cust_name || '').toUpperCase(),
      DomicilioFiscalReceptor: inv.cust_cp,
      RegimenFiscalReceptor: inv.cust_regime,
      UsoCFDI: inv.cfdi_use || 'G03',
    },
    Conceptos: conceptos,
  };

  if (impuestosGlobal.Traslados || impuestosGlobal.Retenciones) {
    doc.Impuestos = impuestosGlobal;
  }

  const disc = Number(inv.discount) || 0;
  if (disc > 0) doc.Descuento = money(disc, 2);

  return doc;
}
