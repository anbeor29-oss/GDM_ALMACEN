/**
 * Products Page
 * - Catálogo con SKU automático "P-N"
 * - Combos SAT con búsqueda (Clave Producto/Servicio y Unidad)
 * - Importación masiva desde XMLs CFDI 4.0
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Edit2, FileUp, Loader2, X, CheckCircle, Search, AlertCircle, Boxes,
} from 'lucide-react';
import api from '@/services/api';

/* ─── Helper: mapa preset → tasas visibles en la tabla ─── */
function ratesFor(presetId?: string, taxType?: string, taxRate?: number): {
  iva: string; retIva: string | null; retIsr: string | null;
} {
  const table: Record<string, { iva: string; retIva: string | null; retIsr: string | null }> = {
    iva16:        { iva: '16%',    retIva: null,     retIsr: null },
    iva8:         { iva: '8%',     retIva: null,     retIsr: null },
    iva0:         { iva: '0%',     retIva: null,     retIsr: null },
    ivaex:        { iva: 'Exento', retIva: null,     retIsr: null },
    hon_pf_pm:    { iva: '16%',    retIva: '10.67%', retIsr: '10%' },
    resico_pf_pm: { iva: '16%',    retIva: '10.67%', retIsr: '1.25%' },
    arr_pf_pm:    { iva: '16%',    retIva: '10.67%', retIsr: '10%' },
    auto_carga:   { iva: '16%',    retIva: '4%',     retIsr: null },
    desperdicios: { iva: '16%',    retIva: '16%',    retIsr: null },
    ieps_tasa:    { iva: 'IEPS %', retIva: null,     retIsr: null },
    ieps_cuota:   { iva: 'IEPS $', retIva: null,     retIsr: null },
  };
  if (presetId && table[presetId]) return table[presetId];
  // Fallback para productos legacy (sin preset guardado)
  if (taxType === 'EXENTO') return { iva: 'Exento', retIva: null, retIsr: null };
  if (taxType === 'IEPS')   return { iva: 'IEPS',   retIva: null, retIsr: null };
  const r = typeof taxRate === 'number' ? taxRate : 0.16;
  return { iva: `${(r * 100).toFixed(0)}%`, retIva: null, retIsr: null };
}

