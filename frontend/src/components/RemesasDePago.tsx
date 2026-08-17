/**
 * Remesas de pago — la lista que se arma el viernes y se paga el lunes.
 *
 * FLUJO QUE SIGUE LA PANTALLA
 * Elegir proveedor → marcar las facturas que se le van a pagar → fecha de pago
 * → Programar. La remesa nace en borrador; se autoriza (ahí se congela), se
 * imprime con los datos bancarios y el lunes se marca pagada: un solo golpe
 * liquida todas sus facturas y libera la línea de crédito de cada proveedor.
 *
 * POR QUÉ EL DÍA POR OMISIÓN ES EL PRÓXIMO LUNES
 * Es cuando se firman las transferencias. Nadie tiene que calcularlo ni corregir
 * la fecha en cada corrida; si algún día cambia, se escribe encima.
 */
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarCheck, Printer, Check, XCircle, FileSignature, Building2, Trash2, Search,
} from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const fecha = (d: any) => (d ? new Date(d).toLocaleDateString('es-MX') : '—');

const ESTADO: Record<string, { label: string; cls: string }> = {
  DRAFT:      { label: 'Borrador',   cls: 'bg-gray-200 text-gray-700' },
  AUTHORIZED: { label: 'Autorizada', cls: 'bg-sky-100 text-sky-700' },
  PAID:       { label: 'Pagada',     cls: 'bg-emerald-100 text-emerald-700' },
  CANCELLED:  { label: 'Cancelada',  cls: 'bg-rose-100 text-rose-700' },
};

