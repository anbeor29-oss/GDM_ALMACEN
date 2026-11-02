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
  ['isr', 'Revisión ISR'],
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

  /* El recálculo del ISR se pide aparte y sólo cuando se abre su pestaña: es un
   * cotejo más pesado (recalcula con la tarifa del Art. 96) y no todos lo miran. */
  const isrQ = useQuery({
    queryKey: ['revision-nom-isr', anio],
    queryFn: () => api.getRevisionNominaIsr(anio as number),
    enabled: !!anio && sub === 'isr',
  });
  const isr: any = isrQ.data?.data;

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

          {sub !== 'isr' && (
            <>
              <div className="bg-white rounded-lg shadow border overflow-x-auto">
                {sub === 'trabajador' && <TablaTrabajadores filas={d.trabajadores} />}
                {sub === 'mes' && <TablaMeses filas={d.porMes} />}
                {sub === 'semana' && <TablaSemanas filas={d.porSemana} />}
                {sub === 'recibos' && <TablaRecibos filas={d.recibos} />}
              </div>
              <p className="text-[11px] text-gray-400">{tituloSub} · {d.anio}</p>
            </>
          )}

          {sub === 'isr' && (
            <div className="space-y-3">
              {isrQ.isLoading && <p className="text-center text-gray-500 py-8">Recalculando el ISR mensual…</p>}
              {isr?.aviso && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
                  <Info size={16} className="mt-0.5 shrink-0" /><span>{isr.aviso}</span>
                </div>
              )}
              {isr && !isr.aviso && (
                <>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                    <span className="text-gray-600">Meses-trabajador: <b className="text-gray-900">{isr.resumen.meses}</b></span>
                    <span className={isr.resumen.conDiferencia ? 'text-rose-700' : 'text-emerald-700'}>
                      Con diferencia relevante: <b>{isr.resumen.conDiferencia}</b>
                    </span>
                    <span className="text-gray-600">Diferencia neta: <b className={isr.resumen.totalDiferencia ? 'text-rose-700' : 'text-emerald-700'}>{money(isr.resumen.totalDiferencia)}</b></span>
                    <span className="ml-auto text-[11px] text-gray-400">Tarifa Art. 96 · {isr.anioParametros}</span>
                  </div>
                  <div className="bg-white rounded-lg shadow border overflow-x-auto">
                    <TablaIsr filas={isr.filas} />
                  </div>
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    «Art. 96 bruto» = tarifa mensual sobre el gravado del mes; «Art. 96 neto» = ya con el subsidio
                    al empleo. El ISR retenido (deducción 002) debe coincidir con una de las dos; la <b>diferencia</b>
                    es contra la más cercana (+ faltó retener · − se retuvo de más). Como la retención por periodo
                    (quincenal/semanal) no coincide exacto con la mensual, se <b>resaltan</b> sólo las relevantes
                    (&gt; $1 y &gt; 1 %). Los asimilados se recalculan sin subsidio.
                  </p>
                </>
              )}
            </div>
          )}
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

function TablaIsr({ filas }: { filas: any[] }) {
  if (!filas?.length) return <Vacia />;
  return (
    <table className="w-full min-w-[920px]">
      <thead className="bg-emerald-50/60 border-b border-emerald-200">
        <tr>
          <Th>Trabajador</Th><Th>Mes</Th><Th right>Gravado mes</Th>
          <Th right>ISR retenido</Th><Th right>Subsidio</Th>
          <Th right>Art. 96 bruto</Th><Th right>Art. 96 neto</Th><Th right>Diferencia</Th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {filas.map((f, i) => (
          <tr key={`${f.rfc}-${f.mes}-${i}`} className={f.marca ? 'bg-rose-50' : 'hover:bg-gray-50'}>
            <Td>
              {f.nombre || f.rfc || '—'}
              {f.asimilado && <span className="ml-1.5 text-[9px] font-semibold uppercase bg-slate-100 text-slate-600 px-1 py-0.5 rounded">asimilado</span>}
            </Td>
            <Td>{f.nombreMes}</Td>
            <Td right>{money(f.gravado)}</Td>
            <Td right>{money(f.isrRetenido)}</Td>
            <Td right>{money(f.subsidio)}</Td>
            <Td right>{money(f.isrBrutoTabla)}</Td>
            <Td right>{money(f.isrNetoTabla)}</Td>
            <td className={`px-3 py-1.5 text-sm text-right tabular-nums font-semibold ${
              f.marca ? 'text-rose-700' : Math.abs(f.diferencia) < 0.01 ? 'text-emerald-700' : 'text-gray-500'}`}>
              {money(f.diferencia)}
            </td>
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
