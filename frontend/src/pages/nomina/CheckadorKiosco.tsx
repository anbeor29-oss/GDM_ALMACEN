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
import { UserCheck, UserX, Camera, LogIn, LogOut, Loader2 } from 'lucide-react';
import { cargarFaceApi, descriptorDeVideo } from '@/utils/faceApi';
import api from '@/services/api';

type Resultado = { ok: boolean; nombre?: string; tipo?: string; repetido?: boolean; hora?: string };

export function CheckadorKioscoPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fase, setFase] = useState<'iniciando' | 'listo' | 'error'>('iniciando');
  const [error, setError] = useState('');
  const [res, setRes] = useState<Resultado | null>(null);
  const ocupado = useRef(false);
  const enfriando = useRef(0);   // timestamp hasta el que no se vuelve a procesar

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
          const r: any = await api.checadorChecada({ descriptor: d.descriptor });
          const x = r?.data || {};
          if (!x.reconocido) {
            setRes({ ok: false });
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
    <div className="min-h-[80vh] flex flex-col items-center justify-center gap-6 p-6 bg-gray-900 rounded-xl text-white relative overflow-hidden">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Camera size={24} /> Checador · Kiosco</h1>

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
          !res.ok ? 'bg-rose-600' : res.tipo === 'ENTRADA' ? 'bg-emerald-600' : 'bg-sky-600'}`}>
          {!res.ok ? (
            <div className="flex flex-col items-center gap-1"><UserX size={40} /><p className="text-lg font-bold">No te reconocí</p><p className="text-sm opacity-90">Intenta de nuevo o pide que te enrolen.</p></div>
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
    </div>
  );
}

export default CheckadorKioscoPage;
