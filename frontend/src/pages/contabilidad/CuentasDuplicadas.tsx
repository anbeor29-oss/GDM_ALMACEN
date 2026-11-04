/**
 * Cuentas duplicadas — detecta cuentas del catálogo con el MISMO código (dos ids
 * para un mismo código) y las FUSIONA en una sola, reapuntando pólizas y saldos.
 * Pasa en catálogos viejos importados dos veces: la balanza sale con cada cuenta
 * repetida. Primero se PREVISUALIZA (solo lectura) y, con un clic, se consolida.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, CheckCircle2, AlertTriangle, Merge } from 'lucide-react';
import api from '@/services/api';
import { formatCuenta, useMascara } from '@/utils/cuenta';

const money = (n: any) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);

export function CuentasDuplicadasPage() {
  const qc = useQueryClient();
  const mascara = useMascara();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const q = useQuery({ queryKey: ['cuentas-duplicadas'], queryFn: () => api.getCuentasDuplicadas() });
  const d: any = q.data?.data || { grupos: [], totalCodigos: 0, totalCuentasSobrantes: 0 };
  const grupos: any[] = d.grupos || [];

  const fusionar = async () => {
    if (!window.confirm(
      `¿Fusionar ${d.totalCuentasSobrantes} cuenta(s) duplicada(s) en ${d.totalCodigos} código(s)?\n\n` +
      `Las pólizas y los saldos de las copias se mueven a UNA sola cuenta por código y las copias se eliminan. ` +
      `Es una operación en bloque (si algo choca, no se aplica nada). Conviene tener respaldo.\n\n` +
      `Después: Balanza → «Reconstruir año» para re-derivar los saldos.`)) return;
    setBusy(true); setMsg('');
    try {
      const r: any = await api.fusionarCuentasDuplicadas();
      setMsg(r.message || r.data?.mensaje || 'Cuentas fusionadas.');
      qc.invalidateQueries({ queryKey: ['cuentas-duplicadas'] });
      qc.invalidateQueries({ queryKey: ['ctas-mov'] });
      qc.invalidateQueries({ queryKey: ['ctas-todas'] });
    } catch (e: any) {
      setMsg(e?.response?.data?.message || 'No se pudo fusionar (se revirtió todo). Revisa si hay subcuentas de tercero en conflicto.');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Copy size={22} className="text-primary" /> Cuentas duplicadas
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Cuentas que son la <b>misma</b> aunque el código esté escrito distinto (p. ej. <span className="font-mono">«31080000»</span> y
          <span className="font-mono"> «3-10-80-000»</span> se ven iguales en pantalla). Se consolidan en una sola:
          las pólizas y los saldos de las copias se mueven a la cuenta que conserva más historia (entre «comillas», el código tal cual está guardado).
        </p>
      </div>

      {msg && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">{msg}</p>}

      {q.isLoading && <p className="text-gray-500">Buscando…</p>}

      {!q.isLoading && grupos.length === 0 && (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-4 py-6 flex items-center gap-2">
          <CheckCircle2 size={16} /> No hay cuentas duplicadas en esta empresa.
        </p>
      )}

      {grupos.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 bg-amber-50 border border-amber-300 rounded-lg p-3">
            <AlertTriangle size={18} className="text-amber-700 shrink-0" />
            <p className="text-sm text-amber-800 flex-1 min-w-[16rem]">
              <b>{d.totalCodigos}</b> código(s) con copias — <b>{d.totalCuentasSobrantes}</b> cuenta(s) sobrante(s)
              que se eliminarán al fusionar. La cuenta <b>canónica</b> (la que se queda) es la de más hijos, luego
              más movimientos, luego más antigua.
            </p>
            <button onClick={fusionar} disabled={busy}
              className="flex items-center gap-1.5 bg-primary text-white px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
              <Merge size={15} /> {busy ? 'Fusionando…' : 'Fusionar todas'}
            </button>
          </div>

          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Código</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Nombre</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Copias</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Se queda (movs · hijos)</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Se eliminan</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {grupos.map((g) => (
                  <tr key={g.codigo} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-2 font-mono text-xs text-gray-700 whitespace-nowrap">{formatCuenta(g.codigo, mascara)}</td>
                    <td className="px-4 py-2"><p className="truncate max-w-xs">{g.nombre}</p></td>
                    <td className="px-4 py-2 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">{g.copias}</span>
                    </td>
                    <td className="px-4 py-2 text-center text-xs text-gray-600">
                      <div className="font-mono text-gray-400">«{g.canonica.codigoRaw}»</div>
                      {g.canonica.movimientos} mov · {g.canonica.hijos} hijo(s)
                      <div className="text-gray-400">{money(g.canonica.saldo)}</div>
                    </td>
                    <td className="px-4 py-2 text-center text-xs text-gray-500">
                      {g.duplicadas.map((x: any, i: number) => (
                        <div key={i}>
                          <span className="font-mono text-gray-400">«{x.codigoRaw}»</span> · {x.movimientos} mov · {money(x.saldo)}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default CuentasDuplicadasPage;
