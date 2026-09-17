/**
 * Indicadores económicos — INPC, UMA, salarios mínimos y UMI en un solo lugar.
 *
 *   · INPC: se ACTUALIZA SOLO desde la API del INEGI (botón). Es mensual y es de
 *     la contabilidad/fiscal (actualización de contribuciones, recargos).
 *   · UMA / SM / UMI / Tarifa Art. 96: se muestran de sólo lectura; se editan y
 *     confirman en Nómina → Parámetros (son anuales y no tienen API limpia).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, RefreshCw, Landmark, ExternalLink, AlertTriangle, CheckCircle2 } from 'lucide-react';
import api from '@/services/api';

const MESES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const money = (n: any) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const num = (n: any) => n === null || n === undefined ? '—' : Number(n).toLocaleString('es-MX', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function IndicadoresPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const q = useQuery({ queryKey: ['indicadores'], queryFn: () => api.getIndicadores() });
  const d: any = q.data?.data || {};
  const inpcQ = useQuery({ queryKey: ['inpc-serie'], queryFn: () => api.getInpcSerie(24) });
  const serie: any[] = inpcQ.data?.data || [];

  const actualizar = async () => {
    setBusy(true); setMsg('');
    try {
      const r: any = await api.actualizarInpc();
      const x = r?.data || {};
      setMsg(`INPC actualizado: ${x.actualizados} periodo(s) (${x.desde} → ${x.hasta}).`);
      qc.invalidateQueries({ queryKey: ['indicadores'] });
      qc.invalidateQueries({ queryKey: ['inpc-serie'] });
    } catch (e: any) {
      setMsg(e?.response?.data?.message || e?.message || 'No se pudo actualizar el INPC.');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <TrendingUp size={22} className="text-primary" /> Indicadores económicos
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          INPC, UMA, salarios mínimos y UMI. El INPC se baja solo del INEGI; los demás se
          capturan una vez al año en Nómina → Parámetros.
        </p>
      </div>

      {msg && <p className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded px-3 py-2">{msg}</p>}

      {/* ── INPC ── */}
      <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-gray-800">INPC — Índice Nacional de Precios al Consumidor</h2>
          <div className="ml-auto flex items-center gap-2">
            {d.tieneToken === false && (
              <span className="text-xs text-amber-700 flex items-center gap-1" title="Registra un token gratuito del INEGI y ponlo en INEGI_TOKEN (Render)">
                <AlertTriangle size={13} /> Falta el token del INEGI
              </span>
            )}
            <button onClick={actualizar} disabled={busy}
              className="flex items-center gap-1.5 bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 disabled:opacity-50 text-sm">
              <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> {busy ? 'Actualizando…' : 'Actualizar desde INEGI'}
            </button>
          </div>
        </div>

        {d.inpc ? (
          <p className="text-sm text-gray-700">
            Último dato: <b>{MESES[d.inpc.mes]} {d.inpc.anio}</b> = <b>{num(d.inpc.valor)}</b>
            <span className="text-gray-400"> (base 2ª quincena julio 2018 = 100)</span>
          </p>
        ) : (
          <p className="text-sm text-gray-500 italic">Todavía no hay serie del INPC. Dale «Actualizar desde INEGI».</p>
        )}

        {serie.length > 0 && (
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead className="text-xs text-gray-500">
                <tr><th className="px-2 py-1 text-left">Periodo</th><th className="px-2 py-1 text-right">INPC</th><th className="px-2 py-1 text-left">Fuente</th></tr>
              </thead>
              <tbody className="divide-y">
                {serie.slice(0, 24).map((s) => (
                  <tr key={`${s.anio}-${s.mes}`}>
                    <td className="px-2 py-1 whitespace-nowrap">{MESES[s.mes]} {s.anio}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{num(s.valor)}</td>
                    <td className="px-2 py-1 text-xs text-gray-400">{s.fuente}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── UMA / SM / UMI / ISR (de sólo lectura) ── */}
      <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Landmark size={17} className="text-emerald-600" />
          <h2 className="font-semibold text-gray-800">UMA, salarios mínimos, UMI y tarifa del Art. 96</h2>
          <a href="/nomina/parametros" className="ml-auto text-sm text-primary hover:underline flex items-center gap-1">
            Editar en Nómina → Parámetros <ExternalLink size={13} />
          </a>
        </div>
        <p className="text-xs text-gray-500">
          Son anuales (UMA 1-feb · salarios mínimos y UMI 1-ene) y sin API pública limpia, así que se
          capturan y se confirman a mano una vez al año. Aquí se muestran para tenerlos a la vista.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-2 py-1.5 text-left">Año</th>
                <th className="px-2 py-1.5 text-right">UMA diaria</th>
                <th className="px-2 py-1.5 text-right">UMA mensual</th>
                <th className="px-2 py-1.5 text-right">SM general</th>
                <th className="px-2 py-1.5 text-right">SM frontera</th>
                <th className="px-2 py-1.5 text-right">UMI diaria</th>
                <th className="px-2 py-1.5 text-center">Tarifa ISR</th>
                <th className="px-2 py-1.5 text-center">Confirmado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(d.ejercicios || []).length === 0 && (
                <tr><td colSpan={8} className="px-2 py-4 text-center text-gray-500 italic">Sin ejercicios de nómina cargados.</td></tr>
              )}
              {(d.ejercicios || []).map((e: any) => (
                <tr key={e.anio}>
                  <td className="px-2 py-1.5 font-medium">{e.anio}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(e.umaDiaria)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(e.umaMensual)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(e.smgGeneral)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(e.smgFrontera)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(e.umiDiaria)}</td>
                  <td className="px-2 py-1.5 text-center text-xs">{e.renglonesIsr > 0 ? `${e.renglonesIsr} renglones` : '—'}</td>
                  <td className="px-2 py-1.5 text-center">
                    {e.confirmado
                      ? <CheckCircle2 size={15} className="inline text-emerald-600" />
                      : <AlertTriangle size={15} className="inline text-amber-500" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default IndicadoresPage;
