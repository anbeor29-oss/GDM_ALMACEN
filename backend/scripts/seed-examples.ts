/**
 * seed-examples — carga datos de ejemplo en GDM ALMACÉN para ver el sistema
 * "con vida": 1 almacén, ~14 productos con costo + precio sugerido (+25%) y
 * STOCK inicial real (vía applyMovement → kardex correcto), y ~6 clientes.
 *
 * Se ejecuta LOCAL contra la BD de Render (ts-node existe local; en runtime no):
 *   cd E:\Obsidian\ALMACEN\app\backend
 *   $env:DATABASE_URL="<External Database URL de gdm-almacen-postgres>"
 *   npm run seed:examples            (o:  npm run seed:examples -- <RFC>)
 *
 * Idempotente: omite productos/clientes existentes y no duplica stock.
 */
import { query, closePool } from '../src/config/database';
import { applyMovement } from '../src/modules/inventory/inventory.service';

const rfc = (process.argv.slice(2).find((a) => !a.startsWith('--')) || 'EKU9003173C9').toUpperCase();

// [sku, nombre, claveSat, unidad(clave), unidad(nombre), COSTO de compra, stock, preset]
// El precio de venta se sugiere en costo + 25% (redondeado a 2 decimales).
const PRODUCTS: [string, string, string, string, string, number, number, string][] = [
  ['ABR-001', 'Abrazadera acero inox 1/2"',       '31162800', 'H87', 'Pieza',    9.90,  480, 'iva16'],
  ['TOR-114', 'Tornillo hexagonal 1/4" (100pz)',  '31161500', 'XBX', 'Caja',    72.00,  120, 'iva16'],
  ['CIN-050', 'Cinta aislante 3M 18mm',           '31201600', 'H87', 'Pieza',   22.00,  300, 'iva16'],
  ['PIN-VER', 'Pintura vinílica verde 4L',        '32131700', 'H87', 'Pieza',  249.00,   60, 'iva16'],
  ['CAB-12G', 'Cable THW cal.12 (metro)',         '26121600', 'MTR', 'Metro',   11.50, 1000, 'iva16'],
  ['FOC-LED', 'Foco LED 9W luz cálida',           '39101600', 'H87', 'Pieza',   28.00,  400, 'iva16'],
  ['GUA-NIT', 'Guantes de nitrilo (caja 100)',    '46181700', 'XBX', 'Caja',   119.00,   85, 'iva16'],
  ['MAR-16O', 'Martillo uña 16 oz',               '27111700', 'H87', 'Pieza',  149.00,   40, 'iva16'],
  ['DES-PH2', 'Desarmador Phillips #2',           '27112100', 'H87', 'Pieza',   39.00,  150, 'iva16'],
  ['SIL-ACR', 'Silicón acrílico blanco',          '31201500', 'H87', 'Pieza',   34.00,  200, 'iva16'],
  ['LIJ-120', 'Lija de agua grano 120',           '31191500', 'H87', 'Pieza',    5.90,  600, 'iva16'],
  ['BRO-1-4', 'Broca para concreto 1/4"',         '27112800', 'H87', 'Pieza',   18.50,  220, 'iva16'],
  ['CAF-500', 'Café molido 500g',                 '50201706', 'H87', 'Pieza',   85.00,   90, 'iva16'],
  ['AGU-1LT', 'Agua purificada 1L',               '50202301', 'H87', 'Pieza',    7.00,  500, 'iva0'],
];

// [rfc, razón social, régimen, uso CFDI, cp]
const CUSTOMERS: [string, string, string, string, string][] = [
  ['XAXX010101000', 'PÚBLICO EN GENERAL',                         '616', 'S01', '20000'],
  ['CACX7605101P8', 'MARIA FERNANDA CASTRO XOLO',                 '612', 'G03', '20126'],
  ['GHC1707275Y0',  'GRUPO HCGM',                                 '601', 'G03', '20000'],
  ['SAJ161022FW9',  'SERVICIOS ADMINISTRATIVOS JOCARMI SA DE CV', '601', 'G03', '20240'],
  ['BEOA730829LJ0', 'ANTONIO BERNAL ORNELAS',                     '612', 'G03', '20126'],
  ['FEMX901201AB2', 'FERRETERÍA EL MARTILLO SA DE CV',            '601', 'G01', '20180'],
];

