/**
 * CampoFecha — una fecha que SIEMPRE se ve y se escribe DD/MM/AAAA.
 *
 * POR QUÉ NO ALCANZA CON <input type="date">
 * Ese control lo dibuja el navegador con el formato del SISTEMA, no el de la
 * página. En una máquina en inglés se ve "mm/dd/yyyy" y no hay atributo de CSS
 * ni de HTML que lo cambie: no es contenido de la página, es interfaz del
 * navegador. En nómina eso no es un detalle estético — capturar 03/07 como
 * "3 de julio" cuando el control lee "7 de marzo" mueve una fecha de ingreso,
 * y con ella la antigüedad, las vacaciones y el finiquito.
 *
 * CÓMO FUNCIONA
 * Es un campo de texto con máscara: se teclean números y las diagonales salen
 * solas. Hacia afuera el valor viaja en ISO (AAAA-MM-DD), que es como lo
 * guardan la base y el CFDI; la conversión ocurre aquí y en un solo lugar.
 *
 * El botón del calendario abre el selector nativo cuando el navegador lo
 * permite. Ese calendario sí es del navegador, pero elegir un día ahí no tiene
 * ambigüedad posible: se ve el mes escrito.
 *
 * LO QUE SE VALIDA
 * Que la fecha exista. "31/02/2026" son ocho dígitos correctos y una fecha que
 * no existe; sin esta comprobación se guardaría como 3 de marzo sin que nadie
 * lo notara.
 */
import { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';

interface Props {
  /** ISO AAAA-MM-DD, o cadena vacía. */
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  min?: string;
  max?: string;
  placeholder?: string;
}

/** "2026-08-19" → "19/08/2026" */
export function aTextoMx(iso?: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** "19/08/2026" → "2026-08-19", o '' si no es una fecha que exista. */
export function aIso(mx: string): string {
  const d = mx.replace(/\D/g, '');
  if (d.length !== 8) return '';
  const dia = Number(d.slice(0, 2));
  const mes = Number(d.slice(2, 4));
  const anio = Number(d.slice(4, 8));
  if (mes < 1 || mes > 12 || dia < 1 || anio < 1900 || anio > 2200) return '';

  /* Que el día EXISTA en ese mes. Un 31 de febrero pasa la validación de
   * rangos y el Date lo convierte en 3 de marzo sin protestar. */
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia) return '';

  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Va poniendo las diagonales conforme se teclea. */
function conDiagonales(texto: string): string {
  const d = texto.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

export function CampoFecha({
  value, onChange, disabled, className = '', id, min, max,
  placeholder = 'dd/mm/aaaa',
}: Props) {
  const [texto, setTexto] = useState(() => aTextoMx(value));
  const nativo = useRef<HTMLInputElement>(null);

  /* Si el valor cambia desde afuera —se cargó el expediente, lo llenó la CIF—
   * se refleja. No al revés: mientras se teclea manda lo tecleado, o el cursor
   * saltaría a cada dígito. */
  useEffect(() => {
    const desdeFuera = aTextoMx(value);
    if (aIso(texto) !== value) setTexto(desdeFuera);

  }, [value]);

  const escribir = (t: string) => {
    const puesto = conDiagonales(t);
    setTexto(puesto);
    const iso = aIso(puesto);
    /* Se avisa cuando la fecha está completa Y existe; y también al vaciar el
     * campo, que es como se borra una fecha opcional. */
    if (iso) onChange(iso);
    else if (puesto === '') onChange('');
  };

  const completaPeroInvalida = texto.replace(/\D/g, '').length === 8 && !aIso(texto);

  return (
    <div className={`relative ${className}`}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={texto}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={10}
        onChange={(e) => escribir(e.target.value)}
        onBlur={() => { if (!aIso(texto) && texto !== '') setTexto(aTextoMx(value)); }}
        className={`w-full border rounded-lg pl-3 pr-9 py-1.5 text-sm tabular-nums
          focus:ring-2 focus:ring-primary/30 focus:border-primary
          ${completaPeroInvalida ? 'border-rose-400 bg-rose-50' : ''}
          ${disabled ? 'bg-gray-50 text-gray-500' : ''}`}
      />

      {/* El calendario nativo, para quien prefiere apuntar. El input real está
          escondido detrás del botón; se le pide que muestre su selector. */}
      {!disabled && (
        <>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              const el = nativo.current;
              if (!el) return;
              if (typeof (el as any).showPicker === 'function') (el as any).showPicker();
              else el.click();
            }}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-gray-400
              hover:text-primary rounded"
            title="Abrir calendario"
          >
            <Calendar size={14} />
          </button>
          <input
            ref={nativo}
            type="date"
            tabIndex={-1}
            aria-hidden
            value={value || ''}
            min={min}
            max={max}
            onChange={(e) => { setTexto(aTextoMx(e.target.value)); onChange(e.target.value); }}
            className="absolute right-2 top-1/2 w-0 h-0 opacity-0 pointer-events-none"
          />
        </>
      )}

      {completaPeroInvalida && (
        <p className="text-[11px] text-rose-600 mt-0.5">Esa fecha no existe</p>
      )}
    </div>
  );
}

export default CampoFecha;
