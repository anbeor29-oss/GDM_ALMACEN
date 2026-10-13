/**
 * Validar CFDI — pantalla propia dentro de Contabilidad → Reportes (entre «SAT» y
 * «Cédulas fiscales»). Comprueba el estatus de un comprobante ante el SAT
 * (vigente / cancelado) subiendo el XML: rellena los campos solo y basta dar clic
 * en Validar. Sólo usa el RFC de la empresa, no requiere CIEC.
 *
 * No duplica motor: reusa el MISMO panel `PanelValidarCfdi` que ya se abría como
 * ventana emergente desde el Panel fiscal (consulta vía SatGo `satgoValidarCfdi`).
 */
import { BadgeCheck } from 'lucide-react';
import { PanelValidarCfdi } from './CumplimientoPaneles';

export function ValidarCfdiPage() {
  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <BadgeCheck size={20} className="text-primary" /> Validar CFDI
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Verifica ante el SAT si un comprobante está vigente o cancelado. Sube el XML y da clic en Validar.
        </p>
      </div>
      <PanelValidarCfdi />
    </div>
  );
}

export default ValidarCfdiPage;
