/**
 * ConsentimientoFirmado — los 3 pasos que LIBERAN el enrolamiento facial.
 *
 * POR QUÉ EXISTE
 * El rostro es un dato personal SENSIBLE y la LFPDPPP pide consentimiento
 * EXPRESO Y POR ESCRITO. Antes bastaba una palomita en pantalla: eso no es
 * prueba de nada el día de una queja ante el INAI. Ahora el orden es físico y
 * el sistema lo impone:
 *
 *   1. IMPRIMIR el convenio            (el texto ya lo teníamos)
 *   2. FIRMA de puño y letra           — fuera del sistema, en papel
 *   3. FOTO del convenio firmado       → eso, y sólo eso, libera el rostro
 *
 * DECISIONES DE DISEÑO
 * · Pasos NUMERADOS con su palomita: el usuario ve en qué va y qué falta sin
 *   leer (Gestalt: progresión; heurística #1 de Nielsen: visibilidad del estado).
 *   El botón de enrolar queda deshabilitado con la razón escrita al lado, no
 *   «muerto» sin explicación.
 * · Dos formas de tomar la foto: con la cámara que ya está abierta (laptop,
 *   sosteniendo la hoja) y con el archivo/cámara del equipo, que en celular y
 *   tableta abre la cámara TRASERA —la buena para fotografiar un papel—.
 * · La foto se reduce en el navegador antes de subirla (ver `reducirDocumento`).
 * · Objetivos táctiles de 44 px y foco visible: esto se usa en tableta.
 */
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, Camera, Upload, Check, Loader2, ShieldCheck, Eye, X, RotateCcw } from 'lucide-react';
import { aTextoMx } from '@/components/CampoFecha';
import { useAuthStore } from '@/store/auth';
import { htmlConsentimientoImprimir } from './ConsentimientoBiometrico';
import api from '@/services/api';

/** Lo que devuelve el backend en `GET …/consentimiento`. */
export type EstadoConsentimiento = {
  aceptado?: boolean;
  tiene_documento?: boolean;
  impreso_at?: string | null;
  documento_at?: string | null;
  fecha?: string | null;
};

/* La foto tiene que LEERSE (es un documento, no un avatar), pero no puede pesar
 * 4 MB como sale del celular: 1600 px de lado largo y calidad bajando hasta que
 * entre en ~1.4 MB. El backend rechaza arriba de ~2 MB. */
const MAX_LADO = 1600;
const MAX_LARGO = Math.floor(1.4 * 1024 * 1024);
const CALIDADES = [0.82, 0.7, 0.6, 0.5, 0.4];

function aJpeg(lienzo: HTMLCanvasElement): string {
  for (const q of CALIDADES) {
    const d = lienzo.toDataURL('image/jpeg', q);
    if (d.length <= MAX_LARGO) return d;
  }
  return lienzo.toDataURL('image/jpeg', 0.35);
}

function dibujar(fuente: CanvasImageSource, w: number, h: number): string | null {
  if (!w || !h) return null;
  const escala = Math.min(1, MAX_LADO / Math.max(w, h));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(w * escala);
  lienzo.height = Math.round(h * escala);
  const ctx = lienzo.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
  return aJpeg(lienzo);
}

/** Reduce la foto elegida (o tomada con la cámara del equipo) a un JPEG legible. */
export function reducirDocumento(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('El archivo no es una imagen válida.'));
      img.onload = () => {
        const d = dibujar(img, img.width, img.height);
        d ? resolve(d) : reject(new Error('No se pudo procesar la imagen.'));
      };
      img.src = String(lector.result);
    };
    lector.readAsDataURL(f);
  });
}

/** Cuadro COMPLETO del video (no recorte cuadrado): una hoja no es un retrato. */
export function fotoDocumentoDeVideo(v: HTMLVideoElement): string | null {
  return dibujar(v, v.videoWidth, v.videoHeight);
}

