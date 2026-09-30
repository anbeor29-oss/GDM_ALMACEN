/**
 * Servicios SAT — hub de trámites/consultas del SAT vía SatGo, en pestañas:
 *   Opinión 32-D · CIF/CSF · Declaraciones · Información Fiscal · Validar CFDI.
 * Las dos primeras reutilizan PanelOpinion (descarga + histórico + Configurar);
 * las tres siguientes son consultas directas a SatGo (CIEC de la empresa, salvo
 * la validación de CFDI que sólo usa el RFC). El IMSS y el INFONAVIT viven en su
 * propia área del menú (orden SAT → IMSS → INFONAVIT).
 */
import { useState } from 'react';
import { Landmark, DownloadCloud, FileSearch, BadgeCheck, AlertTriangle, Loader2 } from 'lucide-react';
import api from '@/services/api';
import { PanelOpinion } from './PanelOpinion';
import { claseOpcion } from '@/utils/coloresOpciones';

const TABS: Array<[string, string]> = [
  ['SAT', 'Opinión 32-D'],
  ['CSF', 'CIF/CSF'],
  ['DEC', 'Declaraciones'],
  ['INFO', 'Información Fiscal'],
  ['CFDI', 'Validar CFDI'],
];

export function ServiciosSatPage() {
  const [tab, setTab] = useState('SAT');
  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Landmark size={22} className="text-primary" /> Servicios SAT
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Opinión 32-D, Constancia de Situación Fiscal, declaraciones, información fiscal y validación de
          comprobantes — obtenidos por SatGo con el RFC y la clave CIEC de la empresa.
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {TABS.map(([k, nombre], i) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 ${claseOpcion(i, tab === k)}`}>{nombre}</button>
        ))}
      </div>

      {tab === 'SAT' && <PanelOpinion tipo="SAT" />}
      {tab === 'CSF' && <PanelOpinion tipo="CSF" />}
      {tab === 'DEC' && <PanelDeclaraciones />}
      {tab === 'INFO' && <PanelInfoFiscal />}
      {tab === 'CFDI' && <PanelValidarCfdi />}
    </div>
  );
}

/* ─────────────────── Declaraciones (ZIP por ejercicio/mes) ─────────────────── */
const MESES = ['Todo el ejercicio', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function PanelDeclaraciones() {
  const anioActual = new Date().getFullYear();
  const anios: number[] = [];
  for (let a = anioActual; a >= 2018; a--) anios.push(a);
  const [ejercicio, setEjercicio] = useState(anioActual);
  const [mes, setMes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const descargar = async () => {
    setBusy(true); setMsg('');
    try { await api.satgoDeclaraciones(ejercicio, mes); setMsg('Descarga iniciada (ZIP).'); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo descargar. Revisa la clave CIEC en la pestaña Opinión 32-D → Configurar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-lg shadow p-5 space-y-4 max-w-xl">
      <p className="text-sm text-gray-600">Descarga en ZIP las declaraciones presentadas del ejercicio y mes elegidos (requiere la clave CIEC).</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="text-xs text-gray-600">Ejercicio</span>
          <select value={ejercicio} onChange={(e) => setEjercicio(Number(e.target.value))} className="input w-full">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select></label>
        <label className="block"><span className="text-xs text-gray-600">Mes</span>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input w-full">
            {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select></label>
      </div>
      <button onClick={descargar} disabled={busy}
        className="flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <DownloadCloud size={15} />} Descargar ZIP
      </button>
      {msg && <p className="text-sm text-gray-700 bg-gray-50 border rounded px-3 py-2">{msg}</p>}
    </div>
  );
}

/* ─────────────────── Información fiscal (JSON) ─────────────────── */
function PanelInfoFiscal() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);

  const consultar = async () => {
    setBusy(true); setError(''); setData(null);
    try { const r: any = await api.satgoInfoFiscal(); setData(r?.data ?? r); }
    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo consultar. Revisa la clave CIEC en la pestaña Opinión 32-D → Configurar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-lg shadow p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-600">Consulta la información fiscal de la empresa registrada en el SAT (régimen, obligaciones, domicilio). Requiere la clave CIEC.</p>
        <button onClick={consultar} disabled={busy}
          className="flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm shrink-0">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <FileSearch size={15} />} Consultar
        </button>
      </div>
      {error && <p className="text-sm text-rose-700 flex items-center gap-1.5"><AlertTriangle size={14} /> {error}</p>}
      {data && (
        <pre className="text-xs bg-gray-50 border rounded p-3 overflow-x-auto max-h-[28rem] whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
}

/* ─────────────────── Validación de CFDI ─────────────────── */
function PanelValidarCfdi() {
  const [f, setF] = useState({ re: '', rr: '', tt: '', id: '', fe: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);
  const set = (k: string) => (e: any) => setF((p) => ({ ...p, [k]: e.target.value }));

  const validar = async () => {
    setBusy(true); setError(''); setData(null);
    try { const r: any = await api.satgoValidarCfdi(f); setData(r?.data ?? r); }
    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo validar el CFDI.'); }
    finally { setBusy(false); }
  };

  // Intenta leer el estado del comprobante de la respuesta (esquema puede variar).
  const estado = data ? String(
    data?.estado || data?.Estado || data?.estatus || data?.estadoComprobante || data?.CodigoEstatus || '',
  ) : '';
  const esVigente = /vigente/i.test(estado);
  const esCancelado = /cancel/i.test(estado);

  return (
    <div className="bg-white rounded-lg shadow p-5 space-y-4 max-w-2xl">
      <p className="text-sm text-gray-600">Consulta el estatus de un CFDI ante el SAT (vigente / cancelado). Sólo usa el RFC de la empresa; no requiere CIEC.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="text-xs text-gray-600">RFC emisor (re)</span>
          <input value={f.re} onChange={set('re')} className="input w-full font-mono uppercase" placeholder="AAA010101AAA" /></label>
        <label className="block"><span className="text-xs text-gray-600">RFC receptor (rr)</span>
          <input value={f.rr} onChange={set('rr')} className="input w-full font-mono uppercase" placeholder="BBB020202BBB" /></label>
        <label className="block"><span className="text-xs text-gray-600">Total (tt)</span>
          <input value={f.tt} onChange={set('tt')} className="input w-full font-mono" placeholder="1160.00" /></label>
        <label className="block"><span className="text-xs text-gray-600">Últimos 8 del sello (fe) — opcional</span>
          <input value={f.fe} onChange={set('fe')} className="input w-full font-mono" placeholder="Xx12Yy34" /></label>
        <label className="block col-span-2"><span className="text-xs text-gray-600">UUID / Folio fiscal (id)</span>
          <input value={f.id} onChange={set('id')} className="input w-full font-mono uppercase" placeholder="12345678-90ab-cdef-1234-567890abcdef" /></label>
      </div>
      <button onClick={validar} disabled={busy}
        className="flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <BadgeCheck size={15} />} Validar
      </button>
      {error && <p className="text-sm text-rose-700 flex items-center gap-1.5"><AlertTriangle size={14} /> {error}</p>}
      {data && (
        <div className="space-y-2">
          {estado && (
            <p className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium ${
              esVigente ? 'bg-emerald-100 text-emerald-700' : esCancelado ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-700'}`}>
              <BadgeCheck size={15} /> {estado}
            </p>
          )}
          <pre className="text-xs bg-gray-50 border rounded p-3 overflow-x-auto max-h-80 whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default ServiciosSatPage;
