/**
 * Motor inteligente de codificación por RFC — pantallas.
 * (spec E:\Banco\GDM_NEXO_Motor_Inteligente_Codificacion_RFC.md, §15-17)
 *
 *   BandejaCompras — Compras 115/601 FACTURA POR FACTURA: cada XML con sus conceptos,
 *                    la sugerencia del agente (cuenta + confianza + evidencia) y la
 *                    cuenta que el motor usará. Se acepta, se cambia, se reparte por
 *                    concepto y se puede guardar como regla del proveedor.
 *   MemoriaRfc     — lo que el agente aprendió de la historia (pólizas importadas +
 *                    XML): resumen de recuperación, reglas propuestas/aprobadas con
 *                    su historial, proveedores aprendidos y auditoría.
 *
 * Nada aquí modifica pólizas: la historia se LEE; las decisiones van a su propia tabla.
 */
import { confirmar } from '@/utils/avisos';
import { Fragment, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Brain, ChevronDown, ChevronRight, FileText, BookOpen, CheckCircle2, AlertTriangle, Search,
  Sparkles, X, ThumbsUp, ThumbsDown, PauseCircle, History, RefreshCw, Link2,
} from 'lucide-react';
import api from '@/services/api';
import { useMascara } from '@/utils/cuenta';
import { fechaMx } from '@/utils/fecha';
import { SelectorCuenta } from '@/components/SelectorCuenta';
import { AsientoModal, ComprobanteModal } from '@/components/TablaComprobantesSat';

const money = (n: any) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const pct = (n: any) => n == null ? '—' : `${Math.round(Number(n) * 100)}%`;

