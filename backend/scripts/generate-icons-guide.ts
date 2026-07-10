/**
 * Genera el PDF "GUIA_ICONOS_FACTURAS.pdf" con la descripción de cada
 * icono que puede aparecer en la lista de facturas del ERP.
 *
 * Los iconos se DIBUJAN con los SVG paths reales de Lucide (los mismos
 * que renderiza el frontend). PDFKit soporta `doc.path()` para paths SVG
 * y `doc.circle()` para círculos — no necesitamos convertir a PNG.
 *
 * Uso:
 *   npm run docs:icons
 *
 * Salida:
 *   docs/GUIA_ICONOS_FACTURAS.pdf
 */

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

type PDFDoc = InstanceType<typeof PDFDocument>;

/* ─────────────── SVG paths de Lucide ───────────────
 *
 * Todos los iconos Lucide son viewBox 24×24, stroke-width 2, sin fill.
 * Cada icono es un array de "trazos": paths (string) o círculos (obj).
 * Los renderizamos con stroke, no fill.
 */

type Stroke = string | { cx: number; cy: number; r: number };

const LUCIDE: Record<string, Stroke[]> = {
  fileDown: [
    'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z',
    'M14 2v4a2 2 0 0 0 2 2h4',
    'M12 18v-6',
    'M9 15l3 3 3-3',
  ],
  download: [
    'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
    'M7 10l5 5 5-5',
    'M12 15V3',
  ],
  eye: [
    'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z',
    { cx: 12, cy: 12, r: 3 },
  ],
  pencil: [
    'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
    'm15 5 4 4',
  ],
  stamp: [
    'M5 22h14',
    'M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z',
    'M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-3-3c-1.66 0-3 1-3 3s1 2 1 3.5V13',
  ],
  wallet: [
    'M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4',
    'M4 6v12c0 1.1.9 2 2 2h14v-4',
    'M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4Z',
  ],
  coins: [
    { cx: 8, cy: 8, r: 6 },
    'M18.09 10.37A6 6 0 1 1 10.34 18',
    'M7 6h1v4',
    'm16.71 13.88.7.71-2.82 2.82',
  ],
  history: [
    'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8',
    'M3 3v5h5',
    'M12 7v5l4 2',
  ],
  ban: [
    { cx: 12, cy: 12, r: 10 },
    'm4.9 4.9 14.2 14.2',
  ],
};

/**
 * Dibuja un icono Lucide en (x, y) con tamaño `size` puntos, en el color
 * dado. Todos los paths se pintan con stroke (no fill) — replican el
 * comportamiento de Lucide en el navegador (fill=none, stroke-width=2,
 * linecap=round, linejoin=round).
 */
function drawLucideIcon(
  doc: PDFDoc,
  name: keyof typeof LUCIDE,
  x: number,
  y: number,
  size: number,
  color: string
) {
  const strokes = LUCIDE[name];
  if (!strokes) return;

  const scale = size / 24;
  const strokeW = 2 * scale;

  doc.save();
  doc.translate(x, y).scale(scale);
  doc.strokeColor(color)
    .lineWidth(strokeW / scale)  // en unidades del viewBox 24
    .lineCap('round')
    .lineJoin('round');

  for (const s of strokes) {
    if (typeof s === 'string') {
      doc.path(s).stroke();
    } else {
      doc.circle(s.cx, s.cy, s.r).stroke();
    }
  }
  doc.restore();
}

/* ─────────────── Contenido de la guía ─────────────── */

interface IconRow {
  icon: keyof typeof LUCIDE;
  nombre: string;
  colorNombre: string;
  colorHex: string;
  funcion: string;
  cuandoAparece: string;
}

