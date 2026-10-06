/**
 * XmlDelSat — TODO el XML del SAT en UNA sola pantalla, con pestañas arriba
 * (mismo patrón que Tesorería), no como un menú que se despliega hacia abajo.
 *
 *   Descarga    → "XML del SAT": pedir al SAT, cupo del día, trabajos.
 *   Emitidos    → la tabla de emitidos (con su representación impresa).
 *   Recibidos   → la tabla de recibidos (ficha de metadatos; el SAT no da su XML).
 *   Calendario  → cobertura por día (emitidos + recibidos) y llenar huecos.
 *
 * Las pestañas siguen siendo rutas reales (/xml-sat, /xml-sat/emitidos, …) para
 * que los enlaces directos y el botón «atrás» del navegador funcionen; el sidebar
 * ya sólo trae una entrada «XML» que cae en la de Descarga.
 */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Download, Archive } from 'lucide-react';
import { XmlRecibidos } from '@/components/XmlRecibidos';
import { ProgramacionSat } from '@/components/ProgramacionSat';
import { TablaComprobantesSat } from '@/components/TablaComprobantesSat';
import { CalendarioSatPage } from '@/pages/CalendarioSat';
import { aniosContables } from '@/utils/anios';
import { claseOpcion } from '@/utils/coloresOpciones';
import api from '@/services/api';

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

type Tab = 'descarga' | 'comprobantes' | 'respaldo';
type Sub = 'emitidos' | 'recibidos' | 'calendario';

/* [clave, etiqueta, ruta] — la ruta mantiene la pestaña enlazable.
 * Emitidos + Recibidos + Calendario se unieron en «Comprobantes» (una sola vista,
 * con un control interno), para no tener la información regada en 3 pestañas. */
const TABS: Array<[Tab, string, string]> = [
  ['descarga',     'Descarga',     '/xml-sat'],
  ['comprobantes', 'Comprobantes', '/xml-sat/recibidos'],
  ['respaldo',     'Respaldo',     '/xml-sat/respaldo'],
];
/* Sub-vistas dentro de «Comprobantes»; cada una conserva su ruta propia. */
const SUBS: Array<[Sub, string, string]> = [
  ['recibidos',  'Recibidos',  '/xml-sat/recibidos'],
  ['emitidos',   'Emitidos',   '/xml-sat/emitidos'],
  ['calendario', 'Calendario', '/xml-sat/calendario'],
];

export function XmlDelSatPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const esComprobante = pathname.endsWith('/emitidos') || pathname.endsWith('/recibidos') || pathname.endsWith('/calendario');
  const tab: Tab =
    pathname.endsWith('/respaldo') ? 'respaldo' :
    esComprobante ? 'comprobantes' :
    'descarga';
  const sub: Sub =
    pathname.endsWith('/emitidos')   ? 'emitidos'   :
    pathname.endsWith('/calendario') ? 'calendario' :
    'recibidos';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Download size={24} className="text-emerald-600" /> XML del SAT
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Todo el XML del SAT en una pantalla: pide la descarga, consulta los comprobantes
          (emitidos, recibidos y su calendario de cobertura) y baja el respaldo.
        </p>
      </div>

      {/* Pestañas arriba (mismo patrón que Tesorería). */}
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map(([k, label, to], i) => (
          <button key={k} onClick={() => navigate(to)} className={claseOpcion(i, tab === k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'descarga' && (<>
        {/* Cómo va de verdad, el cupo del día y el histórico. */}
        <ProgramacionSat />
        {/* La maquinaria de descarga (credencial, pedir el periodo, trabajos). */}
        <XmlRecibidos direccionInicial="recibidos" />
      </>)}

      {tab === 'comprobantes' && (<>
        {/* Control interno: emitidos / recibidos / calendario, en una sola vista. */}
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
          {SUBS.map(([k, label, to]) => (
            <button key={k} onClick={() => navigate(to)}
              className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
                sub === k ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}>
              {label}
            </button>
          ))}
        </div>
        {sub === 'emitidos'   && <TablaComprobantesSat direccion="emitidos" />}
        {sub === 'recibidos'  && <TablaComprobantesSat direccion="recibidos" />}
        {sub === 'calendario' && <CalendarioSatPage />}
      </>)}

      {tab === 'respaldo' && <RespaldoXml />}
    </div>
  );
}

/* ── Respaldo: descarga un ZIP con TODOS los XML almacenados (la fuente de la
 *    verdad): emitidos y recibidos, en carpetas, con manifiesto. ── */
function RespaldoXml() {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(0);
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const descargar = async () => {
    setBusy(true); setMsg('');
    try { await api.descargarRespaldoXml(anio, mes || undefined, dir || undefined); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo generar el respaldo.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3 max-w-2xl">
      <div className="flex items-start gap-2">
        <Archive size={18} className="text-emerald-600 mt-0.5 shrink-0" />
        <div>
          <h2 className="font-semibold text-gray-800">Respaldo de XML</h2>
          <p className="text-sm text-gray-500">
            Descarga un ZIP con los CFDI almacenados —la fuente de la verdad—: emitidos y
            recibidos, en carpetas y con un manifiesto. Elige el periodo y la dirección.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-[11px] text-gray-600 block">Año</label>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input text-sm">
            {aniosContables().map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-gray-600 block">Mes</label>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input text-sm">
            <option value={0}>Todo el año</option>
            {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-gray-600 block">Dirección</label>
          <select value={dir} onChange={(e) => setDir(e.target.value)} className="input text-sm">
            <option value="">Emitidos y recibidos</option>
            <option value="emitidos">Solo emitidos</option>
            <option value="recibidos">Solo recibidos</option>
          </select>
        </div>
        <button onClick={descargar} disabled={busy}
          className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
          <Download size={15} /> {busy ? 'Generando…' : 'Descargar respaldo (.zip)'}
        </button>
      </div>
      {msg && <p className="text-sm text-rose-600">{msg}</p>}
    </div>
  );
}

export default XmlDelSatPage;
