/**
 * probar-entregas-cobradas — que un uniforme con costo se cobre UNA vez.
 *
 * LOS DOS ERRORES QUE SE ESTÁN EVITANDO, Y SON OPUESTOS
 *
 *   Cobrarlo dos veces. Es el que reclama el trabajador, y el que aparece
 *   cuando el descuento se calcula solo pero nadie apunta que ya se cobró.
 *
 *   No cobrarlo nunca. Es el que nadie reclama y por eso se descubre tarde:
 *   basta con que la marca quede fuera de la transacción del cierre.
 *
 * Por eso la prueba cierra DOS periodos seguidos y mira el segundo: es ahí
 * donde se ve si la marca sirvió.
 *
 *   npx ts-node -r dotenv/config scripts/probar-entregas-cobradas.ts
 *
 * Deja la base como la encontró.
 */
import { pool, query } from '../src/config/database';
import * as expediente from '../src/modules/nomina/expediente.service';
import * as prenomina from '../src/modules/nomina/prenomina.service';
import * as cierre from '../src/modules/nomina/cierre.service';

let ok = 0, fallos = 0;
const bien = (q: string) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q: string, d?: any) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };
const cerca = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

const NUMS = ['ZU01', 'ZU02'];
const ANIO = 2026;

/** La deducción 017 de un renglón: lo que se le cobró de artículos. */
const cobrado = (r: any) =>
  (r.deducciones || [])
    .filter((d: any) => d.clave === '017')
    .reduce((a: number, d: any) => a + Number(d.importe), 0);

async function limpiar(companyId: string) {
  const emp = await query<any>(
    `SELECT id FROM nomina_empleados WHERE company_id=$1 AND num_empleado = ANY($2::text[])`,
    [companyId, NUMS]);
  const ids = emp.rows.map((x: any) => x.id);
  if (ids.length) {
    await query(`DELETE FROM nomina_entregas WHERE empleado_id = ANY($1::uuid[])`, [ids]);
  }
  await query(`DELETE FROM nomina_recibos WHERE company_id=$1 AND num_empleado = ANY($2::text[])`,
    [companyId, NUMS]);
  await query(
    `DELETE FROM nomina_periodos
      WHERE company_id=$1 AND anio=$2 AND tipo='ESPECIAL' AND concepto LIKE 'ZZ uniforme%'`,
    [companyId, ANIO]);
  await query(`DELETE FROM nomina_empleados WHERE company_id=$1 AND num_empleado = ANY($2::text[])`,
    [companyId, NUMS]);
}

