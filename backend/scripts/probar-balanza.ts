/**
 * Pruebas del lector de balanzas — Excel contra PDF.
 *
 * ── LA PRUEBA QUE DE VERDAD VALE ──
 * Los dos archivos de ejemplo son LA MISMA BALANZA en dos formatos. Así que el
 * lector de PDF —que tiene que despegar '-382.000.000.00-382.00' y recomponer
 * nombres partidos en tres líneas— debe dar exactamente lo mismo que el de
 * Excel, cuenta por cuenta y centavo por centavo.
 *
 * Una comprobación así no se puede fingir: si el PDF se lee mal en un solo
 * renglón, salta.
 *
 * ── LOS ARCHIVOS NO ESTÁN EN EL REPOSITORIO ──
 * Son la contabilidad real de una empresa que no es nuestra. Se leen de una
 * carpeta local y la prueba se salta sola si no están, para que no reviente en
 * Render ni en el equipo de nadie más.
 *
 *   BALANZA_XLSX=/ruta/al.xlsx BALANZA_PDF=/ruta/al.pdf npm run probar:balanza
 */

import fs from 'fs';
import path from 'path';
import * as bal from '../src/modules/accounting/balanza-lector.service';

let ok = 0, ko = 0;
const bien = (m: string) => { ok++; console.log(`  ✔ ${m}`); };
const mal = (m: string, x?: any) => {
  ko++; console.log(`  ✘ ${m}${x !== undefined ? `  → ${JSON.stringify(x)}` : ''}`);
};
const titulo = (t: string) => console.log(`\n${t}`);

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const XLSX = process.env.BALANZA_XLSX
  || path.join(HOME, 'Downloads', 'BALANZA_DE_COMPROBACIÓN_PRO1401108F6_31072026_13073225.xlsx');
const PDF = process.env.BALANZA_PDF
  || path.join(HOME, 'Downloads', 'BALANZA_DE_COMPROBACIÓN_PRO1401108F6_31072026_13073230.pdf');

