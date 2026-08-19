/**
 * estilo-excel — la paleta de la casa, en un solo lugar.
 *
 * DE DÓNDE SALEN LOS COLORES
 * Del formato "Lista de Raya" que ya se usaba: se leyeron sus celdas una por
 * una —fondos, tipografía, tamaños y formatos de número— en vez de escoger
 * colores parecidos. Que la prenómina y los reportes salgan iguales importa
 * porque se imprimen juntos y se archivan juntos.
 *
 * POR QUÉ AQUÍ Y NO EN CADA REPORTE
 * Son cinco hojas distintas. Con la paleta repartida, la sexta saldría con otro
 * azul y nadie sabría cuál es el bueno.
 *
 * SheetJS en su versión libre NO escribe estilos: los ignora al guardar. Por
 * eso las hojas se arman con ExcelJS, que sí los conserva.
 */

import ExcelJS from 'exceljs';

/** Los colores del formato, tal como estaban. */
export const C = {
  tituloFondo:   'FFE8EDF5',
  tituloTexto:   'FF162840',

  /* Las tres bandas. */
  ingresos:      'FF1E3D6E',
  descuentos:    'FFA93226',
  neto:          'FF1A5C30',

  /* Encabezados de columna. */
  identidad:     'FF162840',   // # y NOMBRE
  totalIngresos: 'FF0D2040',
  totalDescuentos: 'FF641D17',

  blanco:        'FFFFFFFF',
  textoBase:     'FF162840',
  textoRojo:     'FF7B1C1C',
  textoVerde:    'FF1A5C30',
  textoGris:     'FF666666',

  /* Fondos de la fila de totales. */
  totalAzul:     'FFDCE6F5',
  totalRojo:     'FFFDE8E6',
  totalVerde:    'FFD6F0E0',
} as const;

export const FUENTE = 'Calibri';

/** Pesos con dos decimales y separador de miles, como en el formato. */
export const FORMATO_PESOS = '#,##0.00';

/** El título de la hoja, combinado a lo ancho. */
export function titulo(ws: ExcelJS.Worksheet, texto: string, columnas: number) {
  const c = ws.getCell('A1');
  c.value = texto;
  c.font = { name: FUENTE, size: 14, bold: true, color: { argb: C.tituloTexto } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.tituloFondo } };
  c.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.mergeCells(1, 1, 1, Math.max(columnas, 6));
  ws.getRow(1).height = 22;
}

/** Un renglón del encabezado: "Empresa: …", "RFC: …". */
export function dato(ws: ExcelJS.Worksheet, fila: number, col: number, texto: string, negrita = false) {
  const c = ws.getCell(fila, col);
  c.value = texto;
  c.font = { name: FUENTE, size: negrita ? 11 : 10, bold: negrita };
  c.alignment = { horizontal: 'left' };
}

/** Una banda de grupo — INGRESOS, DESCUENTOS, NETO. */
export function banda(
  ws: ExcelJS.Worksheet, fila: number, desde: number, hasta: number,
  texto: string, color: string
) {
  const c = ws.getCell(fila, desde);
  c.value = texto;
  c.font = { name: FUENTE, size: 9, bold: true, color: { argb: C.blanco } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  c.alignment = { horizontal: 'center', vertical: 'middle' };
  if (hasta > desde) ws.mergeCells(fila, desde, fila, hasta);
  for (let i = desde; i <= hasta; i++) {
    ws.getCell(fila, i).fill =
      { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  }
}

/** El encabezado de columnas, con su color por bloque. */
export function encabezado(
  ws: ExcelJS.Worksheet, fila: number,
  columnas: Array<{ texto: string; color: string }>
) {
  columnas.forEach((col, i) => {
    const c = ws.getCell(fila, i + 1);
    c.value = col.texto;
    c.font = { name: FUENTE, size: 9, bold: true, color: { argb: C.blanco } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.color } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  ws.getRow(fila).height = 28;
}

export type Tinta = 'base' | 'rojo' | 'verde' | 'gris';

const TINTAS: Record<Tinta, string> = {
  base: C.textoBase, rojo: C.textoRojo, verde: C.textoVerde, gris: C.textoGris,
};

/**
 * Una celda de datos. Los números llevan formato de pesos y van a la derecha;
 * el texto a la izquierda. Distinguirlos aquí evita que un importe salga como
 * texto y deje de sumarse en Excel — que es el error que vuelve inútil una hoja
 * de cálculo.
 */
export function celda(
  ws: ExcelJS.Worksheet, fila: number, col: number, valor: any,
  o: { tinta?: Tinta; negrita?: boolean; pesos?: boolean; centrado?: boolean; fondo?: string } = {}
) {
  const c = ws.getCell(fila, col);
  const esNumero = typeof valor === 'number' && Number.isFinite(valor);
  c.value = valor === null || valor === undefined ? '' : valor;
  c.font = {
    name: FUENTE, size: 10, bold: !!o.negrita,
    color: { argb: TINTAS[o.tinta || 'base'] },
  };
  if (esNumero && o.pesos !== false) c.numFmt = FORMATO_PESOS;
  c.alignment = {
    horizontal: o.centrado ? 'center' : esNumero ? 'right' : 'left',
  };
  if (o.fondo) {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fondo } };
  }
  return c;
}

/** El pie de totales, con su fondo por bloque. */
export function totales(
  ws: ExcelJS.Worksheet, fila: number,
  celdas: Array<{ valor: any; fondo?: string; tinta?: Tinta; centrado?: boolean }>
) {
  celdas.forEach((x, i) => {
    celda(ws, fila, i + 1, x.valor, {
      negrita: true,
      tinta: x.tinta || 'base',
      fondo: x.fondo || C.tituloFondo,
      centrado: x.centrado,
    });
  });
}

/** Anchos: el nombre necesita espacio y los importes no. */
export function anchos(ws: ExcelJS.Worksheet, cols: number[]) {
  cols.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

/** El libro terminado, listo para mandarse. */
export async function aBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export { ExcelJS };
