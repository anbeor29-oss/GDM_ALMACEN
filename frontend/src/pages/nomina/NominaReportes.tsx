/**
 * NominaReportes — los cuatro reportes, por rango de periodos.
 *
 * QUÉ SE VE Y QUÉ NO
 * Sólo periodos CERRADOS. Lo que todavía se puede mover no se declara, y un
 * reporte que mezclara lo cerrado con lo abierto no cuadraría contra nada —que
 * es lo único para lo que sirve un reporte de nómina—. Para ver lo abierto está
 * la prenómina.
 *
 * EL RANGO
 * Del periodo N al M: 1 a 53 en semanal, 1 a 24 en quincenal, 1 a 12 en
 * mensual. Es como se piden —"del 1 al 12", "la 24"— y como se cuadran contra
 * las declaraciones. La pantalla sólo ofrece los que de verdad están cerrados.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileBarChart, FileSpreadsheet, AlertTriangle, Users, Receipt, Landmark, HeartPulse,
} from 'lucide-react';
import api from '@/services/api';

const money = (v: any) =>
  Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const TIPOS = [
  { id: 'SEMANAL',   label: 'Semanal',   max: 53 },
  { id: 'QUINCENAL', label: 'Quincenal', max: 24 },
  { id: 'MENSUAL',   label: 'Mensual',   max: 12 },
  { id: 'ESPECIAL',  label: 'Especial',  max: 99 },
] as const;

const REPORTES = [
  { id: 'prenomina', label: 'Prenómina',      icono: Users,
    ayuda: 'El detalle de lo pagado, por trabajador y periodo.' },
  { id: 'cfdi',      label: 'Vista previa CFDI', icono: Receipt,
    ayuda: 'Qué se timbró y qué falta, con su folio fiscal.' },
  { id: 'isr',       label: 'ISR por nómina', icono: Landmark,
    ayuda: 'Lo retenido por el Art. 96, agrupado como la constancia anual.' },
  { id: 'imss',      label: 'IMSS por nómina', icono: HeartPulse,
    ayuda: 'La cuota OBRERA — sólo la parte del trabajador.' },
] as const;

export function NominaReportesPage() {
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const [tipo, setTipo] = useState<string>('SEMANAL');
  const [que, setQue] = useState<string>('prenomina');
  const [desde, setDesde] = useState(1);
  const [hasta, setHasta] = useState(1);
  const [error, setError] = useState('');

  /* Qué periodos cerrados hay. Sin esto la pantalla ofrecería "del 1 al 53"
   * cuando sólo hay ocho, y mandaría a pedir reportes vacíos. */
  const dispQ = useQuery({
    queryKey: ['reportes-periodos', anio],
    queryFn: () => api.getPeriodosParaReporte(anio),
  });
  const porTipo: Record<string, any[]> = dispQ.data?.data?.porTipo || {};
  const cerrados: any[] = porTipo[tipo] || [];

  /* El rango arranca cubriendo TODO lo cerrado de esa periodicidad: es lo que
   * se pide más seguido —el año corrido— y evita el primer clic. */
  useEffect(() => {
    if (cerrados.length === 0) return;
    setDesde(cerrados[0].numero);
    setHasta(cerrados[cerrados.length - 1].numero);
  }, [tipo, anio, dispQ.data]);

  const repQ = useQuery({
    queryKey: ['reporte-nomina', que, anio, tipo, desde, hasta],
    queryFn: () => api.getReporteNomina(que, { anio, tipo, desde, hasta }),
    enabled: cerrados.length > 0,
    retry: false,
  });
  const d: any = repQ.data?.data;

  const exportar = async () => {
    setError('');
    try {
      await api.descargarReporteNominaExcel(que, { anio, tipo, desde, hasta });
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo generar el Excel');
    }
  };

  const maxDelTipo = TIPOS.find((t) => t.id === tipo)?.max || 53;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileBarChart size={24} className="text-violet-600" /> Reportes de nómina
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Salen de los periodos <b>cerrados</b>, con los importes tal como se pagaron.
          Lo que todavía se puede mover está en Nómina.
        </p>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* ── Qué reporte ── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {REPORTES.map((r) => {
          const Ico = r.icono;
          return (
            <button
              key={r.id}
              onClick={() => setQue(r.id)}
              className={`rounded-lg border px-3 py-2.5 text-left transition ${
                que === r.id
                  ? 'border-violet-500 bg-violet-50'
                  : 'border-gray-200 bg-white hover:border-violet-300'
              }`}
            >
              <span className="flex items-center gap-2 font-medium text-sm text-gray-900">
                <Ico size={15} className="text-violet-600" /> {r.label}
              </span>
              <span className="block text-[11px] text-gray-500 mt-0.5 leading-tight">
                {r.ayuda}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── De qué periodos ── */}
      <div className="bg-white rounded-lg shadow border p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Año</label>
            <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))}
              className="border rounded-lg px-3 py-2 text-sm w-24" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Periodicidad</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm">
              {TIPOS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({(porTipo[t.id] || []).length} cerrado(s))
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Del periodo</label>
            <input type="number" min={1} max={maxDelTipo} value={desde}
              onChange={(e) => setDesde(Number(e.target.value))}
              className="border rounded-lg px-3 py-2 text-sm w-20" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">al</label>
            <input type="number" min={1} max={maxDelTipo} value={hasta}
              onChange={(e) => setHasta(Number(e.target.value))}
              className="border rounded-lg px-3 py-2 text-sm w-20" />
            <p className="text-[10px] text-gray-400 mt-0.5">de 1 a {maxDelTipo}</p>
          </div>

          <button onClick={exportar} disabled={!d}
            className="ml-auto text-sm text-emerald-700 hover:underline flex items-center gap-1 disabled:opacity-40">
            <FileSpreadsheet size={15} /> Excel
          </button>
        </div>

        {cerrados.length === 0 && !dispQ.isLoading && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            No hay periodos {tipo.toLowerCase()}es cerrados en {anio}. Un reporte sale de lo
            cerrado: cierra el periodo en Nómina y aparecerá aquí.
          </p>
        )}
      </div>

      {/* ── El reporte ── */}
      {repQ.isLoading && <p className="text-sm text-gray-500">Reuniendo los periodos…</p>}
      {repQ.isError && (
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          {(repQ.error as any)?.response?.data?.message || 'No se pudo armar el reporte'}
        </p>
      )}

      {d && que === 'prenomina' && <TablaPrenomina d={d} />}
      {d && que === 'cfdi'      && <TablaCfdi d={d} />}
      {d && que === 'isr'       && <TablaIsr d={d} />}
      {d && que === 'imss'      && <TablaImss d={d} />}
    </div>
  );
}

