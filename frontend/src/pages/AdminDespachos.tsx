/**
 * Súper Admin → «Despachos contables».
 *
 * El despacho es la FIRMA que administra a sus empresas cliente y donde se FIJAN LOS
 * PRECIOS del servicio. Aquí se dan de alta / baja y se editan sus precios:
 *   · precio por usuario (NULL = hereda el precio global de Facturación),
 *   · escalón de timbres (incluidos base, +incluidos por usuario, timbre extra…),
 *   · emisora de cobro predeterminada.
 * La empresa se asigna a un despacho desde «Empresas → Editar empresa».
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Pencil, Trash2, Loader2, Save, X, DollarSign } from 'lucide-react';
import api from '@/services/api';

export function AdminDespachosPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [editar, setEditar] = useState<any | null>(null);   // despacho a editar
  const [crear, setCrear] = useState(false);

  const q = useQuery({ queryKey: ['admin-despachos'], queryFn: () => api.listDespachos() });
  const despachos: any[] = (q.data as any)?.data?.despachos || [];

  const refrescar = () => { qc.invalidateQueries({ queryKey: ['admin-despachos'] }); q.refetch(); };
  const flash = (t: string) => { setMsg(t); if (t) setTimeout(() => setMsg(''), 4000); };

  const eliminar = async (d: any) => {
    if (!confirm(`¿Dar de baja el despacho «${d.nombre}»?\nSus ${d.empresas} empresa(s) quedarán «sin despacho» (no se borran).`)) return;
    try { const r = await api.eliminarDespacho(d.id); flash(r?.message || 'Despacho dado de baja.'); refrescar(); }
    catch (e: any) { flash(e?.response?.data?.message || 'No se pudo dar de baja.'); }
  };

  const money = (n: any) => n == null ? null : `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
        <div className="flex items-center gap-3">
          <Building2 className="text-indigo-600" size={26} />
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Despachos contables</h1>
            <p className="text-sm text-gray-500">Da de alta/baja despachos y fija sus precios. La empresa se mete a un despacho desde «Empresas → Editar empresa».</p>
          </div>
        </div>
        <button onClick={() => setCrear(true)}
          className="inline-flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm font-medium">
          <Plus size={16} /> Nuevo despacho
        </button>
      </div>

      {msg && <div className="my-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded">{msg}</div>}

      <div className="mt-4 bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Despacho</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Empresas</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Usuarios</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Precio/usuario</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Timbres incl.</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Timbre extra</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Emisora predet.</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
          </tr></thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">Cargando…</td></tr>}
            {!q.isLoading && despachos.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400 italic">Sin despachos. Crea el primero con «Nuevo despacho».</td></tr>
            )}
            {despachos.map((d) => (
              <tr key={d.id} className={`hover:bg-gray-50 ${d.activo ? '' : 'opacity-60'}`}>
                <td className="px-3 py-2">
                  <p className="font-medium text-gray-800">{d.nombre}</p>
                  {!d.activo && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">inactivo</span>}
                  {d.notas && <p className="text-[11px] text-gray-400">{d.notas}</p>}
                </td>
                <td className="px-3 py-2 text-center">{d.empresas}</td>
                <td className="px-3 py-2 text-center">{d.usuarios}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(d.precio_usuario_mxn) || <span className="text-[11px] text-gray-400 italic">global</span>}
                </td>
                <td className="px-3 py-2 text-center">
                  {d.timbres_incluidos != null ? d.timbres_incluidos : <span className="text-[11px] text-gray-400 italic">global</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(d.timbre_extra_mxn) || <span className="text-[11px] text-gray-400 italic">global</span>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">{d.emisora_nombre || <span className="text-gray-400 italic">—</span>}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <button onClick={() => setEditar(d)} className="p-1.5 text-sky-600 hover:bg-sky-50 rounded" title="Editar"><Pencil size={15} /></button>
                  <button onClick={() => eliminar(d)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded" title="Dar de baja"><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        «Precio/usuario» y «Timbres» en blanco heredan el precio global (Facturación → Precios). Un valor aquí es el <b>precio propio del despacho</b> y no se le aplica el brinco por calendario.
      </p>

      {(crear || editar) && (
        <DespachoModal despacho={editar} onClose={() => { setCrear(false); setEditar(null); }}
          onDone={(t: string) => { setCrear(false); setEditar(null); flash(t); refrescar(); }} />
      )}
    </div>
  );
}

/* ─────────────── Modal: alta / edición de despacho ─────────────── */
function DespachoModal({ despacho, onClose, onDone }: { despacho: any | null; onClose: () => void; onDone: (t: string) => void }) {
  const esEdicion = !!despacho;
  const [form, setForm] = useState({
    nombre: despacho?.nombre || '',
    precioUsuario: despacho?.precio_usuario_mxn ?? '',
    timbresIncluidos: despacho?.timbres_incluidos ?? '',
    timbreExtra: despacho?.timbre_extra_mxn ?? '',
    timbresPorUsuario: despacho?.timbres_por_usuario ?? '',
    timbreExtraPorUsuario: despacho?.timbre_extra_por_usuario ?? '',
    emisoraPredeterminadaId: despacho?.emisora_predeterminada_id || '',
    notas: despacho?.notas || '',
    activo: despacho ? despacho.activo !== false : true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { data: emisoresData } = useQuery({ queryKey: ['admin-emisores'], queryFn: () => api.adminListEmisores() });
  const emisores: any[] = ((emisoresData as any)?.data?.emisores || []);

  // '' → null (hereda el global); si no, número.
  const num = (v: any) => v === '' || v === null ? null : Number(v);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.nombre.trim()) { setError('Captura el nombre del despacho.'); return; }
    const payload = {
      nombre: form.nombre.trim(),
      precioUsuario: num(form.precioUsuario),
      timbresIncluidos: num(form.timbresIncluidos),
      timbreExtra: num(form.timbreExtra),
      timbresPorUsuario: num(form.timbresPorUsuario),
      timbreExtraPorUsuario: num(form.timbreExtraPorUsuario),
      emisoraPredeterminadaId: form.emisoraPredeterminadaId || null,
      notas: form.notas.trim(),
      ...(esEdicion ? { activo: form.activo } : {}),
    };
    setBusy(true);
    try {
      if (esEdicion) { await api.actualizarDespacho(despacho.id, payload); onDone('Despacho actualizado.'); }
      else { const r = await api.crearDespacho(payload as any); onDone(r?.message || 'Despacho creado.'); }
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message);
    } finally { setBusy(false); }
  };

  // Campo numérico como FUNCIÓN inline (no componente): si fuera <Campo/> React lo
  // remonta en cada tecla y el input perdería el foco. Llamado como {campo(...)} se
  // mezcla en el árbol del formulario sin remontar.
  const campo = (label: string, k: keyof typeof form, ph?: string, hint?: string) => (
    <label className="block">
      <span className="text-xs font-medium text-gray-600 block mb-1">{label}</span>
      <input type="number" step="any" min="0" value={form[k] as any} placeholder={ph}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
      {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center"><Building2 className="text-indigo-700" size={20} /></div>
            <h2 className="font-bold text-gray-900">{esEdicion ? 'Editar despacho' : 'Nuevo despacho'}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-5">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}

          <label className="block">
            <span className="text-xs font-medium text-gray-600 block mb-1">Nombre del despacho *</span>
            <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              placeholder="GRUPO HCGM" className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </label>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-indigo-700 mb-2 flex items-center gap-1.5"><DollarSign size={13} /> Precios del despacho</p>
            <p className="text-[11px] text-gray-500 mb-2">Deja en blanco para <b>heredar el precio global</b> de Facturación. Un valor fija el precio propio del despacho.</p>
            <div className="grid grid-cols-2 gap-3">
              {campo('Precio por usuario', 'precioUsuario', 'global', '$ / usuario facturable')}
              {campo('Timbres incluidos (base)', 'timbresIncluidos', 'global', 'con 1 usuario')}
              {campo('+ Incluidos por usuario', 'timbresPorUsuario', 'global', 'por cada usuario extra')}
              {campo('Precio timbre extra', 'timbreExtra', 'global', '$ por timbre excedente')}
              {campo('+ $ timbre extra por usuario', 'timbreExtraPorUsuario', 'global', 'sube el extra por usuario')}
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-gray-600 block mb-1">Emisora de cobro predeterminada</span>
            <select value={form.emisoraPredeterminadaId} onChange={(e) => setForm({ ...form, emisoraPredeterminadaId: e.target.value })}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white">
              <option value="">— ninguna —</option>
              {emisores.map((em) => <option key={em.id} value={em.id}>{em.rfc} · {em.business_name}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-gray-600 block mb-1">Notas</span>
            <input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </label>

          {esEdicion && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /> Activo
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t bg-slate-50 sticky bottom-0">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={busy} className="flex items-center gap-2 px-5 py-2 rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 font-semibold">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
