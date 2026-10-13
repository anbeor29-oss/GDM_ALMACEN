#!/usr/bin/env node
/**
 * generar-plan-negocios.js — Plan de Negocios de GDM NEXO en PDF.
 *
 * Documento interno/estratégico (distinto del PLAN_COMERCIAL_NEXO.pdf, que es la
 * hoja de venta al cliente). Reúne la investigación de precios de la competencia en
 * México, fija la banda de cobro por usuario (piso / recomendado / techo), la
 * economía unitaria, la proyección de ingresos, el go-to-market, los riesgos y las
 * fuentes.  Uso:  cd backend && node scripts/generar-plan-negocios.js
 *
 * Cifras de la competencia: precios públicos consultados en oct-2026 (MXN, antes de
 * IVA). Ver sección "Fuentes consultadas".
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', '..', 'docs', 'PLAN_NEGOCIOS_NEXO.pdf');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

// Paleta
const NAVY = '#0B1220', AZUL = '#244A78', ROJO = '#C62828', GRIS = '#5B6676', GRIS2 = '#8A94A6';
const TINTA = '#1A2233', LINEA = '#D8DEE9', VERDE = '#1B7A52';
const FNT = 'Helvetica', FB = 'Helvetica-Bold';

const doc = new PDFDocument({ size: 'A4', margin: 56, bufferPages: true,
  info: { Title: 'Plan de Negocios — GDM NEXO', Author: 'GRUPO HCGM', Subject: 'Estrategia de precios por usuario y plan de negocios' } });
doc.pipe(fs.createWriteStream(OUT));

const M = 56, W = doc.page.width - M * 2, PH = doc.page.height;
const BOT = PH - 64;
let y = M;

const room = (h) => { if (y + h > BOT) nueva(); };
function nueva() { doc.addPage(); y = M; }

function parrafo(txt, o = {}) {
  const size = o.size || 10, lh = o.lh || 1.45, color = o.color || TINTA;
  doc.font(o.font || FNT).fontSize(size).fillColor(color);
  const h = doc.heightOfString(txt, { width: W, align: o.align || 'justify', lineGap: size * (lh - 1) });
  room(h);
  doc.text(txt, M, y, { width: W, align: o.align || 'justify', lineGap: size * (lh - 1) });
  y = doc.y + (o.gap == null ? 7 : o.gap);
}

function vineta(items, o = {}) {
  const size = o.size || 10;
  doc.fontSize(size);
  for (const it of items) {
    const txt = typeof it === 'string' ? it : it.t;
    const bold = typeof it === 'object' && it.b;
    const h = doc.font(FNT).heightOfString(txt, { width: W - 16, lineGap: size * 0.45 });
    room(h + 3);
    doc.circle(M + 3, y + size * 0.5, 1.7).fill(AZUL);
    doc.font(bold ? FB : FNT).fillColor(TINTA).fontSize(size)
      .text(txt, M + 14, y, { width: W - 16, lineGap: size * 0.45 });
    y = doc.y + 4;
  }
  y += 3;
}

let secN = 0;
function seccion(titulo) {
  secN++;
  room(46);
  if (y > M + 2) y += 8;
  doc.save();
  doc.rect(M, y, 4, 17).fill(ROJO);
  doc.font(FB).fontSize(14).fillColor(NAVY).text(`${secN}.  ${titulo}`, M + 12, y - 1, { width: W - 12 });
  doc.restore();
  y = doc.y + 6;
  doc.moveTo(M, y).lineTo(M + W, y).lineWidth(0.6).strokeColor(LINEA).stroke();
  y += 10;
}

function subt(t) {
  room(24);
  doc.font(FB).fontSize(10.5).fillColor(AZUL).text(t, M, y, { width: W });
  y = doc.y + 4;
}

// Tabla. cols: [{t, w, align}], filas: [[...]]; opt.destacar = índice de fila a resaltar.
function tabla(cols, filas, opt = {}) {
  const padX = 6, fsH = 8.3, fs = 8.6, lg = 1.5;
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  const esc = W / totalW;
  cols = cols.map((c) => ({ ...c, w: c.w * esc }));
  const altoFila = (vals, font, size) => {
    doc.font(font).fontSize(size);
    let max = 0;
    vals.forEach((v, i) => { max = Math.max(max, doc.heightOfString(String(v), { width: cols[i].w - padX * 2, lineGap: lg })); });
    return max + 9;
  };
  const drawHead = () => {
    const h = altoFila(cols.map((c) => c.t), FB, fsH);
    room(h + 4);
    doc.rect(M, y, W, h).fill(NAVY);
    let x = M;
    doc.font(FB).fontSize(fsH).fillColor('#FFFFFF');
    cols.forEach((c) => { doc.text(c.t, x + padX, y + 4.5, { width: c.w - padX * 2, align: c.align || 'left', lineGap: lg }); x += c.w; });
    y += h;
  };
  drawHead();
  filas.forEach((f, idx) => {
    const h = altoFila(f, FNT, fs);
    if (y + h > BOT) { nueva(); drawHead(); }
    const resaltar = opt.destacar === idx;
    if (resaltar) doc.rect(M, y, W, h).fill('#FFF3CD');
    else if (idx % 2) doc.rect(M, y, W, h).fill('#F4F6FA');
    let x = M;
    doc.font(resaltar ? FB : FNT).fontSize(fs).fillColor(resaltar ? '#6B4E00' : TINTA);
    f.forEach((v, i) => { doc.text(String(v), x + padX, y + 4.5, { width: cols[i].w - padX * 2, align: cols[i].align || 'left', lineGap: lg }); x += cols[i].w; });
    doc.moveTo(M, y + h).lineTo(M + W, y + h).lineWidth(0.4).strokeColor(LINEA).stroke();
    y += h;
  });
  y += 10;
}

function callout(titulo, texto, color = AZUL) {
  doc.font(FB).fontSize(9.5);
  const hT = doc.heightOfString(titulo, { width: W - 24 });
  doc.font(FNT).fontSize(9.5);
  const hX = doc.heightOfString(texto, { width: W - 24, lineGap: 3 });
  const h = hT + hX + 18;
  room(h + 6);
  doc.save();
  doc.roundedRect(M, y, W, h, 6).fill('#F0F4FA');
  doc.rect(M, y, 4, h).fill(color);
  doc.font(FB).fontSize(9.5).fillColor(NAVY).text(titulo, M + 14, y + 8, { width: W - 24 });
  doc.font(FNT).fontSize(9.5).fillColor(TINTA).text(texto, M + 14, y + 8 + hT + 3, { width: W - 24, lineGap: 3 });
  doc.restore();
  y += h + 10;
}

const money = (n) => '$' + Number(n).toLocaleString('es-MX');

/* ───────────────────────── PORTADA ───────────────────────── */
doc.rect(0, 0, doc.page.width, PH).fill(NAVY);
doc.rect(0, 250, doc.page.width, 4).fill(ROJO);
doc.font(FB).fontSize(40).fillColor('#FFFFFF').text('GDM NEXO', M, 150, { width: W });
doc.font(FNT).fontSize(13).fillColor('#9FB3D1').text('ERP fiscal unificado para empresas y despachos en México', M, 205, { width: W });
doc.font(FB).fontSize(22).fillColor('#FFFFFF').text('Plan de Negocios', M, 290, { width: W });
doc.font(FNT).fontSize(13).fillColor('#C9D6EA').text('Estrategia de precios por usuario (mínimo – recomendado – máximo),\nanálisis de mercado y proyección de ingresos', M, 322, { width: W, lineGap: 3 });
doc.font(FNT).fontSize(10).fillColor('#7E93B4')
  .text('GRUPO HCGM', M, 690)
  .text('Documento interno · Ciudad de México · 12/10/2026', M, 706)
  .text('Cifras de la competencia en MXN, antes de IVA. Fuentes al final del documento.', M, 722, { width: W });
