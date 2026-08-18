/**
 * probar-captura-y-timbre — que lo tecleado no se pierda, y que timbrar no se
 * haga dos veces.
 *
 * Son los dos errores que más caro salen en esta pantalla:
 *   · perder media hora de captura por cambiar de menú
 *   · timbrar dos veces el mismo recibo, que sólo se arregla cancelando ante
 *     el SAT
 *
 *   npx ts-node -r dotenv/config scripts/probar-captura-y-timbre.ts
 *
 * Deja la base como la encontró.
 */
import { pool, query } from '../src/config/database';
import * as prenomina from '../src/modules/nomina/prenomina.service';
import * as cierre from '../src/modules/nomina/cierre.service';
import { generarListaDeRaya } from '../src/modules/nomina/lista-de-raya.service';
import * as XLSX from 'xlsx';

let ok = 0, fallos = 0;
const bien = (q: string) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q: string, d?: any) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };
const cerca = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;

const NUMS = ['ZZ60', 'ZZ61', 'ZZ62'];

async function limpiar(companyId: string) {
  await query(`DELETE FROM nomina_recibos WHERE company_id=$1 AND num_empleado = ANY($2::text[])`,
    [companyId, NUMS]);
  await query(`DELETE FROM nomina_captura WHERE company_id=$1 AND empleado_id IN (
      SELECT id FROM nomina_empleados WHERE company_id=$1 AND num_empleado = ANY($2::text[]))`,
    [companyId, NUMS]);
  await query(`DELETE FROM nomina_empleados WHERE company_id=$1 AND num_empleado = ANY($2::text[])`,
    [companyId, NUMS]);
  await query(
    `DELETE FROM nomina_periodos WHERE company_id=$1 AND anio=2026 AND tipo='SEMANAL' AND numero=53`,
    [companyId]);
}

