/**
 * Activo fijo y depreciación — parte del XML de compra y la lleva sola:
 *   1. Cédula        — cada activo: concepto, MOI, depreciación anual y mensual,
 *                      acumulada asentada y valor en libros. Tasa y mes de inicio editables.
 *   2. Detectar      — propone activos desde las compras (partidas a cuentas 15x/17x).
 *   3. Depreciación  — genera la póliza de depreciación del mes (cargo a gasto, abono a
 *                      la acumulada). Una por mes, no duplica.
 *
 * Las tasas son los máximos LISR (arts. 33-35); se pueden bajar por activo. Nada se
 * asienta sin el clic de «Generar».
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Sparkles, PlayCircle, FileText, RefreshCw, Check, Pencil, Trash2, X, CalendarClock } from 'lucide-react';
import api from '@/services/api';

const money = (n: any) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const pct = (n: any) => `${(Math.round((Number(n) || 0) * 10000) / 100)}%`;
const fecha = (s?: string) => s ? new Date(s + (s.length <= 10 ? 'T00:00:00' : '')).toLocaleDateString('es-MX') : '—';
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const mesAA = (s?: string) => s ? `${MESES[Number(s.slice(5, 7))]} ${s.slice(0, 4)}` : '—';

export function ActivoFijoPage() {
  const hoy = new Date();
  const [tab, setTab] = useState<'cedula' | 'detectar' | 'depreciacion'>('cedula');
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Building2 size={22} className="text-emerald-700" /> Activo fijo y depreciación
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Cada compra que cae en una cuenta de activo fijo se deprecia sola en línea recta (LISR 33-35):
          su cédula, y una póliza mensual que no duplica.
        </p>
      </div>

      {tab !== 'cedula' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Mes calendario:</span>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input py-1.5 text-sm">
            {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input py-1.5 text-sm w-24">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      )}

      <div className="flex gap-1 border-b">
        {([['cedula', 'Cédula', Building2], ['detectar', 'Detectar desde compras', Sparkles],
           ['depreciacion', 'Pólizas de depreciación', FileText]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 ${
              tab === k ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'cedula' && <TabCedula />}
      {tab === 'detectar' && <TabDetectar anio={anio} mes={mes} />}
      {tab === 'depreciacion' && <TabDepreciacion anio={anio} mes={mes} />}
    </div>
  );
}

/* ── Tab 1: Cédula ─────────────────────────────────────────────────────────── */
function TabCedula() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['activos-fijos'], queryFn: () => api.getActivos() });
  const activos: any[] = q.data?.data?.activos || [];
  const [cedula, setCedula] = useState<string | null>(null);

  const totalMoi = activos.reduce((a, x) => a + Number(x.moi || 0), 0);
  const totalLibros = activos.reduce((a, x) => a + Number(x.valor_en_libros || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm bg-white border rounded-lg p-3">
        <span className="text-gray-600"><b>{activos.length}</b> activo(s)</span>
        <span className="text-gray-400">·</span>
        <span className="text-gray-600">MOI total <b>{money(totalMoi)}</b></span>
        <span className="text-gray-400">·</span>
        <span className="text-gray-600">Valor en libros <b>{money(totalLibros)}</b></span>
        <button onClick={() => q.refetch()} className="ml-auto text-gray-500 hover:text-gray-700" title="Actualizar">
          <RefreshCw size={16} className={q.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Concepto</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Cuenta</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Adquirido</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">MOI</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Tasa</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Anual</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Mensual</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Acumulada</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">En libros</th>
              <th className="px-3 py-2 w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>}
            {!q.isLoading && activos.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500 italic">
                Aún no hay activos. Ve a «Detectar desde compras» para levantarlos del XML.
              </td></tr>
            )}
            {activos.map((a) => (
              <RenglonActivo key={a.id} a={a} onCedula={() => setCedula(a.id)}
                onCambio={() => qc.invalidateQueries({ queryKey: ['activos-fijos'] })} />
            ))}
          </tbody>
        </table>
      </div>

      {cedula && <ModalCedula id={cedula} onClose={() => setCedula(null)} />}
    </div>
  );
}

