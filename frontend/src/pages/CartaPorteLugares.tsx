/**
 * CartaPorteLugares — CRUD de lugares frecuentes de Carta Porte (Origen/Destino).
 *
 * Mismo patrón que Productos: tabla con búsqueda y filtros, modal para alta y
 * edición, borrado suave (activo=false). Ancho 1200px como el resto de CP.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Pencil, Trash2, Search, X, Save, Loader2 } from 'lucide-react';
import api from '@/services/api';

interface Lugar {
  id: string;
  alias: string;
  tipo_default: 'Origen' | 'Destino' | null;
  rfc: string;
  nombre: string | null;
  calle: string | null;
  num_exterior: string | null;
  colonia: string | null;
  municipio: string | null;
  estado: string;
  pais: string;
  codigo_postal: string;
  usos: number;
  activo: boolean;
}

const blank = () => ({
  alias: '', tipoDefault: '', rfc: '', nombre: '',
  numRegIdTrib: '', residenciaFiscal: '',
  calle: '', numExterior: '', numInterior: '',
  colonia: '', localidad: '', referencia: '',
  municipio: '', estado: '', pais: 'MEX', codigoPostal: '',
});

export function CartaPorteLugaresPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState<'' | 'Origen' | 'Destino'>('');
  const [modal, setModal] = useState<{ open: boolean; editingId: string | null; form: any }>({
    open: false, editingId: null, form: blank(),
  });
  const [err, setErr] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<Lugar[]>({
    queryKey: ['cp-lugares', q, tipo],
    queryFn: () => api.listCPLugares(q || undefined, tipo || undefined),
  });

  const save = useMutation({
    mutationFn: async () => {
      setErr(null);
      if (modal.editingId) return api.updateCPLugar(modal.editingId, modal.form);
      return api.createCPLugar(modal.form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cp-lugares'] });
      setModal({ open: false, editingId: null, form: blank() });
    },
    onError: (e: any) => setErr(e?.response?.data?.error || e?.message || 'Error al guardar'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteCPLugar(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cp-lugares'] }),
  });

  const openNew = () => setModal({ open: true, editingId: null, form: blank() });
  const openEdit = (l: Lugar) => setModal({
    open: true,
    editingId: l.id,
    form: {
      alias: l.alias,
      tipoDefault: l.tipo_default || '',
      rfc: l.rfc,
      nombre: l.nombre || '',
      numRegIdTrib: '',
      residenciaFiscal: '',
      calle: l.calle || '',
      numExterior: l.num_exterior || '',
      numInterior: '',
      colonia: l.colonia || '',
      localidad: '',
      referencia: '',
      municipio: l.municipio || '',
      estado: l.estado,
      pais: l.pais,
      codigoPostal: l.codigo_postal,
    },
  });

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <MapPin size={26} className="text-emerald-700" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Lugares frecuentes</h1>
            <p className="text-sm text-slate-500">Orígenes y destinos que reutilizas en tus Cartas Porte</p>
          </div>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium"
        >
          <Plus size={18} /> Nuevo lugar
        </button>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar por alias, RFC o nombre…"
            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <select
          value={tipo}
          onChange={e => setTipo(e.target.value as any)}
          className="input"
          style={{ maxWidth: 200 }}
        >
          <option value="">Todos los tipos</option>
          <option value="Origen">Origen</option>
          <option value="Destino">Destino</option>
        </select>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Alias</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Tipo</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">RFC</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Nombre</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Domicilio</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">Usos</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  <MapPin size={40} className="mx-auto mb-3 text-slate-300" />
                  <p className="font-medium">Sin lugares aún</p>
                  <p className="text-xs mt-1">Crea uno con "Nuevo lugar" o guárdalos desde tu formulario de Carta Porte</p>
                </td>
              </tr>
            ) : (
              rows.map(l => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{l.alias}</td>
                  <td className="px-4 py-3">
                    {l.tipo_default
                      ? <span className={`px-2 py-0.5 rounded text-xs ${l.tipo_default === 'Origen' ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'}`}>{l.tipo_default}</span>
                      : <span className="text-xs text-slate-400">Ambos</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{l.rfc}</td>
                  <td className="px-4 py-3 text-xs">{l.nombre || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {[l.calle, l.num_exterior].filter(Boolean).join(' ')}
                    {(l.calle || l.num_exterior) && ', '}
                    {l.municipio || l.colonia} <span className="text-slate-400">·</span> {l.estado} <span className="text-slate-400">·</span> CP {l.codigo_postal}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">{l.usos}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => openEdit(l)} className="p-1.5 text-sky-600 hover:bg-sky-50 rounded" title="Editar"><Pencil size={14} /></button>
                      <button
                        onClick={() => { if (confirm(`¿Eliminar "${l.alias}"? (se desactiva)`)) del.mutate(l.id); }}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                        title="Eliminar (soft delete)"
                      ><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal alta / edición */}
      {modal.open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-12" onClick={() => setModal({ open: false, editingId: null, form: blank() })}>
          <div className="bg-white rounded-lg shadow-xl w-[900px] max-w-[95vw] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <h3 className="font-semibold text-slate-800">
                {modal.editingId ? 'Editar lugar' : 'Nuevo lugar'}
              </h3>
              <button onClick={() => setModal({ open: false, editingId: null, form: blank() })} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {err && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{err}</div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <Field label="Alias (identificador corto)" required span={2}>
                  <input value={modal.form.alias} onChange={e => setModal({ ...modal, form: { ...modal.form, alias: e.target.value } })} maxLength={60} className="input" placeholder="Almacén HCGM Gdl" />
                </Field>
                <Field label="Tipo por defecto">
                  <select value={modal.form.tipoDefault} onChange={e => setModal({ ...modal, form: { ...modal.form, tipoDefault: e.target.value } })} className="input">
                    <option value="">Ambos</option>
                    <option value="Origen">Origen</option>
                    <option value="Destino">Destino</option>
                  </select>
                </Field>
                <Field label="RFC" required>
                  <input value={modal.form.rfc} onChange={e => setModal({ ...modal, form: { ...modal.form, rfc: e.target.value.toUpperCase() } })} maxLength={13} className="input font-mono" />
                </Field>
                <Field label="Nombre / Razón social" span={2}>
                  <input value={modal.form.nombre} onChange={e => setModal({ ...modal, form: { ...modal.form, nombre: e.target.value } })} maxLength={300} className="input" />
                </Field>
              </div>

              <div className="border-t border-slate-200 pt-4">
                <h4 className="text-sm font-medium text-slate-700 mb-3">Domicilio</h4>

                {/* CP arriba — dispara autocompletado de colonias */}
                <CPAutofillBlock form={modal.form} setForm={(f) => setModal({ ...modal, form: f })} />

                <div className="grid grid-cols-4 gap-3 mt-3">
                  <Field label="Calle" span={2}>
                    <input value={modal.form.calle} onChange={e => setModal({ ...modal, form: { ...modal.form, calle: e.target.value } })} maxLength={200} className="input" />
                  </Field>
                  <Field label="No. exterior">
                    <input value={modal.form.numExterior} onChange={e => setModal({ ...modal, form: { ...modal.form, numExterior: e.target.value } })} maxLength={60} className="input" />
                  </Field>
                  <Field label="No. interior">
                    <input value={modal.form.numInterior} onChange={e => setModal({ ...modal, form: { ...modal.form, numInterior: e.target.value } })} maxLength={60} className="input" />
                  </Field>
                  <Field label="Localidad">
                    <input value={modal.form.localidad} onChange={e => setModal({ ...modal, form: { ...modal.form, localidad: e.target.value } })} className="input" />
                  </Field>
                  <Field label="País (3 letras)">
                    <input value={modal.form.pais} onChange={e => setModal({ ...modal, form: { ...modal.form, pais: e.target.value.toUpperCase() } })} maxLength={3} className="input font-mono" />
                  </Field>
                  <Field label="Referencia" span={4}>
                    <input value={modal.form.referencia} onChange={e => setModal({ ...modal, form: { ...modal.form, referencia: e.target.value } })} maxLength={500} className="input" placeholder="Entre calles, entrada, etc." />
                  </Field>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg">
              <button onClick={() => setModal({ open: false, editingId: null, form: blank() })} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
                Cancelar
              </button>
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded text-sm font-medium"
              >
                <Save size={16} /> {save.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, required, span = 1 }: { label: string; children: React.ReactNode; required?: boolean; span?: number }) {
  const cls = span === 2 ? 'col-span-2' : span === 3 ? 'col-span-3' : span === 4 ? 'col-span-4' : '';
  return (
    <label className={`block ${cls}`}>
      <span className="block text-xs text-slate-500 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

/**
 * CPAutofillBlock — 3 campos primeros: CP + Colonia (dropdown) + Municipio +
 * Estado. Al capturar 5 dígitos en CP, consulta el catálogo SAT y precarga
 * las colonias disponibles. El usuario elige una, o teclea manualmente si
 * el CP no está en el catálogo.
 */
function CPAutofillBlock({ form, setForm }: { form: any; setForm: (f: any) => void }) {
  const [loading, setLoading] = useState(false);
  const [colonias, setColonias] = useState<Array<{ clave: string; descripcion: string }>>([]);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const cp = String(form.codigoPostal || '').trim();
    if (!/^\d{5}$/.test(cp)) { setColonias([]); setError(''); return; }
    let cancelled = false;
    setLoading(true); setError('');
    api.resolveCP(cp).then(r => {
      if (cancelled) return;
      setColonias(r.colonias || []);
      if (!r.colonias || r.colonias.length === 0) setError('CP no encontrado en el catálogo SAT — captura manual');
    }).catch(e => {
      if (!cancelled) setError(e?.response?.data?.error || 'Error al buscar CP');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [form.codigoPostal]);

  return (
    <div className="grid grid-cols-4 gap-3 p-3 bg-slate-50 rounded border border-slate-200">
      <label className="block">
        <span className="block text-xs text-slate-500 mb-1">
          Código postal <span className="text-red-500">*</span>
          {loading && <Loader2 size={12} className="inline animate-spin ml-2" />}
        </span>
        <input
          value={form.codigoPostal}
          onChange={e => setForm({ ...form, codigoPostal: e.target.value.replace(/\D/g, '').slice(0, 5) })}
          maxLength={5}
          className="input font-mono"
          placeholder="20126"
        />
      </label>
      <label className="block col-span-2">
        <span className="block text-xs text-slate-500 mb-1">Colonia (SAT)</span>
        {colonias.length > 0 ? (
          <div className="space-y-1">
            <select
              value={colonias.some(c => c.clave === form.colonia) ? form.colonia : (form.colonia ? '__OTRA__' : '')}
              onChange={e => setForm({ ...form, colonia: e.target.value === '__OTRA__' ? ' ' : e.target.value })}
              className="input"
            >
              <option value="">— elige colonia —</option>
              {colonias.map((c) => (
                <option key={c.clave} value={c.clave}>{c.clave} · {c.descripcion}</option>
              ))}
              <option value="__OTRA__">✎ Otra no especificada en el catálogo…</option>
            </select>
            {form.colonia && !colonias.some(c => c.clave === form.colonia) && (
              <input
                value={form.colonia === ' ' ? '' : form.colonia}
                onChange={e => setForm({ ...form, colonia: e.target.value })}
                className="input text-sm"
                placeholder="Anota la colonia (texto libre)"
                autoFocus
              />
            )}
          </div>
        ) : (
          <input value={form.colonia} onChange={e => setForm({ ...form, colonia: e.target.value })} className="input" placeholder={loading ? 'Buscando…' : 'Manual'} />
        )}
      </label>
      <label className="block">
        <span className="block text-xs text-slate-500 mb-1">Estado <span className="text-red-500">*</span></span>
        <input
          value={form.estado}
          onChange={e => setForm({ ...form, estado: e.target.value.toUpperCase().slice(0, 3) })}
          maxLength={3}
          className="input font-mono"
          placeholder="AGU"
        />
      </label>
      <label className="block col-span-2">
        <span className="block text-xs text-slate-500 mb-1">Municipio</span>
        <input value={form.municipio} onChange={e => setForm({ ...form, municipio: e.target.value })} className="input" placeholder="Aguascalientes" />
      </label>
      {error && (
        <p className="col-span-4 text-xs text-amber-600">⚠ {error}</p>
      )}
      {colonias.length > 0 && !error && (
        <p className="col-span-4 text-xs text-emerald-700">✓ {colonias.length} colonia(s) disponibles para este CP</p>
      )}
    </div>
  );
}
