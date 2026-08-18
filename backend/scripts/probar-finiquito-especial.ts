/**
 * probar-finiquito-especial — que el periodo del finiquito sea de UNA persona.
 *
 * Es el error que reportó el usuario: al liquidar a alguien, la prenómina del
 * periodo especial traía la plantilla completa. Quien liquida tenía que confiar
 * en no cerrar por error un periodo que no era el suyo.
 *
 * Se comprueba con DOS trabajadores en la empresa: si el especial trae dos
 * renglones, el filtro no funciona. Con uno solo no se notaría.
 *
 *   npx ts-node -r dotenv/config scripts/probar-finiquito-especial.ts
 *
 * Deja la base como la encontró.
 */
import { pool, query } from '../src/config/database';
import * as finiquito from '../src/modules/nomina/finiquito.service';
import * as prenomina from '../src/modules/nomina/prenomina.service';

let ok = 0, fallos = 0;
const bien = (q: string) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q: string, d?: any) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };
const cerca = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;

const NUMS = ['ZZ70', 'ZZ71'];

async function limpiar(companyId: string) {
  await query(
    `DELETE FROM nomina_recibos WHERE company_id = $1 AND num_empleado = ANY($2::text[])`,
    [companyId, NUMS]
  );
  /* Los periodos con empleado_id caen solos por el ON DELETE CASCADE del
   * trabajador, pero los borramos explícito para no depender de eso. */
  await query(
    `DELETE FROM nomina_periodos WHERE company_id = $1 AND empleado_id IN (
       SELECT id FROM nomina_empleados WHERE company_id = $1 AND num_empleado = ANY($2::text[]))`,
    [companyId, NUMS]
  );
  await query(
    `DELETE FROM nomina_empleados WHERE company_id = $1 AND num_empleado = ANY($2::text[])`,
    [companyId, NUMS]
  );
}

