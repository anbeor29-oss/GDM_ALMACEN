/**
 * DiferenciaCambiaria — utilidad y pérdida por variación del tipo de cambio.
 *
 * Se factura 1 000 USD el lunes a 17.50 y cobran 15 días después a 18.00:
 * llegan los mismos 1 000 dólares, pero 500 pesos más. Esos 500 son utilidad
 * cambiaria y el contador los necesita separados al cierre.
 *
 * En pagos parciales se compara solo la porción cobrada, no la factura
 * entera: lo que no se ha cobrado todavía no se ha valuado.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Download, Scale } from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function primerDiaDelMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function DiferenciaCambiariaPage() {
  const [desde, setDesde] = useState(primerDiaDelMes());
  const [hasta, setHasta] = useState(hoy());
  const [moneda, setMoneda] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['fx-diff', desde, hasta, moneda],
    queryFn: () => api.getFxDifference({ desde, hasta, moneda: moneda || undefined }),
  });

  const exportarCsv = () => {
    const filas = data?.detalle || [];
    if (!filas.length) return;
    const encabezado = [
      'Serie', 'Folio', 'Cliente', 'Moneda', 'Fecha pago', 'Cobrado',
      'TC factura', 'TC pago', 'Equivalente al facturar', 'Equivalente al cobrar',
      'Diferencia MXN', 'Efecto',
    ];
    const csv = [
      encabezado.join(','),
      ...filas.map((r: any) => [
        r.serie ?? '', r.folio ?? '', `"${(r.cliente || '').replace(/"/g, '""')}"`,
        r.moneda, String(r.payment_date).slice(0, 10), r.cobrado_moneda,
        r.tc_factura, r.tc_pago, r.equivalente_al_facturar, r.equivalente_al_cobrar,
        r.diferencia_mxn, r.efecto,
      ].join(',')),
    ].join('\n');
    // BOM para que Excel en Windows respete los acentos.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `diferencia-cambiaria_${desde}_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const g = data?.global;

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg"><Scale size={24} className="text-indigo-700" /></div>
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Diferencia cambiaria</h1>
            <p className="text-xs text-slate-500">
              Lo que se facturó contra lo que realmente entró, según el tipo de cambio de cada día.
            </p>
          </div>
        </div>
        <button
          onClick={exportarCsv}
          disabled={!data?.detalle?.length}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium"
        >
          <Download size={16} /> Exportar CSV
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs text-slate-500">Desde</span>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="input mt-1" />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">Hasta</span>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="input mt-1" />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">Moneda</span>
          <select value={moneda} onChange={e => setMoneda(e.target.value)} className="input mt-1">
            <option value="">Todas</option>
            <option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
          </select>
        </label>
      </div>

      {/* Totales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="p-4 bg-white rounded-lg border border-emerald-200">
          <div className="flex items-center gap-2 text-emerald-700">
            <TrendingUp size={16} /><span className="text-xs font-medium">Utilidad cambiaria</span>
          </div>
          <p className="mt-1 text-2xl font-semibold text-emerald-800">$ {money(g?.utilidad)}</p>
        </div>
        <div className="p-4 bg-white rounded-lg border border-red-200">
          <div className="flex items-center gap-2 text-red-600">
            <TrendingDown size={16} /><span className="text-xs font-medium">Pérdida cambiaria</span>
          </div>
          <p className="mt-1 text-2xl font-semibold text-red-700">$ {money(Math.abs(Number(g?.perdida || 0)))}</p>
        </div>
        <div className="p-4 bg-white rounded-lg border border-slate-300">
          <span className="text-xs font-medium text-slate-600">Efecto neto</span>
          <p className={`mt-1 text-2xl font-semibold ${
            Number(g?.diferencia || 0) >= 0 ? 'text-emerald-800' : 'text-red-700'
          }`}>
            {Number(g?.diferencia || 0) >= 0 ? '+' : '−'} $ {money(Math.abs(Number(g?.diferencia || 0)))}
          </p>
        </div>
      </div>

      {/* Detalle */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="text-left px-3 py-2">Factura</th>
                <th className="text-left px-3 py-2">Cliente</th>
                <th className="text-left px-3 py-2">Pago</th>
                <th className="text-right px-3 py-2">Cobrado</th>
                <th className="text-right px-3 py-2">T.C. factura</th>
                <th className="text-right px-3 py-2">T.C. pago</th>
                <th className="text-right px-3 py-2">Al facturar</th>
                <th className="text-right px-3 py-2">Al cobrar</th>
                <th className="text-right px-3 py-2">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Cargando…</td></tr>
              )}
              {!isLoading && !data?.detalle?.length && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                  Sin cobros en moneda extranjera en este periodo.
                </td></tr>
              )}
              {(data?.detalle || []).map((r: any) => (
                <tr key={r.payment_id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono">{r.serie}{r.folio}</td>
                  <td className="px-3 py-2 text-slate-600">{r.cliente}</td>
                  <td className="px-3 py-2 font-mono text-xs">{String(r.payment_date).slice(0, 10)}</td>
                  <td className="px-3 py-2 text-right font-mono">{money(r.cobrado_moneda)} {r.moneda}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-slate-500">{Number(r.tc_factura).toFixed(4)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-slate-500">{Number(r.tc_pago).toFixed(4)}</td>
                  <td className="px-3 py-2 text-right font-mono">{money(r.equivalente_al_facturar)}</td>
                  <td className="px-3 py-2 text-right font-mono">{money(r.equivalente_al_cobrar)}</td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold ${
                    r.efecto === 'UTILIDAD' ? 'text-emerald-700'
                    : r.efecto === 'PERDIDA' ? 'text-red-600' : 'text-slate-400'
                  }`}>
                    {Number(r.diferencia_mxn) >= 0 ? '+' : '−'} {money(Math.abs(Number(r.diferencia_mxn)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!!data?.porMoneda?.length && (
        <div className="mt-4 flex flex-wrap gap-3">
          {data.porMoneda.map((m: any) => (
            <div key={m.moneda} className="px-3 py-2 bg-white border border-slate-200 rounded text-xs">
              <span className="font-mono font-semibold">{m.moneda}</span>
              <span className="ml-2 text-slate-500">{m.pagos} pago(s)</span>
              <span className={`ml-2 font-semibold ${
                Number(m.diferencia) >= 0 ? 'text-emerald-700' : 'text-red-600'
              }`}>
                {Number(m.diferencia) >= 0 ? '+' : '−'} $ {money(Math.abs(Number(m.diferencia)))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DiferenciaCambiariaPage;
