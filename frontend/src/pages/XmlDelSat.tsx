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
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { Download, Archive, Users, TrendingUp, TrendingDown, Loader2, AlertTriangle } from 'lucide-react';
import { XmlRecibidos } from '@/components/XmlRecibidos';
import { ProgramacionSat } from '@/components/ProgramacionSat';
import { TablaComprobantesSat } from '@/components/TablaComprobantesSat';
import { CalendarioSatPage } from '@/pages/CalendarioSat';
import { aniosContables } from '@/utils/anios';
import { claseOpcion } from '@/utils/coloresOpciones';
import api from '@/services/api';

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

type Tab = 'descarga' | 'comprobantes' | 'nominapf' | 'respaldo';
type Sub = 'emitidos' | 'recibidos' | 'calendario';

/* [clave, etiqueta, ruta] — la ruta mantiene la pestaña enlazable.
 * Emitidos + Recibidos + Calendario se unieron en «Comprobantes» (una sola vista,
 * con un control interno), para no tener la información regada en 3 pestañas. */
const TABS: Array<[Tab, string, string]> = [
  ['descarga',     'Descarga',     '/xml-sat'],
  ['comprobantes', 'Comprobantes', '/xml-sat/recibidos'],
  ['nominapf',     'Persona física', '/xml-sat/nomina-pf'],
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
    pathname.endsWith('/nomina-pf') ? 'nominapf' :
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

      {tab === 'nominapf' && <NominaPFPanel />}

      {tab === 'respaldo' && <RespaldoXml />}
    </div>
  );
}

/* ── Persona física: la foto fiscal desde sus XML. La nómina que RECIBE (sueldos/
 *    asimilados, con su ISR/IMSS) son ingresos; lo que EMITE (tipo I) es ingreso
 *    facturado; lo que RECIBE como gasto (tipo I) es egreso. Todo sale de la bóveda
 *    (`cfdi_recibidos`), sin volver a ir al SAT. ── */
const money = (n: any) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const CLASE_NOM: Record<string, { label: string; cls: string }> = {
  sueldos: { label: 'Sueldos', cls: 'bg-emerald-100 text-emerald-700' },
  asimilados: { label: 'Asimilados', cls: 'bg-sky-100 text-sky-700' },
  jubilacion: { label: 'Jubilación', cls: 'bg-amber-100 text-amber-700' },
  otro: { label: 'Otro', cls: 'bg-gray-100 text-gray-600' },
};