nueva();

/* ───────────────────────── 1. RESUMEN EJECUTIVO ───────────────────────── */
seccion('Resumen ejecutivo');
parrafo('GDM NEXO es una plataforma en la nube que reúne en un solo sistema lo que hoy una empresa mexicana resuelve con tres o cuatro programas distintos: contabilidad, nómina timbrada, facturación CFDI 4.0, tesorería, inventarios (almacén) y —el diferenciador— la automatización del cumplimiento fiscal: opinión 32-D, CIF/CSF, opiniones IMSS e INFONAVIT, cédulas de ISR/IVA, DIOT, contabilidad electrónica, conciliación bancaria y prevención de lavado de dinero (PLD).');
parrafo('El cobro es por usuario, con timbres incluidos y checador biométrico sin costo. Este documento fija, con base en los precios reales de la competencia, la banda de cobro por usuario recomendada y la justifica con la economía unitaria del servicio y una proyección de ingresos.');
callout('Recomendación de precio por usuario',
  'Piso: ' + money(500) + '/usuario/mes (migración, volumen o promoción de arranque).   ·   Ancla recomendada: ' + money(750) + '/usuario/mes (precio actual).   ·   Techo de mercado: ' + money(1200) + '/usuario/mes (edición Despacho / multi-RFC).  A $750 incluye timbres escalonados (1,000 base + 500 por cada usuario adicional) y checador biométrico sin costo.', ROJO);
