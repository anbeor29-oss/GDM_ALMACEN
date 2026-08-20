/**
 * Estados financieros — Nivel 2 de la especificación.
 *
 * Estado de situación financiera (B-6), estado de resultado integral (B-3),
 * flujos de efectivo (B-2), cambios en el capital contable (B-4), análisis
 * vertical y horizontal, y razones financieras.
 *
 * ── DE DÓNDE SALEN LAS CIFRAS ──
 * De los saldos ya ubicados en el código agrupador del SAT. Ni el estado ni
 * las razones conocen la numeración del contribuyente: el mapeo ya ocurrió, y
 * aquí sólo se agrupa por rubro.
 *
 * ── DOS DECISIONES QUE SE REPITEN ──
 *
 * 1. Los rubros NETOS se presentan netos, y también se muestran sus dos
 *    componentes. 'Clientes 105 − estimación 108' presentado sólo como neto
 *    esconde el tamaño de la cartera y el de la estimación, que es justo lo
 *    que se necesita para juzgar si la segunda alcanza.
 *
 * 2. El 703 se parte por NATURALEZA y no por subcuenta. El Anexo 24 pone los
 *    gastos financieros en 703.01-.11 y los productos en 703.12-.21, pero el
 *    resumen del que se sembró el catálogo no detalla esas subcuentas — así
 *    que si se partiera por código, todo el 703 caería del lado de los gastos
 *    y un ingreso por intereses se restaría en vez de sumarse.
 *
 *    Es exactamente el error que ya se corrigió en la regla de la ecuación
 *    contable, y aquí vuelve a aparecer por la misma puerta.
 */

import type { ContextoNif, SaldoAgrupado } from './nif-reglas.data';

export interface Rubro {
  clave: string;
  nombre: string;
  codigos: string;
  importe: number;
  /** Los componentes de un rubro neto, para no esconderlos. */
  detalle?: Array<{ nombre: string; importe: number }>;
  /** Porcentaje sobre el total de referencia (análisis vertical). */
  vertical?: number;
}

