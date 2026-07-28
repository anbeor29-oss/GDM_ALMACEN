/**
 * Punto de Venta — venta de mostrador (Fase 5 ALMACEN).
 *
 *  · La venta descuenta inventario AL MOMENTO de cobrar.
 *  · Lo no facturado individualmente entra a la factura global del día
 *    (público en general, RFC XAXX010101000) — cierre manual o cron 23:55.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Store, Search, Trash2, Plus, Minus, Banknote, Receipt, XCircle, Lock,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

interface CartLine {
  productId: string;
  sku: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

const PAYMENT_FORMS: Record<string, string> = {
  '01': 'Efectivo',
  '03': 'Transferencia',
  '04': 'Tarjeta de crédito',
  '28': 'Tarjeta de débito',
};

const SALE_BADGE: Record<string, { label: string; cls: string }> = {
  OPEN:                { label: 'Abierta',            cls: 'bg-sky-100 text-sky-700' },
  INVOICED_INDIVIDUAL: { label: 'Facturada',          cls: 'bg-emerald-100 text-emerald-700' },
  IN_GLOBAL:           { label: 'En factura global',  cls: 'bg-violet-100 text-violet-700' },
  CANCELLED:           { label: 'Cancelada',          cls: 'bg-rose-100 text-rose-700' },
};

const money = (n: number) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export function PointOfSalePage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canManage = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'].includes(user?.role || '');

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentForm, setPaymentForm] = useState('01');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState('');
  const [error, setError] = useState('');

  const productsQ = useQuery({
    queryKey: ['pos-products', search],
    queryFn: () => api.getProducts(1, 8, search),
    enabled: search.trim().length >= 2,
  });
  const found: any[] = productsQ.data?.data?.products || [];

  const salesQ = useQuery({
    queryKey: ['pos-sales-today'],
    queryFn: () => api.getPosSales(),
    refetchInterval: 60_000,
  });
  const sales: any[] = salesQ.data?.data?.sales || [];
  const summary = salesQ.data?.data?.summary;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['pos-sales-today'] });
    qc.invalidateQueries({ queryKey: ['inventory-stock'] });
    qc.invalidateQueries({ queryKey: ['inventory-value'] });
  };

  const addToCart = (p: any) => {
    setSearch('');
    setCart((prev) => {
      const hit = prev.find((l) => l.productId === p.id);
      if (hit) {
        return prev.map((l) => l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, {
        productId: p.id, sku: p.sku, name: p.name,
        unitPrice: Number(p.base_price || 0), quantity: 1,
      }];
    });
  };

  const setQty = (productId: string, delta: number) => {
    setCart((prev) => prev
      .map((l) => l.productId === productId ? { ...l, quantity: Math.max(0, l.quantity + delta) } : l)
      .filter((l) => l.quantity > 0));
  };

  const setPrice = (productId: string, price: string) => {
    setCart((prev) => prev.map((l) =>
      l.productId === productId ? { ...l, unitPrice: Number(price) || 0 } : l));
  };

  const total = cart.reduce((a, l) => a + l.unitPrice * l.quantity, 0);

  const handleCharge = async () => {
    if (cart.length === 0) return;
    setBusy(true); setError(''); setBanner('');
    try {
      const r = await api.createPosSale({
        paymentForm,
        items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
      });
      const warn = (r.data.warnings || []).length > 0
        ? ` ⚠ ${r.data.warnings.join(' · ')}` : '';
      setBanner(`✅ Venta #${r.data.folio} cobrada: ${money(r.data.total)} (${PAYMENT_FORMS[paymentForm]})${warn}`);
      setCart([]);
      refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo cobrar la venta');
    } finally { setBusy(false); }
  };

  const handleCancel = async (sale: any) => {
    if (!window.confirm(`¿Cancelar la venta #${sale.folio}? La mercancía regresa al inventario.`)) return;
    setError('');
    try {
      await api.cancelPosSale(sale.id);
      refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo cancelar');
    }
  };

  const handleCloseDay = async () => {
    if (!window.confirm(
      `Cerrar el día genera la FACTURA GLOBAL al público en general con las ${summary?.open ?? 0} venta(s) abiertas. ¿Continuar?`
    )) return;
    setBusy(true); setError(''); setBanner('');
    try {
      const r = await api.closePosDay();
      setBanner(
        r.data.invoiceId
          ? `🧾 ${r.data.message} Folio ${r.data.folio} por ${money(r.data.totalInvoiced)} ${r.data.stamped ? '(timbrada)' : '(timbrado pendiente — reintenta desde Facturas)'}`
          : r.data.message
      );
      refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo cerrar el día');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <Store className="text-amber-600" size={36} /> Punto de venta
          </h1>
          <p className="text-gray-600 mt-1">
            La venta descuenta inventario al momento · lo no facturado entra a la global del día (23:55)
          </p>
        </div>
        {canManage && (
          <button onClick={handleCloseDay} disabled={busy || (summary?.open ?? 0) === 0}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg disabled:opacity-50">
            <Receipt size={18} /> Cerrar día (factura global)
          </button>
        )}
      </div>

      {banner && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-sm">{banner}</div>}
      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Carrito ── */}
        <div className="bg-white rounded-lg shadow border">
          <div className="p-4 border-b">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar producto por nombre o SKU (mín. 2 letras)…"
                className="input pl-9 w-full" autoFocus />
              {search.trim().length >= 2 && found.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  {found.map((p) => (
                    <button key={p.id} onClick={() => addToCart(p)}
                      className="w-full text-left px-3 py-2 hover:bg-sky-50 flex justify-between items-center">
                      <span>
                        <span className="font-mono text-xs text-gray-500">{p.sku}</span>{' '}
                        <span className="font-medium text-sm">{p.name}</span>
                      </span>
                      <span className="text-sm font-semibold">{money(p.base_price)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="p-4 space-y-2 min-h-40">
            {cart.length === 0 && (
              <p className="text-sm text-gray-400 italic text-center py-8">
                Carrito vacío — busca un producto para empezar
              </p>
            )}
            {cart.map((l) => (
              <div key={l.productId} className="flex items-center gap-2 border border-gray-200 rounded-lg p-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{l.name}</p>
                  <p className="text-xs text-gray-500 font-mono">{l.sku}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setQty(l.productId, -1)}
                    className="p-1 text-gray-500 hover:bg-gray-100 rounded"><Minus size={14} /></button>
                  <span className="w-10 text-center font-semibold">{l.quantity}</span>
                  <button onClick={() => setQty(l.productId, +1)}
                    className="p-1 text-gray-500 hover:bg-gray-100 rounded"><Plus size={14} /></button>
                </div>
                <input type="number" min="0" step="any" value={l.unitPrice}
                  onChange={(e) => setPrice(l.productId, e.target.value)}
                  className="input w-24 text-right" />
                <span className="w-24 text-right text-sm font-semibold">
                  {money(l.unitPrice * l.quantity)}
                </span>
                <button onClick={() => setQty(l.productId, -l.quantity)}
                  className="p-1.5 text-rose-500 hover:bg-rose-50 rounded"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>

          <div className="p-4 border-t bg-gray-50 flex items-center gap-3">
            <select value={paymentForm} onChange={(e) => setPaymentForm(e.target.value)} className="input w-auto">
              {Object.entries(PAYMENT_FORMS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div className="ml-auto text-right">
              <p className="text-xs text-gray-500 uppercase">Total (IVA incluido)</p>
              <p className="text-2xl font-bold text-gray-900">{money(total)}</p>
            </div>
            <button onClick={handleCharge} disabled={busy || cart.length === 0}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-lg font-semibold disabled:opacity-50">
              <Banknote size={18} /> {busy ? 'Cobrando…' : 'Cobrar'}
            </button>
          </div>
        </div>

        {/* ── Ventas del día ── */}
        <div className="bg-white rounded-lg shadow border">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="font-bold text-gray-900">Ventas de hoy</h2>
            {summary && (
              <div className="flex gap-3 text-sm">
                <span className="text-gray-500">{summary.sales} ventas</span>
                <span className="text-sky-700 font-medium">{summary.open} abiertas</span>
                <span className="font-bold text-gray-900">{money(summary.total)}</span>
              </div>
            )}
          </div>
          <div className="divide-y max-h-[32rem] overflow-y-auto">
            {sales.length === 0 && (
              <p className="text-sm text-gray-400 italic text-center py-8">Sin ventas hoy todavía</p>
            )}
            {sales.map((s) => {
              const badge = SALE_BADGE[s.status] || { label: s.status, cls: 'bg-gray-100 text-gray-600' };
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                  <span className="font-mono font-semibold text-sm w-14">#{s.folio}</span>
                  <span className="text-xs text-gray-500 w-14">
                    {new Date(s.sold_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-xs text-gray-500 w-20">
                    {s.items_count} art · {PAYMENT_FORMS[s.payment_form] || s.payment_form}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                    {badge.label}
                  </span>
                  <span className="ml-auto font-semibold text-sm">{money(s.total)}</span>
                  {canManage && s.status === 'OPEN' && (
                    <button title="Cancelar venta" onClick={() => handleCancel(s)}
                      className="p-1.5 text-rose-500 hover:bg-rose-50 rounded"><XCircle size={16} /></button>
                  )}
                  {s.status === 'IN_GLOBAL' && (
                    <span title="Incluida en la factura global — cancelar requiere NC">
                      <Lock size={14} className="text-gray-400" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
