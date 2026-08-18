/**
 * Pruebas del motor de nómina.
 *
 * POR QUÉ ESTAS PRUEBAS IMPORTAN MÁS QUE LAS DEMÁS
 * Un ISR mal calculado no se ve roto: se ve como un número. Nadie lo nota hasta
 * que el SAT lo nota. Las cifras esperadas de abajo están DERIVADAS A MANO con
 * la tarifa del ejercicio, renglón por renglón, no copiadas de lo que el código
 * devolvió — si se hubieran copiado, la prueba sólo confirmaría que el código
 * hace lo que hace.
 *
 * El ejercicio de prueba usa los valores de 2026 que trae el sistema anterior.
 */
import {
  calcularIsr, calcularImssObrero, calcularInfonavit, calcularPension,
  partirGravadoExento, calcularRecibo, calcularSdi, diasDeVacaciones,
  factorDeIntegracion, pesos, smgDeZona, Ejercicio,
} from './motor';

/* OJO: este ejercicio es un BANCO DE PRUEBAS, no la tarifa vigente.
 *
 * Sus renglones son los que el sistema anterior traía sembrados, y los valores
 * esperados de todas las pruebas de ISR de este archivo se derivaron a mano
 * contra ellos. Cambiarlos por los del DOF rompería cuarenta aserciones sin
 * probar nada nuevo: lo que aquí se verifica es la MECÁNICA del motor —que
 * mensualice, que encuentre el renglón, que reste el subsidio—, no que la tabla
 * sea la correcta. De eso se encarga `scripts/probar-tarifas-2026.ts`, que
 * corre contra la base real y coteja renglón por renglón contra el Anexo 8. */
const E2026: Ejercicio = {
  anio: 2026,
  umaDiaria: 113.14,
  umaMensual: 3300.72,
  umiDiaria: 100.81,
  smgGeneral: 315.04,
  smgFrontera: 440.87,
  tarifaIsr: [
    { limite_inferior:      0.01, limite_superior:    746.04, cuota_fija:      0.00, porcentaje:  1.92 },
    { limite_inferior:    746.05, limite_superior:   6332.05, cuota_fija:     14.32, porcentaje:  6.40 },
    { limite_inferior:   6332.06, limite_superior:  11128.01, cuota_fija:    371.83, porcentaje: 10.88 },
    { limite_inferior:  11128.02, limite_superior:  12935.82, cuota_fija:    893.63, porcentaje: 16.00 },
    { limite_inferior:  12935.83, limite_superior:  15487.71, cuota_fija:   1182.88, porcentaje: 17.92 },
    { limite_inferior:  15487.72, limite_superior:  31236.49, cuota_fija:   1640.18, porcentaje: 21.36 },
    { limite_inferior:  31236.50, limite_superior:  49233.00, cuota_fija:   4997.58, porcentaje: 23.52 },
    { limite_inferior:  49233.01, limite_superior:  93993.90, cuota_fija:   9233.62, porcentaje: 30.00 },
    { limite_inferior:  93993.91, limite_superior: 125325.20, cuota_fija:  22661.50, porcentaje: 32.00 },
    { limite_inferior: 125325.21, limite_superior: 375975.61, cuota_fija:  32691.18, porcentaje: 34.00 },
    { limite_inferior: 375975.62, limite_superior:      null, cuota_fija: 117912.32, porcentaje: 35.00 },
  ],
  subsidio: [
    { limite_inferior:    0.01, limite_superior: 1768.96, subsidio: 407.02 },
    { limite_inferior: 1768.97, limite_superior: 2653.38, subsidio: 406.83 },
    { limite_inferior: 2653.39, limite_superior: 3472.84, subsidio: 406.62 },
    { limite_inferior: 3472.85, limite_superior: 3537.87, subsidio: 392.77 },
    { limite_inferior: 3537.88, limite_superior: 4446.15, subsidio: 382.46 },
    { limite_inferior: 4446.16, limite_superior: 4717.18, subsidio: 354.23 },
    { limite_inferior: 4717.19, limite_superior: 5335.42, subsidio: 324.87 },
    { limite_inferior: 5335.43, limite_superior: 6224.67, subsidio: 294.63 },
    { limite_inferior: 6224.68, limite_superior: 7113.90, subsidio: 253.54 },
    { limite_inferior: 7113.91, limite_superior: 7382.33, subsidio: 217.61 },
    { limite_inferior: 7382.34, limite_superior:    null, subsidio:   0.00 },
  ],
};

