/**
 * ErpPrivado — TODO el ERP de escritorio (bajo el Layout), en un módulo que se
 * carga PEREZOSO (lazy) desde App.
 *
 * POR QUÉ EXISTE
 * El checador corre en tabletas/celulares modestos, y cargar todo el ERP (~2 MB
 * de JS) sólo para pintar el kiosco era pesado. Al mover el ERP aquí, el kiosco
 * y las pantallas del checador ya no lo arrastran: sólo se descarga este pedazo
 * cuando alguien entra al ERP de verdad.
 *
 * Los guards (ProtectedRoute, ModuleRoute, …) siguen viviendo en App y se
 * importan de ahí, para no duplicarlos.
 */
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute, ModuleRoute, CompanyOnlyRoute, CompanyAdminRoute, SuperAdminRoute } from './App';

import { Layout } from '@/components/Layout';
import { DashboardPage } from '@/pages/Dashboard';
import { InvoicesPage } from '@/pages/Invoices';
import { NewInvoicePage } from '@/pages/NewInvoice';
import { CustomersPage } from '@/pages/Customers';
import { ProductsPage } from '@/pages/Products';
import { ReportsPage } from '@/pages/Reports';
import { CobranzaDetalladaPage } from '@/pages/CobranzaDetallada';
import { CreditNotesPage } from '@/pages/CreditNotes';
import PaymentsPage from '@/pages/Payments';
import { AdminPackagesPage } from '@/pages/AdminPackages';
import { AdminUsersPage }    from '@/pages/AdminUsers';
import { AdminCompaniesPage } from '@/pages/AdminCompanies';
import { AdminBillingPage }   from '@/pages/AdminBilling';
import { AdminPrepaidPage }   from '@/pages/AdminPrepaid';
import { AdminPromocionPage } from '@/pages/AdminPromocion';
import AdminAccesosPage from '@/pages/AdminAccesos';
import { ImportXMLWizardPage } from '@/pages/ImportXMLWizard';
import { SuppliersPage }      from '@/pages/Suppliers';
import { TeamPage }           from '@/pages/Team';
import { ContractPage }       from '@/pages/Contract';
import { CartaPortePage }             from '@/pages/CartaPorte';
import { CartaPorteFormPage }         from '@/pages/CartaPorteForm';
import { CartaPorteLugaresPage }      from '@/pages/CartaPorteLugares';
import { CartaPorteVehiculosPage }    from '@/pages/CartaPorteVehiculos';
import { CartaPorteAseguradorasPage } from '@/pages/CartaPorteAseguradoras';
import { CartaPorteOperadoresPage }   from '@/pages/CartaPorteOperadores';
import { CartaPorteImportarXmlPage }  from '@/pages/CartaPorteImportarXml';
import { CartaPorteMercanciasPage }   from '@/pages/CartaPorteMercancias';
import { TiposDeCambioPage }          from '@/pages/TiposDeCambio';
import { DiferenciaCambiariaPage }    from '@/pages/DiferenciaCambiaria';
import { WarehousesPage }             from '@/pages/Warehouses';
import { ComprasXMLPage }             from '@/pages/ComprasXML';
import { InventoryPage }              from '@/pages/Inventory';
import { PurchaseOrdersPage }         from '@/pages/PurchaseOrders';
import { PointOfSalePage }            from '@/pages/PointOfSale';
import { TreasuryPage }               from '@/pages/Treasury';
import { AuditoriaPage }              from '@/pages/Auditoria';
import { XmlDelSatPage }             from '@/pages/XmlDelSat';
import { MensajesPage }               from '@/pages/Mensajes';
import { NominaDashboardPage }        from '@/pages/nomina/NominaDashboard';
import { EmpleadosPage }              from '@/pages/nomina/Empleados';
import { NominaParametrosPage }       from '@/pages/nomina/NominaParametros';
import { NominaGuard }                from '@/pages/nomina/NominaGuard';
import { NominaCalculoPage } from '@/pages/nomina/NominaCalculo';
import { NominaCFDIPage } from '@/pages/nomina/NominaCFDI';
import { NominaReportesPage } from '@/pages/nomina/NominaReportes';
import { NominaImportarPage } from '@/pages/nomina/NominaImportar';
import { ImportarRespaldoNominaPage } from '@/pages/nomina/ImportarRespaldoNomina';
import { ChecadorPage } from '@/pages/nomina/Checador';
import { MotorImssIdsePage } from '@/pages/nomina/MotorImssIdse';
import { CatalogoCuentasPage } from '@/pages/contabilidad/CatalogoCuentas';
import { AsignacionCuentasPage } from '@/pages/contabilidad/AsignacionCuentas';
import { ConciliacionContablePage } from '@/pages/contabilidad/ConciliacionContable';
import { AuxiliarCuentasPage } from '@/pages/contabilidad/AuxiliarCuentas';
import { ValidacionContablePage } from '@/pages/contabilidad/ValidacionContable';
import { ReportesEspecialesPage } from '@/pages/contabilidad/ReportesEspeciales';
import { ReportesFiscalesPage } from '@/pages/contabilidad/ReportesFiscales';
import { PolizaManualPage } from '@/pages/contabilidad/PolizaManual';
import { PolizasListaPage } from '@/pages/contabilidad/PolizasLista';
import { PolizasPendientesPage } from '@/pages/contabilidad/PolizasPendientes';
import { PolizasVentaPage } from '@/pages/contabilidad/PolizasVenta';
import { PolizasCompraPage } from '@/pages/contabilidad/PolizasCompra';
import { ActivoFijoPage } from '@/pages/contabilidad/ActivoFijo';
import { ImportarContpaqiPage } from '@/pages/contabilidad/ImportarContpaqi';
import { CfdiContabilidadPage } from '@/pages/contabilidad/CfdiContabilidad';
import { AutofacturacionPage } from '@/pages/contabilidad/Autofacturacion';
import { OpinionCumplimientoPage } from '@/pages/contabilidad/OpinionCumplimiento';
import { CambioCuentaPage } from '@/pages/contabilidad/CambioCuenta';
import {
  BalanzaPage, SituacionFinancieraPage, ResultadoIntegralPage, EstadoResultadosPage,
  FlujoEfectivoPage, CambiosCapitalPage, RazonesPage,
} from '@/pages/contabilidad/Estados';
import { BalanceGeneralPage } from '@/pages/contabilidad/BalanceGeneral';
import { EstadoResultadosContablePage } from '@/pages/contabilidad/EstadoResultadosContable';
import { NifReportesPage, EstadosFinancierosPage } from '@/pages/contabilidad/ReportesHubs';
import { CuentasHubPage } from '@/pages/contabilidad/CuentasHub';
import { IndicadoresPage } from '@/pages/contabilidad/Indicadores';
import { PeriodosPage } from '@/pages/contabilidad/Periodos';
import { CierreEjercicioPage } from '@/pages/contabilidad/CierreEjercicio';
import { PhysicalCountPage }          from '@/pages/PhysicalCount';
import { KardexPage }                 from '@/pages/Kardex';
import { FaltantesPage }              from '@/pages/Faltantes';
import { SuperXMLImportPage }         from '@/pages/SuperXMLImport';
import { CompanyProfilePage }         from '@/pages/CompanyProfile';

