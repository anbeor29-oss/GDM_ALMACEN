/**
 * Pólizas — genera y consulta los asientos (PLAN_CONTABILIDAD §2).
 *
 * PASO 1: la regla de VENTAS. De cada factura emitida (con su cuenta de ingreso
 * ya asignada) arma la póliza de tres renglones del Anexo 24:
 *
 *     105.01 Clientes            cargo  total
 *         4xx Ventas (asignada)      abono  total − IVA
 *         208/209 IVA trasladado     abono  IVA         (208 si PUE, 209 si PPD)
 *
 * El 208 vs 209 es la distinción de flujo del IVA mexicano: se causa al cobrar,
 * no al facturar. Lo decide `metodo_pago`. Los importes salen del XML.
 *
 * Lo que aún NO hace (siguiente paso): compras/recibidos —les falta el desglose
 * de IVA, que el metadato no trae—, cobros (complemento → traslado 209→208),
 * notas de crédito, nómina y depreciación. Lo que no puede cuadrar, se OMITE con
 * su motivo, no se inventa.
 */
import { query, transaction } from '../../config/database';
import { resolverOCrearSubcuentaTercero } from './catalogo-terceros.service';
import { conceptosDeXml, complementoDeXml, mapaProductoCuenta } from './ventas-cuentas.service';
import { mapaProductoCuentaCompra } from './compras-cuentas.service';

export interface LineaPoliza {
  account_id: string; cargo?: number; abono?: number; concepto?: string;
  uuid_cfdi?: string | null; party_rfc?: string | null;
}
export interface NuevaPoliza {
  tipo?: 'INGRESO' | 'EGRESO' | 'DIARIO';
  fecha: string; concepto?: string;
  origen?: string; origen_uuid?: string | null; regla?: string | null;
  lineas: LineaPoliza[];
}

const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const finDeMes = (anio: number, mes: number) => new Date(anio, mes, 0).toISOString().slice(0, 10);
const iniDeMes = (anio: number, mes: number) => `${anio}-${String(mes).padStart(2, '0')}-01`;

/** Totales de impuestos a nivel comprobante, leídos del XML sin parser completo. */
function impuestosDeXml(xml: string): { trasladados: number; retenidos: number } {
  const g = (re: RegExp) => { const m = re.exec(xml); return m ? Number(m[1]) : 0; };
  return {
    trasladados: g(/TotalImpuestosTrasladados="([\d.]+)"/),
    retenidos: g(/TotalImpuestosRetenidos="([\d.]+)"/),
  };
}

/**
 * Las retenciones del comprobante partidas por impuesto: ISR (001) e IVA (002).
 * Se lee SÓLO el nodo de Impuestos a nivel comprobante —el que trae
 * `TotalImpuestosRetenidos`— para no sumar las retenciones por concepto (que
 * duplicarían). Van a cuentas distintas: el ISR y el IVA no se mezclan.
 */
function retencionesDeXml(xml: string): { isr: number; iva: number } {
  const bloque = /<(?:\w+:)?Impuestos\b[^>]*TotalImpuestosRetenidos[^>]*>([\s\S]*?)<\/(?:\w+:)?Impuestos>/.exec(xml);
  if (!bloque) return { isr: 0, iva: 0 };
  let isr = 0, iva = 0;
  for (const r of bloque[1].match(/<(?:\w+:)?Retencion\b[^>]*>/g) || []) {
    const imp = /\bImpuesto\s*=\s*"([^"]*)"/.exec(r)?.[1] || '';
    const val = Number(/\bImporte\s*=\s*"([\d.]+)"/.exec(r)?.[1]) || 0;
    if (imp === '001') isr += val;
    else if (imp === '002') iva += val;
  }
  return { isr: round2(isr), iva: round2(iva) };
}

/** La primera cuenta de movimientos que exista para cualquiera de los agrupadores
 *  dados, en orden. Sirve para las cuentas de retención, cuyo agrupador Anexo 24
 *  (216.xx / 113.xx) puede estar armado distinto en cada catálogo. */
async function cuentaPorAgrupadores(companyId: string, agrupadores: string[]) {
  for (const a of agrupadores) {
    const c = await cuentaPorAgrupador(companyId, a);
    if (c) return c;
  }
  return null;
}

/* Agrupadores Anexo 24 de las cuentas de retención (se toma la primera que exista
 * como cuenta de movimientos en el catálogo de la empresa):
 *   VENTA  — el cliente nos retiene → es un impuesto A FAVOR (activo, cargo).
 *   COMPRA — nosotros retenemos al proveedor → es un pasivo POR ENTERAR (abono). */
const AGR_RET = {
  ventaISR:  ['113.02'],                             // ISR a favor
  ventaIVA:  ['113.01'],                             // IVA a favor
  compraISR: ['216.05', '216.04', '216.03', '216.01', '216'], // ISR retenido por enterar
  compraIVA: ['216.10', '216'],                      // IVA retenido por enterar
};

