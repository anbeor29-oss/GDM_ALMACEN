/**
 * AvisoGlobal — pinta el diálogo CENTRADO propio que reemplaza a los nativos del
 * navegador (alert/confirm con «JavaScript de "https://…" dice»). Lee la cola de
 * `utils/avisos` (el override de `window.alert` ya se instala al importar ese módulo;
 * los «¿sí/no?» entran por `confirmar()`). Se monta UNA vez en App.
 *
 * Sólo muestra el de enfrente de la cola: «Aceptar» para avisos, «Aceptar»/«Cancelar»
 * para confirmaciones. Enter = Aceptar; Escape = Cancelar (confirm) o cerrar (aviso).
 */
import { useEffect, useState } from 'react';
import { _suscribir, _frente, _cerrar } from '@/utils/avisos';

export function AvisoGlobal() {
  const [, forzar] = useState(0);
  useEffect(() => _suscribir(() => forzar((n) => n + 1)), []);

  const actual = _frente();
  useEffect(() => {
    if (!actual) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); _cerrar(true); }
      else if (e.key === 'Escape') { e.preventDefault(); _cerrar(actual.tipo === 'confirm' ? false : true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actual]);

  if (!actual) return null;
  const esConfirm = actual.tipo === 'confirm';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
      <div role="alertdialog" aria-modal="true"
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 text-center">
        <p className="text-[15px] text-gray-800 whitespace-pre-line leading-relaxed">{actual.msg}</p>
        <div className="mt-5 flex items-center justify-center gap-2">
          {esConfirm && (
            <button onClick={() => _cerrar(false)}
              className="px-6 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300">
              Cancelar
            </button>
          )}
          <button autoFocus onClick={() => _cerrar(true)}
            className="px-7 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2">
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}

export default AvisoGlobal;
