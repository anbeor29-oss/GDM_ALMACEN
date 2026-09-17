/**
 * Cierre del ejercicio — proceso de ADMIN.
 *
 * Determina la utilidad/pérdida del año y genera la PÓLIZA DE CIERRE (salda los
 * resultados contra la 305). Re-ejecutable: cada corrida regenera la póliza con lo
 * que haya. El ISR/PTU se capturan antes como pólizas de ajuste. No altera los
 * reportes operativos (la póliza de cierre se excluye de la balanza reconstruida).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock, PlayCircle, RefreshCw, Undo2, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown } from 'lucide-react';
import api from '@/services/api';
import { aniosContables } from '@/utils/anios';
import { usePeriodoTrabajo } from '@/utils/periodoActivo';
import { useAuthStore } from '@/store/auth';

const money = (n: any) => Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function CierreEjercicioPage() {
  const { user } = useAuthStore();
  const esAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  // Arranca en el mes de trabajo, listo para el cierre MENSUAL (siguiente al último
  // cerrado). Para el cierre anual se cambia el toggle a «Anual».
  const { anio, mes, setAnio, setMes } = usePeriodoTrabajo();
  const [modo, setModo] = useState<'anual' | 'mensual'>('mensual');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const mensual = modo === 'mensual';
  const periodo = mensual ? `${MESES[mes]} ${anio}` : `${anio}`;

  const q = useQuery({
    queryKey: ['cierre', anio, modo, mes],
    queryFn: () => mensual ? api.getCierreMes(anio, mes) : api.getCierreEjercicio(anio),
  });
  const d: any = q.data?.data;
  const refrescar = () => q.refetch();

  const generar = async () => {
    setBusy(true); setMsg(''); setError('');
    try {
      const r: any = mensual ? await api.generarCierreMes(anio, mes) : await api.generarCierreEjercicio(anio);
      setMsg(r?.message || 'Póliza de cierre generada.');
      refrescar();
    } catch (e: any) { setError(e?.response?.data?.message || 'No se pudo generar el cierre.'); }
    finally { setBusy(false); }
  };
  const revertir = async () => {
    if (!confirm(`¿Deshacer la póliza de cierre de ${periodo}? Se borra la póliza; los resultados no se tocan.`)) return;
    setBusy(true); setMsg(''); setError('');
    try {
      if (mensual) await api.revertirCierreMes(anio, mes); else await api.revertirCierreEjercicio(anio);
      setMsg(`Póliza de cierre de ${periodo} deshecha.`);
      refrescar();
    } catch (e: any) { setError(e?.response?.data?.message || 'No se pudo deshacer.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-4 space-y-4 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Lock size={22} className="text-amber-600" /> Cierre del ejercicio
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Determina la utilidad o pérdida {mensual ? 'del mes' : 'del año'} y la salda contra la cuenta de capital
            {' '}(utilidad <b>305.01</b> / pérdida <b>305.02</b> «Resultado Ejercicio {anio}»).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 border rounded-lg p-0.5 bg-gray-50">
            {(['anual', 'mensual'] as const).map((k) => (
              <button key={k} onClick={() => setModo(k)}
                className={`px-3 py-1 rounded-md text-sm ${modo === k ? 'bg-white shadow font-medium text-amber-700' : 'text-gray-600'}`}>
                {k === 'anual' ? 'Anual' : 'Mensual'}
              </button>
            ))}
          </div>
          {mensual && (
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input w-32">
              {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          )}
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input w-28">
            {aniosContables().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={refrescar} className="text-gray-500 hover:text-gray-700" title="Actualizar">
            <RefreshCw size={16} className={q.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {!esAdmin && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Sólo un <b>ADMIN</b> puede generar el cierre. Puedes consultar el resultado, pero no asentarlo.
        </p>
      )}
      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</p>}
      {msg && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">{msg}</p>}

      {q.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}

      {d && (
        <>
          {/* Resultado del ejercicio */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Cifra titulo={`Ingresos ${mensual ? 'del mes' : 'del año'}`} valor={money(d.ingresos)} />
            <Cifra titulo="Costos y gastos" valor={money(d.egresos)} />
            <div className={`rounded-lg p-4 border ${d.utilidad ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 flex items-center gap-1">
                {d.utilidad ? <TrendingUp size={13} className="text-emerald-600" /> : <TrendingDown size={13} className="text-rose-600" />}
                {d.utilidad ? 'Utilidad' : 'Pérdida'} {mensual ? 'del mes' : 'del ejercicio'}
              </p>
              <p className={`text-2xl font-bold tabular-nums ${d.utilidad ? 'text-emerald-700' : 'text-rose-700'}`}>
                {money(Math.abs(d.resultado))}
              </p>
            </div>
          </div>

          {/* Estado del cierre + acciones */}
          <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
            {d.cierreAsentado ? (
              <p className="text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded px-3 py-2 flex items-center gap-2">
                <CheckCircle2 size={16} /> Cierre asentado: <b>póliza #{d.cierreAsentado.folio}</b> ({d.cierreAsentado.fecha}).
                Puedes <b>regenerarla</b> si cambiaste pólizas del año.
              </p>
            ) : (
              <p className="text-sm text-gray-600">Aún no hay póliza de cierre para {periodo}.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={generar} disabled={busy || !esAdmin || !d.cuentas?.length} className="btn-primary">
                <PlayCircle size={16} /> {busy ? 'Generando…' : d.cierreAsentado ? 'Regenerar póliza de cierre' : 'Generar póliza de cierre'}
              </button>
              {d.cierreAsentado && (
                <button onClick={revertir} disabled={busy || !esAdmin} className="btn-ghost text-rose-600 hover:bg-rose-50">
                  <Undo2 size={15} /> Deshacer
                </button>
              )}
            </div>
            <div className="text-xs text-gray-500 space-y-1">
              <p className="flex items-start gap-1"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
                El <b>ISR y la PTU</b> se capturan antes, a mano, como pólizas de ajuste. El cierre toma el resultado tal cual quede.</p>
              <p>La póliza de cierre es <b>re-ejecutable</b>: cada corrida la regenera con las pólizas {mensual ? 'del mes' : 'del año'}. Es un asiento formal —<b>no cambia</b> la balanza ni el estado de resultados operativos—.</p>
              {mensual && <p className="flex items-start gap-1 text-gray-500"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-gray-400" /> El cierre <b>mensual</b> deja asentado el resultado del mes (útil para pagos provisionales). El que traspasa el resultado a capital al cambiar de año es el <b>anual</b>.</p>}
            </div>
          </div>

          {/* Cuentas de resultados que se saldan */}
          {d.cuentas?.length > 0 && (
            <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="bg-gray-50 border-b text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Cuenta</th>
                    <th className="px-3 py-2 text-left">Nombre</th>
                    <th className="px-3 py-2 text-left">Tipo</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                  </tr>
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
      )}
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
