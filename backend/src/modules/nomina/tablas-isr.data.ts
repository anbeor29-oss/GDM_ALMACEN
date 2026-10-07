/**
 * tablas-isr.data — las tablas del ISR 2026 COMPLETAS, para CONSULTA en pantalla.
 *
 * QUÉ ES ESTO Y QUÉ NO ES
 * El motor de nómina retiene con la tarifa que vive en la base de datos
 * (`nomina_tarifa_isr`, periodicidad MENSUAL/SEMANAL/QUINCENAL), cotejada contra
 * el DOF en la migración `2026-08-17h_tarifas_2026_dof.sql`. ESTE archivo NO es
 * para calcular: es el REGISTRO de referencia que pide el contador —las tablas
 * por periodo, las doce tablas acumuladas por mes y la anual— para cotejar de un
 * vistazo contra la publicación oficial. Se sirve de sólo lectura en
 * Nómina → Parámetros. Por eso es un archivo versionado y no una tabla: son
 * números del país, no de la empresa, y agregar un año es agregar un objeto.
 *
 * DE DÓNDE SALEN LOS NÚMEROS
 * Tarifas del Art. 96 LISR y pagos provisionales — Anexo 8 de la RMF 2026
 * (DOF 28/12/2025), tal como las publica el SAT y las reproduce
 * elcontribuyente.mx/tablas-isr/2026 (consultado 2026-10-06). La tarifa MENSUAL
 * de aquí coincide renglón por renglón con la que el motor trae cotejada del DOF
 * (la fila «enero» de los pagos provisionales ES la tarifa mensual); si algún día
 * difirieran por un centavo, manda la del DOF en la base de datos.
 *
 * PARA QUÉ SIRVE CADA TABLA
 *   · Las de PERIODICIDAD (diaria/semanal/decenal/quincenal/MENSUAL/bimestral)
 *     son la RETENCIÓN del ISR de SUELDOS Y SALARIOS —la nómina—, según el
 *     periodo de pago. La MENSUAL es la que usa el motor de nómina.
 *   · Las DOCE «por mes» (acumuladas) y la ANUAL son para los PAGOS
 *     PROVISIONALES: personas físicas con actividad empresarial y profesional
 *     (régimen 612) y, en general, cualquier pago provisional (Art. 106 LISR) y
 *     el cálculo anual (Art. 152). NO son de nómina.
 *
 * LAS DOCE «TABLAS POR MES» SON LAS ACUMULADAS
 * En los pagos provisionales se acumula el ingreso de enero al mes y se aplica
 * la tabla de ESE mes: la del mes N es la tarifa elevada a N meses, con el
 * redondeo propio del SAT. No es exactamente «mensual × N»: por eso van las doce
 * completas y no derivadas. Dos igualdades que el SAT respeta y que aquí se
 * aprovechan para no repetir números:
 *   · mes  1 (enero)     = tarifa MENSUAL
 *   · mes  2 (febrero)   = tarifa BIMESTRAL
 *   · mes 12 (diciembre) = tarifa ANUAL del ejercicio
 *
 * EL SUBSIDIO NO SE DUPLICA AQUÍ
 * Desde el decreto de 2024 el subsidio al empleo dejó de ser una escalera de
 * once renglones y es un porcentaje de la UMA (un solo importe hasta cierto
 * tope). El valor vigente vive en `nomina_subsidio` y se ve arriba, en la misma
 * pantalla, con su vigencia. Reproducir aquí las viejas escaleras de subsidio
 * por periodo —que el motor ya no usa— sólo agregaría números que mantener.
 *
 * CÓMO AGREGAR UN AÑO
 *   1. Captura `MESES_<año>` con las doce tablas acumuladas (enero … diciembre)
 *      del Anexo 8 de la RMF de ese año.
 *   2. Captura `DIARIA/SEMANAL/DECENAL/QUINCENAL_<año>` (las sub-mensuales).
 *   3. Agrega la entrada `<año>:` a `TABLAS_ISR`, apuntando anual→mes 12,
 *      mensual→mes 1, bimestral→mes 2.
 *   4. Coteja contra el DOF antes de confiar en ellas.
 */

