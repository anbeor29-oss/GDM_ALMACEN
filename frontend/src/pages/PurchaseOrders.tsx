/**
 * Órdenes de Compra — cotización → aprobación → compra → recepción (§3 ALMACEN.MD).
 *
 *  · "Analizar inventario" corre el mismo análisis del cron diario: bajo
 *    mínimo o proyectado a tocarlo en ≤15 días → órdenes AUTO por almacén.
 *  · Recepción parcial o total; al recibir, el sistema PREGUNTA cómo aplicar
 *    el costo (prorratear / revaluar todo / respetar capas).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList, Sparkles, CheckCircle2, PackageCheck, XCircle,
  ShoppingCart, Eye,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  PENDING:          { label: 'Pendiente',        cls: 'bg-gray-200 text-gray-700' },
  QUOTED:           { label: 'Cotizada',         cls: 'bg-sky-100 text-sky-700' },
  APPROVED:         { label: 'Aprobada',         cls: 'bg-emerald-100 text-emerald-700' },
  PURCHASED:        { label: 'Comprada',         cls: 'bg-violet-100 text-violet-700' },
  RECEIVED_PARTIAL: { label: 'Recibida parcial', cls: 'bg-amber-100 text-amber-700' },
  RECEIVED:         { label: 'Recibida',         cls: 'bg-emerald-100 text-emerald-700' },
  CANCELLED:        { label: 'Cancelada',        cls: 'bg-rose-100 text-rose-700' },
};

const money = (n: number) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const num = (n: number) => Number(n ?? 0).toLocaleString('es-MX');

export function PurchaseOrdersPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canWrite = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'].includes(user?.role || '');

  const [statusFilter, setStatusFilter] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [banner, setBanner] = useState('');
  const [error, setError] = useState('');

  const q = useQuery({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: () => api.getPurchaseOrders({ status: statusFilter || undefined, limit: 100 }),
  });
  const orders: any[] = q.data?.data?.orders || [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    qc.invalidateQueries({ queryKey: ['inventory-stock'] });
  };

  const handleAnalyze = async () => {
    setAnalyzing(true); setBanner(''); setError('');
    try {
      const r = await api.runReorderCheck();
      const d = r.data;
      if (d.ordersCreated.length > 0) {
        setBanner(
          `Análisis completado: ${d.ordersCreated.length} orden(es) de cotización generadas ` +
          `(${d.candidates} producto(s) candidatos, ${d.skippedWithOpenOrder} ya tenían orden abierta).`
        );
      } else {
        setBanner(
          d.candidates === 0
            ? 'Análisis completado: ningún producto bajo mínimo ni proyectado a faltar en 15 días. 👌'
            : `Análisis completado: los ${d.candidates} candidatos ya tienen orden abierta — sin duplicados.`
        );
      }
      refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'El análisis falló');
    } finally { setAnalyzing(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <ClipboardList className="text-emerald-600" size={36} /> Órdenes de compra
          </h1>
          <p className="text-gray-600 mt-1">
            Cotización → aprobación → compra → recepción · generadas por el análisis diario o manualmente
          </p>
        </div>
        {canWrite && (
          <button onClick={handleAnalyze} disabled={analyzing}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50">
            <Sparkles size={18} /> {analyzing ? 'Analizando…' : 'Analizar inventario'}
          </button>
        )}
      </div>

      {banner && (
        <div className="bg-sky-50 border border-sky-200 text-sky-900 px-4 py-3 rounded-lg text-sm">
          {banner}
        </div>
      )}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow border p-4 flex items-center gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input w-auto">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_BADGE).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <span className="ml-auto text-sm text-gray-500">{orders.length} órdenes</span>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Folio</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Origen</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Almacén</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Proveedor</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Items</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Estimado</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Avance</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Estado</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && orders.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500 italic">
                Sin órdenes. Usa "Analizar inventario" para generar cotizaciones de lo que
                está bajo mínimo (o llegará al mínimo en 15 días).
              </td></tr>
            )}
            {orders.map((o) => {
              const badge = STATUS_BADGE[o.status] || { label: o.status, cls: 'bg-gray-100 text-gray-600' };
              const pct = Number(o.total_ordered) > 0
                ? Math.round((Number(o.total_received) / Number(o.total_ordered)) * 100) : 0;
              return (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono font-semibold">#{o.folio}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      o.source === 'AUTO' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {o.source === 'AUTO' ? '🤖 Automática' : 'Manual'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm">
                    <span className="font-mono text-xs bg-sky-50 text-sky-700 px-2 py-0.5 rounded">
                      {o.warehouse_code}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm truncate max-w-48">{o.supplier_name || '—'}</td>
                  <td className="px-4 py-2 text-center text-sm">{o.items_count}</td>
                  <td className="px-4 py-2 text-right text-sm font-medium">{money(o.estimated_total)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-16">
                        <div className="h-1.5 bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-8">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button title="Ver detalle" onClick={() => setDetailId(o.id)}
                      className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded">
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detailId && (
        <OrderDetailModal orderId={detailId} canWrite={canWrite}
          onClose={() => setDetailId(null)}
          onChanged={() => { refresh(); }} />
      )}
    </div>
  );
}

/* ============================ DETALLE + ACCIONES ============================ */

