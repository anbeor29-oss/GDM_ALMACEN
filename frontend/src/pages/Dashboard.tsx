/**
 * Dashboard — KPIs reales calculados desde la BD.
 *  · Facturas timbradas (sin DRAFT/CANCELLED)
 *  · Total facturado, cobrado, acreditado por NC, saldo por cobrar
 *  · Listado de facturas recientes con saldo remanente real (no total)
 *  · Clientes con su saldo agregado
 */

import { useQuery } from '@tanstack/react-query';
import { FileText, Wallet, TrendingDown, AlertCircle, Stamp, Boxes } from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import api from '@/services/api';

function fmt(n: any) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function DashboardPage() {
  const { data: summary } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => api.getDashboardSummary(),
    refetchOnWindowFocus: true,
  });

  const { data: invoicesData } = useQuery({
    queryKey: ['invoices', 1],
    queryFn: () => api.getInvoices(1, 6),
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers', 1],
    queryFn: () => api.getCustomers(1, 6),
  });

  const { data: usage } = useQuery({
    queryKey: ['monthly-usage'],
    queryFn: () => api.getMonthlyUsage(),
    refetchOnWindowFocus: true,
  });

  const { data: invValue } = useQuery({
    queryKey: ['inventory-value'],
    queryFn: () => api.getInventoryValue(),
    refetchOnWindowFocus: true,
  });

  const { data: invHistory } = useQuery({
    queryKey: ['inventory-value-history'],
    queryFn: () => api.getInventoryValueHistory(12),
  });

  const s = summary?.data || {};
  const u = usage?.data;
  const inv = invValue?.data;
  const histRows: any[] = invHistory?.data?.history || [];
  const chartData = histRows.map((h) => ({
    mes: new Date(h.snapshot_month).toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }),
    valor: Number(h.total_value),
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-2">Resumen de tu cartera al día de hoy</p>
      </div>

      {/* KPIs reales (Ingresos timbrados, no borradores ni cancelados) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          icon={<FileText size={24} />}
          title="Facturas emitidas"
          value={s.facturas ?? 0}
          color="indigo"
        />
        <MetricCard
          icon={<TrendingDown size={24} />}
          title="Total facturado"
          value={`$ ${fmt(s.total_facturado)}`}
          color="sky"
        />
        <MetricCard
          icon={<Wallet size={24} />}
          title="Cobrado + NC"
          value={`$ ${fmt(Number(s.total_cobrado || 0) + Number(s.total_acreditado || 0))}`}
          color="emerald"
          hint={`Pagos $ ${fmt(s.total_cobrado)} · NC $ ${fmt(s.total_acreditado)}`}
        />
        <MetricCard
          icon={<AlertCircle size={24} />}
          title="Saldo por cobrar"
          value={`$ ${fmt(s.saldo_por_cobrar)}`}
          color="amber"
          hint={`${s.facturas_con_saldo ?? 0} facturas con saldo pendiente`}
        />
      </div>

      {/* Consumo de timbres del mes — relevante para plan iguala (100 timbres) */}
      {u && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 p-2 rounded-lg">
                <Stamp size={20} />
              </div>
              <div>
                <h3 className="text-gray-900 font-semibold">Timbres del mes</h3>
                <p className="text-xs text-gray-500">Periodo {u.period} · plan iguala</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">
                {u.usage.total}<span className="text-base text-gray-400"> / {u.plan.cap_timbres}</span>
              </p>
              <p className={`text-xs font-medium ${u.plan.over ? 'text-rose-700' : 'text-emerald-700'}`}>
                {u.plan.over ? `+${u.usage.total - u.plan.cap_timbres} excedente` : `${u.plan.remaining} disponibles`}
              </p>
            </div>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className={`h-2 ${u.plan.over ? 'bg-rose-500' : u.plan.consumed_pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, u.plan.consumed_pct)}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-xs text-gray-500">
            <span>Facturas: <b className="text-gray-800">{u.usage.facturas}</b></span>
            <span>NC: <b className="text-gray-800">{u.usage.notas_credito}</b></span>
            <span>Pagos: <b className="text-gray-800">{u.usage.pagos}</b></span>
          </div>
        </div>
      )}

      {/* Valor del inventario — actual + histórico mensual (snapshots) */}
      {inv && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="bg-fuchsia-50 text-fuchsia-600 ring-1 ring-fuchsia-100 p-2 rounded-lg">
                <Boxes size={20} />
              </div>
              <div>
                <h3 className="text-gray-900 font-semibold">Valor del inventario</h3>
                <p className="text-xs text-gray-500">
                  {inv.consolidated.productsCount} productos con existencia ·{' '}
                  {Number(inv.consolidated.totalUnits).toLocaleString('es-MX')} unidades
                </p>
              </div>
            </div>
            <p className="text-3xl font-bold text-gray-900">$ {fmt(inv.consolidated.totalValue)}</p>
          </div>

          {/* Desglose por almacén */}
          {inv.warehouses.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {inv.warehouses.map((w: any) => (
                <div key={w.warehouse_id} className="border border-gray-200 rounded-lg p-3">
                  <p className="text-xs font-mono text-sky-700">{w.code}</p>
                  <p className="text-sm text-gray-600 truncate">{w.name}</p>
                  <p className="font-semibold text-gray-900">$ {fmt(w.total_value)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Histórico mes a mes */}
          {chartData.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
                  <defs>
                    <linearGradient id="invValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} width={55} />
                  <Tooltip formatter={(v: any) => [`$ ${fmt(v)}`, 'Valuación']} />
                  <Area type="monotone" dataKey="valor" stroke="#3B82F6" strokeWidth={2}
                    fill="url(#invValue)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-gray-500 italic">
              El histórico mensual se llena con el snapshot automático del día 1 (o manual desde
              Inventario → Reportes).
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Facturas recientes con saldo real */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Facturas recientes</h2>
          <div className="space-y-3">
            {(invoicesData?.data?.invoices || []).slice(0, 6).map((invoice: any) => {
              const bal = Number(invoice.balance ?? invoice.total);
              const settled = bal <= 0.01;
              return (
                <div key={invoice.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{invoice.serie}-{invoice.folio}</p>
                    <p className="text-sm text-gray-600 truncate">{invoice.customer_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">$ {fmt(invoice.total)}</p>
                    <p className={`text-xs font-semibold ${settled ? 'text-emerald-700' : 'text-amber-700'}`}>
                      saldo $ {fmt(bal)}
                    </p>
                  </div>
                </div>
              );
            })}
            {(!invoicesData?.data?.invoices || invoicesData.data.invoices.length === 0) && (
              <p className="text-sm text-gray-500 italic">No hay facturas todavía.</p>
            )}
          </div>
        </div>

        {/* Clientes recientes */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Clientes recientes</h2>
          <div className="space-y-3">
            {(customersData?.data?.customers || []).slice(0, 6).map((customer: any) => (
              <div key={customer.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{customer.business_name}</p>
                  <p className="text-sm text-gray-600 font-mono">{customer.rfc}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 uppercase">Saldo</p>
                  <p className="font-semibold text-gray-900">$ {fmt(customer.balance)}</p>
                </div>
              </div>
            ))}
            {(!customersData?.data?.customers || customersData.data.customers.length === 0) && (
              <p className="text-sm text-gray-500 italic">No hay clientes registrados.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  color: 'indigo' | 'sky' | 'emerald' | 'amber';
  hint?: string;
}

function MetricCard({ icon, title, value, color, hint }: MetricCardProps) {
  const palette = {
    indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600',  ring: 'ring-indigo-100' },
    sky:     { bg: 'bg-sky-50',     text: 'text-sky-600',     ring: 'ring-sky-100' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   ring: 'ring-amber-100' },
  }[color];
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className={`${palette.bg} ${palette.text} ${palette.ring} ring-1 p-3 rounded-lg w-fit mb-4`}>
        {icon}
      </div>
      <h3 className="text-gray-600 text-sm font-medium mb-1">{title}</h3>
      <p className="text-3xl font-bold text-gray-900 truncate">{value}</p>
      {hint && <p className="text-xs text-gray-500 mt-2">{hint}</p>}
    </div>
  );
}
