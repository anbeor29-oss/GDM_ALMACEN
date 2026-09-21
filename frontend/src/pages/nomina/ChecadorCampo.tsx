/**
 * Checador de CAMPO (celular) — para el personal fuera de la oficina.
 *
 * Al abrir: pide la UBICACIÓN (GPS) y la CÁMARA. En cuanto detecta un rostro,
 * registra la checada (ENTRADA/SALIDA por toggle) con `origen: 'APP'` y las
 * coordenadas. El rostro identifica a la persona (1:N en el servidor); el equipo
 * entra con un usuario universal compartido —la cara distingue a cada quien—.
 *
 * Sólo se guardan las COORDENADAS (lat/lng): la dirección se ve en Maps cuando se
 * necesite, desde el registro. Corre a pantalla completa, fuera del ERP.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserCheck, UserX, MapPin, MapPinOff, LogIn, LogOut, Loader2, Settings, RefreshCw } from 'lucide-react';
import { cargarFaceApi, descriptorDeVideo } from '@/utils/faceApi';
import api from '@/services/api';

type Coords = { lat: number; lng: number } | null;
type Resultado = { ok: boolean; nombre?: string; tipo?: string; repetido?: boolean; hora?: string; conUbicacion?: boolean };

export function ChecadorCampoPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fase, setFase] = useState<'iniciando' | 'listo' | 'error'>('iniciando');
  const [error, setError] = useState('');
  const [gps, setGps] = useState<'buscando' | 'ok' | 'denegado' | 'sin'>('buscando');
  const [res, setRes] = useState<Resultado | null>(null);
  const [checando, setChecando] = useState(false);
  const coordsRef = useRef<Coords>(null);
  const ocupado = useRef(false);
  const activo = useRef(true);   // se apaga tras una checada exitosa; el botón lo reactiva

  const pedirGps = () => {
    if (!('geolocation' in navigator)) { setGps('sin'); return; }
    setGps('buscando');
    navigator.geolocation.getCurrentPosition(
      (p) => { coordsRef.current = { lat: p.coords.latitude, lng: p.coords.longitude }; setGps('ok'); },
      (e) => { setGps(e.code === 1 ? 'denegado' : 'sin'); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };

  const reiniciar = () => { setRes(null); activo.current = true; pedirGps(); };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let vivo = true;
    let timer: any = null;

    const tick = async () => {
      if (!vivo || ocupado.current || !activo.current) return;
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      ocupado.current = true;
      try {
        const d = await descriptorDeVideo(v);
        if (d) {
          activo.current = false;                 // no dispares otra vez hasta "Checar de nuevo"
          setChecando(true);
          const c = coordsRef.current;
          const r: any = await api.checadorChecada({ descriptor: d.descriptor, lat: c?.lat ?? null, lng: c?.lng ?? null, origen: 'APP' });
          const x = r?.data || {};
          if (!x.reconocido) {
            setRes({ ok: false });
            activo.current = true;                // no te reconoció: deja reintentar solo
          } else {
            const hora = x.ts ? new Date(x.ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '';
            setRes({ ok: true, nombre: x.empleado?.nombre, tipo: x.tipo, repetido: x.repetido, hora, conUbicacion: !!c });
          }
          setChecando(false);
        }
      } catch { /* reintenta en el próximo tick */ }
      finally { ocupado.current = false; }
    };

    pedirGps();
    (async () => {
      try {
        await cargarFaceApi();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
        if (!vivo) return;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        setFase('listo');
        timer = setInterval(tick, 1000);
      } catch (e: any) {
        setError(e?.message || 'No se pudo iniciar la cámara. Da permiso de cámara y recarga.');
        setFase('error');
      }
    })();

    return () => { vivo = false; if (timer) clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const gpsChip = {
    buscando: { icon: <Loader2 className="animate-spin" size={14} />, txt: 'Ubicación…', cls: 'bg-gray-700 text-gray-200' },
    ok:       { icon: <MapPin size={14} />, txt: 'Ubicación lista', cls: 'bg-emerald-600 text-white' },
    denegado: { icon: <MapPinOff size={14} />, txt: 'Sin permiso de ubicación', cls: 'bg-amber-600 text-white' },
    sin:      { icon: <MapPinOff size={14} />, txt: 'Sin GPS', cls: 'bg-amber-600 text-white' },
  }[gps];

  return (
    <div className="min-h-screen flex flex-col items-center gap-4 p-4 bg-gray-900 text-white relative overflow-hidden">
      <Link to="/checador" className="absolute top-3 right-3 text-gray-400 hover:text-white p-2" title="Administración" aria-label="Administración">
        <Settings size={20} />
      </Link>
      <h1 className="text-xl font-bold flex items-center gap-2 mt-1"><MapPin size={22} /> Checador · Campo</h1>

      <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${gpsChip.cls}`}>
        {gpsChip.icon} {gpsChip.txt}
        {(gps === 'denegado' || gps === 'sin') && (
          <button onClick={pedirGps} className="ml-1 underline">reintentar</button>
        )}
      </span>

      <div className="relative w-full max-w-[420px]">
        <video ref={videoRef} playsInline muted className="rounded-lg bg-black w-full aspect-[3/4] object-cover shadow-lg" />
        {fase === 'iniciando' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg">
            <span className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={18} /> Iniciando cámara…</span>
          </div>
        )}
        {checando && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
            <span className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={18} /> Registrando…</span>
          </div>
        )}
      </div>

      {fase === 'error' && <p className="text-rose-300 text-sm max-w-md text-center">{error}</p>}
      {fase === 'listo' && !res && !checando && <p className="text-gray-300 text-sm text-center">Mira a la cámara para registrar tu entrada o salida.</p>}

      {res && (
        <div className={`w-full max-w-[420px] rounded-xl p-5 text-center shadow-xl ${
          !res.ok ? 'bg-rose-600' : res.tipo === 'ENTRADA' ? 'bg-emerald-600' : 'bg-sky-600'}`}>
          {!res.ok ? (
            <div className="flex flex-col items-center gap-1"><UserX size={40} /><p className="text-lg font-bold">No te reconocí</p><p className="text-sm opacity-90">Acomódate de frente, con buena luz.</p></div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <UserCheck size={40} />
              <p className="text-xl font-bold">{res.nombre}</p>
              <p className="text-2xl font-extrabold flex items-center gap-2">
                {res.tipo === 'ENTRADA' ? <><LogIn size={22} /> ENTRADA</> : <><LogOut size={22} /> SALIDA</>}
                {res.hora && <span className="text-base font-medium opacity-90">· {res.hora}</span>}
              </p>
              <p className="text-xs opacity-90 flex items-center gap-1">
                {res.conUbicacion ? <><MapPin size={12} /> ubicación registrada</> : <><MapPinOff size={12} /> sin ubicación</>}
              </p>
              {res.repetido && <p className="text-xs opacity-90">(ya habías checado hace un momento)</p>}
            </div>
          )}
          <button onClick={reiniciar} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white/20 hover:bg-white/30 px-4 py-2 text-sm font-medium">
            <RefreshCw size={15} /> Checar de nuevo
          </button>
        </div>
      )}
    </div>
  );
}

export default ChecadorCampoPage;
