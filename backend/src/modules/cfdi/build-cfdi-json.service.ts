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
import { decimalesDeMoneda, redondea, conDecimales, dentroDeTolerancia } from './decimales';

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
  /**
   * Factura GLOBAL al público en general (RFC genérico XAXX010101000).
   *
   * El SAT obliga este nodo (CFDI 4.0) cuando TipoDeComprobante='I', el Rfc del
   * receptor es el genérico nacional y su Nombre es "PÚBLICO EN GENERAL". Ampara
   * el PERIODO al que corresponden las ventas sin requerimiento de factura:
   *   · Periodicidad (c_Periodicidad): 01 Diario · 02 Semanal · 03 Quincenal ·
   *     04 Mensual · 05 Bimestral.
   *   · Meses (c_Meses): 01-12 por mes; 13-18 por bimestre (13=Ene-Feb … 18=Nov-Dic).
   *   · Año: 4 dígitos, NO mayor al año en curso.
   * Sin este nodo el PAC rechaza con "Este Nodo debe existir siempre que el
   * atributo TipoDeComprobante sea 'I' … 'XAXX010101000' … 'PUBLICO EN GENERAL'".
   */
  InformacionGlobal?: {
    Periodicidad: string;
    Meses: string;
    'Año': string;
  };
  /**
   * Relación con otros CFDI. Obligatoria en una nota de crédito (tipo E):
   * TipoRelacion '01' = nota de crédito de los documentos relacionados.
   *
   * Es un ARREGLO porque el nodo es repetible en el Anexo 20: un comprobante
   * puede relacionar documentos con TipoRelacion distinto, y cada uno necesita
   * su propio bloque. Declararlo como objeto —como estaba— hace que el
   * deserializador de SW falle antes de mirar el contenido.
   */
  CfdiRelacionados?: Array<{
    TipoRelacion: string;
    CfdiRelacionado: Array<{ UUID: string }>;
  }>;
  /**
   * Complemento de Pagos 2.0 — solo en comprobantes tipo P.
   *
   * Se declara aquí porque los pagos y las notas de crédito deben emitirse por
   * la MISMA ruta que las facturas (/v3/cfdi33/issue/json/v4), donde SW sella
   * con el CSD de su bóveda. Antes se armaba un XML sin sellar y se mandaba a
   * /cfdi33/stamp/v4, que exige un XML YA sellado: de ahí el rechazo
   * "Xml CFDI no proporcionado o viene vacío".
   */
  Complemento?: {
    Pagos?: {
      Version: '2.0';
      Totales: {
        MontoTotalPagos: string;
        TotalTrasladosBaseIVA16?: string;
        TotalTrasladosImpuestoIVA16?: string;
      };
      Pago: Array<{
        FechaPago: string;
        FormaDePagoP: string;
        MonedaP: string;
        TipoCambioP?: string;
        Monto: string;
        DoctoRelacionado: Array<{
          IdDocumento: string;
          MonedaDR: string;
          EquivalenciaDR?: string;
          NumParcialidad: string;
          ImpSaldoAnt: string;
          ImpPagado: string;
          ImpSaldoInsoluto: string;
          ObjetoImpDR: string;
        }>;
      }>;
    };
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

/** RFC genérico nacional: receptor de las facturas globales (público en general). */
const RFC_GENERICO_NACIONAL = 'XAXX010101000';

/* money y qty delegan en modules/cfdi/decimales para que el XML redondee
 * EXACTAMENTE igual que el servicio que guardo la factura. Si cada uno
 * redondeara por su cuenta, el importe guardado y el declarado se separarian
 * por un centavo en los casos de borde y el PAC rechazaria. */
function money(n: number | string | null | undefined, decimals = 2): string {
  return conDecimales(n, decimals);
}

function qty(n: number | string | null | undefined): string {
  return conDecimales(n, 6);
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
export function fmtFechaSAT(d: Date = new Date()): string {
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

  /* Decimales que soporta la MONEDA de esta factura (2 en pesos). El precio
   * unitario puede llevar hasta 6 —el Anexo 20 lo permite y es lo que deja
   * cerrar el total en una cifra redonda—, pero los IMPORTES van con los de la
   * moneda: a 6 decimales la tolerancia del SAT se encoge a una millonesima y
   * cualquier arrastre del redondeo tumba el timbre. */
  const dec = decimalesDeMoneda(inv.currency);

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

    /* GUARDIA: el SAT exige Importe = Cantidad x ValorUnitario, con una
     * tolerancia de una unidad en la ultima posicion decimal declarada (un
     * centavo en pesos). Si no cuadra, el PAC rechaza con un mensaje que no
     * dice cual linea ni por que. Lo revisamos AQUI para decirlo claro.
     *
     * El caso real que esto atrapa: hasta el 25/11/2026 invoice_items.unit_price
     * era DECIMAL(15,2) y Postgres redondeaba el precio al guardar (32.219827
     * quedaba 32.22), asi que 400 x 32.22 = 12,888.00 contra un importe
     * guardado de 12,887.93. Esos decimales NO se pueden recuperar: hay que
     * volver a capturar el precio. */
    const calculado = redondea(Number(it.quantity) * Number(it.unit_price), dec);
    if (!dentroDeTolerancia(calculado, redondea(base, dec), dec)) {
      throw new ValidationError(
        `El concepto «${(it.description || '').substring(0, 40) || 'sin descripcion'}» no cuadra: ` +
        `${conDecimales(it.quantity, 3)} x ${conDecimales(it.unit_price, 6)} da ${conDecimales(calculado, dec)}, ` +
        `pero el importe guardado es ${conDecimales(base, dec)}. ` +
        `Si esta factura se capturo antes del 25/11/2026, el precio unitario perdio sus decimales al guardarse: ` +
        `abrela, vuelve a teclear el precio completo y guarda otra vez.`
      );
    }
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
      // Precio hasta 6 decimales; importe con los de la moneda (ver decimales.ts).
      ValorUnitario: money(it.unit_price, 6),
      Importe: money(base, dec),
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

  /* GUARDIA DE TOTALES — el XML tiene que cuadrar CONTRA SI MISMO.
   *
   * El SAT revisa dos sumas: SubTotal = suma de los importes de los conceptos,
   * y Total = SubTotal - Descuento + trasladados - retenidos. Si no cuadran,
   * el PAC rechaza sin decir cual de las dos fallo. Se revisan sobre los
   * MISMOS textos que se van a enviar (no sobre los numeros de la base), que
   * es justo lo que el SAT va a leer. */
  const sumaConceptos = conceptos.reduce((a, c) => a + Number(c.Importe), 0);
  if (!dentroDeTolerancia(sumaConceptos, Number(doc.SubTotal), dec)) {
    throw new ValidationError(
      `El subtotal de la factura (${doc.SubTotal}) no coincide con la suma de sus conceptos ` +
      `(${conDecimales(sumaConceptos, dec)}). Vuelve a abrir la factura y guardala para recalcularla.`
    );
  }

  const trasladado = Number(doc.Impuestos?.TotalImpuestosTrasladados || 0);
  const retenido   = Number(doc.Impuestos?.TotalImpuestosRetenidos || 0);
  const totalCalc  = redondea(Number(doc.SubTotal) - disc + trasladado - retenido, dec);
  if (!dentroDeTolerancia(totalCalc, Number(doc.Total), dec)) {
    throw new ValidationError(
      `El total de la factura (${doc.Total}) no cuadra: subtotal ${doc.SubTotal} ` +
      `${disc > 0 ? `- descuento ${conDecimales(disc, dec)} ` : ''}` +
      `+ impuestos ${conDecimales(trasladado, dec)} - retenciones ${conDecimales(retenido, dec)} ` +
      `da ${conDecimales(totalCalc, dec)}. Vuelve a abrir la factura y guardala para recalcularla.`
    );
  }

  // 7) Factura global al público en general (RFC genérico nacional).
  //    El SAT valida cuatro reglas EN CONJUNTO para el receptor genérico; se
  //    rompen fácil por separado, así que las forzamos aquí en vez de confiar
  //    en lo que traiga el expediente del cliente:
  //      · RegimenFiscalReceptor = 616 (único que admite el genérico)
  //      · DomicilioFiscalReceptor = CP del emisor (= LugarExpedicion; al
  //        público no se le conoce domicilio)
  //      · UsoCFDI = S01 "Sin efectos fiscales" (sólo para el ingreso tipo I)
  //      · InformacionGlobal obligatorio (sólo tipo I)
  if (doc.Receptor.Rfc === RFC_GENERICO_NACIONAL) {
    doc.Receptor.RegimenFiscalReceptor = '616';
    doc.Receptor.DomicilioFiscalReceptor = comp.postal_code;

    if (doc.TipoDeComprobante === 'I') {
      doc.Receptor.UsoCFDI = 'S01';

      // Periodo que ampara la global. Se toma de la factura si viene capturado;
      // si no, se deriva de la fecha de emisión como MENSUAL (lo más común),
      // con el mes y año de la propia factura. El año nunca puede ser mayor al
      // año en curso, de ahí el tope contra "ahora".
      const base = inv.date_issued ? new Date(inv.date_issued) : new Date();
      const valida = !Number.isNaN(base.getTime());
      const ahora = new Date();
      const mesBase = String((valida ? base.getMonth() : ahora.getMonth()) + 1).padStart(2, '0');
      let anioBase = valida ? base.getFullYear() : ahora.getFullYear();
      if (anioBase > ahora.getFullYear()) anioBase = ahora.getFullYear();

      doc.InformacionGlobal = {
        Periodicidad: inv.global_periodicidad || '04',  // 04 = Mensual
        Meses: inv.global_meses || mesBase,
        'Año': String(inv.global_anio || anioBase),
      };
    }
  }

  return doc;
}
