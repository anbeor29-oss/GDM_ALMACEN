/**
 * Inventario Físico — conteo y conciliación (Fase 6 ALMACEN §11).
 *
 *  Abrir un conteo congela la existencia del sistema; se captura lo contado
 *  físicamente; al cerrar (con autorización) el stock se ajusta a lo contado
 *  y las diferencias quedan en el kardex como ajustes.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck, Plus, Eye, CheckCircle2, XCircle, PackageX, PackagePlus,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const num = (n: any) => Number(n ?? 0).toLocaleString('es-MX');

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  OPEN:      { label: 'En captura', cls: 'bg-sky-100 text-sky-700' },
  CLOSED:    { label: 'Cerrado',    cls: 'bg-emerald-100 text-emerald-700' },
  CANCELLED: { label: 'Cancelado',  cls: 'bg-rose-100 text-rose-700' },
};

export function PhysicalCountPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canManage = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'].includes(user?.role || '');
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const q = useQuery({ queryKey: ['physical-counts'], queryFn: () => api.getPhysicalCounts() });
  const counts: any[] = q.data?.data?.counts || [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['physical-counts'] });
    qc.invalidateQueries({ queryKey: ['inventory-stock'] });
    qc.invalidateQueries({ queryKey: ['inventory-count-due'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <ClipboardCheck className="text-amber-600" size={36} /> Inventario físico
          </h1>
          <p className="text-gray-600 mt-1">
            Conteo por almacén · comparación sistema vs físico · ajuste autorizado al kardex
          </p>
        </div>
        {canManage && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-blue-600">
            <Plus size={18} /> Nuevo conteo
          </button>
        )}
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Folio</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Almacén</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Categoría</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Productos</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Contados</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Diferencias</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Valor dif.</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Estado</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && counts.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500 italic">
                Sin conteos. Crea uno para conciliar la existencia física con el sistema.
              </td></tr>
            )}
            {counts.map((c) => {
              const badge = STATUS_BADGE[c.status] || { label: c.status, cls: 'bg-gray-100 text-gray-600' };
              const vdiff = Number(c.value_difference);
              return (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono font-semibold">#{c.folio}</td>
                  <td className="px-4 py-2 text-sm">
                    <span className="font-mono text-xs bg-sky-50 text-sky-700 px-2 py-0.5 rounded">{c.warehouse_code}</span>
                  </td>
                  <td className="px-4 py-2 text-sm">{c.category || 'Todas'}</td>
                  <td className="px-4 py-2 text-center text-sm">{c.products}</td>
                  <td className="px-4 py-2 text-center text-sm">{c.counted}</td>
                  <td className="px-4 py-2 text-center text-sm">
                    {c.differences > 0
                      ? <span className="text-amber-700 font-semibold">{c.differences}</span>
                      : <span className="text-gray-400">0</span>}
                  </td>
                  <td className={`px-4 py-2 text-right text-sm font-medium ${
                    vdiff < 0 ? 'text-rose-700' : vdiff > 0 ? 'text-emerald-700' : 'text-gray-400'
                  }`}>
                    {vdiff !== 0 ? money(vdiff) : '—'}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button title="Abrir" onClick={() => setDetailId(c.id)}
                      className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"><Eye size={16} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateCountModal onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); refresh(); setDetailId(id); }} />
      )}
      {detailId && (
        <CountDetailModal countId={detailId} canManage={canManage}
          onClose={() => setDetailId(null)}
          onChanged={refresh} onError={setError} />
      )}
    </div>
  );
}

function CreateCountModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [warehouseId, setWarehouseId] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const whQ = useQuery({ queryKey: ['warehouses'], queryFn: () => api.getWarehouses() });
  const warehouses: any[] = whQ.data?.data?.warehouses || [];

  const handleCreate = async () => {
    setError('');
    if (!warehouseId) { setError('Selecciona un almacén'); return; }
    setSaving(true);
    try {
      const r = await api.openPhysicalCount({ warehouseId, category: category.trim() || undefined, notes: notes.trim() || undefined });
      onCreated(r.data.id);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo abrir el conteo');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold flex items-center gap-2"><ClipboardCheck size={18} /> Nuevo conteo físico</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Almacén *</label>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input">
              <option value="">— Selecciona —</option>
              {warehouses.filter((w) => w.is_active).map((w) => (
                <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Categoría (opcional)</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)}
              placeholder="Vacío = todo el almacén" className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input" />
          </div>
          <p className="text-xs text-gray-500">
            Al abrir, se congela la existencia del sistema como referencia. Podrás capturar
            lo contado y, al cerrar con autorización, el stock se ajusta a lo físico.
          </p>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
          <button onClick={handleCreate} disabled={saving}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {saving ? 'Abriendo…' : 'Abrir conteo'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CountDetailModal({ countId, canManage, onClose, onChanged, onError }: {
  countId: string; canManage: boolean; onClose: () => void;
  onChanged: () => void; onError: (m: string) => void;
}) {
  const qc = useQueryClient();
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const q = useQuery({ queryKey: ['physical-count', countId], queryFn: () => api.getPhysicalCount(countId) });
  const count = q.data?.data?.count;
  const items: any[] = q.data?.data?.items || [];
  const isOpen = count?.status === 'OPEN';

  const refreshDetail = () => {
    qc.invalidateQueries({ queryKey: ['physical-count', countId] });
    onChanged();
  };

  const saveCapture = async () => {
    const payload = Object.entries(counted)
      .filter(([, v]) => v !== '')
      .map(([itemId, v]) => ({ itemId, countedQty: Number(v) }));
    if (payload.length === 0) return;
    setBusy(true);
    try {
      await api.capturePhysicalCount(countId, payload);
      setCounted({});
      refreshDetail();
    } catch (e: any) {
      onError(e?.response?.data?.message || 'No se pudo guardar la captura');
    } finally { setBusy(false); }
  };

  const closeCount = async () => {
    if (!window.confirm('Cerrar el conteo aplicará los ajustes al inventario. ¿Continuar?')) return;
    setBusy(true);
    try {
      const r = await api.closePhysicalCount(countId);
      onError('');
      refreshDetail();
      window.alert(`Conteo cerrado: ${r.data.adjustments} ajuste(s) — ${r.data.surplus} sobrantes, ${r.data.shortage} faltantes.`);
    } catch (e: any) {
      onError(e?.response?.data?.message || 'No se pudo cerrar el conteo');
    } finally { setBusy(false); }
  };

  const cancelCount = async () => {
    if (!window.confirm('¿Cancelar el conteo? No se aplicará ningún ajuste.')) return;
    setBusy(true);
    try { await api.cancelPhysicalCount(countId); refreshDetail(); onClose(); }
    catch (e: any) { onError(e?.response?.data?.message || 'No se pudo cancelar'); }
    finally { setBusy(false); }
  };

  if (!count) return null;
  const badge = STATUS_BADGE[count.status];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-bold">
              Conteo #{count.folio} · {count.warehouse_code} — {count.warehouse_name}
            </h2>
            <p className="text-xs text-gray-500">
              {count.category || 'Todas las categorías'} · abierto {new Date(count.started_at).toLocaleString('es-MX')}
              {count.authorized_by_email && ` · autorizó ${count.authorized_by_email}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${badge?.cls}`}>{badge?.label}</span>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">✕</button>
          </div>
        </div>

        <div className="p-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="py-1.5 pr-3">Producto</th>
                <th className="py-1.5 pr-3 text-right">Sistema</th>
                <th className="py-1.5 pr-3 text-right">Contado</th>
                <th className="py-1.5 pr-3 text-right">Diferencia</th>
                <th className="py-1.5 text-right">Valor dif.</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((it) => {
                const contadoActual = counted[it.id] !== undefined
                  ? counted[it.id]
                  : (it.counted_qty != null ? String(it.counted_qty) : '');
                const diff = it.counted_qty != null ? Number(it.difference) : null;
                return (
                  <tr key={it.id}>
                    <td className="py-1.5 pr-3">
                      <span className="font-mono text-xs text-gray-500">{it.sku}</span>{' '}
                      <span className="font-medium">{it.product_name}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right text-gray-600">{num(it.system_qty)}</td>
                    <td className="py-1.5 pr-3 text-right">
                      {isOpen ? (
                        <input type="number" min="0" step="any" value={contadoActual}
                          onChange={(e) => setCounted({ ...counted, [it.id]: e.target.value })}
                          placeholder="—" className="input w-24 text-right py-1" />
                      ) : (it.counted_qty != null ? num(it.counted_qty) : '—')}
                    </td>
                    <td className={`py-1.5 pr-3 text-right font-medium ${
                      diff == null ? 'text-gray-300' : diff < 0 ? 'text-rose-700' : diff > 0 ? 'text-emerald-700' : 'text-gray-400'
                    }`}>
                      {diff == null ? '—' : (
                        <span className="inline-flex items-center gap-1 justify-end">
                          {diff < 0 && <PackageX size={13} />}
                          {diff > 0 && <PackagePlus size={13} />}
                          {diff > 0 ? '+' : ''}{num(diff)}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right text-xs text-gray-500">
                      {diff != null && diff !== 0 ? money(it.value_difference) : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {canManage && isOpen && (
          <div className="flex flex-wrap justify-end gap-2 p-5 border-t bg-gray-50 sticky bottom-0">
            <button onClick={cancelCount} disabled={busy}
              className="flex items-center gap-2 px-4 py-2 text-rose-600 hover:bg-rose-50 rounded-lg text-sm">
              <XCircle size={16} /> Cancelar conteo
            </button>
            <button onClick={saveCapture} disabled={busy || Object.keys(counted).length === 0}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm disabled:opacity-50">
              Guardar captura
            </button>
            <button onClick={closeCount} disabled={busy}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm disabled:opacity-50">
              <CheckCircle2 size={16} /> Cerrar y ajustar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
