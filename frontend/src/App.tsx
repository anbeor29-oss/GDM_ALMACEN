/**
 * Main App Component
 * Router configuration
 */

import { useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { Layout } from '@/components/Layout';
import { LoginPage } from '@/pages/Login';
import { PublicHomePage } from '@/pages/PublicHome';
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
import { TerminosPage, PrivacidadPage } from '@/pages/LegalDoc';
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
// ─── Portadas desde GDM Almacén (fusión ERP, fase 0) ───────────────
import { WarehousesPage }             from '@/pages/Warehouses';
import { ComprasXMLPage }             from '@/pages/ComprasXML';
import { InventoryPage }              from '@/pages/Inventory';
import { PurchaseOrdersPage }         from '@/pages/PurchaseOrders';
import { PointOfSalePage }            from '@/pages/PointOfSale';
import { TreasuryPage }               from '@/pages/Treasury';
import { AuditoriaPage }              from '@/pages/Auditoria';
import { XmlDelSatPage }             from '@/pages/XmlDelSat';
import { CalendarioSatPage }         from '@/pages/CalendarioSat';
import { MensajesPage }               from '@/pages/Mensajes';
import { NominaDashboardPage }        from '@/pages/nomina/NominaDashboard';
import { EmpleadosPage }              from '@/pages/nomina/Empleados';
import { NominaParametrosPage }       from '@/pages/nomina/NominaParametros';
import { NominaCalculoPage } from '@/pages/nomina/NominaCalculo';
import { NominaCFDIPage } from '@/pages/nomina/NominaCFDI';
import { NominaReportesPage } from '@/pages/nomina/NominaReportes';
import { NominaImportarPage } from '@/pages/nomina/NominaImportar';
import { MotorImssIdsePage } from '@/pages/nomina/MotorImssIdse';
import { CatalogoCuentasPage } from '@/pages/contabilidad/CatalogoCuentas';
import { AsignacionCuentasPage } from '@/pages/contabilidad/AsignacionCuentas';
import { PolizaManualPage } from '@/pages/contabilidad/PolizaManual';
import { PolizasListaPage } from '@/pages/contabilidad/PolizasLista';
import { PolizasPendientesPage } from '@/pages/contabilidad/PolizasPendientes';
import { PolizasVentaPage } from '@/pages/contabilidad/PolizasVenta';
import { PolizasCompraPage } from '@/pages/contabilidad/PolizasCompra';
import { ActivoFijoPage } from '@/pages/contabilidad/ActivoFijo';
import { ImportarContpaqiPage } from '@/pages/contabilidad/ImportarContpaqi';
import { CambioCuentaPage } from '@/pages/contabilidad/CambioCuenta';
import {
  BalanzaPage, SituacionFinancieraPage, ResultadoIntegralPage, EstadoResultadosPage,
  FlujoEfectivoPage, CambiosCapitalPage, RazonesPage,
} from '@/pages/contabilidad/Estados';
import { PeriodosPage } from '@/pages/contabilidad/Periodos';
import { PhysicalCountPage }          from '@/pages/PhysicalCount';
import { KardexPage }                 from '@/pages/Kardex';
import { FaltantesPage }              from '@/pages/Faltantes';
import { SuperXMLImportPage }         from '@/pages/SuperXMLImport';
import { CompanyProfilePage }         from '@/pages/CompanyProfile';
import { useAuthStore } from '@/store/auth';
import { canAccess, type ModuleKey, homeDe } from '@/utils/permissions';

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

/**
 * Landing por rol tras login:
 *   · SUPER_ADMIN → /admin/companies (operador de plataforma)
 *   · Otros roles → /dashboard (operativo de empresa)
 */
function HomeRedirect() {
  const { user } = useAuthStore();
  /* Cada grupo llega a lo que viene a hacer.
   *
   * Antes todos caían en el dashboard. Ahora que el resumen del negocio es sólo
   * para la dirección, mandar ahí a un cajero sería mandarlo a una puerta
   * cerrada — y como el dashboard es también el destino de los rechazos, se
   * quedaría rebotando entre dos negativas. */
  return (
    <Navigate
      to={user?.role === 'SUPER_ADMIN' ? '/admin/companies' : homeDe(user)}
      replace
    />
  );
}

/**
 * Redirección desde la raíz "/" según sesión.
 *   · Sin sesión → landing pública con planes y CTA
 *   · Con sesión → HomeRedirect (dashboard o admin/companies)
 */
function RootLanding() {
  const { isAuthenticated } = useAuthStore();
  if (isAuthenticated) return <HomeRedirect />;
  return <PublicHomePage />;
}

/**
 * Rutas operativas (Dashboard, Facturas, etc.) — bloqueadas para SUPER_ADMIN
 * porque son módulos de empresa usuaria, no de plataforma. Si entra a la URL
 * a mano lo mandamos al menú de Empresas.
 */
function CompanyOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role === 'SUPER_ADMIN') {
    return <Navigate to="/admin/companies" replace />;
  }
  return <>{children}</>;
}

