/**
 * XmlDelSat — el menú XML, con tres pantallas bajo /xml-sat.
 *
 *   /xml-sat            → "XML del SAT": la pantalla principal de descarga
 *                         (estado, cupo, pedir al SAT, trabajos). Es la que
 *                         alimenta a las otras dos.
 *   /xml-sat/emitidos   → sólo la tabla de emitidos (con su representación).
 *   /xml-sat/recibidos  → sólo la tabla de recibidos (ficha de metadatos).
 *
 * Emitidos y recibidos son la MISMA tabla con la dirección puesta; no traen la
 * maquinaria de descarga, que vive en la pantalla principal. Recibidos aparece
 * con sus títulos aunque todavía no haya nada que mostrar.
 */
import { useLocation } from 'react-router-dom';
import { Download } from 'lucide-react';
import { XmlRecibidos } from '@/components/XmlRecibidos';
import { ProgramacionSat } from '@/components/ProgramacionSat';
import { TablaComprobantesSat } from '@/components/TablaComprobantesSat';

export function XmlDelSatPage() {
  const { pathname } = useLocation();

  // Emitidos / Recibidos: sólo la tabla, en su dirección.
  if (pathname.endsWith('/emitidos')) {
    return <div className="space-y-4"><TablaComprobantesSat direccion="emitidos" /></div>;
  }
  if (pathname.endsWith('/recibidos')) {
    return <div className="space-y-4"><TablaComprobantesSat direccion="recibidos" /></div>;
  }

  // Pantalla principal: la descarga.
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Download size={24} className="text-emerald-600" />
          XML del SAT
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Se piden aquí los comprobantes al SAT —emitidos y recibidos—; ya traídos se
          consultan en sus pantallas de Emitidos y Recibidos.
        </p>
      </div>

      {/* Cómo va de verdad, el cupo del día y el histórico. */}
      <ProgramacionSat />

      {/* La maquinaria de descarga (credencial, pedir el periodo, trabajos). */}
      <XmlRecibidos direccionInicial="recibidos" />
    </div>
  );
}

export default XmlDelSatPage;
