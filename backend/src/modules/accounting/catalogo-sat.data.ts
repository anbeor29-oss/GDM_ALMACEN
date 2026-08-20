/**
 * Código agrupador del SAT — Anexo 24 de la RMF 2026 (DOF 13/01/2026).
 *
 * ── QUÉ ES ESTO Y QUÉ NO ES ──
 * NO es el catálogo de cuentas de la empresa. Es la tabla de EQUIVALENCIAS a la
 * que se mapea el catálogo propio. El propio Anexo 24 lo dice: el contribuyente
 * mantiene su catálogo y lo mapea al agrupador.
 *
 * Varias cuentas propias pueden apuntar al mismo agrupador —dos cuentas de
 * banco distintas son las dos '102.01'— y eso es correcto, no un duplicado.
 *
 * ── UN LÍMITE QUE SE RESPETA EN VEZ DE RELLENAR ──
 * Esta siembra viene del RESUMEN del Anexo 24, no del archivo oficial del SAT.
 * El resumen detalla algunos rangos por completo ('601.01 a .84', '401.01 a
 * .37', toda la serie 800) y otros sólo los enuncia: dice '109.01-23 Pagos
 * anticipados (seguros, rentas, intereses, factoraje, arrendamiento,
 * fideicomisos, otros)' — veintitrés códigos y siete descripciones.
 *
 * De esos rangos se siembra ÚNICAMENTE la cuenta mayor. Inventar '109.08
 * Anticipo de honorarios' porque suena razonable sería sembrar una equivalencia
 * falsa en el campo que va al buzón tributario, y nadie la volvería a revisar.
 *
 * Un código faltante se nota y se pide. Un código inventado se usa.
 *
 * Para completar el nivel 2 hace falta el archivo oficial del SAT. Mientras
 * tanto no bloquea nada: se decidió contabilidad interna primero, y el
 * agrupador sólo es obligatorio para el XML del Anexo 24.
 */

export type TipoCuenta =
  | 'ACTIVO' | 'PASIVO' | 'CAPITAL' | 'INGRESO'
  | 'COSTO' | 'GASTO' | 'RIF' | 'ORDEN';

export type Naturaleza = 'DEUDORA' | 'ACREEDORA';

export interface CodigoSat {
  codigo: string;
  nombre: string;
  nivel: 1 | 2;
  padre?: string;
  tipo: TipoCuenta;
  naturaleza: Naturaleza;
  nif?: string;
  /** Cuenta que RESTA del rubro que corrige (depreciación acumulada, estimaciones). */
  complementaria?: boolean;
}

const D: Naturaleza = 'DEUDORA';
const A: Naturaleza = 'ACREEDORA';

/* ═══════════════════════════════════════════════════════════════════════════
   CUENTAS MAYORES (nivel 1) — completas
   ═══════════════════════════════════════════════════════════════════════════ */

