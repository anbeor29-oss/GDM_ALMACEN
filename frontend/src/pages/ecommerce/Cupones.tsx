/**
 * Comercio Electrónico → Cupones / Promociones (rebanada 9).
 *
 * Códigos de descuento por empresa (aplican a cualquier tienda). El comprador los
 * captura en el checkout; el descuento baja el precio NETO de los productos (el CFDI
 * sale correcto, IVA sobre el neto). Porcentaje o monto fijo, con mínimo de compra,
 * vigencia y límite de usos opcionales.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tag, ArrowLeft, Plus, Pencil, Trash2, Loader2, Save, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/services/api';

const money = (n: any) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
const fechaMx = (s: string | null) => (s ? s.split('-').reverse().join('/') : '—');

export function CuponesEcPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [editar, setEditar] = useState<any | null>(null);
  const [crear, setCrear] = useState(false);

  const q = useQuery({ queryKey: ['ec-cupones'], queryFn: () => api.getCuponesEc() });
  const cupones: any[] = (q.data as any)?.data?.cupones || [];

  const refrescar = () => qc.invalidateQueries({ queryKey: ['ec-cupones'] });
  const flash = (t: string) => { setMsg(t); if (t) setTimeout(() => setMsg(''), 3000); };

  const toggle = async (c: any) => {
    try { await api.actualizarCuponEc(c.id, { activo: !c.activo }); refrescar(); }
    catch (e: any) { flash(e?.response?.data?.message || 'No se pudo cambiar.'); }
  };
  const eliminar = async (c: any) => {
    if (!window.confirm(`¿Eliminar el cupón «${c.codigo}»?`)) return;
    try { const r = await api.eliminarCuponEc(c.id); flash(r?.message || 'Cupón eliminado.'); refrescar(); }
    catch (e: any) { flash(e?.response?.data?.message || 'No se pudo eliminar.'); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link to="/ecommerce" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={15} /> Comercio Electrónico</Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mt-1"><Tag className="text-fuchsia-600" size={24} /> Cupones y promociones</h1>
          <p className="text-sm text-gray-500">Códigos de descuento para tus tiendas. Porcentaje o monto fijo, con mínimo, vigencia y límite de usos opcionales.</p>
        </div>
        <button onClick={() => setCrear(true)}
          className="inline-flex items-center gap-1.5 bg-fuchsia-600 text-white px-4 py-2 rounded-lg hover:bg-fuchsia-700 text-sm font-medium">
          <Plus size={16} /> Nuevo cupón
        </button>
      </div>

      {msg && <div className="text-sm bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-800 px-3 py-2 rounded">{msg}</div>}

      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Código</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Descuento</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Mínimo</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Vence</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Usos</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Activo</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
          </tr></thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">Cargando…</td></tr>}
            {!q.isLoading && cupones.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400 italic">Sin cupones. Crea el primero con «Nuevo cupón».</td></tr>}
            {cupones.map((c) => (
              <tr key={c.id} className={`hover:bg-gray-50 ${c.activo ? '' : 'opacity-60'}`}>
                <td className="px-3 py-2 font-mono font-semibold text-gray-900">{c.codigo}</td>
                <td className="px-3 py-2 text-gray-700">{c.tipo === 'PORCENTAJE' ? `${c.valor}%` : money(c.valor)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{c.min_compra != null ? money(c.min_compra) : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2 text-center text-gray-600">{fechaMx(c.vence)}</td>
                <td className="px-3 py-2 text-center text-gray-600">{c.usos}{c.usos_max != null ? ` / ${c.usos_max}` : ''}</td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => toggle(c)} title={c.activo ? 'Activo — clic para desactivar' : 'Inactivo — clic para activar'}
                    className={`w-9 h-5 rounded-full relative transition-colors ${c.activo ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${c.activo ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <button onClick={() => setEditar(c)} className="p-1.5 text-sky-600 hover:bg-sky-50 rounded" title="Editar"><Pencil size={15} /></button>
                  <button onClick={() => eliminar(c)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded" title="Eliminar"><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(crear || editar) && (
        <CuponModal cupon={editar} onClose={() => { setCrear(false); setEditar(null); }}
          onDone={(t: string) => { setCrear(false); setEditar(null); flash(t); refrescar(); }} />
      )}
    </div>
  );
}

function CuponModal({ cupon, onClose, onDone }: { cupon: any | null; onClose: () => void; onDone: (t: string) => void }) {
  const esEdicion = !!cupon;
  const [form, setForm] = useState({
    codigo: cupon?.codigo || '',
    tipo: cupon?.tipo || 'PORCENTAJE',
    valor: cupon?.valor ?? '',
    minCompra: cupon?.min_compra ?? '',
    vence: cupon?.vence || '',
    usosMax: cupon?.usos_max ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!form.codigo.trim()) { setError('Captura el código del cupón.'); return; }
    if (form.valor === '' || Number(form.valor) <= 0) { setError('Captura el valor del descuento.'); return; }
    setBusy(true);
    const payload = {
      codigo: form.codigo.trim().toUpperCase(),
      tipo: form.tipo,
      valor: Number(form.valor),
      minCompra: form.minCompra === '' ? null : Number(form.minCompra),
      vence: form.vence || null,
      usosMax: form.usosMax === '' ? null : Number(form.usosMax),
    };
    try {
      if (esEdicion) { await api.actualizarCuponEc(cupon.id, payload); onDone('Cupón actualizado.'); }
      else { const r = await api.crearCuponEc(payload); onDone(r?.message || 'Cupón creado.'); }
    } catch (err: any) { setError(err?.response?.data?.message || err.message); }
    finally { setBusy(false); }
  };

  const campo = (label: string, k: keyof typeof form, props: any = {}) => (
    <label className="block">
      <span className="text-xs font-medium text-gray-600 block mb-1">{label}</span>
      <input value={form[k] as any} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm" {...props} />
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-fuchsia-100 rounded-lg flex items-center justify-center"><Tag className="text-fuchsia-700" size={20} /></div>
            <h2 className="font-bold text-gray-900">{esEdicion ? 'Editar cupón' : 'Nuevo cupón'}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}
          <label className="block">
            <span className="text-xs font-medium text-gray-600 block mb-1">Código *</span>
            <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })}
              placeholder="BIENVENIDA10" className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono uppercase" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600 block mb-1">Tipo</span>
              <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white">
                <option value="PORCENTAJE">Porcentaje (%)</option>
                <option value="MONTO">Monto fijo ($)</option>
              </select>
            </label>
            {campo(form.tipo === 'PORCENTAJE' ? 'Porcentaje *' : 'Monto *', 'valor', { type: 'number', step: 'any', min: '0', placeholder: form.tipo === 'PORCENTAJE' ? '10' : '100.00' })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {campo('Compra mínima (opcional)', 'minCompra', { type: 'number', step: 'any', min: '0', placeholder: 'sin mínimo' })}
            {campo('Vence (opcional)', 'vence', { type: 'date' })}
          </div>
          {campo('Límite de usos (opcional)', 'usosMax', { type: 'number', min: '0', step: '1', placeholder: 'ilimitado' })}
          <p className="text-[11px] text-gray-400">El descuento baja el precio de los productos (no el envío). El monto fijo se entiende con IVA incluido.</p>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t bg-slate-50 sticky bottom-0">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={busy} className="flex items-center gap-2 px-5 py-2 rounded-lg text-white bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50 font-semibold">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default CuponesEcPage;
