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
import { useState, useEffect } from 'react';
import { confirmar } from '@/utils/avisos';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, FileDown, Eye, Ban, Download, Plus, X, Loader2 } from 'lucide-react';
import { api } from '@/services/api';
import { fechaMx } from '@/utils/fecha';

export default function Payments() {
  const qc = useQueryClient();
  // #10 — alta de complemento ARRANCANDO DEL DEPÓSITO: un pago que cubre varias
  // facturas PPD del mismo cliente genera UN solo CFDI tipo P (varios
  // DoctoRelacionado) y consume UN timbre. El alta por factura sigue en la factura.
  const [nuevo, setNuevo] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['payments'],
    queryFn: () => api.listPayments(),
    retry: false,
  });
  const pagos: any[] = (data as any)?.data?.payments || (data as any)?.data || [];

  const etiqueta = (p: any) => `${p.serie || 'P'}-${String(p.folio).padStart(6, '0')}`;

  const handlePDF = async (p: any, inline = false) => {
    try {
      const blob = await api.paymentPDF(p.id, inline);
      /* Aunque sólo se quiera VER, el PDF se descarga: un complemento de pago
       * que se abría en una pestaña y se cerraba no quedaba en ningún lado. */
      await api.verYDescargar(
        new Blob([blob], { type: 'application/pdf' }),
        `complemento-pago-${etiqueta(p)}.pdf`,
        inline,
      );
    } catch (e: any) {
      alert(`No se pudo generar el PDF.\n\n${e.response?.data?.message || e.message}`);
    }
  };

  const handleXML = async (p: any) => {
    try {
      const xml = await api.paymentXML(p.id);
      await api.downloadFile(
        new Blob([xml as any], { type: 'application/xml' }),
        `complemento-pago-${etiqueta(p)}.xml`,
      );
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
    if (!await confirmar(
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
        {/* #10 — alta desde el DEPÓSITO: cubre varias facturas del cliente en un
            solo comprobante. El alta desde una factura concreta sigue disponible
            en la factura («Registrar pago»). */}
        <button onClick={() => setNuevo(true)}
          className="inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 font-semibold shadow-sm">
          <Plus size={18} /> Nuevo complemento
        </button>
      </div>

      <p className="text-sm text-slate-500 mb-4">
        Un <b>depósito</b> que cubre varias facturas PPD del mismo cliente se timbra en
        <b> un solo comprobante</b> con «Nuevo complemento». Para el pago de <b>una</b> factura
        también puedes entrar a ella y usar <b>Registrar pago</b>.
      </p>

      {nuevo && (
        <NuevoComplementoPago
          onClose={() => setNuevo(false)}
          onDone={() => {
            setNuevo(false);
            qc.invalidateQueries({ queryKey: ['payments'] });
            qc.invalidateQueries({ queryKey: ['invoices'] });
          }}
        />
      )}

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">Cargando…</div>
        ) : isError ? (
          /* ── Un error NO se muestra como "no hay nada" ──
             Es lo que pasó aquí: la consulta reventaba en el servidor, `data`
             quedaba indefinido, la lista salía vacía y la pantalla decía
             "Todavía no hay complementos de pago". Nadie reporta eso, porque
             parece la verdad. Un 500 disfrazado de lista vacía es peor que un
             500 a secas. */
          <div className="p-8 text-center">
            <p className="text-rose-700 font-medium">
              No se pudo traer la lista de complementos.
            </p>
            <p className="text-sm text-slate-500 mt-1">
              {(error as any)?.response?.data?.message || (error as any)?.message ||
               'El servidor respondió con un error.'}
            </p>
            <p className="text-xs text-slate-400 mt-2">
              Esto NO significa que no haya complementos: significa que no se pudieron leer.
            </p>
          </div>
        ) : !pagos.length ? (
          <div className="p-8 text-center text-slate-500">
            <Wallet size={40} className="mx-auto mb-3 text-slate-300" />
            Todavía no hay complementos de pago.
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left text-sm font-semibold text-slate-700">
                <th className="px-6 py-2">Folio</th>
                <th className="px-6 py-2">Cliente</th>
                <th className="px-6 py-2">Factura</th>
                <th className="px-6 py-2">Fecha</th>
                <th className="px-6 py-2">Folio fiscal</th>
                <th className="px-6 py-2 text-right">Monto</th>
                <th className="px-6 py-2">Estado</th>
                <th className="px-6 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagos.map((p: any) => {
                const cancelado = p.document_status === 'CANCELLED';
                return (
                  <tr key={p.id} className="text-sm hover:bg-slate-50">
                    <td className="px-6 py-2 font-semibold text-slate-900">{etiqueta(p)}</td>
                    <td className="px-6 py-2 text-blue-700">{p.customer_name || '—'}</td>
                    <td className="px-6 py-2 font-mono text-xs">
                      {p.invoice_serie || ''}{p.invoice_folio ? `-${String(p.invoice_folio).padStart(6, '0')}` : '—'}
                    </td>
                    <td className="px-6 py-2">
                      {p.payment_date ? fechaMx(p.payment_date) : '—'}
                    </td>
                    <td className="px-6 py-2 font-mono text-[11px] text-slate-500">{p.uuid || '—'}</td>
                    <td className={`px-6 py-2 text-right font-semibold ${cancelado ? 'line-through text-slate-400' : 'text-emerald-700'}`}>
                      ${Number(p.payment_amount || 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        cancelado ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {cancelado ? 'Cancelado' : 'Timbrado'}
                      </span>
                    </td>
                    <td className="px-6 py-2">
                      {/* Los MISMOS iconos y colores que el panel de facturas: rojo
                          para el PDF, verde para el XML, azul para la vista previa
                          y naranja para cancelar. Un complemento de pago es un CFDI
                          igual que una factura; que sus acciones se vieran distintas
                          obligaba a volver a aprenderlas en cada pantalla. El XML
                          era un botón con la palabra "XML" y ahora es su icono. */}
                      <div className="flex items-center gap-1">
                        <button onClick={() => handlePDF(p)} title="Descargar PDF"
                          className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg"><FileDown size={18} /></button>
                        <button onClick={() => handleXML(p)} title="Descargar XML"
                          className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg"><Download size={18} /></button>
                        <button onClick={() => handlePDF(p, true)} title="Vista previa"
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><Eye size={18} /></button>
                        {p.uuid && !cancelado && (
                          <button onClick={() => handleCancelar(p)} title="Cancelar ante el SAT"
                            className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg"><Ban size={18} /></button>
                        )}
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

/* ───────────── Nuevo complemento de pago (desde el DEPÓSITO, multi-factura) ─────────────
 *
 * El modal de la factura ya arma complementos de varias facturas ARRANCANDO de una
 * factura. Este arranca del DEPÓSITO: eliges cliente, ves TODAS sus facturas PPD con
 * saldo, repartes el depósito (o marcas a mano) y se timbra UN CFDI tipo P con varios
 * DoctoRelacionado. El backend (`createPayment`) ya valida: mismo cliente, saldo real
 * (total − pagos − NC), parcialidad por factura y no repetir factura.
 *
 * Una sola moneda por complemento: MonedaP es única en el Anexo 20. El caso «factura en
 * USD cobrada en pesos» se hace desde «Registrar pago» de esa factura (tiene el TC).
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

function NuevoComplementoPago({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [clienteId, setClienteId] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [forma, setForma] = useState('03');
  const [banco, setBanco] = useState('');
  const [deposito, setDeposito] = useState<number | ''>('');
  const [sel, setSel] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Facturas candidatas: timbradas, con saldo, no pagadas ni canceladas (= PPD por cobrar).
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', 'pendientes-rep'],
    queryFn: () => api.getInvoices(1, 500),
    retry: false,
  });
  const formas = useQuery({
    queryKey: ['catalog', 'formapago'],
    queryFn: () => api.getCatalog('formapago'),
    staleTime: Infinity,
  });

  // Al cambiar de cliente se limpia la selección (otro receptor, otras facturas).
  useEffect(() => { setSel({}); setDeposito(''); }, [clienteId]);

  const saldoDe = (f: any) => {
    const calc = Math.max(0, Number(f.total || 0) - Number(f.paid_total || 0) - Number(f.credited_total || 0));
    return f.balance != null ? Number(f.balance) : calc;
  };

  const lista: any[] = ((data as any)?.data?.invoices) || ((data as any)?.data) || [];
  const candidatas = lista.filter((f: any) =>
    f.cfdi_uuid && ['STAMPED', 'PARTIAL_PAYMENT'].includes(f.status) && saldoDe(f) > 0.01);

  // Clientes que tienen facturas por cobrar (sólo esos aparecen en el selector).
  const mapaCli = new Map<string, string>();
  candidatas.forEach((f: any) => { if (!mapaCli.has(f.customer_id)) mapaCli.set(f.customer_id, f.customer_name || f.customer_rfc || '—'); });
  const clientes = [...mapaCli.entries()].map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // Las del cliente, de la MÁS VIEJA a la más nueva (para repartir el depósito en orden).
  const delCliente = (clienteId ? candidatas.filter((f: any) => f.customer_id === clienteId) : [])
    .slice().sort((a: any, b: any) =>
      new Date(a.date_issued || a.issue_date || 0).getTime() - new Date(b.date_issued || b.issue_date || 0).getTime());

  const seleccionadas = delCliente.filter((f: any) => f.id in sel);
  const monedas = [...new Set(seleccionadas.map((f: any) => String(f.currency || 'MXN').toUpperCase()))];
  const monedaUnica = monedas.length <= 1 ? (monedas[0] || String(delCliente[0]?.currency || 'MXN').toUpperCase()) : null;
  const totalAplicado = r2(Object.values(sel).reduce((a, m) => a + (Number(m) || 0), 0));
  const formasEntries: any[] = (formas.data as any)?.data?.entries || [
    { catalog_key: '03', description: 'Transferencia electrónica de fondos' },
    { catalog_key: '01', description: 'Efectivo' },
  ];

  const alternar = (f: any) => setSel((prev) => {
    const c = { ...prev };
    if (f.id in c) delete c[f.id];
    else c[f.id] = r2(saldoDe(f));   // por omisión, el saldo completo
    return c;
  });

  // Reparte el depósito capturado entre las facturas del cliente, de la más vieja a la
  // más nueva, topando cada una a su saldo. Después se puede ajustar a mano.
  const repartir = () => {
    let resto = r2(Number(deposito) || 0);
    const next: Record<string, number> = {};
    for (const f of delCliente) {
      if (resto <= 0.009) break;
      const s = r2(saldoDe(f));
      if (s <= 0) continue;
      const aplica = Math.min(s, resto);
      if (aplica > 0.009) { next[f.id] = aplica; resto = r2(resto - aplica); }
    }
    setSel(next);
  };

  const submit = async () => {
    setError('');
    const docs = Object.entries(sel).filter(([, m]) => Number(m) > 0);
    if (!clienteId) { setError('Elige el cliente.'); return; }
    if (!docs.length) { setError('Marca al menos una factura y su monto.'); return; }
    if (!monedaUnica) {
      setError('Todas las facturas del complemento deben ser de la misma moneda (un CFDI de pago tiene una sola MonedaP). ' +
        'Si cobras en pesos una factura en otra moneda, usa «Registrar pago» dentro de esa factura.');
      return;
    }
    for (const [id, m] of docs) {
      const f = delCliente.find((x: any) => x.id === id);
      if (f && Number(m) > saldoDe(f) + 0.01) {
        setError(`El monto de ${f.serie || ''}${f.folio} excede su saldo (${saldoDe(f).toFixed(2)} ${String(f.currency || 'MXN').toUpperCase()}).`);
        return;
      }
    }
    setBusy(true);
    try {
      const res: any = await api.createPayment({
        documentos: docs.map(([invoiceId, monto]) => ({ invoiceId, monto: Number(monto) })),
        // Mediodía local para que la fecha no se recorra un día al pasar a UTC.
        paymentDate: new Date(`${fecha}T12:00:00`).toISOString(),
        paymentForm: forma,
        notes: banco.trim() ? `Depósito: ${banco.trim()}` : undefined,
      });
      const d = res?.data || {};
      alert(
        `✅ Complemento de Pago timbrado con ${d.provider || 'el PAC'}\n\n` +
        (d.payment?.uuid ? `UUID: ${d.payment.uuid}\n` : '') +
        `${docs.length} factura(s) · depósito $${totalAplicado.toFixed(2)} ${monedaUnica}`
      );
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'No se pudo timbrar el complemento.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
              <Wallet className="text-emerald-700" size={20} />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">Nuevo complemento de pago</h2>
              <p className="text-xs text-slate-500">Un depósito que cubre varias facturas del mismo cliente — CFDI tipo P</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">{error}</div>}

          {isLoading ? (
            <div className="py-10 text-center text-slate-500 flex items-center justify-center gap-2">
              <Loader2 size={18} className="animate-spin" /> Cargando facturas…
            </div>
          ) : !clientes.length ? (
            <div className="py-10 text-center text-slate-500">
              <Wallet size={36} className="mx-auto mb-2 text-slate-300" />
              No hay facturas PPD timbradas con saldo pendiente para generar un complemento.
            </div>
          ) : (
            <>
              {/* Datos del depósito */}
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium text-slate-600 block mb-1">Cliente</span>
                  <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">— Elige el cliente —</option>
                    {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600 block mb-1">Fecha del pago</span>
                  <input type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600 block mb-1">Forma de pago (c_FormaPago)</span>
                  <select value={forma} onChange={(e) => setForma(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                    {formasEntries.map((f: any) => (
                      <option key={f.catalog_key} value={f.catalog_key}>{f.catalog_key} — {f.description}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600 block mb-1">Banco / referencia <span className="text-slate-400">(opcional)</span></span>
                  <input type="text" value={banco} onChange={(e) => setBanco(e.target.value)}
                    placeholder="BBVA 1234 · folio del depósito"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </label>
              </div>

              {clienteId && (
                <>
                  {/* Repartir el depósito */}
                  <div className="flex flex-wrap items-end gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600 block mb-1">Monto del depósito</span>
                      <input type="number" min={0} step="0.01" value={deposito}
                        onChange={(e) => setDeposito(e.target.value === '' ? '' : parseFloat(e.target.value))}
                        placeholder="0.00" className="w-40 border border-slate-300 rounded-lg px-3 py-2 text-sm text-right" />
                    </label>
                    <button type="button" onClick={repartir} disabled={!deposito}
                      className="px-3 py-2 text-sm border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 disabled:opacity-40">
                      Repartir en las más viejas
                    </button>
                    <span className="text-xs text-slate-500">o marca las facturas a mano ↓</span>
                  </div>

                  {/* Facturas del cliente */}
                  {!delCliente.length ? (
                    <p className="text-sm text-slate-500 py-4 text-center">Este cliente no tiene facturas con saldo.</p>
                  ) : (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <span></span><span>Factura</span><span className="text-right">Saldo</span><span className="text-right">A pagar</span>
                      </div>
                      <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                        {delCliente.map((f: any) => {
                          const marcada = f.id in sel;
                          const saldo = saldoDe(f);
                          const mon = String(f.currency || 'MXN').toUpperCase();
                          return (
                            <div key={f.id} className={`grid grid-cols-[auto_1fr_auto_auto] gap-2 px-3 py-2 items-center text-sm ${marcada ? 'bg-emerald-50/50' : ''}`}>
                              <input type="checkbox" checked={marcada} onChange={() => alternar(f)} className="w-4 h-4 accent-emerald-600" />
                              <div className="min-w-0">
                                <span className="font-semibold text-slate-800">{f.serie || ''}{f.serie ? '-' : ''}{String(f.folio).padStart(6, '0')}</span>
                                <span className="text-slate-400 text-xs"> · {fechaMx(f.date_issued || f.issue_date)}</span>
                                <span className="text-slate-400 text-xs block truncate">total ${Number(f.total || 0).toFixed(2)} {mon}</span>
                              </div>
                              <span className="text-right text-slate-600 tabular-nums">${saldo.toFixed(2)}<br /><span className="text-[10px] text-slate-400">{mon}</span></span>
                              <input type="number" min={0.01} step="0.01" max={saldo} disabled={!marcada}
                                value={marcada ? sel[f.id] : ''} placeholder="0.00"
                                onChange={(e) => setSel((prev) => ({ ...prev, [f.id]: parseFloat(e.target.value) || 0 }))}
                                className="w-28 border border-slate-300 rounded px-2 py-1 text-sm text-right disabled:bg-slate-100 disabled:opacity-50" />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Resumen */}
                  <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                    <span className="text-sm text-slate-600">
                      {seleccionadas.length} factura(s) seleccionada(s)
                      {monedas.length > 1 && <span className="text-rose-600 font-medium"> · ⚠ monedas mezcladas</span>}
                    </span>
                    <span className="text-lg font-bold text-emerald-700 tabular-nums">
                      ${totalAplicado.toFixed(2)} {monedaUnica || ''}
                    </span>
                  </div>
                  {deposito !== '' && Math.abs(Number(deposito) - totalAplicado) > 0.01 && (
                    <p className="text-xs text-amber-600">
                      El depósito capturado (${Number(deposito).toFixed(2)}) no cuadra con lo aplicado (${totalAplicado.toFixed(2)}).
                      Ajusta los montos o reparte de nuevo.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-200">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50">Cancelar</button>
          <button onClick={submit} disabled={busy || !seleccionadas.length}
            className="inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 font-semibold disabled:opacity-40">
            {busy ? <><Loader2 size={16} className="animate-spin" /> Timbrando…</> : <>Timbrar complemento</>}
          </button>
        </div>
      </div>
    </div>
  );
}