const MAYORES: Array<[string, string, TipoCuenta, Naturaleza, string?, boolean?]> = [
  /* ── 100.01 Activo a corto plazo ── */
  ['101', 'Caja', 'ACTIVO', D, 'C-1'],
  ['102', 'Bancos', 'ACTIVO', D, 'C-1'],
  ['103', 'Inversiones', 'ACTIVO', D, 'C-2'],
  ['104', 'Otros instrumentos financieros', 'ACTIVO', D, 'C-2'],
  ['105', 'Clientes', 'ACTIVO', D, 'C-3'],
  ['106', 'Cuentas y documentos por cobrar a corto plazo', 'ACTIVO', D, 'C-3'],
  ['107', 'Deudores diversos', 'ACTIVO', D, 'C-3'],
  ['108', 'Estimación de cuentas incobrables', 'ACTIVO', A, 'C-16', true],
  ['109', 'Pagos anticipados', 'ACTIVO', D, 'C-5'],
  ['110', 'Subsidio al empleo por aplicar', 'ACTIVO', D, 'D-3'],
  ['111', 'Crédito al diesel por acreditar', 'ACTIVO', D],
  ['112', 'Otros estímulos', 'ACTIVO', D],
  ['113', 'Impuestos a favor', 'ACTIVO', D, 'D-4'],
  ['114', 'Pagos provisionales de ISR', 'ACTIVO', D, 'D-4'],
  ['115', 'Inventario', 'ACTIVO', D, 'C-4'],
  ['116', 'Estimación de inventarios obsoletos y de lento movimiento', 'ACTIVO', A, 'C-4', true],
  ['117', 'Obras en proceso de inmuebles', 'ACTIVO', D, 'C-6'],
  ['118', 'Impuestos acreditables pagados', 'ACTIVO', D],
  ['119', 'Impuestos acreditables por pagar', 'ACTIVO', D],
  ['120', 'Anticipo a proveedores', 'ACTIVO', D, 'C-5'],
  ['121', 'Otros activos a corto plazo', 'ACTIVO', D],

  /* ── 100.02 Activo a largo plazo ── */
  ['151', 'Terrenos', 'ACTIVO', D, 'C-6'],
  ['152', 'Edificios', 'ACTIVO', D, 'C-6'],
  ['153', 'Maquinaria y equipo', 'ACTIVO', D, 'C-6'],
  ['154', 'Automóviles, autobuses, camiones, tractocamiones, montacargas y remolques', 'ACTIVO', D, 'C-6'],
  ['155', 'Mobiliario y equipo de oficina', 'ACTIVO', D, 'C-6'],
  ['156', 'Equipo de cómputo', 'ACTIVO', D, 'C-6'],
  ['157', 'Equipo de comunicación', 'ACTIVO', D, 'C-6'],
  ['158', 'Activos biológicos, vegetales y semovientes', 'ACTIVO', D, 'E-1'],
  ['159', 'Obras en proceso de activos fijos', 'ACTIVO', D, 'C-6'],
  ['160', 'Otros activos fijos', 'ACTIVO', D, 'C-6'],
  ['161', 'Ferrocarriles', 'ACTIVO', D, 'C-6'],
  ['162', 'Embarcaciones', 'ACTIVO', D, 'C-6'],
  ['163', 'Aviones', 'ACTIVO', D, 'C-6'],
  ['164', 'Troqueles, moldes, matrices y herramental', 'ACTIVO', D, 'C-6'],
  ['165', 'Equipo de comunicaciones telefónicas', 'ACTIVO', D, 'C-6'],
  ['166', 'Equipo de comunicación satelital', 'ACTIVO', D, 'C-6'],
  ['167', 'Equipo de adaptaciones para personas con capacidades diferentes', 'ACTIVO', D, 'C-6'],
  ['168', 'Maquinaria y equipo de generación de energía renovable o cogeneración eficiente', 'ACTIVO', D, 'C-6'],
  ['169', 'Otra maquinaria y equipo', 'ACTIVO', D, 'C-6'],
  ['170', 'Adaptaciones y mejoras', 'ACTIVO', D, 'C-6'],
  ['171', 'Depreciación acumulada de activos fijos', 'ACTIVO', A, 'C-6', true],
  ['172', 'Pérdida por deterioro acumulado de activos fijos', 'ACTIVO', A, 'C-15', true],
  ['173', 'Gastos diferidos', 'ACTIVO', D, 'C-8'],
  ['174', 'Gastos pre operativos', 'ACTIVO', D, 'C-8'],
  ['175', 'Regalías, asistencia técnica y otros gastos diferidos', 'ACTIVO', D, 'C-8'],
  ['176', 'Activos intangibles', 'ACTIVO', D, 'C-8'],
  ['177', 'Gastos de organización', 'ACTIVO', D, 'C-8'],
  ['178', 'Investigación y desarrollo de mercado', 'ACTIVO', D, 'C-8'],
  ['179', 'Marcas y patentes', 'ACTIVO', D, 'C-8'],
  ['180', 'Crédito mercantil', 'ACTIVO', D, 'C-8'],
  ['181', 'Gastos de instalación', 'ACTIVO', D, 'C-8'],
  ['182', 'Otros activos diferidos', 'ACTIVO', D, 'C-8'],
  ['183', 'Amortización acumulada de activos diferidos', 'ACTIVO', A, 'C-8', true],
  ['184', 'Depósitos en garantía', 'ACTIVO', D, 'C-3'],
  ['185', 'Impuestos diferidos ISR', 'ACTIVO', D, 'D-4'],
  ['186', 'Cuentas y documentos por cobrar a largo plazo', 'ACTIVO', D, 'C-3'],
  ['187', 'PTU diferida', 'ACTIVO', D, 'D-3'],
  ['188', 'Inversiones permanentes en acciones', 'ACTIVO', D, 'C-7'],
  ['189', 'Otros instrumentos financieros', 'ACTIVO', D, 'C-2'],
  ['190', 'Otros activos a largo plazo', 'ACTIVO', D],

  /* ── 200.01 Pasivo a corto plazo ── */
  ['201', 'Proveedores', 'PASIVO', A, 'C-19'],
  ['202', 'Cuentas por pagar a corto plazo', 'PASIVO', A, 'C-19'],
  ['203', 'Cobros anticipados a corto plazo', 'PASIVO', A, 'D-1'],
  ['204', 'Instrumentos financieros a corto plazo', 'PASIVO', A, 'C-19'],
  ['205', 'Acreedores diversos a corto plazo', 'PASIVO', A, 'C-19'],
  ['206', 'Anticipo de clientes', 'PASIVO', A, 'D-1'],
  ['207', 'Impuestos trasladados', 'PASIVO', A],
  ['208', 'Impuestos trasladados cobrados', 'PASIVO', A],
  ['209', 'Impuestos trasladados no cobrados', 'PASIVO', A],
  ['210', 'Provisión de sueldos y salarios', 'PASIVO', A, 'D-3'],
  ['211', 'Provisión de contribuciones de seguridad social', 'PASIVO', A, 'D-3'],
  ['212', 'Provisión de impuesto estatal sobre nómina por pagar', 'PASIVO', A, 'D-3'],
  ['213', 'Impuestos y derechos por pagar', 'PASIVO', A],
  ['214', 'Dividendos por pagar', 'PASIVO', A, 'C-11'],
  ['215', 'PTU por pagar', 'PASIVO', A, 'D-3'],
  ['216', 'Impuestos retenidos', 'PASIVO', A],
  ['217', 'Pagos realizados por cuenta de terceros', 'PASIVO', A],
  ['218', 'Otros pasivos a corto plazo', 'PASIVO', A],

  /* ── 200.02 Pasivo a largo plazo ── */
  ['251', 'Acreedores diversos a largo plazo', 'PASIVO', A, 'C-19'],
  ['252', 'Cuentas por pagar a largo plazo', 'PASIVO', A, 'C-19'],
  ['253', 'Cobros anticipados a largo plazo', 'PASIVO', A, 'D-1'],
  ['254', 'Instrumentos financieros a largo plazo', 'PASIVO', A, 'C-19'],
  ['255', 'Pasivos por beneficios a los empleados a largo plazo', 'PASIVO', A, 'D-3'],
  ['256', 'Otros pasivos a largo plazo', 'PASIVO', A],
  ['257', 'PTU diferida', 'PASIVO', A, 'D-3'],
  ['258', 'Obligaciones contraídas de fideicomisos', 'PASIVO', A],
  ['259', 'Impuestos diferidos', 'PASIVO', A, 'D-4'],
  ['260', 'Pasivos diferidos', 'PASIVO', A],

  /* ── 300 Capital contable ── */
  ['301', 'Capital social', 'CAPITAL', A, 'C-11'],
  ['302', 'Patrimonio', 'CAPITAL', A, 'C-11'],
  ['303', 'Reserva legal', 'CAPITAL', A, 'C-11'],
  ['304', 'Resultado de ejercicios anteriores', 'CAPITAL', A, 'C-11'],
  ['305', 'Resultado del ejercicio', 'CAPITAL', A, 'C-11'],
  ['306', 'Otras cuentas de capital', 'CAPITAL', A, 'C-11'],

  /* ── 400 Ingresos ── */
  ['401', 'Ingresos', 'INGRESO', A, 'D-1'],
  /* Contra-ingreso: RESTA de las ventas. Es complementaria igual que 171,
   * aunque no sea de activo — la regla no es "activo con saldo acreedor",
   * es "naturaleza contraria a la de su tipo porque corrige su rubro". */
  ['402', 'Devoluciones, descuentos o bonificaciones', 'INGRESO', D, 'D-1', true],
  ['403', 'Otros ingresos', 'INGRESO', A, 'D-1'],

  /* ── 500 Costos ── */
  ['501', 'Costo de venta y/o servicio', 'COSTO', D, 'D-2'],
  ['502', 'Compras', 'COSTO', D, 'C-4'],
  /* Contra-costo: RESTA de las compras. */
  ['503', 'Devoluciones, descuentos o bonificaciones sobre compras', 'COSTO', A, 'C-4', true],
  ['504', 'Gastos indirectos de fabricación', 'COSTO', D, 'C-4'],
  ['505', 'Costo de activo fijo', 'COSTO', D, 'C-6'],

  /* ── 600 Gastos ── */
  ['601', 'Gastos generales', 'GASTO', D],
  ['602', 'Gastos de venta', 'GASTO', D],
  ['603', 'Gastos de administración', 'GASTO', D],
  ['604', 'Gastos de fabricación', 'GASTO', D],
  ['605', 'Mano de obra directa', 'GASTO', D, 'D-3'],
  ['606', 'Facilidades administrativas fiscales', 'GASTO', D],
  ['607', 'PTU - Participación de los trabajadores en las utilidades', 'GASTO', D, 'D-3'],
  ['608', 'Participación en resultados de subsidiarias', 'GASTO', D, 'C-7'],
  ['609', 'Participación en resultados de asociadas', 'GASTO', D, 'C-7'],
  ['610', 'PTU diferida', 'GASTO', D, 'D-3'],
  ['611', 'Impuesto Sobre la Renta', 'GASTO', D, 'D-4'],
  ['612', 'Gastos no deducibles para CUFIN', 'GASTO', D],

  /* ── 700 Resultado integral de financiamiento ── */
  ['701', 'Depreciación contable', 'RIF', D, 'C-6'],
  ['702', 'Amortización contable', 'RIF', D, 'C-8'],
  ['703', 'Gastos y productos financieros', 'RIF', D, 'D-6'],
  ['704', 'Otros gastos y otros productos', 'RIF', D],
];

