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
  HeartPulse, Search, X, Download,
  AlertTriangle, CheckCircle2, SlidersHorizontal, Upload, Pencil,
} from 'lucide-react';
import api from '@/services/api';
import { CampoFecha, aTextoMx } from '@/components/CampoFecha';
import { useCapacidades, CAP } from '@/utils/capacidades';

type Tipo = 'ALTA' | 'BAJA' | 'MODIFICACION';

/** Causas de baja del IMSS (posición 149 del registro). */
const CAUSAS_BAJA: Record<string, string> = {
  '1': 'Término de contrato', '2': 'Separación voluntaria', '3': 'Abandono de empleo',
  '4': 'Defunción', '5': 'Clausura', '6': 'Otras', '7': 'Ausentismo',
  '8': 'Rescisión de contrato', '9': 'Jubilación', 'A': 'Pensión',
};

const ETIQUETA_TIPO: Record<string, string> = {
  ALTA: 'ALTA', BAJA: 'BAJA', MODIFICACION: 'MODIF.',
};
/** El código IDSE de cada movimiento: 08 alta, 07 modificación, 02 baja. */
const CODIGO_TIPO: Record<string, string> = { ALTA: '08', MODIFICACION: '07', BAJA: '02' };
/** Colores por tipo (clases estáticas: Tailwind no admite nombres dinámicos). */
const BOTON_MOV: Record<Tipo, { activo: string; base: string }> = {
  ALTA:         { activo: 'bg-emerald-600 text-white border-emerald-600', base: 'text-emerald-700 border-emerald-200 hover:bg-emerald-50' },
  MODIFICACION: { activo: 'bg-violet-600 text-white border-violet-600',   base: 'text-violet-700 border-violet-200 hover:bg-violet-50' },
  BAJA:         { activo: 'bg-rose-600 text-white border-rose-600',       base: 'text-rose-700 border-rose-200 hover:bg-rose-50' },
};
const NOMBRE_BOTON: Record<Tipo, string> = { ALTA: 'Alta', MODIFICACION: 'ModSal', BAJA: 'Baja' };

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
  sbc: string;        // salario base de cotización (INTEGRADO) — lo que va al IDSE
  diario: string;     // salario diario (referencia de la empresa)
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
  const [modal, setModal] = useState<{ id: string; nombre: string; nss: string; tipo: Tipo; emp: any } | null>(null);
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
    queryKey: ['empleados-idse', buscar, incluirBajas],
    queryFn: () => api.getEmpleados({ buscar, incluirBajas }),
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
            diario: p.diario != null ? String(p.diario) : '',
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

  /* El alta/baja/modificación se captura en un modal por trabajador: se abre con
   * los datos que ya tenemos (SBC integrado, salario diario) y pide lo que falta
   * según el tipo (motivo en baja; diario e integrado en alta/modificación). */
  const abrirModal = (e: any, tipo: Tipo) => {
    setOk(''); setError('');
    setDatos((d) => ({ ...d, [e.id]: { nombre_completo: e.nombre_completo, nss: e.nss } }));
    setModal({ id: e.id, nombre: e.nombre_completo, nss: e.nss, tipo, emp: e });
  };

  const guardarMov = (fila: { fecha: string; sbc: string; diario: string; umf: string; causaBaja: string }) => {
    if (!modal) return;
    const e = modal.emp || porId.get(modal.id) || datos[modal.id] || {};
    setSel((prev) => ({
      ...prev,
      [modal.id]: {
        tipo: modal.tipo, fecha: fila.fecha || hoyIso(),
        sbc: fila.sbc, diario: fila.diario, umf: fila.umf,
        clave: e.num_empleado || '', curp: e.curp || '',
        causaBaja: fila.causaBaja, incluir: true,
        pendienteId: prev[modal.id]?.pendienteId,
      },
    }));
    setModal(null);
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
            <p className="text-[11px] text-gray-500">
              Elige el movimiento con los botones <b>Alta · ModSal · Baja</b> de cada trabajador;
              se abre un recuadro con lo que falta.
            </p>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
                placeholder="Buscar por nombre, número, RFC, CURP o NSS…"
                value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={incluirBajas} onChange={(e) => setIncluirBajas(e.target.checked)} />
              Incluir a los que ya están de baja (para reingresos)
            </label>
          </div>
          <div className="max-h-[24rem] overflow-y-auto divide-y">
            {q.isLoading && <p className="p-4 text-sm text-gray-500">Cargando plantilla…</p>}
            {!q.isLoading && lista.length === 0 && (
              <p className="p-6 text-sm text-gray-500 italic text-center">Nadie coincide con esa búsqueda.</p>
            )}
            {lista.map((e) => {
              const puesto = sel[e.id];
              return (
                <div key={e.id} className="px-3 py-2 flex items-center gap-3 hover:bg-gray-50">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{e.nombre_completo}</p>
                    <p className="text-[11px] text-gray-500 font-mono">
                      #{e.num_empleado || '—'} · NSS {e.nss || <span className="text-rose-600">falta</span>}
                      {!e.activo && <span className="text-rose-600"> · baja</span>}
                    </p>
                  </div>
                  {/* Un botón por movimiento: abre el modal con lo que falta. */}
                  <div className="flex items-center gap-1 shrink-0 text-[11px]">
                    {(['ALTA', 'MODIFICACION', 'BAJA'] as Tipo[]).map((t) => {
                      const activo = puesto?.tipo === t;
                      const st = BOTON_MOV[t];
                      return (
                        <button key={t} onClick={() => abrirModal(e, t)}
                          title={`${ETIQUETA_TIPO[t]} ${CODIGO_TIPO[t]}`}
                          className={`px-2 py-1 rounded border font-semibold ${activo ? st.activo : st.base}`}>
                          {NOMBRE_BOTON[t]}
                        </button>
                      );
                    })}
                  </div>
                </div>
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
                  const faltaCausa = f.tipo === 'BAJA' && !f.causaBaja;
                  return (
                    <li key={id} className={`px-3 py-2 flex items-center gap-3 ${f.incluir ? '' : 'opacity-50'}`}>
                      <input type="checkbox" checked={f.incluir}
                        onChange={(ev) => editar(id, 'incluir', ev.target.checked)} title="Entra al archivo" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{e?.nombre_completo || 'Trabajador'}</p>
                        <p className="text-[11px] font-mono text-gray-500">
                          NSS {e?.nss || <span className="text-rose-600 font-semibold">falta</span>}
                          {faltaCausa && <span className="text-rose-600 font-semibold"> · falta causa</span>}
                        </p>
                      </div>
                      {/* Dos columnas: fecha solicitada al IDSE · código del movimiento (rojo). */}
                      <div className="text-right shrink-0 w-24">
                        <p className="text-xs font-mono text-gray-700">{aTextoMx(f.fecha) || '—'}</p>
                        <p className="text-xs font-bold text-rose-600">{CODIGO_TIPO[f.tipo]} {ETIQUETA_TIPO[f.tipo]}</p>
                      </div>
                      <button onClick={() => setModal({ id, nombre: e?.nombre_completo, nss: e?.nss, tipo: f.tipo,
                          emp: { id, nombre_completo: e?.nombre_completo, nss: e?.nss, num_empleado: f.clave, curp: f.curp, salario_diario_integrado: f.sbc, salario_diario: f.diario } })}
                        title="Editar movimiento" className="text-gray-400 hover:text-primary"><Pencil size={14} /></button>
                      <button onClick={() => yaPaso(id)} title="Ya pasó en el IDSE" className="text-emerald-600 hover:bg-emerald-50 p-1 rounded"><CheckCircle2 size={14} /></button>
                      <button onClick={() => descartar(id)} className="text-gray-400 hover:text-rose-600" title="Quitar"><X size={15} /></button>
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

      {modal && (
        <ModalMovimiento
          modal={modal}
          inicial={sel[modal.id] || {
            fecha: hoyIso(),
            sbc: String(Number(modal.emp?.salario_diario_integrado ?? 0) || ''),
            diario: String(Number(modal.emp?.salario_diario ?? 0) || ''),
            umf: '', causaBaja: '',
          }}
          onGuardar={guardarMov}
          onCerrar={() => setModal(null)}
        />
      )}
    </div>
  );
}

/* ── El modal por movimiento: pide lo que falta según el tipo ── */
function ModalMovimiento({ modal, inicial, onGuardar, onCerrar }: {
  modal: { nombre: string; nss: string; tipo: Tipo };
  inicial: { fecha: string; sbc: string; diario: string; umf: string; causaBaja: string };
  onGuardar: (f: { fecha: string; sbc: string; diario: string; umf: string; causaBaja: string }) => void;
  onCerrar: () => void;
}) {
  const [f, setF] = useState({
    fecha: inicial.fecha || '', sbc: inicial.sbc || '', diario: inicial.diario || '',
    umf: inicial.umf || '', causaBaja: inicial.causaBaja || '',
  });
  const esBaja = modal.tipo === 'BAJA';
  const esAlta = modal.tipo === 'ALTA';
  const conSalario = esAlta || modal.tipo === 'MODIFICACION';
  const st = BOTON_MOV[modal.tipo];

  const listo = !!f.fecha && (esBaja ? !!f.causaBaja : Number(f.sbc) > 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${st.activo}`}>
              {ETIQUETA_TIPO[modal.tipo]} {CODIGO_TIPO[modal.tipo]}
            </span>
            <p className="font-semibold text-gray-900 truncate mt-1">{modal.nombre}</p>
            <p className="text-[11px] font-mono text-gray-500">NSS {modal.nss || '— falta —'}</p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-xs text-gray-600">
              {esBaja ? 'Fecha de baja' : modal.tipo === 'MODIFICACION' ? 'Fecha del cambio' : 'Fecha de alta'}
            </span>
            <CampoFecha value={f.fecha} onChange={(iso) => setF({ ...f, fecha: iso })} className="input w-full" />
          </label>

          {conSalario && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-gray-600">Salario diario</span>
                <input type="number" step="0.01" min="0" value={f.diario}
                  onChange={(e) => setF({ ...f, diario: e.target.value })} className="input w-full" />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">SBC (integrado) *</span>
                <input type="number" step="0.01" min="0" value={f.sbc}
                  onChange={(e) => setF({ ...f, sbc: e.target.value })} className="input w-full" />
              </label>
            </div>
          )}

          {esAlta && (
            <label className="block">
              <span className="text-xs text-gray-600">UMF (opcional)</span>
              <input value={f.umf} maxLength={3}
                onChange={(e) => setF({ ...f, umf: e.target.value.replace(/\D/g, '') })} className="input w-full font-mono" />
            </label>
          )}

          {esBaja && (
            <label className="block">
              <span className="text-xs text-gray-600">Motivo de la baja *</span>
              <select value={f.causaBaja} onChange={(e) => setF({ ...f, causaBaja: e.target.value })} className="input w-full bg-white">
                <option value="">— elige el motivo —</option>
                {Object.entries(CAUSAS_BAJA).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onCerrar} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={() => onGuardar(f)} disabled={!listo}
            className="btn-primary text-sm disabled:opacity-50">Agregar al archivo</button>
        </div>
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
