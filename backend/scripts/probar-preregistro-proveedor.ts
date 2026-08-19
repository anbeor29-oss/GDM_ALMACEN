/**
 * probar-preregistro-proveedor — que la deuda nazca aunque el proveedor no esté.
 *
 * LO QUE SE ESTÁ ARREGLANDO
 * La mercancía entraba y la deuda no. Quien recibe tiene la factura en la mano
 * pero el proveedor no está dado de alta, y darlo de alta completo pide RFC,
 * régimen y domicilio: datos que no trae el repartidor. El resultado es una
 * cuenta por pagar que nadie captura hasta que el proveedor llama —y para
 * entonces ya venció—.
 *
 * LO QUE NO SE PUEDE ROMPER AL ARREGLARLO
 *   · Que capturar el mismo nombre dos veces cree DOS proveedores. El saldo de
 *     ninguno de los dos sería el real.
 *   · Que la línea de crédito no se consuma.
 *   · Que el preregistro pase por un proveedor bueno. Le falta el RFC: si algo
 *     fiscal lo acepta, el error sale hasta el timbrado.
 *
 *   npx ts-node -r dotenv/config scripts/probar-preregistro-proveedor.ts
 *
 * Deja la base como la encontró.
 */
import { pool, query } from '../src/config/database';
import { preregistrar, esPreregistroRfc } from '../src/modules/purchasing/preregistro-proveedor.service';
import { receiveOrder } from '../src/modules/purchasing/purchasing.service';
import { listarFaltantes } from '../src/modules/purchasing/faltantes.service';

let ok = 0, fallos = 0;
const bien = (q: string) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q: string, d?: any) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };
const cerca = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

const NOMBRE = 'ZZ PRUEBA ACEROS DEL NORTE';
const SKU = 'ZZ-PRE-01';

async function limpiar(companyId: string) {
  await query(
    `DELETE FROM supplier_payments_schedule
      WHERE company_id = $1 AND supplier_id IN
        (SELECT id FROM customers WHERE company_id = $1 AND business_name LIKE 'ZZ PRUEBA%')`,
    [companyId]);
  await query(
    `DELETE FROM purchase_orders WHERE company_id = $1 AND notes LIKE 'ZZ prueba%'`, [companyId]);
  await query(
    `DELETE FROM customers WHERE company_id = $1 AND business_name LIKE 'ZZ PRUEBA%'`, [companyId]);
  await query(
    `DELETE FROM inventory_movements WHERE product_id IN
       (SELECT id FROM products WHERE company_id=$1 AND sku=$2)`, [companyId, SKU]);
  await query(
    `DELETE FROM warehouse_stock WHERE product_id IN
       (SELECT id FROM products WHERE company_id=$1 AND sku=$2)`, [companyId, SKU]);
  await query(`DELETE FROM products WHERE company_id = $1 AND sku = $2`, [companyId, SKU]);
}

