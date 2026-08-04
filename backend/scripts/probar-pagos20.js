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

/** Un documento suelto: cubre la factura completa salvo que se diga otra cosa. */
const doc = (partidas, total, monto, extra = {}) => ({
  partidas,
  totalFactura: total,
  montoPagado: monto === undefined ? total : monto,
  saldoAnterior: total,
  saldoInsoluto: total - (monto === undefined ? total : monto),
  parcialidad: 1,
  uuid: 'daca5d85-b8cd-463b-a056-b021fe33c2f9',
  serie: 'B',
  folio: '1',
  monedaDR: 'MXN',
  ...extra,
});

/** Datos del pago, con un solo documento salvo que se pasen más. */
const base = (partidas, total, monto, extraDoc = {}) => ({
  documentos: [doc(partidas, total, monto, extraDoc)],
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
    ...base([P({ subtotal: 100, tax_rate: 0.16 })], 116, undefined, { monedaDR: 'USD' }),
    monedaP: 'USD',
  });
  revisar('TipoCambioP obligatorio fuera de MXN',
    r.Pago[0].TipoCambioP !== undefined, r.Pago[0].TipoCambioP);
  revisar('EquivalenciaDR es 1 con misma moneda',
    r.Pago[0].DoctoRelacionado[0].EquivalenciaDR === '1');
}
{
  const r = construirPagos20({
    ...base([P({ subtotal: 100, tax_rate: 0.16 })], 116, undefined,
            { monedaDR: 'USD', equivalenciaDR: 0.045331 }),
    monedaP: 'MXN',
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

/* --- Un pago que liquida DOS facturas ---------------------------------- */
console.log('\nUn pago sobre dos facturas');
{
  const r = construirPagos20({
    documentos: [
      /* Las partidas son las de la factura COMPLETA; el prorrateo lo hace el
       * constructor con montoPagado/totalFactura. Poner aquí la base de lo
       * pagado en vez de la de la factura da bases minúsculas — así se detectó,
       * y era un error del dato de prueba, no del constructor. */
      // Factura 1: 5842.60 + IVA = 6777.42, pagada completa.
      { partidas: [P({ subtotal: 5842.60, tax_rate: 0.16 })], totalFactura: 6777.42,
        montoPagado: 6777.42, saldoAnterior: 6777.42, saldoInsoluto: 0,
        parcialidad: 2, uuid: 'b7c8d2bf-cb4e-4f84-af89-c68b6731206a',
        serie: 'FA', folio: 'N0000216349', monedaDR: 'MXN' },
      // Factura 2: 8285.18 + IVA = 9610.81, de la que se abonan 0.59.
      // Prorrateado: 8285.18 x 0.59 / 9610.81 = 0.51 de base.
      { partidas: [P({ subtotal: 8285.18, tax_rate: 0.16 })], totalFactura: 9610.81,
        montoPagado: 0.59, saldoAnterior: 9610.81, saldoInsoluto: 9610.22,
        parcialidad: 1, uuid: '94f4e541-bb38-4355-b779-02d337dc9720',
        serie: 'FA', folio: 'SI000032690', monedaDR: 'MXN' },
    ],
    monedaP: 'MXN', fechaPago: '2026-08-03T12:00:00', formaPago: '01',
  });
  const p0 = r.Pago[0];
  revisar('hay DOS DoctoRelacionado', p0.DoctoRelacionado.length === 2, p0.DoctoRelacionado.length);
  revisar('cada uno con su UUID',
    p0.DoctoRelacionado[0].IdDocumento !== p0.DoctoRelacionado[1].IdDocumento);
  revisar('NumParcialidad es POR FACTURA, no por pago',
    p0.DoctoRelacionado[0].NumParcialidad === '2' && p0.DoctoRelacionado[1].NumParcialidad === '1',
    p0.DoctoRelacionado.map((x) => x.NumParcialidad));
  const suma = p0.DoctoRelacionado.reduce((a, x) => a + Number(x.ImpPagado), 0);
  revisar('Monto = suma de los ImpPagado',
    Number(p0.Monto).toFixed(2) === suma.toFixed(2), { monto: p0.Monto, suma: suma.toFixed(2) });
  revisar('MontoTotalPagos coincide con Monto',
    r.Totales.MontoTotalPagos === p0.Monto, r.Totales.MontoTotalPagos);
  revisar('Totales suma las bases de las DOS facturas (5842.60 + 0.51)',
    r.Totales.TotalTrasladosBaseIVA16 === '5843.11', r.Totales.TotalTrasladosBaseIVA16);
  revisar('ImpuestosP agrupa la misma tasa en UN renglon',
    p0.ImpuestosP.TrasladosP.length === 1, p0.ImpuestosP.TrasladosP);
}

/* --- Dos facturas con tasas distintas ---------------------------------- */
console.log('\nDos facturas con tasas distintas');
{
  const r = construirPagos20({
    documentos: [
      { partidas: [P({ subtotal: 100, tax_rate: 0.16 })], totalFactura: 116, montoPagado: 116,
        saldoAnterior: 116, saldoInsoluto: 0, parcialidad: 1, uuid: 'aaa', folio: '1', monedaDR: 'MXN' },
      { partidas: [P({ subtotal: 200, is_exempt: true })], totalFactura: 200, montoPagado: 200,
        saldoAnterior: 200, saldoInsoluto: 0, parcialidad: 1, uuid: 'bbb', folio: '2', monedaDR: 'MXN' },
    ],
    monedaP: 'MXN', fechaPago: '2026-08-03T12:00:00', formaPago: '03',
  });
  revisar('declara base al 16%', r.Totales.TotalTrasladosBaseIVA16 === '100.00', r.Totales);
  revisar('y base exenta, por separado', r.Totales.TotalTrasladosBaseIVAExento === '200.00', r.Totales);
  revisar('el exento no declara impuesto',
    r.Totales.TotalTrasladosImpuestoIVAExento === undefined, r.Totales);
  revisar('ImpuestosP lleva los dos renglones',
    r.Pago[0].ImpuestosP.TrasladosP.length === 2, r.Pago[0].ImpuestosP.TrasladosP.length);
}

/* --- Sin documentos no hay complemento posible ------------------------- */
console.log('\nSin facturas relacionadas');
{
  let lanzo = false;
  try { construirPagos20({ documentos: [], monedaP: 'MXN', fechaPago: 'x', formaPago: '03' }); }
  catch { lanzo = true; }
  revisar('se rechaza en vez de emitir un complemento vacio', lanzo);
}

console.log(`\n${pruebas - fallos}/${pruebas} comprobaciones correctas`);
if (fallos) { console.log(`${fallos} FALLARON`); process.exit(1); }
