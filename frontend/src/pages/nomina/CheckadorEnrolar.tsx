/**
 * Enrolamiento facial (PWA) — captura 3 tomas del rostro del empleado y las
 * guarda como plantillas para que el kiosco luego lo reconozca.
 *
 * Igual que el kiosco: el descriptor (128 flotantes) se calcula EN EL DISPOSITIVO
 * y al backend solo van los números, nunca la foto.
 *
 * EL CANDADO ES LA FIRMA, NO UNA PALOMITA
 * Sólo se enrola a quien ya firmó el convenio de datos biométricos EN PAPEL y
 * cuya firma quedó fotografiada en el sistema (LFPDPPP: dato sensible, se exige
 * consentimiento expreso y por escrito). El flujo —imprimir, firmar, fotografiar—
 * vive en <ConsentimientoFirmado/> y es lo que habilita los botones de captura.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Check, Loader2, ShieldCheck, UserPlus, RefreshCw, Save, ArrowLeft, FileText } from 'lucide-react';
import { cargarFaceApi, descriptorDeVideo } from '@/utils/faceApi';
import { CamaraAviso, diagnosticarCamara, revisarEntornoCamara, type DiagnosticoCamara } from '@/components/CamaraAviso';
import { useAuthStore } from '@/store/auth';
import { ConsentimientoTexto } from './ConsentimientoBiometrico';
import { ConsentimientoFirmado, fotoDocumentoDeVideo } from './ConsentimientoFirmado';
import api from '@/services/api';

type Empleado = {
  id: string; nombre: string; num_empleado?: string; plantillas: number;
  /** Consentimiento vigente (no revocado). */
  consentimiento: boolean;
  /** Ya existe la FOTO del convenio firmado: esto es lo que libera el enrolamiento. */
  convenio_firmado?: boolean;
  impreso_at?: string | null;
  documento_at?: string | null;
};
const TOMAS = 3;

/** Toma una foto del video (cuadrado central, 320 px, JPEG) para el expediente.
 *  Así la foto de FRENTE del enrolamiento sirve también de foto del trabajador y
 *  no se toma otra aparte. Mismo formato que FotoDelTrabajador. */
function fotoDelVideo(video: HTMLVideoElement): string | null {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const lado = Math.min(vw, vh);
  const c = document.createElement('canvas');
  c.width = 320; c.height = 320;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, (vw - lado) / 2, (vh - lado) / 2, lado, lado, 0, 0, 320, 320);
  return c.toDataURL('image/jpeg', 0.82);
}