async function main() {
  const c = await query<any>(
    `SELECT id FROM companies WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`);
  const companyId = c.rows[0].id;
  await limpiar(companyId);

  /* ── 1. El preregistro nace con lo mínimo ── */
  const p1 = await preregistrar(companyId, { nombre: NOMBRE, creditDays: 30 });
  p1.nuevo && p1.id
    ? bien('el proveedor se da de alta con nombre y días de crédito, nada más')
    : mal('no se creó el preregistro');

  const guardado = await query<any>(
    `SELECT rfc, business_name, credit_days, es_preregistro, party_type
       FROM customers WHERE id = $1`, [p1.id]);
  const g = guardado.rows[0];

  g.es_preregistro && g.party_type === 'SUPPLIER' && Number(g.credit_days) === 30
    ? bien('queda marcado como preregistro, con sus 30 días')
    : mal('el preregistro no quedó bien', JSON.stringify(g));

  esPreregistroRfc(g.rfc)
    ? bien(`el RFC es un marcador, no un RFC: "${g.rfc}" — nada fiscal lo va a aceptar`)
    : mal('se guardó algo que parece un RFC real', g.rfc);

  /* ── 2. El mismo nombre NO crea otro ── */
  const p2 = await preregistrar(companyId, { nombre: '  zz prueba aceros del norte  ' });
  !p2.nuevo && p2.id === p1.id
    ? bien('capturar el mismo nombre otra vez reusa el proveedor, aunque cambien mayúsculas y espacios')
    : mal('se duplicó el proveedor', `${p1.id} vs ${p2.id}`);

  const cuantos = await query<any>(
    `SELECT COUNT(*)::int n FROM customers WHERE company_id=$1 AND business_name LIKE 'ZZ PRUEBA%'`,
    [companyId]);
  cuantos.rows[0].n === 1
    ? bien('hay UN proveedor, no dos con la deuda repartida')
    : mal('quedaron proveedores duplicados', cuantos.rows[0].n);

  /* ── 3. Recibir mercancía SIN proveedor en la orden, capturando su nombre ── */
  const w = await query<any>(
    `SELECT id FROM warehouses WHERE company_id=$1 AND deleted_at IS NULL LIMIT 1`, [companyId]);
  if (w.rows.length === 0) {
    bien('(sin almacenes en la base: no se pudo probar la recepción)');
    await limpiar(companyId);
    console.log(`\n${ok} bien, ${fallos} mal`);
    await pool.end();
    return process.exit(fallos ? 1 : 0);
  }
  const warehouseId = w.rows[0].id;

  const prod = await query<any>(
    `INSERT INTO products (company_id, sku, name, clave_sat, unit_code)
     VALUES ($1,$2,'ZZ producto de prueba','01010101','H87') RETURNING id`,
    [companyId, SKU]);
  const productId = prod.rows[0].id;

  const po = await query<any>(
    `INSERT INTO purchase_orders
       (company_id, folio, warehouse_id, status, order_type, notes)
     SELECT $1, COALESCE(MAX(folio),0)+900, $2, 'APPROVED','QUOTATION','ZZ prueba recepción sin proveedor'
       FROM purchase_orders WHERE company_id=$1
     RETURNING id, folio`,
    [companyId, warehouseId]);
  const orderId = po.rows[0].id;

  const item = await query<any>(
    `INSERT INTO purchase_order_items
       (purchase_order_id, product_id, quantity_ordered, quantity_received, last_purchase_price)
     VALUES ($1,$2,10,0,50) RETURNING id`,
    [orderId, productId]);

  /* Otro proveedor de preregistro, capturado EN LA RECEPCIÓN. */
  const NOMBRE2 = 'ZZ PRUEBA FERRETERA DEL BAJIO';
  const res = await receiveOrder(
    companyId, orderId,
    [{ itemId: item.rows[0].id, quantity: 10, unitCost: 50 }],
    { userId: undefined, email: 'prueba@zz.mx' },
    'PROMEDIO',
    {
      invoiceNumber: 'ZZ-A-1001',
      total: 580,              // el papel dice 580
      taxRate: 16,
      invoiceDate: '2026-08-19',
      creditDays: 15,
      supplierName: NOMBRE2,
    }
  );

  res.deuda && res.deuda.id
    ? bien('la mercancía entra Y la deuda nace, con el proveedor capturado al vuelo')
    : mal('no se generó la deuda', JSON.stringify(res.deuda));

  cerca(Number(res.deuda?.amount), 580)
    ? bien('el importe es el TOTAL que dice la factura — 580, no el costo de la mercancía')
    : mal('el importe no es el capturado', res.deuda?.amount);

  cerca(Number(res.deuda?.subtotal), 500)
    ? bien('y el subtotal se deriva del total: 580 / 1.16 = 500')
    : mal('el subtotal derivado no cuadra', res.deuda?.subtotal);

  /* Los días de la FACTURA, no los del proveedor. */
  /* `due_date` llega como Date del driver, no como texto: compararlo con
   * String(...).slice(0,10) daba "Thu Sep 03" y la prueba fallaba por el
   * formato, no por la fecha. Se normaliza a ISO. */
  const venc = new Date(res.deuda?.dueDate).toISOString().slice(0, 10);
  venc === '2026-09-03'
    ? bien('vence a los 15 días de la factura (03/09), que son los que se capturaron')
    : mal('el vencimiento no usó los días de la factura', venc);

  /* La orden se quedó con ese proveedor. */
  const poDespues = await query<any>(
    `SELECT supplier_id FROM purchase_orders WHERE id = $1`, [orderId]);
  const nuevoProv = await query<any>(
    `SELECT id, business_name, es_preregistro, credit_used
       FROM customers WHERE id = $1`, [poDespues.rows[0].supplier_id]);

  nuevoProv.rows[0]?.business_name === NOMBRE2 && nuevoProv.rows[0]?.es_preregistro
    ? bien('la orden quedó ligada al proveedor nuevo: la deuda tiene a quién pagarle')
    : mal('la orden no quedó con el proveedor', JSON.stringify(nuevoProv.rows[0]));

  cerca(Number(nuevoProv.rows[0]?.credit_used), 580)
    ? bien('la línea de crédito se consumió, igual que con un proveedor de planta')
    : mal('no se consumió la línea de crédito', nuevoProv.rows[0]?.credit_used);

  /* ── 4. La misma factura dos veces no duplica la deuda ── */
  const dobles = await query<any>(
    `SELECT COUNT(*)::int n FROM supplier_payments_schedule
      WHERE company_id=$1 AND invoice_number='ZZ-A-1001'`, [companyId]);
  dobles.rows[0].n === 1
    ? bien('una factura, una deuda')
    : mal('la factura se registró más de una vez', dobles.rows[0].n);

  /* ── 5. Sin nombre y sin proveedor, se dice por qué ── */
  const po2 = await query<any>(
    `INSERT INTO purchase_orders (company_id, folio, warehouse_id, status, order_type, notes)
     SELECT $1, COALESCE(MAX(folio),0)+901, $2, 'APPROVED','QUOTATION','ZZ prueba sin nada'
       FROM purchase_orders WHERE company_id=$1
     RETURNING id`,
    [companyId, warehouseId]);
  const item2 = await query<any>(
    `INSERT INTO purchase_order_items
       (purchase_order_id, product_id, quantity_ordered, quantity_received, last_purchase_price)
     VALUES ($1,$2,5,0,50) RETURNING id`,
    [po2.rows[0].id, productId]);

  try {
    await receiveOrder(
      companyId, po2.rows[0].id,
      [{ itemId: item2.rows[0].id, quantity: 5 }],
      { email: 'prueba@zz.mx' }, 'PROMEDIO',
      { invoiceNumber: 'ZZ-A-2002', total: 100 }
    );
    mal('registró una deuda sin decir a quién se le debe');
  } catch (e: any) {
    /captura su nombre/.test(e.message)
      ? bien('sin proveedor ni nombre, el mensaje dice exactamente qué hacer')
      : mal('rechazó con otro mensaje', e.message);
  }

  /* ── 6. Faltantes: el margen de dos unidades ──
   *
   * Enterarse al TOCAR el mínimo es enterarse tarde: el proveedor no entrega el
   * mismo día. La prueba pone el mismo producto en cuatro existencias distintas
   * y comprueba en qué escalón cae cada una. */
  await query(
    `INSERT INTO warehouse_stock (product_id, warehouse_id, quantity, stock_minimum, stock_maximum)
     VALUES ($1,$2,12,10,40)
     ON CONFLICT (product_id, warehouse_id)
     DO UPDATE SET quantity = 12, stock_minimum = 10, stock_maximum = 40`,
    [productId, warehouseId]);

  const situacionDe = async () => {
    const l = await listarFaltantes(companyId, 2);
    return l.find((x: any) => x.product_id === productId)?.situacion ?? '(no aparece)';
  };

  await situacionDe() === 'cerca'
    ? bien('con 12 y mínimo 10, sale como "cerca": ya está llegando')
    : mal('el margen de 2 no atrapó al producto', await situacionDe());

  await query(`UPDATE warehouse_stock SET quantity = 10 WHERE product_id=$1 AND warehouse_id=$2`,
    [productId, warehouseId]);
  await situacionDe() === 'bajo'
    ? bien('al tocar el mínimo pasa a "bajo mínimo" — el aviso escala solo')
    : mal('en el mínimo no salió como bajo', await situacionDe());

  await query(`UPDATE warehouse_stock SET quantity = 13 WHERE product_id=$1 AND warehouse_id=$2`,
    [productId, warehouseId]);
  await situacionDe() === '(no aparece)'
    ? bien('con 13 (tres arriba) ya NO aparece: el margen es de dos, no de todo')
    : mal('se coló un producto fuera del margen', await situacionDe());

  await query(`UPDATE warehouse_stock SET quantity = 0 WHERE product_id=$1 AND warehouse_id=$2`,
    [productId, warehouseId]);
  await situacionDe() === 'agotado'
    ? bien('en ceros sale como agotado, que es lo más urgente')
    : mal('el agotado no se detectó', await situacionDe());

  /* Con margen 0 se comporta como antes de este cambio: nada de avisos. */
  await query(`UPDATE warehouse_stock SET quantity = 12 WHERE product_id=$1 AND warehouse_id=$2`,
    [productId, warehouseId]);
  const sinMargen = await listarFaltantes(companyId, 0);
  !sinMargen.some((x: any) => x.product_id === productId)
    ? bien('con margen 0 se comporta como antes: sólo lo que ya está bajo mínimo')
    : mal('el margen 0 siguió avisando');

  await limpiar(companyId);
  console.log(`\n${ok} bien, ${fallos} mal`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