async function cuentaPorAgrupador(companyId: string, agrupador: string) {
  const r = await query<any>(
    `SELECT id, codigo, nombre FROM accounting_accounts
      WHERE company_id=$1 AND activa=true AND permite_movimientos=true AND codigo_agrupador=$2
      ORDER BY codigo LIMIT 1`, [companyId, agrupador]);
  return r.rows[0] || null;
}
async function cuentaPorCodigo(companyId: string, codigo: string) {
  const r = await query<any>(
    `SELECT id, codigo, nombre, permite_movimientos FROM accounting_accounts
      WHERE company_id=$1 AND codigo=$2 LIMIT 1`, [companyId, codigo]);
  return r.rows[0] || null;
}

/** Crea una póliza (encabezado + partidas). El cuadre lo valida la base al COMMIT. */
export async function crearPoliza(companyId: string, p: NuevaPoliza, userId?: string) {
  return transaction(async (client) => {
    const f = await client.query(
      `SELECT COALESCE(MAX(folio),0)+1 AS n FROM journal_entries
        WHERE company_id=$1 AND EXTRACT(YEAR FROM fecha)=EXTRACT(YEAR FROM $2::date)`,
      [companyId, p.fecha]);
    const folio = Number(f.rows[0].n);
    const e = await client.query(
      `INSERT INTO journal_entries
         (company_id, tipo, folio, fecha, concepto, estado, origen, origen_uuid, regla, created_by)
       VALUES ($1,$2,$3,$4,$5,'ASENTADA',$6,$7,$8,$9)
       RETURNING id, folio`,
      [companyId, p.tipo || 'DIARIO', folio, p.fecha, p.concepto || null,
       p.origen || 'MANUAL', p.origen_uuid || null, p.regla || null, userId || null]);
    const entryId = e.rows[0].id;
    let orden = 1;
    for (const l of p.lineas) {
      await client.query(
        `INSERT INTO journal_lines (entry_id, orden, account_id, cargo, abono, concepto, uuid_cfdi, party_rfc)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [entryId, orden++, l.account_id, round2(l.cargo || 0), round2(l.abono || 0),
         l.concepto || null, l.uuid_cfdi || null, l.party_rfc || null]);
    }
    return { id: entryId, folio: e.rows[0].folio };
  });
}

/**
 * Genera las pólizas de VENTA del mes: UNA por factura emitida (tipo I), PARTIDA
 * POR PRODUCTO. Cada ClaveProdServ va a su 401 (mapaProductoCuenta) por su NETO
 * (importe − descuento); el cargo es la subcuenta del cliente (se crea al vuelo)
 * y el IVA va a 208 (PUE) o 209 (PPD). Si el cliente nos retiene ISR/IVA, esa
 * retención es un impuesto A FAVOR (cargo). Idempotente (UNIQUE por origen_uuid).
 * Lo que no cuadra —producto sin 401, falta la cuenta de retención— se OMITE con
 * su motivo.
 */
export async function generarVentasDelMes(
  companyId: string, anio: number, mes: number, userId?: string
): Promise<{ creadas: number; omitidas: Array<{ folio: string; motivo: string }> }> {
  const mapaProd = await mapaProductoCuenta(companyId);
  const r = await query<any>(
    `SELECT c.uuid, c.serie, c.folio, TO_CHAR(c.fecha_emision, 'YYYY-MM-DD') AS fecha_emision, c.total, c.descuento, c.metodo_pago,
            c.nombre_receptor, c.rfc_receptor, c.xml
       FROM cfdi_recibidos c
      WHERE c.company_id=$1 AND c.direccion='emitidos'
        AND c.tipo_comprobante='I' AND c.xml IS NOT NULL
        AND (c.estado_sat IS NULL OR c.estado_sat <> 'Cancelado')
        AND c.fecha_emision::date BETWEEN $2 AND $3
        AND NOT EXISTS (SELECT 1 FROM journal_entries e
                         WHERE e.company_id=c.company_id AND e.origen_uuid=c.uuid)
      ORDER BY c.fecha_emision`,
    [companyId, iniDeMes(anio, mes), finDeMes(anio, mes)]);

  let creadas = 0;
  const omitidas: Array<{ folio: string; motivo: string }> = [];

  for (const c of r.rows) {
    const folioTxt = [c.serie, c.folio].filter(Boolean).join('-') || String(c.uuid).slice(0, 8);
    try {
      const imp = impuestosDeXml(String(c.xml));
      const ret = retencionesDeXml(String(c.xml));

      // Partir el subtotal NETO (importe − descuento) por producto → su 401. El
      // IVA se causa sobre el neto, así que la cuenta de ingreso lleva el neto.
      const porCuenta = new Map<string, number>();
      let faltaProducto: string | null = null;
      for (const cn of conceptosDeXml(String(c.xml))) {
        const cod = mapaProd.get(cn.clave);
        if (!cod) { faltaProducto = cn.clave; break; }
        porCuenta.set(cod, round2((porCuenta.get(cod) || 0) + cn.importe - cn.descuento));
      }
      if (faltaProducto) { omitidas.push({ folio: folioTxt, motivo: `producto ${faltaProducto} sin cuenta 401 asignada` }); continue; }
      if (porCuenta.size === 0) { omitidas.push({ folio: folioTxt, motivo: 'la factura no trae conceptos' }); continue; }

      const cli = await resolverOCrearSubcuentaTercero(companyId, 'cliente', c.rfc_receptor, c.nombre_receptor);
      if ('error' in cli) { omitidas.push({ folio: folioTxt, motivo: `clientes: ${cli.error}` }); continue; }

      const total = round2(c.total);
      const iva = round2(imp.trasladados);
      let sumaVentas = round2(Array.from(porCuenta.values()).reduce((a, b) => a + b, 0));
      // Las ventas deben sumar: total + retenciones − IVA. El residuo (centavos por
      // el redondeo del propio CFDI) se absorbe en la cuenta de mayor importe; más
      // de 5 centavos ya no es redondeo y se OMITE.
      const requerido = round2(total + ret.isr + ret.iva - iva);
      const residuo = round2(requerido - sumaVentas);
      if (Math.abs(residuo) > 0.05) {
        omitidas.push({ folio: folioTxt, motivo: `no cuadra: ventas ${sumaVentas} + IVA ${iva} − retención ${round2(ret.isr + ret.iva)} ≠ total ${total}` }); continue;
      }
      if (residuo !== 0) {
        let cod = '', max = -1;
        for (const [k, v] of porCuenta) if (v > max) { max = v; cod = k; }
        porCuenta.set(cod, round2((porCuenta.get(cod) || 0) + residuo));
        sumaVentas = round2(sumaVentas + residuo);
      }

      const lineas: LineaPoliza[] = [
        { account_id: cli.id, cargo: total, concepto: 'Clientes', uuid_cfdi: c.uuid, party_rfc: c.rfc_receptor },
      ];
      // Lo que el cliente nos retiene es un impuesto A FAVOR (activo, cargo).
      if (ret.isr > 0) {
        const cta = await cuentaPorAgrupadores(companyId, AGR_RET.ventaISR);
        if (!cta) { omitidas.push({ folio: folioTxt, motivo: `tiene ISR retenido pero no hay cuenta a favor (agrupador ${AGR_RET.ventaISR.join('/')})` }); continue; }
        lineas.push({ account_id: cta.id, cargo: ret.isr, concepto: 'ISR retenido a favor', uuid_cfdi: c.uuid });
      }
      if (ret.iva > 0) {
        const cta = await cuentaPorAgrupadores(companyId, AGR_RET.ventaIVA);
        if (!cta) { omitidas.push({ folio: folioTxt, motivo: `tiene IVA retenido pero no hay cuenta a favor (agrupador ${AGR_RET.ventaIVA.join('/')})` }); continue; }
        lineas.push({ account_id: cta.id, cargo: ret.iva, concepto: 'IVA retenido a favor', uuid_cfdi: c.uuid });
      }
      if (iva > 0) {
        const agrupIva = c.metodo_pago === 'PPD' ? '209.01' : '208.01';
        const ctaIva = await cuentaPorAgrupador(companyId, agrupIva);
        if (!ctaIva) { omitidas.push({ folio: folioTxt, motivo: `falta la cuenta de IVA (agrupador ${agrupIva})` }); continue; }
        lineas.push({
          account_id: ctaIva.id, abono: iva, uuid_cfdi: c.uuid,
          concepto: c.metodo_pago === 'PPD' ? 'IVA trasladado no cobrado' : 'IVA trasladado cobrado',
        });
      }
      let faltaCuenta: string | null = null;
      for (const [cod, monto] of porCuenta) {
        const cuenta = await cuentaPorCodigo(companyId, cod);
        if (!cuenta || !cuenta.permite_movimientos) { faltaCuenta = cod; break; }
        lineas.push({ account_id: cuenta.id, abono: monto, concepto: `Ventas ${cod}`, uuid_cfdi: c.uuid });
      }
      if (faltaCuenta) { omitidas.push({ folio: folioTxt, motivo: `la cuenta ${faltaCuenta} no está en el catálogo o no admite movimientos` }); continue; }

      await crearPoliza(companyId, {
        tipo: 'INGRESO', fecha: String(c.fecha_emision).slice(0, 10),
        concepto: `Venta ${folioTxt} · ${(c.nombre_receptor || c.rfc_receptor || '').toString().slice(0, 80)}`.trim(),
        origen: 'CFDI', origen_uuid: c.uuid, regla: 'ventas_cfdi_v2', lineas,
      }, userId);
      creadas++;
    } catch (e: any) {
      omitidas.push({ folio: folioTxt, motivo: (e?.message || 'error').toString().slice(0, 140) });
    }
  }
  return { creadas, omitidas };
}

/**
 * Genera las pólizas de COMPRA del mes: UNA por factura recibida (tipo I) con
 * XML, PARTIDA POR PRODUCTO. Cada ClaveProdServ va a su 115 (inventario) o 601
 * (gasto) por su NETO (importe − descuento); el IVA acreditable va al cargo
 * (119.01) y el abono al proveedor (subcuenta de 201, creada al vuelo). Si le
 * retenemos ISR/IVA al proveedor, esa retención es un pasivo POR ENTERAR (abono)
 * y el proveedor recibe el neto. Idempotente.
 *
 * Los recibidos que sólo tienen metadato (sin XML —la mayoría, por la
 * restricción del SAT) se OMITEN con su motivo: sin conceptos no hay póliza.
 */
export async function generarComprasDelMes(
  companyId: string, anio: number, mes: number, userId?: string
): Promise<{ creadas: number; omitidas: Array<{ folio: string; motivo: string }> }> {
  const mapaProd = await mapaProductoCuentaCompra(companyId);
  const r = await query<any>(
    `SELECT c.uuid, c.serie, c.folio, TO_CHAR(c.fecha_emision, 'YYYY-MM-DD') AS fecha_emision, c.total, c.descuento,
            c.nombre_emisor, c.rfc_emisor, c.xml
       FROM cfdi_recibidos c
      WHERE c.company_id=$1 AND c.direccion='recibidos'
        AND (c.tipo_comprobante='I' OR c.tipo_comprobante IS NULL)
        AND (c.estado_sat IS NULL OR c.estado_sat <> 'Cancelado')
        AND c.fecha_emision::date BETWEEN $2 AND $3
        AND NOT EXISTS (SELECT 1 FROM journal_entries e
                         WHERE e.company_id=c.company_id AND e.origen_uuid=c.uuid)
      ORDER BY c.fecha_emision`,
    [companyId, iniDeMes(anio, mes), finDeMes(anio, mes)]);

  let creadas = 0;
  const omitidas: Array<{ folio: string; motivo: string }> = [];

  for (const c of r.rows) {
    const folioTxt = [c.serie, c.folio].filter(Boolean).join('-') || String(c.uuid).slice(0, 8);
    try {
      if (!c.xml) { omitidas.push({ folio: folioTxt, motivo: 'sin XML (bajó como metadato) — no hay conceptos que contabilizar' }); continue; }
      const imp = impuestosDeXml(String(c.xml));
      const ret = retencionesDeXml(String(c.xml));

      // Cada concepto va NETO (importe − descuento) a su 115/601.
      const porCuenta = new Map<string, number>();
      let faltaProducto: string | null = null;
      for (const cn of conceptosDeXml(String(c.xml))) {
        const cod = mapaProd.get(cn.clave);
        if (!cod) { faltaProducto = cn.clave; break; }
        porCuenta.set(cod, round2((porCuenta.get(cod) || 0) + cn.importe - cn.descuento));
      }
      if (faltaProducto) { omitidas.push({ folio: folioTxt, motivo: `producto ${faltaProducto} sin cuenta (115/601) asignada` }); continue; }
      if (porCuenta.size === 0) { omitidas.push({ folio: folioTxt, motivo: 'la factura no trae conceptos' }); continue; }

      const prov = await resolverOCrearSubcuentaTercero(companyId, 'proveedor', c.rfc_emisor, c.nombre_emisor);
      if ('error' in prov) { omitidas.push({ folio: folioTxt, motivo: `proveedores: ${prov.error}` }); continue; }

      const total = round2(c.total);
      const iva = round2(imp.trasladados);
      let sumaCargos = round2(Array.from(porCuenta.values()).reduce((a, b) => a + b, 0));
      // Los cargos deben sumar: total + retenciones − IVA. El residuo (centavos por
      // el redondeo del propio CFDI) se absorbe en la cuenta de mayor importe; más
      // de 5 centavos ya no es redondeo y se OMITE.
      const requerido = round2(total + ret.isr + ret.iva - iva);
      const residuo = round2(requerido - sumaCargos);
      if (Math.abs(residuo) > 0.05) {
        omitidas.push({ folio: folioTxt, motivo: `no cuadra: compras ${sumaCargos} + IVA ${iva} − retención ${round2(ret.isr + ret.iva)} ≠ total ${total}` }); continue;
      }
      if (residuo !== 0) {
        let cod = '', max = -1;
        for (const [k, v] of porCuenta) if (v > max) { max = v; cod = k; }
        porCuenta.set(cod, round2((porCuenta.get(cod) || 0) + residuo));
        sumaCargos = round2(sumaCargos + residuo);
      }

      const lineas: LineaPoliza[] = [];
      let faltaCuenta: string | null = null;
      for (const [cod, monto] of porCuenta) {
        const cuenta = await cuentaPorCodigo(companyId, cod);
        if (!cuenta || !cuenta.permite_movimientos) { faltaCuenta = cod; break; }
        lineas.push({ account_id: cuenta.id, cargo: monto, concepto: `Compra ${cod}`, uuid_cfdi: c.uuid });
      }
      if (faltaCuenta) { omitidas.push({ folio: folioTxt, motivo: `la cuenta ${faltaCuenta} no está en el catálogo o no admite movimientos` }); continue; }

      if (iva > 0) {
        const ctaIva = await cuentaPorAgrupador(companyId, '119.01');
        if (!ctaIva) { omitidas.push({ folio: folioTxt, motivo: 'falta la cuenta de IVA acreditable (agrupador 119.01)' }); continue; }
        lineas.push({ account_id: ctaIva.id, cargo: iva, concepto: 'IVA acreditable por pagar', uuid_cfdi: c.uuid });
      }
      // El proveedor recibe el NETO de la retención; lo retenido es un pasivo POR ENTERAR (abono).
      lineas.push({ account_id: prov.id, abono: total, concepto: 'Proveedores', uuid_cfdi: c.uuid, party_rfc: c.rfc_emisor });
      if (ret.isr > 0) {
        const cta = await cuentaPorAgrupadores(companyId, AGR_RET.compraISR);
        if (!cta) { omitidas.push({ folio: folioTxt, motivo: `le retienes ISR pero no hay cuenta por enterar (agrupador ${AGR_RET.compraISR.join('/')})` }); continue; }
        lineas.push({ account_id: cta.id, abono: ret.isr, concepto: 'ISR retenido por enterar', uuid_cfdi: c.uuid });
      }
      if (ret.iva > 0) {
        const cta = await cuentaPorAgrupadores(companyId, AGR_RET.compraIVA);
        if (!cta) { omitidas.push({ folio: folioTxt, motivo: `le retienes IVA pero no hay cuenta por enterar (agrupador ${AGR_RET.compraIVA.join('/')})` }); continue; }
        lineas.push({ account_id: cta.id, abono: ret.iva, concepto: 'IVA retenido por enterar', uuid_cfdi: c.uuid });
      }

      await crearPoliza(companyId, {
        tipo: 'EGRESO', fecha: String(c.fecha_emision).slice(0, 10),
        concepto: `Compra ${folioTxt} · ${(c.nombre_emisor || c.rfc_emisor || '').toString().slice(0, 80)}`.trim(),
        origen: 'CFDI', origen_uuid: c.uuid, regla: 'compras_cfdi_v1', lineas,
      }, userId);
      creadas++;
    } catch (e: any) {
      omitidas.push({ folio: folioTxt, motivo: (e?.message || 'error').toString().slice(0, 140) });
    }
  }
  return { creadas, omitidas };
}

/**
 * Genera las pólizas de COBRO y PAGO del mes, desde los complementos de pago
 * (tipo P) con XML — una por complemento (PLAN_CONTABILIDAD §2.4 C y E):
 *
 *   COBRO (complemento EMITIDO):        PAGO (complemento RECIBIDO):
 *     102 Banco            cargo monto    201 Proveedor        cargo monto
 *     209 IVA no cobrado   cargo iva      118 IVA pagado       cargo iva
 *         105 Cliente      abono monto        102 Banco        abono monto
 *         208 IVA cobrado  abono iva          119 IVA por pagar abono iva
 *
 * El IVA sale del propio complemento (TrasladoDR), así que respeta el de la
 * factura original. El banco es la cuenta de control 102.01 (si hay varias, la
 * primera). Idempotente por origen_uuid.
 */
export async function generarCobrosPagosDelMes(
  companyId: string, anio: number, mes: number, userId?: string
): Promise<{ creadas: number; omitidas: Array<{ folio: string; motivo: string }> }> {
  let creadas = 0;
  const omitidas: Array<{ folio: string; motivo: string }> = [];
  const banco = await cuentaPorAgrupador(companyId, '102.01');

  const traer = (direccion: 'emitidos' | 'recibidos') => query<any>(
    `SELECT c.uuid, c.serie, c.folio, TO_CHAR(c.fecha_emision, 'YYYY-MM-DD') AS fecha_emision, c.moneda,
            c.nombre_emisor, c.rfc_emisor, c.nombre_receptor, c.rfc_receptor, c.xml
       FROM cfdi_recibidos c
      WHERE c.company_id=$1 AND c.direccion=$2 AND c.tipo_comprobante='P' AND c.xml IS NOT NULL
        AND (c.estado_sat IS NULL OR c.estado_sat <> 'Cancelado')
        AND c.fecha_emision::date BETWEEN $3 AND $4
        AND NOT EXISTS (SELECT 1 FROM journal_entries e
                         WHERE e.company_id=c.company_id AND e.origen_uuid=c.uuid)
      ORDER BY c.fecha_emision`,
    [companyId, direccion, iniDeMes(anio, mes), finDeMes(anio, mes)]);

  const cobros = await traer('emitidos');   // los que NOSOTROS timbramos = cobros a clientes
  const pagos = await traer('recibidos');   // los que el proveedor timbró = pagos a proveedores

  for (const c of cobros.rows) {
    const folioTxt = [c.serie, c.folio].filter(Boolean).join('-') || String(c.uuid).slice(0, 8);
    try {
      if (!banco) { omitidas.push({ folio: folioTxt, motivo: 'falta la cuenta de banco (agrupador 102.01)' }); continue; }
      const { monto, iva } = complementoDeXml(String(c.xml));
      if (monto <= 0) { omitidas.push({ folio: folioTxt, motivo: 'el complemento no trae monto' }); continue; }
      const cli = await resolverOCrearSubcuentaTercero(companyId, 'cliente', c.rfc_receptor, c.nombre_receptor);
      if ('error' in cli) { omitidas.push({ folio: folioTxt, motivo: `clientes: ${cli.error}` }); continue; }

      const lineas: LineaPoliza[] = [
        { account_id: banco.id, cargo: monto, concepto: 'Banco (cobro)', uuid_cfdi: c.uuid },
        { account_id: cli.id, abono: monto, concepto: 'Clientes', uuid_cfdi: c.uuid, party_rfc: c.rfc_receptor },
      ];
      if (iva > 0) {
        const c209 = await cuentaPorAgrupador(companyId, '209.01');
        const c208 = await cuentaPorAgrupador(companyId, '208.01');
        if (!c209 || !c208) { omitidas.push({ folio: folioTxt, motivo: 'falta cuenta de IVA (208.01 / 209.01)' }); continue; }
        lineas.push({ account_id: c209.id, cargo: iva, concepto: 'IVA trasladado no cobrado', uuid_cfdi: c.uuid });
        lineas.push({ account_id: c208.id, abono: iva, concepto: 'IVA trasladado cobrado', uuid_cfdi: c.uuid });
      }
      await crearPoliza(companyId, {
        tipo: 'INGRESO', fecha: String(c.fecha_emision).slice(0, 10),
        concepto: `Cobro ${folioTxt} · ${(c.nombre_receptor || c.rfc_receptor || '').toString().slice(0, 80)}`.trim(),
        origen: 'CFDI', origen_uuid: c.uuid, regla: 'cobro_cfdi_v1', lineas,
      }, userId);
      creadas++;
    } catch (e: any) { omitidas.push({ folio: folioTxt, motivo: (e?.message || 'error').toString().slice(0, 140) }); }
  }

  for (const c of pagos.rows) {
    const folioTxt = [c.serie, c.folio].filter(Boolean).join('-') || String(c.uuid).slice(0, 8);
    try {
      if (!banco) { omitidas.push({ folio: folioTxt, motivo: 'falta la cuenta de banco (agrupador 102.01)' }); continue; }
      const { monto, iva } = complementoDeXml(String(c.xml));
      if (monto <= 0) { omitidas.push({ folio: folioTxt, motivo: 'el complemento no trae monto' }); continue; }
      const prov = await resolverOCrearSubcuentaTercero(companyId, 'proveedor', c.rfc_emisor, c.nombre_emisor);
      if ('error' in prov) { omitidas.push({ folio: folioTxt, motivo: `proveedores: ${prov.error}` }); continue; }

      const lineas: LineaPoliza[] = [
        { account_id: prov.id, cargo: monto, concepto: 'Proveedores', uuid_cfdi: c.uuid, party_rfc: c.rfc_emisor },
        { account_id: banco.id, abono: monto, concepto: 'Banco (pago)', uuid_cfdi: c.uuid },
      ];
      if (iva > 0) {
        const c118 = await cuentaPorAgrupador(companyId, '118.01');
        const c119 = await cuentaPorAgrupador(companyId, '119.01');
        if (!c118 || !c119) { omitidas.push({ folio: folioTxt, motivo: 'falta cuenta de IVA (118.01 / 119.01)' }); continue; }
        lineas.push({ account_id: c118.id, cargo: iva, concepto: 'IVA acreditable pagado', uuid_cfdi: c.uuid });
        lineas.push({ account_id: c119.id, abono: iva, concepto: 'IVA acreditable por pagar', uuid_cfdi: c.uuid });
      }
      await crearPoliza(companyId, {
        tipo: 'EGRESO', fecha: String(c.fecha_emision).slice(0, 10),
        concepto: `Pago ${folioTxt} · ${(c.nombre_emisor || c.rfc_emisor || '').toString().slice(0, 80)}`.trim(),
        origen: 'CFDI', origen_uuid: c.uuid, regla: 'pago_cfdi_v1', lineas,
      }, userId);
      creadas++;
    } catch (e: any) { omitidas.push({ folio: folioTxt, motivo: (e?.message || 'error').toString().slice(0, 140) }); }
  }

  return { creadas, omitidas };
}

/**
 * Póliza MANUAL — cargos y abonos capturados a mano, con CUALQUIER cuenta del
 * catálogo (a diferencia de ventas/compras/nómina, que sólo tocan sus cuentas).
 * Cuadra o no se guarda: se valida Σcargo = Σabono antes de asentar, y la base
 * lo revalida al COMMIT. El UUID es opcional; si se pone, liga la póliza a un CFDI.
 */
export async function crearPolizaManual(
  companyId: string,
  d: {
    tipo?: 'INGRESO' | 'EGRESO' | 'DIARIO';
    fecha: string; concepto?: string; uuid?: string | null;
    lineas: Array<{ codigo: string; cargo?: number; abono?: number; concepto?: string; party_rfc?: string | null }>;
  },
  userId?: string
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha || ''))) {
    throw new Error('La fecha debe venir como AAAA-MM-DD.');
  }
  const filas = (d.lineas || []).filter((l) => l && l.codigo && (round2(l.cargo) > 0 || round2(l.abono) > 0));
  if (filas.length < 2) throw new Error('Una póliza necesita al menos dos partidas con importe.');

  const lineas: LineaPoliza[] = [];
  let sumaCargo = 0, sumaAbono = 0;
  for (const l of filas) {
    const cargo = round2(l.cargo), abono = round2(l.abono);
    if (cargo > 0 && abono > 0) throw new Error(`La cuenta ${l.codigo} no puede llevar cargo y abono a la vez.`);
    const cuenta = await cuentaPorCodigo(companyId, String(l.codigo).trim());
    if (!cuenta) throw new Error(`La cuenta ${l.codigo} no está en el catálogo.`);
    if (!cuenta.permite_movimientos) throw new Error(`La cuenta ${l.codigo} es de agrupación (tiene subcuentas): no admite movimientos.`);
    sumaCargo = round2(sumaCargo + cargo);
    sumaAbono = round2(sumaAbono + abono);
    lineas.push({
      account_id: cuenta.id, cargo, abono,
      concepto: (l.concepto || d.concepto || '').toString().slice(0, 200) || undefined,
      uuid_cfdi: d.uuid || null, party_rfc: l.party_rfc || null,
    });
  }
  if (sumaCargo <= 0) throw new Error('La póliza no tiene importes.');
  if (sumaCargo !== sumaAbono) {
    throw new Error(`No cuadra: cargos ${sumaCargo.toFixed(2)} ≠ abonos ${sumaAbono.toFixed(2)} (diferencia ${(sumaCargo - sumaAbono).toFixed(2)}).`);
  }
  if (d.uuid) {
    const dup = await query('SELECT 1 FROM journal_entries WHERE company_id=$1 AND origen_uuid=$2 LIMIT 1', [companyId, d.uuid]);
    if ((dup.rowCount || 0) > 0) throw new Error('Ya existe una póliza con ese UUID.');
  }

  const poliza = await crearPoliza(companyId, {
    tipo: d.tipo || 'DIARIO', fecha: d.fecha, concepto: d.concepto || 'Póliza manual',
    origen: 'MANUAL', origen_uuid: d.uuid || null, regla: 'manual', lineas,
  }, userId);
  return { ...poliza, sumaCargo, sumaAbono };
}

/**
 * Edita las partidas (y el encabezado) de una póliza, del origen que sea. Se
 * reemplazan TODAS las partidas por las nuevas; útil para corregir a mano una
 * póliza automática que quedó con la cuenta equivocada. Cuadra o no se guarda.
 */
export async function editarPoliza(
  companyId: string, id: string,
  d: { fecha?: string; concepto?: string; lineas: Array<{ codigo: string; cargo?: number; abono?: number; concepto?: string }> }
) {
  const filas = (d.lineas || []).filter((l) => l && l.codigo && (round2(l.cargo) > 0 || round2(l.abono) > 0));
  if (filas.length < 2) throw new Error('Una póliza necesita al menos dos partidas con importe.');

  const nuevas: Array<{ account_id: string; cargo: number; abono: number; concepto: string | null }> = [];
  let sumaCargo = 0, sumaAbono = 0;
  for (const l of filas) {
    const cargo = round2(l.cargo), abono = round2(l.abono);
    if (cargo > 0 && abono > 0) throw new Error(`La cuenta ${l.codigo} no puede llevar cargo y abono a la vez.`);
    const cuenta = await cuentaPorCodigo(companyId, String(l.codigo).trim());
    if (!cuenta) throw new Error(`La cuenta ${l.codigo} no está en el catálogo.`);
    if (!cuenta.permite_movimientos) throw new Error(`La cuenta ${l.codigo} es de agrupación: no admite movimientos.`);
    sumaCargo = round2(sumaCargo + cargo); sumaAbono = round2(sumaAbono + abono);
    nuevas.push({ account_id: cuenta.id, cargo, abono, concepto: (l.concepto || d.concepto || '').toString().slice(0, 200) || null });
  }
  if (sumaCargo <= 0) throw new Error('La póliza no tiene importes.');
  if (sumaCargo !== sumaAbono) throw new Error(`No cuadra: cargos ${sumaCargo.toFixed(2)} ≠ abonos ${sumaAbono.toFixed(2)}.`);

  return transaction(async (client) => {
    const own = await client.query<any>(
      `SELECT origen_uuid FROM journal_entries WHERE company_id=$1 AND id=$2`, [companyId, id]);
    if (own.rows.length === 0) throw new Error('No se encontró la póliza.');
    const uuid = own.rows[0].origen_uuid || null;

    const fechaValida = d.fecha && /^\d{4}-\d{2}-\d{2}$/.test(d.fecha) ? d.fecha : null;
    if (fechaValida || d.concepto !== undefined) {
      await client.query(
        `UPDATE journal_entries SET fecha = COALESCE($3, fecha), concepto = COALESCE($4, concepto)
          WHERE id=$1 AND company_id=$2`,
        [id, companyId, fechaValida, d.concepto ?? null]);
    }
    await client.query(`DELETE FROM journal_lines WHERE entry_id=$1`, [id]);
    let orden = 1;
    for (const l of nuevas) {
      await client.query(
        `INSERT INTO journal_lines (entry_id, orden, account_id, cargo, abono, concepto, uuid_cfdi)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, orden++, l.account_id, l.cargo, l.abono, l.concepto, uuid]);
    }
    return { id, sumaCargo, sumaAbono };
  });
}