export interface RenglonIsr {
  limite_inferior: number;
  limite_superior: number | null;   // null = «en adelante»
  cuota_fija: number;
  porcentaje: number;
}

/** Periodicidades de retención del Art. 96 (apartado B del Anexo 8). */
export type Periodicidad =
  | 'DIARIA' | 'SEMANAL' | 'DECENAL' | 'QUINCENAL' | 'MENSUAL' | 'BIMESTRAL';

export interface TablaIsrAnio {
  fuente: string;
  capturado: string;                         // YYYY-MM-DD
  anual: RenglonIsr[];                        // tarifa del ejercicio (Art. 152 / Anexo 8)
  meses: Record<number, RenglonIsr[]>;        // 1..12, acumuladas para pagos provisionales
  periodicas: Record<Periodicidad, RenglonIsr[]>;
}

/** Nombres de mes, para la pantalla. */
export const MESES_NOMBRE: Record<number, string> = {
  1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril', 5: 'Mayo', 6: 'Junio',
  7: 'Julio', 8: 'Agosto', 9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
};

/** Etiqueta legible de cada periodicidad. */
export const PERIODICIDAD_NOMBRE: Record<Periodicidad, string> = {
  DIARIA: 'Diaria', SEMANAL: 'Semanal', DECENAL: 'Decenal',
  QUINCENAL: 'Quincenal', MENSUAL: 'Mensual', BIMESTRAL: 'Bimestral',
};

/* Tuplas [límite_inferior, límite_superior, cuota_fija, % excedente] para que
 * cotejar contra el DOF sea leer una fila y no cuatro campos. `null` = en adelante. */
type Fila = [number, number | null, number, number];
const R = (filas: Fila[]): RenglonIsr[] =>
  filas.map(([a, b, c, d]) => ({ limite_inferior: a, limite_superior: b, cuota_fija: c, porcentaje: d }));

/* ═══════════════════════ 2026 ═══════════════════════ */

