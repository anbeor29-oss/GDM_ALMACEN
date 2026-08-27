/**
 * Pólizas — el libro diario: TODAS las pólizas del mes (ventas, compras, cobros/
 * pagos, nómina y manuales), como se van generando, con opción de eliminar.
 *
 * No las genera: para eso están las pantallas de cada origen. Aquí se ven juntas
 * y se puede borrar una que salió mal (el asiento y sus partidas).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Trash2, AlertTriangle } from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const fecha = (s?: string) => s ? new Date(s + (String(s).length <= 10 ? 'T12:00:00' : '')).toLocaleDateString('es-MX') : '—';
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Clasifica cada póliza en un origen legible, por su regla/origen. */
function categoria(p: any): 'venta' | 'compra' | 'cobropago' | 'nomina' | 'manual' | 'otro' {
  const r = String(p.regla || '');
  if (/^ventas/.test(r)) return 'venta';
  if (/^compras/.test(r)) return 'compra';
  if (/^(cobro|pago)/.test(r)) return 'cobropago';
  if (p.origen === 'NOMINA' || /^nomina/.test(r)) return 'nomina';
  if (p.origen === 'MANUAL' || r === 'manual') return 'manual';
  return 'otro';
}
const ETIQUETA: Record<string, string> = {
  venta: 'Venta', compra: 'Compra', cobropago: 'Cobro/Pago', nomina: 'Nómina', manual: 'Manual', otro: 'Otro',
};
const FILTROS = [
  ['', 'Todas'], ['venta', 'Ventas'], ['compra', 'Compras'],
  ['cobropago', 'Cobros/Pagos'], ['nomina', 'Nómina'], ['manual', 'Manuales'],
] as const;

export function PolizasListaPage() {
  const hoy = new Date();
  const qc = useQueryClient();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [filtro, setFiltro] = useState<string>('');
  const [msg, setMsg] = useState('');
  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);

  const q = useQuery({ queryKey: ['polizas', anio, mes], queryFn: () => api.getPolizas(anio, mes) });
  const todas: any[] = q.data?.data?.polizas || [];
  const polizas = useMemo(
    () => todas.filter((p) => !filtro || categoria(p) === filtro),
    [todas, filtro]);

  const borrar = async (p: any) => {
    if (!window.confirm(`¿Borrar la póliza #${p.folio} (${p.concepto || 'sin concepto'})? Esto no se puede deshacer.`)) return;
    setMsg('');
    try {
      await api.borrarPoliza(p.id);
      setMsg(`Póliza #${p.folio} eliminada.`);
      qc.invalidateQueries({ queryKey: ['polizas', anio, mes] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo borrar.'); }
  };

  const cuenta = (c: string) => todas.filter((p) => categoria(p) === c).length;

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BookOpen size={22} className="text-primary" /> Pólizas
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          El libro diario del mes: todas las pólizas según se generan. Se pueden eliminar.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input py-1.5 text-sm">
          {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input py-1.5 text-sm w-24">
          {anios.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="flex flex-wrap gap-1 ml-2">
          {FILTROS.map(([k, label]) => (
            <button key={k} onClick={() => setFiltro(k)}
              className={`px-2.5 py-1 rounded-lg text-xs border ${
                filtro === k ? 'bg-primary text-white border-primary' : 'text-gray-600 hover:bg-gray-50'}`}>
              {label}{k && cuenta(k) > 0 ? ` (${cuenta(k)})` : ''}
            </button>
          ))}
        </div>
      </div>

      {msg && <p className="text-sm text-emerald-700">{msg}</p>}

      <div className="space-y-2">
        {q.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}
        {!q.isLoading && polizas.length === 0 && (
          <p className="text-sm text-gray-500 italic bg-white border rounded-lg p-4 text-center">
            Sin pólizas {filtro ? `de ${ETIQUETA[filtro].toLowerCase()} ` : ''}en {MESES[mes]} {anio}.
          </p>
        )}
        {polizas.map((p) => {
          const cargos = (p.lineas || []).reduce((a: number, l: any) => a + Number(l.cargo || 0), 0);
          const abonos = (p.lineas || []).reduce((a: number, l: any) => a + Number(l.abono || 0), 0);
          const cuadra = Math.abs(cargos - abonos) <= 0.02;
          return (
            <div key={p.id} className="bg-white border rounded-lg overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50 border-b text-sm">
                <b>#{p.folio}</b>
                <span className="text-gray-500">{fecha(p.fecha)}</span>
                <span className="text-gray-700 truncate">{p.concepto}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">{ETIQUETA[categoria(p)]}</span>
                {!cuadra && (
                  <span className="text-[10px] text-rose-600 flex items-center gap-0.5"><AlertTriangle size={11} /> descuadrada</span>
                )}
                <button onClick={() => borrar(p)} title="Eliminar póliza"
                  className="ml-auto text-gray-300 hover:text-rose-500"><Trash2 size={15} /></button>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {(p.lineas || []).map((l: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-1 font-mono text-gray-500 w-24">{l.codigo}</td>
                      <td className="px-2 py-1">{l.nombre}{l.concepto ? ` · ${l.concepto}` : ''}</td>
                      <td className="px-3 py-1 text-right w-28">{Number(l.cargo) > 0 ? money(l.cargo) : ''}</td>
                      <td className="px-3 py-1 text-right w-28">{Number(l.abono) > 0 ? money(l.abono) : ''}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold bg-gray-50">
                    <td colSpan={2} className="px-3 py-1 text-right">Sumas</td>
                    <td className="px-3 py-1 text-right">{money(cargos)}</td>
                    <td className="px-3 py-1 text-right">{money(abonos)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PolizasListaPage;