/* ── Las cuatro tablas ─────────────────────────────────────────────── */

function Caja({ children }: any) {
  return <div className="bg-white rounded-lg shadow overflow-x-auto">{children}</div>;
}

function TablaPrenomina({ d }: any) {
  const t = d.totales;
  return (
    <Caja>
      <table className="w-full text-xs tabular-nums">
        <thead className="bg-gray-50 border-b text-gray-600">
          <tr>
            <th className="px-2 py-2 text-center w-14">Periodo</th>
            <th className="px-2 py-2 text-left">Trabajador</th>
            <th className="px-2 py-2 text-center w-12">Días</th>
            <th className="px-2 py-2 text-right w-24">Percepciones</th>
            <th className="px-2 py-2 text-right w-24">Gravado</th>
            <th className="px-2 py-2 text-right w-24">Exento</th>
            <th className="px-2 py-2 text-right w-20">IMSS</th>
            <th className="px-2 py-2 text-right w-20">ISR</th>
            <th className="px-2 py-2 text-right w-24">Neto</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {d.renglones.map((r: any, i: number) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-2 py-1 text-center">#{r.periodo}</td>
              <td className="px-2 py-1">
                {r.nombre}
                <span className="text-gray-400 ml-1.5">{r.num_empleado}</span>
              </td>
              <td className="px-2 py-1 text-center">{r.dias}</td>
              <td className="px-2 py-1 text-right">{money(r.total_percepciones)}</td>
              <td className="px-2 py-1 text-right">{money(r.total_gravado)}</td>
              <td className="px-2 py-1 text-right text-emerald-700">{money(r.total_exento)}</td>
              <td className="px-2 py-1 text-right text-rose-700">{money(r.imss)}</td>
              <td className="px-2 py-1 text-right text-rose-700">{money(r.isr)}</td>
              <td className="px-2 py-1 text-right font-semibold">{money(r.neto)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50 border-t-2 font-semibold">
          <tr>
            <td className="px-2 py-2" colSpan={3}>{t.renglones} recibo(s)</td>
            <td className="px-2 py-2 text-right">{money(t.percepciones)}</td>
            <td className="px-2 py-2 text-right">{money(t.gravado)}</td>
            <td className="px-2 py-2 text-right text-emerald-700">{money(t.exento)}</td>
            <td className="px-2 py-2 text-right text-rose-700">{money(t.imss)}</td>
            <td className="px-2 py-2 text-right text-rose-700">{money(t.isr)}</td>
            <td className="px-2 py-2 text-right">{money(t.neto)}</td>
          </tr>
        </tfoot>
      </table>
    </Caja>
  );
}

function TablaCfdi({ d }: any) {
  const t = d.totales;
  return (
    <>
      {t.sinTimbrar > 0 && (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            <b>{t.sinTimbrar}</b> recibo(s) sin timbrar en este rango. Una retención declarada
            sin CFDI que la ampare es lo que el SAT reclama en una revisión.
          </span>
        </p>
      )}
      <Caja>
        <table className="w-full text-xs tabular-nums">
          <thead className="bg-gray-50 border-b text-gray-600">
            <tr>
              <th className="px-2 py-2 text-center w-14">Periodo</th>
              <th className="px-2 py-2 text-left">Trabajador</th>
              <th className="px-2 py-2 text-left">Folio fiscal (UUID)</th>
              <th className="px-2 py-2 text-left w-32">Timbrado</th>
              <th className="px-2 py-2 text-right w-24">Neto</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {d.renglones.map((r: any, i: number) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-2 py-1 text-center">#{r.periodo}</td>
                <td className="px-2 py-1">
                  {r.nombre}<span className="text-gray-400 ml-1.5">{r.num_empleado}</span>
                </td>
                <td className="px-2 py-1">
                  {r.uuid
                    ? <span className="font-mono text-[11px] select-all break-all">{r.uuid}</span>
                    : <span className="text-amber-700 italic">sin timbrar</span>}
                </td>
                <td className="px-2 py-1 text-gray-500">{r.timbrado_at || '—'}</td>
                <td className="px-2 py-1 text-right font-semibold">{money(r.neto)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 font-semibold">
            <tr>
              <td className="px-2 py-2" colSpan={2}>
                {t.recibos} recibo(s) · {t.timbrados} timbrado(s)
              </td>
              <td className="px-2 py-2 text-amber-700" colSpan={2}>
                {t.sinTimbrar > 0 ? `${t.sinTimbrar} sin timbrar` : 'todos timbrados'}
              </td>
              <td className="px-2 py-2 text-right">{money(t.neto)}</td>
            </tr>
          </tfoot>
        </table>
      </Caja>
    </>
  );
}

function TablaIsr({ d }: any) {
  const t = d.totales;
  return (
    <>
      <Caja>
        <table className="w-full text-xs tabular-nums">
          <thead className="bg-gray-50 border-b text-gray-600">
            <tr>
              <th className="px-2 py-2 text-left">Trabajador</th>
              <th className="px-2 py-2 text-left w-32">RFC</th>
              <th className="px-2 py-2 text-center w-16">Periodos</th>
              <th className="px-2 py-2 text-right w-28">Gravado</th>
              <th className="px-2 py-2 text-right w-28">Exento</th>
              <th className="px-2 py-2 text-right w-24">ISR retenido</th>
              <th className="px-2 py-2 text-right w-24">Subsidio</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {d.renglones.map((r: any, i: number) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-2 py-1">
                  {r.nombre}<span className="text-gray-400 ml-1.5">{r.num_empleado}</span>
                </td>
                <td className="px-2 py-1 font-mono text-[11px]">{r.rfc}</td>
                <td className="px-2 py-1 text-center">{r.periodos}</td>
                <td className="px-2 py-1 text-right">{money(r.gravado)}</td>
                <td className="px-2 py-1 text-right text-emerald-700">{money(r.exento)}</td>
                <td className="px-2 py-1 text-right text-rose-700 font-semibold">{money(r.isr)}</td>
                <td className="px-2 py-1 text-right text-sky-700">{money(r.subsidio)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 font-semibold">
            <tr>
              <td className="px-2 py-2" colSpan={3}>{t.trabajadores} trabajador(es)</td>
              <td className="px-2 py-2 text-right">{money(t.gravado)}</td>
              <td className="px-2 py-2 text-right text-emerald-700">{money(t.exento)}</td>
              <td className="px-2 py-2 text-right text-rose-700">{money(t.isr)}</td>
              <td className="px-2 py-2 text-right text-sky-700">{money(t.subsidio)}</td>
            </tr>
          </tfoot>
        </table>
      </Caja>

      <p className="text-xs text-gray-500">
        El <b>subsidio</b> va aparte porque no es una retención: es dinero que se le
        entregó al trabajador y que el patrón acredita.
      </p>

      <PorPeriodo filas={d.porPeriodo} columnas={[
        ['gravado', 'Gravado'], ['isr', 'ISR'], ['subsidio', 'Subsidio'],
      ]} />
    </>
  );
}

function TablaImss({ d }: any) {
  const t = d.totales;
  return (
    <>
      <Caja>
        <table className="w-full text-xs tabular-nums">
          <thead className="bg-gray-50 border-b text-gray-600">
            <tr>
              <th className="px-2 py-2 text-left">Trabajador</th>
              <th className="px-2 py-2 text-left w-32">NSS</th>
              <th className="px-2 py-2 text-center w-16">Periodos</th>
              <th className="px-2 py-2 text-center w-16">Días</th>
              <th className="px-2 py-2 text-right w-28">Cuota obrera</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {d.renglones.map((r: any, i: number) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-2 py-1">
                  {r.nombre}<span className="text-gray-400 ml-1.5">{r.num_empleado}</span>
                </td>
                <td className="px-2 py-1 font-mono text-[11px]">{r.nss || '—'}</td>
                <td className="px-2 py-1 text-center">{r.periodos}</td>
                <td className="px-2 py-1 text-center">{r.dias}</td>
                <td className="px-2 py-1 text-right text-rose-700 font-semibold">
                  {Number(r.imss) > 0
                    ? money(r.imss)
                    : <span className="text-gray-400 font-normal">exento</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 font-semibold">
            <tr>
              <td className="px-2 py-2" colSpan={3}>{t.trabajadores} trabajador(es)</td>
              <td className="px-2 py-2 text-center">{t.dias}</td>
              <td className="px-2 py-2 text-right text-rose-700">{money(t.imss)}</td>
            </tr>
          </tfoot>
        </table>
      </Caja>

      <p className="text-xs text-gray-500">
        Es la cuota <b>obrera</b>: sólo la parte del trabajador. La patronal no la calcula
        este sistema, y por eso no aparece — ponerla en cero haría creer que es cero.
        {t.sinCuota > 0 && (
          <> Los <b>{t.sinCuota}</b> marcados como exentos ganan el salario mínimo: el
          Art. 36 LSS pone su cuota en cero y la absorbe el patrón.</>
        )}
      </p>

      <PorPeriodo filas={d.porPeriodo} columnas={[['dias', 'Días'], ['imss', 'Cuota obrera']]} />
    </>
  );
}

/**
 * El corte por periodo. Es contra lo que se paga cada mes, así que va debajo
 * del detalle por trabajador y no en otra pantalla.
 */
function PorPeriodo({ filas, columnas }: { filas: any[]; columnas: Array<[string, string]> }) {
  if (!filas?.length) return null;
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <p className="px-3 py-2 text-sm font-medium text-slate-700 border-b">Por periodo</p>
      <table className="w-full text-xs tabular-nums">
        <thead className="bg-gray-50 border-b text-gray-600">
          <tr>
            <th className="px-2 py-1.5 text-center w-16">Periodo</th>
            <th className="px-2 py-1.5 text-left w-28">Termina</th>
            <th className="px-2 py-1.5 text-center w-24">Trabajadores</th>
            {columnas.map(([, t]) => (
              <th key={t} className="px-2 py-1.5 text-right w-28">{t}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {filas.map((r: any, i: number) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-2 py-1 text-center">#{r.periodo}</td>
              <td className="px-2 py-1 text-gray-500">{r.fecha_fin}</td>
              <td className="px-2 py-1 text-center">{r.trabajadores}</td>
              {columnas.map(([k]) => (
                <td key={k} className="px-2 py-1 text-right">
                  {k === 'dias' ? r[k] : money(r[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default NominaReportesPage;
