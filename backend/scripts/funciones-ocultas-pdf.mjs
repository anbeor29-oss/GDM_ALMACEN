/**
 * Genera el PDF «Funciones ocultas / retiradas» de GDM NEXO (pdfkit).
 * Es el inventario de pantallas, botones y pestañas que se OCULTARON o QUITARON
 * del menú para aligerar el programa — con DÓNDE están en el código y CÓMO
 * reactivarlas (casi todas son reversibles con quitar un `false &&`).
 *
 * Uso: node scripts/funciones-ocultas-pdf.mjs [ruta_salida.pdf]
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';

const SALIDA = process.argv[2] || 'Funciones_ocultas_NEXO.pdf';

const AZUL = '#b91c1c';      // rojo-700 (tema del documento: lo oculto/retirado)
const AZULOSC = '#7f1d1d';
const GRIS = '#4b5563';
const GRISCLARO = '#6b7280';
const FONDO = '#fef2f2';     // rose-50

const doc = new PDFDocument({ size: 'LETTER', margin: 54, bufferPages: true });
doc.pipe(fs.createWriteStream(SALIDA));

const M = 54;
const W = doc.page.width - M * 2;
const bottom = () => doc.page.height - M - 24;
function salto(alto) { if (doc.y + alto > bottom()) doc.addPage(); }
function h1(txt) {
  salto(40); doc.moveDown(0.3);
  doc.fillColor(AZULOSC).font('Helvetica-Bold').fontSize(16).text(txt, { width: W });
  const y = doc.y + 3;
  doc.moveTo(M, y).lineTo(M + W, y).strokeColor(AZUL).lineWidth(1.5).stroke();
  doc.moveDown(0.6);
}
function p(txt) {
  salto(16);
  doc.fillColor(GRIS).font('Helvetica').fontSize(10).text(txt, { width: W, lineGap: 1.5 });
  doc.moveDown(0.25);
}
function bullet(txt) {
  salto(16); const x = M + 12;
  doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(10).text('•', M + 2, doc.y, { continued: false, width: 10 });
  doc.moveUp();
  doc.fillColor(GRIS).font('Helvetica').fontSize(10).text(txt, x, doc.y, { width: W - 12, lineGap: 1 });
  doc.moveDown(0.15);
}
function nota(txt) {
  salto(40); const yIni = doc.y;
  const alto = doc.heightOfString(txt, { width: W - 24, lineGap: 1.5 }) + 16;
  doc.roundedRect(M, yIni, W, alto, 6).fill(FONDO);
  doc.fillColor(AZULOSC).font('Helvetica-Oblique').fontSize(9.5).text(txt, M + 12, yIni + 8, { width: W - 24, lineGap: 1.5 });
  doc.y = yIni + alto + 6;
}
/* Tarjeta de una función oculta: título + metadatos (dónde / cómo volver) */
function item({ titulo, donde, porque, volver }) {
  salto(70);
  doc.moveDown(0.2);
  doc.fillColor(AZULOSC).font('Helvetica-Bold').fontSize(12).text(titulo, { width: W });
  doc.moveDown(0.15);
  const meta = (etq, val) => {
    salto(16);
    const x = M + 2;
    doc.fillColor(AZUL).font('Helvetica-Bold').fontSize(8.5).text(etq.toUpperCase(), x, doc.y, { width: 70, continued: true, characterSpacing: 0.4 });
    doc.fillColor(GRIS).font('Helvetica').fontSize(9.5).text('  ' + val, { width: W - 72, lineGap: 1.2 });
    doc.moveDown(0.1);
  };
  if (porque) meta('Qué era', porque);
  if (donde) meta('Dónde', donde);
  if (volver) meta('Cómo volver', volver);
  doc.moveDown(0.35);
}

/* ── Portada ── */
doc.rect(0, 0, doc.page.width, 190).fill(AZULOSC);
doc.fillColor('#fecaca').font('Helvetica-Bold').fontSize(11).text('GDM NEXO', M, 54, { characterSpacing: 1 });
doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(29).text('Funciones ocultas', M, 84, { width: W });
doc.fillColor('#fca5a5').font('Helvetica-Bold').fontSize(16).text('Pantallas y botones retirados del menú para aligerar el programa', M, 122, { width: W });
doc.fillColor('#fecaca').font('Helvetica').fontSize(10).text('Qué se ocultó, por qué, dónde está en el código y cómo reactivarlo.', M, 158, { width: W });
doc.y = 215;

p('Para que NEXO se sienta más ligero y claro, se OCULTARON varias pantallas, pestañas y botones que estaban duplicados o que ya no son el camino principal. NINGUNA función se perdió: el código sigue ahí, sólo dejó de mostrarse. Este documento las lista para que las reconozcas y, si alguna hiciera falta, se reactive en segundos.');
nota('Casi todas se ocultaron envolviéndolas en un «{false && … }» en el código del front. Para que vuelvan a aparecer basta con quitar ese «false &&» (o invertir el filtro) en el archivo indicado y regenerar el ZIP del front. No hay que reescribir nada.');