/* Doce tablas acumuladas (pagos provisionales), Anexo 8 RMF 2026. */
const MESES_2026: Record<number, RenglonIsr[]> = {
  /* Enero — es idéntica a la tarifa MENSUAL del Art. 96. */
  1: R([
    [0.01, 844.59, 0.00, 1.92],
    [844.60, 7168.51, 16.22, 6.40],
    [7168.52, 12598.02, 420.95, 10.88],
    [12598.03, 14644.64, 1011.68, 16.00],
    [14644.65, 17533.64, 1339.14, 17.92],
    [17533.65, 35362.83, 1856.84, 21.36],
    [35362.84, 55736.68, 5665.16, 23.52],
    [55736.69, 106410.50, 10457.09, 30.00],
    [106410.51, 141880.66, 25659.23, 32.00],
    [141880.67, 425641.99, 37009.69, 34.00],
    [425642.00, null, 133488.54, 35.00],
  ]),
  /* Febrero — es idéntica a la tarifa BIMESTRAL. */
  2: R([
    [0.01, 1689.18, 0.00, 1.92],
    [1689.19, 14337.02, 32.44, 6.40],
    [14337.03, 25196.04, 841.90, 10.88],
    [25196.05, 29289.28, 2023.36, 16.00],
    [29289.29, 35067.28, 2678.28, 17.92],
    [35067.29, 70725.66, 3713.68, 21.36],
    [70725.67, 111473.36, 11330.32, 23.52],
    [111473.37, 212821.00, 20914.18, 30.00],
    [212821.01, 283761.32, 51318.46, 32.00],
    [283761.33, 851283.98, 74019.38, 34.00],
    [851283.99, null, 266977.08, 35.00],
  ]),
  3: R([
    [0.01, 2533.77, 0.00, 1.92],
    [2533.78, 21505.53, 48.66, 6.40],
    [21505.54, 37794.06, 1262.85, 10.88],
    [37794.07, 43933.92, 3035.04, 16.00],
    [43933.93, 52600.92, 4017.42, 17.92],
    [52600.93, 106088.49, 5570.52, 21.36],
    [106088.50, 167210.04, 16995.48, 23.52],
    [167210.05, 319231.50, 31371.27, 30.00],
    [319231.51, 425641.98, 76977.69, 32.00],
    [425641.99, 1276925.97, 111029.07, 34.00],
    [1276925.98, null, 400465.62, 35.00],
  ]),
  4: R([
    [0.01, 3378.36, 0.00, 1.92],
    [3378.37, 28674.04, 64.88, 6.40],
    [28674.05, 50392.08, 1683.80, 10.88],
    [50392.09, 58578.56, 4046.72, 16.00],
    [58578.57, 70134.56, 5356.56, 17.92],
    [70134.57, 141451.32, 7427.36, 21.36],
    [141451.33, 222946.72, 22660.64, 23.52],
    [222946.73, 425642.00, 41828.36, 30.00],
    [425642.01, 567522.64, 102636.92, 32.00],
    [567522.65, 1702567.96, 148038.76, 34.00],
    [1702567.97, null, 533954.16, 35.00],
  ]),
  5: R([
    [0.01, 4222.95, 0.00, 1.92],
    [4222.96, 35842.55, 81.10, 6.40],
    [35842.56, 62990.10, 2104.75, 10.88],
    [62990.11, 73223.20, 5058.40, 16.00],
    [73223.21, 87668.20, 6695.70, 17.92],
    [87668.21, 176814.15, 9284.20, 21.36],
    [176814.16, 278683.40, 28325.80, 23.52],
    [278683.41, 532052.50, 52285.45, 30.00],
    [532052.51, 709403.30, 128296.15, 32.00],
    [709403.31, 2128209.95, 185048.45, 34.00],
    [2128209.96, null, 667442.70, 35.00],
  ]),
  6: R([
    [0.01, 5067.54, 0.00, 1.92],
    [5067.55, 43011.06, 97.32, 6.40],
    [43011.07, 75588.12, 2525.70, 10.88],
    [75588.13, 87867.84, 6070.08, 16.00],
    [87867.85, 105201.84, 8034.84, 17.92],
    [105201.85, 212176.98, 11141.04, 21.36],
    [212176.99, 334420.08, 33990.96, 23.52],
    [334420.09, 638463.00, 62742.54, 30.00],
    [638463.01, 851283.96, 153955.38, 32.00],
    [851283.97, 2553851.94, 222058.14, 34.00],
    [2553851.95, null, 800931.24, 35.00],
  ]),
  7: R([
    [0.01, 5912.13, 0.00, 1.92],
    [5912.14, 50179.57, 113.54, 6.40],
    [50179.58, 88186.14, 2946.65, 10.88],
    [88186.15, 102512.48, 7081.76, 16.00],
    [102512.49, 122735.48, 9373.98, 17.92],
    [122735.49, 247539.81, 12997.88, 21.36],
    [247539.82, 390156.76, 39656.12, 23.52],
    [390156.77, 744873.50, 73199.63, 30.00],
    [744873.51, 993164.62, 179614.61, 32.00],
    [993164.63, 2979493.93, 259067.83, 34.00],
    [2979493.94, null, 934419.78, 35.00],
  ]),
  8: R([
    [0.01, 6756.72, 0.00, 1.92],
    [6756.73, 57348.08, 129.76, 6.40],
    [57348.09, 100784.16, 3367.60, 10.88],
    [100784.17, 117157.12, 8093.44, 16.00],
    [117157.13, 140269.12, 10713.12, 17.92],
    [140269.13, 282902.64, 14854.72, 21.36],
    [282902.65, 445893.44, 45321.28, 23.52],
    [445893.45, 851284.00, 83656.72, 30.00],
    [851284.01, 1135045.28, 205273.84, 32.00],
    [1135045.29, 3405135.92, 296077.52, 34.00],
    [3405135.93, null, 1067908.32, 35.00],
  ]),
  9: R([
    [0.01, 7601.31, 0.00, 1.92],
    [7601.32, 64516.59, 145.98, 6.40],
    [64516.60, 113382.18, 3788.55, 10.88],
    [113382.19, 131801.76, 9105.12, 16.00],
    [131801.77, 157802.76, 12052.26, 17.92],
    [157802.77, 318265.47, 16711.56, 21.36],
    [318265.48, 501630.12, 50986.44, 23.52],
    [501630.13, 957694.50, 94113.81, 30.00],
    [957694.51, 1276925.94, 230933.07, 32.00],
    [1276925.95, 3830777.91, 333087.21, 34.00],
    [3830777.92, null, 1201396.86, 35.00],
  ]),
  10: R([
    [0.01, 8445.90, 0.00, 1.92],
    [8445.91, 71685.10, 162.20, 6.40],
    [71685.11, 125980.20, 4209.50, 10.88],
    [125980.21, 146446.40, 10116.80, 16.00],
    [146446.41, 175336.40, 13391.40, 17.92],
    [175336.41, 353628.30, 18568.40, 21.36],
    [353628.31, 557366.80, 56651.60, 23.52],
    [557366.81, 1064105.00, 104570.90, 30.00],
    [1064105.01, 1418806.60, 256592.30, 32.00],
    [1418806.61, 4256419.90, 370096.90, 34.00],
    [4256419.91, null, 1334885.40, 35.00],
  ]),
  11: R([
    [0.01, 9290.49, 0.00, 1.92],
    [9290.50, 78853.61, 178.42, 6.40],
    [78853.62, 138578.22, 4630.45, 10.88],
    [138578.23, 161091.04, 11128.48, 16.00],
    [161091.05, 192870.04, 14730.54, 17.92],
    [192870.05, 388991.13, 20425.24, 21.36],
    [388991.14, 613103.48, 62316.76, 23.52],
    [613103.49, 1170515.50, 115027.99, 30.00],
    [1170515.51, 1560687.26, 282251.53, 32.00],
    [1560687.27, 4682061.89, 407106.59, 34.00],
    [4682061.90, null, 1468373.94, 35.00],
  ]),
  /* Diciembre — es idéntica a la tarifa ANUAL del ejercicio. */
  12: R([
    [0.01, 10135.11, 0.00, 1.92],
    [10135.12, 86022.11, 194.59, 6.40],
    [86022.12, 151176.19, 5051.37, 10.88],
    [151176.20, 175735.66, 12140.13, 16.00],
    [175735.67, 210403.69, 16069.64, 17.92],
    [210403.70, 424353.97, 22282.14, 21.36],
    [424353.98, 668840.14, 67981.92, 23.52],
    [668840.15, 1276925.98, 125485.07, 30.00],
    [1276925.99, 1702567.97, 307910.81, 32.00],
    [1702567.98, 5107703.92, 444116.23, 34.00],
    [5107703.93, null, 1601862.46, 35.00],
  ]),
};