/** Datos del trabajador que van impresos en el convenio. */
export type DatosImpresion = { empresa?: string; empleado?: string; rfc?: string; puesto?: string };

interface Props {
  empleadoId: string;
  datos: DatosImpresion;
  estado?: EstadoConsentimiento | null;
  /** Se llama tras cada cambio para que la pantalla vuelva a pedir el estado. */
  onCambio: () => void | Promise<void>;
  /** Si la pantalla ya tiene una cámara abierta, con qué tomar la foto ahí mismo. */
  tomarDeCamara?: () => string | null;
}

export function ConsentimientoFirmado({ empleadoId, datos, estado, onCambio, tomarDeCamara }: Props) {
  const archivo = useRef<HTMLInputElement>(null);
  const [tomada, setTomada] = useState<string | null>(null);   // foto pendiente de guardar
  const [trabajando, setTrabajando] = useState('');            // 'imprimir' | 'subir' | 'ver' | 'revocar'
  const [msg, setMsg] = useState('');
  const [verDoc, setVerDoc] = useState<string | null>(null);

  /* El Responsable del tratamiento es LA EMPRESA y va impreso en el convenio. Si
   * la pantalla no lo pasó, se resuelve aquí (react-query lo cachea y no se
   * vuelve a pedir en toda la sesión). */
  const { user } = useAuthStore();
  const empresasQ = useQuery({
    queryKey: ['mis-empresas'], queryFn: () => api.misEmpresas(),
    enabled: !datos.empresa, staleTime: 5 * 60 * 1000,
  });
  const empresa = datos.empresa
    || ((empresasQ.data as any)?.data || []).find((x: any) => x.id === user?.companyId)?.business_name
    || '';

  const impreso = !!estado?.impreso_at;
  const firmado = !!estado?.tiene_documento;
  const vigente = firmado && !!estado?.aceptado;

  const fallo = (e: any, alterno: string) => setMsg(e?.response?.data?.message || e?.message || alterno);

  /* Paso 1 — se abre la versión imprimible y se deja constancia de que se imprimió.
   * El registro no depende de que el usuario oprima «Imprimir» en el diálogo del
   * navegador (eso no se puede saber): marca que ya se generó para firma. */
  const imprimir = async () => {
    setMsg(''); setTrabajando('imprimir');
    try {
      const html = htmlConsentimientoImprimir({ ...datos, empresa });
      const w = window.open('', '_blank', 'width=820,height=920');
      if (!w) { setMsg('Permite las ventanas emergentes para imprimir el convenio.'); return; }
      w.document.write(html); w.document.close();
      await api.setCheckadorConsentimiento(empleadoId, { impreso: true });
      await onCambio();
    } catch (e: any) { fallo(e, 'No se pudo registrar la impresión.'); }
    finally { setTrabajando(''); }
  };

  const elegirArchivo = async (f: File) => {
    setMsg('');
    if (!/^image\//.test(f.type)) { setMsg('Tiene que ser una imagen (foto del convenio).'); return; }
    try { setTomada(await reducirDocumento(f)); }
    catch (e: any) { fallo(e, 'No se pudo leer la imagen.'); }
  };

  const tomarAhora = () => {
    setMsg('');
    const d = tomarDeCamara?.();
    if (!d) { setMsg('La cámara aún no está lista. Espera a que se vea la imagen.'); return; }
    setTomada(d);
  };

  /* Paso 3 — subir la foto: esto es lo que LIBERA el enrolamiento. */
  const guardar = async () => {
    if (!tomada) return;
    setMsg(''); setTrabajando('subir');
    try {
      await api.setCheckadorConsentimiento(empleadoId, { documento: tomada });
      setTomada(null);
      await onCambio();
    } catch (e: any) { fallo(e, 'No se pudo guardar la foto del convenio.'); }
    finally { setTrabajando(''); }
  };

  const ver = async () => {
    setMsg(''); setTrabajando('ver');
    try {
      const r: any = await api.getCheckadorConvenioFirmado(empleadoId);
      setVerDoc(r?.data?.documento || null);
    } catch (e: any) { fallo(e, 'No se pudo abrir el convenio.'); }
    finally { setTrabajando(''); }
  };

  const revocar = async () => {
    if (!window.confirm('¿Registrar que el trabajador REVOCA su consentimiento biométrico?\n\nYa no se podrá enrolar su rostro y habrá que darle un método alterno de asistencia. El convenio firmado se conserva como constancia de lo que se firmó.')) return;
    setMsg(''); setTrabajando('revocar');
    try {
      await api.setCheckadorConsentimiento(empleadoId, { aceptado: false });
      await onCambio();
    } catch (e: any) { fallo(e, 'No se pudo registrar la revocación.'); }
    finally { setTrabajando(''); }
  };

  return (
    <div className={`rounded-lg border p-3 space-y-3 ${vigente ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/60'}`}>
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
        <ShieldCheck size={18} className={vigente ? 'text-emerald-600' : 'text-amber-600'} aria-hidden="true" />
        Convenio de datos biométricos (LFPDPPP)
        {vigente && <span className="ml-auto text-xs font-medium text-emerald-700">Enrolamiento liberado</span>}
      </div>

      {/* ── Paso 1 ── */}
      <Paso n={1} listo={impreso} titulo="Imprime el convenio"
        nota={impreso ? `Impreso el ${aTextoMx(estado?.impreso_at)}` : 'Se firma por duplicado: uno para el trabajador, uno para la empresa.'}>
        <BotonPaso onClick={imprimir} cargando={trabajando === 'imprimir'} icono={<Printer size={15} />}
          tono={impreso ? 'suave' : 'fuerte'}>
          {impreso ? 'Imprimir de nuevo' : 'Imprimir convenio'}
        </BotonPaso>
      </Paso>

      {/* ── Paso 2 ── */}
      <Paso n={2} listo={firmado} titulo="Que lo firme de su puño y letra"
        nota="En papel, fuera del sistema. Es voluntario: si no firma, usa un método alterno de asistencia." />

      {/* ── Paso 3 ── */}
      <Paso n={3} listo={firmado} titulo="Tómale foto al convenio firmado"
        nota={firmado
          ? `Foto guardada el ${aTextoMx(estado?.documento_at)}${estado?.aceptado ? '' : ' · consentimiento REVOCADO'}`
          : 'Esta foto es la prueba de la firma y es lo que libera el enrolamiento del rostro.'}>
        {/* Foto recién tomada, antes de guardarla */}
        {tomada ? (
          <div className="flex flex-wrap items-center gap-2">
            <img src={tomada} alt="Vista previa del convenio firmado"
              className="h-20 w-auto rounded border border-gray-300 bg-white" />
            <BotonPaso onClick={guardar} cargando={trabajando === 'subir'} icono={<Check size={15} />} tono="fuerte">
              Guardar y liberar enrolamiento
            </BotonPaso>
            <BotonPaso onClick={() => setTomada(null)} icono={<X size={15} />} tono="suave">Descartar</BotonPaso>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {tomarDeCamara && (
              <BotonPaso onClick={tomarAhora} icono={<Camera size={15} />} tono={firmado ? 'suave' : 'fuerte'}>
                Tomar foto con esta cámara
              </BotonPaso>
            )}
            <BotonPaso onClick={() => archivo.current?.click()} icono={<Upload size={15} />}
              tono={firmado || tomarDeCamara ? 'suave' : 'fuerte'}>
              {firmado ? 'Reemplazar foto' : 'Tomar foto / elegir archivo'}
            </BotonPaso>
            {firmado && (
              <>
                <BotonPaso onClick={ver} cargando={trabajando === 'ver'} icono={<Eye size={15} />} tono="suave">
                  Ver convenio
                </BotonPaso>
                {estado?.aceptado
                  ? <BotonPaso onClick={revocar} cargando={trabajando === 'revocar'} icono={<X size={15} />} tono="peligro">
                      Revocar
                    </BotonPaso>
                  : <BotonPaso onClick={() => archivo.current?.click()} icono={<RotateCcw size={15} />} tono="fuerte">
                      Volver a firmar
                    </BotonPaso>}
              </>
            )}
            {/* `capture="environment"`: en celular y tableta abre la cámara TRASERA,
                que es la que sirve para fotografiar una hoja. */}
            <input ref={archivo} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) elegirArchivo(f); e.target.value = ''; }} />
          </div>
        )}
      </Paso>

      {msg && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">{msg}</p>}
      {firmado && !estado?.aceptado && (
        <p role="alert" className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
          Consentimiento <b>revocado</b>: no se puede enrolar su rostro. Dale un método alterno de asistencia.
        </p>
      )}

      {/* El convenio firmado, en grande */}
      {verDoc && (
        <div role="dialog" aria-modal="true" aria-label="Convenio firmado"
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setVerDoc(null)}>
          <div className="bg-white rounded-lg p-2 max-w-3xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-2 pb-2">
              <span className="text-sm font-semibold text-gray-700">Convenio firmado · {datos.empleado || ''}</span>
              <button onClick={() => setVerDoc(null)} aria-label="Cerrar"
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-gray-500
                  hover:bg-gray-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-300">
                <X size={20} />
              </button>
            </div>
            <img src={verDoc} alt="Convenio de datos biométricos firmado" className="max-w-full rounded" />
          </div>
        </div>
      )}
    </div>
  );
}