/* ═══════════════════════════════════════════════════════════════════════════
   SUBCUENTAS (nivel 2) — SÓLO las que el Anexo 24 detalla nombre por nombre
   ═══════════════════════════════════════════════════════════════════════════ */

const SUBCUENTAS: Array<[string, string]> = [
  ['101.01', 'Caja y efectivo'],

  ['102.01', 'Bancos nacionales'],
  ['102.02', 'Bancos extranjeros'],

  ['103.01', 'Inversiones temporales'],
  ['103.02', 'Inversiones en fideicomisos'],
  ['103.03', 'Otras inversiones'],

  ['104.01', 'Otros instrumentos financieros'],

  ['105.01', 'Clientes nacionales'],
  ['105.02', 'Clientes extranjeros'],
  ['105.03', 'Clientes partes relacionadas nacionales'],
  ['105.04', 'Clientes partes relacionadas extranjeros'],

  ['110.01', 'Subsidio al empleo por aplicar'],
  ['111.01', 'Crédito al diesel por acreditar'],
  ['112.01', 'Otros estímulos'],

  ['113.01', 'IVA a favor'],
  ['113.02', 'ISR a favor'],
  ['113.03', 'IETU a favor'],
  ['113.04', 'IDE a favor'],
  ['113.05', 'IA a favor'],
  ['113.06', 'Subsidio al empleo'],
  ['113.07', 'Pago de lo indebido'],
  ['113.08', 'Otros impuestos a favor'],

  ['114.01', 'Pagos provisionales de ISR'],

  ['116.01', 'Estimación de inventarios obsoletos y de lento movimiento'],
  ['117.01', 'Obras en proceso de inmuebles'],

  ['118.01', 'IVA pagado'],
  ['118.02', 'IVA pagado de importación'],
  ['118.03', 'IEPS pagado'],
  ['118.04', 'IEPS pagado de importación'],

  ['119.01', 'IVA por pagar'],
  ['119.02', 'IVA por pagar de importación'],
  ['119.03', 'IEPS por pagar'],
  ['119.04', 'IEPS por pagar de importación'],

  ['121.01', 'Otros activos a corto plazo'],

  /* Activo fijo: una subcuenta por rubro. */
  ['151.01', 'Terrenos'],
  ['152.01', 'Edificios'],
  ['153.01', 'Maquinaria y equipo'],
  ['154.01', 'Automóviles, autobuses, camiones, tractocamiones, montacargas y remolques'],
  ['155.01', 'Mobiliario y equipo de oficina'],
  ['156.01', 'Equipo de cómputo'],
  ['157.01', 'Equipo de comunicación'],
  ['158.01', 'Activos biológicos, vegetales y semovientes'],
  ['159.01', 'Obras en proceso de activos fijos'],
  ['160.01', 'Otros activos fijos'],
  ['161.01', 'Ferrocarriles'],
  ['162.01', 'Embarcaciones'],
  ['163.01', 'Aviones'],
  ['164.01', 'Troqueles, moldes, matrices y herramental'],
  ['165.01', 'Equipo de comunicaciones telefónicas'],
  ['166.01', 'Equipo de comunicación satelital'],
  ['167.01', 'Equipo de adaptaciones para personas con capacidades diferentes'],
  ['168.01', 'Maquinaria y equipo de generación de energía renovable o cogeneración eficiente'],
  ['169.01', 'Otra maquinaria y equipo'],
  ['170.01', 'Adaptaciones y mejoras'],

  ['173.01', 'Gastos diferidos'],
  ['174.01', 'Gastos pre operativos'],
  ['175.01', 'Regalías, asistencia técnica y otros gastos diferidos'],
  ['176.01', 'Activos intangibles'],
  ['177.01', 'Gastos de organización'],
  ['178.01', 'Investigación y desarrollo de mercado'],
  ['179.01', 'Marcas y patentes'],
  ['180.01', 'Crédito mercantil'],
  ['181.01', 'Gastos de instalación'],
  ['182.01', 'Otros activos diferidos'],
  ['185.01', 'Impuestos diferidos ISR'],
  ['187.01', 'PTU diferida'],
  ['189.01', 'Otros instrumentos financieros'],
  ['190.01', 'Otros activos a largo plazo'],

  /* Pasivo */
  ['201.01', 'Proveedores nacionales'],
  ['201.02', 'Proveedores extranjeros'],
  ['201.03', 'Proveedores partes relacionadas nacionales'],
  ['201.04', 'Proveedores partes relacionadas extranjeros'],

  ['204.01', 'Instrumentos financieros a corto plazo'],

  ['207.01', 'IVA trasladado'],
  ['207.02', 'IEPS trasladado'],
  ['208.01', 'IVA trasladado cobrado'],
  ['208.02', 'IEPS trasladado cobrado'],
  ['209.01', 'IVA trasladado no cobrado'],
  ['209.02', 'IEPS trasladado no cobrado'],

  ['211.01', 'Provisión de IMSS patronal'],
  ['211.02', 'Provisión de SAR'],
  ['211.03', 'Provisión de INFONAVIT'],

  ['212.01', 'Provisión de impuesto estatal sobre nómina por pagar'],

  ['214.01', 'Dividendos por pagar'],

  ['215.01', 'PTU por pagar del ejercicio actual'],
  ['215.02', 'PTU por pagar de ejercicios anteriores'],
  ['215.03', 'Provisión de PTU'],

  ['217.01', 'Pagos realizados por cuenta de terceros'],
  ['218.01', 'Otros pasivos a corto plazo'],

  ['254.01', 'Instrumentos financieros a largo plazo'],
  ['255.01', 'Pasivos por beneficios a los empleados a largo plazo'],
  ['256.01', 'Otros pasivos a largo plazo'],
  ['257.01', 'PTU diferida'],
  ['258.01', 'Obligaciones contraídas de fideicomisos'],
  ['259.01', 'Impuestos diferidos ISR'],
  ['259.02', 'Impuestos diferidos ISR por dividendo'],
  ['259.03', 'Otros impuestos diferidos'],
  ['260.01', 'Pasivos diferidos'],

  /* Capital */
  ['301.01', 'Capital social fijo'],
  ['301.02', 'Capital social variable'],
  ['301.03', 'Aportaciones para futuros aumentos de capital'],
  ['301.04', 'Prima en suscripción de acciones'],
  ['301.05', 'Prima en suscripción de partes sociales'],
  ['302.01', 'Patrimonio'],
  ['302.02', 'Aportación patrimonial'],
  ['302.03', 'Déficit o remanente del ejercicio'],
  ['303.01', 'Reserva legal'],
  ['304.01', 'Utilidad de ejercicios anteriores'],
  ['304.02', 'Pérdida de ejercicios anteriores'],
  ['304.03', 'Resultado integral de ejercicios anteriores'],
  ['304.04', 'Déficit o remanente de ejercicios anteriores'],
  ['305.01', 'Utilidad del ejercicio'],
  ['305.02', 'Pérdida del ejercicio'],
  ['305.03', 'Resultado integral del ejercicio'],
  ['306.01', 'Otras cuentas de capital'],
];