const ROWS: IconRow[] = [
  {
    icon: 'fileDown',
    nombre: 'Descargar PDF',
    colorNombre: 'rojo',
    colorHex: '#dc2626',
    funcion:
      'Descarga la representacion impresa del CFDI (PDF Anexo 20). Incluye QR SAT, sellos, ' +
      'cadena original, No. Certificado y desglose de impuestos.',
    cuandoAparece: 'Siempre. Si aun no timbra, genera el borrador con leyenda "sin sello del SAT".',
  },
  {
    icon: 'download',
    nombre: 'Descargar XML',
    colorNombre: 'verde',
    colorHex: '#16a34a',
    funcion:
      'Descarga el XML CFDI 4.0 timbrado (o reconstruido a partir de campos persistidos si viene ' +
      'de importacion antigua). Es el documento fiscal oficial.',
    cuandoAparece: 'Siempre. Sin timbre el XML no lleva TimbreFiscalDigital pero conserva el resto.',
  },
  {
    icon: 'eye',
    nombre: 'Vista previa PDF',
    colorNombre: 'azul',
    colorHex: '#2563eb',
    funcion:
      'Abre el PDF en el navegador (inline) sin descargarlo. Util para verificar antes de enviar ' +
      'por correo o de timbrar.',
    cuandoAparece: 'Siempre.',
  },
  {
    icon: 'pencil',
    nombre: 'Editar factura',
    colorNombre: 'cielo',
    colorHex: '#0284c7',
    funcion:
      'Abre la factura en modo edicion: se pueden cambiar cliente, conceptos, cantidades, precios, ' +
      'forma y metodo de pago. Al guardar, los totales se recalculan (Anexo 20).',
    cuandoAparece: 'Solo cuando status = DRAFT y is_stamped = false. Una vez timbrada la factura es inmutable.',
  },
  {
    icon: 'stamp',
    nombre: 'Timbrar factura',
    colorNombre: 'morado',
    colorHex: '#9333ea',
    funcion:
      'Envia la factura al PAC (SW Sapien). El PAC arma el XML, lo sella con el CSD del vault y ' +
      'la timbra ante el SAT. Al exito, la factura pasa a STAMPED con UUID real.',
    cuandoAparece: 'Cuando no esta timbrada, no cancelada, no ya en STAMPED. Rechaza si falta CSD o falla el PAC.',
  },
  {
    icon: 'wallet',
    nombre: 'Complemento de Pago',
    colorNombre: 'verde intenso',
    colorHex: '#15803d',
    funcion:
      'Abre el modal para timbrar un Complemento de Pago (CFDI tipo P). Precarga el saldo real ' +
      '(total - pagos - NC). Al timbrar, la factura pasa a PARTIAL_PAYMENT o PAID segun cubierto.',
    cuandoAparece:
      'Solo si la factura esta timbrada, no cancelada, no DRAFT, y tiene saldo pendiente > $0.01.',
  },
  {
    icon: 'coins',
    nombre: 'Ver saldo y aplicaciones',
    colorNombre: 'ambar',
    colorHex: '#d97706',
    funcion:
      'Modal con desglose: total facturado, pagado, NC aplicadas y saldo. Lista todos los abonos y ' +
      'NC vigentes. Boton "Enviar por correo" desde ahi.',
    cuandoAparece: 'Solo si status = PARTIAL_PAYMENT o PAID (ya tiene actividad de cobro/abono).',
  },
  {
    icon: 'history',
    nombre: 'Historia de timbres',
    colorNombre: 'indigo',
    colorHex: '#4f46e5',
    funcion:
      'Vista cronologica de los CFDIs relacionados: la factura padre, cada NC y cada Complemento de ' +
      'Pago. Descarga PDF/XML por renglon. Boton "Cancelar" en cada dependiente para permitir ' +
      'la cancelacion en cascada.',
    cuandoAparece: 'Solo si la factura esta timbrada (is_stamped = true).',
  },
  {
    icon: 'ban',
    nombre: 'Cancelar factura',
    colorNombre: 'naranja',
    colorHex: '#ea580c',
    funcion:
      'Modal con motivos SAT (01-04). Envia la cancelacion al PAC. Si SW rebota con 404 (bug de ' +
      'vault en sandbox), ofrece bypass local para marcar solo en la BD. Si la factura ya esta ' +
      'CANCELADA con pac_id = SW_SAPIEN, el mismo boton sirve para "Reintentar en el PAC".',
    cuandoAparece:
      'Cuando la factura no esta cancelada, o cuando esta cancelada localmente pero aun vigente en SW.',
  },
];

const REGLAS: Array<{ titulo: string; texto: string }> = [
  {
    titulo: 'Regla de cancelacion en cascada',
    texto:
      'Si una factura tiene NC o Complementos de Pago vigentes, el sistema exige cancelar primero ' +
      'esos comprobantes desde el icono Historia. La factura solo se puede cancelar cuando no tiene ' +
      'dependientes vivos.',
  },
  {
    titulo: 'Calculo de saldo real',
    texto:
      'Saldo = Total - Suma(pagos vigentes) - Suma(NC vigentes). Los pagos/NC cancelados NO se ' +
      'descuentan. Cuando saldo <= $0.01, la factura pasa a PAID automaticamente.',
  },
  {
    titulo: 'Regla de edicion',
    texto:
      'Solo facturas en estado DRAFT pueden editarse. Una vez timbradas, cualquier cambio requiere ' +
      'cancelar y emitir un nuevo CFDI (SAT no permite alterar comprobantes vivos).',
  },
  {
    titulo: 'Envio por correo',
    texto:
      'Desde el modal Saldo -> "Enviar por correo". Se pueden marcar por separado el PDF y el XML de ' +
      'la factura, de cada NC y de cada Complemento de Pago. Adjuntos que fallen se listan en el ' +
      'toast; los que si generen se envian igual (mailer tolerante).',
  },
];

