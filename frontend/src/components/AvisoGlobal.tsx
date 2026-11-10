/**
 * AvisoGlobal — reemplaza el `window.alert` nativo del navegador (el que muestra el feo
 * encabezado «JavaScript de "https://…" dice») por un recuadro PROPIO centrado en la
 * página, con sólo el mensaje y un botón «Aceptar».
 *
 * Se monta UNA vez en la raíz de la app (App.tsx). Al montar, guarda el `alert` nativo y
 * lo sustituye; así TODOS los `alert(...)` del sistema (los avisos de «tarea terminada»,
 * etc.) salen con este estilo sin tocar cada pantalla. Encola si llegan varios y los
 * muestra de uno en uno. No toca `confirm()` (ese sí necesita respuesta inmediata).
 */
import { useEffect, useRef, useState } from 'react';

export function AvisoGlobal() {
  const [cola, setCola] = useState<string[]>([]);
  const nativa = useRef<typeof window.alert | null>(null);

  useEffect(() => {
    nativa.current = window.alert;
    window.alert = (msg?: any) => setCola((c) => [...c, msg == null ? '' : String(msg)]);
    return () => { if (nativa.current) window.alert = nativa.current; };
  }, []);

  const cerrar = () => setCola((c) => c.slice(1));

  useEffect(() => {
    if (!cola.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setCola((c) => c.slice(1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cola.length]);

  if (!cola.length) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
      <div role="alertdialog" aria-modal="true"
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 text-center">
        <p className="text-[15px] text-gray-800 whitespace-pre-line leading-relaxed">{cola[0]}</p>
        <button autoFocus onClick={cerrar}
          className="mt-5 inline-flex items-center justify-center px-7 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2">
          Aceptar
        </button>
      </div>
    </div>
  );
}

export default AvisoGlobal;
