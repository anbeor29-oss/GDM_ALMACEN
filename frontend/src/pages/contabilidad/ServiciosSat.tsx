/**
 * Servicios SAT — hub de trámites/consultas del SAT vía SatGo, en pestañas:
 *   Opinión 32-D · CIF/CSF · Declaraciones · Información Fiscal · Validar CFDI.
 * Las dos primeras reutilizan PanelOpinion (descarga + histórico + Configurar);
 * las tres siguientes son consultas directas a SatGo (CIEC de la empresa, salvo
 * la validación de CFDI que sólo usa el RFC). El IMSS y el INFONAVIT viven en su
 * propia área del menú (orden SAT → IMSS → INFONAVIT).
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Landmark, FileSearch, BadgeCheck, AlertTriangle, Loader2, FileText } from 'lucide-react';
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

/** Abre un documento (data-URL base64) en pestaña nueva vía blob (mejor que data: directo). */
function abrirDoc(dataUrl: string) {
  try {
    const [meta, b64] = dataUrl.split(',');
    const mime = meta.match(/data:(.*?);/)?.[1] || 'application/pdf';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: mime }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch { /* noop */ }
}

export function ServiciosSatPage() {
  const [tab, setTab] = useState('SAT');
  // Estado de las opiniones (para el círculo de actualización en 32-D y CIF).
  const configQ = useQuery({ queryKey: ['cumpl-config'], queryFn: () => api.getConfigCumplimiento() });
  const cfgs: any = configQ.data?.data?.configs || {};

  const dot = (k: string) => {
    if (k !== 'SAT' && k !== 'CSF') return null;
    const c = cfgs[k] || {};
    const ok = c.ultimo_estado === 'SUCCESS';
    const activo = !!c.activo;
    if (!ok && !activo) return null;
    const titulo = ok
      ? `Última descarga correcta${c.ultima_ejecucion ? ' · ' + c.ultima_ejecucion : ''}`
      : 'Actualización automática activa (domingos)';
    return <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-emerald-500/40'}`} title={titulo} />;
  };

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
            className={`inline-flex items-center gap-1.5 ${claseOpcion(i, tab === k)}`}>
            {nombre}{dot(k)}
          </button>
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

/* ═══════════════ Declaraciones — cuadrícula año × mes ═══════════════ */
const MESES_ABBR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
type CeldaEstado = { estado: 'cargando' | 'listo' | 'error'; archivos?: any[]; error?: string };

function PanelDeclaraciones() {
  const anioActual = new Date().getFullYear();
  const anios: number[] = [];
  for (let a = anioActual; a >= 2018; a--) anios.push(a);
  const [celdas, setCeldas] = useState<Record<string, CeldaEstado>>({});
  const [sel, setSel] = useState<string | null>(null);

  const cargar = async (anio: number, mes: number) => {
    const key = `${anio}-${mes}`;
    setSel(key);
    if (celdas[key]?.estado === 'listo' || celdas[key]?.estado === 'cargando') return;
    setCeldas((p) => ({ ...p, [key]: { estado: 'cargando' } }));
    try {
      const r: any = await api.satgoDeclaracionesContenido(anio, mes);
      const archivos = r?.data?.archivos || [];
      setCeldas((p) => ({ ...p, [key]: { estado: 'listo', archivos } }));
    } catch (e: any) {
      setCeldas((p) => ({ ...p, [key]: { estado: 'error', error: e?.response?.data?.message || 'No se pudo.' } }));
    }
  };

  const celda = (anio: number, mes: number) => {
    const key = `${anio}-${mes}`;
    const c = celdas[key];
    const activa = sel === key;
    let contenido: ReactNode = <span className="text-gray-300">·</span>;
    if (c?.estado === 'cargando') contenido = <Loader2 size={13} className="animate-spin text-primary mx-auto" />;
    else if (c?.estado === 'error') contenido = <span className="text-rose-500" title={c.error}>!</span>;
    else if (c?.estado === 'listo') contenido = c.archivos?.length
      ? <span className="inline-flex items-center gap-0.5 text-emerald-700"><FileText size={11} />{c.archivos.length}</span>
      : <span className="text-gray-300" title="Sin declaraciones en el periodo">—</span>;
    return (
      <td key={mes} className="p-0.5">
        <button onClick={() => cargar(anio, mes)}
          className={`w-full h-8 rounded text-xs flex items-center justify-center border transition
            ${activa ? 'border-primary ring-1 ring-primary/40' : 'border-gray-100 hover:border-primary/40 hover:bg-primary/5'}`}>
          {contenido}
        </button>
      </td>
    );
  };

  const detalle = sel ? celdas[sel] : undefined;
  const [selAnio, selMes] = sel ? sel.split('-').map(Number) : [0, 0];

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Cuadrícula de declaraciones presentadas: <b>años en vertical, meses en horizontal</b>. Da clic en una celda
        para traer y <b>descomprimir</b> su declaración (SatGo con CIEC). El número indica cuántos documentos trae.
      </p>
      <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-1.5 flex items-start gap-1.5">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> Cada celda consulta a SatGo (consume cuota del plan). La columna
        <b> Anual</b> trae todo el ejercicio en una sola consulta.
      </p>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="text-center border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="px-3 py-2 text-xs font-semibold text-gray-600 text-left sticky left-0 bg-gray-50">Año</th>
              {MESES_ABBR.map((m) => <th key={m} className="px-1 py-2 text-[11px] font-semibold text-gray-500 w-12">{m}</th>)}
              <th className="px-1 py-2 text-[11px] font-semibold text-gray-500 w-12">Anual</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {anios.map((a) => (
              <tr key={a} className="hover:bg-gray-50/50">
                <td className="px-3 py-1 text-sm font-medium text-gray-700 text-left sticky left-0 bg-white">{a}</td>
                {MESES_ABBR.map((_, i) => celda(a, i + 1))}
                {celda(a, 0)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sel && (
        <div className="bg-white rounded-lg shadow p-4 space-y-2">
          <h4 className="text-sm font-semibold text-gray-800">
            {selMes === 0 ? `Declaraciones ${selAnio} (todo el ejercicio)` : `${MESES_ABBR[selMes - 1]} ${selAnio}`}
          </h4>
          {detalle?.estado === 'cargando' && <p className="text-sm text-gray-500 flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Descargando y descomprimiendo…</p>}
          {detalle?.estado === 'error' && <p className="text-sm text-rose-700 flex items-center gap-1.5"><AlertTriangle size={14} /> {detalle.error}</p>}
          {detalle?.estado === 'listo' && (detalle.archivos?.length
            ? <ul className="divide-y">
                {detalle.archivos.map((f: any, i: number) => (
                  <li key={i} className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-gray-700 flex items-center gap-1.5 truncate"><FileText size={14} className={f.esPdf ? 'text-rose-500' : 'text-gray-400'} /> {f.nombre}</span>
                    <button onClick={() => abrirDoc(f.base64)} className="text-xs text-primary hover:underline shrink-0 ml-3">Abrir</button>
                  </li>
                ))}
              </ul>
            : <p className="text-sm text-gray-500 italic">Sin declaraciones presentadas en este periodo.</p>)}
        </div>
      )}
    </div>
  );
}

/* ═══════════════ Información fiscal — vista legible ═══════════════ */
const LBL: Record<string, string> = {
  rfc: 'RFC', nombre: 'Nombre / Razón social', curp: 'CURP', situacion: 'Situación',
  detalleSituacion: 'Detalle de situación', fechaSituacion: 'Fecha de situación', fechaNacimiento: 'Fecha de nacimiento',
  fecha: 'Fecha de consulta', hora: 'Hora', ubicacionFiscal: 'Domicilio fiscal', datosIdentificacion: 'Identificación',
  regimenes: 'Regímenes', regimenesFiscales: 'Regímenes fiscales', obligaciones: 'Obligaciones',
  actividadesEconomicas: 'Actividades económicas', estatusDomicilio: 'Estatus del domicilio',
  estatusContribuyenteEnDomicilio: 'Estatus del contribuyente', fechaAltaDomicilio: 'Alta del domicilio',
  entidadFederativa: 'Entidad federativa', municipioDemarcacionTerritorial: 'Municipio / Demarcación',
  localidad: 'Localidad', colonia: 'Colonia', nombreVialidad: 'Vialidad', numeroExterior: 'No. exterior',
  numeroInterior: 'No. interior', entreCalle: 'Entre calle', yCalle: 'y calle', tipoVialidad: 'Tipo de vialidad',
  codigoPostal: 'Código postal', tipoInmueble: 'Tipo de inmueble', telefonoFijo: 'Teléfono fijo',
  telefonoMovil: 'Teléfono móvil', ad: 'Administración', correoElectronico: 'Correo electrónico',
};
const etiqueta = (k: string) => LBL[k] || k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const fmt = (v: any) => v === true ? 'Sí' : v === false ? 'No' : (v == null || v === '') ? '—' : String(v);
const esEscalar = (v: any) => v == null || typeof v !== 'object';

function domicilioLinea(u: any): string {
  const p: string[] = [];
  const via = [u.tipoVialidad, u.nombreVialidad].filter(Boolean).join(' ');
  if (via) p.push(via);
  if (u.numeroExterior) p.push('No. ' + u.numeroExterior);
  if (u.numeroInterior) p.push('Int. ' + u.numeroInterior);
  if (u.colonia) p.push('Col. ' + u.colonia);
  if (u.codigoPostal) p.push('C.P. ' + u.codigoPostal);
  const mun = u.municipioDemarcacionTerritorial || u.localidad;
  if (mun) p.push(mun);
  if (u.entidadFederativa) p.push(u.entidadFederativa);
  return p.join(', ');
}

function Campos({ obj }: { obj: any }) {
  const ent = Object.entries(obj).filter(([, v]) => esEscalar(v));
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
      {ent.map(([k, v]) => (
        <div key={k}>
          <p className="text-[11px] text-gray-400">{etiqueta(k)}</p>
          <p className="text-sm text-gray-800 break-words">{fmt(v)}</p>
        </div>
      ))}
    </div>
  );
}

function Tabla({ filas }: { filas: any[] }) {
  if (!filas.length) return <p className="text-sm text-gray-400 italic">—</p>;
  if (esEscalar(filas[0])) return <p className="text-sm text-gray-800">{filas.map(fmt).join(', ')}</p>;
  const cols = Array.from(new Set(filas.flatMap((f) => Object.keys(f))));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b">{cols.map((c) => <th key={c} className="px-2 py-1 text-left text-[11px] font-semibold text-gray-500">{etiqueta(c)}</th>)}</tr></thead>
        <tbody className="divide-y">
          {filas.map((f, i) => <tr key={i}>{cols.map((c) => <td key={c} className="px-2 py-1 text-gray-700">{fmt(f[c])}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function VistaInfoFiscal({ data }: { data: any }) {
  const entries = Object.entries(data || {});
  const objetos = entries.filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
  const arreglos = entries.filter(([, v]) => Array.isArray(v));
  const hayEscalarRaiz = entries.some(([, v]) => esEscalar(v));
  // Encabezado: busca rfc/nombre/situación en raíz y en objetos de primer nivel.
  const todos: any = { ...data };
  for (const [, v] of objetos) Object.assign(todos, v);
  const situacion = todos.situacion || todos.detalleSituacion;
  const activo = /activo/i.test(String(situacion || ''));

  return (
    <div className="space-y-3">
      {(todos.rfc || todos.nombre) && (
        <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-lg font-bold text-gray-900">{todos.nombre || '—'}</p>
            <p className="text-sm font-mono text-gray-500">{todos.rfc || ''}</p>
          </div>
          {situacion && <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${activo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{fmt(situacion)}</span>}
        </div>
      )}

      {hayEscalarRaiz && (
        <div className="bg-white rounded-lg shadow p-4">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Datos generales</h4>
          <Campos obj={Object.fromEntries(entries.filter(([, v]) => esEscalar(v)))} />
        </div>
      )}

      {objetos.map(([k, v]) => (
        <div key={k} className="bg-white rounded-lg shadow p-4 space-y-2">
          <h4 className="text-sm font-semibold text-gray-800">{etiqueta(k)}</h4>
          {/rfc$|domicili|ubicacion/i.test(k) && domicilioLinea(v as any) && (
            <p className="text-sm text-gray-700 bg-gray-50 border rounded px-3 py-1.5">{domicilioLinea(v as any)}</p>
          )}
          <Campos obj={v} />
        </div>
      ))}

      {arreglos.map(([k, v]) => (
        <div key={k} className="bg-white rounded-lg shadow p-4 space-y-2">
          <h4 className="text-sm font-semibold text-gray-800">{etiqueta(k)}</h4>
          <Tabla filas={v as any[]} />
        </div>
      ))}
    </div>
  );
}

function PanelInfoFiscal() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);
  const [verJson, setVerJson] = useState(false);

  const consultar = async () => {
    setBusy(true); setError(''); setData(null);
    try { const r: any = await api.satgoInfoFiscal(); setData(r?.data ?? r); }
    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo consultar. Revisa la clave CIEC en la pestaña Opinión 32-D → Configurar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between gap-2">
        <p className="text-sm text-gray-600">Información fiscal de la empresa en el SAT (identidad, domicilio, régimen y obligaciones). Requiere la clave CIEC.</p>
        <div className="flex items-center gap-2 shrink-0">
          {data && <button onClick={() => setVerJson((v) => !v)} className="text-xs text-gray-500 hover:underline">{verJson ? 'Ver formato' : 'Ver JSON'}</button>}
          <button onClick={consultar} disabled={busy}
            className="flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FileSearch size={15} />} Consultar
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-center gap-1.5"><AlertTriangle size={14} /> {error}</p>}
      {data && (verJson
        ? <pre className="text-xs bg-gray-50 border rounded p-3 overflow-x-auto max-h-[30rem] whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>
        : <VistaInfoFiscal data={data} />)}
    </div>
  );
}

/* ═══════════════ Validación de CFDI ═══════════════ */
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
