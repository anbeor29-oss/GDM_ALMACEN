/**
 * Comercio Electrónico → Catálogo web (rebanada 3, el núcleo).
 *
 * Decide QUÉ productos salen a la tienda y con qué contenido web, SOBRE el catálogo
 * real del ERP (no lo copia): `ec_product_channel` liga por product_id y, si un campo
 * web va vacío, el storefront usa el dato del maestro (nombre/precio base).
 */
import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, ArrowLeft, Search, Star, Save, X, Loader2, Pencil, ImagePlus, Trash2, Tags, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/services/api';

const money = (n: any) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

export function CatalogoWebPage() {
  const qc = useQueryClient();
  const [busq, setBusq] = useState('');
  const [soloPub, setSoloPub] = useState(false);
  const [msg, setMsg] = useState('');
  const [editar, setEditar] = useState<any | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);

  const q = useQuery({
    queryKey: ['ec-catalogo', busq, soloPub],
    queryFn: () => api.getCatalogoEc({ search: busq || undefined, publicados: soloPub }),
  });
  const items: any[] = (q.data as any)?.data?.catalogo || [];
  const catsQ = useQuery({ queryKey: ['ec-categorias'], queryFn: () => api.getCategoriasEc() });
  const categorias: any[] = (catsQ.data as any)?.data?.categorias || [];

  const refrescar = () => { qc.invalidateQueries({ queryKey: ['ec-catalogo'] }); qc.invalidateQueries({ queryKey: ['ecommerce-estado'] }); };
  const flash = (t: string) => { setMsg(t); if (t) setTimeout(() => setMsg(''), 3000); };

  const togglePublicar = async (it: any) => {
    try { await api.publicarProductoEc(it.product_id, !it.publicado); refrescar(); }
    catch (e: any) { flash(e?.response?.data?.message || 'No se pudo cambiar.'); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link to="/ecommerce" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={15} /> Comercio Electrónico</Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mt-1"><Globe className="text-cyan-600" size={24} /> Catálogo web</h1>
          <p className="text-sm text-gray-500">Elige qué productos se publican en la tienda y su precio/contenido web. El precio web vacío usa el precio del producto.</p>
        </div>
        <button onClick={() => setCatsOpen(true)}
          className="inline-flex items-center gap-1.5 border border-cyan-300 bg-cyan-50 text-cyan-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-cyan-100 shrink-0">
          <Tags size={15} /> Categorías{categorias.length ? ` (${categorias.length})` : ''}
        </button>
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
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Categoría</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Precio ERP</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Precio web</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Web</th>
          </tr></thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">Cargando…</td></tr>}
            {!q.isLoading && items.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400 italic">Sin productos. Da de alta productos primero.</td></tr>}
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
                <td className="px-3 py-2">
                  {it.categoria_nombre
                    ? <span className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5"><Tags size={10} /> {it.categoria_nombre}</span>
                    : <span className="text-[11px] text-gray-300">—</span>}
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

      {editar && <WebModal item={editar} categorias={categorias} onClose={() => setEditar(null)}
        onDone={() => { setEditar(null); flash(''); refrescar(); }} />}

      {catsOpen && <CategoriasModal onClose={() => setCatsOpen(false)}
        onChange={() => { qc.invalidateQueries({ queryKey: ['ec-categorias'] }); refrescar(); }} />}
    </div>
  );
}

function WebModal({ item, categorias, onClose, onDone }: { item: any; categorias: any[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    publicado: !!item.publicado,
    destacado: !!item.destacado,
    categoryId: item.category_id || '',
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
          <label className="block">
            <span className="text-xs font-medium text-gray-600 block mb-1">Categoría <span className="text-gray-400">(para navegar la tienda por secciones)</span></span>
            <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white">
              <option value="">— Sin categoría —</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
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
          <ImagenesProducto productId={item.product_id} />
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

/* Fotos del producto: subida (se optimiza en el backend), miniaturas y borrado. */
function ImagenesProducto({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const [subiendo, setSubiendo] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['ec-img', productId], queryFn: () => api.listarImagenesProductoEc(productId) });
  const imgs: any[] = (q.data as any)?.data?.imagenes || [];
  const refetch = () => {
    qc.invalidateQueries({ queryKey: ['ec-img', productId] });
    qc.invalidateQueries({ queryKey: ['ec-catalogo'] });
  };

  const subir = async (file?: File) => {
    if (!file) return;
    setErr(''); setSubiendo(true);
    try { await api.subirImagenProductoEc(productId, file); refetch(); }
    catch (e: any) { setErr(e?.response?.data?.message || 'No se pudo subir la imagen.'); }
    finally { setSubiendo(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const borrar = async (id: string) => {
    try { await api.eliminarImagenProductoEc(id); refetch(); } catch { /* noop */ }
  };

  return (
    <div>
      <span className="text-xs font-medium text-gray-600 block mb-1">Fotos del producto <span className="text-gray-400">(hasta 6; se muestran en la tienda)</span></span>
      <div className="flex flex-wrap gap-2">
        {imgs.map((im) => (
          <div key={im.id} className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 group">
            <img src={api.imagenProductoUrl(im.id)} alt="" className="w-full h-full object-cover" />
            <button type="button" onClick={() => borrar(im.id)} title="Quitar"
              className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded p-0.5 opacity-0 group-hover:opacity-100 transition">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {imgs.length < 6 && (
          <label className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-50">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => subir(e.target.files?.[0])} />
            {subiendo ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
          </label>
        )}
      </div>
      {err && <p className="text-xs text-rose-600 mt-1">{err}</p>}
    </div>
  );
}

/* Administración de categorías de la tienda: alta, nombre, orden, activa y baja.
 * Al borrar una categoría los productos quedan sin categoría (no se pierden). */
function CategoriasModal({ onClose, onChange }: { onClose: () => void; onChange: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ec-categorias'], queryFn: () => api.getCategoriasEc() });
  const cats: any[] = (q.data as any)?.data?.categorias || [];
  const [nuevo, setNuevo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const refetch = () => { qc.invalidateQueries({ queryKey: ['ec-categorias'] }); onChange(); };
  const agregar = async () => {
    const nombre = nuevo.trim();
    if (!nombre) return;
    setErr(''); setBusy(true);
    try { await api.crearCategoriaEc({ nombre }); setNuevo(''); refetch(); }
    catch (e: any) { setErr(e?.response?.data?.message || 'No se pudo crear la categoría.'); }
    finally { setBusy(false); }
  };
  const guardar = async (id: string, cambios: any) => {
    try { await api.actualizarCategoriaEc(id, cambios); refetch(); }
    catch (e: any) { setErr(e?.response?.data?.message || 'No se pudo guardar.'); }
  };
  const borrar = async (c: any) => {
    if (!window.confirm(`¿Eliminar la categoría «${c.nombre}»?\n\nLos productos que la tengan quedan SIN categoría (no se borran).`)) return;
    try { await api.eliminarCategoriaEc(c.id); refetch(); }
    catch (e: any) { setErr(e?.response?.data?.message || 'No se pudo eliminar.'); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-cyan-100 rounded-lg flex items-center justify-center"><Tags className="text-cyan-700" size={20} /></div>
            <div><h2 className="font-bold text-gray-900">Categorías de la tienda</h2><p className="text-xs text-gray-500">Secciones para que el comprador navegue el catálogo.</p></div>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{err}</div>}
          <div className="flex gap-2">
            <input value={nuevo} onChange={(e) => setNuevo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') agregar(); }}
              placeholder="Nueva categoría (p. ej. Ofertas, Ropa, Herramientas)…"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={agregar} disabled={busy || !nuevo.trim()}
              className="inline-flex items-center gap-1.5 bg-cyan-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-cyan-700 disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Agregar
            </button>
          </div>

          {q.isLoading ? (
            <p className="text-sm text-gray-400 text-center py-6">Cargando…</p>
          ) : cats.length === 0 ? (
            <p className="text-sm text-gray-400 italic text-center py-6">Aún no hay categorías. Crea la primera arriba.</p>
          ) : (
            <div className="divide-y border rounded-lg">
              {cats.map((c) => (
                <FilaCategoria key={c.id} cat={c} onGuardar={guardar} onBorrar={() => borrar(c)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Un renglón editable de categoría: nombre + orden (guardan al salir del campo),
 * interruptor de activa y botón de baja. Muestra cuántos productos tiene. */
function FilaCategoria({ cat, onGuardar, onBorrar }: {
  cat: any; onGuardar: (id: string, cambios: any) => void; onBorrar: () => void;
}) {
  const [nombre, setNombre] = useState(cat.nombre);
  const [orden, setOrden] = useState(String(cat.orden ?? 0));

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <input value={nombre} onChange={(e) => setNombre(e.target.value)}
        onBlur={() => { const n = nombre.trim(); if (n && n !== cat.nombre) onGuardar(cat.id, { nombre: n }); else setNombre(cat.nombre); }}
        className="flex-1 border border-transparent hover:border-gray-200 focus:border-cyan-300 rounded px-2 py-1 text-sm font-medium" />
      <input value={orden} onChange={(e) => setOrden(e.target.value)} title="Orden en la tienda"
        onBlur={() => { const o = Number(orden) || 0; if (o !== (cat.orden ?? 0)) onGuardar(cat.id, { orden: o }); }}
        className="w-12 border border-gray-200 rounded px-1 py-1 text-xs text-center" />
      <span className="text-[11px] text-gray-400 w-16 text-right">{cat.publicados ?? 0}/{cat.productos ?? 0} prod.</span>
      <button onClick={() => onGuardar(cat.id, { activa: !cat.activa })} title={cat.activa ? 'Activa — clic para ocultar' : 'Oculta — clic para activar'}
        className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${cat.activa ? 'bg-emerald-500' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${cat.activa ? 'left-4' : 'left-0.5'}`} />
      </button>
      <button onClick={onBorrar} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded" title="Eliminar categoría"><Trash2 size={15} /></button>
    </div>
  );
}

export default CatalogoWebPage;