/* ── 401 Ingresos: el Anexo 24 los detalla uno por uno ── */
const INGRESOS_401: Array<[string, string]> = [
  ['401.01', 'Ventas y/o servicios gravados a la tasa general de contado'],
  ['401.02', 'Ventas y/o servicios gravados a la tasa general a crédito'],
  ['401.03', 'Ventas y/o servicios gravados al 0% de contado'],
  ['401.04', 'Ventas y/o servicios gravados al 0% a crédito'],
  ['401.05', 'Ventas y/o servicios exentos de contado'],
  ['401.06', 'Ventas y/o servicios exentos a crédito'],
  ['401.07', 'Ventas y/o servicios gravados a la tasa general nacionales partes relacionadas'],
  ['401.08', 'Ventas y/o servicios gravados a la tasa general extranjeros partes relacionadas'],
  ['401.09', 'Ventas y/o servicios gravados al 0% nacionales partes relacionadas'],
  ['401.10', 'Ventas y/o servicios gravados al 0% extranjeros partes relacionadas'],
  ['401.11', 'Ventas y/o servicios exentos nacionales partes relacionadas'],
  ['401.12', 'Ventas y/o servicios exentos extranjeros partes relacionadas'],
  ['401.13', 'Ingresos por servicios administrativos'],
  ['401.14', 'Ingresos por servicios administrativos nacionales partes relacionadas'],
  ['401.15', 'Ingresos por servicios administrativos extranjeros partes relacionadas'],
  ['401.16', 'Ingresos por servicios profesionales'],
  ['401.17', 'Ingresos por servicios profesionales nacionales partes relacionadas'],
  ['401.18', 'Ingresos por servicios profesionales extranjeros partes relacionadas'],
  ['401.19', 'Ingresos por arrendamiento'],
  ['401.20', 'Ingresos por arrendamiento nacionales partes relacionadas'],
  ['401.21', 'Ingresos por arrendamiento extranjeros partes relacionadas'],
  ['401.22', 'Ingresos por exportación'],
  ['401.23', 'Ingresos por comisiones'],
  ['401.24', 'Ingresos por maquila'],
  ['401.25', 'Ingresos por coordinados'],
  ['401.26', 'Ingresos por regalías'],
  ['401.27', 'Ingresos por asistencia técnica'],
  ['401.28', 'Ingresos por donativos'],
  ['401.29', 'Ingresos por intereses de actividad propia'],
  ['401.30', 'Ingresos de copropiedad'],
  ['401.31', 'Ingresos por fideicomisos'],
  ['401.32', 'Ingresos por factoraje financiero'],
  ['401.33', 'Ingresos por arrendamiento financiero'],
  ['401.34', 'Ingresos de extranjeros con establecimiento en el país'],
  ['401.35', 'Otros ingresos propios'],
  ['401.36', 'Ventas y/o servicios gravados en zona fronteriza norte de contado'],
  ['401.37', 'Ventas y/o servicios gravados en zona fronteriza norte a crédito'],
];

