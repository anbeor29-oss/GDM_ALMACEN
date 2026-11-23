/**
 * CamaraAviso — qué decirle a una persona cuando la cámara no abre.
 *
 * EL PROBLEMA QUE RESUELVE
 * Las tres pantallas de cámara (enrolar, kiosco, campo) hacían `catch (e)` y
 * pintaban `e.message` tal cual: «Permission denied». Eso es el mensaje del
 * navegador para el programador, no para quien está parado frente a la tableta:
 * no dice QUÉ pasó, ni DÓNDE tocar, ni ofrece reintentar. Resultado: un cuadro
 * negro y dos palabras en inglés.
 *
 * Aquí el error se DIAGNOSTICA (cada `name` del estándar MediaDevices tiene una
 * causa y una salida distinta) y se devuelve en español, con los pasos concretos
 * y un botón de reintento. Heurísticas de Nielsen #9 (ayudar a reconocer y
 * recuperarse del error) y #1 (visibilidad del estado del sistema).
 *
 * LA CAUSA QUE MÁS SE REPITE y que el mensaje crudo ESCONDE: la cámara sólo se
 * permite en «contexto seguro» (https:// o localhost). Abierta por http:// o por
 * IP de la red local, el navegador ni siquiera pregunta. Por eso se revisa ANTES
 * de pedirla: así el aviso dice la verdad en vez de «permiso denegado».
 */
import { Camera, CameraOff, Lock, RefreshCw, ShieldAlert } from 'lucide-react';

export interface DiagnosticoCamara {
  /** Clave del caso, para pruebas y telemetría. */
  clave: 'inseguro' | 'sin-api' | 'bloqueada' | 'sin-camara' | 'ocupada' | 'config' | 'desconocido';
  titulo: string;
  /** Qué pasó, en una frase. */
  causa: string;
  /** Qué hacer, en pasos. */
  pasos: string[];
  /** ¿Tiene sentido ofrecer «Reintentar»? */
  reintentable: boolean;
  /** Detalle técnico (para soporte); no se enseña de primera. */
  tecnico?: string;
}

/**
 * ¿Puede este navegador abrir la cámara? Se llama ANTES de `getUserMedia` para
 * distinguir «el navegador no me deja ni preguntar» de «la persona dijo que no».
 */
export function revisarEntornoCamara(): DiagnosticoCamara | null {
  if (typeof window === 'undefined') return null;
  const seguro = window.isSecureContext || window.location.hostname === 'localhost';
  if (!seguro) {
    return {
      clave: 'inseguro',
      titulo: 'Esta página no está en modo seguro',
      causa: `Los navegadores sólo encienden la cámara en sitios https://. Esta página se abrió como «${window.location.protocol}//${window.location.host}», así que ni siquiera pide permiso.`,
      pasos: [
        'Abre la misma dirección pero con https:// al inicio.',
        'Si la abriste por la IP del equipo (192.168.x.x), usa mejor el dominio del sistema.',
        'Si no tienes https, pide que se habilite: sin eso la cámara no puede funcionar en ningún navegador.',
      ],
      reintentable: false,
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      clave: 'sin-api',
      titulo: 'Este navegador no puede usar la cámara',
      causa: 'El navegador no expone el acceso a cámara (suele pasar en navegadores muy viejos o dentro de apps que abren páginas en una ventana limitada).',
      pasos: [
        'Abre el checador en Chrome o Edge actualizados.',
        'Si estás dentro de otra app (Facebook, Instagram, un visor de PDF), ábrela en el navegador del teléfono.',
      ],
      reintentable: false,
    };
  }
  return null;
}

