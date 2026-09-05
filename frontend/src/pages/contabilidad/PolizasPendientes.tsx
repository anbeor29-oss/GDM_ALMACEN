/**
 * Pólizas pendientes — las del respaldo que NO se pudieron importar.
 *
 * Requisito: que nada se pierda. Cuando una póliza del respaldo no entra (por la
 * razón que sea), se guarda cruda con su motivo en `contpaqi_polizas_pendientes`
 * y se lista aquí. Al re-importar, la que ya entra se borra sola de esta lista;
 * «Descartar» la quita a mano si decides que no va.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Trash2, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export function PolizasPendientesPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const q = useQuery({ queryKey: ['polizas-pendientes'], queryFn: () => api.getPolizasPendientes() });
  const data: any = q.data?.data;
  const pendientes: any[] = data?.pendientes || [];
  const total: number = data?.total ?? 0;

  const descartar = async (guid: string, folio: string) => {
    if (!window.confirm(`¿Descartar la póliza pendiente ${folio}? Ya no se intentará importar.`)) return;
    setMsg('');
    try {
      await api.descartarPolizaPendiente(guid);
      setMsg('Pendiente descartada.');
      qc.invalidateQueries({ queryKey: ['polizas-pendientes'] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo descartar.'); }
  };

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <AlertTriangle size={22} className="text-amber-600" /> Pólizas pendientes
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Las del respaldo que no se pudieron importar. Nada se perdió: se guardan aquí con su
            motivo. Al re-importar, las que ya entren desaparecen solas.
          </p>
        </div>
        <button onClick={() => q.refetch()} className="text-gray-500 hover:text-gray-700" title="Actualizar">
          <RefreshCw size={16} className={q.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {msg && <p className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded px-3 py-2">{msg}</p>}

      {q.isLoading ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : total === 0 ? (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-4 py-3">
          No hay pólizas pendientes: todo el respaldo entró. 👌
        </p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <div className="px-4 py-2 text-xs text-gray-500 border-b">
            {total} pendiente(s){total > pendientes.length ? ` · se muestran ${pendientes.length}` : ''}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b text-gray-600">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold" />
                <th className="px-4 py-2 text-left text-xs font-semibold">Folio</th>
                <th className="px-4 py-2 text-left text-xs font-semibold">Fecha</th>
                <th className="px-4 py-2 text-left text-xs font-semibold">Concepto</th>
                <th className="px-4 py-2 text-center text-xs font-semibold">Movs</th>
                <th className="px-4 py-2 text-left text-xs font-semibold">Motivo</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {pendientes.map((p) => (
                <FilaPendiente key={p.guid} p={p} onDescartar={descartar} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-500">
        Para reintentarlas, vuelve a importar el respaldo: el motor las reintenta y borra de aquí las
        que ya entren. «Descartar» sólo la quita de la lista si decides que no va.
      </p>
    </div>
  );
}

/* Un renglón que se abre para mostrar los movimientos CRUDOS del respaldo: así el
 * usuario ve si la póliza existe y si se leyó bien (cuánto cargo, cuánto abono, si
 * cuadra). El detalle se pide al expandir, no antes. */
function FilaPendiente({ p, onDescartar }: { p: any; onDescartar: (guid: string, folio: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const d = useQuery({
    queryKey: ['pendiente-detalle', p.guid],
    queryFn: () => api.getPolizaPendienteDetalle(p.guid),
    enabled: abierto,
  });
  const det: any = d.data?.data;
  const movs: any[] = det?.movimientos || [];
  const cuadra = det ? Math.abs(det.cuadre?.diferencia || 0) < 0.005 : true;

  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-2 py-2 text-center">
          <button onClick={() => setAbierto((v) => !v)} className="text-gray-400 hover:text-gray-700"
            title={abierto ? 'Ocultar movimientos' : 'Ver movimientos del respaldo'}>
            {abierto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        </td>
        <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">{p.folio}</td>
        <td className="px-4 py-2 text-xs whitespace-nowrap">{p.fecha}</td>
        <td className="px-4 py-2 text-xs truncate max-w-xs">{p.concepto || '—'}</td>
        <td className="px-4 py-2 text-center text-xs text-gray-500">{p.movimientos}</td>
        <td className="px-4 py-2 text-xs text-rose-700">{p.motivo}</td>
        <td className="px-4 py-2 text-right">
          <button onClick={() => onDescartar(p.guid, p.folio)} title="Descartar de la lista"
            className="text-gray-300 hover:text-rose-600">
            <Trash2 size={14} />
          </button>
        </td>
      </tr>
      {abierto && (
        <tr className="bg-gray-50/60">
          <td />
          <td colSpan={6} className="px-4 py-3">
            {d.isLoading ? (
              <p className="text-xs text-gray-500">Cargando movimientos…</p>
            ) : movs.length === 0 ? (
              <p className="text-xs text-gray-500">
                El respaldo trae <b>{p.movimientos} movimiento(s)</b> para esta póliza. Una póliza
                necesita al menos 2 (un cargo y un abono) para asentarse; con menos, no es un asiento
                completo en el respaldo.
              </p>
            ) : (
              <div className="space-y-2">
                <table className="w-full text-xs">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="text-left font-medium py-1">#</th>
                      <th className="text-left font-medium py-1">Cuenta</th>
                      <th className="text-right font-medium py-1">Cargo</th>
                      <th className="text-right font-medium py-1">Abono</th>
                      <th className="text-left font-medium py-1 pl-3">Concepto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {movs.map((m, i) => (
                      <tr key={i}>
                        <td className="py-1 text-gray-400">{m.num}</td>
                        <td className="py-1 font-mono">{m.cuenta}</td>
                        <td className="py-1 text-right">{m.cargo ? money(m.cargo) : ''}</td>
                        <td className="py-1 text-right">{m.abono ? money(m.abono) : ''}</td>
                        <td className="py-1 pl-3 text-gray-600 truncate max-w-xs">{m.concepto}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t font-semibold">
                      <td colSpan={2} className="py-1 text-right pr-2">Sumas</td>
                      <td className="py-1 text-right">{money(det.cuadre.cargos)}</td>
                      <td className="py-1 text-right">{money(det.cuadre.abonos)}</td>
                      <td className="py-1 pl-3">
                        {cuadra
                          ? <span className="text-emerald-700">cuadra</span>
                          : <span className="text-rose-700">descuadre {money(det.cuadre.diferencia)}</span>}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <p className="text-[11px] text-gray-500">
                  Esto es lo que trae el respaldo, tal cual. Si cuadra y las cuentas existen, al
                  volver a importar entra sola y desaparece de aquí; si no, aquí se ve qué le falta.
                </p>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default PolizasPendientesPage;
