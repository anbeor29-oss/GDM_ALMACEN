/**
 * PLD / antilavado (LFPIORPI) en 3 pasos:
 *   1) Actividades vulnerables — el usuario elige su actividad principal del Art. 17.
 *      Al elegir una que aplique, se DESBLOQUEAN el Expediente y las Alertas.
 *   2) Expediente — expediente único de identificación por cliente (Anexo 2/3).
 *   3) Alertas — cruza las facturas contra el umbral (UMA) y lista lo que exige
 *      identificación / Aviso (día 17), clientes por acumulado y expedientes pendientes.
 * Ver docs/PLD_LFPIORPI_ANALISIS.md.
 */
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Save, AlertTriangle, Users, FileWarning, CalendarClock, Loader2, Lock, FolderOpen } from 'lucide-react';
import api from '@/services/api';
import { claseOpcion } from '@/utils/coloresOpciones';

const money = (n: any) => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PldPage() {
  const qc = useQueryClient();
  const actsQ = useQuery({ queryKey: ['pld-acts'], queryFn: () => api.getPldActividades() });
  const cfgQ = useQuery({ queryKey: ['pld-cfg'], queryFn: () => api.getPldConfig() });

  const acts: any[] = (actsQ.data as any)?.data || [];
  const cfg: any = (cfgQ.data as any)?.data || {};
  const desbloqueado = !!(cfg.activo && cfg.fraccion);

  const [tab, setTab] = useState('ACT');
  const [prefill, setPrefill] = useState<{ rfc: string; nombre: string } | null>(null);

  const abrirExpediente = (rfc: string, nombre: string) => { setPrefill({ rfc, nombre }); setTab('EXP'); };

  const TABS: Array<[string, string, boolean]> = [
    ['ACT', 'Actividades vulnerables', true],
    ['EXP', 'Expediente', desbloqueado],
    ['ALE', 'Alertas', desbloqueado],
  ];

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldAlert size={22} className="text-rose-600" /> PLD · Prevención de Lavado de Dinero
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Antilavado (LFPIORPI). Define tu Actividad Vulnerable; con eso se habilitan el expediente y las alertas.
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {TABS.map(([k, nombre, on], i) => (
          <button key={k} disabled={!on} onClick={() => on && setTab(k)}
            className={`inline-flex items-center gap-1.5 ${claseOpcion(i, tab === k)} ${!on ? 'opacity-40 cursor-not-allowed' : ''}`}>
            {!on && <Lock size={12} />}{nombre}
          </button>
        ))}
      </div>

      {tab === 'ACT' && <PanelActividad acts={acts} cfg={cfg} onSaved={(unlocked) => { qc.invalidateQueries({ queryKey: ['pld-cfg'] }); if (unlocked) setTab('EXP'); }} />}
      {tab === 'EXP' && desbloqueado && <PanelExpediente prefill={prefill} onPrefillUsed={() => setPrefill(null)} />}
      {tab === 'ALE' && desbloqueado && <PanelAlertas onAbrirExpediente={abrirExpediente} />}
    </div>
  );
}

/* ═══════════════ 1 · Actividad vulnerable (config) ═══════════════ */
function PanelActividad({ acts, cfg, onSaved }: { acts: any[]; cfg: any; onSaved: (unlocked: boolean) => void }) {
  const [form, setForm] = useState<any>({ activo: false, fraccion: '', representante_nombre: '', representante_rfc: '', padron_folio: '', padron_alta: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setForm({
      activo: !!cfg.activo, fraccion: cfg.fraccion || '',
      representante_nombre: cfg.representante_nombre || '', representante_rfc: cfg.representante_rfc || '',
      padron_folio: cfg.padron_folio || '', padron_alta: cfg.padron_alta || '',
    });
  }, [cfg]);

  const actSel = acts.find((a) => a.fraccion === form.fraccion);

  const guardar = async () => {
    setBusy(true); setMsg('');
    try {
      await api.setPldConfig(form);
      const unlocked = !!(form.activo && form.fraccion);
      setMsg(unlocked ? 'Guardado. Expediente y alertas habilitados.' : 'Configuración guardada.');
      onSaved(unlocked);
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-lg shadow p-5 space-y-3">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
        <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} />
        Mi empresa realiza una <b>Actividad Vulnerable</b> del Art. 17
      </label>

      {form.activo && (
        <>
          <label className="block">
            <span className="text-xs text-gray-600">Actividad principal (Art. 17)</span>
            <select value={form.fraccion} onChange={(e) => setForm({ ...form, fraccion: e.target.value })} className="input w-full">
              <option value="">— elige tu actividad —</option>
              {acts.map((a) => <option key={a.fraccion} value={a.fraccion}>{a.fraccion}. {a.label}</option>)}
            </select>
            {actSel?.nota && <span className="text-[11px] text-amber-700">{actSel.nota}</span>}
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block"><span className="text-xs text-gray-600">Representante de Cumplimiento (nombre)</span>
              <input value={form.representante_nombre} onChange={(e) => setForm({ ...form, representante_nombre: e.target.value })} className="input w-full" placeholder="Obligatorio para personas morales (Art. 20)" /></label>
            <label className="block"><span className="text-xs text-gray-600">RFC del representante</span>
              <input value={form.representante_rfc} onChange={(e) => setForm({ ...form, representante_rfc: e.target.value })} className="input w-full font-mono uppercase" /></label>
            <label className="block"><span className="text-xs text-gray-600">Folio de alta en el padrón (SPPLD)</span>
              <input value={form.padron_folio} onChange={(e) => setForm({ ...form, padron_folio: e.target.value })} className="input w-full" /></label>
            <label className="block"><span className="text-xs text-gray-600">Fecha de alta en el padrón</span>
              <input type="date" value={form.padron_alta} onChange={(e) => setForm({ ...form, padron_alta: e.target.value })} className="input w-full" /></label>
          </div>
        </>
      )}

      <div className="flex items-center gap-3">
        <button onClick={guardar} disabled={busy} className="inline-flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
      {!form.activo && <p className="text-[11px] text-gray-400">Si tu empresa no realiza ninguna actividad vulnerable, déjalo apagado: el módulo no te pedirá nada.</p>}
    </div>
  );
}

