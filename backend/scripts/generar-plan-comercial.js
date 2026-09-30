#!/usr/bin/env node
/**
 * generar-plan-comercial.js — Plan comercial de GDM NEXO en PDF.
 * Precio por usuario + comparación de mercado + estrategia de introducción +
 * aumentos por inflación (INPC) + reglas de facturación.  Uso: node scripts/generar-plan-comercial.js
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', '..', 'docs', 'PLAN_COMERCIAL_NEXO.pdf');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const NAVY = '#1e3a8a', NAVY_DARK = '#0f172a', GOLD = '#d4a574', GRAY = '#475569', GRAY_L = '#94a3b8', SOFT = '#f1f5f9', GREEN = '#059669';
const M = 54, W = 595.28 - M * 2;
const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: 'Plan comercial · GDM NEXO', Author: 'GRUPO HCGM S.A. DE C.V.' } });
doc.pipe(fs.createWriteStream(OUT));

function need(pts) { if (doc.y + pts > doc.page.height - 70) doc.addPage(); }
function h1(t, sub) {
  need(70); doc.rect(M, doc.y, 44, 4).fill(GOLD); doc.y += 12;
  doc.font('Helvetica-Bold').fontSize(19).fillColor(NAVY_DARK).text(t, M, doc.y, { width: W });
  if (sub) { doc.moveDown(0.15); doc.font('Helvetica').fontSize(10).fillColor(GRAY).text(sub, { width: W }); }
  doc.moveDown(0.6);
}
function h2(t) { need(46); doc.moveDown(0.3); doc.font('Helvetica-Bold').fontSize(12.5).fillColor(NAVY).text(t, M, doc.y, { width: W }); doc.moveDown(0.3); }
function p(t, o = {}) { need(38); doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size || 10).fillColor(o.color || GRAY).text(t, M + (o.indent || 0), doc.y, { width: W - (o.indent || 0), align: o.align || 'left', lineGap: 1.6 }); doc.moveDown(o.gap ?? 0.4); }
function bullets(items) { items.forEach((it) => { need(24); const x = M + 10; doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('•', x, doc.y, { width: 12, continued: false }); const y = doc.y - doc.currentLineHeight(); const m = it.match(/^\*\*(.+?)\*\*\s*(.*)$/s); if (m) { doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY_DARK).text(m[1], x + 14, y, { width: W - 26, continued: true }); doc.font('Helvetica').fillColor(GRAY).text(m[2] ? ' ' + m[2] : '', { width: W - 26 }); } else { doc.font('Helvetica').fontSize(10).fillColor(GRAY).text(it, x + 14, y, { width: W - 26, lineGap: 1.4 }); } doc.moveDown(0.2); }); doc.moveDown(0.25); }
function box(title, text, color = GREEN, bg = '#f0fdf4') { doc.font('Helvetica').fontSize(9.5); const h = doc.heightOfString(text, { width: W - 28, lineGap: 1.4 }) + 30; need(h + 8); const y0 = doc.y; doc.roundedRect(M, y0, W, h, 6).fill(bg); doc.rect(M, y0, 4, h).fill(color); doc.font('Helvetica-Bold').fontSize(10).fillColor(color).text(title, M + 16, y0 + 9, { width: W - 28 }); doc.font('Helvetica').fontSize(9.5).fillColor(GRAY).text(text, M + 16, doc.y + 1, { width: W - 28, lineGap: 1.4 }); doc.y = y0 + h + 8; }
function table(cols, rows) {
  const tw = cols.reduce((a, c) => a + c.w, 0); need(30 + rows.length * 18);
  const head = (yy) => { doc.rect(M, yy, tw, 19).fill(NAVY); let x = M; doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff'); cols.forEach((c) => { doc.text(c.label, x + 6, yy + 5.5, { width: c.w - 10, align: c.align || 'left', lineBreak: false }); x += c.w; }); return yy + 19; };
  let y = head(doc.y);
  rows.forEach((r, i) => { let mh = 18; cols.forEach((c, j) => { const hh = doc.font('Helvetica').fontSize(8.5).heightOfString(String(r[j] ?? ''), { width: c.w - 10 }); if (hh + 8 > mh) mh = hh + 8; }); if (y + mh > doc.page.height - 70) { doc.addPage(); y = head(doc.y); } if (i % 2 === 0) doc.rect(M, y, tw, mh).fill(SOFT); let x = M; cols.forEach((c, j) => { doc.font(j === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(j === 0 ? NAVY_DARK : GRAY).text(String(r[j] ?? ''), x + 6, y + 5, { width: c.w - 10, align: c.align || 'left' }); x += c.w; }); y += mh; });
  doc.y = y + 10;
}

/* ── Portada ── */
doc.rect(0, 0, 595.28, 200).fill(NAVY_DARK);
doc.circle(500, 60, 150).fillOpacity(0.06).fill(GOLD).fillOpacity(1);
doc.font('Helvetica-Bold').fontSize(26).fillColor('#fff').text('Plan comercial', M, 60, { width: W });
doc.font('Helvetica').fontSize(15).fillColor(GOLD).text('GDM NEXO · ERP CFDI 4.0', M, 96);
doc.font('Helvetica').fontSize(9.5).fillColor('#cbd5e1').text('Precio por usuario · Comparación de mercado · Estrategia de introducción · Aumentos por inflación', M, 126, { width: W });
doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(`GRUPO HCGM, S.A. DE C.V. · ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}`, M, 160);
doc.y = 224;

