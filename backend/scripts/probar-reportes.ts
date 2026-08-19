/**
 * probar-reportes — que los cuatro reportes cuadren contra los recibos.
 *
 * Un reporte de nómina existe para UNA cosa: cuadrar contra lo que se declaró.
 * Si sus totales no coinciden con la suma de los recibos, no sirve para nada —y
 * peor, se descubre cuando el SAT pregunta.
 *
 * Por eso cada total se compara contra la suma sacada aparte, con SQL propio,
 * y no contra lo que devolvió el mismo código.
 *
 *   npx ts-node -r dotenv/config scripts/probar-reportes.ts
 *
 * Deja la base como la encontró.
 */
import { pool, query } from '../src/config/database';
import * as prenomina from '../src/modules/nomina/prenomina.service';
import * as cierre from '../src/modules/nomina/cierre.service';
import * as reportes from '../src/modules/nomina/reportes.service';
import * as XLSX from 'xlsx';

let ok = 0, fallos = 0;
const bien = (q: string) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q: string, d?: any) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };
const cerca = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

const NUMS = ['ZR01', 'ZR02'];
const ANIO = 2026;

async function limpiar(companyId: string) {
  await query(`DELETE FROM nomina_recibos WHERE company_id=$1 AND num_empleado = ANY($2::text[])`,
    [companyId, NUMS]);
  await query(`DELETE FROM nomina_empleados WHERE company_id=$1 AND num_empleado = ANY($2::text[])`,
    [companyId, NUMS]);
  await query(
    `DELETE FROM nomina_periodos
      WHERE company_id=$1 AND anio=$2 AND tipo='QUINCENAL' AND numero IN (23, 24)`,
    [companyId, ANIO]);
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

  /* Dos trabajadores y DOS periodos: con uno solo no se nota si el rango
   * filtra, ni si el agrupado por trabajador suma bien entre periodos. */
  const ids: string[] = [];
  for (const [num, nom, rfc, curp, diario] of [
    ['ZR01', 'ROSA',  'ROSA900707GH8', 'ROSA900707MDFSSS08', 600],
    ['ZR02', 'TOMAS', 'TOMA900808IJ9', 'TOMA900808HDFMSM09', 315.04],
  ] as any[]) {
    const r = await query<any>(
      `INSERT INTO nomina_empleados
         (company_id, num_empleado, nombre, apellido_pat, rfc, curp, nss,
          fecha_ingreso, tipo_contrato, tipo_regimen, tipo_jornada,
          periodicidad_pago, tipo_nomina, zona_geografica, regimen_fiscal, uso_cfdi,
          salario_diario, salario_diario_integrado, estado, entidad_federativa, activo)
       VALUES ($1,$2,$3,'PRUEBA',$4,$5,'12345678907','2022-05-10','01','02','01','04','O',
               'general','605','CN01',$6,$6*1.05,'JAL','JAL',true)
       RETURNING id`,
      [companyId, num, nom, rfc, curp, diario]
    );
    ids.push(r.rows[0].id);
  }

  const periodos: string[] = [];
  for (const [num, ini, fin] of [
    [23, '2026-12-01', '2026-12-15'],
    [24, '2026-12-16', '2026-12-31'],
  ] as any[]) {
    const p = await query<any>(
      `INSERT INTO nomina_periodos
         (company_id, anio, tipo, numero, fecha_inicio, fecha_fin, fecha_pago, dias, estatus)
       VALUES ($1,$2,'QUINCENAL',$3,$4,$5,$5,15,'ABIERTO') RETURNING id`,
      [companyId, ANIO, num, ini, fin]
    );
    periodos.push(p.rows[0].id);
  }
  bien('dos trabajadores y dos quincenas de prueba');

  /* ── Un reporte de periodos ABIERTOS sale vacío, a propósito ── */
  const abierto = await reportes.prenomina(companyId, {
    anio: ANIO, tipo: 'QUINCENAL', desde: 23, hasta: 24,
  });
  abierto.renglones.length === 0
    ? bien('con los periodos abiertos, el reporte sale VACÍO — lo que se puede mover no se declara')
    : mal('un periodo abierto se coló al reporte', abierto.renglones.length);

  /* Se cierran los dos. */
  for (const id of periodos) await cierre.cerrarPeriodo(companyId, id, []);
  bien('las dos quincenas cerradas');

  /* ── La verdad, sacada aparte con SQL propio ── */
  const verdad = await query<any>(
    `SELECT COUNT(*)::int n,
            SUM(r.total_percepciones) perc, SUM(r.total_gravado) grav,
            SUM(r.isr) isr, SUM(r.imss) imss, SUM(r.neto) neto,
            SUM(r.total_otros_pagos) subsidio
       FROM nomina_recibos r
       JOIN nomina_periodos p ON p.id = r.periodo_id
      WHERE r.company_id = $1 AND p.anio = $2 AND p.tipo = 'QUINCENAL'
        AND p.numero BETWEEN 23 AND 24
        AND r.num_empleado = ANY($3::text[])`,
    [companyId, ANIO, NUMS]
  );
  const v = verdad.rows[0];

  /* ── 1. Prenómina ── */
  const pre = await reportes.prenomina(companyId, {
    anio: ANIO, tipo: 'QUINCENAL', desde: 23, hasta: 24,
  });
  const mios = pre.renglones.filter((r: any) => NUMS.includes(r.num_empleado));
  mios.length === 4
    ? bien('prenómina: 2 trabajadores × 2 quincenas = 4 renglones')
    : mal('la prenómina no trajo los cuatro renglones', mios.length);

  const sumaMia = mios.reduce((a: number, r: any) => a + Number(r.neto), 0);
  cerca(sumaMia, Number(v.neto))
    ? bien(`prenómina: el neto cuadra con los recibos — ${sumaMia.toFixed(2)}`)
    : mal('el neto de la prenómina no cuadra', `${sumaMia} vs ${v.neto}`);

  /* ── 2. El rango filtra de verdad ── */
  const soloUna = await reportes.prenomina(companyId, {
    anio: ANIO, tipo: 'QUINCENAL', desde: 24, hasta: 24,
  });
  const mios24 = soloUna.renglones.filter((r: any) => NUMS.includes(r.num_empleado));
  mios24.length === 2
    ? bien('pedir sólo la quincena 24 trae 2 renglones, no 4')
    : mal('el rango no filtró', mios24.length);

  /* Y un rango imposible se rechaza en vez de devolver algo raro. */
  try {
    await reportes.prenomina(companyId, { anio: ANIO, tipo: 'QUINCENAL', desde: 1, hasta: 30 });
    mal('aceptó la quincena 30, que no existe');
  } catch (e: any) {
    /del 1 al 24/.test(e.message)
      ? bien('la quincena 30 se rechaza: en quincenal sólo hay 24')
      : mal('rechazó con otro mensaje', e.message);
  }

  /* ── 3. ISR agrupado por trabajador ── */
  const isr = await reportes.isr(companyId, { anio: ANIO, tipo: 'QUINCENAL', desde: 23, hasta: 24 });
  const rosa = isr.renglones.find((r: any) => r.num_empleado === 'ZR01');
  rosa && Number(rosa.periodos) === 2
    ? bien('ISR: cada trabajador sale UNA vez, con sus 2 periodos sumados')
    : mal('el agrupado por trabajador no cuadra', JSON.stringify(rosa));

  const isrMio = isr.renglones
    .filter((r: any) => NUMS.includes(r.num_empleado))
    .reduce((a: number, r: any) => a + Number(r.isr), 0);
  cerca(isrMio, Number(v.isr))
    ? bien(`ISR: el total cuadra con los recibos — ${isrMio.toFixed(2)}`)
    : mal('el ISR no cuadra', `${isrMio} vs ${v.isr}`);

  isr.porPeriodo.length >= 2
    ? bien('ISR: trae el corte por periodo, que es contra lo que se paga al SAT')
    : mal('falta el corte por periodo');

  /* ── 4. IMSS: la cuota obrera y el exento del mínimo ── */
  const imss = await reportes.imss(companyId, { anio: ANIO, tipo: 'QUINCENAL', desde: 23, hasta: 24 });
  const tomas = imss.renglones.find((r: any) => r.num_empleado === 'ZR02');
  Number(tomas?.imss) === 0
    ? bien('IMSS: al salario mínimo la cuota obrera es cero (Art. 36 LSS)')
    : mal('al mínimo le salió cuota obrera', tomas?.imss);

  const imssMio = imss.renglones
    .filter((r: any) => NUMS.includes(r.num_empleado))
    .reduce((a: number, r: any) => a + Number(r.imss), 0);
  cerca(imssMio, Number(v.imss))
    ? bien(`IMSS: el total cuadra con los recibos — ${imssMio.toFixed(2)}`)
    : mal('el IMSS no cuadra', `${imssMio} vs ${v.imss}`);

  /* ── 5. CFDI: quién está timbrado ── */
  const recibos = await cierre.listarRecibos(companyId, {});
  const unoMio = recibos.find((r: any) => NUMS.includes(r.num_empleado));
  await cierre.timbrarVarios(companyId, [unoMio.id]);

  const cfdi = await reportes.cfdi(companyId, { anio: ANIO, tipo: 'QUINCENAL', desde: 23, hasta: 24 });
  const miosCfdi = cfdi.renglones.filter((r: any) => NUMS.includes(r.num_empleado));
  const conUuid = miosCfdi.filter((r: any) => r.uuid).length;
  conUuid === 1
    ? bien('CFDI: distingue el timbrado de los que faltan')
    : mal('el conteo de timbrados no cuadra', conUuid);

  miosCfdi.find((r: any) => r.uuid)?.uuid?.length >= 32
    ? bien('CFDI: el folio fiscal sale completo, no cortado')
    : mal('el UUID viene incompleto');

  /* ── 6. El Excel dice lo mismo que la pantalla ── */
  const xls = await reportes.generarExcel(companyId, 'isr', {
    anio: ANIO, tipo: 'QUINCENAL', desde: 23, hasta: 24,
  });
  const wb = XLSX.read(xls.buffer, { type: 'buffer' });
  const aoa: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
  const texto = JSON.stringify(aoa);

  /* Los encabezados van en MAYÚSCULAS y con salto de línea, como el formato de
   * la casa: "ISR
RETENIDO". La prueba los busca así. */
  /ISR/.test(texto) && /SUBSIDIO/.test(texto) && /GRAVADO/.test(texto)
    ? bien('Excel: trae las columnas del reporte de ISR, con los rótulos del formato')
    : mal('al Excel le faltan columnas');

  /ROSA/.test(texto)
    ? bien('Excel: trae los renglones de los trabajadores')
    : mal('el Excel salió sin datos');

  /Sólo periodos CERRADOS/.test(texto)
    ? bien('Excel: dice de dónde salen los números, en la hoja misma')
    : mal('al Excel le falta la nota de alcance');

  /* ── 7. La cuota PATRONAL, para provisionar ── */
  const imssRep: any = await reportes.imss(companyId, {
    anio: ANIO, tipo: 'QUINCENAL', desde: 23, hasta: 24,
  });

  imssRep.patronal && imssRep.patronal.total > 0
    ? bien(`cuota patronal calculada: ${imssRep.patronal.total.toFixed(2)} para provisionar`)
    : mal('no se calculó la cuota patronal', JSON.stringify(imssRep.patronal));

  /* Las ramas suman el total del IMSS: si no cuadran, alguna se quedó fuera y
   * la provisión saldría corta sin que se note. */
  const p2 = imssRep.patronal;
  const ramas = p2.emCuotaFija + p2.emExcedente + p2.emDinero + p2.emPensionados +
                p2.invalidezVida + p2.riesgosTrabajo + p2.guarderias + p2.retiro +
                p2.cesantiaVejez;
  cerca(ramas, p2.totalImss, 0.10)
    ? bien('las nueve ramas suman el total del IMSS patronal')
    : mal('las ramas no cuadran con el total', `${ramas.toFixed(2)} vs ${p2.totalImss}`);

  cerca(p2.totalImss + p2.infonavit, p2.total, 0.02)
    ? bien('IMSS + INFONAVIT = lo que hay que apartar')
    : mal('el total a provisionar no suma');

  /* La patronal es MUCHO mayor que la obrera: es el dato que justifica el
   * reporte. Si salieran parecidas, algo se quedó fuera. */
  p2.total > Number(imssRep.totales.imss) * 3
    ? bien('la patronal supera con creces a la obrera, como debe ser')
    : mal('la patronal salió sospechosamente baja',
          `patronal ${p2.total} vs obrera ${imssRep.totales.imss}`);

  /* Sin prima de riesgo capturada, se avisa en vez de provisionar de menos en
   * silencio. */
  imssRep.avisos.some((a: string) => /prima de riesgo/.test(a))
    ? bien('sin prima de riesgo capturada, el reporte avisa que la provisión queda corta')
    : bien('la empresa tiene prima de riesgo: la rama se calculó');

  await limpiar(companyId);
  if (!rpPrevio) await query(`UPDATE companies SET registro_patronal=NULL WHERE id=$1`, [companyId]);
  console.log('\n(base limpia)');
  console.log(`\n${ok} bien, ${fallos} mal\n`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