async function main() {
  const c = await query<any>(
    `SELECT id FROM companies WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`);
  const companyId = c.rows[0].id;
  await limpiar(companyId);

  const ids: string[] = [];
  for (const [num, nom, rfc, curp] of [
    ['ZU01', 'SOFIA', 'SOFI900404GH4', 'SOFI900404MDFSSS04'],
    ['ZU02', 'TERESA', 'TERE900505IJ5', 'TERE900505MDFSSS05'],
  ] as any[]) {
    const r = await query<any>(
      `INSERT INTO nomina_empleados
         (company_id, num_empleado, nombre, apellido_pat, rfc, curp, nss,
          fecha_ingreso, tipo_contrato, tipo_regimen, tipo_jornada,
          periodicidad_pago, tipo_nomina, zona_geografica, regimen_fiscal, uso_cfdi,
          salario_diario, salario_diario_integrado, estado, entidad_federativa, activo)
       VALUES ($1,$2,$3,'PRUEBA',$4,$5,'12345678907','2021-06-01','01','02','01','04','O',
               'general','605','CN01',700,735,'JAL','JAL',true)
       RETURNING id`,
      [companyId, num, nom, rfc, curp]);
    ids.push(r.rows[0].id);
  }
  bien('dos trabajadoras de prueba');

  /* ── Tres entregas: una con costo, una gratis y una que aún no toca ── */
  await expediente.registrarEntrega(companyId, {
    empleado_id: ids[0], tipo: 'UNIFORME', articulo: 'Camisola',
    cantidad: 2, fecha_entrega: `${ANIO}-08-05`, costo: 480,
  });
  await expediente.registrarEntrega(companyId, {
    empleado_id: ids[0], tipo: 'EPP', articulo: 'Casco',
    cantidad: 1, fecha_entrega: `${ANIO}-08-05`, costo: 0,
  });
  await expediente.registrarEntrega(companyId, {
    empleado_id: ids[1], tipo: 'UNIFORME', articulo: 'Botas',
    cantidad: 1, fecha_entrega: `${ANIO}-08-05`, costo: 900,
    descontar_desde: `${ANIO}-09-10`,
  });
  bien('tres entregas: una con costo, una gratis y una que empieza a cobrarse después');

  /* Lo que falta por cobrar al 31 de agosto: sólo la primera. */
  const pendientes = await expediente.entregasPorCobrar(companyId, `${ANIO}-08-31`, ids);
  pendientes.length === 1 && cerca(pendientes[0].importe, 480)
    ? bien('al 31 de agosto sólo hay UNA por cobrar: la de 480')
    : mal('la lista de pendientes no cuadra',
          JSON.stringify(pendientes.map((x) => [x.articulo, x.importe])));

  /* ── Periodo 1: se cobra ── */
  const p1 = await query<any>(
    `INSERT INTO nomina_periodos
       (company_id, anio, tipo, numero, fecha_inicio, fecha_fin, fecha_pago, dias, estatus, concepto)
     VALUES ($1,$2,'ESPECIAL',90,'${ANIO}-08-16','${ANIO}-08-31','${ANIO}-08-31',15,'ABIERTO','ZZ uniforme uno')
     RETURNING id`, [companyId, ANIO]);

  const pre1 = await prenomina.calcular(companyId, p1.rows[0].id, {});
  const sofia1 = pre1.renglones.find((r: any) => r.num_empleado === 'ZU01');
  const teresa1 = pre1.renglones.find((r: any) => r.num_empleado === 'ZU02');

  cerca(cobrado(sofia1), 480)
    ? bien('la camisola de 480 entra como deducción 017 en el primer periodo')
    : mal('no se cobró la camisola', cobrado(sofia1));

  cobrado(teresa1) === 0
    ? bien('las botas NO se cobran todavía: empiezan el 10 de septiembre')
    : mal('se cobró algo que aún no tocaba', cobrado(teresa1));

  /* El casco de costo cero no debe aparecer por ningún lado. */
  !((sofia1 as any)?.deducciones || []).some((d: any) => /casco/i.test(d.concepto || ''))
    ? bien('el casco de costo cero no genera descuento: lo pone la empresa')
    : mal('se descontó algo que no costaba nada');

  const r1 = await cierre.cerrarPeriodo(companyId, p1.rows[0].id, []);
  (r1 as any).entregasCobradas === 1
    ? bien('al cerrar se marcó UNA entrega como cobrada')
    : mal('el cierre no marcó la entrega', (r1 as any).entregasCobradas);

  /* ── Periodo 2: NO se vuelve a cobrar ── */
  const p2 = await query<any>(
    `INSERT INTO nomina_periodos
       (company_id, anio, tipo, numero, fecha_inicio, fecha_fin, fecha_pago, dias, estatus, concepto)
     VALUES ($1,$2,'ESPECIAL',91,'${ANIO}-09-01','${ANIO}-09-15','${ANIO}-09-15',15,'ABIERTO','ZZ uniforme dos')
     RETURNING id`, [companyId, ANIO]);

  const pre2 = await prenomina.calcular(companyId, p2.rows[0].id, {});
  const sofia2 = pre2.renglones.find((r: any) => r.num_empleado === 'ZU01');
  const teresa2 = pre2.renglones.find((r: any) => r.num_empleado === 'ZU02');

  cobrado(sofia2) === 0
    ? bien('EN EL SEGUNDO PERIODO NO SE VUELVE A COBRAR — es lo que reclamaría el trabajador')
    : mal('la camisola se cobró dos veces', cobrado(sofia2));

  /* Y las botas, que empezaban el 10 de septiembre, ahora sí caen. */
  cerca(cobrado(teresa2), 900)
    ? bien('las botas caen en el periodo que cubre el 10 de septiembre, no antes')
    : mal('las botas no se cobraron cuando tocaba', cobrado(teresa2));

  await cierre.cerrarPeriodo(companyId, p2.rows[0].id, []);

  /* ── Queda constancia de DÓNDE se cobró ── */
  const lista = await expediente.listarEntregas(companyId, ids[0]);
  const camisola = lista.find((x: any) => x.articulo === 'Camisola');
  camisola?.descontado_en && /90/.test(String(camisola.descontado_en))
    ? bien(`el expediente dice en qué periodo se cobró: "${camisola.descontado_en}"`)
    : mal('no quedó constancia del periodo', JSON.stringify(camisola?.descontado_en));

  const casco = lista.find((x: any) => x.articulo === 'Casco');
  casco && !casco.descontado_periodo_id && !casco.descontar_desde
    ? bien('el de costo cero quedó sin fecha de cobro: no hay nada que cobrar')
    : mal('el de costo cero quedó marcado para cobro');

  /* ── La pensión y el INFONAVIT respetan su fecha ──
   *
   * Un oficio notificado el 10 de septiembre no alcanza a la quincena que
   * corrió del 1 al 15 de agosto: cobrarla ahí sería retener sin orden que lo
   * respalde, y devolverlo después ya no es un ajuste de nómina. */
  await query(
    `UPDATE nomina_empleados
        SET tiene_pension_alimenticia = true, pension_tipo = 'porcentaje',
            pension_monto = 20, pension_desde = $2::date
      WHERE id = $1`,
    [ids[0], `${ANIO}-09-10`]);

  const p3 = await query<any>(
    `INSERT INTO nomina_periodos
       (company_id, anio, tipo, numero, fecha_inicio, fecha_fin, fecha_pago, dias, estatus, concepto)
     VALUES ($1,$2,'ESPECIAL',92,'${ANIO}-08-01','${ANIO}-08-15','${ANIO}-08-15',15,'ABIERTO','ZZ uniforme tres')
     RETURNING id`, [companyId, ANIO]);
  const preAntes = await prenomina.calcular(companyId, p3.rows[0].id, {});
  const sofiaAntes: any = preAntes.renglones.find((r: any) => r.num_empleado === 'ZU01');
  const pension = (r: any) =>
    (r?.deducciones || []).filter((d: any) => d.clave === '007')
      .reduce((a: number, d: any) => a + Number(d.importe), 0);

  pension(sofiaAntes) === 0
    ? bien('la pensión NO se retiene en la quincena anterior al oficio')
    : mal('se retuvo pensión antes de la fecha del oficio', pension(sofiaAntes));

  const p4 = await query<any>(
    `INSERT INTO nomina_periodos
       (company_id, anio, tipo, numero, fecha_inicio, fecha_fin, fecha_pago, dias, estatus, concepto)
     VALUES ($1,$2,'ESPECIAL',93,'${ANIO}-09-01','${ANIO}-09-15','${ANIO}-09-15',15,'ABIERTO','ZZ uniforme cuatro')
     RETURNING id`, [companyId, ANIO]);
  const preDespues = await prenomina.calcular(companyId, p4.rows[0].id, {});
  const sofiaDespues: any = preDespues.renglones.find((r: any) => r.num_empleado === 'ZU01');

  pension(sofiaDespues) > 0
    ? bien('y sí se retiene en la quincena que cubre el día de la notificación')
    : mal('no se retuvo la pensión cuando ya tocaba');

  /* Sin fecha capturada, aplica desde siempre: es como se comportaban los
   * expedientes antes de que la columna existiera. */
  await query(`UPDATE nomina_empleados SET pension_desde = NULL WHERE id = $1`, [ids[0]]);
  const preSinFecha = await prenomina.calcular(companyId, p3.rows[0].id, {});
  const sofiaSinFecha: any = preSinFecha.renglones.find((r: any) => r.num_empleado === 'ZU01');
  pension(sofiaSinFecha) > 0
    ? bien('sin fecha capturada, la pensión aplica desde siempre — no cambia lo que ya existía')
    : mal('vaciar la fecha dejó de retener');

  await query(
    `DELETE FROM nomina_periodos WHERE id = ANY($1::uuid[])`,
    [[p3.rows[0].id, p4.rows[0].id]]);

  /* ── Una entrega no puede empezar a cobrarse antes de entregarse ── */
  try {
    await expediente.registrarEntrega(companyId, {
      empleado_id: ids[0], tipo: 'OTRO', articulo: 'Imposible',
      fecha_entrega: `${ANIO}-08-20`, costo: 100, descontar_desde: `${ANIO}-08-01`,
    });
    mal('aceptó cobrar antes de haber entregado');
  } catch (e: any) {
    /antes de haberlo entregado/.test(e.message)
      ? bien('no se puede empezar a cobrar antes de la entrega')
      : mal('rechazó con otro mensaje', e.message);
  }

  await limpiar(companyId);
  console.log(`\n${ok} bien, ${fallos} mal`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
