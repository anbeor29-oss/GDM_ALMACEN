/**
 * ExpedienteDelTrabajador — la bitácora y lo que trae puesto.
 *
 * DOS MITADES PORQUE SON DOS COSAS
 * A la izquierda, hechos fechados que ya ocurrieron: un reconocimiento, un acta
 * administrativa, una nota reservada. A la derecha, bienes que están en poder
 * de alguien: uniformes y equipo de protección, que se entregan y se devuelven.
 * Mezclarlos dejaría la mitad de cada renglón vacía.
 *
 * LO CONFIDENCIAL LO FILTRA EL SERVIDOR
 * Esta pantalla no esconde nada: lo que no debe verse no llega. Un filtro en el
 * navegador se rodea abriendo el inspector.
 *
 * NO HAY BORRAR
 * Una nota se cancela con su motivo y se queda tachada. Un historial del que se
 * puede quitar lo incómodo no sirve el día que se necesita.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookText, Shirt, Plus, X, Lock, Award, AlertTriangle, Info, FileText, Undo2,
} from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  n === null || n === undefined ? '—'
    : Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const TIPO_NOTA: Record<string, { label: string; cls: string; icono: any }> = {
  LOGRO:      { label: 'Logro',      cls: 'bg-emerald-100 text-emerald-800', icono: Award },
  SANCION:    { label: 'Sanción',    cls: 'bg-rose-100 text-rose-800',       icono: AlertTriangle },
  INCIDENCIA: { label: 'Incidencia', cls: 'bg-amber-100 text-amber-800',     icono: Info },
  NOTA:       { label: 'Nota',       cls: 'bg-slate-100 text-slate-700',     icono: FileText },
};

const TIPO_ENTREGA: Record<string, string> = {
  UNIFORME: 'Uniforme',
  EPP: 'Equipo de protección',
  HERRAMIENTA: 'Herramienta',
  OTRO: 'Otro',
};

export function ExpedienteDelTrabajador({
  empleadoId, puedeEditar,
}: {
  empleadoId?: string;
  puedeEditar: boolean;
}) {
  if (!empleadoId) {
    return (
      <div className="border rounded-lg p-5 text-sm text-gray-600 bg-slate-50">
        <p className="font-medium text-gray-700">Bitácora y entregas</p>
        <p className="mt-1">
          Se capturan cuando el expediente ya está guardado. Da de alta al trabajador
          primero y vuelve a abrir su ficha.
        </p>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <Bitacora empleadoId={empleadoId} puedeEditar={puedeEditar} />
      <Entregas empleadoId={empleadoId} puedeEditar={puedeEditar} />
    </div>
  );
}

/* ═══════════════════ MITAD IZQUIERDA: BITÁCORA ═══════════════════ */