export function CheckadorEnrolarPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [empId, setEmpId] = useState('');
  const [fase, setFase] = useState<'iniciando' | 'listo' | 'error'>('iniciando');
  /* Diagnóstico accionable en vez del `e.message` crudo del navegador. */
  const [diag, setDiag] = useState<DiagnosticoCamara | null>(null);
  const [intento, setIntento] = useState(0);
  const [tomas, setTomas] = useState<number[][]>([]);
  const [fotoFrente, setFotoFrente] = useState<string | null>(null);  // JPEG de la 1ª toma → expediente
  const [capturando, setCapturando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');
  const { user } = useAuthStore();
  const [empresa, setEmpresa] = useState('');

  const emp = useMemo(() => empleados.find((e) => e.id === empId), [empleados, empId]);
  /* Las DOS condiciones: existe la foto del convenio firmado y el consentimiento
   * sigue vigente (el trabajador puede revocarlo en cualquier momento). */
  const liberado = !!emp?.convenio_firmado && !!emp?.consentimiento;

  // Nombre de la empresa (Responsable del tratamiento) para el convenio.
  useEffect(() => {
    api.misEmpresas().then((r: any) => {
      const e = (r?.data || []).find((x: any) => x.id === user?.companyId);
      setEmpresa(e?.business_name || '');
    }).catch(() => {});
  }, [user?.companyId]);

  const cargarEmpleados = async () => {
    try { const r: any = await api.checadorEmpleadosEnrolar(); setEmpleados(r?.data || []); }
    catch { setEmpleados([]); }
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let vivo = true;
    (async () => {
      await cargarEmpleados();
      const previo = revisarEntornoCamara();
      if (previo) { setDiag(previo); setFase('error'); return; }
      try {
        setFase('iniciando'); setDiag(null);
        await cargarFaceApi();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
        if (!vivo) return;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        setFase('listo');
      } catch (e: any) {
        if (!vivo) return;
        setDiag(diagnosticarCamara(e));
        setFase('error');
      }
    })();
    return () => { vivo = false; stream?.getTracks().forEach((t) => t.stop()); };
  }, [intento]);

  const capturar = async () => {
    if (!videoRef.current || capturando || tomas.length >= TOMAS) return;
    setCapturando(true); setMsg('');
    try {
      const d = await descriptorDeVideo(videoRef.current);
      if (!d) { setMsg('No detecté un rostro claro. Acércate, con buena luz y de frente.'); }
      else {
        // La PRIMERA toma es la de frente: se guarda además como foto del expediente.
        if (tomas.length === 0) setFotoFrente(fotoDelVideo(videoRef.current));
        setTomas((t) => [...t, d.descriptor]);
      }
    } catch { setMsg('Error al capturar. Intenta de nuevo.'); }
    finally { setCapturando(false); }
  };

  const guardar = async () => {
    if (!empId || tomas.length < TOMAS) return;
    setGuardando(true); setMsg('');
    try {
      await api.checadorEnrolar(empId, tomas);
      // La foto de FRENTE va al expediente del trabajador (update parcial: sólo la foto).
      let conFoto = '';
      if (fotoFrente) {
        try { await api.actualizarEmpleado(empId, { foto: fotoFrente }); conFoto = ' y su foto quedó en el expediente'; }
        catch { /* el enrolamiento ya se guardó; la foto se puede poner luego en el expediente */ }
      }
      setMsg(`✓ ${emp?.nombre} quedó enrolado con ${tomas.length} tomas${conFoto}.`);
      setTomas([]); setFotoFrente(null);
      await cargarEmpleados();
    } catch (e: any) {
      setMsg(e?.response?.data?.message || e?.message || 'No se pudo guardar el enrolamiento.');
    } finally { setGuardando(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
     <div className="max-w-3xl mx-auto space-y-4">
      {/* Salida explícita y etiquetada. Antes sólo había un engrane gris que iba al
          MISMO lugar que esto: dos controles para lo mismo, y el engrane prometía
          «configuración» sin darla. Se quitó. */}
      <div className="flex items-center gap-3">
        <Link to="/checador" aria-label="Regresar al checador"
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-gray-300 bg-white
            text-sm font-medium text-gray-700 hover:bg-gray-100 transition active:scale-[.97]
            focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-300">
          <ArrowLeft size={17} aria-hidden="true" /> Regresar
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2"><UserPlus size={22} aria-hidden="true" /> Enrolamiento facial</h1>
      </div>
      <p className="text-sm text-gray-500">
        Primero el <b>convenio firmado</b>; con eso se libera la captura. Luego elige al empleado, toma {TOMAS} tomas
        de su rostro y guarda. La <b>primera toma (de frente)</b> se guarda además como su <b>foto del expediente</b>.
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
          {fase === 'error' && diag && (
            <CamaraAviso d={diag} onReintentar={() => setIntento((n) => n + 1)} />
          )}

          <div className="flex items-center gap-2">
            {Array.from({ length: TOMAS }).map((_, i) => (
              <span key={i} className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
                i < tomas.length ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 text-gray-400'}`}>
                {i < tomas.length ? <Check size={16} /> : i + 1}
              </span>
            ))}
            <span className="text-sm text-gray-500 ml-1">{tomas.length}/{TOMAS} tomas</span>
            {fotoFrente && (
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-gray-500" title="La toma de frente se guardará en el expediente">
                <img src={fotoFrente} alt="Foto de frente" className="w-9 h-9 rounded object-cover border" /> al expediente
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={capturar} disabled={fase !== 'listo' || capturando || tomas.length >= TOMAS || !liberado}
              className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] rounded-lg bg-blue-600 text-white px-3
                text-sm font-medium transition active:scale-[.97] disabled:opacity-50
                focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-300">
              {capturando ? <Loader2 className="animate-spin" size={16} /> : <Camera size={16} />} Capturar toma
            </button>
            {tomas.length > 0 && (
              <button onClick={() => { setTomas([]); setFotoFrente(null); }}
                className="inline-flex items-center gap-1 min-h-[44px] rounded-lg border px-3 text-sm text-gray-600
                  hover:bg-gray-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-300">
                <RefreshCw size={14} /> Reiniciar
              </button>
            )}
          </div>
          {/* La razón por la que el botón está apagado, escrita. Un botón muerto sin
              explicación es el peor estado posible (heurística #1 de Nielsen). */}
          {emp && !liberado && (
            <p className="text-xs text-amber-800">
              La captura está bloqueada: {emp.convenio_firmado
                ? 'el trabajador revocó su consentimiento.'
                : 'falta la foto del convenio firmado (panel de la derecha).'}
            </p>
          )}
        </div>

        {/* Selección de empleado + convenio + guardar */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700" htmlFor="emp-enrolar">Empleado</label>
          <select id="emp-enrolar" value={empId}
            onChange={(e) => { setEmpId(e.target.value); setTomas([]); setFotoFrente(null); setMsg(''); }}
            className="w-full rounded-lg border px-3 py-2 text-sm">
            <option value="">— Selecciona —</option>
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}{e.num_empleado ? ` (#${e.num_empleado})` : ''} · {e.plantillas > 0 ? `${e.plantillas} plantillas` : 'sin enrolar'}
                {e.convenio_firmado ? '' : ' · sin convenio firmado'}
              </option>
            ))}
          </select>

          {emp && (
            <ConsentimientoFirmado
              empleadoId={emp.id}
              datos={{ empresa, empleado: emp.nombre }}
              estado={{
                aceptado: emp.consentimiento,
                tiene_documento: emp.convenio_firmado,
                impreso_at: emp.impreso_at,
                documento_at: emp.documento_at,
              }}
              onCambio={cargarEmpleados}
              /* La cámara ya está abierta: se puede fotografiar la hoja aquí mismo
                 (en celular/tableta el otro botón abre la cámara trasera). */
              tomarDeCamara={() => (videoRef.current ? fotoDocumentoDeVideo(videoRef.current) : null)}
            />
          )}

          {/* El texto del convenio, para leerlo en pantalla sin imprimirlo. */}
          {emp && (
            <details className="rounded-lg border bg-white">
              <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium text-gray-700 flex items-center gap-1.5
                focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-300 rounded-lg">
                <FileText size={15} aria-hidden="true" /> Leer el texto del convenio
              </summary>
              <div className="max-h-56 overflow-y-auto border-t p-3">
                <ConsentimientoTexto empresa={empresa} />
              </div>
            </details>
          )}

          <button onClick={guardar} disabled={!empId || tomas.length < TOMAS || guardando || !liberado}
            className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] rounded-lg bg-emerald-600 text-white px-3
              text-sm font-medium transition active:scale-[.97] disabled:opacity-50
              focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300">
            {guardando ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Guardar enrolamiento
          </button>

          {emp && liberado && emp.plantillas > 0 && (
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <ShieldCheck size={13} className="text-emerald-600" /> Ya tiene {emp.plantillas} plantillas; guardar de nuevo las reemplaza.
            </p>
          )}
          {msg && <p role="status" className={`text-sm ${msg.startsWith('✓') ? 'text-emerald-600' : 'text-rose-600'}`}>{msg}</p>}
        </div>
      </div>
     </div>
    </div>
  );
}

export default CheckadorEnrolarPage;
