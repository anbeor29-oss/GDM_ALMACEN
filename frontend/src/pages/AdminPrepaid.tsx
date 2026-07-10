/**
 * Super-Admin → Compras Prepago (plan FLEX)
 *
 * Tabla de empresas con plan PKG_FLEX y su saldo de timbres prepago.
 * Modal de recarga por bloques (default 30 × $4.99) con registro del pago.
 * Histórico de compras por empresa.
 *
 * Referencia: docs/DISENO_FACTURACION_PLANES.md §2.3
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingCart, X, Plus, History, AlertTriangle, Loader2, Coins,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

function fmtMoney(n: any) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDateTime(d: any) {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

export function AdminPrepaidPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [rechargeTarget, setRechargeTarget] = useState<any>(null);
  const [historyTarget, setHistoryTarget] = useState<any>(null);

  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 p-6 rounded-lg">
        <p className="font-semibold mb-1">Acceso restringido</p>
        <p className="text-sm">Esta sección requiere rol <b>SUPER_ADMIN</b>. Tu rol: <b>{user?.role}</b>.</p>
      </div>
    );
  }

  const q = useQuery({
    queryKey: ['admin-prepaid-balances'],
    queryFn: () => api.adminPrepaidBalances(),
    refetchInterval: 60_000,
  });
  const rows = q.data?.data?.companies || [];
  const defaultPrice = Number(q.data?.data?.default_unit_price || 4.99);

  const totalSaldo = rows.reduce((s: number, r: any) => s + Number(r.balance || 0), 0);
  const totalVendidoMxn = rows.reduce((s: number, r: any) => s + Number(r.lifetime_mxn || 0), 0);
  const enRiesgo = rows.filter((r: any) => Number(r.balance) <= Number(r.low_threshold)).length;

  const onDone = () => {
    setRechargeTarget(null);
    qc.invalidateQueries({ queryKey: ['admin-prepaid-balances'] });
    qc.invalidateQueries({ queryKey: ['admin-billing-current'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <ShoppingCart className="text-violet-600" size={36}/> Compras Prepago
          </h1>
          <p className="text-gray-600 mt-1">
            Saldo de timbres del plan <b>Uso libre (PKG_FLEX)</b> · bloque sugerido 30 × ${fmtMoney(defaultPrice)} + IVA
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Coins size={16}/> Timbres prepago vivos
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">{totalSaldo}</p>
          <p className="text-xs text-slate-500 mt-1">Suma de saldos de todas las empresas FLEX.</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <ShoppingCart size={16}/> Ingresos por recargas (histórico)
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">$ {fmtMoney(totalVendidoMxn)}</p>
          <p className="text-xs text-slate-500 mt-1">Total facturado en bloques prepago.</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <AlertTriangle size={16}/> Empresas en riesgo
          </div>
          <p className={`text-3xl font-bold mt-2 ${enRiesgo > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {enRiesgo}
          </p>
          <p className="text-xs text-slate-500 mt-1">Saldo en o por debajo del umbral de aviso.</p>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Empresas con plan Uso libre</h2>
          <span className="text-xs text-slate-500">{rows.length} empresas · refresca cada 60 s</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="px-4 py-2 text-left">RFC</th>
                <th className="px-4 py-2 text-left">Empresa</th>
                <th className="px-4 py-2 text-right">Saldo</th>
                <th className="px-4 py-2 text-right">Umbral aviso</th>
                <th className="px-4 py-2 text-right">Usados este mes</th>
                <th className="px-4 py-2 text-left">Última recarga</th>
                <th className="px-4 py-2 text-right">Comprados (vida)</th>
                <th className="px-4 py-2 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r: any) => {
                const balance = Number(r.balance);
                const threshold = Number(r.low_threshold);
                const critical = balance === 0;
                const warning = !critical && balance <= threshold;
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs">{r.rfc}</td>
                    <td className="px-4 py-2 font-medium">{r.business_name}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`font-bold text-lg ${
                        critical ? 'text-red-600' : warning ? 'text-amber-600' : 'text-emerald-700'
                      }`}>
                        {balance}
                      </span>
                      {critical && (
                        <span className="block text-[10px] text-red-500 font-semibold uppercase">
                          Bloqueado
                        </span>
                      )}
                      {warning && (
                        <span className="block text-[10px] text-amber-600 font-semibold uppercase">
                          Por agotarse
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">{threshold}</td>
                    <td className="px-4 py-2 text-right">{r.used_current_month}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {r.last_recharge_at
                        ? `${fmtDateTime(r.last_recharge_at)} (+${r.last_recharge_stamps})`
                        : <span className="italic">nunca</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="font-semibold">{r.lifetime_stamps}</span>
                      <span className="text-[10px] text-slate-400 block">$ {fmtMoney(r.lifetime_mxn)}</span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          title="Recargar timbres"
                          onClick={() => setRechargeTarget(r)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded"
                        >
                          <Plus size={14}/> Recargar
                        </button>
                        <button
                          title="Ver compras"
                          onClick={() => setHistoryTarget(r)}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"
                        >
                          <History size={16}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {q.isLoading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 italic">Cargando…</td></tr>
              )}
              {!q.isLoading && rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 italic">
                  Ninguna empresa tiene plan Uso libre (PKG_FLEX) actualmente.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {rechargeTarget && (
        <RechargeModal
          company={rechargeTarget}
          defaultPrice={defaultPrice}
          onClose={() => setRechargeTarget(null)}
          onDone={onDone}
        />
      )}
      {historyTarget && (
        <PurchasesModal
          company={historyTarget}
          onClose={() => setHistoryTarget(null)}
        />
      )}
    </div>
  );
}

/* ─────────────── Modal de recarga ─────────────── */