describe('calcularIsr', () => {
  /**
   * Base semanal 3,000.
   *   mensualizada: 3000 × 30.4/7 = 13,028.571429
   *   renglón 5 (12,935.83 – 15,487.71): 1,182.88 + (13,028.571429 − 12,935.83) × 17.92 %
   *                                    = 1,182.88 + 92.741429 × 0.1792
   *                                    = 1,182.88 + 16.619264 = 1,199.499264
   *   subsidio: la base pasa de 7,382.34 → 0
   *   al periodo: 1,199.499264 × 7/30.4 = 276.200489 → 276.20
   */
  it('aplica el renglón correcto y devuelve el ISR a la escala del periodo', () => {
    const r = calcularIsr(3000, 'SEMANAL', E2026);
    expect(r.baseMensual).toBeCloseTo(13028.57, 2);
    expect(r.renglon).toBe(5);
    expect(r.isr).toBe(276.20);
    expect(r.subsidio).toBe(0);
  });

  /**
   * Base semanal 400 — sueldo bajo, el subsidio se come todo el impuesto.
   *   mensualizada: 400 × 30.4/7 = 1,737.142857
   *   renglón 2: 14.32 + (1,737.142857 − 746.05) × 6.40 % = 14.32 + 63.429943 = 77.749943
   *   subsidio de tabla: 407.02 → el ISR queda en 0
   *   subsidio APLICADO: sólo 77.749943, no los 407.02 completos
   *   al periodo: 77.749943 × 7/30.4 = 17.902699 → 17.90
   */
  it('el subsidio nunca deja el ISR en negativo y sólo se aplica lo que se usó', () => {
    const r = calcularIsr(400, 'SEMANAL', E2026);
    expect(r.isr).toBe(0);
    expect(r.subsidio).toBe(17.90);
  });

  /** Base mensual: el factor es 1, así que la tarifa se aplica directo. */
  it('con periodicidad mensual no mensualiza nada', () => {
    const r = calcularIsr(13028.57, 'MENSUAL', E2026);
    expect(r.baseMensual).toBe(13028.57);
    // 1,182.88 + (13,028.57 − 12,935.83) × 0.1792 = 1,182.88 + 16.618848 = 1,199.498848
    expect(r.isr).toBeCloseTo(1199.50, 2);
  });

  it('sin base gravable no hay impuesto', () => {
    expect(calcularIsr(0, 'SEMANAL', E2026).isr).toBe(0);
    expect(calcularIsr(-100, 'SEMANAL', E2026).isr).toBe(0);
  });

  it('se niega a calcular si no hay tarifa del ejercicio, en vez de suponerla', () => {
    const sinTarifa = { ...E2026, tarifaIsr: [] };
    expect(() => calcularIsr(3000, 'SEMANAL', sinTarifa)).toThrow(/No hay tarifa/);
  });

  it('el último renglón no tiene techo', () => {
    const r = calcularIsr(500000, 'MENSUAL', E2026);
    expect(r.renglon).toBe(11);
    // 117,912.32 + (500,000 − 375,975.62) × 0.35 = 117,912.32 + 43,408.533 = 161,320.853
    expect(r.isr).toBeCloseTo(161320.85, 1);
  });
});

describe('calcularImssObrero', () => {
  /**
   * SD 500, SDI 527.40, 7 días. 3 UMA = 339.42, el SDI lo rebasa.
   *   excedente: (527.40 − 339.42) × 0.40 % × 7 = 187.98 × 0.004 × 7 = 5.26344
   *   IV:        527.40 × 0.625 % × 7 = 23.07375
   *   CEAV:      527.40 × 1.125 % × 7 = 41.53275
   *   total ≈ 69.87
   */
  it('suma excedente, invalidez/vida y cesantía/vejez', () => {
    const r = calcularImssObrero(500, 527.40, 7, 'general', E2026);
    expect(r.excedente).toBeCloseTo(5.26, 2);
    expect(r.invalidezVida).toBeCloseTo(23.07, 2);
    expect(r.cesantiaVejez).toBeCloseTo(41.53, 2);
    expect(r.total).toBeCloseTo(69.87, 2);
  });

  it('con salario mínimo la cuota obrera es CERO (Art. 36 LSS)', () => {
    expect(calcularImssObrero(315.04, 330, 7, 'general', E2026).total).toBe(0);
    // Un centavo arriba del mínimo ya cotiza.
    expect(calcularImssObrero(315.05, 330, 7, 'general', E2026).total).toBeGreaterThan(0);
  });

  it('la zona fronteriza mueve el umbral de la exención', () => {
    // 400 está arriba del mínimo general pero debajo del de frontera.
    expect(calcularImssObrero(400, 420, 7, 'general', E2026).total).toBeGreaterThan(0);
    expect(calcularImssObrero(400, 420, 7, 'frontera_norte', E2026).total).toBe(0);
  });

  it('no cobra excedente cuando el SDI no pasa de 3 UMA', () => {
    // 3 UMA = 339.42
    const r = calcularImssObrero(400, 300, 7, 'general', E2026);
    expect(r.excedente).toBe(0);
    expect(r.total).toBeGreaterThan(0);
  });
});