async function main() {
  const outDir = path.resolve(__dirname, '..', '..', 'docs');
  fs.mkdirSync(outDir, { recursive: true });
  let outFile = path.join(outDir, 'GUIA_ICONOS_FACTURAS.pdf');

  // Fallback si el archivo canónico está abierto en un visor.
  try {
    const fd = fs.openSync(outFile, 'w');
    fs.closeSync(fd);
  } catch {
    outFile = path.join(outDir, `GUIA_ICONOS_FACTURAS-${new Date().toISOString().slice(0, 10)}.pdf`);
    console.warn(`⚠  Archivo canonico bloqueado — usando ${path.basename(outFile)}`);
  }

  const doc = new PDFDocument({ size: 'letter', margin: 50, bufferPages: true });
  const stream = fs.createWriteStream(outFile);
  doc.pipe(stream);

  const ICON_SIZE = 22;   // pt
  const CONTENT_X = 90;   // texto arranca aquí (después del icono)

  /* ─────────────── Portada ─────────────── */
  doc.font('Helvetica-Bold').fontSize(24).fillColor('#1e40af')
    .text('GDM_FAC — ERP CFDI 4.0', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(16).fillColor('#334155')
    .text('Guia de iconos del listado de Facturas', { align: 'center' });
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(10).fillColor('#64748b')
    .text(`Generado ${new Date().toISOString().slice(0, 10)}`, { align: 'center' });
  doc.moveDown(2);

  doc.font('Helvetica').fontSize(11).fillColor('#0f172a')
    .text(
      'Este documento describe cada uno de los iconos que aparecen en la columna de acciones ' +
      'de una factura, incluidos los que solo se muestran bajo ciertas condiciones (canStamp, ' +
      'canPay, canEdit, etc.). Los iconos estan dibujados con los mismos SVG paths de Lucide que ' +
      'renderiza el frontend, en el orden en que aparecen de izquierda a derecha.',
      { align: 'justify' }
    );
  doc.moveDown(1.5);

  /* ─────────────── Tabla de iconos ─────────────── */
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#1e40af')
    .text('Iconos disponibles (en el orden en que aparecen)');
  doc.moveDown(0.5);

  for (const row of ROWS) {
    // Nueva página si el bloque no cabe (~85pt)
    if (doc.y > 660) doc.addPage();

    // separador
    const y0 = doc.y;
    doc.moveTo(50, y0).lineTo(562, y0).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    doc.moveDown(0.35);

    // Icono real dibujado a la izquierda + nombre a la derecha
    const rowY = doc.y;
    drawLucideIcon(doc, row.icon, 55, rowY - 2, ICON_SIZE, row.colorHex);

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12)
      .text(row.nombre, CONTENT_X, rowY, { lineBreak: false });
    doc.moveDown(0.25);

    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#64748b')
      .text(`Color: ${row.colorNombre}`, CONTENT_X, doc.y);
    doc.moveDown(0.3);

    // Función
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#334155')
      .text('Funcion:', CONTENT_X, doc.y, { continued: true })
      .font('Helvetica').fillColor('#0f172a')
      .text(' ' + row.funcion, { align: 'justify' });
    doc.moveDown(0.2);

    // Cuándo aparece
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#334155')
      .text('Cuando aparece:', CONTENT_X, doc.y, { continued: true })
      .font('Helvetica').fillColor('#0f172a')
      .text(' ' + row.cuandoAparece, { align: 'justify' });
    doc.moveDown(0.8);

    // Reset de X a margen izquierdo para el siguiente separador
    doc.x = 50;
  }

  /* ─────────────── Reglas ─────────────── */
  if (doc.y > 620) doc.addPage();
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#1e40af')
    .text('Reglas de negocio relacionadas', 50);
  doc.moveDown(0.5);

  for (const regla of REGLAS) {
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#0f172a')
      .text(regla.titulo, 50);
    doc.font('Helvetica').fontSize(10).fillColor('#334155')
      .text(regla.texto, 50, doc.y, { align: 'justify' });
    doc.moveDown(0.7);
  }

  /* ─────────────── Pie ─────────────── */
  doc.moveDown(1);
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#64748b')
    .text(
      'Documento auto-generado por scripts/generate-icons-guide.ts. Los iconos son SVG paths ' +
      'reales de Lucide (los mismos del frontend). Regenerar con `npm run docs:icons`.',
      { align: 'center' }
    );

  doc.end();
  await new Promise<void>((resolve) => stream.on('finish', () => resolve()));

  console.log(`✅ Generado: ${outFile}`);
  const stat = fs.statSync(outFile);
  console.log(`   ${(stat.size / 1024).toFixed(1)} KB`);
}

main().catch((e) => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
