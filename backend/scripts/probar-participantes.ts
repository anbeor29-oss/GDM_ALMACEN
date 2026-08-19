/**
 * probar-participantes — que una nómina especial alcance sólo a quien se eligió.
 *
 * LO QUE SE ESTÁ PROTEGIENDO
 * Un periodo cerrado ya generó recibos. Si un bono para tres personas alcanza a
 * ochenta y alguien lo cierra, deshacerlo es borrar CFDI. Por eso la lista se
 * guarda con el periodo y no en la pantalla: lo que se elige tiene que seguir
 * ahí cuando otro lo abra mañana.
 *
 * Y la convención al revés importa igual: SIN lista, alcanza a TODOS. Es como
 * se comportaban los especiales antes de que existiera esta tabla, y es lo que
 * debe seguir haciendo el aguinaldo.
 *
 *   npx ts-node -r dotenv/config scripts/probar-participantes.ts
 *
 * Deja la base como la encontró.
 */
import { pool, query } from '../src/config/database';
import * as periodos from '../src/modules/nomina/periodos.service';
import * as prenomina from '../src/modules/nomina/prenomina.service';
import * as cierre from '../src/modules/nomina/cierre.service';

let ok = 0, fallos = 0;
const bien = (q: string) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q: string, d?: any) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };

const NUMS = ['ZP01', 'ZP02', 'ZP03'];
const ANIO = 2026;

async function limpiar(companyId: string) {
  await query(`DELETE FROM nomina_recibos WHERE company_id=$1 AND num_empleado = ANY($2::text[])`,
    [companyId, NUMS]);
  await query(
    `DELETE FROM nomina_periodos
      WHERE company_id=$1 AND anio=$2 AND tipo='ESPECIAL' AND concepto LIKE 'ZZ prueba%'`,
    [companyId, ANIO]);
  await query(`DELETE FROM nomina_empleados WHERE company_id=$1 AND num_empleado = ANY($2::text[])`,
    [companyId, NUMS]);
}