/* Sub-mensuales (retención por periodo corto), Anexo 8 RMF 2026 apartado B. */
const DIARIA_2026 = R([
  [0.01, 27.78, 0.00, 1.92],
  [27.79, 235.81, 0.53, 6.40],
  [235.82, 414.41, 13.85, 10.88],
  [414.42, 481.73, 33.28, 16.00],
  [481.74, 576.76, 44.05, 17.92],
  [576.77, 1163.25, 61.08, 21.36],
  [1163.26, 1833.44, 186.35, 23.52],
  [1833.45, 3500.35, 343.98, 30.00],
  [3500.36, 4667.13, 844.05, 32.00],
  [4667.14, 14001.38, 1217.42, 34.00],
  [14001.39, null, 4391.07, 35.00],
]);

const SEMANAL_2026 = R([
  [0.01, 194.46, 0.00, 1.92],
  [194.47, 1650.67, 3.71, 6.40],
  [1650.68, 2900.87, 96.95, 10.88],
  [2900.88, 3372.11, 232.96, 16.00],
  [3372.12, 4037.32, 308.35, 17.92],
  [4037.33, 8142.75, 427.56, 21.36],
  [8142.76, 12834.08, 1304.45, 23.52],
  [12834.09, 24502.45, 2407.86, 30.00],
  [24502.46, 32669.91, 5908.35, 32.00],
  [32669.92, 98009.66, 8521.94, 34.00],
  [98009.67, null, 30737.49, 35.00],
]);