parrafo('A $750 por usuario, GDM NEXO se ubica por encima de los ERP de nube más económicos (Bind, Alegra, ClickBalance: $225–$490 por usuario) pero muy por debajo del costo real de armar el mismo alcance con el esquema tradicional CONTPAQi/Aspel + PAC + herramientas de cumplimiento, que para una sola empresa supera con facilidad los $1,200–$1,600 al mes. El precio no compite por asiento: compite por costo total de propiedad.');

/* ───────────────────────── 2. EL PRODUCTO ───────────────────────── */
seccion('El producto: un solo sistema en lugar de un stack');
parrafo('GDM NEXO sustituye y conecta módulos que normalmente se compran y operan por separado. Todo vive en la nube, se actualiza de forma continua conforme cambia la normativa del SAT, y comparte una sola base de datos, de modo que la factura, la póliza, la balanza y la declaración son el mismo dato.');
subt('Módulos incluidos');
vineta([
  { t: 'Facturación CFDI 4.0 — emisión, cancelación, complementos y autofacturación (Anexo 20).', b: false },
  'Contabilidad — pólizas automáticas, catálogo, balanza, estados financieros (NIF y contables), cierre y traspaso de ejercicio.',
  'Nómina timbrada — cálculo, recibos CFDI, finiquitos y documento legal de baja; checador biométrico incluido.',
  'Tesorería y conciliación bancaria — extractor de estados de cuenta de los principales bancos y conciliación formal.',
  'Almacén / inventarios — catálogo de productos con claves SAT, carga/exportación por plantilla Excel y punto de venta.',
  'Cumplimiento fiscal automatizado — opinión 32-D, CIF/CSF, opiniones IMSS e INFONAVIT; refresco automático.',
  'Reportes fiscales — DIOT (carga masiva), contabilidad electrónica (Anexo 24), cédulas de ISR/IVA y validación de CFDI.',
  'PLD / antilavado (LFPIORPI) — expediente único, alertas por umbral (UMA) y generación del aviso.',
]);
callout('Propuesta de valor',
  'Un responsable de contabilidad que hoy usa CONTPAQi Contabilidad + CONTPAQi Nómina, contrata un PAC para timbrar, lleva el 32-D y el IMSS a mano y paga aparte un checador, con GDM NEXO lo tiene todo en una sola suscripción por usuario, en la nube y automatizado.', VERDE);

