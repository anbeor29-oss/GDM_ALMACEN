/**
 * BanderaMoneda — círculo con la bandera del país de la moneda del CFDI.
 *
 * POR QUÉ SVG Y NO EMOJI
 * El emoji 🇲🇽 no se dibuja en Windows —el sistema no trae las banderas de
 * región y sale "MX" en letras—, así que en las máquinas donde se factura no
 * serviría de nada. Un SVG pesa nada, siempre se ve igual y no depende de
 * nadie.
 *
 * LA ÚNICA IMAGEN ES EL ESCUDO NACIONAL
 * Y va servida por el propio sitio, no traída de fuera. El águila, la
 * serpiente, el nopal y el listón tienen una forma oficial: dibujarlos
 * "parecido" en SVG sería inventar un escudo que no es el escudo. Si el archivo
 * no está, la bandera sale con sus tres franjas y nada se ve roto.
 *
 * SE MUESTRA LA MONEDA, NO EL PAÍS DEL CLIENTE. Un cliente mexicano puede
 * facturarse en dólares; lo que hay que distinguir de un vistazo es en qué
 * moneda está el comprobante, que es lo que cambia el importe.
 */
import { useState } from 'react';

/**
 * Dónde vive el escudo nacional.
 *
 * Es un archivo del sitio, no un dibujo del código: se deja caer en
 * `frontend/public/escudo-mx.png` y aparece solo. Mientras no esté, la bandera
 * sale con sus tres franjas y nada se ve roto.
 *
 * Un archivo del propio sitio y no una URL externa: una imagen de fuera mete
 * una petición a un tercero por cada renglón de la tabla y se rompe el día que
 * esa dirección cambie.
 */
const ESCUDO_MX = `${import.meta.env.BASE_URL}escudo-mx.png`;

interface Props {
  /** Clave ISO del CFDI: MXN, USD, EUR… */
  moneda?: string | null;
  size?: number;
}

export function BanderaMoneda({ moneda, size = 18 }: Props) {
  /* Si el archivo del escudo no está, se deja de intentar: sin esto, cada
   * renglón de la tabla pediría una imagen que no existe. */
  const [escudoFallo, setEscudoFallo] = useState(false);
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
      case 'GBP':
        /* Union Jack: aspas blancas y rojas, y encima la cruz de San Jorge.
         * Las aspas rojas de San Patricio van centradas y no descentradas como
         * en la bandera real — a 18 px ese desfase no se ve y sí ensucia el
         * dibujo. Lo que identifica la bandera a este tamaño es la estructura
         * de aspas más cruz, y esa sí está completa. */
        return (
          <>
            <rect x="0" y="0" width={size} height={size} fill="#012169" />
            <g strokeLinecap="butt">
              <path d={`M0,0 L${size},${size} M${size},0 L0,${size}`}
                stroke="#FFFFFF" strokeWidth={size * 0.3} />
              <path d={`M0,0 L${size},${size} M${size},0 L0,${size}`}
                stroke="#C8102E" strokeWidth={size * 0.13} />
              <path d={`M${r},0 L${r},${size} M0,${r} L${size},${r}`}
                stroke="#FFFFFF" strokeWidth={size * 0.34} />
              <path d={`M${r},0 L${r},${size} M0,${r} L${size},${r}`}
                stroke="#C8102E" strokeWidth={size * 0.2} />
            </g>
          </>
        );
      case 'MXN':
        /* Verde, blanco y rojo, con el escudo ENCIMA si el archivo está puesto.
         *
         * El escudo no se dibuja a mano: el águila, la serpiente, el nopal y el
         * listón tricolor son un dibujo con forma oficial, y trazarlo "parecido"
         * en SVG sería inventar un escudo que no es el escudo. Lo que sí se
         * puede es USAR el de verdad.
         *
         * Se busca en /escudo-mx.png (o .svg, ver abajo). Si no está, se cae a
         * las tres franjas —que ya identifican la bandera sin ambigüedad— en vez
         * de dejar el hueco de una imagen rota. Por eso el onError. */
        return (
          <>
            <rect x="0" y="0" width={size / 3} height={size} fill="#006847" />
            <rect x={size / 3} y="0" width={size / 3} height={size} fill="#FFFFFF" />
            <rect x={(size * 2) / 3} y="0" width={size / 3} height={size} fill="#CE1126" />
            {!escudoFallo && (
              <image
                href={ESCUDO_MX}
                x={size * 0.28} y={size * 0.20}
                width={size * 0.44} height={size * 0.60}
                preserveAspectRatio="xMidYMid meet"
                onError={() => setEscudoFallo(true)}
              />
            )}
          </>
        );
      case 'JPY':
        /* Hinomaru: campo blanco y disco rojo centrado.
         *
         * Es la única del grupo que se dibuja COMPLETA a este tamaño — no hay
         * detalle que sacrificar—, así que el icono no es una aproximación de
         * la bandera: es la bandera.
         *
         * El disco va a 0.30 del lado. En la bandera oficial mide 3/5 del alto;
         * como aquí el cuadro se recorta en círculo, ese mismo 3/5 deja el aro
         * blanco que hace reconocible el dibujo. Más grande, el rojo toca el
         * borde y parece un punto sin bandera.
         *
         * El rojo es el #BC002D de la especificación y no un rojo cualquiera:
         * junto a la franja del peso (#CE1126) la diferencia se nota, y
         * distinguir pesos de yenes de un vistazo es justo el trabajo de este
         * icono. */
        return (
          <>
            <rect x="0" y="0" width={size} height={size} fill="#FFFFFF" />
            <circle cx={r} cy={r} r={size * 0.30} fill="#BC002D" />
          </>
        );
      default:
        /* CUALQUIER OTRA MONEDA: la clave, no una bandera.
         *
         * Antes el `default` caía en México, así que una factura en libras
         * mostraba la bandera mexicana — el peor error posible en un icono cuyo
         * único trabajo es decir en qué moneda está el documento. Dibujar de
         * memoria las banderas que faltan sería cambiar un dato falso por otro
         * aproximado; la clave ISO no se equivoca nunca. */
        return (
          <>
            <rect x="0" y="0" width={size} height={size} fill="#E2E8F0" />
            <text x={r} y={r} fill="#475569" fontSize={size * 0.42} fontWeight="700"
              textAnchor="middle" dominantBaseline="central"
              fontFamily="system-ui, sans-serif">
              {m.slice(0, 3)}
            </text>
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