/**
 * Ruta de empresa gateada por MÓDULO según el grupo de trabajo del usuario.
 * Un usuario de VENTAS que teclee /products a mano es redirigido al dashboard.
 * (Bloquea también a SUPER_ADMIN vía CompanyOnlyRoute.)
 */
function ModuleRoute({ module, children }: { module: ModuleKey; children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role === 'SUPER_ADMIN') return <Navigate to="/admin/companies" replace />;
  /* Se rebota a la casa del grupo, NO al dashboard: si el grupo tampoco lo
   * alcanza —y seis de los siete no— el rebote sería a otra negativa. */
  if (!canAccess(user?.workGroup, module)) return <Navigate to={homeDe(user)} replace />;
  return <>{children}</>;
}

/**
 * Ruta gateada por ROL ADMIN de empresa. Gestionar usuarios es una cuestión de
 * AUTORIDAD, no de grupo de trabajo: por eso no pasa por ModuleRoute. El
 * SUPER_ADMIN administra usuarios desde /admin/users, no desde aquí.
 */
function CompanyAdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role !== 'ADMIN') return <Navigate to={homeDe(user)} replace />;
  return <>{children}</>;
}

/**
 * Módulos administrativos de plataforma — sólo SUPER_ADMIN.
 * Si un usuario común escribe /import-xml o /admin/... a mano, lo enviamos
 * al dashboard en lugar de renderizar la página.
 */
function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role !== 'SUPER_ADMIN') {
    return <Navigate to={homeDe(user)} replace />;
  }
  return <>{children}</>;
}

/**
 * Auto-recarga: cuando el backend cambia de commit (hubo un deploy), la próxima
 * vez que se cambie de pantalla la app se recarga sola —así toma la versión nueva
 * sin teclear Ctrl+Shift+R y sin cortar una captura a media—.
 */
