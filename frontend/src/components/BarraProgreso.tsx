/**
 * Barra de avance 0–100% para cargas/importaciones. Muestra el % real de la SUBIDA
 * (onUploadProgress de axios) y, cuando ésta llega a 100% pero el servidor sigue
 * procesando, una barra indeterminada «Procesando…» para que se vea que trabaja.
 */
export function BarraProgreso({ pct, procesando, etiqueta }: {
  pct: number; procesando?: boolean; etiqueta?: string;
}) {
  const subiendo = pct < 100;
  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-[11px] text-gray-500 mb-0.5">
        <span>{etiqueta || (subiendo ? 'Subiendo archivo…' : (procesando ? 'Procesando en el servidor…' : 'Listo'))}</span>
        {subiendo && <span className="tabular-nums">{pct}%</span>}
      </div>
      <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
        {subiendo ? (
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        ) : procesando ? (
          <div className="h-full rounded-full bg-sky-400 w-full animate-pulse" />
        ) : (
          <div className="h-full rounded-full bg-emerald-500 w-full" />
        )}
      </div>
    </div>
  );
}

export default BarraProgreso;