h1('Contabilidad — Catálogo y Pólizas');
item({
  titulo: 'Pólizas de venta / Pólizas de compra (pantallas separadas)',
  porque: 'Dos pantallas aparte para contabilizar ventas y compras.',
  donde: 'Se consolidaron en el HUB de pestañas de «Pólizas» (Ventas · Compras · Pagos · Depreciaciones · Nómina · Libro diario). PolizasLista.tsx.',
  volver: 'No hace falta: todo vive ahora en «Pólizas» por pestañas. Se dejaron ocultas sólo para no duplicar.',
});
item({
  titulo: '«Reconstruir todos los ejercicios» (tarjeta suelta)',
  porque: 'Tarjeta independiente en «Importar respaldo» para recuadrar toda la historia.',
  donde: 'ImportarContpaqi.tsx — ahora aparece DENTRO de la pantalla verde de resultados, justo después de importar (respaldo y Contalink).',
  volver: 'La acción no se perdió: está en la pantalla verde del import. La tarjeta suelta está comentada en ImportarContpaqi.tsx.',
});
item({
  titulo: '«Reorganizar terceros» (botón del Catálogo)',
  porque: 'Movía clientes/proveedores mezclados a su control correcto (105 / 201) y los renumeraba.',
  donde: 'CatalogoCuentas.tsx (envuelto en «false &&»). La universalidad parte de un RESPALDO contable, no de reacomodar terceros.',
  volver: 'Quitar el «false &&» que envuelve el botón «Reorganizar terceros».',
});
item({
  titulo: 'Panel «Respaldo de balanza / Catálogos» (PanelAnalisis)',
  porque: 'Segundo panel a la derecha del Catálogo con análisis del respaldo de balanza.',
  donde: 'CatalogoCuentas.tsx — «{false && <PanelAnalisis />}». El catálogo ahora ocupa todo el ancho.',
  volver: 'Quitar el «false &&» antes de <PanelAnalisis /> (y el grid vuelve a 2 columnas).',
});
item({
  titulo: 'Asignación de cuentas — pestañas «Clientes» y «Proveedores»',
  porque: 'Dos pestañas más en «Asignación de cuentas».',
  donde: 'AsignacionCuentas.tsx — se ocultaron temporalmente (conjunto OCULTAS) para medir qué tanto afectan.',
  volver: 'Vaciar el Set OCULTAS (o quitar \'clientes\'/\'proveedores\' de él).',
});

h1('Tesorería');
item({
  titulo: '«Cobros y pagos» (pestaña de Tesorería)',
  porque: 'Pestaña que mostraba PolizasCobroPago.',
  donde: 'Treasury.tsx — era un DUPLICADO del hub de «Pólizas» (pestañas Pagos de ventas / Pago de compras). Se quitó y se reordenaron las pestañas a: Bancos · Cuentas por pagar · Pagos programados.',
  volver: 'Reponer la pestaña \'cobrospagos\' en el arreglo de tabs y volver a importar/renderizar PolizasCobroPago. (No recomendado: duplica el hub.)',
});

h1('Súper Admin — Facturación de la plataforma');
item({
  titulo: '«Contratar un paquete» / «Accesos por empresa» (prepago)',
  porque: 'Venta de paquetes de timbres prepago y accesos por empresa.',
  donde: 'AdminPromocion / sección de paquetes. El cobro es por USUARIO ($750/usuario, checador gratis, 2000 timbres/mes), no por paquete.',
  volver: 'Decisión de negocio: el modelo es por usuario. Reactivar sólo si se vuelve al prepago.',
});
item({
  titulo: '«Prueba de cortesía» (prueba gratis manual)',
  porque: 'Alta de una prueba gratis a mano desde Súper Admin.',
  donde: 'AdminPromocion.tsx — se quitó: las pruebas van por el autoregistro público (prueba 72 h) definido en onboarding.',
  volver: 'Decisión de negocio; el onboarding público ya cubre la prueba.',
});
item({
  titulo: '«Paquetes de uso» → renombrado «Respaldos»',
  porque: 'La sección de Súper Admin «Paquetes de uso».',
  donde: 'Se renombró a «Respaldos» (conserva el Respaldo SAT en ZIP). No es una ocultación: es un cambio de nombre y enfoque.',
  volver: 'N/A (cambio de nombre).',
});

h1('Cumplimiento fiscal');
item({
  titulo: 'Hub «Cumplimiento fiscal» (ServiciosSat)',
  porque: 'Pantalla hub con 32-D / CIF / IMSS / INFONAVIT y las consultas al SAT.',
  donde: 'Se ELIMINÓ (se borró ServiciosSat.tsx) y todo se consolidó en el «Panel fiscal»; las rutas viejas redirigen ahí.',
  volver: 'No aplica: su funcionalidad vive completa en el Panel fiscal (opiniones + consultas en ventanas emergentes).',
});
item({
  titulo: 'JSON crudo de las respuestas del SAT',
  porque: 'Volcado del JSON técnico de cada consulta.',
  donde: 'CumplimientoPaneles.tsx — queda disponible para quien lo necesite, pero oculto en la vista normal.',
  volver: 'Está accesible para soporte; no estorba al usuario final.',
});

doc.moveDown(0.5);
nota('Resumen: lo retirado es duplicado (Cobros y pagos, Pólizas de venta/compra), decisión de negocio (paquetes prepago, prueba de cortesía) o consolidación (Cumplimiento fiscal → Panel fiscal; Reconstruir → pantalla verde del import). Nada se borró del motor: reactivar lo reversible es quitar un «false &&» y regenerar el ZIP del front.');

/* ── Pie de página con numeración ── */
const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(range.start + i);
  doc.fillColor(GRISCLARO).font('Helvetica').fontSize(8)
    .text(`GDM NEXO · Funciones ocultas · ${new Date().toLocaleDateString('es-MX')}`, M, doc.page.height - M - 14, { width: W - 60 });
  doc.text(`${i + 1} / ${range.count}`, M + W - 60, doc.page.height - M - 14, { width: 60, align: 'right' });
}

doc.end();
console.log('PDF generado:', SALIDA);