/** Traduce el error de `getUserMedia` a algo accionable. */
export function diagnosticarCamara(e: any): DiagnosticoCamara {
  const previo = revisarEntornoCamara();
  if (previo) return previo;

  const name = String(e?.name || '');
  const msg = String(e?.message || '');
  const tecnico = [name, msg].filter(Boolean).join(': ') || undefined;

  if (name === 'NotAllowedError' || name === 'SecurityError' || /permission|denied|denegad/i.test(msg)) {
    return {
      clave: 'bloqueada',
      titulo: 'La cámara está bloqueada para este sitio',
      causa: 'El navegador tiene guardado un «No permitir» para esta página, así que ya no vuelve a preguntar.',
      pasos: [
        'Toca el candado (o el ícono de cámara) a la izquierda de la dirección, arriba.',
        'En «Cámara», elige Permitir.',
        'Vuelve aquí y toca Reintentar.',
        'En Windows, revisa también Configuración → Privacidad → Cámara, y que esté encendida para el navegador.',
      ],
      reintentable: true,
      tecnico,
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return {
      clave: name === 'OverconstrainedError' ? 'config' : 'sin-camara',
      titulo: name === 'OverconstrainedError' ? 'La cámara no acepta este formato' : 'No se encontró ninguna cámara',
      causa: name === 'OverconstrainedError'
        ? 'La cámara del equipo no admite la resolución que se le pidió.'
        : 'El equipo no tiene cámara conectada, o el sistema no la está mostrando al navegador.',
      pasos: name === 'OverconstrainedError'
        ? ['Toca Reintentar: se pedirá la cámara sin exigir resolución.']
        : [
            'Si es una tableta o celular, revisa que la cámara frontal no esté tapada ni deshabilitada.',
            'Si es una computadora, conecta la cámara USB y vuelve a tocar Reintentar.',
          ],
      reintentable: true,
      tecnico,
    };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return {
      clave: 'ocupada',
      titulo: 'Otra aplicación está usando la cámara',
      causa: 'El sistema sólo deja que un programa use la cámara a la vez.',
      pasos: [
        'Cierra Zoom, Teams, Meet, WhatsApp o la app de Cámara.',
        'Cierra las otras pestañas que tengan el kiosco abierto.',
        'Toca Reintentar.',
      ],
      reintentable: true,
      tecnico,
    };
  }
  return {
    clave: 'desconocido',
    titulo: 'No se pudo encender la cámara',
    causa: 'El navegador rechazó el acceso y no dijo por qué.',
    pasos: ['Toca Reintentar.', 'Si sigue igual, recarga la página.', 'Si persiste, abre el checador en Chrome actualizado.'],
    reintentable: true,
    tecnico,
  };
}

const ICONO = {
  inseguro: ShieldAlert, 'sin-api': CameraOff, bloqueada: Lock,
  'sin-camara': CameraOff, ocupada: Camera, config: Camera, desconocido: CameraOff,
} as const;

/**
 * El aviso. `tono="oscuro"` para el kiosco y campo (pantalla completa oscura),
 * `"claro"` para el enrolamiento dentro del ERP. Ambos pasan AA de contraste.
 * `role="alert"` lo anuncia en lector de pantalla al aparecer.
 */
export function CamaraAviso(
  { d, onReintentar, tono = 'claro' }:
  { d: DiagnosticoCamara; onReintentar?: () => void; tono?: 'claro' | 'oscuro' },
) {
  const Ico = ICONO[d.clave] || CameraOff;
  const oscuro = tono === 'oscuro';
  return (
    <div role="alert"
      className={`w-full max-w-md rounded-2xl border p-4 text-left ${oscuro
        ? 'bg-slate-800/80 border-slate-600 text-slate-100'
        : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
      <div className="flex items-start gap-3">
        <span className={`shrink-0 rounded-xl p-2 ${oscuro ? 'bg-slate-700 text-amber-300' : 'bg-rose-100 text-rose-700'}`}>
          <Ico size={22} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold leading-snug">{d.titulo}</h2>
          <p className={`text-sm mt-0.5 ${oscuro ? 'text-slate-300' : 'text-rose-800'}`}>{d.causa}</p>
        </div>
      </div>

      <ol className={`mt-3 space-y-1.5 text-sm list-decimal pl-8 ${oscuro ? 'text-slate-200' : 'text-rose-900'}`}>
        {d.pasos.map((p, i) => <li key={i}>{p}</li>)}
      </ol>

      {d.reintentable && onReintentar && (
        <button type="button" onClick={onReintentar}
          /* 44px de alto mínimo (WCAG 2.2 AA · objetivo táctil) y foco visible. */
          className={`mt-4 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl font-medium w-full
            focus:outline-none focus-visible:ring-4 transition active:scale-[.98] ${oscuro
              ? 'bg-emerald-500 text-slate-900 hover:bg-emerald-400 focus-visible:ring-emerald-300/50'
              : 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-300'}`}>
          <RefreshCw size={17} aria-hidden="true" /> Reintentar
        </button>
      )}

      {d.tecnico && (
        <details className={`mt-2 text-[11px] ${oscuro ? 'text-slate-400' : 'text-rose-700/80'}`}>
          <summary className="cursor-pointer min-h-[24px]">Detalle técnico (para soporte)</summary>
          <code className="block mt-1 break-words">{d.tecnico}</code>
        </details>
      )}
    </div>
  );
}
