/**
 * Checador · Asistencia — administración (sin cámara).
 *
 *   Configuración — parámetros ABIERTOS: tolerancia, comida, horas semanales
 *                   (48→40 flexible), radio del kiosco, umbral facial.
 *   Turnos        — para horarios FIJOS (matutino/vespertino/nocturno…).
 *   Empleados     — a cada quien su tipo (FIJO/ROTATIVO/EXENTO) y turno,
 *                   su consentimiento (LFPDPPP) y el estado de enrolamiento.
 *
 * La captura facial con cámara (enrolamiento) y el kiosco viven en pantallas
 * aparte —instalables como PWA en tabletas/celulares— y se abren desde aquí.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Users, Settings, Plus, Trash2, ShieldCheck, Camera, Save, UserPlus, ClipboardList, MapPin } from 'lucide-react';
import { claseOpcion } from '@/utils/coloresOpciones';
import { parseCoordenadas } from '@/utils/coords';
import { RegistroAsistencia } from '@/pages/nomina/RegistroAsistencia';
import api from '@/services/api';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

type Tab = 'config' | 'kioscos' | 'turnos' | 'empleados' | 'registro';

export function ChecadorPage() {
  const [tab, setTab] = useState<Tab>('config');
  const T: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'config', label: 'Configuración', icon: Settings },
    { id: 'kioscos', label: 'Kioscos', icon: MapPin },
    { id: 'turnos', label: 'Turnos', icon: Clock },
    { id: 'empleados', label: 'Empleados', icon: Users },
    { id: 'registro', label: 'Registro', icon: ClipboardList },
  ];
  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Checador · Asistencia</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Control de asistencia biométrico. Aquí defines los parámetros, los turnos y a quién se le
            registra. La asistencia alimenta la prenómina.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link to="/checador/registro"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <ClipboardList size={16} /> Registro
          </Link>
          <Link to="/checador/enrolar"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <UserPlus size={16} /> Enrolar rostro
          </Link>
          <Link to="/checador/campo"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <MapPin size={16} /> Campo
          </Link>
          <Link to="/checador/kiosco"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Camera size={16} /> Abrir kiosco
          </Link>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {T.map((t, i) => {
          const Ico = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 ${claseOpcion(i, tab === t.id)}`}>
              <Ico size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'config' && <TabConfig />}
      {tab === 'kioscos' && <TabKioscos />}
      {tab === 'turnos' && <TabTurnos />}
      {tab === 'empleados' && <TabEmpleados />}
      {tab === 'registro' && <RegistroAsistencia />}
    </div>
  );
}

/* ── Kioscos (ubicación fija por centro de trabajo) ── */
function TabKioscos() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['checador-kioscos'], queryFn: () => api.getCheckadorKioscos() });
  const kioscos: any[] = q.data?.data || [];

  const vacio = { id: '', nombre: '', lat: '', lng: '', radio_m: '' };
  const [f, setF] = useState<any>(vacio);
  const [msg, setMsg] = useState('');
  const [ubicando, setUbicando] = useState(false);
  const editando = !!f.id;

  const guardar = useMutation({
    mutationFn: () => {
      const body = {
        nombre: f.nombre,
        lat: f.lat === '' ? null : Number(f.lat),
        lng: f.lng === '' ? null : Number(f.lng),
        radio_m: f.radio_m === '' ? null : Number(f.radio_m),
      };
      return editando ? api.actualizarCheckadorKiosco(f.id, body) : api.crearCheckadorKiosco(body);
    },
    onSuccess: () => { setF(vacio); setMsg(''); qc.invalidateQueries({ queryKey: ['checador-kioscos'] }); },
    onError: (e: any) => setMsg(e?.response?.data?.message || 'No se pudo guardar el kiosco.'),
  });
  const borrar = useMutation({
    mutationFn: (id: string) => api.borrarCheckadorKiosco(id),
    onSuccess: () => { if (editando) setF(vacio); qc.invalidateQueries({ queryKey: ['checador-kioscos'] }); },
  });

  /* «Usar mi ubicación actual»: pensado para capturar la ubicación PARADO en el
   * centro de trabajo (abre esta pantalla en la tableta del kiosco y toca el botón). */
  const usarMiUbicacion = () => {
    if (!navigator.geolocation) { setMsg('Este equipo no permite geolocalización; captura lat/lng a mano.'); return; }
    setUbicando(true); setMsg('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setF((s: any) => ({ ...s, lat: pos.coords.latitude.toFixed(7), lng: pos.coords.longitude.toFixed(7) }));
        setUbicando(false);
      },
      (err) => { setMsg(err?.message || 'No se pudo obtener la ubicación. Da permiso o captúrala a mano.'); setUbicando(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const puedeGuardar = f.nombre.trim() && !guardar.isPending;

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* Lista */}
      <div className="bg-white rounded-lg shadow border overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-gray-50 text-sm font-semibold text-gray-700">
          Kioscos / centros de trabajo
        </div>
        {q.isLoading ? (
          <p className="p-4 text-sm text-gray-500">Cargando…</p>
        ) : kioscos.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">
            Aún no hay kioscos. Da de alta el primero (Kiosko 1, Recepción, Planta Norte…) y fíjale su ubicación.
          </p>
        ) : (
          <ul className="divide-y">
            {kioscos.map((k) => (
              <li key={k.id} className="flex items-center gap-3 px-4 py-2.5">
                <MapPin size={16} className={k.lat != null ? 'text-emerald-600' : 'text-gray-300'} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{k.nombre}</p>
                  <p className="text-[11px] text-gray-500">
                    {k.lat != null && k.lng != null
                      ? <>{Number(k.lat).toFixed(5)}, {Number(k.lng).toFixed(5)}{k.radio_m ? ` · radio ${k.radio_m} m` : ''}</>
                      : <span className="text-amber-600">sin ubicación fijada</span>}
                  </p>
                </div>
                <button onClick={() => setF({ id: k.id, nombre: k.nombre, lat: k.lat ?? '', lng: k.lng ?? '', radio_m: k.radio_m ?? '' })}
                  className="text-xs text-primary hover:underline">Editar</button>
                <button onClick={() => borrar.mutate(k.id)} className="text-gray-400 hover:text-rose-600" title="Quitar">
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Alta / edición */}
      <div className="bg-white rounded-lg shadow border p-4 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">{editando ? 'Editar kiosco' : 'Nuevo kiosco'}</h3>
        <Campo label="Nombre del kiosco" hint="Cómo se llama este equipo / centro (Kiosko 1, Recepción…).">
          <input className="input" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Kiosko 1" />
        </Campo>

        <div className="rounded-lg border border-dashed p-3 space-y-2">
          <p className="text-xs text-gray-600">
            <b>Ubicación del centro de trabajo.</b> Lo más fácil: abre esta pantalla en la tableta
            del kiosco, parado donde va a quedar, y toca «Usar mi ubicación actual».
          </p>
          <button type="button" onClick={usarMiUbicacion} disabled={ubicando}
            className="inline-flex items-center gap-1.5 text-sm border rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50">
            <MapPin size={15} /> {ubicando ? 'Obteniendo…' : 'Usar mi ubicación actual'}
          </button>
          {/* Pegar coordenadas de Google Maps: acepta GMS (21°55'19.8"N 102°17'04.1"W) o decimal. */}
          <label className="block">
            <span className="text-[11px] text-gray-600 block">…o pega de Google Maps</span>
            <input className="input font-mono text-xs"
              placeholder={`21°55'19.8"N 102°17'04.1"W   ·   o   21.922167, -102.284472`}
              onChange={(e) => {
                const c = parseCoordenadas(e.target.value);
                if (c) setF((s: any) => ({ ...s, lat: c.lat.toFixed(7), lng: c.lng.toFixed(7) }));
              }} />
            <span className="text-[10px] text-gray-400">Al reconocerlas, llena latitud y longitud abajo.</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Campo label="Latitud">
              <input className="input" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} placeholder="19.4326" />
            </Campo>
            <Campo label="Longitud">
              <input className="input" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} placeholder="-99.1332" />
            </Campo>
          </div>
          {f.lat !== '' && f.lng !== '' && (
            <a className="text-xs text-primary hover:underline" target="_blank" rel="noreferrer"
              href={`https://www.google.com/maps?q=${f.lat},${f.lng}`}>Ver en el mapa</a>
          )}
        </div>

        <Campo label="Radio permitido (m)" hint="Opcional. Vacío = usa el radio general de la Configuración.">
          <input type="number" min={0} className="input" value={f.radio_m} onChange={(e) => setF({ ...f, radio_m: e.target.value })} placeholder="100" />
        </Campo>

        {msg && <p className="text-xs text-rose-600">{msg}</p>}
        <div className="flex gap-2">
          <button onClick={() => guardar.mutate()} disabled={!puedeGuardar}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
            <Save size={16} /> {guardar.isPending ? 'Guardando…' : editando ? 'Guardar cambios' : 'Agregar kiosco'}
          </button>
          {editando && (
            <button onClick={() => { setF(vacio); setMsg(''); }} className="text-sm text-gray-500 hover:text-gray-700 px-2">
              Cancelar
            </button>
          )}
        </div>
      </div>
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

      {/* Regla configurable: N retardos = 1 falta (sólo si el usuario la enciende). */}
      <div className="border-t pt-3 space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={(f.retardos_por_falta ?? 0) > 0}
            onChange={(e) => setF({ ...f, retardos_por_falta: e.target.checked ? (f.retardos_por_falta > 0 ? f.retardos_por_falta : 3) : null })} />
          Convertir retardos acumulados en falta
        </label>
        {(f.retardos_por_falta ?? 0) > 0 && (
          <div className="flex items-center gap-2 text-sm text-gray-700 pl-6">
            Cada
            <input type="number" min={1} max={5} className="input w-16 text-center"
              value={f.retardos_por_falta ?? ''}
              onChange={(e) => setF({ ...f, retardos_por_falta: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })} />
            retardo(s) = <b>1 falta</b>
          </div>
        )}
        <p className="text-xs text-gray-500 pl-6">
          Al «Cargar del checador» en la prenómina, los retardos acumulados del periodo se vuelven
          falta (deducción 020, en días). Apagado: los retardos sólo se informan, no se descuentan.
        </p>
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
  const [error, setError] = useState('');

  const crear = useMutation({
    mutationFn: () => api.crearCheckadorTurno(nuevo),
    onSuccess: () => { setNuevo(vacio); setError(''); qc.invalidateQueries({ queryKey: ['checador-turnos'] }); },
    onError: (e: any) => setError(e?.response?.data?.message || e?.message || 'No se pudo crear el turno.'),
  });

  // Valida y avisa qué falta (en vez de dejar el botón muerto sin explicación).
  const intentarCrear = () => {
    const faltan: string[] = [];
    if (!String(nuevo.nombre).trim()) faltan.push('nombre');
    if (!nuevo.hora_entrada) faltan.push('hora de entrada');
    if (!nuevo.hora_salida) faltan.push('hora de salida');
    if (faltan.length) { setError(`Falta ${faltan.join(', ')}. Si el reloj muestra «-----», toca esa parte y elige AM/PM para que se guarde.`); return; }
    if (!!nuevo.comida_inicio !== !!nuevo.comida_fin) { setError('La comida necesita inicio y fin (o deja ambos vacíos).'); return; }
    if (!nuevo.dias.length) { setError('Elige al menos un día laboral.'); return; }
    setError('');
    crear.mutate();
  };
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
        <p className="text-[11px] text-gray-400 mt-1">Si un campo de hora muestra «-----», toca esa parte y elige AM/PM (o teclea la hora completa) para que se guarde.</p>
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
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        <button onClick={intentarCrear} disabled={crear.isPending}
          className="btn-primary mt-4 inline-flex items-center gap-2">
          <Plus size={16} /> {crear.isPending ? 'Agregando…' : 'Agregar turno'}
        </button>
      </div>
    </div>
  );
}

/* ── Empleados: horario + consentimiento + enrolamiento ── */
function TabEmpleados() {
  const qc = useQueryClient();
  const empQ = useQuery({ queryKey: ['checador-empleados'], queryFn: () => api.getEmpleados({}) });
  const empleados: any[] = empQ.data?.data?.empleados || empQ.data?.data || [];
  const turnosQ = useQuery({ queryKey: ['checador-turnos'], queryFn: () => api.getCheckadorTurnos() });
  const turnos: any[] = turnosQ.data?.data || [];
  const [sel, setSel] = useState<any>(null);

  /* Selección múltiple para asignar el turno a varios de un golpe (la plantilla
   * crece y abrir uno por uno no escala). */
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [turnoMasivo, setTurnoMasivo] = useState('');   // '' · id de turno · 'EXENTO'
  const [avisoMasivo, setAvisoMasivo] = useState('');
  const toggle = (id: string) => setMarcados((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const todos = empleados.length > 0 && marcados.size === empleados.length;
  const toggleTodos = () => setMarcados(todos ? new Set() : new Set(empleados.map((e) => e.id)));

  const asignar = useMutation({
    mutationFn: () => {
      const ids = Array.from(marcados);
      return turnoMasivo === 'EXENTO'
        ? api.asignarHorarioMasivo(ids, 'EXENTO')
        : api.asignarHorarioMasivo(ids, 'FIJO', turnoMasivo);
    },
    onSuccess: (r: any) => {
      setAvisoMasivo(`${r?.data?.asignados ?? marcados.size} empleado(s) actualizados.`);
      setMarcados(new Set()); setTurnoMasivo('');
      qc.invalidateQueries({ queryKey: ['checador-horario'] });   // refresca el editor abierto
      setTimeout(() => setAvisoMasivo(''), 4000);
    },
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-1 space-y-2">
        {/* Selección y asignación masiva */}
        {empleados.length > 0 && (
          <div className="bg-white rounded-lg shadow border p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={todos} onChange={toggleTodos} />
              {marcados.size > 0 ? `${marcados.size} seleccionado(s)` : 'Seleccionar todos'}
            </label>
            {marcados.size > 0 && (
              <div className="flex flex-col gap-2 pt-2 border-t">
                <span className="text-xs text-gray-500">Asignar horario a los {marcados.size} marcados:</span>
                <div className="flex gap-2">
                  <select value={turnoMasivo} onChange={(e) => setTurnoMasivo(e.target.value)}
                    className="flex-1 rounded border px-2 py-1.5 text-sm min-w-0">
                    <option value="">— Turno —</option>
                    {turnos.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre} ({String(t.hora_entrada).slice(0, 5)}–{String(t.hora_salida).slice(0, 5)})
                      </option>
                    ))}
                    <option value="EXENTO">Exento (no checa)</option>
                  </select>
                  <button onClick={() => asignar.mutate()} disabled={!turnoMasivo || asignar.isPending}
                    className="rounded bg-blue-600 text-white px-3 py-1.5 text-sm font-medium disabled:opacity-50 whitespace-nowrap">
                    {asignar.isPending ? '…' : 'Asignar'}
                  </button>
                </div>
              </div>
            )}
            {avisoMasivo && <p className="text-xs text-emerald-600">{avisoMasivo}</p>}
          </div>
        )}

        {/* Lista con check por trabajador */}
        <div className="bg-white rounded-lg shadow border overflow-hidden max-h-[62vh] overflow-y-auto">
          {empleados.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">Sin empleados. Dalos de alta en Empleados.</p>
          ) : empleados.map((e) => (
            <div key={e.id}
              className={`flex items-center gap-2.5 px-3 py-2.5 border-b text-sm ${sel?.id === e.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
              <input type="checkbox" checked={marcados.has(e.id)} onChange={() => toggle(e.id)}
                className="shrink-0" aria-label={`Marcar ${e.nombre}`} />
              <button onClick={() => setSel(e)} className="text-left flex-1 min-w-0">
                <div className="font-medium text-gray-800 truncate">{e.nombre} {e.apellido_pat} {e.apellido_mat}</div>
                <div className="text-xs text-gray-500 font-mono">#{e.num_empleado}</div>
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="md:col-span-2">
        {sel ? <EditorEmpleado empleado={sel} turnos={turnos} /> : (
          <div className="bg-white rounded-lg shadow border p-8 text-center text-gray-500 text-sm">
            Elige un empleado para ver su horario, consentimiento y enrolamiento.<br />
            O marca varios con el check y asígnales el turno de golpe.
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
            : 'Sin rostro enrolado. Usa el botón «Enrolar rostro» (arriba) para capturarlo con la cámara.'}
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