describe('partirGravadoExento', () => {
  const ctx = { ejercicio: E2026, zona: 'general' as const, salarioDiario: 500, dias: 15 };

  it('aguinaldo: exento hasta 30 veces el salario mínimo', () => {
    // 30 × 315.04 = 9,451.20
    const r = partirGravadoExento('002', 12000, ctx);
    expect(r.exento).toBe(9451.20);
    expect(r.gravado).toBe(2548.80);
  });

  it('aguinaldo por debajo del tope: no grava nada', () => {
    const r = partirGravadoExento('002', 5000, ctx);
    expect(r.gravado).toBe(0);
    expect(r.exento).toBe(5000);
  });

  it('vales de despensa: exentos hasta 40 % de la UMA mensual', () => {
    // 0.40 × 3,300.72 = 1,320.288
    expect(partirGravadoExento('015', 1000, ctx).gravado).toBe(0);
    expect(partirGravadoExento('015', 2000, ctx).gravado).toBeCloseTo(679.71, 2);
  });

  it('premios de puntualidad: exentos hasta 10 % del salario del periodo', () => {
    // 0.10 × 500 × 15 = 750
    expect(partirGravadoExento('010', 700, ctx).gravado).toBe(0);
    expect(partirGravadoExento('010', 1000, ctx).gravado).toBe(250);
  });

  it('los viáticos comprobados no gravan y los no comprobados gravan todo', () => {
    expect(partirGravadoExento('050', 3000, ctx).gravado).toBe(0);
    expect(partirGravadoExento('050NC', 3000, ctx).gravado).toBe(3000);
  });

  it('un concepto manual respeta lo capturado, sin pasarse del importe', () => {
    expect(partirGravadoExento('019', 1000, ctx, 400).gravado).toBe(400);
    expect(partirGravadoExento('019', 1000, ctx, 5000).gravado).toBe(1000);
    expect(partirGravadoExento('019', 1000, ctx, -50).gravado).toBe(0);
    // Sin captura, grava completo.
    expect(partirGravadoExento('019', 1000, ctx).gravado).toBe(1000);
  });

  it('un concepto desconocido grava completo — es la postura conservadora', () => {
    expect(partirGravadoExento('999', 500, ctx).gravado).toBe(500);
  });

  it('la zona fronteriza sube la exención del aguinaldo', () => {
    const frontera = { ...ctx, zona: 'frontera_norte' as const };
    // 30 × 440.87 = 13,226.10 → 12,000 queda exento por completo
    expect(partirGravadoExento('002', 12000, frontera).gravado).toBe(0);
  });
});

describe('calcularRecibo — la regla del salario mínimo (Art. 93 Fr. XIV)', () => {
  const base = {
    salarioDiario: 315.04, sdi: 332.60, dias: 7,
    zona: 'general' as const, periodicidad: 'SEMANAL' as const,
  };

  it('quien gana el mínimo y no recibe otra cosa no causa ISR ni cuota obrera', () => {
    const r = calcularRecibo(base, E2026);
    expect(r.detalle.sueldoExentoPorSalarioMinimo).toBe(true);
    expect(r.baseGravable).toBe(0);
    expect(r.isr).toBe(0);
    expect(r.imss).toBe(0);
    expect(r.neto).toBe(pesos(315.04 * 7));
  });

  it('si recibe un ingreso gravado PIERDE la exención y el sueldo entra a la base', () => {
    const r = calcularRecibo({ ...base, otrosIngresos: [{ clave: '012', importe: 5000 }] }, E2026);
    expect(r.detalle.sueldoExentoPorSalarioMinimo).toBe(false);
    // 315.04 × 7 = 2,205.28 de sueldo + 5,000 de bono
    expect(r.baseGravable).toBe(pesos(2205.28 + 5000));
    expect(r.isr).toBeGreaterThan(0);
  });

  it('un ingreso EXENTO no le quita la exención al sueldo', () => {
    const r = calcularRecibo({ ...base, otrosIngresos: [{ clave: '050', importe: 3000 }] }, E2026);
    expect(r.detalle.sueldoExentoPorSalarioMinimo).toBe(true);
    expect(r.baseGravable).toBe(0);
  });
});