/** El próximo lunes — el día en que se firman las transferencias. */
function proximoLunes(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

export function RemesasDePago({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [seleccion, setSeleccion] = useState<Record<string, boolean>>({});
  /* Filtro sobre las facturas del proveedor. Con un proveedor de veinte o
   * treinta facturas, marcar "las tres de septiembre" a base de scroll es
   * justo donde se marca la de al lado por error. */
  const [filtroFactura, setFiltroFactura] = useState('');
  const [fechaPago, setFechaPago] = useState(proximoLunes());
  const [notas, setNotas] = useState('');
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const supsQ = useQuery({
    queryKey: ['suppliers-combo'],
    queryFn: () => api.listSuppliers({ limit: 500 }),
  });
  const suppliers: any[] = supsQ.data?.data?.suppliers || [];

  /* Sólo lo pendiente y todavía no programado: una factura ya incluida en la
   * corrida del lunes no debe poder entrar también en la del martes. */
  const pendientesQ = useQuery({
    queryKey: ['treasury-pendientes', supplierId],
    queryFn: () => api.getTreasuryPayments({
      status: 'PENDING', sinRemesa: true, supplierId: supplierId || undefined,
    }),
    enabled: !!supplierId,
  });
  const pendientes: any[] = pendientesQ.data?.data?.payments || [];

  const runsQ = useQuery({ queryKey: ['payment-runs'], queryFn: () => api.getPaymentRuns() });
  const runs: any[] = runsQ.data?.data?.runs || [];

  /* Lo que se ve después del filtro. Busca por número de factura y por la
   * nota, que es donde queda escrito el concepto de una compra sin folio. */
  const visibles = useMemo(() => {
    const q = filtroFactura.trim().toLowerCase();
    if (!q) return pendientes;
    return pendientes.filter((p) =>
      String(p.invoice_number || '').toLowerCase().includes(q) ||
      String(p.notes || '').toLowerCase().includes(q)
    );
  }, [pendientes, filtroFactura]);

  /* Se elige sobre `pendientes` y NO sobre `visibles`: si alguien marca tres
   * facturas y luego escribe en el filtro, las tres siguen elegidas aunque
   * dejen de verse. Perderlas al teclear sería el peor momento para perderlas. */
  const elegidas = useMemo(
    () => pendientes.filter((p) => seleccion[p.id]),
    [pendientes, seleccion]
  );
  /* Marcar o limpiar de golpe, sobre lo que el filtro está mostrando. */
  const marcarVisibles = (v: boolean) => {
    const s2 = { ...seleccion };
    for (const p of visibles) s2[p.id] = v;
    setSeleccion(s2);
  };
  const totalElegido = elegidas.reduce((a, p) => a + Number(p.amount), 0);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['payment-runs'] });
    qc.invalidateQueries({ queryKey: ['treasury-pendientes'] });
    qc.invalidateQueries({ queryKey: ['treasury-payments'] });
    qc.invalidateQueries({ queryKey: ['treasury-summary'] });
  };

  const programar = async () => {
    if (elegidas.length === 0) { setError('Marca al menos una factura'); return; }
    setBusy(true); setError(''); setAviso('');
    try {
      const r = await api.createPaymentRun({
        paymentDate: fechaPago,
        notes: notas || undefined,
        paymentIds: elegidas.map((p) => p.id),
      });
      const d: any = r.data;
      setAviso(
        `Remesa #${d.folio} para el ${fecha(d.payment_date)}: ${d.agregadas} factura(s), ` +
        `${money(d.total)}.` +
        (d.rechazadas?.length ? ` ${d.rechazadas.length} no entraron (${d.rechazadas[0].motivo}).` : '')
      );
      setSeleccion({}); setNotas('');
      refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo programar la remesa');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
      {aviso && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-sm">{aviso}</div>}

      {/* ── ARMAR LA REMESA ─────────────────────────────────────────────── */}
      {canManage && (
        <div className="bg-white rounded-lg shadow border p-5 space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            <CalendarCheck className="text-emerald-600" size={20} /> Programar pagos
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">1 · Proveedor</label>
              <select value={supplierId}
                onChange={(e) => { setSupplierId(e.target.value); setSeleccion({}); setFiltroFactura(''); }}
                className="input w-full">
                <option value="">— Elige un proveedor —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.business_name}{s.rfc ? ` · ${s.rfc}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">3 · Fecha en que se paga</label>
              <input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)}
                className="input w-full" />
              <p className="text-[11px] text-gray-500 mt-1">
                Por omisión, el próximo lunes. No cambia el vencimiento de las facturas.
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Nota (opcional)</label>
              <input value={notas} onChange={(e) => setNotas(e.target.value)}
                placeholder="Transferencias de la semana" className="input w-full" />
            </div>
          </div>

          {/* 2 · las facturas que se le deben */}
          {supplierId && (
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 border-b">
                <div className="text-xs font-semibold text-gray-600 flex items-center">
                  2 · Facturas por pagar de este proveedor
                  <span className="ml-auto font-normal">
                    {filtroFactura
                      ? `${visibles.length} de ${pendientes.length} sin programar`
                      : `${pendientes.length} sin programar`}
                  </span>
                </div>
                {pendientes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <div className="relative flex-1 min-w-[12rem]">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        className="w-full border rounded pl-8 pr-3 py-1.5 text-sm"
                        placeholder="Filtrar por número de factura o nota…"
                        value={filtroFactura}
                        onChange={(e) => setFiltroFactura(e.target.value)}
                      />
                    </div>
                    {canManage && (
                      <>
                        <button type="button" onClick={() => marcarVisibles(true)}
                          className="text-xs px-2 py-1.5 border rounded hover:bg-white">
                          Marcar {filtroFactura ? 'lo filtrado' : 'todas'}
                        </button>
                        <button type="button" onClick={() => marcarVisibles(false)}
                          className="text-xs px-2 py-1.5 border rounded hover:bg-white">
                          Limpiar
                        </button>
                      </>
                    )}
                  </div>
                )}
                {/* Se avisa cuando hay elegidas que el filtro dejó fuera: si no,
                    el total de abajo no cuadraría con lo que se ve. */}
                {filtroFactura && elegidas.some((p) => !visibles.includes(p)) && (
                  <p className="text-[11px] text-amber-700 mt-1.5">
                    Hay facturas marcadas que el filtro no está mostrando. Siguen contando
                    en el total.
                  </p>
                )}
              </div>
              {pendientesQ.isLoading && (
                <p className="px-3 py-4 text-sm text-gray-500">Cargando…</p>
              )}
              {!pendientesQ.isLoading && pendientes.length === 0 && (
                <p className="px-3 py-6 text-sm text-gray-500 italic text-center">
                  Este proveedor no tiene facturas pendientes sin programar.
                </p>
              )}
              {pendientes.length > 0 && visibles.length === 0 && (
                <p className="px-3 py-6 text-sm text-gray-500 italic text-center">
                  Ninguna factura de este proveedor coincide con “{filtroFactura}”.
                </p>
              )}
              {visibles.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="px-3 py-1.5 w-8"></th>
                      <th className="px-3 py-1.5">Factura</th>
                      <th className="px-3 py-1.5">Vence</th>
                      <th className="px-3 py-1.5 text-right">Importe</th>
                      <th className="px-3 py-1.5">Nota</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {visibles.map((p) => {
                      const vencida = p.bucket === 'OVERDUE';
                      return (
                        <tr key={p.id} className={seleccion[p.id] ? 'bg-emerald-50/50' : ''}>
                          <td className="px-3 py-1.5">
                            <input type="checkbox" checked={!!seleccion[p.id]}
                              onChange={(e) => setSeleccion({ ...seleccion, [p.id]: e.target.checked })}
                              className="rounded border-gray-300" />
                          </td>
                          <td className="px-3 py-1.5 font-medium">{p.invoice_number || '—'}</td>
                          <td className={`px-3 py-1.5 ${vencida ? 'text-rose-700 font-semibold' : ''}`}>
                            {fecha(p.due_date)}{vencida && ' · vencida'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold">{money(p.amount)}</td>
                          <td className="px-3 py-1.5 text-xs text-gray-500 truncate max-w-xs">{p.notes}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">
              {elegidas.length} factura(s) · <strong>{money(totalElegido)}</strong>
            </span>
            <button onClick={programar} disabled={busy || elegidas.length === 0}
              className="ml-auto flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm">
              <CalendarCheck size={16} /> {busy ? 'Programando…' : 'Programar pago'}
            </button>
          </div>
        </div>
      )}

      {/* ── LAS REMESAS ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Remesa</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Se paga</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Proveedores</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Facturas</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Total</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Estado</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {runsQ.isLoading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!runsQ.isLoading && runs.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 italic">
                Todavía no hay remesas. Arma la primera arriba: elige proveedor,
                marca sus facturas y programa la fecha de pago.
              </td></tr>
            )}
            {runs.map((r) => {
              const e = ESTADO[r.status] || { label: r.status, cls: 'bg-gray-100 text-gray-600' };
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">#{r.folio}</td>
                  <td className="px-4 py-2">{fecha(r.payment_date)}</td>
                  <td className="px-4 py-2 text-center">{r.proveedores}</td>
                  <td className="px-4 py-2 text-center">{r.facturas}</td>
                  <td className="px-4 py-2 text-right font-semibold">{money(r.total)}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${e.cls}`}>{e.label}</span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button onClick={() => setDetalleId(r.id)}
                      className="text-primary hover:underline text-sm">Ver</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detalleId && (
        <DetalleRemesa runId={detalleId} canManage={canManage}
          onClose={() => setDetalleId(null)} onChanged={refresh} />
      )}
    </div>
  );
}

/* ══════════════════════ EL REPORTE QUE SE IMPRIME ══════════════════════ */

function DetalleRemesa({ runId, canManage, onClose, onChanged }: {
  runId: string; canManage: boolean; onClose: () => void; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const q = useQuery({ queryKey: ['payment-run', runId], queryFn: () => api.getPaymentRun(runId) });
  const run = q.data?.data?.run;
  const renglones: any[] = q.data?.data?.renglones || [];
  const total = Number(q.data?.data?.total || 0);

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['payment-run', runId] });
    onChanged();
  };

  const cambiarEstado = async (status: 'AUTHORIZED' | 'PAID' | 'CANCELLED', pregunta: string) => {
    if (!window.confirm(pregunta)) return;
    setBusy(true); setError('');
    try { await api.setPaymentRunStatus(runId, status); refrescar(); }
    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo cambiar el estado'); }
    finally { setBusy(false); }
  };

  const quitar = async (paymentId: string) => {
    setBusy(true); setError('');
    try { await api.removePaymentFromRun(runId, paymentId); refrescar(); }
    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo quitar'); }
    finally { setBusy(false); }
  };

  /* Se imprime en ventana aparte con su propio HTML: la lista se lleva al banco
   * o se archiva firmada, y arrastrar el menú y los botones de la aplicación a
   * ese papel no ayuda a nadie. */
  const imprimir = () => {
    const filas = renglones.map((r) => `
      <tr>
        <td>${r.supplier_name}<br><small>${r.supplier_rfc || ''}</small></td>
        <td>${r.invoice_number || '—'}</td>
        <td>${r.due_date ? new Date(r.due_date).toLocaleDateString('es-MX') : '—'}</td>
        <td>${r.bank_name || '—'}<br><small>${r.bank_clabe || r.bank_account || 'sin CLABE'}</small></td>
        <td class="der">${money(r.amount)}</td>
      </tr>`).join('');

    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(`
      <html><head><title>Remesa ${run?.folio}</title><style>
        body{font-family:system-ui,Arial,sans-serif;padding:24px;color:#111}
        h1{font-size:18px;margin:0 0 4px}
        .sub{color:#555;font-size:12px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
        th{background:#f3f4f6;font-size:11px;text-transform:uppercase}
        .der{text-align:right}
        tfoot td{font-weight:bold;font-size:14px;border-top:2px solid #333}
        small{color:#666}
        .firmas{margin-top:48px;display:flex;gap:64px;font-size:12px}
        .firma{border-top:1px solid #333;padding-top:4px;width:220px;text-align:center}
      </style></head><body>
        <h1>Remesa de pago #${run?.folio}</h1>
        <div class="sub">
          Se paga el ${run?.payment_date ? new Date(run.payment_date).toLocaleDateString('es-MX') : ''}
          · ${renglones.length} factura(s)
          ${run?.notes ? ' · ' + run.notes : ''}
        </div>
        <table>
          <thead><tr>
            <th>Proveedor</th><th>Factura</th><th>Vence</th>
            <th>Banco / CLABE</th><th class="der">Importe</th>
          </tr></thead>
          <tbody>${filas}</tbody>
          <tfoot><tr>
            <td colspan="4" class="der">TOTAL</td><td class="der">${money(total)}</td>
          </tr></tfoot>
        </table>
        <div class="firmas">
          <div class="firma">Elaboró</div>
          <div class="firma">Autorizó</div>
        </div>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  if (!run) return null;
  const e = ESTADO[run.status] || { label: run.status, cls: 'bg-gray-100 text-gray-600' };
  const enBorrador = run.status === 'DRAFT';

  /* Agrupado por proveedor: las transferencias del mismo destinatario van
   * juntas y quien paga no salta de un lado a otro de la lista. */
  const porProveedor = renglones.reduce((acc: Record<string, any[]>, r) => {
    (acc[r.supplier_id] = acc[r.supplier_id] || []).push(r);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white">
          <div>
            <h2 className="font-bold">
              Remesa #{run.folio} · se paga el {fecha(run.payment_date)}
            </h2>
            <p className="text-xs text-gray-500">
              {renglones.length} factura(s) · {Object.keys(porProveedor).length} proveedor(es)
              {run.created_by_email ? ` · armada por ${run.created_by_email}` : ''}
              {run.authorized_at ? ` · autorizada ${fecha(run.authorized_at)}` : ''}
              {run.paid_at ? ` · pagada ${fecha(run.paid_at)}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${e.cls}`}>{e.label}</span>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">✕</button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">{error}</div>}
          {run.notes && <p className="text-sm text-gray-600 bg-gray-50 rounded p-3">{run.notes}</p>}

          {Object.entries(porProveedor).map(([sid, filas]: [string, any]) => {
            const p = filas[0];
            const subtotal = filas.reduce((a: number, r: any) => a + Number(r.amount), 0);
            return (
              <div key={sid} className="border rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 flex items-start gap-2">
                  <Building2 size={16} className="text-gray-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{p.supplier_name}</p>
                    <p className="text-xs text-gray-500">
                      {p.supplier_rfc}
                      {p.bank_name ? ` · ${p.bank_name}` : ''}
                      {p.bank_clabe ? ` · CLABE ${p.bank_clabe}` : ''}
                      {!p.bank_clabe && !p.bank_account && (
                        <span className="text-amber-700"> · sin datos bancarios capturados</span>
                      )}
                    </p>
                  </div>
                  <span className="ml-auto font-semibold text-sm">{money(subtotal)}</span>
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    {filas.map((r: any) => (
                      <tr key={r.id}>
                        <td className="px-3 py-1.5">
                          <span className="font-medium">{r.invoice_number || 'sin folio'}</span>
                          {r.orden_folio && (
                            <span className="text-xs text-gray-500"> · orden #{r.orden_folio}</span>
                          )}
                        </td>
                        <td className={`px-3 py-1.5 text-xs ${r.vencida ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>
                          vence {fecha(r.due_date)}{r.vencida && ' · vencida'}
                        </td>
                        <td className="px-3 py-1.5 text-right">{money(r.amount)}</td>
                        <td className="px-3 py-1.5 text-right w-10">
                          {enBorrador && canManage && (
                            <button onClick={() => quitar(r.id)} disabled={busy}
                              title="Quitar de la remesa"
                              className="text-rose-600 hover:bg-rose-50 rounded p-1">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}

          <div className="flex items-center justify-end gap-3 text-lg font-bold border-t pt-3">
            <span className="text-sm font-normal text-gray-600">Total de la remesa</span>
            {money(total)}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 p-5 border-t bg-gray-50 sticky bottom-0">
          <button onClick={imprimir}
            className="flex items-center gap-2 bg-gray-700 text-white px-4 py-2 rounded-lg hover:bg-gray-800 text-sm">
            <Printer size={16} /> Imprimir lista
          </button>
          {canManage && enBorrador && (
            <button onClick={() => cambiarEstado('AUTHORIZED',
              `¿Autorizar la remesa #${run.folio} por ${money(total)}? Ya no se le podrán agregar ni quitar facturas.`)}
              disabled={busy}
              className="flex items-center gap-2 bg-sky-600 text-white px-4 py-2 rounded-lg hover:bg-sky-700 text-sm disabled:opacity-50">
              <FileSignature size={16} /> Autorizar
            </button>
          )}
          {canManage && run.status === 'AUTHORIZED' && (
            <button onClick={() => cambiarEstado('PAID',
              `¿Marcar como pagada la remesa #${run.folio}?\n\nSe van a dar por pagadas sus ${renglones.length} factura(s) por ${money(total)} y se liberará la línea de crédito de cada proveedor.`)}
              disabled={busy}
              className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 text-sm disabled:opacity-50">
              <Check size={16} /> Marcar pagada
            </button>
          )}
          {canManage && ['DRAFT', 'AUTHORIZED'].includes(run.status) && (
            <button onClick={() => cambiarEstado('CANCELLED',
              `¿Cancelar la remesa #${run.folio}?\n\nLas facturas NO se cancelan: vuelven a quedar disponibles para otra corrida.`)}
              disabled={busy}
              className="flex items-center gap-2 bg-rose-600 text-white px-4 py-2 rounded-lg hover:bg-rose-700 text-sm disabled:opacity-50">
              <XCircle size={16} /> Cancelar remesa
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
