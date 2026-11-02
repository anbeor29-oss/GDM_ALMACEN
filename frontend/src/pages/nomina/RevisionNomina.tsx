/**
 * RevisiónNómina — revisión ANUAL de los recibos de nómina del cliente.
 *
 * Etapa 1 (esta): se arma la base del año desde la bóveda (los recibos EMITIDOS
 * tipo N que la descarga del SAT ya guardó) y se organiza por TRABAJADOR, MES y
 * SEMANA, con sus acumulados. Es la base —ordenada por fecha → RFC— para la
 * revisión de cálculos (ISR, IMSS, Infonavit) que viene en la siguiente etapa.
 *
 * Los XML se descargan en «XML del SAT»; aquí se LEEN los ya respaldados.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Scale, Info } from 'lucide-react';
import api from '@/services/api';
import { claseOpcion } from '@/utils/coloresOpciones';
import { aTextoMx } from '@/components/CampoFecha';

const money = (n: any) => Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const SUBTABS: Array<[string, string]> = [
  ['trabajador', 'Por trabajador'],
  ['mes', 'Por mes'],
  ['semana', 'Por semana'],
  ['recibos', 'Recibos'],
];

export function RevisionNominaPage() {
  const aniosQ = useQuery({ queryKey: ['revision-nom-anios'], queryFn: () => api.getRevisionNominaAnios() });
  const anios: number[] = aniosQ.data?.data || [];
  const [anioSel, setAnioSel] = useState<number | null>(null);
  const anio = anioSel ?? anios[0] ?? null;

  const q = useQuery({
    queryKey: ['revision-nom', anio],
    queryFn: () => api.getRevisionNominaAnual(anio as number),
    enabled: !!anio,
  });
  const d: any = q.data?.data;
  const [sub, setSub] = useState('trabajador');

  const t = d?.totales;
  const sinAnios = !aniosQ.isLoading && anios.length === 0;

  const tituloSub = useMemo(() => SUBTABS.find((s) => s[0] === sub)?.[1] || '', [sub]);

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ClipboardCheck size={22} className="text-violet-600" /> Revisión de nómina
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Arma la base del año con los recibos de nómina emitidos (ya descargados del SAT) y los organiza por
          trabajador, mes y semana. Es el paso previo a revisar los cálculos de ISR, IMSS e Infonavit.
        </p>
      </div>

      {/* Año a revisar */}
      <div className="bg-white rounded-lg shadow border p-4 flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Año a revisar</span>
          <select value={anio ?? ''} onChange={(e) => setAnioSel(Number(e.target.value))}
            disabled={sinAnios}
            className="border rounded-lg px-3 py-2 text-sm min-w-[8rem]">
            {anios.length === 0 && <option value="">—</option>}
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        {d && (
          <p className="text-xs text-gray-500">
            <b className="text-gray-800">{d.totalRecibos}</b> recibos ·{' '}
            <b className="text-gray-800">{t?.trabajadores}</b> trabajadores en {d.anio}
          </p>
        )}
      </div>

      {sinAnios && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex items-start gap-2">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>
            No hay recibos de nómina emitidos en la bóveda. Descárgalos primero en <b>XML del SAT</b> (emitidos,
            tipo Nómina) del año que quieras revisar; al terminar aparecerán aquí.
          </span>
        </div>
      )}

      {q.isLoading && <p className="text-center text-gray-500 py-10">Armando la base del año…</p>}

      {d && (
        <>
          {/* Totales del año */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <TotCard label="Percepciones" value={money(t.percepciones)} tono="sky" />
            <TotCard label="Gravado" value={money(t.gravado)} tono="slate" />
            <TotCard label="ISR" value={money(t.isr)} tono="violet" />
            <TotCard label="IMSS" value={money(t.imss)} tono="amber" />
            <TotCard label="Infonavit" value={money(t.infonavit)} tono="rose" />
            <TotCard label="Neto pagado" value={money(t.neto)} tono="emerald" />
          </div>

          {/* Nota de la etapa siguiente (recálculo legal) */}
          <div className="rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-2 text-xs text-violet-900 flex items-start gap-2">
            <Scale size={15} className="mt-0.5 shrink-0 text-violet-600" />
            <p>
              Siguiente etapa: <b>revisión de cálculos</b> — recalcular ISR (LISR Art. 96/subsidio), IMSS (LSS) e
              Infonavit por mes y marcar diferencias contra lo timbrado, con reporte de datos originales vs. recalculados.
            </p>
          </div>

          {/* Pestañas */}
          <div className="flex flex-wrap gap-2">
            {SUBTABS.map(([k, label], i) => (
              <button key={k} onClick={() => setSub(k)} className={claseOpcion(i, sub === k)}>{label}</button>
            ))}
          </div>

          <div className="bg-white rounded-lg shadow border overflow-x-auto">
            {sub === 'trabajador' && <TablaTrabajadores filas={d.trabajadores} />}
            {sub === 'mes' && <TablaMeses filas={d.porMes} />}
            {sub === 'semana' && <TablaSemanas filas={d.porSemana} />}
            {sub === 'recibos' && <TablaRecibos filas={d.recibos} />}
          </div>
          <p className="text-[11px] text-gray-400">{tituloSub} · {d.anio}</p>
        </>
      )}
    </div>
  );
}