/* ── 1. Precio ── */
h1('1 · Precio: por usuario, plano', 'La misma tarifa para una empresa de 1 usuario o de 100 (sin descuentos por tamaño). Los timbres incluidos crecen con tus usuarios.');
table([{ label: 'Concepto', w: 300 }, { label: 'Valor', w: W - 300 }], [
  ['Usuario facturable (cualquier rol)', '$750 / mes'],
  ['Checador (kioscos + celulares)', '$0 — gratis, ilimitados'],
  ['Timbres incluidos', '1,000 / mes base · +500 por cada usuario adicional'],
  ['Timbre extra (excedente, +IVA)', 'desde $1.30 (1 usuario) · +$0.20 por usuario'],
]);
box('Fórmula de la renta mensual', 'Renta = $750 × (usuarios facturables) + (timbres por encima de los incluidos × el precio del timbre de tu nivel). Timbres incluidos = 1,000 + 500 × (usuarios − 1). Los checadores no suman.', NAVY, '#eff6ff');

h2('Rango por usuario');
table([{ label: 'Usuarios', w: 130, align: 'right' }, { label: 'Renta/mes', w: 150, align: 'right' }, { label: 'Anual (−16%)', w: W - 280, align: 'right' }], [
  ['1', '$750', '$630'], ['2', '$1,500', '$1,260'], ['3', '$2,250', '$1,890'], ['4', '$3,000', '$2,520'],
  ['5', '$3,750', '$3,150'], ['6', '$4,500', '$3,780'], ['8', '$6,000', '$5,040'], ['10', '$7,500', '$6,300'],
  ['N', '$750 × N', '$630 × N'],
]);

h2('Timbres incluidos y excedente por nivel');
table([{ label: 'Usuarios', w: 130, align: 'right' }, { label: 'Timbres incluidos', w: 170, align: 'right' }, { label: 'Timbre extra (+IVA)', w: W - 300, align: 'right' }], [
  ['1', '1,000', '$1.30'], ['2', '1,500', '$1.50'], ['3', '2,000', '$1.70'], ['4', '2,500', '$1.90'],
  ['5', '3,000', '$2.10'], ['6', '3,500', '$2.30'], ['8', '4,500', '$2.70'], ['10', '5,500', '$3.10'],
  ['N', '1,000 + 500×(N−1)', '$1.30 + $0.20×(N−1)'],
]);
p('Entre más usuarios, más timbres incluidos (+500 por usuario), así que es menos probable que pagues excedente. El timbre extra sube por nivel; los incluidos se reinician el día 30 y no se acumulan.', { size: 9 });

/* ── 2. Mercado ── */
h1('2 · Comparación de mercado (2026)', 'Precios de referencia en México (MXN/mes, sin IVA).');
table([{ label: 'Producto', w: 150 }, { label: 'Modelo', w: 110 }, { label: 'Precio/mes', w: 100 }, { label: 'Qué cubre', w: W - 360 }], [
  ['Bind ERP', 'Por plan', '$570 – $1,700', 'ERP PyME (3 usuarios base)'],
  ['Alegra Contab.', 'Por plan', '$499 – $1,999', 'Contab + factura + POS (2–5 usuarios)'],
  ['Alegra Factura', 'Por plan', '$138 – $599', 'Solo facturación'],
  ['CONTPAQi nube', 'Por sistema', '$390 – $590 c/u', 'Se suman: Contabiliza, Vende, Personia'],
]);
p('No es manzana con manzana: Bind y Alegra cobran POR PLAN (2–5 usuarios incluidos) y CONTPAQi POR SISTEMA (se apilan). NEXO cobra por usuario. La medida justa no es el precio por asiento, sino qué obtiene UNA persona por su dinero.', { size: 9.5 });
box('Un usuario = todo el ERP', 'Con NEXO, un solo usuario ($750) tiene factura + almacén + compras + tesorería + nómina + contabilidad + carta porte + POS + checador facial GRATIS + 1,000 timbres. Igualarlo con CONTPAQi (Contabiliza + Vende + Personia) cuesta ~$1,470 en 3 sistemas sueltos, y aun así SIN checador ni carta porte. Ese "todo en un asiento" no lo tiene ningún competidor.', GOLD, '#fffbeb');
box('¿Se puede competir a $750? Sí — y dónde (honesto)', 'GANAS en micro-PyME y en consolidación: quien hoy paga 2–3 suscripciones sueltas (facturador + contable + nómina) reemplaza todo por un asiento de $750, con MENOR costo total. El pitch es «un usuario = todo el ERP, reemplaza 3 suscripciones», no «asiento barato». Donde el por-usuario pesa es en equipos grandes con gente que usa UN solo módulo; ahí se compite por valor (consolidación + checador gratis + profundidad fiscal MX), y queda como palanca a futuro un asiento «operativo» más barato junto al «full» de $750 (no ahora).', NAVY, '#eff6ff');

