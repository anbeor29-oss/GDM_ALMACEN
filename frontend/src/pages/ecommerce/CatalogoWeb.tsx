/**
 * Comercio Electrónico → Catálogo web (rebanada 3, el núcleo).
 *
 * Decide QUÉ productos salen a la tienda y con qué contenido web, SOBRE el catálogo
 * real del ERP (no lo copia): `ec_product_channel` liga por product_id y, si un campo
 * web va vacío, el storefront usa el dato del maestro (nombre/precio base).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, ArrowLeft, Search, Star, Save, X, Loader2, Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/services/api';

const money = (n: any) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

export function CatalogoWebPage() {
  const qc = useQueryClient();
  const [busq, setBusq] = useState('');
  const [soloPub, setSoloPub] = useState(false);
  const [msg, setMsg] = useState('');
  const [editar, setEditar] = useState<any | null>(null);

  const q = useQuery({
    queryKey: ['ec-catalogo', busq, soloPub],
    queryFn: () => api.getCatalogoEc({ search: busq || undefined, publicados: soloPub }),
  });
  const items: any[] = (q.data as any)?.data?.catalogo || [];

  const refrescar = () => { qc.invalidateQueries({ queryKey: ['ec-catalogo'] }); qc.invalidateQueries({ queryKey: ['ecommerce-estado'] }); };
  const flash = (t: string) => { setMsg(t); if (t) setTimeout(() => setMsg(''), 3000); };

  const togglePublicar = async (it: any) => {
    try { await api.publicarProductoEc(it.product_id, !it.publicado); refrescar(); }
    catch (e: any) { flash(e?.response?.data?.message || 'No se pudo cambiar.'); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <Link to="/ecommerce" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={15} /> Comercio Electrónico</Link>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mt-1"><Globe className="text-cyan-600" size={24} /> Catálogo web</h1>
        <p className="text-sm text-gray-500">Elige qué productos se publican en la tienda y su precio/contenido web. El precio web vacío usa el precio del producto.</p>
      </div>

      {msg && <div className="text-sm bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 rounded">{msg}</div>}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
          <input value={busq} onChange={(e) => setBusq(e.target.value)} placeholder="Buscar producto…"
            className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm" />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={soloPub} onChange={(e) => setSoloPub(e.target.checked)} /> Sólo publicados
        </label>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Publicar</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Producto</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Precio ERP</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Precio web</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Web</th>
          </tr></thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Cargando…</td></tr>}
            {!q.isLoading && items.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400 italic">Sin productos. Da de alta productos primero.</td></tr>}
            {items.map((it) => (
              <tr key={it.product_id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-center">
                  {/* Interruptor de publicado */}
                  <button onClick={() => togglePublicar(it)} title={it.publicado ? 'Publicado — clic para ocultar' : 'Oculto — clic para publicar'}
                    className={`w-10 h-5 rounded-full relative transition-colors ${it.publicado ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${it.publicado ? 'left-5' : 'left-0.5'}`} />
                  </button>
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium text-gray-800 flex items-center gap-1.5">
                    {it.destacado && <Star size={13} className="text-amber-500 fill-amber-400" />}
                    {it.titulo_web || it.name}
                  </p>
                  <p className="text-[11px] text-gray-400 font-mono">{it.sku}{it.titulo_web ? ` · ${it.name}` : ''}</p>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">{money(it.base_price)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{it.precio_web != null ? money(it.precio_web) : <span className="text-[11px] text-gray-400">usa ERP</span>}</td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => setEditar(it)} className="p-1.5 text-cyan-600 hover:bg-cyan-50 rounded" title="Editar contenido web"><Pencil size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editar && <WebModal item={editar} onClose={() => setEditar(null)}
        onDone={() => { setEditar(null); flash(''); refrescar(); }} />}
    </div>
  );
}

function WebModal({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    publicado: !!item.publicado,
    destacado: !!item.destacado,
    precioWeb: item.precio_web ?? '',
    tituloWeb: item.titulo_web || '',
    descripcionWeb: item.descripcion_web || '',
    seoTitle: item.seo_title || '',
    seoDescription: item.seo_description || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      await api.guardarCatalogoWeb(item.product_id, {
        ...form, precioWeb: form.precioWeb === '' ? null : Number(form.precioWeb),
      });
      onDone();
    } catch (err: any) { setError(err?.response?.data?.message || err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-cyan-100 rounded-lg flex items-center justify-center"><Globe className="text-cyan-700" size={20} /></div>
            <div><h2 className="font-bold text-gray-900">Contenido web</h2><p className="text-xs text-gray-500">{item.name} · {item.sku}</p></div>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}
          <div className="flex items-center gap-5">
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.publicado} onChange={(e) => setForm({ ...form, publicado: e.target.checked })} /> Publicado</label>
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.destacado} onChange={(e) => setForm({ ...form, destacado: e.target.checked })} /> Destacado</label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600 block mb-1">Precio web <span className="text-gray-400">(vacío = usa ERP {money(item.base_price)})</span></span>
              <input type="number" step="any" min="0" value={form.precioWeb} onChange={(e) => setForm({ ...form, precioWeb: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600 block mb-1">Título web <span className="text-gray-400">(vacío = nombre)</span></span>
              <input value={form.tituloWeb} onChange={(e) => setForm({ ...form, tituloWeb: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600 block mb-1">Descripción web</span>
            <textarea rows={3} value={form.descripcionWeb} onChange={(e) => setForm({ ...form, descripcionWeb: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </label>
          <details className="rounded-lg border border-gray-200">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-gray-700">SEO (opcional)</summary>
            <div className="p-3 space-y-3 border-t">
              <label className="block"><span className="text-xs font-medium text-gray-600 block mb-1">Título SEO</span>
                <input value={form.seoTitle} onChange={(e) => setForm({ ...form, seoTitle: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" /></label>
              <label className="block"><span className="text-xs font-medium text-gray-600 block mb-1">Descripción SEO</span>
                <textarea rows={2} value={form.seoDescription} onChange={(e) => setForm({ ...form, seoDescription: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" /></label>
            </div>
          </details>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t bg-slate-50 sticky bottom-0">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={busy} className="flex items-center gap-2 px-5 py-2 rounded-lg text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 font-semibold">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default CatalogoWebPage;