/* ── 601-604: la misma estructura .01 a .84 en los cuatro grupos ──
 *
 * Es el bloque más grande del catálogo y el que más se usa: aquí caen sueldos,
 * IMSS, INFONAVIT, honorarios, arrendamiento, combustible, uniformes.
 * El Anexo 24 los detalla completos, así que se siembran completos. */
const GASTOS_SUFIJOS: Array<[string, string, string?]> = [
  ['01', 'Sueldos y salarios', 'D-3'],
  ['02', 'Compensaciones', 'D-3'],
  ['03', 'Tiempos extras', 'D-3'],
  ['04', 'Premios de asistencia', 'D-3'],
  ['05', 'Premios de puntualidad', 'D-3'],
  ['06', 'Vacaciones', 'D-3'],
  ['07', 'Prima vacacional', 'D-3'],
  ['08', 'Prima dominical', 'D-3'],
  ['09', 'Días festivos', 'D-3'],
  ['10', 'Gratificaciones', 'D-3'],
  ['11', 'Primas de antigüedad', 'D-3'],
  ['12', 'Aguinaldo', 'D-3'],
  ['13', 'Indemnizaciones', 'D-3'],
  ['14', 'Destajo', 'D-3'],
  ['15', 'Despensa', 'D-3'],
  ['16', 'Transporte', 'D-3'],
  ['17', 'Servicio médico', 'D-3'],
  ['18', 'Ayuda en gastos funerarios', 'D-3'],
  ['19', 'Fondo de ahorro', 'D-3'],
  ['20', 'Cuotas sindicales', 'D-3'],
  ['21', 'PTU', 'D-3'],
  ['22', 'Estímulo al personal', 'D-3'],
  ['23', 'Previsión social', 'D-3'],
  ['24', 'Aportaciones plan de jubilación', 'D-3'],
  ['25', 'Otras prestaciones al personal', 'D-3'],
  ['26', 'Cuotas al IMSS', 'D-3'],
  ['27', 'Aportaciones al INFONAVIT', 'D-3'],
  ['28', 'Aportaciones al SAR', 'D-3'],
  ['29', 'Impuesto estatal sobre nóminas', 'D-3'],
  ['30', 'Otras aportaciones', 'D-3'],
  ['31', 'Asimilados a salarios', 'D-3'],
  ['32', 'Servicios administrativos'],
  ['33', 'Servicios administrativos partes relacionadas', 'C-13'],
  ['34', 'Honorarios a personas físicas nacionales'],
  ['35', 'Honorarios a personas físicas nacionales partes relacionadas', 'C-13'],
  ['36', 'Honorarios a personas físicas del extranjero'],
  ['37', 'Honorarios a personas físicas del extranjero partes relacionadas', 'C-13'],
  ['38', 'Honorarios a personas morales nacionales'],
  ['39', 'Honorarios a personas morales nacionales partes relacionadas', 'C-13'],
  ['40', 'Honorarios a personas morales del extranjero'],
  ['41', 'Honorarios a personas morales del extranjero partes relacionadas', 'C-13'],
  ['42', 'Honorarios aduanales a personas físicas'],
  ['43', 'Honorarios aduanales a personas morales'],
  ['44', 'Honorarios al consejo de administración'],
  ['45', 'Arrendamiento a personas físicas nacionales', 'D-5'],
  ['46', 'Arrendamiento a personas morales nacionales', 'D-5'],
  ['47', 'Arrendamiento a residentes en el extranjero', 'D-5'],
  ['48', 'Combustibles y lubricantes'],
  ['49', 'Viáticos y gastos de viaje'],
  ['50', 'Teléfono, internet'],
  ['51', 'Agua'],
  ['52', 'Energía eléctrica'],
  ['53', 'Vigilancia y seguridad'],
  ['54', 'Limpieza'],
  ['55', 'Papelería y artículos de oficina'],
  ['56', 'Mantenimiento y conservación'],
  ['57', 'Seguros y fianzas'],
  ['58', 'Otros impuestos y derechos'],
  ['59', 'Recargos fiscales'],
  ['60', 'Cuotas y suscripciones'],
  ['61', 'Propaganda y publicidad'],
  ['62', 'Capacitación al personal', 'D-3'],
  ['63', 'Donativos y ayudas'],
  ['64', 'Asistencia técnica'],
  ['65', 'Regalías otros porcentajes'],
  ['66', 'Regalías 5%'],
  ['67', 'Regalías 10%'],
  ['68', 'Regalías 15%'],
  ['69', 'Regalías 25%'],
  ['70', 'Regalías 30%'],
  ['71', 'Regalías sin retención'],
  ['72', 'Fletes y acarreos'],
  ['73', 'Gastos de importación'],
  ['74', 'Comisiones sobre ventas'],
  ['75', 'Comisiones por tarjetas de crédito'],
  ['76', 'Patentes y marcas'],
  ['77', 'Uniformes'],
  ['78', 'Prediales'],
  ['79', 'Gastos de urbanización'],
  ['80', 'Gastos de construcción'],
  ['81', 'Fletes del extranjero'],
  ['82', 'Recolección del sector agropecuario/ganadero'],
  ['83', 'Gastos no deducibles'],
  ['84', 'Otros gastos del grupo'],
];