function Bitacora({ empleadoId, puedeEditar }: { empleadoId: string; puedeEditar: boolean }) {
  const [alta, setAlta] = useState(false);
  const [error, setError] = useState('');
  const q = useQuery({
    queryKey: ['bitacora', empleadoId],
    queryFn: () => api.getBitacora(empleadoId),
  });
  const notas: any[] = q.data?.data?.notas || [];
  const veConfidenciales = q.data?.data?.veConfidenciales;

  return (
    <div className="border rounded-lg overflow-hidden flex flex-col">
      <div className="bg-slate-50 px-4 py-2.5 border-b flex items-center justify-between">
        <p className="font-semibold text-sm text-gray-700 flex items-center gap-2">
          <BookText size={16} className="text-violet-600" /> Bitácora
        </p>
        {puedeEditar && !alta && (
          <button type="button" onClick={() => setAlta(true)}
            className="text-sm text-primary hover:underline flex items-center gap-1">
            <Plus size={14} /> Agregar
          </button>
        )}
      </div>

      <div className="p-4 space-y-3 flex-1">
        {error && <p className="text-xs text-rose-600">{error}</p>}

        {!veConfidenciales && (
          <p className="text-[11px] text-gray-500 flex items-start gap-1.5">
            <Lock size={12} className="mt-0.5 shrink-0" />
            Las notas marcadas como confidenciales no se muestran con tu rol.
          </p>
        )}

        {alta && (
          <FormaDeNota
            empleadoId={empleadoId}
            onCancelar={() => setAlta(false)}
            onGuardado={() => { setAlta(false); q.refetch(); }}
          />
        )}

        {q.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}
        {!q.isLoading && notas.length === 0 && !alta && (
          <p className="text-sm text-gray-500 italic text-center py-6">
            Sin notas en la bitácora.
          </p>
        )}

        {notas.map((n) => {
          const t = TIPO_NOTA[n.tipo] || TIPO_NOTA.NOTA;
          const Icono = t.icono;
          return (
            <div key={n.id} className={`border rounded-lg p-3 ${n.cancelada ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${t.cls}`}>
                    <Icono size={11} /> {t.label}
                  </span>
                  {n.confidencial && (
                    <span className="ml-1.5 text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-white inline-flex items-center gap-1">
                      <Lock size={10} /> confidencial
                    </span>
                  )}
                  <p className={`font-medium text-sm mt-1 ${n.cancelada ? 'line-through' : ''}`}>
                    {n.titulo}
                  </p>
                  {n.detalle && <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-line">{n.detalle}</p>}
                  {n.dias_suspension && (
                    <p className="text-xs text-rose-700 mt-0.5">
                      {n.dias_suspension} día(s) de suspensión
                    </p>
                  )}
                  {n.cancelada && (
                    <p className="text-[11px] text-gray-500 mt-1">
                      Cancelada: {n.motivo_cancelacion}
                    </p>
                  )}
                </div>
                <span className="text-xs text-gray-400 shrink-0">{n.fecha}</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                capturó {n.creada_por || n.creada_por_correo || 'alguien'}
              </p>
              {puedeEditar && !n.cancelada && (
                <button type="button"
                  onClick={async () => {
                    const m = window.prompt('¿Por qué se cancela esta nota?');
                    if (!m) return;
                    setError('');
                    try { await api.cancelarNotaBitacora(n.id, m); q.refetch(); }
                    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo cancelar'); }
                  }}
                  className="text-[11px] text-gray-500 hover:text-rose-600 hover:underline mt-1">
                  Cancelar nota
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FormaDeNota({ empleadoId, onCancelar, onGuardado }: any) {
  const [f, setF] = useState<any>({
    tipo: 'LOGRO', fecha: new Date().toISOString().slice(0, 10),
    titulo: '', detalle: '', confidencial: false, dias_suspension: '',
  });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const campo = 'w-full border rounded-lg px-3 py-1.5 text-sm';
  const set = (k: string, v: any) => setF({ ...f, [k]: v });

  return (
    <div className="border border-violet-200 bg-violet-50/40 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm">Nueva nota</p>
        <button type="button" onClick={onCancelar} className="text-gray-400 hover:text-gray-600">
          <X size={15} />
        </button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <select className={campo} value={f.tipo} onChange={(e) => set('tipo', e.target.value)}>
          <option value="LOGRO">Logro</option>
          <option value="SANCION">Sanción</option>
          <option value="INCIDENCIA">Incidencia</option>
          <option value="NOTA">Nota</option>
        </select>
        <input type="date" className={campo} value={f.fecha} onChange={(e) => set('fecha', e.target.value)} />
      </div>
      <input className={campo} placeholder="Título" value={f.titulo}
        onChange={(e) => set('titulo', e.target.value)} />
      <textarea className={campo} rows={3} placeholder="Detalle (opcional)"
        value={f.detalle} onChange={(e) => set('detalle', e.target.value)} />
      {f.tipo === 'SANCION' && (
        <input type="number" min={1} max={90} className={campo}
          placeholder="Días de suspensión (opcional)"
          value={f.dias_suspension} onChange={(e) => set('dias_suspension', e.target.value)} />
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.confidencial}
          onChange={(e) => set('confidencial', e.target.checked)} />
        Confidencial — sólo la ve el administrador
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar}
          className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
        <button type="button" disabled={guardando}
          onClick={async () => {
            setGuardando(true); setError('');
            try {
              await api.crearNotaBitacora({
                empleado_id: empleadoId, tipo: f.tipo, fecha: f.fecha,
                titulo: f.titulo, detalle: f.detalle || null,
                confidencial: f.confidencial,
                dias_suspension: f.dias_suspension ? Number(f.dias_suspension) : undefined,
              });
              onGuardado();
            } catch (e: any) {
              setError(e?.response?.data?.message || 'No se pudo guardar');
            } finally { setGuardando(false); }
          }}
          className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════ MITAD DERECHA: UNIFORMES Y EPP ═══════════════════ */

function Entregas({ empleadoId, puedeEditar }: { empleadoId: string; puedeEditar: boolean }) {
  const [alta, setAlta] = useState(false);
  const [error, setError] = useState('');
  const q = useQuery({
    queryKey: ['entregas', empleadoId],
    queryFn: () => api.getEntregas(empleadoId),
  });
  const entregas: any[] = q.data?.data?.entregas || [];
  const enPoder = entregas.filter((e) => !e.devuelto);

  return (
    <div className="border rounded-lg overflow-hidden flex flex-col">
      <div className="bg-slate-50 px-4 py-2.5 border-b flex items-center justify-between">
        <p className="font-semibold text-sm text-gray-700 flex items-center gap-2">
          <Shirt size={16} className="text-sky-600" /> Uniformes y equipo de protección
        </p>
        {puedeEditar && !alta && (
          <button type="button" onClick={() => setAlta(true)}
            className="text-sm text-primary hover:underline flex items-center gap-1">
            <Plus size={14} /> Entregar
          </button>
        )}
      </div>

      <div className="p-4 space-y-3 flex-1">
        {error && <p className="text-xs text-rose-600">{error}</p>}

        {enPoder.length > 0 && (
          <p className="text-[11px] text-gray-600">
            <b>{enPoder.length}</b> artículo(s) en su poder — es lo que hay que pedirle
            de vuelta al liquidarlo.
          </p>
        )}

        {alta && (
          <FormaDeEntrega
            empleadoId={empleadoId}
            onCancelar={() => setAlta(false)}
            onGuardado={() => { setAlta(false); q.refetch(); }}
          />
        )}

        {q.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}
        {!q.isLoading && entregas.length === 0 && !alta && (
          <p className="text-sm text-gray-500 italic text-center py-6">
            No se le ha entregado nada.
          </p>
        )}

        {entregas.map((e) => (
          <div key={e.id} className={`border rounded-lg p-3 ${e.devuelto ? 'bg-slate-50/60 opacity-70' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-800">
                  {TIPO_ENTREGA[e.tipo] || e.tipo}
                </span>
                <p className="font-medium text-sm mt-1">
                  {e.cantidad > 1 && `${e.cantidad} × `}{e.articulo}
                  {e.talla && <span className="text-gray-500 font-normal"> · talla {e.talla}</span>}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  entregado el {e.fecha_entrega}
                  {e.costo !== null && ` · ${money(e.costo)}`}
                </p>
                {e.vencido && (
                  <p className="text-xs text-amber-700 mt-0.5">
                    Tocaba reponerlo el {e.fecha_reposicion}
                  </p>
                )}
                {e.devuelto && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    devuelto el {e.fecha_devolucion}
                    {e.estado_devolucion && ` · ${e.estado_devolucion.toLowerCase()}`}
                  </p>
                )}
              </div>
              {puedeEditar && !e.devuelto && (
                <button type="button"
                  onClick={async () => {
                    const est = window.prompt(
                      '¿En qué estado volvió?\nBUENO, USADO, DANADO o EXTRAVIADO', 'USADO');
                    if (!est) return;
                    setError('');
                    try { await api.registrarDevolucion(e.id, { estado: est }); q.refetch(); }
                    catch (err: any) { setError(err?.response?.data?.message || 'No se pudo registrar'); }
                  }}
                  className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0">
                  <Undo2 size={12} /> Devolución
                </button>
              )}
            </div>
          </div>
        ))}

        <p className="text-[11px] text-gray-500">
          Es el comprobante que exige el Art. 132 Fr. XVII de la LFT, no un inventario:
          por eso lo que importa es la fecha y quién lo recibió.
        </p>
      </div>
    </div>
  );
}

function FormaDeEntrega({ empleadoId, onCancelar, onGuardado }: any) {
  const [f, setF] = useState<any>({
    tipo: 'EPP', articulo: '', talla: '', cantidad: 1,
    fecha_entrega: new Date().toISOString().slice(0, 10),
    fecha_reposicion: '', costo: '',
  });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const campo = 'w-full border rounded-lg px-3 py-1.5 text-sm';
  const set = (k: string, v: any) => setF({ ...f, [k]: v });

  return (
    <div className="border border-sky-200 bg-sky-50/40 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm">Nueva entrega</p>
        <button type="button" onClick={onCancelar} className="text-gray-400 hover:text-gray-600">
          <X size={15} />
        </button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <select className={campo} value={f.tipo} onChange={(e) => set('tipo', e.target.value)}>
          <option value="EPP">Equipo de protección</option>
          <option value="UNIFORME">Uniforme</option>
          <option value="HERRAMIENTA">Herramienta</option>
          <option value="OTRO">Otro</option>
        </select>
        <input type="date" className={campo} value={f.fecha_entrega}
          onChange={(e) => set('fecha_entrega', e.target.value)} />
      </div>
      <input className={campo} placeholder="Qué se entregó (botas, casco, camisola…)"
        value={f.articulo} onChange={(e) => set('articulo', e.target.value)} />
      <div className="grid grid-cols-3 gap-2">
        <input className={campo} placeholder="Talla" value={f.talla}
          onChange={(e) => set('talla', e.target.value)} />
        <input type="number" min={1} className={campo} placeholder="Cantidad"
          value={f.cantidad} onChange={(e) => set('cantidad', e.target.value)} />
        <input type="number" step="0.01" className={campo} placeholder="Costo"
          value={f.costo} onChange={(e) => set('costo', e.target.value)} />
      </div>
      <div>
        <label className="block text-xs text-gray-600 mb-1">Cuándo toca reponerlo (opcional)</label>
        <input type="date" className={campo} value={f.fecha_reposicion}
          onChange={(e) => set('fecha_reposicion', e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar}
          className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
        <button type="button" disabled={guardando}
          onClick={async () => {
            setGuardando(true); setError('');
            try {
              await api.registrarEntrega({
                empleado_id: empleadoId, tipo: f.tipo, articulo: f.articulo,
                talla: f.talla || null, cantidad: Number(f.cantidad) || 1,
                fecha_entrega: f.fecha_entrega,
                fecha_reposicion: f.fecha_reposicion || null,
                costo: f.costo === '' ? null : Number(f.costo),
              });
              onGuardado();
            } catch (e: any) {
              setError(e?.response?.data?.message || 'No se pudo guardar');
            } finally { setGuardando(false); }
          }}
          className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
          {guardando ? 'Guardando…' : 'Registrar entrega'}
        </button>
      </div>
    </div>
  );
}

export default ExpedienteDelTrabajador;
