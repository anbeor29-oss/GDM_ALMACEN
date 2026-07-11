/**
 * Tesorería — programación de pagos a proveedores (Fase 6 ALMACEN).
 *
 *  Los pagos se crean automáticamente al importar compras XML (vencimiento =
 *  fecha del CFDI + días de crédito del proveedor). Aquí se ven por semana,
 *  se marcan pagados (liberando la línea de crédito), se reprograman o se
 *  cancelan; también se pueden dar de alta manualmente.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Landmark, AlertTriangle, CalendarClock, Wallet, Check, CalendarDays,
  XCircle, Plus,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const BUCKET: Record<string, { label: string; cls: string }> = {
  OVERDUE:   { label: 'Vencido',      cls: 'bg-rose-100 text-rose-700' },
  THIS_WEEK: { label: 'Esta semana',  cls: 'bg-amber-100 text-amber-700' },
  UPCOMING:  { label: 'Próximo',      cls: 'bg-sky-100 text-sky-700' },
  DONE:      { label: 'Aplicado',     cls: 'bg-emerald-100 text-emerald-700' },
};

export function TreasuryPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canManage = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'].includes(user?.role || '');
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState('');

  const summaryQ = useQuery({ queryKey: ['treasury-summary'], queryFn: () => api.getTreasurySummary() });
  const s = summaryQ.data?.data;

  const paymentsQ = useQuery({
    queryKey: ['treasury-payments', statusFilter],
    queryFn: () => api.getTreasuryPayments({ status: statusFilter || undefined }),
  });
  const payments: any[] = paymentsQ.data?.data?.payments || [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['treasury-payments'] });
    qc.invalidateQueries({ queryKey: ['treasury-summary'] });
    qc.invalidateQueries({ queryKey: ['suppliers'] });
  };

  const doPay = async (p: any) => {
    if (!window.confirm(`¿Marcar como pagado ${money(p.amount)} a ${p.supplier_name}?`)) return;
    setError('');
    try { await api.payTreasuryPayment(p.id); refresh(); }
    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo marcar pagado'); }
  };
  const doReschedule = async (p: any) => {
    const nd = window.prompt('Nueva fecha de vencimiento (AAAA-MM-DD):', p.due_date?.slice(0, 10));
    if (!nd) return;
    setError('');
    try { await api.rescheduleTreasuryPayment(p.id, nd); refresh(); }
    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo reprogramar'); }
  };
  const doCancel = async (p: any) => {
    if (!window.confirm(`¿Cancelar el pago de ${money(p.amount)}? Libera la línea de crédito.`)) return;
    setError('');
    try { await api.cancelTreasuryPayment(p.id); refresh(); }
    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo cancelar'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <Landmark className="text-emerald-600" size={36} /> Tesorería
          </h1>
          <p className="text-gray-600 mt-1">
            Pagos programados a proveedores · vencimientos por semana · línea de crédito
          </p>
        </div>
        {canManage && (
          <button onClick={() => setShowManual(true)}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-blue-600">
            <Plus size={18} /> Pago manual
          </button>
        )}
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      {/* KPIs */}
      {s && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard icon={<AlertTriangle size={22} />} color="rose"
            title="Vencido" value={money(s.overdue_amount)} hint={`${s.overdue_count} pago(s)`} />
          <KpiCard icon={<CalendarClock size={22} />} color="amber"
            title="Esta semana" value={money(s.week_amount)} hint={`${s.week_count} pago(s)`} />
          <KpiCard icon={<Wallet size={22} />} color="sky"
            title="Pendiente total" value={money(s.pending_total)} hint={`${s.pending_count} pago(s)`} />
        </div>
      )}

      <div className="bg-white rounded-lg shadow border p-4 flex items-center gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input w-auto">
          <option value="PENDING">Pendientes</option>
          <option value="PAID">Pagados</option>
          <option value="CANCELLED">Cancelados</option>
        </select>
        <span className="ml-auto text-sm text-gray-500">{payments.length} pagos</span>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Vence</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Proveedor</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Monto</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Estado</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Nota</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {paymentsQ.isLoading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!paymentsQ.isLoading && payments.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 italic">
                Sin pagos {statusFilter === 'PENDING' ? 'pendientes' : ''}. Los pagos se programan
                automáticamente al importar compras XML de proveedores con crédito.
              </td></tr>
            )}
            {payments.map((p) => {
              const badge = BUCKET[p.bucket] || { label: p.status, cls: 'bg-gray-100 text-gray-600' };
              return (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm whitespace-nowrap">
                    {new Date(p.due_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {p.status === 'PENDING' && p.days_to_due < 0 && (
                      <span className="ml-1 text-xs text-rose-600">({Math.abs(p.days_to_due)}d)</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm">
                    <p className="font-medium">{p.supplier_name}</p>
                    <p className="text-xs text-gray-500 font-mono">{p.supplier_rfc}</p>
                  </td>
                  <td className="px-4 py-2 text-right font-semibold">{money(p.amount)}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 max-w-48 truncate" title={p.notes}>{p.notes || '—'}</td>
                  <td className="px-4 py-2">
                    {canManage && p.status === 'PENDING' && (
                      <div className="flex items-center justify-center gap-1">
                        <button title="Marcar pagado" onClick={() => doPay(p)}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded"><Check size={16} /></button>
                        <button title="Reprogramar" onClick={() => doReschedule(p)}
                          className="p-1.5 text-sky-600 hover:bg-sky-50 rounded"><CalendarDays size={16} /></button>
                        <button title="Cancelar" onClick={() => doCancel(p)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"><XCircle size={16} /></button>
                      </div>
                    )}
                    {p.status === 'PAID' && p.paid_at && (
                      <span className="text-xs text-gray-500">
                        {new Date(p.paid_at).toLocaleDateString('es-MX')}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showManual && (
        <ManualPaymentModal onClose={() => setShowManual(false)}
          onSaved={() => { setShowManual(false); refresh(); }} />
      )}
    </div>
  );
}

function KpiCard({ icon, title, value, hint, color }: {
  icon: React.ReactNode; title: string; value: string; hint: string;
  color: 'rose' | 'amber' | 'sky';
}) {
  const palette = {
    rose:  { bg: 'bg-rose-50',  text: 'text-rose-600',  ring: 'ring-rose-100' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-600', ring: 'ring-amber-100' },
    sky:   { bg: 'bg-sky-50',   text: 'text-sky-600',   ring: 'ring-sky-100' },
  }[color];
  return (
    <div className="bg-white rounded-lg shadow p-5">
      <div className={`${palette.bg} ${palette.text} ${palette.ring} ring-1 p-2.5 rounded-lg w-fit mb-3`}>{icon}</div>
      <h3 className="text-gray-600 text-sm font-medium">{title}</h3>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{hint}</p>
    </div>
  );
}

function ManualPaymentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [supplierId, setSupplierId] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const suppliersQ = useQuery({ queryKey: ['suppliers-for-treasury'], queryFn: () => api.listSuppliers({ limit: 500 }) });
  const suppliers: any[] = suppliersQ.data?.data?.suppliers || [];

  const handleSave = async () => {
    setError('');
    if (!supplierId) { setError('Selecciona un proveedor'); return; }
    if (!amount || Number(amount) <= 0) { setError('Monto inválido'); return; }
    setSaving(true);
    try {
      await api.createTreasuryPayment({ supplierId, amount: Number(amount), dueDate, notes: notes.trim() || undefined });
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo crear el pago');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold flex items-center gap-2"><Landmark size={18} /> Pago manual programado</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Proveedor *</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="input">
              <option value="">— Selecciona —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.business_name} ({s.rfc})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto *</label>
              <input type="number" min="0" step="0.01" value={amount}
                onChange={(e) => setAmount(e.target.value)} className="input text-right" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vence *</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nota</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. anticipo, compra sin XML…" className="input" />
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {saving ? 'Guardando…' : 'Programar pago'}
          </button>
        </div>
      </div>
    </div>
  );
}
