/**
 * Reports Page
 * Cobranza, Ventas, Fiscal
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, DollarSign, Receipt, ClipboardList, Download } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import api from '@/services/api';

type Tab = 'collections' | 'receivables' | 'sales' | 'tax';

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('collections');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold text-gray-900">Reportes</h1>
        <p className="text-gray-600 mt-2">Cobranza, ventas y reportes fiscales</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <TabButton
          active={tab === 'collections'}
          onClick={() => setTab('collections')}
          icon={<DollarSign size={18} />}
          label="Cobranza"
        />
        <TabButton
          active={tab === 'receivables'}
          onClick={() => setTab('receivables')}
          icon={<ClipboardList size={18} />}
          label="Cobranza detallada"
        />
        <TabButton
          active={tab === 'sales'}
          onClick={() => setTab('sales')}
          icon={<TrendingUp size={18} />}
          label="Ventas"
        />
        <TabButton
          active={tab === 'tax'}
          onClick={() => setTab('tax')}
          icon={<Receipt size={18} />}
          label="Fiscal"
        />
      </div>

      {tab === 'collections' && <CollectionsReport />}
      {tab === 'receivables' && <ReceivablesReport />}
      {tab === 'sales' && <SalesReport />}
      {tab === 'tax' && <TaxReport />}
    </div>
  );
}

/* ─────────────── Cobranza detallada — facturas con saldo > 0.20 ─────────────── */

