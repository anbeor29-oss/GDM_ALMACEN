/**
 * probar-cierre — el cierre del periodo, contra Postgres de verdad.
 *
 * Lo que se comprueba aquí no se puede comprobar con pruebas unitarias: que la
 * transacción deje TODO escrito o NADA, que el índice único impida cerrar dos
 * veces, que los abonos de los préstamos bajen el saldo exactamente una vez, y
 * que el XML que sale tenga la estructura del CFDI 4.0 con su complemento.
 *
 *   npx ts-node -r dotenv/config scripts/probar-cierre.ts
 *
 * Deja la base como la encontró.
 */
import { pool, query } from '../src/config/database';
import * as cierre from '../src/modules/nomina/cierre.service';
import * as prenomina from '../src/modules/nomina/prenomina.service';

let ok = 0, fallos = 0;
const bien = (q: string) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q: string, d?: any) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };

async function main() {
  const c = await query<any>(
    `SELECT id, rfc, registro_patronal FROM companies WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`
  );
  const companyId = c.rows[0].id;
  console.log(`\nEmpresa: ${c.rows[0].rfc}  ·  registro patronal ${c.rows[0].registro_patronal || '(sin capturar)'}\n`);

  /* Sin registro patronal el CFDI de nómina no cierra. Si la empresa no lo
   * tiene se le pone uno para la prueba y se le quita al terminar: la prueba no
   * deja la empresa modificada. */
  const RP_DE_PRUEBA = 'Z1234567890';
  /* Si una corrida anterior se cayó a la mitad puede haber dejado el de prueba
   * puesto. Ese no cuenta como "el suyo": se vuelve a limpiar al final. */
  const rpPrevio =
    c.rows[0].registro_patronal === RP_DE_PRUEBA ? null : c.rows[0].registro_patronal;
  if (!rpPrevio) {
    await query(`UPDATE companies SET registro_patronal = $2 WHERE id = $1`, [companyId, RP_DE_PRUEBA]);
  }

  /* Barremos los restos de una corrida anterior que se haya caído a medias.
   * Un script de verificación que sólo funciona la primera vez no sirve. */
  await query(
    `DELETE FROM nomina_credito_abonos WHERE credito_id IN (
       SELECT c.id FROM nomina_creditos c JOIN nomina_empleados e ON e.id = c.empleado_id
        WHERE e.company_id = $1 AND e.num_empleado IN ('ZZ01','ZZ02'))`, [companyId]);
  await query(
    `DELETE FROM nomina_recibos WHERE company_id = $1 AND num_empleado IN ('ZZ01','ZZ02')`, [companyId]);
  await query(
    `DELETE FROM nomina_creditos WHERE empleado_id IN (
       SELECT id FROM nomina_empleados WHERE company_id = $1 AND num_empleado IN ('ZZ01','ZZ02'))`, [companyId]);
  await query(
    `DELETE FROM nomina_empleados WHERE company_id = $1 AND num_empleado IN ('ZZ01','ZZ02')`, [companyId]);

  await query(
    `INSERT INTO nomina_puestos (company_id, nombre) VALUES ($1, 'PRUEBA CIERRE')
     ON CONFLICT DO NOTHING`, [companyId]
  );
  const puestoId = (
    await query<any>(`SELECT id FROM nomina_puestos WHERE company_id=$1 AND nombre='PRUEBA CIERRE'`, [companyId])
  ).rows[0].id;

  /* Dos trabajadores: uno con sueldo normal, uno al salario mínimo. */
  const gente = [
    { num: 'ZZ01', nom: 'PEDRO', pat: 'RAMIREZ', mat: 'SOLIS',
      rfc: 'RASP900115AB1', curp: 'RASP900115HDFMLD01', nss: '12345678901', diario: 500, sdi: 520 },
    { num: 'ZZ02', nom: 'LUCIA', pat: 'MENDEZ', mat: 'ORTIZ',
      rfc: 'MEOL950320CD2', curp: 'MEOL950320MDFNRC02', nss: '12345678902', diario: 278.80, sdi: 290 },
  ];
  const ids: string[] = [];
  for (const g of gente) {
    const r = await query<any>(
      `INSERT INTO nomina_empleados
         (company_id, num_empleado, nombre, apellido_pat, apellido_mat, rfc, curp, nss,
          fecha_ingreso, puesto_id, tipo_contrato, tipo_regimen, tipo_jornada,
          periodicidad_pago, tipo_nomina, zona_geografica, regimen_fiscal, uso_cfdi,
          salario_diario, salario_diario_integrado, banco_clave, cuenta_clabe,
          estado, entidad_federativa, activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'2024-01-15',$9,'01','02','01',
               '04','O','general','605','CN01',
               $10,$11,'002','012345678901234567','JAL','JAL',true)
       RETURNING id`,
      [companyId, g.num, g.nom, g.pat, g.mat, g.rfc, g.curp, g.nss, puestoId, g.diario, g.sdi]
    );
    ids.push(r.rows[0].id);
  }
  bien('dos trabajadores de prueba dados de alta');

  /* Un préstamo, para ver que el cierre lo abone. */
  const cred = await query<any>(
    `INSERT INTO nomina_creditos
       (company_id, empleado_id, origen, concepto, monto_original, saldo,
        descuento_por_periodo, fecha_inicio, estatus)
     VALUES ($1,$2,'PRESTAMO','Préstamo de prueba',6000,6000,500,'2026-01-01','ACTIVO')
     RETURNING id`,
    [companyId, ids[0]]
  );
  const creditoId = cred.rows[0].id;

  /* El número de quincena va de 1 a 24 por CHECK, así que no podemos inventar
   * un 90 fuera de rango para no chocar. Tomamos el primero libre y, si la
   * empresa ya tiene las 24 capturadas, lo decimos en vez de pisar una real. */
  const usados = (await query<any>(
    `SELECT numero FROM nomina_periodos WHERE company_id=$1 AND anio=2026 AND tipo='QUINCENAL'`,
    [companyId]
  )).rows.map((r: any) => Number(r.numero));
  const libre = [...Array(24).keys()].map((i) => i + 1).find((n) => !usados.includes(n));
  if (!libre) {
    mal('no hay ninguna quincena libre de 2026 para la prueba; no se pisa una real');
    process.exit(1);
  }
  const per = await query<any>(
    `INSERT INTO nomina_periodos (company_id, anio, tipo, numero, fecha_inicio, fecha_fin, fecha_pago, dias, estatus)
     VALUES ($1, 2026, 'QUINCENAL', $2, '2026-08-01', '2026-08-15', '2026-08-15', 15, 'ABIERTO')
     RETURNING id`, [companyId, libre]
  );
  const periodoId = per.rows[0].id;
  console.log(`  (periodo de prueba: quincena ${libre} de 2026)`);

  /* 1. La prenómina ve a los dos. */
  const pre = await prenomina.calcular(companyId, periodoId);
  const mios = pre.renglones.filter((r: any) => ['ZZ01', 'ZZ02'].includes(r.num_empleado));
  mios.length === 2 ? bien('la prenómina trae a los dos trabajadores')
                    : mal('la prenómina no los trajo', `trajo ${mios.length}`);

  const pedro: any = mios.find((r: any) => r.num_empleado === 'ZZ01');
  const lucia: any = mios.find((r: any) => r.num_empleado === 'ZZ02');

  pedro.prestamos === 500 ? bien('el préstamo de 500 aparece como deducción')
                          : mal('el préstamo no se descontó', pedro.prestamos);
  lucia.imss === 0 && lucia.isr === 0
    ? bien('al salario mínimo no hay cuota obrera ni ISR (Art. 36 LSS / 93-XIV LISR)')
    : mal('el trabajador al mínimo salió con retenciones', `imss ${lucia.imss} isr ${lucia.isr}`);

  Math.abs(pedro.totalPercepciones - pedro.totalDeducciones - pedro.neto) < 0.01
    ? bien('percepciones menos deducciones = neto')
    : mal('el neto no cuadra');

  Math.abs(pedro.gravado + pedro.exento - pedro.totalPercepciones) < 0.01
    ? bien('gravado + exento = total de percepciones')
    : mal('gravado y exento no suman las percepciones',
          `${pedro.gravado} + ${pedro.exento} != ${pedro.totalPercepciones}`);

  /* 2. El cierre. */
  const cerrado: any = await cierre.cerrarPeriodo(companyId, periodoId, []);
  cerrado.recibos === 2 ? bien('el cierre generó dos recibos')
                        : mal('número de recibos inesperado', JSON.stringify(cerrado));

  const est = await query<any>(`SELECT estatus FROM nomina_periodos WHERE id=$1`, [periodoId]);
  est.rows[0].estatus === 'CERRADO' ? bien('el periodo quedó CERRADO')
                                    : mal('el periodo no cambió de estatus', est.rows[0].estatus);

  /* 3. El préstamo se abonó UNA vez. */
  const saldo = await query<any>(`SELECT saldo FROM nomina_creditos WHERE id=$1`, [creditoId]);
  Number(saldo.rows[0].saldo) === 5500
    ? bien('el préstamo bajó de 6,000 a 5,500 -- un solo abono')
    : mal('el saldo del préstamo quedó mal', saldo.rows[0].saldo);

  const abonos = await query<any>(`SELECT COUNT(*)::int n FROM nomina_credito_abonos WHERE credito_id=$1`, [creditoId]);
  abonos.rows[0].n === 1 ? bien('hay exactamente un renglón de abono')
                         : mal('abonos duplicados o ausentes', abonos.rows[0].n);

  /* 4. No se cierra dos veces. */
  try {
    await cierre.cerrarPeriodo(companyId, periodoId, []);
    mal('cerró dos veces el mismo periodo');
  } catch (e: any) {
    /ya está cerrado/.test(e.message || '')
      ? bien('cerrar dos veces se rechaza')
      : mal('rechazó por otro motivo', e.message);
  }

  /* 5. El XML. */
  const recibos = await cierre.listarRecibos(companyId, { periodoId });
  const rp: any = recibos.find((r: any) => r.num_empleado === 'ZZ01');
  const xml: any = await cierre.xmlDelRecibo(companyId, rp.id);
  const t: string = xml.xml;

  const debe: [string, RegExp][] = [
    ['declara CFDI 4.0',               /Version="4\.0"/],
    ['es tipo N (nómina)',             /TipoDeComprobante="N"/],
    ['trae el complemento 1.2',        /<nomina12:Nomina[^>]*Version="1\.2"/],
    ['la periodicidad va en clave SAT', /PeriodicidadPago="04"/],
    ['el receptor es el trabajador',   /Rfc="RASP900115AB1"/],
    ['lleva CURP',                     /Curp="RASP900115HDFMLD01"/],
    ['lleva NSS',                      /NumSeguridadSocial="12345678901"/],
    ['lleva el registro patronal',     /RegistroPatronal="/],
    ['el concepto es el 84111505',     /ClaveProdServ="84111505"/],
  ];
  for (const [que, re] of debe) {
    re.test(t) ? bien(`XML: ${que}`) : mal(`XML: ${que}`);
  }
  !/TimbreFiscalDigital/.test(t)
    ? bien('XML: no trae timbre -- es pre-timbre, como se pidió')
    : mal('XML: trae timbre y no debía');

  const mTot = /\sTotal="([\d.]+)"/.exec(t);   // \s para no casar con SubTotal=
  const mDes = /Descuento="([\d.]+)"/.exec(t);
  mTot && Math.abs(Number(mTot[1]) - Number(rp.neto)) < 0.01
    ? bien('XML: Total = neto a cobrar')
    : mal('XML: el Total no es el neto', `${mTot?.[1]} vs ${rp.neto}`);
  mDes && Math.abs(Number(mDes[1]) - Number(rp.total_deducciones)) < 0.01
    ? bien('XML: Descuento = total de deducciones')
    : mal('XML: el Descuento no cuadra', `${mDes?.[1]} vs ${rp.total_deducciones}`);

  /* 6. El check de envío por correo. */
  await cierre.marcarEnvioPorCorreo(companyId, [rp.id], true);
  const marcado = await query<any>(`SELECT enviar_por_correo FROM nomina_recibos WHERE id=$1`, [rp.id]);
  marcado.rows[0].enviar_por_correo === true
    ? bien('el check de envío por correo se guarda')
    : mal('el check no se guardó');

  /* 7. El filtro de la pantalla CFDI. */
  const sinTimbrar = await cierre.listarRecibos(companyId, { estatus: 'PENDIENTE', periodoId });
  sinTimbrar.length === 2 ? bien('los dos recibos aparecen como pendientes de timbrar')
                          : mal('el filtro por estatus no cuadra', sinTimbrar.length);

  console.log('\n--- primeras líneas del XML generado ---');
  console.log(t.split('\n').slice(0, 8).join('\n'));

  /* Limpieza. */
  await query(`DELETE FROM nomina_recibos WHERE periodo_id=$1`, [periodoId]);
  await query(`DELETE FROM nomina_credito_abonos WHERE credito_id=$1`, [creditoId]);
  await query(`DELETE FROM nomina_creditos WHERE id=$1`, [creditoId]);
  await query(`DELETE FROM nomina_periodos WHERE id=$1`, [periodoId]);
  await query(`DELETE FROM nomina_empleados WHERE id = ANY($1::uuid[])`, [ids]);
  await query(`DELETE FROM nomina_puestos WHERE id=$1`, [puestoId]);
  if (!rpPrevio) await query(`UPDATE companies SET registro_patronal = NULL WHERE id=$1`, [companyId]);
  console.log('\n(base limpia)');

  console.log(`\n${ok} bien, ${fallos} mal\n`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
