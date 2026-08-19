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
  Sigma, List,
} from 'lucide-react';
import api from '@/services/api';
import { aTextoMx } from '@/components/CampoFecha';

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
  /* Con un solo periodo acumular y detallar dan lo mismo, así que el modo
   * sólo se ofrece —y sólo importa— cuando el rango abarca varios. */
  const [acumulado, setAcumulado] = useState(true);

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
    queryKey: ['reporte-nomina', que, anio, tipo, desde, hasta, acumulado],
    queryFn: () => api.getReporteNomina(que, { anio, tipo, desde, hasta, acumulado }),
    enabled: cerrados.length > 0,
    retry: false,
  });
  const d: any = repQ.data?.data;

  const exportar = async () => {
    setError('');
    try {
      await api.descargarReporteNominaExcel(que, { anio, tipo, desde, hasta, acumulado });
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo generar el Excel');
    }
  };

  const maxDelTipo = TIPOS.find((t) => t.id === tipo)?.max || 53;
  const varios = hasta > desde;

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

          {/* ── Acumulado o detalle ──
              Pedir "de la 32 a la 34" y recibir tres renglones de cada quien
              obliga a sumar a mano lo que el reporte ya sabe. Por eso el
              acumulado es lo primero que se ve; el detalle sigue a un clic. */}
          {que === 'prenomina' && varios && (
            <div className="flex rounded-lg border overflow-hidden text-xs">
              <button
                onClick={() => setAcumulado(true)}
                className={`px-3 py-2 transition ${
                  acumulado ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
                title={`Un renglón por trabajador, con los ${hasta - desde + 1} periodos sumados`}
              >
                <Sigma size={13} className="inline mr-1 -mt-0.5" />
                Acumulado
              </button>
              <button
                onClick={() => setAcumulado(false)}
                className={`px-3 py-2 border-l transition ${
                  !acumulado ? 'bg-violet-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
                title="Un renglón por trabajador y periodo"
              >
                <List size={13} className="inline mr-1 -mt-0.5" />
                Detalle
              </button>
            </div>
          )}

          <button onClick={exportar} disabled={!d}
            className={`text-sm text-emerald-700 hover:underline flex items-center gap-1 disabled:opacity-40 ${
              que === 'prenomina' && varios ? '' : 'ml-auto'
            }`}>
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
  const acum = !!d.acumulado;
  return (
    <>
      <Caja>
        <table className="w-full text-xs tabular-nums">
          <thead className="bg-gray-50 border-b text-gray-600">
            <tr>
              <th className="px-2 py-2 text-center w-16">
                {acum ? 'Periodos' : 'Periodo'}
              </th>
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
                {/* Acumulado esconde justo lo que más se pregunta al revisar:
                    que a alguien le falte una semana. Por eso el conteo va
                    marcado cuando no trae todos los periodos del rango. */}
                <td className="px-2 py-1 text-center">
                  {acum ? (
                    r.completo ? (
                      <span className="text-gray-500">{r.periodos}</span>
                    ) : (
                      <span
                        className="text-amber-700 font-semibold"
                        title={`Sólo aparece en ${r.periodos} de los ${d.periodosDelRango} periodos ` +
                               `(#${r.primer_periodo} al #${r.ultimo_periodo})`}
                      >
                        {r.periodos} ⚠
                      </span>
                    )
                  ) : `#${r.periodo}`}
                </td>
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
              <td className="px-2 py-2" colSpan={3}>
                {acum
                  ? `${d.renglones.length} trabajador(es) · ${t.recibos} recibo(s) de ` +
                    `${d.periodosDelRango} periodo(s)`
                  : `${t.recibos} recibo(s)`}
              </td>
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

      {d.avisos?.map((a: string, i: number) => (
        <p key={i}
          className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          {a}
        </p>
      ))}
    </>
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
  const p = d.patronal;
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
              <th className="px-2 py-2 text-right w-32">Cuota patronal</th>
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
                {/* La patronal se paga SIEMPRE, incluso por quien está exento de
                    cuota obrera: es justo lo que el Art. 36 LSS le traslada al
                    patrón. Por eso esta columna nunca dice "exento". */}
                <td className="px-2 py-1 text-right text-amber-800 font-semibold">
                  {r.patronal === null
                    ? <span className="text-gray-400 font-normal">—</span>
                    : money(r.patronal)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 border-t-2 font-semibold">
            <tr>
              <td className="px-2 py-2" colSpan={3}>{t.trabajadores} trabajador(es)</td>
              <td className="px-2 py-2 text-center">{t.dias}</td>
              <td className="px-2 py-2 text-right text-rose-700">{money(t.imss)}</td>
              <td className="px-2 py-2 text-right text-amber-800">{money(t.patronal)}</td>
            </tr>
          </tfoot>
        </table>
      </Caja>

      {/* ── El desglose por rama ──
          Va desglosado y no como un solo importe porque así se captura la
          provisión en contabilidad: una cuenta por rama. */}
      {p && p.total > 0 && (
        <Caja>
          <div className="px-3 py-2 border-b bg-amber-50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-amber-900">
              Cuota patronal — para provisionar
            </h3>
            <span className="text-lg font-bold text-amber-800 tabular-nums">
              {money(p.total)}
            </span>
          </div>
          <table className="w-full text-xs tabular-nums">
            <tbody className="divide-y">
              {([
                ['emCuotaFija',    'Enfermedad y maternidad · cuota fija', 'Art. 106 Fr. I'],
                ['emExcedente',    'Enfermedad · excedente de 3 UMA',      'Art. 106 Fr. II'],
                ['emDinero',       'Prestaciones en dinero',               'Art. 107'],
                ['emPensionados',  'Gastos médicos de pensionados',        'Art. 25'],
                ['invalidezVida',  'Invalidez y vida',                     'Art. 147'],
                ['riesgosTrabajo', 'Riesgos de trabajo',                   'Art. 71-73'],
                ['guarderias',     'Guarderías y prestaciones sociales',   'Art. 211'],
                ['retiro',         'Retiro',                               'Art. 168 Fr. I'],
                ['cesantiaVejez',  'Cesantía en edad avanzada y vejez',    'Art. 168 Fr. II'],
              ] as Array<[string, string, string]>).map(([k, nombre, art]) => (
                <tr key={k} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5">{nombre}</td>
                  <td className="px-2 py-1.5 text-gray-400 text-[11px] w-28">{art}</td>
                  <td className="px-3 py-1.5 text-right w-32">
                    {Number(p[k]) === 0
                      ? <span className="text-gray-300">0.00</span>
                      : money(p[k])}
                  </td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-semibold border-t-2">
                <td className="px-3 py-2" colSpan={2}>Total IMSS</td>
                <td className="px-3 py-2 text-right">{money(p.totalImss)}</td>
              </tr>
              <tr className="hover:bg-gray-50">
                <td className="px-3 py-1.5">INFONAVIT (aportación patronal 5%)</td>
                <td className="px-2 py-1.5 text-gray-400 text-[11px]">
                  Art. 29 Fr. II Ley INFONAVIT
                </td>
                <td className="px-3 py-1.5 text-right">{money(p.infonavit)}</td>
              </tr>
              <tr className="bg-amber-50 font-bold border-t-2 text-amber-900">
                <td className="px-3 py-2.5" colSpan={2}>TOTAL A PROVISIONAR</td>
                <td className="px-3 py-2.5 text-right text-sm">{money(p.total)}</td>
              </tr>
            </tbody>
          </table>
        </Caja>
      )}

      <p className="text-xs text-gray-500">
        La <b>cuota obrera</b> se le retiene al trabajador; la <b>patronal</b> sale de la
        empresa y se paga al IMSS al mes siguiente — es la que hay que provisionar.
        {t.sinCuota > 0 && (
          <> Los <b>{t.sinCuota}</b> marcados como exentos ganan el salario mínimo: el
          Art. 36 LSS pone su cuota obrera en cero <i>y la absorbe el patrón</i>, así que
          sí generan cuota patronal.</>
        )}
      </p>

      {/* Es una estimación y hay que decirlo: quien pague por este número sin
          cotejar contra el SUA va a descuadrar. */}
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
        <b>Es una estimación para provisionar.</b> El IMSS liquida con SUS registros
        —sus movimientos de alta y baja, sus días cotizados y la prima de riesgo que
        tiene autorizada—. Lo que se paga es lo que emita el SUA, no esta cifra.
      </p>

      {d.avisos?.map((a: string, i: number) => (
        <p key={i} className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          {a}
        </p>
      ))}

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
              <td className="px-2 py-1 text-gray-500">{aTextoMx(r.fecha_fin)}</td>
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
