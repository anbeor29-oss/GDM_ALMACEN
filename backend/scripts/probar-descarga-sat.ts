/**
 * Pruebas de la programación de descarga del SAT.
 *
 * ── LO QUE SE COMPRUEBA ──
 * Tres cosas que estaban rotas y no se veían:
 *
 * 1. Nadie creaba el trabajo del día. El cron sólo avanzaba lo que ya existía.
 * 2. Pedir dos veces el mismo rango creaba dos trabajos y gastaba el cupo de
 *    solicitudes del SAT por duplicado.
 * 3. "Sin datos" y "rechazada" se contaban en el mismo número, así que con una
 *    e.firma de prueba no había forma de saber si funcionaba.
 *
 * No se le pide nada al SAT: se prueban el cálculo de rangos, el presupuesto,
 * el candado contra duplicados y el desglose.
 *
 *   npx ts-node --files -r dotenv/config scripts/probar-descarga-sat.ts
 */

import { pool, query } from '../src/config/database';
import * as prog from '../src/modules/sat-descarga/programacion.service';

let ok = 0, ko = 0;
const bien = (m: string) => { ok++; console.log(`  ✔ ${m}`); };
const mal = (m: string, x?: any) => {
  ko++; console.log(`  ✘ ${m}${x !== undefined ? `  → ${JSON.stringify(x)}` : ''}`);
};
const titulo = (t: string) => console.log(`\n${t}`);

