/**
 * ComboConAlta — elegir de una lista, o agregar lo que no esté.
 *
 * POR QUÉ NO BASTA UN CAMPO DE TEXTO
 * Puesto y departamento se venían capturando a mano, y ahí es donde nacen
 * "PRODUCCION", "Producción" y "produccion " como tres departamentos distintos.
 * Nadie lo nota hasta que un reporte por departamento sale partido en tres y no
 * cuadra con la plantilla.
 *
 * POR QUÉ TAMPOCO BASTA UN SELECT
 * Un catálogo cerrado detiene la captura el día que entra alguien con un puesto
 * nuevo — que es el día que hay prisa. Por eso el "+ Agregar" está aquí adentro
 * y no en otra pantalla: se escribe el nombre, se guarda en el catálogo y queda
 * elegido, sin salir del expediente.
 *
 * LO NUEVO SE COMPARTE
 * Lo que se agrega entra al catálogo de la empresa, así que el siguiente
 * expediente ya lo encuentra en la lista. Esa es la diferencia entre un catálogo
 * y un campo de texto con memoria.
 */
import { useState } from 'react';
import { Plus, Check, X } from 'lucide-react';

interface Props {
  label: string;
  /** Lo que hay en el catálogo. */
  opciones: Array<{ id?: string; nombre: string }>;
  valor: string;
  onChange: (v: string) => void;
  /** Da de alta en el catálogo y devuelve el nombre guardado. */
  onAgregar: (nombre: string) => Promise<string>;
  disabled?: boolean;
  className?: string;
  ancho?: string;
}

export function ComboConAlta({
  label, opciones, valor, onChange, onAgregar, disabled, className = '', ancho = '',
}: Props) {
  const [agregando, setAgregando] = useState(false);
  const [nuevo, setNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const campo = 'w-full border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary';

  /* El valor que trae el expediente puede no estar en el catálogo: viene de un
   * XML o de una captura vieja. Se agrega a la lista para que no desaparezca
   * del selector al abrir la ficha — perderlo en silencio sería peor que
   * tenerlo desalineado. */
  const enCatalogo = opciones.some(
    (o) => o.nombre.trim().toUpperCase() === String(valor || '').trim().toUpperCase()
  );
  const lista = !enCatalogo && valor
    ? [{ nombre: valor }, ...opciones]
    : opciones;

  const agregar = async () => {
    const n = nuevo.trim();
    if (!n) { setError('Escribe el nombre'); return; }
    setGuardando(true); setError('');
    try {
      const guardado = await onAgregar(n);
      onChange(guardado);
      setAgregando(false);
      setNuevo('');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo agregar');
    } finally {
      setGuardando(false);
    }
  };

  if (agregando) {
    return (
      <div className={ancho}>
        <label className="block text-xs font-medium text-gray-600 mb-1">{label} — nuevo</label>
        <div className="flex gap-1">
          <input
            autoFocus
            className={campo}
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); agregar(); }
              if (e.key === 'Escape') { setAgregando(false); setNuevo(''); setError(''); }
            }}
            placeholder={`Nombre del ${label.toLowerCase()}`}
          />
          <button type="button" onClick={agregar} disabled={guardando}
            title="Guardar en el catálogo"
            className="px-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            <Check size={15} />
          </button>
          <button type="button" onClick={() => { setAgregando(false); setNuevo(''); setError(''); }}
            title="Cancelar"
            className="px-2 rounded-lg border text-gray-500 hover:bg-gray-50">
            <X size={15} />
          </button>
        </div>
        {error && <p className="text-[11px] text-rose-600 mt-1">{error}</p>}
      </div>
    );
  }

  return (
    <div className={ancho}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="flex gap-1">
        <select
          className={`${campo} ${className}`}
          value={valor || ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— sin especificar —</option>
          {lista.map((o) => (
            <option key={o.id || o.nombre} value={o.nombre}>{o.nombre}</option>
          ))}
        </select>
        {!disabled && (
          <button type="button" onClick={() => setAgregando(true)}
            title={`Agregar un ${label.toLowerCase()} que no esté en la lista`}
            className="px-2 rounded-lg border text-gray-500 hover:bg-gray-50 hover:text-primary shrink-0">
            <Plus size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

export default ComboConAlta;
