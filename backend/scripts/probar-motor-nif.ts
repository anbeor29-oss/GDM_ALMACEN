/**
 * Pruebas del motor NIF.
 *
 * ── LO QUE SE COMPRUEBA ──
 * Que cada regla diga la verdad en los dos sentidos: que dispare cuando hay
 * un problema y que se calle cuando no lo hay. Una regla que siempre dispara
 * es tan inútil como una que nunca lo hace, y la primera es peor: entrena a
 * la gente a ignorar los avisos.
 *
 * También que la clasificación de tres estados no sea un truco para vaciar la
 * lista de pendientes. El IVA acreditable tiene que salir NO_APLICA —no le
 * corresponde ninguna NIF de valuación— y no clasificado como C-3, que sería
 * exigirle estimación de incobrabilidad a un saldo que se compensa contra el
 * propio impuesto.
 *
 *   npx ts-node --files -r dotenv/config scripts/probar-motor-nif.ts
 */

import fs from 'fs';
import path from 'path';
import { pool, query } from '../src/config/database';
import * as nif from '../src/modules/accounting/nif-motor.service';
import { REGLAS_NIF, type ContextoNif, type SaldoAgrupado } from '../src/modules/accounting/nif-reglas.data';
import * as bal from '../src/modules/accounting/balanza-lector.service';
import * as map from '../src/modules/accounting/mapeador-sat.service';

let ok = 0, ko = 0;
const bien = (m: string) => { ok++; console.log(`  ✔ ${m}`); };
const mal = (m: string, x?: any) => {
  ko++; console.log(`  ✘ ${m}${x !== undefined ? `  → ${JSON.stringify(x)}` : ''}`);
};
const titulo = (t: string) => console.log(`\n${t}`);

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const XLSX = process.env.BALANZA_XLSX
  || path.join(HOME, 'Downloads', 'BALANZA_DE_COMPROBACIÓN_PRO1401108F6_31072026_13073225.xlsx');

/** Un contexto armado a mano, para probar cada regla aislada. */
function ctx(saldos: Array<Partial<SaldoAgrupado> & { agrupador: string; saldo: number }>): ContextoNif {
  const full: SaldoAgrupado[] = saldos.map((s, i) => ({
    agrupador: s.agrupador,
    cuenta: s.cuenta ?? `C${i}`,
    nombre: s.nombre ?? `Cuenta ${i}`,
    naturaleza: s.naturaleza ?? (/^[1567]/.test(s.agrupador) ? 'D' : 'A'),
    saldo: s.saldo,
    esComplementaria: s.esComplementaria,
  }));
  const bajo = (p: string[]) => full.filter((s) => p.some((x) => s.agrupador.startsWith(x)));
  return {
    fechaCorte: '2026-07-31',
    saldos: full,
    suma: (...p) => bajo(p).reduce((a, s) => a + s.saldo, 0),
    cuentas: (...p) => bajo(p),
    existe: (...p) => bajo(p).length > 0,
  };
}

const correr = (clave: string, c: ContextoNif) => {
  const r = REGLAS_NIF.find((x) => x.clave === clave)!;
  return r.evaluar(c);
};

