/**
 * Genera docs/CODIGOS_DEPRECIACION_SAT.pdf — la lista de códigos SAT (agrupadores),
 * conceptos, tasas y fundamento LISR que usa el módulo de Activos fijos / Depreciación
 * de GDM NEXO. Datos tomados 1:1 de backend/src/modules/accounting/depreciacion.data.ts.
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'docs', 'CODIGOS_DEPRECIACION_SAT.pdf');

// [código/agrupador, rubro, tasa (0..1), gasto, acumulada, fundamento]
const DEPRECIABLES = [
  ['152', 'Edificios y construcciones', 0.05, '701.01', '171.01', 'LISR 34-I-b) 5%'],
  ['153', 'Maquinaria y equipo', 0.10, '701.02', '171.02', 'LISR 35-XIV 10%'],
  ['154', 'Automóviles, camiones y equipo de transporte', 0.25, '701.03', '171.03', 'LISR 34-VI 25%'],
  ['155', 'Mobiliario y equipo de oficina', 0.10, '701.04', '171.04', 'LISR 34-III 10%'],
  ['156', 'Equipo de cómputo', 0.30, '701.05', '171.05', 'LISR 34-VII 30%'],
  ['157', 'Equipo de comunicación', 0.10, '701.06', '171.06', 'LISR 35-XIV 10%'],
  ['158', 'Activos biológicos, vegetales y semovientes', 0.25, '701.07', '171.07', 'LISR 35 (según actividad)'],
  ['160', 'Otros activos fijos', 0.10, '701.08', '171.08', 'LISR 35-XIV 10%'],
  ['161', 'Ferrocarriles', 0.06, '701.09', '171.09', 'LISR 34-II 6%'],
  ['162', 'Embarcaciones', 0.06, '701.10', '171.10', 'LISR 34-IV 6%'],
  ['163', 'Aviones', 0.10, '701.11', '171.11', 'LISR 34-V 10%'],
  ['164', 'Troqueles, moldes, matrices y herramental', 0.35, '701.02', '171.02', 'LISR 34-VIII 35%'],
  ['165', 'Equipo de comunicaciones telefónicas', 0.10, '701.06', '171.06', 'LISR 34-IX (10% general)'],
  ['166', 'Equipo de comunicación satelital', 0.08, '701.06', '171.06', 'LISR 34-X 8%'],
  ['167', 'Adaptaciones para personas con capacidades diferentes', 1.0, '701.08', '171.08', 'LISR 34-XIII 100%'],
  ['168', 'Maquinaria de energía renovable / cogeneración eficiente', 1.0, '701.02', '171.02', 'LISR 34-XIII 100% (con requisitos)'],
  ['169', 'Otra maquinaria y equipo', 0.10, '701.02', '171.02', 'LISR 35-XIV 10%'],
  ['170', 'Adaptaciones y mejoras', 0.05, '701.01', '171.01', 'LISR 34-I 5% (o vida del contrato)'],
];
const AMORTIZABLES = [
  ['173', 'Gastos diferidos', 0.15, '702.01', '183.01', 'LISR 33-III 15%'],
  ['174', 'Gastos pre operativos', 0.10, '702.02', '183.02', 'LISR 33-II 10%'],
  ['175', 'Regalías, asistencia técnica y otros gastos diferidos', 0.15, '702.03', '183.03', 'LISR 33-III 15%'],
  ['176', 'Activos intangibles (software, licencias)', 0.15, '702.04', '183.04', 'LISR 33-III 15% (vida definida)'],
  ['177', 'Gastos de organización', 0.05, '702.05', '183.05', 'LISR 33-I 5%'],
  ['178', 'Investigación y desarrollo de mercado', 0.15, '702.06', '183.06', 'LISR 33-III 15%'],
  ['179', 'Marcas y patentes', 0.05, '702.07', '183.07', 'LISR 33-I 5% (o vida legal)'],
  ['181', 'Gastos de instalación', 0.05, '702.09', '183.09', 'LISR 33-I 5%'],
  ['182', 'Otros activos diferidos', 0.05, '702.10', '183.10', 'LISR 33-I 5%'],
];
const NO_DEPRECIAN = [
  ['151', 'Terrenos', 'No se deprecia (el terreno no pierde valor por uso) — LISR 34'],
  ['159', 'Obras en proceso de activos fijos', 'No se deprecia hasta que el activo entra en uso — NIF C-6'],
  ['180', 'Crédito mercantil', 'No se amortiza; se prueba deterioro — NIF C-8 / LISR no deducible'],
];

const M = 40;
const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true,
  info: { Title: 'Códigos SAT — Depreciación y Amortización · GDM NEXO', Author: 'GRUPO HCGM S.A. DE C.V.' } });
doc.pipe(fs.createWriteStream(OUT));

const W = doc.page.width - M * 2;
const rojo = '#b91c1c', gris = '#6b7280', negro = '#111827';
const pct = (t) => (t * 100).toFixed(0) + '%';

function titulo() {
  doc.fillColor(rojo).font('Helvetica-Bold').fontSize(18).text('Códigos SAT — Depreciación y Amortización', M, M);
  doc.fillColor(gris).font('Helvetica').fontSize(9)
    .text('Módulo de Activos fijos de GDM NEXO · LISR arts. 33, 34 y 35 · método de línea recta · % = tasa anual MÁXIMA (se puede usar menos).', { width: W });
  doc.moveDown(0.3);
  doc.fillColor(gris).fontSize(8).text('El código es el AGRUPADOR (3 dígitos) de la cuenta de activo; de él se derivan la cuenta de gasto y la acumulada. MOI = costo neto sin IVA.', { width: W });
  doc.moveDown(0.6);
}

// Columnas: Cód | Rubro/Concepto | Tasa | Gasto | Acum | Fundamento
const cols = [
  { k: 'cod', t: 'Cód.', w: 34 },
  { k: 'rubro', t: 'Rubro / Concepto', w: 200 },
  { k: 'tasa', t: 'Tasa', w: 36 },
  { k: 'gasto', t: 'Gasto', w: 44 },
  { k: 'acum', t: 'Acum.', w: 44 },
  { k: 'fund', t: 'Fundamento LISR', w: W - 34 - 200 - 36 - 44 - 44 },
];

function encabezadoTabla() {
  let x = M; const y = doc.y;
  doc.rect(M, y, W, 16).fill('#1f2937');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
  cols.forEach((c) => { doc.text(c.t, x + 3, y + 4, { width: c.w - 6 }); x += c.w; });
  doc.y = y + 16;
  doc.fillColor(negro).font('Helvetica').fontSize(8);
}

function fila(r, i) {
  if (doc.y > doc.page.height - M - 24) { doc.addPage(); encabezadoTabla(); }
  const y = doc.y;
  const vals = { cod: r[0], rubro: r[1], tasa: pct(r[2]), gasto: r[3], acum: r[4], fund: r[5] };
  // alto dinámico por el rubro/fundamento
  const hRubro = doc.heightOfString(vals.rubro, { width: cols[1].w - 6 });
  const hFund = doc.heightOfString(vals.fund, { width: cols[5].w - 6 });
  const h = Math.max(14, hRubro + 4, hFund + 4);
  if (i % 2 === 1) doc.rect(M, y, W, h).fill('#f3f4f6');
  doc.fillColor(negro);
  let x = M;
  cols.forEach((c) => { doc.text(String(vals[c.k]), x + 3, y + 2, { width: c.w - 6 }); x += c.w; });
  doc.y = y + h;
}

function seccion(nombre, sub, rows) {
  if (doc.y > doc.page.height - M - 80) doc.addPage();
  doc.moveDown(0.4);
  doc.fillColor(rojo).font('Helvetica-Bold').fontSize(12).text(nombre, M, doc.y);
  if (sub) doc.fillColor(gris).font('Helvetica').fontSize(8).text(sub, { width: W });
  doc.moveDown(0.2);
  encabezadoTabla();
  rows.forEach(fila);
}

titulo();
seccion('1) Depreciación de activos fijos tangibles', 'Cuenta de gasto 701.xx (depreciación) · acumulada 171.xx.', DEPRECIABLES);
seccion('2) Amortización de activos diferidos / intangibles', 'Cuenta de gasto 702.xx (amortización) · acumulada 183.xx.', AMORTIZABLES);

// No se deprecian
if (doc.y > doc.page.height - M - 90) doc.addPage();
doc.moveDown(0.5);
doc.fillColor(rojo).font('Helvetica-Bold').fontSize(12).text('3) Se registran pero NO se deprecian/amortizan', M, doc.y);
doc.moveDown(0.2);
doc.font('Helvetica').fontSize(8).fillColor(negro);
NO_DEPRECIAN.forEach((r) => { doc.text(`•  ${r[0]} — ${r[1]}:  `, { continued: true }).fillColor(gris).text(r[2]).fillColor(negro); });

// Pie
const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(range.start + i);
  doc.fillColor(gris).font('Helvetica').fontSize(7)
    .text(`GDM NEXO · GRUPO HCGM S.A. DE C.V. · Tasas máximas LISR (referencia, ajustables por activo) · pág. ${i + 1} de ${range.count}`,
      M, doc.page.height - 28, { width: W, align: 'center' });
}

doc.end();
doc.on('finish', () => {});
console.log('PDF generado:', OUT);
