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
import { AlertTriangle, Trash2, RefreshCw } from 'lucide-react';
import api from '@/services/api';

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
                <tr key={p.guid} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">{p.folio}</td>
                  <td className="px-4 py-2 text-xs whitespace-nowrap">{p.fecha}</td>
                  <td className="px-4 py-2 text-xs truncate max-w-xs">{p.concepto || '—'}</td>
                  <td className="px-4 py-2 text-center text-xs text-gray-500">{p.movimientos}</td>
                  <td className="px-4 py-2 text-xs text-rose-700">{p.motivo}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => descartar(p.guid, p.folio)} title="Descartar de la lista"
                      className="text-gray-300 hover:text-rose-600">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
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

export default PolizasPendientesPage;
