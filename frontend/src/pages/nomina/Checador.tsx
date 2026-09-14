/**
 * Checador · Asistencia — administración (sin cámara).
 *
 *   Configuración — parámetros ABIERTOS: tolerancia, comida, horas semanales
 *                   (48→40 flexible), radio del kiosco, umbral facial.
 *   Turnos        — para horarios FIJOS (matutino/vespertino/nocturno…).
 *   Empleados     — a cada quien su tipo (FIJO/ROTATIVO/EXENTO) y turno,
 *                   su consentimiento (LFPDPPP) y el estado de enrolamiento.
 *
 * La captura facial (enrolamiento con cámara) y el kiosco van en las siguientes
 * fases; aquí se deja todo lo administrativo listo.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Users, Settings, Plus, Trash2, ShieldCheck, Camera, Save } from 'lucide-react';
import api from '@/services/api';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

type Tab = 'config' | 'turnos' | 'empleados';

export function ChecadorPage() {
  const [tab, setTab] = useState<Tab>('config');
  const T: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'config', label: 'Configuración', icon: Settings },
    { id: 'turnos', label: 'Turnos', icon: Clock },
    { id: 'empleados', label: 'Empleados', icon: Users },
  ];
  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Checador · Asistencia</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Control de asistencia biométrico. Aquí defines los parámetros, los turnos y a quién se le
          registra. La asistencia alimenta la prenómina.
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {T.map((t) => {
          const Ico = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              <Ico size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'config' && <TabConfig />}
      {tab === 'turnos' && <TabTurnos />}
      {tab === 'empleados' && <TabEmpleados />}
    </div>
  );
}

/* ── Configuración ── */
function TabConfig() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['checador-config'], queryFn: () => api.getCheckadorConfig() });
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (q.data?.data) setF({ ...q.data.data }); }, [q.data]);

  const guardar = useMutation({
    mutationFn: () => api.setCheckadorConfig(f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['checador-config'] }); },
  });

  if (!f) return <p className="text-sm text-gray-500">Cargando…</p>;
  const num = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value === '' ? null : Number(e.target.value) });

  return (
    <div className="bg-white rounded-lg shadow border p-5 space-y-4 max-w-xl">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />
        Checador activo para esta empresa
      </label>

      <div className="grid grid-cols-2 gap-4">
        <Campo label="Tolerancia de retardo (min)" hint="Solo horarios fijos. Vacío = sin gracia.">
          <input type="number" min={0} className="input" value={f.tolerancia_retardo_min ?? ''} onChange={num('tolerancia_retardo_min')} />
        </Campo>
        <Campo label="Horas semanales (ley)" hint="48 en 2026; baja a 40 escalonado desde 2027.">
          <input type="number" step="0.5" className="input" value={f.horas_semanales ?? ''} onChange={num('horas_semanales')} />
        </Campo>
        <Campo label="Radio del kiosco (m)" hint="Solo aplica al kiosco fijo, no a la app de campo.">
          <input type="number" min={0} className="input" value={f.radio_kiosco_m ?? ''} onChange={num('radio_kiosco_m')} />
        </Campo>
        <Campo label="Umbral facial (distancia)" hint="Menor = más estricto. Típico 0.6.">
          <input type="number" step="0.05" className="input" value={f.umbral_distancia ?? ''} onChange={num('umbral_distancia')} />
        </Campo>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!f.registra_comida} onChange={(e) => setF({ ...f, registra_comida: e.target.checked })} />
        Registrar entrada/salida de comida
      </label>

      <button onClick={() => guardar.mutate()} disabled={guardar.isPending}
        className="btn-primary inline-flex items-center gap-2">
        <Save size={16} /> {guardar.isPending ? 'Guardando…' : 'Guardar configuración'}
      </button>
      {guardar.isSuccess && <span className="text-emerald-600 text-sm ml-3">Guardado ✓</span>}
    </div>
  );
}

