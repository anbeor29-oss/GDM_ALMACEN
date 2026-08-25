/**
 * IMSS · IDSE — movimientos afiliatorios (altas/reingresos, bajas y
 * modificaciones de salario) para subir al IDSE del IMSS.
 *
 * LO QUE ESTA PANTALLA RESUELVE
 * El IDSE pide un archivo de texto de posición fija que a mano es imposible de
 * teclear sin equivocarse. Aquí se elige el tipo de movimiento y los trabajadores,
 * se completan los pocos datos que el sistema no puede saber (fecha del acto, la
 * clínica en un alta, la causa en una baja) y el servidor arma el TXT con el NSS,
 * el nombre, el CURP y el salario base que YA viven en el expediente.
 *
 * NO GENERA A MEDIAS
 * Si a alguien le falta el NSS, o a una baja le falta la causa, el archivo no se
 * produce y la pantalla lista a todos los que hay que corregir. El IMSS rechaza
 * el lote completo por un renglón malo; más vale enterarse aquí.
 */
import { useMemo, useState } from 'react';
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
  { clave: 'ALTA',         label: 'Alta / Reingreso',   icono: UserPlus,   ayuda: 'Inscribe o reinscribe al trabajador. Movimiento 08.' },
  { clave: 'BAJA',         label: 'Baja',               icono: UserMinus,  ayuda: 'Da de baja al trabajador con su causa. Movimiento 02.' },
  { clave: 'MODIFICACION', label: 'Modif. de salario',  icono: TrendingUp, ayuda: 'Cambia el salario base de cotización. Movimiento 07.' },
];

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/** Hoy en AAAA-MM-DD según el reloj local (sin corrimiento por UTC). */
function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Lo editable por trabajador seleccionado. */
interface Fila {
  fecha: string;
  sbc: string;
  umf: string;
  clave: string;
  curp: string;
  causaBaja: string;
}

