/**
 * Las NIF vigentes, como catálogo de referencia.
 *
 * ── POR QUÉ ESTO NO ES DOCUMENTACIÓN ──
 * La norma que clasifica a una cuenta decide tres cosas distintas: cómo se
 * VALÚA lo que hay en ella, cómo se PRESENTA en el estado financiero, y qué
 * hay que REVELAR en las notas.
 *
 * Un inventario clasificado C-4 se valúa a "el menor entre costo y valor neto
 * de realización" —y esa regla es la que obliga a estimar obsolescencia. Uno
 * sin clasificar se queda al costo para siempre y nadie se entera.
 *
 * Por eso la clasificación va en el catálogo desde el día uno y no cuando se
 * construya el motor NIF: clasificar 400 cuentas después, a mano y con
 * movimientos encima, es el trabajo que nadie termina.
 *
 * ── ÁMBITO ──
 * Marca qué es lo que la norma resuelve principalmente. El motor NIF lo usará
 * para saber en qué momento del proceso preguntarle a cada regla.
 */

export interface NormaNif {
  clave: string;
  serie: 'A' | 'B' | 'C' | 'D' | 'E';
  titulo: string;
  ambito: 'MARCO' | 'RECONOCIMIENTO' | 'VALUACION' | 'PRESENTACION' | 'REVELACION';
  resumen?: string;
}

export const NIF_NORMAS: NormaNif[] = [
  /* ── Serie A · Marco conceptual ── */
  { clave: 'A-1', serie: 'A', titulo: 'Estructura de las Normas de Información Financiera', ambito: 'MARCO' },
  { clave: 'A-2', serie: 'A', titulo: 'Postulados básicos', ambito: 'MARCO',
    resumen: 'Devengación contable, asociación de costos y gastos con ingresos, valuación, dualidad económica, consistencia.' },
  { clave: 'A-3', serie: 'A', titulo: 'Necesidades de los usuarios y objetivos de los estados financieros', ambito: 'MARCO' },
  { clave: 'A-5', serie: 'A', titulo: 'Elementos básicos de los estados financieros', ambito: 'MARCO' },
  { clave: 'A-6', serie: 'A', titulo: 'Reconocimiento y valuación', ambito: 'VALUACION' },
  { clave: 'A-7', serie: 'A', titulo: 'Presentación y revelación', ambito: 'PRESENTACION' },

  /* ── Serie B · Estados financieros en su conjunto ── */
  { clave: 'B-1',  serie: 'B', titulo: 'Cambios contables y correcciones de errores', ambito: 'PRESENTACION' },
  { clave: 'B-2',  serie: 'B', titulo: 'Estado de flujos de efectivo', ambito: 'PRESENTACION' },
  { clave: 'B-3',  serie: 'B', titulo: 'Estado de resultado integral', ambito: 'PRESENTACION' },
  { clave: 'B-4',  serie: 'B', titulo: 'Estado de cambios en el capital contable', ambito: 'PRESENTACION' },
  { clave: 'B-6',  serie: 'B', titulo: 'Estado de situación financiera', ambito: 'PRESENTACION' },
  { clave: 'B-10', serie: 'B', titulo: 'Efectos de la inflación', ambito: 'VALUACION' },
  { clave: 'B-15', serie: 'B', titulo: 'Conversión de monedas extranjeras', ambito: 'VALUACION' },

  /* ── Serie C · Conceptos específicos ── */
  { clave: 'C-1',  serie: 'C', titulo: 'Efectivo y equivalentes de efectivo', ambito: 'VALUACION' },
  { clave: 'C-2',  serie: 'C', titulo: 'Inversión en instrumentos financieros', ambito: 'VALUACION' },
  { clave: 'C-3',  serie: 'C', titulo: 'Cuentas por cobrar', ambito: 'VALUACION',
    resumen: 'Exige estimar la pérdida crediticia esperada; no basta esperar a que la cuenta sea incobrable.' },
  { clave: 'C-4',  serie: 'C', titulo: 'Inventarios', ambito: 'VALUACION',
    resumen: 'El menor entre costo y valor neto de realización. Admite PEPS, costo promedio y costo estándar; NO admite UEPS.' },
  { clave: 'C-5',  serie: 'C', titulo: 'Pagos anticipados', ambito: 'VALUACION' },
  { clave: 'C-6',  serie: 'C', titulo: 'Propiedades, planta y equipo', ambito: 'VALUACION',
    resumen: 'Depreciación por vida útil y valor residual — NO por porcentajes fiscales. Es la razón de los dos libros.' },
  { clave: 'C-7',  serie: 'C', titulo: 'Inversiones en asociadas, negocios conjuntos y otras inversiones permanentes', ambito: 'VALUACION' },
  { clave: 'C-8',  serie: 'C', titulo: 'Activos intangibles', ambito: 'VALUACION' },
  { clave: 'C-9',  serie: 'C', titulo: 'Provisiones, contingencias y compromisos', ambito: 'RECONOCIMIENTO' },
  { clave: 'C-11', serie: 'C', titulo: 'Capital contable', ambito: 'PRESENTACION' },
  { clave: 'C-13', serie: 'C', titulo: 'Partes relacionadas', ambito: 'REVELACION' },
  { clave: 'C-15', serie: 'C', titulo: 'Deterioro en el valor de los activos de larga duración', ambito: 'VALUACION' },
  { clave: 'C-16', serie: 'C', titulo: 'Deterioro de instrumentos financieros por cobrar', ambito: 'VALUACION' },
  { clave: 'C-19', serie: 'C', titulo: 'Instrumentos financieros por pagar', ambito: 'VALUACION' },
  { clave: 'C-20', serie: 'C', titulo: 'Instrumentos financieros para cobrar principal e interés', ambito: 'VALUACION' },

  /* ── Serie D · Determinación de resultados ── */
  { clave: 'D-1', serie: 'D', titulo: 'Ingresos por contratos con clientes', ambito: 'RECONOCIMIENTO',
    resumen: 'El ingreso se reconoce al transferir el control, no al facturar ni al cobrar.' },
  { clave: 'D-2', serie: 'D', titulo: 'Costos por contratos con clientes', ambito: 'RECONOCIMIENTO' },
  { clave: 'D-3', serie: 'D', titulo: 'Beneficios a los empleados', ambito: 'RECONOCIMIENTO',
    resumen: 'Incluye prima de antigüedad e indemnizaciones: son pasivo desde que se devengan, no cuando se pagan.' },
  { clave: 'D-4', serie: 'D', titulo: 'Impuestos a la utilidad', ambito: 'RECONOCIMIENTO',
    resumen: 'ISR diferido por las diferencias temporales entre el libro contable y el fiscal.' },
  { clave: 'D-5', serie: 'D', titulo: 'Arrendamientos', ambito: 'RECONOCIMIENTO',
    resumen: 'El arrendatario reconoce activo por derecho de uso y pasivo por arrendamiento.' },
  { clave: 'D-6', serie: 'D', titulo: 'Capitalización del resultado integral de financiamiento', ambito: 'VALUACION' },
  { clave: 'D-8', serie: 'D', titulo: 'Pagos basados en acciones', ambito: 'RECONOCIMIENTO' },

  /* ── Serie E · Actividades especializadas ── */
  { clave: 'E-1', serie: 'E', titulo: 'Actividades agropecuarias', ambito: 'VALUACION' },
  { clave: 'E-2', serie: 'E', titulo: 'Donativos recibidos u otorgados por entidades con propósitos no lucrativos', ambito: 'RECONOCIMIENTO' },
];