function AutoActualizar() {
  const commitInicial = useRef<string | null>(null);
  const hayNueva = useRef(false);
  const location = useLocation();

  useEffect(() => {
    const revisar = async () => {
      try {
        const s = await api.getSalud();
        const c = s?.commit;
        if (!c || c === 'local') return;
        if (commitInicial.current == null) commitInicial.current = c;
        else if (c !== commitInicial.current) hayNueva.current = true;
      } catch { /* sin red: no pasa nada */ }
    };
    revisar();
    const id = setInterval(revisar, 120_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (hayNueva.current) window.location.reload();
  }, [location.pathname]);

  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router basename={import.meta.env.BASE_URL}>
        <AutoActualizar />
        <Routes>
          {/* Rutas públicas */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/terminos"   element={<TerminosPage />} />
          <Route path="/privacidad" element={<PrivacidadPage />} />

          {/* Layout privado — bajo "/" — pero la ruta index es el landing público */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            {/* Operación diaria — gateada por grupo de trabajo (SUPER_ADMIN redirigido) */}
            {/* El dashboard deja de ser de todos.
                El resumen del negocio —ventas, saldos, línea de crédito— es
                información de la dirección. Va por ModuleRoute como cualquier
                otra pantalla, y quien no lo tenga rebota a la casa de su
                grupo en vez de verlo tecleando la dirección. */}
            <Route path="dashboard"    element={<ModuleRoute module="dashboard"><DashboardPage /></ModuleRoute>} />
            {/* Facturación */}
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
            {/* Equipo: el ADMIN de la empresa gestiona a sus USER. */}
            <Route path="team" element={<CompanyOnlyRoute><CompanyAdminRoute><TeamPage /></CompanyAdminRoute></CompanyOnlyRoute>} />
            {/* Contrato: lo lee cualquier usuario de empresa; firmarlo exige ADMIN
                (el guard real está en el backend). */}
            {/* El contrato: rol de administrador Y sin grupo operativo. Un
                administrador acotado a tesorería o a nómina no ve las
                condiciones comerciales con GDM — se le acotó el trabajo, y esto
                no es parte de él. El candado del menú no basta: sin esto se
                llegaría tecleando la dirección. */}
            <Route path="contract" element={<CompanyOnlyRoute><CompanyAdminRoute><ModuleRoute module="dashboard"><ContractPage /></ModuleRoute></CompanyAdminRoute></CompanyOnlyRoute>} />
            {/* Carta Porte 3.1 + Super Lector XML — módulos V2.
                Cada pantalla va con el módulo al que pertenece: esconderla del
                menú y dejarla abierta por URL no sirve de nada. */}
            <Route path="carta-porte"                     element={<ModuleRoute module="carta_porte"><CartaPortePage /></ModuleRoute>} />
            <Route path="invoices/:invoiceId/carta-porte" element={<ModuleRoute module="carta_porte"><CartaPorteFormPage /></ModuleRoute>} />
            <Route path="carta-porte/lugares"             element={<ModuleRoute module="carta_porte"><CartaPorteLugaresPage /></ModuleRoute>} />
            <Route path="carta-porte/vehiculos"           element={<ModuleRoute module="carta_porte"><CartaPorteVehiculosPage /></ModuleRoute>} />
            <Route path="carta-porte/aseguradoras"        element={<ModuleRoute module="carta_porte"><CartaPorteAseguradorasPage /></ModuleRoute>} />
            <Route path="carta-porte/operadores"          element={<ModuleRoute module="carta_porte"><CartaPorteOperadoresPage /></ModuleRoute>} />
            <Route path="carta-porte/importar-xml"        element={<ModuleRoute module="carta_porte"><CartaPorteImportarXmlPage /></ModuleRoute>} />
            <Route path="carta-porte/mercancias"          element={<ModuleRoute module="carta_porte"><CartaPorteMercanciasPage /></ModuleRoute>} />
            <Route path="xml-super-import"                element={<ModuleRoute module="xml_reader"><SuperXMLImportPage /></ModuleRoute>} />
            <Route path="tipos-de-cambio"                 element={<ModuleRoute module="exchange_rates"><TiposDeCambioPage /></ModuleRoute>} />
            <Route path="diferencia-cambiaria"            element={<ModuleRoute module="exchange_rates"><DiferenciaCambiariaPage /></ModuleRoute>} />
            {/* Inventarios, compras y tesorería — fusión ERP */}
            <Route path="warehouses"                      element={<ModuleRoute module="inventory"><WarehousesPage /></ModuleRoute>} />
            <Route path="inventory"                       element={<ModuleRoute module="inventory"><InventoryPage /></ModuleRoute>} />
            <Route path="physical-counts"                 element={<ModuleRoute module="inventory"><PhysicalCountPage /></ModuleRoute>} />
            <Route path="kardex"                          element={<ModuleRoute module="inventory"><KardexPage /></ModuleRoute>} />
            <Route path="faltantes"                       element={<ModuleRoute module="purchasing"><FaltantesPage /></ModuleRoute>} />
            <Route path="purchase-orders"                 element={<ModuleRoute module="purchasing"><PurchaseOrdersPage /></ModuleRoute>} />
            <Route path="compras/xml"                     element={<ModuleRoute module="purchasing"><ComprasXMLPage /></ModuleRoute>} />
            {/* Proveedores es catálogo DE LA EMPRESA, no de plataforma: las
                órdenes de compra y tesorería lo referencian. Estaba bajo
                SuperAdminRoute y por eso rebotaba al dashboard. */}
            <Route path="suppliers"                       element={<ModuleRoute module="suppliers"><SuppliersPage /></ModuleRoute>} />
            <Route path="pos"                             element={<ModuleRoute module="pos"><PointOfSalePage /></ModuleRoute>} />
            <Route path="treasury"                        element={<ModuleRoute module="treasury"><TreasuryPage /></ModuleRoute>} />
            <Route path="auditoria"                       element={<ModuleRoute module="auditoria"><AuditoriaPage /></ModuleRoute>} />
            {/* Los XML del SAT tienen su propio menú y sus propias rutas: es
                una pantalla de trabajo diario, no un rincón de Auditoría.
                Adentro de Auditoría siguen estando como pestaña, para quien
                llega por ahí. */}
            <Route path="xml-sat"                         element={<ModuleRoute module="auditoria"><XmlDelSatPage /></ModuleRoute>} />
            <Route path="xml-sat/recibidos"               element={<ModuleRoute module="auditoria"><XmlDelSatPage /></ModuleRoute>} />
            <Route path="xml-sat/emitidos"                element={<ModuleRoute module="auditoria"><XmlDelSatPage /></ModuleRoute>} />
            <Route path="xml-sat/calendario"              element={<ModuleRoute module="auditoria"><CalendarioSatPage /></ModuleRoute>} />
            <Route path="mensajes"                        element={<ModuleRoute module="mensajes"><MensajesPage /></ModuleRoute>} />
            {/* Nómina. El gateo real lo hace el backend (requireModule) — esto
                sólo evita que la URL escrita a mano pinte una pantalla vacía. */}
            <Route path="nomina"                          element={<ModuleRoute module="nomina"><NominaDashboardPage /></ModuleRoute>} />
            <Route path="nomina/empleados"                element={<ModuleRoute module="nomina"><EmpleadosPage /></ModuleRoute>} />
            <Route path="nomina/calculo"                  element={<ModuleRoute module="nomina"><NominaCalculoPage /></ModuleRoute>} />
            <Route path="nomina/cfdi"                     element={<ModuleRoute module="nomina"><NominaCFDIPage /></ModuleRoute>} />
            <Route path="nomina/imss"                     element={<ModuleRoute module="nomina"><MotorImssIdsePage /></ModuleRoute>} />
            <Route path="nomina/parametros"               element={<ModuleRoute module="nomina"><NominaParametrosPage /></ModuleRoute>} />
            <Route path="nomina/reportes"                 element={<ModuleRoute module="nomina"><NominaReportesPage /></ModuleRoute>} />
            <Route path="nomina/importar"                 element={<ModuleRoute module="nomina"><NominaImportarPage /></ModuleRoute>} />

            {/* Contabilidad. Mismo gateo que nómina: el backend manda con
                requireModule, esto sólo evita la pantalla vacía. */}
            <Route path="contabilidad/cuentas"            element={<ModuleRoute module="contabilidad"><CatalogoCuentasPage /></ModuleRoute>} />
            <Route path="contabilidad/asignacion"         element={<ModuleRoute module="contabilidad"><AsignacionCuentasPage /></ModuleRoute>} />
            <Route path="contabilidad/poliza-manual"      element={<ModuleRoute module="contabilidad"><PolizaManualPage /></ModuleRoute>} />
            <Route path="contabilidad/polizas"            element={<ModuleRoute module="contabilidad"><PolizasListaPage /></ModuleRoute>} />
            <Route path="contabilidad/polizas-pendientes" element={<ModuleRoute module="contabilidad"><PolizasPendientesPage /></ModuleRoute>} />
            <Route path="contabilidad/activo-fijo"        element={<ModuleRoute module="contabilidad"><ActivoFijoPage /></ModuleRoute>} />
            <Route path="contabilidad/importar-contpaqi"  element={<ModuleRoute module="contabilidad"><ImportarContpaqiPage /></ModuleRoute>} />
            <Route path="contabilidad/cambio-cuenta"      element={<ModuleRoute module="contabilidad"><CambioCuentaPage /></ModuleRoute>} />
            <Route path="contabilidad/periodos"           element={<ModuleRoute module="contabilidad"><PeriodosPage /></ModuleRoute>} />
            <Route path="contabilidad/balanza"            element={<ModuleRoute module="contabilidad"><BalanzaPage /></ModuleRoute>} />
            <Route path="contabilidad/situacion"          element={<ModuleRoute module="contabilidad"><SituacionFinancieraPage /></ModuleRoute>} />
            <Route path="contabilidad/resultados"         element={<ModuleRoute module="contabilidad"><ResultadoIntegralPage /></ModuleRoute>} />
            <Route path="contabilidad/estado-resultados"  element={<ModuleRoute module="contabilidad"><EstadoResultadosPage /></ModuleRoute>} />
            <Route path="contabilidad/flujo"              element={<ModuleRoute module="contabilidad"><FlujoEfectivoPage /></ModuleRoute>} />
            <Route path="contabilidad/capital"            element={<ModuleRoute module="contabilidad"><CambiosCapitalPage /></ModuleRoute>} />
            <Route path="contabilidad/razones"            element={<ModuleRoute module="contabilidad"><RazonesPage /></ModuleRoute>} />
            <Route path="company"                         element={<CompanyOnlyRoute><CompanyProfilePage /></CompanyOnlyRoute>} />

            {/* Módulos de plataforma — SOLO SUPER_ADMIN (guard por URL directa) */}
            <Route path="admin/packages"  element={<SuperAdminRoute><AdminPackagesPage /></SuperAdminRoute>} />
            <Route path="admin/billing"   element={<SuperAdminRoute><AdminBillingPage /></SuperAdminRoute>} />
            <Route path="admin/prepaid"   element={<SuperAdminRoute><AdminPrepaidPage /></SuperAdminRoute>} />
            <Route path="admin/promocion" element={<SuperAdminRoute><AdminPromocionPage /></SuperAdminRoute>} />
            <Route path="admin/accesos"   element={<SuperAdminRoute><AdminAccesosPage /></SuperAdminRoute>} />
            <Route path="admin/users"     element={<SuperAdminRoute><AdminUsersPage /></SuperAdminRoute>} />
            <Route path="admin/companies" element={<SuperAdminRoute><AdminCompaniesPage /></SuperAdminRoute>} />
            <Route path="import-xml"      element={<SuperAdminRoute><ImportXMLWizardPage /></SuperAdminRoute>} />

          </Route>

          {/* Ruta raíz "/" — landing público si no hay sesión, redirect si sí */}
          <Route path="/" element={<RootLanding />} />

          {/* Cualquier URL desconocida → landing */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </QueryClientProvider>
  );
}