const DECENAL_2026 = R([
  [0.01, 277.80, 0.00, 1.92],
  [277.81, 2358.10, 5.30, 6.40],
  [2358.11, 4144.10, 138.50, 10.88],
  [4144.11, 4817.30, 332.80, 16.00],
  [4817.31, 5767.60, 440.50, 17.92],
  [5767.61, 11632.50, 610.80, 21.36],
  [11632.51, 18334.40, 1863.50, 23.52],
  [18334.41, 35003.50, 3439.80, 30.00],
  [35003.51, 46671.30, 8440.50, 32.00],
  [46671.31, 140013.80, 12174.20, 34.00],
  [140013.81, null, 43910.70, 35.00],
]);

const QUINCENAL_2026 = R([
  [0.01, 416.70, 0.00, 1.92],
  [416.71, 3537.15, 7.95, 6.40],
  [3537.16, 6216.15, 207.75, 10.88],
  [6216.16, 7225.95, 499.20, 16.00],
  [7225.96, 8651.40, 660.75, 17.92],
  [8651.41, 17448.75, 916.20, 21.36],
  [17448.76, 27501.60, 2795.25, 23.52],
  [27501.61, 52505.25, 5159.70, 30.00],
  [52505.26, 70006.95, 12660.75, 32.00],
  [70006.96, 210020.70, 18261.30, 34.00],
  [210020.71, null, 65866.05, 35.00],
]);

export const TABLAS_ISR: Record<number, TablaIsrAnio> = {
  2026: {
    fuente:
      'Anexo 8 de la Resolución Miscelánea Fiscal 2026 (DOF 28/12/2025), ' +
      'tarifas del Art. 96 LISR y pagos provisionales. Reproducido por ' +
      'elcontribuyente.mx/tablas-isr/2026 (consultado 06/10/2026). La tarifa ' +
      'mensual coincide con la cotejada contra el DOF que usa el motor.',
    capturado: '2026-10-06',
    anual: MESES_2026[12],       // diciembre acumulado = tarifa anual
    meses: MESES_2026,
    periodicas: {
      DIARIA: DIARIA_2026,
      SEMANAL: SEMANAL_2026,
      DECENAL: DECENAL_2026,
      QUINCENAL: QUINCENAL_2026,
      MENSUAL: MESES_2026[1],    // enero acumulado = tarifa mensual
      BIMESTRAL: MESES_2026[2],  // febrero acumulado = tarifa bimestral
    },
  },
};

/** El paquete de un año, o null si todavía no se captura. */
export function tablasIsr(anio: number): TablaIsrAnio | null {
  return TABLAS_ISR[anio] ?? null;
}

/** Años con tablas cargadas, del más reciente al más viejo. */
export function aniosConTablasIsr(): number[] {
  return Object.keys(TABLAS_ISR).map(Number).sort((a, b) => b - a);
}