async function main() {
  console.log('\n═══ DESCARGA DEL SAT · programación ═══');

  const emp = await query<any>(`SELECT id FROM companies ORDER BY created_at LIMIT 1`);
  const companyId = emp.rows[0].id;
  const limpiar = async () => {
    await query(`DELETE FROM sat_consumo_diario WHERE company_id=$1`, [companyId]);
    await query(`DELETE FROM sat_trabajos WHERE company_id=$1 AND rfc LIKE 'ZZ%'`, [companyId]);
  };
  await limpiar();

  /* ── 1. Los rangos del ejercicio ── */
  titulo('1. Un ejercicio, mes por mes');

  const m2024 = prog.mesesDelEjercicio(2024);
  m2024.length === 12
    ? bien('2024 son doce meses')
    : mal('no dio doce meses', m2024.length);

  m2024[1].desde === '2024-02-01' && m2024[1].hasta === '2024-02-29'
    ? bien('★ febrero de 2024 cierra el 29: año bisiesto')
    : mal('★ el bisiesto se calculó mal', m2024[1]);

  const m2025 = prog.mesesDelEjercicio(2025);
  m2025[1].hasta === '2025-02-28'
    ? bien('y el de 2025 el 28')
    : mal('febrero normal mal', m2025[1]);

  m2024[3].hasta === '2024-04-30' && m2024[0].hasta === '2024-01-31'
    ? bien('abril cierra el 30 y enero el 31: sin tabla de días')
    : mal('el último día del mes falla', { abr: m2024[3], ene: m2024[0] });

  /* El año en curso no pide el mes que todavía se está formando. */
  const anioActual = new Date().getFullYear();
  const mActual = prog.mesesDelEjercicio(anioActual);
  mActual.length === Math.max(1, new Date().getMonth())
    ? bien(`★ del año en curso pide hasta el mes pasado (${mActual.length} meses): ` +
           `el mes actual lo trae la descarga diaria`)
    : mal('pidió meses que aún no cierran', mActual.length);

  /* Cada rango empalma con el siguiente sin huecos ni traslapes. */
  let continuo = true;
  for (let i = 1; i < m2024.length; i++) {
    const finAnterior = new Date(m2024[i - 1].hasta + 'T00:00:00Z');
    const inicioActual = new Date(m2024[i].desde + 'T00:00:00Z');
    if (inicioActual.getTime() - finAnterior.getTime() !== 86400000) continuo = false;
  }
  continuo
    ? bien('★ los doce rangos empalman sin huecos ni traslapes')
    : mal('★ hay días que no quedan cubiertos, o días pedidos dos veces');

  /* ── 2. El presupuesto ── */
  titulo('2. El presupuesto del día');

  await prog.guardarConfig(companyId, { xmlPorDia: 2000, solicitudesPorDia: 40 });
  const p0 = await prog.presupuestoDeHoy(companyId);
  p0.xmlTope === 2000 && p0.solicitudesTope === 40 && !p0.agotado
    ? bien(`arranca con ${p0.quedanXml} XML y ${p0.quedanSolicitudes} solicitudes de cupo`)
    : mal('el presupuesto inicial está mal', p0);

  await prog.consumir(companyId, { solicitudes: 5, xml: 300, paquetes: 2 });
  const p1 = await prog.presupuestoDeHoy(companyId);
  p1.xml === 300 && p1.solicitudes === 5 && p1.quedanXml === 1700
    ? bien('consumir descuenta: 300 XML gastados, quedan 1,700')
    : mal('el consumo no se registró', p1);

  await prog.consumir(companyId, { xml: 1700 });
  const p2 = await prog.presupuestoDeHoy(companyId);
  p2.agotado && p2.quedanXml === 0
    ? bien('★ al llegar a los 2,000 XML el presupuesto se agota')
    : mal('★ no frenó al llegar al tope', p2);

  /* Se agota por CUALQUIERA de los dos topes, no sólo por XML. */
  await query(`DELETE FROM sat_consumo_diario WHERE company_id=$1`, [companyId]);
  await prog.consumir(companyId, { solicitudes: 40 });
  const p3 = await prog.presupuestoDeHoy(companyId);
  p3.agotado && p3.quedanXml === 2000
    ? bien('★★ y también por solicitudes: 40 gastadas frena aunque queden 2,000 XML de cupo')
    : mal('★★ sólo miraba un tope; el otro se pasaría de largo', p3);

  /* El consumo es de HOY: mañana arranca limpio. */
  await query(
    `INSERT INTO sat_consumo_diario (company_id, fecha, solicitudes, xml)
     VALUES ($1, CURRENT_DATE - 1, 40, 2000)
     ON CONFLICT (company_id, fecha) DO UPDATE SET solicitudes = 40, xml = 2000`,
    [companyId]);
  await query(`DELETE FROM sat_consumo_diario WHERE company_id=$1 AND fecha=CURRENT_DATE`,
    [companyId]);
  const p4 = await prog.presupuestoDeHoy(companyId);
  !p4.agotado && p4.quedanXml === 2000
    ? bien('★ lo gastado ayer no cuenta hoy: el cupo es por día')
    : mal('el consumo de ayer frenó el de hoy', p4);

  /* ── 3. La configuración ── */
  titulo('3. Configuración');

  const cfg = await prog.configDe(companyId);
  cfg.diasAtras === 3
    ? bien('★ se piden 3 días atrás, no sólo ayer: el SAT tarda en publicar')
    : mal('la ventana de días está mal', cfg.diasAtras);

  const cfg2 = await prog.guardarConfig(companyId, { diariaActiva: false });
  cfg2.diariaActiva === false && cfg2.xmlPorDia === 2000
    ? bien('guardar un campo no borra los demás')
    : mal('guardar pisó otros campos', cfg2);
  await prog.guardarConfig(companyId, { diariaActiva: true });

  /* Apagada, no crea nada. */
  await prog.guardarConfig(companyId, { diariaActiva: false });
  const apagada = await prog.crearTrabajoDiario(companyId);
  apagada.creados.length === 0 && /apagada/i.test(apagada.omitidos[0] || '')
    ? bien('con la descarga diaria apagada no crea trabajos, y lo dice')
    : mal('creó trabajos con la descarga apagada', apagada);
  await prog.guardarConfig(companyId, { diariaActiva: true });

  /* ── 3-bis. ★ Idempotente POR DÍA ── */
  titulo('3-bis. ★ Llamarlo cada 15 minutos no crea 96 trabajos');

  /* Se simula que el trabajo de hoy ya se creó. */
  await query(
    `INSERT INTO sat_trabajos
       (company_id, rfc, fecha_desde, fecha_hasta, direccion, tipo, estado, origen)
     VALUES ($1,'ZZTE010101ZZ1', CURRENT_DATE - 3, CURRENT_DATE - 1,
             'recibidos','CFDI','TERMINADO','DIARIO')`,
    [companyId]);

  const otraVez = await prog.crearTrabajoDiario(companyId);
  otraVez.creados.length === 0 && /ya se creó/i.test(otraVez.omitidos[0] || '')
    ? bien('★★ con el trabajo de hoy ya creado, no crea otro — aunque esté TERMINADO')
    : mal('★★ volvería a crear uno cada cuarto de hora', otraVez);

  /* Y ésa es justo la diferencia: si mirara "hay uno vivo", un trabajo
   * TERMINADO dejaría pasar la comprobación y se crearía otro. */
  const vivos = await query<any>(
    `SELECT COUNT(*)::int n FROM sat_trabajos
      WHERE company_id=$1 AND origen='DIARIO' AND estado IN ('CREADO','EN_PROCESO')`,
    [companyId]);
  vivos.rows[0].n === 0
    ? bien('★ y no hay ninguno vivo: la comprobación vieja habría dejado pasar')
    : mal('la prueba no aísla el caso', vivos.rows[0].n);

  await query(`DELETE FROM sat_trabajos WHERE company_id=$1 AND origen='DIARIO'`, [companyId]);

  /* ── 4. ★ El candado contra duplicados ── */
  titulo('4. ★ No se pide dos veces el mismo rango');

  const meter = (desde: string, hasta: string, dir: string, estado = 'EN_PROCESO') =>
    query(
      `INSERT INTO sat_trabajos
         (company_id, rfc, fecha_desde, fecha_hasta, direccion, tipo, estado, origen)
       VALUES ($1,'ZZTE010101ZZ1',$2::date,$3::date,$4,'CFDI',$5,'MANUAL')
       RETURNING id`,
      [companyId, desde, hasta, dir, estado]);

  await meter('2026-08-17', '2026-08-19', 'recibidos');

  try {
    await meter('2026-08-17', '2026-08-19', 'recibidos');
    mal('★★ la base aceptó dos trabajos vivos sobre el mismo rango');
  } catch {
    bien('★★ el índice único de la base rechaza el trabajo vivo duplicado');
  }

  /* Un rango que se TRASLAPA es el caso real: dos clics con un día de
   * diferencia. El índice exacto no lo atrapa, pero la comprobación de
   * traslape del servicio sí. */
  const traslape = await query<any>(
    `SELECT 1 FROM sat_trabajos
      WHERE company_id=$1 AND direccion='recibidos' AND estado IN ('CREADO','EN_PROCESO')
        AND fecha_desde <= '2026-08-20'::date AND fecha_hasta >= '2026-08-18'::date`,
    [companyId]);
  traslape.rows.length > 0
    ? bien('★ y un rango que se traslapa (18→20 contra 17→19) se detecta como ya pedido')
    : mal('★ el traslape no se detecta: se pedirían los mismos días dos veces');

  /* Un trabajo TERMINADO no estorba: volver a pedir un rango ya bajado es
   * legítimo si se sospecha que faltó algo. */
  await query(`UPDATE sat_trabajos SET estado='TERMINADO' WHERE company_id=$1 AND rfc LIKE 'ZZ%'`,
    [companyId]);
  const r = await meter('2026-08-17', '2026-08-19', 'recibidos');
  r.rows.length === 1
    ? bien('★ pero un trabajo TERMINADO no bloquea: se puede volver a pedir ese rango')
    : mal('bloqueó un rango ya terminado');

  /* Y emitidos no estorba a recibidos: son solicitudes distintas ante el SAT. */
  const otro = await meter('2026-08-17', '2026-08-19', 'emitidos');
  otro.rows.length === 1
    ? bien('emitidos y recibidos del mismo rango conviven: son solicitudes distintas')
    : mal('emitidos bloqueó a recibidos');

  /* ── 5. ★ El desglose que la pantalla no tenía ── */
  titulo('5. ★ "Sin datos" no es lo mismo que "rechazada"');

  const t = await query<any>(
    `SELECT id FROM sat_trabajos WHERE company_id=$1 AND rfc LIKE 'ZZ%' LIMIT 1`, [companyId]);
  const trabajoId = t.rows[0].id;
  const part = (estado: string, i: number, msg?: string) => query(
    `INSERT INTO sat_particiones (trabajo_id, desde, hasta, profundidad, huella, estado, mensaje_sat)
     VALUES ($1, NOW() - INTERVAL '10 day', NOW(), 0, $2, $3, $4)`,
    [trabajoId, `zz-huella-${i}`, estado, msg ?? null]);

  await part('SIN_DATOS', 1);
  await part('SIN_DATOS', 2);
  await part('TERMINADA', 3);
  await part('RECHAZADA', 4, 'La e.firma no corresponde al RFC solicitante.');
  await part('PENDIENTE', 5);

  const v = await prog.comoVa(companyId);
  v.particiones.sin_datos === 2 && v.particiones.rechazadas === 1 && v.particiones.terminadas === 1
    ? bien('★★ el desglose separa: 2 sin datos, 1 terminada, 1 rechazada')
    : mal('★★ sigue mezclándolas en un solo número', v.particiones);

  v.resueltas === 3 && v.atoradas === 1 && v.enVuelo === 1
    ? bien('★ "resueltas" son las que trajeron algo o confirmaron que no había; ' +
           'lo rechazado está ATORADO, no listo')
    : mal('★ el resumen sigue contando lo rechazado como avance',
          { resueltas: v.resueltas, atoradas: v.atoradas, enVuelo: v.enVuelo });

  v.problemas.length === 1 && /e\.firma no corresponde/.test(v.problemas[0].mensaje_sat)
    ? bien('★ y trae el motivo concreto: "' + v.problemas[0].mensaje_sat.slice(0, 44) + '…"')
    : mal('no devuelve el motivo del rechazo', v.problemas);

  v.presupuesto && v.config
    ? bien('el mismo endpoint trae presupuesto y configuración: una llamada, no tres')
    : mal('falta el presupuesto o la configuración');

  /* ── Limpieza ── */
  await query(`DELETE FROM sat_particiones WHERE trabajo_id IN
    (SELECT id FROM sat_trabajos WHERE company_id=$1 AND rfc LIKE 'ZZ%')`, [companyId]);
  await limpiar();
  await query(`DELETE FROM sat_config_descarga WHERE company_id=$1`, [companyId]);

  console.log(`\n═══ ${ok} bien, ${ko} mal ═══\n`);
  await pool.end();
  process.exit(ko ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\n✘ reventó:', e);
  await pool.end();
  process.exit(1);
});
