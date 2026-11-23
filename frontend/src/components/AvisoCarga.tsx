/**
 * AvisoCarga — lo que se enseña cuando una consulta FALLA.
 *
 * POR QUÉ EXISTE
 * Las pantallas hacían `if (!datos) return <p>Cargando…</p>`: si la petición
 * fallaba, el estado nunca se llenaba y la pestaña se quedaba en «Cargando…»
 * para siempre, sin decir nada. Las tablas eran peores: enseñaban «Aún no hay
 * kioscos» o «Sin registros» —afirmando que no hay datos— cuando lo que pasó
 * es que el servidor no contestó.
 *
 * Tres cosas, siempre: QUÉ falló, POR QUÉ (el mensaje del servidor) y un botón
 * para REINTENTAR sin recargar la página (44 px, con foco visible).
 */
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  /** El error de react-query / axios. */
  error?: any;
  /** Qué no se pudo cargar, en palabras: «la configuración del checador». */
  que: string;
  onReintentar: () => void;
  /** Dentro de una celda de tabla, sin el marco. */
  plano?: boolean;
}

export function AvisoCarga({ error, que, onReintentar, plano }: Props) {
  const detalle = error?.response?.data?.message || error?.message || 'El servidor no respondió.';
  return (
    <div role="alert"
      className={plano ? 'text-left' : 'bg-rose-50 border border-rose-200 text-rose-900 rounded-lg p-4 max-w-xl'}>
      <p className="font-semibold text-rose-900 flex items-center gap-1.5">
        <AlertTriangle size={16} aria-hidden="true" /> No se pudo cargar {que}.
      </p>
      <p className="text-sm text-rose-800 mt-0.5">{detalle}</p>
      <button type="button" onClick={onReintentar}
        className="mt-3 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg
          bg-rose-600 text-white font-medium transition active:scale-[.97] hover:bg-rose-700
          focus:outline-none focus-visible:ring-4 focus-visible:ring-rose-300">
        <RotateCcw size={16} aria-hidden="true" /> Reintentar
      </button>
    </div>
  );
}

export default AvisoCarga;
