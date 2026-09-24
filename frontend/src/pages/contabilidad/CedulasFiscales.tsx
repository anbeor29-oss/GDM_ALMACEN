/**
 * Cédulas fiscales (papel de trabajo) — determinación mensual de impuestos.
 *
 *  · ISR de Persona Física con Actividad Empresarial y Profesional (régimen 612):
 *    pago provisional acumulado (tarifa Art. 96 acumulada al mes).
 *  · Cédula de IVA (mensual, definitivo) — para cualquier régimen.
 *
 * Los datos salen de los CFDI (ingresos = emitidos, deducciones = recibidos). Se
 * activa por RÉGIMEN FISCAL: la de ISR solo si la empresa es 612; la de IVA para
 * todas. PRIMERA VERSIÓN: coteja los números contra tu papel de trabajo.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Info } from 'lucide-react';
import api from '@/services/api';
import { claseOpcion } from '@/utils/coloresOpciones';
import { aniosContables } from '@/utils/anios';

const money = (n: any) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const pct = (n: any) => `${((Number(n) || 0) * 100).toFixed(2)}%`;

type Def = [string, string, ('money' | 'pct')?, boolean?];

const FILAS_ISR: Def[] = [
  ['Ingreso del periodo', 'ingresoMes'],
  ['(=) Ingresos acumulables', 'ingresoAcum'],
  ['(−) Deducciones del periodo', 'deduccionMes'],
  ['(=) Deducciones acumuladas', 'deduccionAcum'],
  ['(=) BASE GRAVABLE', 'base', 'money', true],
  ['(−) Límite inferior', 'limiteInferior'],
  ['(=) Excedente s/lím. inf.', 'excedente'],
  ['(×) % de tasa', 'pct', 'pct'],
  ['(=) Impuesto marginal', 'marginal'],
  ['(+) Cuota fija', 'cuotaFija'],
  ['(=) Impuesto determinado', 'determinado'],
  ['(−) Pagos prov. previos', 'pagosProvPrevios'],
  ['(−) ISR retenido acum.', 'isrRetenidoAcum'],
  ['(=) ISR POR PAGAR', 'isrPorPagar', 'money', true],
];
const FILAS_IVA: Def[] = [
  ['Ingresos gravados 16%', 'base16Ing'],
  ['Ingresos gravados 8%', 'base8Ing'],
  ['Ingresos 0%', 'base0Ing'],
  ['Exentos', 'exentoIng'],
  ['IVA trasladado 16%', 'trasladado16'],
  ['IVA trasladado 8%', 'trasladado8'],
  ['(−) IVA retenido', 'ivaRetenido'],
  ['(=) Total IVA trasladado', 'trasladado', 'money', true],
  ['Base acreditable', 'baseAcred'],
  ['(=) IVA acreditable', 'acreditable', 'money', true],
  ['IVA a cargo del periodo', 'aCargoPeriodo'],
  ['IVA a favor del periodo', 'aFavorPeriodo'],
  ['Saldo a favor (arrastre)', 'saldoFavorArrastre'],
  ['(=) IVA A CARGO', 'aCargo', 'money', true],
];

function TablaCedula({ filas, defs }: { filas: any[]; defs: Def[] }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 border-b sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left font-semibold text-gray-700 sticky left-0 bg-gray-50 min-w-[200px]">Concepto</th>
            {filas.map((f) => <th key={f.n} className="px-3 py-2 text-right font-semibold text-gray-600 min-w-[92px]">{f.mes}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y">
          {defs.map(([label, key, tipo, hi]) => (
            <tr key={key} className={hi ? 'bg-indigo-50/60 font-semibold' : 'hover:bg-gray-50'}>
              <td className={`px-3 py-1.5 text-gray-700 sticky left-0 ${hi ? 'bg-indigo-50/60 font-semibold' : 'bg-white'}`}>{label}</td>
              {filas.map((f) => (
                <td key={f.n} className="px-3 py-1.5 text-right tabular-nums text-gray-800">
                  {tipo === 'pct' ? pct(f[key]) : money(f[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CedulasFiscalesPage() {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<'isr' | 'iva'>('iva');
  const anios = aniosContables();

  const regQ = useQuery({ queryKey: ['cedula-regimen'], queryFn: () => api.getCedulaRegimen() });
  const regimen: string = regQ.data?.data?.regimen || '';
  const esPF612 = regimen === '612';

  const isrQ = useQuery({ queryKey: ['cedula-isr', anio], queryFn: () => api.getCedulaIsrPF(anio), enabled: tab === 'isr' && esPF612 });
  const ivaQ = useQuery({ queryKey: ['cedula-iva', anio], queryFn: () => api.getCedulaIva(anio), enabled: tab === 'iva' });

  const tabs: Array<['isr' | 'iva', string]> = [];
  if (esPF612) tabs.push(['isr', 'ISR (PF Act. Emp. 612)']);
  tabs.push(['iva', 'Cédula de IVA']);
  // El tab de ISR solo se ofrece a régimen 612; el default es IVA (aplica a todos).

  return (
    <div className="p-6 space-y-4 max-w-full">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileSpreadsheet size={22} className="text-emerald-700" /> Cédulas fiscales
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Papel de trabajo mensual, desde los CFDI (ingresos = emitidos, deducciones = recibidos).
          Régimen de la empresa: <b>{regimen || '—'}</b>.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input py-1.5 text-sm w-28">
          {anios.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="flex gap-1.5 flex-wrap">
          {tabs.map(([k, label], i) => (
            <button key={k} onClick={() => setTab(k)} className={`inline-flex items-center gap-1.5 ${claseOpcion(i, tab === k)}`}>{label}</button>
          ))}
        </div>
      </div>

      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-1.5">
        <Info size={14} className="mt-0.5 shrink-0" /> Primera versión: coteja los números contra tu papel de trabajo.
        Las deducciones personales, la pérdida fiscal y la base de flujo (efectivo) quedan como afinación posterior.
      </p>

      {tab === 'isr' && esPF612 && (
        isrQ.isLoading ? <p className="text-sm text-gray-500">Calculando…</p>
        : isrQ.error ? <p className="text-sm text-rose-700">{(isrQ.error as any)?.response?.data?.message || 'No se pudo calcular.'}</p>
        : isrQ.data?.data ? <TablaCedula filas={isrQ.data.data.filas} defs={FILAS_ISR} /> : null
      )}
      {tab === 'iva' && (
        ivaQ.isLoading ? <p className="text-sm text-gray-500">Calculando…</p>
        : ivaQ.error ? <p className="text-sm text-rose-700">{(ivaQ.error as any)?.response?.data?.message || 'No se pudo calcular.'}</p>
        : ivaQ.data?.data ? <TablaCedula filas={ivaQ.data.data.filas} defs={FILAS_IVA} /> : null
      )}
      {tab === 'isr' && !esPF612 && (
        <p className="text-sm text-gray-600 bg-white border rounded-lg p-4">La cédula de ISR de esta pantalla es para el régimen <b>612</b> (PF con Actividad Empresarial y Profesional). Esta empresa es <b>{regimen || 'otro régimen'}</b>. La cédula de IVA sí aplica.</p>
      )}
    </div>
  );
}

export default CedulasFiscalesPage;
