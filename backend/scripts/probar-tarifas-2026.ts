/**
 * probar-tarifas-2026 — que lo cargado sea de verdad lo del DOF.
 *
 * No basta con que el INSERT haya pasado: hay que ver que los escalones cierren
 * sin huecos, que el motor tome el renglón correcto y que el resultado cuadre
 * con la aritmética del Art. 96 hecha aparte, a mano. Si el ISR de un
 * trabajador sale mal, sale mal para toda la plantilla y se descubre hasta la
 * anual.
 *
 *   npx ts-node -r dotenv/config scripts/probar-tarifas-2026.ts
 *
 * No escribe nada.
 */
import { pool, query } from '../src/config/database';
import * as ejercicios from '../src/modules/nomina/ejercicios.service';
import { calcularIsr, calcularRecibo, FACTOR } from '../src/modules/nomina/motor';

let ok = 0, fallos = 0;
const bien = (q: string) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q: string, d?: any) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };
const cerca = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

async function main() {
  /* ── 1. Los escalones cierran ────────────────────────────────────────
   * Un hueco entre el límite superior de un renglón y el inferior del
   * siguiente deja bases sin tarifa: el motor no encuentra renglón y retiene
   * de menos sin avisar. */
  for (const p of ['MENSUAL', 'SEMANAL', 'QUINCENAL']) {
    const r = await query<any>(
      `SELECT renglon, limite_inferior li, limite_superior ls, cuota_fija cf, porcentaje pc
         FROM nomina_tarifa_isr WHERE anio = 2026 AND periodicidad = $1 ORDER BY renglon`,
      [p]
    );
    if (r.rows.length !== 11) { mal(`${p}: se esperaban 11 renglones`, r.rows.length); continue; }

    let sano = true;
    for (let i = 0; i < r.rows.length - 1; i++) {
      const ls = Number(r.rows[i].ls), siguiente = Number(r.rows[i + 1].li);
      if (!cerca(siguiente - ls, 0.01, 0.0001)) {
        mal(`${p}: hueco entre el renglón ${i + 1} y el ${i + 2}`, `${ls} -> ${siguiente}`);
        sano = false;
      }
      if (Number(r.rows[i + 1].pc) <= Number(r.rows[i].pc)) {
        mal(`${p}: el porcentaje no es creciente en el renglón ${i + 2}`);
        sano = false;
      }
    }
    if (Number(r.rows[0].li) !== 0.01) { mal(`${p}: no empieza en 0.01`); sano = false; }
    if (r.rows[10].ls !== null)        { mal(`${p}: el último renglón debe ser abierto`); sano = false; }
    if (sano) bien(`${p}: 11 renglones contiguos, sin huecos y con tasa creciente`);
  }

  /* ── 2. La continuidad de la cuota fija ──────────────────────────────
   * La cuota fija de un renglón tiene que ser el impuesto acumulado justo
   * antes de entrar a él. Si no cuadra, la tabla se transcribió mal: es la
   * prueba que caza un dígito volteado. */
  const m = await query<any>(
    `SELECT limite_inferior li, limite_superior ls, cuota_fija cf, porcentaje pc
       FROM nomina_tarifa_isr WHERE anio = 2026 AND periodicidad = 'MENSUAL' ORDER BY renglon`
  );
  let cuadran = 0;
  for (let i = 0; i < m.rows.length - 1; i++) {
    const r = m.rows[i], sig = m.rows[i + 1];
    const acumulado = Number(r.cf) + (Number(r.ls) - Number(r.li)) * Number(r.pc) / 100;
    if (cerca(acumulado, Number(sig.cf), 0.60)) cuadran++;
    else mal(`la cuota fija del renglón ${i + 2} no continúa la del ${i + 1}`,
             `calculada ${acumulado.toFixed(2)} vs guardada ${sig.cf}`);
  }
  if (cuadran === m.rows.length - 1) {
    bien('MENSUAL: cada cuota fija continúa el impuesto acumulado del renglón anterior');
  }

  /* ── 3. La vigencia del subsidio ─────────────────────────────────────
   * El transitorio segundo del decreto manda 15.59% en enero y 15.02% de
   * febrero en adelante. Cargar el de febrero para un periodo de enero le
   * daría al trabajador un subsidio que no le tocaba. */
  const enero  = await ejercicios.cargar(2026, '2026-01-15');
  const agosto = await ejercicios.cargar(2026, '2026-08-15');

  enero.subsidio.length === 1 && cerca(enero.subsidio[0].subsidio, 536.21)
    ? bien('enero toma el subsidio del transitorio: $536.21 (15.59% de la UMA de 2025)')
    : mal('el subsidio de enero no es el del transitorio', JSON.stringify(enero.subsidio));

  agosto.subsidio.length === 1 && cerca(agosto.subsidio[0].subsidio, 535.65)
    ? bien('agosto toma el subsidio general: $535.65 (15.02% de la UMA de 2026)')
    : mal('el subsidio de agosto está mal', JSON.stringify(agosto.subsidio));

  cerca(agosto.subsidio[0].limite_superior || 0, 11492.66)
    ? bien('el tope de ingresos del subsidio es $11,492.66')
    : mal('el tope de ingresos del subsidio está mal');

  /* ── 4. La UMA es internamente consistente ───────────────────────────
   * La mensual es la diaria por 30.4. La semilla anterior fallaba justo aquí:
   * traía la diaria de un año y la mensual de otro. */
  cerca(agosto.umaDiaria * 30.4, agosto.umaMensual, 0.02)
    ? bien(`la UMA cuadra: ${agosto.umaDiaria} x 30.4 = ${agosto.umaMensual}`)
    : mal('la UMA mensual no es la diaria por 30.4',
          `${agosto.umaDiaria} x 30.4 = ${(agosto.umaDiaria * 30.4).toFixed(2)} vs ${agosto.umaMensual}`);

  cerca(agosto.smgGeneral, 315.04) && cerca(agosto.smgFrontera, 440.87)
    ? bien('salarios mínimos 2026: general $315.04, frontera norte $440.87')
    : mal('los salarios mínimos no son los de 2026');

  /* ── 5. El ISR, cotejado a mano ──────────────────────────────────────
   * Se toma el caso real de la pantalla: sueldo semanal de $2,354.03. La
   * aritmética del Art. 96 se hace aquí aparte, con los números del Anexo 8
   * escritos a mano, y se compara contra lo que devuelve el motor. */
  const baseSemanal = 2354.03;
  const f = FACTOR.SEMANAL;                    // 30.4 / 7
  const baseMensual = baseSemanal * f;         // 10,222.44

  // Renglón 3 del Anexo 8: 7,168.52 a 12,598.02, cuota 420.95, 10.88%
  const esperadoMensual = 420.95 + (baseMensual - 7168.52) * 0.1088;
  const esperadoNeto    = Math.max(esperadoMensual - 535.65, 0);
  const esperadoSemanal = esperadoNeto / f;

  const r = calcularIsr(baseSemanal, 'SEMANAL', agosto);

  cerca(r.baseMensual, baseMensual, 0.02)
    ? bien(`mensualiza bien: $${baseSemanal} semanal -> $${r.baseMensual.toFixed(2)} mensual`)
    : mal('la mensualización no cuadra', `${r.baseMensual} vs ${baseMensual.toFixed(2)}`);

  r.renglon === 3
    ? bien('cae en el renglón 3 del Anexo 8 (7,168.52 a 12,598.02)')
    : mal('cayó en otro renglón', r.renglon);

  cerca(r.isr, esperadoSemanal, 0.02)
    ? bien(`ISR semanal $${r.isr.toFixed(2)} — igual al cálculo hecho a mano`)
    : mal('el ISR no cuadra con el cálculo a mano',
          `motor ${r.isr.toFixed(2)} vs a mano ${esperadoSemanal.toFixed(2)}`);

  console.log(`\n      a mano: 420.95 + (${baseMensual.toFixed(2)} - 7,168.52) x 10.88% = ` +
              `${esperadoMensual.toFixed(2)} mensual`);
  console.log(`              menos subsidio 535.65 = ${esperadoNeto.toFixed(2)} ; ` +
              `entre ${f.toFixed(6)} = ${esperadoSemanal.toFixed(2)} semanal`);
  console.log(`       motor: ${r.isr.toFixed(2)} semanal, subsidio aplicado ${r.subsidio.toFixed(2)}\n`);

  /* ── 6. El salario mínimo no paga ISR ────────────────────────────────
   * Art. 93 Fr. XIV. Ojo: la exención NO vive en calcularIsr —esa función es
   * la aritmética pura del Art. 96— sino en calcularRecibo, porque exime al
   * TRABAJADOR, no al concepto: en cuanto recibe otro ingreso gravado la
   * pierde. Por eso se prueba por el camino completo y se prueban los dos
   * lados de la regla. */
  const minimo = calcularRecibo(
    { salarioDiario: 315.04, sdi: 330, dias: 7, zona: 'general', periodicidad: 'SEMANAL' },
    agosto
  );
  minimo.isr === 0 && minimo.imss === 0
    ? bien(`al mínimo ($${(315.04 * 7).toFixed(2)} a la semana): sin ISR y sin cuota obrera`)
    : mal('al salario mínimo le salió retención', `isr ${minimo.isr} imss ${minimo.imss}`);

  const minimoConBono = calcularRecibo(
    { salarioDiario: 315.04, sdi: 330, dias: 7, zona: 'general', periodicidad: 'SEMANAL',
      otrosIngresos: [{ clave: '010', importe: 1500 }] },
    agosto
  );
  minimoConBono.isr > 0
    ? bien('con otro ingreso gravado pierde la exención y sí retiene (Art. 93 Fr. XIV)')
    : mal('siguió exento aun con otro ingreso gravado');

  /* ── 7. Las revisiones que ya trae el servicio ───────────────────────*/
  const d = await ejercicios.detalle(2026);
  const avisos: string[] = (d as any).avisos || [];
  avisos.length === 0
    ? bien('el ejercicio 2026 no levanta ningún aviso')
    : mal('el ejercicio levanta avisos', avisos.join(' | '));

  console.log(`${ok} bien, ${fallos} mal\n`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
