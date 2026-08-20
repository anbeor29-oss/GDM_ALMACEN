/**
 * Pruebas de los estados financieros.
 *
 * ── LO QUE MÁS IMPORTA AQUÍ ──
 * Que el balance CUADRE, y que cuando no cuadre lo diga en vez de disimularlo.
 * Un estado de situación financiera que no cuadra y se presenta igual es la
 * peor salida posible: se ve como un estado financiero.
 *
 * Y que ninguna razón devuelva un número sin sentido. "Se tarda −16 días en
 * cobrar" es peor que "no se puede calcular": lo segundo se corrige, lo
 * primero se copia a una presentación.
 *
 *   npx ts-node --files -r dotenv/config scripts/probar-estados-financieros.ts
 */

import fs from 'fs';
import path from 'path';
import { pool } from '../src/config/database';
import * as ef from '../src/modules/accounting/estados-financieros.service';
import type { ContextoNif, SaldoAgrupado } from '../src/modules/accounting/nif-reglas.data';
import * as bal from '../src/modules/accounting/balanza-lector.service';
import * as map from '../src/modules/accounting/mapeador-sat.service';
import * as nif from '../src/modules/accounting/nif-motor.service';

let ok = 0, ko = 0;
const bien = (m: string) => { ok++; console.log(`  ✔ ${m}`); };
const mal = (m: string, x?: any) => {
  ko++; console.log(`  ✘ ${m}${x !== undefined ? `  → ${JSON.stringify(x)}` : ''}`);
};
const titulo = (t: string) => console.log(`\n${t}`);

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const XLSX = process.env.BALANZA_XLSX
  || path.join(HOME, 'Downloads', 'BALANZA_DE_COMPROBACIÓN_PRO1401108F6_31072026_13073225.xlsx');

function ctx(ss: Array<{ agrupador: string; saldo: number; naturaleza?: 'D' | 'A'; nombre?: string }>): ContextoNif {
  const full: SaldoAgrupado[] = ss.map((s, i) => ({
    agrupador: s.agrupador, cuenta: `C${i}`, nombre: s.nombre ?? `Cuenta ${i}`,
    naturaleza: s.naturaleza ?? (/^[1567]/.test(s.agrupador) ? 'D' : 'A'),
    saldo: s.saldo,
  }));
  const bajo = (p: string[]) => full.filter((s) => p.some((x) => s.agrupador.startsWith(x)));
  return {
    fechaCorte: '2026-07-31', saldos: full,
    suma: (...p) => bajo(p).reduce((a, s) => a + s.saldo, 0),
    cuentas: (...p) => bajo(p),
    existe: (...p) => bajo(p).length > 0,
  };
}

const razon = (rs: ef.Razon[], clave: string) => rs.find((r) => r.clave === clave)!;

