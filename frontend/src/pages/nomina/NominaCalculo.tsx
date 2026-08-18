/**
 * NominaCalculo — elegir el tipo, el periodo, y ver lo que se va a pagar.
 *
 * EL ORDEN DE LA PANTALLA ES EL ORDEN DE LA DECISIÓN
 *   1. Qué nómina — la planta es semanal, la oficina quincenal, y conviven.
 *   2. Qué periodo — de los que ya están generados; si no hay, se generan aquí.
 *   3. Quién y cuánto — la rejilla, que sale sola con quien le toca ese periodo.
 *
 * NADA DE ESTO GUARDA
 * La prenómina se corre veinte veces mientras se ajustan cosas. Se calcula al
 * vuelo cada vez; lo que se persiste es el cierre del periodo, que todavía no
 * está construido.
 *
 * A QUIÉN LE TOCA CADA NÓMINA
 * A quien tenga esa periodicidad en su expediente. Por eso los botones enseñan
 * cuánta gente hay en cada una: un tipo con cero trabajadores casi siempre
 * significa que la periodicidad quedó mal capturada, y verlo antes ahorra
 * generar 53 periodos que nadie va a usar.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarPlus, Users, AlertTriangle, RefreshCw, Plus, X, Info,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const TIPOS = [
  { id: 'SEMANAL',   label: 'Semanal',   emoji: '📅', detalle: 'Hasta 53 periodos al año' },
  { id: 'QUINCENAL', label: 'Quincenal', emoji: '📆', detalle: '24 periodos al año' },
  { id: 'MENSUAL',   label: 'Mensual',   emoji: '📋', detalle: '12 periodos al año' },
  { id: 'ESPECIAL',  label: 'Especial',  emoji: '⚡', detalle: 'PTU, finiquitos, aguinaldo y otras' },
] as const;

export function NominaCalculoPage() {
  const { user } = useAuthStore();
  const esAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role || '');

  const [tipo, setTipo] = useState<string>('SEMANAL');
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [periodoId, setPeriodoId] = useState('');
  const [generando, setGenerando] = useState(false);
  const [creandoEspecial, setCreandoEspecial] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const plantillaQ = useQuery({
    queryKey: ['plantilla-por-tipo'],
    queryFn: () => api.getPlantillaPorTipo(),
  });
  const plantilla: any = plantillaQ.data?.data || {};

  const periodosQ = useQuery({
    queryKey: ['periodos-nomina', anio, tipo],
    queryFn: () => api.getPeriodosNomina({ anio, tipo }),
  });
  const periodos: any[] = periodosQ.data?.data?.periodos || [];

  const prenominaQ = useQuery({
    queryKey: ['prenomina', periodoId],
    queryFn: () => api.getPrenomina(periodoId),
    enabled: !!periodoId,
  });
  const pre: any = prenominaQ.data?.data;

  const cambiarTipo = (t: string) => { setTipo(t); setPeriodoId(''); setError(''); setAviso(''); };

  const generar = async () => {
    setGenerando(true); setError(''); setAviso('');
    try {
      let arranque: string | undefined;
      if (tipo === 'SEMANAL') {
        /* La fecha de arranque no se puede suponer: cada empresa cierra su
         * semana el día que decidió, y adivinar el lunes movería el corte de
         * toda la plantilla. */
        const v = window.prompt(
          '¿En qué fecha arranca la primera semana del año?\n' +
          'Es el día en que tu empresa cierra la semana — no se puede suponer.',
          `${anio}-01-05`
        );
        if (!v) { setGenerando(false); return; }
        arranque = v.trim();
      }
      const r = await api.generarPeriodosNomina(tipo, anio, arranque);
      const d: any = r.data;
      setAviso(
        `${d.creados} periodo(s) generados para ${anio}` +
        (d.respetados ? ` · ${d.respetados} ya cerrados, no se tocaron` : '')
      );
      periodosQ.refetch();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudieron generar los periodos');
    } finally { setGenerando(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Cálculo de nómina</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Nada se guarda aquí: la prenómina se calcula cada vez que se abre.
        </p>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
      {aviso && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-sm">{aviso}</div>}

      {/* ── 1 · Tipo de nómina ── */}
      <div className="bg-white rounded-lg shadow border p-5">
        <p className="text-sm font-semibold text-gray-700 mb-3">1 · Tipo de nómina</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TIPOS.map((t) => {
            const gente = plantilla[t.id];
            return (
              <button
                key={t.id}
                onClick={() => cambiarTipo(t.id)}
                className={`rounded-lg border-2 px-3 py-3 text-center transition ${
                  tipo === t.id
                    ? 'border-violet-500 bg-violet-50 text-violet-900'
                    : 'border-gray-200 hover:border-violet-300 text-gray-700'
                }`}
              >
                <span className="text-xl block">{t.emoji}</span>
                <span className="text-sm font-medium block mt-1">{t.label}</span>
                {gente !== undefined && (
                  <span className={`text-[11px] block mt-0.5 ${gente === 0 ? 'text-amber-600' : 'text-gray-500'}`}>
                    {gente} trabajador{gente === 1 ? '' : 'es'}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {plantilla.sinTipo > 0 && (
          <p className="text-xs text-amber-700 mt-3 flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {plantilla.sinTipo} trabajador(es) tienen una periodicidad que no corresponde a
            ninguna nómina —diario, catorcenal, decenal— y no entrarán en ninguna corrida.
            Revisa su expediente.
          </p>
        )}
      </div>

      {/* ── 2 · Periodo ── */}
      <div className="bg-white rounded-lg shadow border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <p className="text-sm font-semibold text-gray-700">2 · Periodo</p>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Año</label>
            <input type="number" min={2000} max={2100} value={anio}
              onChange={(e) => { setAnio(Number(e.target.value)); setPeriodoId(''); }}
              className="w-24 border rounded-lg px-2 py-1 text-sm" />
            {esAdmin && tipo !== 'ESPECIAL' && (
              <button onClick={generar} disabled={generando}
                className="flex items-center gap-1.5 text-sm bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 disabled:opacity-50">
                <CalendarPlus size={15} />
                {generando ? 'Generando…' : periodos.length ? 'Regenerar' : 'Generar periodos'}
              </button>
            )}
            {esAdmin && tipo === 'ESPECIAL' && (
              <button onClick={() => setCreandoEspecial(true)}
                className="flex items-center gap-1.5 text-sm bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-blue-600">
                <Plus size={15} /> Nuevo especial
              </button>
            )}
          </div>
        </div>

        {tipo === 'ESPECIAL' && (
          <p className="text-xs text-gray-600 mb-3 flex items-start gap-1.5">
            <Info size={13} className="mt-0.5 shrink-0" />
            Los especiales no salen de un calendario: cada uno se captura con sus fechas y
            su concepto — <b>PTU</b>, <b>finiquito</b>, <b>aguinaldo</b> u otra cosa. Alcanzan
            a toda la plantilla, sin importar su periodicidad.
          </p>
        )}

        {creandoEspecial && (
          <FormaEspecial
            anio={anio}
            onCancelar={() => setCreandoEspecial(false)}
            onCreado={(id: string) => {
              setCreandoEspecial(false);
              periodosQ.refetch();
              setPeriodoId(id);
            }}
          />
        )}

        {periodosQ.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}

        {!periodosQ.isLoading && periodos.length === 0 && !creandoEspecial && (
          <p className="text-sm text-gray-500 italic">
            {tipo === 'ESPECIAL'
              ? `No hay periodos especiales en ${anio}.`
              : `No hay periodos ${tipo.toLowerCase()}es generados para ${anio}.`}
          </p>
        )}

        {periodos.length > 0 && (
          <select value={periodoId} onChange={(e) => setPeriodoId(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="">— Elige el periodo —</option>
            {periodos.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.numero} · {p.concepto ? `${p.concepto} · ` : ''}
                {p.fecha_inicio} al {p.fecha_fin} ({p.dias} días)
                {p.estatus !== 'ABIERTO' ? ` · ${p.estatus.toLowerCase()}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ── 3 · La rejilla ── */}
      {periodoId && (
        <div className="bg-white rounded-lg shadow border overflow-hidden">
          <div className="px-5 py-3 border-b flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Users size={16} className="text-violet-600" /> 3 · Prenómina
              {pre && (
                <span className="font-normal text-gray-500">
                  — {pre.periodo.tipo} #{pre.periodo.numero}
                  {pre.periodo.concepto ? ` · ${pre.periodo.concepto}` : ''}
                  {' · '}{pre.periodo.fecha_inicio} al {pre.periodo.fecha_fin}
                </span>
              )}
            </p>
            <button onClick={() => prenominaQ.refetch()} disabled={prenominaQ.isFetching}
              className="text-sm text-primary hover:underline flex items-center gap-1">
              <RefreshCw size={14} className={prenominaQ.isFetching ? 'animate-spin' : ''} />
              Recalcular
            </button>
          </div>

          {prenominaQ.isLoading && <p className="px-5 py-8 text-sm text-gray-500">Calculando…</p>}
          {prenominaQ.isError && (
            <p className="px-5 py-6 text-sm text-rose-700">
              {(prenominaQ.error as any)?.response?.data?.message || 'No se pudo calcular'}
            </p>
          )}

          {pre?.avisos?.length > 0 && (
            <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 space-y-1">
              {pre.avisos.map((a: string, i: number) => (
                <p key={i} className="text-xs text-amber-900 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {a}
                </p>
              ))}
            </div>
          )}

          {pre && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr className="text-xs text-gray-600">
                    <th className="px-3 py-2 text-left">Nómina</th>
                    <th className="px-3 py-2 text-left">Nombre</th>
                    <th className="px-3 py-2 text-center">Días trab.</th>
                    <th className="px-3 py-2 text-right">Ingresos</th>
                    <th className="px-3 py-2 text-right">Egresos</th>
                    <th className="px-3 py-2 text-right">Total a cobrar</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pre.renglones.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 italic">
                      Ningún trabajador con esa periodicidad estuvo activo en este periodo.
                    </td></tr>
                  )}
                  {pre.renglones.map((r: any) => (
                    <tr key={r.empleado_id} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-xs text-gray-500">{pre.periodo.tipo}</td>
                      <td className="px-3 py-1.5">
                        <p className="font-medium text-gray-900">{r.nombre}</p>
                        <p className="text-[11px] text-gray-500">
                          {r.num_empleado}{r.puesto ? ` · ${r.puesto}` : ''}
                        </p>
                        {r.faltantes?.length > 0 && (
                          <p className="text-[11px] text-amber-700 flex items-center gap-1">
                            <AlertTriangle size={11} /> no se puede timbrar: falta {r.faltantes.join(', ')}
                          </p>
                        )}
                        {r.avisos?.map((a: string, i: number) => (
                          <p key={i} className="text-[11px] text-amber-700">{a}</p>
                        ))}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {r.dias}
                        {r.dias !== r.diasDelPeriodo && (
                          <span className="text-[11px] text-gray-400"> / {r.diasDelPeriodo}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right">{money(r.ingresos)}</td>
                      <td className="px-3 py-1.5 text-right text-rose-700">
                        {r.egresos > 0 ? money(r.egresos) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-semibold">{money(r.neto)}</td>
                    </tr>
                  ))}
                </tbody>
                {pre.renglones.length > 0 && (
                  <tfoot className="bg-gray-50 border-t-2">
                    <tr className="font-semibold">
                      <td className="px-3 py-2" colSpan={2}>
                        {pre.totales.trabajadores} trabajador(es)
                        {pre.totales.sinPoderTimbrar > 0 && (
                          <span className="font-normal text-amber-700 text-xs">
                            {' '}· {pre.totales.sinPoderTimbrar} sin poder timbrar
                          </span>
                        )}
                      </td>
                      <td></td>
                      <td className="px-3 py-2 text-right">{money(pre.totales.ingresos)}</td>
                      <td className="px-3 py-2 text-right text-rose-700">{money(pre.totales.egresos)}</td>
                      <td className="px-3 py-2 text-right">{money(pre.totales.neto)}</td>
                    </tr>
                    <tr className="text-xs text-gray-600">
                      <td className="px-3 pb-2" colSpan={6}>
                        ISR {money(pre.totales.isr)} · IMSS obrero {money(pre.totales.imss)}
                        {pre.totales.subsidio > 0 && ` · subsidio al empleo ${money(pre.totales.subsidio)}`}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          <p className="px-5 py-3 text-xs text-gray-500 border-t">
            Falta la captura de conceptos por trabajador —horas extra, faltas, bonos—, la
            vista previa del CFDI y el cierre del periodo, que es el que aplicará los abonos
            de préstamos y FONACOT.
          </p>
        </div>
      )}
    </div>
  );
}

/** Alta de un periodo especial: PTU, finiquito, aguinaldo u otra cosa. */
function FormaEspecial({ anio, onCancelar, onCreado }: any) {
  const HOY = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<any>({
    concepto: '', fecha_inicio: `${anio}-01-01`, fecha_fin: `${anio}-12-31`, fecha_pago: HOY,
  });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const campo = 'w-full border rounded-lg px-3 py-1.5 text-sm';

  /* Los tres casos de siempre, para no teclear el concepto ni las fechas. */
  const plantillas = [
    { label: 'Aguinaldo', concepto: `Aguinaldo ${anio}`, ini: `${anio}-01-01`, fin: `${anio}-12-31` },
    { label: 'PTU',       concepto: `PTU ${anio - 1}`,   ini: `${anio - 1}-01-01`, fin: `${anio - 1}-12-31` },
    { label: 'Finiquito', concepto: 'Finiquito de ',     ini: HOY, fin: HOY },
  ];

  return (
    <div className="border border-violet-200 bg-violet-50/40 rounded-lg p-4 space-y-3 mb-3">
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm">Nuevo periodo especial</p>
        <button onClick={onCancelar} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {plantillas.map((p) => (
          <button key={p.label} type="button"
            onClick={() => setF({ ...f, concepto: p.concepto, fecha_inicio: p.ini, fecha_fin: p.fin })}
            className="text-xs border rounded-lg px-3 py-1.5 bg-white hover:border-violet-400">
            {p.label}
          </button>
        ))}
        <span className="text-xs text-gray-500 self-center">o escribe el concepto que necesites</span>
      </div>

      <input className={campo} placeholder='Concepto — "Aguinaldo 2026", "Finiquito de Juan Pérez"…'
        value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} />

      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Desde</label>
          <input type="date" className={campo} value={f.fecha_inicio}
            onChange={(e) => setF({ ...f, fecha_inicio: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Hasta</label>
          <input type="date" className={campo} value={f.fecha_fin}
            onChange={(e) => setF({ ...f, fecha_fin: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Fecha de pago</label>
          <input type="date" className={campo} value={f.fecha_pago}
            onChange={(e) => setF({ ...f, fecha_pago: e.target.value })} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancelar}
          className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
        <button disabled={guardando}
          onClick={async () => {
            setGuardando(true); setError('');
            try {
              const r = await api.crearPeriodoEspecial({ anio, ...f });
              onCreado(r.data.id);
            } catch (e: any) {
              setError(e?.response?.data?.message || 'No se pudo crear');
            } finally { setGuardando(false); }
          }}
          className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
          {guardando ? 'Creando…' : 'Crear periodo'}
        </button>
      </div>
    </div>
  );
}

export default NominaCalculoPage;
