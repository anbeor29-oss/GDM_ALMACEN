/**
 * Proveedores — pantalla READ-ONLY (decisión del negocio).
 *
 *  · Mismo modelo que customers, pero filtrados por party_type='SUPPLIER'.
 *  · No exponemos botones de editar/eliminar; sólo búsqueda y consulta.
 *  · La página acepta navegación a "ver detalle" para auditoría.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck, Search, Eye, Lock, CreditCard, Star } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

interface Supplier {
  id: string;
  rfc: string;
  business_name: string;
  fiscal_regime?: string;
  postal_code?: string;
  email?: string;
  phone?: string;
  imports_count?: number;
  created_at?: string;
  credit_days?: number;
  credit_line?: number;
  credit_used?: number;
  payment_conditions?: string;
  delivery_days_avg?: number;
  supplier_rating?: number;
  pending_payments?: number;
}

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export function SuppliersPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canEdit = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'].includes(user?.role || '');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Supplier | null>(null);
  const [creditEdit, setCreditEdit] = useState<Supplier | null>(null);

  const q = useQuery({
    queryKey: ['suppliers', search],
    queryFn: () => api.listSuppliers({ search, limit: 200 }),
  });
  const rows: Supplier[] = q.data?.data?.suppliers || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <Truck className="text-indigo-600" size={36}/> Proveedores
          </h1>
          <p className="text-gray-600 mt-1 flex items-center gap-1">
            <Lock size={14}/> Vista de solo lectura · capturados al importar XMLs recibidos
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500 uppercase">Registrados</p>
          <p className="text-2xl font-bold text-gray-900">{q.data?.data?.total ?? 0}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow border p-4">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por RFC o razón social…"
            className="input pl-9 w-full"
          />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">RFC</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Razón social</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Días créd.</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Línea de crédito</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Utilizado</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Eval.</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 italic">
                Sin proveedores. Los proveedores se crean al importar XMLs recibidos en "Compras XML".
              </td></tr>
            )}
            {rows.map((s) => {
              const line = Number(s.credit_line || 0);
              const used = Number(s.credit_used || 0);
              const pct = line > 0 ? Math.min(100, Math.round((used / line) * 100)) : 0;
              return (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono">{s.rfc}</td>
                <td className="px-4 py-2 font-medium uppercase">{s.business_name}</td>
                <td className="px-4 py-2 text-center text-sm">
                  {s.credit_days ? `${s.credit_days} d` : '—'}
                </td>
                <td className="px-4 py-2 text-right text-sm">{line > 0 ? money(line) : '—'}</td>
                <td className="px-4 py-2 text-right text-sm">
                  {used > 0 ? (
                    <div>
                      <span className={pct >= 90 ? 'text-rose-700 font-semibold' : ''}>{money(used)}</span>
                      {line > 0 && (
                        <div className="w-20 ml-auto bg-gray-100 rounded-full h-1 mt-0.5">
                          <div className={`h-1 rounded-full ${pct >= 90 ? 'bg-rose-500' : 'bg-amber-500'}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                  ) : '—'}
                </td>
                <td className="px-4 py-2 text-center">
                  {s.supplier_rating ? (
                    <span className="inline-flex items-center gap-0.5 text-amber-500 text-xs">
                      {s.supplier_rating}<Star size={12} className="fill-amber-400" />
                    </span>
                  ) : <span className="text-gray-400 text-xs">—</span>}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <button title="Ver detalle" onClick={() => setDetail(s)}
                      className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded">
                      <Eye size={16}/>
                    </button>
                    {canEdit && (
                      <button title="Condiciones de crédito" onClick={() => setCreditEdit(s)}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded">
                        <CreditCard size={16}/>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detail && <DetailModal supplier={detail} onClose={() => setDetail(null)}/>}
      {creditEdit && (
        <CreditModal supplier={creditEdit}
          onClose={() => setCreditEdit(null)}
          onSaved={() => { setCreditEdit(null); qc.invalidateQueries({ queryKey: ['suppliers'] }); }}/>
      )}
    </div>
  );
}

function CreditModal({ supplier, onClose, onSaved }: {
  supplier: Supplier; onClose: () => void; onSaved: () => void;
}) {
  const [creditDays, setCreditDays] = useState(String(supplier.credit_days ?? 0));
  const [creditLine, setCreditLine] = useState(String(supplier.credit_line ?? 0));
  const [conditions, setConditions] = useState(supplier.payment_conditions ?? '');
  const [rating, setRating] = useState(String(supplier.supplier_rating ?? ''));
  const [deliveryDays, setDeliveryDays] = useState(String(supplier.delivery_days_avg ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      await api.updateSupplierCredit(supplier.id, {
        creditDays: Number(creditDays),
        creditLine: Number(creditLine),
        paymentConditions: conditions.trim() || undefined,
        supplierRating: rating ? Number(rating) : undefined,
        deliveryDaysAvg: deliveryDays ? Number(deliveryDays) : undefined,
      });
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo guardar');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
              <CreditCard className="text-emerald-700" size={20}/>
            </div>
            <div>
              <h2 className="font-bold">Condiciones de crédito</h2>
              <p className="text-xs text-gray-500">{supplier.business_name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Días de crédito</label>
              <input type="number" min="0" max="365" value={creditDays}
                onChange={(e) => setCreditDays(e.target.value)} className="input" />
              <p className="text-xs text-gray-500 mt-1">Define el vencimiento de las nuevas compras.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Línea de crédito</label>
              <input type="number" min="0" step="0.01" value={creditLine}
                onChange={(e) => setCreditLine(e.target.value)} className="input text-right" />
              <p className="text-xs text-gray-500 mt-1">Utilizado: {money(supplier.credit_used)}</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Condiciones de pago</label>
            <input value={conditions} onChange={(e) => setConditions(e.target.value)}
              placeholder="Ej. 30 días netos, pago los viernes…" className="input" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Días de entrega prom.</label>
              <input type="number" min="0" value={deliveryDays}
                onChange={(e) => setDeliveryDays(e.target.value)} className="input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Evaluación (1–5)</label>
              <select value={rating} onChange={(e) => setRating(e.target.value)} className="input">
                <option value="">Sin evaluar</option>
                {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n} ⭐</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 p-5 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <Truck className="text-indigo-700" size={20}/>
            </div>
            <div>
              <h2 className="font-bold">{supplier.business_name}</h2>
              <p className="text-xs text-gray-500 font-mono">{supplier.rfc}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">✕</button>
        </div>
        <div className="p-5 space-y-2 text-sm">
          <Row k="Régimen fiscal"   v={supplier.fiscal_regime}/>
          <Row k="Código postal"    v={supplier.postal_code}/>
          <Row k="Email"            v={supplier.email}/>
          <Row k="Teléfono"         v={supplier.phone}/>
          <Row k="XMLs importados"  v={String(supplier.imports_count ?? 0)}/>
          <Row k="Creado"           v={supplier.created_at ? new Date(supplier.created_at).toLocaleString('es-MX') : undefined}/>
        </div>
        <div className="p-5 border-t bg-amber-50 text-amber-900 text-xs flex items-start gap-2">
          <Lock size={14} className="shrink-0 mt-0.5"/>
          <p>Los proveedores son de sólo lectura. Se crean automáticamente al importar XMLs donde tu empresa figura como receptor.</p>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  return (
    <div className="flex justify-between border-b last:border-b-0 py-1">
      <span className="text-gray-500">{k}</span>
      <span className="text-gray-800">{v || <span className="italic text-gray-400">—</span>}</span>
    </div>
  );
}