describe('calcularRecibo — el recibo completo cuadra', () => {
  it('neto = percepciones − deducciones + subsidio entregado', () => {
    const r = calcularRecibo({
      salarioDiario: 500, sdi: 527.40, dias: 15,
      zona: 'general', periodicidad: 'QUINCENAL',
      otrosIngresos: [{ clave: '015', importe: 800 }],
      otrasDeducciones: [{ clave: '012', importe: 250 }],
      infonavit: { tiene: true, tipo: 'porcentaje', valor: 20, seguroDanosDiario: 1.5 },
      pension: { tiene: true, tipo: 'porcentaje', monto: 15 },
    }, E2026);

    const sumaPerc = pesos(r.percepciones.reduce((s, p) => s + p.importe, 0));
    const sumaDed  = pesos(r.deducciones.reduce((s, d) => s + d.importe, 0));
    expect(r.totalPercepciones).toBe(sumaPerc);
    expect(r.totalDeducciones).toBe(sumaDed);
    expect(r.neto).toBe(pesos(r.totalPercepciones - r.totalDeducciones + r.totalOtrosPagos));
  });

  it('cada percepción reparte su importe entre gravado y exento, sin perder centavos', () => {
    const r = calcularRecibo({
      salarioDiario: 500, sdi: 527.40, dias: 15,
      zona: 'general', periodicidad: 'QUINCENAL',
      otrosIngresos: [{ clave: '002', importe: 12000 }, { clave: '015', importe: 2000 }],
    }, E2026);
    for (const p of r.percepciones) {
      expect(pesos(p.gravado + p.exento)).toBe(p.importe);
    }
  });

  it('el sueldo siempre es el primer renglón, con la clave 001', () => {
    const r = calcularRecibo({
      salarioDiario: 500, sdi: 527.40, dias: 15,
      zona: 'general', periodicidad: 'QUINCENAL',
      otrosIngresos: [{ clave: '012', importe: 100 }],
    }, E2026);
    expect(r.percepciones[0].clave).toBe('001');
    expect(r.percepciones[0].importe).toBe(7500);
  });

  it('un periodo sin días no se calcula', () => {
    expect(() => calcularRecibo({
      salarioDiario: 500, sdi: 527.40, dias: 0,
      zona: 'general', periodicidad: 'QUINCENAL',
    }, E2026)).toThrow(/cero días/);
  });
});

describe('calcularInfonavit', () => {
  it('porcentaje sobre el SDI por los días del periodo', () => {
    // 527.40 × 20 % × 15 = 1,582.20
    const r = calcularInfonavit({ tiene: true, tipo: 'porcentaje', valor: 20 }, 527.40, 15, 'general', E2026);
    expect(r.credito).toBeCloseTo(1582.20, 2);
  });

  it('la cuota fija es mensual y se prorratea', () => {
    // 1,000 × 15/30.4 = 493.42
    const r = calcularInfonavit({ tiene: true, tipo: 'cuota_fija', valor: 1000 }, 527.40, 15, 'general', E2026);
    expect(r.credito).toBeCloseTo(493.42, 2);
  });

  /* Esta prueba afirmaba lo contrario —"VSM usa el salario mínimo de la zona"—
   * y por eso el error sobrevivió: consagraba el comportamiento equivocado. La
   * reforma de 2016 a la Ley del INFONAVIT desligó los créditos en VSM del
   * salario mínimo y creó la UMI justamente para que sus alzas no inflaran la
   * deuda del trabajador. */
  it('VSM usa la UMI, no el salario mínimo (reforma 2016)', () => {
    // 100.81 × 2 × 15/30.4 = 99.48
    const r = calcularInfonavit({ tiene: true, tipo: 'vsm', valor: 2 }, 527.40, 15, 'general', E2026);
    expect(r.credito).toBeCloseTo(99.48, 2);

    // Con el salario mínimo habrían salido 310.89: más del TRIPLE.
    expect(r.credito).toBeLessThan(310.89 / 3 + 1);
  });

  it('la UMI no depende de la zona: el mismo crédito en frontera', () => {
    const g = calcularInfonavit({ tiene: true, tipo: 'vsm', valor: 2 }, 527.40, 15, 'general', E2026);
    const f = calcularInfonavit({ tiene: true, tipo: 'vsm', valor: 2 }, 527.40, 15, 'frontera_norte', E2026);
    expect(f.credito).toBeCloseTo(g.credito, 2);
  });

  it('sin UMI cargada se detiene en vez de usar el salario mínimo', () => {
    const sinUmi = { ...E2026, umiDiaria: null };
    expect(() =>
      calcularInfonavit({ tiene: true, tipo: 'vsm', valor: 2 }, 527.40, 15, 'general', sinUmi)
    ).toThrow(/UMI/);
  });

  it('el seguro de daños es diario y se suma aparte', () => {
    const r = calcularInfonavit(
      { tiene: true, tipo: 'cuota_fija', valor: 1000, seguroDanosDiario: 2 }, 527.40, 15, 'general', E2026
    );
    expect(r.seguroDanos).toBe(30);
    expect(r.total).toBe(pesos(r.credito + 30));
  });

  it('sin crédito no descuenta nada', () => {
    expect(calcularInfonavit({ tiene: false }, 527.40, 15, 'general', E2026).total).toBe(0);
    // Marcado pero sin valor: tampoco inventa un descuento.
    expect(calcularInfonavit({ tiene: true, tipo: 'porcentaje' }, 527.40, 15, 'general', E2026).total).toBe(0);
  });
});

