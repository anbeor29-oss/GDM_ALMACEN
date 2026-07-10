/**
 * Invoices Page — listado, descarga PDF/XML, vista previa, timbrado y cancelación.
 *
 * Acciones por fila:
 *  📄 rojo   → descargar PDF
 *  ⬇ verde   → descargar XML
 *  🔍 azul   → vista previa del PDF en modal
 *  🛡 morado → timbrar (requiere CSD del emisor cargado)
 *  ✕ rojo    → cancelar (motivos Anexo 20 del SAT)
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Download, FileDown, CheckCircle, Eye, Stamp, X, Ban, Loader2, Wallet, Coins, History,
  Mail, Send, FileText, FileMinus2, Pencil,
} from 'lucide-react';
import api from '@/services/api';
import { Invoice } from '@/types';

/* ───────────── Helpers de estado (español) ───────────── */

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Capturada',
  READY: 'Lista',
  STAMPED: 'Timbrada',
  SENT: 'Enviada',
  PAID: 'Pagada',
  RECEIVED: 'Recibida',
  PARTIAL_PAYMENT: 'Pago parcial',
  CANCELLED: 'Cancelada',
};

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  DRAFT:           { bg: 'bg-gray-100',    text: 'text-gray-800' },
  READY:           { bg: 'bg-yellow-100',  text: 'text-yellow-800' },
  STAMPED:         { bg: 'bg-blue-100',    text: 'text-blue-800' },
  SENT:            { bg: 'bg-purple-100',  text: 'text-purple-800' },
  PAID:            { bg: 'bg-green-100',   text: 'text-green-800' },
  RECEIVED:        { bg: 'bg-indigo-100',  text: 'text-indigo-800' },
  PARTIAL_PAYMENT: { bg: 'bg-amber-100',   text: 'text-amber-800' },
  CANCELLED:       { bg: 'bg-red-100',     text: 'text-red-800' },
};

/* ───────────── Motivos de cancelación (Anexo 20, c_MotivoCancelacion) ───────────── */

const CANCEL_REASONS: Array<{ key: string; label: string; needsUUID: boolean }> = [
  { key: '01', label: '01 — Comprobante emitido con errores con relación (sustitución)', needsUUID: true  },
  { key: '02', label: '02 — Comprobante emitido con errores sin relación',                needsUUID: false },
  { key: '03', label: '03 — No se llevó a cabo la operación',                              needsUUID: false },
  { key: '04', label: '04 — Operación nominativa relacionada en una factura global',      needsUUID: false },
];

/* ─────────────────────────────────────────────── */

