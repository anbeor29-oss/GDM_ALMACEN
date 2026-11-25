/**
 * pdf-temas — temas de color para la representación impresa del CFDI.
 *
 * El usuario elige un formato en «Datos de mi empresa» (companies.pdf_formato) y
 * se aplica a FACTURA, TIMBRE DE PAGO (complemento) y NOTA DE CRÉDITO. Es vanity:
 * el LAYOUT no cambia (sigue siendo un CFDI válido), sólo los colores/acentos.
 */

export type FormatoPdf = 'clasico' | 'esmeralda' | 'carbon' | 'cielo' | 'farsystems' | 'gncys' | 'lineal' | 'bandas';

/** Catálogo para el selector (6 formatos). 'esmeralda' y 'carbon' comparten el
 *  layout PROPIO y sólo cambian de color; los otros cuatro tienen LAYOUT propio
 *  (ver pdf-farsystems / pdf-gncys / pdf-lineal / pdf-bandas).
 *  'clasico' y 'cielo' se retiraron del selector (quedan como respaldo interno).
 *
 *  Para verlos los seis con la misma factura de ejemplo, sin base de datos:
 *      npx ts-node scripts/muestra-formatos.ts                                */
export const FORMATOS_PDF: Array<{ key: FormatoPdf; nombre: string; muestra: string }> = [
  { key: 'esmeralda',  nombre: 'Esmeralda (verde)',    muestra: '#047857' },
  { key: 'carbon',     nombre: 'Carbón (gris · rojo)', muestra: '#b91c1c' },
  { key: 'lineal',     nombre: 'Lineal (compacto)',    muestra: '#1E3D6E' },
  { key: 'bandas',     nombre: 'Bandas (etiquetas de color)', muestra: '#0f766e' },
  { key: 'farsystems', nombre: 'FarSystems (réplica)', muestra: '#1d4ed8' },
  { key: 'gncys',      nombre: 'GNcys (réplica)',      muestra: '#1e3a8a' },
];

export interface TemaPdf {
  titulo: string;          // color del título (FACTURA / TIMBRE DE PAGO / NOTA DE CRÉDITO)
  tablaHeaderBg: string;   // fondo del encabezado de la tabla de conceptos
  tablaHeaderText: string; // texto del encabezado de la tabla
  boxBg: string;           // fondo de la caja de folio/datos
  boxBorder: string;       // borde de esa caja
  acento: string;          // acentos (etiquetas, montos monoespaciados)
}

const TEMAS: Record<FormatoPdf, TemaPdf> = {
  clasico:   { titulo: '#1e40af', tablaHeaderBg: '#3b82f6', tablaHeaderText: '#ffffff', boxBg: '#eff6ff', boxBorder: '#94a3b8', acento: '#1e3a8a' },
  esmeralda: { titulo: '#047857', tablaHeaderBg: '#059669', tablaHeaderText: '#ffffff', boxBg: '#ecfdf5', boxBorder: '#6ee7b7', acento: '#065f46' },
  carbon:    { titulo: '#b91c1c', tablaHeaderBg: '#334155', tablaHeaderText: '#ffffff', boxBg: '#f1f5f9', boxBorder: '#94a3b8', acento: '#334155' },
  cielo:     { titulo: '#0369a1', tablaHeaderBg: '#0284c7', tablaHeaderText: '#ffffff', boxBg: '#f0f9ff', boxBorder: '#7dd3fc', acento: '#075985' },
  // FarSystems: el layout propio vive en pdf-farsystems; estos colores sólo sirven
  // de respaldo si algún comprobante que aún no tiene la réplica (pago/NC) lo usa.
  farsystems: { titulo: '#1d4ed8', tablaHeaderBg: '#1d4ed8', tablaHeaderText: '#ffffff', boxBg: '#eff6ff', boxBorder: '#93c5fd', acento: '#1e3a8a' },
  // GNcys: layout propio en pdf-gncys; colores de respaldo (azul marino sobrio).
  gncys:      { titulo: '#1e3a8a', tablaHeaderBg: '#1e3a8a', tablaHeaderText: '#ffffff', boxBg: '#eef2ff', boxBorder: '#c7d2fe', acento: '#1e3a8a' },
  // Lineal: filetes finos, sin fondos. El azul de la casa como único acento.
  lineal:     { titulo: '#1E3D6E', tablaHeaderBg: '#1E3D6E', tablaHeaderText: '#ffffff', boxBg: '#f8fafc', boxBorder: '#1E3D6E', acento: '#1E3D6E' },
  // Bandas: el color ES la estructura, así que va con cuerpo y texto blanco.
  bandas:     { titulo: '#0f766e', tablaHeaderBg: '#0f766e', tablaHeaderText: '#ffffff', boxBg: '#f0fdfa', boxBorder: '#5eead4', acento: '#115e59' },
};

/** Tema por clave; ante cualquier valor desconocido o vacío, el clásico. */
export function getTema(formato?: string | null): TemaPdf {
  return TEMAS[(formato || '') as FormatoPdf] || TEMAS.clasico;
}
