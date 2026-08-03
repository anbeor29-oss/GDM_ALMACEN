#!/usr/bin/env node
/**
 * probar-pagos20.js — comprueba el constructor del Complemento de Pago 2.0
 * contra los casos del documento de referencia de SW.
 *
 * POR QUÉ NO BASTA CON QUE COMPILE
 * Los errores de este nodo no se ven al compilar ni al ejecutar: se ven cuando
 * el SAT rechaza el comprobante, con el timbre ya consumido y el cliente
 * esperando. Cada caso de abajo es uno que el documento ejemplifica y que
 * antes se habría armado mal.
 *
 * Uso:  node scripts/probar-pagos20.js
 */
const path = require('path');
const { construirPagos20 } = require(path.join(__dirname, '..', 'dist', 'modules', 'payments', 'pagos20.builder'));

let fallos = 0;
let pruebas = 0;

function revisar(titulo, cond, detalle) {
  pruebas++;
  if (cond) { console.log(`  ✔ ${titulo}`); return; }
  fallos++;
  console.log(`  ✘ ${titulo}`);
  if (detalle !== undefined) console.log(`      ${JSON.stringify(detalle)}`);
}

/** Datos comunes: el pago cubre la factura completa salvo que se diga otra cosa. */
const base = (partidas, total, monto) => ({
  partidas,
  totalFactura: total,
  montoPago: monto === undefined ? total : monto,
  saldoAnterior: total,
  saldoInsoluto: total - (monto === undefined ? total : monto),
  parcialidad: 1,
  uuidFactura: 'daca5d85-b8cd-463b-a056-b021fe33c2f9',
  serieFactura: 'B',
  folioFactura: '1',
  monedaDR: 'MXN',
  monedaP: 'MXN',
  fechaPago: '2026-08-03T12:00:00',
  formaPago: '03',
});

const P = (o) => ({ subtotal: 0, tax_rate: 0, is_exempt: false, ret_iva_rate: 0, ret_isr_rate: 0, ieps_rate: 0, ...o });

/* ─── Caso: sólo traslados IVA 16% ─────────────────────────────────────── */
console.log('\nSólo traslados, IVA 16%');
{
  const r = construirPagos20(base([P({ subtotal: 100, tax_rate: 0.16 })], 116));
  const dr = r.Pago[0].DoctoRelacionado[0];
  revisar('ObjetoImpDR es 02', dr.ObjetoImpDR === '02', dr.ObjetoImpDR);
  revisar('hay TrasladosDR', !!dr.ImpuestosDR?.TrasladosDR, dr.ImpuestosDR);
  revisar('no hay RetencionesDR', !dr.ImpuestosDR?.RetencionesDR);
  const t = dr.ImpuestosDR.TrasladosDR[0];
  revisar('BaseDR = 100.00', t.BaseDR === '100.00', t.BaseDR);
  revisar('TasaOCuotaDR con 6 decimales', t.TasaOCuotaDR === '0.160000', t.TasaOCuotaDR);
  revisar('ImporteDR = BaseDR x tasa', t.ImporteDR === '16.00', t.ImporteDR);
  revisar('Totales base IVA16', r.Totales.TotalTrasladosBaseIVA16 === '100.00', r.Totales);
  revisar('Totales impuesto IVA16', r.Totales.TotalTrasladosImpuestoIVA16 === '16.00', r.Totales);
  revisar('MontoTotalPagos', r.Totales.MontoTotalPagos === '116.00', r.Totales);
}

/* ─── Caso: sin impuestos ──────────────────────────────────────────────── */
console.log('\nSin impuestos');
{
  const r = construirPagos20(base([P({ subtotal: 100, tax_rate: 0 })], 100));
  const dr = r.Pago[0].DoctoRelacionado[0];
  // tax_rate 0 sigue siendo objeto de impuesto a tasa cero: lleva nodo.
  revisar('tasa 0 declara ObjetoImpDR 02', dr.ObjetoImpDR === '02', dr.ObjetoImpDR);
  revisar('Totales usa el sufijo IVA0', r.Totales.TotalTrasladosBaseIVA0 === '100.00', r.Totales);
  revisar('impuesto de tasa 0 es 0.00', r.Totales.TotalTrasladosImpuestoIVA0 === '0.00', r.Totales);
}

/* ─── Caso: exento ─────────────────────────────────────────────────────── */
console.log('\nIVA exento');
{
  const r = construirPagos20(base([P({ subtotal: 100, is_exempt: true })], 100));
  const t = r.Pago[0].DoctoRelacionado[0].ImpuestosDR.TrasladosDR[0];
  revisar('TipoFactorDR es Exento', t.TipoFactorDR === 'Exento', t);
  revisar('SIN TasaOCuotaDR', t.TasaOCuotaDR === undefined, t);
  revisar('SIN ImporteDR', t.ImporteDR === undefined, t);
  revisar('Totales base exento', r.Totales.TotalTrasladosBaseIVAExento === '100.00', r.Totales);
  revisar('exento no declara impuesto', r.Totales.TotalTrasladosImpuestoIVAExento === undefined, r.Totales);
}