function ReceivablesReport() {
  const [customerId, setCustomerId] = useState<string>('');
  const { data: customersResp } = useQuery({
    queryKey: ['customers-for-receivables'],
    queryFn: () => api.getCustomers(1, 500, { sortBy: 'name', sortOrder: 'ASC' }),
  });
  const { data, isLoading } = useQuery({
    queryKey: ['report-receivables', customerId],
    queryFn: () => api.getReceivablesReport(customerId || undefined),
  });

  const report = data?.data;

  const openPDF = () => {
    const url = api.receivablesPDFUrl(customerId || undefined);
    const token = localStorage.getItem('token');
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => window.open(URL.createObjectURL(blob), '_blank'));
  };

  return (
    <div className="space-y-6">
      {/* Filtro + acciones */}
      <div className="bg-white rounded-lg shadow border p-4 flex flex-col md:flex-row gap-3 md:items-end">
        <label className="flex-1">
          <span className="text-xs uppercase tracking-wide text-gray-500">Cliente</span>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="input mt-1"
          >
            <option value="">— Todos los clientes con saldo —</option>
            {(customersResp?.data?.customers || []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.business_name} · {c.rfc}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={openPDF}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow"
        >
          <Download size={16} /> Descargar PDF
        </button>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard label="Total facturado" value={`$${Number(report?.totals?.invoiced || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`} />
        <SummaryCard label="Cobrado (abonos)" value={`$${Number(report?.totals?.paid || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`} />
        <SummaryCard label="Acreditado (NC)" value={`$${Number(report?.totals?.credited || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`} />
        <SummaryCard
          label={`Saldo por cobrar (>$${(report?.threshold ?? 0.20).toFixed(2)})`}
          value={`$${Number(report?.totals?.balance || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`}
          highlight
        />
      </div>

      {/* Detalle por cliente */}
      {isLoading && <LoadingState />}
      {!isLoading && (report?.customers?.length === 0) && (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No hay facturas con saldo pendiente mayor a ${(report?.threshold ?? 0.20).toFixed(2)}.
        </div>
      )}
      {!isLoading && (report?.customers || []).map((c: any) => (
        <div key={c.id} className="bg-white rounded-lg shadow overflow-hidden">
          <div className="bg-blue-50 border-b border-blue-100 px-5 py-3 flex items-center justify-between">
            <div>
              <p className="font-bold text-blue-900 uppercase">{c.business_name}</p>
              <p className="text-xs text-gray-500 font-mono">{c.rfc} · {c.invoice_count} factura(s)</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 uppercase">Saldo del cliente</p>
              <p className="text-xl font-bold text-red-600">
                ${Number(c.balance).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Folio</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Fecha</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Total</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Abonado</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Notas Cr.</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {c.invoices.map((inv: any) => (
                <>
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-semibold">
                      {inv.serie ? `${inv.serie}-${inv.folio}` : inv.folio}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {new Date(inv.date_issued).toLocaleDateString('es-MX')}
                    </td>
                    <td className="px-4 py-2 text-right">${Number(inv.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-2 text-right text-green-700">${Number(inv.paid).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-2 text-right text-amber-700">${Number(inv.credited).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-2 text-right font-bold text-red-600">
                      ${Number(inv.balance).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                  {inv.payments.map((p: any) => (
                    <tr key={p.id} className="text-xs text-gray-500 bg-gray-50">
                      <td className="pl-10 py-1 italic" colSpan={3}>↳ Abono {p.folio || ''} · {new Date(p.date).toLocaleDateString('es-MX')}</td>
                      <td className="py-1 text-right text-green-700">−${Number(p.amount).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                      <td colSpan={2}></td>
                    </tr>
                  ))}
                  {inv.credit_notes.map((n: any) => (
                    <tr key={n.id} className="text-xs text-gray-500 bg-gray-50">
                      <td className="pl-10 py-1 italic" colSpan={4}>↳ NC {n.folio || ''} · {new Date(n.date).toLocaleDateString('es-MX')}</td>
                      <td className="py-1 text-right text-amber-700">−${Number(n.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                      <td></td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
        active
          ? 'border-blue-600 text-blue-600 font-semibold'
          : 'border-transparent text-gray-600 hover:text-gray-900'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function CollectionsReport() {
  const { data, isLoading } = useQuery({
    queryKey: ['report-collections'],
    queryFn: () => api.getCollectionsReport(),
  });

  if (isLoading) return <LoadingState />;

  const report = data?.data;

  return (
    <div className="space-y-6">
      {/* Total pendiente */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-gray-600 text-sm font-medium mb-2">Total por Cobrar</h3>
        <p className="text-4xl font-bold text-red-600">
          ${Number(report?.total_pending || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
        </p>
        <p className="text-sm text-gray-500 mt-1">
          {report?.customers_with_balance || 0} clientes con saldo pendiente
        </p>
      </div>

      {/* Antigüedad de saldos */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Antigüedad de Saldos</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {report?.aging?.map((bucket: any) => (
            <div key={bucket.bucket} className="border border-gray-200 rounded-lg p-4">
              <p className="text-sm text-gray-600">{bucket.bucket} días</p>
              <p className="text-2xl font-bold text-gray-900">
                ${Number(bucket.amount).toLocaleString('es-MX')}
              </p>
              <p className="text-xs text-gray-500">{bucket.invoice_count} facturas</p>
            </div>
          ))}
        </div>
      </div>

      {/* Clientes con saldo */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <h3 className="text-lg font-bold text-gray-900 p-6 pb-0">Clientes con Saldo</h3>
        <table className="w-full mt-4">
          <thead className="bg-gray-50 border-y border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Cliente</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">RFC</th>
              <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Facturas</th>
              <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {report?.customers?.map((c: any) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-sm font-medium text-gray-900">{c.business_name}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{c.rfc}</td>
                <td className="px-6 py-4 text-sm text-gray-600 text-right">{c.pending_invoices}</td>
                <td className="px-6 py-4 text-sm font-semibold text-red-600 text-right">
                  ${Number(c.pending_amount).toLocaleString('es-MX')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SalesReport() {
  const { data, isLoading } = useQuery({
    queryKey: ['report-sales'],
    queryFn: () => api.getSalesReport(),
  });

  if (isLoading) return <LoadingState />;

  const report = data?.data;
  const chartData =
    report?.monthly?.map((m: any) => ({
      name: m.month,
      amount: Number(m.amount),
    })).reverse() || [];

  return (
    <div className="space-y-6">
      {/* Resumen */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard label="Facturas" value={report?.summary?.total_invoices || 0} />
        <SummaryCard
          label="Subtotal"
          value={`$${Number(report?.summary?.total_subtotal || 0).toLocaleString('es-MX')}`}
        />
        <SummaryCard
          label="Impuestos"
          value={`$${Number(report?.summary?.total_tax || 0).toLocaleString('es-MX')}`}
        />
        <SummaryCard
          label="Total"
          value={`$${Number(report?.summary?.total_amount || 0).toLocaleString('es-MX')}`}
          highlight
        />
      </div>

      {/* Gráfico mensual */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Ventas por Mes</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip formatter={(v: number) => `$${v.toLocaleString('es-MX')}`} />
            <Bar dataKey="amount" fill="#3B82F6" name="Ventas" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Top clientes */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <h3 className="text-lg font-bold text-gray-900 p-6 pb-0">Top 10 Clientes</h3>
        <table className="w-full mt-4">
          <thead className="bg-gray-50 border-y border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Cliente</th>
              <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Facturas</th>
              <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {report?.top_customers?.map((c: any, idx: number) => (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-sm font-medium text-gray-900">{c.business_name}</td>
                <td className="px-6 py-4 text-sm text-gray-600 text-right">{c.invoice_count}</td>
                <td className="px-6 py-4 text-sm font-semibold text-green-600 text-right">
                  ${Number(c.total_amount).toLocaleString('es-MX')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TaxReport() {
  const { data, isLoading } = useQuery({
    queryKey: ['report-tax'],
    queryFn: () => api.getTaxReport(),
  });

  if (isLoading) return <LoadingState />;

  const report = data?.data;
  const s = report?.summary;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          label="Base Gravable"
          value={`$${Number(s?.base_gravable || 0).toLocaleString('es-MX')}`}
        />
        <SummaryCard
          label="IVA Trasladado"
          value={`$${Number(s?.iva_trasladado || 0).toLocaleString('es-MX')}`}
          highlight
        />
        <SummaryCard
          label="IVA Retenido"
          value={`$${Number(s?.iva_retenido || 0).toLocaleString('es-MX')}`}
        />
      </div>

      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <h3 className="text-lg font-bold text-gray-900 p-6 pb-0">Desglose Mensual</h3>
        <table className="w-full mt-4">
          <thead className="bg-gray-50 border-y border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Mes</th>
              <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Base</th>
              <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">IVA Trasladado</th>
              <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">IVA Retenido</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {report?.monthly?.map((m: any, idx: number) => (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-sm font-medium text-gray-900">{m.month}</td>
                <td className="px-6 py-4 text-sm text-gray-600 text-right">
                  ${Number(m.base).toLocaleString('es-MX')}
                </td>
                <td className="px-6 py-4 text-sm text-blue-600 text-right">
                  ${Number(m.iva_trasladado).toLocaleString('es-MX')}
                </td>
                <td className="px-6 py-4 text-sm text-gray-600 text-right">
                  ${Number(m.iva_retenido).toLocaleString('es-MX')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg shadow-lg p-6 ${highlight ? 'bg-blue-600 text-white' : 'bg-white'}`}>
      <h3 className={`text-sm font-medium mb-2 ${highlight ? 'text-blue-100' : 'text-gray-600'}`}>
        {label}
      </h3>
      <p className={`text-2xl font-bold ${highlight ? 'text-white' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="bg-white rounded-lg shadow-lg p-12 text-center text-gray-600">Cargando reporte...</div>
  );
}
