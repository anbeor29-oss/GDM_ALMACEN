/**
 * IMSS · IDSE — un solo constructor para todos los movimientos afiliatorios.
 *
 * LO QUE ESTA PANTALLA RESUELVE
 * El IDSE pide un TXT de posición fija imposible de teclear a mano. Aquí se arma
 * UNA lista con altas (08), bajas (02) y modificaciones (07) MEZCLADAS, cada una
 * con su casilla para decir si entra al archivo, y un solo botón genera el TXT
 * con las marcadas. Las bajas, reingresos, cambios de salario y altas manuales
 * caen solos en esta lista; también se puede agregar a alguien del padrón.
 *
 * NO GENERA A MEDIAS
 * Si a alguien le falta el NSS, o a una baja le falta la causa, el archivo no se
 * produce y se listan todos los que hay que corregir.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HeartPulse, Search, UserPlus, UserMinus, TrendingUp, X, Download,
  AlertTriangle, CheckCircle2, SlidersHorizontal, Upload,
} from 'lucide-react';
import api from '@/services/api';
import { CampoFecha } from '@/components/CampoFecha';
import { useCapacidades, CAP } from '@/utils/capacidades';

type Tipo = 'ALTA' | 'BAJA' | 'MODIFICACION';

/** Causas de baja del IMSS (posición 149 del registro). */
const CAUSAS_BAJA: Record<string, string> = {
  '1': 'Término de contrato', '2': 'Separación voluntaria', '3': 'Abandono de empleo',
  '4': 'Defunción', '5': 'Clausura', '6': 'Otras', '7': 'Ausentismo',
  '8': 'Rescisión de contrato', '9': 'Jubilación', 'A': 'Pensión',
};

const TIPOS: { clave: Tipo; label: string; icono: any; ayuda: string }[] = [
  { clave: 'ALTA',         label: 'Alta / Reingreso',   icono: UserPlus,   ayuda: 'Inscribe o reinscribe. Movimiento 08.' },
  { clave: 'BAJA',         label: 'Baja',               icono: UserMinus,  ayuda: 'Baja con su causa. Movimiento 02.' },
  { clave: 'MODIFICACION', label: 'Modif. de salario',  icono: TrendingUp, ayuda: 'Cambia el SBC. Movimiento 07.' },
];

const ETIQUETA_TIPO: Record<string, string> = {
  ALTA: 'ALTA', BAJA: 'BAJA', MODIFICACION: 'MODIF.',
};

/** Hoy en AAAA-MM-DD según el reloj local (sin corrimiento por UTC). */
function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Un movimiento del constructor: su tipo, sus datos, si entra al archivo, y —si
 *  vino de la cola— su id de pendiente para marcarlo enviado. */
interface Fila {
  tipo: Tipo;
  fecha: string;
  sbc: string;
  umf: string;
  clave: string;
  curp: string;
  causaBaja: string;
  incluir: boolean;
  pendienteId?: string;
}

