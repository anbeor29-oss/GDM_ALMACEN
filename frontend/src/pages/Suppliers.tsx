/**
 * Proveedores — alta + edición completa (mismos datos que Clientes) + datos
 * bancarios para depósito (compra EXPRESS) y condiciones de crédito.
 *
 *  Los proveedores viven en `customers` con party_type='SUPPLIER'. Se crean
 *  automáticamente al importar XMLs de compra (sin duplicar por RFC) y aquí se
 *  completan sus datos bancarios y de crédito para poder pagarles al instante.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, Search, Edit2, X, Star, Plus, Landmark } from 'lucide-react';
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
  credit_days?: number;
  credit_line?: number;
  credit_used?: number;
  supplier_rating?: number;
  bank_name?: string;
  bank_clabe?: string;
}

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export function SuppliersPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canEdit = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'].includes(user?.role || '');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['suppliers', search],
    queryFn: () => api.listSuppliers({ search, limit: 200 }),
  });
  const rows: Supplier[] = q.data?.data?.suppliers || [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['suppliers'] });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <Truck className="text-indigo-600" size={36}/> Proveedores
          </h1>
          <p className="text-gray-600 mt-1">
            Mismos datos que un cliente + cuenta bancaria y crédito para compra express
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-lg hover:bg-blue-600 shadow">
            <Plus size={18}/> Nuevo Proveedor
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg shadow border p-4">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por RFC o razón social…" className="input pl-9 w-full"/>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">RFC</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Razón social</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Banco</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Días créd.</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Línea</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Utilizado</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Eval.</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500 italic">
                Sin proveedores. Créalos aquí o se agregan solos al importar XMLs de compra en "Compras XML".
              </td></tr>
            )}
            {rows.map((s) => {
              const line = Number(s.credit_line || 0);
              const used = Number(s.credit_used || 0);
              const pct = line > 0 ? Math.min(100, Math.round((used / line) * 100)) : 0;
              return (
              <tr key={s.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => canEdit && setEditingId(s.id)}>
                <td className="px-4 py-2 font-mono">{s.rfc}</td>
                <td className="px-4 py-2 font-medium uppercase">{s.business_name}</td>
                <td className="px-4 py-2 text-sm">
                  {s.bank_name ? (
                    <span className="inline-flex items-center gap-1 text-gray-700">
                      <Landmark size={13} className="text-emerald-600"/>{s.bank_name}
                    </span>
                  ) : <span className="text-gray-400 text-xs">sin cuenta</span>}
                </td>
                <td className="px-4 py-2 text-center text-sm">{s.credit_days ? `${s.credit_days} d` : '—'}</td>
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
                      {s.supplier_rating}<Star size={12} className="fill-amber-400"/>
                    </span>
                  ) : <span className="text-gray-400 text-xs">—</span>}
                </td>
                <td className="px-4 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                  {canEdit && (
                    <button title="Editar proveedor" onClick={() => setEditingId(s.id)}
                      className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded">
                      <Edit2 size={16}/>
                    </button>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <SupplierModal mode="create"
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); refresh(); }}/>
      )}
      {editingId && (
        <SupplierModal mode="edit" supplierId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); refresh(); }}/>
      )}
    </div>
  );
}

/* =============================== MODAL =============================== */

interface SupplierForm {
  rfc: string; businessName: string; fiscalRegime: string; defaultCfdiUse: string;
  postalCode: string; state: string; municipality: string; city: string;
  neighborhood: string; street: string; extNumber: string;
  email: string; phone: string; contactPerson: string;
  creditDays: number; creditLine: number;
  bankCode: string; bankAccount: string; bankClabe: string; bankAccountHolder: string;
}

const empty: SupplierForm = {
  rfc: '', businessName: '', fiscalRegime: '', defaultCfdiUse: 'G03',
  postalCode: '', state: '', municipality: '', city: '',
  neighborhood: '', street: '', extNumber: '',
  email: '', phone: '', contactPerson: '',
  creditDays: 30, creditLine: 0,
  bankCode: '', bankAccount: '', bankClabe: '', bankAccountHolder: '',
};

