/**
 * Super-Admin → Facturación (cobro POR USUARIO, modelo único — sin paquetes).
 *
 * Una sola pantalla que une la antigua «Facturación mensual» y «Facturación y
 * consumo». Orden: (1) ambientes de PRUEBA (sin cobro), (2) usuarios REALES
 * (cobro $precio × usuarios + excedente de timbres), (3) consumo de timbres.
 * Prepago: generar la lista del día 30, marcar pagado / suspender por falta de pago.
 */
import { useState, useMemo, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, RefreshCw, Check, Ban, RotateCcw, Settings, Loader2, AlertTriangle, FlaskConical, Users, Stamp, ChevronRight, ChevronDown, FileText, X } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

const money = (n: any) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const mesActual = () => new Date().toISOString().slice(0, 7);

export function AdminFacturacionPage() {
  const { user } = useAuthStore();
  const [periodo, setPeriodo] = useState(mesActual());
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [cfgOpen, setCfgOpen] = useState(false);

  const q = useQuery({ queryKey: ['facturacion-consolidado', periodo], queryFn: () => api.getFacturacionConsolidado(periodo) });
  const cfgQ = useQuery({ queryKey: ['facturacion-config'], queryFn: () => api.getFacturacionConfig() });
  const emisorasQ = useQuery({ queryKey: ['admin-emisores'], queryFn: () => api.adminListEmisores() });
  const emisoras: any[] = ((emisorasQ.data as any)?.data?.emisores || []).filter((e: any) => e.es_emisor);
  const [emitir, setEmitir] = useState<any>(null);   // cargo a facturar (abre el modal de emisora)
  const data = q.data?.data;
  const prueba: any[] = data?.prueba || [];
  const reales: any[] = data?.reales || [];
  const cfg = cfgQ.data?.data;
  // Dos paneles por producto contratado: NEXO (ERP) e IVA (servicio IVA.HTML, su CFDI
  // lo emite NEXO). 'AMBOS' aparece en los dos. Las listas y los totales se filtran.
  const [panel, setPanel] = useState<'NEXO' | 'IVA'>('NEXO');
  const enPanel = (f: any) => {
    const p = String(f?.producto || 'NEXO').toUpperCase();
    return panel === 'NEXO' ? (p === 'NEXO' || p === 'AMBOS') : (p === 'IVA' || p === 'AMBOS');
  };
  const pruebaF = prueba.filter(enPanel);
  const realesF = reales.filter(enPanel);

  /* Árbol por despacho (encabezados colapsables): las empresas se agrupan por su
   * emisora de cobro (empresa_cobro_id) y, si no la tienen, por la emisora
   * PREDETERMINADA (GRUPO HCGM). El encabezado es el nombre del despacho. Por
   * omisión TODO abierto; se colapsa por grupo. */
  const emisoraPred: any = data?.emisoraPredeterminada || null;
  const [colapsado, setColapsado] = useState<Set<string>>(new Set());
  const alternarGrupo = (id: string) => setColapsado((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const gruposReales = useMemo(() => {
    const nombrePorId = new Map<string, string>(realesF.map((f) => [f.company_id, f.business_name]));
    if (emisoraPred?.id) nombrePorId.set(emisoraPred.id, emisoraPred.business_name);
    const m = new Map<string, { nombre: string; rows: any[] }>();
    for (const f of realesF) {
      let key = f.empresa_cobro_id;
      if (!key && !f.emisor_predeterminado && emisoraPred?.id && emisoraPred.id !== f.company_id) key = emisoraPred.id;
      const k = key || '__none__';
      const nombre = k === '__none__' ? 'Sin despacho' : (nombrePorId.get(k) || 'Despacho');
      if (!m.has(k)) m.set(k, { nombre, rows: [] });
      m.get(k)!.rows.push(f);
    }
    return [...m.entries()].sort((a, b) => a[0] === '__none__' ? 1 : b[0] === '__none__' ? -1 : a[1].nombre.localeCompare(b[1].nombre));
  }, [realesF, data]);
  const totPanel = {
    empresasReales: realesF.length,
    usuariosReales: realesF.reduce((a, f) => a + Number(f.usuarios || 0), 0),
    renta: realesF.reduce((a, f) => a + Number(f.renta_mxn || 0), 0),
    extra: realesF.reduce((a, f) => a + Number(f.extra_mxn || 0), 0),
    total: realesF.reduce((a, f) => a + Number(f.total_mxn || 0), 0),
  };

  if (user?.role !== 'SUPER_ADMIN') {
    return <div className="bg-amber-50 border border-amber-200 text-amber-900 p-6 rounded-lg">
      <p className="font-semibold">Acceso restringido</p><p className="text-sm">Requiere rol SUPER_ADMIN.</p></div>;
  }

  const generar = async () => {
    setBusy('generar'); setMsg('');
    try { await api.generarFacturacion(periodo); await q.refetch(); setMsg('Lista generada.'); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo generar.'); }
    finally { setBusy(''); }
  };
  const accion = async (fn: () => Promise<any>, id: string, ok: string) => {
    setBusy(id); setMsg('');
    try { await fn(); await q.refetch(); setMsg(ok); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo aplicar.'); }
    finally { setBusy(''); }
  };

  const badge = (s: string) =>
    s === 'PAGADO' ? 'bg-emerald-100 text-emerald-700'
      : s === 'SUSPENDIDO' ? 'bg-rose-100 text-rose-700'
      : s === 'SIN_GENERAR' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <DollarSign size={28} className="text-emerald-600" /> Facturación
          </h1>
          <p className="text-gray-600 mt-1">
            Cobro <b>por usuario</b> (sin paquetes). Genera la lista del periodo (día 30):
            $precio × usuarios facturables (sin checador) + excedente de timbres. Prepago.
          </p>
        </div>
        <button onClick={() => setCfgOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 border px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          <Settings size={15} /> Precios
        </button>
      </div>

      {cfgOpen && cfg && <PanelConfig cfg={cfg} onGuardado={() => cfgQ.refetch()} />}

      {/* Dos paneles por producto contratado */}
      <div className="flex gap-2">
        <button onClick={() => setPanel('NEXO')}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${panel === 'NEXO' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>NEXO (ERP)</button>
        <button onClick={() => setPanel('IVA')}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${panel === 'IVA' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>IVA (servicio)</button>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-white border rounded-lg p-3">
        <label className="text-sm text-gray-600">Periodo:
          <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="input ml-2 py-1.5 text-sm w-40" />
        </label>
        <button onClick={generar} disabled={busy === 'generar'}
          className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm">
          {busy === 'generar' ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Generar lista del día 30
        </button>
        {cfg && <span className="text-xs text-gray-400">${cfg.precioUsuario}/usuario · {cfg.timbresIncluidos}+{cfg.timbresPorUsuario}/usr timbres · extra ${cfg.timbreExtra}+${cfg.timbreExtraPorUsuario}/usr</span>}
        {msg && <span className="text-sm text-gray-700">{msg}</span>}
      </div>

      {/* Totales del panel activo (solo reales) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Tarjeta label={`Empresas ${panel}`} valor={totPanel.empresasReales} />
        <Tarjeta label="Usuarios" valor={totPanel.usuariosReales} />
        <Tarjeta label="Renta" valor={money(totPanel.renta)} />
        <Tarjeta label="Timbres extra" valor={money(totPanel.extra)} />
        <Tarjeta label="Total a cobrar" valor={money(totPanel.total)} destacado />
      </div>

      {q.isLoading && <p className="text-gray-500">Cargando…</p>}

      {/* 1) Ambientes de PRUEBA — sin cobro */}
      <Seccion icon={<FlaskConical size={16} className="text-sky-600" />} titulo="Solicitudes en prueba (72 h)"
        nota="Altas nuevas de IVA/NEXO en su prueba de 72 h sin firmar — aquí se concentran las solicitudes de servicio. Las exentas y propias ya NO salen aquí: aparecen en «Usuarios reales» marcadas «sin cobro».">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Empresa</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Motivo</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Usuarios</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Timbres</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Cobro</th>
          </tr></thead>
          <tbody className="divide-y">
            {pruebaF.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400 italic">Sin solicitudes en prueba por ahora. Aquí aparecen las altas nuevas (IVA/NEXO) en su prueba de 72 h.</td></tr>}
            {pruebaF.map((f) => (
              <tr key={f.company_id} className="hover:bg-gray-50">
                <td className="px-3 py-2"><p className="font-medium text-gray-800">{f.business_name}</p><p className="text-[11px] text-gray-500 font-mono">{f.rfc}</p></td>
                <td className="px-3 py-2"><span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">{f.motivo}</span></td>
                <td className="px-3 py-2 text-center">{f.usuarios}</td>
                <td className="px-3 py-2 text-center text-xs">{f.timbres_usados}<span className="text-gray-400">/{f.timbres_incluidos}</span></td>
                <td className="px-3 py-2 text-right text-gray-400 italic">sin cobro</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Seccion>

      {/* 2) Usuarios REALES — cobro por usuario */}
      <Seccion icon={<Users size={16} className="text-emerald-600" />} titulo="Usuarios reales (cobro por usuario)"
        nota="Clientes de pago. Genera la lista para crear el cargo; luego marca pagado o suspende por falta de pago.">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Empresa</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Usuarios</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Renta</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Timbres</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Extra</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Total</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Estado</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
          </tr></thead>
          <tbody className="divide-y">
            {realesF.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-gray-400 italic">Sin clientes de pago todavía.</td></tr>}
            {gruposReales.map(([key, g]) => (
              <Fragment key={key}>
                <tr className="bg-indigo-50/70 border-y border-indigo-100">
                  <td colSpan={8} className="px-3 py-1.5">
                    <button onClick={() => alternarGrupo(key)} className="flex items-center gap-1.5 text-sm font-semibold text-indigo-800 hover:text-indigo-900">
                      {colapsado.has(key) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      {g.nombre}
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">{g.rows.length} empresa(s)</span>
                    </button>
                  </td>
                </tr>
                {!colapsado.has(key) && g.rows.map((f: any) => (
              <tr key={f.company_id} className={`hover:bg-gray-50 ${f.status === 'SUSPENDIDO' ? 'bg-rose-50/40' : f.exenta ? 'bg-slate-50/40' : ''}`}>
                <td className="px-3 py-2 pl-8">
                  <p className="font-medium text-gray-800">{f.business_name}
                    {f.exenta && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">{f.motivo || 'exenta'}</span>}
                  </p>
                  <p className="text-[11px] text-gray-500 font-mono">{f.rfc}</p>
                </td>
                <td className="px-3 py-2 text-center">{f.usuarios}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(f.renta_mxn)}</td>
                <td className="px-3 py-2 text-center text-xs">{f.timbres_usados}<span className="text-gray-400">/{f.timbres_incluidos}</span>{f.timbres_extra > 0 && <span className="block text-[10px] text-rose-600">+{f.timbres_extra} extra</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{money(f.extra_mxn)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{money(f.total_mxn)}</td>
                <td className="px-3 py-2 text-center">{f.exenta
                  ? <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">sin cobro</span>
                  : <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badge(f.status)}`}>{f.status === 'SIN_GENERAR' ? 'sin generar' : f.status}</span>}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  {f.exenta && <span className="text-[11px] text-gray-400">—</span>}
                  {!f.exenta && !f.cargo_id && <span className="text-[11px] text-gray-400">genera la lista</span>}
                  {/* Emitir la factura del servicio: pregunta desde cuál de las dos
                      emisoras (GHC/SAJ) se timbra. Disponible cuando hay cargo y no está pagada. */}
                  {f.cargo_id && f.status !== 'PAGADO' && (
                    <button onClick={() => setEmitir(f)}
                      disabled={busy === f.cargo_id} className="p-1.5 text-violet-600 hover:bg-violet-50 rounded" title="Emitir factura (elige la emisora)">
                      <FileText size={15} />
                    </button>
                  )}
                  {f.cargo_id && f.status !== 'PAGADO' && (
                    <button onClick={() => accion(() => api.pagarFacturacion(f.cargo_id), f.cargo_id, 'Marcado como pagado.')}
                      disabled={busy === f.cargo_id} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded" title="Marcar pagado">
                      {busy === f.cargo_id ? <Loader2 className="animate-spin" size={14} /> : <Check size={15} />}
                    </button>
                  )}
                  {f.cargo_id && f.status === 'PENDIENTE' && (
                    <button onClick={() => { if (confirm(`¿Suspender el servicio de ${f.business_name} por falta de pago?`)) accion(() => api.suspenderFacturacion(f.cargo_id), f.cargo_id, 'Servicio suspendido.'); }}
                      disabled={busy === f.cargo_id} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded" title="Suspender servicio"><Ban size={15} /></button>
                  )}
                  {f.cargo_id && f.status === 'SUSPENDIDO' && (
                    <button onClick={() => accion(() => api.reactivarFacturacion(f.cargo_id), f.cargo_id, 'Servicio reactivado.')}
                      disabled={busy === f.cargo_id} className="p-1.5 text-sky-600 hover:bg-sky-50 rounded" title="Reactivar"><RotateCcw size={15} /></button>
                  )}
                </td>
              </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Seccion>

      {/* 3) Consumo de timbres — colapsable (arranca cerrado) y ordenado por USADOS. */}
      <Seccion colapsable defaultColapsado icon={<Stamp size={16} className="text-violet-600" />} titulo="Consumo de timbres del periodo"
        nota="Timbres timbrados vía SW (stamp_usage), de mayor a menor consumo. Los incluidos crecen con los usuarios; el excedente se cobra a los reales.">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Empresa</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Usados</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Incluidos</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Excedente</th>
          </tr></thead>
          <tbody className="divide-y">
            {[...realesF, ...pruebaF].sort((a, b) => (b.timbres_usados || 0) - (a.timbres_usados || 0)).map((f) => (
              <tr key={f.company_id} className="hover:bg-gray-50">
                <td className="px-3 py-2"><span className="text-gray-800">{f.business_name}</span> <span className="text-[11px] text-gray-400 font-mono">{f.rfc}</span></td>
                <td className="px-3 py-2 text-center tabular-nums font-medium">{f.timbres_usados}</td>
                <td className="px-3 py-2 text-center tabular-nums text-gray-500">{f.timbres_incluidos}</td>
                <td className="px-3 py-2 text-center tabular-nums">{f.timbres_extra > 0 ? <span className="text-rose-600 font-medium">+{f.timbres_extra}</span> : <span className="text-gray-300">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Seccion>

      <p className="text-xs text-gray-500 flex items-start gap-1.5">
        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
        Prepago: se cobra por adelantado. Suspender bloquea el login de la empresa; al marcar pagado se reactiva sola.
        Los ambientes de prueba no se cobran hasta que se eliminen.
      </p>

      {emitir && (
        <ModalEmitir cargo={emitir} emisoras={emisoras}
          onClose={() => setEmitir(null)}
          onDone={(m: string) => { setEmitir(null); setMsg(m); q.refetch(); }} />
      )}
    </div>
  );
}

/** Pregunta DESDE CUÁL emisora (GHC/SAJ) se emite el CFDI del cargo, y lo timbra. */
function ModalEmitir({ cargo, emisoras, onClose, onDone }: { cargo: any; emisoras: any[]; onClose: () => void; onDone: (m: string) => void }) {
  const [emisoraId, setEmisoraId] = useState<string>(emisoras.find((e) => e.predeterminado)?.id || emisoras[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const emitir = async () => {
    if (!emisoraId) { setError('Elige la emisora.'); return; }
    setBusy(true); setError('');
    try {
      const r: any = await api.emitirFacturaMensual(cargo.cargo_id, emisoraId);
      onDone(r?.message || `Factura ${r?.data?.folio || ''} emitida.`);
    } catch (e: any) { setError(e?.response?.data?.message || 'No se pudo emitir.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><FileText size={18} className="text-violet-600" /> Emitir factura</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <p className="text-gray-600">Cliente: <b>{cargo.business_name}</b> <span className="font-mono text-gray-400">{cargo.rfc}</span></p>
          <p className="text-gray-600">Total: <b>{money(cargo.total_mxn)}</b> + IVA · periodo del cargo.</p>
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 block mb-1">¿Desde cuál emisora se factura?</span>
            <select value={emisoraId} onChange={(e) => setEmisoraId(e.target.value)} className="w-full border border-slate-300 rounded px-3 py-2 text-sm">
              {emisoras.length === 0 && <option value="">No hay emisoras marcadas</option>}
              {emisoras.map((e) => (
                <option key={e.id} value={e.id}>{e.business_name} · {e.rfc}{e.predeterminado ? ' (predeterminada)' : ''}</option>
              ))}
            </select>
          </label>
          {error && <p className="text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</p>}
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">Se timbrará un CFDI real desde la emisora elegida. Asegúrate de que el cliente tenga RFC, régimen y CP correctos.</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border text-gray-700 hover:bg-gray-100">Cancelar</button>
          <button onClick={emitir} disabled={busy || !emisoraId}
            className="px-4 py-2 text-sm rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            <FileText size={15} /> {busy ? 'Emitiendo…' : 'Emitir CFDI'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Seccion({ icon, titulo, nota, children, colapsable, defaultColapsado }: { icon: React.ReactNode; titulo: string; nota?: string; children: React.ReactNode; colapsable?: boolean; defaultColapsado?: boolean }) {
  const [abierto, setAbierto] = useState(!defaultColapsado);
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
        {colapsable ? (
          <button onClick={() => setAbierto((a) => !a)} className="flex items-center gap-1.5 hover:text-gray-900">
            {abierto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}{icon} {titulo}
          </button>
        ) : <>{icon} {titulo}</>}
      </h2>
      {nota && abierto && <p className="text-xs text-gray-400 mb-1.5">{nota}</p>}
      {(!colapsable || abierto) && <div className="bg-white rounded-lg shadow overflow-x-auto">{children}</div>}
    </section>
  );
}

function Tarjeta({ label, valor, destacado }: { label: string; valor: any; destacado?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${destacado ? 'bg-emerald-50 border-emerald-200' : 'bg-white'}`}>
      <p className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold ${destacado ? 'text-emerald-700' : 'text-gray-800'}`}>{valor}</p>
    </div>
  );
}

function PanelConfig({ cfg, onGuardado }: { cfg: any; onGuardado: () => void }) {
  const [precio, setPrecio] = useState(String(cfg.precioUsuario));
  const [incl, setIncl] = useState(String(cfg.timbresIncluidos));
  const [extra, setExtra] = useState(String(cfg.timbreExtra));
  const [inclPU, setInclPU] = useState(String(cfg.timbresPorUsuario ?? 500));
  const [extraPU, setExtraPU] = useState(String(cfg.timbreExtraPorUsuario ?? 0.2));
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState('');

  const guardar = async () => {
    setBusy(true); setOk('');
    try {
      await api.setFacturacionConfig({
        precioUsuario: Number(precio), timbresIncluidos: Number(incl), timbreExtra: Number(extra),
        timbresPorUsuario: Number(inclPU), timbreExtraPorUsuario: Number(extraPU),
      });
      setOk('Guardado.'); onGuardado();
    } catch (e: any) { setOk(e?.response?.data?.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };

  const inc10 = Number(incl) + Number(inclPU) * 9;
  const ext10 = (Number(extra) + Number(extraPU) * 9).toFixed(2);

  return (
    <div className="bg-white border rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block"><span className="text-xs text-gray-600 block mb-1">Precio por usuario — introducción (MXN)</span>
          <input value={precio} onChange={(e) => setPrecio(e.target.value)} className="input py-1.5 text-sm w-32" /></label>
        <label className="block"><span className="text-xs text-gray-600 block mb-1">Timbres incluidos base (1 usr)</span>
          <input value={incl} onChange={(e) => setIncl(e.target.value)} className="input py-1.5 text-sm w-32" /></label>
        <label className="block"><span className="text-xs text-gray-600 block mb-1">+ Timbres por usuario</span>
          <input value={inclPU} onChange={(e) => setInclPU(e.target.value)} className="input py-1.5 text-sm w-32" /></label>
        <label className="block"><span className="text-xs text-gray-600 block mb-1">Timbre extra base (MXN)</span>
          <input value={extra} onChange={(e) => setExtra(e.target.value)} className="input py-1.5 text-sm w-32" /></label>
        <label className="block"><span className="text-xs text-gray-600 block mb-1">+ Timbre extra por usuario (MXN)</span>
          <input value={extraPU} onChange={(e) => setExtraPU(e.target.value)} className="input py-1.5 text-sm w-32" /></label>
        <button onClick={guardar} disabled={busy} className="bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">{busy ? 'Guardando…' : 'Guardar'}</button>
        {ok && <span className="text-sm text-emerald-700">{ok}</span>}
      </div>
      <p className="text-[11px] text-gray-400">
        Escalonado: incluidos = base + (por usuario) × (usuarios − 1); timbre extra = base + (por usuario) × (usuarios − 1).
        Con estos valores: <b>1 usuario</b> = {incl} timbres / ${extra} · <b>10 usuarios</b> = {inc10} timbres / ${ext10}. Cobro mensual, sin plazo forzoso.
      </p>
      <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
        <b>Calendario del precio por usuario:</b> el valor de arriba es el de <b>introducción</b> (contrataciones de oct–dic 2026).
        Las que contraten desde el <b>01/01/2027</b> pagan <b>$1,000</b>, y el <b>01/04/2027</b> <b>todas</b> las empresas saltan a <b>$1,000</b>
        (y así queda en 2027). El salto es automático por fecha; aquí solo se ajusta el precio de introducción.
      </p>
    </div>
  );
}

export default AdminFacturacionPage;
