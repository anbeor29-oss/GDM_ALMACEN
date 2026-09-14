/**
 * Cobranza detallada — lo que te deben tus clientes, alimentado de DOS fuentes:
 *   1. Contabilidad — el neto de cada subcuenta de cliente (105-xx = ventas −
 *      cobros). Se llena de las pólizas: facturas de NEXO Y XML descargados del
 *      SAT. Es la vista que sobrevive: con el tiempo, todo pasa por aquí.
 *   2. Facturas de NEXO — el reporte de facturas con saldo pendiente (inmediato,
 *      no espera a la contabilización). Reusa `ReceivablesReport`.
 */
import { useQuery } from '@tanstack/react-query';
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

      <SaldosContables />

      <div>
        <h2 className="text-xl font-semibold text-gray-800 mb-3">Facturas de NEXO con saldo</h2>
        <ReceivablesReport />
      </div>
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
