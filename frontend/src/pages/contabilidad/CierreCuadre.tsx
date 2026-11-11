/**
 * CierreCuadre — junta en UNA pantalla (pestañas) el «Cierre del ejercicio» y el «Cuadre
 * contable» (antes dos items del submenú de Contabilidad). Así el menú queda más corto y
 * ambas viven bajo «Cierre del ejercicio». Cada pestaña renderiza su página tal cual.
 */
import { useState } from 'react';
import { CierreEjercicioPage } from './CierreEjercicio';
import { ValidacionContablePage } from './ValidacionContable';
import { claseOpcion } from '@/utils/coloresOpciones';

export function CierreCuadrePage() {
  const [tab, setTab] = useState<'cierre' | 'cuadre'>('cierre');
  const TABS: Array<['cierre' | 'cuadre', string]> = [
    ['cierre', 'Cierre del ejercicio'],
    ['cuadre', 'Cuadre contable'],
  ];
  return (
    <div>
      <div className="px-6 pt-6 flex flex-wrap gap-1.5">
        {TABS.map(([k, label], i) => (
          <button key={k} onClick={() => setTab(k)} className={claseOpcion(i, tab === k)}>{label}</button>
        ))}
      </div>
      {tab === 'cierre' ? <CierreEjercicioPage /> : <ValidacionContablePage />}
    </div>
  );
}

export default CierreCuadrePage;