/* ── Turnos ── */
function TabTurnos() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['checador-turnos'], queryFn: () => api.getCheckadorTurnos() });
  const turnos: any[] = q.data?.data || [];
  const vacio = { nombre: '', hora_entrada: '', comida_inicio: '', comida_fin: '', hora_salida: '', dias: [1, 2, 3, 4, 5] };
  const [nuevo, setNuevo] = useState<any>(vacio);

  const crear = useMutation({
    mutationFn: () => api.crearCheckadorTurno(nuevo),
    onSuccess: () => { setNuevo(vacio); qc.invalidateQueries({ queryKey: ['checador-turnos'] }); },
  });
  const borrar = useMutation({
    mutationFn: (id: string) => api.borrarCheckadorTurno(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checador-turnos'] }),
  });

  const toggleDia = (d: number) =>
    setNuevo((n: any) => ({ ...n, dias: n.dias.includes(d) ? n.dias.filter((x: number) => x !== d) : [...n.dias, d].sort() }));

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left">Turno</th><th className="px-4 py-2">Entrada</th>
              <th className="px-4 py-2">Comida</th><th className="px-4 py-2">Salida</th>
              <th className="px-4 py-2">Días</th><th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {turnos.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Sin turnos. Crea el primero abajo.</td></tr>
            ) : turnos.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-2 font-medium">{t.nombre}</td>
                <td className="px-4 py-2 text-center font-mono">{String(t.hora_entrada).slice(0, 5)}</td>
                <td className="px-4 py-2 text-center font-mono text-gray-500">
                  {t.comida_inicio ? `${String(t.comida_inicio).slice(0, 5)}–${String(t.comida_fin).slice(0, 5)}` : '—'}
                </td>
                <td className="px-4 py-2 text-center font-mono">{String(t.hora_salida).slice(0, 5)}</td>
                <td className="px-4 py-2 text-center text-xs">{(t.dias || []).map((d: number) => DIAS[d]).join(' ')}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => borrar.mutate(t.id)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded" title="Eliminar">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-lg shadow border p-4">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><Plus size={15} /> Nuevo turno</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Campo label="Nombre"><input className="input" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Matutino" /></Campo>
          <Campo label="Entrada"><input type="time" className="input" value={nuevo.hora_entrada} onChange={(e) => setNuevo({ ...nuevo, hora_entrada: e.target.value })} /></Campo>
          <Campo label="Salida"><input type="time" className="input" value={nuevo.hora_salida} onChange={(e) => setNuevo({ ...nuevo, hora_salida: e.target.value })} /></Campo>
          <Campo label="Comida inicio"><input type="time" className="input" value={nuevo.comida_inicio} onChange={(e) => setNuevo({ ...nuevo, comida_inicio: e.target.value })} /></Campo>
          <Campo label="Comida fin"><input type="time" className="input" value={nuevo.comida_fin} onChange={(e) => setNuevo({ ...nuevo, comida_fin: e.target.value })} /></Campo>
        </div>
        <div className="mt-3">
          <span className="text-xs text-gray-500">Días laborales:</span>
          <div className="flex gap-1 mt-1">
            {DIAS.map((d, i) => (
              <button key={i} onClick={() => toggleDia(i)} type="button"
                className={`px-2.5 py-1 rounded text-xs border ${nuevo.dias.includes(i) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => crear.mutate()} disabled={crear.isPending || !nuevo.nombre || !nuevo.hora_entrada || !nuevo.hora_salida}
          className="btn-primary mt-4 inline-flex items-center gap-2">
          <Plus size={16} /> Agregar turno
        </button>
      </div>
    </div>
  );
}

/* ── Empleados: horario + consentimiento + enrolamiento ── */
function TabEmpleados() {
  const empQ = useQuery({ queryKey: ['checador-empleados'], queryFn: () => api.getEmpleados({}) });
  const empleados: any[] = empQ.data?.data?.empleados || empQ.data?.data || [];
  const turnosQ = useQuery({ queryKey: ['checador-turnos'], queryFn: () => api.getCheckadorTurnos() });
  const turnos: any[] = turnosQ.data?.data || [];
  const [sel, setSel] = useState<any>(null);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-white rounded-lg shadow border overflow-hidden md:col-span-1 max-h-[70vh] overflow-y-auto">
        {empleados.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">Sin empleados. Dalos de alta en Empleados.</p>
        ) : empleados.map((e) => (
          <button key={e.id} onClick={() => setSel(e)}
            className={`w-full text-left px-4 py-2.5 border-b text-sm hover:bg-gray-50 ${sel?.id === e.id ? 'bg-blue-50' : ''}`}>
            <div className="font-medium text-gray-800">{e.nombre} {e.apellido_pat} {e.apellido_mat}</div>
            <div className="text-xs text-gray-500 font-mono">#{e.num_empleado}</div>
          </button>
        ))}
      </div>

      <div className="md:col-span-2">
        {sel ? <EditorEmpleado empleado={sel} turnos={turnos} /> : (
          <div className="bg-white rounded-lg shadow border p-8 text-center text-gray-500 text-sm">
            Elige un empleado de la lista para asignar su horario y registrar su consentimiento.
          </div>
        )}
      </div>
    </div>
  );
}

function EditorEmpleado({ empleado, turnos }: { empleado: any; turnos: any[] }) {
  const qc = useQueryClient();
  const id = empleado.id;
  const horarioQ = useQuery({ queryKey: ['checador-horario', id], queryFn: () => api.getCheckadorHorario(id) });
  const consQ = useQuery({ queryKey: ['checador-cons', id], queryFn: () => api.getCheckadorConsentimiento(id) });
  const enrQ = useQuery({ queryKey: ['checador-enr', id], queryFn: () => api.getCheckadorEnrolamiento(id) });

  const h = horarioQ.data?.data;
  const [tipo, setTipo] = useState('FIJO');
  const [turnoId, setTurnoId] = useState<string>('');
  useEffect(() => {
    setTipo(h?.tipo || 'FIJO');
    setTurnoId(h?.turno_id || '');
  }, [h]);

  const guardarHorario = useMutation({
    mutationFn: () => api.setCheckadorHorario(id, { tipo, turno_id: tipo === 'FIJO' ? (turnoId || null) : null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checador-horario', id] }),
  });
  const cons = consQ.data?.data;
  const toggleCons = useMutation({
    mutationFn: (aceptado: boolean) => api.setCheckadorConsentimiento(id, { aceptado }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checador-cons', id] }),
  });

  return (
    <div className="bg-white rounded-lg shadow border p-5 space-y-5">
      <h3 className="font-semibold text-gray-900">{empleado.nombre} {empleado.apellido_pat} {empleado.apellido_mat}</h3>

      {/* Horario */}
      <div className="space-y-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Horario</span>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="FIJO">Fijo (turno estable)</option>
            <option value="ROTATIVO">Rotativo (rola turnos)</option>
            <option value="EXENTO">Exento (no registra)</option>
          </select>
          {tipo === 'FIJO' && (
            <select className="input" value={turnoId} onChange={(e) => setTurnoId(e.target.value)}>
              <option value="">— Turno —</option>
              {turnos.map((t) => <option key={t.id} value={t.id}>{t.nombre} ({String(t.hora_entrada).slice(0, 5)}–{String(t.hora_salida).slice(0, 5)})</option>)}
            </select>
          )}
          <button onClick={() => guardarHorario.mutate()} disabled={guardarHorario.isPending} className="btn-primary inline-flex items-center gap-1.5">
            <Save size={15} /> Guardar
          </button>
        </div>
        {tipo === 'ROTATIVO' && <p className="text-xs text-gray-500">El turno de cada día se asigna en el rol (siguiente fase).</p>}
        {tipo === 'EXENTO' && <p className="text-xs text-gray-500">Personal de confianza: no se le registra ni genera retardo/falta.</p>}
      </div>

      {/* Consentimiento */}
      <div className="space-y-2 border-t pt-4">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5"><ShieldCheck size={14} /> Consentimiento biométrico (LFPDPPP)</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!cons?.aceptado} onChange={(e) => toggleCons.mutate(e.target.checked)} />
          El trabajador firmó el consentimiento para el uso de datos biométricos.
        </label>
        {!cons?.aceptado && <p className="text-xs text-amber-600">Sin consentimiento no se puede enrolar su rostro.</p>}
      </div>

      {/* Enrolamiento (estado; la captura con cámara va en la siguiente fase) */}
      <div className="space-y-1 border-t pt-4">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5"><Camera size={14} /> Rostro enrolado</span>
        <p className="text-sm text-gray-700">
          {(enrQ.data?.data?.plantillas ?? 0) > 0
            ? `${enrQ.data?.data?.plantillas} plantilla(s) registradas.`
            : 'Sin rostro enrolado. La captura con cámara se habilita en la siguiente fase.'}
        </p>
      </div>
    </div>
  );
}

/* ── util ── */
function Campo({ label, hint, children }: { label: string; hint?: string; children: any }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 mt-0.5">{hint}</span>}
    </label>
  );
}

export default ChecadorPage;
