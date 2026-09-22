/**
 * Cierre contable — proceso de ADMIN, todo en un panel.
 *
 *   · Mes en curso   — el ÚNICO mes abierto (el siguiente al último cerrado). Se
 *                      cierra con un cuadro de mensaje que explica qué se hace según
 *                      las NIF y a qué tipo de cambio quedaron las operaciones.
 *   · Meses cerrados — reabrir un mes ya cerrado para corregir y volver a cerrarlo.
 *   · Anual          — el cierre del ejercicio (traspaso del resultado a capital).
 *
 * La póliza de cierre salda los resultados contra la 305; es re-ejecutable y no
 * altera los reportes operativos.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Lock, PlayCircle, RefreshCw, Undo2, AlertTriangle, CheckCircle2,
  TrendingUp, TrendingDown, Coins, CalendarClock, X, RotateCcw,
} from 'lucide-react';
import api from '@/services/api';
import { aniosContables } from '@/utils/anios';
import { usePeriodoTrabajo } from '@/utils/periodoActivo';
import { aTextoMx } from '@/components/CampoFecha';
import { useAuthStore } from '@/store/auth';
import { claseOpcion } from '@/utils/coloresOpciones';

const money = (n: any) => Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const tc = (n: any) => Number(n ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

type Vista = 'mes' | 'cerrados' | 'anual';

export function CierreEjercicioPage() {
  const { user } = useAuthStore();
  const esAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  // El mes de trabajo = el ABIERTO (siguiente al último cerrado). Aquí es fijo.
  const { anio, mes } = usePeriodoTrabajo();
  const [vista, setVista] = useState<Vista>('mes');
  const [anioSel, setAnioSel] = useState(anio);     // para «cerrados» y «anual»
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [confirmar, setConfirmar] = useState(false);

  const qMes = useQuery({ queryKey: ['cierre-mes', anio, mes], queryFn: () => api.getCierreMes(anio, mes), enabled: vista === 'mes' });
  const qAnual = useQuery({ queryKey: ['cierre-anual', anioSel], queryFn: () => api.getCierreEjercicio(anioSel), enabled: vista === 'anual' });
  const qCerrados = useQuery({ queryKey: ['meses-cerrados', anioSel], queryFn: () => api.getMesesCerrados(anioSel), enabled: vista === 'cerrados' });

  const d: any = vista === 'anual' ? qAnual.data?.data : qMes.data?.data;
  const cerrados: number[] = (qCerrados.data?.data as number[]) || [];
  const cargando = vista === 'anual' ? qAnual.isLoading : vista === 'mes' ? qMes.isLoading : qCerrados.isLoading;

  const generar = async () => {
    setConfirmar(false); setBusy(true); setMsg(''); setError('');
    try {
      const r: any = vista === 'anual' ? await api.generarCierreEjercicio(anioSel) : await api.generarCierreMes(anio, mes);
      setMsg(r?.message || 'Póliza de cierre generada.');
      (vista === 'anual' ? qAnual : qMes).refetch();
    } catch (e: any) { setError(e?.response?.data?.message || 'No se pudo generar el cierre.'); }
    finally { setBusy(false); }
  };
  const reabrir = async (m: number) => {
    if (!confirm(`¿Reabrir ${MESES[m]} ${anioSel} para corregir?\n\nSe borra su póliza de cierre; los movimientos del mes NO se tocan. Corrige lo que haga falta y vuelve a cerrarlo.`)) return;
    setBusy(true); setMsg(''); setError('');
    try { await api.revertirCierreMes(anioSel, m); setMsg(`${MESES[m]} ${anioSel} reabierto. Corrige y vuelve a cerrarlo.`); qCerrados.refetch(); }
    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo reabrir.'); }
    finally { setBusy(false); }
  };
  const revertirAnual = async () => {
    if (!confirm(`¿Deshacer el cierre anual de ${anioSel}? Se borra la póliza; los resultados no se tocan.`)) return;
    setBusy(true); setMsg(''); setError('');
    try { await api.revertirCierreEjercicio(anioSel); setMsg(`Cierre anual de ${anioSel} deshecho.`); qAnual.refetch(); }
    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo deshacer.'); }
    finally { setBusy(false); }
  };

  const periodo = vista === 'anual' ? `${anioSel}` : `${MESES[mes]} ${anio}`;

  return (
    <div className="p-4 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Lock size={22} className="text-amber-600" /> Cierre contable
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Determina la utilidad o pérdida y la salda contra la cuenta de capital
          {' '}(utilidad <b>305.01</b> / pérdida <b>305.02</b>).
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {([['mes', 'Mes en curso'], ['cerrados', 'Meses cerrados'], ['anual', 'Cierre anual']] as const).map(([k, l], i) => (
          <button key={k} onClick={() => { setVista(k); setMsg(''); setError(''); }} className={claseOpcion(i, vista === k)}>{l}</button>
        ))}
      </div>

      {!esAdmin && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Sólo un <b>ADMIN</b> puede cerrar o reabrir. Puedes consultar, pero no asentarlo.
        </p>
      )}
      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</p>}
      {msg && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">{msg}</p>}

      {/* ── MES EN CURSO (el único abierto) ── */}
      {vista === 'mes' && (
        <>
          <div className="bg-white rounded-lg border shadow-sm p-4 flex items-center gap-2 text-sm">
            <CalendarClock size={18} className="text-amber-600" />
            <span>Mes de trabajo (abierto): <b>{MESES[mes]} {anio}</b>. Es el que sigue al último mes cerrado.</span>
          </div>
          {cargando && <p className="text-sm text-gray-500">Cargando…</p>}
          {d && <ResultadoMes d={d} periodo={periodo} mensual
            onGenerar={() => setConfirmar(true)} busy={busy} esAdmin={esAdmin} />}
        </>
      )}

      {/* ── MESES CERRADOS (reabrir para corregir) ── */}
      {vista === 'cerrados' && (
        <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Año</span>
            <select value={anioSel} onChange={(e) => setAnioSel(Number(e.target.value))} className="input w-28">
              {aniosContables().map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={() => qCerrados.refetch()} className="text-gray-500 hover:text-gray-700" title="Actualizar">
              <RefreshCw size={16} className={qCerrados.isFetching ? 'animate-spin' : ''} />
            </button>
          </div>
          <p className="text-xs text-gray-500 flex items-start gap-1">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
            Reabrir borra sólo la <b>póliza de cierre</b> del mes; los movimientos quedan intactos. Corrige lo mal hecho y vuelve a cerrar el mes.
          </p>
          {qCerrados.isLoading ? (
            <p className="text-sm text-gray-500">Cargando…</p>
          ) : cerrados.length === 0 ? (
            <p className="text-sm text-gray-500">No hay meses cerrados en {anioSel}.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {cerrados.map((m) => (
                <div key={m} className="border rounded-lg p-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                    <CheckCircle2 size={15} className="text-emerald-600" /> {MESES[m]}
                  </span>
                  <button onClick={() => reabrir(m)} disabled={busy || !esAdmin}
                    className="text-xs text-rose-600 hover:bg-rose-50 rounded px-2 py-1 inline-flex items-center gap-1 disabled:opacity-50" title="Reabrir para corregir">
                    <RotateCcw size={13} /> Reabrir
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ANUAL ── */}
      {vista === 'anual' && (
        <>
          <div className="bg-white rounded-lg border shadow-sm p-4 flex items-center gap-2 text-sm">
            <span className="text-gray-600">Ejercicio</span>
            <select value={anioSel} onChange={(e) => setAnioSel(Number(e.target.value))} className="input w-28">
              {aniosContables().map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={() => qAnual.refetch()} className="text-gray-500 hover:text-gray-700" title="Actualizar">
              <RefreshCw size={16} className={qAnual.isFetching ? 'animate-spin' : ''} />
            </button>
          </div>
          {cargando && <p className="text-sm text-gray-500">Cargando…</p>}
          {d && <ResultadoMes d={d} periodo={periodo} mensual={false}
            onGenerar={() => setConfirmar(true)} onRevertir={revertirAnual} busy={busy} esAdmin={esAdmin} />}
        </>
      )}

      {/* ── CUADRO DE MENSAJE al cerrar ── */}
      {confirmar && d && (
        <DialogoCierre d={d} periodo={periodo} mensual={vista !== 'anual'}
          onCancelar={() => setConfirmar(false)} onConfirmar={generar} busy={busy} />
      )}
    </div>
  );
}

function ResultadoMes({ d, periodo, mensual, onGenerar, onRevertir, busy, esAdmin }: {
  d: any; periodo: string; mensual: boolean; onGenerar: () => void; onRevertir?: () => void; busy: boolean; esAdmin: boolean;
}) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Cifra titulo={`Ingresos ${mensual ? 'del mes' : 'del año'}`} valor={money(d.ingresos)} />
        <Cifra titulo="Costos y gastos" valor={money(d.egresos)} />
        <div className={`rounded-lg p-4 border ${d.utilidad ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
          <p className="text-[11px] uppercase tracking-wide text-gray-500 flex items-center gap-1">
            {d.utilidad ? <TrendingUp size={13} className="text-emerald-600" /> : <TrendingDown size={13} className="text-rose-600" />}
            {d.utilidad ? 'Utilidad' : 'Pérdida'} {mensual ? 'del mes' : 'del ejercicio'}
          </p>
          <p className={`text-2xl font-bold tabular-nums ${d.utilidad ? 'text-emerald-700' : 'text-rose-700'}`}>{money(Math.abs(d.resultado))}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
        {d.cierreAsentado ? (
          <p className="text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded px-3 py-2 flex items-center gap-2">
            <CheckCircle2 size={16} /> Cierre asentado: <b>póliza #{d.cierreAsentado.folio}</b> ({aTextoMx(d.cierreAsentado.fecha)}). Puedes <b>regenerarla</b> si cambiaste pólizas.
          </p>
        ) : (
          <p className="text-sm text-gray-600">Aún no hay póliza de cierre para {periodo}.</p>
        )}
        {d.monedaExtranjera?.length > 0 && (
          <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-2">
            <Coins size={16} className="mt-0.5 shrink-0" />
            <span>Hubo operaciones en <b>{d.monedaExtranjera.map((x: any) => x.moneda).join(', ')}</b>: revisa el tipo de cambio en el cuadro al cerrar.</span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={onGenerar} disabled={busy || !esAdmin || !d.cuentas?.length} className="btn-primary">
            <PlayCircle size={16} /> {d.cierreAsentado ? 'Regenerar cierre' : 'Cerrar el periodo'}
          </button>
          {d.cierreAsentado && onRevertir && (
            <button onClick={onRevertir} disabled={busy || !esAdmin} className="btn-ghost text-rose-600 hover:bg-rose-50">
              <Undo2 size={15} /> Deshacer
            </button>
          )}
        </div>
      </div>

      {d.cuentas?.length > 0 && (
        <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-gray-50 border-b text-gray-600">
              <tr><th className="px-3 py-2 text-left">Cuenta</th><th className="px-3 py-2 text-left">Nombre</th><th className="px-3 py-2 text-left">Tipo</th><th className="px-3 py-2 text-right">Saldo</th></tr>
            </thead>
            <tbody className="divide-y">
              {d.cuentas.map((c: any) => (
                <tr key={c.id}>
                  <td className="px-3 py-1.5 font-mono text-xs">{c.codigo}</td>
                  <td className="px-3 py-1.5">{c.nombre}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-500">{c.tipo}</td>
                  <td className={`px-3 py-1.5 text-right ${c.acreedora ? 'text-emerald-700' : 'text-rose-700'}`}>{money(c.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function DialogoCierre({ d, periodo, mensual, onCancelar, onConfirmar, busy }: {
  d: any; periodo: string; mensual: boolean; onCancelar: () => void; onConfirmar: () => void; busy: boolean;
}) {
  const mx = d.monedaExtranjera || [];
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onCancelar}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><Lock size={18} className="text-amber-600" /> Cerrar {periodo}</h3>
          <button onClick={onCancelar} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div>
            <p className="font-semibold text-gray-800 mb-1">Qué voy a hacer (según las NIF):</p>
            <ul className="list-disc pl-5 space-y-1 text-gray-600">
              <li>Determinar la <b>{d.utilidad ? 'utilidad' : 'pérdida'}</b> del periodo: ingresos ({money(d.ingresos)}) − costos y gastos ({money(d.egresos)}) = <b>{money(Math.abs(d.resultado))}</b>.</li>
              <li>Saldar las cuentas de resultados contra la cuenta de capital <b>305</b> «Resultado del ejercicio» ({d.utilidad ? 'utilidad → 305.01' : 'pérdida → 305.02'}).</li>
              <li>Generar la <b>póliza de cierre</b> formal. Es <b>re-ejecutable</b>: si corriges y vuelves a cerrar, se regenera.</li>
              <li><b>No</b> altera la balanza ni el estado de resultados operativos; el resultado {mensual ? 'del mes' : 'del ejercicio'} queda asentado.</li>
              <li>El <b>ISR y la PTU</b> se capturan aparte, a mano, como pólizas de ajuste, <b>antes</b> del cierre.</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-gray-800 mb-1 flex items-center gap-1.5"><Coins size={15} /> Tipo de cambio de las operaciones:</p>
            {mx.length === 0 ? (
              <p className="text-gray-600">Todas las operaciones del periodo fueron en <b>pesos (MXN)</b>: no hay tipo de cambio que considerar.</p>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm tabular-nums">
                  <thead className="bg-gray-50 text-gray-500 text-xs"><tr><th className="px-3 py-1.5 text-left">Moneda</th><th className="px-3 py-1.5 text-right">Operaciones</th><th className="px-3 py-1.5 text-right">Tipo de cambio</th></tr></thead>
                  <tbody className="divide-y">
                    {mx.map((x: any) => (
                      <tr key={x.moneda}>
                        <td className="px-3 py-1.5 font-medium">{x.moneda}</td>
                        <td className="px-3 py-1.5 text-right">{x.operaciones}</td>
                        <td className="px-3 py-1.5 text-right">{x.tcMin === x.tcMax ? tc(x.tcMin) : `${tc(x.tcMin)} – ${tc(x.tcMax)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-gray-50">
          <button onClick={onCancelar} className="px-4 py-2 text-sm rounded-lg border text-gray-700 hover:bg-gray-100">Cancelar</button>
          <button onClick={onConfirmar} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            <Lock size={15} /> {busy ? 'Cerrando…' : 'Sí, cerrar el periodo'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Cifra({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg p-4 bg-gray-50">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{titulo}</p>
      <p className="text-2xl font-bold text-gray-900 tabular-nums">{valor}</p>
    </div>
  );
}

export default CierreEjercicioPage;