export interface Seccion {
  clave: string;
  nombre: string;
  rubros: Rubro[];
  total: number;
  vertical?: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   HERRAMIENTAS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Suma un rango de cuentas mayores: rango('151','170') cubre 151..170. */
function rango(c: ContextoNif, desde: string, hasta: string): number {
  const d = parseInt(desde, 10);
  const h = parseInt(hasta, 10);
  return c.saldos
    .filter((s) => {
      const n = parseInt((s.agrupador || '').split('.')[0], 10);
      return Number.isFinite(n) && n >= d && n <= h;
    })
    .reduce((a, s) => a + s.saldo, 0);
}

/** Las cuentas del RIF separadas por lo que realmente son. */
function rif(c: ContextoNif) {
  const cuentas = c.cuentas('703');
  const gastos = cuentas.filter((x) => x.naturaleza === 'D').reduce((a, x) => a + x.saldo, 0);
  const productos = cuentas.filter((x) => x.naturaleza === 'A').reduce((a, x) => a + x.saldo, 0);
  return { gastos, productos, neto: productos - gastos };
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/* ═══════════════════════════════════════════════════════════════════════════
   1. ESTADO DE SITUACIÓN FINANCIERA — NIF B-6
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SituacionFinanciera {
  norma: 'B-6';
  fechaCorte: string;
  activoCirculante: Seccion;
  activoNoCirculante: Seccion;
  activoTotal: number;
  pasivoCorto: Seccion;
  pasivoLargo: Seccion;
  pasivoTotal: number;
  capital: Seccion;
  capitalTotal: number;
  /** Activo − (Pasivo + Capital). Debe ser cero. */
  diferencia: number;
  cuadra: boolean;
}

export function situacionFinanciera(c: ContextoNif): SituacionFinanciera {
  const neto = (bruto: number, contra: number, nBruto: string, nContra: string): Rubro['detalle'] =>
    [{ nombre: nBruto, importe: redondear(bruto) },
     { nombre: nContra, importe: redondear(-Math.abs(contra)) }];

  /* ── Activo circulante ── */
  const efectivo = rango(c, '101', '104');
  const clientesBruto = c.suma('105');
  const estimacion = Math.abs(c.suma('108'));
  const otrasCxC = c.suma('106', '107') + rango(c, '110', '114') + c.suma('120');
  const invBruto = c.suma('115');
  const invEstim = Math.abs(c.suma('116'));
  const anticipados = c.suma('109', '118', '119');
  const otrosCP = c.suma('117', '121');

  const circulante: Seccion = {
    clave: 'ACTIVO_CIRCULANTE',
    nombre: 'Activo circulante',
    rubros: [
      { clave: 'EFECTIVO', nombre: 'Efectivo y equivalentes de efectivo',
        codigos: '101–104', importe: redondear(efectivo) },
      { clave: 'CLIENTES', nombre: 'Clientes, neto',
        codigos: '105 − 108', importe: redondear(clientesBruto - estimacion),
        detalle: neto(clientesBruto, estimacion, 'Clientes', 'Estimación de incobrables') },
      { clave: 'OTRAS_CXC', nombre: 'Otras cuentas por cobrar',
        codigos: '106, 107, 110–114, 120', importe: redondear(otrasCxC) },
      { clave: 'INVENTARIOS', nombre: 'Inventarios, neto',
        codigos: '115 − 116', importe: redondear(invBruto - invEstim),
        detalle: neto(invBruto, invEstim, 'Inventario', 'Estimación de obsolescencia') },
      { clave: 'ANTICIPADOS', nombre: 'Pagos anticipados e impuestos acreditables',
        codigos: '109, 118, 119', importe: redondear(anticipados) },
      { clave: 'OTROS_CP', nombre: 'Otros activos a corto plazo',
        codigos: '117, 121', importe: redondear(otrosCP) },
    ],
    total: 0,
  };
  circulante.total = redondear(circulante.rubros.reduce((a, r) => a + r.importe, 0));

  /* ── Activo no circulante ── */
  const fijoBruto = rango(c, '151', '170');
  const deprec = Math.abs(c.suma('171'));
  const deterioro = Math.abs(c.suma('172'));
  const intangBruto = rango(c, '173', '182');
  const amort = Math.abs(c.suma('183'));
  const otrosLP = rango(c, '184', '190');

  const noCirculante: Seccion = {
    clave: 'ACTIVO_NO_CIRCULANTE',
    nombre: 'Activo no circulante',
    rubros: [
      { clave: 'FIJO', nombre: 'Inmuebles, maquinaria y equipo, neto',
        codigos: '151–170 − 171 − 172',
        importe: redondear(fijoBruto - deprec - deterioro),
        detalle: [
          { nombre: 'Inversión', importe: redondear(fijoBruto) },
          { nombre: 'Depreciación acumulada', importe: redondear(-deprec) },
          { nombre: 'Deterioro acumulado', importe: redondear(-deterioro) },
        ] },
      { clave: 'INTANGIBLES', nombre: 'Intangibles y cargos diferidos, neto',
        codigos: '173–182 − 183', importe: redondear(intangBruto - amort),
        detalle: neto(intangBruto, amort, 'Intangibles y diferidos', 'Amortización acumulada') },
      { clave: 'OTROS_LP', nombre: 'Otros activos a largo plazo',
        codigos: '184–190', importe: redondear(otrosLP) },
    ],
    total: 0,
  };
  noCirculante.total = redondear(noCirculante.rubros.reduce((a, r) => a + r.importe, 0));

  const activoTotal = redondear(circulante.total + noCirculante.total);

  /* ── Pasivo ── */
  const pasivoCorto: Seccion = {
    clave: 'PASIVO_CORTO', nombre: 'Pasivo a corto plazo',
    rubros: [
      { clave: 'PROVEEDORES', nombre: 'Proveedores', codigos: '201', importe: redondear(c.suma('201')) },
      { clave: 'CXP_CP', nombre: 'Cuentas y documentos por pagar', codigos: '202, 205',
        importe: redondear(c.suma('202', '205')) },
      { clave: 'ANTICIPOS_CLI', nombre: 'Anticipos de clientes y cobros anticipados',
        codigos: '203, 206', importe: redondear(c.suma('203', '206')) },
      { clave: 'IMPUESTOS', nombre: 'Impuestos por pagar y trasladados',
        codigos: '207–209, 213, 216, 217', importe:
          redondear(rango(c, '207', '209') + c.suma('213', '216', '217')) },
      { clave: 'PROVISIONES', nombre: 'Provisiones y beneficios a empleados',
        codigos: '210–212, 215', importe: redondear(rango(c, '210', '212') + c.suma('215')) },
      { clave: 'OTROS_PAS_CP', nombre: 'Otros pasivos a corto plazo',
        codigos: '204, 214, 218', importe: redondear(c.suma('204', '214', '218')) },
    ],
    total: 0,
  };
  pasivoCorto.total = redondear(pasivoCorto.rubros.reduce((a, r) => a + r.importe, 0));

  const pasivoLargo: Seccion = {
    clave: 'PASIVO_LARGO', nombre: 'Pasivo a largo plazo',
    rubros: [
      { clave: 'CXP_LP', nombre: 'Cuentas por pagar a largo plazo', codigos: '251, 252',
        importe: redondear(c.suma('251', '252')) },
      { clave: 'BENEF_LP', nombre: 'Beneficios a los empleados a largo plazo', codigos: '255',
        importe: redondear(c.suma('255')) },
      { clave: 'DIFERIDOS_PAS', nombre: 'Impuestos y pasivos diferidos', codigos: '257, 259, 260',
        importe: redondear(c.suma('257', '259', '260')) },
      { clave: 'OTROS_PAS_LP', nombre: 'Otros pasivos a largo plazo', codigos: '253, 254, 256, 258',
        importe: redondear(c.suma('253', '254', '256', '258')) },
    ],
    total: 0,
  };
  pasivoLargo.total = redondear(pasivoLargo.rubros.reduce((a, r) => a + r.importe, 0));
  const pasivoTotal = redondear(pasivoCorto.total + pasivoLargo.total);

  /* ── Capital contable ──
   * El resultado del ejercicio se toma de los saldos de resultados, no de la
   * cuenta 305: en una balanza mensual el resultado todavía no se ha
   * traspasado, y leer 305 daría cero mientras el negocio ganó dinero. */
  const r = resultadoIntegral(c);
  const capital: Seccion = {
    clave: 'CAPITAL', nombre: 'Capital contable',
    rubros: [
      { clave: 'CAPITAL_SOCIAL', nombre: 'Capital social y aportaciones', codigos: '301, 302',
        importe: redondear(c.suma('301', '302')) },
      { clave: 'RESERVAS', nombre: 'Reserva legal y otras reservas', codigos: '303',
        importe: redondear(c.suma('303')) },
      { clave: 'ACUMULADOS', nombre: 'Resultados de ejercicios anteriores', codigos: '304',
        importe: redondear(c.suma('304')) },
      { clave: 'RESULTADO', nombre: 'Resultado del ejercicio', codigos: '4–7 (o 305)',
        importe: redondear(r.utilidadNeta) },
      { clave: 'OTRAS_CAP', nombre: 'Otras cuentas de capital', codigos: '306',
        importe: redondear(c.suma('306')) },
    ],
    total: 0,
  };
  capital.total = redondear(capital.rubros.reduce((a, r2) => a + r2.importe, 0));

  const diferencia = redondear(activoTotal - (pasivoTotal + capital.total));

  /* Análisis vertical: cada rubro sobre el activo total. */
  for (const sec of [circulante, noCirculante, pasivoCorto, pasivoLargo, capital]) {
    sec.vertical = activoTotal ? redondear(sec.total / activoTotal * 100) : 0;
    for (const rb of sec.rubros) {
      rb.vertical = activoTotal ? redondear(rb.importe / activoTotal * 100) : 0;
    }
  }

  return {
    norma: 'B-6', fechaCorte: c.fechaCorte,
    activoCirculante: circulante, activoNoCirculante: noCirculante, activoTotal,
    pasivoCorto, pasivoLargo, pasivoTotal,
    capital, capitalTotal: capital.total,
    diferencia, cuadra: Math.abs(diferencia) <= 1,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. ESTADO DE RESULTADO INTEGRAL — NIF B-3
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResultadoIntegral {
  norma: 'B-3';
  fechaCorte: string;
  renglones: Rubro[];
  ingresosNetos: number;
  utilidadBruta: number;
  utilidadOperacion: number;
  utilidadAntesImpuestos: number;
  utilidadNeta: number;
  /** El 305 de la balanza, para contrastar. Puede no existir en un mes. */
  resultadoSegun305: number;
  /** Diferencia entre lo calculado y el 305, cuando el 305 existe. */
  diferenciaCon305: number | null;
}

export function resultadoIntegral(c: ContextoNif): ResultadoIntegral {
  const ventas = c.suma('401');
  const devoluciones = Math.abs(c.suma('402'));
  const otrosIngresos = c.suma('403');
  const ingresosNetos = ventas - devoluciones + otrosIngresos;

  const costo = rango(c, '501', '505');
  const utilidadBruta = ingresosNetos - costo;

  const gastos = rango(c, '601', '604');
  const depreciacion = c.suma('701', '702');
  const utilidadOperacion = utilidadBruta - gastos - depreciacion;

  const f = rif(c);
  const otros = c.cuentas('704');
  const otrosGastos = otros.filter((x) => x.naturaleza === 'D').reduce((a, x) => a + x.saldo, 0);
  const otrosProductos = otros.filter((x) => x.naturaleza === 'A').reduce((a, x) => a + x.saldo, 0);
  const participacion = c.suma('608', '609');

  const utilidadAntesImpuestos =
    utilidadOperacion + f.neto + (otrosProductos - otrosGastos) - participacion;

  const isr = c.suma('611');
  const ptu = c.suma('607', '610');
  const utilidadNeta = utilidadAntesImpuestos - isr - ptu;

  const resultadoSegun305 = c.suma('305');

  const R = (clave: string, nombre: string, codigos: string, importe: number): Rubro =>
    ({ clave, nombre, codigos, importe: redondear(importe) });

  const renglones: Rubro[] = [
    R('VENTAS', 'Ventas y servicios', '401', ventas),
    R('DEVOLUCIONES', 'Devoluciones, descuentos y bonificaciones', '402', -devoluciones),
    R('OTROS_ING', 'Otros ingresos', '403', otrosIngresos),
    R('INGRESOS_NETOS', 'Ingresos netos', '401 − 402 + 403', ingresosNetos),
    R('COSTO', 'Costo de ventas', '501–505', -costo),
    R('UTILIDAD_BRUTA', 'Utilidad bruta', '', utilidadBruta),
    R('GASTOS', 'Gastos de operación', '601–604', -gastos),
    R('DEPRECIACION', 'Depreciación y amortización', '701, 702', -depreciacion),
    R('UTILIDAD_OPERACION', 'Utilidad de operación', '', utilidadOperacion),
    R('RIF_GASTOS', 'Gastos financieros', '703 (deudoras)', -f.gastos),
    R('RIF_PRODUCTOS', 'Productos financieros', '703 (acreedoras)', f.productos),
    R('OTROS_GP', 'Otros gastos y productos', '704', otrosProductos - otrosGastos),
    R('PARTICIPACION', 'Participación en subsidiarias y asociadas', '608, 609', -participacion),
    R('UAI', 'Utilidad antes de impuestos', '', utilidadAntesImpuestos),
    R('ISR', 'Impuesto sobre la renta', '611', -isr),
    R('PTU', 'PTU del ejercicio', '607, 610', -ptu),
    R('UTILIDAD_NETA', 'Utilidad neta', '', utilidadNeta),
  ];

  /* Vertical sobre ingresos netos. */
  for (const r of renglones) {
    r.vertical = ingresosNetos ? redondear(r.importe / ingresosNetos * 100) : 0;
  }

  return {
    norma: 'B-3', fechaCorte: c.fechaCorte, renglones,
    ingresosNetos: redondear(ingresosNetos),
    utilidadBruta: redondear(utilidadBruta),
    utilidadOperacion: redondear(utilidadOperacion),
    utilidadAntesImpuestos: redondear(utilidadAntesImpuestos),
    utilidadNeta: redondear(utilidadNeta),
    resultadoSegun305: redondear(resultadoSegun305),
    /* Sólo tiene sentido contrastar si la 305 trae algo: en una balanza
     * mensual el resultado aún no se traspasa y la cuenta está en cero. */
    diferenciaCon305: Math.abs(resultadoSegun305) > 1
      ? redondear(utilidadNeta - resultadoSegun305) : null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. RAZONES FINANCIERAS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface Razon {
  clave: string;
  nombre: string;
  formula: string;
  valor: number | null;
  unidad: 'VECES' | 'PORCENTAJE' | 'DIAS' | 'PESOS';
  /** Las cifras con las que se calculó: sin ellas la razón no se puede rehacer. */
  base: Record<string, number>;
  interpretacion: string;
  referencia?: string;
  /** VERDE / AMBAR / ROJO / SIN_DATO */
  semaforo: 'VERDE' | 'AMBAR' | 'ROJO' | 'SIN_DATO';
}

/**
 * Divide, o devuelve null si no se puede.
 *
 * NO redondea: el redondeo va al final, cuando se presenta. Redondear aqui
 * mata la precision de todo lo que despues se multiplica — un margen de
 * 0.3786 redondeado a 0.38 y llevado a porcentaje sale 38%, no 37.86%.
 */
const div = (a: number, b: number): number | null =>
  Math.abs(b) < 0.005 ? null : a / b;

/**
 * Un plazo en dias sobre una base que tiene que ser POSITIVA.
 *
 * Con cartera negativa —clientes que pagaron de mas— la formula da "se tarda
 * -16 dias en cobrar", que no significa nada y encima se ve como un dato.
 * Cuando la base no tiene sentido, la razon se declara incalculable y se dice
 * por que: eso SI es informacion.
 */
const dias = (numerador: number, base: number, d: number): number | null =>
  numerador <= 0 || Math.abs(base) < 0.005 ? null : (numerador * d) / base;

export function razones(
  bal: SituacionFinanciera,
  res: ResultadoIntegral,
  c: ContextoNif,
  diasPeriodo = 365,
): Razon[] {
  const AC = bal.activoCirculante.total;
  const PC = bal.pasivoCorto.total;
  const inventario = bal.activoCirculante.rubros.find((r) => r.clave === 'INVENTARIOS')!.importe;
  const clientes = bal.activoCirculante.rubros.find((r) => r.clave === 'CLIENTES')!.importe;
  const proveedores = bal.pasivoCorto.rubros.find((r) => r.clave === 'PROVEEDORES')!.importe;
  const costo = Math.abs(res.renglones.find((r) => r.clave === 'COSTO')!.importe);
  const depreciacion = Math.abs(res.renglones.find((r) => r.clave === 'DEPRECIACION')!.importe);
  const gastosFin = Math.abs(res.renglones.find((r) => r.clave === 'RIF_GASTOS')!.importe);
  const ebitda = res.utilidadOperacion + depreciacion;

  const sem = (v: number | null, verde: (x: number) => boolean, ambar: (x: number) => boolean):
    Razon['semaforo'] => v === null ? 'SIN_DATO' : verde(v) ? 'VERDE' : ambar(v) ? 'AMBAR' : 'ROJO';

  const out: Razon[] = [];
  const add = (r: Razon) => out.push(r);

  const liquidez = div(AC, PC);
  add({
    clave: 'LIQUIDEZ', nombre: 'Liquidez corriente',
    formula: 'Activo circulante ÷ Pasivo a corto plazo',
    valor: liquidez === null ? null : redondear(liquidez), unidad: 'VECES',
    base: { activoCirculante: AC, pasivoCorto: PC },
    referencia: '1.5 a 2.0',
    interpretacion: liquidez === null
      ? 'No hay pasivo a corto plazo con el cual comparar.'
      : liquidez < 1
        ? `Por cada peso que se debe a corto plazo hay ${liquidez.toFixed(2)}. No alcanza: ` +
          `el circulante no cubre las obligaciones del año.`
        : `Por cada peso que se debe a corto plazo hay ${liquidez.toFixed(2)} de activo circulante.`,
    semaforo: sem(liquidez, (v) => v >= 1.5, (v) => v >= 1),
  });

  const acido = div(AC - Math.max(0, inventario), PC);
  add({
    clave: 'ACIDO', nombre: 'Prueba del ácido',
    formula: '(Activo circulante − Inventarios) ÷ Pasivo a corto plazo',
    valor: acido === null ? null : redondear(acido), unidad: 'VECES',
    base: { activoCirculante: AC, inventarios: inventario, pasivoCorto: PC },
    referencia: '≥ 1.0',
    interpretacion: acido === null
      ? 'No hay pasivo a corto plazo con el cual comparar.'
      : `Sin vender una sola pieza de inventario, se cubre ${acido.toFixed(2)} veces el pasivo corto.`,
    semaforo: sem(acido, (v) => v >= 1, (v) => v >= 0.8),
  });

  const apalanca = div(bal.pasivoTotal, bal.capitalTotal);
  add({
    clave: 'APALANCAMIENTO', nombre: 'Apalancamiento',
    formula: 'Pasivo total ÷ Capital contable',
    valor: apalanca === null ? null : redondear(apalanca), unidad: 'VECES',
    base: { pasivoTotal: bal.pasivoTotal, capital: bal.capitalTotal },
    referencia: '≤ 2.0 · vigilar capitalización delgada 3:1 con partes relacionadas del extranjero',
    interpretacion: apalanca === null
      ? 'No hay capital contable positivo con el cual comparar.'
      : apalanca < 0
        ? 'El capital contable es negativo: el pasivo excede al activo.'
        : `Por cada peso de los socios hay ${apalanca.toFixed(2)} de terceros.`,
    semaforo: apalanca === null ? 'SIN_DATO'
      : apalanca < 0 ? 'ROJO' : sem(apalanca, (v) => v <= 2, (v) => v <= 3),
  });

  const margenBruto = div(res.utilidadBruta, res.ingresosNetos);
  add({
    clave: 'MARGEN_BRUTO', nombre: 'Margen bruto',
    formula: 'Utilidad bruta ÷ Ingresos netos',
    valor: margenBruto === null ? null : redondear(margenBruto * 100), unidad: 'PORCENTAJE',
    base: { utilidadBruta: res.utilidadBruta, ingresosNetos: res.ingresosNetos },
    interpretacion: margenBruto === null
      ? 'No hay ingresos en el periodo.'
      : `De cada 100 pesos vendidos quedan ${(margenBruto * 100).toFixed(1)} después del costo.`,
    semaforo: sem(margenBruto, (v) => v >= 0.30, (v) => v >= 0.15),
  });

  const margenNeto = div(res.utilidadNeta, res.ingresosNetos);
  add({
    clave: 'MARGEN_NETO', nombre: 'Margen neto',
    formula: 'Utilidad neta ÷ Ingresos netos',
    valor: margenNeto === null ? null : redondear(margenNeto * 100), unidad: 'PORCENTAJE',
    base: { utilidadNeta: res.utilidadNeta, ingresosNetos: res.ingresosNetos },
    interpretacion: margenNeto === null
      ? 'No hay ingresos en el periodo.'
      : `De cada 100 pesos vendidos quedan ${(margenNeto * 100).toFixed(1)} al final.`,
    semaforo: sem(margenNeto, (v) => v >= 0.10, (v) => v > 0),
  });

  const margenEbitda = div(ebitda, res.ingresosNetos);
  add({
    clave: 'EBITDA', nombre: 'EBITDA',
    formula: 'Utilidad de operación + depreciación y amortización',
    valor: redondear(ebitda), unidad: 'PESOS',
    base: { utilidadOperacion: res.utilidadOperacion, depreciacion },
    referencia: margenEbitda !== null ? `${(margenEbitda * 100).toFixed(1)}% sobre ingresos` : undefined,
    interpretacion:
      'Lo que genera la operación antes de intereses, impuestos y partidas que no ' +
      'salen de la caja.',
    semaforo: sem(margenEbitda, (v) => v >= 0.10, (v) => v > 0),
  });

  const roa = div(res.utilidadNeta, bal.activoTotal);
  add({
    clave: 'ROA', nombre: 'Rendimiento sobre activos (ROA)',
    formula: 'Utilidad neta ÷ Activo total',
    valor: roa === null ? null : redondear(roa * 100), unidad: 'PORCENTAJE',
    base: { utilidadNeta: res.utilidadNeta, activoTotal: bal.activoTotal },
    referencia: 'Por encima del costo de fondeo',
    interpretacion: roa === null ? 'No hay activo con el cual comparar.'
      : `Cada 100 pesos invertidos en activos generaron ${(roa * 100).toFixed(1)}.`,
    semaforo: sem(roa, (v) => v >= 0.05, (v) => v > 0),
  });

  const roe = div(res.utilidadNeta, bal.capitalTotal);
  add({
    clave: 'ROE', nombre: 'Rendimiento sobre capital (ROE)',
    formula: 'Utilidad neta ÷ Capital contable',
    valor: roe === null ? null : redondear(roe * 100), unidad: 'PORCENTAJE',
    base: { utilidadNeta: res.utilidadNeta, capital: bal.capitalTotal },
    interpretacion: roe === null ? 'No hay capital contable con el cual comparar.'
      : `Cada 100 pesos de los socios rindieron ${(roe * 100).toFixed(1)}.`,
    semaforo: sem(roe, (v) => v >= 0.10, (v) => v > 0),
  });

  const dso = dias(clientes, res.ingresosNetos, diasPeriodo);
  add({
    clave: 'DSO', nombre: 'Días de cartera (DSO)',
    formula: `Clientes ÷ Ingresos × ${diasPeriodo}`,
    valor: dso === null ? null : redondear(dso), unidad: 'DIAS',
    base: { clientes, ingresosNetos: res.ingresosNetos, dias: diasPeriodo },
    referencia: 'No mayor al plazo de crédito otorgado',
    interpretacion: dso === null
      ? (clientes <= 0
          ? `No se puede calcular: la cartera neta es ${clientes.toFixed(2)}. Un saldo de `
            + `clientes negativo significa que cobraron por adelantado más de lo que deben, `
            + `y eso son anticipos —pasivo—, no cartera.`
          : 'No hay ingresos en el periodo con los cuales comparar.')
      : `Se tarda ${Math.round(dso)} días en cobrar lo que se vende.`,
    semaforo: sem(dso, (v) => v <= 45, (v) => v <= 90),
  });

  const dio = dias(inventario, costo, diasPeriodo);
  add({
    clave: 'DIO', nombre: 'Días de inventario (DIO)',
    formula: `Inventario ÷ Costo de ventas × ${diasPeriodo}`,
    valor: dio === null ? null : redondear(dio), unidad: 'DIAS',
    base: { inventario, costo, dias: diasPeriodo },
    interpretacion: dio === null
      ? (inventario <= 0 ? 'No hay inventario que rotar.'
                         : 'No hay costo de ventas en el periodo.')
      : `El inventario dura ${Math.round(dio)} días antes de venderse.`,
    semaforo: sem(dio, (v) => v <= 60, (v) => v <= 120),
  });

  const dpo = dias(proveedores, costo, diasPeriodo);
  add({
    clave: 'DPO', nombre: 'Días de proveedores (DPO)',
    formula: `Proveedores ÷ Costo de ventas × ${diasPeriodo}`,
    valor: dpo === null ? null : redondear(dpo), unidad: 'DIAS',
    base: { proveedores, costo, dias: diasPeriodo },
    interpretacion: dpo === null
      ? (proveedores <= 0
          ? `No se puede calcular: el saldo de proveedores es ${proveedores.toFixed(2)}. `
            + `Un proveedor con saldo deudor es un anticipo entregado —activo—, no una deuda.`
          : 'No hay costo de ventas en el periodo.')
      : `Se tarda ${Math.round(dpo)} días en pagar a proveedores.`,
    semaforo: 'SIN_DATO',
  });

  const ciclo = (dso !== null && dio !== null && dpo !== null)
    ? redondear(dso + dio - dpo) : null;
  add({
    clave: 'CICLO_EFECTIVO', nombre: 'Ciclo de conversión de efectivo',
    formula: 'DSO + DIO − DPO',
    valor: ciclo, unidad: 'DIAS',
    base: { dso: dso ?? 0, dio: dio ?? 0, dpo: dpo ?? 0 },
    interpretacion: ciclo === null
      ? 'No se puede calcular: falta alguno de los tres plazos, y un ciclo armado '
        + 'con las piezas que sí hay daría un número con toda la apariencia de ser bueno.'
      : ciclo < 0
        ? `El ciclo es negativo (${Math.round(ciclo)} días): se cobra antes de pagar, y el ` +
          `capital de trabajo lo financia el proveedor.`
        : `Pasan ${Math.round(ciclo)} días entre que se paga la mercancía y se cobra su venta. ` +
          `Ese hueco hay que financiarlo.`,
    semaforo: ciclo === null ? 'SIN_DATO' : ciclo <= 30 ? 'VERDE' : ciclo <= 90 ? 'AMBAR' : 'ROJO',
  });

  const cobertura = div(ebitda, gastosFin);
  add({
    clave: 'COBERTURA_INTERESES', nombre: 'Cobertura de intereses',
    formula: 'EBITDA ÷ Gastos financieros',
    valor: cobertura === null ? null : redondear(cobertura), unidad: 'VECES',
    base: { ebitda: redondear(ebitda), gastosFinancieros: gastosFin },
    referencia: '≥ 3.0',
    interpretacion: cobertura === null
      ? 'No hay gastos financieros en el periodo.'
      : `La operación cubre ${cobertura.toFixed(2)} veces los intereses del periodo.`,
    semaforo: sem(cobertura, (v) => v >= 3, (v) => v >= 1.5),
  });

  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. ANÁLISIS HORIZONTAL — dos periodos
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RenglonHorizontal {
  clave: string;
  nombre: string;
  actual: number;
  anterior: number;
  variacion: number;
  variacionPct: number | null;
  alerta: boolean;
}

/**
 * Compara dos periodos.
 *
 * Se marca alerta cuando la variación pasa el 20% Y además supera un umbral en
 * pesos. Sólo con el porcentaje, un rubro que pasa de $100 a $200 sale como
 * alerta del 100% y entierra al que se movió medio millón.
 */
export function analisisHorizontal(
  actual: SituacionFinanciera,
  anterior: SituacionFinanciera,
  umbralPct = 20,
  umbralPesos = 500000,
): RenglonHorizontal[] {
  const planos = (b: SituacionFinanciera) => {
    const m = new Map<string, { nombre: string; importe: number }>();
    for (const sec of [b.activoCirculante, b.activoNoCirculante,
                       b.pasivoCorto, b.pasivoLargo, b.capital]) {
      for (const r of sec.rubros) m.set(r.clave, { nombre: r.nombre, importe: r.importe });
    }
    return m;
  };
  const a = planos(actual);
  const b = planos(anterior);

  const out: RenglonHorizontal[] = [];
  for (const [clave, v] of a) {
    const prev = b.get(clave)?.importe ?? 0;
    const variacion = redondear(v.importe - prev);
    const pct = Math.abs(prev) < 0.005 ? null : redondear(variacion / Math.abs(prev) * 100);
    out.push({
      clave, nombre: v.nombre, actual: v.importe, anterior: prev, variacion,
      variacionPct: pct,
      alerta: (pct !== null && Math.abs(pct) > umbralPct && Math.abs(variacion) > umbralPesos)
        || (pct === null && Math.abs(variacion) > umbralPesos),
    });
  }
  return out.sort((x, y) => Math.abs(y.variacion) - Math.abs(x.variacion));
}

/* ═══════════════════════════════════════════════════════════════════════════
   4-bis. ESTADO DE FLUJOS DE EFECTIVO — NIF B-2 (método indirecto)
   ═══════════════════════════════════════════════════════════════════════════ */

export interface FlujoEfectivo {
  norma: 'B-2';
  metodo: 'INDIRECTO';
  disponible: boolean;
  motivo?: string;
  operacion: Rubro[];
  flujoOperacion: number;
  inversion: Rubro[];
  flujoInversion: number;
  financiamiento: Rubro[];
  flujoFinanciamiento: number;
  incrementoNeto: number;
  efectivoInicial: number;
  efectivoFinal: number;
  /** Lo calculado contra el movimiento real del efectivo. Debe ser cero. */
  diferencia: number;
  concilia: boolean;
}

/**
 * Flujo de efectivo por el método indirecto.
 *
 * ── POR QUÉ EXIGE DOS PERIODOS ──
 * El flujo no se lee de saldos: se lee de VARIACIONES. "Cuánto entró de
 * clientes" es el saldo de clientes de este mes contra el del anterior. Con un
 * solo periodo no hay resta que hacer, y devolver ceros sería peor que no
 * devolver nada: un estado de flujo en ceros parece una empresa quieta.
 *
 * ── LA COMPROBACIÓN QUE LO VALIDA ──
 * La suma de los tres flujos tiene que dar exactamente el movimiento del
 * efectivo entre los dos periodos. Si no da, algo se quedó fuera — y el estado
 * lo dice en vez de presentar una cifra que no cierra.
 */
export function flujoEfectivo(
  actual: ContextoNif,
  anterior?: ContextoNif,
): FlujoEfectivo {
  const vacio: FlujoEfectivo = {
    norma: 'B-2', metodo: 'INDIRECTO', disponible: false,
    motivo:
      'El estado de flujos de efectivo se arma con las VARIACIONES entre dos periodos, ' +
      'no con los saldos de uno. Falta el periodo anterior: cárgalo o ciérralo para ' +
      'que este estado se pueda calcular.',
    operacion: [], flujoOperacion: 0, inversion: [], flujoInversion: 0,
    financiamiento: [], flujoFinanciamiento: 0, incrementoNeto: 0,
    efectivoInicial: 0, efectivoFinal: 0, diferencia: 0, concilia: false,
  };
  if (!anterior) return vacio;

  const d = (...pref: string[]) =>
    pref.reduce((a, p2) => a + actual.suma(p2), 0)
    - pref.reduce((a, p2) => a + anterior.suma(p2), 0);

  const res = resultadoIntegral(actual);
  const R = (clave: string, nombre: string, codigos: string, importe: number): Rubro =>
    ({ clave, nombre, codigos, importe: redondear(importe) });

  /* ── Operación ──
   * La utilidad, más lo que no salió de la caja, más/menos lo que se movió en
   * el capital de trabajo. El signo es el de su efecto en el efectivo: si
   * clientes SUBE, el efectivo BAJA (se vendió y no se cobró). */
  const depreciacion = actual.suma('701', '702');
  const estimaciones = d('108', '116', '172');
  const dClientes = d('105', '106', '107');
  const dInventarios = d('115');
  const dAnticipados = d('109', '118', '119', '120');
  const dProveedores = d('201', '202', '205');
  const dImpuestos = d('207', '208', '209', '213', '216');
  const dProvisiones = d('210', '211', '212', '215');

  const operacion: Rubro[] = [
    R('UAI', 'Utilidad antes de impuestos', '', res.utilidadAntesImpuestos),
    R('DEPRECIACION', 'Depreciación y amortización del periodo', '701, 702', depreciacion),
    R('ESTIMACIONES', 'Variación de estimaciones', '108, 116, 172', estimaciones),
    R('D_CLIENTES', 'Variación de cuentas por cobrar', '105–107', -dClientes),
    R('D_INVENTARIOS', 'Variación de inventarios', '115', -dInventarios),
    R('D_ANTICIPADOS', 'Variación de pagos anticipados e impuestos acreditables',
      '109, 118–120', -dAnticipados),
    R('D_PROVEEDORES', 'Variación de proveedores y cuentas por pagar', '201, 202, 205', dProveedores),
    R('D_IMPUESTOS', 'Variación de impuestos por pagar', '207–209, 213, 216', dImpuestos),
    R('D_PROVISIONES', 'Variación de provisiones', '210–212, 215', dProvisiones),
  ];
  const flujoOperacion = operacion.reduce((a, x) => a + x.importe, 0);

  /* ── Inversión ── */
  const dFijo = d('151', '152', '153', '154', '155', '156', '157', '158', '159',
    '160', '161', '162', '163', '164', '165', '166', '167', '168', '169', '170');
  const dIntangibles = d('173', '174', '175', '176', '177', '178', '179', '180', '181', '182');
  const dPermanentes = d('188');

  const inversion: Rubro[] = [
    R('D_FIJO', 'Adquisición de propiedades, planta y equipo', '151–170', -dFijo),
    R('D_INTANGIBLES', 'Adquisición de intangibles y diferidos', '173–182', -dIntangibles),
    R('D_PERMANENTES', 'Inversiones permanentes en acciones', '188', -dPermanentes),
  ];
  const flujoInversion = inversion.reduce((a, x) => a + x.importe, 0);

  /* ── Financiamiento ── */
  const dPrestamos = d('204', '251', '252', '254');
  const dCapital = d('301', '302');
  const dDividendos = d('214');

  const financiamiento: Rubro[] = [
    R('D_PRESTAMOS', 'Préstamos obtenidos o pagados', '204, 251, 252, 254', dPrestamos),
    R('D_CAPITAL', 'Aportaciones de capital', '301, 302', dCapital),
    R('D_DIVIDENDOS', 'Dividendos decretados o pagados', '214', dDividendos),
  ];
  const flujoFinanciamiento = financiamiento.reduce((a, x) => a + x.importe, 0);

  const incrementoNeto = flujoOperacion + flujoInversion + flujoFinanciamiento;
  const efectivoInicial = anterior.suma('101') + anterior.suma('102')
    + anterior.suma('103') + anterior.suma('104');
  const efectivoFinal = actual.suma('101') + actual.suma('102')
    + actual.suma('103') + actual.suma('104');
  const diferencia = incrementoNeto - (efectivoFinal - efectivoInicial);

  return {
    norma: 'B-2', metodo: 'INDIRECTO', disponible: true,
    operacion, flujoOperacion: redondear(flujoOperacion),
    inversion, flujoInversion: redondear(flujoInversion),
    financiamiento, flujoFinanciamiento: redondear(flujoFinanciamiento),
    incrementoNeto: redondear(incrementoNeto),
    efectivoInicial: redondear(efectivoInicial),
    efectivoFinal: redondear(efectivoFinal),
    diferencia: redondear(diferencia),
    concilia: Math.abs(diferencia) <= 1,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4-ter. ESTADO DE CAMBIOS EN EL CAPITAL CONTABLE — NIF B-4
   ═══════════════════════════════════════════════════════════════════════════ */

export interface CambiosCapital {
  norma: 'B-4';
  disponible: boolean;
  motivo?: string;
  columnas: string[];
  /** Cada renglón es un movimiento; cada columna, un rubro del capital. */
  renglones: Array<{ concepto: string; valores: number[]; total: number; esSaldo?: boolean }>;
  saldoInicial: number;
  saldoFinal: number;
  /** La reserva legal que exige la LGSM contra la que hay. */
  reservaLegal: { hay: number; minimo: number; falta: number } | null;
}

/**
 * Cambios en el capital contable.
 *
 * ── QUÉ PUEDE Y QUÉ NO ──
 * Con dos periodos se ven los SALDOS inicial y final de cada rubro, y su
 * variación. Lo que NO se puede deducir de saldos es el CONCEPTO del
 * movimiento: una variación en 301 puede ser una aportación o una reducción de
 * capital, y el estado B-4 pide distinguirlas.
 *
 * Se presenta lo que los saldos permiten y se dice qué falta. Inventar el
 * concepto sería poner en un estado firmado una historia que nadie contó.
 */
export function cambiosCapital(
  actual: ContextoNif,
  anterior?: ContextoNif,
): CambiosCapital {
  const rubros: Array<[string, string]> = [
    ['301', 'Capital social'],
    ['302', 'Patrimonio'],
    ['303', 'Reserva legal'],
    ['304', 'Resultados acumulados'],
    ['306', 'Otras cuentas de capital'],
  ];
  const columnas = [...rubros.map(([, n]) => n), 'Resultado del ejercicio'];

  if (!anterior) {
    const res = resultadoIntegral(actual);
    const valores = [...rubros.map(([c]) => redondear(actual.suma(c))),
                     redondear(res.utilidadNeta)];
    return {
      norma: 'B-4', disponible: false,
      motivo:
        'Con un solo periodo sólo se puede mostrar el saldo final de cada rubro. ' +
        'El estado de cambios necesita el periodo anterior para calcular los ' +
        'movimientos, y aun con los dos no puede deducir de los saldos si una ' +
        'variación fue aportación o reducción de capital: eso se captura.',
      columnas,
      renglones: [{
        concepto: 'Saldo final', valores, esSaldo: true,
        total: redondear(valores.reduce((a, v) => a + v, 0)),
      }],
      saldoInicial: 0,
      saldoFinal: redondear(valores.reduce((a, v) => a + v, 0)),
      reservaLegal: null,
    };
  }

  const resAct = resultadoIntegral(actual);
  const resAnt = resultadoIntegral(anterior);

  const inicial = [...rubros.map(([c]) => redondear(anterior.suma(c))),
                   redondear(resAnt.utilidadNeta)];
  const final = [...rubros.map(([c]) => redondear(actual.suma(c))),
                 redondear(resAct.utilidadNeta)];
  const variacion = final.map((v, i) => redondear(v - inicial[i]));

  const suma = (a: number[]) => redondear(a.reduce((x, y) => x + y, 0));

  const capitalSocial = Math.abs(actual.suma('301'));
  const reserva = Math.abs(actual.suma('303'));
  const minimo = redondear(capitalSocial * 0.20);

  return {
    norma: 'B-4', disponible: true,
    columnas,
    renglones: [
      { concepto: 'Saldo inicial', valores: inicial, total: suma(inicial), esSaldo: true },
      { concepto: 'Movimientos del periodo', valores: variacion, total: suma(variacion) },
      { concepto: 'Saldo final', valores: final, total: suma(final), esSaldo: true },
    ],
    saldoInicial: suma(inicial),
    saldoFinal: suma(final),
    reservaLegal: capitalSocial > 0
      ? { hay: redondear(reserva), minimo, falta: redondear(Math.max(0, minimo - reserva)) }
      : null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. TODO JUNTO
   ═══════════════════════════════════════════════════════════════════════════ */

export interface JuegoCompleto {
  situacionFinanciera: SituacionFinanciera;
  resultadoIntegral: ResultadoIntegral;
  flujoEfectivo: FlujoEfectivo;
  cambiosCapital: CambiosCapital;
  razones: Razon[];
  horizontal?: RenglonHorizontal[];
  avisos: string[];
}

export function juegoCompleto(
  c: ContextoNif,
  anterior?: ContextoNif,
  diasPeriodo = 365,
): JuegoCompleto {
  const bal = situacionFinanciera(c);
  const res = resultadoIntegral(c);
  const avisos: string[] = [];

  if (!bal.cuadra) {
    avisos.push(
      `El balance no cuadra por ${bal.diferencia.toFixed(2)}: activo ` +
      `${bal.activoTotal.toFixed(2)} contra ${(bal.pasivoTotal + bal.capitalTotal).toFixed(2)} ` +
      `de pasivo más capital. Ningún estado que salga de aquí es confiable hasta arreglarlo.`);
  }
  if (res.diferenciaCon305 !== null && Math.abs(res.diferenciaCon305) > 1) {
    avisos.push(
      `La utilidad calculada (${res.utilidadNeta.toFixed(2)}) no coincide con la cuenta 305 ` +
      `(${res.resultadoSegun305.toFixed(2)}). Diferencia: ${res.diferenciaCon305.toFixed(2)}.`);
  }
  const sinUbicar = c.saldos.filter((s: SaldoAgrupado) => !s.agrupador && Math.abs(s.saldo) >= 1);
  if (sinUbicar.length) {
    avisos.push(
      `${sinUbicar.length} cuenta(s) con saldo no llegaron a ningún rubro y quedaron fuera ` +
      `del estado. Por eso el balance puede no cuadrar.`);
  }

  const flujo = flujoEfectivo(c, anterior);
  if (flujo.disponible && !flujo.concilia) {
    avisos.push(
      `El flujo de efectivo no concilia por ${flujo.diferencia.toFixed(2)}: los tres ` +
      `flujos suman ${flujo.incrementoNeto.toFixed(2)} y el efectivo se movió ` +
      `${(flujo.efectivoFinal - flujo.efectivoInicial).toFixed(2)}. Falta alguna partida.`);
  }

  return {
    situacionFinanciera: bal,
    resultadoIntegral: res,
    flujoEfectivo: flujo,
    cambiosCapital: cambiosCapital(c, anterior),
    razones: razones(bal, res, c, diasPeriodo),
    horizontal: anterior ? analisisHorizontal(bal, situacionFinanciera(anterior)) : undefined,
    avisos,
  };
}

export default {
  situacionFinanciera, resultadoIntegral, flujoEfectivo, cambiosCapital,
  razones, analisisHorizontal, juegoCompleto,
};
