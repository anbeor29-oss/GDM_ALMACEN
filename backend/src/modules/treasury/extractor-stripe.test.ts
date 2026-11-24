/**
 * Stripe — cobrador de pagos, no banco.
 *
 * Lo que se prueba es lo que el usuario pidió controlar: los SALDOS (inicial y
 * final) y la COMISIÓN del periodo con su IVA desglosado (÷1.16, porque Stripe
 * la cobra con IVA incluido). Y el caso real: el PDF que escribe las cifras de
 * la tabla en una fuente ilegible, donde los renglones se pierden pero los
 * saldos y los totales NO — ahí el lector tiene que avisar, no inventar ceros.
 */
import { extraerMovimientos } from './extractor-movimientos.service';

/* El resumen TAL CUAL sale del estado real de octubre 2026 (las cifras de la
 * tabla no se incluyen porque el PDF no las entrega: ver el último caso). */
const RESUMEN_REAL = `
CLARIUS · GLOBAL FLUENCY NETWORK, S.C.
Estado de Cuenta Stripe  Movimientos de Octubre 2026
Periodo: 1  31 de octubre 2026 UTC · Moneda: MXN · Cuenta: Clarius
COBROS (BRUTO)
$57,891.93
COMISIONES STRIPE
$2,913.15
ACTIVIDAD NETA
$54,978.78
PAGOS A BANCO
$102,004.22
Resumen: Saldo inicial $62,241.30 30 sep)  Actividad neta $54,978.78  Pagos a banco $102,004.22  Saldo final $15,215.86 31 oct).
Comisiones Stripe del mes: $2,913.15 $2,459.30 por cobros  $453.85 cargos de facturación) — respaldadas por el CFDI 202610 para IVA
acreditable.
`;

describe('Stripe · lo que hay que controlar', () => {
  test('se reconoce como Stripe y no como un banco', () => {
    expect(extraerMovimientos(RESUMEN_REAL).banco).toBe('Stripe');
  });

  test('la palabra «Stripe» sola, como contraparte de un SPEI, NO lo hace un estado de Stripe', () => {
    const bancario = `BANCO MERCANTIL DEL NORTE, S.A. BNO951005
      SALDO ANTERIOR 1,000.00
      01-OCT-26 TRANSFERENCIA SPEI RECIBIDA STRIPE PAYMENTS MEXICO 500.00 1,500.00
      SALDO FINAL 1,500.00`;
    expect(extraerMovimientos(bancario).banco).not.toBe('Stripe');
  });

  test('saca los saldos inicial y final del resumen', () => {
    const r = extraerMovimientos(RESUMEN_REAL);
    expect(r.saldoInicial).toBe(62241.30);
    expect(r.saldoFinal).toBe(15215.86);
  });

  test('desglosa el IVA de la comisión dividiendo entre 1.16', () => {
    const r = extraerMovimientos(RESUMEN_REAL);
    expect(r.comisiones).toBeDefined();
    expect(r.comisiones!.total).toBe(2913.15);
    expect(r.comisiones!.base).toBe(2511.34);     // 2,913.15 / 1.16
    expect(r.comisiones!.iva).toBe(401.81);       // la diferencia
    expect(r.comisiones!.tasa).toBe(0.16);
    /* base + IVA tiene que volver al total: si no, el gasto y el acreditable
     * no sumarían lo que Stripe cobró. */
    expect(r.comisiones!.base + r.comisiones!.iva).toBeCloseTo(2913.15, 2);
  });

  test('reparte la comisión entre la retenida en los cobros y los cargos de facturación', () => {
    const c = extraerMovimientos(RESUMEN_REAL).comisiones!;
    expect(c.porCobros).toBe(2459.30);
    expect(c.porFacturacion).toBe(453.85);
  });

  test('cuadra por el resumen: inicial + actividad neta − pagos a banco = final', () => {
    expect(extraerMovimientos(RESUMEN_REAL).cuadra).toBe(true);
  });

  test('si el resumen NO cuadra, lo dice con las cifras', () => {
    const r = extraerMovimientos(RESUMEN_REAL.replace('Saldo final $15,215.86', 'Saldo final $15,999.99'));
    expect(r.cuadra).toBe(false);
    expect(r.avisos.join(' ')).toMatch(/NO CUADRA EL RESUMEN/);
  });
});

