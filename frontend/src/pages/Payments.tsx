/**
 * Payments.tsx — Complementos de Pago (CFDI tipo P · Anexo 20).
 *
 * POR QUÉ EXISTE ESTA PANTALLA
 * Los complementos sólo se veían dentro del modal "Historia de timbres" de su
 * factura, y ahí no había forma de cancelarlos ni de bajar su XML. Eso dejó un
 * hueco caro: un complemento vigente ante el SAT impide cancelar su factura, y
 * sin pantalla propia no había manera de actuar sobre él desde el sistema.
 *
 * Es deliberadamente igual a Notas de Crédito: mismas columnas, mismos iconos y
 * el mismo orden de acciones. Los dos son comprobantes que cuelgan de una
 * factura y se administran igual; que se vean distinto sólo obligaría a
 * aprender dos pantallas para el mismo trabajo.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, FileDown, Eye, Ban } from 'lucide-react';
import { api } from '@/services/api';

export default function Payments() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: () => api.listPayments(),
  });
  const pagos: any[] = (data as any)?.data?.payments || (data as any)?.data || [];

  const etiqueta = (p: any) => `${p.serie || 'P'}-${String(p.folio).padStart(6, '0')}`;

  const handlePDF = async (p: any, inline = false) => {
    try {
      const blob = await api.paymentPDF(p.id, inline);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      if (inline) { window.open(url, '_blank'); return; }
      const a = document.createElement('a');
      a.href = url;
      a.download = `complemento-pago-${etiqueta(p)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`No se pudo generar el PDF.\n\n${e.response?.data?.message || e.message}`);
    }
  };

  const handleXML = async (p: any) => {
    try {
      const xml = await api.paymentXML(p.id);
      const url = URL.createObjectURL(new Blob([xml as any], { type: 'application/xml' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `complemento-pago-${etiqueta(p)}.xml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`No se pudo descargar el XML.\n\n${e.response?.data?.message || e.message}`);
    }
  };

  /* CANCELAR ANTE EL SAT.
   *
   * El botón se muestra siempre que el complemento tenga folio fiscal, INCLUSO
   * si el sistema ya lo marca como cancelado. Suena contradictorio y es a
   * propósito: durante mucho tiempo cancelar sólo cambiaba el estado local, así
   * que hay complementos marcados aquí como cancelados que siguen VIGENTES ante
   * el SAT — y mientras sigan vivos, su factura no se puede cancelar. Ocultar el
   * botón dejaría esos casos sin salida. */
  const handleCancelar = async (p: any) => {
    const motivoSat = window.prompt(
      'Motivo de cancelación (Anexo 20):\n' +
      '  01  Emitido con errores CON relación (exige folio sustituto)\n' +
      '  02  Emitido con errores SIN relación\n' +
      '  03  No se llevó a cabo la operación\n' +
      '  04  Operación nominativa en factura global',
      '02'
    );
    if (!motivoSat) return;
    let folioSustitucion: string | undefined;
    if (motivoSat === '01') {
      folioSustitucion = window.prompt('Folio fiscal (UUID) del CFDI que lo sustituye:') || undefined;
      if (!folioSustitucion) return;
    }
    if (!window.confirm(
      `Se cancelará ante el SAT el complemento ${etiqueta(p)}.\n\n` +
      `Si el SAT lo rechaza, no se modifica nada en el sistema.`
    )) return;
    try {
      await api.cancelPayment(p.id, undefined, motivoSat, folioSustitucion);
      alert(`Complemento ${etiqueta(p)} cancelado ante el SAT.`);
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    } catch (e: any) {
      alert(`No se canceló.\n\n${e.response?.data?.message || e.message}`);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Complementos de Pago</h1>
          <p className="text-slate-500 mt-1">CFDI de Pago (Anexo 20)</p>
        </div>
      </div>

      {/* El alta vive en la factura, no aquí: un complemento SIEMPRE se emite
          contra una factura concreta, y crearlo desde una lista suelta obligaría
          a buscarla primero. Esta pantalla es para consultarlos y actuar sobre
          ellos. */}
      <p className="text-sm text-slate-500 mb-4">
        Para registrar un pago nuevo, entra a la factura correspondiente y usa
        <b> Registrar pago</b>.
      </p>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">Cargando…</div>
        ) : !pagos.length ? (
          <div className="p-8 text-center text-slate-500">
            <Wallet size={40} className="mx-auto mb-3 text-slate-300" />
            Todavía no hay complementos de pago.
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left text-sm font-semibold text-slate-700">
                <th className="px-6 py-3">Folio</th>
                <th className="px-6 py-3">Cliente</th>
                <th className="px-6 py-3">Factura</th>
                <th className="px-6 py-3">Fecha</th>
                <th className="px-6 py-3">Folio fiscal</th>
                <th className="px-6 py-3 text-right">Monto</th>
                <th className="px-6 py-3">Estado</th>
                <th className="px-6 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagos.map((p: any) => {
                const cancelado = p.document_status === 'CANCELLED';
                return (
                  <tr key={p.id} className="text-sm hover:bg-slate-50">
                    <td className="px-6 py-4 font-semibold text-slate-900">{etiqueta(p)}</td>
                    <td className="px-6 py-4 text-blue-700">{p.customer_name || '—'}</td>
                    <td className="px-6 py-4 font-mono text-xs">
                      {p.invoice_serie || ''}{p.invoice_folio ? `-${String(p.invoice_folio).padStart(6, '0')}` : '—'}
                    </td>
                    <td className="px-6 py-4">
                      {p.payment_date ? new Date(p.payment_date).toLocaleDateString('es-MX') : '—'}
                    </td>
                    <td className="px-6 py-4 font-mono text-[11px] text-slate-500">{p.uuid || '—'}</td>
                    <td className={`px-6 py-4 text-right font-semibold ${cancelado ? 'line-through text-slate-400' : 'text-emerald-700'}`}>
                      ${Number(p.payment_amount || 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        cancelado ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {cancelado ? 'Cancelado' : 'Timbrado'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <button onClick={() => handlePDF(p)} title="Descargar PDF"
                          className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg"><FileDown size={18} /></button>
                        {p.uuid && (
                          <button onClick={() => handleCancelar(p)} title="Cancelar ante el SAT"
                            className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg"><Ban size={18} /></button>
                        )}
                        <button onClick={() => handleXML(p)} title="Descargar XML timbrado"
                          className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-bold">XML</button>
                        <button onClick={() => handlePDF(p, true)} title="Vista previa"
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><Eye size={18} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