export function InvoicesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [stampingId, setStampingId] = useState<string | null>(null);

  // estado de modales
  const [previewBlob, setPreviewBlob] = useState<{ url: string; filename: string } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Invoice | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<Invoice | null>(null);
  const [balanceTarget, setBalanceTarget] = useState<Invoice | null>(null);
  const [timbresTarget, setTimbresTarget] = useState<Invoice | null>(null);

  const { data: invoicesData, isLoading } = useQuery({
    queryKey: ['invoices', page],
    queryFn: () => api.getInvoices(page, 10),
  });

  /* ───────────── PDF ───────────── */

  const handleDownloadPDF = async (invoice: Invoice) => {
    try {
      const blob = await api.generatePDF(invoice.id);
      const fname = `factura-${invoice.serie}-${String(invoice.folio).padStart(6, '0')}.pdf`;
      api.downloadFile(blob, fname);
    } catch (e: any) {
      console.error(e);
      alert(`No se pudo generar el PDF.\n\n${e.response?.data?.message || e.message}`);
    }
  };

  const handlePreviewPDF = async (invoice: Invoice) => {
    try {
      const blob = await api.previewPDF(invoice.id);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      const fname = `factura-${invoice.serie}-${String(invoice.folio).padStart(6, '0')}.pdf`;
      setPreviewBlob({ url, filename: fname });
    } catch (e: any) {
      console.error(e);
      alert(`No se pudo generar la vista previa.\n\n${e.response?.data?.message || e.message}`);
    }
  };

  /* ───────────── XML ───────────── */

  const handleDownloadXML = async (invoice: Invoice) => {
    try {
      const blob = await api.getCFDIXML(invoice.id);
      const fname = `factura-${invoice.serie}-${String(invoice.folio).padStart(6, '0')}.xml`;
      api.downloadFile(blob, fname);
    } catch (e: any) {
      alert(`No se pudo descargar el XML.\nQuizá la factura todavía no tiene XML generado (aún está como Capturada).\n\n${e.response?.data?.message || e.message}`);
    }
  };

  /* ───────────── Timbrado (con validación de CSD) ───────────── */

  const handleStamp = async (invoice: Invoice) => {
    setStampingId(invoice.id);
    try {
      const result = await api.stampInvoice(invoice.id);
      const isMock = result.data?.is_mock !== false && result.data?.provider === 'MOCK';
      alert(
        isMock
          ? (`✅ Factura timbrada (MODO SIMULACIÓN)\n\n` +
             `UUID asignado: ${result.data.uuid}\n` +
             `Sello del SAT generado a partir del CSD del emisor.\n\n` +
             `⚠ Estamos usando un PAC MOCK. Cuando se conecte un PAC real, ` +
             `este mismo CSD se usará para el sello digital real.`)
          : (`✅ Factura timbrada con ${result.data.provider}\n\n` +
             `UUID SAT: ${result.data.uuid}\n` +
             `Fecha timbrado: ${result.data.fecha_timbrado || ''}\n\n` +
             `El XML y PDF ya contienen el sello real del SAT.`)
      );
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    } catch (e: any) {
      alert(`No se pudo timbrar.\n\n${e.response?.data?.message || e.message}`);
    } finally {
      setStampingId(null);
    }
  };

  /* ───────────── Cancelación ───────────── */

  const onCancelDone = () => {
    setCancelTarget(null);
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
  };

  /* ───────────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900">Facturas</h1>
          <p className="text-gray-600 mt-2">Gestiona tus facturas electrónicas</p>
        </div>
        <button
          onClick={() => navigate('/invoices/new')}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors"
        >
          <Plus size={20} />
          Nueva Factura
        </button>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Folio</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Cliente</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Fecha</th>
              <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Total</th>
              <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Saldo</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Estado</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {isLoading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-600">Cargando…</td></tr>
            ) : invoicesData?.data?.invoices?.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-600">No hay facturas</td></tr>
            ) : (
              invoicesData?.data?.invoices?.map((invoice: Invoice) => {
                const canStamp  = !invoice.is_stamped && invoice.status !== 'CANCELLED' && invoice.status !== 'STAMPED';
                // canCancel abarca 2 escenarios:
                //   1. Factura viva → cancelar por primera vez (envía al PAC).
                //   2. Factura CANCELLED localmente pero pac_id=SW_SAPIEN → resend al PAC
                //      (para sincronizar cuando el bypass local se usó antes).
                const isResendable =
                  invoice.status === 'CANCELLED' &&
                  (invoice as any).pac_id === 'SW_SAPIEN';
                const canCancel = invoice.status !== 'CANCELLED' || isResendable;
                // Editar: solo antes de timbrar. Una vez timbrada la factura es
                // inmutable (regla SAT). El backend rechaza el PUT en no-DRAFT.
                const canEdit = !invoice.is_stamped && invoice.status === 'DRAFT';
                // Saldo real (total − pagos − NC). Si llega como 0 la factura ya está liquidada.
                const saldoReal = Number((invoice as any).balance ?? invoice.total);
                const liquidada = saldoReal <= 0.01;
                // Pago aplica solo si: está timbrada, no cancelada, no DRAFT y TIENE SALDO PENDIENTE.
                // Si una PARTIAL_PAYMENT quedó en saldo 0 por combinación pagos+NC, no debe
                // permitir más complementos (no hay nada que cobrar).
                const canPay = invoice.is_stamped &&
                  !['PAID', 'CANCELLED', 'DRAFT'].includes(invoice.status) &&
                  !liquidada;
                return (
                  <tr key={invoice.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {invoice.serie}-{String(invoice.folio).padStart(6, '0')}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{invoice.customer_name}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(invoice.date_issued).toLocaleDateString('es-MX')}
                    </td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900 text-right">
                      $ {Number(invoice.total).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-sm text-right">
                      {(() => {
                        const bal = Number((invoice as any).balance ?? invoice.total);
                        const paid = Number((invoice as any).paid_total || 0);
                        const cred = Number((invoice as any).credited_total || 0);
                        const isSettled = bal <= 0.01;
                        return (
                          <div>
                            <span className={`font-bold ${isSettled ? 'text-emerald-700' : 'text-amber-700'}`}>
                              $ {bal.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            {(paid > 0 || cred > 0) && (
                              <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">
                                {paid > 0 && <>pagado ${paid.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</>}
                                {paid > 0 && cred > 0 && ' · '}
                                {cred > 0 && <>NC ${cred.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</>}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={invoice.status} />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <IconBtn color="red"    title="Descargar PDF"     onClick={() => handleDownloadPDF(invoice)}><FileDown size={18} /></IconBtn>
                        <IconBtn color="green"  title="Descargar XML"     onClick={() => handleDownloadXML(invoice)}><Download size={18} /></IconBtn>
                        <IconBtn color="blue"   title="Vista previa"      onClick={() => handlePreviewPDF(invoice)}><Eye size={18} /></IconBtn>
                        {canEdit && (
                          <IconBtn color="sky" title="Editar factura (solo DRAFT)"
                            onClick={() => navigate(`/invoices/${invoice.id}/edit`)}>
                            <Pencil size={18} />
                          </IconBtn>
                        )}
                        {canStamp && (
                          <IconBtn color="purple" title="Timbrar con CSD del emisor"
                            disabled={stampingId === invoice.id}
                            onClick={() => handleStamp(invoice)}>
                            {stampingId === invoice.id ? <Loader2 size={18} className="animate-spin" /> : <Stamp size={18} />}
                          </IconBtn>
                        )}
                        {canPay && (
                          <IconBtn color="green" title="Timbrar Complemento de Pago"
                            onClick={() => setPaymentTarget(invoice)}>
                            <Wallet size={18} />
                          </IconBtn>
                        )}
                        {(['PARTIAL_PAYMENT', 'PAID'] as string[]).includes(invoice.status) && (
                          <IconBtn color="amber" title="Ver abonos, notas de crédito y saldo"
                            onClick={() => setBalanceTarget(invoice)}>
                            <Coins size={18} />
                          </IconBtn>
                        )}
                        {invoice.is_stamped && (
                          <IconBtn color="indigo" title="Historia de timbres (Factura, NC, Pagos)"
                            onClick={() => setTimbresTarget(invoice)}>
                            <History size={18} />
                          </IconBtn>
                        )}
                        {canCancel && (
                          <IconBtn
                            color="orange"
                            title={isResendable
                              ? 'Reintentar cancelación en el PAC (aún vigente en SW)'
                              : 'Cancelar factura'}
                            onClick={() => setCancelTarget(invoice)}>
                            <Ban size={18} />
                          </IconBtn>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {invoicesData?.data?.pagination && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">Página {page} de {invoicesData.data.pagination.totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={!invoicesData.data.pagination.hasPrev}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Anterior</button>
            <button onClick={() => setPage(page + 1)} disabled={!invoicesData.data.pagination.hasNext}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Siguiente</button>
          </div>
        </div>
      )}

      {previewBlob && (
        <PreviewModal url={previewBlob.url} filename={previewBlob.filename}
          onClose={() => {
            URL.revokeObjectURL(previewBlob.url);
            setPreviewBlob(null);
          }}
        />
      )}

      {cancelTarget && (
        <CancelModal invoice={cancelTarget} onClose={() => setCancelTarget(null)} onDone={onCancelDone} />
      )}

      {balanceTarget && (
        <BalanceModal invoice={balanceTarget} onClose={() => setBalanceTarget(null)} />
      )}

      {timbresTarget && (
        <TimbresModal invoice={timbresTarget} onClose={() => setTimbresTarget(null)} />
      )}

      {paymentTarget && (
        <PaymentModal
          invoice={paymentTarget}
          onClose={() => setPaymentTarget(null)}
          onDone={() => {
            setPaymentTarget(null);
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({ queryKey: ['invoice-balance'] });
          }}
        />
      )}
    </div>
  );
}

/* ───────────── Modal de Complemento de Pago ───────────── */