describe('Stripe · el acomodo del detalle (positivos por día, negativos uno por uno)', () => {
  /* Un periodo chico pero consistente: dos cobros el mismo día, un cargo de
   * facturación y un payout. 1,000.00 + 1,160.00 − 34.80 − 11.60 − 2,000.00 = 113.60 */
  const CON_CIFRAS = `
Estado de Cuenta Stripe  Movimientos de Octubre 2026
FECHACONCEPTOTIPOIMPORTECOMISIÓNNETO
20261003Plan Profesional  Inglés EjecutivoCobro$1,000.00 $30.00 $970.00
20261003Actualización de suscripciónCobro$160.00 $4.80 $155.20
20261004Comisión de facturación 03 oct)Comisión Stripe$11.60
20261005Payout a bancoPago a banco-$2,000.00 -$2,000.00
Resumen: Saldo inicial $1,000.00  Actividad neta $1,113.60  Pagos a banco $2,000.00  Saldo final $113.60.
Comisiones Stripe del mes: $46.40 $34.80 por cobros  $11.60 cargos de facturación)
`;

  test('los COBROS del mismo día se suman en UN solo depósito, por su importe (bruto)', () => {
    const r = extraerMovimientos(CON_CIFRAS);
    const dep = r.movimientos.filter((m) => m.deposito > 0);
    expect(dep).toHaveLength(1);
    expect(dep[0].fecha).toBe('2026-10-03');
    expect(dep[0].deposito).toBe(1160);            // 1,000.00 + 160.00, no el neto
    expect(dep[0].concepto).toMatch(/2 movimientos/);
  });

  test('la comisión retenida del día SALE del saldo, en su propio renglón', () => {
    const r = extraerMovimientos(CON_CIFRAS);
    const com = r.movimientos.find((m) => /retenida/i.test(m.concepto))!;
    expect(com.fecha).toBe('2026-10-03');
    expect(com.retiro).toBe(34.80);                 // 30.00 + 4.80
    expect(com.deposito).toBe(0);
  });

  test('los NEGATIVOS van uno por uno, con su fecha', () => {
    const r = extraerMovimientos(CON_CIFRAS);
    const com = r.movimientos.find((m) => /facturación/.test(m.concepto))!;
    const pay = r.movimientos.find((m) => /Payout/.test(m.concepto))!;
    expect([com.fecha, com.retiro]).toEqual(['2026-10-04', 11.60]);
    expect([pay.fecha, pay.retiro]).toEqual(['2026-10-05', 2000]);
    expect(pay.deposito).toBe(0);
  });

  test('el arrastre del saldo llega al final declarado', () => {
    const r = extraerMovimientos(CON_CIFRAS);
    expect(r.movimientos).toHaveLength(4);          // depósito + comisión + cargo + payout
    expect(r.movimientos[r.movimientos.length - 1].saldoCalculado).toBe(113.60);
    expect(r.totalDepositos).toBe(1160);
    expect(r.totalRetiros).toBe(2046.40);
    expect(r.cuadra).toBe(true);
  });

  test('la comisión del cobro y la de facturación suman el total, con su IVA', () => {
    const c = extraerMovimientos(CON_CIFRAS).comisiones!;
    expect(c.total).toBe(46.40);
    expect(c.base).toBe(40);        // 46.40 / 1.16
    expect(c.iva).toBe(6.40);
  });

  test('sin TIPO reconocible, manda el SIGNO: «-$» sale, «$» entra', () => {
    const r = extraerMovimientos(`
Estado de Cuenta Stripe
COMISIONES STRIPE $0.00
20261007Movimiento raro sin tipo-$1,500.00
20261008Otro movimiento raro$2,500.00
Resumen: Saldo inicial $0.00  Saldo final $1,000.00.
`);
    const sale = r.movimientos.find((m) => m.fecha === '2026-10-07')!;
    const entra = r.movimientos.find((m) => m.fecha === '2026-10-08')!;
    expect([sale.retiro, sale.deposito]).toEqual([1500, 0]);
    expect([entra.retiro, entra.deposito]).toEqual([0, 2500]);
    /* El que SALE sin tipo queda marcado para revisión; el signo dice el lado,
     * pero no de qué es el cargo. */
    expect(sale.duda).toBe(true);
  });

  test('también lee la fecha con guiones (el CSV del portal), no sólo la pegada del PDF', () => {
    const r = extraerMovimientos(`
Estado de Cuenta Stripe
COMISIONES STRIPE $3.00
2026-10-03,Plan Profesional,Cobro,$100.00,$3.00
Resumen: Saldo inicial $0.00  Saldo final $97.00.
`, { anio: 2026 });
    expect(r.movimientos.length).toBeGreaterThan(0);
    expect(r.movimientos[0].fecha).toBe('2026-10-03');
    expect(r.movimientos[0].deposito).toBe(100);
    expect(r.comisiones!.total).toBe(3);
  });
});