async function main() {
  const c = await query<any>(
    `SELECT id, registro_patronal FROM companies WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`
  );
  const companyId = c.rows[0].id;
  await limpiar(companyId);

  /* DOS trabajadores, misma empresa, misma periodicidad. */
  const ids: string[] = [];
  const gente = [
    { num: 'ZZ70', nom: 'ROSA',  pat: 'GARCIA', rfc: 'GARO900202AB3', curp: 'GARO900202MDFRSS03' },
    { num: 'ZZ71', nom: 'PABLO', pat: 'LOPEZ',  rfc: 'LOPA900303CD4', curp: 'LOPA900303HDFPBL04' },
  ];
  for (const g of gente) {
    const r = await query<any>(
      `INSERT INTO nomina_empleados
         (company_id, num_empleado, nombre, apellido_pat, rfc, curp, nss,
          fecha_ingreso, tipo_contrato, tipo_regimen, tipo_jornada,
          periodicidad_pago, tipo_nomina, zona_geografica, regimen_fiscal, uso_cfdi,
          salario_diario, salario_diario_integrado, estado, entidad_federativa, activo)
       VALUES ($1,$2,$3,$4,$5,$6,'12345678904','2022-06-01','01','02','01','04','O',
               'general','605','CN01', 400, 420,'JAL','JAL',true)
       RETURNING id`,
      [companyId, g.num, g.nom, g.pat, g.rfc, g.curp]
    );
    ids.push(r.rows[0].id);
  }
  bien('dos trabajadores activos en la empresa');

  /* ── El traspaso: finiquito de ROSA ── */
  const r = await finiquito.pasarANominaEspecial(companyId, ids[0], {
    fechaBaja: '2026-08-15',
    tipo: 'FINIQUITO',
    desde: '2026-08-10',            // seis días que se le deben
    vacacionesYaDisfrutadas: 0,
  });

  const per = r.periodo;
  per.tipo === 'ESPECIAL'
    ? bien(`se creó un periodo ESPECIAL #${per.numero}`)
    : mal('el periodo no es especial', per.tipo);

  /^Finiquito de ROSA/.test(per.concepto)
    ? bien(`el concepto lo identifica: "${per.concepto}"`)
    : mal('el concepto no dice de quién es', per.concepto);

  Number(per.dias) === 6
    ? bien('el periodo son 6 días: del 10 al 15 de agosto, inclusive')
    : mal('los días del tramo no cuadran', per.dias);

  /* ── LO QUE IMPORTA: la prenómina trae UNA persona ── */
  const pre = await prenomina.calcular(companyId, per.id);
  pre.renglones.length === 1
    ? bien('la prenómina del especial trae UN renglón, no la plantilla')
    : mal('la prenómina trajo a más de uno',
          `${pre.renglones.length}: ${pre.renglones.map((x: any) => x.num_empleado).join(', ')}`);

  pre.renglones[0]?.num_empleado === 'ZZ70'
    ? bien('y es ROSA, la que se va — no PABLO')
    : mal('trajo al trabajador equivocado', pre.renglones[0]?.num_empleado);

  /* ── Los conceptos: su semana + su finiquito ── */
  const fila: any = pre.renglones[0];
  const claves = fila.percepciones.map((p: any) => p.clave);

  claves.includes('001')
    ? bien('trae el sueldo de los días que se le deben (clave 001)')
    : mal('falta el sueldo del tramo');

  cerca(fila.sueldo, 400 * 6, 0.5)
    ? bien(`el sueldo son 6 días x $400 = $${fila.sueldo.toFixed(2)}`)
    : mal('el sueldo del tramo no cuadra', `${fila.sueldo} vs 2400`);

  claves.includes('002')
    ? bien('trae el aguinaldo proporcional (clave 002)')
    : mal('falta el aguinaldo', claves.join(','));

  claves.includes('021')
    ? bien('trae la prima vacacional (clave 021)')
    : mal('falta la prima vacacional', claves.join(','));

  /* Un FINIQUITO no lleva indemnización: la clave 025 es de separación. */
  !claves.includes('025')
    ? bien('un FINIQUITO no trae indemnización — esa es de la liquidación')
    : mal('el finiquito trajo indemnización');

  /* El SUELDO no se duplica.
   *
   * Contar claves 001 no sirve: son DOS y las dos están bien —el sueldo del
   * periodo y las vacaciones no disfrutadas—, porque para el SAT ambas son
   * salario. Lo que no puede haber es dos conceptos MARCADOS como sueldo del
   * periodo: ahí sí se estaría cobrando el tramo dos veces. */
  const marcados = fila.percepciones.filter((p: any) => p.esSueldoDelPeriodo).length;
  marcados === 1
    ? bien('un solo concepto marcado como sueldo del periodo: el tramo no se duplicó')
    : mal('el sueldo del periodo aparece varias veces', `${marcados} conceptos marcados`);

  /* Y las vacaciones se ven APARTE del sueldo en la rejilla, aunque compartan
   * clave: es lo que arregló la marca. */
  cerca(fila.otrosIngresos, fila.totalPercepciones - 2400, 0.5)
    ? bien(`"Otros ingresos" ($${fila.otrosIngresos.toFixed(2)}) excluye el sueldo del tramo`)
    : mal('otros ingresos se comió el sueldo o al revés',
          `otros ${fila.otrosIngresos} · total ${fila.totalPercepciones}`);

  /* ── Ahora una LIQUIDACIÓN, para PABLO ── */
  const r2 = await finiquito.pasarANominaEspecial(companyId, ids[1], {
    fechaBaja: '2026-08-15',
    tipo: 'LIQUIDACION',
    desde: '2026-08-15',
  });
  const pre2 = await prenomina.calcular(companyId, r2.periodo.id);
  const fila2: any = pre2.renglones[0];
  const claves2 = fila2.percepciones.map((p: any) => p.clave);

  pre2.renglones.length === 1 && fila2.num_empleado === 'ZZ71'
    ? bien('la liquidación de PABLO también trae sólo un renglón')
    : mal('la liquidación no aisló al trabajador', pre2.renglones.length);

  claves2.includes('025')
    ? bien('la LIQUIDACIÓN sí trae la indemnización de tres meses (clave 025)')
    : mal('falta la indemnización en la liquidación', claves2.join(','));

  claves2.includes('022')
    ? bien('y la prima de antigüedad (clave 022)')
    : mal('falta la prima de antigüedad', claves2.join(','));

  /* Los dos periodos coexisten sin estorbarse. */
  const especiales = await query<any>(
    `SELECT COUNT(*)::int n FROM nomina_periodos
      WHERE company_id = $1 AND tipo = 'ESPECIAL' AND empleado_id IS NOT NULL`,
    [companyId]
  );
  especiales.rows[0].n >= 2
    ? bien('los dos finiquitos conviven como periodos individuales distintos')
    : mal('no se crearon los dos periodos', especiales.rows[0].n);

  /* Y el aguinaldo de toda la plantilla SIGUE alcanzando a todos: el cambio no
   * rompió los especiales colectivos. */
  const colectivo = await query<any>(
    `INSERT INTO nomina_periodos
       (company_id, anio, tipo, numero, fecha_inicio, fecha_fin, fecha_pago, dias, estatus, concepto)
     VALUES ($1, 2026, 'ESPECIAL',
             (SELECT COALESCE(MAX(numero),0)+1 FROM nomina_periodos
               WHERE company_id=$1 AND anio=2026 AND tipo='ESPECIAL'),
             '2026-12-01','2026-12-15','2026-12-15',15,'ABIERTO','Aguinaldo de prueba')
     RETURNING id`, [companyId]
  );
  const preCol = await prenomina.calcular(companyId, colectivo.rows[0].id);
  const mios = preCol.renglones.filter((x: any) => NUMS.includes(x.num_empleado));
  mios.length === 2
    ? bien('un especial SIN trabajador sigue alcanzando a toda la plantilla')
    : mal('el especial colectivo dejó de traer a todos', mios.length);
  await query(`DELETE FROM nomina_periodos WHERE id = $1`, [colectivo.rows[0].id]);

  console.log(`\n  ${r.aviso}\n`);

  await limpiar(companyId);
  console.log('(base limpia)');
  console.log(`\n${ok} bien, ${fallos} mal\n`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