function PaymentModal({
  invoice, onClose, onDone,
}: {
  invoice: Invoice;
  onClose: () => void;
  onDone: () => void;
}) {
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [paymentForm, setPaymentForm] = useState('03');
  const [paymentMethod, setPaymentMethod] = useState('PUE');
  const [amount, setAmount] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const formasPago = useQuery({
    queryKey: ['catalog', 'formapago'],
    queryFn: () => api.getCatalog('formapago'),
    staleTime: Infinity,
  });

  // Saldo REAL desde el endpoint que ya considera pagos + notas de crédito.
  // (Antes leíamos solo pagos previos y el restante quedaba inflado por no
  // descontar las NC aplicadas a la factura.)
  const balance = useQuery({
    queryKey: ['invoice-balance', invoice.id],
    queryFn: () => api.getInvoiceBalance(invoice.id),
  });

  const totals = balance.data?.data?.totals;
  const pagado    = Number(totals?.paid || 0);
  const acreditado = Number(totals?.credited || 0);
  const restante  = Number(totals?.remaining ?? invoice.total);

  // Cuando llega el balance real, precargamos el campo "monto" con el saldo
  useEffect(() => {
    if (totals && amount === 0) setAmount(restante);
  }, [totals]);

  const submit = async () => {
    setError('');
    if (amount <= 0) { setError('Captura un monto mayor que 0'); return; }
    if (amount > restante + 0.01) {
      setError(`El monto excede el saldo restante ($${restante.toFixed(2)})`);
      return;
    }
    setBusy(true);
    try {
      const res = await api.createPayment({
        invoiceId: invoice.id,
        paymentAmount: amount,
        paymentDate: new Date(paymentDate).toISOString(),
        paymentForm,
        paymentMethod,
      });
      alert(
        `✅ Complemento de Pago timbrado (MODO SIMULACIÓN)\n\n` +
        `UUID: ${res.data?.payment?.uuid}\n` +
        `Nuevo estatus de la factura: ${res.data?.invoice?.new_status}\n` +
        `Saldo restante: $${(res.data?.invoice?.remaining || 0).toFixed(2)}\n\n` +
        `⚠ PAC real pendiente.`
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
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
              <Wallet className="text-emerald-700" size={20} />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Complemento de Pago</h2>
              <p className="text-xs text-gray-500">
                Factura {invoice.serie}-{String(invoice.folio).padStart(6, '0')} — CFDI tipo P
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>
          )}

          <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-600">Total factura:</span>
              <span className="font-semibold">$ {Number(invoice.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Pagos previos:</span>
              <span>− $ {pagado.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Notas de crédito aplicadas:</span>
              <span className="text-rose-700">− $ {acreditado.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-base font-bold pt-1 border-t border-gray-300">
              <span>Saldo restante:</span>
              <span className="text-emerald-700">$ {restante.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
            </div>
            {balance.isLoading && <p className="text-xs text-gray-400 italic">cargando saldo…</p>}
          </div>

          <label className="block">
            <span className="text-sm font-medium text-gray-700 block mb-1">Fecha del pago</span>
            <input type="datetime-local" value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)} className="input" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-gray-700 block mb-1">Forma de pago (c_FormaPago)</span>
              <select value={paymentForm} onChange={(e) => setPaymentForm(e.target.value)} className="input">
                {(formasPago.data?.data?.entries || [
                  { catalog_key: '03', description: 'Transferencia electrónica' },
                  { catalog_key: '01', description: 'Efectivo' },
                ]).map((f: any) => (
                  <option key={f.catalog_key} value={f.catalog_key}>{f.catalog_key} — {f.description}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700 block mb-1">Método</span>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="input">
                <option value="PUE">PUE — Una exhibición</option>
                <option value="PPD">PPD — Parcial / diferido</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-gray-700 block mb-1">
              Monto del pago (MXN)
            </span>
            <div className="flex gap-2">
              <input type="number" min={0.01} step="0.01" max={restante}
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                className="input flex-1 text-right" />
              <button type="button" onClick={() => setAmount(restante)}
                className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">
                Pago total
              </button>
            </div>
            <span className="text-xs text-gray-500 block mt-1">
              {amount >= restante ? '→ Marca la factura como Pagada' : '→ Marca la factura como Pago parcial'}
            </span>
          </label>

          <div className="bg-blue-50 border border-blue-200 text-blue-800 px-3 py-2 rounded text-xs">
            <b>Anexo 20:</b> el Complemento de Pago se emite cuando el método es PPD o cuando una factura PUE
            se cobra parcialmente. Plazo: a más tardar el 5° día natural del mes siguiente al pago.
          </div>
        </div>

        <div className="flex gap-3 p-5 border-t border-gray-200">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={submit} disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg">
            <Wallet size={16} />
            {busy ? 'Timbrando…' : 'Timbrar Pago'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────── helpers UI ───────────── */

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLOR[status] || STATUS_COLOR.DRAFT;
  const label = STATUS_LABEL[status] || status;
  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${c.bg} ${c.text}`}>
      {status === 'PAID' && <CheckCircle size={14} />}
      {label}
    </span>
  );
}

function IconBtn({
  color, title, onClick, disabled, children,
}: {
  color: 'red' | 'green' | 'blue' | 'purple' | 'orange' | 'amber' | 'indigo' | 'sky';
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    red: 'text-red-600 hover:bg-red-50',
    green: 'text-green-600 hover:bg-green-50',
    blue: 'text-blue-600 hover:bg-blue-50',
    purple: 'text-purple-600 hover:bg-purple-50',
    orange: 'text-orange-600 hover:bg-orange-50',
    amber: 'text-amber-600 hover:bg-amber-50',
    indigo: 'text-indigo-600 hover:bg-indigo-50',
    sky: 'text-sky-600 hover:bg-sky-50',
  };
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${colors[color]}`}
    >
      {children}
    </button>
  );
}

/* ───────────── Detalle de saldo (abonos + NC + remanente) ───────────── */

function BalanceModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const [showMail, setShowMail] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['invoice-balance', invoice.id],
    queryFn: () => api.getInvoiceBalance(invoice.id),
  });

  const fmt = (n: any) =>
    Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const d = data?.data;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
              <Coins className="text-amber-700" size={20} />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">
                Saldo de {invoice.serie}-{String(invoice.folio).padStart(6, '0')}
              </h2>
              <p className="text-xs text-gray-500">Pagos parciales + Notas de crédito aplicadas</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        {isLoading || !d ? (
          <div className="p-8 text-center text-gray-500">Cargando…</div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Total"      value={`$ ${fmt(d.totals.total)}`}      tone="slate" />
              <Stat label="Pagado"     value={`$ ${fmt(d.totals.paid)}`}       tone="emerald" />
              <Stat label="NC aplicadas" value={`$ ${fmt(d.totals.credited)}`} tone="rose" />
              <Stat label="Saldo"      value={`$ ${fmt(d.totals.remaining)}`}  tone={d.totals.remaining <= 0.01 ? 'emerald' : 'amber'} />
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Abonos ({d.counts.payments})
              </h3>
              {d.payments.length === 0 ? (
                <p className="text-sm text-gray-500 italic">Sin pagos registrados.</p>
              ) : (
                <table className="w-full text-sm border border-gray-200 rounded">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left">Fecha</th>
                      <th className="px-3 py-2 text-left">Forma</th>
                      <th className="px-3 py-2 text-left">Ref.</th>
                      <th className="px-3 py-2 text-right">Importe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {d.payments.map((p: any) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2">{new Date(p.payment_date).toLocaleDateString('es-MX')}</td>
                        <td className="px-3 py-2">{p.payment_form || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{p.reference || '—'}</td>
                        <td className="px-3 py-2 text-right font-semibold">$ {fmt(p.payment_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                Notas de crédito ({d.counts.creditNotes})
              </h3>
              {d.creditNotes.length === 0 ? (
                <p className="text-sm text-gray-500 italic">Sin NC aplicadas.</p>
              ) : (
                <table className="w-full text-sm border border-gray-200 rounded">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left">Folio NC</th>
                      <th className="px-3 py-2 text-left">Fecha</th>
                      <th className="px-3 py-2 text-left">Motivo</th>
                      <th className="px-3 py-2 text-right">Importe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {d.creditNotes.map((n: any) => (
                      <tr key={n.id}>
                        <td className="px-3 py-2 font-medium">{n.serie}-{String(n.folio).padStart(6, '0')}</td>
                        <td className="px-3 py-2">{new Date(n.date_issued).toLocaleDateString('es-MX')}</td>
                        <td className="px-3 py-2 text-gray-500">{n.tipo_relacion} — {n.motivo}</td>
                        <td className="px-3 py-2 text-right font-semibold text-rose-700">−$ {fmt(n.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between p-5 border-t border-gray-200 bg-gray-50">
          <button
            onClick={() => setShowMail(true)}
            disabled={!d}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg shadow"
            title="Enviar factura + NCs + pagos por correo"
          >
            <Mail size={16}/> Enviar por correo
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
            Cerrar
          </button>
        </div>

        {showMail && d && (
          <SendMailModal
            invoice={invoice}
            balance={d}
            onClose={() => setShowMail(false)}
          />
        )}
      </div>
    </div>
  );
}

/* ───────────── Modal: enviar PDF + XML por correo ─────────────
 * Recibe el balance ya cargado (factura + NCs + pagos) para mostrar
 * todos los documentos como checkboxes seleccionables.
 */
function SendMailModal({
  invoice, balance, onClose,
}: {
  invoice: Invoice;
  balance: any;
  onClose: () => void;
}) {
  // Cargamos datos del cliente para prellenar el email destino
  const customerQ = useQuery({
    queryKey: ['customer', invoice.customer_id],
    queryFn: () => api.getCustomer(invoice.customer_id),
    enabled: !!invoice.customer_id,
  });
  const customerEmail = customerQ.data?.data?.email || '';

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(
    `Factura ${invoice.serie}-${String(invoice.folio).padStart(6, '0')}`
  );
  const [message, setMessage] = useState(
    'Adjuntamos la factura y documentos fiscales relacionados para su registro contable.\n\nQuedamos atentos a cualquier duda.'
  );

  // Prellenamos "to" cuando llega el cliente
  useEffect(() => { if (customerEmail && !to) setTo(customerEmail); }, [customerEmail]);

  // Selección de adjuntos — factura marcada por default (PDF+XML)
  const [sel, setSel] = useState<Record<string, boolean>>({
    [`invoice_pdf:${invoice.id}`]: true,
    [`invoice_xml:${invoice.id}`]: !!invoice.cfdi_uuid,
  });
  const toggle = (key: string) => setSel((s) => ({ ...s, [key]: !s[key] }));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setOk('');
    const attachments = Object.entries(sel)
      .filter(([_, v]) => v)
      .map(([k]) => {
        const [kind, id] = k.split(':');
        return { kind, id };
      });
    if (attachments.length === 0) {
      setError('Selecciona al menos un archivo para enviar'); return;
    }
    if (!to) { setError('Captura el correo destino'); return; }
    setBusy(true);
    try {
      const r = await api.sendInvoiceMail(invoice.id, { to, cc, subject, message, attachments });
      const attached = r.data?.attached ?? attachments.length;
      const skipped: Array<{ kind: string; message: string }> = r.data?.skipped || [];
      let msg = `Correo enviado a ${r.data.recipients.join(', ')} con ${attached} adjunto(s).`;
      if (skipped.length > 0) {
        msg += ` Omitidos (${skipped.length}): ` + skipped.map((s) => `${s.kind} — ${s.message}`).join(' · ');
      }
      setOk(msg);
    } catch (e: any) {
      setError(e.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  const invoiceHasXml = !!invoice.cfdi_uuid;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <Mail className="text-indigo-700" size={20}/>
            </div>
            <div>
              <h2 className="font-bold">Enviar documentos por correo</h2>
              <p className="text-xs text-gray-500">
                {invoice.serie}-{String(invoice.folio).padStart(6, '0')} — selecciona los archivos y captura el destinatario
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded"><X size={18}/></button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}
          {ok    && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded text-sm">{ok}</div>}

          {/* Destinatario */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium block mb-1">Para *</span>
              <input required type="email" value={to} onChange={(e)=>setTo(e.target.value)}
                placeholder="cliente@empresa.com" className="input w-full"/>
              {customerEmail && (
                <p className="text-[11px] text-gray-500 mt-1">
                  Prellenado con el correo del cliente ({customerEmail})
                </p>
              )}
            </label>
            <label className="block">
              <span className="text-sm font-medium block mb-1">CC (opcional)</span>
              <input type="email" value={cc} onChange={(e)=>setCc(e.target.value)}
                placeholder="copia@ejemplo.com" className="input w-full"/>
            </label>
          </div>

          {/* Asunto */}
          <label className="block">
            <span className="text-sm font-medium block mb-1">Asunto</span>
            <input value={subject} onChange={(e)=>setSubject(e.target.value)} className="input w-full"/>
          </label>

          {/* Mensaje */}
          <label className="block">
            <span className="text-sm font-medium block mb-1">Mensaje</span>
            <textarea value={message} onChange={(e)=>setMessage(e.target.value)}
              rows={4} className="input w-full font-sans"/>
          </label>

          {/* Selección de adjuntos */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Adjuntos disponibles</p>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-[280px] overflow-y-auto">
              {/* Factura */}
              <AttachRow
                icon={<FileText size={16} className="text-amber-600"/>}
                title={`Factura ${invoice.serie}-${String(invoice.folio).padStart(6,'0')}`}
                pdfKey={`invoice_pdf:${invoice.id}`}
                xmlKey={`invoice_xml:${invoice.id}`}
                xmlDisabled={!invoiceHasXml}
                xmlHint={!invoiceHasXml ? 'Sin XML (no timbrada)' : undefined}
                sel={sel} toggle={toggle}
              />
              {/* NCs */}
              {balance.creditNotes.map((n: any) => (
                <AttachRow key={n.id}
                  icon={<FileMinus2 size={16} className="text-rose-600"/>}
                  title={`Nota de Crédito ${n.serie || 'NC'}-${String(n.folio).padStart(6,'0')}`}
                  subtitle={`${n.tipo_relacion || ''} · $${Number(n.total).toLocaleString('es-MX',{minimumFractionDigits:2})}`}
                  pdfKey={`credit_note_pdf:${n.id}`}
                  xmlKey={`credit_note_xml:${n.id}`}
                  xmlDisabled={!n.uuid}
                  xmlHint={!n.uuid ? 'Sin XML timbrado' : undefined}
                  sel={sel} toggle={toggle}
                />
              ))}
              {/* Pagos */}
              {balance.payments.map((p: any) => (
                <AttachRow key={p.id}
                  icon={<Wallet size={16} className="text-emerald-600"/>}
                  title={`Complemento de Pago ${p.serie || 'P'}-${String(p.folio || '').padStart(6,'0')}`}
                  subtitle={`${new Date(p.payment_date).toLocaleDateString('es-MX')} · $${Number(p.payment_amount).toLocaleString('es-MX',{minimumFractionDigits:2})}`}
                  pdfKey={`payment_pdf:${p.id}`}
                  xmlKey={`payment_xml:${p.id}`}
                  xmlDisabled={!p.uuid}
                  xmlHint={!p.uuid ? 'Sin XML timbrado' : undefined}
                  sel={sel} toggle={toggle}
                />
              ))}
              {balance.payments.length === 0 && balance.creditNotes.length === 0 && (
                <p className="px-4 py-3 text-xs text-gray-500 italic">
                  Solo se puede enviar la factura — aún no hay NCs ni complementos de pago asociados.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-5 border-t bg-gray-50">
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-white">
            Cerrar
          </button>
          <button type="submit" disabled={busy}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg shadow">
            <Send size={16}/> {busy ? 'Enviando…' : 'Enviar correo'}
          </button>
        </div>
      </form>
    </div>
  );
}

function AttachRow({
  icon, title, subtitle, pdfKey, xmlKey, xmlDisabled, xmlHint, sel, toggle,
}: {
  icon: React.ReactNode; title: string; subtitle?: string;
  pdfKey: string; xmlKey: string;
  xmlDisabled?: boolean; xmlHint?: string;
  sel: Record<string, boolean>; toggle: (k: string) => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
      <div className="flex items-center gap-3 min-w-0">
        <div className="shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{title}</p>
          {subtitle && <p className="text-[11px] text-gray-500">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={!!sel[pdfKey]} onChange={()=>toggle(pdfKey)}/>
          <span className="text-red-600 font-mono text-xs">PDF</span>
        </label>
        <label
          className={`flex items-center gap-1.5 text-sm cursor-pointer ${xmlDisabled ? 'opacity-40 pointer-events-none' : ''}`}
          title={xmlHint}
        >
          <input type="checkbox" checked={!!sel[xmlKey]} disabled={xmlDisabled} onChange={()=>toggle(xmlKey)}/>
          <span className="text-blue-600 font-mono text-xs">XML</span>
        </label>
      </div>
    </div>
  );
}

/* ───────────── Historia de Timbres (CFDI I + P + E) ─────────────
 * Bitácora cronológica de todos los timbres ligados a una factura:
 *   · CFDI tipo I  → la factura original (Ingreso)
 *   · CFDI tipo P  → cada complemento de pago timbrado (Anexo 20)
 *   · CFDI tipo E  → cada nota de crédito timbrada (Egreso)
 * Cada renglón muestra UUID, fecha de timbrado, importe y permite descargar PDF.
 */
function TimbresModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['invoice-balance', invoice.id],
    queryFn: () => api.getInvoiceBalance(invoice.id),
  });
  const d = data?.data;
  const [busyCancelId, setBusyCancelId] = useState<string | null>(null);

  const cancelDependent = async (
    kind: 'payment' | 'creditNote',
    id: string,
    label: string,
    folio: string
  ) => {
    const motivo = prompt(
      `Cancelar ${label} ${folio}\n\nEscribe el motivo (opcional). Esta acción marca el ` +
      `comprobante como CANCELADO y recalcula el saldo de la factura.`,
      ''
    );
    if (motivo === null) return; // cancel del prompt
    setBusyCancelId(id);
    try {
      if (kind === 'payment') await api.cancelPayment(id, motivo || undefined);
      else                    await api.cancelCreditNote(id, motivo || undefined);
      // Refresca este modal + la lista de facturas (status cambia)
      queryClient.invalidateQueries({ queryKey: ['invoice-balance', invoice.id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    } catch (e: any) {
      alert(e.response?.data?.message || e.message);
    } finally {
      setBusyCancelId(null);
    }
  };

  const fmt = (n: any) =>
    Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d: any) => (d ? new Date(d).toLocaleString('es-MX') : '—');

  // Construye lista cronológica unificada (cada fila con descarga PDF + XML)
  const rows: Array<{
    id?: string;
    kind?: 'payment' | 'creditNote';
    tipo: 'I' | 'P' | 'E';
    label: string;
    folio: string;
    fecha: any;
    importe: number;
    uuid: string | null;
    isCancelled?: boolean;
    badgeBg: string;
    badgeText: string;
    onPdf?: () => Promise<void>;
    onXml?: () => Promise<void>;
  }> = [];

  if (d) {
    const folioInv = d.invoice.folio.replace(/\s+/g, '-');
    rows.push({
      tipo: 'I',
      label: 'Factura (Ingreso)',
      folio: d.invoice.folio,
      fecha: d.invoice.pac_timestamp || d.invoice.date_issued,
      importe: Number(d.invoice.total),
      uuid: d.invoice.cfdi_uuid,
      badgeBg: 'bg-blue-100',
      badgeText: 'text-blue-800',
      onPdf: async () => {
        const blob = await api.generatePDF(invoice.id);
        api.downloadFile(blob, `factura-${folioInv}.pdf`);
      },
      onXml: async () => {
        const blob = await api.getCFDIXML(invoice.id);
        api.downloadFile(blob, `factura-${folioInv}.xml`);
      },
    });
    for (const p of d.payments) {
      const f = `${p.serie || 'P'}-${String(p.folio || 0).padStart(6, '0')}`;
      rows.push({
        id: p.id,
        kind: 'payment',
        tipo: 'P',
        label: 'Complemento de Pago',
        folio: f,
        fecha: p.pac_timestamp || p.payment_date,
        importe: Number(p.payment_amount),
        uuid: p.uuid || p.payment_uuid,
        isCancelled: p.document_status === 'CANCELLED',
        badgeBg: 'bg-emerald-100',
        badgeText: 'text-emerald-800',
        onPdf: async () => {
          const blob = await api.paymentPDF(p.id);
          api.downloadFile(blob, `pago-${f}.pdf`);
        },
        onXml: async () => {
          const blob = await api.paymentXML(p.id);
          api.downloadFile(blob, `pago-${f}.xml`);
        },
      });
    }
    for (const n of d.creditNotes) {
      const f = `${n.serie || 'NC'}-${String(n.folio).padStart(6, '0')}`;
      rows.push({
        id: n.id,
        kind: 'creditNote',
        tipo: 'E',
        label: 'Nota de Crédito',
        folio: f,
        fecha: n.pac_timestamp || n.date_issued,
        importe: Number(n.total),
        uuid: n.uuid,
        isCancelled: n.status === 'CANCELLED',
        badgeBg: 'bg-rose-100',
        badgeText: 'text-rose-800',
        onPdf: async () => {
          const blob = await api.creditNotePDF(n.id);
          api.downloadFile(blob, `nota-credito-${f}.pdf`);
        },
        onXml: async () => {
          const blob = await api.creditNoteXML(n.id);
          api.downloadFile(blob, `nota-credito-${f}.xml`);
        },
      });
    }
    rows.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <History className="text-indigo-700" size={20} />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">
                Historia de timbres — {invoice.serie}-{String(invoice.folio).padStart(6, '0')}
              </h2>
              <p className="text-xs text-gray-500">
                CFDI tipo I (Ingreso) · P (Pago) · E (Egreso/NC) — Anexo 20
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        {isLoading || !d ? (
          <div className="p-8 text-center text-gray-500">Cargando bitácora…</div>
        ) : (
          <div className="p-5">
            <div className="space-y-3">
              {rows.map((r, idx) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${r.badgeBg} ${r.badgeText}`}>
                        {r.tipo}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900">{r.label} <span className="text-gray-500 font-normal">· {r.folio}</span></p>
                        <p className="text-xs text-gray-500 mt-0.5">Timbrado: {fmtDate(r.fecha)}</p>
                        <p className="text-xs font-mono text-indigo-700 mt-1 break-all">
                          {r.uuid || <span className="text-amber-600 italic font-sans">pendiente de timbrar</span>}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-bold ${r.tipo === 'E' ? 'text-rose-700' : 'text-gray-900'} ${r.isCancelled ? 'line-through opacity-60' : ''}`}>
                        {r.tipo === 'E' ? '−' : ''}$ {fmt(r.importe)}
                      </p>
                      {r.isCancelled && (
                        <span className="inline-block mt-1 px-2 py-0.5 bg-gray-200 text-gray-700 text-[10px] font-bold rounded uppercase">
                          Cancelado
                        </span>
                      )}
                      <div className="flex justify-end gap-3 mt-1 flex-wrap">
                        {r.uuid && r.onPdf && (
                          <button
                            type="button"
                            onClick={() => r.onPdf!().catch((e) => alert(e?.message || 'Error PDF'))}
                            className="text-xs text-red-600 hover:text-red-800 hover:underline inline-flex items-center gap-1"
                          >
                            <FileDown size={12} /> PDF
                          </button>
                        )}
                        {r.uuid && r.onXml && (
                          <button
                            type="button"
                            onClick={() => r.onXml!().catch((e) => alert(e?.message || 'Error XML'))}
                            className="text-xs text-emerald-700 hover:text-emerald-900 hover:underline inline-flex items-center gap-1"
                          >
                            <Download size={12} /> XML
                          </button>
                        )}
                        {/* Cancelar — solo NC y pagos, y solo si no están ya cancelados.
                           Se muestra AUN sin UUID (pagos/NC en DRAFT o modo mock) para
                           que la factura no quede bloqueada por comprobantes sin timbre. */}
                        {r.kind && r.id && !r.isCancelled && (
                          <button
                            type="button"
                            disabled={busyCancelId === r.id}
                            onClick={() =>
                              cancelDependent(r.kind!, r.id!, r.label, r.folio)
                            }
                            className="text-xs text-orange-600 hover:text-orange-800 hover:underline inline-flex items-center gap-1 disabled:opacity-50"
                          >
                            <Ban size={12} />
                            {busyCancelId === r.id ? 'Cancelando…' : 'Cancelar'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {rows.length === 0 && (
                <p className="text-center text-gray-500 italic p-6">
                  Esta factura no ha sido timbrada todavía.
                </p>
              )}
            </div>

            {/* Resumen abajo */}
            <div className="mt-5 pt-4 border-t border-gray-200 grid grid-cols-3 gap-3 text-sm">
              <div className="text-center"><p className="text-xs text-gray-500">Total facturado</p>
                <p className="font-bold text-gray-900">$ {fmt(d.totals.total)}</p></div>
              <div className="text-center"><p className="text-xs text-gray-500">Cobrado + NC</p>
                <p className="font-bold text-emerald-700">$ {fmt(Number(d.totals.paid) + Number(d.totals.credited))}</p></div>
              <div className="text-center"><p className="text-xs text-gray-500">Saldo</p>
                <p className={`font-bold ${d.totals.remaining <= 0.01 ? 'text-emerald-700' : 'text-amber-700'}`}>
                  $ {fmt(d.totals.remaining)}
                </p></div>
            </div>
          </div>
        )}

        <div className="flex justify-end p-5 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'slate' | 'emerald' | 'rose' | 'amber' }) {
  const map = {
    slate:   'bg-slate-50 text-slate-800 border-slate-200',
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    rose:    'bg-rose-50 text-rose-800 border-rose-200',
    amber:   'bg-amber-50 text-amber-800 border-amber-200',
  } as const;
  return (
    <div className={`rounded-lg border p-3 ${map[tone]}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-base font-bold">{value}</p>
    </div>
  );
}

/* ───────────── Vista previa del PDF ───────────── */

function PreviewModal({ url, filename, onClose }: { url: string; filename: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="font-bold text-gray-900 truncate">Vista previa — {filename}</h2>
          <div className="flex gap-2">
            <a href={url} download={filename}
              className="flex items-center gap-1 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg">
              <FileDown size={14} /> Descargar
            </a>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
          </div>
        </div>
        <iframe src={url} className="flex-1 w-full" title="PDF preview" />
      </div>
    </div>
  );
}

/* ───────────── Modal de cancelación ───────────── */

function CancelModal({
  invoice, onClose, onDone,
}: {
  invoice: Invoice;
  onClose: () => void;
  onDone: () => void;
}) {
  const [motivo, setMotivo] = useState('02');
  const [folioSustitucion, setFolioSustitucion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Cuando SW responde 404 (bug de vault en sandbox), ofrecemos "cancelar solo
  // local" para destrabar al usuario sin que tenga que volver a abrir el modal.
  const [showForceLocal, setShowForceLocal] = useState(false);

  const selected = CANCEL_REASONS.find((r) => r.key === motivo);
  const needsUUID = !!selected?.needsUUID;

  const doCancel = async (forceLocal: boolean) => {
    setError('');
    setShowForceLocal(false);
    if (needsUUID && !/^[A-Z0-9]{8}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{12}$/i.test(folioSustitucion.trim())) {
      setError('El motivo 01 requiere el UUID del CFDI que sustituye (formato 8-4-4-4-12).');
      return;
    }
    setBusy(true);
    try {
      const r = await api.cancelInvoice(
        invoice.id,
        motivo,
        needsUUID ? folioSustitucion.trim().toUpperCase() : undefined,
        forceLocal || undefined
      );
      alert(
        forceLocal
          ? (`✅ Factura cancelada solo localmente\n\n` +
             `Motivo: ${selected?.label}\n` +
             `⚠ El PAC/SAT NO fue notificado. Si el CFDI llegó al SAT, ` +
             `debes cancelarlo por otro medio (panel del PAC).`)
          : (`✅ Cancelación procesada\n\n` +
             `Motivo: ${selected?.label}\n` +
             (needsUUID ? `Sustitución de UUID: ${folioSustitucion.toUpperCase()}\n\n` : '\n') +
             (r.message || 'Estatus actualizado.'))
      );
      onDone();
    } catch (e: any) {
      const msg = e.response?.data?.message || e.message;
      setError(msg);
      // Si el error viene del PAC (404, "vault", "no encuentra"), ofrecemos
      // el bypass local — común en sandbox de SW.
      if (/404|vault|no encuentra|SW/i.test(msg)) {
        setShowForceLocal(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = () => doCancel(false);
  const submitForceLocal = () => doCancel(true);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <Ban className="text-orange-600" size={20} />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Cancelar factura</h2>
              <p className="text-xs text-gray-500">Folio {invoice.serie}-{String(invoice.folio).padStart(6, '0')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}

          <label className="block">
            <span className="text-sm font-medium text-gray-700 block mb-1">
              Motivo de cancelación (Anexo 20 — c_MotivoCancelacion)
            </span>
            <select
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="input"
            >
              {CANCEL_REASONS.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
          </label>

          {needsUUID && (
            <div className="bg-amber-50 border border-amber-200 p-3 rounded space-y-2">
              <p className="text-sm font-semibold text-amber-900">⚠ Motivo 01 requiere sustitución</p>
              <p className="text-xs text-amber-800">
                Antes de cancelar con este motivo debes haber emitido y timbrado un nuevo CFDI que
                <b> sustituya</b> al actual. Captura aquí el UUID (Folio Fiscal) del CFDI sustituto.
              </p>
              <label className="block">
                <span className="text-xs font-medium text-amber-900 block mb-1">UUID de sustitución</span>
                <input
                  type="text"
                  value={folioSustitucion}
                  onChange={(e) => setFolioSustitucion(e.target.value)}
                  placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                  className="input font-mono text-xs uppercase"
                  maxLength={36}
                />
              </label>
            </div>
          )}

          <p className="text-xs text-gray-500">
            <b>Regla del SAT:</b> en el mismo mes la cancelación no requiere aceptación del receptor.
            En meses posteriores, el receptor tiene 24 h para aceptar o rechazar. El motivo 03
            ("no se llevó a cabo la operación") se usa cuando no hubo intercambio comercial real.
          </p>
        </div>

        <div className="p-5 border-t border-gray-200 space-y-3">
          {showForceLocal && (
            <div className="bg-amber-50 border border-amber-200 rounded p-3 space-y-2">
              <p className="text-sm font-semibold text-amber-900">
                ⚠ El PAC no pudo procesar la cancelación
              </p>
              <p className="text-xs text-amber-800">
                Puedes marcar la factura como CANCELADA solo en tu ERP (bypass local).
                Úsalo cuando SW rebote por bug de vault en sandbox o cuando ya
                cancelaste el CFDI directamente en el panel del PAC.
              </p>
              <button
                type="button"
                onClick={submitForceLocal}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm px-3 py-2 rounded"
              >
                <Ban size={14} />
                Cancelar solo localmente (sin llamar al PAC)
              </button>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
              No cancelar
            </button>
            <button onClick={submit} disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg">
              <Ban size={16} />
              {busy ? 'Procesando…' : 'Cancelar factura'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