/* ───────────────────────── 3. MERCADO Y COMPETENCIA ───────────────────────── */
seccion('Mercado y competencia');
parrafo('La tabla compara el precio público de las alternativas más relevantes en México (MXN al mes, antes de IVA). Para hacerlas comparables se calcula el costo "por usuario" cuando el plan incluye varios. Ninguna de las opciones de nube económicas incluye, a la vez, nómina timbrada y la automatización del cumplimiento fiscal (32-D / IMSS / PLD) que trae GDM NEXO.');
tabla(
  [ { t: 'Solución', w: 150 }, { t: 'Precio (MXN/mes)', w: 118 }, { t: 'Usuarios', w: 58, align: 'center' },
    { t: 'Aprox. por usuario', w: 80, align: 'right' }, { t: 'Nómina timbrada', w: 70, align: 'center' }, { t: 'Cumplimiento SAT/IMSS/PLD', w: 95, align: 'center' } ],
  [
    ['GDM NEXO', '$750 por usuario', '—', '$750', 'Sí', 'Sí (automático)'],
    ['Bind ERP (nube)', '$890 – $1,890', '3 – 6', '$232 – $297', 'No', 'No'],
    ['Alegra ERP (nube)', '$1,299 – $2,999', '3 – 10', '$225 – $433', 'No', 'No'],
    ['ClickBalance One', '$490 por usuario', '—', '$490', 'Add-on', 'Parcial'],
    ['Aspel COI + NOI', '≈ $1,238 + usuarios', '1', '+$315/usr', 'Sí (NOI)', 'No'],
    ['CONTPAQi Conta + Nómina', '≈ $1,157 (anual/RFC)', '1 RFC', '+$290/usr', 'Sí', 'No'],
  ],
  { destacar: 0 }
);
parrafo('Notas: Bind y Alegra cobran por empresa con usuarios incluidos; el "por usuario" es el precio del plan entre sus asientos. CONTPAQi se vende por RFC y por año (Contabilidad multi-RFC $6,190 + Nóminas multi-RFC $7,690 = $13,880/año ≈ $1,157/mes), en escritorio, con la facturación y los usuarios adicionales cotizados aparte. Aspel es suscripción mensual por empresa (COI $559 + NOI $679), con usuario adicional a $142 y $173 respectivamente. En todos los casos el cumplimiento fiscal (32-D, IMSS, PLD) se resuelve a mano o con terceros.', { size: 8.6, color: GRIS });
subt('Lectura del mercado');
vineta([
  'Gama económica de nube ($225–$490 por usuario): buena para facturar y llevar contabilidad básica, sin nómina timbrada ni cumplimiento automatizado.',
  'Suites tradicionales (CONTPAQi / Aspel): potentes pero por producto y por RFC; sumar contabilidad + nómina + facturación + usuarios lleva el costo real por empresa a $1,200–$1,600+ al mes, casi siempre en escritorio.',
  'Hueco de mercado: una sola plataforma en la nube que cubra TODO el ciclo fiscal con automatización de cumplimiento. Ahí juega GDM NEXO.',
]);

/* ───────────────────────── 4. ESTRATEGIA DE PRECIOS ───────────────────────── */
seccion('Estrategia de precios por usuario');
parrafo('El cobro por usuario es simple de entender y escala con el tamaño del cliente. La banda recomendada se sostiene en dos referencias: el piso que protege el margen y el techo a partir del cual al cliente le empieza a convenir el esquema tradicional.');
tabla(
  [ { t: 'Nivel', w: 70 }, { t: 'Precio/usuario/mes', w: 90, align: 'right' }, { t: 'Cuándo aplicarlo', w: 220 }, { t: 'Referencia de mercado', w: 140 } ],
  [
    ['Piso', '$500', 'Migración desde CONTPAQi/Aspel, ventas por volumen (varios usuarios) o promoción de arranque. No bajar de aquí salvo caso de negocio.', 'ClickBalance $490/usr'],
    ['Recomendado', '$750', 'Precio de lista actual. Incluye timbres escalonados (1,000 + 500/usuario) y checador. Es el ancla de toda la oferta.', 'Entre nube económica y suite'],
    ['Techo', '$1,000 – $1,200', 'Edición Despacho / multi-RFC: PLD, cédulas, más timbres y soporte prioritario. Sigue por debajo del stack CONTPAQi+Aspel+PAC.', 'Alegra Firma $1,990 (10 usr)'],
  ],
  { destacar: 1 }
);
callout('Por qué $750 y no menos',
  'El precio no se compara contra el asiento más barato de Alegra o Bind, sino contra lo que el cliente dejaría de pagar: dos o tres licencias CONTPAQi/Aspel por RFC, un PAC para timbrar, un checador y las horas de su contador resolviendo 32-D, IMSS y DIOT a mano. Frente a eso, $750 por usuario al mes es claramente favorable y deja margen sano.', ROJO);
subt('Planes sugeridos (empaquetado de la banda)');
tabla(
  [ { t: 'Plan', w: 90 }, { t: 'Precio/usuario', w: 80, align: 'right' }, { t: 'Incluye', w: 310 } ],
  [
    ['NEXO Esencial', '$500', 'Contabilidad + Facturación CFDI 4.0 + Tesorería. 1 RFC. Timbres incluidos (escalonados). Checador incluido.'],
    ['NEXO Negocio', '$750', 'Todo Esencial + Nómina timbrada + Inventarios/Almacén + Cumplimiento fiscal (32-D / CIF / IMSS / INFONAVIT) + Conciliación bancaria.'],
    ['NEXO Despacho', '$1,000 – $1,200', 'Todo Negocio + multi-RFC + PLD + Cédulas/DIOT/Contabilidad electrónica avanzada + más timbres + soporte prioritario.'],
  ],
  { destacar: 1 }
);
parrafo('Timbres (modelo escalonado): incluidos = 1,000 base + 500 por cada usuario adicional (1 usuario = 1,000; 3 usuarios = 2,000); se reinician el día 30 y no se acumulan. El timbre excedente cuesta $1.30 más $0.20 por cada usuario adicional (+IVA), por debajo del mercado de paquetes ($2.40–$3.00 por timbre en PAC como EdiFact).', { size: 9, color: GRIS });