type Nivel = 'ALTO' | 'MEDIO' | 'BAJO' | 'SIN_EVIDENCIA';
const NIVEL_UI: Record<Nivel, { txt: string; cls: string }> = {
  ALTO: { txt: 'Alta', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  MEDIO: { txt: 'Media', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  BAJO: { txt: 'Baja', cls: 'bg-rose-100 text-rose-700 border-rose-300' },
  SIN_EVIDENCIA: { txt: 'Sin evidencia', cls: 'bg-gray-100 text-gray-600 border-gray-300' },
};
const ESTADO_UI: Record<string, { txt: string; cls: string }> = {
  PENDIENTE: { txt: 'Pendiente', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  CODIFICADA: { txt: 'Codificada', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  CONTABILIZADA: { txt: 'Contabilizada', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  SIN_XML: { txt: 'Sin XML', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
};
const FUENTE_UI: Record<string, string> = {
  DECISION: 'decisión en la factura', CUENTA_UNICA: 'una sola cuenta', REGLA: 'regla aprobada',
  PRODUCTO: 'asignación por producto', NINGUNA: '—',
};
const BASE_UI: Record<string, string> = {
  REGLA: 'regla', REGLA_PROVEEDOR: 'regla del proveedor', RFC_CLAVE: 'proveedor + producto',
  RFC_DESC: 'proveedor + descripción', CLAVE: 'producto (otros proveedores)', RFC: 'proveedor',
  PRODUCTO: 'configuración por producto', NINGUNA: '—',
};

function Badge({ nivel }: { nivel: Nivel }) {
  const u = NIVEL_UI[nivel] || NIVEL_UI.SIN_EVIDENCIA;
  return <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap ${u.cls}`}>{u.txt}</span>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   BANDEJA — Compras 115/601 factura por factura
   ═══════════════════════════════════════════════════════════════════════════ */

export function BandejaCompras({ anio, mes, cuentas }: { anio: number; mes: number; cuentas: any[] }) {
  const qc = useQueryClient();
  const clave = ['codif-bandeja', anio, mes];
  const q = useQuery({ queryKey: clave, queryFn: () => api.getBandejaCodificacion(anio, mes) });
  const data: any = q.data?.data;
  const facturas: any[] = data?.facturas || [];
  const res: any = data?.resumen;
  const [filtro, setFiltro] = useState<'PENDIENTE' | 'CODIFICADA' | 'CONTABILIZADA' | 'SIN_XML' | 'TODAS'>('PENDIENTE');
  const [busca, setBusca] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);
  const [xmlId, setXmlId] = useState<string | null>(null);
  const [polizaUuid, setPolizaUuid] = useState<string | null>(null);
  const [evid, setEvid] = useState<{ rfc: string; clave: string; titulo: string } | null>(null);
  const [msg, setMsg] = useState('');

  const elegibles = useMemo(() => cuentas.filter((c) => ['ACTIVO', 'GASTO', 'COSTO'].includes(c.tipo)), [cuentas]);
  const refrescar = () => { qc.invalidateQueries({ queryKey: clave }); qc.invalidateQueries({ queryKey: ['codif-resumen'] }); };

  const aceptar = useMutation({
    mutationFn: (minimo: 'ALTO' | 'MEDIO') => api.aceptarSugerenciasCodificacion(anio, mes, minimo),
    onSuccess: (r: any) => { setMsg(`Aceptadas: ${r.data?.conceptos || 0} concepto(s) en ${r.data?.facturas || 0} factura(s).`); refrescar(); },
    onError: (e: any) => setMsg(e?.response?.data?.message || 'No se pudieron aceptar.'),
  });

  const visibles = facturas.filter((f) => (filtro === 'TODAS' || f.estado === filtro) &&
    (!busca.trim() || `${f.nombre} ${f.rfc} ${f.folio} ${f.uuid}`.toUpperCase().includes(busca.trim().toUpperCase())));

  return (
    <div className="space-y-3">
      {res?.memoriaVacia && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 flex items-start gap-2">
          <Brain size={16} className="mt-0.5 shrink-0" />
          <div>La memoria de esta empresa está vacía. Ve a la pestaña <b>Memoria por RFC</b> y pulsa
            <b> «Aprender de la historia»</b> para que el agente estudie las pólizas del respaldo. Sin historia, sugiere desde la
            configuración por producto y aprende de lo que apruebes aquí.</div>
        </div>
      )}
      {res?.modoCuentaUnica && (
        <div className="rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
          Modo «una sola cuenta» activo ({res.modoCuentaUnica}): el motor manda las compras ahí, salvo las facturas donde decidas otra cuenta.
        </div>
      )}

      {/* Resumen + acciones en bloque */}
      <div className="bg-white rounded-lg shadow border p-3 flex flex-wrap items-center gap-2 text-sm">
        {res && (['PENDIENTE', 'CODIFICADA', 'CONTABILIZADA', 'SIN_XML', 'TODAS'] as const).map((k) => {
          const n = k === 'TODAS' ? res.total : k === 'PENDIENTE' ? res.pendientes : k === 'CODIFICADA' ? res.codificadas
            : k === 'CONTABILIZADA' ? res.contabilizadas : res.sinXml;
          return (
            <button key={k} onClick={() => setFiltro(k)}
              className={`px-2.5 py-1 rounded-full border text-xs ${filtro === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-gray-50'}`}>
              {k === 'TODAS' ? 'Todas' : ESTADO_UI[k].txt} · {n}
            </button>
          );
        })}
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Proveedor, RFC, folio…"
            className="input py-1 pl-6 text-sm w-56" />
        </div>
      </div>

      {res && res.pendientes > 0 && (
        <div className="rounded-lg border bg-gray-50 p-3 flex flex-wrap items-center gap-2 text-sm">
          <Sparkles size={15} className="text-indigo-600" />
          <span className="text-gray-700">
            Pendientes por confianza: <Badge nivel="ALTO" /> {res.pendientesPorConfianza.ALTO} · <Badge nivel="MEDIO" /> {res.pendientesPorConfianza.MEDIO}
            {' '}· <Badge nivel="BAJO" /> {res.pendientesPorConfianza.BAJO} · <Badge nivel="SIN_EVIDENCIA" /> {res.pendientesPorConfianza.SIN_EVIDENCIA}
            <span className="text-gray-500"> — {money(res.importePendiente)}</span>
          </span>
          <div className="ml-auto flex gap-2">
            <button disabled={aceptar.isPending} onClick={() => aceptar.mutate('ALTO')}
              className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-50 text-xs">
              Aceptar las de confianza alta
            </button>
            <button disabled={aceptar.isPending} onClick={async () => {
              if (await confirmar('Se aceptarán también las de confianza MEDIA (patrón consistente pero no regla aprobada). ¿Seguir?')) aceptar.mutate('MEDIO');
            }} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 text-xs">
              Aceptar alta y media
            </button>
          </div>
        </div>
      )}
      {msg && <p className="text-xs text-gray-600">{msg}</p>}

      <div className="bg-white rounded-lg shadow border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="w-6"></th>
              <th className="text-left px-2 py-2">Fecha</th>
              <th className="text-left px-2 py-2">Proveedor</th>
              <th className="text-left px-2 py-2">Serie-folio</th>
              <th className="text-right px-2 py-2">Total</th>
              <th className="text-center px-2 py-2">Mét./forma</th>
              <th className="text-center px-2 py-2">Conc.</th>
              <th className="text-left px-2 py-2">Estado</th>
              <th className="text-left px-2 py-2">Cuenta sugerida</th>
              <th className="text-left px-2 py-2">Confianza</th>
              <th className="text-right px-2 py-2">Docs</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={11} className="text-center text-gray-500 py-6">Cargando facturas…</td></tr>}
            {!q.isLoading && visibles.length === 0 && <tr><td colSpan={11} className="text-center text-gray-400 py-6">No hay facturas en este filtro.</td></tr>}
            {visibles.map((f) => {
              const open = abierta === f.uuid;
              return (
                <Fragment key={f.uuid}>
                  <tr className={`hover:bg-gray-50 cursor-pointer ${open ? 'bg-blue-50/40' : ''}`} onClick={() => setAbierta(open ? null : f.uuid)}>
                    <td className="pl-2 text-gray-400">{f.nConceptos ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{fechaMx(f.fecha)}</td>
                    <td className="px-2 py-1.5"><div className="font-medium text-gray-800 truncate max-w-[16rem]">{f.nombre || '—'}</div>
                      <div className="text-[11px] font-mono text-gray-500">{f.rfc}</div></td>
                    <td className="px-2 py-1.5 font-mono text-xs">{f.folio}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{money(f.total)}</td>
                    <td className="px-2 py-1.5 text-center text-xs">{f.metodoPago || '—'}/{f.formaPago || '—'}</td>
                    <td className="px-2 py-1.5 text-center">{f.nConceptos}</td>
                    <td className="px-2 py-1.5"><span className={`px-1.5 py-0.5 rounded border text-[11px] ${ESTADO_UI[f.estado]?.cls}`}>{ESTADO_UI[f.estado]?.txt}</span></td>
                    <td className="px-2 py-1.5 font-mono text-xs">{f.cuentaSugerida || '—'}</td>
                    <td className="px-2 py-1.5">{f.estado !== 'SIN_XML' && <Badge nivel={f.confianza} />}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button title="Ver XML" onClick={() => setXmlId(f.id)} className="p-1 text-gray-500 hover:text-blue-700"><FileText size={15} /></button>
                      {f.polizaId && <button title="Ver póliza" onClick={() => setPolizaUuid(f.uuid)} className="p-1 text-emerald-600 hover:text-emerald-800"><BookOpen size={15} /></button>}
                    </td>
                  </tr>
                  {open && f.nConceptos > 0 && (
                    <tr><td colSpan={11} className="bg-slate-50 px-4 py-3">
                      <DetalleFactura f={f} cuentas={elegibles} onGuardado={(t) => { setMsg(t); refrescar(); }}
                        onEvidencia={(clave, titulo) => setEvid({ rfc: f.rfc, clave, titulo })} />
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {xmlId && <ComprobanteModal id={xmlId} modo="representacion" emitido={false} onClose={() => setXmlId(null)} />}
      {polizaUuid && <AsientoModal uuid={polizaUuid} claveVista={clave} onClose={() => setPolizaUuid(null)} />}
      {evid && <EvidenciaModal {...evid} onClose={() => setEvid(null)} onPoliza={(u) => setPolizaUuid(u)} />}
    </div>
  );
}

/** Los conceptos de UNA factura: sugerencia, cuenta efectiva y la decisión del usuario. */
function DetalleFactura({ f, cuentas, onGuardado, onEvidencia }: {
  f: any; cuentas: any[]; onGuardado: (msg: string) => void; onEvidencia: (clave: string, titulo: string) => void;
}) {
  const mascara = useMascara();
  const bloqueada = f.estado === 'CONTABILIZADA';
  // Arranca con lo que el motor usaría; si no hay, con la sugerencia (el usuario confirma).
  const [sel, setSel] = useState<Record<number, string>>(() =>
    Object.fromEntries(f.conceptos.map((c: any) => [c.idx, c.cuenta || c.sugerencia?.cuenta || ''])));
  const [regla, setRegla] = useState(false);
  const [err, setErr] = useState('');
  const guardar = useMutation({
    mutationFn: () => api.codificarFactura(f.uuid,
      f.conceptos.map((c: any) => ({ idx: c.idx, cuenta: sel[c.idx] || null })), regla),
    onSuccess: (r: any) => { setErr(''); onGuardado(`Factura ${f.folio}: ${r.data?.guardados || 0} concepto(s) codificado(s)` + (r.data?.reglas ? `, ${r.data.reglas} regla(s) guardada(s).` : '.')); },
    onError: (e: any) => setErr(e?.response?.data?.message || 'No se pudo guardar.'),
  });
  const todas = (cod: string) => setSel(Object.fromEntries(f.conceptos.map((c: any) => [c.idx, cod])));
  const nombreCta = (cod: string) => cuentas.find((x) => x.codigo === cod)?.nombre;

  return (
    <div className="space-y-2">
      {bloqueada && (
        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
          Ya tiene póliza: no se recodifica en silencio. Para cambiarla, «Descontabilizar mes» en Pólizas y vuelve a generar.
        </p>
      )}
      <table className="w-full text-xs bg-white border rounded">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="text-left px-2 py-1.5">Clave</th>
            <th className="text-left px-2 py-1.5">Concepto</th>
            <th className="text-right px-2 py-1.5">Neto</th>
            <th className="text-left px-2 py-1.5">Sugerencia del agente</th>
            <th className="text-left px-2 py-1.5 w-72">Cuenta</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {f.conceptos.map((c: any) => {
            const s = c.sugerencia || {};
            return (
              <tr key={c.idx} className="align-top">
                <td className="px-2 py-1.5 font-mono">{c.clave || '—'}</td>
                <td className="px-2 py-1.5 max-w-[18rem]">{c.descripcion}</td>
                <td className="px-2 py-1.5 text-right font-mono">{money(c.importe)}</td>
                <td className="px-2 py-1.5 max-w-[22rem]">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge nivel={s.nivel} />
                    {s.cuenta && <span className="font-mono">{s.cuenta}</span>}
                    {s.nombreCuenta && <span className="text-gray-500 truncate max-w-[10rem]">{s.nombreCuenta}</span>}
                    {s.cuenta && !bloqueada && sel[c.idx] !== s.cuenta && (
                      <button onClick={() => setSel({ ...sel, [c.idx]: s.cuenta })} className="text-blue-700 hover:underline">usar</button>
                    )}
                  </div>
                  <div className="text-gray-500 mt-0.5">{s.base && s.base !== 'NINGUNA' && BASE_UI[s.base] ? `[${BASE_UI[s.base]}] ` : ''}{s.motivo}</div>
                  {s.incidencia && <div className="text-rose-600 mt-0.5 flex items-center gap-1"><AlertTriangle size={11} /> {s.incidencia}</div>}
                  {s.alternativas?.length > 1 && (
                    <div className="text-gray-500 mt-0.5">Otras: {s.alternativas.slice(0, 4).map((a: any) => `${a.cuenta} (${a.n})`).join(' · ')}</div>
                  )}
                  {(s.ejemplos?.length > 0 || s.muestras > 0) && (
                    <button onClick={() => onEvidencia(c.clave, `${f.nombre || f.rfc} · ${c.clave}`)} className="text-indigo-700 hover:underline mt-0.5">
                      ver evidencia ({s.muestras} muestra{s.muestras === 1 ? '' : 's'})
                    </button>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {bloqueada ? (
                    <span className="font-mono">{c.cuenta || '—'}</span>
                  ) : (
                    <SelectorCuenta cuentas={cuentas} value={sel[c.idx] || ''} mascara={mascara} permitirCrear={false}
                      placeholder="— Elegir cuenta —" onChange={(cod) => setSel({ ...sel, [c.idx]: cod })} />
                  )}
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    Motor usa: {c.cuenta ? <><span className="font-mono">{c.cuenta}</span> · {FUENTE_UI[c.fuente] || c.fuente}</> : <span className="text-rose-600">sin cuenta</span>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!bloqueada && (
        <div className="flex flex-wrap items-center gap-3">
          {f.conceptos.length > 1 && sel[f.conceptos[0].idx] && (
            <button onClick={() => todas(sel[f.conceptos[0].idx])} className="text-xs text-blue-700 hover:underline">
              Toda la factura a {sel[f.conceptos[0].idx]} {nombreCta(sel[f.conceptos[0].idx]) ? `(${nombreCta(sel[f.conceptos[0].idx])})` : ''}
            </button>
          )}
          <label className="flex items-center gap-1.5 text-xs text-gray-700">
            <input type="checkbox" checked={regla} onChange={(e) => setRegla(e.target.checked)} />
            Guardar como regla para este proveedor (proveedor + producto → cuenta) para futuras facturas
          </label>
          <button disabled={guardar.isPending} onClick={() => guardar.mutate()}
            className="ml-auto px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-xs">
            {guardar.isPending ? 'Guardando…' : 'Guardar codificación'}
          </button>
        </div>
      )}
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </div>
  );
}

/** Evidencia de una sugerencia: los patrones por nivel y las pólizas que los sostienen. */
function EvidenciaModal({ rfc, clave, titulo, onClose, onPoliza }: {
  rfc: string; clave: string; titulo: string; onClose: () => void; onPoliza: (uuid: string) => void;
}) {
  const q = useQuery({ queryKey: ['codif-evid', rfc, clave], queryFn: () => api.getEvidenciaCodificacion(rfc, clave) });
  const pats: any[] = q.data?.data || [];
  const NIV: Record<string, string> = { RFC_CLAVE: 'Mismo proveedor y producto', RFC_DESC: 'Mismo proveedor y descripción', CLAVE: 'Mismo producto, otros proveedores', RFC: 'Mismo proveedor, cualquier producto' };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div><p className="font-semibold text-gray-800">Evidencia del agente</p><p className="text-xs text-gray-500">{titulo}</p></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          {q.isLoading && <p className="text-gray-500">Cargando…</p>}
          {!q.isLoading && pats.length === 0 && <p className="text-gray-500">No hay historia para este proveedor/producto: la sugerencia viene de la configuración.</p>}
          {pats.map((p, i) => (
            <div key={i} className="border rounded-lg">
              <div className="px-3 py-2 bg-gray-50 border-b flex flex-wrap items-center gap-2">
                <b className="text-gray-700">{NIV[p.nivel] || p.nivel}</b>
                <span className="text-xs text-gray-500">{p.muestras} concepto(s) · consistencia {pct(p.consistencia)}</span>
              </div>
              <div className="px-3 py-2 space-y-2">
                <div className="flex flex-wrap gap-2 text-xs">
                  {(p.distribucion || []).map((d: any) => (
                    <span key={d.cuenta} className="px-2 py-0.5 rounded border bg-white">
                      <span className="font-mono">{d.cuenta}</span> · {d.n} vez/veces · {fechaMx(d.primera)} → {fechaMx(d.ultima)}
                    </span>
                  ))}
                </div>
                <table className="w-full text-xs">
                  <tbody className="divide-y">
                    {(p.ejemplos || []).map((e: any, j: number) => (
                      <tr key={j}>
                        <td className="py-1 pr-2 whitespace-nowrap">{fechaMx(e.fecha)}</td>
                        <td className="py-1 pr-2 font-mono">{e.cuenta}</td>
                        <td className="py-1 pr-2 text-gray-600">{e.poliza ? `${e.poliza.tipo} #${e.poliza.folio} · ${e.poliza.concepto || ''}` : (e.fuente === 'decision' ? 'decisión del usuario (aún sin póliza)' : '—')}</td>
                        <td className="py-1 pr-2 text-gray-400">{e.fuente === 'historia' ? 'respaldo' : e.fuente === 'nexo' ? 'NEXO' : 'decisión'}</td>
                        <td className="py-1 text-right"><button onClick={() => onPoliza(e.uuid)} className="text-blue-700 hover:underline">ver póliza/XML</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MEMORIA POR RFC — recuperación, aprendizaje, reglas y auditoría
   ═══════════════════════════════════════════════════════════════════════════ */

const CONF_UI: Record<'ALTA' | 'MEDIA' | 'BAJA', { txt: string; cls: string }> = {
  ALTA: { txt: 'Alta', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  MEDIA: { txt: 'Media', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  BAJA: { txt: 'Baja', cls: 'bg-rose-100 text-rose-700 border-rose-300' },
};

/**
 * Reparar enlaces del respaldo — opción B. Busca la póliza de respaldo de cada XML que
 * quedó «por clasificar» por falta del enlace UUID↔póliza, y graba sólo ese enlace.
 * Primero SIMULACRO (no toca nada), luego el usuario aplica hasta el nivel de confianza
 * que quiera. Reusa la base y la UX de confianza del agente de codificación.
 */
function RepararEnlaces() {
  const qc = useQueryClient();
  const [anio, setAnio] = useState<number>(0);   // 0 = todos los años
  const [sim, setSim] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const diagQ = useQuery({ queryKey: ['enlaces-diag'], queryFn: () => api.getDiagnosticoEnlaces() });
  const porAnio: any[] = diagQ.data?.data?.porAnio || [];

  const analizar = useMutation({
    mutationFn: () => api.repararEnlacesRespaldo({ anio: anio || undefined, aplicar: false }),
    onSuccess: (x: any) => { setSim(x.data); setMsg(''); },
    onError: (e: any) => { setSim(null); setMsg(e?.response?.data?.message || 'No se pudo analizar.'); },
  });
  const aplicar = useMutation({
    mutationFn: (conf: 'ALTA' | 'MEDIA' | 'BAJA') => api.repararEnlacesRespaldo({ anio: anio || undefined, aplicar: true, confianza: conf }),
    onSuccess: (x: any) => {
      setSim(x.data);
      setMsg(`Se enlazaron ${x.data.aplicados} factura(s) a su póliza del respaldo.`);
      ['enlaces-diag', 'codif-resumen', 'codif-bandeja'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: any) => setMsg(e?.response?.data?.message || 'No se pudo aplicar.'),
  });
  const trabajando = analizar.isPending || aplicar.isPending;

  return (
    <div className="bg-white rounded-lg shadow border p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <Link2 size={22} className="text-sky-600 mt-0.5" />
        <div className="flex-1 min-w-[16rem]">
          <p className="font-semibold text-gray-800">Reparar enlaces del respaldo</p>
          <p className="text-xs text-gray-500">
            Cuando el respaldo no trajo el enlace XML↔póliza, la factura aparece como «por clasificar» aunque YA esté
            contabilizada. Esto busca su póliza del respaldo por <b>importe exacto + RFC + fecha</b> y graba sólo el
            enlace que faltaba. <b>No cambia importes ni cuentas</b>, y ante la duda no enlaza.
          </p>
        </div>
      </div>

      {porAnio.length > 0 && (
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500"><tr>
              <th className="text-left px-2 py-1.5">Año</th>
              <th className="text-right px-2 py-1.5">Compras enlazadas</th>
              <th className="text-right px-2 py-1.5">Ventas enlazadas</th>
              <th className="text-right px-2 py-1.5">Pólizas de respaldo</th>
            </tr></thead>
            <tbody className="divide-y">
              {porAnio.map((f) => {
                const rp = f.recibidos.total ? Math.round(f.recibidos.enlazados / f.recibidos.total * 100) : null;
                const vp = f.emitidos.total ? Math.round(f.emitidos.enlazados / f.emitidos.total * 100) : null;
                return (
                  <tr key={f.anio}>
                    <td className="px-2 py-1 font-medium">{f.anio}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{f.recibidos.enlazados}/{f.recibidos.total}{rp != null && <span className="text-gray-400"> ({rp}%)</span>}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{f.emitidos.enlazados}/{f.emitidos.total}{vp != null && <span className="text-gray-400"> ({vp}%)</span>}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{f.polizasRespaldo}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">Año:</span>
        <select value={anio} onChange={(e) => { setAnio(Number(e.target.value)); setSim(null); setMsg(''); }} className="input py-1.5 text-sm w-32">
          <option value={0}>Todos</option>
          {porAnio.map((f) => <option key={f.anio} value={f.anio}>{f.anio}</option>)}
        </select>
        <button disabled={trabajando} onClick={() => analizar.mutate()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 text-sm">
          <Search size={14} /> {analizar.isPending ? 'Analizando…' : 'Analizar (simulacro)'}
        </button>
      </div>

      {sim && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Revisados sin enlace: <b>{sim.revisados}</b></span>
            <span className="text-emerald-700">Alta: <b>{sim.porConfianza.ALTA}</b></span>
            <span className="text-amber-700">Media: <b>{sim.porConfianza.MEDIA}</b></span>
            <span className="text-rose-700">Baja: <b>{sim.porConfianza.BAJA}</b></span>
            <span className="text-gray-500">Ambiguos: {sim.ambiguos}</span>
            <span className="text-gray-500">Sin candidata: {sim.sinCandidata}</span>
          </div>
          {sim.aplicar
            ? <p className="text-emerald-800 font-medium flex items-center gap-1.5"><CheckCircle2 size={15} /> {msg}</p>
            : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-600">Enlazar hasta confianza:</span>
                <button disabled={trabajando || !sim.porConfianza.ALTA} onClick={() => aplicar.mutate('ALTA')}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 text-sm">
                  Sólo Alta ({sim.porConfianza.ALTA})
                </button>
                <button disabled={trabajando || !(sim.porConfianza.ALTA + sim.porConfianza.MEDIA)} onClick={() => aplicar.mutate('MEDIA')}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 text-sm">
                  Alta + Media ({sim.porConfianza.ALTA + sim.porConfianza.MEDIA})
                </button>
                <button disabled={trabajando || !(sim.porConfianza.ALTA + sim.porConfianza.MEDIA + sim.porConfianza.BAJA)}
                  onClick={async () => { if (await confirmar('Enlazar TODAS las coincidencias, incluidas las de confianza BAJA (sólo importe exacto único, sin RFC ni nombre). Revisa la muestra antes. ¿Continuar?')) aplicar.mutate('BAJA'); }}
                  className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-40 text-sm">
                  Todas ({sim.porConfianza.ALTA + sim.porConfianza.MEDIA + sim.porConfianza.BAJA})
                </button>
              </div>
            )}

          {sim.muestra?.length > 0 && (
            <div className="overflow-x-auto border rounded-lg bg-white mt-1">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500"><tr>
                  <th className="text-left px-2 py-1">Tipo</th>
                  <th className="text-left px-2 py-1">Folio</th>
                  <th className="text-left px-2 py-1">RFC</th>
                  <th className="text-right px-2 py-1">Importe</th>
                  <th className="text-left px-2 py-1">Fecha XML → póliza</th>
                  <th className="text-left px-2 py-1">Confianza</th>
                  <th className="text-left px-2 py-1">Motivo</th>
                </tr></thead>
                <tbody className="divide-y">
                  {sim.muestra.map((m: any, i: number) => (
                    <tr key={i}>
                      <td className="px-2 py-1">{m.direccion === 'recibidos' ? 'Compra' : 'Venta'}</td>
                      <td className="px-2 py-1 font-mono">{m.folio}</td>
                      <td className="px-2 py-1 font-mono">{m.rfc || '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{money(m.total)}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{fechaMx(m.fecha)} → {fechaMx(m.entryFecha)}</td>
                      <td className="px-2 py-1"><span className={`px-1.5 py-0.5 rounded border text-[11px] ${CONF_UI[m.confianza as 'ALTA' | 'MEDIA' | 'BAJA'].cls}`}>{CONF_UI[m.confianza as 'ALTA' | 'MEDIA' | 'BAJA'].txt}</span></td>
                      <td className="px-2 py-1 text-gray-600">{m.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-gray-500">
            Los <b>ambiguos</b> (varias pólizas con el mismo importe) y los <b>sin candidata</b> no se tocan: los primeros
            porque no se puede saber cuál es; los segundos porque de verdad no vienen en el respaldo.
          </p>
        </div>
      )}
      {msg && !sim?.aplicar && <p className="text-xs text-rose-600">{msg}</p>}
    </div>
  );
}

export function MemoriaRfc({ cuentas }: { cuentas: any[] }) {
  const qc = useQueryClient();
  const [sec, setSec] = useState<'propuestas' | 'proveedores' | 'reglas' | 'auditoria'>('propuestas');
  const resQ = useQuery({ queryKey: ['codif-resumen'], queryFn: () => api.getCodificacionResumen() });
  const r: any = resQ.data?.data;
  const [aprendido, setAprendido] = useState<any>(null);
  const [err, setErr] = useState('');
  const invalidar = () => ['codif-resumen', 'codif-reglas', 'codif-memoria', 'codif-bandeja'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const aprender = useMutation({
    mutationFn: () => api.aprenderCodificacion(),
    onSuccess: (x: any) => { setAprendido(x.data); setErr(''); invalidar(); },
    onError: (e: any) => setErr(e?.response?.data?.message || 'No se pudo aprender.'),
  });

  return (
    <div className="space-y-4">
      {/* Recuperación y aprendizaje (spec §15) */}
      <div className="bg-white rounded-lg shadow border p-4">
        <div className="flex flex-wrap items-start gap-3">
          <Brain size={22} className="text-indigo-600 mt-0.5" />
          <div className="flex-1 min-w-[16rem]">
            <p className="font-semibold text-gray-800">Memoria contable de esta empresa</p>
            <p className="text-xs text-gray-500">
              El agente estudia las pólizas (del respaldo importado y las de NEXO) ligadas a sus XML y aprende qué cuenta usas por
              proveedor y producto. <b>No modifica ninguna póliza</b>: sólo lee. La memoria es exclusiva de este RFC.
            </p>
          </div>
          <button disabled={aprender.isPending} onClick={() => aprender.mutate()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 text-sm">
            <RefreshCw size={14} className={aprender.isPending ? 'animate-spin' : ''} />
            {aprender.isPending ? 'Aprendiendo…' : 'Aprender de la historia'}
          </button>
        </div>
        {r && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-sm">
            <Dato t="Pólizas en NEXO" v={r.historia?.polizas} s={`${r.historia?.importadas || 0} importadas · ${r.historia?.motor || 0} del motor`} />
            <Dato t="Periodo" v={r.historia?.desde ? `${fechaMx(r.historia.desde)} → ${fechaMx(r.historia.hasta)}` : '—'} s={`${r.historia?.partidas || 0} partidas`} />
            <Dato t="Facturas de compra" v={r.xml?.recibidos} s={`${r.xml?.con_xml || 0} con XML · ${r.xml?.con_poliza || 0} con póliza (${r.xml?.pctRelacionado ?? '—'}%)`} />
            <Dato t="XML sin póliza" v={r.xml?.sin_poliza} s="se codifican en la bandeja" />
            <Dato t="Proveedores aprendidos" v={r.patrones?.RFC?.n || 0} s={`${r.patrones?.RFC_CLAVE?.n || 0} pares proveedor+producto`} />
            <Dato t="Contradicciones" v={(r.patrones?.RFC_CLAVE?.contradicciones || 0)} s="mismo proveedor y producto, cuentas distintas" />
            <Dato t="Reglas" v={`${r.reglas?.APROBADA || 0} aprobadas`} s={`${r.reglas?.PROPUESTA || 0} propuestas · ${r.reglas?.SUSPENDIDA || 0} suspendidas`} />
            <Dato t="Último aprendizaje" v={r.ultimoAprendizaje ? r.ultimoAprendizaje.slice(0, 10).split('-').reverse().join('/') : 'nunca'} s={r.ultimoAprendizaje ? r.ultimoAprendizaje.slice(11) : 'pulsa «Aprender»'} />
          </div>
        )}
        {aprendido && (
          <div className="mt-3 rounded border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-900">
            Aprendí de {aprendido.facturasConPoliza} factura(s) con póliza: {aprendido.conceptosAprendidos} concepto(s) atribuidos,
            {' '}{aprendido.conceptosAmbiguos} ambiguos (no se adivinan), {aprendido.proveedores} proveedor(es).
            {' '}{aprendido.reglasPropuestasNuevas} regla(s) propuesta(s) nueva(s). ({aprendido.segundos}s)
            {aprendido.contradiccionesConReglasAprobadas?.length > 0 && (
              <div className="text-rose-700 mt-1">
                OJO: {aprendido.contradiccionesConReglasAprobadas.length} regla(s) aprobada(s) contradicen la historia reciente
                (no se cambiaron): {aprendido.contradiccionesConReglasAprobadas.slice(0, 5).map((c: any) => `${c.nombre || c.rfc} ${c.clave}: regla ${c.aprobada} vs historia ${c.historia}`).join(' · ')}
              </div>
            )}
          </div>
        )}
        {err && <p className="text-xs text-rose-600 mt-2">{err}</p>}
      </div>

      <RepararEnlaces />

      <div className="flex flex-wrap gap-1.5">
        {([['propuestas', 'Reglas propuestas'], ['proveedores', 'Proveedores aprendidos'], ['reglas', 'Reglas e historial'], ['auditoria', 'Auditoría']] as const).map(([k, t]) => (
          <button key={k} onClick={() => setSec(k)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${sec === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200'}`}>{t}</button>
        ))}
      </div>

      {sec === 'propuestas' && <TablaReglas estado="PROPUESTA" cuentas={cuentas} onCambio={invalidar} />}
      {sec === 'reglas' && <TablaReglas cuentas={cuentas} onCambio={invalidar} />}
      {sec === 'proveedores' && <Proveedores />}
      {sec === 'auditoria' && (
        <div className="bg-white rounded-lg shadow border overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500"><tr>
              <th className="text-left px-2 py-1.5">Fecha</th><th className="text-left px-2 py-1.5">Acción</th>
              <th className="text-left px-2 py-1.5">Sugerida → final</th><th className="text-left px-2 py-1.5">Confianza</th>
              <th className="text-left px-2 py-1.5">Motivo</th><th className="text-left px-2 py-1.5">Usuario</th></tr></thead>
            <tbody className="divide-y">
              {(r?.auditoria || []).map((a: any, i: number) => (
                <tr key={i}>
                  <td className="px-2 py-1 whitespace-nowrap">{a.fecha?.slice(0, 10).split('-').reverse().join('/')} {a.fecha?.slice(11)}</td>
                  <td className="px-2 py-1">{a.accion}</td>
                  <td className="px-2 py-1 font-mono">{a.cuenta_sugerida || '—'} → {a.cuenta_final || '—'}</td>
                  <td className="px-2 py-1">{a.confianza || ''}</td>
                  <td className="px-2 py-1 text-gray-600">{a.motivo || ''}</td>
                  <td className="px-2 py-1 text-gray-500">{a.usuario || 'motor'}</td>
                </tr>
              ))}
              {!(r?.auditoria || []).length && <tr><td colSpan={6} className="text-center text-gray-400 py-4">Sin movimientos todavía.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Dato({ t, v, s }: { t: string; v: any; s?: string }) {
  return (
    <div className="rounded border bg-gray-50 px-3 py-2">
      <div className="text-[11px] text-gray-500 uppercase">{t}</div>
      <div className="font-semibold text-gray-800">{v ?? '—'}</div>
      {s && <div className="text-[11px] text-gray-500">{s}</div>}
    </div>
  );
}

function TablaReglas({ estado, cuentas, onCambio }: { estado?: string; cuentas: any[]; onCambio: () => void }) {
  const mascara = useMascara();
  const q = useQuery({ queryKey: ['codif-reglas', estado || 'todas'], queryFn: () => api.getReglasCodificacion(estado) });
  const reglas: any[] = q.data?.data || [];
  const [editar, setEditar] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const elegibles = useMemo(() => cuentas.filter((c) => ['ACTIVO', 'GASTO', 'COSTO'].includes(c.tipo)), [cuentas]);
  const hecho = (t: string) => { setMsg(t); onCambio(); q.refetch(); };
  const gobernar = useMutation({
    mutationFn: (v: { id: string; estado?: string; cuenta?: string; motivo?: string }) => api.gobernarReglaCodificacion(v.id, v),
    onSuccess: () => hecho('Regla actualizada.'),
    onError: (e: any) => setMsg(e?.response?.data?.message || 'No se pudo.'),
  });
  const aprobarTodas = useMutation({
    mutationFn: () => api.aprobarReglasCodificacion(null),
    onSuccess: (x: any) => hecho(`${x.data?.aprobadas || 0} regla(s) aprobada(s).`),
  });

  return (
    <div className="space-y-2">
      {estado === 'PROPUESTA' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p className="text-gray-600 flex-1">
            Patrones fuertes de la historia (≥3 operaciones y ≥90% en la misma cuenta). Una propuesta <b>no</b> se aplica sola:
            al aprobarla, el motor la usa para codificar las facturas nuevas de ese proveedor y producto.
          </p>
          {reglas.length > 0 && (
            <button onClick={async () => { if (await confirmar(`¿Aprobar las ${reglas.length} reglas propuestas?`)) aprobarTodas.mutate(); }}
              className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 text-xs">Aprobar todas</button>
          )}
        </div>
      )}
      {msg && <p className="text-xs text-gray-600">{msg}</p>}
      <div className="bg-white rounded-lg shadow border overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500"><tr>
            <th className="text-left px-2 py-1.5">Proveedor</th><th className="text-left px-2 py-1.5">Producto</th>
            <th className="text-left px-2 py-1.5">Cuenta</th><th className="text-center px-2 py-1.5">Muestras</th>
            <th className="text-center px-2 py-1.5">Consist.</th><th className="text-left px-2 py-1.5">Evidencia</th>
            <th className="text-left px-2 py-1.5">Estado</th><th className="text-right px-2 py-1.5">Acciones</th></tr></thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={8} className="text-center text-gray-500 py-4">Cargando…</td></tr>}
            {!q.isLoading && reglas.length === 0 && <tr><td colSpan={8} className="text-center text-gray-400 py-4">
              {estado === 'PROPUESTA' ? 'No hay propuestas. Pulsa «Aprender de la historia».' : 'Sin reglas todavía.'}</td></tr>}
            {reglas.map((g) => {
              const viva = ['PROPUESTA', 'APROBADA', 'SUSPENDIDA'].includes(g.estado);
              return (
                <tr key={g.id} className={viva ? '' : 'text-gray-400'}>
                  <td className="px-2 py-1.5"><div className="truncate max-w-[14rem]">{g.nombre || '—'}</div><div className="font-mono text-[11px] text-gray-500">{g.rfc}</div></td>
                  <td className="px-2 py-1.5 font-mono">{g.clave || 'todos'}</td>
                  <td className="px-2 py-1.5 w-64">
                    {editar === g.id ? (
                      <SelectorCuenta cuentas={elegibles} value={g.cuenta_codigo} mascara={mascara} permitirCrear={false}
                        onChange={(cod) => { setEditar(null); if (cod && cod !== g.cuenta_codigo) gobernar.mutate({ id: g.id, cuenta: cod }); }} />
                    ) : (<><span className="font-mono">{g.cuenta_codigo}</span> <span className="text-gray-500">{g.cuenta_nombre || <span className="text-rose-600">no está en el catálogo</span>}</span></>)}
                  </td>
                  <td className="px-2 py-1.5 text-center">{g.muestras}</td>
                  <td className="px-2 py-1.5 text-center">{pct(g.consistencia)}</td>
                  <td className="px-2 py-1.5 text-gray-500">{g.primera ? `${fechaMx(g.primera)} → ${fechaMx(g.ultima)}` : g.origen === 'USUARIO' ? 'decisión del usuario' : '—'}</td>
                  <td className="px-2 py-1.5"><span className="whitespace-nowrap">{g.estado} · v{g.version}</span>
                    {g.aprobado_por && <div className="text-[11px] text-gray-400">{g.aprobado_por}</div>}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {g.estado !== 'APROBADA' && <button title="Aprobar" onClick={() => gobernar.mutate({ id: g.id, estado: 'APROBADA' })} className="p-1 text-emerald-700 hover:text-emerald-900"><ThumbsUp size={14} /></button>}
                    {viva && g.estado !== 'SUSPENDIDA' && g.estado !== 'PROPUESTA' && <button title="Suspender" onClick={() => gobernar.mutate({ id: g.id, estado: 'SUSPENDIDA' })} className="p-1 text-amber-600 hover:text-amber-800"><PauseCircle size={14} /></button>}
                    {viva && <button title="Rechazar" onClick={() => { const m = prompt('Motivo del rechazo (queda en la auditoría):') ?? undefined; if (m !== undefined) gobernar.mutate({ id: g.id, estado: 'RECHAZADA', motivo: m }); }} className="p-1 text-rose-600 hover:text-rose-800"><ThumbsDown size={14} /></button>}
                    {viva && <button title="Cambiar cuenta (nueva versión)" onClick={() => setEditar(editar === g.id ? null : g.id)} className="p-1 text-blue-700 hover:text-blue-900"><History size={14} /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Proveedores() {
  const [q, setQ] = useState('');
  const [busca, setBusca] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const mq = useQuery({ queryKey: ['codif-memoria', busca], queryFn: () => api.getMemoriaCodificacion(busca || undefined) });
  const provs: any[] = mq.data?.data || [];
  return (
    <div className="space-y-2">
      <form onSubmit={(e) => { e.preventDefault(); setBusca(q); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor o RFC" className="input py-1.5 text-sm w-72" />
        <button className="px-3 py-1.5 rounded-lg border text-sm hover:bg-gray-50">Buscar</button>
      </form>
      <div className="bg-white rounded-lg shadow border divide-y">
        {mq.isLoading && <p className="text-center text-gray-500 py-4 text-sm">Cargando…</p>}
        {!mq.isLoading && provs.length === 0 && <p className="text-center text-gray-400 py-4 text-sm">Sin proveedores aprendidos. Pulsa «Aprender de la historia».</p>}
        {provs.map((p) => {
          const open = abierto === p.rfc;
          return (
            <div key={p.rfc}>
              <button onClick={() => setAbierto(open ? null : p.rfc)} className="w-full flex flex-wrap items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50 text-left">
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="font-medium text-gray-800 truncate max-w-[18rem]">{p.nombre || p.rfc}</span>
                <span className="font-mono text-xs text-gray-500">{p.rfc}</span>
                <span className="text-xs text-gray-600">{p.muestras} concepto(s) · {p.cuentasDistintas} cuenta(s) · {fechaMx(p.primera)} → {fechaMx(p.ultima)}</span>
                {p.reglaProveedor && <span className="text-[11px] px-1.5 rounded bg-emerald-100 text-emerald-800">regla del proveedor</span>}
                {p.contradicciones > 0
                  ? <span className="ml-auto text-xs text-rose-600 flex items-center gap-1"><AlertTriangle size={12} /> {p.contradicciones} producto(s) con cuentas distintas</span>
                  : p.explicadoPorProducto
                    ? <span className="ml-auto text-xs text-gray-500">varias cuentas, explicadas por producto</span>
                    : <span className="ml-auto text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 size={12} /> consistente</span>}
              </button>
              {open && (
                <div className="px-8 pb-3">
                  <table className="w-full text-xs">
                    <thead className="text-gray-500"><tr>
                      <th className="text-left py-1">Producto</th><th className="text-left py-1">Cuentas usadas</th>
                      <th className="text-center py-1">Consist.</th><th className="text-left py-1">Regla</th></tr></thead>
                    <tbody className="divide-y">
                      {p.productos.map((d: any, i: number) => (
                        <tr key={i}>
                          <td className="py-1 pr-2"><span className="font-mono">{d.clave || '—'}</span>{d.descripcion ? <span className="text-gray-500"> · {d.descripcion}</span> : null}</td>
                          <td className="py-1 pr-2">{(d.distribucion || []).map((x: any) => `${x.cuenta} (${x.n})`).join(' · ')}</td>
                          <td className={`py-1 text-center ${d.consistencia < 0.9 ? 'text-rose-600' : ''}`}>{pct(d.consistencia)}</td>
                          <td className="py-1">{d.regla ? `${d.regla.estado} → ${d.regla.cuenta_codigo}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
