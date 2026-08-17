/**
 * probar-nomina — verificación del expediente contra una base REAL.
 *
 * Las pruebas unitarias (npm test) cubren lo que es función pura. Esto cubre lo
 * otro: que los CHECK de la migración existan de verdad, que el índice único
 * pegue, que el candado de edición concurrente devuelva 409 y que un RFC mal
 * escrito no entre. Nada de eso se puede comprobar sin Postgres enfrente.
 *
 *   npx ts-node -r dotenv/config scripts/probar-nomina.ts
 *
 * Deja la base como la encontró: todo lo que crea, lo borra al final.
 */
import { pool, query } from '../src/config/database';
import * as empleados from '../src/modules/nomina/empleados.service';
import * as parametros from '../src/modules/nomina/parametros.service';

let ok = 0;
let fallos = 0;

function bien(que: string) { ok++; console.log(`  ✔ ${que}`); }
function mal(que: string, detalle?: any) {
  fallos++;
  console.log(`  ✘ ${que}${detalle ? ` — ${detalle}` : ''}`);
}

/** Espera que la promesa truene, y que el mensaje diga algo reconocible. */
async function debeFallar(que: string, fn: () => Promise<any>, conTexto: RegExp) {
  try {
    await fn();
    mal(`${que} (no falló y debía)`);
  } catch (e: any) {
    if (conTexto.test(e?.message || '')) bien(que);
    else mal(que, `falló con otro mensaje: ${e?.message}`);
  }
}

