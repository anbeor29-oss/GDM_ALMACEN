/**
 * Catálogo de cuentas — hub con pestañas (como Tesorería): el catálogo y las
 * herramientas que giran alrededor de él en una sola pantalla, para no andar de
 * un menú a otro: Catálogo, Asignación de cuentas, Auxiliar de cuentas y Cambios
 * de cuenta. Cada pestaña monta la pantalla que ya existía.
 */
import { BookText } from 'lucide-react';
import { Hub } from './ReportesHubs';
import { CatalogoCuentasPage } from './CatalogoCuentas';
import { AsignacionCuentasPage } from './AsignacionCuentas';
import { AuxiliarCuentasPage } from './AuxiliarCuentas';
import { CambioCuentaPage } from './CambioCuenta';

export function CuentasHubPage() {
  return (
    <Hub
      titulo="Catálogo de cuentas" subtitulo="El catálogo y sus herramientas: asignación, auxiliar y cambios de cuenta."
      icono={<BookText size={20} className="text-primary" />}
      pestanas={[
        ['catalogo', 'Catálogo de cuentas', () => <CatalogoCuentasPage />],
        ['asignacion', 'Asignación de cuentas', () => <AsignacionCuentasPage />],
        ['auxiliar', 'Auxiliar de cuentas', () => <AuxiliarCuentasPage />],
        ['cambio', 'Cambios de cuenta', () => <CambioCuentaPage />],
      ]}
    />
  );
}

export default CuentasHubPage;