function NominaPFPanel() {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [mes, setMes] = useState(0);   // 0 = todo el año (para el detalle)
  const rq = useQuery({ queryKey: ['pf-resumen', anio], queryFn: () => api.getResumenPF(anio) });
  const dq = useQuery({ queryKey: ['pf-nomina', anio, mes], queryFn: () => api.getNominaPF(anio, mes) });
  const r: any = rq.data?.data;
  const det: any[] = dq.data?.data || [];
  const t = r?.totales;

  const exportarCsv = () => {
    const cols = ['Fecha', 'Emisor', 'RFC', 'Clase', 'Percepciones', 'Gravado', 'Exento', 'ISR', 'IMSS', 'Subsidio', 'Neto'];
    const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const filas = det.map((n) => [n.fecha, n.nombreEmisor, n.rfcEmisor, CLASE_NOM[n.clase]?.label || n.clase,
      n.totalPercepciones, n.gravado, n.exento, n.isr, n.imss, n.subsidio, n.neto]);
    const csv = '﻿' + [cols.join(','), ...filas.map((f) => f.map(esc).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `nomina_pf_${anio}${mes ? '-' + String(mes).padStart(2, '0') : ''}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border shadow-sm p-4">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2"><Users size={18} className="text-indigo-600" /> Persona física · ingresos y egresos</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          La <b>nómina que recibes</b> (sueldos y salarios, asimilados) con su ISR/IMSS, lo que <b>facturas</b> (emitidos)
          y tus <b>gastos</b> (recibidos). Sale de tus XML ya descargados; no vuelve a consultar al SAT.
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-3 text-sm">
          <span className="text-gray-600">Ejercicio</span>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input w-28">
            {aniosContables().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="text-gray-600 ml-2">Mes (detalle)</span>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input w-36">
            <option value={0}>Todo el año</option>
            {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <button onClick={exportarCsv} disabled={!det.length}
            className="ml-auto inline-flex items-center gap-1.5 border border-gray-200 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40">
            <Download size={14} /> Exportar CSV
          </button>
        </div>
      </div>

      {rq.isLoading && <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="animate-spin" size={15} /> Cargando…</p>}

      {r && (
        <>
          {/* Tarjetas de resumen del año */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tarjeta titulo="Ingresos por nómina" valor={money(t.ingresoNomina)}
              detalle={`Sueldos ${money(t.sueldos)} · Asimilados ${money(t.asimilados)}`} color="emerald" icon={<TrendingUp size={14} />} />
            <Tarjeta titulo="ISR retenido (nómina)" valor={money(t.isr)}
              detalle={`IMSS ${money(t.imss)}${t.subsidio ? ` · Subsidio ${money(t.subsidio)}` : ''}`} color="rose" />
            <Tarjeta titulo="Ingresos facturados" valor={money(t.facturado)} detalle="CFDI que emitiste (tipo I)" color="sky" icon={<TrendingUp size={14} />} />
            <Tarjeta titulo="Egresos / gastos" valor={money(t.egresos)} detalle="CFDI que recibiste (tipo I)" color="amber" icon={<TrendingDown size={14} />} />
          </div>

          {r.nominaSinXml > 0 && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>Hay <b>{r.nominaSinXml}</b> recibo(s) de nómina sin su XML (sólo metadata): no se pueden desglosar. Vuelve a descargarlos (con e.firma) o súbelos en «Respaldo».</span>
            </div>
          )}

          {/* Resumen mensual */}
          <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-3 py-2">Mes</th>
                  <th className="px-3 py-2 text-right">Sueldos</th>
                  <th className="px-3 py-2 text-right">Asimilados</th>
                  <th className="px-3 py-2 text-right">ISR ret.</th>
                  <th className="px-3 py-2 text-right">IMSS</th>
                  <th className="px-3 py-2 text-right">Facturado</th>
                  <th className="px-3 py-2 text-right">Egresos</th>
                </tr>
              </thead>
              <tbody>
                {r.filas.filter((f: any) => f.docs || f.facturado || f.egresos).map((f: any) => (
                  <tr key={f.mes} className="border-t border-gray-100">
                    <td className="px-3 py-1.5">{MESES[f.mes]}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{f.sueldos ? money(f.sueldos) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{f.asimilados ? money(f.asimilados) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-rose-600">{f.isr ? money(f.isr) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{f.imss ? money(f.imss) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{f.facturado ? money(f.facturado) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-amber-700">{f.egresos ? money(f.egresos) : '—'}</td>
                  </tr>
                ))}
                {!r.filas.some((f: any) => f.docs || f.facturado || f.egresos) && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400 italic">Sin XML en {anio}. Descarga del SAT primero.</td></tr>
                )}
              </tbody>
              {/* Totales del año: suma de cada columna, para el control de la declaración anual. */}
              {r.filas.some((f: any) => f.docs || f.facturado || f.egresos) && (() => {
                const T = r.filas.reduce((a: any, f: any) => ({
                  sueldos: a.sueldos + (f.sueldos || 0), asimilados: a.asimilados + (f.asimilados || 0),
                  isr: a.isr + (f.isr || 0), imss: a.imss + (f.imss || 0),
                  facturado: a.facturado + (f.facturado || 0), egresos: a.egresos + (f.egresos || 0),
                }), { sueldos: 0, asimilados: 0, isr: 0, imss: 0, facturado: 0, egresos: 0 });
                return (
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-800">
                      <td className="px-3 py-2">Totales {anio}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(T.sueldos)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(T.asimilados)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-rose-600">{money(T.isr)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(T.imss)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(T.facturado)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-700">{money(T.egresos)}</td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>

          {/* Detalle de nómina recibida */}
          <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
            <div className="px-3 py-2 border-b text-xs font-semibold text-gray-500 flex items-center justify-between">
              <span>Nómina recibida {mes ? `· ${MESES[mes]}` : '· todo el año'}</span>
              <span>{dq.isFetching ? 'Cargando…' : `${det.length} recibo(s)`}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Patrón / emisor</th>
                  <th className="px-3 py-2">Clase</th>
                  <th className="px-3 py-2 text-right">Percepciones</th>
                  <th className="px-3 py-2 text-right">ISR</th>
                  <th className="px-3 py-2 text-right">Neto</th>
                </tr>
              </thead>
              <tbody>
                {det.map((n) => (
                  <tr key={n.uuid} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 whitespace-nowrap">{n.fecha}</td>
                    <td className="px-3 py-1.5"><span className="block truncate max-w-xs">{n.nombreEmisor}</span><span className="text-[11px] font-mono text-gray-400">{n.rfcEmisor}</span></td>
                    <td className="px-3 py-1.5"><span className={`text-[11px] px-1.5 py-0.5 rounded ${CLASE_NOM[n.clase]?.cls || 'bg-gray-100 text-gray-600'}`}>{CLASE_NOM[n.clase]?.label || n.clase}</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(n.totalPercepciones)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-rose-600">{n.isr ? money(n.isr) : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">{money(n.neto)}</td>
                  </tr>
                ))}
                {!det.length && !dq.isFetching && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400 italic">Sin nómina recibida en el periodo.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, detalle, color, icon }: { titulo: string; valor: string; detalle?: string; color: string; icon?: any }) {
  const borde: Record<string, string> = { emerald: 'border-l-emerald-400', rose: 'border-l-rose-400', sky: 'border-l-sky-400', amber: 'border-l-amber-400' };
  return (
    <div className={`bg-white rounded-lg border border-l-4 ${borde[color] || 'border-l-gray-300'} shadow-sm p-3`}>
      <p className="text-[11px] uppercase tracking-wide text-gray-400 flex items-center gap-1">{icon}{titulo}</p>
      <p className="text-lg font-bold text-gray-800 tabular-nums mt-0.5">{valor}</p>
      {detalle && <p className="text-[11px] text-gray-500 mt-0.5">{detalle}</p>}
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