/* ───────────────────────── 5. ECONOMÍA UNITARIA ───────────────────────── */
seccion('Economía unitaria (por usuario, estimada)');
parrafo('La siguiente estimación muestra la estructura de costo marginal por usuario al mes y el margen bruto resultante a $750. Las cifras son un marco de trabajo y deben validarse con los costos reales de infraestructura (Render), del PAC (SW Sapien) y del proveedor fiscal (SatGo).');
tabla(
  [ { t: 'Concepto', w: 240 }, { t: 'Estimado/usuario/mes', w: 120, align: 'right' }, { t: 'Nota', w: 150 } ],
  [
    ['Precio de venta', '$750', 'Plan Negocio'],
    ['Infraestructura (Render + Postgres, prorrateada)', '$30 – $60', 'Costo compartido'],
    ['Timbres PAC (uso típico 100–400/mes)', '$30 – $120', 'Sólo lo timbrado'],
    ['Proveedor fiscal / conectores (SatGo, prorrateado)', '$20 – $40', 'Compartido'],
    ['Soporte y operación', '$80 – $150', 'Escala con clientes'],
    ['Costo marginal total (estimado)', '$160 – $370', '—'],
    ['Margen bruto por usuario', '$380 – $590', '≈ 50% – 78%'],
  ],
  { destacar: 6 }
);
parrafo('Aun en el escenario pesimista (costo marginal de $370), el margen bruto ronda el 50%, saludable para SaaS. El costo dominante es el soporte humano, que mejora con onboarding estandarizado (ya existe la prueba de 72 h) y documentación.', { gap: 4 });

/* ───────────────────────── 6. PROYECCIÓN DE INGRESOS ───────────────────────── */
seccion('Proyección de ingresos');
parrafo('Ingreso recurrente a $750 por usuario al mes, sin contar timbres excedentes ni ediciones Despacho (que elevan el ticket promedio). La suspensión por falta de pago ya bloquea el acceso, lo que protege la cobranza.');
tabla(
  [ { t: 'Usuarios activos', w: 110, align: 'center' }, { t: 'Ingreso mensual', w: 130, align: 'right' }, { t: 'Ingreso anual', w: 130, align: 'right' }, { t: 'Margen bruto anual (≈60%)', w: 130, align: 'right' } ],
  [
    ['10', money(7500), money(90000), money(54000)],
    ['25', money(18750), money(225000), money(135000)],
    ['50', money(37500), money(450000), money(270000)],
    ['100', money(75000), money(900000), money(540000)],
    ['150', money(112500), money(1350000), money(810000)],
  ],
  { destacar: 2 }
);
parrafo('A 50 usuarios el servicio ya genera ingresos anuales cercanos a medio millón de pesos con un margen bruto saludable; a 150 usuarios supera el millón. El crecimiento de ingresos por excedentes de timbres y por la edición Despacho es adicional.', { size: 9, color: GRIS });

/* ───────────────────────── 7. GO-TO-MARKET ───────────────────────── */
seccion('Ir al mercado');
vineta([
  { t: 'Migración asistida: el importador desde respaldos CONTPAQi/Aspel ya existe; convierte el "costo de cambio" en una ventaja de venta.', b: false },
  'Despachos contables: la edición Despacho (multi-RFC) atiende a quien lleva muchas empresas; es el segmento de mayor ticket y recurrencia.',
  'Prueba de 72 horas: alta pública con liberación al firmar con e.firma; reduce fricción de entrada.',
  'Diferenciador en toda comunicación: "una sola plataforma para facturar, contabilizar, nominar y cumplir con el SAT", no "otro programa de facturas".',
  'Referidos y contadores aliados: el contador que ya opera varias empresas es el mejor canal.',
]);