function TotCard({ label, value, tono }: { label: string; value: string; tono: string }) {
  const barra: Record<string, string> = {
    sky: 'bg-sky-500', slate: 'bg-slate-400', violet: 'bg-violet-500',
    amber: 'bg-amber-500', rose: 'bg-rose-500', emerald: 'bg-emerald-500',
  };
  return (
    <div className="relative bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className={`h-1 ${barra[tono]}`} />
      <div className="p-3">
        <p className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</p>
        <p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5 truncate">{value}</p>
      </div>
    </div>
  );
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={`px-3 py-2 text-xs font-semibold text-gray-600 ${right ? 'text-right' : 'text-left'}`}>{children}</th>
);
const Td = ({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) => (
  <td className={`px-3 py-1.5 text-sm ${right ? 'text-right tabular-nums' : ''} ${mono ? 'font-mono text-xs' : ''}`}>{children}</td>
);

function TablaTrabajadores({ filas }: { filas: any[] }) {
  if (!filas?.length) return <Vacia />;
  return (
    <table className="w-full min-w-[720px]">
      <thead className="bg-emerald-50/60 border-b border-emerald-200">
        <tr>
          <Th>Trabajador</Th><Th>RFC</Th><Th right>Recibos</Th><Th right>Percepciones</Th>
          <Th right>Gravado</Th><Th right>ISR</Th><Th right>IMSS</Th><Th right>Infonavit</Th><Th right>Neto</Th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {filas.map((f, i) => (
          <tr key={f.rfc || i} className="hover:bg-gray-50">
            <Td>{f.nombre || '—'}</Td>
            <Td mono>{f.rfc || '—'}</Td>
            <Td right>{f.recibos}</Td>
            <Td right>{money(f.percepciones)}</Td>
            <Td right>{money(f.gravado)}</Td>
            <Td right>{money(f.isr)}</Td>
            <Td right>{money(f.imss)}</Td>
            <Td right>{money(f.infonavit)}</Td>
            <Td right>{money(f.neto)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TablaMeses({ filas }: { filas: any[] }) {
  if (!filas?.length) return <Vacia />;
  return (
    <table className="w-full min-w-[640px]">
      <thead className="bg-emerald-50/60 border-b border-emerald-200">
        <tr><Th>Mes</Th><Th right>Recibos</Th><Th right>Percepciones</Th><Th right>Gravado</Th><Th right>ISR</Th><Th right>IMSS</Th><Th right>Infonavit</Th><Th right>Neto</Th></tr>
      </thead>
      <tbody className="divide-y">
        {filas.map((f) => (
          <tr key={f.mes} className="hover:bg-gray-50">
            <Td>{f.nombreMes}</Td><Td right>{f.recibos}</Td><Td right>{money(f.percepciones)}</Td>
            <Td right>{money(f.gravado)}</Td><Td right>{money(f.isr)}</Td><Td right>{money(f.imss)}</Td>
            <Td right>{money(f.infonavit)}</Td><Td right>{money(f.neto)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TablaSemanas({ filas }: { filas: any[] }) {
  if (!filas?.length) return <Vacia />;
  return (
    <table className="w-full min-w-[600px]">
      <thead className="bg-emerald-50/60 border-b border-emerald-200">
        <tr><Th>Semana ISO</Th><Th right>Recibos</Th><Th right>Percepciones</Th><Th right>ISR</Th><Th right>IMSS</Th><Th right>Infonavit</Th><Th right>Neto</Th></tr>
      </thead>
      <tbody className="divide-y">
        {filas.map((f) => (
          <tr key={f.semana} className="hover:bg-gray-50">
            <Td>Semana {f.semana}</Td><Td right>{f.recibos}</Td><Td right>{money(f.percepciones)}</Td>
            <Td right>{money(f.isr)}</Td><Td right>{money(f.imss)}</Td><Td right>{money(f.infonavit)}</Td><Td right>{money(f.neto)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TablaRecibos({ filas }: { filas: any[] }) {
  if (!filas?.length) return <Vacia />;
  return (
    <table className="w-full min-w-[840px]">
      <thead className="bg-emerald-50/60 border-b border-emerald-200">
        <tr><Th>Fecha pago</Th><Th>Trabajador</Th><Th>RFC</Th><Th>UUID</Th><Th right>Percepciones</Th><Th right>ISR</Th><Th right>IMSS</Th><Th right>Infonavit</Th><Th right>Neto</Th></tr>
      </thead>
      <tbody className="divide-y">
        {filas.map((f) => (
          <tr key={f.uuid} className="hover:bg-gray-50">
            <Td>{aTextoMx(f.fechaPago)}</Td>
            <Td>{f.nombreTrabajador || '—'}</Td>
            <Td mono>{f.rfcTrabajador || '—'}</Td>
            <Td mono>{String(f.uuid).slice(0, 8)}…</Td>
            <Td right>{money(f.percepciones)}</Td>
            <Td right>{money(f.isr)}</Td>
            <Td right>{money(f.imss)}</Td>
            <Td right>{money(f.infonavit)}</Td>
            <Td right>{money(f.neto)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Vacia() {
  return <p className="text-sm text-gray-500 italic p-6 text-center">Sin datos para este año.</p>;
}

export default RevisionNominaPage;
