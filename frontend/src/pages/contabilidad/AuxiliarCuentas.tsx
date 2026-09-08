/**
 * Auxiliar de cuentas — el mayor de una cuenta contable en un rango de fechas.
 *
 * Resume TODOS los movimientos de una cuenta (cargos, abonos y saldo corriente)
 * entre dos fechas, partiendo del saldo anterior. El selector de cuenta va en
 * orden de catálogo (por código, como aparecen en la contabilidad).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Search } from 'lucide-react';
import { api } from '@/services/api';
import { formatCuenta, useMascara } from '@/utils/cuenta';

const money = (n: any) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const fdate = (s?: string) => s ? new Date(s + 'T12:00:00').toLocaleDateString('es-MX') : '—';

export function AuxiliarCuentasPage() {
  const hoy = new Date();
  const mascara = useMascara();
  const [busca, setBusca] = useState('');
  const [cuentaId, setCuentaId] = useState('');
  const [desde, setDesde] = useState(`${hoy.getFullYear()}-01-01`);
  const [hasta, setHasta] = useState(`${hoy.getFullYear()}-12-31`);

  const ctasQ = useQuery({ queryKey: ['ctas-mov'], queryFn: () => api.getCuentasContables() });
  // Orden por CÓDIGO (aparición en la contabilidad), no alfabético por nombre.
  const ctas = useMemo(() =>
    (ctasQ.data?.data?.cuentas || [])
      .filter((c: any) => c.permite_movimientos)
      .sort((a: any, b: any) => String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true })),
    [ctasQ.data]);
  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return ctas.filter((c: any) => !t || `${c.codigo} ${c.nombre}`.toLowerCase().includes(t)).slice(0, 100);
  }, [ctas, busca]);

  const q = useQuery({
    queryKey: ['auxiliar', cuentaId, desde, hasta],
    queryFn: () => api.getAuxiliarRango(cuentaId, desde, hasta),
    enabled: !!cuentaId,
  });
  const d: any = q.data?.data;
  const movs: any[] = d?.movimientos || [];

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BookOpen size={22} className="text-amber-600" /> Auxiliar de cuentas
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Todos los movimientos de una cuenta en un rango de fechas, con su saldo corriente.
        </p>
      </div>

      {/* Controles */}
      <div className="bg-white rounded-lg border shadow-sm p-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[280px]">
          <label className="text-[11px] text-gray-600">Cuenta (orden de catálogo)</label>
          <div className="relative mb-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nombre o código…" className="input w-full pl-8 text-sm" />
          </div>
          <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)}
            className="input w-full text-sm" size={1}>
            <option value="">— elige una cuenta ({filtradas.length}) —</option>
            {filtradas.map((c: any) => (
              <option key={c.id} value={c.id}>{formatCuenta(c.codigo, mascara)} — {c.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-gray-600">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="input text-sm block" />
        </div>
        <div>
          <label className="text-[11px] text-gray-600">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="input text-sm block" />
        </div>
      </div>

      {!cuentaId ? (
        <p className="text-sm text-gray-500">Elige una cuenta para ver su auxiliar.</p>
      ) : q.isLoading ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : d?.error ? (
        <p className="text-sm text-rose-700">{d.error}</p>
      ) : (
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-4 py-2 border-b flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-mono font-semibold">{formatCuenta(d.cuenta.codigo, mascara)}</span>
            <span className="text-gray-700">{d.cuenta.nombre}</span>
            <span className="text-xs text-gray-400">({d.cuenta.naturaleza})</span>
            <span className="ml-auto text-xs text-gray-500">{fdate(desde)} → {fdate(hasta)} · {d.total} movimiento(s)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold">Fecha</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold">Folio</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold">Concepto</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold">Cargo</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold">Abono</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr className="bg-gray-50/50">
                  <td colSpan={5} className="px-3 py-1.5 text-right text-xs text-gray-500 italic">Saldo inicial</td>
                  <td className="px-3 py-1.5 text-right font-mono">{money(d.saldoInicial)}</td>
                </tr>
                {movs.map((m, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap">{m.fecha}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-500">#{m.folio}</td>
                    <td className="px-3 py-1.5 text-xs">{m.concepto || m.poliza_concepto || '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{m.cargo ? money(m.cargo) : ''}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{m.abono ? money(m.abono) : ''}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{money(m.saldo)}</td>
                  </tr>
                ))}
                {movs.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">Sin movimientos en el rango.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold bg-gray-50">
                  <td colSpan={3} className="px-3 py-2 text-right">Sumas y saldo final</td>
                  <td className="px-3 py-2 text-right font-mono">{money(d.cargos)}</td>
                  <td className="px-3 py-2 text-right font-mono">{money(d.abonos)}</td>
                  <td className="px-3 py-2 text-right font-mono">{money(d.saldoFinal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default AuxiliarCuentasPage;
