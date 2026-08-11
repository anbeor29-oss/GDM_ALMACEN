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
  /* Cliente al que se le factura la venta. Vacío = público general, que es el
   * caso normal en mostrador y termina en la factura global del día. */
  const [customerId, setCustomerId] = useState('');
  /** Última venta cobrada: de ahí sale el ticket que se imprime. */
  const [ticket, setTicket] = useState<any>(null);

  const productsQ = useQuery({
    queryKey: ['pos-products', search],
    queryFn: () => api.getProducts(1, 8, search),
    enabled: search.trim().length >= 2,
  });
  const found: any[] = productsQ.data?.data?.products || [];

  const salesQ = useQuery({
    queryKey: ['pos-sales-today'],
    queryFn: () => api.getPosSales(),
  });
  /* Los clientes se cargan una vez y se filtran en el navegador: en mostrador
   * no se puede esperar una petición por cada letra mientras hay fila. */
  const clientesQ = useQuery({
    queryKey: ['clientes-pos'],
    queryFn: () => api.getCustomers(1, 300),
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

      /* El ticket se arma con lo que se tenía en pantalla, no se vuelve a
       * pedir al servidor: el cliente ya está esperando su papel y una
       * petición más sólo agrega demora. */
      setTicket({
        folio: r.data.folio, total: r.data.total, fecha: new Date(),
        formaPago: PAYMENT_FORMS[paymentForm], lineas: cart,
      });

      let extra = '';
      if (customerId) {
        /* Pidió factura. Se emite a su nombre con las partidas del ticket; el
         * inventario NO se descuenta otra vez —el backend reapunta los
         * movimientos de la venta a la factura—. */
        try {
          const f: any = await api.facturarVentaPos(r.data.id, customerId);
          const d = f?.data ?? f;
          extra = d?.stamped
            ? ` · Factura ${d.folio} timbrada`
            : ` · Factura ${d?.folio || ''} creada SIN timbrar: ${d?.aviso || 'revisa Facturas'}`;
        } catch (e: any) {
          /* La venta ya está cobrada: no se deshace por un fallo al facturar.
           * Se avisa para que se emita desde Facturas. */
          extra = ` · ⚠ La venta se cobró pero no se pudo facturar: ${e?.response?.data?.message || e.message}`;
        }
      }

      setBanner(`✅ Venta #${r.data.folio} cobrada: ${money(r.data.total)} (${PAYMENT_FORMS[paymentForm]})${warn}${extra}`);
      setCart([]);
      setCustomerId('');
      refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo cobrar la venta');
    } finally { setBusy(false); }
  };

  /* El ticket se imprime abriendo una ventana con su propio HTML.
   *
   * No se usa window.print() de la página completa porque imprimiría el menú,
   * el carrito y la lista de ventas. Y no se arma un PDF en el servidor porque
   * en mostrador el papel tiene que salir YA: una ida al backend por cada
   * ticket agrega segundos con gente esperando. */
  const imprimirTicket = () => {
    if (!ticket) return;
    const filas = ticket.lineas.map((l: any) =>
      `<tr><td>${l.quantity} x ${l.name}</td><td class="d">${money(l.unitPrice * l.quantity)}</td></tr>`
    ).join('');
    const w = window.open('', '_blank', 'width=380,height=600');
    if (!w) { setError('El navegador bloqueó la ventana del ticket. Permite las ventanas emergentes.'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ticket ${ticket.folio}</title>
      <style>
        /* 58 mm es el ancho de la mayoría de las impresoras de tickets. */
        @page { size: 58mm auto; margin: 3mm; }
        body { font-family: ui-monospace, monospace; font-size: 11px; width: 52mm; }
        h1 { font-size: 13px; text-align: center; margin: 0 0 2px; }
        .c { text-align: center; } .d { text-align: right; }
        table { width: 100%; border-collapse: collapse; margin-top: 6px; }
        td { padding: 1px 0; vertical-align: top; }
        .tot { border-top: 1px dashed #000; font-weight: bold; font-size: 13px; }
      </style></head><body>
      <h1>TICKET DE VENTA</h1>
      <p class="c">Folio #${ticket.folio}<br>${ticket.fecha.toLocaleString('es-MX')}</p>
      <table>${filas}
        <tr class="tot"><td>TOTAL</td><td class="d">${money(ticket.total)}</td></tr>
      </table>
      <p class="c" style="margin-top:8px">Pago: ${ticket.formaPago}</p>
      <p class="c" style="margin-top:10px">¡Gracias por su compra!</p>
      <p class="c" style="font-size:9px">Este ticket no es un comprobante fiscal.</p>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
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
      {ticket && (
        <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm">
          <span className="text-slate-700">Ticket de la venta <b>#{ticket.folio}</b> listo.</span>
          <div className="flex gap-2">
            <button onClick={imprimirTicket}
              className="px-3 py-1.5 bg-slate-800 text-white rounded text-xs hover:bg-slate-900">
              Imprimir ticket
            </button>
            <button onClick={() => setTicket(null)}
              className="px-3 py-1.5 border border-slate-300 rounded text-xs hover:bg-white">
              Cerrar
            </button>
          </div>
        </div>
      )}
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
            {/* Cliente. Vacío es lo normal —público general, va a la global del
                día—; con cliente se emite su factura al cobrar. Se deja aquí,
                junto a la forma de pago, porque las dos son decisiones del
                momento de cobrar y no del armado del carrito. */}
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}
                    className="input w-auto max-w-[260px]"
                    title="Déjalo en público general si no piden factura">
              <option value="">Público general (sin factura)</option>
              {((clientesQ.data as any)?.data?.customers ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.rfc} · {c.business_name}</option>
              ))}
            </select>
            {customerId && (
              <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                Se emitirá factura a este cliente
              </span>
            )}
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