async function main() {
  const c = await query<any>(
    `SELECT id, registro_patronal FROM companies WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`
  );
  const companyId = c.rows[0].id;
  const rpPrevio = c.rows[0].registro_patronal;
  if (!rpPrevio) {
    await query(`UPDATE companies SET registro_patronal='Z1234567890' WHERE id=$1`, [companyId]);
  }
  await limpiar(companyId);

  /* Tres trabajadores: con uno no se nota si el masivo aplica a todos. */
  const ids: string[] = [];
  const gente = [
    ['ZZ60', 'IVAN',  'NAVA',   'NAIV900404AB5', 'NAIV900404HDFVVN05'],
    ['ZZ61', 'SARA',  'PEREZ',  'PESA900505CD6', 'PESA900505MDFRRR06'],
    ['ZZ62', 'OMAR',  'CRUZ',   'CROM900606EF7', 'CROM900606HDFRMR07'],
  ];
  for (const [num, nom, pat, rfc, curp] of gente) {
    const r = await query<any>(
      `INSERT INTO nomina_empleados
         (company_id, num_empleado, nombre, apellido_pat, rfc, curp, nss,
          fecha_ingreso, tipo_contrato, tipo_regimen, tipo_jornada,
          periodicidad_pago, tipo_nomina, zona_geografica, regimen_fiscal, uso_cfdi,
          salario_diario, salario_diario_integrado, estado, entidad_federativa, activo)
       VALUES ($1,$2,$3,$4,$5,$6,'12345678905','2023-01-10','01','02','01','02','O',
               'general','605','CN01', 500, 525,'JAL','JAL',true)
       RETURNING id`,
      [companyId, num, nom, pat, rfc, curp]
    );
    ids.push(r.rows[0].id);
  }

  const per = await query<any>(
    `INSERT INTO nomina_periodos
       (company_id, anio, tipo, numero, fecha_inicio, fecha_fin, fecha_pago, dias, estatus)
     VALUES ($1,2026,'SEMANAL',53,'2026-12-28','2027-01-03','2027-01-03',7,'ABIERTO')
     RETURNING id`, [companyId]
  );
  const periodoId = per.rows[0].id;
  bien('tres trabajadores y un periodo semanal de prueba');

  /* ── 1. La captura se guarda y sobrevive ── */
  await prenomina.guardarCaptura(companyId, periodoId, [
    { empleadoId: ids[0], otrosIngresos: [{ clave: '019', importe: 800 }], otrasDeducciones: [] },
  ] as any);

  /* Se calcula SIN mandar captura: es lo que pasa al volver a entrar. */
  const pre1 = await prenomina.calcular(companyId, periodoId);
  const ivan: any = pre1.renglones.find((r: any) => r.num_empleado === 'ZZ60');
  cerca(ivan.otrosIngresos, 800)
    ? bien('al volver a abrir la pantalla, los $800 de horas extra siguen ahí')
    : mal('la captura se perdió al recalcular sin mandarla', ivan.otrosIngresos);

  /* ── 2. Guardar dos veces no duplica ── */
  await prenomina.guardarCaptura(companyId, periodoId, [
    { empleadoId: ids[0], otrosIngresos: [{ clave: '019', importe: 800 }], otrasDeducciones: [] },
  ] as any);
  const filas = await query<any>(
    `SELECT COUNT(*)::int n FROM nomina_captura WHERE periodo_id=$1 AND empleado_id=$2`,
    [periodoId, ids[0]]
  );
  filas.rows[0].n === 1
    ? bien('guardar dos veces deja UNA fila, no dos')
    : mal('la captura se duplicó', filas.rows[0].n);

  /* ── 3. Borrar los conceptos borra la captura ── */
  await prenomina.guardarCaptura(companyId, periodoId, [
    { empleadoId: ids[0], otrosIngresos: [], otrasDeducciones: [] },
  ] as any);
  const vacias = await query<any>(
    `SELECT COUNT(*)::int n FROM nomina_captura WHERE periodo_id=$1 AND empleado_id=$2`,
    [periodoId, ids[0]]
  );
  vacias.rows[0].n === 0
    ? bien('quitar todos los conceptos borra la fila en vez de dejarla vacía')
    : mal('quedó una captura vacía');

  /* ── 3b. Capturar a UNO no borra a los demás ──
   *
   * Es el bug que reportó el usuario. La pantalla manda en el POST sólo al
   * trabajador que se acaba de teclear —si abro el diálogo de IVAN, va IVAN y
   * nadie más—, y el servidor prefería esa lista sobre la guardada: los otros
   * cuarenta y nueve desaparecían de la rejilla y, al cerrar, sus recibos se
   * congelaban sin conceptos. */
  await prenomina.guardarCaptura(companyId, periodoId, [
    { empleadoId: ids[0], otrosIngresos: [{ clave: '019', importe: 700 }], otrasDeducciones: [] },
    { empleadoId: ids[2], otrosIngresos: [{ clave: '019', importe: 900 }], otrasDeducciones: [] },
  ] as any);

  /* Ahora llega un recálculo que SÓLO trae a SARA, como haría la pantalla. */
  const soloSara = await prenomina.calcular(companyId, periodoId, {
    captura: [
      { empleadoId: ids[1], otrosIngresos: [{ clave: '019', importe: 400 }], otrasDeducciones: [] },
    ] as any,
  });
  const i2: any = soloSara.renglones.find((r: any) => r.num_empleado === 'ZZ60');
  const o2: any = soloSara.renglones.find((r: any) => r.num_empleado === 'ZZ62');
  const s2: any = soloSara.renglones.find((r: any) => r.num_empleado === 'ZZ61');

  cerca(i2.otrosIngresos, 700) && cerca(o2.otrosIngresos, 900)
    ? bien('capturar a UNO no borra lo de los otros dos')
    : mal('se perdió la captura de los demás',
          `IVAN ${i2.otrosIngresos} (esperaba 700), OMAR ${o2.otrosIngresos} (esperaba 900)`);

  cerca(s2.otrosIngresos, 400)
    ? bien('y lo que manda la pantalla sí manda sobre lo guardado de ESE trabajador')
    : mal('lo tecleado no se aplicó', s2.otrosIngresos);

  /* Cada renglón trae su borrador, para que la pantalla lo reponga. */
  (i2.capturado?.otrosIngresos?.length || 0) === 1
    ? bien('cada renglón devuelve su captura, para reponerla al volver a entrar')
    : mal('el renglón no trae lo capturado', JSON.stringify(i2.capturado));

  /* Se deja limpio para lo que sigue. */
  await prenomina.guardarCaptura(companyId, periodoId, [
    { empleadoId: ids[0], otrosIngresos: [], otrasDeducciones: [] },
    { empleadoId: ids[1], otrosIngresos: [], otrasDeducciones: [] },
    { empleadoId: ids[2], otrosIngresos: [], otrasDeducciones: [] },
  ] as any);

  /* ── 4. El masivo: un bono a los tres de un jalón ── */
  const masivo = await prenomina.aplicarAVarios(companyId, periodoId, {
    lado: 'ingresos', clave: '029', importe: 1500, empleadoIds: ids,
  });
  masivo.aplicados === 3
    ? bien('un bono de $1,500 aplicado a los tres de una sola vez')
    : mal('el masivo no alcanzó a todos', masivo.aplicados);

  const pre2 = await prenomina.calcular(companyId, periodoId);
  const conBono = pre2.renglones.filter((r: any) => r.otrosIngresos >= 1500).length;
  conBono === 3
    ? bien('los tres traen el bono al recalcular')
    : mal('el bono no le llegó a todos', conBono);

  /* Aplicarlo otra vez REEMPLAZA, no suma: un doble clic no puede pagar doble. */
  await prenomina.aplicarAVarios(companyId, periodoId, {
    lado: 'ingresos', clave: '029', importe: 1500, empleadoIds: ids,
  });
  const pre3 = await prenomina.calcular(companyId, periodoId);
  const sara: any = pre3.renglones.find((r: any) => r.num_empleado === 'ZZ61');
  cerca(sara.otrosIngresos, 1500)
    ? bien('aplicarlo dos veces NO paga doble: reemplaza')
    : mal('el bono se sumó dos veces', sara.otrosIngresos);

  /* Y respeta lo que ya tenía capturado ese trabajador. */
  await prenomina.guardarCaptura(companyId, periodoId, [
    { empleadoId: ids[1],
      otrosIngresos: [{ clave: '029', importe: 1500 }, { clave: '019', importe: 300 }],
      otrasDeducciones: [] },
  ] as any);
  await prenomina.aplicarAVarios(companyId, periodoId, {
    lado: 'egresos', clave: '006', importe: 200, empleadoIds: [ids[1]],
  });
  const pre4 = await prenomina.calcular(companyId, periodoId);
  const sara2: any = pre4.renglones.find((r: any) => r.num_empleado === 'ZZ61');
  cerca(sara2.otrosIngresos, 1800)
    ? bien('el masivo respeta lo que el trabajador ya tenía capturado')
    : mal('el masivo pisó la captura previa', sara2.otrosIngresos);

  /* ── 5. La Lista de Raya trae columna por concepto ── */
  const xls = await generarListaDeRaya(companyId, periodoId);
  const wb = XLSX.read(xls.buffer, { type: 'buffer' });
  const ws = wb.Sheets['Lista de Raya'];
  ws ? bien('la hoja se llama "Lista de Raya", como el formato de la casa')
     : mal('no salió la hoja con ese nombre', wb.SheetNames.join(','));

  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  const texto = JSON.stringify(aoa);

  /^GDM NEXO · Lista de Raya/.test(String(aoa[0]?.[0] || ''))
    ? bien('trae el título del formato')
    : mal('el título no cuadra', aoa[0]?.[0]);

  /INGRESOS/.test(texto) && /DESCUENTOS/.test(texto) && /NETO/.test(texto)
    ? bien('trae las tres bandas: INGRESOS, DESCUENTOS y NETO')
    : mal('faltan las bandas del formato');

  /P029/.test(texto)
    ? bien('el bono tiene su PROPIA columna (P029), no se esconde en "otros"')
    : mal('el concepto no salió como columna');

  /D006/.test(texto)
    ? bien('la deducción también tiene columna propia (D006)')
    : mal('la deducción no salió como columna');

  /TOTALES DEL PER/.test(texto)
    ? bien('cierra con la fila de totales del período')
    : mal('falta la fila de totales');

  /* Una clave que NADIE usó no debe traer columna. */
  !/P047/.test(texto)
    ? bien('un concepto que nadie usó no arrastra una columna vacía')
    : mal('salió una columna de un concepto sin usar');

  /* ── 6. Al cerrar, el borrador se borra ── */
  await cierre.cerrarPeriodo(companyId, periodoId, []);
  const tras = await query<any>(
    `SELECT COUNT(*)::int n FROM nomina_captura WHERE periodo_id=$1`, [periodoId]
  );
  tras.rows[0].n === 0
    ? bien('al cerrar, el borrador se borra: los importes viven en el recibo')
    : mal('quedó captura después de cerrar', tras.rows[0].n);

  /* ── 7. Timbrar, y no timbrar dos veces ── */
  const recibos = await cierre.listarRecibos(companyId, { periodoId });
  const uno = recibos[0];
  const t = await cierre.timbrarVarios(companyId, [uno.id]);
  t.timbrados === 1
    ? bien(`timbrado contra el PAC en modo prueba — UUID ${t.hechos[0]?.uuid?.slice(0, 8)}…`)
    : mal('no timbró', JSON.stringify(t.fallidos));

  const t2 = await cierre.timbrarVarios(companyId, [uno.id]);
  t2.fallaron === 1 && /ya está timbrado/.test(t2.fallidos[0]?.motivo || '')
    ? bien('timbrarlo otra vez se rechaza: sería ingreso duplicado ante el SAT')
    : mal('lo timbró dos veces', JSON.stringify(t2));

  /* Y con varios, que uno falle no detiene a los demás. */
  const t3 = await cierre.timbrarVarios(companyId, [uno.id, recibos[1].id]);
  t3.timbrados === 1 && t3.fallaron === 1
    ? bien('en lote: el ya timbrado falla y el otro sí pasa — no se detiene')
    : mal('el lote no siguió tras el fallo', JSON.stringify(t3));

  /* Con --dejar los datos se quedan, para poder mirar el PDF del recibo o
   * abrir la pantalla con algo dentro. Sin la bandera, limpia como siempre. */
  if (process.argv.includes('--dejar')) {
    console.log('(datos de prueba CONSERVADOS por --dejar)');
  } else {
    await limpiar(companyId);
    if (!rpPrevio) await query(`UPDATE companies SET registro_patronal=NULL WHERE id=$1`, [companyId]);
  }
  console.log('\n(base limpia)');
  console.log(`\n${ok} bien, ${fallos} mal\n`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