async function main() {
  const c = await query<any>(
    `SELECT id FROM companies WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`
  );
  const companyId = c.rows[0].id;
  await limpiar(companyId);

  const ids: string[] = [];
  for (const [num, nom, rfc, curp] of [
    ['ZP01', 'PABLO',  'PABL900101AB1', 'PABL900101HDFMSM01'],
    ['ZP02', 'QUIQUE', 'QUIQ900202CD2', 'QUIQ900202HDFMSM02'],
    ['ZP03', 'RAMON',  'RAMO900303EF3', 'RAMO900303HDFMSM03'],
  ] as any[]) {
    const r = await query<any>(
      `INSERT INTO nomina_empleados
         (company_id, num_empleado, nombre, apellido_pat, rfc, curp, nss,
          fecha_ingreso, tipo_contrato, tipo_regimen, tipo_jornada,
          periodicidad_pago, tipo_nomina, zona_geografica, regimen_fiscal, uso_cfdi,
          salario_diario, salario_diario_integrado, estado, entidad_federativa, activo)
       VALUES ($1,$2,$3,'PRUEBA',$4,$5,'12345678907','2020-01-15','01','02','01','04','O',
               'general','605','CN01',500,525,'JAL','JAL',true)
       RETURNING id`,
      [companyId, num, nom, rfc, curp]
    );
    ids.push(r.rows[0].id);
  }
  bien('tres trabajadores de prueba');

  /* ── 1. Sin lista: alcanza a todos ── */
  const todos = await periodos.crearEspecial(companyId, {
    anio: ANIO, concepto: 'ZZ prueba aguinaldo',
    fecha_inicio: `${ANIO}-01-01`, fecha_fin: `${ANIO}-12-31`, fecha_pago: `${ANIO}-12-20`,
  });

  const preTodos = await prenomina.calcular(companyId, todos.id, {});
  const mios1 = preTodos.renglones.filter((r: any) => NUMS.includes(r.num_empleado));
  mios1.length === 3
    ? bien('sin lista, el especial alcanza a los tres — como el aguinaldo')
    : mal('un especial sin lista dejó fuera a alguien', mios1.length);

  (await periodos.participantes(companyId, todos.id)).length === 0
    ? bien('sin lista se devuelve vacío, no "todos los ids"')
    : mal('la lista vacía se tradujo a ids');

  /* ── 2. Con lista: alcanza sólo a los elegidos ── */
  const bono = await periodos.crearEspecial(companyId, {
    anio: ANIO, concepto: 'ZZ prueba bono del turno',
    fecha_inicio: `${ANIO}-08-01`, fecha_fin: `${ANIO}-08-31`, fecha_pago: `${ANIO}-08-31`,
    empleadoIds: [ids[0], ids[2]],
  });

  const preBono = await prenomina.calcular(companyId, bono.id, {});
  const nums = preBono.renglones
    .filter((r: any) => NUMS.includes(r.num_empleado))
    .map((r: any) => r.num_empleado).sort();

  nums.length === 2 && nums[0] === 'ZP01' && nums[1] === 'ZP03'
    ? bien('con lista, sólo entran los dos elegidos — el tercero se queda fuera')
    : mal('el especial no respetó la lista', nums.join(','));

  /* Y sobrevive a recargar: la lista vive con el periodo, no en la pantalla. */
  const guardados = await periodos.participantes(companyId, bono.id);
  guardados.length === 2 && guardados.includes(ids[0]) && guardados.includes(ids[2])
    ? bien('la lista se guardó con el periodo: sigue ahí al volver a abrirlo')
    : mal('la lista no se guardó', guardados.length);

  /* ── 3. Cambiarla mientras está abierto ── */
  await periodos.fijarParticipantes(companyId, bono.id, [ids[1]]);
  const preCambiado = await prenomina.calcular(companyId, bono.id, {});
  const nums2 = preCambiado.renglones
    .filter((r: any) => NUMS.includes(r.num_empleado)).map((r: any) => r.num_empleado);
  nums2.length === 1 && nums2[0] === 'ZP02'
    ? bien('cambiar la lista cambia a quién alcanza, sin rastro de la anterior')
    : mal('al cambiar la lista quedaron restos', nums2.join(','));

  /* Vaciarla vuelve a "todos": es la misma convención, no un caso aparte. */
  await periodos.fijarParticipantes(companyId, bono.id, []);
  const preVacio = await prenomina.calcular(companyId, bono.id, {});
  preVacio.renglones.filter((r: any) => NUMS.includes(r.num_empleado)).length === 3
    ? bien('vaciar la lista vuelve a alcanzar a todos')
    : mal('vaciar la lista no restauró la plantilla completa');

  /* ── 4. Cerrado, ya no se toca ── */
  await periodos.fijarParticipantes(companyId, bono.id, [ids[0]]);
  await cierre.cerrarPeriodo(companyId, bono.id, []);

  const recibos = await query<any>(
    `SELECT num_empleado FROM nomina_recibos WHERE periodo_id = $1`, [bono.id]);
  const cerrados = recibos.rows.map((r: any) => r.num_empleado);
  cerrados.length === 1 && cerrados[0] === 'ZP01'
    ? bien('al cerrar se generó UN recibo, el del único participante')
    : mal('el cierre generó recibos de más', cerrados.join(','));

  try {
    await periodos.fijarParticipantes(companyId, bono.id, [ids[0], ids[1]]);
    mal('dejó cambiar la lista de un periodo CERRADO');
  } catch (e: any) {
    /cerrado/.test(e.message)
      ? bien('con el periodo cerrado ya no se puede cambiar: dejaría recibos sin dueño')
      : mal('rechazó con otro mensaje', e.message);
  }

  /* ── 5. Un id ajeno no se cuela ── */
  const otro = await query<any>(
    `SELECT id FROM nomina_empleados WHERE company_id <> $1 LIMIT 1`, [companyId]);
  if (otro.rows.length > 0) {
    const p2 = await periodos.crearEspecial(companyId, {
      anio: ANIO, concepto: 'ZZ prueba ajeno',
      fecha_inicio: `${ANIO}-09-01`, fecha_fin: `${ANIO}-09-30`, fecha_pago: `${ANIO}-09-30`,
      empleadoIds: [ids[0], otro.rows[0].id],
    });
    const g = await periodos.participantes(companyId, p2.id);
    g.length === 1 && g[0] === ids[0]
      ? bien('un id de OTRA empresa no se cuela al periodo, aunque venga en la petición')
      : mal('se guardó un trabajador ajeno', g.length);
  } else {
    bien('(sólo hay una empresa: no se pudo probar el id ajeno)');
  }

  /* ── 6. Los de calendario no llevan lista ── */
  const cal = await query<any>(
    `SELECT id FROM nomina_periodos
      WHERE company_id=$1 AND tipo <> 'ESPECIAL' AND estatus='ABIERTO' LIMIT 1`, [companyId]);
  if (cal.rows.length > 0) {
    try {
      await periodos.fijarParticipantes(companyId, cal.rows[0].id, [ids[0]]);
      mal('dejó ponerle lista a un periodo de calendario');
    } catch (e: any) {
      /especiales/.test(e.message)
        ? bien('a un periodo de calendario no se le pone lista: lo define la periodicidad')
        : mal('rechazó con otro mensaje', e.message);
    }
  }

  await limpiar(companyId);
  console.log(`\n${ok} bien, ${fallos} mal`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