const GRUPOS_GASTO: Array<[string, string]> = [
  ['601', 'Gastos generales'],
  ['602', 'Gastos de venta'],
  ['603', 'Gastos de administración'],
  ['604', 'Gastos de fabricación'],
];

/* ── 701 y 702: detallados uno por uno ── */
const DEPRECIACION_701: Array<[string, string]> = [
  ['701.01', 'Depreciación de edificios'],
  ['701.02', 'Depreciación de maquinaria y equipo'],
  ['701.03', 'Depreciación de vehículos'],
  ['701.04', 'Depreciación de mobiliario y equipo de oficina'],
  ['701.05', 'Depreciación de equipo de cómputo'],
  ['701.06', 'Depreciación de equipo de comunicación'],
  ['701.07', 'Depreciación de activos biológicos, vegetales y semovientes'],
  ['701.08', 'Depreciación de otros activos fijos'],
  ['701.09', 'Depreciación de ferrocarriles'],
  ['701.10', 'Depreciación de embarcaciones'],
  ['701.11', 'Depreciación de aviones'],
];

const AMORTIZACION_702: Array<[string, string]> = [
  ['702.01', 'Amortización de gastos diferidos'],
  ['702.02', 'Amortización de gastos pre operativos'],
  ['702.03', 'Amortización de regalías, asistencia técnica y otros gastos diferidos'],
  ['702.04', 'Amortización de activos intangibles'],
  ['702.05', 'Amortización de gastos de organización'],
  ['702.06', 'Amortización de investigación y desarrollo de mercado'],
  ['702.07', 'Amortización de marcas y patentes'],
  ['702.08', 'Amortización de crédito mercantil'],
  ['702.09', 'Amortización de gastos de instalación'],
  ['702.10', 'Amortización de otros activos diferidos'],
];