export default function ErpPrivado() {
  return (
    <Routes>
      {/* Layout privado — bajo "/" */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="dashboard"    element={<ModuleRoute module="dashboard"><DashboardPage /></ModuleRoute>} />
        <Route path="invoices"     element={<ModuleRoute module="invoices"><InvoicesPage /></ModuleRoute>} />
        <Route path="invoices/polizas-venta" element={<ModuleRoute module="contabilidad"><PolizasVentaPage /></ModuleRoute>} />
        <Route path="compras/polizas"        element={<ModuleRoute module="contabilidad"><PolizasCompraPage /></ModuleRoute>} />
        <Route path="invoices/new"       element={<ModuleRoute module="invoices"><NewInvoicePage /></ModuleRoute>} />
        <Route path="invoices/:id/edit"  element={<ModuleRoute module="invoices"><NewInvoicePage /></ModuleRoute>} />
        <Route path="credit-notes" element={<ModuleRoute module="credit_notes"><CreditNotesPage /></ModuleRoute>} />
        <Route path="payments" element={<ModuleRoute module="credit_notes"><PaymentsPage /></ModuleRoute>} />
        <Route path="customers"    element={<ModuleRoute module="customers"><CustomersPage /></ModuleRoute>} />
        <Route path="invoices/cobranza-detallada" element={<ModuleRoute module="invoices"><CobranzaDetalladaPage /></ModuleRoute>} />
        <Route path="reports"      element={<ModuleRoute module="reports"><ReportsPage /></ModuleRoute>} />
        <Route path="products" element={<ModuleRoute module="products"><ProductsPage /></ModuleRoute>} />
        <Route path="team" element={<CompanyOnlyRoute><CompanyAdminRoute><TeamPage /></CompanyAdminRoute></CompanyOnlyRoute>} />
        <Route path="contract" element={<CompanyOnlyRoute><CompanyAdminRoute><ModuleRoute module="dashboard"><ContractPage /></ModuleRoute></CompanyAdminRoute></CompanyOnlyRoute>} />
        <Route path="carta-porte"                     element={<ModuleRoute module="carta_porte"><CartaPortePage /></ModuleRoute>} />
        <Route path="invoices/:invoiceId/carta-porte" element={<ModuleRoute module="carta_porte"><CartaPorteFormPage /></ModuleRoute>} />
        <Route path="carta-porte/lugares"             element={<ModuleRoute module="carta_porte"><CartaPorteLugaresPage /></ModuleRoute>} />
        <Route path="carta-porte/vehiculos"           element={<ModuleRoute module="carta_porte"><CartaPorteVehiculosPage /></ModuleRoute>} />
        <Route path="carta-porte/aseguradoras"        element={<ModuleRoute module="carta_porte"><CartaPorteAseguradorasPage /></ModuleRoute>} />
        <Route path="carta-porte/operadores"          element={<ModuleRoute module="carta_porte"><CartaPorteOperadoresPage /></ModuleRoute>} />
        <Route path="carta-porte/importar-xml"        element={<ModuleRoute module="carta_porte"><CartaPorteImportarXmlPage /></ModuleRoute>} />
        <Route path="carta-porte/mercancias"          element={<ModuleRoute module="carta_porte"><CartaPorteMercanciasPage /></ModuleRoute>} />
        <Route path="carta-porte/lector-xml"          element={<ModuleRoute module="carta_porte"><SuperXMLImportPage soloCartaPorte /></ModuleRoute>} />
        <Route path="xml-super-import"                element={<ModuleRoute module="xml_reader"><SuperXMLImportPage /></ModuleRoute>} />
        <Route path="tipos-de-cambio"                 element={<ModuleRoute module="exchange_rates"><TiposDeCambioPage /></ModuleRoute>} />
        <Route path="diferencia-cambiaria"            element={<ModuleRoute module="exchange_rates"><DiferenciaCambiariaPage /></ModuleRoute>} />
        <Route path="warehouses"                      element={<ModuleRoute module="inventory"><WarehousesPage /></ModuleRoute>} />
        <Route path="inventory"                       element={<ModuleRoute module="inventory"><InventoryPage /></ModuleRoute>} />
        <Route path="physical-counts"                 element={<ModuleRoute module="inventory"><PhysicalCountPage /></ModuleRoute>} />
        <Route path="kardex"                          element={<ModuleRoute module="inventory"><KardexPage /></ModuleRoute>} />
        <Route path="faltantes"                       element={<ModuleRoute module="purchasing"><FaltantesPage /></ModuleRoute>} />
        <Route path="purchase-orders"                 element={<ModuleRoute module="purchasing"><PurchaseOrdersPage /></ModuleRoute>} />
        <Route path="compras/xml"                     element={<ModuleRoute module="purchasing"><ComprasXMLPage /></ModuleRoute>} />
        <Route path="suppliers"                       element={<ModuleRoute module="suppliers"><SuppliersPage /></ModuleRoute>} />
        <Route path="pos"                             element={<ModuleRoute module="pos"><PointOfSalePage /></ModuleRoute>} />
        <Route path="treasury"                        element={<ModuleRoute module="treasury"><TreasuryPage /></ModuleRoute>} />
        <Route path="auditoria"                       element={<ModuleRoute module="auditoria"><AuditoriaPage /></ModuleRoute>} />
        <Route path="xml-sat"                         element={<ModuleRoute module="auditoria"><XmlDelSatPage /></ModuleRoute>} />
        <Route path="xml-sat/recibidos"               element={<ModuleRoute module="auditoria"><XmlDelSatPage /></ModuleRoute>} />
        <Route path="xml-sat/emitidos"                element={<ModuleRoute module="auditoria"><XmlDelSatPage /></ModuleRoute>} />
        <Route path="xml-sat/calendario"              element={<ModuleRoute module="auditoria"><XmlDelSatPage /></ModuleRoute>} />
        <Route path="xml-sat/respaldo"                element={<ModuleRoute module="auditoria"><XmlDelSatPage /></ModuleRoute>} />
        <Route path="mensajes"                        element={<ModuleRoute module="mensajes"><MensajesPage /></ModuleRoute>} />
        <Route path="nomina"                          element={<ModuleRoute module="nomina"><NominaGuard><NominaDashboardPage /></NominaGuard></ModuleRoute>} />
        <Route path="nomina/empleados"                element={<ModuleRoute module="nomina"><NominaGuard><EmpleadosPage /></NominaGuard></ModuleRoute>} />
        <Route path="nomina/calculo"                  element={<ModuleRoute module="nomina"><NominaGuard><NominaCalculoPage /></NominaGuard></ModuleRoute>} />
        <Route path="nomina/cfdi"                     element={<ModuleRoute module="nomina"><NominaGuard><NominaCFDIPage /></NominaGuard></ModuleRoute>} />
        <Route path="nomina/imss"                     element={<ModuleRoute module="nomina"><NominaGuard><MotorImssIdsePage /></NominaGuard></ModuleRoute>} />
        <Route path="nomina/parametros"               element={<ModuleRoute module="nomina"><NominaParametrosPage /></ModuleRoute>} />
        <Route path="nomina/reportes"                 element={<ModuleRoute module="nomina"><NominaGuard><NominaReportesPage /></NominaGuard></ModuleRoute>} />
        <Route path="nomina/importar"                 element={<ModuleRoute module="nomina"><NominaGuard><NominaImportarPage /></NominaGuard></ModuleRoute>} />
        <Route path="nomina/importar-respaldo"        element={<ModuleRoute module="nomina"><NominaGuard><ImportarRespaldoNominaPage /></NominaGuard></ModuleRoute>} />
        <Route path="checador"                        element={<ModuleRoute module="nomina"><NominaGuard><ChecadorPage /></NominaGuard></ModuleRoute>} />
        <Route path="contabilidad/catalogo"           element={<ModuleRoute module="contabilidad"><CuentasHubPage /></ModuleRoute>} />
        <Route path="contabilidad/cuentas"            element={<ModuleRoute module="contabilidad"><CatalogoCuentasPage /></ModuleRoute>} />
        <Route path="contabilidad/asignacion"         element={<ModuleRoute module="contabilidad"><AsignacionCuentasPage /></ModuleRoute>} />
        <Route path="contabilidad/poliza-manual"      element={<ModuleRoute module="contabilidad"><PolizaManualPage /></ModuleRoute>} />
        <Route path="contabilidad/polizas"            element={<ModuleRoute module="contabilidad"><PolizasListaPage /></ModuleRoute>} />
        <Route path="contabilidad/polizas-pendientes" element={<ModuleRoute module="contabilidad"><PolizasPendientesPage /></ModuleRoute>} />
        <Route path="contabilidad/activo-fijo"        element={<ModuleRoute module="contabilidad"><ActivoFijoPage /></ModuleRoute>} />
        <Route path="contabilidad/importar-contpaqi"  element={<ModuleRoute module="contabilidad"><ImportarContpaqiPage /></ModuleRoute>} />
        <Route path="contabilidad/cfdi"               element={<ModuleRoute module="contabilidad"><CfdiContabilidadPage /></ModuleRoute>} />
        <Route path="contabilidad/autofactura"        element={<ModuleRoute module="contabilidad"><AutofacturacionPage /></ModuleRoute>} />
        <Route path="contabilidad/opinion-cumplimiento" element={<ModuleRoute module="contabilidad"><OpinionCumplimientoPage /></ModuleRoute>} />
        <Route path="contabilidad/cambio-cuenta"      element={<ModuleRoute module="contabilidad"><CambioCuentaPage /></ModuleRoute>} />
        <Route path="contabilidad/conciliacion"       element={<ModuleRoute module="contabilidad"><ConciliacionContablePage /></ModuleRoute>} />
        <Route path="contabilidad/auxiliar"           element={<ModuleRoute module="contabilidad"><AuxiliarCuentasPage /></ModuleRoute>} />
        <Route path="contabilidad/validacion"         element={<ModuleRoute module="contabilidad"><ValidacionContablePage /></ModuleRoute>} />
        <Route path="contabilidad/reportes-especiales" element={<ModuleRoute module="contabilidad"><ReportesEspecialesPage /></ModuleRoute>} />
        <Route path="contabilidad/reportes-fiscales"  element={<ModuleRoute module="contabilidad"><ReportesFiscalesPage /></ModuleRoute>} />
        <Route path="contabilidad/periodos"           element={<ModuleRoute module="contabilidad"><PeriodosPage /></ModuleRoute>} />
        <Route path="contabilidad/cierre"             element={<ModuleRoute module="contabilidad"><CierreEjercicioPage /></ModuleRoute>} />
        <Route path="contabilidad/nif"                element={<ModuleRoute module="contabilidad"><NifReportesPage /></ModuleRoute>} />
        <Route path="contabilidad/estados-financieros" element={<ModuleRoute module="contabilidad"><EstadosFinancierosPage /></ModuleRoute>} />
        <Route path="contabilidad/indicadores"        element={<ModuleRoute module="contabilidad"><IndicadoresPage /></ModuleRoute>} />
        <Route path="contabilidad/balanza"            element={<ModuleRoute module="contabilidad"><BalanzaPage /></ModuleRoute>} />
        <Route path="contabilidad/situacion"          element={<ModuleRoute module="contabilidad"><SituacionFinancieraPage /></ModuleRoute>} />
        <Route path="contabilidad/balance-general"    element={<ModuleRoute module="contabilidad"><BalanceGeneralPage /></ModuleRoute>} />
        <Route path="contabilidad/estado-resultados-contable" element={<ModuleRoute module="contabilidad"><EstadoResultadosContablePage /></ModuleRoute>} />
        <Route path="contabilidad/resultados"         element={<ModuleRoute module="contabilidad"><ResultadoIntegralPage /></ModuleRoute>} />
        <Route path="contabilidad/estado-resultados"  element={<ModuleRoute module="contabilidad"><EstadoResultadosPage /></ModuleRoute>} />
        <Route path="contabilidad/flujo"              element={<ModuleRoute module="contabilidad"><FlujoEfectivoPage /></ModuleRoute>} />
        <Route path="contabilidad/capital"            element={<ModuleRoute module="contabilidad"><CambiosCapitalPage /></ModuleRoute>} />
        <Route path="contabilidad/razones"            element={<ModuleRoute module="contabilidad"><RazonesPage /></ModuleRoute>} />
        <Route path="company"                         element={<CompanyOnlyRoute><CompanyProfilePage /></CompanyOnlyRoute>} />

        {/* Plataforma — SOLO SUPER_ADMIN */}
        <Route path="admin/packages"  element={<SuperAdminRoute><AdminPackagesPage /></SuperAdminRoute>} />
        <Route path="admin/billing"   element={<SuperAdminRoute><AdminBillingPage /></SuperAdminRoute>} />
        <Route path="admin/prepaid"   element={<SuperAdminRoute><AdminPrepaidPage /></SuperAdminRoute>} />
        <Route path="admin/promocion" element={<SuperAdminRoute><AdminPromocionPage /></SuperAdminRoute>} />
        <Route path="admin/accesos"   element={<SuperAdminRoute><AdminAccesosPage /></SuperAdminRoute>} />
        <Route path="admin/users"     element={<SuperAdminRoute><AdminUsersPage /></SuperAdminRoute>} />
        <Route path="admin/companies" element={<SuperAdminRoute><AdminCompaniesPage /></SuperAdminRoute>} />
        <Route path="import-xml"      element={<SuperAdminRoute><ImportXMLWizardPage /></SuperAdminRoute>} />
      </Route>

      {/* Cualquier URL desconocida → landing */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
