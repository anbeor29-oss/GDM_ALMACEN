/**
 * probar-extractor-bancos — que lo extraído CUADRE, y que lo dudoso se marque.
 *
 * QUÉ SE ESTÁ PROTEGIENDO
 * Un extractor de estados de cuenta tiene una sola obligación: que la suma de
 * lo que sacó dé el saldo final que declara el documento. Si no cuadra y no lo
 * dice, alguien va a programar pagos contra un saldo inventado.
 *
 * Por eso casi todas las comprobaciones son de CUADRE, no de conteo. Sacar
 * "los 4 movimientos" no sirve de nada si los importes están del lado
 * equivocado — y el conteo saldría igual de bien.
 *
 *   npx ts-node --files -r dotenv/config scripts/probar-extractor-bancos.ts
 *
 * No toca la base.
 */
import {
  extraerMovimientos, aFechaIso, aNumero, repartirImportes,
} from '../src/modules/treasury/extractor-movimientos.service';
import * as bancos from '../src/modules/treasury/bancos.service';
import { pool, query } from '../src/config/database';

let ok = 0, fallos = 0;
const bien = (q: string) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q: string, d?: any) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };
const cerca = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

/* El formato de Bancrea, tal como lo describe la documentación del extractor:
 * fecha DD-MMM-YY, SPEI en varias líneas, comisión de $3.00 e IVA de $0.48. */
const BANCREA = `
BANCREA  ESTADO DE CUENTA  JULIO 2026
Cuenta: 000091234567  SOYBancrea
SALDO INICIAL                                                    23,500.00
FECHA        CONCEPTO                    REFERENCIA         RETIROS    DEPOSITOS   SALDOS
6-JUL-26  TRANSFERENCIA SPEI ENVIADA                          3,500.00              20,000.00
   Bco.Benef: BBVA | Benef: PROVEEDOR UNO SA DE CV | Cta: 012180001234567895
   Cpto: PAGO FACTURA A-123 | Cve.Rastreo: BCREA202607060003071 | Rfc: PUN010101AAA
6-JUL-26  COMISION TRANSFERENCIA SPEI                             3.00              19,997.00
6-JUL-26  IVA DE COMISION                                         0.48              19,996.52
9-JUL-26  TRANSFERENCIA SPEI RECIBIDA                                    5,000.00   24,996.52
   Bco.Ord: SANTANDER | Ordenante: CLIENTE DOS SA | Cta: 014180009876543210
   Cpto: ANTICIPO OBRA | Cve.Rastreo: BNET000091234567890
SALDO FINAL                                                      24,996.52
`;

