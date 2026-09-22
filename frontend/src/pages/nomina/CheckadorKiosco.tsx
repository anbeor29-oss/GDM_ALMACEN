/**
 * Kiosco de asistencia (PWA) — cámara → reconoce el rostro → registra la checada.
 *
 * Corre en el navegador de la tablet/celular. Extrae el descriptor con face-api
 * EN EL DISPOSITIVO y manda solo eso al backend, que identifica (1:N) y asienta
 * ENTRADA/SALIDA. Pensado para pantalla completa: se abre y se deja puesto.
 *
 * Nota: por ahora usa la sesión iniciada (un admin abre el kiosco en la tablet).
 * El token de dispositivo sin login personal es la siguiente fase.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserCheck, UserX, Camera, LogIn, LogOut, Loader2, Settings, Clock, MapPin } from 'lucide-react';
import { cargarFaceApi, descriptorDeVideo } from '@/utils/faceApi';
import { leerKioscoSel, guardarKioscoSel, borrarKioscoSel, type KioscoSel } from '@/utils/kioscoSel';
import api from '@/services/api';

type Resultado = { ok: boolean; nombre?: string; tipo?: string; repetido?: boolean; hora?: string; espera?: boolean; mensaje?: string };

export function CheckadorKioscoPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fase, setFase] = useState<'iniciando' | 'listo' | 'error'>('iniciando');
  const [error, setError] = useState('');
  const [res, setRes] = useState<Resultado | null>(null);
  const ocupado = useRef(false);
  const enfriando = useRef(0);   // timestamp hasta el que no se vuelve a procesar

  // Qué kiosco/centro es ESTE equipo (se guarda en su localStorage).
  const [kioscos, setKioscos] = useState<any[]>([]);
  const [sel, setSel] = useState<KioscoSel | null>(() => leerKioscoSel());
  const selRef = useRef<KioscoSel | null>(sel);
  useEffect(() => { selRef.current = sel; }, [sel]);
  useEffect(() => {
    api.getCheckadorKioscos().then((r: any) => setKioscos(r?.data || [])).catch(() => {});
  }, []);
  const elegir = (k: any) => { guardarKioscoSel(k.id, k.nombre); setSel({ id: k.id, nombre: k.nombre }); };
  const cambiar = () => { borrarKioscoSel(); setSel(null); };
  // Si hay kioscos configurados y este equipo no tiene ninguno elegido, se pide elegir.
  const pidiendoKiosco = kioscos.length > 0 && !sel;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: any = null;
    let vivo = true;

    const tick = async () => {
      if (!vivo || ocupado.current || Date.now() < enfriando.current) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      ocupado.current = true;
      try {
        const d = await descriptorDeVideo(v);
        if (d) {
          const r: any = await api.checadorChecada({ descriptor: d.descriptor, kioscoId: selRef.current?.id || null });
          const x = r?.data || {};
          if (!x.reconocido) {
            setRes({ ok: false });
          } else if (x.espera) {
            setRes({ ok: true, espera: true, nombre: x.empleado?.nombre, mensaje: x.mensaje });
          } else {
            const hora = x.ts ? new Date(x.ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '';
            setRes({ ok: true, nombre: x.empleado?.nombre, tipo: x.tipo, repetido: x.repetido, hora });
          }
          enfriando.current = Date.now() + 4500;                 // muestra el resultado y no re-dispara
          setTimeout(() => { if (vivo) setRes(null); }, 4000);
        }
      } catch { /* sigue intentando en el próximo tick */ }
      finally { ocupado.current = false; }
    };

    (async () => {
      try {
        await cargarFaceApi();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
        if (!vivo) return;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        setFase('listo');
        timer = setInterval(tick, 1200);
      } catch (e: any) {
        setError(e?.message || 'No se pudo iniciar la cámara. Da permiso de cámara y recarga.');
        setFase('error');
      }
    })();

    return () => { vivo = false; if (timer) clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-4 sm:p-6 bg-gray-900 text-white relative overflow-hidden">
      <Link to="/checador" className="absolute top-3 right-3 text-gray-400 hover:text-white p-2" title="Administración" aria-label="Administración">
        <Settings size={20} />
      </Link>
      <h1 className="text-2xl font-bold flex items-center gap-2"><Camera size={24} /> Checador · Kiosco</h1>
      {sel && (
        <button onClick={cambiar} className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white -mt-4"
          title="Cambiar de kiosco en este equipo">
          <MapPin size={14} className="text-emerald-400" /> {sel.nombre} <span className="text-gray-500">· cambiar</span>
        </button>
      )}

      <div className="relative">
        <video ref={videoRef} playsInline muted className="rounded-lg bg-black w-[480px] max-w-full aspect-[4/3] object-cover shadow-lg" />
        {fase === 'iniciando' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg">
            <span className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={18} /> Iniciando cámara y modelo…</span>
          </div>
        )}
      </div>

      {fase === 'error' && <p className="text-rose-300 text-sm max-w-md text-center">{error}</p>}
      {fase === 'listo' && !res && <p className="text-gray-300 text-sm">Acércate y mira a la cámara para registrar tu entrada o salida.</p>}

      {res && (
        <div className={`w-full max-w-md rounded-xl p-5 text-center shadow-xl ${
          !res.ok ? 'bg-rose-600' : res.espera ? 'bg-amber-600' : res.tipo === 'ENTRADA' ? 'bg-emerald-600' : 'bg-sky-600'}`}>
          {!res.ok ? (
            <div className="flex flex-col items-center gap-1"><UserX size={40} /><p className="text-lg font-bold">No te reconocí</p><p className="text-sm opacity-90">Intenta de nuevo o pide que te enrolen.</p></div>
          ) : res.espera ? (
            <div className="flex flex-col items-center gap-1"><Clock size={40} /><p className="text-xl font-bold">{res.nombre}</p><p className="text-sm opacity-95">{res.mensaje}</p></div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <UserCheck size={40} />
              <p className="text-xl font-bold">{res.nombre}</p>
              <p className="text-2xl font-extrabold flex items-center gap-2">
                {res.tipo === 'ENTRADA' ? <><LogIn size={22} /> ENTRADA</> : <><LogOut size={22} /> SALIDA</>}
                {res.hora && <span className="text-base font-medium opacity-90">· {res.hora}</span>}
              </p>
              {res.repetido && <p className="text-xs opacity-90">(ya habías checado hace un momento)</p>}
            </div>
          )}
        </div>
      )}

      {/* Este equipo aún no sabe qué kiosco es: se elige una vez y se recuerda. */}
      {pidiendoKiosco && (
        <div className="absolute inset-0 z-20 bg-gray-900/95 flex flex-col items-center justify-center gap-3 p-6">
          <MapPin size={32} className="text-emerald-400" />
          <p className="text-lg font-semibold">¿Qué kiosco es este equipo?</p>
          <p className="text-sm text-gray-400 -mt-2 text-center">Se recuerda en esta tableta para ligar las checadas a su centro.</p>
          <div className="flex flex-col gap-2 w-full max-w-xs mt-1">
            {kioscos.map((k) => (
              <button key={k.id} onClick={() => elegir(k)}
                className="rounded-lg bg-gray-800 hover:bg-gray-700 px-4 py-3 text-left">
                <span className="font-medium">{k.nombre}</span>
                {k.lat != null && <span className="block text-[11px] text-gray-400">ubicación fijada</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default CheckadorKioscoPage;
