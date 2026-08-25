/**
 * Conciliación bancaria — todas las cuentas en una sola vista.
 *
 * Reúsa el parseo que ya hace "Bancos" (el PDF/CSV del estado de cuenta se
 * convierte en movimientos): aquí se elige la cuenta y el mes, se ve la rejilla
 * —saldo inicial, fecha, depósitos, retiros, saldo final— y se baja en Excel.
 * Habrá tantos estados de cuenta como cuentas de banco tenga la empresa.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, AlertTriangle } from 'lucide-react';
import api from '@/services/api';
import { fechaMx } from '@/utils/fecha';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export function ConciliacionBancaria() {
  const hoy = new Date();
  const [cuentaSel, setCuentaSel] = useState('');
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [estadoId, setEstadoId] = useState('');

  const cuentasQ = useQuery({ queryKey: ['bancos-cuentas'], queryFn: () => api.getCuentasBancarias() });
  const cuentas: any[] = cuentasQ.data?.data?.cuentas || [];
  const cid = cuentaSel || cuentas[0]?.id || '';
  const cuenta = cuentas.find((c) => c.id === cid);

  const controlQ = useQuery({
    queryKey: ['bancos-control', cid, anio],
    queryFn: () => api.getControlMensual(cid, anio),
    enabled: !!cid,
  });
  const meses: any[] = controlQ.data?.data?.meses || [];
  const porMes = new Map<number, any>(meses.map((m) => [m.mes, m]));

  const detalleQ = useQuery({
    queryKey: ['banco-estado', estadoId],
    queryFn: () => api.getDetalleEstadoBanco(estadoId),
    enabled: !!estadoId,
  });
  const estado = detalleQ.data?.data?.estado;
  const movimientos: any[] = detalleQ.data?.data?.movimientos || [];

  const exportar = () => {
    if (!estadoId) return;
    const n = `estado-${(cuenta?.alias || 'cuenta')}-${anio}-${String(estado?.mes || '').padStart(2, '0')}.xlsx`;
    api.descargarExcelEstado(estadoId, n);
  };

  return (
    <div className="space-y-4">
      {/* Elegir cuenta y año */}
      <div className="bg-white rounded-lg shadow border p-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Cuenta de banco</span>
          <select value={cid} onChange={(e) => { setCuentaSel(e.target.value); setEstadoId(''); }}
            className="border rounded-lg px-3 py-2 text-sm min-w-[16rem]">
            {cuentas.length === 0 && <option value="">— no hay cuentas —</option>}
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>{c.banco_nombre ? `${c.banco_nombre} · ` : ''}{c.alias}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Año</span>
          <select value={anio} onChange={(e) => { setAnio(Number(e.target.value)); setEstadoId(''); }}
            className="border rounded-lg px-3 py-2 text-sm">
            {Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-gray-500 ml-auto self-center">
          Los estados de cuenta se cargan en la pestaña <b>Bancos</b>. Aquí se consultan y se exportan.
        </p>
      </div>

      {cuentas.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          No hay cuentas de banco. Créalas y carga sus estados de cuenta en la pestaña Bancos.
        </div>
      ) : (
        <>
          {/* Los doce meses: los cargados se pueden abrir */}
          <div className="bg-white rounded-lg shadow border p-4">
            <p className="text-xs text-gray-500 mb-2">Elige un mes cargado para ver y exportar sus movimientos.</p>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mes) => {
                const m = porMes.get(mes);
                const activo = m && estadoId === m.id;
                return (
                  <button
                    key={mes}
                    disabled={!m}
                    onClick={() => m && setEstadoId(m.id)}
                    className={`rounded-lg border p-2 text-left transition ${
                      activo ? 'border-emerald-500 ring-1 ring-emerald-400 bg-emerald-50'
                      : m ? 'border-gray-200 hover:border-emerald-300 bg-white'
                      : 'border-dashed border-gray-200 bg-gray-50 text-gray-400 cursor-default'}`}
                  >
                    <p className="text-xs font-medium">{MESES[mes - 1]}</p>
                    {m ? (
                      <p className="text-[11px] text-gray-500">{money(m.saldo_final)}
                        {m.cuadra === false && <span className="text-rose-600"> · no cuadra</span>}
                      </p>
                    ) : (
                      <p className="text-[11px] text-gray-400">sin estado</p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* La rejilla del mes elegido */}
          {estadoId && (
            <div className="bg-white rounded-lg shadow border overflow-hidden">
              <div className="p-3 border-b flex flex-wrap items-center gap-3">
                <div className="text-sm">
                  <b>{cuenta?.alias}</b>
                  {estado && <span className="text-gray-500"> · {String(estado.mes).padStart(2, '0')}/{estado.anio}</span>}
                </div>
                {estado && (
                  <span className="text-xs text-gray-600">
                    Inicial {money(estado.saldo_inicial)} · Final {money(estado.saldo_final)}
                    {estado.cuadra === false && <span className="text-rose-600"> · no cuadra</span>}
                  </span>
                )}
                <button onClick={exportar}
                  className="ml-auto flex items-center gap-2 bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 text-sm">
                  <FileSpreadsheet size={16} /> Exportar a Excel
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Fecha</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Concepto</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Depósito</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Retiro</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    <tr className="bg-gray-50/60 italic text-gray-600">
                      <td className="px-3 py-1.5" colSpan={4}>Saldo inicial</td>
                      <td className="px-3 py-1.5 text-right">{estado ? money(estado.saldo_inicial) : ''}</td>
                    </tr>
                    {detalleQ.isLoading && (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">Cargando…</td></tr>
                    )}
                    {movimientos.map((m, i) => (
                      <tr key={i} className={m.inferido ? 'bg-amber-50/40' : ''}>
                        <td className="px-3 py-1.5 whitespace-nowrap">{fechaMx(m.fecha)}</td>
                        <td className="px-3 py-1.5">
                          {m.concepto}
                          {m.inferido && <span className="ml-1 text-[10px] text-amber-700">(inferido)</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right text-emerald-700">{m.deposito ? money(m.deposito) : ''}</td>
                        <td className="px-3 py-1.5 text-right text-rose-700">{m.retiro ? money(m.retiro) : ''}</td>
                        <td className="px-3 py-1.5 text-right">{money(m.saldo ?? m.saldo_calculado)}</td>
                      </tr>
                    ))}
                    {estado && (
                      <tr className="bg-gray-50 font-semibold border-t">
                        <td className="px-3 py-1.5" colSpan={2}>Totales / Saldo final</td>
                        <td className="px-3 py-1.5 text-right text-emerald-700">{money(estado.total_depositos)}</td>
                        <td className="px-3 py-1.5 text-right text-rose-700">{money(estado.total_retiros)}</td>
                        <td className="px-3 py-1.5 text-right">{money(estado.saldo_final)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ConciliacionBancaria;
