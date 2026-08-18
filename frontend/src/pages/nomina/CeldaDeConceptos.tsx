/**
 * CeldaDeConceptos — el importe de la rejilla, con lo que hay detrás.
 *
 * DOS GESTOS, DOS PROPÓSITOS
 *   · Pasar el mouse  → ver CÓMO se integra. Es lo que uno hace cuando el
 *     número no cuadra, y no debería costar un clic ni cambiar de pantalla.
 *   · Doble clic      → capturar. Es un gesto deliberado: un clic sencillo se
 *     da sin querer al recorrer la rejilla, y abrir un formulario de captura
 *     por accidente en el renglón equivocado es como se meten importes donde
 *     no van.
 *
 * EL DESGLOSE SALE DEL CÁLCULO, NO SE ARMA AQUÍ
 * Las percepciones y deducciones que se enseñan son las que devolvió el motor,
 * con su gravado y su exento ya calculados según el Art. 93. Rearmar el
 * desglose en la pantalla garantizaría que un día diga algo distinto de lo que
 * se va a timbrar.
 */
import { useState } from 'react';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

interface Props {
  /** El total que se pinta en la celda. */
  importe: number;
  /** Renglones del desglose: percepciones o deducciones del motor. */
  detalle: Array<{ clave: string; concepto: string; importe: number; gravado?: number; exento?: number }>;
  /** Cuántos de esos renglones se capturaron a mano en esta corrida. */
  capturados?: number;
  titulo: string;
  color?: 'normal' | 'rojo';
  onDobleClic?: () => void;
}

export function CeldaDeConceptos({
  importe, detalle, capturados = 0, titulo, color = 'normal', onDobleClic,
}: Props) {
  const [abierto, setAbierto] = useState(false);

  return (
    <td
      className={`px-2 py-1 text-right relative whitespace-nowrap select-none
        ${onDobleClic ? 'cursor-cell hover:bg-violet-50' : ''}`}
      onDoubleClick={onDobleClic}
      onMouseEnter={() => setAbierto(true)}
      onMouseLeave={() => setAbierto(false)}
      title={onDobleClic ? 'Doble clic para capturar conceptos' : undefined}
    >
      <span className={color === 'rojo' ? 'text-rose-700' : ''}>
        {importe > 0 ? money(importe) : '—'}
      </span>
      {/* Una marca discreta cuando el renglón trae captura manual: sin ella no
          habría forma de distinguir un importe calculado de uno tecleado. */}
      {capturados > 0 && (
        <span className="ml-1 text-[10px] text-violet-600 align-super">+{capturados}</span>
      )}

      {abierto && detalle.length > 0 && (
        <div className="absolute right-2 top-full z-30 mt-0.5 w-72 bg-white border border-slate-300 rounded-lg shadow-lg p-2 text-left">
          <p className="text-[11px] font-semibold text-slate-600 mb-1">{titulo}</p>
          <table className="w-full text-[11px]">
            <tbody>
              {detalle.map((d, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-0.5 pr-1 font-mono text-slate-400">{d.clave}</td>
                  <td className="py-0.5 pr-1 text-slate-700">
                    {d.concepto}
                    {/* El reparto gravado/exento sólo tiene sentido en las
                        percepciones, y sólo cuando de verdad hay exención: en un
                        sueldo normal repetir "gravado 3,500 · exento 0" es ruido. */}
                    {d.exento !== undefined && Number(d.exento) > 0 && (
                      <span className="block text-slate-400">
                        gravado {money(d.gravado)} · exento {money(d.exento)}
                      </span>
                    )}
                  </td>
                  <td className="py-0.5 text-right tabular-nums text-slate-800">
                    {money(d.importe)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-semibold">
                <td colSpan={2} className="pt-1 text-slate-600">Total</td>
                <td className="pt-1 text-right tabular-nums">{money(importe)}</td>
              </tr>
            </tfoot>
          </table>
          {onDobleClic && (
            <p className="text-[10px] text-slate-400 mt-1">Doble clic para capturar</p>
          )}
        </div>
      )}
    </td>
  );
}

export default CeldaDeConceptos;
