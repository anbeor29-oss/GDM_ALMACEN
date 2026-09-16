/**
 * XmlDelSat — TODO el XML del SAT en UNA sola pantalla, con pestañas arriba
 * (mismo patrón que Tesorería), no como un menú que se despliega hacia abajo.
 *
 *   Descarga    → "XML del SAT": pedir al SAT, cupo del día, trabajos.
 *   Emitidos    → la tabla de emitidos (con su representación impresa).
 *   Recibidos   → la tabla de recibidos (ficha de metadatos; el SAT no da su XML).
 *   Calendario  → cobertura por día (emitidos + recibidos) y llenar huecos.
 *
 * Las pestañas siguen siendo rutas reales (/xml-sat, /xml-sat/emitidos, …) para
 * que los enlaces directos y el botón «atrás» del navegador funcionen; el sidebar
 * ya sólo trae una entrada «XML» que cae en la de Descarga.
 */
import { useLocation, useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { XmlRecibidos } from '@/components/XmlRecibidos';
import { ProgramacionSat } from '@/components/ProgramacionSat';
import { TablaComprobantesSat } from '@/components/TablaComprobantesSat';
import { CalendarioSatPage } from '@/pages/CalendarioSat';

type Tab = 'descarga' | 'emitidos' | 'recibidos' | 'calendario';

/* [clave, etiqueta, ruta] — la ruta mantiene la pestaña enlazable. */
const TABS: Array<[Tab, string, string]> = [
  ['descarga',   'Descarga',   '/xml-sat'],
  ['emitidos',   'Emitidos',   '/xml-sat/emitidos'],
  ['recibidos',  'Recibidos',  '/xml-sat/recibidos'],
  ['calendario', 'Calendario', '/xml-sat/calendario'],
];

export function XmlDelSatPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const tab: Tab =
    pathname.endsWith('/emitidos')   ? 'emitidos'   :
    pathname.endsWith('/recibidos')  ? 'recibidos'  :
    pathname.endsWith('/calendario') ? 'calendario' :
    'descarga';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Download size={24} className="text-emerald-600" /> XML del SAT
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Todo el XML del SAT en una sola pantalla: se pide la descarga, se consultan
          los emitidos y recibidos, y se revisa el calendario de cobertura.
        </p>
      </div>

      {/* Pestañas arriba, en la misma pantalla (mismo patrón que Tesorería). */}
      <div className="flex gap-1 border-b">
        {TABS.map(([k, label, to]) => (
          <button key={k} onClick={() => navigate(to)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === k
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'descarga' && (<>
        {/* Cómo va de verdad, el cupo del día y el histórico. */}
        <ProgramacionSat />
        {/* La maquinaria de descarga (credencial, pedir el periodo, trabajos). */}
        <XmlRecibidos direccionInicial="recibidos" />
      </>)}
      {tab === 'emitidos'   && <TablaComprobantesSat direccion="emitidos" />}
      {tab === 'recibidos'  && <TablaComprobantesSat direccion="recibidos" />}
      {tab === 'calendario' && <CalendarioSatPage />}
    </div>
  );
}

export default XmlDelSatPage;
