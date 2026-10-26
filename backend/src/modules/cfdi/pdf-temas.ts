/**
 * pdf-temas — temas de color para la representación impresa del CFDI.
 *
 * El usuario elige un formato en «Datos de mi empresa» (companies.pdf_formato) y
 * se aplica a FACTURA, TIMBRE DE PAGO (complemento) y NOTA DE CRÉDITO. Es vanity:
 * el LAYOUT no cambia (sigue siendo un CFDI válido), sólo los colores/acentos.
 */

export type FormatoPdf = 'clasico' | 'esmeralda' | 'carbon' | 'cielo';

/** Catálogo para el selector (clave + nombre visible + color de muestra). */
export const FORMATOS_PDF: Array<{ key: FormatoPdf; nombre: string; muestra: string }> = [
  { key: 'clasico',   nombre: 'Clásico (azul)',      muestra: '#1e40af' },
  { key: 'esmeralda', nombre: 'Esmeralda (verde)',   muestra: '#047857' },
  { key: 'carbon',    nombre: 'Carbón (gris · rojo)', muestra: '#b91c1c' },
  { key: 'cielo',     nombre: 'Cielo (azul claro)',  muestra: '#0284c7' },
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
};

/** Tema por clave; ante cualquier valor desconocido o vacío, el clásico. */
export function getTema(formato?: string | null): TemaPdf {
  return TEMAS[(formato || '') as FormatoPdf] || TEMAS.clasico;
}