const suggestedPrice = (cost: number) => Math.round(cost * 1.25 * 100) / 100;

async function main() {
  const compR = await query<{ id: string; business_name: string }>(
    'SELECT id, business_name FROM companies WHERE rfc = $1', [rfc]
  );
  if (compR.rows.length === 0) { console.error(`❌ No existe empresa ${rfc}`); process.exit(1); }
  const companyId = compR.rows[0].id;
  console.log(`📦 Sembrando GDM ALMACÉN en ${compR.rows[0].business_name} (${rfc})`);

  // 1) Almacén por defecto (idempotente)
  const whR = await query<{ id: string }>(
    `INSERT INTO warehouses (company_id, code, name, is_default)
     VALUES ($1, 'GEN', 'Almacén General', true)
     ON CONFLICT (company_id, code) DO UPDATE SET is_default = true, deleted_at = NULL
     RETURNING id`,
    [companyId]
  );
  const warehouseId = whR.rows[0].id;
  console.log(`🏬 Almacén General listo.`);

  // 2) Productos + stock inicial (vía applyMovement = kardex correcto)
  let added = 0, stocked = 0;
  for (const [sku, name, clave, unit, unitName, cost, stock, preset] of PRODUCTS) {
    const rate = preset === 'iva0' ? 0 : 0.16;
    const price = suggestedPrice(cost);
    let productId: string;
    const dup = await query<{ id: string }>(
      'SELECT id FROM products WHERE company_id=$1 AND sku=$2 AND deleted_at IS NULL', [companyId, sku]
    );
    if (dup.rows.length) {
      productId = dup.rows[0].id;
    } else {
      const ins = await query<{ id: string }>(
        `INSERT INTO products
           (company_id, sku, name, clave_sat, unit_code, unit_name, base_price,
            tax_type, tax_rate, is_exempt, stock_quantity, stock_minimum, last_cost,
            currency, tax_preset_id, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'IVA',$8,false,0,10,$9,'MXN',$10,true)
         RETURNING id`,
        [companyId, sku, name, clave, unit, unitName, price, rate, cost, preset]
      );
      productId = ins.rows[0].id;
      added++;
    }

    // Stock inicial sólo si el almacén aún no tiene existencia de este producto.
    const stR = await query<{ quantity: string }>(
      'SELECT quantity FROM warehouse_stock WHERE warehouse_id=$1 AND product_id=$2', [warehouseId, productId]
    );
    const cur = stR.rows.length ? Number(stR.rows[0].quantity) : 0;
    if (cur <= 0 && stock > 0) {
      await applyMovement({
        companyId, productId, movementType: 'INITIAL',
        quantity: stock, unitCost: cost, warehouseToId: warehouseId,
        reason: 'Carga inicial de inventario (seed de ejemplos)',
        userEmail: 'seed@gdmalmacen.mx',
      });
      stocked++;
    }
  }

  // 3) Clientes (idempotente por RFC)
  let cAdded = 0;
  for (const [crfc, bn, regime, uso, cp] of CUSTOMERS) {
    const dup = await query('SELECT id FROM customers WHERE company_id=$1 AND rfc=$2 AND deleted_at IS NULL', [companyId, crfc]);
    if ((dup.rowCount ?? 0) > 0) continue;
    await query(
      `INSERT INTO customers (company_id, rfc, business_name, fiscal_regime, default_cfdi_use, postal_code, party_type, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,'CUSTOMER',true)`,
      [companyId, crfc, bn, regime, uso, cp]
    );
    cAdded++;
  }

  console.log(`✅ Listo: ${added} productos nuevos, stock inicial en ${stocked}, ${cAdded} clientes. (Precio de venta = costo + 25%.)`);
  await closePool();
  process.exit(0);
}

main().catch((e) => { console.error('❌ Error:', e.message); process.exit(1); });