export function ProductsPage() {
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products', page],
    queryFn: () => api.getProducts(page, 10),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['products'] });

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar "${name}"?`)) return;
    try {
      // Usamos el cliente axios (respeta VITE_API_BASE en producción y el
      // interceptor de token). El fetch relativo `/api/products/...` NO
      // funciona en Render porque va al static site del frontend.
      await api.deleteProduct(id);
      refresh();
    } catch (e: any) {
      alert(`Error al eliminar: ${e.response?.data?.message || e.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900">Productos</h1>
          <p className="text-gray-600 mt-2">Catálogo de productos y servicios</p>
        </div>
        <div className="flex gap-2">
          <ImportXMLButton onDone={refresh} />
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors shadow"
          >
            <Plus size={20} />
            Nuevo Producto
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-900 uppercase tracking-wide">SKU</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-900 uppercase tracking-wide">Nombre</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-900 uppercase tracking-wide">Clave SAT</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-900 uppercase tracking-wide">Unidad</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-900 uppercase tracking-wide">Precio</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-900 uppercase tracking-wide" title="IVA trasladado">IVA</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-900 uppercase tracking-wide" title="Retención IVA">Ret. IVA</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-900 uppercase tracking-wide" title="Retención ISR">Ret. ISR</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-900 uppercase tracking-wide">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {isLoading ? (
              <tr><td colSpan={9} className="px-6 py-8 text-center text-gray-600">Cargando…</td></tr>
            ) : productsData?.data?.products?.length === 0 ? (
              <tr><td colSpan={9} className="px-6 py-8 text-center text-gray-600">No hay productos. Crea uno o importa XMLs.</td></tr>
            ) : (
              productsData?.data?.products?.map((p: any) => {
                const rates = ratesFor(p.tax_preset_id, p.tax_type, Number(p.tax_rate));
                return (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono text-gray-700">{p.sku}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 uppercase">{p.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-50 text-green-700 text-xs font-mono">
                      <CheckCircle size={12} />
                      {p.clave_sat}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 font-mono">{p.unit_code}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">
                    ${Number(p.base_price || 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-block min-w-[3rem] px-2 py-1 rounded bg-sky-50 text-sky-700 text-xs font-semibold border border-sky-100">
                      {rates.iva}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {rates.retIva ? (
                      <span className="inline-block min-w-[3rem] px-2 py-1 rounded bg-amber-50 text-amber-800 text-xs font-semibold border border-amber-200">
                        {rates.retIva}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {rates.retIsr ? (
                      <span className="inline-block min-w-[3rem] px-2 py-1 rounded bg-rose-50 text-rose-700 text-xs font-semibold border border-rose-200">
                        {rates.retIsr}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setEditingId(p.id)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="Editar"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(p.id, p.name)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        title="Eliminar"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              );})
            )}
          </tbody>
        </table>
      </div>

      {productsData?.data?.pagination && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Página {page} de {productsData.data.pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={!productsData.data.pagination.hasPrev}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >Anterior</button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={!productsData.data.pagination.hasNext}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >Siguiente</button>
          </div>
        </div>
      )}

      {showCreate && (
        <ProductModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {editingId && (
        <ProductModal
          mode="edit"
          productId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); refresh(); }}
        />
      )}
    </div>
  );
}

/* ===================== Importar XMLs ===================== */

function ImportXMLButton({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setResult(null);
    try {
      const arr: File[] = [];
      for (let i = 0; i < files.length; i++) arr.push(files[i]);
      const res = await api.importProductsFromXML(arr);
      setResult(res);
      onDone();
    } catch (e: any) {
      setResult({ success: false, message: e.response?.data?.message || e.message });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".xml,application/xml,text/xml"
        multiple
        hidden
        onChange={(e) => onPick(e.target.files)}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-6 py-3 rounded-lg transition-colors shadow"
        title="Importar productos desde XMLs de CFDIs"
      >
        {busy ? <Loader2 size={20} className="animate-spin" /> : <FileUp size={20} />}
        {busy ? 'Procesando…' : 'Importar XMLs'}
      </button>
      {result && (
        <ImportResultModal result={result} onClose={() => setResult(null)} />
      )}
    </>
  );
}

function ImportResultModal({ result, onClose }: { result: any; onClose: () => void }) {
  const d = result?.data;
  const isOk = result?.success;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isOk ? 'bg-green-100' : 'bg-red-100'}`}>
              {isOk ? <CheckCircle className="text-green-600" /> : <AlertCircle className="text-red-600" />}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Resultado de la importación</h2>
              <p className="text-sm text-gray-600">{result?.message}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        {d && (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Archivos OK" value={`${d.files_ok}/${d.total_files}`} />
              <Stat label="Emitidos" value={d.invoices_emitted} />
              <Stat label="Recibidos" value={d.invoices_received} />
              <Stat label="Creados" value={d.products_created} color="green" />
              <Stat label="Actualizados" value={d.products_updated} color="blue" />
              <Stat label="Memorias cliente" value={d.customer_links_updated} color="purple" />
            </div>

            {d.errors?.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm font-semibold text-red-800 mb-1">Errores:</p>
                <ul className="text-xs text-red-700 space-y-1">
                  {d.errors.map((e: any, i: number) => (
                    <li key={i}><span className="font-mono">{e.file}</span>: {e.error}</li>
                  ))}
                </ul>
              </div>
            )}

            {d.items_detail?.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-900 mb-2">Detalle:</p>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {d.items_detail.map((it: any, i: number) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-mono text-gray-500 truncate">
                          {it.folio ? `${it.folio} · ` : ''}{it.rfcEmisor} → {it.rfcReceptor}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          it.role === 'EMITIDO' ? 'bg-blue-100 text-blue-700'
                          : it.role === 'RECIBIDO' ? 'bg-orange-100 text-orange-700'
                          : 'bg-gray-100 text-gray-700'
                        }`}>{it.role}</span>
                      </div>
                      <ul className="text-xs text-gray-700 space-y-0.5">
                        {it.products.map((p: any, j: number) => (
                          <li key={j} className="flex items-center gap-2">
                            <span className="font-mono text-gray-500">{p.sku || '—'}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                              p.action === 'created' ? 'bg-green-100 text-green-700'
                              : p.action === 'updated' ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-600'
                            }`}>{p.action}</span>
                            <span className="truncate uppercase">{p.name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
          >Cerrar</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: any; color?: string }) {
  const colors: Record<string, string> = {
    green: 'bg-green-50 text-green-700 border-green-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
  };
  const c = color ? colors[color] : 'bg-gray-50 text-gray-700 border-gray-200';
  return (
    <div className={`border rounded-lg p-3 ${c}`}>
      <p className="text-xs uppercase tracking-wide opacity-75">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

/* ===================== Modal de producto ===================== */

interface ProductForm {
  sku: string;
  name: string;
  description: string;
  claveSat: string;
  claveSatLabel: string;
  unitCode: string;
  unitCodeLabel: string;
  basePrice: number;
  taxType: string;
  taxRate: number;
  taxPresetId: string;     // ← guarda CUÁL preset escogió el usuario
  currency: string;        // c_Moneda (ISO 4217)
}

const emptyForm: ProductForm = {
  sku: '',
  name: '',
  description: '',
  claveSat: '',
  claveSatLabel: '',
  unitCode: '',
  unitCodeLabel: '',
  basePrice: 0,
  taxType: 'IVA',
  taxRate: 0.16,
  taxPresetId: 'iva16',
  currency: 'MXN',
};

function ProductModal({
  mode,
  productId,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  productId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [error, setError] = useState('');

  const { data: nextSkuData } = useQuery({
    queryKey: ['nextSku'],
    queryFn: () => api.getNextProductSku(),
    enabled: mode === 'create',
  });

  // Catálogo de monedas (c_Moneda — 183 entradas del Anexo 20)
  const { data: monedasData } = useQuery({
    queryKey: ['catalog', 'moneda'],
    queryFn: () => api.getCatalog('moneda'),
    staleTime: Infinity,
  });

  const { data: existing } = useQuery({
    queryKey: ['product', productId],
    queryFn: () => (api as any).getProduct(productId!),
    enabled: mode === 'edit' && !!productId,
  });

  useEffect(() => {
    if (mode === 'edit' && existing?.data) {
      const p: any = existing.data.product || existing.data;
      setForm({
        sku: p.sku || '',
        name: (p.name || '').toUpperCase(),
        description: (p.description || '').toUpperCase(),
        claveSat: p.clave_sat || '',
        claveSatLabel: p.clave_sat || '',
        unitCode: p.unit_code || '',
        unitCodeLabel: p.unit_name || p.unit_code || '',
        basePrice: Number(p.base_price) || 0,
        taxType: p.tax_type || 'IVA',
        taxRate: Number(p.tax_rate) || 0.16,
        // Priorizar el preset guardado (hon_pf_pm, resico_pf_pm, etc.). Sólo si
        // viene NULL (productos legacy) usamos la inferencia por tax_type/rate.
        taxPresetId:
          p.tax_preset_id
          || (p.tax_type === 'EXENTO' || p.is_exempt ? 'ivaex'
            : p.tax_type === 'IEPS' ? 'ieps_tasa'
            : Number(p.tax_rate) === 0.08 ? 'iva8'
            : Number(p.tax_rate) === 0 ? 'iva0'
            : 'iva16'),
        currency: p.currency || 'MXN',
      });
    } else if (mode === 'create' && nextSkuData?.data?.nextSku) {
      setForm((f) => ({ ...f, sku: nextSkuData.data.nextSku }));
    }
  }, [existing, mode, nextSkuData]);

  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: any) =>
      mode === 'create'
        ? api.createProduct(data)
        : api.updateProduct(productId!, data),
    onSuccess: () => {
      // Invalida TODAS las caches del producto (la lista, el detalle y next SKU)
      // para que la tabla y el próximo abrir del editor traigan los datos frescos.
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product', productId] });
      queryClient.invalidateQueries({ queryKey: ['nextSku'] });
      onSaved();
    },
    onError: (e: any) => setError(e.response?.data?.message || e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name || !form.claveSat || !form.unitCode) {
      setError('Nombre, Clave SAT y Unidad son obligatorios');
      return;
    }
    if (form.basePrice < 0) {
      setError('El precio base no puede ser negativo');
      return;
    }
    // Mapeo correcto Anexo 20: lo que va a la columna `tax_type` debe ser un
    // código del catálogo SAT (c_Impuesto: ISR/IVA/IEPS).
    // Para "exento" NO existe el código "EXENTO" — el SAT lo modela como
    // IVA con TipoFactor=Exento. La distinción la lleva la bandera is_exempt.
    const taxTypeForDb =
      form.taxPresetId === 'ivaex'                                       ? 'IVA'
      : form.taxPresetId === 'ieps_tasa' || form.taxPresetId === 'ieps_cuota' ? 'IEPS'
      : 'IVA';

    mutation.mutate({
      sku: mode === 'edit' ? form.sku : undefined,
      name: form.name,
      description: form.description || form.name,
      claveSat: form.claveSat,
      unitCode: form.unitCode,
      basePrice: form.basePrice,
      taxType: taxTypeForDb,
      taxRate: form.taxRate,
      currency: form.currency,
      // Crítico para Anexo 20: el preset (iva16, hon_pf_pm, resico_pf_pm, etc.)
      // captura el régimen fiscal-impuesto y sus retenciones aplicables.
      taxPresetId: form.taxPresetId,
      // Banderas derivadas del preset para que el backend persista coherente
      isExempt: form.taxPresetId === 'ivaex',
      appliesIEPS: form.taxPresetId === 'ieps_tasa' || form.taxPresetId === 'ieps_cuota',
    });
  };

  const upper = (v: string) => (v || '').toUpperCase();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between p-6 border-b border-gray-200 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-lg flex items-center justify-center shadow-md">
              <Boxes className="text-white" size={22} />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">
              {mode === 'create' ? 'Nuevo Producto' : 'Editar Producto'}
            </h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <Field label="SKU (automático)">
              <input
                type="text"
                value={form.sku || '—'}
                readOnly
                className="input bg-gray-50 text-gray-700 font-mono"
              />
            </Field>
            <Field label={`Precio en ${form.currency === 'MXN' ? 'pesos mexicanos' : form.currency}`}>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.basePrice}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  // Nunca aceptar precios negativos
                  setForm({ ...form, basePrice: isFinite(v) && v >= 0 ? v : 0 });
                }}
                onBlur={() => { if (form.basePrice < 0) setForm({ ...form, basePrice: 0 }); }}
                className="input"
              />
            </Field>
            <Field label="Moneda">
              <select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="input"
              >
                {(() => {
                  const all: Array<{ catalog_key: string; description: string }> =
                    monedasData?.data?.entries || [{ catalog_key: 'MXN', description: 'Peso Mexicano' }];
                  const priority = ['MXN', 'USD', 'EUR', 'CAD', 'GBP', 'JPY'];
                  const top = priority
                    .map((k) => all.find((m) => m.catalog_key === k))
                    .filter(Boolean) as typeof all;
                  const rest = all.filter((m) => !priority.includes(m.catalog_key));
                  return [...top, ...rest].map((m) => (
                    <option key={m.catalog_key} value={m.catalog_key}>
                      {m.catalog_key} — {m.description}
                    </option>
                  ));
                })()}
              </select>
            </Field>
          </div>

          <Field label="Nombre *">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: upper(e.target.value) })}
              placeholder="NOMBRE COMERCIAL DEL PRODUCTO"
              className="input uppercase"
              required
            />
          </Field>

          <SATPicker
            label="Clave Producto/Servicio *"
            type="prodserv"
            placeholder="Busca por código o palabra"
            value={form.claveSat}
            valueLabel={form.claveSatLabel}
            onChange={(key, label) => setForm({ ...form, claveSat: key, claveSatLabel: label })}
          />

          <SATPicker
            label="Clave Unidad *"
            type="unidad"
            placeholder="KGM, H87, ACT, …"
            value={form.unitCode}
            valueLabel={form.unitCodeLabel}
            onChange={(key, label) => setForm({ ...form, unitCode: key, unitCodeLabel: label })}
          />

          <TaxPreset
            value={form.taxPresetId}
            onChange={(presetId, taxType, taxRate) =>
              setForm({ ...form, taxPresetId: presetId, taxType, taxRate })
            }
          />

          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >Cancelar</button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
            >
              {mutation.isPending
                ? 'Guardando…'
                : mode === 'create' ? 'Crear producto' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ===================== Picker de clave SAT ===================== */

function SATPicker({
  label,
  type,
  value,
  valueLabel,
  placeholder,
  onChange,
}: {
  label: string;
  type: 'prodserv' | 'unidad';
  value: string;
  valueLabel: string;
  placeholder: string;
  onChange: (key: string, description: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<{ catalog_key: string; description: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const r = await api.searchSAT(type, q, 25);
        setResults(r.data?.entries || []);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [q, type, open]);

  return (
    <Field label={label}>
      <div className="relative">
        <div className="flex">
          <input
            type="text"
            value={value ? `${value} — ${shortLabel(valueLabel)}` : ''}
            readOnly
            placeholder={placeholder}
            onClick={() => setOpen(true)}
            className="input rounded-r-none cursor-pointer truncate"
            title={value ? `${value} — ${valueLabel}` : ''}
          />
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 rounded-r-lg flex items-center"
          >
            <Search size={16} />
          </button>
        </div>

        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-xl z-20 max-h-80 overflow-hidden flex flex-col">
            <div className="bg-white p-2 border-b border-gray-200 flex-shrink-0">
              <input
                autoFocus
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={placeholder}
                className="input"
              />
            </div>
            <div className="p-2 overflow-y-auto flex-1">
              {loading && <p className="text-sm text-gray-500 p-2">Buscando…</p>}
              {!loading && q.length < 2 && (
                <p className="text-sm text-gray-500 p-2">Escribe al menos 2 caracteres.</p>
              )}
              {!loading && q.length >= 2 && results.length === 0 && (
                <p className="text-sm text-gray-500 p-2">Sin resultados.</p>
              )}
              {results.map((r) => (
                <button
                  key={r.catalog_key}
                  type="button"
                  onClick={() => { onChange(r.catalog_key, r.description); setOpen(false); setQ(''); }}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50 rounded text-sm flex gap-2 items-start"
                  title={r.description}
                >
                  <span className="font-mono font-semibold text-blue-700 flex-shrink-0">{r.catalog_key}</span>
                  <span className="text-gray-700 truncate">{r.description}</span>
                </button>
              ))}
            </div>
            <div className="bg-gray-50 p-2 border-t border-gray-200 text-right flex-shrink-0">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1"
              >Cerrar</button>
            </div>
          </div>
        )}
      </div>
    </Field>
  );
}

/** Recorta a ~70 chars. Las descripciones SAT pueden tener 200+ y rompen el layout. */
function shortLabel(s: string): string {
  if (!s) return '';
  // Quitar el guion-em del SAT si está al inicio repitiendo la clave
  const cleaned = s.replace(/^[A-Z0-9]+\s—\s/, '');
  return cleaned.length > 70 ? cleaned.slice(0, 67) + '…' : cleaned;
}

/* ===================== Preset de impuesto (matriz cliente×impuesto) ===================== */

interface TaxPresetOption {
  id: string;                  // único para el option
  label: string;               // lo que ve el usuario
  taxType: string;             // 'IVA' | 'IEPS' | 'EXENTO'
  taxRate: number;
  group: 'IVA' | 'RETENCIONES' | 'IEPS';
  hint?: string;
  retencion?: string;          // descripción si hay retención típica
  retIva?: number;             // porcentaje de retención IVA (ej. 0.106667 = 10.67%)
  retIsr?: number;             // porcentaje de retención ISR (ej. 0.10 = 10%)
}

// Catálogo derivado del wiki: cliente-impuestos-retenciones.md
const TAX_PRESETS: TaxPresetOption[] = [
  { id: 'iva16', group: 'IVA', label: 'IVA 16% (general)', taxType: 'IVA', taxRate: 0.16,
    hint: 'Bienes y servicios generales — todo el país' },
  { id: 'iva8',  group: 'IVA', label: 'IVA 8% (frontera)', taxType: 'IVA', taxRate: 0.08,
    hint: 'Zona fronteriza norte/sur — decreto Ejecutivo' },
  { id: 'iva0',  group: 'IVA', label: 'IVA 0%', taxType: 'IVA', taxRate: 0,
    hint: 'Alimentos no industrializados, medicinas, libros, leche, etc.' },
  { id: 'ivaex', group: 'IVA', label: 'IVA Exento', taxType: 'EXENTO', taxRate: 0,
    hint: 'Servicios médicos, educativos, transporte público de pasajeros' },

  { id: 'hon_pf_pm', group: 'RETENCIONES',
    label: 'Honorarios PF (612) → PM — IVA 16% + Ret. IVA 10.67% + Ret. ISR 10%',
    taxType: 'IVA', taxRate: 0.16,
    retIva: 0.106667, retIsr: 0.10,
    retencion: 'Cliente PM retiene 2/3 del IVA (10.6667%) y 10% de ISR (LIVA 1o.-A fr. II inciso a; LISR 106)' },
  { id: 'resico_pf_pm', group: 'RETENCIONES',
    label: 'Servicios PF RESICO (626) → PM — IVA 16% + Ret. IVA 10.67% + Ret. ISR 1.25%',
    taxType: 'IVA', taxRate: 0.16,
    retIva: 0.106667, retIsr: 0.0125,
    retencion: '2/3 del IVA (10.6667%) + 1.25% de ISR sobre subtotal (LISR 113-J — régimen simplificado de confianza)' },
  { id: 'arr_pf_pm', group: 'RETENCIONES',
    label: 'Arrendamiento inmueble PF (606) → PM',
    taxType: 'IVA', taxRate: 0.16,
    retIva: 0.106667, retIsr: 0.10,
    retencion: 'PM retiene 10.6667% IVA y 10% ISR (LIVA 1o.-A fr. II inciso a; LISR 116)' },
  { id: 'auto_carga', group: 'RETENCIONES',
    label: 'Autotransporte de carga — Ret. IVA 4%',
    taxType: 'IVA', taxRate: 0.16,
    retIva: 0.04,
    retencion: 'Cliente PM retiene 4% del valor (LIVA 1o.-A fr. II inciso c)' },
  { id: 'desperdicios', group: 'RETENCIONES',
    label: 'Compra de desperdicios — Ret. IVA 16% total',
    taxType: 'IVA', taxRate: 0.16,
    retIva: 0.16,
    retencion: 'PM compradora retiene el 100% del IVA (LIVA 1o.-A fr. II inciso b)' },

  { id: 'ieps_tasa', group: 'IEPS', label: 'IEPS por Tasa', taxType: 'IEPS', taxRate: 0,
    hint: 'Cervezas (26.5%), tabaco, refrescos (8%), etc.' },
  { id: 'ieps_cuota', group: 'IEPS', label: 'IEPS por Cuota fija ($/unidad)', taxType: 'IEPS', taxRate: 0,
    hint: 'Combustibles (IEPS por litro) — la cuota va por unidad' },
];

function TaxPreset({
  value,
  onChange,
}: {
  value: string;                                                // = preset.id
  onChange: (presetId: string, taxType: string, taxRate: number) => void;
}) {
  const selectedPreset = TAX_PRESETS.find((p) => p.id === value);
  const groups: Record<string, TaxPresetOption[]> = {};
  for (const p of TAX_PRESETS) {
    (groups[p.group] ||= []).push(p);
  }

  const ivaGroup = groups['IVA'] || [];
  const retGroup = groups['RETENCIONES'] || [];
  const iepsGroup = groups['IEPS'] || [];

  // Cálculos numéricos del preset seleccionado (para el panel visual)
  const info = selectedPreset ? {
    iva:  selectedPreset.taxRate * 100,
    retIva: selectedPreset.retIva ? selectedPreset.retIva * 100 : null,
    retIsr: selectedPreset.retIsr ? selectedPreset.retIsr * 100 : null,
  } : null;

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-semibold text-gray-800 block mb-2">
          Tipo de impuesto (con retenciones aplicables)
        </label>

        {/* Grupo IVA — 4 opciones como radio-cards horizontales */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">IVA general</p>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {ivaGroup.map((p) => {
              const active = p.id === value;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onChange(p.id, p.taxType, p.taxRate)}
                  className={`px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                    active
                      ? 'border-blue-500 bg-blue-50 text-blue-800 shadow-sm'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300'
                  }`}
                >
                  {p.label.replace(' (general)', '').replace(' (frontera)', '')}
                </button>
              );
            })}
          </div>
        </div>

        {/* Retenciones — dropdown con detalle SAT */}
        <div>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Con retenciones (RESICO, Honorarios, Arr., Autotransporte...)</p>
          <select
            value={retGroup.some((r) => r.id === value) ? value : ''}
            onChange={(e) => {
              const p = TAX_PRESETS.find((x) => x.id === e.target.value);
              if (p) onChange(p.id, p.taxType, p.taxRate);
            }}
            className="input"
          >
            <option value="">— sin retenciones —</option>
            {retGroup.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* IEPS — dropdown (menos común) */}
        {iepsGroup.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">IEPS (Alcohol, tabaco, refresco, etc.)</p>
            <select
              value={iepsGroup.some((r) => r.id === value) ? value : ''}
              onChange={(e) => {
                const p = TAX_PRESETS.find((x) => x.id === e.target.value);
                if (p) onChange(p.id, p.taxType, p.taxRate);
              }}
              className="input"
            >
              <option value="">— sin IEPS —</option>
              {iepsGroup.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Panel destacado con desglose numérico */}
      {selectedPreset && info && (
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border-2 border-indigo-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wider text-indigo-700 font-bold mb-2">Desglose fiscal aplicable</p>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-white rounded p-3 border border-indigo-100">
              <p className="text-[10px] uppercase text-gray-500">IVA trasladado</p>
              <p className="text-2xl font-bold text-blue-700">{info.iva.toFixed(0)}%</p>
            </div>
            <div className={`rounded p-3 border ${info.retIva ? 'bg-white border-amber-200' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
              <p className="text-[10px] uppercase text-gray-500">Ret. IVA</p>
              <p className={`text-2xl font-bold ${info.retIva ? 'text-amber-700' : 'text-gray-400'}`}>
                {info.retIva ? info.retIva.toFixed(2) + '%' : '—'}
              </p>
            </div>
            <div className={`rounded p-3 border ${info.retIsr ? 'bg-white border-rose-200' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
              <p className="text-[10px] uppercase text-gray-500">Ret. ISR</p>
              <p className={`text-2xl font-bold ${info.retIsr ? 'text-rose-700' : 'text-gray-400'}`}>
                {info.retIsr ? info.retIsr.toFixed(2) + '%' : '—'}
              </p>
            </div>
          </div>
          {selectedPreset.hint && (
            <p className="text-xs text-gray-600 mb-1">{selectedPreset.hint}</p>
          )}
          {selectedPreset.retencion && (
            <p className="text-xs bg-white border border-amber-200 text-amber-800 px-2 py-1 rounded">
              <span className="font-semibold">Fundamento legal: </span>{selectedPreset.retencion}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ===================== helpers ===================== */

function Field({
  label,
  children,
}: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700 block mb-1">{label}</span>
      {children}
    </label>
  );
}

/* TaxBadge fue reemplazado por columnas separadas IVA / Ret.IVA / Ret.ISR
 * (ver ratesFor arriba). Se conserva la función vacía para no romper imports. */