async function main() {
  console.log('\n═══ ESTADOS FINANCIEROS ═══');

  /* ── 1. Un balance que cuadra ── */
  titulo('1. El balance cuadra, y lo dice');

  const simple = ctx([
    { agrupador: '102.01', saldo: 500000 },
    { agrupador: '105.01', saldo: 300000 },
    { agrupador: '115.01', saldo: 200000 },
    { agrupador: '156.01', saldo: 400000 },
    { agrupador: '171.05', saldo: 100000, naturaleza: 'A' },
    { agrupador: '201.01', saldo: 600000, naturaleza: 'A' },
    { agrupador: '301.01', saldo: 500000, naturaleza: 'A' },
    { agrupador: '401.01', saldo: 1000000, naturaleza: 'A' },
    { agrupador: '501.01', saldo: 700000 },
    { agrupador: '601.84', saldo: 100000 },
  ]);
  const b = ef.situacionFinanciera(simple);

  b.activoTotal === 1300000
    ? bien(`activo total ${b.activoTotal}: 500k efectivo + 300k clientes + 200k inventario + 300k fijo neto`)
    : mal('el activo no cuadró', b.activoTotal);

  const fijo = b.activoNoCirculante.rubros.find((r) => r.clave === 'FIJO')!;
  fijo.importe === 300000
    ? bien('★ el activo fijo se presenta NETO de su depreciación: 400k − 100k')
    : mal('la depreciación no se restó', fijo.importe);

  fijo.detalle?.length === 3 && fijo.detalle[1].importe === -100000
    ? bien('y aun así muestra sus componentes: inversión, depreciación, deterioro')
    : mal('el rubro neto escondió sus partes', fijo.detalle);

  b.cuadra && Math.abs(b.diferencia) < 0.01
    ? bien(`★ activo ${b.activoTotal} = pasivo ${b.pasivoTotal} + capital ${b.capitalTotal}`)
    : mal('★ el balance no cuadró', { dif: b.diferencia, a: b.activoTotal, p: b.pasivoTotal, c: b.capitalTotal });

  /* ── 2. Y cuando NO cuadra, no lo disimula ── */
  titulo('2. Cuando no cuadra, avisa');

  const roto = ctx([
    { agrupador: '102.01', saldo: 500000 },
    { agrupador: '201.01', saldo: 100000, naturaleza: 'A' },
  ]);
  const j = ef.juegoCompleto(roto);
  !j.situacionFinanciera.cuadra && j.avisos.some((a) => /no cuadra/i.test(a))
    ? bien('★ un balance descuadrado se marca y se explica, no se presenta como si nada')
    : mal('★ presentó un balance descuadrado sin avisar', j.avisos);

  /* ── 3. El resultado ── */
  titulo('3. Estado de resultado integral');

  const r = ef.resultadoIntegral(simple);
  r.ingresosNetos === 1000000 && r.utilidadBruta === 300000
    ? bien(`ingresos ${r.ingresosNetos}, utilidad bruta ${r.utilidadBruta}`)
    : mal('el resultado no cuadró', { i: r.ingresosNetos, ub: r.utilidadBruta });

  r.utilidadNeta === 200000
    ? bien(`utilidad neta ${r.utilidadNeta} tras 100k de gastos`)
    : mal('la utilidad neta salió mal', r.utilidadNeta);

  /* ── 4. ★ El 703, otra vez ── */
  titulo('4. ★ Productos financieros dentro del 703');

  const conRif = ctx([
    { agrupador: '401.01', saldo: 1000000, naturaleza: 'A' },
    { agrupador: '703', saldo: 30000, naturaleza: 'D', nombre: 'Intereses pagados' },
    { agrupador: '703', saldo: 50000, naturaleza: 'A', nombre: 'Intereses ganados' },
  ]);
  const rr = ef.resultadoIntegral(conRif);
  const gf = rr.renglones.find((x) => x.clave === 'RIF_GASTOS')!.importe;
  const pf = rr.renglones.find((x) => x.clave === 'RIF_PRODUCTOS')!.importe;

  gf === -30000 && pf === 50000
    ? bien('★★ el mismo 703 se parte por naturaleza: 30k de gasto y 50k de producto')
    : mal('★★ el 703 se fue todo de un lado', { gastos: gf, productos: pf });

  rr.utilidadAntesImpuestos === 1020000
    ? bien(`y la utilidad antes de impuestos suma el neto: ${rr.utilidadAntesImpuestos}`)
    : mal('el RIF no se aplicó bien', rr.utilidadAntesImpuestos);

  /* ── 5. Las razones ── */
  titulo('5. Razones financieras');

  const rz = ef.razones(b, r, simple, 365);

  const liq = razon(rz, 'LIQUIDEZ');
  liq.valor === 1.67
    ? bien(`liquidez ${liq.valor}: 1,000,000 circulante entre 600,000 de pasivo corto`)
    : mal('la liquidez salió mal', liq.valor);

  Object.keys(liq.base).length >= 2
    ? bien('★ cada razón trae las cifras con las que se calculó: se puede rehacer a mano')
    : mal('la razón no trae su base', liq.base);

  /* ★ Precisión: el margen bruto es 30%, no 30 redondeado desde 0.3 */
  const preciso = ctx([
    { agrupador: '401.01', saldo: 1000000, naturaleza: 'A' },
    { agrupador: '501.01', saldo: 621400 },
  ]);
  const rp = ef.resultadoIntegral(preciso);
  const bp = ef.situacionFinanciera(preciso);
  const mb = razon(ef.razones(bp, rp, preciso), 'MARGEN_BRUTO');
  mb.valor === 37.86
    ? bien('★★ margen bruto 37.86%, no 38%: el redondeo va al presentar, no al calcular')
    : mal('★★ el redondeo intermedio se comió los decimales', mb.valor);

  /* ── 6. ★ Ninguna razón devuelve un número sin sentido ── */
  titulo('6. ★ Con cartera negativa, el DSO no se inventa');

  const negativo = ctx([
    { agrupador: '105.01', saldo: -900000 },
    { agrupador: '401.01', saldo: 1000000, naturaleza: 'A' },
    { agrupador: '501.01', saldo: 400000 },
    { agrupador: '201.01', saldo: -50000, naturaleza: 'A' },
  ]);
  const bn = ef.situacionFinanciera(negativo);
  const rn = ef.resultadoIntegral(negativo);
  const rzn = ef.razones(bn, rn, negativo);

  const dso = razon(rzn, 'DSO');
  dso.valor === null && /cartera neta es -900000/.test(dso.interpretacion)
    ? bien('★★ DSO no se calcula con cartera negativa, y explica que eso son anticipos')
    : mal('★★ devolvió días de cartera negativos', { valor: dso.valor, txt: dso.interpretacion });

  const dpo = razon(rzn, 'DPO');
  dpo.valor === null && /anticipo entregado/.test(dpo.interpretacion)
    ? bien('★ y un proveedor con saldo deudor tampoco: es un anticipo, no una deuda')
    : mal('devolvió días de proveedores con saldo deudor', dpo.valor);

  const ciclo = razon(rzn, 'CICLO_EFECTIVO');
  ciclo.valor === null
    ? bien('★ el ciclo de efectivo no se arma con las piezas que sí hay')
    : mal('★ armó un ciclo con datos incompletos, y se ve como un dato bueno', ciclo.valor);

  /* ── 7. Análisis horizontal ── */
  titulo('7. Análisis horizontal');

  const anterior = ctx([
    { agrupador: '102.01', saldo: 400000 },
    { agrupador: '105.01', saldo: 300000 },
    { agrupador: '201.01', saldo: 600000, naturaleza: 'A' },
  ]);
  const h = ef.analisisHorizontal(b, ef.situacionFinanciera(anterior));
  const efectivo = h.find((x) => x.clave === 'EFECTIVO')!;
  efectivo.variacion === 100000 && efectivo.variacionPct === 25
    ? bien('el efectivo subió 100,000 (25%)')
    : mal('la variación salió mal', efectivo);

  /* Un movimiento porcentualmente grande pero chico en pesos NO es alerta. */
  const chico = ctx([{ agrupador: '102.01', saldo: 200 }]);
  const chicoAnt = ctx([{ agrupador: '102.01', saldo: 100 }]);
  const hChico = ef.analisisHorizontal(
    ef.situacionFinanciera(chico), ef.situacionFinanciera(chicoAnt));
  !hChico.find((x) => x.clave === 'EFECTIVO')!.alerta
    ? bien('★ pasar de $100 a $200 es +100% y NO es alerta: enterraría al que movió medio millón')
    : mal('★ marcó alerta por un movimiento de cien pesos');

  h[0].variacion >= h[h.length - 1].variacion
    ? bien('y se ordena por el tamaño del movimiento, no por rubro')
    : mal('el orden no prioriza lo grande');

  /* ── 8. La balanza real ── */
  if (!fs.existsSync(XLSX)) {
    console.log('\n  (la balanza de ejemplo no está aquí — se salta)');
    console.log(`\n═══ ${ok} bien, ${ko} mal ═══\n`);
    await pool.end();
    process.exit(ko ? 1 : 0);
  }

  titulo('8. ★ La balanza real');

  const ex = await bal.leerBalanzaExcel(fs.readFileSync(XLSX));
  const mapeo = map.proponerMapeo(ex.filas, { agrupadoresValidos: await map.agrupadoresValidos() });
  const real = nif.contextoDeBalanza(ex.filas, mapeo, '2026-07-31');
  const jr = ef.juegoCompleto(real, undefined, 212);

  /* El contraste: el activo del estado tiene que ser el mismo que calcula el
   * analizador de balanza, que llega por otro camino. */
  const analisis = bal.analizarBalanza(ex);
  Math.abs(jr.situacionFinanciera.activoTotal - analisis.activo) < 0.02
    ? bien(`★★ el activo del estado (${jr.situacionFinanciera.activoTotal.toFixed(2)}) coincide ` +
           `con el del analizador de balanza`)
    : mal('★★ los dos caminos dan activos distintos',
          { estado: jr.situacionFinanciera.activoTotal, analizador: analisis.activo });

  Math.abs(jr.situacionFinanciera.diferencia - analisis.diferenciaEcuacion) < 0.02
    ? bien(`y la diferencia también: $${jr.situacionFinanciera.diferencia.toFixed(2)}`)
    : mal('las diferencias no coinciden',
          { estado: jr.situacionFinanciera.diferencia, analizador: analisis.diferenciaEcuacion });

  Math.abs(jr.resultadoIntegral.ingresosNetos - 12097259.18) < 1
    ? bien(`ingresos netos del periodo: $${jr.resultadoIntegral.ingresosNetos.toFixed(2)}`)
    : mal('los ingresos no cuadran', jr.resultadoIntegral.ingresosNetos);

  const sinSentido = jr.razones.filter(
    (z) => z.valor !== null && z.unidad === 'DIAS' && z.valor < 0);
  sinSentido.length === 0
    ? bien('★ ninguna razón de días salió negativa sobre datos reales')
    : mal('★ hay razones con valores imposibles', sinSentido.map((z) => `${z.nombre}: ${z.valor}`));

  jr.avisos.length > 0
    ? bien(`y avisa de lo que está mal en el origen: "${jr.avisos[0].slice(0, 62)}…"`)
    : mal('no avisó del descuadre de $20.14 que trae la balanza');

  console.log(`\n═══ ${ok} bien, ${ko} mal ═══\n`);
  await pool.end();
  process.exit(ko ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\n✘ reventó:', e);
  await pool.end();
  process.exit(1);
});
