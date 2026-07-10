/**
 * Customers Page — alta + edición + baja + lectura de CSF
 * Datos del Receptor conforme a CFF Art. 29-A (CFDI 4.0).
 *
 * Todos los campos de texto se almacenan y muestran en MAYÚSCULAS.
 * Listado ordenado alfabéticamente por nombre.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Edit2, X, FileUp, Loader2 } from 'lucide-react';
import api from '@/services/api';

export function CustomersPage() {
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: customersData, isLoading } = useQuery({
    queryKey: ['customers', page],
    queryFn: () => api.getCustomers(page, 10, { sortBy: 'name', sortOrder: 'ASC' }),
  });

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar al cliente "${name}"?`)) return;
    try {
      await api.deleteCustomer(id);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    } catch (e: any) {
      alert(`Error al eliminar: ${e.response?.data?.message || e.message}`);
    }
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['customers'] });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900">Clientes</h1>
          <p className="text-gray-600 mt-2">Receptores conforme a CFDI 4.0 (CFF Art. 29-A)</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors shadow"
        >
          <Plus size={20} />
          Nuevo Cliente
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Nombre</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">RFC</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Régimen</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">CP</th>
              <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Saldo</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {isLoading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-600">Cargando…</td></tr>
            ) : customersData?.data?.customers?.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-600">No hay clientes</td></tr>
            ) : (
              customersData?.data?.customers?.map((c: any) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 uppercase">{c.business_name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 font-mono">{c.rfc}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 font-mono">{c.fiscal_regime || '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 font-mono">{c.postal_code || '—'}</td>
                  <td className="px-6 py-4 text-right">
                    <span className={`text-sm font-semibold ${Number(c.balance) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      ${Number(c.balance).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditingId(c.id)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Editar (incluido domicilio)"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(c.id, c.business_name)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {customersData?.data?.pagination && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Página {page} de {customersData.data.pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={!customersData.data.pagination.hasPrev}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >Anterior</button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={!customersData.data.pagination.hasNext}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >Siguiente</button>
          </div>
        </div>
      )}

      {createOpen && (
        <CustomerModal
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); refresh(); }}
        />
      )}

      {editingId && (
        <CustomerModal
          mode="edit"
          customerId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); refresh(); }}
        />
      )}
    </div>
  );
}

/* =================================================================
 *  Modal de cliente (alta + edición + lectura de CSF)
 * ================================================================= */

interface CustomerForm {
  rfc: string;
  businessName: string;
  fiscalRegime: string;
  defaultCfdiUse: string;
  postalCode: string;
  state: string;
  municipality: string;
  city: string;
  neighborhood: string;
  street: string;
  extNumber: string;
  email: string;
  phone: string;
  creditLimit: number;
  creditDays: number;
}

const emptyForm: CustomerForm = {
  rfc: '',
  businessName: '',
  fiscalRegime: '',
  defaultCfdiUse: 'G03',
  postalCode: '',
  state: '',
  municipality: '',
  city: '',
  neighborhood: '',
  street: '',
  extNumber: '',
  email: '',
  phone: '',
  creditLimit: 0,
  creditDays: 30,
};

