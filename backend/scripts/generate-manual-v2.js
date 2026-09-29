#!/usr/bin/env node
/**
 * generate-manual-v2.js — Manual de usuario de GDM Facturación V2.
 *
 * Genera `frontend/public/manual-usuario.pdf` desde cero con PDFKit. Se
 * eligió PDFKit sobre Word/Puppeteer porque el manual se sirve como PDF
 * estático desde el hosting y no requiere capturas de pantalla: el sidebar
 * V2 usa emoji, que PDFKit no rasteriza, así que los iconos se describen
 * con su glifo entre corchetes en lugar de dibujarlos.
 *
 * Uso:  node scripts/generate-manual-v2.js
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { icons } = require('./manual-icons');

const OUT = path.resolve(__dirname, '..', '..', 'frontend', 'public', 'manual-usuario.pdf');
const LOGO = path.resolve(__dirname, '..', '..', 'frontend', 'public', 'gdm-logo.png');

/* ─── Paleta (misma del PDF de facturas) ─── */
const NAVY = '#1e3a8a';
const NAVY_DARK = '#0f172a';
const GOLD = '#d4a574';
const GRAY = '#475569';
const GRAY_LIGHT = '#94a3b8';
const BG_SOFT = '#f1f5f9';

const M = 56;            // margen
const W = 595.28 - M * 2; // ancho útil A4

const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true,
  info: {
    Title: 'Manual de Usuario · GDM NEXO',
    Author: 'GRUPO HCGM S.A. DE C.V.',
    Subject: 'ERP CFDI 4.0 — Facturación, Almacén, Compras, Tesorería, Nómina y Contabilidad',
  },
});
doc.pipe(fs.createWriteStream(OUT));

let toc = [];   // {titulo, pagina, nivel}

/* ─── Helpers de composición ─── */

function needSpace(pts) {
  if (doc.y + pts > doc.page.height - 80) { doc.addPage(); return true; }
  return false;
}

/** Capítulo: barra dorada + título grande. Para NO dejar huecos, solo salta a
 *  página nueva si no queda espacio razonable; si hay lugar, continúa en la misma
 *  con un respiro. El primero siempre en hoja nueva (después del índice). */
let _primerCap = true;
function chapter(num, title) {
  if (_primerCap) { doc.addPage(); _primerCap = false; }
  else if ((doc.page.height - 80) - doc.y < 300) { doc.addPage(); }
  else { doc.moveDown(2); }
  toc.push({ titulo: `${num}. ${title}`, pagina: pageNo(), nivel: 1 });
  doc.rect(M, doc.y, 48, 4).fill(GOLD);
  doc.y += 14;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(GOLD)
     .text(`CAPÍTULO ${num}`, M, doc.y);
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(23).fillColor(NAVY_DARK)
     .text(title, M, doc.y, { width: W });
  doc.moveDown(1);
}

function h2(title) {
  needSpace(90);
  doc.moveDown(0.7);
  toc.push({ titulo: title, pagina: pageNo(), nivel: 2 });
  doc.font('Helvetica-Bold').fontSize(14).fillColor(NAVY)
     .text(title, M, doc.y, { width: W });
  doc.moveDown(0.35);
}

function h3(title) {
  needSpace(60);
  doc.moveDown(0.45);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY_DARK)
     .text(title, M, doc.y, { width: W });
  doc.moveDown(0.2);
}

function p(text, opts = {}) {
  needSpace(46);
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
     .fontSize(opts.size || 10)
     .fillColor(opts.color || GRAY)
     .text(text, M + (opts.indent || 0), doc.y,
           { width: W - (opts.indent || 0), align: opts.align || 'justify', lineGap: 1.6 });
  doc.moveDown(opts.gap ?? 0.45);
}

/** Lista con viñeta. `items` puede traer "**negrita** resto". */
function bullets(items, opts = {}) {
  const bullet = opts.bullet || '•';
  items.forEach(it => {
    needSpace(34);
    const x = M + (opts.indent || 12);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(opts.bulletColor || NAVY)
       .text(bullet, x, doc.y, { width: 14, continued: false });
    const yLine = doc.y - doc.currentLineHeight();
    // Soporte de **negrita** al inicio
    const mm = it.match(/^\*\*(.+?)\*\*\s*(.*)$/s);
    if (mm) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY_DARK)
         .text(mm[1], x + 16, yLine, { width: W - 30, continued: true });
      doc.font('Helvetica').fillColor(GRAY).text(mm[2] ? ` ${mm[2]}` : '', { width: W - 30 });
    } else {
      doc.font('Helvetica').fontSize(10).fillColor(GRAY)
         .text(it, x + 16, yLine, { width: W - 30, lineGap: 1.4 });
    }
    doc.moveDown(0.25);
  });
  doc.moveDown(0.3);
}