/** Borra UNA póliza (encabezado + partidas), sea cual sea su origen. */
export async function borrarPoliza(companyId: string, id: string): Promise<boolean> {
  return transaction(async (client) => {
    const own = await client.query(
      `SELECT 1 FROM journal_entries WHERE company_id=$1 AND id=$2`, [companyId, id]);
    if (own.rows.length === 0) return false;
    await client.query(`DELETE FROM journal_lines WHERE entry_id=$1`, [id]);
    await client.query(`DELETE FROM journal_entries WHERE id=$1 AND company_id=$2`, [id, companyId]);
    return true;
  });
}

/** Las pólizas del mes, con sus partidas, para revisarlas. */
export async function listarPolizas(companyId: string, anio: number, mes: number) {
  const r = await query<any>(
    `SELECT e.id, e.folio, e.tipo, e.fecha, e.concepto, e.estado, e.origen, e.regla, e.origen_uuid,
            COALESCE(json_agg(json_build_object(
              'codigo', a.codigo, 'nombre', a.nombre,
              'cargo', l.cargo, 'abono', l.abono, 'concepto', l.concepto
            ) ORDER BY l.orden) FILTER (WHERE l.id IS NOT NULL), '[]') AS lineas
       FROM journal_entries e
       LEFT JOIN journal_lines l ON l.entry_id = e.id
       LEFT JOIN accounting_accounts a ON a.id = l.account_id
      WHERE e.company_id=$1 AND e.fecha BETWEEN $2 AND $3
      GROUP BY e.id
      ORDER BY e.fecha, e.folio`,
    [companyId, iniDeMes(anio, mes), finDeMes(anio, mes)]);
  return r.rows;
}

