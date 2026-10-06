/**
 * PLD / antilavado (LFPIORPI) — se activa sólo si la empresa declara una Actividad
 * Vulnerable (Art. 17). Jala las facturas emitidas de NEXO y las cruza contra el
 * umbral (monto en UMA × UMA vigente) para alertar qué exige identificación y qué
 * exige Aviso a la UIF (día 17 del mes siguiente). Ver docs/PLD_LFPIORPI_ANALISIS.md.
 */
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Save, AlertTriangle, Users, FileWarning, CalendarClock, Loader2, Check } from 'lucide-react';
import api from '@/services/api';

const money = (n: any) => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PldPage() {
  const qc = useQueryClient();
  const actsQ = useQuery({ queryKey: ['pld-acts'], queryFn: () => api.getPldActividades() });
  const cfgQ = useQuery({ queryKey: ['pld-cfg'], queryFn: () => api.getPldConfig() });
  const tabQ = useQuery({ queryKey: ['pld-tab'], queryFn: () => api.getPldTablero() });

  const acts: any[] = (actsQ.data as any)?.data || [];
  const cfg: any = (cfgQ.data as any)?.data || {};
  const tab: any = (tabQ.data as any)?.data || {};

  const [form, setForm] = useState<any>({ activo: false, fraccion: '', representante_nombre: '', representante_rfc: '', padron_folio: '', padron_alta: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (cfgQ.data) setForm({
      activo: !!cfg.activo, fraccion: cfg.fraccion || '',
      representante_nombre: cfg.representante_nombre || '', representante_rfc: cfg.representante_rfc || '',
      padron_folio: cfg.padron_folio || '', padron_alta: cfg.padron_alta || '',
    });
  }, [cfgQ.data]);

  const guardar = async () => {
    setBusy(true); setMsg('');
    try {
      await api.setPldConfig(form);
      await Promise.all([qc.invalidateQueries({ queryKey: ['pld-cfg'] }), qc.invalidateQueries({ queryKey: ['pld-tab'] })]);
      setMsg('Configuración guardada.');
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };

  const marcarExpediente = async (rfc: string, nombre: string) => {
    try {
      await api.savePldExpediente({ rfc, nombre, completo: true });
      qc.invalidateQueries({ queryKey: ['pld-tab'] });
    } catch { /* noop */ }
  };

  const actSel = acts.find((a) => a.fraccion === form.fraccion);

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldAlert size={22} className="text-rose-600" /> PLD · Prevención de Lavado de Dinero
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Antilavado (LFPIORPI). Se activa sólo si tu empresa realiza una Actividad Vulnerable (Art. 17). NEXO cruza
          tus facturas contra el umbral y te avisa qué requiere identificación y qué requiere Aviso a la UIF.
        </p>
      </div>

      {/* ── Configuración ── */}
      <div className="bg-white rounded-lg shadow p-5 space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
          Mi empresa realiza una <b>Actividad Vulnerable</b> del Art. 17
        </label>

        {form.activo && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block md:col-span-2">
              <span className="text-xs text-gray-600">Actividad Vulnerable (Art. 17)</span>
              <select value={form.fraccion} onChange={(e) => setForm({ ...form, fraccion: e.target.value })} className="input w-full">
                <option value="">— elige la fracción —</option>
                {acts.map((a) => <option key={a.fraccion} value={a.fraccion}>{a.fraccion}. {a.label}</option>)}
              </select>
              {actSel?.nota && <span className="text-[11px] text-amber-700">{actSel.nota}</span>}
            </label>
            <label className="block"><span className="text-xs text-gray-600">Representante de Cumplimiento (nombre)</span>
              <input value={form.representante_nombre} onChange={(e) => setForm({ ...form, representante_nombre: e.target.value })} className="input w-full" placeholder="Obligatorio para personas morales (Art. 20)" /></label>
            <label className="block"><span className="text-xs text-gray-600">RFC del representante</span>
              <input value={form.representante_rfc} onChange={(e) => setForm({ ...form, representante_rfc: e.target.value })} className="input w-full font-mono uppercase" /></label>
            <label className="block"><span className="text-xs text-gray-600">Folio de alta en el padrón (SPPLD)</span>
              <input value={form.padron_folio} onChange={(e) => setForm({ ...form, padron_folio: e.target.value })} className="input w-full" /></label>
            <label className="block"><span className="text-xs text-gray-600">Fecha de alta en el padrón</span>
              <input type="date" value={form.padron_alta} onChange={(e) => setForm({ ...form, padron_alta: e.target.value })} className="input w-full" /></label>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button onClick={guardar} disabled={busy} className="inline-flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar
          </button>
          {msg && <span className="text-sm text-gray-600">{msg}</span>}
        </div>
      </div>

      {/* ── Tablero (sólo si está activo) ── */}
      {tabQ.isLoading && <p className="text-sm text-gray-500 flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Calculando…</p>}

      {tab?.activo && (
        <>
          {/* Barra de umbrales */}
          <div className="bg-white rounded-lg shadow p-4 text-sm text-gray-700 flex flex-wrap items-center gap-x-6 gap-y-1">
            <span><b>{tab.fraccion}.</b> {tab.actividad}</span>
            <span className="text-gray-500">UMA diaria: <b>${money(tab.uma)}</b></span>
            {tab.umbralIdentificacion != null && <span>Identificar desde: <b>${money(tab.umbralIdentificacion)}</b> <span className="text-gray-400">({tab.umbralIdentificacionUma} UMA)</span></span>}
            {tab.umbralIdentificacion === null && tab.umbralIdentificacionUma === 0 && <span>Identificar: <b>siempre</b></span>}
            {tab.umbralAviso != null && <span>Avisar desde: <b>${money(tab.umbralAviso)}</b> <span className="text-gray-400">({tab.umbralAvisoUma} UMA)</span></span>}
            <span className="inline-flex items-center gap-1 text-rose-700"><CalendarClock size={14} /> Próximo corte: <b>{tab.proximoCorte}</b></span>
          </div>

          {/* Tarjetas de alerta */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tarjeta n={tab.totales.operacionesAviso} label="Operaciones por AVISAR" color="rose" icon={<AlertTriangle size={16} />} />
            <Tarjeta n={tab.totales.operacionesIdentificacion} label="Por identificar" color="amber" icon={<FileWarning size={16} />} />
            <Tarjeta n={tab.totales.clientesAcumulado} label="Clientes sobre umbral (6 meses)" color="indigo" icon={<Users size={16} />} />
            <Tarjeta n={tab.totales.expedientePendiente} label="Expedientes pendientes" color="slate" icon={<FileWarning size={16} />} />
          </div>

          {tab.operacionesAviso?.length > 0 && (
            <Seccion titulo="Operaciones que requieren Aviso a la UIF" color="rose">
              <TablaOps rows={tab.operacionesAviso} />
            </Seccion>
          )}

          {tab.clientesAcumulado?.length > 0 && (
            <Seccion titulo="Clientes que rebasan el umbral por acumulación de 6 meses" color="indigo">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-gray-500"><th className="py-1.5">RFC</th><th>Cliente</th><th className="text-right">Operaciones</th><th className="text-right">Acumulado</th></tr></thead>
                <tbody className="divide-y">
                  {tab.clientesAcumulado.map((c: any, i: number) => (
                    <tr key={i}><td className="py-1.5 font-mono text-xs">{c.rfc}</td><td className="truncate">{c.nombre}</td><td className="text-right">{c.n}</td><td className="text-right font-medium">${money(c.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </Seccion>
          )}

          {tab.expedientePendiente?.length > 0 && (
            <Seccion titulo="Expedientes únicos pendientes de integrar" color="amber">
              <ul className="divide-y">
                {tab.expedientePendiente.map((e: any, i: number) => (
                  <li key={i} className="flex items-center justify-between py-1.5 text-sm">
                    <span><span className="font-mono text-xs text-gray-500 mr-2">{e.rfc}</span>{e.nombre}</span>
                    <button onClick={() => marcarExpediente(e.rfc, e.nombre)} className="inline-flex items-center gap-1 text-xs text-emerald-700 border border-emerald-200 rounded px-2 py-1 hover:bg-emerald-50">
                      <Check size={12} /> Marcar integrado
                    </button>
                  </li>
                ))}
              </ul>
            </Seccion>
          )}

          <p className="text-[11px] text-gray-400">
            El Aviso se presenta en el Portal del SAT (SPPLD) con tu e.firma; NEXO detecta y arma el expediente.
            Resguarda la información por 10 años (reforma 2025). Umbrales según la UMA vigente.
          </p>
        </>
      )}

      {cfgQ.data && !tab?.activo && !tabQ.isLoading && (
        <p className="text-sm text-gray-500 bg-gray-50 border rounded px-3 py-2">
          Activa arriba la Actividad Vulnerable y elige la fracción para ver el tablero de alertas.
        </p>
      )}
    </div>
  );
}

function Tarjeta({ n, label, color, icon }: { n: number; label: string; color: string; icon: any }) {
  const c: any = { rose: 'text-rose-700 bg-rose-50 border-rose-200', amber: 'text-amber-700 bg-amber-50 border-amber-200', indigo: 'text-indigo-700 bg-indigo-50 border-indigo-200', slate: 'text-slate-700 bg-slate-50 border-slate-200' };
  return (
    <div className={`rounded-lg border p-3 ${c[color]}`}>
      <div className="flex items-center gap-1.5 text-xs">{icon}{label}</div>
      <div className="text-2xl font-bold mt-1">{n}</div>
    </div>
  );
}

function Seccion({ titulo, color, children }: { titulo: string; color: string; children: any }) {
  const c: any = { rose: 'text-rose-800', indigo: 'text-indigo-800', amber: 'text-amber-800' };
  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-2 overflow-x-auto">
      <h3 className={`text-sm font-semibold ${c[color] || 'text-gray-800'}`}>{titulo}</h3>
      {children}
    </div>
  );
}

function TablaOps({ rows }: { rows: any[] }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b text-left text-xs text-gray-500"><th className="py-1.5">Fecha</th><th>Folio</th><th>RFC</th><th>Cliente</th><th className="text-right">Total</th></tr></thead>
      <tbody className="divide-y">
        {rows.map((f: any) => (
          <tr key={f.id}><td className="py-1.5">{f.fecha}</td><td className="text-xs">{f.serie}-{f.folio}</td><td className="font-mono text-xs">{f.rfc}</td><td className="truncate max-w-[16rem]">{f.nombre}</td><td className="text-right font-medium">${money(f.total)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export default PldPage;
