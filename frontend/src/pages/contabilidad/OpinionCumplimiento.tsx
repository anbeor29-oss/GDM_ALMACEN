/**
 * Opinión de Cumplimiento — SAT (32-D), IMSS e INFONAVIT.
 *
 * Registra y da seguimiento a las tres opiniones (sentido, fecha, folio y PDF). La
 * más reciente por tipo es la vigente; se guarda el histórico. La descarga en vivo
 * (Buzón/e.firma) es una fase posterior: por ahora se captura lo que se obtiene del
 * portal de cada dependencia.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus, Trash2, FileText, X, Save, AlertTriangle } from 'lucide-react';
import api from '@/services/api';
import { CampoFecha, aTextoMx } from '@/components/CampoFecha';
import { claseOpcion } from '@/utils/coloresOpciones';

const TIPOS: Array<[string, string, string]> = [
  ['SAT', 'SAT (32-D)', 'Opinión del cumplimiento de obligaciones fiscales (Art. 32-D CFF).'],
  ['IMSS', 'IMSS', 'Opinión de cumplimiento de obligaciones en materia de seguridad social.'],
  ['INFONAVIT', 'INFONAVIT', 'Constancia de situación fiscal en materia de aportaciones de vivienda.'],
];
const SENTIDOS: Array<[string, string]> = [
  ['POSITIVA', 'Positiva (al corriente)'],
  ['SIN_ADEUDOS', 'Sin adeudos'],
  ['NEGATIVA', 'Negativa (con adeudos)'],
  ['SUSPENDIDA', 'Suspendida'],
  ['OTRO', 'Otro'],
];
const badgeSentido = (s: string) =>
  s === 'POSITIVA' || s === 'SIN_ADEUDOS' ? 'bg-emerald-100 text-emerald-700'
    : s === 'NEGATIVA' ? 'bg-rose-100 text-rose-700'
    : s === 'SUSPENDIDA' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600';
const etiquetaSentido = (s: string) => (SENTIDOS.find(([k]) => k === s)?.[1] || s);

export function OpinionCumplimientoPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('SAT');
  const [form, setForm] = useState<boolean>(false);
  const [msg, setMsg] = useState('');

  const resumenQ = useQuery({ queryKey: ['opinion-resumen'], queryFn: () => api.getOpinionCumplimiento() });
  const vigentes: any = resumenQ.data?.data?.vigentes || {};
  const histQ = useQuery({ queryKey: ['opinion-hist', tab], queryFn: () => api.getOpinionHistorial(tab) });
  const historial: any[] = histQ.data?.data || [];

  const borrar = async (id: string) => {
    if (!window.confirm('¿Borrar este registro de opinión?')) return;
    try { await api.borrarOpinion(id); qc.invalidateQueries({ queryKey: ['opinion-hist', tab] }); qc.invalidateQueries({ queryKey: ['opinion-resumen'] }); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo borrar.'); }
  };

  const tipoActual = TIPOS.find(([k]) => k === tab)!;

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldCheck size={22} className="text-primary" /> Opinión de Cumplimiento
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          SAT (32-D), IMSS e INFONAVIT — el estado de cumplimiento de la empresa. Registra la opinión que
          obtienes de cada portal; la más reciente es la vigente.
        </p>
      </div>

      {/* Tarjetas resumen de las tres */}
      <div className="grid sm:grid-cols-3 gap-3">
        {TIPOS.map(([k, nombre]) => {
          const v = vigentes[k];
          return (
            <button key={k} onClick={() => setTab(k)}
              className={`text-left rounded-lg border p-3 hover:shadow-sm ${tab === k ? 'ring-2 ring-primary/40 border-primary/30' : ''}`}>
              <p className="text-sm font-semibold text-gray-800">{nombre}</p>
              {v ? (
                <>
                  <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded ${badgeSentido(v.sentido)}`}>{etiquetaSentido(v.sentido)}</span>
                  <p className="text-xs text-gray-500 mt-1">al {aTextoMx(v.fecha_opinion)}</p>
                </>
              ) : (
                <p className="text-xs text-gray-400 mt-1 italic">sin registro</p>
              )}
            </button>
          );
        })}
      </div>

      {/* Pestañas por tipo */}
      <div className="flex gap-1.5 flex-wrap">
        {TIPOS.map(([k, nombre], i) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 ${claseOpcion(i, tab === k)}`}>{nombre}</button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{tipoActual[2]}</p>
        <button onClick={() => setForm(true)}
          className="flex items-center gap-1.5 bg-primary text-white px-3 py-1.5 rounded-lg hover:opacity-90 text-sm">
          <Plus size={15} /> Registrar opinión
        </button>
      </div>
      {msg && <p className="text-sm text-rose-700">{msg}</p>}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Fecha</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Sentido</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Folio</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Observaciones</th>
              <th className="px-4 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {!histQ.isLoading && historial.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500 italic">Sin registros de {tipoActual[1]}. Registra la primera opinión.</td></tr>
            )}
            {historial.map((h) => (
              <tr key={h.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm">{aTextoMx(h.fecha_opinion)}</td>
                <td className="px-4 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${badgeSentido(h.sentido)}`}>{etiquetaSentido(h.sentido)}</span></td>
                <td className="px-4 py-2 text-xs font-mono text-gray-600">{h.folio || '—'}</td>
                <td className="px-4 py-2 text-xs text-gray-500"><p className="truncate max-w-xs">{h.observaciones || ''}</p></td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {h.tiene_pdf && (
                    <button onClick={() => api.verOpinionPdf(h.id).catch(() => setMsg('No se pudo abrir el PDF.'))}
                      className="text-gray-400 hover:text-sky-600 mr-2" title="Ver PDF"><FileText size={15} /></button>
                  )}
                  <button onClick={() => borrar(h.id)} className="text-gray-400 hover:text-rose-500" title="Borrar"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <ModalRegistrar tipo={tab} tipoNombre={tipoActual[1]}
          onCerrar={() => setForm(false)}
          onHecho={() => { setForm(false); qc.invalidateQueries({ queryKey: ['opinion-hist', tab] }); qc.invalidateQueries({ queryKey: ['opinion-resumen'] }); }} />
      )}
    </div>
  );
}

function ModalRegistrar({ tipo, tipoNombre, onCerrar, onHecho }: any) {
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [sentido, setSentido] = useState('POSITIVA');
  const [folio, setFolio] = useState('');
  const [observaciones, setObs] = useState('');
  const [pdf, setPdf] = useState<string>('');
  const [pdfNombre, setPdfNombre] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const leerPdf = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1_600_000) { setError('El PDF es muy grande (máximo ~1.5 MB).'); return; }
    const rd = new FileReader();
    rd.onload = () => { setPdf(String(rd.result || '')); setPdfNombre(f.name); setError(''); };
    rd.readAsDataURL(f);
  };

  const guardar = async () => {
    setBusy(true); setError('');
    try {
      await api.registrarOpinion({ tipo, sentido, fecha_opinion: fecha, folio: folio.trim() || null, observaciones: observaciones.trim() || null, pdf: pdf || null });
      onHecho();
    } catch (e: any) { setError(e?.response?.data?.message || 'No se pudo registrar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-900">Registrar opinión · {tipoNombre}</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs text-gray-600">Fecha de la opinión</span>
              <CampoFecha value={fecha} onChange={setFecha} className="input w-full" /></label>
            <label className="block"><span className="text-xs text-gray-600">Sentido</span>
              <select value={sentido} onChange={(e) => setSentido(e.target.value)} className="input w-full">
                {SENTIDOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></label>
          </div>
          <label className="block"><span className="text-xs text-gray-600">Folio (opcional)</span>
            <input value={folio} onChange={(e) => setFolio(e.target.value)} className="input w-full font-mono" /></label>
          <label className="block"><span className="text-xs text-gray-600">Observaciones (opcional)</span>
            <textarea value={observaciones} onChange={(e) => setObs(e.target.value)} className="input w-full" rows={2} /></label>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => leerPdf(e.target.files?.[0])} />
            <span className="inline-flex items-center gap-1.5 border rounded-lg px-3 py-1.5 hover:bg-gray-50"><FileText size={14} /> Adjuntar PDF (opcional)</span>
            <span className="text-xs text-gray-400 truncate">{pdfNombre || '.pdf ≤ 1.5 MB'}</span>
          </label>
          {error && <p className="text-sm text-rose-700 flex items-center gap-1.5"><AlertTriangle size={14} /> {error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onCerrar} className="px-3 py-1.5 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button onClick={guardar} disabled={busy}
              className="flex items-center gap-1.5 bg-primary text-white px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
              <Save size={15} /> {busy ? 'Guardando…' : 'Registrar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OpinionCumplimientoPage;
