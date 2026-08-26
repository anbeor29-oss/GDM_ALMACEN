/**
 * Conceptos de nómina para la póliza de pasivo (PLAN_CONTABILIDAD §2.4 F/G).
 *
 * La póliza de nómina no se calcula: los importes ya los da el motor. Sólo hay
 * que COLOCAR cada concepto en su cuenta. Este catálogo es la lista de conceptos
 * —percepciones, deducciones y las provisiones patronales— a los que el usuario
 * les asigna cuenta; con eso la póliza sale exacta.
 *
 *   Percepciones  → CARGO a gasto (601.xx)
 *   Deducciones   → ABONO a pasivo (retención al trabajador: 216.xx / 205)
 *   Neto          → ABONO a 210.01 provisión de sueldos por pagar
 *   Provisiones patronales → CARGO gasto (601.26-29) y ABONO pasivo (211/212)
 *
 * Las claves de percepción/deducción son las del c_TipoPercepcion /
 * c_TipoDeduccion del Anexo 20 (las mismas que el motor y el recibo usan). Las
 * provisiones y el neto llevan clave interna porque no vienen en el CFDI. La
 * `sugerida` es sólo una pista del agrupador SAT; la cuenta la fija el usuario.
 */
export type GrupoConcepto = 'PERCEPCION' | 'DEDUCCION' | 'NETO' | 'PROVISION';

export interface ConceptoNomina {
  grupo: GrupoConcepto;
  clave: string;
  nombre: string;
  lado: 'cargo' | 'abono';
  sugerida: string;
}

export const CONCEPTOS_NOMINA: ConceptoNomina[] = [
  /* ── Percepciones (cargo → gasto 601.xx) ── */
  { grupo: 'PERCEPCION', clave: '001', nombre: 'Sueldos, salarios, rayas y jornales', lado: 'cargo', sugerida: '601.01' },
  { grupo: 'PERCEPCION', clave: '019', nombre: 'Horas extra', lado: 'cargo', sugerida: '601.01' },
  { grupo: 'PERCEPCION', clave: '020', nombre: 'Prima dominical', lado: 'cargo', sugerida: '601.01' },
  { grupo: 'PERCEPCION', clave: '021', nombre: 'Prima vacacional', lado: 'cargo', sugerida: '601.07' },
  { grupo: 'PERCEPCION', clave: '002', nombre: 'Gratificación anual (aguinaldo)', lado: 'cargo', sugerida: '601.12' },
  { grupo: 'PERCEPCION', clave: '003', nombre: 'Participación de utilidades (PTU)', lado: 'cargo', sugerida: '601.13' },
  { grupo: 'PERCEPCION', clave: '010', nombre: 'Premios por puntualidad', lado: 'cargo', sugerida: '601.01' },
  { grupo: 'PERCEPCION', clave: '012', nombre: 'Gratificaciones / bonos', lado: 'cargo', sugerida: '601.01' },
  { grupo: 'PERCEPCION', clave: '015', nombre: 'Vales de despensa', lado: 'cargo', sugerida: '601.10' },
  { grupo: 'PERCEPCION', clave: '046', nombre: 'Comisiones', lado: 'cargo', sugerida: '601.01' },
  { grupo: 'PERCEPCION', clave: '022', nombre: 'Prima por antigüedad', lado: 'cargo', sugerida: '601.16' },
  { grupo: 'PERCEPCION', clave: '023', nombre: 'Pagos por separación (finiquito)', lado: 'cargo', sugerida: '601.17' },
  { grupo: 'PERCEPCION', clave: '025', nombre: 'Indemnizaciones', lado: 'cargo', sugerida: '601.17' },
  { grupo: 'PERCEPCION', clave: '049', nombre: 'Ingresos asimilados a salarios', lado: 'cargo', sugerida: '601.20' },
  { grupo: 'PERCEPCION', clave: '050', nombre: 'Viáticos', lado: 'cargo', sugerida: '601.11' },
  { grupo: 'PERCEPCION', clave: '039', nombre: 'Otros ingresos gravados', lado: 'cargo', sugerida: '601.01' },
  { grupo: 'PERCEPCION', clave: 'SUBSIDIO', nombre: 'Subsidio al empleo por aplicar', lado: 'cargo', sugerida: '110.01' },

  /* ── Deducciones (abono → pasivo por retención al trabajador) ── */
  { grupo: 'DEDUCCION', clave: '002', nombre: 'ISR retenido por sueldos', lado: 'abono', sugerida: '216.01' },
  { grupo: 'DEDUCCION', clave: '001', nombre: 'Seguridad social (IMSS obrero)', lado: 'abono', sugerida: '216.11' },
  { grupo: 'DEDUCCION', clave: 'INFONAVIT', nombre: 'Crédito INFONAVIT (descuento al trabajador)', lado: 'abono', sugerida: '211.03' },
  { grupo: 'DEDUCCION', clave: 'FONACOT', nombre: 'FONACOT (descuento al trabajador)', lado: 'abono', sugerida: '205.01' },
  { grupo: 'DEDUCCION', clave: '007', nombre: 'Pensión alimenticia', lado: 'abono', sugerida: '216.20' },
  { grupo: 'DEDUCCION', clave: '006', nombre: 'Caja / fondo de ahorro', lado: 'abono', sugerida: '216.21' },
  { grupo: 'DEDUCCION', clave: '004', nombre: 'Otros descuentos', lado: 'abono', sugerida: '216.99' },

  /* ── Neto ── */
  { grupo: 'NETO', clave: 'NETO', nombre: 'Neto por pagar (provisión de sueldos)', lado: 'abono', sugerida: '210.01' },

  /* ── Provisiones patronales (cargo gasto + abono pasivo) ── */
  { grupo: 'PROVISION', clave: 'IMSS_PAT_G', nombre: 'Cuotas IMSS patronal — gasto', lado: 'cargo', sugerida: '601.26' },
  { grupo: 'PROVISION', clave: 'IMSS_PAT_P', nombre: 'Cuotas IMSS patronal — provisión', lado: 'abono', sugerida: '211.01' },
  { grupo: 'PROVISION', clave: 'RCV_G', nombre: 'RCV / SAR patronal — gasto', lado: 'cargo', sugerida: '601.28' },
  { grupo: 'PROVISION', clave: 'RCV_P', nombre: 'RCV / SAR — provisión', lado: 'abono', sugerida: '211.02' },
  { grupo: 'PROVISION', clave: 'INFO_G', nombre: 'INFONAVIT patronal — gasto', lado: 'cargo', sugerida: '601.27' },
  { grupo: 'PROVISION', clave: 'INFO_P', nombre: 'INFONAVIT patronal — provisión', lado: 'abono', sugerida: '211.03' },
  { grupo: 'PROVISION', clave: 'ISN_G', nombre: 'Impuesto sobre nómina — gasto', lado: 'cargo', sugerida: '601.29' },
  { grupo: 'PROVISION', clave: 'ISN_P', nombre: 'Impuesto sobre nómina — provisión', lado: 'abono', sugerida: '212.01' },
];
