/**
 * Selector de cuenta contable DEL CATÁLOGO, compartido por las tres asignaciones
 * automáticas (ventas 401, compras 115/601, conceptos de nómina).
 *
 * Antes eran inputs de texto libre: se podía "asignar" un código que no existe
 * (p. ej. 216.01) y la póliza salía sin cuadrar porque ese abono no se asentaba.
 * Aquí el código se VALIDA contra el catálogo: verde + nombre si existe, rojo
 * "no existe" si no. El combo es ancho para ver el nombre completo al elegir.
 *
 * El `datalist` con las opciones lo pinta el padre UNA vez (por pantalla) y se
 * pasa su `listId` + el mapa código→nombre; así no se duplican cientos de
 * opciones por renglón.
 */
import { useEffect, useState } from 'react';
import { Check, AlertTriangle, PlusCircle } from 'lucide-react';

export function CuentaPicker({
  listId, nombreCta, value, onSave, onCrear, placeholder, ancho = 'w-60',
}: {
  listId: string;
  nombreCta: Map<string, string>;
  value: string | null | undefined;
  onSave: (codigo: string) => void;
  /** Si se pasa, cuando el código NO existe aparece un botón para crearlo en el acto. */
  onCrear?: (codigo: string) => void;
  placeholder?: string;
  ancho?: string;
}) {
  const [val, setVal] = useState(value || '');
  useEffect(() => { setVal(value || ''); }, [value]);

  const existe = !!val && nombreCta.has(val);
  const guardado = (val || '') === (value || '');

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <input
        list={listId}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => { if ((val || '') !== (value || '')) onSave(val); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder={placeholder || 'Cuenta del catálogo'}
        className={`input py-1 text-sm font-mono ${ancho} ${val && !existe ? 'border-rose-400 text-rose-700' : ''}`}
      />
      {existe ? (
        <span className="text-xs text-gray-600 truncate max-w-[16rem] flex items-center gap-1"
          title={nombreCta.get(val)}>
          {guardado && <Check size={13} className="text-emerald-500 shrink-0" />}
          {nombreCta.get(val)}
        </span>
      ) : val ? (
        <span className="text-xs text-rose-600 whitespace-nowrap flex items-center gap-1">
          <AlertTriangle size={12} className="shrink-0" /> no existe
          {onCrear && (
            <button onClick={() => onCrear(val)} title="Crear esta cuenta y asignarla"
              className="ml-1 inline-flex items-center gap-1 text-primary hover:underline">
              <PlusCircle size={12} /> crear
            </button>
          )}
        </span>
      ) : null}
    </div>
  );
}

export default CuentaPicker;
