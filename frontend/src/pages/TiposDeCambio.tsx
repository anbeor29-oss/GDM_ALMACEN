/**
 * TiposDeCambio — panel del servicio central de tipos de cambio.
 *
 * Dos cosas que el usuario necesita poder hacer sin llamar a nadie:
 *   1. Ver si el tipo de cambio de hoy ya entró (y si no, por qué).
 *   2. Capturarlo a mano cuando Banxico no respondió, para no quedarse sin
 *      poder facturar en dólares.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Save, Coins, AlertTriangle, CheckCircle2 } from 'lucide-react';
import api from '@/services/api';
import { CampoFecha } from '@/components/CampoFecha';

const EXTRANJERAS = ['USD', 'EUR', 'GBP'] as const;
const NOMBRE: Record<string, string> = {
  MXN: 'Peso mexicano', USD: 'Dólar americano', EUR: 'Euro', GBP: 'Libra esterlina',
};

function hoyMexico(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function TiposDeCambioPage() {
  const qc = useQueryClient();
  const [moneda, setMoneda] = useState<string>('USD');
  const [fecha, setFecha] = useState(hoyMexico());
  const [valor, setValor] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const cuadro = useQuery({ queryKey: ['tc'], queryFn: () => api.getExchangeRates() });
  const historia = useQuery({
    queryKey: ['tc-hist', moneda],
    queryFn: () => api.getExchangeRateHistory(moneda, 30),
  });
  const bitacora = useQuery({ queryKey: ['tc-log'], queryFn: () => api.getExchangeRateLog(20) });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['tc'] });
    qc.invalidateQueries({ queryKey: ['tc-hist'] });
    qc.invalidateQueries({ queryKey: ['tc-log'] });
  };

  const actualizar = useMutation({
    mutationFn: () => api.updateExchangeRates(),
    onSuccess: (r: any) => {
      setAviso(r.fallidas?.length
        ? { tipo: 'error', texto: `No se pudo actualizar: ${r.fallidas.map((f: any) => `${f.moneda} (${f.error})`).join(', ')}` }
        : { tipo: 'ok', texto: `${r.actualizadas.length} monedas actualizadas desde Banxico` });
      refrescar();
    },
    onError: (e: any) => setAviso({
      tipo: 'error',
      texto: e?.response?.data?.error || e?.message || 'No se pudo consultar Banxico',
    }),
  });

  const guardarManual = useMutation({
    mutationFn: () => api.setExchangeRateManual(moneda, fecha, Number(valor)),
    onSuccess: () => {
      setAviso({ tipo: 'ok', texto: `${moneda} guardado para el ${fecha}` });
      setValor('');
      refrescar();
    },
    onError: (e: any) => setAviso({
      tipo: 'error',
      texto: e?.response?.data?.error || e?.message || 'No se pudo guardar',
    }),
  });

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-lg"><Coins size={24} className="text-emerald-700" /></div>
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Tipos de cambio</h1>
            <p className="text-xs text-slate-500">
              Valor del DOF, el que pide el SAT: el que Banxico determinó el día hábil anterior.
            </p>
          </div>
        </div>
        <button
          onClick={() => actualizar.mutate()}
          disabled={actualizar.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium"
        >
          <RefreshCw size={16} className={actualizar.isPending ? 'animate-spin' : ''} />
          {actualizar.isPending ? 'Consultando…' : 'Actualizar desde Banxico'}
        </button>
      </div>

      {aviso && (
        <div className={`mb-4 p-3 rounded border text-sm flex items-start gap-2 ${
          aviso.tipo === 'ok'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {aviso.tipo === 'ok' ? <CheckCircle2 size={16} className="mt-0.5" /> : <AlertTriangle size={16} className="mt-0.5" />}
          <span>{aviso.texto}</span>
        </div>
      )}

      {/* Cuadro de las cuatro monedas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        {(cuadro.data?.items || []).map((t: any) => (
          <div key={t.moneda} className={`p-4 bg-white rounded-lg border ${
            t.error ? 'border-red-200' : t.vigente ? 'border-emerald-200' : 'border-amber-200'
          }`}>
            <div className="flex items-baseline justify-between">
              <span className="font-mono font-semibold text-slate-800">{t.moneda}</span>
              <span className="text-[11px] text-slate-400">{NOMBRE[t.moneda]}</span>
            </div>
            {t.error ? (
              <p className="mt-2 text-xs text-red-600">Sin registrar</p>
            ) : (
              <>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{Number(t.valor).toFixed(4)}</p>
                <p className={`text-[11px] ${t.vigente ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {t.vigente ? 'Vigente hoy' : `Arrastrado del ${t.fecha}`} · {t.fuente}
                </p>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Captura manual */}
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">Captura manual</h2>
          <p className="text-[11px] text-slate-500 mb-3">
            Para cuando Banxico no respondió. Lo capturado aquí gana sobre lo automático de esa fecha.
          </p>
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-slate-500">Moneda</span>
              <select value={moneda} onChange={e => setMoneda(e.target.value)} className="input mt-1">
                {EXTRANJERAS.map(m => <option key={m} value={m}>{m} — {NOMBRE[m]}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Fecha en que rige</span>
              <CampoFecha value={fecha} onChange={setFecha} className="input mt-1" />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Pesos por 1 {moneda}</span>
              <input
                type="number" step="0.000001" value={valor}
                onChange={e => setValor(e.target.value)}
                placeholder="17.523100" className="input mt-1 font-mono"
              />
            </label>
            <button
              onClick={() => guardarManual.mutate()}
              disabled={guardarManual.isPending || !valor || Number(valor) <= 0}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium"
            >
              <Save size={16} /> Guardar
            </button>
          </div>
        </div>

        {/* Histórico */}
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Histórico de {moneda}</h2>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500 border-b border-slate-200">
                <tr><th className="text-left py-1">Rige</th><th className="text-right">Valor</th><th className="text-left pl-2">Fuente</th></tr>
              </thead>
              <tbody>
                {(historia.data?.items || []).map((h: any, i: number) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="py-1 font-mono">{h.fecha}</td>
                    <td className="text-right font-mono">{Number(h.valor).toFixed(4)}</td>
                    <td className="pl-2 text-slate-400">{h.fuente}</td>
                  </tr>
                ))}
                {!historia.data?.items?.length && (
                  <tr><td colSpan={3} className="py-3 text-slate-400 text-center">Sin registros</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bitácora */}
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">Bitácora</h2>
          <p className="text-[11px] text-slate-500 mb-3">Qué pasó en cada intento de actualización.</p>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {(bitacora.data?.items || []).map((l: any, i: number) => (
              <div key={i} className="text-[11px] border-b border-slate-50 pb-1.5">
                <span className={`font-mono font-semibold ${
                  l.resultado === 'OK' ? 'text-emerald-700'
                  : l.resultado === 'ERROR' ? 'text-red-600' : 'text-amber-700'
                }`}>{l.resultado}</span>
                <span className="ml-1.5 font-mono text-slate-600">{l.moneda || '—'}</span>
                <span className="ml-1.5 text-slate-400">{l.origen}</span>
                <p className="text-slate-500">{l.detalle}</p>
              </div>
            ))}
            {!bitacora.data?.items?.length && (
              <p className="text-xs text-slate-400">Sin movimientos</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TiposDeCambioPage;
