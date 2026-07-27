/**
 * Emoji3D — emoji con sombra proyectada para dar sensación de relieve.
 *
 * Reemplaza los iconos de línea (Lucide) en menús y botones donde se busca
 * un look más cálido y reconocible de un vistazo. El `drop-shadow` doble
 * (una sombra dura corta + un halo suave) es lo que produce el efecto 3D
 * sin necesidad de imágenes.
 *
 * `translateZ(0)` fuerza compositing por GPU: sin él, Chrome re-rasteriza
 * el filtro en cada repaint del sidebar y se nota el parpadeo al navegar.
 */
export function Emoji3D({ e, size = 'xl' }: {
  e: string;
  /** `xl` para menús (20px), `base` para submenús y botones de tabla (16px). */
  size?: 'xl' | 'base' | 'lg';
}) {
  const cls = size === 'base' ? 'text-base' : size === 'lg' ? 'text-lg' : 'text-xl';
  return (
    <span
      className={`${cls} leading-none`}
      style={{
        filter: 'drop-shadow(0 1.5px 1px rgba(0,0,0,0.15)) drop-shadow(0 0 1px rgba(0,0,0,0.1))',
        display: 'inline-block',
        transform: 'translateZ(0)',
      }}
    >{e}</span>
  );
}