/** Un paso del flujo: número (palomita al cumplirse), título, nota y su acción. */
function Paso({ n, listo, titulo, nota, children }:
  { n: number; listo: boolean; titulo: string; nota?: string; children?: any }) {
  return (
    <div className="flex gap-2.5">
      {/* emerald-600: la palomita blanca necesita 3:1 contra el relleno (es un
          objeto gráfico que comunica estado) y el -500 se queda en 2.5:1. */}
      <span aria-hidden="true"
        className={`shrink-0 h-7 w-7 rounded-full border-2 flex items-center justify-center text-xs font-bold
          ${listo ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-gray-300 text-gray-400 bg-white'}`}>
        {listo ? <Check size={14} /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium text-gray-800">
          {titulo} {listo && <span className="sr-only">(hecho)</span>}
        </p>
        {nota && <p className="text-[11px] text-gray-600 leading-snug">{nota}</p>}
        {children}
      </div>
    </div>
  );
}

/** Botón de un paso: 44 px de alto, foco visible, con su estado de carga. */
function BotonPaso({ onClick, children, icono, cargando, tono = 'suave' }:
  { onClick: () => void; children: any; icono?: any; cargando?: boolean; tono?: 'fuerte' | 'suave' | 'peligro' }) {
  /* emerald-700 y no -600: con texto blanco de 14 px el 600 da 3.8:1 y no pasa
   * WCAG AA (4.5:1); el 700 da 5.5:1. */
  const colores = {
    fuerte: 'bg-emerald-700 text-white border-emerald-800 hover:bg-emerald-800 focus-visible:ring-emerald-300',
    suave: 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 focus-visible:ring-sky-300',
    peligro: 'bg-white text-rose-700 border-rose-300 hover:bg-rose-50 focus-visible:ring-rose-300',
  }[tono];
  return (
    <button type="button" onClick={onClick} disabled={!!cargando}
      className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border text-sm font-medium
        transition active:scale-[.97] disabled:opacity-50
        focus:outline-none focus-visible:ring-4 ${colores}`}>
      {cargando ? <Loader2 className="animate-spin" size={15} aria-hidden="true" /> : icono}
      {children}
    </button>
  );
}

export default ConsentimientoFirmado;