function RechargeModal({
  company, defaultPrice, onClose, onDone,
}: {
  company: any;
  defaultPrice: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [stamps, setStamps] = useState(30);
  const [unitPrice, setUnitPrice] = useState(defaultPrice);
  const [method, setMethod] = useState('transferencia');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const subtotal = Math.round(stamps * unitPrice * 100) / 100;
  const iva = Math.round(subtotal * 0.16 * 100) / 100;
  const total = Math.round((subtotal + iva) * 100) / 100;

  const submit = async () => {
    setError('');
    if (!stamps || stamps < 1) { setError('Captura una cantidad de timbres válida'); return; }
    setBusy(true);
    try {
      const r = await api.adminPrepaidRecharge(company.id, {
        stampsBought: stamps,
        unitPriceMxn: unitPrice,
        paymentMethod: method,
        paymentReference: reference || undefined,
        notes: notes || undefined,
      });
      alert(
        `Recarga aplicada a ${company.rfc}:\n\n` +
        `+${stamps} timbres · Nuevo saldo: ${r.data.balance_after}\n` +
        `Total cobrado: $${fmtMoney(subtotal)} + IVA = $${fmtMoney(total)}`
      );
      onDone();
    } catch (e: any) {
      setError(e.response?.data?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-violet-100 rounded-lg flex items-center justify-center">
              <ShoppingCart className="text-violet-700" size={20}/>
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Recargar timbres prepago</h2>
              <p className="text-xs text-slate-500">{company.business_name} — {company.rfc}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20}/></button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}

          <div className="bg-slate-50 rounded-lg p-3 text-sm flex items-center justify-between">
            <span className="text-slate-600">Saldo actual</span>
            <span className="font-bold text-slate-900">{company.balance} timbres</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 block mb-1">Timbres a agregar</span>
              <input
                type="number" min={1} max={10000} value={stamps}
                onChange={(e) => setStamps(parseInt(e.target.value || '0', 10))}
                className="w-full border border-slate-300 rounded px-3 py-2 text-right font-mono"
              />
              <div className="flex gap-1 mt-1">
                {[30, 60, 90].map((n) => (
                  <button key={n} type="button" onClick={() => setStamps(n)}
                    className={`text-xs px-2 py-0.5 rounded border ${stamps === n ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                    {n}
                  </button>
                ))}
              </div>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 block mb-1">Precio unitario (MXN)</span>
              <input
                type="number" min={0} step="0.01" value={unitPrice}
                onChange={(e) => setUnitPrice(parseFloat(e.target.value || '0'))}
                className="w-full border border-slate-300 rounded px-3 py-2 text-right font-mono"
              />
              <p className="text-[10px] text-slate-400 mt-1">Default ${fmtMoney(defaultPrice)}</p>
            </label>
          </div>

          {/* Desglose */}
          <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-600">{stamps} × ${fmtMoney(unitPrice)}</span>
              <span className="font-mono">$ {fmtMoney(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">IVA 16%</span>
              <span className="font-mono">$ {fmtMoney(iva)}</span>
            </div>
            <div className="flex justify-between font-bold text-violet-900 border-t border-violet-200 pt-1">
              <span>Total a cobrar</span>
              <span className="font-mono">$ {fmtMoney(total)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 block mb-1">Método de pago</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2">
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="otro">Otro</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 block mb-1">Referencia (opcional)</span>
              <input
                value={reference} onChange={(e) => setReference(e.target.value)}
                placeholder="Folio SPEI…"
                className="w-full border border-slate-300 rounded px-3 py-2 font-mono text-xs"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-gray-700 block mb-1">Notas (opcional)</span>
            <input
              value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-gray-200 bg-slate-50">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={submit} disabled={busy || !stamps}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 font-semibold">
            {busy ? <Loader2 size={16} className="animate-spin"/> : <Plus size={16}/>}
            {busy ? 'Aplicando…' : 'Registrar recarga'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Modal histórico de compras ─────────────── */

function PurchasesModal({
  company, onClose,
}: {
  company: any;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ['admin-prepaid-purchases', company.id],
    queryFn: () => api.adminPrepaidPurchases(company.id),
  });
  const purchases = q.data?.data?.purchases || [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div>
            <h2 className="font-bold text-gray-900">Compras prepago</h2>
            <p className="text-sm text-slate-500">{company.business_name} — {company.rfc}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20}/></button>
        </div>
        <div className="p-5">
          {q.isLoading ? (
            <p className="text-slate-500 italic text-center py-6">Cargando…</p>
          ) : purchases.length === 0 ? (
            <p className="text-slate-500 italic text-center py-6">Sin compras registradas.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-right">Timbres</th>
                  <th className="px-3 py-2 text-right">P. unit</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Método</th>
                  <th className="px-3 py-2 text-left">Referencia</th>
                  <th className="px-3 py-2 text-left">Registró</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {purchases.map((p: any) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{fmtDateTime(p.granted_at)}</td>
                    <td className="px-3 py-2 text-right font-bold">+{p.stamps_bought}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">$ {fmtMoney(p.unit_price_mxn)}</td>
                    <td className="px-3 py-2 text-right font-semibold">$ {fmtMoney(p.total_mxn)}</td>
                    <td className="px-3 py-2 text-xs capitalize">{p.payment_method || '—'}</td>
                    <td className="px-3 py-2 text-xs font-mono">{p.payment_reference || '—'}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{p.granted_by_email || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminPrepaidPage;