function SupplierModal({ mode, supplierId, onClose, onSaved }: {
  mode: 'create' | 'edit'; supplierId?: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<SupplierForm>(empty);
  const [error, setError] = useState('');
  const upper = (v: string) => v.toUpperCase();

  const { data: regimenes } = useQuery({ queryKey: ['catalog', 'regimenFiscal'], queryFn: () => api.getCatalog('regimenFiscal'), staleTime: Infinity });
  const { data: estados }   = useQuery({ queryKey: ['catalog', 'estado'], queryFn: () => api.getCatalog('estado'), staleTime: Infinity });
  const { data: banksData } = useQuery({ queryKey: ['supplier-banks'], queryFn: () => api.getSupplierBanks(), staleTime: Infinity });
  const banks: Array<{ code: string; name: string }> = banksData?.data?.banks || [];

  const { data: existing } = useQuery({
    queryKey: ['supplier', supplierId],
    queryFn: () => api.getSupplier(supplierId!),
    enabled: mode === 'edit' && !!supplierId,
  });

  useEffect(() => {
    if (mode === 'edit' && existing?.data) {
      const c: any = existing.data;
      setForm({
        rfc: c.rfc || '', businessName: (c.business_name || '').toUpperCase(),
        fiscalRegime: c.fiscal_regime || '', defaultCfdiUse: c.default_cfdi_use || 'G03',
        postalCode: c.postal_code || '', state: c.state || '',
        municipality: (c.municipality || '').toUpperCase(), city: (c.city || '').toUpperCase(),
        neighborhood: (c.neighborhood || '').toUpperCase(), street: (c.street || '').toUpperCase(),
        extNumber: c.ext_number || '', email: c.email || '', phone: c.phone || '',
        contactPerson: (c.contact_person || '').toUpperCase(),
        creditDays: Number(c.credit_days) || 0, creditLine: Number(c.credit_line) || 0,
        bankCode: c.bank_code || '', bankAccount: c.bank_account || '',
        bankClabe: c.bank_clabe || '', bankAccountHolder: (c.bank_account_holder || '').toUpperCase(),
      });
    }
  }, [existing, mode]);

  const mutation = useMutation({
    mutationFn: (data: SupplierForm) =>
      mode === 'create' ? api.createSupplier(data) : api.updateSupplier(supplierId!, data),
    onSuccess: onSaved,
    onError: (e: any) => setError(e.response?.data?.message || e.message),
  });

  // Al capturar CLABE (18 díg.) autoselecciona el banco por sus 3 primeros dígitos
  const onClabe = (v: string) => {
    const clabe = v.replace(/\D/g, '').slice(0, 18);
    const code = clabe.slice(0, 3);
    const match = banks.find((b) => b.code === code);
    setForm((f) => ({ ...f, bankClabe: clabe, bankCode: match ? match.code : f.bankCode }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!form.rfc.trim() || !form.businessName.trim()) { setError('RFC y Razón Social son obligatorios'); return; }
    if (form.bankClabe && form.bankClabe.length !== 18) { setError('La CLABE debe tener 18 dígitos'); return; }
    mutation.mutate({ ...form, rfc: form.rfc.toUpperCase().trim() });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between p-6 border-b z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <Truck className="text-indigo-700" size={20}/>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                {mode === 'create' ? 'Nuevo Proveedor' : 'Editar Proveedor'}
              </h2>
              <p className="text-xs text-gray-500">Datos fiscales, bancarios y de crédito</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20}/></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

          {/* Fiscales */}
          <Section>Datos fiscales</Section>
          <div className="grid grid-cols-2 gap-4">
            <Field label="RFC *">
              <input value={form.rfc} onChange={(e) => setForm({ ...form, rfc: upper(e.target.value) })}
                placeholder="ABC010101AB1" className="input uppercase font-mono" maxLength={13} required/>
            </Field>
            <Field label="Razón Social *">
              <input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: upper(e.target.value) })}
                placeholder="MI PROVEEDOR SA DE CV" className="input uppercase" required/>
            </Field>
            <Field label="Régimen Fiscal">
              <select value={form.fiscalRegime} onChange={(e) => setForm({ ...form, fiscalRegime: e.target.value })} className="input">
                <option value="">— seleccionar —</option>
                {regimenes?.data?.entries?.map((r: any) => (
                  <option key={r.catalog_key} value={r.catalog_key}>{r.catalog_key} — {r.description}</option>
                ))}
              </select>
            </Field>
            <Field label="Código Postal" hint="5 dígitos">
              <input value={form.postalCode}
                onChange={(e) => setForm({ ...form, postalCode: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                placeholder="06000" className="input font-mono" maxLength={5}/>
            </Field>
          </div>

          {/* Domicilio */}
          <Section>Domicilio</Section>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Calle">
              <input value={form.street} onChange={(e) => setForm({ ...form, street: upper(e.target.value) })} className="input uppercase"/>
            </Field>
            <Field label="Número">
              <input value={form.extNumber} onChange={(e) => setForm({ ...form, extNumber: upper(e.target.value) })} className="input uppercase"/>
            </Field>
            <Field label="Colonia">
              <input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: upper(e.target.value) })} className="input uppercase"/>
            </Field>
            <Field label="Municipio">
              <input value={form.municipality} onChange={(e) => setForm({ ...form, municipality: upper(e.target.value) })} className="input uppercase"/>
            </Field>
            <Field label="Estado">
              <select value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="input">
                <option value="">— seleccionar —</option>
                {estados?.data?.entries?.map((s: any) => (
                  <option key={s.catalog_key} value={s.catalog_key}>{s.catalog_key} — {s.description}</option>
                ))}
              </select>
            </Field>
            <Field label="Ciudad">
              <input value={form.city} onChange={(e) => setForm({ ...form, city: upper(e.target.value) })} className="input uppercase"/>
            </Field>
          </div>

          {/* Contacto */}
          <Section>Contacto</Section>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Contacto">
              <input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: upper(e.target.value) })} className="input uppercase"/>
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input"/>
            </Field>
            <Field label="Teléfono">
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="input"/>
            </Field>
          </div>

          {/* Datos bancarios */}
          <Section>Datos bancarios (depósito — compra express)</Section>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Banco (CNBV)">
              <select value={form.bankCode} onChange={(e) => setForm({ ...form, bankCode: e.target.value })} className="input">
                <option value="">— seleccionar —</option>
                {banks.map((b) => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
              </select>
            </Field>
            <Field label="CLABE interbancaria" hint="18 dígitos — autoselecciona el banco">
              <input value={form.bankClabe} onChange={(e) => onClabe(e.target.value)}
                placeholder="012180000000000000" className="input font-mono" maxLength={18}/>
            </Field>
            <Field label="Número de cuenta">
              <input value={form.bankAccount}
                onChange={(e) => setForm({ ...form, bankAccount: e.target.value.replace(/\D/g, '').slice(0, 20) })}
                className="input font-mono"/>
            </Field>
            <Field label="Beneficiario / titular">
              <input value={form.bankAccountHolder} onChange={(e) => setForm({ ...form, bankAccountHolder: upper(e.target.value) })} className="input uppercase"/>
            </Field>
          </div>

          {/* Crédito */}
          <Section>Condiciones de crédito</Section>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Días de crédito" hint="Define el vencimiento de las compras">
              <input type="number" min={0} max={365} value={form.creditDays}
                onChange={(e) => setForm({ ...form, creditDays: parseInt(e.target.value, 10) || 0 })} className="input"/>
            </Field>
            <Field label="Línea de crédito (MXN)">
              <input type="number" min={0} step="0.01" value={form.creditLine}
                onChange={(e) => setForm({ ...form, creditLine: parseFloat(e.target.value) || 0 })} className="input text-right"/>
            </Field>
          </div>

          <div className="flex gap-3 pt-4 border-t sticky bottom-0 bg-white">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={mutation.isPending}
              className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
              {mutation.isPending ? 'Guardando…' : mode === 'create' ? 'Crear proveedor' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700 block mb-1">{label}</span>
      {children}
      {hint && <span className="text-xs text-gray-500 block mt-1">{hint}</span>}
    </label>
  );
}
function Section({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-200 pb-1">
      {children}
    </h3>
  );
}
