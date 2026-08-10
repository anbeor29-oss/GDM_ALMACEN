/**
 * kardex.service — la historia de UN producto en UN mes.
 *
 * QUÉ RESPONDE
 * De qué existencia se partió, qué entró y qué salió —con el documento que lo
 * respalda—, con cuánto se cerró y cuánto vale. Es el reporte que se lleva a
 * una revisión: la fila que no cuadra tiene al lado el número de factura con el
 * que discutirla.
 *
 * POR QUÉ SE RECALCULA Y NO SE LEE UNA COLUMNA
 * `warehouse_stock` guarda la existencia de HOY. Para saber con cuánto se
 * empezó en marzo no sirve: habría que restarle todo lo que pasó después, que
 * es justamente lo que se está calculando. El saldo inicial se obtiene sumando
 * los movimientos anteriores al mes, que es el único dato que no cambia cuando
 * alguien corrige algo hoy.
 *
 * LOS MOVIMIENTOS SON LA FUENTE
 * Un movimiento nunca se borra ni se edita: una corrección es otro movimiento.
 * Por eso el kardex de un mes cerrado da siempre el mismo resultado, y por eso
 * puede archivarse sin miedo a que "cambie solo" el mes siguiente.
 */

import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';

/* Qué tipos suman y cuáles restan.
 *
 * Va aquí y no repartido en la consulta porque el día que se agregue un tipo
 * de movimiento hay que decidir de qué lado cae, y esa decisión debe estar en
 * un solo lugar visible. Un tipo que se olvide no rompe nada: simplemente
 * dejaría de contarse, y el saldo saldría mal sin avisar. */
const ENTRADAS = [
  'PURCHASE_IN', 'CUSTOMER_RETURN', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'INITIAL',
] as const;
const SALIDAS = [
  'SALE_OUT', 'SUPPLIER_RETURN', 'TRANSFER_OUT', 'ADJUSTMENT_OUT',
  'SHRINKAGE', 'THEFT', 'DAMAGED',
] as const;

/** Nombre legible de cada tipo. El reporte lo lee gente de almacén, no de TI. */
const NOMBRE: Record<string, string> = {
  PURCHASE_IN: 'Compra', SALE_OUT: 'Venta', CUSTOMER_RETURN: 'Devolución de cliente',
  SUPPLIER_RETURN: 'Devolución a proveedor', TRANSFER_IN: 'Traspaso recibido',
  TRANSFER_OUT: 'Traspaso enviado', ADJUSTMENT_IN: 'Ajuste (+)',
  ADJUSTMENT_OUT: 'Ajuste (−)', SHRINKAGE: 'Merma', THEFT: 'Robo o pérdida',
  DAMAGED: 'Dañado', INITIAL: 'Carga inicial',
};

export interface MovimientoKardex {
  fecha: string;
  tipo: string;
  tipoNombre: string;
  esEntrada: boolean;
  entrada: number;
  salida: number;
  costoUnitario: number | null;
  importe: number | null;
  documento: string;
  almacen: string;
  usuario: string | null;
  nota: string | null;
  /** Existencia DESPUÉS de este movimiento. */
  saldo: number;
}

export interface Kardex {
  producto: { id: string; sku: string; name: string; unit: string | null };
  periodo: { anio: number; mes: number; desde: string; hasta: string };
  almacen: { id: string; code: string; name: string } | null;
  saldoInicial: number;
  movimientos: MovimientoKardex[];
  resumen: {
    totalEntradas: number;
    totalSalidas: number;
    existenciaFinal: number;
    /* Costo promedio de lo que queda, tomado de warehouse_stock: es el que usa
     * el resto del sistema para valuar, y presentar aquí otro número obligaría
     * a explicar cuál de los dos es el bueno. */
    costoPromedio: number;
    valorTotal: number;
  };
}

