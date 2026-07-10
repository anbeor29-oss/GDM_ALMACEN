/**
 * Notas de Crédito (CFDI 4.0 tipo E)
 * - Listado de las NC emitidas
 * - Botón "Nueva nota de crédito": cliente → factura → motivo (Anexo 20) → monto
 * - Aplica el monto contra el saldo de la factura (parcial o total)
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Receipt, X, FileText, ArrowDownCircle, FileDown, Eye } from 'lucide-react';
import api from '@/services/api';

export function CreditNotesPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<{ url: string; filename: string } | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['credit-notes'],
    queryFn: () => api.listCreditNotes(),
  });

  const handleDownload = async (n: any) => {
    try {
      const blob = await api.creditNotePDF(n.id);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `nota-credito-${n.serie}-${String(n.folio).padStart(6, '0')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`No se pudo generar el PDF.\n\n${e.response?.data?.message || e.message}`);
    }
  };

  const handlePreview = async (n: any) => {
    try {
      const blob = await api.creditNotePDF(n.id, true);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      setPreviewBlob({ url, filename: `nota-credito-${n.serie}-${String(n.folio).padStart(6, '0')}.pdf` });
    } catch (e: any) {
      alert(`No se pudo generar la vista previa.\n\n${e.response?.data?.message || e.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900">Notas de Crédito</h1>
          <p className="text-gray-600 mt-2">CFDI de Egreso (Anexo 20)</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors shadow"
        >
          <Plus size={20} />
          Nueva Nota de Crédito
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Folio NC</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Cliente</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Factura</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Fecha</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Motivo</th>
              <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Total</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Estado</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {isLoading ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-600">Cargando…</td></tr>
            ) : (data?.data?.creditNotes || []).length === 0 ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-600">No hay notas de crédito todavía.</td></tr>
            ) : (
              data!.data.creditNotes.map((n: any) => (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {n.serie}-{String(n.folio).padStart(6, '0')}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700 uppercase">{n.customer_name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600 font-mono">
                    {n.invoice_serie || ''}-{n.invoice_folio ? String(n.invoice_folio).padStart(6, '0') : ''}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {new Date(n.date_issued).toLocaleDateString('es-MX')}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 font-mono">
                    {n.tipo_relacion} {n.motivo ? `— ${String(n.motivo).slice(0, 60)}` : ''}
                  </td>
                  <td className="px-6 py-4 text-sm font-semibold text-right text-red-700">
                    − $ {Number(n.total).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      n.status === 'STAMPED' ? 'bg-green-100 text-green-700'
                      : n.status === 'CANCELLED' ? 'bg-red-100 text-red-700'
                      : 'bg-gray-100 text-gray-700'
                    }`}>
                      {n.status === 'STAMPED' ? 'Timbrada' : n.status === 'CANCELLED' ? 'Cancelada' : 'Capturada'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleDownload(n)} title="Descargar PDF"
                        className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg"><FileDown size={18} /></button>
                      <button onClick={() => handlePreview(n)} title="Vista previa"
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><Eye size={18} /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateCreditNoteModal
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['credit-notes'] });
            qc.invalidateQueries({ queryKey: ['invoices'] });
            qc.invalidateQueries({ queryKey: ['invoice-balance'] });
          }}
        />
      )}

      {previewBlob && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="font-bold text-gray-900 truncate">Vista previa — {previewBlob.filename}</h2>
              <div className="flex gap-2">
                <a href={previewBlob.url} download={previewBlob.filename}
                  className="flex items-center gap-1 text-sm bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg">
                  <FileDown size={14} /> Descargar
                </a>
                <button onClick={() => { URL.revokeObjectURL(previewBlob.url); setPreviewBlob(null); }}
                  className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
              </div>
            </div>
            <iframe src={previewBlob.url} className="flex-1 w-full" title="PDF preview" />
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────── Modal de captura ───────────── */

