/**
 * Comercio Electrónico → Productos (rebanada 3, embebido).
 *
 * Alta/edición/baja de productos SOBRE la misma tabla `products` del ERP (reusa su
 * servicio bajo el gate `ecommerce`). El merchant administra su catálogo sin ver el
 * módulo Productos del ERP; el despacho ve los mismos datos.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Plus, Pencil, Trash2, Loader2, Save, X, ArrowLeft, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/services/api';

const money = (n: any) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

export function ProductosEcPage() {
  const qc = useQueryClient();
  const [busq, setBusq] = useState('');
  const [msg, setMsg] = useState('');
  const [editar, setEditar] = useState<any | null>(null);
  const [crear, setCrear] = useState(false);

  const q = useQuery({ queryKey: ['ec-productos', busq], queryFn: () => api.listProductosEc(busq || undefined) });
  const productos: any[] = (q.data as any)?.data?.products || [];

  const refrescar = () => qc.invalidateQueries({ queryKey: ['ec-productos'] });
  const flash = (t: string) => { setMsg(t); if (t) setTimeout(() => setMsg(''), 4000); };

  const eliminar = async (p: any) => {
    if (!confirm(`¿Dar de baja «${p.name}»?`)) return;
    try { await api.eliminarProductoEc(p.id); flash('Producto dado de baja.'); refrescar(); }
    catch (e: any) { flash(e?.response?.data?.message || 'No se pudo dar de baja.'); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link to="/ecommerce" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={15} /> Comercio Electrónico</Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mt-1"><Package className="text-blue-600" size={24} /> Productos</h1>
          <p className="text-sm text-gray-500">Sobre el catálogo real del ERP. Para vender en la tienda, publícalos en «Catálogo web».</p>
        </div>
        <button onClick={() => setCrear(true)} className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium"><Plus size={16} /> Nuevo producto</button>
      </div>

      {msg && <div className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded">{msg}</div>}

      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
        <input value={busq} onChange={(e) => setBusq(e.target.value)} placeholder="Buscar por nombre, SKU o código…"
          className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm" />
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Producto</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">SKU</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Precio</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
          </tr></thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">Cargando…</td></tr>}
            {!q.isLoading && productos.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400 italic">Sin productos. Crea el primero.</td></tr>}
            {productos.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-3 py-2"><p className="font-medium text-gray-800">{p.name}</p>{p.barcode && <p className="text-[11px] text-gray-400 font-mono">{p.barcode}</p>}</td>
                <td className="px-3 py-2 font-mono text-gray-600">{p.sku}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(p.base_price)}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <button onClick={() => setEditar(p)} className="p-1.5 text-sky-600 hover:bg-sky-50 rounded" title="Editar"><Pencil size={15} /></button>
                  <button onClick={() => eliminar(p)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded" title="Dar de baja"><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(crear || editar) && (
        <ProductoModal producto={editar} onClose={() => { setCrear(false); setEditar(null); }}
          onDone={(t: string) => { setCrear(false); setEditar(null); flash(t); refrescar(); }} />
      )}
    </div>
  );
}

function ProductoModal({ producto, onClose, onDone }: { producto: any | null; onClose: () => void; onDone: (t: string) => void }) {
  const esEdicion = !!producto;
  const [form, setForm] = useState({
    name: producto?.name || '',
    sku: producto?.sku || '',
    basePrice: producto?.base_price ?? '',
    barcode: producto?.barcode || '',
    claveSat: producto?.clave_sat || '01010101',
    unitCode: producto?.unit_code || 'H87',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!form.name.trim()) { setError('Captura el nombre del producto.'); return; }
    const payload: any = {
      name: form.name.trim(), sku: form.sku.trim() || undefined,
      basePrice: form.basePrice === '' ? 0 : Number(form.basePrice),
      barcode: form.barcode.trim() || undefined,
      claveSat: form.claveSat.trim() || '01010101', unitCode: form.unitCode.trim() || 'H87',
      ...(esEdicion ? {} : { taxPresetId: 'iva16' }),
    };
    setBusy(true);
    try {
      if (esEdicion) { await api.actualizarProductoEc(producto.id, payload); onDone('Producto actualizado.'); }
      else { await api.crearProductoEc(payload); onDone('Producto creado.'); }
    } catch (err: any) { setError(err?.response?.data?.message || err.message); }
    finally { setBusy(false); }
  };

  const campo = (label: string, k: keyof typeof form, ph?: string, mono = false) => (
    <label className="block">
      <span className="text-xs font-medium text-gray-600 block mb-1">{label}</span>
      <input value={form[k] as any} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder={ph}
        className={`w-full border border-gray-300 rounded px-3 py-2 text-sm ${mono ? 'font-mono' : ''}`} />
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center"><Package className="text-blue-700" size={20} /></div>
            <h2 className="font-bold text-gray-900">{esEdicion ? 'Editar producto' : 'Nuevo producto'}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}
          {campo('Nombre *', 'name', 'Playera algodón')}
          <div className="grid grid-cols-2 gap-3">
            {campo('SKU', 'sku', 'auto si vacío', true)}
            <label className="block">
              <span className="text-xs font-medium text-gray-600 block mb-1">Precio</span>
              <input type="number" step="any" min="0" value={form.basePrice}
                onChange={(e) => setForm({ ...form, basePrice: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </label>
            {campo('Código de barras', 'barcode', 'EAN/UPC', true)}
            {campo('Clave SAT (ProdServ)', 'claveSat', '01010101', true)}
            {campo('Unidad (c_ClaveUnidad)', 'unitCode', 'H87', true)}
          </div>
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            La clave SAT y la unidad se usan al facturar. Si no las conoces, deja los valores genéricos y tu despacho las ajusta.
          </p>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t bg-slate-50 sticky bottom-0">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={busy} className="flex items-center gap-2 px-5 py-2 rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 font-semibold">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default ProductosEcPage;
