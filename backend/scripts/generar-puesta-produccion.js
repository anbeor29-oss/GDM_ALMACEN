#!/usr/bin/env node
/**
 * generar-puesta-produccion.js — Runbook: activar el timbrado REAL (SW Sapien).
 * Uso: node scripts/generar-puesta-produccion.js
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', '..', 'docs', 'PUESTA_EN_PRODUCCION_TIMBRADO.pdf');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const NAVY = '#1e3a8a', NAVY_DARK = '#0f172a', GOLD = '#d4a574', GRAY = '#475569', GRAY_L = '#94a3b8', SOFT = '#f1f5f9', ROSE = '#e11d48';
const M = 54, W = 595.28 - M * 2;
const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: 'Puesta en producción del timbrado · GDM NEXO', Author: 'GRUPO HCGM S.A. DE C.V.' } });
doc.pipe(fs.createWriteStream(OUT));

function need(pts) { if (doc.y + pts > doc.page.height - 70) doc.addPage(); }
function h2(t) { need(46); doc.moveDown(0.4); doc.rect(M, doc.y + 2, 4, 15).fill(GOLD); doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY_DARK).text('  ' + t, M, doc.y, { width: W }); doc.moveDown(0.35); }
function p(t, o = {}) { need(34); doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size || 10).fillColor(o.color || GRAY).text(t, M + (o.indent || 0), doc.y, { width: W - (o.indent || 0), lineGap: 1.6 }); doc.moveDown(o.gap ?? 0.4); }
function bullets(items) { items.forEach((it) => { need(22); const x = M + 10; doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('•', x, doc.y, { width: 12 }); const y = doc.y - doc.currentLineHeight(); const m = it.match(/^\*\*(.+?)\*\*\s*(.*)$/s); if (m) { doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY_DARK).text(m[1], x + 14, y, { width: W - 26, continued: true }); doc.font('Helvetica').fillColor(GRAY).text(m[2] ? ' ' + m[2] : '', { width: W - 26 }); } else { doc.font('Helvetica').fontSize(10).fillColor(GRAY).text(it, x + 14, y, { width: W - 26, lineGap: 1.4 }); } doc.moveDown(0.2); }); doc.moveDown(0.2); }
function box(title, text, color, bg) { doc.font('Helvetica').fontSize(9.5); const h = doc.heightOfString(text, { width: W - 28, lineGap: 1.4 }) + 30; need(h + 8); const y0 = doc.y; doc.roundedRect(M, y0, W, h, 6).fill(bg); doc.rect(M, y0, 4, h).fill(color); doc.font('Helvetica-Bold').fontSize(10).fillColor(color).text(title, M + 16, y0 + 9, { width: W - 28 }); doc.font('Helvetica').fontSize(9.5).fillColor(GRAY).text(text, M + 16, doc.y + 1, { width: W - 28, lineGap: 1.4 }); doc.y = y0 + h + 8; }
function table(cols, rows) { const tw = cols.reduce((a, c) => a + c.w, 0); need(30 + rows.length * 20); const head = (yy) => { doc.rect(M, yy, tw, 19).fill(NAVY); let x = M; doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff'); cols.forEach((c) => { doc.text(c.label, x + 6, yy + 5.5, { width: c.w - 10, lineBreak: false }); x += c.w; }); return yy + 19; }; let y = head(doc.y); rows.forEach((r, i) => { let mh = 20; cols.forEach((c, j) => { const hh = doc.font('Helvetica').fontSize(8.5).heightOfString(String(r[j] ?? ''), { width: c.w - 10 }); if (hh + 8 > mh) mh = hh + 8; }); if (i % 2 === 0) doc.rect(M, y, tw, mh).fill(SOFT); let x = M; cols.forEach((c, j) => { doc.font(j === 0 ? 'Courier-Bold' : 'Helvetica').fontSize(8.5).fillColor(j === 0 ? NAVY_DARK : GRAY).text(String(r[j] ?? ''), x + 6, y + 5, { width: c.w - 10 }); x += c.w; }); y += mh; }); doc.y = y + 10; }

/* Encabezado */
doc.rect(0, 0, 595.28, 96).fill(NAVY_DARK);
doc.font('Helvetica-Bold').fontSize(20).fillColor('#fff').text('Puesta en producción del timbrado real', M, 30, { width: W });
doc.font('Helvetica').fontSize(11).fillColor(GOLD).text('GDM NEXO · SW Sapien (PAC autorizado)', M, 58);
doc.y = 118;

box('SW no usa usuario/contraseña para timbrar', 'SW Sapien timbra con un TOKEN (un JWT largo). Tu usuario y contraseña de SW solo sirven para ENTRAR a su panel y GENERAR ese token. Lo que se coloca en el sistema es el token.', NAVY, '#eff6ff');

h2('Paso 1 · Genera el token de PRODUCCIÓN');
bullets([
  'Entra a https://swpanel.mx con tu usuario y contraseña de SW Sapien.',
  'Ve a Configuración → Tokens.',
  '**Genera/copia el token de PRODUCCIÓN** (requiere tu contrato con timbres reales; NO es el mismo que el de pruebas).',
]);

h2('Paso 2 · Ponlo en Render (Dashboard, NO el Web Shell)');
p('Servicio del backend → pestaña Environment → Add Environment Variable:');
table([{ label: 'Variable', w: 210 }, { label: 'Valor', w: 150 }, { label: 'Nota', w: W - 360 }], [
  ['SW_SAPIEN_TOKEN_PROD', '(token de producción)', 'el real'],
  ['SW_SAPIEN_TOKEN', '(token de pruebas)', 'ya debe estar'],
  ['SW_SAPIEN_ENV', 'sandbox', 'el real se activa por empresa'],
]);
p('Guarda → Render reinicia el backend solo. No hay que tocar URLs: el código ya usa services.sw.com.mx (producción) y services.test.sw.com.mx (pruebas).', { size: 9.5 });

h2('Paso 3 · Marca la empresa como PRODUCCIÓN');
bullets([
  'Super admin → Empresas → editar la empresa → «Ambiente de timbrado» → Producción (en vivo).',
  'Aparece la etiqueta roja EN VIVO. Requisitos: CSD real cargado + el token de producción (Paso 2).',
]);

box('Seguridad — léelo antes de activar', 'Al marcar «Producción» se emiten CFDI REALES ante el SAT (irreversible). El token lo pones tú y la empresa la marcas tú. Es UNA sola cuenta SW (un token) para toda la plataforma; cada empresa sella con su PROPIO CSD. Prueba primero con UNA empresa (una factura real) antes de marcar las demás. El token es secreto: va solo en la variable de Render, nunca en el código ni en un chat.', ROSE, '#fef2f2');

/* Pie */
const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) { doc.switchToPage(i); const mb = doc.page.margins.bottom; doc.page.margins.bottom = 0; const yF = doc.page.height - 40; doc.font('Helvetica').fontSize(7.5).fillColor(GRAY_L).text('GDM NEXO · Puesta en producción del timbrado', M, yF, { width: W / 2, lineBreak: false }); doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text(`Página ${i + 1} de ${range.count}`, M + W / 2, yF, { width: W / 2, align: 'right', lineBreak: false }); doc.page.margins.bottom = mb; }
doc.end();
console.log(`OK: ${OUT} · ${range.count} páginas`);
