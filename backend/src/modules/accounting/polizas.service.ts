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
import { conceptosDeXml, mapaProductoCuenta } from './ventas-cuentas.service';

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

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
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
 * POR PRODUCTO. Cada ClaveProdServ va a su 401 (mapaProductoCuenta); el cargo es
 * la subcuenta del cliente (se crea al vuelo) y el IVA va a 208 (PUE) o 209
 * (PPD). Idempotente (UNIQUE por origen_uuid). Lo que no cuadra —producto sin
 * 401, descuento, retenciones— se OMITE con su motivo.
 */
export async function generarVentasDelMes(
  companyId: string, anio: number, mes: number, userId?: string
): Promise<{ creadas: number; omitidas: Array<{ folio: string; motivo: string }> }> {
  const mapaProd = await mapaProductoCuenta(companyId);
  const r = await query<any>(
    `SELECT c.uuid, c.serie, c.folio, c.fecha_emision, c.total, c.descuento, c.metodo_pago,
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
      if (round2(c.descuento) > 0) { omitidas.push({ folio: folioTxt, motivo: 'tiene descuento — regla pendiente' }); continue; }
      const imp = impuestosDeXml(String(c.xml));
      if (imp.retenidos > 0) { omitidas.push({ folio: folioTxt, motivo: 'tiene retenciones — regla pendiente' }); continue; }

      // Partir el subtotal por producto → su 401 (según el mapeo ClaveProdServ).
      const porCuenta = new Map<string, number>();
      let faltaProducto: string | null = null;
      for (const cn of conceptosDeXml(String(c.xml))) {
        const cod = mapaProd.get(cn.clave);
        if (!cod) { faltaProducto = cn.clave; break; }
        porCuenta.set(cod, round2((porCuenta.get(cod) || 0) + cn.importe));
      }
      if (faltaProducto) { omitidas.push({ folio: folioTxt, motivo: `producto ${faltaProducto} sin cuenta 401 asignada` }); continue; }
      if (porCuenta.size === 0) { omitidas.push({ folio: folioTxt, motivo: 'la factura no trae conceptos' }); continue; }

      const cli = await resolverOCrearSubcuentaTercero(companyId, 'cliente', c.rfc_receptor, c.nombre_receptor);
      if ('error' in cli) { omitidas.push({ folio: folioTxt, motivo: `clientes: ${cli.error}` }); continue; }

      const total = round2(c.total);
      const iva = round2(imp.trasladados);
      const sumaVentas = round2(Array.from(porCuenta.values()).reduce((a, b) => a + b, 0));
      if (round2(sumaVentas + iva) !== total) {
        omitidas.push({ folio: folioTxt, motivo: `no cuadra: ventas ${sumaVentas} + IVA ${iva} ≠ total ${total}` }); continue;
      }

      const lineas: LineaPoliza[] = [
        { account_id: cli.id, cargo: total, concepto: 'Clientes', uuid_cfdi: c.uuid, party_rfc: c.rfc_receptor },
      ];
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

/** Las pólizas del mes, con sus partidas, para revisarlas. */
export async function listarPolizas(companyId: string, anio: number, mes: number) {
  const r = await query<any>(
    `SELECT e.id, e.folio, e.tipo, e.fecha, e.concepto, e.estado, e.origen, e.regla,
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