/* ─── Caso: sólo retenciones ───────────────────────────────────────────── */
console.log('\nSólo retenciones');
{
  const r = construirPagos20(base([P({ subtotal: 100, ret_iva_rate: 0.106667 })], 100));
  const dr = r.Pago[0].DoctoRelacionado[0];
  revisar('hay RetencionesDR', !!dr.ImpuestosDR?.RetencionesDR, dr.ImpuestosDR);
  const ret = dr.ImpuestosDR.RetencionesDR[0];
  revisar('tasa de retención a 6 decimales', ret.TasaOCuotaDR === '0.106667', ret.TasaOCuotaDR);
  revisar('ImporteDR de la retención', ret.ImporteDR === '10.67', ret.ImporteDR);
  revisar('TotalRetencionesIVA', r.Totales.TotalRetencionesIVA === '10.67', r.Totales);
  const rp = r.Pago[0].ImpuestosP.RetencionesP[0];
  revisar('RetencionesP sólo impuesto e importe',
    Object.keys(rp).sort().join(',') === 'ImporteP,ImpuestoP', rp);
}

/* ─── Caso: traslados + retenciones ────────────────────────────────────── */
console.log('\nIVA 16% con retenciones');
{
  const r = construirPagos20(base(
    [P({ subtotal: 100, tax_rate: 0.16, ret_iva_rate: 0.106667, ret_isr_rate: 0.10 })], 105.33));
  const dr = r.Pago[0].DoctoRelacionado[0];
  revisar('lleva los dos arreglos',
    !!dr.ImpuestosDR.TrasladosDR && !!dr.ImpuestosDR.RetencionesDR, Object.keys(dr.ImpuestosDR));
  revisar('retención de ISR es impuesto 001',
    dr.ImpuestosDR.RetencionesDR.some((x) => x.ImpuestoDR === '001'), dr.ImpuestosDR.RetencionesDR);
  revisar('TotalRetencionesISR presente', !!r.Totales.TotalRetencionesISR, r.Totales);
  revisar('TotalRetencionesIVA presente', !!r.Totales.TotalRetencionesIVA, r.Totales);
}

/* ─── Caso: parcialidad ────────────────────────────────────────────────── */
console.log('\nPago parcial (prorrateo)');
{
  // Factura de 116 (100 + IVA). Se paga la mitad: la base declarada es la mitad.
  const r = construirPagos20(base([P({ subtotal: 100, tax_rate: 0.16 })], 116, 58));
  const t = r.Pago[0].DoctoRelacionado[0].ImpuestosDR.TrasladosDR[0];
  revisar('BaseDR prorrateada = 50.00', t.BaseDR === '50.00', t.BaseDR);
  revisar('ImporteDR prorrateado = 8.00', t.ImporteDR === '8.00', t.ImporteDR);
  revisar('ImpPagado = 58.00', r.Pago[0].DoctoRelacionado[0].ImpPagado === '58.00');
  revisar('ImpSaldoInsoluto = 58.00', r.Pago[0].DoctoRelacionado[0].ImpSaldoInsoluto === '58.00');
}

/* ─── Caso: moneda extranjera ──────────────────────────────────────────── */
console.log('\nPago en dólares');
{
  const r = construirPagos20({
    ...base([P({ subtotal: 100, tax_rate: 0.16 })], 116),
    monedaDR: 'USD', monedaP: 'USD',
  });
  revisar('TipoCambioP obligatorio fuera de MXN',
    r.Pago[0].TipoCambioP !== undefined, r.Pago[0].TipoCambioP);
  revisar('EquivalenciaDR es 1 con misma moneda',
    r.Pago[0].DoctoRelacionado[0].EquivalenciaDR === '1');
}
{
  const r = construirPagos20({
    ...base([P({ subtotal: 100, tax_rate: 0.16 })], 116),
    monedaDR: 'USD', monedaP: 'MXN', equivalenciaDR: 0.045331,
  });
  revisar('EquivalenciaDR con 6 decimales si difieren',
    r.Pago[0].DoctoRelacionado[0].EquivalenciaDR === '0.045331',
    r.Pago[0].DoctoRelacionado[0].EquivalenciaDR);
}

/* ─── Invariante que el SAT valida en TODOS los casos ──────────────────── */
console.log('\nInvariante BaseDR x TasaOCuotaDR == ImporteDR');
{
  const casos = [
    [P({ subtotal: 5842.60, tax_rate: 0.16 })],
    [P({ subtotal: 0.51,    tax_rate: 0.16 })],
    [P({ subtotal: 333.33,  tax_rate: 0.08 })],
    [P({ subtotal: 1234.56, tax_rate: 0.16, ret_iva_rate: 0.106667 })],
    [P({ subtotal: 999.99,  ret_isr_rate: 0.35 })],
  ];
  let ok = true;
  for (const partidas of casos) {
    const total = partidas.reduce((a, p) => a + p.subtotal * (1 + p.tax_rate), 0);
    const r = construirPagos20(base(partidas, Math.round(total * 100) / 100));
    const imp = r.Pago[0].DoctoRelacionado[0].ImpuestosDR || {};
    for (const g of [...(imp.TrasladosDR || []), ...(imp.RetencionesDR || [])]) {
      if (g.TipoFactorDR === 'Exento') continue;
      const esperado = (Math.round(Number(g.BaseDR) * Number(g.TasaOCuotaDR) * 100) / 100).toFixed(2);
      if (g.ImporteDR !== esperado) {
        ok = false;
        console.log(`      descuadre: ${g.BaseDR} x ${g.TasaOCuotaDR} = ${esperado}, dice ${g.ImporteDR}`);
      }
    }
  }
  revisar('se cumple en los cinco montos probados', ok);
}

console.log(`\n${pruebas - fallos}/${pruebas} comprobaciones correctas`);
if (fallos) { console.log(`${fallos} FALLARON`); process.exit(1); }
