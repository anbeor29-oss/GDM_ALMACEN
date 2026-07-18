/**
 * example-data — fuente ÚNICA de los datos de ejemplo (productos y clientes) y
 * la función seedExamples() que los inserta. JS plano a propósito: lo usan tanto
 * el CLI (seed-examples.js) como el bootstrap del deploy (bootstrap-env.js), y
 * deben correr en el runtime de Render, donde NO hay devDeps (ni ts-node).
 *
 * Idempotente: omite productos/clientes que ya existen (por SKU / RFC).
 */

// [sku, nombre, claveSat, unidad(clave), unidad(nombre), menudeo, mayoreo, stock, preset]
const PRODUCTS = [
  ['ABR-001', 'Abrazadera acero inox 1/2"',       '31162800', 'H87', 'Pieza',   12.50,   9.90,  480, 'iva16'],
  ['TOR-114', 'Tornillo hexagonal 1/4" (100pz)',  '31161500', 'XBX', 'Caja',    89.00,  72.00,  120, 'iva16'],
  ['CIN-050', 'Cinta aislante 3M 18mm',           '31201600', 'H87', 'Pieza',   28.00,  22.00,  300, 'iva16'],
  ['PIN-VER', 'Pintura vinílica verde 4L',        '32131700', 'H87', 'Pieza',  289.00, 249.00,   60, 'iva16'],
  ['CAB-12G', 'Cable THW cal.12 (metro)',         '26121600', 'MTR', 'Metro',   14.90,  11.50, 1000, 'iva16'],
  ['FOC-LED', 'Foco LED 9W luz cálida',           '39101600', 'H87', 'Pieza',   35.00,  28.00,  400, 'iva16'],
  ['GUA-NIT', 'Guantes de nitrilo (caja 100)',    '46181700', 'XBX', 'Caja',   145.00, 119.00,   85, 'iva16'],
  ['MAR-16O', 'Martillo uña 16 oz',               '27111700', 'H87', 'Pieza',  169.00, 149.00,   40, 'iva16'],
  ['DES-PH2', 'Desarmador Phillips #2',           '27112100', 'H87', 'Pieza',   49.00,  39.00,  150, 'iva16'],
  ['SIL-ACR', 'Silicón acrílico blanco',          '31201500', 'H87', 'Pieza',   42.00,  34.00,  200, 'iva16'],
  ['LIJ-120', 'Lija de agua grano 120',           '31191500', 'H87', 'Pieza',    8.00,   5.90,  600, 'iva16'],
  ['BRO-1-4', 'Broca para concreto 1/4"',         '27112800', 'H87', 'Pieza',   24.00,  18.50,  220, 'iva16'],
  ['CAN-PVC', 'Canaleta PVC 20x10 (tramo 2m)',    '30264200', 'H87', 'Pieza',   36.00,  29.00,  180, 'iva16'],
  ['AGU-1LT', 'Agua purificada 1L',               '50202301', 'H87', 'Pieza',    9.00,   7.00,  500, 'iva0'],
  ['CAF-500', 'Café molido 500g',                 '50201706', 'H87', 'Pieza',   98.00,  85.00,   90, 'iva16'],
  ['LIB-CUA', 'Libreta profesional 100 hojas',    '44121700', 'H87', 'Pieza',   28.00,  22.00,  260, 'iva16'],
];

// [rfc, razón social, régimen, uso CFDI, cp, email]
const CUSTOMERS = [
  ['XAXX010101000', 'PÚBLICO EN GENERAL',                         '616', 'S01', '20000', ''],
  ['CACX7605101P8', 'MARIA FERNANDA CASTRO XOLO',                 '612', 'G03', '20126', 'mfcastro@example.mx'],
  ['GHC1707275Y0',  'GRUPO HCGM',                                 '601', 'G03', '20000', 'compras@hcgm.com.mx'],
  ['SAJ161022FW9',  'SERVICIOS ADMINISTRATIVOS JOCARMI SA DE CV', '601', 'G03', '20240', 'pagos@jocarmi.mx'],
  ['BEOA730829LJ0', 'ANTONIO BERNAL ORNELAS',                     '612', 'G03', '20126', 'abernal@example.mx'],
  ['FEMX901201AB2', 'FERRETERÍA EL MARTILLO SA DE CV',            '601', 'G01', '20180', 'ventas@elmartillo.mx'],
];

/**
 * Inserta productos y clientes de ejemplo en la empresa dada. Idempotente.
 * @param {{ query: Function }} db  Pool o client de pg (o cualquier cosa con .query).
 * @param {string} companyId
 * @returns {Promise<{ products: number, customers: number }>}
 */
async function seedExamples(db, companyId) {
  let products = 0;
  for (const [sku, name, clave, unit, unitName, retail, wholesale, stock, preset] of PRODUCTS) {
    const dup = await db.query(
      `SELECT 1 FROM products WHERE company_id=$1 AND sku=$2 AND deleted_at IS NULL`,
      [companyId, sku]
    );
    if (dup.rowCount) continue;
    const rate = preset === 'iva0' ? 0 : 0.16;
    await db.query(
      `INSERT INTO products
         (company_id, sku, name, clave_sat, unit_code, unit_name, base_price,
          wholesale_price, tax_type, tax_rate, is_exempt, stock_quantity, stock_minimum,
          tax_preset_id, currency, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'IVA',$9,false,$10,10,$11,'MXN',true)`,
      [companyId, sku, name, clave, unit, unitName, retail, wholesale, rate, stock, preset]
    );
    products++;
  }

  let customers = 0;
  for (const [crfc, bn, regime, uso, cp, email] of CUSTOMERS) {
    const dup = await db.query(
      `SELECT 1 FROM customers WHERE company_id=$1 AND rfc=$2 AND deleted_at IS NULL`,
      [companyId, crfc]
    );
    if (dup.rowCount) continue;
    await db.query(
      `INSERT INTO customers (company_id, rfc, business_name, fiscal_regime, default_cfdi_use, postal_code, email, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
      [companyId, crfc, bn, regime, uso, cp, email || null]
    );
    customers++;
  }

  return { products, customers };
}

module.exports = { PRODUCTS, CUSTOMERS, seedExamples };
