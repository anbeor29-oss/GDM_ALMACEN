/**
 * GdmLogo — logo del producto GDM NEXO (emblema plateado sobre azul, 256×256 px,
 * recortado del arte oficial de NEXO). Se muestra con rounded-full para que quede
 * como medallón circular. Es el logo visible en login, landing, registro, sidebar
 * y el favicon (todos leen `gdm-logo.png`, así que el archivo es el único punto de
 * cambio).
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
      // El alt va en minúsculas A PROPÓSITO, aunque la marca visible vaya en
      // mayúsculas: el alt no se ve, se escucha. Varios lectores de pantalla
      // toman una palabra toda en mayúsculas por sigla y la deletrean.
      alt="GDM NEXO"
      className={`rounded-full object-cover select-none ${className}`}
      draggable={false}
    />
  );
}

export default GdmLogo;