describe('calcularPension', () => {
  it('porcentaje sobre las percepciones brutas', () => {
    expect(calcularPension({ tiene: true, tipo: 'porcentaje', monto: 15 }, 8000, 15)).toBe(1200);
  });
  it('cuota fija mensual prorrateada', () => {
    expect(calcularPension({ tiene: true, tipo: 'cuota_fija', monto: 2000 }, 8000, 15)).toBeCloseTo(986.84, 2);
  });
  it('sin orden judicial no descuenta', () => {
    expect(calcularPension({ tiene: false }, 8000, 15)).toBe(0);
  });
});

describe('SDI e integración', () => {
  it('días de vacaciones del Art. 76 reformado', () => {
    expect(diasDeVacaciones(0)).toBe(12);
    expect(diasDeVacaciones(1)).toBe(12);
    expect(diasDeVacaciones(2)).toBe(14);
    expect(diasDeVacaciones(5)).toBe(20);
    expect(diasDeVacaciones(6)).toBe(22);
    expect(diasDeVacaciones(10)).toBe(22);
    expect(diasDeVacaciones(11)).toBe(24);
    expect(diasDeVacaciones(16)).toBe(26);
  });

  it('factor de integración mínimo de ley: (365 + 15 + 12×25 %) / 365', () => {
    // 383/365 = 1.049315…
    expect(factorDeIntegracion(15, 25, 12)).toBeCloseTo(1.0493, 4);
  });

  it('SDI de un trabajador de primer año con los mínimos', () => {
    const r = calcularSdi(500, 15, 25, 0, E2026.umaDiaria);
    expect(r.factor).toBeCloseTo(1.0493, 4);
    expect(r.sdi).toBe(524.66);
    expect(r.topado).toBe(false);
  });

  it('una política más generosa sube el SDI', () => {
    // 30 días de aguinaldo y 100 % de prima: (365 + 30 + 12) / 365 = 1.115068
    const r = calcularSdi(500, 30, 100, 0, E2026.umaDiaria);
    expect(r.factor).toBeCloseTo(1.1151, 4);
    expect(r.sdi).toBeCloseTo(557.53, 2);
  });

  it('el SDI se topa a 25 UMA (Art. 28 LSS)', () => {
    // 25 × 113.14 = 2,828.50
    const r = calcularSdi(5000, 15, 25, 0, E2026.umaDiaria);
    expect(r.sdi).toBe(2828.50);
    expect(r.topado).toBe(true);
  });
});

describe('utilidades', () => {
  it('smgDeZona distingue las dos zonas', () => {
    expect(smgDeZona(E2026, 'general')).toBe(315.04);
    expect(smgDeZona(E2026, 'frontera_norte')).toBe(440.87);
  });

  it('pesos redondea a centavos sin arrastrar el error del binario', () => {
    expect(pesos(1.005)).toBe(1.01);
    expect(pesos(2.675)).toBe(2.68);
    expect(pesos(0.1 + 0.2)).toBe(0.3);
  });
});