async function main() {
  console.log('\n═══ BALANZA · lector ═══');

  /* ── 1. Los números, sin archivos ── */
  titulo('1. Separar importes pegados');

  const casos: Array<[string, number[]]> = [
    ['-382.000.000.00-382.00',                 [-382, 0, 0, -382]],
    ['7,338,428.861,167,152.361,120,498.247,385,082.98',
                                               [7338428.86, 1167152.36, 1120498.24, 7385082.98]],
    ['-4,850.3310.360.00-4,839.97',            [-4850.33, 10.36, 0, -4839.97]],
    ['6,571,343.00762,200.47763,786.486,569,756.99',
                                               [6571343, 762200.47, 763786.48, 6569756.99]],
  ];
  for (const [txt, esperado] of casos) {
    const r = bal.importesPegados(txt);
    JSON.stringify(r) === JSON.stringify(esperado)
      ? bien(`"${txt.slice(0, 30)}…" → ${r.length} importes correctos`)
      : mal(`mal separado: "${txt}"`, { salió: r, debía: esperado });
  }

  /* El caso que rompe la lectura por la izquierda: dígitos en el nombre. */
  const conNombre = bal.importesPegados('CI BANCO 25018-309,047.100.000.00-309,047.10');
  JSON.stringify(conNombre.slice(-4)) === JSON.stringify([-309047.10, 0, 0, -309047.10])
    ? bien('★ "CI BANCO 25018" no se confunde con un importe')
    : mal('el número de cuenta del banco se coló como importe', conNombre);

  bal.aNumero('(1,234.56)') === -1234.56
    ? bien('el paréntesis contable se lee como negativo')
    : mal('no interpretó el paréntesis', bal.aNumero('(1,234.56)'));

  /* ── 1-bis. El nombre pegado al importe ── */
  titulo('1-bis. Cuando el final del nombre se pega al saldo');

  /* 'RESULTADO EJERCICIOS ANTERIORES 2024' + '1,653,827.35' → '20241,653,827.35' */
  const cand = bal.lecturasPosibles('20241,653,827.35');
  cand.length > 1
    ? bien(`admite ${cand.length} lecturas: ${cand.join(', ')}`)
    : mal('no detectó la ambigüedad', cand);

  cand.includes(1653827.35)
    ? bien('★ y la correcta (1,653,827.35) está entre ellas')
    : mal('la lectura correcta no aparece', cand);

  /* Lo importante: NO se queda con una a la brava. */
  cand[0] === 20241653827.35
    ? bien('la primera sigue siendo la lectura literal: no se recorta a ciegas')
    : mal('descartó la lectura literal', cand[0]);

  bal.lecturasPosibles('1,653,827.35').length === 1
    ? bien('★ un importe bien formado NO se toca: una sola lectura')
    : mal('inventó ambigüedad donde no la hay', bal.lecturasPosibles('1,653,827.35'));

  bal.lecturasPosibles('-309,047.10').length === 1
    ? bien('tampoco uno negativo normal')
    : mal('ambigüedad falsa en negativo');

  /* Un grupo interior que no es de 3 = formato inesperado: no se toca nada. */
  bal.lecturasPosibles('12345,67,890.00').length === 1
    ? bien('con separadores irregulares se deja tal cual, sin recortar a la calada')
    : mal('recortó un formato que no entendía');

  /* El desempate en un renglón completo, por la vía del PDF. */
  const linea = '3-10-30-001ARESULTADO EJERCICIOS ANTERIORES 202420241,653,827.350.000.001,653,827.35';
  const leido = bal.leerBalanzaTexto(linea);
  const f0 = leido.filas[0];
  f0 && Math.abs(f0.saldoInicial - 1653827.35) < 0.01
    ? bien('★★ el renglón completo se resuelve por su propia aritmética: ' +
           `saldo inicial ${f0.saldoInicial}`)
    : mal('no resolvió el renglón ambiguo', f0);

  /* ── 2. Hojas y sumarias ── */
  titulo('2. Una hoja es la que no tiene hijos (no la que termina en -000)');

  const muestra: bal.FilaBalanza[] = [
    { cuenta: '1-10-20-000', naturaleza: 'D', nombre: 'BANCOS',    saldoInicial: 0, debe: 0, haber: 0, saldoFinal: 300 },
    { cuenta: '1-10-20-009', naturaleza: 'D', nombre: 'AFIRME',    saldoInicial: 0, debe: 0, haber: 0, saldoFinal: 100 },
    { cuenta: '1-10-20-011', naturaleza: 'D', nombre: 'CI BANCO',  saldoInicial: 0, debe: 0, haber: 0, saldoFinal: 200 },
    /* Termina en -000 y NO tiene hijos: es hoja, y trae saldo propio. */
    { cuenta: '5-05-10-000', naturaleza: 'D', nombre: 'REFACCIONES', saldoInicial: 0, debe: 0, haber: 0, saldoFinal: 7517623 },
  ];
  const marcadas = bal.marcarHojas(muestra);
  const h = (c: string) => marcadas.find((f) => f.cuenta === c)!.hoja;

  h('1-10-20-000') === false
    ? bien('1-10-20-000 BANCOS es sumaria: tiene dos hijas')
    : mal('marcó BANCOS como hoja');
  h('1-10-20-009') === true && h('1-10-20-011') === true
    ? bien('sus dos hijas son hojas')
    : mal('no marcó las hijas como hojas');
  h('5-05-10-000') === true
    ? bien('★ 5-05-10-000 termina en -000 y ES hoja: nadie cuelga de ella')
    : mal('★ descartó una hoja por su sufijo — así se pierden $7.5M de costos');

  marcadas.find((f) => f.cuenta === '1-10-20-009')!.padre === '1-10-20-000'
    ? bien('y el padre queda amarrado correctamente')
    : mal('no encontró el padre');

  /* ── 3. La fórmula depende de la naturaleza ── */
  titulo('3. El saldo final según la naturaleza');

  const deudora: bal.FilaBalanza = { cuenta: '1-1', naturaleza: 'D', nombre: '',
    saldoInicial: 6516.15, debe: 7351.01, haber: 7020.33, saldoFinal: 0 };
  Math.abs(bal.saldoFinalEsperado(deudora) - 6846.83) < 0.01
    ? bien('deudora:   inicial + debe − haber')
    : mal('fórmula deudora mal', bal.saldoFinalEsperado(deudora));

  const acreedora: bal.FilaBalanza = { ...deudora, naturaleza: 'A' };
  Math.abs(bal.saldoFinalEsperado(acreedora) - 6185.47) < 0.01
    ? bien('★ acreedora: inicial − debe + haber (con los MISMOS números, otro saldo)')
    : mal('fórmula acreedora mal', bal.saldoFinalEsperado(acreedora));

  /* ── 4. Los archivos reales ── */
  if (!fs.existsSync(XLSX) || !fs.existsSync(PDF)) {
    console.log('\n  (los archivos de ejemplo no están aquí — se salta la comparación)');
    console.log(`  esperados en:\n    ${XLSX}\n    ${PDF}`);
    console.log(`\n═══ ${ok} bien, ${ko} mal ═══\n`);
    process.exit(ko ? 1 : 0);
  }

  titulo('4. El archivo real de Excel');

  const ex = await bal.leerBalanzaExcel(fs.readFileSync(XLSX));
  ex.filas.length > 300
    ? bien(`${ex.filas.length} renglones leídos`)
    : mal('leyó muy pocos renglones', ex.filas.length);

  ex.encabezado.rfc === 'PRO1401108F6'
    ? bien(`membrete: ${ex.encabezado.razonSocial} · ${ex.encabezado.rfc} · ${ex.encabezado.moneda}`)
    : mal('no leyó el RFC del membrete', ex.encabezado);

  const anEx = bal.analizarBalanza(ex);
  anEx.hojas + anEx.sumarias === anEx.totalFilas
    ? bien(`${anEx.hojas} hojas y ${anEx.sumarias} sumarias`)
    : mal('la partición no cuadra');

  Math.abs(anEx.diferenciaMovimientos) <= 0.02
    ? bien(`★ Σ Debe = Σ Haber = ${anEx.sumaDebe.toFixed(2)} — la balanza cuadra`)
    : mal('los movimientos no cuadran', anEx.diferenciaMovimientos.toFixed(2));

  const conCostos = anEx.porTipo.find((t) => t.tipo === 'COSTOS');
  conCostos && conCostos.saldoFinal > 7_000_000
    ? bien(`★ los COSTOS aparecen: ${conCostos.saldoFinal.toFixed(2)} en ${conCostos.cuentas} cuentas`)
    : mal('★ se perdieron los costos — es el bug del sufijo -000', conCostos);

  console.log(`     ecuación: activo ${anEx.activo.toFixed(2)} vs P+C+R ` +
              `${anEx.pasivoCapitalResultado.toFixed(2)} → dif ${anEx.diferenciaEcuacion.toFixed(2)}`);

  const erroresEx = anEx.avisos.filter((a) => a.nivel === 'ERROR');
  erroresEx.length === 0
    ? bien('ningún renglón descuadra consigo mismo')
    : mal('hay errores en la balanza', erroresEx.map((a) => a.mensaje));

  /* ── 5. EL PDF, contra el Excel ── */
  titulo('5. ★ El PDF tiene que dar lo MISMO que el Excel');

  const pd = await bal.leerBalanzaPdf(fs.readFileSync(PDF));
  pd.filas.length === ex.filas.length
    ? bien(`mismo número de renglones: ${pd.filas.length}`)
    : mal(`el PDF trae ${pd.filas.length} y el Excel ${ex.filas.length}`);

  const porCta = new Map(ex.filas.map((f) => [f.cuenta, f]));
  let iguales = 0;
  const difs: string[] = [];
  for (const p of pd.filas) {
    const e = porCta.get(p.cuenta);
    if (!e) { difs.push(`${p.cuenta} está en el PDF y no en el Excel`); continue; }
    const casi = (a: number, b: number) => Math.abs(a - b) <= 0.005;
    if (casi(p.saldoInicial, e.saldoInicial) && casi(p.debe, e.debe)
        && casi(p.haber, e.haber) && casi(p.saldoFinal, e.saldoFinal)
        && p.naturaleza === e.naturaleza) iguales++;
    else difs.push(
      `${p.cuenta}: pdf(${p.saldoInicial},${p.debe},${p.haber},${p.saldoFinal}) ` +
      `≠ xlsx(${e.saldoInicial},${e.debe},${e.haber},${e.saldoFinal})`);
  }
  iguales === ex.filas.length
    ? bien(`★★ los ${iguales} renglones coinciden centavo por centavo`)
    : mal(`${difs.length} renglón(es) difieren`, difs.slice(0, 6));

  /* El renglón con el nombre partido en tres líneas del PDF. */
  const partido = pd.filas.find((f) => f.cuenta === '1-10-25-005');
  partido && /NOE ALFREDO SALAS/.test(partido.nombre) && partido.saldoFinal === -382
    ? bien(`★ el nombre partido en 3 líneas se recompuso: "${partido.nombre}"`)
    : mal('el nombre partido no se recompuso', partido);

  const banco = pd.filas.find((f) => f.cuenta === '1-10-20-011');
  banco && banco.saldoInicial === -309047.10
    ? bien(`★ "${banco.nombre}" — el 25018 del nombre no se tomó por saldo`)
    : mal('el número del nombre contaminó el saldo', banco);

  const anPdf = bal.analizarBalanza(pd);
  Math.abs(anPdf.sumaDebe - anEx.sumaDebe) <= 0.02
    ? bien('y los totales del análisis coinciden entre los dos formatos')
    : mal('los totales difieren', { pdf: anPdf.sumaDebe, xlsx: anEx.sumaDebe });

  console.log(`\n═══ ${ok} bien, ${ko} mal ═══\n`);
  process.exit(ko ? 1 : 0);
}

main().catch((e) => { console.error('\n✘ reventó:', e); process.exit(1); });