async function main() {
  const c = await query<any>(
    `SELECT id, rfc FROM companies WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`
  );
  if (c.rows.length === 0) {
    console.error('No hay ninguna empresa en la base. Corre el seed antes.');
    process.exit(1);
  }
  const companyId = c.rows[0].id;
  console.log(`\nEmpresa de prueba: ${c.rows[0].rfc}\n`);

  const creados: string[] = [];

  /* ── Alta válida ── */
  console.log('Alta del expediente');
  let e: any;
  try {
    e = await empleados.crear(companyId, {
      num_empleado: 'ZZTEST01',
      nombre: 'JUAN',
      apellido_pat: 'PEREZ',
      apellido_mat: 'LOPEZ',
      rfc: 'PELJ800101ABC',
      curp: 'PELJ800101HDFRPN00',
      nss: '12345678901',
      fecha_ingreso: '2020-01-15',
      salario_diario: 500,
      salario_diario_integrado: 527.4,
    });
    creados.push(e.id);
    bien('se dio de alta con los datos mínimos');
  } catch (err: any) {
    mal('alta mínima', err.message);
    await limpiar(creados);
    return resumen();
  }

  /* ── Lo que falta para timbrar se reporta, pero no bloquea el alta ── */
  if (e.faltantes.includes('código postal fiscal') &&
      e.faltantes.includes('entidad federativa donde presta el servicio')) {
    bien('reporta lo que falta para timbrar sin bloquear el alta');
  } else {
    mal('faltantes para timbrar', JSON.stringify(e.faltantes));
  }

  /* ── Duplicados ── */
  console.log('\nDuplicados');
  await debeFallar(
    'rechaza el mismo número de empleado',
    () => empleados.crear(companyId, {
      num_empleado: 'zztest01', // distinta caja: el índice normaliza
      nombre: 'OTRO', apellido_pat: 'DISTINTO',
      rfc: 'XAXX010101000', curp: 'XAXX010101HDFRPN01',
      fecha_ingreso: '2021-01-01', salario_diario: 300,
    }),
    /ya lo tiene/i
  );
  await debeFallar(
    'rechaza el mismo RFC',
    () => empleados.crear(companyId, {
      num_empleado: 'ZZTEST02',
      nombre: 'OTRO', apellido_pat: 'DISTINTO',
      rfc: 'PELJ800101ABC', curp: 'XAXX010101HDFRPN01',
      fecha_ingreso: '2021-01-01', salario_diario: 300,
    }),
    /ya está dado de alta/i
  );

  /* ── Validación de formato ── */
  console.log('\nFormato de los datos fiscales');
  await debeFallar(
    'rechaza un RFC de persona moral (12 posiciones)',
    () => empleados.crear(companyId, {
      num_empleado: 'ZZTEST03', nombre: 'X', apellido_pat: 'Y',
      rfc: 'GHC1707275Y0', curp: 'XAXX010101HDFRPN01',
      fecha_ingreso: '2021-01-01', salario_diario: 300,
    }),
    /persona física/i
  );
  await debeFallar(
    'rechaza una CURP incompleta',
    () => empleados.crear(companyId, {
      num_empleado: 'ZZTEST04', nombre: 'X', apellido_pat: 'Y',
      rfc: 'XAXX010101000', curp: 'XAXX0101',
      fecha_ingreso: '2021-01-01', salario_diario: 300,
    }),
    /CURP/i
  );
  await debeFallar(
    'rechaza un NSS que no trae 11 dígitos',
    () => empleados.actualizar(companyId, e.id, { nss: '123' }),
    /11 dígitos/i
  );
  await debeFallar(
    'rechaza una clave de contrato que no está en el catálogo del SAT',
    () => empleados.actualizar(companyId, e.id, { tipo_contrato: '77' }),
    /catálogo del SAT/i
  );
  await debeFallar(
    'no deja marcar INFONAVIT sin decir cómo se descuenta',
    () => empleados.actualizar(companyId, e.id, { tiene_infonavit: true }),
    /forma del descuento/i
  );

  /* ── Candado de edición concurrente ── */
  console.log('\nEdición concurrente');
  const antes = await empleados.obtener(companyId, e.id);
  await empleados.actualizar(companyId, e.id, {
    edicion: antes.edicion, departamento: 'PRODUCCION',
  });
  bien('guarda con el número de edición correcto');
  await debeFallar(
    'rechaza el guardado de quien traía la versión vieja',
    () => empleados.actualizar(companyId, e.id, {
      edicion: antes.edicion, departamento: 'ALMACEN',
    }),
    /Alguien más guardó|conflicto/i
  );

  /* ── Baja y reingreso ── */
  console.log('\nBaja y reingreso');
  await debeFallar(
    'no acepta una baja anterior al ingreso',
    () => empleados.darDeBaja(companyId, e.id, '2019-01-01'),
    /anterior a su ingreso|no se pudo/i
  );
  await empleados.darDeBaja(companyId, e.id, '2026-08-15');
  const dado = await empleados.obtener(companyId, e.id);
  if (dado.activo === false && dado.fecha_baja === '2026-08-15') {
    bien('la baja marca la fecha y NO borra el expediente');
  } else {
    mal('baja', JSON.stringify({ activo: dado.activo, fecha: dado.fecha_baja }));
  }
  await empleados.reingresar(companyId, e.id, '2026-08-17');
  const vuelto = await empleados.obtener(companyId, e.id);
  if (vuelto.activo === true && vuelto.fecha_baja === null) bien('el reingreso lo devuelve a la plantilla');
  else mal('reingreso');

  /* ── Aislamiento entre empresas ── */
  console.log('\nAislamiento entre empresas');
  const otra = await query<any>(
    `SELECT id FROM companies WHERE id <> $1 AND deleted_at IS NULL LIMIT 1`, [companyId]
  );
  if (otra.rows.length === 0) {
    console.log('  · sólo hay una empresa en la base, no se puede probar');
  } else {
    try {
      await empleados.obtener(otra.rows[0].id, e.id);
      mal('¡una empresa alcanzó el expediente de otra!');
    } catch {
      bien('una empresa no alcanza el expediente de otra');
    }
  }

  /* ── Parámetros patronales ── */
  console.log('\nParámetros patronales');
  await debeFallar(
    'rechaza una prima de riesgo fuera del rango legal',
    () => parametros.actualizar(companyId, { prima_riesgo: 0.0054355 }),
    /rango legal/i
  );
  await debeFallar(
    'no deja poner menos de 15 días de aguinaldo',
    () => parametros.actualizar(companyId, { fi_aguinaldo_dias: 10 }),
    /Art\. 87/i
  );
  await debeFallar(
    'no deja poner menos del 25 % de prima vacacional',
    () => parametros.actualizar(companyId, { fi_prima_vac_pct: 10 }),
    /Art\. 80/i
  );
  await debeFallar(
    'rechaza un registro patronal que no tiene 11 posiciones',
    () => parametros.actualizar(companyId, { registro_patronal: 'ABC' }),
    /11 posiciones/i
  );

  await limpiar(creados);
  resumen();
}

async function limpiar(ids: string[]) {
  for (const id of ids) {
    await query(`DELETE FROM nomina_empleados WHERE id = $1`, [id]);
  }
  console.log(`\n(se borraron ${ids.length} expediente(s) de prueba)`);
}

function resumen() {
  console.log(`\n${ok} bien, ${fallos} mal\n`);
  process.exit(fallos > 0 ? 1 : 0);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => pool.end());
