/**
 * Programación de la descarga del SAT: el día a día, el histórico y el cupo.
 *
 * ── POR QUÉ ESTE PANEL EXISTE ──
 * La pantalla decía "5 solicitudes enviadas · 0 verificadas · 0 paquetes · 0
 * XML" y una tabla con "4/5 · En proceso". Con eso no se puede saber lo único
 * que importa cuando se está probando una e.firma: si el SAT contestó bien y
 * no había comprobantes, o si rechazó la solicitud.
 *
 * El número "4/5" sumaba las terminadas, las que no traían datos, las
 * divididas, las rechazadas y las fallidas. Cinco cosas distintas en un
 * cociente.
 *
 * Aquí se separan: lo RESUELTO (trajo algo o confirmó que no había) de lo
 * ATORADO (el SAT lo rechazó), con el motivo textual de cada rechazo.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, Gauge, History, AlertTriangle, CheckCircle2,
  Loader2, Play, Settings2, Info, RotateCcw, RefreshCw, Stethoscope,
} from 'lucide-react';
import api from '@/services/api';

const n = (x: number) => Number(x ?? 0).toLocaleString('es-MX');

export function ProgramacionSat() {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [verProblemas, setVerProblemas] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [diag, setDiag] = useState<any>(null);

  const q = useQuery({
    queryKey: ['sat-programacion'],
    queryFn: () => api.getProgramacionSat(),
    refetchInterval: 60_000,
  });
  const d: any = q.data?.data;

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['sat-programacion'] });
    qc.invalidateQueries({ queryKey: ['sat-trabajos'] });
  };

  const accion = async (nombre: string, fn: () => Promise<any>) => {
    setMsg(''); setError(''); setBusy(nombre);
    try {
      const r = await fn();
      setMsg(r.message || 'Listo.');
      refrescar();
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message);
    } finally { setBusy(''); }
  };

  const correrDiagnostico = async () => {
    setMsg(''); setError(''); setDiag(null); setBusy('diag');
    try { const r = await api.diagnosticoSat(); setDiag(r.data); }
    catch (e: any) { setError(e?.response?.data?.message || e.message); }
    finally { setBusy(''); }
  };

  if (!d) return null;

  const p = d.presupuesto;
  const pz = d.particiones;
  const pctXml = p.xmlTope ? Math.min(100, (p.xml / p.xmlTope) * 100) : 0;
  const pctSol = p.solicitudesTope ? Math.min(100, (p.solicitudes / p.solicitudesTope) * 100) : 0;

  return (
    <div className="bg-white rounded-lg shadow border divide-y">
      {/* ── Cómo va de verdad ── */}
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
          <Gauge size={17} className="text-primary" /> Cómo va la descarga
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Cifra rotulo="XML indexados" valor={n(d.xmlIndexados)} color="text-gray-900" grande />
          <Cifra rotulo="Resueltas" valor={n(d.resueltas)} color="text-emerald-700"
            nota={`${n(pz.terminadas)} con datos · ${n(pz.sin_datos)} sin comprobantes`} />
          <Cifra rotulo="En vuelo" valor={n(d.enVuelo)} color="text-sky-700"
            nota={`${n(pz.pendientes)} por pedir · ${n(pz.solicitadas + pz.en_proceso)} esperando al SAT`} />
          <Cifra rotulo="Atoradas" valor={n(d.atoradas)}
            color={d.atoradas ? 'text-rose-700' : 'text-gray-400'}
            nota={d.atoradas ? `${n(pz.rechazadas)} rechazadas · ${n(pz.fallidas)} fallidas`
                             : 'ninguna'} />
        </div>

        {/* ── "Sin datos" NO es un error, y "rechazada" sí ── */}
        {pz.sin_datos > 0 && d.xmlIndexados === 0 && d.atoradas === 0 && (
          <p className="mt-3 text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded px-3 py-2
            flex items-start gap-2">
            <Info size={15} className="mt-0.5 shrink-0" />
            <span>
              El SAT respondió bien a las {n(pz.sin_datos)} solicitudes, pero
              <b> no había comprobantes</b> en esos periodos. La conexión funciona;
              ese RFC no tiene CFDI en esas fechas — es lo normal con una e.firma
              de prueba.
            </span>
          </p>
        )}

        {d.problemas?.length > 0 && (
          <div className="mt-3">
            {/* Resumen colapsable: en vez de un muro rojo, una línea que se abre. */}
            <button
              onClick={() => setVerProblemas(!verProblemas)}
              className="w-full text-left text-sm text-rose-800 bg-rose-50 border border-rose-200
                rounded px-3 py-2 flex items-center gap-2 hover:bg-rose-100 transition-colors">
              <AlertTriangle size={15} className="shrink-0" />
              <span className="font-medium">
                {n(d.problemas.reduce((s: number, x: any) => s + (x.veces || 1), 0))} solicitud(es) que el SAT rechazó
              </span>
              <span className="ml-auto text-xs text-rose-600 underline">
                {verProblemas ? 'ocultar' : 'ver detalle'}
              </span>
            </button>
            {verProblemas && (
              <div className="mt-1.5 space-y-1.5">
                {d.problemas.map((x: any, i: number) => (
                  <p key={i} className="text-sm text-rose-800 bg-rose-50 border border-rose-100
                    rounded px-3 py-2">
                    <b>{x.direccion} {new Date(x.desde).toLocaleDateString('es-MX')} →{' '}
                      {new Date(x.hasta).toLocaleDateString('es-MX')}</b>
                    {x.veces > 1 && ` (${x.veces} veces)`}
                    {x.codigo_sat && <span className="font-mono text-xs ml-2">[{x.codigo_sat}]</span>}
                    <br />
                    {x.mensaje_sat || 'El SAT rechazó la solicitud sin dar motivo.'}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── El presupuesto del día ── */}
      <div className="p-4">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-1">
          <CalendarClock size={17} className="text-primary" /> Cupo de hoy
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          El histórico se baja repartido por días para no dejar sin cupo a la descarga
          diaria. Al agotarse, el motor se detiene y sigue mañana.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <Barra rotulo="Comprobantes" usado={p.xml} tope={p.xmlTope} pct={pctXml} />
          <Barra rotulo="Solicitudes al SAT" usado={p.solicitudes} tope={p.solicitudesTope} pct={pctSol} />
        </div>

        {p.agotado && (
          <p className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-200
            rounded px-3 py-2">
            El cupo de hoy se agotó. Lo que ya está pedido se sigue recogiendo —un
            paquete caduca a las 72 horas—, pero no se piden rangos nuevos hasta mañana.
          </p>
        )}

        {d.ultimoDiario ? (
          <p className="mt-3 text-xs text-gray-500">
            Último trabajo automático:{' '}
            {new Date(d.ultimoDiario.created_at).toLocaleString('es-MX')} ·{' '}
            {d.ultimoDiario.direccion} ·{' '}
            {new Date(d.ultimoDiario.fecha_desde).toLocaleDateString('es-MX')} →{' '}
            {new Date(d.ultimoDiario.fecha_hasta).toLocaleDateString('es-MX')}
          </p>
        ) : (
          <p className="mt-3 text-xs text-amber-800">
            Todavía no ha corrido ningún trabajo automático. El motor lo crea a las
            6:00 (hora de México); con el botón de abajo se puede lanzar ahora.
          </p>
        )}
      </div>

      {/* ── Acciones ── */}
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => accion('diario', () => api.crearDiarioSat())}
            disabled={!!busy}
            className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-50">
            {busy === 'diario' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Pedir lo de hoy
          </button>

          <EjercicioCompleto onLanzar={(anio: number, opts: any) =>
            accion('ejercicio', () => api.crearEjercicioSat(anio, opts))} busy={busy} />

          {d.atoradas > 0 && (
            <button
              onClick={() => accion('reintentar', () => api.reintentarSatAtoradas())}
              disabled={!!busy}
              title="Vuelve a pedir sólo las solicitudes que el SAT rechazó, sin borrar lo demás"
              className="btn-secondary text-sm flex items-center gap-1.5 text-amber-700 disabled:opacity-50">
              {busy === 'reintentar' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Reintentar las {n(d.atoradas)} atoradas
            </button>
          )}

          <button
            onClick={() => {
              if (window.confirm('¿Borrar TODOS los trabajos y el cupo del día para monitorear en limpio?\n\nTu e.firma y la configuración se conservan. Esta acción no se puede deshacer.'))
                accion('reiniciar', () => api.reiniciarSatDescarga());
            }}
            disabled={!!busy}
            className="btn-secondary text-sm flex items-center gap-1.5 text-rose-700 disabled:opacity-50">
            {busy === 'reiniciar' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            Reiniciar monitor
          </button>

          <button onClick={correrDiagnostico} disabled={!!busy}
            title="Prueba la e.firma y pregunta al SAT qué pasa con las solicitudes en vuelo"
            className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-50">
            {busy === 'diag' ? <Loader2 size={14} className="animate-spin" /> : <Stethoscope size={14} />}
            Diagnóstico
          </button>

          <button onClick={() => setAbierto(!abierto)}
            className="btn-secondary text-sm flex items-center gap-1.5 ml-auto">
            <Settings2 size={14} /> Ajustes
          </button>
        </div>

        {msg && (
          <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200
            rounded px-3 py-2 flex items-start gap-2">
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> {msg}
          </p>
        )}
        {error && (
          <p className="text-sm text-rose-800 bg-rose-50 border border-rose-200
            rounded px-3 py-2 flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        {diag && (
          <div className="text-sm bg-white border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={diag.efirma?.ok ? 'text-emerald-700' : 'text-rose-700'}>
                e.firma {diag.efirma?.ok ? `✓ ${diag.efirma.rfc}` : `✗ ${diag.efirma?.mensaje || ''}`}
              </span>
              <span className={diag.autenticacion?.ok ? 'text-emerald-700' : 'text-rose-700'}>
                · Autenticación {diag.autenticacion?.ok ? '✓' : `✗ ${diag.autenticacion?.mensaje || 'no probada'}`}
              </span>
              <span className="text-gray-500">
                · {diag.solicitudes?.length || 0} solicitud(es) verificadas
              </span>
            </div>
            {diag.solicitudes?.length > 0 && (
              <ul className="divide-y text-xs">
                {diag.solicitudes.map((s: any, i: number) => (
                  <li key={i} className="py-1.5 flex items-center gap-2 flex-wrap">
                    <span className="text-gray-700">{s.direccion} · {s.periodo}</span>
                    <span className={`font-medium ${
                      s.estado === 'TERMINADA' ? 'text-emerald-700'
                      : (String(s.estado).includes('PROCESO') || s.estado === 'ACEPTADA') ? 'text-sky-700'
                      : 'text-rose-700'}`}>{s.error ? 'ERROR' : s.estado}</span>
                    {s.paquetes > 0 && <span className="text-emerald-700">{s.paquetes} paquete(s)</span>}
                    {s.cfdis > 0 && <span className="text-gray-500">{s.cfdis} CFDI</span>}
                    {(s.mensaje || s.error) && <span className="text-gray-500">· {s.error || s.mensaje}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-gray-500">
              <b>EN PROCESO / ACEPTADA</b> = el SAT todavía prepara los paquetes (hay que esperar).{' '}
              <b>TERMINADA</b> con paquetes = ya están listos y el problema sería la descarga.{' '}
              Un <b>error</b> muestra su motivo. No cambia nada: es solo consulta.
            </p>
          </div>
        )}

        {abierto && <Ajustes config={d.config} onGuardado={refrescar} />}
      </div>
    </div>
  );
}

/* ═══════════ PIEZAS ═══════════ */

function Cifra({ rotulo, valor, color, nota, grande }: any) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{rotulo}</p>
      <p className={`font-bold tabular-nums ${color} ${grande ? 'text-2xl' : 'text-xl'}`}>
        {valor}
      </p>
      {nota && <p className="text-[11px] text-gray-500 leading-tight mt-0.5">{nota}</p>}
    </div>
  );
}

function Barra({ rotulo, usado, tope, pct }: any) {
  const lleno = pct >= 100;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-600">{rotulo}</span>
        <span className={`tabular-nums font-medium ${lleno ? 'text-amber-700' : 'text-gray-700'}`}>
          {n(usado)} / {n(tope)}
        </span>
      </div>
      <div className="h-2 rounded bg-gray-100 overflow-hidden">
        <div className={`h-full rounded transition-all ${
          lleno ? 'bg-amber-500' : pct > 75 ? 'bg-sky-500' : 'bg-emerald-500'}`}
          style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  );
}

function EjercicioCompleto({ onLanzar, busy }: any) {
  const [abierto, setAbierto] = useState(false);
  const hoy = new Date().getFullYear();
  const [anio, setAnio] = useState(hoy - 1);
  const [recibidos, setRecibidos] = useState(true);
  const [emitidos, setEmitidos] = useState(true);

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} disabled={!!busy}
        className="btn-secondary text-sm flex items-center gap-1.5 disabled:opacity-50">
        {busy === 'ejercicio' ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />}
        Traer un ejercicio completo
      </button>
    );
  }

  return (
    <div className="w-full border rounded-lg p-3 bg-gray-50/60">
      <p className="text-sm font-medium text-gray-800 mb-2">Ejercicio completo</p>
      <p className="text-xs text-gray-600 mb-3">
        Se crea un trabajo por mes. No se descarga de golpe: el motor los va bajando
        dentro del cupo diario, así que un año con volumen tarda varios días — y eso
        es lo correcto, bajarlo de un tirón dejaría sin cupo a la descarga del día.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs text-gray-600">Año</span>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input">
            {Array.from({ length: 8 }, (_, i) => hoy - i).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={recibidos} onChange={(e) => setRecibidos(e.target.checked)} />
          Recibidos
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={emitidos} onChange={(e) => setEmitidos(e.target.checked)} />
          Emitidos
        </label>
        <button
          onClick={() => { onLanzar(anio, { recibidos, emitidos }); setAbierto(false); }}
          disabled={!recibidos && !emitidos}
          className="btn-primary text-sm disabled:opacity-50">
          Crear los trabajos
        </button>
        <button onClick={() => setAbierto(false)} className="btn-secondary text-sm">
          Cancelar
        </button>
      </div>
      {anio === hoy && (
        <p className="text-[11px] text-gray-500 mt-2">
          Del año en curso se piden los meses ya cerrados; el mes actual lo trae la
          descarga diaria.
        </p>
      )}
    </div>
  );
}

function Ajustes({ config, onGuardado }: any) {
  const [f, setF] = useState({ ...config });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const guardar = async () => {
    setError(''); setBusy(true);
    try { await api.guardarProgramacionSat(f); onGuardado(); }
    catch (e: any) { setError(e?.response?.data?.message || e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="border rounded-lg p-3 bg-gray-50/60 space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.diariaActiva}
          onChange={(e) => setF({ ...f, diariaActiva: e.target.checked })} />
        Pedir al SAT automáticamente todos los días
      </label>

      <div className="flex flex-wrap gap-4 pl-6">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={f.diariaRecibidos}
            onChange={(e) => setF({ ...f, diariaRecibidos: e.target.checked })} />
          Recibidos
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={f.diariaEmitidos}
            onChange={(e) => setF({ ...f, diariaEmitidos: e.target.checked })} />
          Emitidos
        </label>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs text-gray-600">Días hacia atrás</span>
          <input type="number" min={1} max={30} value={f.diasAtras}
            onChange={(e) => setF({ ...f, diasAtras: Number(e.target.value) })}
            className="input w-full" />
          <span className="block text-[11px] text-gray-500">
            El SAT tarda en publicar. Pedir sólo ayer deja huecos que nadie ve.
          </span>
        </label>
        <label className="block">
          <span className="text-xs text-gray-600">Comprobantes por día</span>
          <input type="number" min={100} max={500000} step={100} value={f.xmlPorDia}
            onChange={(e) => setF({ ...f, xmlPorDia: Number(e.target.value) })}
            className="input w-full" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-600">Solicitudes por día</span>
          <input type="number" min={1} max={500} value={f.solicitudesPorDia}
            onChange={(e) => setF({ ...f, solicitudesPorDia: Number(e.target.value) })}
            className="input w-full" />
        </label>
      </div>

      {error && (
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <button onClick={guardar} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
        {busy ? 'Guardando…' : 'Guardar ajustes'}
      </button>
    </div>
  );
}

export default ProgramacionSat;