/**
 * Borra las pólizas de ORIGEN CFDI del mes. Es una comodidad de arranque: durante
 * el afinado de la regla hace falta re-generar. No toca las manuales ni las de
 * otros orígenes. (Cuando esto sea producción, se sustituye por reversa.)
 */
export async function borrarVentasDelMes(companyId: string, anio: number, mes: number): Promise<number> {
  const r = await query(
    `DELETE FROM journal_entries
      WHERE company_id=$1 AND origen='CFDI' AND fecha BETWEEN $2 AND $3`,
    [companyId, iniDeMes(anio, mes), finDeMes(anio, mes)]);
  return r.rowCount || 0;
}

/* ── "Todo el año" ──────────────────────────────────────────────────────────
 * Recorre los meses y suma. Del año EN CURSO sólo hasta el mes actual (los meses
 * que aún no pasan no traen comprobantes); de años pasados, los 12. No duplica:
 * cada mes es idempotente por sí mismo. */
function mesesDelAnio(anio: number): number[] {
  const hoy = new Date();
  const ultimo = anio >= hoy.getFullYear() ? hoy.getMonth() + 1 : 12;
  return Array.from({ length: ultimo }, (_, i) => i + 1);
}
type ResultadoGen = { creadas: number; omitidas: Array<{ folio: string; motivo: string }> };
async function porTodoElAnio(
  anio: number, gen: (mes: number) => Promise<ResultadoGen>,
): Promise<ResultadoGen & { porMes: Array<{ mes: number; creadas: number }> }> {
  let creadas = 0;
  const omitidas: Array<{ folio: string; motivo: string }> = [];
  const porMes: Array<{ mes: number; creadas: number }> = [];
  for (const mes of mesesDelAnio(anio)) {
    const r = await gen(mes);
    creadas += r.creadas;
    for (const o of r.omitidas) omitidas.push({ folio: `${String(mes).padStart(2, '0')}·${o.folio}`, motivo: o.motivo });
    porMes.push({ mes, creadas: r.creadas });
  }
  return { creadas, omitidas, porMes };
}
export const generarVentasDelAnio = (companyId: string, anio: number, userId?: string) =>
  porTodoElAnio(anio, (mes) => generarVentasDelMes(companyId, anio, mes, userId));
export const generarComprasDelAnio = (companyId: string, anio: number, userId?: string) =>
  porTodoElAnio(anio, (mes) => generarComprasDelMes(companyId, anio, mes, userId));
export const generarCobrosPagosDelAnio = (companyId: string, anio: number, userId?: string) =>
  porTodoElAnio(anio, (mes) => generarCobrosPagosDelMes(companyId, anio, mes, userId));
