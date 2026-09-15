/**
 * Selector de cuenta contable DEL CATÁLOGO, compartido por las tres asignaciones
 * automáticas (ventas 401, compras 115/601, conceptos de nómina).
 *
 * Ahora es un envoltorio delgado sobre `SelectorCuenta` (combobox BUSCABLE por
 * código o nombre, con «Crear cuenta»): mantiene la misma interfaz que ya usaban
 * las pantallas —`nombreCta` (mapa código→nombre), `value` (código), `onSave`,
 * `onCrear`— para no tocar a sus consumidores. El `listId` del datalist ya no se
 * usa (se conserva por compatibilidad). El alta se delega en el padre vía
 * `onCrear`, que abre su propio ModalCrearSubcuenta con el contexto del renglón.
 */
import { useMemo } from 'react';
import { SelectorCuenta, type CuentaOpc } from '@/components/SelectorCuenta';

export function CuentaPicker({
  nombreCta, value, onSave, onCrear, placeholder, ancho = 'w-60',
}: {
  /** @deprecated ya no se usa (antes era el id del datalist). */
  listId?: string;
  nombreCta: Map<string, string>;
  value: string | null | undefined;
  onSave: (codigo: string) => void;
  /** Si se pasa, «Crear cuenta» delega en el padre (con el texto escrito). */
  onCrear?: (codigo: string) => void;
  placeholder?: string;
  ancho?: string;
}) {
  const cuentas: CuentaOpc[] = useMemo(
    () => [...nombreCta.entries()].map(([codigo, nombre]) => ({ id: codigo, codigo, nombre })),
    [nombreCta]);

  return (
    <div className={`min-w-0 ${ancho}`}>
      <SelectorCuenta
        cuentas={cuentas}
        value={value}
        onChange={onSave}
        placeholder={placeholder || 'Cuenta del catálogo'}
        permitirCrear={!!onCrear}
        onCrearExterno={onCrear ? (txt) => onCrear(txt) : undefined}
      />
    </div>
  );
}

export default CuentaPicker;