export async function kardexDeProducto(opts: {
  companyId: string;
  productId: string;
  anio: number;
  mes: number;
  warehouseId?: string;
}): Promise<Kardex> {
  const { companyId, productId, warehouseId } = opts;
  const anio = Number(opts.anio);
  const mes = Number(opts.mes);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    throw new ValidationError('Año fuera de rango');
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new ValidationError('El mes debe ir de 1 a 12');
  }

  const prodR = await query<any>(
    `SELECT id, sku, name, unit_code AS unit FROM products
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [productId, companyId]
  );
  if (prodR.rows.length === 0) throw new NotFoundError('Producto no encontrado');
  const producto = prodR.rows[0];

  /* Los límites del mes se arman en SQL con make_date para que el corte lo
   * decida la BASE y no la zona horaria del servidor. Render corre en UTC: un
   * movimiento del 31 a las 19:00 hora de México es del día 1 en UTC, y con un
   * corte hecho en JavaScript se iría al mes siguiente. */
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;

  const filtroAlmacen = warehouseId
    ? `AND (m.warehouse_from_id = $4 OR m.warehouse_to_id = $4)`
    : '';
  const params: any[] = [companyId, productId, desde];
  if (warehouseId) params.push(warehouseId);

  const entradasSql = ENTRADAS.map(t => `'${t}'`).join(',');

  /* ── Saldo inicial: todo lo anterior al primer día del mes ───────────── */
  const iniR = await query<{ saldo: string }>(
    `SELECT COALESCE(SUM(
              CASE WHEN m.movement_type IN (${entradasSql})
                   THEN m.quantity ELSE -m.quantity END), 0)::text AS saldo
       FROM inventory_movements m
      WHERE m.company_id = $1 AND m.product_id = $2
        AND m.created_at < $3::date
        ${filtroAlmacen}`,
    params
  );
  const saldoInicial = Number(iniR.rows[0].saldo);

  /* ── Movimientos del mes ─────────────────────────────────────────────── */
  const movR = await query<any>(
    `SELECT m.created_at, m.movement_type, m.quantity, m.unit_cost,
            m.reference_type, m.reference_id, m.reason, m.user_email,
            COALESCE(wt.code, wf.code)            AS almacen_code,
            COALESCE(wt.name, wf.name)            AS almacen_name,
            /* El documento que respalda el movimiento. Cada origen lo guarda
             * distinto y el reporte no puede pedirle al usuario que sepa cuál:
             *   · venta      → serie-folio de la factura
             *   · compra XML → el folio va dentro de "reason", porque
             *                  xml_imports no guarda folio, sólo el UUID
             *   · lo demás   → el tipo de referencia, para no inventar nada */
            i.serie AS inv_serie, i.folio AS inv_folio,
            x.emisor_nombre AS proveedor, x.cfdi_uuid AS compra_uuid
       FROM inventory_movements m
       LEFT JOIN warehouses  wt ON wt.id = m.warehouse_to_id
       LEFT JOIN warehouses  wf ON wf.id = m.warehouse_from_id
       LEFT JOIN invoices     i ON m.reference_type = 'invoice'    AND i.id = m.reference_id
       LEFT JOIN xml_imports  x ON m.reference_type = 'xml_import' AND x.id = m.reference_id
      WHERE m.company_id = $1 AND m.product_id = $2
        AND m.created_at >= $3::date
        AND m.created_at <  ($3::date + INTERVAL '1 month')
        ${filtroAlmacen}
      ORDER BY m.created_at ASC, m.id ASC`,
    params
  );

  let saldo = saldoInicial;
  let totalEntradas = 0;
  let totalSalidas = 0;

  const movimientos: MovimientoKardex[] = movR.rows.map((r: any) => {
    const esEntrada = (ENTRADAS as readonly string[]).includes(r.movement_type);
    const cant = Number(r.quantity);
    if (esEntrada) { saldo += cant; totalEntradas += cant; }
    else { saldo -= cant; totalSalidas += cant; }

    const costo = r.unit_cost != null ? Number(r.unit_cost) : null;

    let documento = '';
    if (r.inv_folio) documento = `${r.inv_serie || 'F'}-${String(r.inv_folio).padStart(6, '0')}`;
    else if (r.proveedor) {
      /* `reason` trae "Compra XML B-123 · PROVEEDOR SA". Se extrae el folio de
       * ahí porque es el número con el que el almacenista busca el papel. */
      const m = String(r.reason || '').match(/Compra XML ([^\s·]+)/);
      documento = m ? m[1] : (r.compra_uuid ? r.compra_uuid.slice(0, 8) : '');
    } else if (r.reference_type) {
      documento = String(r.reference_type).replace(/_/g, ' ');
    }

    return {
      fecha: r.created_at,
      tipo: r.movement_type,
      tipoNombre: NOMBRE[r.movement_type] || r.movement_type,
      esEntrada,
      entrada: esEntrada ? cant : 0,
      salida: esEntrada ? 0 : cant,
      costoUnitario: costo,
      importe: costo != null ? Math.round(costo * cant * 100) / 100 : null,
      documento,
      almacen: r.almacen_code ? `${r.almacen_code} · ${r.almacen_name}` : '',
      usuario: r.user_email,
      nota: r.reason,
      saldo,
    };
  });

  /* ── Valuación de lo que queda ───────────────────────────────────────── */
  const stockR = await query<any>(
    `SELECT COALESCE(SUM(ws.quantity), 0)::numeric              AS cantidad,
            COALESCE(SUM(ws.quantity * ws.avg_cost), 0)::numeric AS valor
       FROM warehouse_stock ws
      WHERE ws.product_id = $1
        ${warehouseId ? 'AND ws.warehouse_id = $2' : ''}`,
    warehouseId ? [productId, warehouseId] : [productId]
  );
  const valorTotal = Number(stockR.rows[0]?.valor || 0);
  const cantidadHoy = Number(stockR.rows[0]?.cantidad || 0);

  let almacen: Kardex['almacen'] = null;
  if (warehouseId) {
    const w = await query<any>(
      `SELECT id, code, name FROM warehouses WHERE id = $1 AND company_id = $2`,
      [warehouseId, companyId]
    );
    almacen = w.rows[0] || null;
  }

  const fin = new Date(anio, mes, 0);
  return {
    producto,
    periodo: {
      anio, mes, desde,
      hasta: `${anio}-${String(mes).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`,
    },
    almacen,
    saldoInicial,
    movimientos,
    resumen: {
      totalEntradas,
      totalSalidas,
      existenciaFinal: saldo,
      costoPromedio: cantidadHoy > 0 ? Math.round((valorTotal / cantidadHoy) * 100) / 100 : 0,
      valorTotal: Math.round(valorTotal * 100) / 100,
    },
  };
}
