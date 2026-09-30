/**
 * Cumplimiento IMSS / INFONAVIT — una pantalla con pestañas por organismo
 * (orden general: SAT → IMSS → INFONAVIT). Reutiliza PanelOpinion:
 *   · IMSS      → un clic baja la opinión por RFC (sin CIEC).
 *   · INFONAVIT → captura manual (abre el portal + Registrar el PDF).
 */
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { PanelOpinion } from './PanelOpinion';
import { claseOpcion } from '@/utils/coloresOpciones';

const TABS: Array<[string, string]> = [
  ['IMSS', 'IMSS'],
  ['INFONAVIT', 'INFONAVIT'],
];

export function CumplimientoOrganismosPage() {
  const [tab, setTab] = useState('IMSS');
  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldCheck size={22} className="text-primary" /> Cumplimiento IMSS / INFONAVIT
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Opinión de cumplimiento del IMSS (por RFC, sin CIEC) y constancia del INFONAVIT (captura manual);
          la más reciente por organismo es la vigente.
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {TABS.map(([k, nombre], i) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 ${claseOpcion(i, tab === k)}`}>{nombre}</button>
        ))}
      </div>

      {tab === 'IMSS' && <PanelOpinion tipo="IMSS" />}
      {tab === 'INFONAVIT' && <PanelOpinion tipo="INFONAVIT" />}
    </div>
  );
}

export default CumplimientoOrganismosPage;
