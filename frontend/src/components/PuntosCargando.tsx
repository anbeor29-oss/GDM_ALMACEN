/**
 * PuntosCargando — los "4 puntitos" de avance (estilo Claude) para estados de carga
 * y descarga. Heredan el color del texto (bg-current) y rebotan en secuencia.
 * Se usa en el hub de Cumplimiento fiscal (Opinión, CIF, Notificaciones,
 * Declaraciones, Información Fiscal) y en PanelOpinion.
 */
export function PuntosCargando({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} role="status" aria-label="Cargando">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.9s' }} />
      ))}
    </span>
  );
}

export default PuntosCargando;