/** Pasos numerados. */
function steps(items) {
  items.forEach((it, i) => {
    needSpace(38);
    const x = M + 12;
    const y0 = doc.y;
    doc.circle(x + 7, y0 + 6, 8).fill(NAVY);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff')
       .text(String(i + 1), x, y0 + 3, { width: 15, align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor(GRAY)
       .text(it, x + 24, y0, { width: W - 40, lineGap: 1.4 });
    doc.moveDown(0.4);
  });
  doc.moveDown(0.2);
}

/** Caja de aviso: kind = info | warn | tip | danger */
function box(kind, title, text) {
  const palette = {
    info:   { bg: '#eff6ff', border: '#3b82f6', icon: 'i',  fg: '#1e40af' },
    warn:   { bg: '#fffbeb', border: '#f59e0b', icon: '!',  fg: '#92400e' },
    tip:    { bg: '#f0fdf4', border: '#22c55e', icon: '+',  fg: '#166534' },
    danger: { bg: '#fef2f2', border: '#ef4444', icon: 'x',  fg: '#991b1b' },
  }[kind];

  doc.font('Helvetica').fontSize(9.5);
  const h = doc.heightOfString(text, { width: W - 48, lineGap: 1.5 }) + 34;
  needSpace(h + 12);

  const y0 = doc.y;
  doc.roundedRect(M, y0, W, h, 6).fill(palette.bg);
  doc.rect(M, y0, 4, h).fill(palette.border);
  doc.circle(M + 20, y0 + 15, 7).fill(palette.border);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff')
     .text(palette.icon, M + 13, y0 + 11, { width: 14, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(palette.fg)
     .text(title, M + 34, y0 + 10, { width: W - 48 });
  doc.font('Helvetica').fontSize(9.5).fillColor(palette.fg)
     .text(text, M + 34, doc.y + 2, { width: W - 48, lineGap: 1.5 });
  doc.y = y0 + h + 10;
}

/**
 * Tabla. `cols = [{label, w, align}]`, `rows = [[...]]`.
 *
 * Una celda puede ser texto o `{ icon: 'home', color: '#hex' }` para dibujar
 * un icono vectorial centrado (ver manual-icons.js). Los emoji no sirven
 * porque PDFKit no puede incrustar fuentes de color.
 */
function table(cols, rows) {
  const totalW = cols.reduce((a, c) => a + c.w, 0);
  needSpace(46 + rows.length * 20);

  const drawHeader = (yy) => {
    doc.rect(M, yy, totalW, 20).fill(NAVY);
    let xh = M;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    cols.forEach(c => {
      doc.text(c.label, xh + 6, yy + 6, { width: c.w - 12, align: c.align || 'left', lineBreak: false });
      xh += c.w;
    });
    return yy + 20;
  };

  let y = drawHeader(doc.y);

  rows.forEach((r, i) => {
    doc.font('Helvetica').fontSize(8.5);
    // Altura: los iconos ocupan 18pt fijos, el texto lo que necesite
    let maxH = 20;
    cols.forEach((c, j) => {
      const cell = r[j];
      if (cell && typeof cell === 'object' && cell.icon) return;
      const hh = doc.heightOfString(String(cell ?? ''), { width: c.w - 12 });
      if (hh + 8 > maxH) maxH = hh + 8;
    });

    if (y + maxH > doc.page.height - 80) {
      doc.addPage();
      y = drawHeader(doc.y);
    }

    if (i % 2 === 0) doc.rect(M, y, totalW, maxH).fill(BG_SOFT);

    let xr = M;
    cols.forEach((c, j) => {
      const cell = r[j];
      if (cell && typeof cell === 'object' && cell.icon) {
        const fn = icons[cell.icon];
        if (fn) {
          const size = 16;
          fn(doc, xr + (c.w - size) / 2, y + (maxH - size) / 2, size, cell.color || NAVY);
        }
      } else {
        doc.font('Helvetica').fontSize(8.5).fillColor(NAVY_DARK)
           .text(String(cell ?? ''), xr + 6, y + 5, { width: c.w - 12, align: c.align || 'left' });
      }
      xr += c.w;
    });
    y += maxH;
  });
  doc.y = y + 12;
}

/** Icono suelto en el flujo, con etiqueta a la derecha. */
function iconLine(name, color, text) {
  needSpace(30);
  const y0 = doc.y;
  const fn = icons[name];
  if (fn) fn(doc, M + 4, y0, 15, color);
  doc.font('Helvetica').fontSize(10).fillColor(GRAY)
     .text(text, M + 26, y0 + 1, { width: W - 26, lineGap: 1.4 });
  doc.moveDown(0.35);
}

function pageNo() { return doc.bufferedPageRange().count; }

/* ══════════════════════════════════════════════════════════
   PORTADA
══════════════════════════════════════════════════════════ */
doc.rect(0, 0, 595.28, 841.89).fill(NAVY_DARK);
// Halo dorado
doc.circle(500, 120, 190).fillOpacity(0.06).fill(GOLD).fillOpacity(1);
doc.circle(80, 700, 150).fillOpacity(0.05).fill('#3b82f6').fillOpacity(1);

if (fs.existsSync(LOGO)) {
  try { doc.image(LOGO, 595.28 / 2 - 55, 130, { width: 110, height: 110 }); } catch {}
}

doc.rect(595.28 / 2 - 30, 268, 60, 3).fill(GOLD);

doc.font('Helvetica-Bold').fontSize(34).fillColor('#ffffff')
   .text('Manual de Usuario', M, 305, { width: W, align: 'center' });
doc.font('Helvetica').fontSize(17).fillColor(GOLD)
   .text('GDM NEXO · ERP CFDI 4.0', M, 348, { width: W, align: 'center' });

doc.font('Helvetica').fontSize(11).fillColor('#cbd5e1')
   .text('Tu empresa en un solo sistema: factura, almacén, compras, tesorería,', M, 392, { width: W, align: 'center' });
doc.text('nómina y contabilidad, con timbrado real ante el SAT.', M, 410, { width: W, align: 'center' });

// Tarjetas de novedades
const cards = [
  ['Facturación y Carta Porte', 'CFDI 4.0 + traslado 3.1'],
  ['Almacén y Compras', 'El XML da de alta y surte'],
  ['Nómina y Checador', 'Recibos y asistencia facial'],
  ['Contabilidad', 'Pólizas, SAT y cédulas'],
];
let cy = 470;
cards.forEach((c, i) => {
  const cx = i % 2 === 0 ? M + 10 : M + W / 2 + 5;
  if (i % 2 === 0 && i > 0) cy += 62;
  doc.roundedRect(cx, cy, W / 2 - 15, 52, 8).fillOpacity(0.08).fill('#ffffff').fillOpacity(1);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(GOLD).text(c[0], cx + 14, cy + 12, { width: W / 2 - 40 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#cbd5e1').text(c[1], cx + 14, cy + 28, { width: W / 2 - 40 });
});

doc.font('Helvetica').fontSize(9).fillColor('#64748b')
   .text('GRUPO HCGM, S.A. DE C.V.  ·  RFC GHC1707275Y0', M, 700, { width: W, align: 'center' });
doc.text('Aguascalientes, Ags., México  ·  info@hcgm.com.mx', M, 715, { width: W, align: 'center' });
doc.font('Helvetica').fontSize(8).fillColor('#475569')
   .text(`Edición ${new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long' })}`, M, 745, { width: W, align: 'center' });

/* ══════════════════════════════════════════════════════════
   ÍNDICE (placeholder — se rellena al final)
══════════════════════════════════════════════════════════ */
doc.addPage();
const tocPageIndex = doc.bufferedPageRange().count - 1;
doc.font('Helvetica-Bold').fontSize(24).fillColor(NAVY_DARK).text('Contenido', M, M + 10);
doc.rect(M, doc.y + 6, 48, 3).fill(GOLD);

/* ══════════════════════════════════════════════════════════
   CAP 1 — PRIMEROS PASOS
══════════════════════════════════════════════════════════ */
chapter(1, 'Primeros pasos');

p('GDM NEXO es un ERP en línea que reúne, en un solo sistema y con una sola base de datos, todo el ciclo de tu empresa: facturación CFDI 4.0 con timbrado real ante el SAT, almacén e inventarios, compras a proveedores, punto de venta, tesorería, nómina con checador de asistencia, y contabilidad electrónica. Todo está conectado: lo que se factura sale del almacén, lo que se compra entra con su cuenta por pagar, y cada CFDI se refleja en la contabilidad.');

p('Cada usuario ve únicamente los módulos de su grupo de trabajo. Este manual describe todos los módulos; tú verás en tu menú los que te correspondan según tu rol (Ventas, Almacén, Compras, Tesorería, Nómina o Contabilidad).');

h2('Cómo entrar');
steps([
  'Abre tu navegador y ve a la dirección del sistema que te proporcionó HCGM.',
  'Escribe tu correo electrónico y tu contraseña.',
  'Pulsa Ingresar. Si es tu primer acceso, el sistema te pedirá cambiar la contraseña.',
]);

box('tip', 'La sesión se cierra al cerrar la pestaña',
  'Por seguridad, tu sesión vive únicamente en la pestaña donde iniciaste. Si cierras la ventana, tendrás que volver a entrar. Recargar la página (F5) no te saca.');

h2('El menú lateral');
p('Todo el sistema se navega desde la barra de la izquierda. Cada módulo tiene un icono que lo identifica de un vistazo. Puedes plegar la barra con el botón de la esquina superior para ganar espacio de pantalla.');

table(
  [ { label: 'Icono', w: 46, align: 'center' }, { label: 'Módulo', w: 130 }, { label: 'Para qué sirve', w: W - 176 } ],
  [
    [{ icon: 'home',     color: '#0284c7' }, 'Dashboard',        'Resumen del mes: facturas emitidas, timbres disponibles y cobranza pendiente.'],
    [{ icon: 'receipt',  color: '#d97706' }, 'Facturas',         'Emitir, timbrar, cancelar y enviar por correo tus CFDI.'],
    [{ icon: 'truck',    color: '#d97706' }, 'Carta Porte',      'Complemento de traslado. Se despliega en cinco catálogos (ver capítulo 3).'],
    [{ icon: 'fileDown', color: '#e11d48' }, 'Notas de Crédito', 'Devoluciones, descuentos y bonificaciones sobre facturas ya timbradas.'],
    [{ icon: 'box',      color: '#c026d3' }, 'Productos',        'Catálogo de lo que vendes, con su clave SAT y su régimen de impuestos.'],
    [{ icon: 'users',    color: '#059669' }, 'Clientes',         'Receptores de tus facturas. Se pueden dar de alta leyendo su Constancia Fiscal.'],
    [{ icon: 'inbox',    color: '#7c3aed' }, 'Lector de XML',    'Importa uno o varios XML y llena tus catálogos automáticamente.'],
    [{ icon: 'chart',    color: '#7c3aed' }, 'Reportes',         'Ventas por periodo, cobranza y exportación a Excel o PDF.'],
    [{ icon: 'contract', color: '#0284c7' }, 'Contrato',         'Contrato de servicio y manifiesto ante el PAC, firmables con e.firma.'],
  ]
);

h2('Antes de tu primera factura');
p('El sistema necesita tres cosas cargadas para poder timbrar. Las encuentras todas en el botón DATOS DE MI EMPRESA de la barra superior:');
bullets([
  '**Datos fiscales.** Razón social, RFC, régimen y domicilio, tal como aparecen en tu Constancia de Situación Fiscal.',
  '**Certificado de Sello Digital (CSD).** Los archivos .cer y .key que el SAT te entregó para facturar, más su contraseña. No confundir con la e.firma.',
  '**Manifiesto ante el PAC.** Se firma una sola vez con tu e.firma (FIEL) y autoriza al proveedor autorizado de certificación a timbrar a tu nombre.',
]);

box('warn', 'CSD y e.firma no son lo mismo',
  'El CSD sirve para sellar facturas y es lo que se carga en la sección CSD. La e.firma (FIEL) es tu identidad ante el SAT y solo se usa para firmar el contrato y el manifiesto. Si intentas timbrar con la e.firma, el PAC rechazará el comprobante.');

/* ══════════════════════════════════════════════════════════
   CAP 2 — FACTURACIÓN
══════════════════════════════════════════════════════════ */
chapter(2, 'Facturación');

h2('Emitir una factura');
steps([
  'Entra a Facturas y pulsa Nueva Factura.',
  'Elige el cliente. Si no existe, puedes darlo de alta desde ahí mismo o leer su Constancia de Situación Fiscal en PDF.',
  'Agrega los conceptos: busca cada producto de tu catálogo, indica cantidad y precio.',
  'Revisa los datos fiscales: uso de CFDI, forma y método de pago.',
  'Guarda. La factura queda en estado BORRADOR y todavía se puede editar.',
  'Cuando esté correcta, pulsa el icono de timbrar. El sistema la sella con tu CSD y la envía al PAC.',
]);

box('danger', 'Una factura timbrada ya no se edita',
  'Al timbrar, el CFDI queda registrado ante el SAT. Si te equivocaste, la única salida es cancelar y emitir una nueva. Revisa importes, RFC y uso de CFDI antes de pulsar timbrar.');

h2('Los botones de cada factura');
p('Al final de cada renglón encontrarás una fila de iconos. Los que aparecen dependen del estado de la factura:');

table(
  [ { label: 'Icono', w: 50, align: 'center' }, { label: 'Acción', w: 132 }, { label: 'Cuándo aparece', w: W - 182 } ],
  [
    [{ icon: 'fileDown', color: '#dc2626' }, 'Descargar PDF',        'Siempre. Es la representación impresa del CFDI.'],
    [{ icon: 'download', color: '#16a34a' }, 'Descargar XML',        'Siempre. Es el archivo fiscal que vale ante el SAT.'],
    [{ icon: 'eye',      color: '#2563eb' }, 'Vista previa',         'Siempre. Abre el PDF sin descargarlo.'],
    [{ icon: 'ship',     color: '#d97706' }, 'Carta Porte',          'Solo en borradores. En facturas timbradas queda deshabilitado.'],
    [{ icon: 'pencil',   color: '#0284c7' }, 'Editar',               'Solo en borradores.'],
    [{ icon: 'stamp',    color: '#7c3aed' }, 'Timbrar',              'Solo en borradores con CSD cargado.'],
    [{ icon: 'wallet',   color: '#16a34a' }, 'Complemento de pago',  'En facturas PPD con saldo pendiente.'],
    [{ icon: 'coins',    color: '#d97706' }, 'Ver saldo',            'En facturas con abonos o notas de crédito aplicadas.'],
    [{ icon: 'mail',     color: '#4f46e5' }, 'Enviar por correo',    'Solo en facturas timbradas. Adjunta PDF y XML.'],
    [{ icon: 'history',  color: '#4f46e5' }, 'Historial de timbres', 'Solo en timbradas. Muestra factura, notas y pagos.'],
    [{ icon: 'ban',      color: '#ea580c' }, 'Cancelar',             'En timbradas dentro del plazo que permite el SAT.'],
  ]
);

box('warn', 'La Carta Porte se agrega ANTES de timbrar',
  'El complemento viaja dentro del XML sellado, así que debe existir en el momento del timbrado. Por eso el icono del barco se deshabilita en cuanto la factura queda timbrada: el sistema te lo indica al pasar el ratón encima.');

h2('Enviar la factura al cliente');
p('El icono del sobre abre una ventana donde eliges destinatario, asunto y mensaje. El PDF y el XML se adjuntan automáticamente. El correo sale desde el buzón que hayas configurado en DATOS DE MI EMPRESA, sección Servidor de correo; si no configuraste ninguno, sale desde el buzón central de la plataforma.');

h3('Configurar tu propio buzón');
p('Si prefieres que tus facturas salgan desde tu propia cuenta (por ejemplo facturas@tuempresa.mx), llena los datos del servidor SMTP. El sistema trae botones con la configuración de los proveedores más usados en México: Hostinger, Gmail, Office 365 y Zoho. Después de guardar, usa Enviar correo de prueba para verificar que las credenciales funcionen.');

box('tip', 'Gmail requiere contraseña de aplicación',
  'Google no acepta tu contraseña normal para enviar correo desde programas externos. Activa la verificación en dos pasos y genera una contraseña de aplicación en myaccount.google.com/apppasswords. Esa es la que se escribe aquí.');

/* ══════════════════════════════════════════════════════════
   CAP 3 — CARTA PORTE
══════════════════════════════════════════════════════════ */
chapter(3, 'Complemento Carta Porte 3.1');

p('La Carta Porte es el complemento que el SAT exige para amparar el traslado de mercancías por territorio nacional. Describe qué se transporta, desde dónde y hacia dónde, en qué vehículo y quién lo conduce.');

box('info', 'Se captura sobre una factura en borrador',
  'La Carta Porte no es un documento aparte: es un bloque que se añade al CFDI. Por eso siempre se parte de una factura existente y sin timbrar.');

h2('Los cinco catálogos');
p('Para no capturar los mismos datos en cada viaje, el sistema guarda cinco catálogos. Al desplegar Carta Porte en el menú lateral encontrarás:');

table(
  [ { label: 'Icono', w: 46, align: 'center' }, { label: 'Catálogo', w: 132 }, { label: 'Qué guarda', w: W - 178 } ],
  [
    [{ icon: 'pin',    color: '#059669' }, 'Lugares frecuentes', 'Direcciones de origen y destino con las que trabajas seguido: RFC, nombre, calle, colonia, municipio, estado y código postal.'],
    [{ icon: 'truck',  color: '#d97706' }, 'Vehículos',          'Placa, configuración vehicular, permiso SCT, año y peso bruto de cada unidad de tu flota.'],
    [{ icon: 'shield', color: '#0284c7' }, 'Aseguradoras',       'Nombre de la aseguradora y número de póliza de responsabilidad civil, ambiental o de carga.'],
    [{ icon: 'driver', color: '#7c3aed' }, 'Operadores',         'Nombre, RFC y número de licencia de tus choferes y demás figuras de transporte.'],
    [{ icon: 'box',    color: '#e11d48' }, 'Mercancías',         'Las mercancías que has transportado, con su clave SAT, unidad y peso. Ver capítulo 5.'],
  ]
);

h2('Capturar una Carta Porte');
steps([
  'En Facturas, localiza la factura en borrador y pulsa el icono del barco.',
  'Bloque 1 — Encabezado: indica si hay transporte internacional y la distancia total en kilómetros.',
  'Bloque 2 — Ubicaciones: captura el origen y el destino (ver la sección siguiente).',
  'Bloque 3 — Mercancías: agrega qué se transporta, con su clave SAT, cantidad, peso y valor.',
  'Bloque 4 — Medio de transporte: permiso SCT, configuración vehicular, placa y aseguradora.',
  'Bloque 5 — Figuras de transporte: el operador que conduce, con su RFC y licencia.',
  'Guarda y regresa a Facturas para timbrar. El complemento viaja dentro del XML.',
]);

h2('Las ubicaciones y el código postal');
p('La captura de direcciones está diseñada para que empieces por el código postal. Al escribir los cinco dígitos, el sistema consulta los catálogos oficiales del SAT y hace tres cosas:');
bullets([
  '**Deduce el estado** y lo muestra con su nombre completo, sin que tengas que buscar la clave.',
  '**Carga las colonias** de ese código postal en una lista desplegable.',
  '**Carga los municipios y localidades** del estado en sus propias listas.',
]);

p('Debajo de cada lista aparece en rojo la clave que el SAT usa internamente. Ese número, no el nombre, es lo que viaja en el XML. Lo mostramos para que puedas verificarlo contra tus documentos.');

box('tip', 'Si tu colonia no está en la lista',
  'Elige la opción "Otra no especificada" al final del desplegable y escribe el nombre a mano. Ocurre con fraccionamientos nuevos que el catálogo del SAT todavía no incorpora.');

h3('Numeración automática de ubicaciones');
p('El SAT pide que cada ubicación lleve un identificador propio. El sistema los genera solo: OR000001 para el primer origen, DE000001 para el primer destino, DE000002 si agregas un segundo destino, y así sucesivamente. No tienes que escribirlos.');

h2('Fecha y hora de salida o llegada');
p('Cada ubicación pide el momento en que la mercancía sale (origen) o llega (destino). El campo está dividido en dos: un calendario para la fecha y un reloj para la hora. Si capturas solo la fecha, el sistema asume las 8:00 de la mañana.');

/* ══════════════════════════════════════════════════════════
   CAP 4 — PLANTILLAS
══════════════════════════════════════════════════════════ */
chapter(4, 'Plantillas: captura en un clic');

p('Las plantillas son el mecanismo que evita volver a teclear datos que ya capturaste antes. Cada uno de los cinco bloques de la Carta Porte tiene un botón Cargar plantilla que abre el catálogo correspondiente.');

h2('Cómo funcionan');
p('El botón abre una ventana con buscador. Escribes parte del nombre, la placa o el RFC, eliges el registro y todos los campos de ese bloque se llenan de golpe. Después puedes ajustar lo que necesites: la plantilla es un punto de partida, no una camisa de fuerza.');

table(
  [ { label: '', w: 34, align: 'center' }, { label: 'Bloque', w: 106 }, { label: 'Botón', w: 116 }, { label: 'Qué llena al elegir', w: W - 256 } ],
  [
    [{ icon: 'pin',    color: '#059669' }, 'Ubicaciones',    'Cargar plantilla',         'RFC, nombre, calle, número, colonia, municipio, localidad, estado, país y código postal.'],
    [{ icon: 'box',    color: '#e11d48' }, 'Mercancías',     'Plantilla de mercancía',   'Clave SAT, descripción, unidad, peso unitario y valor unitario.'],
    [{ icon: 'truck',  color: '#d97706' }, 'Autotransporte', 'Plantilla de vehículo',    'Permiso SCT, número de permiso, configuración, placa, año, peso bruto y aseguradora.'],
    [{ icon: 'shield', color: '#0284c7' }, 'Aseguradora',    'Plantilla de aseguradora', 'Nombre de la aseguradora y número de póliza de responsabilidad civil.'],
    [{ icon: 'driver', color: '#7c3aed' }, 'Figuras',        'Plantilla de operador',    'Tipo de figura, RFC, número de licencia y nombre completo.'],
  ]
);

h2('De dónde salen las plantillas');
p('Hay dos maneras de llenar los catálogos, y ambas alimentan las mismas plantillas:');

h3('1. Capturando a mano');
p('Entra al catálogo desde el menú (Carta Porte, luego Lugares frecuentes, Vehículos, etc.) y pulsa el botón de alta. Es el camino natural cuando das de alta una unidad nueva o contratas un operador.');

h3('2. Importando un XML');
p('Si ya emitiste Cartas Porte antes —con este sistema o con otro— el Lector de XML extrae de esos archivos todos los lugares, vehículos, aseguradoras, operadores y mercancías, y los deja listos como plantillas. Es la forma más rápida de arrancar: un XML de un viaje anterior deja cargado casi todo.');

box('tip', 'Guardar mientras capturas',
  'En el bloque de Ubicaciones hay una casilla "Guardar en Lugares frecuentes". Si la marcas antes de guardar la Carta Porte, esa dirección queda disponible como plantilla para el siguiente viaje sin pasos adicionales.');

h2('Cuando el catálogo está vacío');
p('Si abres una plantilla y no aparece nada, el catálogo todavía no tiene registros. La ventana te lo indica y sugiere importar un XML. No es un error del sistema.');

h2('Campos en verde');
p('En el catálogo de Lugares verás campos con fondo verde suave. Significa que ese dato no venía en el XML del que se importó la dirección y conviene completarlo a mano. Suele pasar con la calle y el número exterior, porque el SAT no los exige en el complemento y muchos emisores los omiten.');

/* ══════════════════════════════════════════════════════════
   CAP 5 — MERCANCÍAS
══════════════════════════════════════════════════════════ */
chapter(5, 'Mercancías transportadas');

box('info', 'No son tus productos',
  'Productos es tu catálogo de venta: lo que facturas. Mercancías es lo que trasladas por encargo de un cliente y no te pertenece. Por eso viven en módulos separados y nunca se mezclan.');

p('Este módulo existe por una razón práctica: durante una inspección en carretera, la autoridad puede pedir el detalle de la carga. Si falta un dato —el peso, la clave del bien, el valor declarado— la multa recae sobre el transportista. Tener el histórico a la mano resuelve la revisión en minutos.');

h2('Las dos pestañas');

h3('Catálogo');
p('Es la lista de mercancías que has transportado alguna vez, sin repeticiones. Cada renglón guarda la clave SAT del bien, su descripción, la unidad de medida, el peso y el valor por unidad, y el cliente para el que se transporta habitualmente. La columna Veces indica cuántos viajes ha hecho esa mercancía: las más frecuentes suben al principio de la lista.');

h3('Bitácora');
p('Es el registro viaje por viaje. Cada renglón corresponde a una mercancía en un traslado concreto, con la fecha, el remitente, el destinatario y el folio fiscal del CFDI que lo ampara. Este es el rastro que se presenta ante una revisión.');

h2('Cómo se llenan');
p('Ambas pestañas se alimentan solas cuando importas un XML con Carta Porte desde el Lector de XML y dejas marcada la casilla de mercancías. El catálogo se actualiza sin duplicar: si la misma mercancía ya existía, solo sube su contador de viajes; si es nueva, se agrega. La bitácora, en cambio, registra siempre el traslado, porque cada viaje es un hecho distinto.');

/* ══════════════════════════════════════════════════════════
   CAP 6 — LECTOR DE XML
══════════════════════════════════════════════════════════ */
chapter(6, 'Lector de XML');

p('El Lector de XML lee cualquier comprobante fiscal y extrae de él los datos que le sirven a tu catálogo. Reconoce el tipo de documento solo, sin que tengas que indicárselo.');

table(
  [ { label: 'Reconoce', w: 190 }, { label: 'Qué extrae', w: W - 190 } ],
  [
    ['CFDI 4.0 de ingreso', 'Emisor, receptor y los conceptos facturados.'],
    ['CFDI + Carta Porte 3.1', 'Además: lugares, vehículos, aseguradoras, operadores y mercancías.'],
    ['CFDI de Nómina 1.2', 'Guarda el comprobante y sus totales para consulta.'],
    ['Complemento de Pagos 2.0', 'Lo identifica y reporta el tipo.'],
    ['Nota de crédito', 'Emisor, receptor y conceptos de la nota.'],
  ]
);

h2('Un solo archivo');
steps([
  'Entra a Lector de XML y arrastra el archivo, o pulsa Elegir archivo.',
  'El sistema analiza el XML y muestra qué encontró, agrupado por tipo de dato.',
  'Revisa las casillas: cada bloque se puede importar o dejar fuera.',
  'Para el emisor y el receptor, decide si cada uno entra como cliente, como proveedor o si no se guarda.',
  'Pulsa Importar todo.',
]);

h2('Varios archivos a la vez');
p('Si eliges entre dos y cinco archivos, el lector cambia a modo lote. Analiza todos, junta los resultados en una sola pantalla y elimina lo repetido entre archivos: si el mismo operador aparece en tres viajes, lo verás una vez.');

p('Antes de mostrarte la lista, el sistema consulta tu base de datos y marca en verde lo que ya tienes registrado, con la leyenda "ya existe". Esos renglones vienen desmarcados para que no los importes por accidente. Los que sí son nuevos vienen marcados y listos para entrar.');

steps([
  'Arrastra de dos a cinco archivos XML.',
  'Pulsa Analizar. El sistema procesa uno por uno y muestra el avance.',
  'Revisa las siete secciones: clientes y proveedores, productos, mercancías, lugares, vehículos, aseguradoras y operadores.',
  'Marca o desmarca lo que quieras. Cada sección tiene un botón para seleccionar todos los nuevos de golpe.',
  'Pulsa Importar lo seleccionado. Al terminar verás cuántos registros se crearon y cuántos se omitieron.',
]);

box('warn', 'Errores frecuentes al importar',
  'El archivo debe ser un XML de CFDI, no un PDF ni un ZIP. Si el comprobante no está timbrado, el lector lo acepta pero avisa que faltan sellos. Si el archivo está dañado o incompleto, aparece en la lista con la marca de error y los demás continúan sin interrumpirse.');

h2('Qué pasa con los duplicados');
p('El sistema nunca crea un registro repetido. Reconoce lo que ya existe por su dato natural: el RFC para clientes y operadores, la placa para vehículos, el número de póliza para aseguradoras, el alias para lugares, y la combinación de clave SAT, descripción y cliente para mercancías. Si algo ya está, lo omite y te lo reporta al final.');

/* ══════════════════════════════════════════════════════════
   CAP 7 — EL PDF
══════════════════════════════════════════════════════════ */
chapter(7, 'El PDF de la factura');

p('Cuando la factura no lleva Carta Porte, el PDF tiene una sola hoja con la información fiscal de siempre. Cuando sí la lleva, se agregan dos hojas más:');

table(
  [ { label: 'Hoja', w: 60, align: 'center' }, { label: 'Contenido', w: W - 60 } ],
  [
    ['1', 'CFDI: emisor, receptor, conceptos, impuestos, totales y timbre fiscal con su código QR.'],
    ['2', 'Complemento Carta Porte: código QR, IdCCP, folio fiscal, y las secciones de autotransporte, aseguradora, vehículo, figuras, ubicaciones y mercancías.'],
    ['3', 'Las catorce cláusulas del contrato de transporte que ampara la Carta Porte.'],
  ]
);

h2('Las claves y sus nombres');
p('En la hoja de Carta Porte, cada clave del SAT aparece acompañada de su significado. Por ejemplo, la ubicación no dice solo "2954" sino "(2954) Ciénega de Flores Centro", y el vehículo no dice solo "C2" sino "(C2) Camión Unitario". Así el documento se puede leer sin tener el catálogo del SAT a la mano.');

h2('El timbre fiscal');
p('Al pie de la primera hoja aparece el bloque del timbre: folio fiscal, fecha de certificación, RFC del proveedor, número de certificado del SAT, los dos sellos digitales completos y la cadena original. A la derecha, el código QR que permite verificar el comprobante en el portal del SAT.');

/* ══════════════════════════════════════════════════════════
   CAP 8 — CONTRATO
══════════════════════════════════════════════════════════ */
chapter(8, 'Contrato y manifiesto');

p('El módulo Contrato reúne dos documentos que se firman en un mismo acto con tu e.firma:');

bullets([
  '**El contrato de servicio con HCGM.** Diez cláusulas que regulan el alcance, la vigencia, el precio, la protección de datos y la jurisdicción.',
  '**El manifiesto ante el PAC.** La autorización que la Resolución Miscelánea Fiscal exige para que el proveedor de certificación pueda timbrar a tu nombre y entregar copia de tus comprobantes al SAT.',
]);

h2('Cómo firmar');
steps([
  'Entra a Contrato desde el menú lateral y lee el documento completo.',
  'Al final encontrarás la sección de firma. Carga tu certificado .cer y tu llave privada .key de la e.firma.',
  'Escribe la contraseña de la e.firma.',
  'Pulsa Aceptar y firmar.',
]);

box('info', 'Tu llave privada no se guarda',
  'Los archivos y la contraseña se usan únicamente para generar la firma en ese momento y se descartan enseguida. El sistema conserva el documento firmado y la firma, nunca tu llave.');

h2('Si el contrato cambia');
p('Cada versión del contrato lleva número y fecha. Las firmas que ya emitiste quedan atadas al texto exacto que firmaste, así que siguen siendo válidas. Si HCGM publica una versión nueva, se te notificará y deberás firmarla para que tu consentimiento corresponda al documento vigente.');

/* ══════════════════════════════════════════════════════════
   CAP 9 — ALMACÉN E INVENTARIOS
══════════════════════════════════════════════════════════ */
chapter(9, 'Almacén e inventarios');

p('El Almacén lleva el control de existencias de lo que compras y vendes. Está conectado con la facturación y con las compras: al timbrar una factura descuenta lo vendido y al recibir una compra lo suma, así el inventario refleja la realidad sin doble captura.');

h2('Existencias y Kardex');
p('En Existencias ves cuánto tienes de cada producto y en qué almacén. El Kardex es el historial de movimientos de un producto —entradas, salidas y ajustes— con su costo, para saber de dónde sale cada cifra. El costeo puede ser promedio, último o por capas, según lo configures.');

h2('Varios almacenes e inventario físico');
p('Puedes dar de alta varios almacenes (matriz, sucursal, bodega) en Almacenes; cada movimiento indica de qué almacén sale o a cuál entra. Para cuadrar contra la realidad, en Inventario físico capturas lo que contaste, el sistema muestra las diferencias contra la existencia teórica y, al confirmar, ajusta y deja el registro.');

box('info', 'Timbrar descuenta, cancelar devuelve',
  'La existencia se mueve con los documentos: al timbrar una factura baja; si cancelas la factura o haces una nota de crédito, la mercancía regresa al almacén. No ajustas a mano.');

/* ══════════════════════════════════════════════════════════
   CAP 10 — COMPRAS Y PROVEEDORES
══════════════════════════════════════════════════════════ */
chapter(10, 'Compras y proveedores');

p('El corazón de Compras es el XML del proveedor: al leer un CFDI recibido, el sistema da de alta al proveedor, sus productos y la entrada al almacén, todo de un tirón. Además genera la cuenta por pagar en Tesorería con los días de crédito del proveedor.');

h2('Recibir un XML de compra');
steps([
  'Entra a Compras y luego a Recibir XML.',
  'Arrastra el CFDI que te envió tu proveedor.',
  'Revisa qué detectó: el proveedor, los productos y las cantidades.',
  'Indica a qué almacén entra cada partida (pueden ir a almacenes distintos) y captura lo que recibiste de verdad.',
  'Confirma. Se registra la entrada al almacén y la cuenta por pagar.',
]);

h2('Órdenes de compra y faltantes');
p('En Órdenes de compra generas pedidos a tus proveedores. La pantalla de Faltantes te avisa qué productos están por debajo de su punto de reorden y proyecta el consumo, para que compres a tiempo. Proveedores es el catálogo con la dirección fiscal, el régimen y el saldo de cada uno.');

/* ══════════════════════════════════════════════════════════
   CAP 11 — PUNTO DE VENTA (POS)
══════════════════════════════════════════════════════════ */
chapter(11, 'Punto de venta (POS)');

p('El Punto de Venta es la pantalla de mostrador: cobro rápido, ticket y corte de caja. Es la más usada del día en una tienda, por eso vive justo debajo del Dashboard en el menú.');

h2('Vender en el mostrador');
steps([
  'Busca cada producto por nombre o código y agrégalo al ticket.',
  'Aplica descuentos si corresponde y elige la forma de pago (efectivo, tarjeta, etc.).',
  'Cobra. La venta descuenta del almacén al instante.',
  'Al cierre del turno, haz el Corte de caja: el sistema cuadra lo cobrado contra lo registrado.',
]);

box('tip', 'Factura global del periodo',
  'Las ventas de mostrador que nadie pidió facturar se agrupan en una factura global timbrada ante el SAT al cierre del periodo. Si un cliente sí pide su factura, se la emites desde el mismo ticket.');

/* ══════════════════════════════════════════════════════════
   CAP 12 — TESORERÍA Y COBRANZA
══════════════════════════════════════════════════════════ */
chapter(12, 'Tesorería y cobranza');

p('Tesorería reúne lo que te deben y lo que debes. Las cuentas por cobrar nacen de tus facturas; las cuentas por pagar, de tus compras, con los días de crédito de cada proveedor. Desde aquí programas pagos y controlas tu línea de crédito.');

h2('Conciliación bancaria');
p('En Contabilidad → Conciliación bancaria subes el estado de cuenta del banco y el sistema lo coteja contra tus movimientos. El botón Conciliar todo sugiere y contabiliza los que empatan, oculta lo ya conciliado y genera un PDF formal de saldos ajustados. Cada banco necesita su cuenta contable ligada.');

box('info', 'La cobranza vive en Facturas',
  'El detalle de cobranza por cliente y el reporte de ventas por período están dentro del módulo de Facturas (Cobranza detallada), porque nacen de lo facturado.');

/* ══════════════════════════════════════════════════════════
   CAP 13 — NÓMINA CFDI 4.0
══════════════════════════════════════════════════════════ */
chapter(13, 'Nómina CFDI 4.0');

p('El módulo de Nómina calcula y timbra los recibos de tus trabajadores. Toma la plantilla de empleados, calcula el ISR con la tarifa y el subsidio del año, las cuotas del IMSS, y emite el CFDI de nómina de cada quien.');

h2('El ciclo de la nómina');
steps([
  'Captura o importa tu plantilla en Empleados.',
  'Verifica los parámetros patronales del ejercicio en Parámetros (UMA, tarifas, cuotas). Sin ellos, la nómina queda bloqueada.',
  'En Nómina (cálculo) arma el periodo: el sistema calcula percepciones, deducciones e ISR.',
  'Revisa la prenómina, ajusta incidencias y genera los recibos.',
  'Timbra los CFDI de nómina y consúltalos en CFDI.',
]);

h2('IMSS, reportes y bajas');
p('En IMSS · IDSE preparas lo que se presenta ante el Seguro Social. Reportes entrega los resúmenes de nómina en Excel y PDF. Cuando das de baja a un trabajador, el sistema arma su finiquito y el documento legal (finiquito, renuncia o liquidación) fundado en la Ley Federal del Trabajo, que acompaña al recibo timbrado.');

/* ══════════════════════════════════════════════════════════
   CAP 14 — CHECADOR · ASISTENCIA
══════════════════════════════════════════════════════════ */
chapter(14, 'Checador · Asistencia biométrica');

p('El Checador registra la asistencia por reconocimiento facial y alimenta la prenómina: las faltas y retardos del periodo se vuelven deducciones sin captura manual. Corre como app instalable (PWA) en tabletas fijas (kiosco) y en celulares (personal en campo, con GPS).');

h2('Cómo se monta (una vez)');
p('El menú del Checador se organiza en tres bloques: Configuración (parámetros, turnos, kioscos, empleados y enrolar rostro), Proceso (abrir kiosco o modo campo) y Reportes (registro de asistencia). Primero fijas la tolerancia de retardo, los turnos y a quién se le registra; luego enrolas el rostro de cada quien.');

h2('El consentimiento del trabajador');
p('El rostro es un dato personal sensible. Al enrolar a un trabajador, él lee y acepta en pantalla el consentimiento —acotado única y exclusivamente al reloj checador— y puede imprimirlo para firma. Hasta que acepta, no se captura su cara. Es voluntario: quien no acepte usa un método alterno.');

box('warn', 'La empresa es la responsable de los rostros',
  'Los datos biométricos los trata la empresa (el patrón) para el control de asistencia. GDM NEXO es solo el proveedor de la tecnología, no el responsable de los datos.');

/* ══════════════════════════════════════════════════════════
   CAP 15 — CONTABILIDAD ELECTRÓNICA
══════════════════════════════════════════════════════════ */
chapter(15, 'Contabilidad electrónica');

p('La Contabilidad genera las pólizas a partir de los CFDI —ingreso, egreso y diario— cuadradas por diseño, y de ahí salen la balanza y los estados financieros. Si tu empresa viene de otro programa, puedes importar tu respaldo para arrancar con tus saldos.');

h2('Catálogo, pólizas y cuadre');
p('El Catálogo de cuentas es un hub con pestañas (catálogo, asignación, auxiliar y cambios de cuenta) donde cada cuenta lleva su agrupador del SAT. En Pólizas están la póliza manual, las de venta, las de compra, todas y las pendientes. Cuadre contable detecta descuadres —casi siempre cuentas sin agrupador— antes de que afecten tus estados.');

h2('Activo fijo, conciliación y cierre');
bullets([
  '**Activo fijo · Depreciación.** Deprecia en línea recta desde el XML de compra y genera su póliza mensual.',
  '**Conciliación bancaria.** Coteja el estado de cuenta contra los movimientos (ver capítulo 12).',
  '**Cierre del ejercicio.** Cierre mensual y anual, con el traspaso de saldos al año nuevo.',
  '**Indicadores.** UMA, tarifas e INPC del periodo, para los cálculos.',
]);

/* ══════════════════════════════════════════════════════════
   CAP 16 — REPORTES FISCALES Y CÉDULAS
══════════════════════════════════════════════════════════ */
chapter(16, 'Reportes fiscales y cédulas');

p('Dentro de Contabilidad → Reportes están los papeles que se presentan o se revisan ante el SAT, agrupados en tres apartados: NIF (estados financieros normados), Estados financieros (contables) y SAT.');

h2('Lo que entrega el apartado SAT');
bullets([
  '**DIOT.** La declaración de operaciones con terceros, con su archivo de carga masiva.',
  '**Contabilidad electrónica.** El XML del catálogo y la balanza (Anexo 24) para el buzón del SAT.',
  '**Cédulas fiscales.** El papel de trabajo mensual de ISR e IVA, calculado desde los CFDI sobre base de flujo. Se muestran todas las cédulas de ISR (612, RESICO 626, PM 601, Plataformas 625) y la de IVA para todos los regímenes; la que corresponde a tu empresa va marcada.',
]);

box('warn', 'Valida el archivo en el portal del SAT',
  'Los archivos de carga (DIOT, contabilidad electrónica) se generan con los datos que capturas; antes de presentarlos, valídalos en el portal oficial del SAT.');

/* ══════════════════════════════════════════════════════════
   CAP 17 — OPINIÓN DE CUMPLIMIENTO 32-D
══════════════════════════════════════════════════════════ */
chapter(17, 'Opinión de cumplimiento (32-D)');

p('En Contabilidad → Reportes → Opinión 32-D registras y das seguimiento a la opinión de cumplimiento de SAT, IMSS e INFONAVIT, además de tu Constancia de Situación Fiscal. La más reciente por dependencia es la vigente y se conserva el histórico, con su PDF.');

h2('Cómo la registras');
steps([
  'Obtén la opinión del portal de cada dependencia (con tu e.firma).',
  'En NEXO, elige la dependencia y pulsa Registrar.',
  'Captura el sentido (positiva, sin adeudos…), la fecha y adjunta el PDF.',
]);

box('tip', 'Asistente del IMSS',
  'La pestaña IMSS trae un asistente que abre el Buzón IMSS oficial y te guía paso a paso (entrar con e.firma, menú 32-D, descargar) para que registres el PDF de un clic.');

/* ══════════════════════════════════════════════════════════
   CAP 18 — XML DEL SAT Y LA BÓVEDA
══════════════════════════════════════════════════════════ */
chapter(18, 'XML del SAT y la bóveda');

p('El módulo XML descarga tus comprobantes directo del SAT con tu e.firma y los guarda en una bóveda que es la fuente de verdad de la contabilidad. Los emitidos y los recibidos se piden por separado, porque responden preguntas distintas: los recibidos son lo que hay que pagar y deducir; los emitidos, la comprobación de lo timbrado.');

h2('Descarga y calendario');
p('La pantalla arranca en la descarga y trae, como pestañas, los Emitidos, los Recibidos y un Calendario de cobertura que muestra qué meses ya están completos y cuáles tienen huecos por llenar. Para un respaldo formal, el super administrador genera un ZIP con los XML de la empresa por rango de fechas (retención SAT de 5 años).');

box('warn', 'Requiere e.firma vigente',
  'La descarga del SAT usa tu e.firma. Si está vencida, el sistema te avisa y no baja comprobantes hasta que la renueves.');

/* ══════════════════════════════════════════════════════════
   CAP 19 — EQUIPO, USUARIOS Y MENSAJERÍA
══════════════════════════════════════════════════════════ */
chapter(19, 'Equipo, usuarios y mensajería');

p('El administrador de la empresa gestiona a su propia gente en Equipo · Usuarios, sin depender de nadie. Cada usuario se da de alta con un rol y un grupo de trabajo que define qué módulos ve: Ventas ve facturas y Carta Porte, Almacén ve existencias, Tesorería ve pagos, y así.');

h2('Alta de un usuario');
steps([
  'Entra a Equipo · Usuarios y pulsa Nuevo usuario.',
  'Captura nombre, correo, una contraseña temporal, el rol y el grupo de trabajo.',
  'Al crearlo, si es operativo, se abre enseguida su sección de capacidades finas para afinar exactamente qué puede hacer.',
]);

box('info', 'Mensajería interna',
  'El menú Mensajes es el recadero interno de la empresa: avisos entre el administrador y su equipo, con un contador de no leídos en el menú.');

/* ══════════════════════════════════════════════════════════
   CAP 20 — PREGUNTAS FRECUENTES
══════════════════════════════════════════════════════════ */
chapter(20, 'Preguntas frecuentes');

const faq = [
  ['El icono del barco está gris y no puedo pulsarlo',
   'La factura ya está timbrada. La Carta Porte debe capturarse antes del timbrado porque viaja dentro del XML sellado. Si necesitas agregarla, cancela la factura y emite una nueva.'],
  ['Escribí el código postal pero no aparecen colonias',
   'Ese código postal no está en el catálogo del SAT que tiene cargado el sistema, o lo escribiste incompleto. Verifica los cinco dígitos. Si es correcto y aun así no aparece, captura la colonia a mano.'],
  ['El botón de plantilla no muestra nada',
   'El catálogo está vacío. Da de alta el primer registro desde el menú de Carta Porte, o importa un XML anterior con el Lector de XML.'],
  ['Cambié el precio de un producto pero no se guardó',
   'Asegúrate de pulsar Guardar cambios al final del formulario. Si el problema persiste, avisa a soporte indicando el SKU del producto.'],
  ['No puedo timbrar: dice que falta el manifiesto',
   'Entra a DATOS DE MI EMPRESA y firma el manifiesto ante el PAC con tu e.firma. Es un requisito del SAT y solo se hace una vez.'],
  ['El correo no sale',
   'Revisa la configuración SMTP en DATOS DE MI EMPRESA y usa el botón de correo de prueba. Si usas Gmail, necesitas una contraseña de aplicación, no tu contraseña normal.'],
  ['Importé un XML y dice que todo ya existía',
   'Es el comportamiento correcto: el sistema no duplica registros. Los renglones en verde con la leyenda "ya existe" indican que ese dato ya estaba en tu catálogo.'],
  ['La factura salió con un dato equivocado',
   'Si aún es borrador, edítala. Si ya está timbrada, cancélala y emite una nueva. El SAT no permite modificar un comprobante certificado.'],
  ['No veo un módulo que sé que existe',
   'Tu menú muestra solo los módulos de tu grupo de trabajo. Si necesitas otro, pídele al administrador de tu empresa que te lo habilite en Equipo · Usuarios.'],
  ['La nómina no me deja calcular',
   'Falta capturar los parámetros patronales del ejercicio (UMA, tarifas y cuotas) en Nómina → Parámetros. Sin ellos, el módulo queda bloqueado.'],
  ['El checador no reconoce a un trabajador',
   'Verifica que haya aceptado el consentimiento y que su rostro esté enrolado en Checador → Enrolar rostro. Sin enrolamiento, el kiosco no puede identificarlo.'],
  ['El balance no cuadra',
   'Casi siempre es una cuenta sin agrupador del SAT. La pantalla Contabilidad → Cuadre contable te indica cuál es.'],
  ['La descarga del SAT no baja nada',
   'Revisa que tu e.firma esté vigente. La descarga del XML del SAT y la contabilidad la usan; si venció, el sistema lo avisa y no baja comprobantes.'],
];

faq.forEach(([q, a]) => {
  needSpace(80);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY)
     .text(q, M, doc.y, { width: W });
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(9.5).fillColor(GRAY)
     .text(a, M + 12, doc.y, { width: W - 12, align: 'justify', lineGap: 1.5 });
  doc.moveDown(0.8);
});

h2('Soporte');
p('Para cualquier duda que no resuelva este manual, escribe a info@hcgm.com.mx indicando tu RFC y, si aplica, el folio de la factura involucrada.');

/* ══════════════════════════════════════════════════════════
   ÍNDICE + PIE DE PÁGINA
══════════════════════════════════════════════════════════ */
const range = doc.bufferedPageRange();

// Rellenar índice
doc.switchToPage(tocPageIndex);
doc.y = M + 60;
// Solo capítulos (nivel 1): con 20 capítulos, un índice por capítulos cabe
// completo y limpio en una página; meter también los subtítulos lo desbordaría
// y se perderían entradas al final.
toc.filter(t => t.nivel === 1).forEach(t => {
  if (doc.y > doc.page.height - 90) return;
  const isCap = t.nivel === 1;
  doc.font(isCap ? 'Helvetica-Bold' : 'Helvetica')
     .fontSize(isCap ? 11 : 9.5)
     .fillColor(isCap ? NAVY_DARK : GRAY);
  const x = M + (isCap ? 0 : 16);
  const label = t.titulo;
  const yLine = doc.y;
  doc.text(label, x, yLine, { width: W - 44, continued: false });
  // puntos guía
  const wLabel = doc.widthOfString(label);
  const dotsFrom = x + Math.min(wLabel, W - 60) + 6;
  const dotsTo = M + W - 22;
  if (dotsTo > dotsFrom) {
    doc.font('Helvetica').fontSize(8).fillColor(GRAY_LIGHT);
    let dx = dotsFrom;
    let dots = '';
    while (dx < dotsTo) { dots += '.'; dx += 2.4; }
    doc.text(dots, dotsFrom, yLine + (isCap ? 2 : 1), { width: dotsTo - dotsFrom, lineBreak: false });
  }
  doc.font(isCap ? 'Helvetica-Bold' : 'Helvetica').fontSize(isCap ? 10 : 9).fillColor(isCap ? NAVY : GRAY);
  doc.text(String(t.pagina), M + W - 20, yLine + (isCap ? 1 : 0), { width: 20, align: 'right', lineBreak: false });
  doc.moveDown(isCap ? 0.55 : 0.35);
});

// Pie en todas menos portada.
// CLAVE: el pie se dibuja en el área del margen inferior. Si no se baja el margen
// a 0, PDFKit cree que el texto se sale de la hoja y AGREGA una página nueva por
// cada pie (así se colaban ~36 páginas fantasma). Se pone el margen en 0 mientras
// se dibuja y se restaura enseguida.
for (let i = 1; i < range.count; i++) {
  doc.switchToPage(i);
  const _mb = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  const yF = doc.page.height - 46;
  doc.moveTo(M, yF).lineTo(M + W, yF).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
  doc.font('Helvetica').fontSize(7.5).fillColor(GRAY_LIGHT)
     .text('GDM NEXO · Manual de Usuario', M, yF + 6, { width: W / 2, lineBreak: false });
  // Número de página SIEMPRE al pie, alineado a la derecha.
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY)
     .text(`Página ${i + 1} de ${range.count}`, M + W / 2, yF + 6,
           { width: W / 2, align: 'right', lineBreak: false });
  doc.page.margins.bottom = _mb;
}

doc.end();
console.log(`✔ Manual generado: ${OUT}`);
console.log(`  ${range.count} páginas · ${toc.filter(t => t.nivel === 1).length} capítulos`);