function RenglonActivo({ a, onCedula, onCambio }: { a: any; onCedula: () => void; onCambio: () => void }) {
  const [editTasa, setEditTasa] = useState(false);
  const [tasa, setTasa] = useState(String(Math.round(Number(a.tasa_anual) * 10000) / 100));
  const [busy, setBusy] = useState(false);

  const guardarTasa = async () => {
    setBusy(true);
    try {
      await api.actualizarActivo(a.id, { tasa_anual: (Number(tasa) || 0) / 100 });
      setEditTasa(false); onCambio();
    } finally { setBusy(false); }
  };
  const baja = async () => {
    if (!confirm(`¿Dar de baja "${a.descripcion}"? Dejará de generar depreciación.`)) return;
    await api.actualizarActivo(a.id, { estado: 'BAJA', fecha_baja: new Date().toISOString().slice(0, 10) });
    onCambio();
  };
  const borrar = async () => {
    if (!confirm(`¿Borrar "${a.descripcion}" de la cédula?`)) return;
    const r: any = await api.borrarActivo(a.id);
    if (r?.success === false) alert(r.message || 'No se pudo borrar');
    onCambio();
  };

  const dado = a.estado === 'BAJA';
  return (
    <tr className={`hover:bg-gray-50 ${dado ? 'opacity-50' : ''}`}>
      <td className="px-3 py-2">
        <button onClick={onCedula} className="text-left group">
          <p className="truncate max-w-xs text-gray-800 group-hover:text-emerald-700">{a.descripcion}</p>
          <p className="text-[11px] text-gray-400">
            {a.proveedor_nombre || a.origen_folio || ''}{a.totalmente_depreciado ? ' · totalmente depreciado' : ''}
            {dado ? ' · BAJA' : ''}
          </p>
        </button>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-gray-600">{a.cuenta_activo}</td>
      <td className="px-3 py-2 text-center text-xs text-gray-500">{fecha(a.fecha_adquisicion)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{money(a.moi)}</td>
      <td className="px-3 py-2 text-center">
        {editTasa ? (
          <span className="inline-flex items-center gap-1">
            <input autoFocus value={tasa} onChange={(e) => setTasa(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') guardarTasa(); if (e.key === 'Escape') setEditTasa(false); }}
              className="input py-0.5 w-16 text-right text-xs" />%
            <button onClick={guardarTasa} disabled={busy} className="text-emerald-600"><Check size={14} /></button>
          </span>
        ) : (
          <button onClick={() => setEditTasa(true)} className="group inline-flex items-center gap-1 text-xs text-gray-700"
            title="Cambiar la tasa (máximo LISR por defecto)">
            {pct(a.tasa_anual)} <Pencil size={11} className="opacity-0 group-hover:opacity-100 text-gray-400" />
          </button>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{money(a.dep_anual)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{money(a.dep_mensual)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{money(a.acumulada)}</td>
      <td className="px-3 py-2 text-right tabular-nums font-medium">{money(a.valor_en_libros)}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5 justify-end">
          {!dado && <button onClick={baja} className="text-gray-400 hover:text-amber-600" title="Dar de baja"><CalendarClock size={15} /></button>}
          <button onClick={borrar} className="text-gray-400 hover:text-rose-600" title="Borrar"><Trash2 size={15} /></button>
        </div>
      </td>
    </tr>
  );
}

function ModalCedula({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['activo-cedula', id], queryFn: () => api.getCedulaActivo(id) });
  const d = q.data?.data;
  const a = d?.activo;
  const renglones: any[] = d?.renglones || [];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-800 truncate">{a?.descripcion || 'Cédula de depreciación'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        {a && (
          <div className="px-4 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 border-b bg-gray-50">
            <span>MOI: <b>{money(a.moi)}</b></span>
            <span>Tasa: <b>{pct(a.tasa_anual)}</b></span>
            <span>Mensual: <b>{money(d?.calculo?.depMensual)}</b></span>
            <span>Anual: <b>{money(d?.calculo?.depAnual)}</b></span>
            <span>Inicio: <b>{mesAA(a.mes_inicio)}</b></span>
            <span>Vida: <b>{d?.calculo?.mesesVida} meses</b></span>
          </div>
        )}
        <div className="overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b sticky top-0">
              <tr>
                <th className="px-3 py-1.5 text-left font-semibold text-gray-600">Mes</th>
                <th className="px-3 py-1.5 text-right font-semibold text-gray-600">Depreciación</th>
                <th className="px-3 py-1.5 text-right font-semibold text-gray-600">Acumulada</th>
                <th className="px-3 py-1.5 text-right font-semibold text-gray-600">En libros</th>
                <th className="px-3 py-1.5 text-center font-semibold text-gray-600">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {q.isLoading && <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-500">Cargando…</td></tr>}
              {!q.isLoading && renglones.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500 italic">Este activo no genera depreciación.</td></tr>
              )}
              {renglones.map((r, i) => (
                <tr key={i} className={r.asentada ? 'bg-emerald-50/50' : ''}>
                  <td className="px-3 py-1 text-gray-700">{MESES[r.mes]} {r.anio}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{money(r.monto)}</td>
                  <td className="px-3 py-1 text-right tabular-nums text-gray-500">{money(r.acumulada)}</td>
                  <td className="px-3 py-1 text-right tabular-nums text-gray-500">{money(r.en_libros)}</td>
                  <td className="px-3 py-1 text-center">
                    {r.asentada
                      ? <span className="text-emerald-700 text-[10px] font-medium">asentada</span>
                      : <span className="text-gray-400 text-[10px]">proyectada</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Tab 2: Detectar desde compras ─────────────────────────────────────────── */
function TabDetectar({ anio, mes }: { anio: number; mes: number }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['activos-detectar', anio, mes], queryFn: () => api.detectarActivos(anio, mes) });
  const detectados: any[] = q.data?.data?.detectados || [];
  const [sel, setSel] = useState<Record<number, boolean>>({});
  const [tasas, setTasas] = useState<Record<number, string>>({});

  const marcados = detectados.filter((_, i) => sel[i]);

  const registrar = async () => {
    if (!marcados.length) return;
    setBusy(true); setMsg('');
    try {
      const payload = detectados
        .map((d, i) => ({ d, i })).filter(({ i }) => sel[i])
        .map(({ d, i }) => ({ ...d, tasa_anual: tasas[i] !== undefined ? (Number(tasas[i]) || 0) / 100 : d.tasa_anual }));
      const r: any = await api.registrarActivosDetectados(payload);
      setMsg(`${r.data?.registrados || 0} activo(s) registrado(s) en la cédula.`);
      setSel({});
      qc.invalidateQueries({ queryKey: ['activos-detectar', anio, mes] });
      qc.invalidateQueries({ queryKey: ['activos-fijos'] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo registrar'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg shadow border p-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-gray-600 flex-1 min-w-[16rem]">
          Toma las compras de <b>{MESES[mes]} {anio}</b> con XML y propone como activo cada partida cuya cuenta sea de
          activo fijo (15x) o intangible (17x). La <b>tasa</b> viene del máximo LISR; ajústala antes de registrar.
        </p>
        <button onClick={() => q.refetch()} disabled={q.isFetching}
          className="flex items-center gap-1.5 bg-white border text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-sm">
          <RefreshCw size={15} className={q.isFetching ? 'animate-spin' : ''} /> Detectar
        </button>
        <button onClick={registrar} disabled={busy || marcados.length === 0}
          className="flex items-center gap-1.5 bg-emerald-700 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-800 disabled:opacity-50 text-sm">
          <PlayCircle size={15} /> Registrar {marcados.length || ''}
        </button>
      </div>
      {msg && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">{msg}</p>}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={detectados.length > 0 && marcados.length === detectados.length}
                  onChange={(e) => setSel(e.target.checked ? Object.fromEntries(detectados.map((_, i) => [i, true])) : {})} />
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Concepto</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Rubro / cuenta</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">MOI</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 w-24">Tasa</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">Buscando…</td></tr>}
            {!q.isLoading && detectados.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500 italic">
                Sin activos por registrar en {MESES[mes]} {anio}. (Recuerda: la partida debe caer en una cuenta 15x/17x,
                y el recibido tener XML.)
              </td></tr>
            )}
            {detectados.map((d, i) => (
              <tr key={i} className={`hover:bg-gray-50 ${!d.depreciable ? 'text-gray-400' : ''}`}>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked={!!sel[i]} onChange={(e) => setSel({ ...sel, [i]: e.target.checked })} />
                </td>
                <td className="px-3 py-2">
                  <p className="truncate max-w-xs text-gray-800">{d.descripcion}</p>
                  <p className="text-[11px] text-gray-400">{d.proveedor_nombre} · {d.origen_folio}</p>
                </td>
                <td className="px-3 py-2">
                  <p className="text-xs text-gray-700">{d.etiqueta}</p>
                  <p className="font-mono text-[11px] text-gray-400">{d.cuenta_activo}{!d.depreciable ? ' · no se deprecia' : ''}</p>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(d.moi)}</td>
                <td className="px-3 py-2 text-center">
                  {d.depreciable ? (
                    <span className="inline-flex items-center gap-0.5">
                      <input value={tasas[i] ?? String(Math.round(d.tasa_anual * 10000) / 100)}
                        onChange={(e) => setTasas({ ...tasas, [i]: e.target.value })}
                        className="input py-0.5 w-14 text-right text-xs" />%
                    </span>
                  ) : <span className="text-xs">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Tab 3: Pólizas de depreciación ────────────────────────────────────────── */
function TabDepreciacion({ anio, mes }: { anio: number; mes: number }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [omitidos, setOmitidos] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['polizas', anio, mes], queryFn: () => api.getPolizas(anio, mes) });
  const polizas: any[] = (q.data?.data?.polizas || []).filter((p: any) => p.origen === 'DEPRECIACION');

  const generar = async () => {
    setBusy(true); setMsg(''); setOmitidos([]);
    try {
      const r: any = await api.generarDepreciacion(anio, mes);
      const d = r.data;
      if (d.yaExiste) setMsg(`Ya existe la póliza de depreciación de ${MESES[mes]} ${anio} (#${d.folio}). Bórrala para regenerar.`);
      else if (d.creada) {
        // Con la póliza recién creada, refresca la balanza para que los saldos ya la incluyan.
        let extra = '';
        try {
          const b: any = await api.actualizarBalanzaDesdePolizas(anio, mes);
          extra = b?.data?.cuadra === false
            ? ' Saldos actualizados — la balanza NO cuadra, revísala.'
            : ' Saldos actualizados en la balanza.';
        } catch { extra = ' (Actualiza los saldos desde Balanza → «Actualizar desde pólizas».)'; }
        setMsg(`Póliza #${d.folio} creada: ${d.activos} activo(s), ${money(d.total)} de depreciación.${extra}`);
      }
      else setMsg(`No había activos que depreciar en ${MESES[mes]} ${anio}.`);
      setOmitidos(d.omitidos || []);
      qc.invalidateQueries({ queryKey: ['polizas', anio, mes] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo generar'); }
    finally { setBusy(false); }
  };

  const borrar = async (id: string) => {
    if (!confirm('¿Borrar la póliza de depreciación del mes? Podrás regenerarla.')) return;
    await api.borrarPoliza(id);
    qc.invalidateQueries({ queryKey: ['polizas', anio, mes] });
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg shadow border p-4 flex flex-wrap items-center gap-2">
        <p className="text-sm text-gray-600 flex-1 min-w-[16rem]">
          Una póliza con la depreciación de <b>{MESES[mes]} {anio}</b>: cargo al gasto (701/702) y abono a la
          acumulada (171/183), por cada activo que ya arrancó y no esté depreciado ese mes. No duplica.
          <span className="block text-xs text-gray-500 mt-1">
            Al <b>cambio de mes</b> esto se genera solo y actualiza los saldos; este botón sirve para adelantarlo o regenerarlo.
          </span>
        </p>
        <button onClick={generar} disabled={busy}
          className="flex items-center gap-1.5 bg-emerald-700 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-800 disabled:opacity-50 text-sm">
          <PlayCircle size={15} /> {busy ? 'Generando…' : 'Generar depreciación'}
        </button>
      </div>
      {msg && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">{msg}</p>}
      {omitidos.length > 0 && (
        <details className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <summary className="cursor-pointer">{omitidos.length} omitido(s) — ver por qué</summary>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {omitidos.map((o, i) => <li key={i}><b>{o.activo}</b>: {o.motivo}</li>)}
          </ul>
        </details>
      )}

      <div className="space-y-2">
        {!q.isLoading && polizas.length === 0 && (
          <p className="text-sm text-gray-500 italic bg-white border rounded-lg p-4 text-center">
            Sin póliza de depreciación en el mes. Genera con el botón de arriba.
          </p>
        )}
        {polizas.map((p) => {
          const cargos = (p.lineas || []).reduce((a: number, l: any) => a + Number(l.cargo || 0), 0);
          const abonos = (p.lineas || []).reduce((a: number, l: any) => a + Number(l.abono || 0), 0);
          return (
            <div key={p.id} className="bg-white border rounded-lg overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50 border-b text-sm">
                <b>#{p.folio}</b>
                <span className="text-gray-500">{fecha(p.fecha)}</span>
                <span className="text-gray-700 truncate">{p.concepto}</span>
                <button onClick={() => borrar(p.id)} className="ml-auto text-gray-400 hover:text-rose-600" title="Borrar (para regenerar)">
                  <Trash2 size={14} />
                </button>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {(p.lineas || []).map((l: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-1 font-mono text-gray-500 w-24">{l.codigo}</td>
                      <td className="px-2 py-1">{l.nombre}{l.concepto ? ` · ${l.concepto}` : ''}</td>
                      <td className="px-3 py-1 text-right w-28">{Number(l.cargo) > 0 ? money(l.cargo) : ''}</td>
                      <td className="px-3 py-1 text-right w-28">{Number(l.abono) > 0 ? money(l.abono) : ''}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold bg-gray-50">
                    <td colSpan={2} className="px-3 py-1 text-right">Sumas</td>
                    <td className="px-3 py-1 text-right">{money(cargos)}</td>
                    <td className="px-3 py-1 text-right">{money(abonos)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ActivoFijoPage;
