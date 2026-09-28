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

type Def = [string, string, ('money' | 'pct' | 'coef')?, boolean?];

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
const FILAS_RESICO: Def[] = [
  ['Ingresos cobrados del mes', 'ingreso'],
  ['(×) Tasa RESICO', 'tasa', 'pct'],
  ['(=) ISR determinado', 'isrDeterminado', 'money', true],
  ['(−) ISR retenido (1.25%)', 'isrRetenido'],
  ['(=) ISR POR PAGAR', 'isrPorPagar', 'money', true],
];
const FILAS_PM: Def[] = [
  ['Ingreso nominal del mes', 'ingresoMes'],
  ['(=) Ingreso nominal acum.', 'ingresoAcum'],
  ['(×) Coeficiente de utilidad', 'coeficiente', 'coef'],
  ['(=) Utilidad estimada', 'utilidad'],
  ['(×) Tasa ISR', 'tasa', 'pct'],
  ['(=) ISR determinado', 'isrDeterminado', 'money', true],
  ['(−) Pagos prov. previos', 'pagosProvPrevios'],
  ['(−) ISR retenido acum.', 'isrRetenidoAcum'],
  ['(=) ISR POR PAGAR', 'isrPorPagar', 'money', true],
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
                  {tipo === 'pct' ? pct(f[key]) : tipo === 'coef' ? (Number(f[key]) || 0).toFixed(4) : money(f[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Plataformas Digitales (625): captura el ingreso cobrado por actividad y mes; el
 * ISR retenido (tasa Art. 113-A) y el IVA (16 % causado, 8 % retenido) se calculan. */
function PanelPlataformas({ anio }: { anio: number }) {
  const q = useQuery({ queryKey: ['cedula-plataformas', anio], queryFn: () => api.getCedulaPlataformas(anio) });
  const actividades: any[] = q.data?.data?.actividades || [];
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const valorIngreso = (clave: string, m: number, capt: number) => {
    const k = `${clave}|${m}`;
    return edit[k] !== undefined ? edit[k] : (capt ? String(capt) : '');
  };
  const num = (clave: string, m: number, capt: number) => Number(valorIngreso(clave, m, capt)) || 0;

  const guardar = async () => {
    setBusy(true); setMsg('');
    try {
      const filas: Array<{ mes: number; actividad: string; ingreso: number }> = [];
      for (const act of actividades) for (const f of act.filas) filas.push({ mes: f.n, actividad: act.clave, ingreso: num(act.clave, f.n, f.ingreso) });
      await api.setCedulaPlataformas(anio, filas);
      setEdit({}); await q.refetch(); setMsg('Guardado.');
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };

  if (q.isLoading) return <p className="text-sm text-gray-500">Cargando…</p>;
  const th = 'px-3 py-1.5 text-right font-semibold text-gray-600 min-w-[84px]';
  const c0 = 'px-3 py-1.5 text-gray-700 sticky left-0 bg-white min-w-[160px]';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={guardar} disabled={busy}
          className="bg-primary text-white px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
          {busy ? 'Guardando…' : 'Guardar ingresos'}
        </button>
        {msg && <span className="text-sm text-emerald-700">{msg}</span>}
        <span className="text-xs text-gray-400">Captura el ingreso cobrado por actividad; el ISR retenido y el IVA se calculan.</span>
      </div>
      {actividades.map((act) => (
        <div key={act.clave} className="bg-white rounded-lg shadow overflow-x-auto">
          <div className="px-3 py-2 bg-gray-50 border-b text-sm font-semibold text-gray-800">
            {act.nombre} <span className="text-xs font-normal text-gray-500">· retención ISR {(act.tasaIsr * 100).toFixed(1)}%</span>
          </div>
          <table className="w-full text-xs">
            <thead className="border-b">
              <tr>
                <th className="px-3 py-1.5 text-left font-semibold text-gray-700 sticky left-0 bg-white min-w-[160px]">Concepto</th>
                {act.filas.map((f: any) => <th key={f.n} className={th}>{f.mes}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className={c0}>Ingreso cobrado</td>
                {act.filas.map((f: any) => (
                  <td key={f.n} className="px-1 py-1">
                    <input value={valorIngreso(act.clave, f.n, f.ingreso)}
                      onChange={(e) => setEdit({ ...edit, [`${act.clave}|${f.n}`]: e.target.value })}
                      className="input py-1 text-xs w-20 text-right" />
                  </td>
                ))}
              </tr>
              <tr className="bg-indigo-50/60 font-semibold">
                <td className={`${c0} bg-indigo-50/60`}>ISR retenido</td>
                {act.filas.map((f: any) => <td key={f.n} className="px-3 py-1.5 text-right tabular-nums">{money(num(act.clave, f.n, f.ingreso) * act.tasaIsr)}</td>)}
              </tr>
              <tr>
                <td className={c0}>IVA causado 16%</td>
                {act.filas.map((f: any) => <td key={f.n} className="px-3 py-1.5 text-right tabular-nums">{money(num(act.clave, f.n, f.ingreso) * 0.16)}</td>)}
              </tr>
              <tr>
                <td className={c0}>IVA retenido 8%</td>
                {act.filas.map((f: any) => <td key={f.n} className="px-3 py-1.5 text-right tabular-nums">{money(num(act.clave, f.n, f.ingreso) * 0.08)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function CedulasFiscalesPage() {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<'isr' | 'resico' | 'pm' | 'plat' | 'iva'>('iva');
  const [coefInput, setCoefInput] = useState('');
  const anios = aniosContables();

  const regQ = useQuery({ queryKey: ['cedula-regimen'], queryFn: () => api.getCedulaRegimen() });
  const regimen: string = regQ.data?.data?.regimen || '';
  const esPF612 = regimen === '612';
  const esRESICO = regimen === '626';
  const esPM601 = regimen === '601';
  const esPlataformas = regimen === '625';

  // Las cédulas se calculan desde los CFDI sin importar el régimen: enable solo
  // por el tab activo, para poder desplegarlas todas y ver el panorama completo.
  const isrQ = useQuery({ queryKey: ['cedula-isr', anio], queryFn: () => api.getCedulaIsrPF(anio), enabled: tab === 'isr' });
  const resicoQ = useQuery({ queryKey: ['cedula-resico', anio], queryFn: () => api.getCedulaResico(anio), enabled: tab === 'resico' });
  const pmQ = useQuery({ queryKey: ['cedula-pm', anio], queryFn: () => api.getCedulaPM601(anio), enabled: tab === 'pm' });
  const ivaQ = useQuery({ queryKey: ['cedula-iva', anio], queryFn: () => api.getCedulaIva(anio), enabled: tab === 'iva' });

  const guardarCoef = async () => {
    await api.setCoeficienteUtilidad(anio, Number(coefInput) || 0);
    setCoefInput('');
    pmQ.refetch();
  };

  // Antes cada cédula de ISR aparecía solo si la empresa era de ese régimen.
  // Ahora se despliegan TODAS para dar el panorama de lo que se procesa; la que
  // corresponde al régimen de la empresa va marcada con un punto verde. El
  // default sigue siendo IVA (aplica a todos los regímenes).
  const tabs: Array<{ k: 'isr' | 'resico' | 'pm' | 'plat' | 'iva'; label: string; propio: boolean }> = [
    { k: 'isr',    label: 'ISR (PF Act. Emp. 612)',   propio: esPF612 },
    { k: 'resico', label: 'ISR RESICO (626)',         propio: esRESICO },
    { k: 'pm',     label: 'ISR PM (601, coeficiente)', propio: esPM601 },
    { k: 'plat',   label: 'Plataformas (625)',         propio: esPlataformas },
    { k: 'iva',    label: 'Cédula de IVA',             propio: false },
  ];

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
          {tabs.map((t, i) => (
            <button key={t.k} onClick={() => setTab(t.k)} className={`inline-flex items-center gap-1.5 ${claseOpcion(i, tab === t.k)}`}>
              {t.label}
              {t.propio && <span title="Régimen de tu empresa" className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shrink-0" />}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-1.5">
        <Info size={14} className="mt-0.5 shrink-0" /> Se muestran <b>todas</b> las cédulas de ISR para dar el panorama;
        la que aplica oficialmente a esta empresa es la de su régimen (<span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 align-middle" /> punto verde).
        Base de <b>flujo de efectivo</b> (lo cobrado/pagado: PUE al emitir, PPD por su complemento de pago). Primera versión —
        coteja los números contra tu papel de trabajo; las deducciones personales, la pérdida fiscal y el desglose por tasa
        del complemento quedan como afinación posterior.
      </p>

      {tab === 'isr' && (
        isrQ.isLoading ? <p className="text-sm text-gray-500">Calculando…</p>
        : isrQ.error ? <p className="text-sm text-rose-700">{(isrQ.error as any)?.response?.data?.message || 'No se pudo calcular.'}</p>
        : isrQ.data?.data ? <TablaCedula filas={isrQ.data.data.filas} defs={FILAS_ISR} /> : null
      )}
      {tab === 'resico' && (
        resicoQ.isLoading ? <p className="text-sm text-gray-500">Calculando…</p>
        : resicoQ.error ? <p className="text-sm text-rose-700">{(resicoQ.error as any)?.response?.data?.message || 'No se pudo calcular.'}</p>
        : resicoQ.data?.data ? <TablaCedula filas={resicoQ.data.data.filas} defs={FILAS_RESICO} /> : null
      )}
      {tab === 'pm' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 bg-gray-50 border rounded-lg px-3 py-2">
            <span className="text-sm text-gray-600">
              Coeficiente de utilidad {anio}: <b>{(Number(pmQ.data?.data?.coeficiente) || 0).toFixed(4)}</b>
              {(!pmQ.data?.data?.coeficiente) && <span className="text-amber-700"> — captúralo (sin él el ISR sale en cero)</span>}
            </span>
            <input value={coefInput} onChange={(e) => setCoefInput(e.target.value)} placeholder="0.1234"
              className="input py-1 text-sm w-28 font-mono" />
            <button onClick={guardarCoef} disabled={coefInput === ''}
              className="border border-emerald-300 text-emerald-700 px-3 py-1 rounded-lg hover:bg-emerald-50 text-sm disabled:opacity-50">Guardar coeficiente</button>
            <span className="text-xs text-gray-400">(sale de la declaración anual anterior: utilidad fiscal ÷ ingresos nominales)</span>
          </div>
          {pmQ.isLoading ? <p className="text-sm text-gray-500">Calculando…</p>
          : pmQ.error ? <p className="text-sm text-rose-700">{(pmQ.error as any)?.response?.data?.message || 'No se pudo calcular.'}</p>
          : pmQ.data?.data ? <TablaCedula filas={pmQ.data.data.filas} defs={FILAS_PM} /> : null}
        </div>
      )}
      {tab === 'plat' && <PanelPlataformas anio={anio} />}
      {tab === 'iva' && (
        ivaQ.isLoading ? <p className="text-sm text-gray-500">Calculando…</p>
        : ivaQ.error ? <p className="text-sm text-rose-700">{(ivaQ.error as any)?.response?.data?.message || 'No se pudo calcular.'}</p>
        : ivaQ.data?.data ? <TablaCedula filas={ivaQ.data.data.filas} defs={FILAS_IVA} /> : null
      )}
    </div>
  );
}

export default CedulasFiscalesPage;