function CustomerModal({
  mode,
  customerId,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  customerId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [error, setError] = useState('');
  const [csfMsg, setCsfMsg] = useState<{ type: 'ok' | 'warn'; text: string } | null>(null);
  const [csfLoading, setCsfLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Catálogos SAT
  const { data: regimenes } = useQuery({
    queryKey: ['catalog', 'regimenFiscal'],
    queryFn: () => api.getCatalog('regimenFiscal'),
    staleTime: Infinity,
  });
  const { data: usos } = useQuery({
    queryKey: ['catalog', 'usoCfdi'],
    queryFn: () => api.getCatalog('usoCfdi'),
    staleTime: Infinity,
  });
  const { data: estados } = useQuery({
    queryKey: ['catalog', 'estado'],
    queryFn: () => api.getCatalog('estado'),
    staleTime: Infinity,
  });

  // Si es edición, precargar
  const { data: existing } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => api.getCustomer(customerId!),
    enabled: mode === 'edit' && !!customerId,
  });

  useEffect(() => {
    if (mode === 'edit' && existing?.data) {
      const c: any = existing.data;
      setForm({
        rfc: c.rfc || '',
        businessName: (c.business_name || '').toUpperCase(),
        fiscalRegime: c.fiscal_regime || '',
        defaultCfdiUse: c.default_cfdi_use || 'G03',
        postalCode: c.postal_code || '',
        state: c.state || '',
        municipality: (c.municipality || '').toUpperCase(),
        city: (c.city || '').toUpperCase(),
        neighborhood: (c.neighborhood || '').toUpperCase(),
        street: (c.street || '').toUpperCase(),
        extNumber: c.ext_number || '',
        email: c.email || '',
        phone: c.phone || '',
        creditLimit: Number(c.credit_limit) || 0,
        creditDays: Number(c.credit_days) || 30,
      });
    }
  }, [existing, mode]);

  // Mutación: crear o editar
  const mutation = useMutation({
    mutationFn: (data: CustomerForm) =>
      mode === 'create'
        ? api.createCustomer(data)
        : api.updateCustomer(customerId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      onSaved();
    },
    onError: (e: any) => setError(e.response?.data?.message || e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.rfc.trim() || !form.businessName.trim()) {
      setError('RFC y Razón Social son obligatorios');
      return;
    }
    if (!form.fiscalRegime || !form.postalCode) {
      setError('Régimen fiscal y código postal son obligatorios en CFDI 4.0');
      return;
    }
    mutation.mutate({ ...form, rfc: form.rfc.toUpperCase().trim() });
  };

  /* ----- Carga de CSF ----- */
  const onPickCSF = async (file: File) => {
    setCsfMsg(null);
    setError('');
    setCsfLoading(true);
    try {
      const res = await api.extractCSF(file);
      const d = res.data;
      setForm((prev) => ({
        ...prev,
        rfc: d.rfc || prev.rfc,
        businessName: (d.businessName || prev.businessName).toUpperCase(),
        fiscalRegime: d.fiscalRegime || prev.fiscalRegime,
        postalCode: d.postalCode || prev.postalCode,
        state: d.state || prev.state,
        municipality: (d.municipality || prev.municipality).toUpperCase(),
        city: (d.city || prev.city).toUpperCase(),
        neighborhood: (d.neighborhood || prev.neighborhood).toUpperCase(),
        street: (d.street || prev.street).toUpperCase(),
        extNumber: d.extNumber || prev.extNumber,
      }));
      const partes: string[] = [];
      if (d.unresolvedRegimen) partes.push(`régimen "${d.raw?.regimen}" no se pudo mapear automáticamente`);
      if (d.unresolvedState) partes.push(`estado "${d.raw?.estado}" no se pudo mapear`);
      if (partes.length) {
        setCsfMsg({ type: 'warn', text: `CSF leída. Revisa: ${partes.join(' y ')}.` });
      } else {
        setCsfMsg({ type: 'ok', text: 'CSF leída y campos llenados. Verifica antes de guardar.' });
      }
    } catch (e: any) {
      setError(e.response?.data?.message || e.message || 'Error al leer la CSF');
    } finally {
      setCsfLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // helper: cambiar texto preservando MAYÚSCULAS
  const upper = (v: string) => v.toUpperCase();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between p-6 border-b border-gray-200 z-10">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {mode === 'create' ? 'Nuevo Cliente' : 'Editar Cliente'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Datos del Receptor — CFDI 4.0</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Carga de CSF */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
            <FileUp className="text-blue-600 flex-shrink-0" size={22} />
            <div className="flex-1">
              <p className="text-sm font-semibold text-blue-900">Leer Constancia de Situación Fiscal</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(e) => e.target.files?.[0] && onPickCSF(e.target.files[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={csfLoading}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2"
            >
              {csfLoading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
              {csfLoading ? 'Procesando…' : 'Subir PDF'}
            </button>
          </div>

          {csfMsg && (
            <div className={`px-4 py-2 rounded-lg text-sm ${
              csfMsg.type === 'ok'
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-yellow-50 border border-yellow-200 text-yellow-800'
            }`}>
              {csfMsg.text}
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Fiscales */}
          <Section>Datos fiscales</Section>
          <div className="grid grid-cols-2 gap-4">
            <Field label="RFC *">
              <input
                type="text"
                value={form.rfc}
                onChange={(e) => setForm({ ...form, rfc: upper(e.target.value) })}
                placeholder="ABC010101AB1"
                className="input uppercase font-mono"
                maxLength={13}
                required
              />
            </Field>
            <Field label="Razón Social *">
              <input
                type="text"
                value={form.businessName}
                onChange={(e) => setForm({ ...form, businessName: upper(e.target.value) })}
                placeholder="MI CLIENTE SA DE CV"
                className="input uppercase"
                required
              />
            </Field>
            <Field label="Régimen Fiscal *">
              <select
                value={form.fiscalRegime}
                onChange={(e) => setForm({ ...form, fiscalRegime: e.target.value })}
                className="input"
                required
              >
                <option value="">— seleccionar —</option>
                {regimenes?.data?.entries?.map((r: any) => (
                  <option key={r.catalog_key} value={r.catalog_key}>
                    {r.catalog_key} — {r.description}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Uso CFDI por defecto">
              <select
                value={form.defaultCfdiUse}
                onChange={(e) => setForm({ ...form, defaultCfdiUse: e.target.value })}
                className="input"
              >
                {usos?.data?.entries?.map((u: any) => (
                  <option key={u.catalog_key} value={u.catalog_key}>
                    {u.catalog_key} — {u.description}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Domicilio */}
          <Section>Domicilio fiscal</Section>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Calle">
              <input
                type="text"
                value={form.street}
                onChange={(e) => setForm({ ...form, street: upper(e.target.value) })}
                placeholder="AV. REFORMA"
                className="input uppercase"
              />
            </Field>
            <Field label="Número">
              <input
                type="text"
                value={form.extNumber}
                onChange={(e) => setForm({ ...form, extNumber: upper(e.target.value) })}
                placeholder="123"
                className="input uppercase"
              />
            </Field>
            <Field label="Colonia">
              <input
                type="text"
                value={form.neighborhood}
                onChange={(e) => setForm({ ...form, neighborhood: upper(e.target.value) })}
                placeholder="CENTRO"
                className="input uppercase"
              />
            </Field>
            <Field label="Municipio">
              <input
                type="text"
                value={form.municipality}
                onChange={(e) => setForm({ ...form, municipality: upper(e.target.value) })}
                placeholder="CUAUHTÉMOC"
                className="input uppercase"
              />
            </Field>
            <Field label="Estado">
              <select
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                className="input"
              >
                <option value="">— seleccionar —</option>
                {estados?.data?.entries?.map((s: any) => (
                  <option key={s.catalog_key} value={s.catalog_key}>
                    {s.catalog_key} — {s.description}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Código Postal *" hint="5 dígitos">
              <input
                type="text"
                value={form.postalCode}
                onChange={(e) => setForm({ ...form, postalCode: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                placeholder="06000"
                className="input font-mono"
                maxLength={5}
                required
              />
            </Field>
          </div>

          {/* Contacto */}
          <Section>Contacto y crédito</Section>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="contacto@cliente.com"
                className="input"
              />
            </Field>
            <Field label="Teléfono">
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="5551234567"
                className="input"
              />
            </Field>
            <Field label="Límite de crédito (MXN)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.creditLimit}
                onChange={(e) => setForm({ ...form, creditLimit: parseFloat(e.target.value) || 0 })}
                className="input"
              />
            </Field>
            <Field label="Días de crédito">
              <input
                type="number"
                min={0}
                value={form.creditDays}
                onChange={(e) => setForm({ ...form, creditDays: parseInt(e.target.value, 10) || 0 })}
                className="input"
              />
            </Field>
          </div>

          <div className="flex gap-3 pt-4 border-t border-gray-200 sticky bottom-0 bg-white">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >Cancelar</button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {mutation.isPending
                ? 'Guardando…'
                : mode === 'create' ? 'Crear cliente' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ----- helpers UI ----- */

function Field({
  label,
  hint,
  children,
}: { label: string; hint?: string; children: React.ReactNode }) {
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
