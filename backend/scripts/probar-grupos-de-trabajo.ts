/**
 * probar-grupos-de-trabajo — que cada grupo VEA lo suyo y PUEDA hacerlo.
 *
 * LOS DOS ERRORES QUE ESTO ATRAPA, Y SON DISTINTOS
 *
 *   VER DE MÁS. Un grupo que alcanza un módulo que no le toca. Es el que se
 *   revisa siempre, porque es el que suena a "seguridad".
 *
 *   VER SIN PODER. Un grupo que abre la pantalla y no puede hacer nada en
 *   ella. Nadie lo llama falla de permisos —parece que "el sistema no sirve"—
 *   y es el que de verdad se sufre: el de tesorería veía sus pagos y no podía
 *   programar uno solo.
 *
 * Y el tercero, más tonto y más caro: un grupo que existe en el mapa pero que
 * el alta de usuarios rechaza. El combo lo ofrece, el usuario lo elige y el
 * servidor dice "workGroup inválido".
 *
 *   npx ts-node -r dotenv/config scripts/probar-grupos-de-trabajo.ts
 *
 * No toca la base salvo por un usuario de prueba, que borra al terminar.
 */
import { pool, query } from '../src/config/database';
import { GROUP_MODULES, groupCanAccess, WorkGroup } from '../src/middleware/permissions';
import { GROUP_CAPABILITIES, userHasCapability, getEffectiveCapabilities } from '../src/modules/auth/capabilities';

let ok = 0, fallos = 0;
const bien = (q: string) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q: string, d?: any) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };

const EMAIL = 'zz-prueba-grupos@zz.mx';

