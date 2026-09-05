/**
 * Periodos contables — dónde se alimenta y se corta cada mes.
 *
 * ── REJILLA DE DOCE, COMO EN BANCOS ──
 * Una lista muestra lo que hay. Una rejilla de doce muestra lo que FALTA, y
 * eso es lo que importa: un año con marzo y mayo pero sin abril tiene un salto
 * de saldos que no se explica solo, y cada mes por separado se ve perfecto.
 *
 * ── EL CIERRE ──
 * Cerrar un mes congela sus saldos. Es lo que hace que "el balance de julio"
 * signifique algo dentro de seis meses, y lo que impide que la balanza que se
 * envió al SAT deje de coincidir con la que el sistema muestra.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload, Lock, Unlock, CheckCircle2,
  AlertTriangle, FileSpreadsheet, X,
} from 'lucide-react';
import api from '@/services/api';
import { useCapacidades, CAP } from '@/utils/capacidades';
import { aniosContables } from '@/utils/anios';
import { mx, MESES, ETIQUETA_FUENTE } from './piezas';

export function PeriodosPage() {
  const qc = useQueryClient();
  const { puede } = useCapacidades();
  const puedeCargar = puede(CAP.ctaCapturar);
  const puedeCerrar = puede(CAP.ctaCerrar);

  const [anio, setAnio] = useState(new Date().getFullYear());
  const [cargando, setCargando] = useState<{ mes: number } | null>(null);
  const [error, setError] = useState('');

  const q = useQuery({
    queryKey: ['periodos', anio],
    queryFn: () => api.getPeriodosContables(anio),
  });
  const d: any = q.data?.data;
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['periodos'] });
    qc.invalidateQueries({ queryKey: ['estados-periodo'] });
    qc.invalidateQueries({ queryKey: ['balanza-periodo'] });
  };

  const cerrar = async (mes: number) => {
    if (!confirm(`¿Cerrar ${MESES[mes]} ${anio}?\n\nSus saldos quedan congelados.`)) return;
    setError('');
    try { await api.cerrarPeriodoContable(anio, mes); refrescar(); }
    catch (e: any) { setError(e?.response?.data?.message || e.message); }
  };

  const reabrir = async (mes: number) => {
    if (!confirm(`¿Reabrir ${MESES[mes]} ${anio}?`)) return;
    setError('');
    try { await api.reabrirPeriodoContable(anio, mes); refrescar(); }
    catch (e: any) { setError(e?.response?.data?.message || e.message); }
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Periodos contables</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Aquí se alimenta cada mes y aquí se corta. Todos los estados financieros
            salen de estos saldos.
          </p>
        </div>
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-semibold
            focus:ring-2 focus:ring-amber-500 focus:border-amber-500">
          {aniosContables().map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {error && (
        <p className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded px-3 py-2
          flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {/* Los saltos entre meses: van arriba porque invalidan todo lo posterior. */}
      {d?.saltos?.map((s: string, i: number) => (
        <p key={i} className="text-sm text-rose-800 bg-rose-50 border border-rose-200
          rounded px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {s}
        </p>
      ))}

      {d?.huecos?.length > 0 && (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <b>Faltan meses en medio:</b> {d.huecos.join(', ')}. Un hueco descuadra todos
          los saldos posteriores, y cada mes por separado se ve perfecto.
        </p>
      )}

      {d && (
        <p className="text-xs text-gray-500">
          {d.conDatos} de 12 meses con saldos · {d.cerrados} cerrados
        </p>
      )}

      {q.isLoading && <p className="text-gray-500">Cargando…</p>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {(d?.meses || []).map((m: any) => (
          <Casilla key={m.mes} m={m}
            puedeCargar={puedeCargar} puedeCerrar={puedeCerrar}
            onCargar={() => setCargando({ mes: m.mes })}
            onCerrar={() => cerrar(m.mes)} onReabrir={() => reabrir(m.mes)} />
        ))}
      </div>

      {cargando && (
        <ModalCarga anio={anio} mes={cargando.mes}
          onCerrar={() => setCargando(null)}
          onListo={() => { setCargando(null); refrescar(); }} />
      )}
    </div>
  );
}