export function MotorImssIdsePage() {
  const { puede } = useCapacidades();
  const esAdmin = puede(CAP.nomina);

  const [modo, setModo] = useState<'movimientos' | 'validar'>('movimientos');
  const [tipoNuevo, setTipoNuevo] = useState<Tipo>('ALTA');
  const [buscar, setBuscar] = useState('');
  const [incluirBajas, setIncluirBajas] = useState(false);
  const [sel, setSel] = useState<Record<string, Fila>>({});
  const [datos, setDatos] = useState<Record<string, any>>({});   // nombre/nss para pintar
  const [verParametros, setVerParametros] = useState(false);
  const [cfg, setCfg] = useState({ guia: '01400', tipoTrabajador: '1', tipoSalario: '2', jornada: '0' });

  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [generando, setGenerando] = useState(false);

  const q = useQuery({
    queryKey: ['empleados-idse', buscar, incluirBajas, tipoNuevo],
    queryFn: () => api.getEmpleados({ buscar, incluirBajas: incluirBajas || tipoNuevo === 'ALTA' }),
  });
  const lista: any[] = q.data?.data?.empleados || [];
  const porId = useMemo(() => new Map(lista.map((e) => [e.id, e])), [lista]);

  const pendQ = useQuery({ queryKey: ['idse-pendientes'], queryFn: () => api.getIdsePendientes() });
  const enviQ = useQuery({ queryKey: ['idse-enviados'], queryFn: () => api.getIdseEnviados() });
  const pendientes: any[] = pendQ.data?.data?.pendientes || [];
  const enviados: any[] = enviQ.data?.data?.enviados || [];

  /* Los pendientes de la cola se sincronizan con la lista: se agregan los nuevos y
   * se quitan los que ya se enviaron o descartaron. Se conservan las ediciones y
   * los que se agregaron a mano (sin pendienteId). Se disparara sólo cuando la
   * firma de los ids cambie, no en cada render. */
  const pendSig = pendientes.map((p) => p.id).join(',');
  useEffect(() => {
    setSel((prev) => {
      const next = { ...prev };
      const vivos = new Set(pendientes.map((p) => p.id));
      for (const id of Object.keys(next)) {
        if (next[id].pendienteId && !vivos.has(next[id].pendienteId)) delete next[id];
      }
      for (const p of pendientes) {
        if (!next[p.empleado_id]) {
          next[p.empleado_id] = {
            tipo: p.tipo, fecha: p.fecha || hoyIso(),
            sbc: p.sbc != null ? String(p.sbc) : '',
            umf: '', clave: p.num_empleado || '', curp: '',
            causaBaja: p.causa_baja || '', incluir: true, pendienteId: p.id,
          };
        }
      }
      return next;
    });
    setDatos((prev) => {
      const next = { ...prev };
      for (const p of pendientes) next[p.empleado_id] = { nombre_completo: p.nombre_completo, nss: p.nss };
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendSig]);

  const filas = Object.keys(sel);
  const incluidos = filas.filter((id) => sel[id].incluir);
  const datosDe = (id: string) => porId.get(id) || datos[id] || {};

  const agregar = (e: any) => {
    setOk(''); setError('');
    setDatos((d) => ({ ...d, [e.id]: { nombre_completo: e.nombre_completo, nss: e.nss } }));
    setSel((prev) => {
      if (prev[e.id]) return prev;   // ya está: no duplica
      return {
        ...prev,
        [e.id]: {
          tipo: tipoNuevo, fecha: hoyIso(),
          sbc: String(Number(e.sbc ?? e.salario_diario_integrado ?? 0) || ''),
          umf: '', clave: e.num_empleado || '', curp: e.curp || '',
          causaBaja: '', incluir: true,
        },
      };
    });
  };

  const editar = (id: string, campo: keyof Fila, valor: any) =>
    setSel((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }));

  const quitar = (id: string) =>
    setSel((prev) => { const c = { ...prev }; delete c[id]; return c; });

  const marcarTodos = (v: boolean) =>
    setSel((prev) => Object.fromEntries(Object.entries(prev).map(([k, f]) => [k, { ...f, incluir: v }])));

  const generar = async () => {
    setError(''); setOk(''); setGenerando(true);
    try {
      const movimientos = incluidos.map((id) => {
        const f = sel[id];
        return {
          empleadoId: id, tipo: f.tipo, fecha: f.fecha,
          sbc: f.sbc === '' ? undefined : Number(f.sbc),
          umf: f.umf || undefined,
          claveTrabajador: f.clave || undefined,
          curp: f.curp || undefined,
          causaBaja: f.causaBaja || undefined,
        };
      });
      await api.generarIdseMixto({ movimientos, ...cfg });
      setOk(`Archivo con ${movimientos.length} movimiento(s) descargado. Súbelo al IDSE; cuando pase, marca "ya pasó".`);
    } catch (e: any) {
      setError(e?.message || 'No se pudo generar el archivo.');
    } finally { setGenerando(false); }
  };

  /* "Ya pasó en el IDSE": los que vienen de la cola pasan a enviados; los que se
   * agregaron a mano sólo salen de la lista (no estaban registrados). */
  const yaPaso = async (id: string) => {
    const f = sel[id];
    try {
      if (f.pendienteId) { await api.marcarIdseEnviados([f.pendienteId]); pendQ.refetch(); enviQ.refetch(); }
      else quitar(id);
    } catch (e: any) { setError(e?.response?.data?.message || 'No se pudo.'); }
  };

  const descartar = async (id: string) => {
    const f = sel[id];
    if (f.pendienteId) { try { await api.descartarIdsePendiente(f.pendienteId); pendQ.refetch(); } catch { /* nada */ } }
    else quitar(id);
  };

  const regresar = async (pid: string) => {
    try { await api.regresarIdsePendientes([pid]); pendQ.refetch(); enviQ.refetch(); } catch { /* nada */ }
  };

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 grid place-items-center">
          <HeartPulse size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">IMSS · IDSE</h1>
          <p className="text-sm text-gray-500">
            Todos los movimientos (altas, bajas y modificaciones) en un solo archivo.
          </p>
        </div>
      </div>

      {/* Pestañas */}
      <div className="flex gap-1 border-b">
        {([['movimientos', 'Movimientos'], ['validar', 'Validar archivo']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setModo(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              modo === k ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {modo === 'validar' ? <ValidadorIdse /> : <>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Padrón: agregar movimientos ── */}
        <div className="bg-white rounded-lg shadow border overflow-hidden">
          <div className="p-3 border-b space-y-2">
            <p className="text-[11px] text-gray-500">Al agregar de la lista, el movimiento entra como:</p>
            <div className="grid grid-cols-3 gap-1.5">
              {TIPOS.map((t) => {
                const activo = tipoNuevo === t.clave;
                const Icono = t.icono;
                return (
                  <button key={t.clave} onClick={() => setTipoNuevo(t.clave)}
                    title={t.ayuda}
                    className={`text-xs rounded-lg border px-2 py-1.5 flex items-center justify-center gap-1 ${
                      activo ? 'border-violet-500 bg-violet-50 text-violet-800 font-medium' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    <Icono size={14} /> {t.label}
                  </button>
                );
              })}
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
                placeholder="Buscar por nombre, número, RFC, CURP o NSS…"
                value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            </div>
            {tipoNuevo !== 'ALTA' && (
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={incluirBajas} onChange={(e) => setIncluirBajas(e.target.checked)} />
                Incluir a los que ya están de baja
              </label>
            )}
          </div>
          <div className="max-h-[24rem] overflow-y-auto divide-y">
            {q.isLoading && <p className="p-4 text-sm text-gray-500">Cargando plantilla…</p>}
            {!q.isLoading && lista.length === 0 && (
              <p className="p-6 text-sm text-gray-500 italic text-center">Nadie coincide con esa búsqueda.</p>
            )}
            {lista.map((e) => {
              const puesto = !!sel[e.id];
              return (
                <button key={e.id} onClick={() => agregar(e)} disabled={puesto}
                  className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-50 ${puesto ? 'opacity-50' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{e.nombre_completo}</p>
                    <p className="text-[11px] text-gray-500 font-mono">
                      #{e.num_empleado || '—'} · NSS {e.nss || <span className="text-rose-600">falta</span>}
                      {!e.activo && <span className="text-rose-600"> · baja</span>}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{puesto ? 'agregado' : 'agregar +'}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── El archivo: movimientos mezclados ── */}
        <div className="bg-white rounded-lg shadow border overflow-hidden flex flex-col">
          <div className="p-3 border-b flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-800">{incluidos.length} en el archivo · {filas.length} en total</p>
            {filas.length > 0 && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={filas.every((id) => sel[id].incluir)}
                    onChange={(e) => marcarTodos(e.target.checked)} />
                  Todos
                </label>
                <button onClick={() => setSel({})} className="text-xs text-gray-500 hover:text-rose-600">Vaciar</button>
              </div>
            )}
          </div>

          <div className="max-h-[24rem] overflow-y-auto">
            {filas.length === 0 ? (
              <p className="p-6 text-sm text-gray-500 italic text-center">
                Aún no hay movimientos. Se llenan solos con las bajas, reingresos, cambios de salario y altas;
                o agrega a alguien de la izquierda.
              </p>
            ) : (
              <ul className="divide-y">
                {filas.map((id) => {
                  const e = datosDe(id);
                  const f = sel[id];
                  return (
                    <li key={id} className={`p-2.5 space-y-2 ${f.incluir ? '' : 'opacity-60'}`}>
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={f.incluir}
                          onChange={(ev) => editar(id, 'incluir', ev.target.checked)} title="Entra al archivo" />
                        <select value={f.tipo} onChange={(ev) => editar(id, 'tipo', ev.target.value as Tipo)}
                          className={`text-[11px] font-bold rounded px-1.5 py-1 border ${
                            f.tipo === 'BAJA' ? 'text-rose-700 border-rose-200'
                            : f.tipo === 'ALTA' ? 'text-emerald-700 border-emerald-200'
                            : 'text-violet-700 border-violet-200'}`}>
                          <option value="ALTA">ALTA 08</option>
                          <option value="BAJA">BAJA 02</option>
                          <option value="MODIFICACION">MODIF 07</option>
                        </select>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">{e?.nombre_completo || 'Trabajador'}</p>
                          <p className="text-[11px] font-mono text-gray-500">
                            NSS {e?.nss || <span className="text-rose-600 font-semibold">falta</span>}
                          </p>
                        </div>
                        <button onClick={() => yaPaso(id)} title="Ya pasó en el IDSE"
                          className="text-[11px] text-emerald-700 hover:bg-emerald-50 px-1.5 py-1 rounded flex items-center gap-1">
                          <CheckCircle2 size={13} /> ya pasó
                        </button>
                        <button onClick={() => descartar(id)} className="text-gray-400 hover:text-rose-600" title="Quitar"><X size={15} /></button>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-6">
                        <label className="text-[11px] text-gray-500">
                          {f.tipo === 'BAJA' ? 'Fecha baja' : f.tipo === 'MODIFICACION' ? 'Fecha cambio' : 'Fecha alta'}
                          <CampoFecha value={f.fecha} onChange={(iso) => editar(id, 'fecha', iso)} className="w-full border rounded px-2 py-1 text-sm mt-0.5" />
                        </label>
                        {(f.tipo === 'ALTA' || f.tipo === 'MODIFICACION') && (
                          <label className="text-[11px] text-gray-500">
                            SBC
                            <input type="number" step="0.01" min="0" value={f.sbc}
                              onChange={(ev) => editar(id, 'sbc', ev.target.value)}
                              className="w-full border rounded px-2 py-1 text-sm mt-0.5" />
                          </label>
                        )}
                        {f.tipo === 'ALTA' && (
                          <label className="text-[11px] text-gray-500">
                            UMF
                            <input value={f.umf} maxLength={3}
                              onChange={(ev) => editar(id, 'umf', ev.target.value.replace(/\D/g, ''))}
                              className="w-full border rounded px-2 py-1 text-sm mt-0.5" />
                          </label>
                        )}
                        {f.tipo === 'BAJA' && (
                          <label className="text-[11px] text-gray-500 sm:col-span-2">
                            Causa de baja
                            <select value={f.causaBaja} onChange={(ev) => editar(id, 'causaBaja', ev.target.value)}
                              className="w-full border rounded px-2 py-1 text-sm mt-0.5 bg-white">
                              <option value="">— elige —</option>
                              {Object.entries(CAUSAS_BAJA).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
                            </select>
                          </label>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Parámetros del archivo */}
          <div className="border-t">
            <button onClick={() => setVerParametros((v) => !v)}
              className="w-full px-3 py-2 flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700">
              <SlidersHorizontal size={14} /> Parámetros del archivo (guía, tipo de trabajador, salario, jornada)
            </button>
            {verParametros && (
              <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <label className="text-[11px] text-gray-500">Guía
                  <input value={cfg.guia} onChange={(e) => setCfg({ ...cfg, guia: e.target.value })}
                    className="w-full border rounded px-2 py-1 text-sm mt-0.5" /></label>
                <label className="text-[11px] text-gray-500">Tipo trabajador
                  <input value={cfg.tipoTrabajador} maxLength={1} onChange={(e) => setCfg({ ...cfg, tipoTrabajador: e.target.value })}
                    className="w-full border rounded px-2 py-1 text-sm mt-0.5" /></label>
                <label className="text-[11px] text-gray-500">Tipo salario
                  <select value={cfg.tipoSalario} onChange={(e) => setCfg({ ...cfg, tipoSalario: e.target.value })}
                    className="w-full border rounded px-2 py-1 text-sm mt-0.5 bg-white">
                    <option value="1">1 · Fijo</option><option value="2">2 · Variable</option><option value="3">3 · Mixto</option>
                  </select></label>
                <label className="text-[11px] text-gray-500">Jornada
                  <input value={cfg.jornada} maxLength={1} onChange={(e) => setCfg({ ...cfg, jornada: e.target.value })}
                    className="w-full border rounded px-2 py-1 text-sm mt-0.5" /></label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Avisos */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2 whitespace-pre-line">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}
      {ok && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> <span>{ok}</span>
        </div>
      )}

      {/* Un solo botón */}
      <div className="flex items-center justify-end gap-3">
        {incluidos.some((id) => !datosDe(id)?.nss) && (
          <p className="text-xs text-amber-700 flex items-center gap-1 mr-auto">
            <AlertTriangle size={13} /> Hay movimientos sin NSS: el archivo no se generará hasta capturarlo.
          </p>
        )}
        <button onClick={generar} disabled={!esAdmin || generando || incluidos.length === 0}
          className="bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 flex items-center gap-2 disabled:opacity-50"
          title={!esAdmin ? 'Necesitas la capacidad de nómina' : undefined}>
          <Download size={16} />
          {generando ? 'Generando…' : `Generar archivo IDSE (${incluidos.length})`}
        </button>
      </div>

      {/* Ya pasaron en el IDSE */}
      {enviados.length > 0 && (
        <div className="bg-white rounded-lg shadow border">
          <p className="text-sm font-semibold text-gray-800 px-3 py-2 border-b">Ya pasaron en el IDSE</p>
          <ul className="divide-y">
            {enviados.map((p) => (
              <li key={p.id} className="px-3 py-2 flex items-center gap-3 text-sm">
                <span className="text-[10px] font-bold text-gray-500 w-16 shrink-0">{ETIQUETA_TIPO[p.tipo] || p.tipo}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-700 truncate">{p.nombre_completo}</p>
                  <p className="text-[11px] text-gray-400 font-mono">#{p.num_empleado || '—'} · {p.fecha}{p.enviado ? ` · confirmado ${p.enviado}` : ''}</p>
                </div>
                <button onClick={() => regresar(p.id)} className="text-xs text-violet-700 hover:bg-violet-50 px-2 py-1 rounded">↩ regresar</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      </>}
    </div>
  );
}

/* ═══════════════════════════ VALIDADOR DE ARCHIVOS IDSE ═══════════════════════════ */

/**
 * Revisa un TXT del IDSE —el que generó este módulo o uno de otro sistema— contra
 * las posiciones de la guía, antes de subirlo al IMSS. Se pega el texto o se sube
 * el archivo; el servidor devuelve TODOS los problemas de una vez.
 */
function ValidadorIdse() {
  const [contenido, setContenido] = useState('');
  const [res, setRes] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [validando, setValidando] = useState(false);

  const subirArchivo = (file: File | null) => {
    if (!file) return;
    setError(''); setRes(null);
    const lector = new FileReader();
    lector.onload = () => setContenido(String(lector.result || ''));
    lector.onerror = () => setError('No se pudo leer el archivo.');
    lector.readAsText(file, 'utf-8');
  };

  const validar = async () => {
    setError(''); setRes(null); setValidando(true);
    try {
      const r = await api.validarIdse(contenido);
      setRes(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'No se pudo validar.');
    } finally {
      setValidando(false);
    }
  };

  const errores = res?.problemas?.filter((p: any) => p.nivel === 'error') || [];
  const avisos = res?.problemas?.filter((p: any) => p.nivel === 'aviso') || [];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow border p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-violet-700 hover:text-violet-800 cursor-pointer flex items-center gap-1.5">
            <Upload size={16} />
            <span>Subir un .txt</span>
            <input type="file" accept=".txt,text/plain" className="hidden"
              onChange={(e) => subirArchivo(e.target.files?.[0] || null)} />
          </label>
          <span className="text-xs text-gray-400">o pega el contenido abajo</span>
          {contenido && (
            <button onClick={() => { setContenido(''); setRes(null); setError(''); }}
              className="ml-auto text-xs text-gray-500 hover:text-rose-600">Limpiar</button>
          )}
        </div>
        <textarea
          value={contenido}
          onChange={(e) => { setContenido(e.target.value); setRes(null); }}
          spellCheck={false}
          placeholder="Cada línea es un movimiento de 168 caracteres; la última, la cifra de control…"
          className="w-full h-48 border rounded-lg px-3 py-2 text-xs font-mono whitespace-pre overflow-x-auto"
        />
        <div className="flex items-center gap-3">
          <button onClick={validar} disabled={validando || !contenido.trim()}
            className="bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 flex items-center gap-2 disabled:opacity-50 text-sm">
            <CheckCircle2 size={16} />
            {validando ? 'Validando…' : 'Validar archivo'}
          </button>
          {contenido && (
            <span className="text-xs text-gray-500">
              {contenido.split(/\r\n|\r|\n/).filter((l) => l.length).length} línea(s)
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {res && (
        <div className="space-y-3">
          {/* Veredicto */}
          <div className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-2 ${
            res.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                   : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
            {res.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
            <span>
              {res.ok
                ? `Archivo válido: ${res.movimientos} movimiento(s) y cifra de control correcta.`
                : `${errores.length} error(es) que el IMSS rechazaría. Corrígelos antes de subir.`}
            </span>
          </div>

          {/* Resumen */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-white rounded-lg shadow border p-4">
            <Cifra rotulo="Líneas" valor={res.totalLineas} />
            <Cifra rotulo="Altas" valor={res.altas} />
            <Cifra rotulo="Bajas" valor={res.bajas} />
            <Cifra rotulo="Modif." valor={res.modificaciones} />
            <Cifra rotulo="Cifra control" valor={res.conCifraControl ? '✓' : '✗'}
              color={res.conCifraControl ? 'text-emerald-700' : 'text-rose-700'} />
          </div>

          {/* Problemas */}
          {res.problemas.length > 0 && (
            <div className="bg-white rounded-lg shadow border divide-y">
              {errores.map((p: any, i: number) => (
                <div key={`e${i}`} className="px-4 py-2 text-sm flex items-start gap-2">
                  <span className="text-[11px] font-mono bg-rose-100 text-rose-700 rounded px-1.5 py-0.5 shrink-0">L{p.linea}</span>
                  <span className="text-rose-800">{p.texto}</span>
                </div>
              ))}
              {avisos.map((p: any, i: number) => (
                <div key={`a${i}`} className="px-4 py-2 text-sm flex items-start gap-2">
                  <span className="text-[11px] font-mono bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 shrink-0">L{p.linea}</span>
                  <span className="text-amber-800">{p.texto}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Cifra({ rotulo, valor, color = 'text-gray-900' }: { rotulo: string; valor: any; color?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{rotulo}</p>
      <p className={`text-xl font-bold tabular-nums ${color}`}>{valor}</p>
    </div>
  );
}
