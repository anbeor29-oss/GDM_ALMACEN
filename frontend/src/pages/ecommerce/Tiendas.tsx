/**
 * Comercio Electrónico → Tiendas (rebanada 2).
 *
 * Alta/edición/baja de tiendas: nombre, subdominio (slug), moneda, branding
 * (logo + colores) y políticas. Multi-empresa (el backend lo acota por company_id).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Store, Plus, Pencil, Trash2, Loader2, Save, X, ArrowLeft, ExternalLink, Truck } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/services/api';

/** Base visible del subdominio (sólo preview por ahora; el ruteo real llega luego). */
const BASE_DOMINIO = 'tienda.hcgm.com.mx/';

export function TiendasPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [editar, setEditar] = useState<any | null>(null);
  const [crear, setCrear] = useState(false);
  const [envios, setEnvios] = useState<any | null>(null);   // tienda cuyos envíos se editan

  const q = useQuery({ queryKey: ['ec-tiendas'], queryFn: () => api.listTiendas() });
  const tiendas: any[] = (q.data as any)?.data?.tiendas || [];

  const refrescar = () => { qc.invalidateQueries({ queryKey: ['ec-tiendas'] }); qc.invalidateQueries({ queryKey: ['ecommerce-estado'] }); };
  const flash = (t: string) => { setMsg(t); if (t) setTimeout(() => setMsg(''), 4000); };

  const eliminar = async (t: any) => {
    if (!confirm(`¿Dar de baja la tienda «${t.nombre}»?`)) return;
    try { const r = await api.eliminarTienda(t.id); flash(r?.message || 'Tienda dada de baja.'); refrescar(); }
    catch (e: any) { flash(e?.response?.data?.message || 'No se pudo dar de baja.'); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link to="/ecommerce" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft size={15} /> Comercio Electrónico
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mt-1">
            <Store className="text-emerald-600" size={24} /> Tiendas
          </h1>
          <p className="text-sm text-gray-500">Da de alta tu tienda: nombre, subdominio, moneda, logo, colores y políticas.</p>
        </div>
        <button onClick={() => setCrear(true)}
          className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 text-sm font-medium">
          <Plus size={16} /> Nueva tienda
        </button>
      </div>

      {msg && <div className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded">{msg}</div>}

      {q.isLoading ? (
        <p className="text-gray-500">Cargando…</p>
      ) : tiendas.length === 0 ? (
        <div className="text-center text-gray-400 border border-dashed rounded-xl py-12">
          <Store size={32} className="mx-auto mb-2 opacity-40" />
          <p>Aún no tienes tiendas. Crea la primera con «Nueva tienda».</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {tiendas.map((t) => (
            <div key={t.id} className={`bg-white border rounded-xl p-4 ${t.activa ? '' : 'opacity-60'}`}>
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-lg flex items-center justify-center text-white shrink-0"
                  style={{ background: `linear-gradient(135deg, ${t.color_primario}, ${t.color_secundario})` }}>
                  <Store size={22} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{t.nombre}</p>
                  <p className="text-xs text-gray-500 font-mono truncate">{BASE_DOMINIO}{t.slug}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
                    <span>{t.moneda}</span>
                    {!t.activa && <span className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">inactiva</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setEnvios(t)} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded" title="Métodos de envío"><Truck size={15} /></button>
                  <button onClick={() => setEditar(t)} className="p-1.5 text-sky-600 hover:bg-sky-50 rounded" title="Editar"><Pencil size={15} /></button>
                  <button onClick={() => eliminar(t)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded" title="Dar de baja"><Trash2 size={15} /></button>
                </div>
              </div>
              {/* Enlace público del comprador (ruta /t/:slug bajo la base del sitio). */}
              {t.activa && (
                <a href={`${import.meta.env.BASE_URL}t/${t.slug}`} target="_blank" rel="noreferrer"
                  className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">
                  <ExternalLink size={13} /> Ver tienda pública
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {(crear || editar) && (
        <TiendaModal tienda={editar} onClose={() => { setCrear(false); setEditar(null); }}
          onDone={(t: string) => { setCrear(false); setEditar(null); flash(t); refrescar(); }} />
      )}

      {envios && <EnviosModal tienda={envios} onClose={() => setEnvios(null)} />}
    </div>
  );
}

/* ─────────────── Modal: métodos de envío de una tienda ─────────────── */
function EnviosModal({ tienda, onClose }: { tienda: any; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ec-envios', tienda.id], queryFn: () => api.getEnviosEc(tienda.id) });
  const metodos: any[] = (q.data as any)?.data?.metodos || [];
  const [nombre, setNombre] = useState('');
  const [costo, setCosto] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const refetch = () => qc.invalidateQueries({ queryKey: ['ec-envios', tienda.id] });
  const agregar = async () => {
    const n = nombre.trim();
    if (!n) return;
    setErr(''); setBusy(true);
    try { await api.crearEnvioEc(tienda.id, { nombre: n, costo: costo === '' ? 0 : Number(costo) }); setNombre(''); setCosto(''); refetch(); }
    catch (e: any) { setErr(e?.response?.data?.message || 'No se pudo crear el método.'); }
    finally { setBusy(false); }
  };
  const guardar = async (id: string, cambios: any) => {
    try { await api.actualizarEnvioEc(id, cambios); refetch(); }
    catch (e: any) { setErr(e?.response?.data?.message || 'No se pudo guardar.'); }
  };
  const borrar = async (m: any) => {
    if (!window.confirm(`¿Eliminar el método de envío «${m.nombre}»?`)) return;
    try { await api.eliminarEnvioEc(m.id); refetch(); }
    catch (e: any) { setErr(e?.response?.data?.message || 'No se pudo eliminar.'); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center"><Truck className="text-amber-700" size={20} /></div>
            <div><h2 className="font-bold text-gray-900">Envíos — {tienda.nombre}</h2><p className="text-xs text-gray-500">El costo es SIN IVA (se le suma 16% al facturar). «Gratis desde» es opcional.</p></div>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{err}</div>}
          <div className="flex gap-2">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') agregar(); }}
              placeholder="Método (p. ej. Estándar, Express, Local)…"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input value={costo} onChange={(e) => setCosto(e.target.value)} type="number" step="any" min="0"
              placeholder="Costo" title="Costo sin IVA"
              className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm text-right" />
            <button onClick={agregar} disabled={busy || !nombre.trim()}
              className="inline-flex items-center gap-1.5 bg-amber-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Agregar
            </button>
          </div>

          {q.isLoading ? (
            <p className="text-sm text-gray-400 text-center py-6">Cargando…</p>
          ) : metodos.length === 0 ? (
            <p className="text-sm text-gray-400 italic text-center py-6">Sin métodos de envío. Crea el primero arriba (o deja la tienda sin envío).</p>
          ) : (
            <div className="divide-y border rounded-lg">
              {metodos.map((m) => <FilaEnvio key={m.id} metodo={m} onGuardar={guardar} onBorrar={() => borrar(m)} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Un renglón editable de método de envío: nombre, costo (sin IVA), «gratis desde»,
 * activo y baja. Los campos de texto guardan al salir del campo. */
function FilaEnvio({ metodo, onGuardar, onBorrar }: {
  metodo: any; onGuardar: (id: string, cambios: any) => void; onBorrar: () => void;
}) {
  const [nombre, setNombre] = useState(metodo.nombre);
  const [costo, setCosto] = useState(String(metodo.costo ?? 0));
  const [gratis, setGratis] = useState(metodo.gratis_desde != null ? String(metodo.gratis_desde) : '');

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <input value={nombre} onChange={(e) => setNombre(e.target.value)}
        onBlur={() => { const n = nombre.trim(); if (n && n !== metodo.nombre) onGuardar(metodo.id, { nombre: n }); else setNombre(metodo.nombre); }}
        className="flex-1 min-w-0 border border-transparent hover:border-gray-200 focus:border-amber-300 rounded px-2 py-1 text-sm font-medium" />
      <label className="text-[11px] text-gray-400 flex items-center gap-1" title="Costo sin IVA">$
        <input value={costo} onChange={(e) => setCosto(e.target.value)} type="number" step="any" min="0"
          onBlur={() => { const c = Number(costo) || 0; if (c !== Number(metodo.costo)) onGuardar(metodo.id, { costo: c }); }}
          className="w-16 border border-gray-200 rounded px-1 py-1 text-xs text-right text-gray-700" />
      </label>
      <label className="text-[11px] text-gray-400 flex items-center gap-1" title="Envío gratis a partir de este total (con IVA). Vacío = sin envío gratis.">free≥
        <input value={gratis} onChange={(e) => setGratis(e.target.value)} type="number" step="any" min="0" placeholder="—"
          onBlur={() => { const g = gratis === '' ? null : (Number(gratis) || 0); const actual = metodo.gratis_desde != null ? Number(metodo.gratis_desde) : null; if (g !== actual) onGuardar(metodo.id, { gratisDesde: g }); }}
          className="w-16 border border-gray-200 rounded px-1 py-1 text-xs text-right text-gray-700" />
      </label>
      <button onClick={() => onGuardar(metodo.id, { activo: !metodo.activo })} title={metodo.activo ? 'Activo — clic para ocultar' : 'Oculto — clic para activar'}
        className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${metodo.activo ? 'bg-emerald-500' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${metodo.activo ? 'left-4' : 'left-0.5'}`} />
      </button>
      <button onClick={onBorrar} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded shrink-0" title="Eliminar método"><Trash2 size={15} /></button>
    </div>
  );
}

/* ─────────────── Modal: alta / edición de tienda ─────────────── */
function TiendaModal({ tienda, onClose, onDone }: { tienda: any | null; onClose: () => void; onDone: (t: string) => void }) {
  const esEdicion = !!tienda;
  const [form, setForm] = useState({
    nombre: tienda?.nombre || '',
    slug: tienda?.slug || '',
    moneda: tienda?.moneda || 'MXN',
    logoUrl: tienda?.logo_url || '',
    colorPrimario: tienda?.color_primario || '#059669',
    colorSecundario: tienda?.color_secundario || '#0d9488',
    politicaEnvio: tienda?.politica_envio || '',
    politicaDevolucion: tienda?.politica_devolucion || '',
    politicaPrivacidad: tienda?.politica_privacidad || '',
    terminos: tienda?.terminos || '',
    activa: tienda ? tienda.activa !== false : true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Sugiere el slug a partir del nombre mientras no se haya tocado a mano (alta).
  const [slugTocado, setSlugTocado] = useState(esEdicion);
  const slugDe = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const onNombre = (v: string) => setForm((f) => ({ ...f, nombre: v, slug: slugTocado ? f.slug : slugDe(v) }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!form.nombre.trim()) { setError('Captura el nombre de la tienda.'); return; }
    if (!form.slug.trim()) { setError('Captura el subdominio.'); return; }
    setBusy(true);
    try {
      if (esEdicion) { await api.actualizarTienda(tienda.id, form); onDone('Tienda actualizada.'); }
      else { const r = await api.crearTienda(form); onDone(r?.message || 'Tienda creada.'); }
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message);
    } finally { setBusy(false); }
  };

  const area = (label: string, k: keyof typeof form) => (
    <label className="block">
      <span className="text-xs font-medium text-gray-600 block mb-1">{label}</span>
      <textarea value={form[k] as string} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        rows={2} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white"
              style={{ background: `linear-gradient(135deg, ${form.colorPrimario}, ${form.colorSecundario})` }}><Store size={20} /></div>
            <h2 className="font-bold text-gray-900">{esEdicion ? 'Editar tienda' : 'Nueva tienda'}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}

          <label className="block">
            <span className="text-xs font-medium text-gray-600 block mb-1">Nombre de la tienda *</span>
            <input value={form.nombre} onChange={(e) => onNombre(e.target.value)}
              placeholder="Mi Tienda" className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-gray-600 block mb-1">Subdominio *</span>
            <div className="flex items-center rounded border border-gray-300 overflow-hidden">
              <span className="px-2 py-2 text-xs text-gray-400 bg-gray-50 font-mono whitespace-nowrap">{BASE_DOMINIO}</span>
              <input value={form.slug}
                onChange={(e) => { setSlugTocado(true); setForm({ ...form, slug: slugDe(e.target.value) }); }}
                placeholder="mi-tienda" className="flex-1 px-2 py-2 text-sm font-mono outline-none" />
            </div>
            <span className="text-[11px] text-gray-400">Minúsculas, números y guiones. Debe ser único.</span>
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600 block mb-1">Moneda</span>
              <input value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value.toUpperCase().slice(0, 3) })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600 block mb-1">Color primario</span>
              <input type="color" value={form.colorPrimario} onChange={(e) => setForm({ ...form, colorPrimario: e.target.value })}
                className="w-full h-9 border border-gray-300 rounded" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600 block mb-1">Color secundario</span>
              <input type="color" value={form.colorSecundario} onChange={(e) => setForm({ ...form, colorSecundario: e.target.value })}
                className="w-full h-9 border border-gray-300 rounded" />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-gray-600 block mb-1">Logo (URL)</span>
            <input value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
              placeholder="https://…/logo.png" className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
          </label>

          <details className="rounded-lg border border-gray-200">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-gray-700">Políticas (opcional)</summary>
            <div className="p-3 space-y-3 border-t">
              {area('Política de envío', 'politicaEnvio')}
              {area('Política de cambios y devoluciones', 'politicaDevolucion')}
              {area('Aviso de privacidad', 'politicaPrivacidad')}
              {area('Términos y condiciones', 'terminos')}
            </div>
          </details>

          {esEdicion && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} /> Tienda activa
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t bg-slate-50 sticky bottom-0">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={busy} className="flex items-center gap-2 px-5 py-2 rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 font-semibold">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default TiendasPage;
