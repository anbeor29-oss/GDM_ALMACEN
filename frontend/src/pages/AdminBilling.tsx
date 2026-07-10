/**
 * Super-Admin → Facturación y Consumo
 *
 * Vista principal: tabla del mes en curso por empresa con cap efectivo,
 * consumo, extras y monto estimado. Botón para cerrar el mes anterior
 * manualmente. Modal para ver histórico por empresa. Acción de marcar
 * un cargo como pagado.
 *
 * Referencia: docs/DISENO_FACTURACION_PLANES.md
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DollarSign, Calendar, X, History, CheckCircle,
  AlertTriangle, Loader2, PackageCheck, TrendingUp, Stamp,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

function fmtMoney(n: any) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d: any) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-MX', { year: 'numeric', month: 'long' });
}

export function AdminBillingPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [historyTarget, setHistoryTarget] = useState<any>(null);
  const [closingBusy, setClosingBusy] = useState(false);
  const [closeResult, setCloseResult] = useState<any>(null);

  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 p-6 rounded-lg">
        <p className="font-semibold mb-1">Acceso restringido</p>
        <p className="text-sm">Esta sección requiere rol <b>SUPER_ADMIN</b>. Tu rol: <b>{user?.role}</b>.</p>
      </div>
    );
  }

  const currentQ = useQuery({
    queryKey: ['admin-billing-current'],
    queryFn: () => api.adminBillingCurrentMonth(),
    refetchInterval: 60_000, // refresca cada minuto
  });

  const historyQ = useQuery({
    queryKey: ['admin-billing-history', new Date().getFullYear()],
    queryFn: () => api.adminBillingHistory(new Date().getFullYear()),
  });

  const markPaid = useMutation({
    mutationFn: (id: string) => api.adminBillingMarkPaid(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-billing-history'] });
    },
  });

  const issueInvoice = useMutation({
    mutationFn: (id: string) => api.adminBillingIssueInvoice(id),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['admin-billing-history'] });
      if (r.success) {
        alert(`✅ ${r.message}`);
      } else {
        alert(`⚠ Emisión falló:\n\n${r.message}\n\nEl error quedó registrado; puedes reintentar.`);
      }
    },
    onError: (e: any) => {
      alert('Error al emitir: ' + (e.response?.data?.message || e.message));
    },
  });

  const closeMonth = async () => {
    if (!confirm(
      'Cerrar el mes ANTERIOR:\n\n' +
      '· Calcula rollover para cada empresa.\n' +
      '· Crea las filas de cargo (PENDING) en el histórico.\n' +
      '· Actualiza el rollover del ciclo siguiente.\n' +
      '· EMITE y TIMBRA el CFDI de cobro de cada cargo (dogfooding)\n' +
      '  y lo envía por correo al cliente.\n\n' +
      'Es idempotente. ¿Continuar?'
    )) return;
    setClosingBusy(true);
    setCloseResult(null);
    try {
      const r = await api.adminBillingCloseMonth();
      setCloseResult(r.data);
      qc.invalidateQueries({ queryKey: ['admin-billing-current'] });
      qc.invalidateQueries({ queryKey: ['admin-billing-history'] });
    } catch (e: any) {
      alert('Error al cerrar mes: ' + (e.response?.data?.message || e.message));
    } finally {
      setClosingBusy(false);
    }
  };

  const rows = currentQ.data?.data?.companies || [];
  const history = historyQ.data?.data?.records || [];
  const totalEstimado = rows.reduce((s: number, r: any) => s + Number(r.estimated_total_mxn || 0), 0);
  const totalHistorico = history
    .filter((h: any) => h.status !== 'CANCELLED')
    .reduce((s: number, h: any) => s + Number(h.total_mxn || 0), 0);
  const pendientes = history.filter((h: any) => h.status === 'PENDING' || h.status === 'INVOICED').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <DollarSign className="text-emerald-600" size={36}/> Facturación y Consumo
          </h1>
          <p className="text-gray-600 mt-1">
            Estado del mes en curso, rollover, extras y facturación mensual por empresa.
          </p>
        </div>
        <button
          onClick={closeMonth}
          disabled={closingBusy}
          className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg shadow"
        >
          {closingBusy ? <Loader2 size={18} className="animate-spin"/> : <Calendar size={18}/>}
          {closingBusy ? 'Cerrando…' : 'Cerrar mes anterior'}
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <TrendingUp size={16}/> Facturación estimada del mes
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">$ {fmtMoney(totalEstimado)}</p>
          <p className="text-xs text-slate-500 mt-1">Suma de todas las empresas activas (sin FLEX).</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <PackageCheck size={16}/> Cargos del año en curso
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">$ {fmtMoney(totalHistorico)}</p>
          <p className="text-xs text-slate-500 mt-1">{history.length} cargos generados desde ene.</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <AlertTriangle size={16}/> Cargos pendientes por cobrar
          </div>
          <p className="text-3xl font-bold text-amber-600 mt-2">{pendientes}</p>
          <p className="text-xs text-slate-500 mt-1">Estatus PENDING o INVOICED, sin marcar pagado.</p>
        </div>
      </div>

      {/* Resultado del close-month */}
      {closeResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-emerald-900 flex items-center gap-2">
              <CheckCircle size={18}/> Cierre ejecutado — periodo {closeResult.period}
            </p>
            <button
              onClick={() => setCloseResult(null)}
              className="text-emerald-700 hover:text-emerald-900"
            ><X size={16}/></button>
          </div>
          <p className="text-sm text-emerald-800">
            {closeResult.created} cargos creados ·
            {' '}{closeResult.skipped_flex} empresas FLEX (informativo) ·
            {' '}{closeResult.total_processed} empresas procesadas
            {closeResult.cfdis_issued != null && (
              <>
                {' '}· <b>{closeResult.cfdis_issued} CFDIs emitidos</b>
                {Number(closeResult.cfdis_error) > 0 && (
                  <span className="text-red-700"> · {closeResult.cfdis_error} con error (reintenta por fila)</span>
                )}
              </>
            )}
          </p>
        </div>
      )}

      {/* Tabla del mes en curso */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Mes en curso — consumo actual</h2>
          <span className="text-xs text-slate-500">
            {rows.length} empresas · se refresca cada 60 s
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="px-4 py-2 text-left">RFC</th>
                <th className="px-4 py-2 text-left">Empresa</th>
                <th className="px-4 py-2 text-left">Plan</th>
                <th className="px-4 py-2 text-right">Cap efectivo</th>
                <th className="px-4 py-2 text-right">Usados</th>
                <th className="px-4 py-2 text-right">Extras</th>
                <th className="px-4 py-2 text-right">Estimado</th>
                <th className="px-4 py-2 text-center">%</th>
                <th className="px-4 py-2 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r: any) => {
                const usados = Number(r.used_current_month);
                const cap = Number(r.effective_cap);
                const extras = Math.max(0, usados - cap);
                const isPrepaid = !!r.is_prepaid;
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs">{r.rfc}</td>
                    <td className="px-4 py-2 font-medium">{r.business_name}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold">{r.stamp_package_code}</span>
                        <span className="text-[10px] text-slate-500">
                          {isPrepaid ? `prepago · saldo ${r.prepaid_balance}` : `$ ${fmtMoney(r.monthly_fee_mxn)}/mes`}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isPrepaid ? (
                        <span className="text-slate-400 italic">n/a</span>
                      ) : (
                        <span>
                          <b>{cap}</b>
                          {Number(r.carried_over_stamps) > 0 && (
                            <span className="text-[10px] text-emerald-600 ml-1">
                              (+{r.carried_over_stamps} rollover)
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold">{usados}</td>
                    <td className="px-4 py-2 text-right">
                      {isPrepaid ? <span className="text-slate-400">—</span> :
                        extras > 0 ? <span className="text-orange-600 font-semibold">{extras}</span> : '0'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isPrepaid ? (
                        <span className="text-slate-400 italic text-xs">pagado en recarga</span>
                      ) : (
                        <span className="font-semibold">$ {fmtMoney(r.estimated_total_mxn)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {isPrepaid ? (
                        <span className={`text-xs font-mono ${Number(r.prepaid_balance) <= Number(r.prepaid_low_threshold) ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                          {r.prepaid_balance}/{r.prepaid_low_threshold}
                        </span>
                      ) : (
                        <span className="text-xs">{Number(r.percent_used).toFixed(0)}%</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <button
                        title="Ver histórico de facturación"
                        onClick={() => setHistoryTarget({ id: r.id, rfc: r.rfc, business_name: r.business_name })}
                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"
                      >
                        <History size={16}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
              {currentQ.isLoading && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 italic">Cargando…</td></tr>
              )}
              {!currentQ.isLoading && rows.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500 italic">Sin empresas registradas</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Histórico global del año */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">
            Histórico {new Date().getFullYear()} — facturación mensual
          </h2>
          <span className="text-xs text-slate-500">{history.length} cargos</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs">
              <tr>
                <th className="px-4 py-2 text-left">Período</th>
                <th className="px-4 py-2 text-left">Empresa</th>
                <th className="px-4 py-2 text-left">Plan</th>
                <th className="px-4 py-2 text-right">Usados</th>
                <th className="px-4 py-2 text-right">Extras</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-center">Estado</th>
                <th className="px-4 py-2 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((h: any) => (
                <tr key={h.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 whitespace-nowrap">{fmtDate(h.billing_period)}</td>
                  <td className="px-4 py-2">{h.business_name}</td>
                  <td className="px-4 py-2 text-xs font-mono">{h.package_code}</td>
                  <td className="px-4 py-2 text-right">{h.stamps_used}</td>
                  <td className="px-4 py-2 text-right">
                    {h.stamps_extra > 0 ? <span className="text-orange-600 font-semibold">{h.stamps_extra}</span> : '0'}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold">$ {fmtMoney(h.total_mxn)}</td>
                  <td className="px-4 py-2 text-center">
                    <StatusBadge status={h.status} />
                    {h.invoice_folio && (
                      <span className="block text-[10px] font-mono text-indigo-700 mt-0.5">
                        {h.invoice_folio}
                      </span>
                    )}
                    {h.status === 'ERROR' && h.last_error && (
                      <span
                        className="block text-[10px] text-red-500 mt-0.5 max-w-[160px] truncate mx-auto"
                        title={h.last_error}
                      >
                        {h.last_error}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {(h.status === 'PENDING' || h.status === 'ERROR') && Number(h.total_mxn) > 0 && (
                        <button
                          title={h.status === 'ERROR' ? 'Reintentar emisión del CFDI' : 'Emitir y timbrar CFDI de cobro'}
                          onClick={() => issueInvoice.mutate(h.id)}
                          disabled={issueInvoice.isPending}
                          className="p-1.5 text-violet-600 hover:bg-violet-50 rounded disabled:opacity-50"
                        >
                          {issueInvoice.isPending
                            ? <Loader2 size={16} className="animate-spin"/>
                            : <Stamp size={16}/>}
                        </button>
                      )}
                      {(h.status === 'PENDING' || h.status === 'INVOICED') && (
                        <button
                          title="Marcar como pagado"
                          onClick={() => markPaid.mutate(h.id)}
                          disabled={markPaid.isPending}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded disabled:opacity-50"
                        >
                          <CheckCircle size={16}/>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {historyQ.isLoading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 italic">Cargando…</td></tr>
              )}
              {!historyQ.isLoading && history.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 italic">
                  Aún no hay cargos generados este año. Corre "Cerrar mes anterior" el día 1.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {historyTarget && (
        <CompanyHistoryModal
          company={historyTarget}
          onClose={() => setHistoryTarget(null)}
        />
      )}
    </div>
  );
}

/* ─────────────── Componentes auxiliares ─────────────── */

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    PENDING:   { bg: 'bg-amber-100',   text: 'text-amber-800',   label: 'Pendiente' },
    INVOICED:  { bg: 'bg-blue-100',    text: 'text-blue-800',    label: 'Facturado' },
    PAID:      { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Pagado' },
    CANCELLED: { bg: 'bg-slate-100',   text: 'text-slate-600',   label: 'Cancelado' },
    ERROR:     { bg: 'bg-red-100',     text: 'text-red-800',     label: 'Error' },
  };
  const s = map[status] || { bg: 'bg-slate-100', text: 'text-slate-800', label: status };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function CompanyHistoryModal({
  company, onClose,
}: {
  company: { id: string; rfc: string; business_name: string };
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ['admin-billing-company', company.id],
    queryFn: () => api.adminBillingCompanyHistory(company.id),
  });
  const records = q.data?.data?.records || [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div>
            <h2 className="font-bold text-gray-900">Histórico de facturación</h2>
            <p className="text-sm text-slate-500">{company.business_name} — {company.rfc}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20}/></button>
        </div>
        <div className="p-5">
          {q.isLoading ? (
            <p className="text-slate-500 italic text-center py-6">Cargando…</p>
          ) : records.length === 0 ? (
            <p className="text-slate-500 italic text-center py-6">
              Aún no hay cargos generados para esta empresa.
            </p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">Período</th>
                  <th className="px-3 py-2 text-right">Renta</th>
                  <th className="px-3 py-2 text-right">Extras</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Rollover→</th>
                  <th className="px-3 py-2 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((h: any) => (
                  <tr key={h.id}>
                    <td className="px-3 py-2 whitespace-nowrap font-medium">{fmtDate(h.billing_period)}</td>
                    <td className="px-3 py-2 text-right">$ {fmtMoney(h.monthly_fee_mxn)}</td>
                    <td className="px-3 py-2 text-right">
                      {h.stamps_extra > 0 ? (
                        <span>{h.stamps_extra} × ${fmtMoney(h.extra_charge_mxn / (h.stamps_extra || 1))} = <b>${fmtMoney(h.extra_charge_mxn)}</b></span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-bold">$ {fmtMoney(h.total_mxn)}</td>
                    <td className="px-3 py-2 text-right text-emerald-600 font-mono text-xs">
                      {h.stamps_rolling_to_next}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <StatusBadge status={h.status}/>
                    </td>
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

export default AdminBillingPage;