/* ═══════════════ 2 · Expediente único ═══════════════ */
const CAMPOS_COMUN = [
  ['actividad', 'Actividad u ocupación'], ['nacionalidad', 'Nacionalidad'], ['telefono', 'Teléfono'], ['correo', 'Correo'],
  ['calle', 'Calle y número'], ['colonia', 'Colonia'], ['cp', 'Código postal'], ['municipio', 'Municipio / Alcaldía'], ['estado', 'Entidad federativa'],
];
const CAMPOS_FISICA = [['curp', 'CURP'], ['fechaNacimiento', 'Fecha de nacimiento'], ['idTipo', 'Identificación (tipo)'], ['idFolio', 'Folio de la identificación']];
const CAMPOS_MORAL = [['fechaConstitucion', 'Fecha de constitución'], ['representanteNombre', 'Representante legal'], ['representanteRfc', 'RFC del representante']];

function PanelExpediente({ prefill, onPrefillUsed }: { prefill: { rfc: string; nombre: string } | null; onPrefillUsed: () => void }) {
  const qc = useQueryClient();
  const listQ = useQuery({ queryKey: ['pld-exp'], queryFn: () => api.getPldExpedientes() });
  const lista: any[] = (listQ.data as any)?.data || [];

  const vacio = { rfc: '', nombre: '', tipo_persona: 'FISICA', completo: false, beneficiario_controlador: '', datos: {} as any };
  const [f, setF] = useState<any>(vacio);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { if (prefill) { setF({ ...vacio, rfc: prefill.rfc, nombre: prefill.nombre }); onPrefillUsed(); } }, [prefill]);

  const setDato = (k: string, v: string) => setF((p: any) => ({ ...p, datos: { ...p.datos, [k]: v } }));

  const editar = (e: any) => setF({
    rfc: e.rfc, nombre: e.nombre || '', tipo_persona: e.tipo_persona || 'FISICA',
    completo: !!e.completo, beneficiario_controlador: e.beneficiario_controlador || '', datos: e.datos || {},
  });

  const guardar = async () => {
    setBusy(true); setMsg('');
    try {
      await api.savePldExpediente(f);
      await qc.invalidateQueries({ queryKey: ['pld-exp'] });
      await qc.invalidateQueries({ queryKey: ['pld-tab'] });
      setMsg('Expediente guardado.'); setF(vacio);
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };

  const extra = f.tipo_persona === 'MORAL' ? CAMPOS_MORAL : CAMPOS_FISICA;

  return (
    <div className="grid md:grid-cols-5 gap-4">
      {/* Lista */}
      <div className="md:col-span-2 bg-white rounded-lg shadow p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Expedientes</h3>
        {listQ.isLoading ? <p className="text-sm text-gray-500 flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Cargando…</p>
          : lista.length === 0 ? <p className="text-sm text-gray-400 italic py-4 text-center">Sin expedientes. Crea el primero →</p>
          : <ul className="divide-y">
              {lista.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2">
                  <button onClick={() => editar(e)} className="text-left min-w-0">
                    <p className="text-sm text-gray-800 truncate">{e.nombre || e.rfc}</p>
                    <p className="text-[11px] text-gray-400 font-mono">{e.rfc} · {e.tipo_persona || '—'}</p>
                  </button>
                  {e.completo
                    ? <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 shrink-0">Completo</span>
                    : <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">Pendiente</span>}
                </li>
              ))}
            </ul>}
      </div>

      {/* Formulario */}
      <div className="md:col-span-3 bg-white rounded-lg shadow p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><FolderOpen size={15} /> {f.rfc ? 'Editar expediente' : 'Nuevo expediente'}</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-gray-600">RFC</span>
            <input value={f.rfc} onChange={(e) => setF({ ...f, rfc: e.target.value.toUpperCase() })} className="input w-full font-mono uppercase" /></label>
          <label className="block"><span className="text-xs text-gray-600">Nombre / Razón social</span>
            <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} className="input w-full" /></label>
          <label className="block"><span className="text-xs text-gray-600">Tipo de persona</span>
            <select value={f.tipo_persona} onChange={(e) => setF({ ...f, tipo_persona: e.target.value })} className="input w-full">
              <option value="FISICA">Física</option><option value="MORAL">Moral</option>
            </select></label>
          {f.tipo_persona === 'MORAL' && (
            <label className="block"><span className="text-xs text-gray-600">Beneficiario Controlador</span>
              <input value={f.beneficiario_controlador} onChange={(e) => setF({ ...f, beneficiario_controlador: e.target.value })} className="input w-full" placeholder="Quién controla la persona moral" /></label>
          )}
          {[...extra, ...CAMPOS_COMUN].map(([k, label]) => (
            <label key={k} className="block"><span className="text-xs text-gray-600">{label}</span>
              <input value={f.datos?.[k] || ''} onChange={(e) => setDato(k, e.target.value)} className="input w-full" /></label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={f.completo} onChange={(e) => setF({ ...f, completo: e.target.checked })} />
          Expediente <b>completo</b> (con copia de documentos del Anexo {f.tipo_persona === 'MORAL' ? '2' : '3'})
        </label>
        <div className="flex items-center gap-3">
          <button onClick={guardar} disabled={busy || !f.rfc} className="inline-flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar
          </button>
          {f.rfc && <button onClick={() => setF(vacio)} className="text-sm text-gray-500 hover:underline">Limpiar</button>}
          {msg && <span className="text-sm text-gray-600">{msg}</span>}
        </div>
        <p className="text-[11px] text-gray-400">Resguarda la identificación y los documentos por <b>10 años</b> (reforma 2025). Los campos detallados se guardan en el expediente.</p>
      </div>
    </div>
  );
}

/* ═══════════════ 3 · Alertas (tablero) ═══════════════ */
function PanelAlertas({ onAbrirExpediente }: { onAbrirExpediente: (rfc: string, nombre: string) => void }) {
  const tabQ = useQuery({ queryKey: ['pld-tab'], queryFn: () => api.getPldTablero() });
  const tab: any = (tabQ.data as any)?.data || {};

  if (tabQ.isLoading) return <p className="text-sm text-gray-500 flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Calculando…</p>;
  if (!tab.activo) return <p className="text-sm text-gray-500">Activa tu Actividad Vulnerable en el primer paso.</p>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4 text-sm text-gray-700 flex flex-wrap items-center gap-x-6 gap-y-1">
        <span><b>{tab.fraccion}.</b> {tab.actividad}</span>
        <span className="text-gray-500">UMA diaria: <b>${money(tab.uma)}</b></span>
        {tab.umbralIdentificacion != null && <span>Identificar desde: <b>${money(tab.umbralIdentificacion)}</b> <span className="text-gray-400">({tab.umbralIdentificacionUma} UMA)</span></span>}
        {tab.umbralIdentificacionUma === 0 && <span>Identificar: <b>siempre</b></span>}
        {tab.umbralAviso != null && <span>Avisar desde: <b>${money(tab.umbralAviso)}</b> <span className="text-gray-400">({tab.umbralAvisoUma} UMA)</span></span>}
        <span className="inline-flex items-center gap-1 text-rose-700"><CalendarClock size={14} /> Próximo corte: <b>{tab.proximoCorte}</b></span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tarjeta n={tab.totales.operacionesAviso} label="Operaciones por AVISAR" color="rose" icon={<AlertTriangle size={16} />} />
        <Tarjeta n={tab.totales.operacionesIdentificacion} label="Por identificar" color="amber" icon={<FileWarning size={16} />} />
        <Tarjeta n={tab.totales.clientesAcumulado} label="Clientes sobre umbral (6 meses)" color="indigo" icon={<Users size={16} />} />
        <Tarjeta n={tab.totales.expedientePendiente} label="Expedientes pendientes" color="slate" icon={<FileWarning size={16} />} />
      </div>

      {tab.operacionesAviso?.length > 0 && (
        <Seccion titulo="Operaciones que requieren Aviso a la UIF" color="rose"><TablaOps rows={tab.operacionesAviso} /></Seccion>
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
                <button onClick={() => onAbrirExpediente(e.rfc, e.nombre)} className="inline-flex items-center gap-1 text-xs text-primary border border-primary/30 rounded px-2 py-1 hover:bg-primary/5">
                  <FolderOpen size={12} /> Integrar expediente
                </button>
              </li>
            ))}
          </ul>
        </Seccion>
      )}

      <p className="text-[11px] text-gray-400">El Aviso se presenta en el Portal del SAT (SPPLD) con tu e.firma; NEXO detecta y arma el expediente. Umbrales según la UMA vigente.</p>
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