/* ── 800 Cuentas de orden: pares cuenta / contra cuenta ──
 *
 * Fuera de todo estado financiero. Son memoranda fiscal: CUFIN, CUCA,
 * deducción de inversión, pérdidas por amortizar. Si aparecen en el balance,
 * éste no cuadra. */
const ORDEN_800: Array<[string, string]> = [
  ['801', 'UFIN del ejercicio'],
  ['802', 'CUFIN del ejercicio'],
  ['803', 'CUFIN de ejercicios anteriores'],
  ['804', 'CUFINRE del ejercicio'],
  ['805', 'CUFINRE de ejercicios anteriores'],
  ['806', 'CUCA del ejercicio'],
  ['807', 'CUCA de ejercicios anteriores'],
  ['808', 'Ajuste anual por inflación acumulable'],
  ['809', 'Ajuste anual por inflación deducible'],
  ['810', 'Deducción de inversión'],
  ['811', 'Utilidad o pérdida fiscal en venta o baja de activo fijo'],
  ['812', 'Utilidad o pérdida fiscal en venta de acciones o partes sociales'],
  ['813', 'Pérdidas fiscales pendientes de amortizar actualizadas'],
  ['814', 'Mercancías recibidas en consignación'],
  ['815', 'Crédito fiscal IVA/IEPS por importación de mercancías (empresas certificadas)'],
  ['816', 'Crédito fiscal IVA/IEPS por importación de activos fijos (empresas certificadas)'],
  ['899', 'Otras cuentas de orden'],
];

/* ═══════════════════════════════════════════════════════════════════════════
   ARMADO
   ═══════════════════════════════════════════════════════════════════════════ */