/* ───────────────────────── 8. RIESGOS ───────────────────────── */
seccion('Riesgos y mitigación');
tabla(
  [ { t: 'Riesgo', w: 200 }, { t: 'Mitigación', w: 283 } ],
  [
    ['Dependencia del PAC (SW Sapien) y del proveedor fiscal (SatGo); llaves que caducan.', 'Monitoreo y blindaje ya implementados ("Probar conexión", avisos de caducidad); contratar llaves/cuentas de producción, no de prueba.'],
    ['Cambios normativos del SAT (reforma fiscal 2026).', 'El producto se actualiza de forma continua; es una ventaja frente al escritorio que obliga a recomprar versión.'],
    ['El soporte crece con los usuarios.', 'Onboarding estandarizado (prueba 72 h), documentación y autoservicio; el margen absorbe la operación.'],
    ['Competencia de marcas grandes (CONTPAQi, Aspel, Alegra).', 'No competir por precio de asiento, sino por alcance todo-en-uno + automatización de cumplimiento + costo total.'],
    ['Concentración de ingresos en pocos clientes.', 'Diversificar con despachos (multi-RFC) y segmento PyME; cobro por usuario escala parejo.'],
  ]
);

/* ───────────────────────── 9. CONCLUSIÓN ───────────────────────── */
seccion('Conclusión y recomendación');
parrafo('El precio actual de $750 por usuario al mes está bien ubicado: suficientemente por encima de la nube económica para sostener el margen y el soporte, y muy por debajo del costo real de replicar el alcance con el esquema tradicional. Se recomienda:');
vineta([
  { t: 'Mantener $750 como precio ancla del plan Negocio.', b: true },
  { t: 'Conservar $500 como piso explícito, reservado a migración, volumen o promociones; no como lista general.', b: true },
  { t: 'Formalizar la edición Despacho a $1,000–$1,200 por usuario (multi-RFC), que hoy es dinero sobre la mesa.', b: true },
  { t: 'Comunicar siempre el valor como ahorro frente al stack, no como precio por asiento.', b: true },
]);
callout('En una frase',
  'GDM NEXO no vende asientos de software: vende dejar de pagar —y de operar— tres o cuatro programas distintos para cumplir con el SAT. A $750 por usuario, con techo de $1,200 para despachos y piso de $500 para migraciones, el precio está donde debe estar.', VERDE);

/* ───────────────────────── 10. FUENTES ───────────────────────── */
seccion('Fuentes consultadas');
parrafo('Precios públicos de la competencia, consultados en octubre de 2026 (MXN, antes de IVA). Las cifras de terceros pueden variar; confirmar con cada proveedor antes de una decisión formal.', { size: 9, color: GRIS });
vineta([
  'CONTPAQi — Lista de precios al público 2026 (multi-RFC): contpaqi.com / idnube.com/precios-contpaqi.',
  'Aspel (Siigo) — Lista oficial de precios 2026 (COI, NOI).',
  'Bind ERP — planes publicados en Capterra, GetApp, Software Advice y Tiendanube (2026).',
  'ClickBalance One — clickbalance.one (precio por usuario) y comparasoftware.com.',
  'Alegra México — alegra.com/mexico/precios (Facturación, ERP, Soy Contador).',
  'Timbres CFDI — paquetes de PAC (p. ej. EdiFact): referencia $2.40–$3.00 por timbre.',
], { size: 9 });

/* ───────── pie de página con numeración (omite portada) ───────── */
const rango = doc.bufferedPageRange();
for (let i = rango.start; i < rango.start + rango.count; i++) {
  doc.switchToPage(i);
  if (i === rango.start) continue;
  const mb = doc.page.margins.bottom; doc.page.margins.bottom = 0;
  const yPie = PH - 42;
  doc.moveTo(M, yPie).lineTo(M + W, yPie).lineWidth(0.5).strokeColor(LINEA).stroke();
  doc.font(FNT).fontSize(8).fillColor(GRIS2);
  doc.text('GDM NEXO · Plan de Negocios', M, yPie + 6, { width: W / 2, align: 'left', lineBreak: false });
  doc.text(`Página ${i} de ${rango.count - 1}`, M + W / 2, yPie + 6, { width: W / 2, align: 'right', lineBreak: false });
  doc.page.margins.bottom = mb;
}

doc.end();
doc.on('end', () => {});
console.log(`OK: ${OUT} · ${rango.count} páginas`);
