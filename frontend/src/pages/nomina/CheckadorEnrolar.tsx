/**
 * Enrolamiento facial (PWA) — captura 3 tomas del rostro del empleado y las
 * guarda como plantillas para que el kiosco luego lo reconozca.
 *
 * Igual que el kiosco: el descriptor (128 flotantes) se calcula EN EL DISPOSITIVO
 * y al backend solo van los números, nunca la foto. Solo se puede enrolar a quien
 * ya firmó el consentimiento biométrico (LFPDPPP).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, Loader2, ShieldAlert, UserPlus, RefreshCw, Save } from 'lucide-react';
import { cargarFaceApi, descriptorDeVideo } from '@/utils/faceApi';
import api from '@/services/api';

type Empleado = { id: string; nombre: string; num_empleado?: string; plantillas: number; consentimiento: boolean };
const TOMAS = 3;

export function CheckadorEnrolarPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [empId, setEmpId] = useState('');
  const [fase, setFase] = useState<'iniciando' | 'listo' | 'error'>('iniciando');
  const [error, setError] = useState('');
  const [tomas, setTomas] = useState<number[][]>([]);
  const [capturando, setCapturando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  const emp = useMemo(() => empleados.find((e) => e.id === empId), [empleados, empId]);

  const cargarEmpleados = async () => {
    try { const r: any = await api.checadorEmpleadosEnrolar(); setEmpleados(r?.data || []); }
    catch { setEmpleados([]); }
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let vivo = true;
    (async () => {
      await cargarEmpleados();
      try {
        await cargarFaceApi();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
        if (!vivo) return;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        setFase('listo');
      } catch (e: any) {
        setError(e?.message || 'No se pudo iniciar la cámara. Da permiso de cámara y recarga.');
        setFase('error');
      }
    })();
    return () => { vivo = false; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const capturar = async () => {
    if (!videoRef.current || capturando || tomas.length >= TOMAS) return;
    setCapturando(true); setMsg('');
    try {
      const d = await descriptorDeVideo(videoRef.current);
      if (!d) { setMsg('No detecté un rostro claro. Acércate, con buena luz y de frente.'); }
      else setTomas((t) => [...t, d.descriptor]);
    } catch { setMsg('Error al capturar. Intenta de nuevo.'); }
    finally { setCapturando(false); }
  };

  const guardar = async () => {
    if (!empId || tomas.length < TOMAS) return;
    setGuardando(true); setMsg('');
    try {
      await api.checadorEnrolar(empId, tomas);
      setMsg(`✓ ${emp?.nombre} quedó enrolado con ${tomas.length} tomas.`);
      setTomas([]);
      await cargarEmpleados();
    } catch (e: any) {
      setMsg(e?.response?.data?.message || e?.message || 'No se pudo guardar el enrolamiento.');
    } finally { setGuardando(false); }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <h1 className="text-xl font-bold flex items-center gap-2"><UserPlus size={22} /> Enrolamiento facial</h1>
      <p className="text-sm text-gray-500">
        Elige al empleado, captura {TOMAS} tomas de su rostro y guarda. Después el kiosco lo reconocerá al checar.
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Cámara + capturas */}
        <div className="space-y-3">
          <div className="relative">
            <video ref={videoRef} playsInline muted className="rounded-lg bg-black w-full aspect-[4/3] object-cover shadow" />
            {fase === 'iniciando' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg text-white">
                <span className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={18} /> Iniciando cámara…</span>
              </div>
            )}
          </div>
          {fase === 'error' && <p className="text-rose-600 text-sm">{error}</p>}

          <div className="flex items-center gap-2">
            {Array.from({ length: TOMAS }).map((_, i) => (
              <span key={i} className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
                i < tomas.length ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 text-gray-400'}`}>
                {i < tomas.length ? <Check size={16} /> : i + 1}
              </span>
            ))}
            <span className="text-sm text-gray-500 ml-1">{tomas.length}/{TOMAS} tomas</span>
          </div>

          <div className="flex gap-2">
            <button onClick={capturar} disabled={fase !== 'listo' || capturando || tomas.length >= TOMAS || !emp?.consentimiento}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 text-white px-3 py-2 text-sm font-medium disabled:opacity-50">
              {capturando ? <Loader2 className="animate-spin" size={16} /> : <Camera size={16} />} Capturar toma
            </button>
            {tomas.length > 0 && (
              <button onClick={() => setTomas([])} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm text-gray-600">
                <RefreshCw size={14} /> Reiniciar
              </button>
            )}
          </div>
        </div>

        {/* Selección de empleado + guardar */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">Empleado</label>
          <select value={empId} onChange={(e) => { setEmpId(e.target.value); setTomas([]); setMsg(''); }}
            className="w-full rounded-lg border px-3 py-2 text-sm">
            <option value="">— Selecciona —</option>
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}{e.num_empleado ? ` (#${e.num_empleado})` : ''} · {e.plantillas > 0 ? `${e.plantillas} plantillas` : 'sin enrolar'}
              </option>
            ))}
          </select>

          {emp && !emp.consentimiento && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              <ShieldAlert size={18} className="mt-0.5 shrink-0" />
              <span>Este empleado aún no firma el consentimiento biométrico (LFPDPPP). Regístralo en Nómina → Checador antes de enrolar su rostro.</span>
            </div>
          )}
          {emp && emp.consentimiento && emp.plantillas > 0 && (
            <p className="text-xs text-gray-500">Ya tiene {emp.plantillas} plantillas; guardar de nuevo las reemplaza.</p>
          )}

          <button onClick={guardar} disabled={!empId || tomas.length < TOMAS || guardando || !emp?.consentimiento}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 text-white px-3 py-2 text-sm font-medium disabled:opacity-50">
            {guardando ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Guardar enrolamiento
          </button>

          {msg && <p className={`text-sm ${msg.startsWith('✓') ? 'text-emerald-600' : 'text-rose-600'}`}>{msg}</p>}
        </div>
      </div>
    </div>
  );
}

export default CheckadorEnrolarPage;