export function construirCatalogoSat(): CodigoSat[] {
  const out: CodigoSat[] = [];
  const porCodigo = new Map<string, CodigoSat>();

  const push = (c: CodigoSat) => {
    if (porCodigo.has(c.codigo)) return;   // el primero manda
    porCodigo.set(c.codigo, c);
    out.push(c);
  };

  /* 1. Las cuentas mayores */
  for (const [codigo, nombre, tipo, naturaleza, nif, complementaria] of MAYORES) {
    push({ codigo, nombre, nivel: 1, tipo, naturaleza, nif, complementaria });
  }

  /* 2. Las subcuentas heredan tipo, naturaleza y NIF de su mayor: una subcuenta
   *    de una cuenta complementaria también es complementaria. */
  const heredar = (codigo: string, nombre: string): CodigoSat | null => {
    const padre = codigo.split('.')[0];
    const p = porCodigo.get(padre);
    if (!p) return null;
    return {
      codigo, nombre, nivel: 2, padre,
      tipo: p.tipo, naturaleza: p.naturaleza,
      nif: p.nif, complementaria: p.complementaria,
    };
  };

  for (const [codigo, nombre] of [...SUBCUENTAS, ...INGRESOS_401,
                                  ...DEPRECIACION_701, ...AMORTIZACION_702]) {
    const c = heredar(codigo, nombre);
    if (c) push(c);
  }

  /* 3. Los cuatro grupos de gasto × 84 conceptos */
  for (const [grupo] of GRUPOS_GASTO) {
    for (const [sufijo, nombre, nif] of GASTOS_SUFIJOS) {
      push({
        codigo: `${grupo}.${sufijo}`, nombre, nivel: 2, padre: grupo,
        tipo: 'GASTO', naturaleza: D, nif,
      });
    }
  }

  /* 4. Cuentas de orden: cada una con su contra cuenta.
   *    La contra siempre es de naturaleza opuesta — así el par se anula y las
   *    cuentas de orden no alteran ningún saldo real. */
  for (const [codigo, nombre] of ORDEN_800) {
    push({ codigo, nombre, nivel: 1, tipo: 'ORDEN', naturaleza: D });
    push({ codigo: `${codigo}.01`, nombre, nivel: 2, padre: codigo,
           tipo: 'ORDEN', naturaleza: D });
    push({ codigo: `${codigo}.02`, nombre: `Contra cuenta de ${nombre.toLowerCase()}`,
           nivel: 2, padre: codigo, tipo: 'ORDEN', naturaleza: A });
  }

  return out;
}

/**
 * Las cuentas mayores cuyo nivel 2 el resumen NO detalla nombre por nombre.
 *
 * Se reporta al sembrar en vez de rellenarse a ojo. El número entre paréntesis
 * es cuántas subcuentas dice el Anexo 24 que existen.
 */
export const NIVEL2_PENDIENTE: Array<[string, number, string]> = [
  ['106', 10, 'Cuentas y documentos por cobrar a corto plazo'],
  ['107',  5, 'Deudores diversos'],
  ['108',  4, 'Estimación de cuentas incobrables'],
  ['109', 23, 'Pagos anticipados'],
  ['115',  7, 'Inventario'],
  ['120',  4, 'Anticipo a proveedores'],
  ['171', 18, 'Depreciación acumulada de activos fijos'],
  ['172', 18, 'Pérdida por deterioro acumulado de activos fijos'],
  ['183', 10, 'Amortización acumulada de activos diferidos'],
  ['184',  3, 'Depósitos en garantía'],
  ['186', 10, 'Cuentas y documentos por cobrar a largo plazo'],
  ['188',  4, 'Inversiones permanentes en acciones'],
  ['202', 12, 'Cuentas por pagar a corto plazo'],
  ['203', 18, 'Cobros anticipados a corto plazo'],
  ['205',  6, 'Acreedores diversos a corto plazo'],
  ['206',  5, 'Anticipo de clientes'],
  ['210',  7, 'Provisión de sueldos y salarios'],
  ['213',  7, 'Impuestos y derechos por pagar'],
  ['216', 12, 'Impuestos retenidos'],
  ['251',  6, 'Acreedores diversos a largo plazo'],
  ['252', 17, 'Cuentas por pagar a largo plazo'],
  ['253', 18, 'Cobros anticipados a largo plazo'],
  ['402',  5, 'Devoluciones, descuentos o bonificaciones'],
  ['403',  4, 'Otros ingresos'],
  ['501',  8, 'Costo de venta y/o servicio'],
  ['502',  4, 'Compras'],
  ['504', 25, 'Gastos indirectos de fabricación'],
  ['505',  2, 'Costo de activo fijo'],
  ['605', 31, 'Mano de obra directa'],
  ['703', 21, 'Gastos y productos financieros'],
  ['704', 23, 'Otros gastos y otros productos'],
];
