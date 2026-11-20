/**
 * Cobranza detallada — lo que te deben tus clientes, alimentado de DOS fuentes:
 *   1. Contabilidad — el neto de cada subcuenta de cliente (105-xx = ventas −
 *      cobros). Se llena de las pólizas: facturas de NEXO Y XML descargados del
 *      SAT. Es la vista que sobrevive: con el tiempo, todo pasa por aquí.
 *   2. Facturas de NEXO — el reporte de facturas con saldo pendiente (inmediato,
 *      no espera a la contabilización). Reusa `ReceivablesReport`.
 */
import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, ChevronRight, TrendingUp, FileSpreadsheet, Loader2 } from 'lucide-react';
import { ReceivablesReport } from './Reports';
import api from '@/services/api';

const fmt = (n: number) =>
  `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function CobranzaDetalladaPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-gray-900">Cobranza detallada</h1>
        <p className="text-gray-600 mt-2">
          Lo que te deben tus clientes, desde la contabilidad y desde las facturas de NEXO.
        </p>
      </div>

      <HistorialFacturas />

      <CarteraReconstruida />

      <SaldosContables />

      <div>
        <h2 className="text-xl font-semibold text-gray-800 mb-3">Facturas de NEXO con saldo</h2>
        <ReceivablesReport />
      </div>
    </div>
  );
}

/* Reconstruye la cartera DIRECTO de los XML: facturas PPD − complementos de pago.
 * No espera a que estén las pólizas; sirve para un cliente del que ya se bajaron
 * todos sus XML. */
function CarteraReconstruida() {
  const [activo, setActivo] = useState(false);
  const [rfc, setRfc] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['cobranza-reconstruir', rfc],
    queryFn: () => api.reconstruirCobranza(rfc.trim() || undefined),
    enabled: activo,
  });
  const d: any = q.data?.data;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Reconstruir cartera (desde XML)</h2>
          <p className="text-sm text-gray-500">
            Acumula las facturas <b>PPD</b> emitidas y descuenta los <b>complementos de pago</b> — el saldo por cobrar
            sale de los XML, sin esperar a las pólizas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input value={rfc} onChange={(e) => setRfc(e.target.value.toUpperCase())}
            placeholder="RFC cliente (opcional)" className="input py-1.5 text-sm font-mono w-48" />
          <button onClick={() => { setActivo(true); q.refetch(); }} disabled={q.isFetching}
            className="flex items-center gap-1.5 bg-primary text-white px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
            <RefreshCw size={15} className={q.isFetching ? 'animate-spin' : ''} /> {q.isFetching ? 'Reconstruyendo…' : 'Reconstruir'}
          </button>
        </div>
      </div>

      {activo && !q.isFetching && d && (
        <>
          <div className="flex flex-wrap gap-3 mb-3">
            <div className="bg-white rounded-lg shadow border px-4 py-2">
              <p className="text-xs text-gray-500">Total por cobrar</p>
              <p className="text-lg font-bold text-rose-700 tabular-nums">{fmt(d.total)}</p>
            </div>
            <div className="bg-white rounded-lg shadow border px-4 py-2">
              <p className="text-xs text-gray-500">Clientes con saldo</p>
              <p className="text-lg font-bold text-gray-800 tabular-nums">{d.clientes?.length || 0}</p>
            </div>
            <div className="bg-white rounded-lg shadow border px-4 py-2">
              <p className="text-xs text-gray-500">Facturas sin ningún pago</p>
              <p className="text-lg font-bold text-gray-800 tabular-nums">{d.sinPago || 0}</p>
            </div>
          </div>

          {(d.clientes || []).length === 0 ? (
            <div className="bg-white rounded-lg shadow border p-6 text-sm text-gray-500">
              Sin saldos PPD por cobrar. (Revisa que estén descargados los XML de facturas y de complementos de pago.)
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Cliente</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">0-30</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">31-60</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">61-90</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">+90</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(d.clientes || []).map((c: any) => {
                    const abiertoEste = abierto === (c.rfc || c.cliente);
                    const facturas = (d.facturas || []).filter((f: any) => (f.rfc || '') === (c.rfc || ''));
                    return (
                      <Fragment key={c.rfc || c.cliente}>
                        <tr className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => setAbierto(abiertoEste ? null : (c.rfc || c.cliente))}>
                          <td className="px-3 py-2 font-medium text-gray-800 uppercase">
                            <span className="inline-flex items-center gap-1">
                              <ChevronRight size={13} className={`text-gray-400 transition-transform ${abiertoEste ? 'rotate-90' : ''}`} />
                              {c.cliente}
                              <span className="ml-1 text-[10px] font-mono text-gray-400">{c.rfc}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{c.b0_30 ? fmt(c.b0_30) : ''}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{c.b31_60 ? fmt(c.b31_60) : ''}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-amber-700">{c.b61_90 ? fmt(c.b61_90) : ''}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-rose-700">{c.b90 ? fmt(c.b90) : ''}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-rose-700">{fmt(c.saldo)}</td>
                        </tr>
                        {abiertoEste && facturas.map((f: any) => (
                          <tr key={f.uuid} className="bg-gray-50/60 text-xs">
                            <td className="pl-8 pr-3 py-1 text-gray-600">
                              {f.folio} · {f.fecha} · <span className="text-gray-400">{f.dias} días</span>
                              {f.pagado > 0 && <span className="text-emerald-600"> · pagado {fmt(f.pagado)} de {fmt(f.total)}</span>}
                            </td>
                            <td colSpan={4}></td>
                            <td className="px-3 py-1 text-right tabular-nums text-gray-700">{fmt(f.saldo)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="border-t bg-gray-50">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-right font-semibold text-gray-700">Total cartera</td>
                    <td className="px-3 py-2 text-right font-bold text-rose-700 tabular-nums">{fmt(d.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SaldosContables() {
  const q = useQuery({ queryKey: ['saldos-clientes-contable'], queryFn: () => api.getSaldosClientesContable() });
  const data: any = q.data?.data;
  const clientes: any[] = data?.clientes || [];

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-1">Saldos por cliente (contabilidad)</h2>
      <p className="text-sm text-gray-500 mb-3">
        Neto de cada cliente en su cuenta contable: <b>ventas − cobros</b>. Se alimenta de las
        pólizas (facturas de NEXO y XML descargados del SAT) — por eso importan las descargas.
      </p>

      {q.isLoading ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : clientes.length === 0 ? (
        <div className="bg-white rounded-lg shadow border p-6 text-sm text-gray-500">
          Sin saldos por cobrar en la contabilidad todavía. Aparecen cuando se generan las pólizas
          de venta y de cobro (requiere descargar y contabilizar los XML de ventas y pagos).
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left font-semibold text-gray-900">Cliente</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-900">RFC</th>
                <th className="px-4 py-2 text-left font-semibold text-gray-900">Cuenta</th>
                <th className="px-4 py-2 text-right font-semibold text-gray-900">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {clientes.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-800 uppercase">{c.cliente}</td>
                  <td className="px-4 py-2 font-mono text-gray-600">{c.tercero_rfc}</td>
                  <td className="px-4 py-2 font-mono text-gray-500">{c.codigo}</td>
                  <td className="px-4 py-2 text-right font-semibold text-red-600 tabular-nums">{fmt(c.saldo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-gray-50">
              <tr>
                <td colSpan={3} className="px-4 py-2 text-right font-semibold text-gray-700">
                  Total por cobrar ({data?.cuantos ?? clientes.length} cliente{clientes.length === 1 ? '' : 's'})
                </td>
                <td className="px-4 py-2 text-right font-bold text-red-700 tabular-nums">{fmt(data?.total || 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─────────────── Historial de facturas emitidas (por cliente/fecha) ───────────────
 * Verde = pagada · rojo = pendiente · gris = cancelada. Excel (pestaña verde) y un
 * PRONÓSTICO de cobranza por antigüedad del saldo. */
function HistorialFacturas() {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [verPron, setVerPron] = useState(false);
  const [bajando, setBajando] = useState(false);

  const { data: customersResp } = useQuery({
    queryKey: ['customers-historial'],
    queryFn: () => api.getCustomers(1, 500, { sortBy: 'name', sortOrder: 'ASC' }),
  });
  const customers: any[] = (customersResp as any)?.data?.customers || [];

  const filtros = { desde: desde || undefined, hasta: hasta || undefined, customerId: customerId || undefined };
  const q = useQuery({
    queryKey: ['historial-facturas', desde, hasta, customerId],
    queryFn: () => api.getInvoicesHistory(filtros),
  });
  const d: any = (q.data as any)?.data;
  const filas: any[] = d?.filas || [];
  const tot: any = d?.totales;
  const pron: any[] = d?.pronostico || [];

  const descargarExcel = async () => {
    setBajando(true);
    try {
      const blob = await api.getInvoicesHistoryExcel(filtros);
      await api.downloadFile(blob, 'Historial_facturas.xlsx');
    } catch (e: any) {
      alert(e?.response?.data?.message || 'No se pudo generar el Excel.');
    } finally { setBajando(false); }
  };

  const dotColor = (estado: string) => estado === 'PAGADA' ? 'bg-emerald-500' : estado === 'PENDIENTE' ? 'bg-rose-500' : 'bg-gray-300';
  const estadoTexto = (estado: string) => estado === 'PAGADA' ? 'Pagada' : estado === 'PENDIENTE' ? 'Pendiente' : 'Cancelada';

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Historial de facturas emitidas</h2>
          <p className="text-sm text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-1">
            Todo el historial, por cliente y fecha.
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> pagada</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> pendiente</span>
          </p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-[11px] text-gray-500">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="input block py-1.5 text-sm" /></label>
          <label className="text-[11px] text-gray-500">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="input block py-1.5 text-sm" /></label>
          <label className="text-[11px] text-gray-500">Cliente
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="input block py-1.5 text-sm w-44">
              <option value="">Todos</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.business_name}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setVerPron((v) => !v)} title="Pronóstico de cobranza por antigüedad"
            className={`inline-flex items-center gap-1.5 border px-3 py-2 rounded-lg text-sm ${verPron ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'}`}>
            <TrendingUp size={15} /> Pronóstico
          </button>
          <button type="button" onClick={descargarExcel} disabled={bajando}
            className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm font-medium">
            {bajando ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />} Excel
          </button>
        </div>
      </div>

      {tot && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div className="bg-white rounded-lg shadow border px-4 py-2"><p className="text-xs text-gray-500">Facturado</p><p className="text-lg font-bold text-gray-800 tabular-nums">{fmt(tot.totalFacturado)}</p></div>
          <div className="bg-white rounded-lg shadow border px-4 py-2"><p className="text-xs text-gray-500">Pagado ({tot.pagadas})</p><p className="text-lg font-bold text-emerald-700 tabular-nums">{fmt(tot.totalPagado)}</p></div>
          <div className="bg-white rounded-lg shadow border px-4 py-2"><p className="text-xs text-gray-500">Pendiente ({tot.pendientes})</p><p className="text-lg font-bold text-rose-700 tabular-nums">{fmt(tot.totalPendiente)}</p></div>
          <div className="bg-white rounded-lg shadow border px-4 py-2"><p className="text-xs text-gray-500">Facturas</p><p className="text-lg font-bold text-gray-800 tabular-nums">{tot.facturas}{tot.canceladas ? <span className="text-xs text-gray-400"> · {tot.canceladas} cancel.</span> : null}</p></div>
        </div>
      )}

      {verPron && (
        <div className="bg-indigo-50/60 border border-indigo-200 rounded-lg p-4 mb-3">
          <p className="text-sm font-semibold text-indigo-800 flex items-center gap-1.5 mb-2"><TrendingUp size={15} /> Pronóstico de cobranza (por antigüedad del saldo)</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {pron.map((p) => (
              <div key={p.rango} className="bg-white rounded-lg border px-3 py-2">
                <p className="text-[11px] text-gray-500">{p.rango}</p>
                <p className="text-base font-bold text-rose-700 tabular-nums">{fmt(p.monto)}</p>
                <p className="text-[10px] text-gray-400">{p.facturas} factura(s)</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Fecha</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Cliente</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Folio</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Total</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Pagado</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Saldo</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Estado</th>
          </tr></thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">Cargando…</td></tr>}
            {!q.isLoading && filas.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400 italic">Sin facturas emitidas en el periodo.</td></tr>}
            {filas.map((f, i) => (
              <tr key={`${f.serie}-${f.folio}-${i}`} className="hover:bg-gray-50">
                <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{f.fecha}</td>
                <td className="px-3 py-1.5 text-gray-800">{f.cliente} <span className="text-[11px] text-gray-400 font-mono">{f.rfc}</span></td>
                <td className="px-3 py-1.5 font-mono text-xs text-gray-500">{f.serie}-{String(f.folio).padStart(6, '0')}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmt(f.total)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{fmt(f.pagado)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${f.saldo > 0 ? 'text-rose-700 font-medium' : 'text-gray-400'}`}>{fmt(f.saldo)}</td>
                <td className="px-3 py-1.5 text-center">
                  <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                    <span className={`w-2.5 h-2.5 rounded-full inline-block ${dotColor(f.estado)}`} /> {estadoTexto(f.estado)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CobranzaDetalladaPage;
