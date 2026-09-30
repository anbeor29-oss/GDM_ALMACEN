/**
 * Áreas de cumplimiento del IMSS y el INFONAVIT (cada organismo su pantalla, orden
 * SAT → IMSS → INFONAVIT). Reutilizan PanelOpinion:
 *   · IMSS      → un clic baja la opinión por RFC (SatGo `imssoc`, sin CIEC).
 *   · INFONAVIT → captura manual (abre el portal + Registrar el PDF).
 */
import { ShieldCheck, Home } from 'lucide-react';
import { PanelOpinion } from './PanelOpinion';

export function CumplimientoImssPage() {
  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldCheck size={22} className="text-primary" /> Opinión de Cumplimiento · IMSS
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Opinión de cumplimiento de obligaciones en materia de seguridad social. Se baja por RFC con SatGo
          (sin CIEC); la más reciente es la vigente.
        </p>
      </div>
      <PanelOpinion tipo="IMSS" />
    </div>
  );
}

export function CumplimientoInfonavitPage() {
  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Home size={22} className="text-primary" /> Constancia · INFONAVIT
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Cumplimiento en materia de aportaciones de vivienda (INFONAVIT) — captura manual: abre el portal,
          descarga tu constancia/opinión y súbela con «Registrar» (NEXO la lee sola).
        </p>
      </div>
      <PanelOpinion tipo="INFONAVIT" />
    </div>
  );
}