function OrderDetailModal({ orderId, canWrite, onClose, onChanged }: {
  orderId: string; canWrite: boolean; onClose: () => void; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [receiving, setReceiving] = useState(false);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [costing, setCosting] = useState<'' | 'PROMEDIO' | 'ULTIMO' | 'CAPAS'>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const q = useQuery({
    queryKey: ['purchase-order', orderId],
    queryFn: () => api.getPurchaseOrder(orderId),
  });
  const order = q.data?.data?.order;
  const items: any[] = q.data?.data?.items || [];

  const refreshDetail = () => {
    qc.invalidateQueries({ queryKey: ['purchase-order', orderId] });
    onChanged();
  };

  const doStatus = async (status: string) => {
    setBusy(true); setError('');
    try {
      await api.setPurchaseOrderStatus(orderId, status);
      refreshDetail();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo cambiar el estado');
    } finally { setBusy(false); }
  };

  const doReceive = async () => {
    setBusy(true); setError('');
    try {
      const receipts = items
        .map((it) => ({ itemId: it.id, quantity: Number(receiveQty[it.id] || 0) }))
        .filter((r) => r.quantity > 0);
      if (receipts.length === 0) { setError('Captura al menos una cantidad a recibir'); setBusy(false); return; }
      await api.receivePurchaseOrder(orderId, receipts, costing || undefined);
      setReceiving(false); setReceiveQty({});
      refreshDetail();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo registrar la recepción');
    } finally { setBusy(false); }
  };

  if (!order) return null;
  const badge = STATUS_BADGE[order.status] || { label: order.status, cls: 'bg-gray-100 text-gray-600' };
  const canReceive = ['APPROVED', 'PURCHASED', 'RECEIVED_PARTIAL'].includes(order.status);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
              <ClipboardList className="text-emerald-700" size={20} />
            </div>
            <div>
              <h2 className="font-bold">Orden #{order.folio} · {order.warehouse_code} — {order.warehouse_name}</h2>
              <p className="text-xs text-gray-500">
                {order.supplier_name ? `Proveedor: ${order.supplier_name}` : 'Sin proveedor asignado'} ·
                creada {new Date(order.created_at).toLocaleDateString('es-MX')} ·
                necesidad {order.needed_by_date ? new Date(order.needed_by_date).toLocaleDateString('es-MX') : '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">✕</button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">{error}</div>}
          {order.notes && <p className="text-sm text-gray-600 bg-gray-50 rounded p-3">{order.notes}</p>}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="py-1.5 pr-3">Producto</th>
                <th className="py-1.5 pr-3 text-right">Sugerido</th>
                <th className="py-1.5 pr-3 text-right">Pedido</th>
                <th className="py-1.5 pr-3 text-right">Recibido</th>
                <th className="py-1.5 pr-3 text-right">Últ. precio</th>
                <th className="py-1.5 pr-3">Prov. sugerido</th>
                {receiving && <th className="py-1.5 text-right">Recibir ahora</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((it) => {
                const pending = Number(it.quantity_ordered) - Number(it.quantity_received);
                return (
                  <tr key={it.id}>
                    <td className="py-1.5 pr-3">
                      <span className="font-mono text-xs text-gray-500">{it.sku}</span>{' '}
                      <span className="font-medium">{it.product_name}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right">{num(it.quantity_suggested)}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold">{num(it.quantity_ordered)}</td>
                    <td className="py-1.5 pr-3 text-right">
                      <span className={Number(it.quantity_received) >= Number(it.quantity_ordered)
                        ? 'text-emerald-700 font-semibold' : ''}>
                        {num(it.quantity_received)}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {it.last_purchase_price != null ? money(it.last_purchase_price) : '—'}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-gray-600 truncate max-w-36">
                      {it.supplier_suggested_name || '—'}
                    </td>
                    {receiving && (
                      <td className="py-1.5 text-right">
                        <input type="number" min="0" max={pending} step="any"
                          value={receiveQty[it.id] ?? ''}
                          onChange={(e) => setReceiveQty({ ...receiveQty, [it.id]: e.target.value })}
                          placeholder={`máx ${num(pending)}`}
                          className="input w-28 text-right" />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* La PREGUNTA de costos (requerimiento): cómo aplicar el costo nuevo */}
          {receiving && (
            <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-4">
              <p className="text-sm font-medium text-amber-900 mb-2">
                ¿Cómo aplicar el costo si ya hay existencia a otro precio?
              </p>
              <select value={costing} onChange={(e) => setCosting(e.target.value as any)} className="input max-w-md">
                <option value="">Según la política de la empresa (default)</option>
                <option value="PROMEDIO">Prorratear — costo promedio ponderado</option>
                <option value="ULTIMO">Aumentar en general — todo el stock al costo nuevo</option>
                <option value="CAPAS">Respetar precios — existente a precio X, nuevo a precio Z (FIFO)</option>
              </select>
            </div>
          )}
        </div>

        {canWrite && (
          <div className="flex flex-wrap justify-end gap-2 p-5 border-t bg-gray-50 sticky bottom-0">
            {['PENDING', 'QUOTED'].includes(order.status) && (
              <ActionBtn icon={<CheckCircle2 size={16} />} label="Aprobar" color="emerald"
                disabled={busy} onClick={() => doStatus('APPROVED')} />
            )}
            {order.status === 'PENDING' && (
              <ActionBtn icon={<Eye size={16} />} label="Marcar cotizada" color="sky"
                disabled={busy} onClick={() => doStatus('QUOTED')} />
            )}
            {order.status === 'APPROVED' && (
              <ActionBtn icon={<ShoppingCart size={16} />} label="Marcar comprada" color="violet"
                disabled={busy} onClick={() => doStatus('PURCHASED')} />
            )}
            {canReceive && !receiving && (
              <ActionBtn icon={<PackageCheck size={16} />} label="Recibir mercancía" color="emerald"
                disabled={busy} onClick={() => setReceiving(true)} />
            )}
            {receiving && (
              <>
                <button onClick={() => setReceiving(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">
                  Cancelar recepción
                </button>
                <ActionBtn icon={<PackageCheck size={16} />} label={busy ? 'Recibiendo…' : 'Confirmar recepción'}
                  color="emerald" disabled={busy} onClick={doReceive} />
              </>
            )}
            {!['RECEIVED', 'CANCELLED'].includes(order.status) && !receiving && (
              <ActionBtn icon={<XCircle size={16} />} label="Cancelar orden" color="rose"
                disabled={busy}
                onClick={() => { if (window.confirm('¿Cancelar esta orden?')) doStatus('CANCELLED'); }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, color, disabled, onClick }: {
  icon: React.ReactNode; label: string; color: 'emerald' | 'sky' | 'violet' | 'rose';
  disabled?: boolean; onClick: () => void;
}) {
  const cls = {
    emerald: 'bg-emerald-600 hover:bg-emerald-700',
    sky:     'bg-sky-600 hover:bg-sky-700',
    violet:  'bg-violet-600 hover:bg-violet-700',
    rose:    'bg-rose-600 hover:bg-rose-700',
  }[color];
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center gap-2 ${cls} text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50`}>
      {icon}{label}
    </button>
  );
}