function Casilla({ m, puedeCargar, puedeCerrar, onCargar, onCerrar, onReabrir }: any) {
  const cerrado = m.estado === 'CERRADO';
  const sinEjercicio = m.estado === 'SIN_EJERCICIO';

  if (sinEjercicio) {
    return (
      <div className="border border-dashed rounded-lg p-3 opacity-60">
        <p className="font-medium text-gray-500 text-sm">{MESES[m.mes]}</p>
        <p className="text-xs text-gray-400 mt-1">El ejercicio no está abierto</p>
      </div>
    );
  }

  if (!m.tieneDatos) {
    return (
      <button disabled={!puedeCargar} onClick={onCargar}
        className="border border-dashed rounded-lg p-3 text-left hover:border-emerald-400
          hover:bg-emerald-50/40 transition disabled:opacity-60 disabled:cursor-default">
        <p className="font-medium text-gray-500 text-sm">{MESES[m.mes]}</p>
        <p className="text-xs text-gray-400 mt-1">Sin saldos</p>
        {puedeCargar && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 mt-2">
            <Upload size={12} /> Cargar balanza
          </span>
        )}
      </button>
    );
  }

  return (
    <div className={`border rounded-lg p-3 ${
      cerrado ? 'border-gray-300 bg-gray-50'
      : m.cuadra ? 'border-emerald-200 bg-emerald-50/30'
      : 'border-rose-300 bg-rose-50/40'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-gray-900 text-sm">{MESES[m.mes]}</p>
        {cerrado ? <Lock size={14} className="text-gray-500 shrink-0" />
          : m.cuadra ? <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
          : <AlertTriangle size={15} className="text-rose-600 shrink-0" />}
      </div>

      <p className="text-xs text-gray-600 mt-1">{m.cuentasConSaldo} cuentas</p>
      <p className="text-[11px] text-gray-500">
        Cargos {mx(m.totalCargos)}<br />Abonos {mx(m.totalAbonos)}
      </p>
      {!m.cuadra && <p className="text-[11px] text-rose-700 mt-1">No cuadra</p>}

      {m.fuentes?.length > 0 && (
        <p className="text-[10px] text-gray-500 mt-1 truncate"
          title={m.fuentes.map((f: any) => ETIQUETA_FUENTE[f.fuente] || f.fuente).join(', ')}>
          {m.fuentes.map((f: any) => ETIQUETA_FUENTE[f.fuente] || f.fuente).join(', ')}
        </p>
      )}

      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-200/70">
        <a href={`/contabilidad/situacion`} className="text-xs text-primary hover:underline">
          Ver estados
        </a>
        {!cerrado && puedeCargar && (
          <button onClick={onCargar} title="Volver a cargar (reemplaza)"
            className="text-gray-500 hover:text-emerald-700"><Upload size={13} /></button>
        )}
        {puedeCerrar && (
          cerrado
            ? <button onClick={onReabrir} title="Reabrir"
                className="text-gray-500 hover:text-amber-700 ml-auto"><Unlock size={13} /></button>
            : <button onClick={onCerrar} title="Cerrar el mes"
                className="text-gray-500 hover:text-gray-900 ml-auto"><Lock size={13} /></button>
        )}
      </div>
    </div>
  );
}

function ModalCarga({ anio, mes, onCerrar, onListo }: any) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const subir = async () => {
    if (!archivo) return;
    setError(''); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const r = await api.cargarBalanzaEnPeriodo(anio, mes, fd);
      setOk(r.message || 'Cargado.');
      setTimeout(onListo, 900);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-start justify-between p-4 border-b">
          <div>
            <h3 className="font-semibold text-gray-900">
              Cargar {MESES[mes]} {anio}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Balanza de comprobación de otro sistema, en Excel o PDF.
            </p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          <label className="block">
            <div className={`border border-dashed rounded px-3 py-4 text-sm cursor-pointer
              hover:border-primary ${archivo ? 'border-emerald-300 bg-emerald-50/40' : ''}`}>
              <input type="file" accept=".xlsx,.xls,.pdf" className="hidden"
                onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
              <span className="flex items-center gap-2 text-gray-700">
                {archivo ? <FileSpreadsheet size={16} className="text-emerald-600" />
                         : <Upload size={16} className="text-gray-400" />}
                {archivo ? archivo.name : 'Elige el Excel o PDF'}
              </span>
            </div>
          </label>

          <p className="text-[11px] text-gray-500">
            Volver a cargar este mes <b>reemplaza</b> lo que había de esta fuente, no lo suma.
            Una balanza que no cuadre se rechaza: si se guardara, todos los estados del
            mes saldrían de un descuadre.
          </p>

          {error && (
            <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              {error}
            </p>
          )}
          {ok && (
            <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200
              rounded px-3 py-2">{ok}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onCerrar} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={subir} disabled={busy || !archivo}
            className="btn-primary text-sm disabled:opacity-50">
            {busy ? 'Cargando…' : 'Cargar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PeriodosPage;
