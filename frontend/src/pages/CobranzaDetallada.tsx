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
import { RefreshCw, ChevronRight } from 'lucide-react';
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

export default CobranzaDetalladaPage;
