/**
 * SelectorCuenta — combobox BUSCABLE del catálogo de cuentas, con opción de CREAR.
 *
 * Reemplaza a los `<select>` planos y a los `<datalist>` (que con el catálogo
 * entero filtran mal): aquí se escriben las primeras letras del **código o del
 * nombre** y la lista se acota en el acto; se elige con clic o con las flechas +
 * Enter. Si lo que buscas no existe, un renglón «＋ Crear cuenta» abre el alta
 * rápida (ModalCrearSubcuenta) y la deja asignada.
 *
 * Trabaja por CÓDIGO: `value` es el código y `onChange(codigo)` lo devuelve.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, PlusCircle, Check } from 'lucide-react';
import { ModalCrearSubcuenta } from '@/components/ModalCrearSubcuenta';

export interface CuentaOpc { id: string; codigo: string; nombre: string }

export function SelectorCuenta({
  cuentas, value, onChange, placeholder = 'Cuenta del catálogo', mascara,
  permitirCrear = true, className = '', autoFocus = false,
}: {
  cuentas: CuentaOpc[];
  value: string | null | undefined;
  onChange: (codigo: string) => void;
  placeholder?: string;
  mascara?: string;
  permitirCrear?: boolean;
  className?: string;
  autoFocus?: boolean;
}) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [busca, setBusca] = useState('');
  const [idx, setIdx] = useState(0);
  const [creando, setCreando] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const porCodigo = useMemo(() => new Map(cuentas.map((c) => [c.codigo, c])), [cuentas]);
  const sel = value ? porCodigo.get(value) : undefined;

  const t = busca.trim().toLowerCase();
  const filtradas = useMemo(() => {
    const base = !t ? cuentas
      : cuentas.filter((c) => `${c.codigo} ${c.nombre}`.toLowerCase().includes(t));
    return base.slice(0, 60);
  }, [cuentas, t]);

  const abrir = () => { setBusca(''); setIdx(0); setAbierto(true); };
  const elegir = (c: CuentaOpc) => { onChange(c.codigo); setAbierto(false); setBusca(''); };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!abierto && (e.key === 'ArrowDown' || e.key === 'Enter')) { abrir(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtradas.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (idx < filtradas.length) elegir(filtradas[idx]);
      else if (permitirCrear) setCreando(busca.trim());
    } else if (e.key === 'Escape') { setAbierto(false); }
  };

  // Lo que se ve en la caja: mientras se escribe, el texto; si no, la cuenta elegida.
  const textoCaja = abierto ? busca : (sel ? `${sel.codigo} — ${sel.nombre}` : '');

  return (
    <div className="relative min-w-0">
      <div className="relative">
        <input
          ref={inputRef}
          value={textoCaja}
          autoFocus={autoFocus}
          placeholder={sel && !abierto ? '' : placeholder}
          onFocus={abrir}
          onChange={(e) => { setBusca(e.target.value); setIdx(0); if (!abierto) setAbierto(true); }}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onKeyDown={onKey}
          className={`input py-1 text-sm w-full pr-6 ${value && !sel ? 'border-rose-400 text-rose-700' : ''} ${className}`}
        />
        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>

      {abierto && (
        <div className="absolute z-30 mt-1 w-full min-w-[16rem] max-h-64 overflow-y-auto bg-white border rounded-lg shadow-lg text-sm">
          {filtradas.length === 0 && !permitirCrear && (
            <div className="px-3 py-2 text-gray-400">Sin coincidencias.</div>
          )}
          {filtradas.map((c, i) => (
            <button key={c.id} type="button"
              onMouseDown={(e) => { e.preventDefault(); elegir(c); }}
              onMouseEnter={() => setIdx(i)}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${i === idx ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
              <span className="font-mono text-gray-700 shrink-0">{c.codigo}</span>
              <span className="text-gray-600 truncate">{c.nombre}</span>
              {value === c.codigo && <Check size={13} className="ml-auto text-emerald-500 shrink-0" />}
            </button>
          ))}
          {permitirCrear && (
            <button type="button"
              onMouseDown={(e) => { e.preventDefault(); setCreando(busca.trim()); setAbierto(false); }}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-1.5 border-t text-primary ${idx === filtradas.length ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
              <PlusCircle size={14} /> Crear cuenta{busca.trim() ? ` «${busca.trim()}»` : ''}
            </button>
          )}
        </div>
      )}

      {creando !== null && (
        <ModalCrearSubcuenta
          codigo={/^[\d.-]+$/.test(creando) ? creando : ''}
          sugerirNombre={/^[\d.-]+$/.test(creando) ? '' : creando}
          mascara={mascara}
          onHecho={(cod) => {
            setCreando(null);
            qc.invalidateQueries({ queryKey: ['ctas-mov'] });
            qc.invalidateQueries({ queryKey: ['ctas-todas'] });
            onChange(cod);
          }}
          onCerrar={() => setCreando(null)}
        />
      )}
    </div>
  );
}

export default SelectorCuenta;
