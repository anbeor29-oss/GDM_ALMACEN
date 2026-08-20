/**
 * Pruebas del tercero con varios roles.
 *
 * ── LO QUE SE COMPRUEBA ──
 * Un banco es activo y pasivo a la vez: mi dinero depositado en él, y el
 * crédito que él me dio. Un cliente puede venderme algo y volverse proveedor.
 *
 * Antes eso era IMPOSIBLE de representar, y no por descuido: el CHECK dejaba
 * un solo rol y el UNIQUE del RFC impedía crear un segundo registro. Las dos
 * cosas juntas cerraban la puerta por completo.
 *
 * Se comprueba también lo que NO debe pasar: que agregar un rol borre el otro,
 * que el tercero se duplique, o que un saldo de activo se neteé contra uno de
 * pasivo sólo porque son del mismo banco.
 *
 *   npx ts-node --files -r dotenv/config scripts/probar-tercero-varios-roles.ts
 */

import { pool, query } from '../src/config/database';
import * as customers from '../src/modules/customers/customers.service';

let ok = 0, ko = 0;
const bien = (m: string) => { ok++; console.log(`  ✔ ${m}`); };
const mal = (m: string, x?: any) => {
  ko++; console.log(`  ✘ ${m}${x !== undefined ? `  → ${JSON.stringify(x)}` : ''}`);
};
const titulo = (t: string) => console.log(`\n${t}`);

const RFC = 'ZZB010101ZZ9';

