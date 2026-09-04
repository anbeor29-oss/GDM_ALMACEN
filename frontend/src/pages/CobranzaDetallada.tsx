/**
 * Cobranza detallada — vive también en Facturas.
 *
 * Es el mismo reporte que estaba en «Reportes» (facturas con saldo pendiente por
 * cliente), pero alcanzable desde Facturas para quien factura, sin abrir el
 * tablero de dirección. Reutiliza el componente `ReceivablesReport` para no
 * duplicar la lógica ni la exportación a PDF.
 */
import { ReceivablesReport } from './Reports';

export function CobranzaDetalladaPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold text-gray-900">Cobranza detallada</h1>
        <p className="text-gray-600 mt-2">Facturas con saldo pendiente, por cliente.</p>
      </div>
      <ReceivablesReport />
    </div>
  );
}

export default CobranzaDetalladaPage;