describe('Stripe · el PDF cuyas cifras no se pueden leer', () => {
  /* ESTO es lo que de verdad entrega `pdf-parse` con el estado real: los
   * rótulos y los totales salen, pero las cifras de la tabla se quedan en el
   * camino —sólo llegan los «$»— porque van en una fuente sin mapa a Unicode. */
  const SIN_CIFRAS = `
Estado de Cuenta Stripe  Movimientos de Octubre 2026
FECHACONCEPTOTIPOIMPORTECOMISIÓNNETO
20261001Comisión de facturación 30 sep)Comisión Stripe$
20261003Plan Profesional  Inglés EjecutivoCobro$$$
20261005Payout  CONCENTRADO DE MESES ANTERIORESPago a banco$$
COBROS (BRUTO)
$57,891.93
COMISIONES STRIPE
$2,913.15
ACTIVIDAD NETA
$54,978.78
PAGOS A BANCO
$102,004.22
Resumen: Saldo inicial $62,241.30 30 sep)  Actividad neta $54,978.78  Pagos a banco $102,004.22  Saldo final $15,215.86 31 oct).
`;

  test('NO inventa movimientos en cero', () => {
    expect(extraerMovimientos(SIN_CIFRAS).movimientos).toHaveLength(0);
  });

  test('avisa cuántos renglones se perdieron y qué hacer', () => {
    const avisos = extraerMovimientos(SIN_CIFRAS).avisos.join(' ');
    expect(avisos).toMatch(/3 renglón\(es\) traen las columnas de importe pero SIN cifras/);
    expect(avisos).toMatch(/CSV/);
  });

  test('aun así entrega los saldos y la comisión con su IVA, y cuadra', () => {
    const r = extraerMovimientos(SIN_CIFRAS);
    expect(r.saldoInicial).toBe(62241.30);
    expect(r.saldoFinal).toBe(15215.86);
    expect(r.comisiones!.base).toBe(2511.34);
    expect(r.comisiones!.iva).toBe(401.81);
    expect(r.cuadra).toBe(true);
  });

  /* LA CAUSA REAL, medida en el PDF de octubre 2026: la fuente de la tabla no
   * trae mapa a Unicode y sus caracteres llegan en el ÁREA DE USO PRIVADO. La
   * fecha «2026-10-01» llega como 20261001 —con los guiones en
   * U+E088— y las cifras llegan enteras en esa área, de ahí que sólo se vean
   * los «$». Sin limpiarlos, el renglón no se reconoce y el detalle se perdía
   * EN SILENCIO: lo peor posible, porque nada avisaba. */
  test('los glifos de uso privado no esconden el renglón: se limpian y se cuentan', () => {
    const conPua = SIN_CIFRAS
      .replace('20261001', '20261001')
      .replace('20261003', '20261003')
      .replace('20261005', '20261005');
    const r = extraerMovimientos(conPua);
    expect(r.avisos.join(' ')).toMatch(/3 renglón\(es\) traen las columnas de importe pero SIN cifras/);
    expect(r.avisos.join(' ')).toMatch(/glifos de uso privado/);
    /* Los saldos y la comisión siguen saliendo: van en la fuente buena. */
    expect(r.saldoFinal).toBe(15215.86);
    expect(r.comisiones!.iva).toBe(401.81);
  });

  test('con los glifos limpios, un renglón que SÍ trae cifras se lee normal', () => {
    const r = extraerMovimientos(`
Estado de Cuenta Stripe
COMISIONES STRIPE $34.80
20261003Plan ProfesionalCobro$1,160.00 $34.80 $1,125.20
Resumen: Saldo inicial $0.00  Saldo final $1,125.20.
`);
    /* Dos renglones: el cobro por su importe y la comisión retenida de ese día. */
    expect(r.movimientos).toHaveLength(2);
    expect(r.movimientos[0].fecha).toBe('2026-10-03');
    expect(r.movimientos[0].deposito).toBe(1160);
    expect(r.movimientos[1].retiro).toBe(34.80);
  });
});
