/**
 * Estado de resultados (CONTABLE, no NIF) — el que entrega el despacho: el árbol
 * del catálogo de cuentas de resultados (Ingresos → … ; Gastos → …), con el
 * movimiento de cada cuenta. Dos vistas:
 *   Mensual → PERIODO (el mes) + ACUMULADO (1-ene al fin del mes).
 *   Anual   → doce columnas (ene…dic) + TOTAL.
 * Descarga en PDF y Excel. A diferencia del «Resultado integral» (NIF B-3), NO
 * reagrupa por rubro: respeta la numeración y nombres del catálogo.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileDown, TrendingUp } from 'lucide-react';
import api from '@/services/api';
import { formatCuenta, useMascara } from '@/utils/cuenta';
import { SelectorPeriodo } from '@/components/SelectorPeriodo';
import { mx, MESES } from './piezas';

const MES3 = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

interface Fila { codigo: string; nombre: string; nivel: number; valores: number[]; }
function aplanar(nodos: any[], out: Fila[] = []): Fila[] {
  for (const n of nodos || []) {
    out.push({ codigo: n.codigo, nombre: n.nombre, nivel: n.nivel, valores: n.valores });
    if (n.hijos?.length) aplanar(n.hijos, out);
  }
  return out;
}

/* ── Vista MENSUAL: Concepto | Periodo | Acumulado ── */
function VistaMensual({ d, mascara }: { d: any; mascara: string }) {
  const seccion = (etiqueta: string, total: number[], nodos: any[]) => (
    <>
      <tr className="bg-gray-100 font-bold text-gray-800">
        <td className="px-3 py-1.5 uppercase tracking-wide">{etiqueta}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{mx(total[0])}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{mx(total[1])}</td>
      </tr>
      {aplanar(nodos).map((f, i) => {
        const fuerte = f.nivel <= 2;
        return (
          <tr key={(f.codigo || '') + i} className={fuerte ? 'bg-gray-50/60' : ''}>
            <td className="px-3 py-1" style={{ paddingLeft: 16 + Math.max(0, f.nivel - 1) * 16 }}>
              <span className={fuerte ? 'font-semibold text-gray-800' : 'text-gray-700'}>{f.nombre}</span>
              {f.codigo && <span className="ml-2 text-[10px] text-gray-400 font-mono">{formatCuenta(f.codigo, mascara)}</span>}
            </td>
            <td className={`px-3 py-1 text-right tabular-nums ${f.valores[0] < 0 ? 'text-rose-700' : ''}`}>{mx(f.valores[0])}</td>
            <td className={`px-3 py-1 text-right tabular-nums ${f.valores[1] < 0 ? 'text-rose-700' : ''}`}>{mx(f.valores[1])}</td>
          </tr>
        );
      })}
    </>
  );
  return (
    <div className="bg-white rounded-lg shadow border overflow-hidden max-w-4xl">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-600">
          <tr>
            <th className="px-3 py-2 text-left">Concepto</th>
            <th className="px-3 py-2 text-right w-40">Periodo</th>
            <th className="px-3 py-2 text-right w-40">Acumulado</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {seccion('Ingresos', d.totalIngresos, d.ingresos)}
          {seccion('Gastos', d.totalGastos, d.gastos)}
          <tr className="bg-gray-900 text-white font-bold">
            <td className="px-3 py-2">UTILIDAD (PÉRDIDA) DEL EJERCICIO</td>
            <td className="px-3 py-2 text-right tabular-nums">{mx(d.utilidad[0])}</td>
            <td className="px-3 py-2 text-right tabular-nums">{mx(d.utilidad[1])}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ── Vista ANUAL: Concepto | ENE…DIC | TOTAL ── */
function VistaAnual({ d }: { d: any }) {
  const total12 = (v: number[]) => r2((v || []).reduce((a, x) => a + x, 0));
  const celdas = (v: number[]) => (
    <>
      {v.map((x, i) => (
        <td key={i} className={`px-2 py-1 text-right tabular-nums ${x < 0 ? 'text-rose-700' : ''}`}>{x ? mx(x) : ''}</td>
      ))}
      <td className={`px-2 py-1 text-right tabular-nums font-semibold ${total12(v) < 0 ? 'text-rose-700' : ''}`}>{mx(total12(v))}</td>
    </>
  );
  const seccion = (etiqueta: string, total: number[], nodos: any[]) => (
    <>
      <tr className="bg-gray-100 font-bold text-gray-800">
        <td className="px-2 py-1.5 uppercase tracking-wide sticky left-0 bg-gray-100">{etiqueta}</td>
        {celdas(total)}
      </tr>
      {aplanar(nodos).map((f, i) => (
        <tr key={(f.codigo || '') + i} className={f.nivel <= 2 ? 'bg-gray-50/60' : ''}>
          <td className="px-2 py-1 sticky left-0 bg-inherit whitespace-nowrap"
            style={{ paddingLeft: 8 + Math.max(0, f.nivel - 1) * 14 }}>
            <span className={f.nivel <= 2 ? 'font-semibold' : ''}>{f.nombre}</span>
          </td>
          {celdas(f.valores)}
        </tr>
      ))}
    </>
  );
  return (
    <div className="bg-white rounded-lg shadow border overflow-x-auto">
      <table className="text-xs whitespace-nowrap">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-2 py-2 text-left sticky left-0 bg-gray-50">Concepto</th>
            {MES3.map((m) => <th key={m} className="px-2 py-2 text-right">{m}</th>)}
            <th className="px-2 py-2 text-right">TOTAL</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {seccion('Ingresos', d.totalIngresos, d.ingresos)}
          {seccion('Gastos', d.totalGastos, d.gastos)}
          <tr className="bg-gray-900 text-white font-bold">
            <td className="px-2 py-2 sticky left-0 bg-gray-900">UTILIDAD (PÉRDIDA)</td>
            {celdas(d.utilidad)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function EstadoResultadosContablePage() {
  const hoy = new Date();
  const mascara = useMascara();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [modo, setModo] = useState<'mensual' | 'anual'>('mensual');
  const [msg, setMsg] = useState('');

  const q = useQuery({
    queryKey: ['er-contable', modo, anio, mes],
    queryFn: () => modo === 'anual'
      ? api.getEstadoResultadosContableAnual(anio)
      : api.getEstadoResultadosContable(anio, mes),
  });
  const d: any = q.data?.data;
  const hayDatos = d && !d.vacio;

  const descargar = async (formato: 'excel' | 'pdf') => {
    setMsg('');
    try {
      if (modo === 'anual') await api.descargarEstadoResultadosContableAnual(anio, formato);
      else await api.descargarEstadoResultadosContable(anio, mes, formato);
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo descargar.'); }
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <TrendingUp size={22} className="text-primary" /> Estado de resultados
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Ingresos menos gastos, por cuenta del catálogo (no por rubro NIF).
            {modo === 'mensual' ? ' Periodo del mes y acumulado del ejercicio.' : ' Ejercicio completo, mes por mes.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border overflow-hidden text-sm">
            {(['mensual', 'anual'] as const).map((k) => (
              <button key={k} onClick={() => setModo(k)}
                className={`px-3 py-1.5 ${modo === k ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {k === 'mensual' ? 'Mensual' : 'Anual'}
              </button>
            ))}
          </div>
          {hayDatos && (
            <>
              <button onClick={() => descargar('excel')} title="Descargar Excel" className="btn-export">
                <FileSpreadsheet size={16} /> Excel
              </button>
              <button onClick={() => descargar('pdf')} title="Descargar PDF" className="btn-export">
                <FileDown size={16} /> PDF
              </button>
            </>
          )}
          {/* En anual manda el año; el mes se ignora. */}
          <SelectorPeriodo anio={anio} mes={mes} onAnio={setAnio} onMes={(m) => { setMes(m); setModo('mensual'); }} />
        </div>
      </div>

      {msg && <p className="text-sm text-rose-700">{msg}</p>}
      {q.isLoading && <p className="text-gray-500">Cargando {modo === 'anual' ? `${anio}` : `${MESES[mes]} ${anio}`}…</p>}

      {!q.isLoading && !hayDatos && (
        <p className="text-sm text-gray-600 bg-gray-50 border rounded px-4 py-6 text-center">
          {modo === 'anual' ? `El ejercicio ${anio}` : `${MESES[mes]} ${anio}`} todavía no tiene movimientos de resultados.
          Genera las pólizas y actualiza la balanza en{' '}
          <a href="/contabilidad/balanza" className="text-primary hover:underline">Balanza</a>.
        </p>
      )}

      {hayDatos && (modo === 'anual' ? <VistaAnual d={d} /> : <VistaMensual d={d} mascara={mascara} />)}
    </div>
  );
}

export default EstadoResultadosContablePage;
