/**
 * BotonSalirPantalla — la salida de una pantalla completa (kiosco, campo).
 *
 * POR QUÉ EXISTE
 * El kiosco y el modo campo ocupaban TODA la pantalla sin un solo control para
 * volver: quien entraba quedaba atrapado y tenía que cerrar la pestaña. Es la
 * heurística #3 de Nielsen (control y libertad del usuario) y, en una tableta
 * montada en la pared, la diferencia entre usable y no usable.
 *
 * DECISIONES
 * · Arriba a la IZQUIERDA: es donde se busca «atrás» (convención del sistema y
 *   de toda la web). Ley de Fitts: esquina = objetivo grande y fácil.
 * · 44×44 px mínimo, el objetivo táctil de WCAG 2.2 AA — se toca con el pulgar
 *   y con guante, que es como se usa un checador en piso.
 * · `confirmar`: en el KIOSCO la salida va con confirmación, porque el kiosco es
 *   un equipo compartido y cualquiera que pase no debe poder sacarlo del modo de
 *   registro con un toque accidental. En campo (celular propio) no estorba.
 * · Contraste AA sobre fondo oscuro y anillo de foco visible para teclado.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export function BotonSalirPantalla(
  { a = '/checador', etiqueta = 'Salir', confirmar = false }:
  { a?: string; etiqueta?: string; confirmar?: boolean },
) {
  const navigate = useNavigate();
  const [pidiendo, setPidiendo] = useState(false);

  const salir = () => navigate(a);

  if (pidiendo) {
    return (
      <div role="dialog" aria-modal="true" aria-label="Confirmar salida"
        className="fixed top-3 left-3 z-50 flex items-center gap-2 rounded-2xl bg-slate-800 border border-slate-600 p-2 shadow-xl">
        <span className="text-slate-100 text-sm px-1">¿Salir del kiosco?</span>
        <button type="button" onClick={salir} autoFocus
          className="min-h-[44px] px-4 rounded-xl bg-emerald-500 text-slate-900 font-semibold
            focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/50 hover:bg-emerald-400 transition">
          Sí, salir
        </button>
        <button type="button" onClick={() => setPidiendo(false)}
          className="min-h-[44px] px-4 rounded-xl bg-slate-700 text-slate-100
            focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-400/50 hover:bg-slate-600 transition">
          Seguir aquí
        </button>
      </div>
    );
  }

  return (
    <button type="button" onClick={() => (confirmar ? setPidiendo(true) : salir())}
      aria-label={`${etiqueta} y volver al checador`}
      className="fixed top-3 left-3 z-50 inline-flex items-center gap-2 min-h-[44px] min-w-[44px] px-4
        rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-slate-100 backdrop-blur
        border border-slate-600 shadow-lg transition active:scale-[.97]
        focus:outline-none focus-visible:ring-4 focus-visible:ring-sky-400/60">
      <ArrowLeft size={18} aria-hidden="true" />
      <span className="text-sm font-medium">{etiqueta}</span>
    </button>
  );
}