function CreateCreditNoteModal({
  onClose, onDone,
}: { onClose: () => void; onDone: () => void }) {
  const [customerId, setCustomerId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [tipoRelacion, setTipoRelacion] = useState('01');
  const [motivo, setMotivo] = useState('');
  const [amountKind, setAmountKind] = useState<'total' | 'partial' | 'percent'>('partial');
  const [amount, setAmount] = useState<number>(0);
  const [iva, setIva] = useState<number>(0);
  const [percent, setPercent] = useState<number>(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const customers = useQuery({
    queryKey: ['customers-all-for-cn'],
    queryFn: () => api.getCustomers(1, 200, { sortBy: 'name', sortOrder: 'ASC' }),
  });

  const invoices = useQuery({
    queryKey: ['invoices-for-cn', customerId],
    queryFn: () => api.getInvoices(1, 100, { customerId }),
    enabled: !!customerId,
  });

  const motivos = useQuery({
    queryKey: ['credit-note-motivos'],
    queryFn: () => api.getCreditNoteMotivos(),
    staleTime: Infinity,
  });

  const facturasAplicables = useMemo(() => {
    return (invoices.data?.data?.invoices || []).filter(
      (i: any) => !['CANCELLED', 'PAID', 'DRAFT'].includes(i.status)
    );
  }, [invoices.data]);

  const selectedInvoice: any = facturasAplicables.find((i: any) => i.id === invoiceId);

  // Auto-cálculo del IVA según el modo:
  //  - total   → amount = total factura, IVA = tax_transferred factura
  //  - percent → amount = total * pct/100, IVA prorrateado con la misma proporción
  //  - partial → al cambiar amount, IVA se prorratea usando IVA/Total de la factura
  //              (el usuario puede sobreescribirlo manualmente — guardamos esa intención)
  const [ivaManual, setIvaManual] = useState(false);

  useEffect(() => {
    if (!selectedInvoice) return;
    if (amountKind === 'total') {
      setAmount(Number(selectedInvoice.total));
      setIva(Number(selectedInvoice.tax_transferred) || 0);
      setIvaManual(false);
    } else if (amountKind === 'percent') {
      const t = Number(selectedInvoice.total) || 0;
      const ivaProp = Number(selectedInvoice.tax_transferred) || 0;
      const calc = Math.round(t * (percent / 100) * 100) / 100;
      setAmount(calc);
      setIva(t > 0 ? Math.round((calc * (ivaProp / t)) * 100) / 100 : 0);
      setIvaManual(false);
    } else if (amountKind === 'partial' && !ivaManual) {
      // prorrateo automático cuando el usuario no ha tocado el IVA a mano
      const t = Number(selectedInvoice.total) || 0;
      const ivaProp = Number(selectedInvoice.tax_transferred) || 0;
      setIva(t > 0 && amount > 0 ? Math.round((amount * (ivaProp / t)) * 100) / 100 : 0);
    }
  }, [selectedInvoice, amountKind, percent, amount, ivaManual]);

  // Subtotal derivado en vivo para mostrar el desglose sin importar el modo
  const subtotalNC = Math.max(0, Math.round((amount - iva) * 100) / 100);

  const submit = async () => {
    setError('');
    if (!customerId) { setError('Selecciona un cliente'); return; }
    if (!invoiceId)  { setError('Selecciona la factura a la que aplica'); return; }
    if (amountKind === 'percent') {
      if (!percent || percent <= 0) { setError('Captura un % mayor que 0'); return; }
    } else if (amount <= 0) {
      setError('Captura un monto mayor que 0'); return;
    }
    setBusy(true);
    try {
      const res = await api.createCreditNote({
        customerId, invoiceId, tipoRelacion,
        motivo: motivo || undefined,
        // Para "porcentaje" mandamos discountPercent — el backend recalcula el monto.
        ...(amountKind === 'percent'
          ? { discountPercent: percent }
          : { amount, iva: iva > 0 ? iva : undefined }),
        applyToInvoice: true,
      } as any);
      alert(
        `✅ Nota de Crédito timbrada (MODO SIMULACIÓN)\n\n` +
        `Folio: ${res.data?.serie}-${res.data?.folio}\n` +
        `UUID:  ${res.data?.uuid}\n` +
        `Motivo: ${res.data?.tipo_relacion}\n` +
        `Aplicada a la factura ${selectedInvoice?.serie}-${selectedInvoice?.folio}`
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
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between p-5 border-b border-gray-200 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-rose-100 rounded-lg flex items-center justify-center">
              <Receipt className="text-rose-700" size={20} />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Nueva Nota de Crédito</h2>
              <p className="text-xs text-gray-500">CFDI 4.0 tipo E — Anexo 20</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>
          )}

          <label className="block">
            <span className="text-sm font-medium text-gray-700 block mb-1">Cliente *</span>
            <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setInvoiceId(''); }}
              className="input">
              <option value="">— seleccionar cliente —</option>
              {(customers.data?.data?.customers || []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.business_name} ({c.rfc})</option>
              ))}
            </select>
          </label>

          {customerId && (
            <label className="block">
              <span className="text-sm font-medium text-gray-700 block mb-1">
                Factura a la que aplica * <span className="text-xs text-gray-500">(solo Timbradas / Pago parcial)</span>
              </span>
              <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} className="input">
                <option value="">— seleccionar factura —</option>
                {facturasAplicables.map((i: any) => (
                  <option key={i.id} value={i.id}>
                    {i.serie}-{String(i.folio).padStart(6, '0')} · ${Number(i.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })} · {i.status}
                  </option>
                ))}
              </select>
              {customerId && facturasAplicables.length === 0 && !invoices.isLoading && (
                <span className="text-xs text-amber-700 mt-1 block">
                  Este cliente no tiene facturas timbradas o con saldo a las que se pueda aplicar una NC.
                </span>
              )}
            </label>
          )}

          {selectedInvoice && (
            <div className="bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-700 grid grid-cols-3 gap-2">
              <div><span className="text-gray-500">Total factura:</span> <b>$ {Number(selectedInvoice.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</b></div>
              <div><span className="text-gray-500">Subtotal:</span> $ {Number(selectedInvoice.subtotal || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</div>
              <div><span className="text-gray-500">IVA:</span> $ {Number(selectedInvoice.tax_transferred || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</div>
            </div>
          )}

          <label className="block">
            <span className="text-sm font-medium text-gray-700 block mb-1">Tipo de Relación (c_TipoRelacion)</span>
            <select value={tipoRelacion} onChange={(e) => setTipoRelacion(e.target.value)} className="input">
              {Object.entries(motivos.data?.data?.motivos || {
                '01': 'Nota de crédito de los documentos relacionados',
                '03': 'Devolución de mercancía sobre facturas o traslados previos',
                '07': 'CFDI por aplicación de anticipo',
              }).map(([k, v]) => (
                <option key={k} value={k}>{k} — {String(v)}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700 block mb-1">Motivo / Comentario</span>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)}
              rows={2} className="input"
              placeholder="(opcional) Detalle interno del motivo de la nota de crédito" />
          </label>

          <div>
            <span className="text-sm font-medium text-gray-700 block mb-1">Aplicación</span>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <button type="button"
                onClick={() => setAmountKind('total')}
                className={`px-3 py-2 border rounded-lg text-sm ${amountKind === 'total' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300'}`}>
                <ArrowDownCircle size={14} className="inline mr-1" /> Cancelación total
              </button>
              <button type="button"
                onClick={() => setAmountKind('partial')}
                className={`px-3 py-2 border rounded-lg text-sm ${amountKind === 'partial' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300'}`}>
                <FileText size={14} className="inline mr-1" /> Monto fijo
              </button>
              <button type="button"
                onClick={() => setAmountKind('percent')}
                className={`px-3 py-2 border rounded-lg text-sm ${amountKind === 'percent' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300'}`}
                title="Descuento por pronto pago, devolución parcial, etc.">
                % Descuento
              </button>
            </div>

            {amountKind === 'percent' && (
              <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-2">
                <label className="block">
                  <span className="text-xs text-amber-800 block mb-1">% sobre el TOTAL de la factura</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min={0.01} max={100} step="0.01" value={percent}
                      onChange={(e) => setPercent(parseFloat(e.target.value) || 0)}
                      className="input text-right w-24"
                    />
                    <span className="text-sm text-amber-700">%</span>
                    <span className="text-xs text-gray-500 ml-2">
                      → NC ≈ <b>$ {amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</b>
                      {' '}(IVA $ {iva.toLocaleString('es-MX', { minimumFractionDigits: 2 })})
                    </span>
                  </div>
                </label>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-gray-500 block mb-1">Monto total NC (con IVA)</span>
                <input type="number" min={0.01} step="0.01" value={amount}
                  disabled={amountKind === 'percent'}
                  onChange={(e) => {
                    setAmount(parseFloat(e.target.value) || 0);
                    if (amountKind !== 'percent') setAmountKind('partial');
                    setIvaManual(false); // al cambiar amount volvemos a auto-prorrateo
                  }}
                  className="input text-right disabled:bg-gray-100 disabled:text-gray-500" />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500 block mb-1">IVA contenido</span>
                <input type="number" min={0} step="0.01" value={iva}
                  disabled={amountKind === 'percent'}
                  onChange={(e) => { setIva(parseFloat(e.target.value) || 0); setIvaManual(true); }}
                  className="input text-right disabled:bg-gray-100 disabled:text-gray-500" />
              </label>
            </div>

            {/* Desglose en vivo — siempre visible, en todos los modos */}
            {amount > 0 && (
              <div className="mt-2 bg-slate-50 border border-slate-200 rounded p-3 text-xs grid grid-cols-3 gap-2">
                <div>
                  <span className="text-slate-500 uppercase tracking-wide">Subtotal NC</span>
                  <p className="font-bold text-slate-800 text-sm">
                    $ {subtotalNC.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500 uppercase tracking-wide">IVA NC</span>
                  <p className="font-bold text-slate-800 text-sm">
                    $ {iva.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500 uppercase tracking-wide">Total NC</span>
                  <p className="font-bold text-rose-700 text-sm">
                    $ {amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 p-5 border-t border-gray-200">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={submit} disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg">
            <Receipt size={16} />
            {busy ? 'Timbrando…' : 'Timbrar Nota de Crédito'}
          </button>
        </div>
      </div>
    </div>
  );
}