async function main() {
  /* ── 1. Las piezas sueltas ── */
  aFechaIso('6-JUL-26') === '2026-07-06'
    ? bien('la fecha DD-MMM-YY del PDF se normaliza a ISO')
    : mal('no se normalizó 6-JUL-26', aFechaIso('6-JUL-26'));

  aFechaIso('06/07/2026') === '2026-07-06'
    ? bien('y también DD/MM/AAAA — que es día/mes, no mes/día')
    : mal('06/07/2026 se leyó al revés', aFechaIso('06/07/2026'));

  aFechaIso('31/02/2026') !== '' && aFechaIso('') === ''
    ? bien('una cadena vacía no produce fecha')
    : mal('la fecha vacía devolvió algo');

  aNumero('3,500.00') === 3500 && aNumero('$20,000.00') === 20000
    ? bien('los importes con coma y con signo de pesos se leen bien')
    : mal('un importe no se convirtió');

  /* El reparto por concepto, que es donde el original se equivocaba: suponía
   * que el saldo siempre es 10× el movimiento, y eso falla al vaciarse. */
  const r1 = repartirImportes([3500, 20000], 'TRANSFERENCIA SPEI ENVIADA');
  r1.retiro === 3500 && r1.deposito === 0 && r1.saldo === 20000
    ? bien('con dos importes, "ENVIADA" manda: 3500 sale y 20000 es el saldo')
    : mal('el reparto de una SPEI enviada falló', JSON.stringify(r1));

  const r2 = repartirImportes([5000, 24996.52], 'TRANSFERENCIA SPEI RECIBIDA');
  r2.deposito === 5000 && r2.retiro === 0
    ? bien('y "RECIBIDA" entra, no sale')
    : mal('una SPEI recibida se tomó como retiro', JSON.stringify(r2));

  /* El caso que el original resolvía por magnitud: un movimiento de 900 con
   * saldo de 100. Comparando tamaños, tomaría el saldo como el movimiento. */
  const r3 = repartirImportes([900, 100], 'TRANSFERENCIA SPEI ENVIADA');
  r3.retiro === 900 && r3.saldo === 100
    ? bien('con la cuenta casi vacía (retiro 900, saldo 100) NO se invierten')
    : mal('el reparto se invirtió al quedar poco saldo', JSON.stringify(r3));

  const r4 = repartirImportes([1234.56], 'MOVIMIENTO BANCARIO');
  r4.duda
    ? bien('un importe solo, sin concepto que lo diga, se marca como dudoso')
    : mal('se adivinó el lado de un importe sin decirlo');

  /* ── 2. El estado completo de Bancrea ── */
  const r = extraerMovimientos(BANCREA, { anio: 2026, mes: 7 });

  r.banco === 'Bancrea'
    ? bien('se reconoce el banco por el texto del documento')
    : mal('no se detectó Bancrea', r.banco);

  cerca(r.saldoInicial ?? -1, 23500) && cerca(r.saldoFinal ?? -1, 24996.52)
    ? bien('saldo inicial 23,500.00 y final 24,996.52, del resumen')
    : mal('los saldos del resumen no se leyeron', `${r.saldoInicial} / ${r.saldoFinal}`);

  r.movimientos.length === 4
    ? bien('cuatro movimientos: la SPEI, su comisión, su IVA y la recibida')
    : mal('el conteo de movimientos no cuadra',
          r.movimientos.map((m) => `${m.concepto}=${m.retiro || m.deposito}`).join(' | '));

  /* ── 3. LO QUE DE VERDAD IMPORTA: que cuadre ── */
  r.cuadra
    ? bien('★ CUADRA: inicial − retiros + depósitos = el saldo final que declara el banco')
    : mal('NO cuadra contra el saldo final del documento', r.avisos.join(' · '));

  cerca(r.totalRetiros, 3503.48)
    ? bien(`los retiros suman ${r.totalRetiros.toFixed(2)} — la SPEI, los $3.00 y los $0.48`)
    : mal('los retiros no suman', r.totalRetiros);

  cerca(r.totalDepositos, 5000)
    ? bien('y los depósitos, 5,000.00')
    : mal('los depósitos no suman', r.totalDepositos);

  /* El arrastre debe coincidir renglón por renglón con lo que declara el banco:
   * es lo único que delata un movimiento que el documento se comió. */
  const desfasados = r.movimientos.filter(
    (m) => m.saldo !== null && !cerca(m.saldo, m.saldoCalculado));
  desfasados.length === 0
    ? bien('el saldo arrastrado coincide con el declarado en los cuatro renglones')
    : mal('hay renglones con el saldo desfasado',
          desfasados.map((m) => `${m.concepto}: ${m.saldo} vs ${m.saldoCalculado}`).join(' | '));

  const primero = r.movimientos[0];
  primero.fecha === '2026-07-06' && primero.retiro === 3500
    ? bien('el primer movimiento sale con su fecha y su importe correctos')
    : mal('el primer movimiento salió mal', JSON.stringify(primero));

  /* La referencia de una SPEI vive en las líneas de ABAJO. Si no se juntan, se
   * pierde el beneficiario y la clave de rastreo — que es con lo que se aclara
   * un pago ante el banco. */
  /Cve\.Rastreo: BCREA202607060003071/.test(primero.referencia)
    ? bien('la clave de rastreo, que va en otra línea, viajó con su movimiento')
    : mal('se perdió la referencia multilínea', primero.referencia.slice(0, 80));

  /* ── 4. La comisión que Bancrea omite ── */
  const SIN_COMISION = BANCREA.replace(
    /6-JUL-26  COMISION TRANSFERENCIA SPEI.*\n/, '');
  const r2b = extraerMovimientos(SIN_COMISION, { anio: 2026, mes: 7 });

  r2b.inferidos === 1
    ? bien('si el documento omite la comisión de $3.00, se deduce del hueco de saldos')
    : mal('no se dedujo la comisión faltante', r2b.inferidos);

  const inferido = r2b.movimientos.find((m) => m.inferido);
  inferido && inferido.retiro === 3 && /INFERIDO/.test(inferido.advertencia)
    ? bien('★ y va MARCADA como inferida: el banco no la reportó, y eso se dice')
    : mal('la comisión inferida no quedó marcada', JSON.stringify(inferido));

  r2b.cuadra
    ? bien('con la comisión deducida, el estado vuelve a cuadrar')
    : mal('sigue sin cuadrar tras deducir la comisión', r2b.avisos.join(' · '));

  /* ── 5. Cuando NO cuadra, se dice ──
   * Es la comprobación que más vale: un extractor que calla un descuadre es
   * peor que uno que no extrae nada. */
  const MUTILADO = BANCREA.replace(
    /9-JUL-26  TRANSFERENCIA SPEI RECIBIDA.*\n/, '');
  const r3b = extraerMovimientos(MUTILADO, { anio: 2026, mes: 7 });

  !r3b.cuadra && r3b.avisos.some((a) => /NO CUADRA/.test(a))
    ? bien('★ si falta un movimiento, NO cuadra y lo dice con la diferencia exacta')
    : mal('un estado incompleto pasó como bueno');

  r3b.avisos.some((a) => /5000\.00|5,000\.00/.test(a))
    ? bien('y la diferencia que reporta es justo el movimiento que falta')
    : mal('la diferencia reportada no señala lo que falta', r3b.avisos.join(' · '));

  /* ── 6. Un documento vacío o ilegible no inventa nada ── */
  const vacio = extraerMovimientos('esto no es un estado de cuenta', {});
  vacio.movimientos.length === 0 && vacio.avisos.some((a) => /No se reconoció/.test(a))
    ? bien('un texto que no es un estado de cuenta no produce movimientos, y avisa')
    : mal('se inventaron movimientos de la nada', vacio.movimientos.length);

  /* ── 7. Un formato distinto: fechas DD/MM/AAAA y columnas separadas ── */
  const OTRO = `
BBVA BANCOMER — ESTADO DE CUENTA
SALDO ANTERIOR 10,000.00
01/08/2026 DEPOSITO EN EFECTIVO REF 998877 2,500.00 12,500.00
03/08/2026 RETIRO EN EFECTIVO CAJERO 4411 1,000.00 11,500.00
SALDO FINAL 11,500.00
`;
  const r4b = extraerMovimientos(OTRO, { anio: 2026, mes: 8 });
  r4b.cuadra && r4b.movimientos.length === 2
    ? bien('otro banco, otro formato de fecha, y también cuadra')
    : mal('el formato DD/MM/AAAA no se procesó', JSON.stringify({
        cuadra: r4b.cuadra, n: r4b.movimientos.length, avisos: r4b.avisos }));

  /* ── 8. De extremo a extremo, contra la base ──
   *
   * Lo que se prueba aquí no es el extractor sino la CARGA: que volver a subir
   * el mismo mes REEMPLACE en vez de acumular. Cargar dos veces julio y quedarse
   * con los movimientos duplicados daría un saldo del doble, y nadie lo notaría
   * hasta cuadrar contra el banco. */
  const c = await query('SELECT id FROM companies WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1');
  const companyId = (c.rows[0] as any).id;
  const limpiar = () =>
    query("DELETE FROM bancos_cuentas WHERE company_id=$1 AND alias LIKE 'ZZ %'", [companyId]);
  await limpiar();

  const cuenta = await bancos.crearCuenta(companyId, {
    bancoNombre: 'Bancrea', alias: 'ZZ prueba', clabe: '012180001234567895',
    saldoInicial: 23500, saldoInicialFecha: '2026-06-30',
  });
  cuenta.id
    ? bien('la cuenta se da de alta con su CLABE y su saldo de partida')
    : mal('no se creó la cuenta');

  try {
    await bancos.crearCuenta(companyId, {
      bancoNombre: 'Otro', alias: 'ZZ repetida', clabe: '012180001234567895' });
    mal('aceptó dos cuentas con la misma CLABE');
  } catch (e: any) {
    /misma CLABE/.test(e.message)
      ? bien('dos cuentas con la misma CLABE se rechazan: es captura, no dos cuentas')
      : mal('rechazó con otro mensaje', e.message);
  }

  try {
    await bancos.crearCuenta(companyId, { bancoNombre: 'X', alias: '' });
    mal('aceptó una cuenta sin nombre');
  } catch (e: any) {
    /nombre a la cuenta/.test(e.message)
      ? bien('una cuenta sin nombre se rechaza diciendo para qué sirve el nombre')
      : mal('rechazó con otro mensaje', e.message);
  }

  try {
    await bancos.crearCuenta(companyId, { bancoNombre: 'X', alias: 'ZZ mala', clabe: '123' });
    mal('aceptó una CLABE de 3 dígitos');
  } catch (e: any) {
    /18 d/.test(e.message)
      ? bien('una CLABE que no trae 18 dígitos se rechaza')
      : mal('rechazó con otro mensaje', e.message);
  }

  const carga1 = await bancos.cargarEstadoDeCuenta(companyId, {
    cuentaId: cuenta.id, anio: 2026, mes: 7, texto: BANCREA });
  carga1.extraccion.cuadra && !carga1.reemplazo
    ? bien('el estado de julio se carga y cuadra')
    : mal('la primera carga falló', JSON.stringify(carga1.extraccion.avisos));

  const carga2 = await bancos.cargarEstadoDeCuenta(companyId, {
    cuentaId: cuenta.id, anio: 2026, mes: 7, texto: BANCREA });
  carga2.reemplazo
    ? bien('volver a subir julio se anuncia como REEMPLAZO, no como carga nueva')
    : mal('la segunda carga no se reconoció como reemplazo');

  const n = await query('SELECT COUNT(*)::int n FROM bancos_movimientos WHERE cuenta_id=$1',
    [cuenta.id]);
  (n.rows[0] as any).n === 4
    ? bien('★ y siguen siendo 4 movimientos, no 8: reemplaza, no acumula')
    : mal('los movimientos se duplicaron al recargar', (n.rows[0] as any).n);

  const lista = await bancos.listarCuentas(companyId);
  const mia: any = lista.find((x: any) => x.id === cuenta.id);
  Math.abs(Number(mia.saldo_al_corte) - 24996.52) < 0.02 && mia.corte === '07/2026'
    ? bien(`el saldo al corte es 24,996.52 y se dice de cuándo: ${mia.corte}`)
    : mal('el saldo al corte no cuadra', `${mia?.saldo_al_corte} / ${mia?.corte}`);

  /* Agosto arranca donde julio terminó. */
  await bancos.cargarEstadoDeCuenta(companyId, {
    cuentaId: cuenta.id, anio: 2026, mes: 8,
    texto: 'SALDO INICIAL 24,996.52\n' +
           '01/08/2026 DEPOSITO EN EFECTIVO REF 1 1,000.00 25,996.52\n' +
           'SALDO FINAL 25,996.52\n',
  });
  const ctrl = await bancos.controlMensual(companyId, cuenta.id);
  ctrl.meses.length === 2 && ctrl.saltos.length === 0
    ? bien('julio y agosto encadenan: el final de uno es el inicial del otro')
    : mal('se detectó un salto donde no lo hay', ctrl.saltos.join(' · '));

  /* Y un mes que NO encadena se señala: es lo que delata el mes que falta. */
  await bancos.cargarEstadoDeCuenta(companyId, {
    cuentaId: cuenta.id, anio: 2026, mes: 9,
    texto: 'SALDO INICIAL 99,000.00\n' +
           '02/09/2026 RETIRO EN EFECTIVO CAJERO 500.00 98,500.00\n' +
           'SALDO FINAL 98,500.00\n',
  });
  const ctrl2 = await bancos.controlMensual(companyId, cuenta.id);
  ctrl2.saltos.length === 1 && ctrl2.saltos[0].includes('08/2026')
    ? bien('★ un mes que no encadena con el anterior se señala, con las dos cifras')
    : mal('no se detectó el salto de saldo entre meses', JSON.stringify(ctrl2.saltos));

  await limpiar();
  await pool.end();

  console.log(`\n${ok} bien, ${fallos} mal`);
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