export function MotorImssIdsePage() {
  const { puede } = useCapacidades();
  const esAdmin = puede(CAP.nomina);

  const [modo, setModo] = useState<'generar' | 'movimientos' | 'validar'>('generar');
  const [tipo, setTipo] = useState<Tipo>('ALTA');
  const [buscar, setBuscar] = useState('');
  const [incluirBajas, setIncluirBajas] = useState(false);
  const [sel, setSel] = useState<Record<string, Fila>>({});
  const [verParametros, setVerParametros] = useState(false);
  const [cfg, setCfg] = useState({ guia: '01400', tipoTrabajador: '1', tipoSalario: '2', jornada: '0' });

  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [generando, setGenerando] = useState(false);

  /* En un reingreso hay que poder tomar a alguien que está de baja. */
  const q = useQuery({
    queryKey: ['empleados-idse', buscar, incluirBajas],
    queryFn: () => api.getEmpleados({ buscar, incluirBajas: incluirBajas || tipo === 'ALTA' }),
  });
  const lista: any[] = q.data?.data?.empleados || [];
  const porId = useMemo(() => new Map(lista.map((e) => [e.id, e])), [lista]);

  /* Movimientos que la baja/reingreso mandaron a este menú. Se traen aquí para
   * cargarlos en la selección sin volver a buscar a la persona. */
  const pendQ = useQuery({ queryKey: ['idse-pendientes'], queryFn: () => api.getIdsePendientes() });
  const pendientes: any[] = pendQ.data?.data?.pendientes || [];
  const pendDelTipo = pendientes.filter((p) => p.tipo === tipo);
  /* Datos de los pendientes cargados, para pintarlos aunque sean bajas que ya no
   * están en el padrón activo. */
  const [pendMap, setPendMap] = useState<Record<string, any>>({});

  const seleccionados = Object.keys(sel);

  const cargarPendientes = () => {
    setOk(''); setError('');
    setPendMap((m) => {
      const nuevo = { ...m };
      for (const p of pendDelTipo) nuevo[p.empleado_id] = { nombre_completo: p.nombre_completo, nss: p.nss };
      return nuevo;
    });
    setSel((prev) => {
      const copia = { ...prev };
      for (const p of pendDelTipo) {
        copia[p.empleado_id] = {
          fecha: p.fecha || hoyIso(),
          sbc: p.sbc != null ? String(p.sbc) : '',
          umf: '',
          clave: p.num_empleado || '',
          curp: '',
          causaBaja: p.causa_baja || '',
        };
      }
      return copia;
    });
  };

  const descartarPendiente = async (id: string) => {
    try { await api.descartarIdsePendiente(id); pendQ.refetch(); } catch { /* no pasa nada */ }
  };

  const alternar = (e: any) => {
    setOk(''); setError('');
    setSel((prev) => {
      const copia = { ...prev };
      if (copia[e.id]) { delete copia[e.id]; return copia; }
      copia[e.id] = {
        fecha: hoyIso(),
        sbc: String(Number(e.sbc ?? e.salario_diario_integrado ?? 0) || ''),
        umf: '',
        clave: e.num_empleado || '',
        curp: e.curp || '',
        causaBaja: '',
      };
      return copia;
    });
  };

  const editar = (id: string, campo: keyof Fila, valor: string) =>
    setSel((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }));

  const limpiar = () => { setSel({}); setOk(''); setError(''); };

  const generar = async () => {
    setError(''); setOk(''); setGenerando(true);
    try {
      const movimientos = seleccionados.map((id) => {
        const f = sel[id];
        return {
          empleadoId: id,
          fecha: f.fecha,
          sbc: f.sbc === '' ? undefined : Number(f.sbc),
          umf: f.umf || undefined,
          claveTrabajador: f.clave || undefined,
          curp: f.curp || undefined,
          causaBaja: f.causaBaja || undefined,
        };
      });
      await api.generarIdse({ tipo, movimientos, ...cfg });
      setOk(`Archivo IDSE de ${movimientos.length} movimiento(s) descargado. Súbelo en el portal del IDSE.`);
    } catch (e: any) {
      setError(e?.message || 'No se pudo generar el archivo.');
    } finally {
      setGenerando(false);
    }
  };

  const faltaNss = (e: any) => !e?.nss;

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
            Genera el archivo de movimientos afiliatorios (altas, bajas y modificaciones de salario).
          </p>
        </div>
      </div>

      {/* Pestañas: generar vs. validar un archivo ya hecho */}
      <div className="flex gap-1 border-b">
        {([['generar', 'Generar movimientos'], ['movimientos', 'Movimientos del IDSE'], ['validar', 'Validar archivo']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setModo(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              modo === k ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {modo === 'validar' ? <ValidadorIdse /> : modo === 'movimientos' ? <MovimientosIdse /> : <>

      {/* Selector de tipo */}
      <div className="grid sm:grid-cols-3 gap-3">
        {TIPOS.map((t) => {
          const activo = tipo === t.clave;
          const Icono = t.icono;
          return (
            <button
              key={t.clave}
              onClick={() => { setTipo(t.clave); setOk(''); setError(''); }}
              className={`text-left rounded-lg border p-3 transition ${
                activo ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className={`flex items-center gap-2 font-semibold ${activo ? 'text-violet-800' : 'text-gray-800'}`}>
                <Icono size={18} /> {t.label}
              </div>
              <p className="text-xs text-gray-500 mt-1">{t.ayuda}</p>
            </button>
          );
        })}
      </div>

      {/* ── Pendientes que mandó la baja / el reingreso ── */}
      {pendDelTipo.length > 0 && (
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-violet-900">
              <b>{pendDelTipo.length}</b> movimiento(s) de {TIPOS.find((t) => t.clave === tipo)!.label.toLowerCase()}{' '}
              llegaron desde una baja o reingreso, listos para enviar al IDSE.
            </p>
            <button
              onClick={cargarPendientes}
              className="text-xs bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700"
            >
              Cargar en la selección
            </button>
          </div>
          <ul className="mt-2 divide-y divide-violet-100">
            {pendDelTipo.map((p) => (
              <li key={p.id} className="py-1 flex items-center gap-2 text-xs text-violet-900">
                <span className="flex-1 truncate">
                  {p.nombre_completo} · NSS {p.nss || <span className="text-rose-600">falta</span>} · {p.fecha}
                </span>
                <button onClick={() => descartarPendiente(p.id)} className="text-violet-400 hover:text-rose-600" title="Descartar">
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Padrón ── */}
        <div className="bg-white rounded-lg shadow border overflow-hidden">
          <div className="p-3 border-b space-y-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
                placeholder="Buscar por nombre, número, RFC, CURP o NSS…"
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
              />
            </div>
            {tipo !== 'ALTA' && (
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={incluirBajas} onChange={(e) => setIncluirBajas(e.target.checked)} />
                Incluir a los que ya están de baja
              </label>
            )}
          </div>
          <div className="max-h-[26rem] overflow-y-auto divide-y">
            {q.isLoading && <p className="p-4 text-sm text-gray-500">Cargando plantilla…</p>}
            {!q.isLoading && lista.length === 0 && (
              <p className="p-6 text-sm text-gray-500 italic text-center">Nadie coincide con esa búsqueda.</p>
            )}
            {lista.map((e) => {
              const marcado = !!sel[e.id];
              return (
                <button
                  key={e.id}
                  onClick={() => alternar(e)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-50 ${marcado ? 'bg-violet-50/60' : ''}`}
                >
                  <input type="checkbox" readOnly checked={marcado} className="pointer-events-none" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{e.nombre_completo}</p>
                    <p className="text-[11px] text-gray-500 font-mono">
                      #{e.num_empleado || '—'} · NSS {e.nss || <span className="text-rose-600">falta</span>}
                      {!e.activo && <span className="text-rose-600"> · baja</span>}
                    </p>
                  </div>
                  <span className="text-xs text-gray-500 shrink-0">{money(e.sbc || e.salario_diario_integrado)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Movimientos a generar ── */}
        <div className="bg-white rounded-lg shadow border overflow-hidden flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-800">
              {seleccionados.length} movimiento(s) de {TIPOS.find((t) => t.clave === tipo)!.label.toLowerCase()}
            </p>
            {seleccionados.length > 0 && (
              <button onClick={limpiar} className="text-xs text-gray-500 hover:text-rose-600">Quitar todos</button>
            )}
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {seleccionados.length === 0 ? (
              <p className="p-6 text-sm text-gray-500 italic text-center">
                Elige trabajadores de la lista de la izquierda para armar el archivo.
              </p>
            ) : (
              <ul className="divide-y">
                {seleccionados.map((id) => {
                  const e = porId.get(id) || pendMap[id];
                  const f = sel[id];
                  return (
                    <li key={id} className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{e?.nombre_completo || 'Trabajador'}</p>
                          <p className="text-[11px] font-mono text-gray-500">
                            NSS {e?.nss || <span className="text-rose-600 font-semibold">falta — captúralo en el expediente</span>}
                          </p>
                        </div>
                        <button onClick={() => alternar(e)} className="text-gray-400 hover:text-rose-600 shrink-0">
                          <X size={16} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[11px] text-gray-500">
                          {tipo === 'BAJA' ? 'Fecha de baja' : tipo === 'MODIFICACION' ? 'Fecha del cambio' : 'Fecha de alta'}
                          <CampoFecha value={f.fecha} onChange={(iso) => editar(id, 'fecha', iso)} className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" />
                        </label>

                        {(tipo === 'ALTA' || tipo === 'MODIFICACION') && (
                          <label className="text-[11px] text-gray-500">
                            Salario base (SBC)
                            <input
                              type="number" step="0.01" min="0" value={f.sbc}
                              onChange={(ev) => editar(id, 'sbc', ev.target.value)}
                              className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5"
                            />
                          </label>
                        )}

                        {tipo === 'ALTA' && (
                          <label className="text-[11px] text-gray-500">
                            UMF (clínica)
                            <input
                              value={f.umf} maxLength={3} placeholder="p. ej. 12"
                              onChange={(ev) => editar(id, 'umf', ev.target.value.replace(/\D/g, ''))}
                              className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5"
                            />
                          </label>
                        )}

                        {tipo === 'BAJA' && (
                          <label className="text-[11px] text-gray-500">
                            Causa de baja
                            <select
                              value={f.causaBaja}
                              onChange={(ev) => editar(id, 'causaBaja', ev.target.value)}
                              className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5 bg-white"
                            >
                              <option value="">— elige —</option>
                              {Object.entries(CAUSAS_BAJA).map(([k, v]) => (
                                <option key={k} value={k}>{k} · {v}</option>
                              ))}
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

          {/* Parámetros del archivo (rara vez cambian) */}
          <div className="border-t">
            <button
              onClick={() => setVerParametros((v) => !v)}
              className="w-full px-3 py-2 flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700"
            >
              <SlidersHorizontal size={14} />
              Parámetros del archivo (guía, tipo de trabajador, salario, jornada)
            </button>
            {verParametros && (
              <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <label className="text-[11px] text-gray-500">
                  Guía
                  <input value={cfg.guia} onChange={(e) => setCfg({ ...cfg, guia: e.target.value })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" />
                </label>
                <label className="text-[11px] text-gray-500">
                  Tipo trabajador
                  <input value={cfg.tipoTrabajador} maxLength={1} onChange={(e) => setCfg({ ...cfg, tipoTrabajador: e.target.value })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" />
                </label>
                <label className="text-[11px] text-gray-500">
                  Tipo salario
                  <select value={cfg.tipoSalario} onChange={(e) => setCfg({ ...cfg, tipoSalario: e.target.value })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5 bg-white">
                    <option value="1">1 · Fijo</option>
                    <option value="2">2 · Variable</option>
                    <option value="3">3 · Mixto</option>
                  </select>
                </label>
                <label className="text-[11px] text-gray-500">
                  Jornada
                  <input value={cfg.jornada} maxLength={1} onChange={(e) => setCfg({ ...cfg, jornada: e.target.value })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" />
                </label>
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

      {/* Acción */}
      <div className="flex items-center justify-end gap-3">
        {seleccionados.some((id) => faltaNss(porId.get(id) || pendMap[id])) && (
          <p className="text-xs text-amber-700 flex items-center gap-1 mr-auto">
            <AlertTriangle size={13} /> Hay seleccionados sin NSS: el IMSS lo exige y el archivo no se generará hasta capturarlo.
          </p>
        )}
        <button
          onClick={generar}
          disabled={!esAdmin || generando || seleccionados.length === 0}
          className="bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 flex items-center gap-2 disabled:opacity-50"
          title={!esAdmin ? 'Necesitas la capacidad de nómina para generar movimientos' : undefined}
        >
          <Download size={16} />
          {generando ? 'Generando…' : 'Generar archivo IDSE'}
        </button>
      </div>
      </>}
    </div>
  );
}

/* ═══════════════════════════ MOVIMIENTOS DEL IDSE (cola mixta) ═══════════════════════════ */

const ETIQUETA_TIPO: Record<string, string> = {
  ALTA: 'ALTA / REINGRESO', BAJA: 'BAJA', MODIFICACION: 'MODIF. DE SALARIO',
};

/**
 * La cola de movimientos afiliatorios. Aquí caen las altas, bajas y modificaciones
 * —de la baja del trabajador, del reingreso o de un cambio de salario— y se manda
 * un SOLO archivo con los que se elijan, aunque sean de tipos distintos. Al
 * confirmar que ya pasaron en el IDSE, se mueven a la lista de enviados; de ahí se
 * pueden regresar si se subieron por error.
 */
function MovimientosIdse() {
  const pendQ = useQuery({ queryKey: ['idse-pendientes'], queryFn: () => api.getIdsePendientes() });
  const enviQ = useQuery({ queryKey: ['idse-enviados'], queryFn: () => api.getIdseEnviados() });
  const pendientes: any[] = pendQ.data?.data?.pendientes || [];
  const enviados: any[] = enviQ.data?.data?.enviados || [];

  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const idsSel = pendientes.filter((p) => sel[p.id]).map((p) => p.id);
  const refetch = () => { pendQ.refetch(); enviQ.refetch(); };

  const generar = async () => {
    if (!idsSel.length) return;
    setBusy(true); setMsg(''); setError('');
    try {
      await api.generarIdseDesdePendientes(idsSel);
      setMsg(`Archivo con ${idsSel.length} movimiento(s) descargado. Cuando pase en el IDSE, márcalo con "ya pasó".`);
    } catch (e: any) {
      setError(e?.message || 'No se pudo generar el archivo.');
    } finally { setBusy(false); }
  };

  const accion = async (fn: () => Promise<any>) => {
    setMsg(''); setError('');
    try { await fn(); refetch(); } catch (e: any) { setError(e?.response?.data?.message || e?.message || 'No se pudo.'); }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2 whitespace-pre-line">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}
      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> <span>{msg}</span>
        </div>
      )}

      {/* ── Pendientes (mixtos, en un solo archivo) ── */}
      <div className="bg-white rounded-lg shadow border">
        <div className="p-3 border-b flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-gray-800">Movimientos pendientes</p>
            <p className="text-[11px] text-gray-500">
              Marca los que van en el archivo —pueden ser de tipos distintos— y genera uno solo.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {pendientes.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={pendientes.every((p) => sel[p.id])}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setSel(Object.fromEntries(pendientes.map((p) => [p.id, v])));
                  }}
                />
                Seleccionar todos
              </label>
            )}
            <button
              onClick={generar}
              disabled={busy || idsSel.length === 0}
              className="bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 flex items-center gap-2 disabled:opacity-50 text-sm"
            >
              <Download size={16} />
              {busy ? 'Generando…' : `Generar archivo IDSE (${idsSel.length})`}
            </button>
          </div>
        </div>

        {pendientes.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 italic text-center">
            No hay movimientos pendientes. Al dar de baja, reingresar o cambiar un salario, aparecen aquí.
          </p>
        ) : (
          <ul className="divide-y">
            {pendientes.map((p) => (
              <li key={p.id} className="px-3 py-2 flex items-center gap-3 text-sm hover:bg-gray-50">
                {/* Casilla: entra al archivo */}
                <input
                  type="checkbox" checked={!!sel[p.id]}
                  onChange={(e) => setSel((s) => ({ ...s, [p.id]: e.target.checked }))}
                />
                <span className="text-[10px] font-bold text-rose-600 w-28 shrink-0">{ETIQUETA_TIPO[p.tipo] || p.tipo}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 truncate">{p.nombre_completo}</p>
                  <p className="text-[11px] text-gray-500 font-mono">
                    #{p.num_empleado || '—'} · NSS {p.nss || <span className="text-rose-600">falta</span>} · {p.fecha}
                  </p>
                </div>
                {/* Check "ya pasó en el IDSE" → a la lista de enviados */}
                <button
                  onClick={() => accion(() => api.marcarIdseEnviados([p.id]))}
                  className="text-xs text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded flex items-center gap-1"
                  title="Confirmar que ya pasó en el IDSE"
                >
                  <CheckCircle2 size={14} /> ya pasó
                </button>
                <button onClick={() => accion(() => api.descartarIdsePendiente(p.id))}
                  className="text-gray-400 hover:text-rose-600" title="Descartar">
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Enviados (ya pasaron en el IDSE) ── */}
      <div className="bg-white rounded-lg shadow border">
        <div className="p-3 border-b">
          <p className="text-sm font-semibold text-gray-800">Ya pasaron en el IDSE</p>
          <p className="text-[11px] text-gray-500">Si alguno se subió por error, se regresa a pendientes.</p>
        </div>
        {enviados.length === 0 ? (
          <p className="p-4 text-sm text-gray-500 italic text-center">Todavía no hay movimientos confirmados.</p>
        ) : (
          <ul className="divide-y">
            {enviados.map((p) => (
              <li key={p.id} className="px-3 py-2 flex items-center gap-3 text-sm">
                <span className="text-[10px] font-bold text-gray-500 w-28 shrink-0">{ETIQUETA_TIPO[p.tipo] || p.tipo}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-700 truncate">{p.nombre_completo}</p>
                  <p className="text-[11px] text-gray-400 font-mono">
                    #{p.num_empleado || '—'} · {p.fecha}{p.enviado ? ` · confirmado ${p.enviado}` : ''}
                  </p>
                </div>
                <button onClick={() => accion(() => api.regresarIdsePendientes([p.id]))}
                  className="text-xs text-violet-700 hover:bg-violet-50 px-2 py-1 rounded">
                  ↩ regresar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