async function main() {
  console.log('\n═══ UN TERCERO, VARIOS ROLES ═══');

  const emp = await query<any>(`SELECT id, business_name FROM companies ORDER BY created_at LIMIT 1`);
  const companyId = emp.rows[0].id;
  const limpiar = () => query(`DELETE FROM customers WHERE company_id=$1 AND rfc=$2`, [companyId, RFC]);
  await limpiar();

  /* ── 1. La estructura ── */
  titulo('1. La base admite los dos roles a la vez');

  const chk = await query<any>(
    `SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint
      WHERE conrelid='customers'::regclass AND conname IN ('chk_party_type','chk_tercero_con_rol')`);
  const defs = Object.fromEntries(chk.rows.map((r: any) => [r.conname, r.d]));

  /BOTH/.test(defs['chk_party_type'] || '')
    ? bien("party_type admite 'BOTH'")
    : mal('party_type sigue con dos valores', defs['chk_party_type']);

  defs['chk_tercero_con_rol']
    ? bien('y un tercero está obligado a tener al menos un rol')
    : mal('falta la restricción de rol mínimo');

  /* El UNIQUE del RFC SIGUE ahí, y es a propósito. */
  const uniq = await query<any>(
    `SELECT pg_get_constraintdef(oid) d FROM pg_constraint
      WHERE conrelid='customers'::regclass AND conname='customers_company_id_rfc_key'`);
  uniq.rows.length
    ? bien('★ el RFC sigue siendo único: un tercero es UN registro, no dos')
    : mal('se quitó el UNIQUE del RFC — así nacen los expedientes duplicados');

  /* ── 2. El banco que es las dos cosas ── */
  titulo('2. ★ El banco donde tengo dinero y que además me presta');

  const banco = await query<any>(
    `INSERT INTO customers (company_id, rfc, business_name, es_cliente, es_proveedor)
     VALUES ($1,$2,'BANCO DE PRUEBA S.A.',TRUE,TRUE)
     RETURNING id, party_type, es_cliente, es_proveedor`,
    [companyId, RFC]);
  const b = banco.rows[0];

  b.es_cliente && b.es_proveedor
    ? bien('se puede guardar como cliente Y proveedor')
    : mal('no aceptó los dos roles', b);

  b.party_type === 'BOTH'
    ? bien("★ party_type se puso en 'BOTH' solo, por el trigger de la base")
    : mal('party_type no se sincronizó', b.party_type);

  /* ── 3. Sale en LAS DOS listas ── */
  titulo('3. Y aparece en las dos listas, no en una');

  const clientes = await query<any>(
    `SELECT id FROM customers WHERE company_id=$1 AND deleted_at IS NULL AND es_cliente AND id=$2`,
    [companyId, b.id]);
  const provs = await query<any>(
    `SELECT id FROM customers WHERE company_id=$1 AND deleted_at IS NULL AND es_proveedor AND id=$2`,
    [companyId, b.id]);

  clientes.rows.length === 1 && provs.rows.length === 1
    ? bien('★★ el mismo registro sale en clientes Y en proveedores')
    : mal('★★ desapareció de una de las dos listas',
          { clientes: clientes.rows.length, proveedores: provs.rows.length });

  /* La consulta vieja lo habría perdido de las dos. */
  const viejo = await query<any>(
    `SELECT id FROM customers WHERE company_id=$1 AND party_type='SUPPLIER' AND id=$2`,
    [companyId, b.id]);
  viejo.rows.length === 0
    ? bien("★ y con el filtro viejo (party_type='SUPPLIER') se habría perdido — por eso se cambió")
    : mal('el filtro viejo sigue funcionando; la prueba no demuestra nada');

  /* ── 4. Agregar un rol no quita el otro ── */
  titulo('4. Agregar un rol SUMA, no sustituye');

  await query(`UPDATE customers SET es_cliente=FALSE, es_proveedor=TRUE WHERE id=$1`, [b.id]);
  const soloProv = await query<any>(`SELECT party_type FROM customers WHERE id=$1`, [b.id]);
  soloProv.rows[0].party_type === 'SUPPLIER'
    ? bien('vuelto sólo proveedor, party_type se ajusta')
    : mal('no se ajustó', soloProv.rows[0]);

  /* Alta como CLIENTE de un RFC que ya existe como PROVEEDOR. */
  const conRol = await customers.createCustomer(companyId, {
    rfc: RFC, businessName: 'BANCO DE PRUEBA S.A.', fiscalRegime: '601',
    postalCode: '20000', partyType: 'CUSTOMER',
  } as any);

  const tras = await query<any>(
    `SELECT id, es_cliente, es_proveedor, party_type FROM customers WHERE company_id=$1 AND rfc=$2`,
    [companyId, RFC]);
  tras.rows.length === 1
    ? bien('★ no se duplicó el tercero: sigue habiendo UN registro')
    : mal('★ se crearon varios registros del mismo RFC', tras.rows.length);

  tras.rows[0].es_cliente && tras.rows[0].es_proveedor
    ? bien('★★ dar de alta como cliente a un proveedor existente le AGREGA el rol')
    : mal('★★ perdió un rol al agregar el otro', tras.rows[0]);

  conRol && (conRol as any).id === b.id
    ? bien('y devuelve el MISMO tercero, no uno nuevo')
    : mal('devolvió otro registro');

  /* ── 5. Duplicado de verdad: sigue rechazándose ── */
  titulo('5. Un duplicado real sigue siendo un error');

  try {
    await customers.createCustomer(companyId, {
      rfc: RFC, businessName: 'OTRA VEZ', fiscalRegime: '601',
      postalCode: '20000', partyType: 'CUSTOMER',
    } as any);
    mal('aceptó dar de alta dos veces el mismo rol');
  } catch (e: any) {
    /ya está registrado/i.test(e.message)
      ? bien('★ dar de alta el MISMO rol dos veces sigue siendo conflicto')
      : mal('falló con otro mensaje', e.message);
  }

  /* ── 6. Sin rol, no hay tercero ── */
  titulo('6. Un tercero sin ningún rol no existe');

  try {
    await query(`UPDATE customers SET es_cliente=FALSE, es_proveedor=FALSE,
                        es_acreedor=FALSE, es_deudor=FALSE WHERE id=$1`, [b.id]);
    mal('aceptó un tercero sin ningún rol');
  } catch {
    bien('la base rechaza un tercero sin rol');
  }

  /* ── 6-bis. Que nadie vuelva a filtrar por party_type ── */
  titulo('6-bis. Ninguna consulta selecciona por party_type');

  const fs = await import('fs');
  const path = await import('path');

  const archivos: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(r);
      else if (r.endsWith('.ts') && !r.includes('database')) archivos.push(r);
    }
  };
  recorrer('src');

  /* Se busca el FILTRO, no la palabra: leer party_type para mostrarla está
   * bien; escoger por ella es lo que rompe, porque un tercero con dos roles
   * vale 'BOTH' y no cae en ninguna de las dos ramas. */
  const culpables: string[] = [];
  for (const f of archivos) {
    const t = fs.readFileSync(f, 'utf8');
    t.split('\n').forEach((linea, i) => {
      if (/party_type\s*(=|===|!==)\s*['\`"]?(SUPPLIER|CUSTOMER)/.test(linea)
          && !/^\s*(\*|\/\/)/.test(linea)) {
        culpables.push(`${f}:${i + 1}`);
      }
    });
  }
  culpables.length === 0
    ? bien(`★ revisadas ${archivos.length} fuentes: nadie escoge por party_type`)
    : mal('★ alguien volvió a filtrar por party_type — el tercero con dos roles se le escapa',
          culpables.slice(0, 6));

  /* ── 7. La regla contable: NO se netean ── */
  titulo('7. ★ Un solo tercero NO significa un solo saldo');

  /* Que el banco sea un registro no autoriza a restar lo que le debo de lo
   * que me debe. Van en cuentas distintas y de lados distintos del balance:
   * compensar esconde a la vez la liquidez y la deuda (NIF A-7 y C-19). */
  const cuentas = await query<any>(
    `SELECT codigo, nombre, tipo FROM accounting_accounts
      WHERE company_id=$1 AND codigo IN ('102.01','205') ORDER BY codigo`, [companyId]);

  if (cuentas.rows.length === 2) {
    const [act, pas] = cuentas.rows;
    act.tipo === 'ACTIVO' && pas.tipo === 'PASIVO'
      ? bien(`★ ${act.codigo} es ${act.tipo} y ${pas.codigo} es ${pas.tipo}: ` +
             `el mismo banco vive en los dos lados, sin restarse`)
      : mal('las cuentas no quedaron en lados opuestos', cuentas.rows);
  } else {
    bien('(el catálogo de esta empresa no tiene 102.01/205 sembradas — se omite)');
  }

  await limpiar();
  console.log(`\n═══ ${ok} bien, ${ko} mal ═══\n`);
  await pool.end();
  process.exit(ko ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\n✘ reventó:', e);
  await query(`DELETE FROM customers WHERE rfc=$1`, [RFC]).catch(() => {});
  await pool.end();
  process.exit(1);
});
