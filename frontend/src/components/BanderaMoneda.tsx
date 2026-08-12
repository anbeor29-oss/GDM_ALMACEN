/**
 * BanderaMoneda — círculo con la bandera del país de la moneda del CFDI.
 *
 * POR QUÉ SVG Y NO EMOJI NI IMÁGENES
 * El emoji 🇲🇽 no se dibuja en Windows —el sistema no trae las banderas de
 * región y sale "MX" en letras—, así que en las máquinas donde se factura no
 * serviría de nada. Y una imagen externa mete una petición por renglón y se
 * rompe el día que cambie la URL. Un SVG de tres franjas pesa nada, siempre se
 * ve igual y no depende de nadie.
 *
 * SE MUESTRA LA MONEDA, NO EL PAÍS DEL CLIENTE. Un cliente mexicano puede
 * facturarse en dólares; lo que hay que distinguir de un vistazo es en qué
 * moneda está el comprobante, que es lo que cambia el importe.
 */

interface Props {
  /** Clave ISO del CFDI: MXN, USD, EUR… */
  moneda?: string | null;
  size?: number;
}

export function BanderaMoneda({ moneda, size = 18 }: Props) {
  const m = String(moneda || 'MXN').toUpperCase();
  const r = size / 2;

  /* `clipPath` con id único por moneda: dos SVG con el mismo id en la misma
   * página hacen que el segundo herede el recorte del primero, y las banderas
   * de los renglones de abajo salen cortadas. */
  const clipId = `bandera-${m}`;

  const contenido = () => {
    switch (m) {
      case 'USD':
        /* Trece franjas y el cantón azul. A 18 px no se distinguen las
         * estrellas, así que no se dibujan: cargarlas sería peso sin lectura. */
        return (
          <>
            {Array.from({ length: 13 }).map((_, i) => (
              <rect key={i} x="0" y={(i * size) / 13} width={size} height={size / 13}
                fill={i % 2 === 0 ? '#B22234' : '#FFFFFF'} />
            ))}
            <rect x="0" y="0" width={size * 0.5} height={(size / 13) * 7} fill="#3C3B6E" />
          </>
        );
      case 'EUR':
        /* Doce estrellas en círculo sobre azul. Se dibujan como puntos: a este
         * tamaño una estrella de cinco puntas es una mancha. */
        return (
          <>
            <rect x="0" y="0" width={size} height={size} fill="#003399" />
            {Array.from({ length: 12 }).map((_, i) => {
              const a = (i * Math.PI) / 6 - Math.PI / 2;
              return (
                <circle key={i} r={size * 0.055} fill="#FFCC00"
                  cx={r + Math.cos(a) * r * 0.62} cy={r + Math.sin(a) * r * 0.62} />
              );
            })}
          </>
        );
      case 'MXN':
      default:
        /* Verde, blanco y rojo. El escudo no se dibuja: a 18 px sería un
         * borrón, y las tres franjas ya identifican la bandera sin ambigüedad. */
        return (
          <>
            <rect x="0" y="0" width={size / 3} height={size} fill="#006847" />
            <rect x={size / 3} y="0" width={size / 3} height={size} fill="#FFFFFF" />
            <rect x={(size * 2) / 3} y="0" width={size / 3} height={size} fill="#CE1126" />
          </>
        );
    }
  };

  return (
    <span
      title={`Moneda: ${m}`}
      className="inline-flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Moneda ${m}`}>
        <defs>
          <clipPath id={clipId}><circle cx={r} cy={r} r={r} /></clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>{contenido()}</g>
        {/* Aro tenue: sobre fondo blanco, la franja blanca de México y el
            blanco de Estados Unidos se confundirían con la fila. */}
        <circle cx={r} cy={r} r={r - 0.5} fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="1" />
      </svg>
    </span>
  );
}

export default BanderaMoneda;