async function main() {
  /* ── 1. Los siete grupos existen en las TRES listas ── */
  const grupos = Object.keys(GROUP_MODULES) as WorkGroup[];
  grupos.length === 7
    ? bien(`siete grupos en el mapa: ${grupos.join(', ')}`)
    : mal('el mapa no tiene los siete grupos', grupos.join(','));

  const chk = await query<any>(
    `SELECT pg_get_constraintdef(oid) d FROM pg_constraint
      WHERE conrelid='users'::regclass AND conname='chk_users_work_group'`);
  const def = chk.rows[0]?.d || '';
  const faltanEnLaBase = grupos.filter((g) => !def.includes(g));
  faltanEnLaBase.length === 0
    ? bien('los siete los acepta el CHECK de users.work_group')
    : mal('la base rechazaría estos grupos', faltanEnLaBase.join(','));

  /* La lista de validación del alta se DERIVA del mapa, así que no puede
   * quedarse corta. Se comprueba que siga derivándose y no vuelva a escribirse
   * a mano: fue exactamente lo que rompió "Recursos Humanos". */
  const rutas = await import('fs').then((fs) =>
    fs.readFileSync('src/modules/admin/admin-users.routes.ts', 'utf8'));
  rutas.includes('Object.keys(GROUP_MODULES)')
    ? bien('el alta de usuarios deriva sus grupos válidos del mapa, no de una lista a mano')
    : mal('VALID_WORK_GROUPS volvió a ser una lista escrita a mano');

  /* ── 2. Lo que cada grupo NO debe ver ── */
  const NO_DEBE: Array<[WorkGroup, string[]]> = [
    ['COMPRAS',          ['inventory', 'treasury', 'nomina', 'invoices', 'pos']],
    ['TESORERIA',        ['auditoria', 'inventory', 'nomina', 'invoices', 'pos']],
    ['PUNTO_VENTA',      ['invoices', 'customers', 'treasury', 'nomina', 'purchasing']],
    ['RECURSOS_HUMANOS', ['invoices', 'customers', 'inventory', 'treasury', 'purchasing', 'pos']],
    ['ALMACEN',          ['invoices', 'treasury', 'nomina', 'purchasing']],
    ['VENTAS',           ['nomina', 'treasury', 'purchasing', 'inventory']],
  ];
  for (const [g, modulos] of NO_DEBE) {
    const colados = modulos.filter((m) => groupCanAccess(g, m as any));
    colados.length === 0
      ? bien(`${g}: no alcanza ${modulos.join(', ')}`)
      : mal(`${g} ve módulos que no le tocan`, colados.join(','));
  }

  /* ── 3. Lo que cada grupo SÍ debe ver ── */
  const SI_DEBE: Array<[WorkGroup, string[]]> = [
    ['COMPRAS',          ['purchasing', 'suppliers', 'products']],
    ['TESORERIA',        ['treasury', 'suppliers']],
    ['PUNTO_VENTA',      ['pos']],
    ['RECURSOS_HUMANOS', ['nomina']],
  ];
  for (const [g, modulos] of SI_DEBE) {
    const faltantes = modulos.filter((m) => !groupCanAccess(g, m as any));
    faltantes.length === 0
      ? bien(`${g}: alcanza ${modulos.join(', ')}`)
      : mal(`a ${g} le falta su propio módulo`, faltantes.join(','));
  }

  /* Nómina, cerrada a dos grupos. Es el dato más sensible del sistema: sueldos,
   * CURP, cuentas bancarias y órdenes de pensión alimenticia. */
  const conNomina = grupos.filter((g) => groupCanAccess(g, 'nomina'));
  conNomina.length === 2 && conNomina.includes('ADMIN_ALL') &&
  conNomina.includes('RECURSOS_HUMANOS')
    ? bien('a nómina sólo llegan ADMIN_ALL y RECURSOS_HUMANOS')
    : mal('nómina quedó abierta a más grupos', conNomina.join(','));

  /* ── 4. VER SIN PODER: el error que no suena a permisos ── */
  const emp = await query<any>(
    `SELECT id FROM companies WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`);
  await query(`DELETE FROM users WHERE email = $1`, [EMAIL]);

  const u = await query<any>(
    `INSERT INTO users (email, password_hash, first_name, last_name, role, company_id, work_group)
     VALUES ($1,'x','ZZ','Prueba','USER',$2,'TESORERIA') RETURNING id`,
    [EMAIL, emp.rows[0].id]);
  const userId = u.rows[0].id;

  await userHasCapability(userId, 'USER', 'treasury:pay')
    ? bien('TESORERIA puede programar pagos — era lo que NO se podía hacer')
    : mal('un usuario de tesorería sigue sin poder programar pagos');

  !(await userHasCapability(userId, 'USER', 'purchasing:approve'))
    ? bien('y NO puede aprobar compras: cada grupo trae lo suyo y nada más')
    : mal('tesorería alcanzó una capacidad que no le toca');

  const efectivas = await getEffectiveCapabilities(userId, 'USER');
  efectivas.includes('treasury:pay')
    ? bien(`sus capacidades efectivas la incluyen (${efectivas.length} en total)`)
    : mal('la capacidad no aparece en el conjunto efectivo', efectivas.join(','));

  /* El cajero, el mismo caso. */
  await query(`UPDATE users SET work_group = 'PUNTO_VENTA' WHERE id = $1`, [userId]);
  await userHasCapability(userId, 'USER', 'pos:sell')
    ? bien('PUNTO_VENTA puede cobrar en la caja')
    : mal('el cajero no puede vender');

  !(await userHasCapability(userId, 'USER', 'treasury:pay'))
    ? bien('y el cajero NO puede pagar proveedores')
    : mal('el cajero alcanzó los pagos');

  /* Cambiar de grupo surte efecto de inmediato: se lee de la base, no del
   * token. Si viniera del JWT, el cambio esperaría a que expire la sesión. */
  await query(`UPDATE users SET work_group = 'ALMACEN' WHERE id = $1`, [userId]);
  await userHasCapability(userId, 'USER', 'inventory:adjust')
    ? bien('cambiar de grupo cambia lo que puede hacer, sin volver a entrar')
    : mal('el cambio de grupo no surtió efecto');

  /* Un otorgamiento individual SE SUMA al grupo, no lo reemplaza. */
  await query(
    `INSERT INTO user_capabilities (user_id, capability) VALUES ($1,'purchasing:approve')
     ON CONFLICT DO NOTHING`, [userId]);
  const conAmbas = await userHasCapability(userId, 'USER', 'purchasing:approve') &&
                   await userHasCapability(userId, 'USER', 'inventory:adjust');
  conAmbas
    ? bien('lo otorgado a mano se SUMA al grupo: se conservan las dos')
    : mal('el otorgamiento individual pisó las del grupo');

  /* ── 5. Cada grupo tiene capacidades declaradas ──
   * Un grupo sin capacidades es una pantalla que se abre y no hace nada. */
  const sinCaps = grupos.filter((g) => !(GROUP_CAPABILITIES[g]?.length));
  sinCaps.length === 0
    ? bien('los siete grupos declaran qué pueden hacer, no sólo qué ven')
    : mal('hay grupos que ven pantallas sin poder usarlas', sinCaps.join(','));

  await query(`DELETE FROM user_capabilities WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM users WHERE id = $1`, [userId]);

  console.log(`\n${ok} bien, ${fallos} mal`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