/* ── 3. Estrategia ── */
h1('3 · Estrategia de introducción al mercado');
h2('Fase 0 · Alistar');
bullets(['Cerrar contabilidad al 100 % (es la pieza más vendible frente a CONTPAQi).', '2–3 empresas piloto → un caso de éxito con números reales.']);
h2('Fase 1 · Lanzamiento con gancho (mes 1–3)');
bullets(['**Migración GRATIS desde CONTPAQi / Aspel** — ya tienes el importador; quita el miedo a cambiarse.', '**Precio de lanzamiento congelado 12 meses:** quien entre en el trimestre de lanzamiento no sube por inflación el primer año.', '**Prueba gratis 15–30 días** sin tarjeta. Meta: conseguir logos, no margen.']);
h2('Fase 2 · Canal de contadores (mes 3–9)');
bullets(['El contador maneja muchas PyMEs: es el multiplicador (así crecieron Alegra y Contalink).', 'Cuenta multi-empresa con descuento + comisión por cada cliente que traiga.']);
h2('Fase 3 · Nichos y escala (mes 9+)');
bullets(['Transportistas → Carta Porte 3.1 multimodal.', 'Comercios → POS + checador facial gratis.', 'Programa de referidos cliente-trae-cliente.']);
box('Diferenciadores de venta', '1) Todo en uno, un solo precio por usuario. 2) Checador facial GRATIS (nadie más). 3) Timbres incluidos que crecen con tus usuarios (1,000 → 5,500). 4) Migración sin costo desde tu sistema actual.', NAVY, '#eff6ff');

/* ── 4. Inflación + facturación ── */
h1('4 · Aumentos por inflación (INPC)');
box('Regla', 'Cada 1.º de enero el precio sube el % del INPC (INEGI) del año anterior, avisado con 30–60 días. Es un índice público, no un capricho — y NEXO ya lo trae automático de la API de INEGI.', GREEN);
table([{ label: 'Año', w: 90 }, { label: 'Usuario/mes', w: 120, align: 'right' }, { label: 'Timbre extra (1 usr)', w: 130, align: 'right' }, { label: 'Timbres incl. (1 usr)', w: W - 340, align: 'right' }], [
  ['2026 (lanz.)', '$750', '$1.30', '1,000'], ['2027', '~$785', '~$1.36', '1,000'], ['2028', '~$820', '~$1.42', '1,000'],
  ['2029', '~$855', '~$1.48', '1,000'], ['2030', '~$895', '~$1.55', '1,000'],
]);
p('(Estimando INPC ~4.5 %/año; se ajusta al dato real de INEGI cada año. La tabla es el nivel base de 1 usuario: los timbres incluidos crecen +500 por usuario y el timbre extra sube +$0.20 por usuario. Cliente de lanzamiento: su 1.er año no sube. Cliente anual: tarifa fija hasta su renovación.)', { size: 9 });

h1('5 · Reglas de facturación (super admin)');
bullets([
  'El **super administrador solo da de alta empresas**; cada empresa genera sus usuarios.',
  '**Lista de cobro el día 30:** por empresa, $750 × usuarios facturables (sin checador) + excedente de timbres.',
  '**Prorrateo:** a quien entra después del día 1 se le cobra proporcional a los días del mes.',
  '**Prepago:** se cobra por adelantado. Las facturas salen el día 1.',
  '**Corte del servicio el día 5** si no paga (suspende el acceso de la empresa; al pagar se reactiva sola).',
  '**Conteo de timbres** vía SW: incluidos = 1,000 + 500 por usuario; del excedente se cobra el timbre de tu nivel ($1.30 con 1 usuario, hasta $3.10 con 10).',
]);

/* ── Pie ── */
const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(i);
  const mb = doc.page.margins.bottom; doc.page.margins.bottom = 0;
  const yF = doc.page.height - 40;
  doc.font('Helvetica').fontSize(7.5).fillColor(GRAY_L).text('GDM NEXO · Plan comercial · GRUPO HCGM', M, yF, { width: W / 2, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text(`Página ${i + 1} de ${range.count}`, M + W / 2, yF, { width: W / 2, align: 'right', lineBreak: false });
  doc.page.margins.bottom = mb;
}
doc.end();
doc.on('end', () => {});
console.log(`OK: ${OUT} · ${range.count} páginas`);
