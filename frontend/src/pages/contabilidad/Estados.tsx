/**
 * Los estados financieros, uno por menú.
 *
 * Cada uno es su propio cascarón: existe siempre, se corta por mes, y se llena
 * con los saldos del periodo vengan de donde vengan —balanza de otro sistema,
 * CFDI procesados o pólizas capturadas.
 *
 * Todos leen el MISMO endpoint del periodo. Que sean pantallas distintas no
 * significa que sean cálculos distintos: si dos estados salieran de dos
 * consultas, un día dirían cosas diferentes del mismo mes.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Info, TrendingUp, X, FileSpreadsheet, FileDown } from 'lucide-react';
import api from '@/services/api';
import { formatCuenta, useMascara } from '@/utils/cuenta';
import {
  MarcoEstado, SeccionBalance, Total, ListaRubros, NoDisponible, Cuadre,
  mx, pct, MESES,
} from './piezas';

/* ═══════════════════════════════════════════════════════════════════════════
   BALANZA DE COMPROBACIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

export function BalanzaPage() {
  const hoy = new Date();
  const qc = useQueryClient();
  const mascara = useMascara();
  /* Se puede volver aquí desde el editor de una póliza (que se abrió por el
   * auxiliar): el mes/año llegan en la URL para reabrir en el mismo periodo. */
  const [params] = useSearchParams();
  const [anio, setAnio] = useState(Number(params.get('anio')) || hoy.getFullYear());
  const [mes, setMes] = useState(Number(params.get('mes')) || hoy.getMonth() + 1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [auxiliar, setAuxiliar] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['balanza-periodo', anio, mes],
    queryFn: () => api.getBalanzaDelPeriodo(anio, mes),
  });
  const d: any = q.data?.data;

  const actualizar = async () => {
    setBusy(true); setMsg('');
    try {
      const r: any = await api.actualizarBalanzaDesdePolizas(anio, mes);
      setMsg(r.message || 'Balanza actualizada.');
      qc.invalidateQueries({ queryKey: ['balanza-periodo', anio, mes] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo actualizar.'); }
    finally { setBusy(false); }
  };

  const hayDatos = d && !d.vacio && (d.filas?.length || 0) > 0;
  const descargar = async (fn: () => Promise<void>) => {
    setMsg('');
    try { await fn(); } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo descargar.'); }
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Balanza de comprobación</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Saldo inicial, cargos, abonos y saldo final por cuenta. Es el archivo B del
            Anexo 24 y la base de todos los demás estados.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={actualizar} disabled={busy}
            title="Recalcula la balanza del mes con lo contabilizado en las pólizas"
            className="flex items-center gap-1.5 bg-primary text-white px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
            {busy ? 'Actualizando…' : 'Actualizar desde pólizas'}
          </button>
          {hayDatos && (
            <>
              <button onClick={() => descargar(() => api.descargarBalanzaExcel(anio, mes))} title="Descargar Excel"
                className="flex items-center gap-1 border text-emerald-700 px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 text-sm">
                <FileSpreadsheet size={16} /> Excel
              </button>
              <button onClick={() => descargar(() => api.descargarBalanzaPdf(anio, mes))} title="Descargar PDF"
                className="flex items-center gap-1 border text-rose-600 px-2.5 py-1.5 rounded-lg hover:bg-rose-50 text-sm">
                <FileDown size={16} /> PDF
              </button>
            </>
          )}
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input">
            {MESES.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))}
            className="input w-24" />
        </div>
      </div>

      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      {q.isLoading && <p className="text-gray-500">Cargando…</p>}

      {(!d || d?.vacio) && !q.isLoading && (
        <p className="text-sm text-gray-600 bg-gray-50 border rounded px-4 py-6 text-center">
          {MESES[mes]} {anio} no tiene saldos. Genera las pólizas del mes y dale
          <b> «Actualizar desde pólizas»</b> — o carga una balanza externa en{' '}
          <a href="/contabilidad/periodos" className="text-primary hover:underline">Periodos</a>.
        </p>
      )}

      {d && !d.vacio && (
        <>
          <Cuadre ok={d.cuadra}
            texto={d.cuadra
              ? `Cuadra: cargos y abonos suman ${mx(d.sumaCargos)}.`
              : `No cuadra: cargos ${mx(d.sumaCargos)} contra abonos ${mx(d.sumaAbonos)}, ` +
                `diferencia ${mx(d.diferencia)}.`} />

          <div className="bg-white rounded-lg shadow border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Cuenta</th>
                  <th className="px-3 py-2 text-left">Nombre</th>
                  <th className="px-2 py-2 text-center">Nat.</th>
                  <th className="px-3 py-2 text-right">Saldo inicial</th>
                  <th className="px-3 py-2 text-right">Cargos</th>
                  <th className="px-3 py-2 text-right">Abonos</th>
                  <th className="px-3 py-2 text-right">Saldo final</th>
                  <th className="px-3 py-2 text-left">SAT</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {d.filas.map((f: any) => (
                  <tr key={f.codigo} className="hover:bg-sky-50 cursor-pointer"
                    onDoubleClick={() => setAuxiliar(f.codigo)}
                    title="Doble clic para ver el auxiliar de la cuenta">
                    <td className="px-3 py-1 font-mono text-xs whitespace-nowrap">{formatCuenta(f.codigo, mascara)}</td>
                    <td className="px-3 py-1">{f.nombre}</td>
                    <td className="px-2 py-1 text-center text-xs text-gray-500">
                      {f.naturaleza === 'ACREEDORA' ? 'A' : 'D'}
                    </td>
                    <td className="px-3 py-1 text-right tabular-nums">{mx(f.saldo_inicial)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{mx(f.cargos)}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{mx(f.abonos)}</td>
                    <td className={`px-3 py-1 text-right tabular-nums font-medium ${
                      f.saldo_final < 0 ? 'text-rose-700' : ''}`}>{mx(f.saldo_final)}</td>
                    <td className="px-3 py-1 font-mono text-[10px] text-gray-400">
                      {f.codigo_agrupador || '—'}
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-100 font-semibold">
                  <td colSpan={4} className="px-3 py-2">Totales · {d.filas.length} cuentas</td>
                  <td className="px-3 py-2 text-right tabular-nums">{mx(d.sumaCargos)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{mx(d.sumaAbonos)}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {auxiliar && (
        <AuxiliarModal codigo={auxiliar} anio={anio} mes={mes} onClose={() => setAuxiliar(null)} />
      )}
    </div>
  );
}

/* ── Auxiliar de una cuenta: sus movimientos del mes, con la póliza en azul ── */
function AuxiliarModal({ codigo, anio, mes, onClose }: {
  codigo: string; anio: number; mes: number; onClose: () => void;
}) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['auxiliar', codigo, anio, mes],
    queryFn: () => api.getAuxiliarCuenta(codigo, anio, mes),
  });
  const d: any = q.data?.data;
  const abrirPoliza = (entryId: string) =>
    navigate(`/contabilidad/polizas?editar=${entryId}&anio=${anio}&mes=${mes}&desde=balanza`);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="font-semibold text-gray-900">
              Auxiliar · <span className="font-mono">{d?.cuenta?.codigo || codigo}</span> {d?.cuenta?.nombre || ''}
            </h3>
            <p className="text-xs text-gray-500">{MESES[mes]} {anio} · doble clic en un renglón para abrir su póliza</p>
          </div>
          <div className="flex items-center gap-2">
            {d?.cuenta && (
              <>
                <button onClick={() => api.descargarAuxiliarExcel(d.cuenta.codigo, anio, mes).catch(() => {})}
                  title="Descargar Excel"
                  className="flex items-center gap-1 border text-emerald-700 px-2 py-1 rounded hover:bg-emerald-50 text-xs">
                  <FileSpreadsheet size={14} /> Excel
                </button>
                <button onClick={() => api.descargarAuxiliarPdf(d.cuenta.codigo, anio, mes).catch(() => {})}
                  title="Descargar PDF"
                  className="flex items-center gap-1 border text-rose-600 px-2 py-1 rounded hover:bg-rose-50 text-xs">
                  <FileDown size={14} /> PDF
                </button>
              </>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Póliza</th>
                <th className="px-3 py-2 text-left">Concepto</th>
                <th className="px-3 py-2 text-right">Cargo</th>
                <th className="px-3 py-2 text-right">Abono</th>
                <th className="px-3 py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr className="bg-gray-50/60">
                <td colSpan={5} className="px-3 py-1.5 text-right text-xs text-gray-500 italic">Saldo inicial</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{mx(d?.saldoInicial ?? 0)}</td>
              </tr>
              {q.isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">Cargando…</td></tr>}
              {!q.isLoading && d && d.movimientos.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500 italic">
                  Esta cuenta no tuvo movimientos en {MESES[mes]} {anio}.
                </td></tr>
              )}
              {(d?.movimientos || []).map((m: any, i: number) => (
                <tr key={i} className="hover:bg-sky-50 cursor-pointer"
                  onDoubleClick={() => abrirPoliza(m.entry_id)}
                  title="Doble clic para abrir la póliza en edición">
                  <td className="px-3 py-1 text-xs text-gray-600 whitespace-nowrap">
                    {new Date(m.fecha + 'T12:00:00').toLocaleDateString('es-MX')}
                  </td>
                  <td className="px-3 py-1">
                    <button onClick={(e) => { e.stopPropagation(); abrirPoliza(m.entry_id); }}
                      className="text-sky-600 hover:text-sky-800 hover:underline font-medium">
                      #{m.folio}
                    </button>
                  </td>
                  <td className="px-3 py-1 text-gray-700">
                    <span className="truncate block max-w-md">{m.linea_concepto || m.poliza_concepto || '—'}</span>
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">{m.cargo > 0 ? mx(m.cargo) : ''}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{m.abono > 0 ? mx(m.abono) : ''}</td>
                  <td className="px-3 py-1 text-right tabular-nums text-gray-600">{mx(m.saldo)}</td>
                </tr>
              ))}
            </tbody>
            {d && (
              <tfoot>
                <tr className="bg-gray-100 font-semibold border-t">
                  <td colSpan={3} className="px-3 py-2 text-right">Sumas del mes</td>
                  <td className="px-3 py-2 text-right tabular-nums">{mx(d.totalCargos)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{mx(d.totalAbonos)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{mx(d.saldoFinal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SITUACIÓN FINANCIERA — B-6
   ═══════════════════════════════════════════════════════════════════════════ */

export function SituacionFinancieraPage() {
  return (
    <MarcoEstado titulo="Estado de situación financiera" norma="B-6"
      descripcion="Lo que la empresa tiene, lo que debe y lo que es de los socios, a la fecha de corte."
      descargas={{ excel: (a, m) => api.descargarSituacion(a, m, 'excel'), pdf: (a, m) => api.descargarSituacion(a, m, 'pdf') }}>
      {(d) => (
        <>
          <Cuadre ok={d.situacionFinanciera.cuadra}
            texto={d.situacionFinanciera.cuadra
              ? `El balance cuadra: activo ${mx(d.situacionFinanciera.activoTotal)} = pasivo más capital.`
              : `No cuadra por ${mx(d.situacionFinanciera.diferencia)}.`} />
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="space-y-4">
              <SeccionBalance s={d.situacionFinanciera.activoCirculante} />
              <SeccionBalance s={d.situacionFinanciera.activoNoCirculante} />
              <Total etiqueta="ACTIVO TOTAL" valor={d.situacionFinanciera.activoTotal} fuerte />
            </div>
            <div className="space-y-4">
              <SeccionBalance s={d.situacionFinanciera.pasivoCorto} />
              <SeccionBalance s={d.situacionFinanciera.pasivoLargo} />
              <Total etiqueta="Pasivo total" valor={d.situacionFinanciera.pasivoTotal} />
              <SeccionBalance s={d.situacionFinanciera.capital} />
              <Total etiqueta="PASIVO + CAPITAL"
                valor={d.situacionFinanciera.pasivoTotal + d.situacionFinanciera.capitalTotal} fuerte />
            </div>
          </div>
        </>
      )}
    </MarcoEstado>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESULTADO INTEGRAL — B-3
   ═══════════════════════════════════════════════════════════════════════════ */

const SUBTOTALES = ['INGRESOS_NETOS', 'UTILIDAD_BRUTA', 'UTILIDAD_OPERACION', 'UAI', 'UTILIDAD_NETA'];

export function ResultadoIntegralPage() {
  return (
    <MarcoEstado titulo="Estado de resultado integral" norma="B-3"
      descripcion="Cómo se llegó del ingreso del periodo a la utilidad, renglón por renglón."
      descargas={{ excel: (a, m) => api.descargarResultados(a, m, 'excel'), pdf: (a, m) => api.descargarResultados(a, m, 'pdf') }}>
      {(d) => (
        <div className="bg-white rounded-lg shadow border overflow-hidden max-w-3xl">
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {d.resultadoIntegral.renglones
                .filter((x: any) => Math.abs(x.importe) >= 1 || SUBTOTALES.includes(x.clave))
                .map((x: any) => {
                  const st = SUBTOTALES.includes(x.clave);
                  return (
                    <tr key={x.clave} className={st ? 'bg-gray-50 font-semibold' : ''}>
                      <td className={`px-4 py-1.5 ${st ? '' : 'pl-8'}`}>
                        {x.nombre}
                        {x.codigos && (
                          <span className="ml-2 text-[10px] text-gray-400 font-mono">{x.codigos}</span>
                        )}
                      </td>
                      <td className={`px-4 py-1.5 text-right tabular-nums whitespace-nowrap ${
                        x.importe < 0 ? 'text-rose-700' : 'text-gray-900'}`}>{mx(x.importe)}</td>
                      <td className="px-3 py-1.5 text-right text-xs text-gray-400 w-16">
                        {pct(x.vertical)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          {d.resultadoIntegral.diferenciaCon305 !== null
            && Math.abs(d.resultadoIntegral.diferenciaCon305) > 1 && (
            <p className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-t">
              La utilidad calculada no coincide con la cuenta 305 de la balanza
              ({mx(d.resultadoIntegral.resultadoSegun305)}).
              Diferencia: {mx(d.resultadoIntegral.diferenciaCon305)}.
            </p>
          )}
        </div>
      )}
    </MarcoEstado>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   FLUJOS DE EFECTIVO — B-2
   ═══════════════════════════════════════════════════════════════════════════ */

export function FlujoEfectivoPage() {
  return (
    <MarcoEstado titulo="Estado de flujos de efectivo" norma="B-2"
      descripcion="De dónde salió y a dónde se fue el efectivo, por método indirecto."
      descargas={{ excel: (a, m) => api.descargarFlujo(a, m, 'excel'), pdf: (a, m) => api.descargarFlujo(a, m, 'pdf') }}>
      {(d) => {
        const f = d.flujoEfectivo;
        if (!f.disponible) return <NoDisponible motivo={f.motivo} />;
        return (
          <>
            <Cuadre ok={f.concilia}
              texto={f.concilia
                ? `Concilia: los tres flujos suman ${mx(f.incrementoNeto)} y el efectivo ` +
                  `pasó de ${mx(f.efectivoInicial)} a ${mx(f.efectivoFinal)}.`
                : `No concilia por ${mx(f.diferencia)}: falta alguna partida.`} />
            <div className="space-y-4 max-w-3xl">
              <ListaRubros titulo="Actividades de operación" rubros={f.operacion}
                total={f.flujoOperacion} etiquetaTotal="Flujo de operación" />
              <ListaRubros titulo="Actividades de inversión" rubros={f.inversion}
                total={f.flujoInversion} etiquetaTotal="Flujo de inversión" />
              <ListaRubros titulo="Actividades de financiamiento" rubros={f.financiamiento}
                total={f.flujoFinanciamiento} etiquetaTotal="Flujo de financiamiento" />
              <Total etiqueta="INCREMENTO NETO DE EFECTIVO" valor={f.incrementoNeto} fuerte />
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 rounded px-4 py-2 flex justify-between">
                  <span>Efectivo al inicio</span>
                  <span className="tabular-nums font-medium">{mx(f.efectivoInicial)}</span>
                </div>
                <div className="bg-gray-50 rounded px-4 py-2 flex justify-between">
                  <span>Efectivo al final</span>
                  <span className="tabular-nums font-medium">{mx(f.efectivoFinal)}</span>
                </div>
              </div>
            </div>
          </>
        );
      }}
    </MarcoEstado>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAMBIOS EN EL CAPITAL CONTABLE — B-4
   ═══════════════════════════════════════════════════════════════════════════ */

export function CambiosCapitalPage() {
  return (
    <MarcoEstado titulo="Estado de cambios en el capital contable" norma="B-4"
      descripcion="Cómo se movió el capital de los socios entre el inicio y el fin del periodo."
      descargas={{ excel: (a, m) => api.descargarCambios(a, m, 'excel'), pdf: (a, m) => api.descargarCambios(a, m, 'pdf') }}>
      {(d) => {
        const c = d.cambiosCapital;
        return (
          <>
            {!c.disponible && <NoDisponible motivo={c.motivo} />}
            <div className="bg-white rounded-lg shadow border overflow-x-auto max-w-5xl">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-600">
                  <tr>
                    <th className="px-4 py-2 text-left">Concepto</th>
                    {c.columnas.map((col: string) => (
                      <th key={col} className="px-3 py-2 text-right whitespace-nowrap">{col}</th>
                    ))}
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {c.renglones.map((r: any, i: number) => (
                    <tr key={i} className={r.esSaldo ? 'bg-gray-50 font-semibold' : ''}>
                      <td className="px-4 py-2">{r.concepto}</td>
                      {r.valores.map((v: number, j: number) => (
                        <td key={j} className={`px-3 py-2 text-right tabular-nums ${
                          v < 0 ? 'text-rose-700' : ''}`}>{mx(v)}</td>
                      ))}
                      <td className="px-4 py-2 text-right tabular-nums">{mx(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {c.reservaLegal && (
              <div className={`rounded border px-4 py-3 text-sm max-w-2xl ${
                c.reservaLegal.falta > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
                <p className="font-semibold flex items-center gap-2">
                  {c.reservaLegal.falta > 0 ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
                  Reserva legal
                </p>
                <p className="mt-1">
                  Hay {mx(c.reservaLegal.hay)} y el mínimo del 20% del capital social son{' '}
                  {mx(c.reservaLegal.minimo)}.
                  {c.reservaLegal.falta > 0
                    ? ` Falta ${mx(c.reservaLegal.falta)}: hay que seguir separando el 5% de cada utilidad (LGSM Art. 20).`
                    : ' Ya se alcanzó el mínimo de ley.'}
                </p>
              </div>
            )}
          </>
        );
      }}
    </MarcoEstado>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   RAZONES Y ANÁLISIS
   ═══════════════════════════════════════════════════════════════════════════ */

const COLOR: Record<string, string> = {
  VERDE: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  AMBAR: 'bg-amber-100 text-amber-800 border-amber-200',
  ROJO: 'bg-rose-100 text-rose-800 border-rose-200',
  SIN_DATO: 'bg-gray-100 text-gray-600 border-gray-200',
};

export function RazonesPage() {
  const [tab, setTab] = useState<'razones' | 'horizontal' | 'nif'>('razones');
  return (
    <MarcoEstado titulo="Razones y análisis"
      descripcion="Liquidez, apalancamiento, rotaciones y rentabilidad, con las cifras que las sostienen."
      descargas={{ excel: (a, m) => api.descargarRazones(a, m, 'excel'), pdf: (a, m) => api.descargarRazones(a, m, 'pdf') }}>
      {(d) => (
        <>
          <div className="flex gap-1 border-b">
            {([['razones', 'Razones'],
               ['horizontal', 'Comparativo con el mes anterior'],
               ['nif', `NIF${d.nif.noCumple ? ` (${d.nif.noCumple})` : ''}`]] as Array<[string, string]>)
              .map(([k, t]) => (
              <button key={k} onClick={() => setTab(k as any)}
                className={`px-3 py-2 text-sm border-b-2 -mb-px ${
                  tab === k ? 'border-primary text-primary font-medium'
                            : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{t}</button>
            ))}
          </div>

          {tab === 'razones' && (
            <div className="grid md:grid-cols-2 gap-3">
              {d.razones.map((z: any) => (
                <div key={z.clave} className={`rounded-lg border p-3 ${COLOR[z.semaforo]}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className="font-semibold text-sm">{z.nombre}</h4>
                    <span className="text-lg font-bold tabular-nums whitespace-nowrap">
                      {z.valor === null ? '—'
                        : z.unidad === 'PORCENTAJE' ? `${z.valor.toFixed(2)}%`
                        : z.unidad === 'PESOS' ? mx(z.valor)
                        : z.unidad === 'DIAS' ? `${Math.round(z.valor)} d`
                        : z.valor.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[11px] opacity-75 font-mono mt-0.5">{z.formula}</p>
                  <p className="text-xs mt-1.5">{z.interpretacion}</p>
                  <p className="text-[10px] opacity-70 mt-1.5 font-mono break-words">
                    {Object.entries(z.base).map(([k, v]: any) =>
                      `${k}: ${typeof v === 'number' ? v.toLocaleString('es-MX') : v}`).join(' · ')}
                  </p>
                  {z.referencia && (
                    <p className="text-[10px] opacity-70 mt-1">Referencia: {z.referencia}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'horizontal' && (
            d.horizontal ? (
              <div className="bg-white rounded-lg shadow border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-600">
                    <tr>
                      <th className="px-4 py-2 text-left">Rubro</th>
                      <th className="px-4 py-2 text-right">Este mes</th>
                      <th className="px-4 py-2 text-right">Mes anterior</th>
                      <th className="px-4 py-2 text-right">Variación</th>
                      <th className="px-4 py-2 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {d.horizontal.map((f: any) => (
                      <tr key={f.clave} className={f.alerta ? 'bg-amber-50/60' : ''}>
                        <td className="px-4 py-1.5">
                          {f.alerta && <TrendingUp size={12} className="inline mr-1 text-amber-600" />}
                          {f.nombre}
                        </td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{mx(f.actual)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-gray-500">{mx(f.anterior)}</td>
                        <td className={`px-4 py-1.5 text-right tabular-nums ${
                          f.variacion < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{mx(f.variacion)}</td>
                        <td className="px-4 py-1.5 text-right text-xs text-gray-500">
                          {f.variacionPct === null ? '—' : `${f.variacionPct.toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-4 py-2 text-[11px] text-gray-500 border-t">
                  Se marca alerta cuando la variación pasa el 20% <b>y</b> supera $500,000.
                  Sólo con el porcentaje, un rubro que va de $100 a $200 sale como +100% y
                  entierra al que se movió medio millón.
                </p>
              </div>
            ) : (
              <NoDisponible motivo="Falta el mes anterior para comparar. Cárgalo en Periodos." />
            )
          )}

          {tab === 'nif' && (
            <div className="space-y-2 max-w-4xl">
              {d.nif.hallazgos.map((h: any, i: number) => (
                <div key={i} className={`rounded border p-3 ${
                  h.estado === 'NO_CUMPLE' ? 'border-rose-200 bg-rose-50/50'
                  : h.estado === 'REQUIERE_REVISION' ? 'border-amber-200 bg-amber-50/40'
                  : 'border-emerald-200 bg-emerald-50/30'}`}>
                  <h4 className="text-sm font-semibold text-gray-900">
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 mr-2">
                      {h.norma}
                    </span>{h.titulo}
                  </h4>
                  <p className="text-sm text-gray-700 mt-1">{h.mensaje}</p>
                  {h.estado !== 'CUMPLE' && (
                    <>
                      <p className="text-xs text-gray-600 mt-1.5"><b>Qué exige:</b> {h.queExige}</p>
                      <p className="text-xs text-gray-600 mt-0.5"><b>Si no:</b> {h.consecuencia}</p>
                    </>
                  )}
                </div>
              ))}
              {!d.nif.hallazgos.length && (
                <p className="text-sm text-gray-500 flex items-center gap-2">
                  <Info size={14} /> Ninguna regla NIF aplicable a estos saldos.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </MarcoEstado>
  );
}