async function main() {
  console.log('\n═══ MOTOR NIF ═══');

  /* ── 1. Las reglas en la base ── */
  titulo('1. Las reglas se registran y se versionan');

  const s1 = await nif.sincronizarReglas();
  s1.total === REGLAS_NIF.length
    ? bien(`${s1.total} reglas sincronizadas`)
    : mal('no se sincronizaron todas', s1);

  const s2 = await nif.sincronizarReglas();
  s2.nuevas === 0
    ? bien('★ correrlo dos veces no duplica ni reescribe: una versión es inmutable')
    : mal('la segunda corrida volvió a insertar', s2);

  const cols = await query<any>(
    `SELECT COUNT(*)::int n FROM information_schema.columns
      WHERE table_name='nif_hallazgos' AND column_name='regla_version'`);
  cols.rows[0].n === 1
    ? bien('cada hallazgo guarda la versión de la regla que lo produjo')
    : mal('los hallazgos no guardan versión');

  /* ── 2. Tres estados, y el IVA en el correcto ── */
  titulo('2. ★ Tres estados: el IVA NO tiene NIF, y eso no es un pendiente');

  const cl = await nif.clasificarCatalogoSat();
  cl.especifica > 300 && cl.noAplica > 100 && cl.depende > 0
    ? bien(`clasificadas: ${cl.especifica} con NIF · ${cl.noAplica} sin NIF aplicable · ` +
           `${cl.depende} dependen del contenido`)
    : mal('la clasificación quedó rara', cl);

  const iva = await query<any>(
    `SELECT codigo, nif_aplica, nif_norma FROM sat_codigos_agrupadores
      WHERE codigo IN ('118.01','119.01','208.01','216') ORDER BY codigo`);
  const todosNoAplica = iva.rows.every((r: any) => r.nif_aplica === 'NO_APLICA' && !r.nif_norma);
  todosNoAplica
    ? bien('★★ IVA acreditable, IVA trasladado y retenciones: NO_APLICA, sin norma inventada')
    : mal('★★ se le asignó una NIF al IVA', iva.rows);

  const otros = await query<any>(
    `SELECT codigo, nif_aplica FROM sat_codigos_agrupadores WHERE codigo IN ('121','218')`);
  otros.rows.every((r: any) => r.nif_aplica === 'DEPENDE')
    ? bien("★ 'Otros activos' y 'Otros pasivos' quedan en DEPENDE: no se puede saber sin ver qué hay dentro")
    : mal('se clasificaron cuentas genéricas a ciegas', otros.rows);

  const inv = await query<any>(
    `SELECT codigo, nif_aplica, nif_norma FROM sat_codigos_agrupadores WHERE codigo='115'`);
  inv.rows[0]?.nif_aplica === 'ESPECIFICA' && inv.rows[0]?.nif_norma === 'C-4'
    ? bien('y lo que sí tiene norma la conserva: 115 Inventario → C-4')
    : mal('se perdió una clasificación buena', inv.rows[0]);

  /* ── 3. Cada regla, en los dos sentidos ── */
  titulo('3. Cada regla dispara cuando debe, y se calla cuando no');

  /* C-3 */
  const c3malo = correr('C3-ESTIMACION-INCOBRABLES', ctx([{ agrupador: '105.01', saldo: 500000 }]));
  c3malo.estado === 'NO_CUMPLE'
    ? bien('C-3 dispara con cartera y sin estimación')
    : mal('C-3 no disparó', c3malo);

  const c3bueno = correr('C3-ESTIMACION-INCOBRABLES', ctx([
    { agrupador: '105.01', saldo: 500000 },
    { agrupador: '108.01', saldo: 25000, esComplementaria: true },
  ]));
  c3bueno.estado === 'CUMPLE'
    ? bien('y se calla cuando la estimación existe')
    : mal('C-3 disparó con estimación presente', c3bueno);

  /* ★ C-3 mide exposición, no neto */
  const c3neto = correr('C3-ESTIMACION-INCOBRABLES', ctx([
    { agrupador: '105.01', saldo: 500000, cuenta: 'A', nombre: 'DEBE' },
    { agrupador: '105.01', saldo: -900000, cuenta: 'B', nombre: 'PAGÓ DE MÁS' },
  ]));
  c3neto.estado === 'NO_CUMPLE' && (c3neto.cifras as any).cartera === 500000
    ? bien('★★ con clientes a favor, mide la EXPOSICIÓN ($500,000) y no el neto (−$400,000)')
    : mal('★★ el neto se comió la exposición: pediría estimar una cartera negativa', c3neto);

  /* C-6 · terrenos no entran */
  const c6terreno = correr('C6-DEPRECIACION', ctx([{ agrupador: '151.01', saldo: 3000000 }]));
  c6terreno.estado === 'NO_APLICA'
    ? bien('★ C-6 no exige depreciar cuando lo único que hay son TERRENOS')
    : mal('★ pidió depreciar un terreno', c6terreno);

  const c6malo = correr('C6-DEPRECIACION', ctx([{ agrupador: '156.01', saldo: 200000 }]));
  c6malo.estado === 'NO_CUMPLE'
    ? bien('pero sí con equipo de cómputo sin depreciación acumulada')
    : mal('C-6 no disparó con activo depreciable', c6malo);

  const c6bueno = correr('C6-DEPRECIACION', ctx([
    { agrupador: '156.01', saldo: 200000 },
    { agrupador: '171.05', saldo: 60000, esComplementaria: true },
  ]));
  c6bueno.estado === 'CUMPLE'
    ? bien('y se calla con depreciación registrada')
    : mal('C-6 disparó con depreciación presente', c6bueno);

  /* C-6 terrenos depreciados */
  const terrDep = correr('C6-TERRENOS-NO-SE-DEPRECIAN', ctx([
    { agrupador: '151.01', saldo: 3000000 },
    { agrupador: '171.01', saldo: 50000, nombre: 'Depreciación de terrenos' },
  ]));
  terrDep.estado === 'NO_CUMPLE'
    ? bien('★ detecta una cuenta que deprecia terrenos')
    : mal('no detectó la depreciación de terrenos', terrDep);

  /* C-1 efectivo negativo */
  const c1 = correr('C1-EFECTIVO-NEGATIVO', ctx([
    { agrupador: '102.01', saldo: 100000, nombre: 'Banco A' },
    { agrupador: '102.01', saldo: -80000, nombre: 'Banco B', cuenta: 'X' },
  ]));
  c1.estado === 'NO_CUMPLE'
    ? bien('★ C-1 detecta el banco sobregirado aunque OTRO banco tenga saldo a favor')
    : mal('★ el saldo positivo tapó el sobregiro — eso es compensar', c1);

  /* C-11 reserva legal */
  const r11 = correr('C11-RESERVA-LEGAL', ctx([
    { agrupador: '301.01', saldo: 1000000 },
    { agrupador: '303.01', saldo: 50000 },
  ]));
  r11.estado === 'REQUIERE_REVISION' && Math.abs((r11.cifras as any).falta - 150000) < 1
    ? bien('C-11 calcula lo que falta de reserva legal: $150,000 sobre $1,000,000')
    : mal('el cálculo de reserva legal falló', r11);

  const r11ok = correr('C11-RESERVA-LEGAL', ctx([
    { agrupador: '301.01', saldo: 1000000 },
    { agrupador: '303.01', saldo: 200000 },
  ]));
  r11ok.estado === 'CUMPLE'
    ? bien('y se calla al llegar al 20%')
    : mal('siguió pidiendo reserva ya completa', r11ok);

  /* ── 4. ★ La ecuación, por naturaleza ── */
  titulo('4. ★ El 703 guarda gastos Y productos financieros');

  const eq = correr('A5-ECUACION-CONTABLE', ctx([
    { agrupador: '102.01', saldo: 100, naturaleza: 'D' },
    { agrupador: '201.01', saldo: 40, naturaleza: 'A' },
    { agrupador: '301.01', saldo: 10, naturaleza: 'A' },
    /* Un INGRESO por intereses, que en el Anexo 24 cae en 703. */
    { agrupador: '703', saldo: 50, naturaleza: 'A', nombre: 'Intereses ganados' },
  ]));
  eq.estado === 'CUMPLE'
    ? bien('★★ un ingreso por intereses mapeado a 703 SUMA, no resta')
    : mal('★★ el producto financiero se restó como gasto: el error entra dos veces', eq);

  const eqGasto = correr('A5-ECUACION-CONTABLE', ctx([
    { agrupador: '102.01', saldo: 100, naturaleza: 'D' },
    { agrupador: '201.01', saldo: 140, naturaleza: 'A' },
    { agrupador: '301.01', saldo: 10, naturaleza: 'A' },
    { agrupador: '703', saldo: 50, naturaleza: 'D', nombre: 'Intereses pagados' },
  ]));
  eqGasto.estado === 'CUMPLE'
    ? bien('y un gasto financiero en el MISMO 703 sí resta')
    : mal('el gasto financiero no se restó', eqGasto);

  /* ── 5. Una regla que revienta no tumba la corrida ── */
  titulo('5. Una regla rota no se lleva la corrida');

  const rota = {
    ...REGLAS_NIF[0], clave: 'ZZ-ROTA', version: 1,
    evaluar: () => { throw new Error('boom'); },
  } as any;
  const conRota = nif.evaluar(ctx([{ agrupador: '102.01', saldo: 1 }]),
    [rota, REGLAS_NIF.find((r) => r.clave === 'C1-EFECTIVO-NEGATIVO')!]);
  conRota.hallazgos.length === 2 && /boom/.test(conRota.hallazgos.find((h) => h.regla === 'ZZ-ROTA')!.mensaje)
    ? bien('★ la regla rota se reporta y las demás siguen corriendo')
    : mal('una regla rota tumbó la corrida', conRota.hallazgos.length);

  /* ── 6. El orden ── */
  titulo('6. Lo que no cumple va primero');

  const orden = nif.evaluar(ctx([
    { agrupador: '102.01', saldo: -5000, nombre: 'Sobregirado' },
    { agrupador: '105.01', saldo: 900000 },
  ]));
  const estados = orden.hallazgos.map((h) => h.estado);
  const primerCumple = estados.indexOf('CUMPLE');
  const ultimoNo = estados.lastIndexOf('NO_CUMPLE');
  (primerCumple === -1 || ultimoNo < primerCumple)
    ? bien('los incumplimientos salen antes que los cumplimientos')
    : mal('el orden mezcla lo urgente con lo que ya está bien', estados);

  /* ── 7. La balanza real, contra el otro camino de cálculo ── */
  if (!fs.existsSync(XLSX)) {
    console.log('\n  (la balanza de ejemplo no está aquí — se salta)');
    console.log(`\n═══ ${ok} bien, ${ko} mal ═══\n`);
    await pool.end();
    process.exit(ko ? 1 : 0);
  }

  titulo('7. ★ La balanza real, y el contraste con el analizador');

  const ex = await bal.leerBalanzaExcel(fs.readFileSync(XLSX));
  const validos = await map.agrupadoresValidos();
  const mapeo = map.proponerMapeo(ex.filas, { agrupadoresValidos: validos });
  const contexto = nif.contextoDeBalanza(ex.filas, mapeo, '2026-07-31');
  const res = nif.evaluar(contexto);

  res.reglasCorridas === REGLAS_NIF.length
    ? bien(`${res.reglasCorridas} reglas corridas sobre 343 cuentas`)
    : mal('no corrieron todas', res.reglasCorridas);

  /* EL contraste: dos implementaciones independientes de la misma cifra. */
  const analisis = bal.analizarBalanza(ex);
  const ecuacion = res.hallazgos.find((h) => h.regla === 'A5-ECUACION-CONTABLE')!;
  const difMotor = Math.abs((ecuacion.cifras as any).diferencia);
  const difAnalizador = Math.abs(analisis.diferenciaEcuacion);

  Math.abs(difMotor - difAnalizador) < 0.02
    ? bien(`★★ el motor NIF y el analizador de balanza dan la MISMA diferencia ` +
           `($${difMotor.toFixed(2)}) por caminos distintos`)
    : mal('★★ los dos caminos no coinciden — uno de los dos está mal',
          { motor: difMotor, analizador: difAnalizador });

  const c1real = res.hallazgos.find((h) => h.regla === 'C1-EFECTIVO-NEGATIVO')!;
  c1real.estado === 'NO_CUMPLE'
    ? bien(`★ y encuentra los sobregiros reales: ${c1real.mensaje.slice(0, 70)}…`)
    : mal('no detectó los bancos negativos de la balanza real', c1real.estado);

  const c3real = res.hallazgos.find((h) => h.regla === 'C3-ESTIMACION-INCOBRABLES')!;
  (c3real.cifras as any).cartera > 0
    ? bien(`la cartera reportada es positiva: $${((c3real.cifras as any).cartera).toFixed(2)}`)
    : mal('reportó una cartera negativa', c3real.cifras);

  /* ── 8. Guardar y releer ── */
  titulo('8. La corrida se guarda y se puede releer');

  const emp = await query<any>(`SELECT id FROM companies ORDER BY created_at LIMIT 1`);
  const companyId = emp.rows[0].id;
  await query(`DELETE FROM nif_evaluaciones WHERE company_id=$1`, [companyId]);

  const evId = await nif.guardarEvaluacion(companyId, res, 'BALANZA');
  const hall = await nif.hallazgosDe(evId);
  hall.length === res.hallazgos.length
    ? bien(`${hall.length} hallazgos guardados y releídos`)
    : mal('se perdieron hallazgos al guardar', { guardados: hall.length, esperados: res.hallazgos.length });

  hall[0].estado !== 'CUMPLE' || res.noCumple === 0
    ? bien('y al releerlos siguen ordenados por urgencia')
    : mal('el orden se perdió al releer', hall[0].estado);

  hall.every((h: any) => h.regla_version >= 1 && h.que_exige)
    ? bien('★ cada hallazgo conserva su versión de regla y el texto de lo que exige')
    : mal('hay hallazgos sin versión o sin fundamento');

  await query(`DELETE FROM nif_evaluaciones WHERE company_id=$1`, [companyId]);

  console.log(`\n═══ ${ok} bien, ${ko} mal ═══\n`);
  await pool.end();
  process.exit(ko ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\n✘ reventó:', e);
  await pool.end();
  process.exit(1);
});
