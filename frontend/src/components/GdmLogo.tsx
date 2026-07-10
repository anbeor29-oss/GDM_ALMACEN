/**
 * GdmLogo — logo corporativo oficial de GDM High Consulting México.
 *
 * Usa la imagen real del monograma (extraída del sitio corporativo
 * hcgm.com.mx y recortada al círculo, 256×256 px) en vez de una
 * recreación dibujada. Se muestra con rounded-full para que el fondo
 * azul quede como medallón circular.
 *
 * La URL respeta el base del build (/ en Render, /erp/ en hosting).
 */

const LOGO_URL = `${import.meta.env.BASE_URL}gdm-logo.png`;

export function GdmLogo({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src={LOGO_URL}
      width={size}
      height={size}
      alt="GDM High Consulting México"
      className={`rounded-full object-cover select-none ${className}`}
      draggable={false}
    />
  );
}

export default GdmLogo;
