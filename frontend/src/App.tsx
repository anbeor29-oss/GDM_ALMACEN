/**
 * Main App Component
 * Router configuration
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { LoginPage } from '@/pages/Login';
import { PublicHomePage } from '@/pages/PublicHome';
import { DashboardPage } from '@/pages/Dashboard';
import { InvoicesPage } from '@/pages/Invoices';
import { NewInvoicePage } from '@/pages/NewInvoice';
import { CustomersPage } from '@/pages/Customers';
import { ProductsPage } from '@/pages/Products';
import { ReportsPage } from '@/pages/Reports';
import { CreditNotesPage } from '@/pages/CreditNotes';
import { AdminPackagesPage } from '@/pages/AdminPackages';
import { AdminUsersPage }    from '@/pages/AdminUsers';
import { AdminCompaniesPage } from '@/pages/AdminCompanies';
import { AdminBillingPage }   from '@/pages/AdminBilling';
import { AdminPrepaidPage }   from '@/pages/AdminPrepaid';
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
import { InventoryPage }              from '@/pages/Inventory';
import { PurchaseOrdersPage }         from '@/pages/PurchaseOrders';
import { PointOfSalePage }            from '@/pages/PointOfSale';
import { TreasuryPage }               from '@/pages/Treasury';
import { PhysicalCountPage }          from '@/pages/PhysicalCount';
import { SuperXMLImportPage }         from '@/pages/SuperXMLImport';
import { CompanyProfilePage }         from '@/pages/CompanyProfile';
import { useAuthStore } from '@/store/auth';
import { canAccess, type ModuleKey } from '@/utils/permissions';

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
  return <Navigate to={user?.role === 'SUPER_ADMIN' ? '/admin/companies' : '/dashboard'} replace />;
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
  if (!canAccess(user?.workGroup, module)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/**
 * Ruta gateada por ROL ADMIN de empresa. Gestionar usuarios es una cuestión de
 * AUTORIDAD, no de grupo de trabajo: por eso no pasa por ModuleRoute. El
 * SUPER_ADMIN administra usuarios desde /admin/users, no desde aquí.
 */
function CompanyAdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role !== 'ADMIN') return <Navigate to="/dashboard" replace />;
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
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router basename={import.meta.env.BASE_URL}>
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
            <Route path="dashboard"    element={<CompanyOnlyRoute><DashboardPage /></CompanyOnlyRoute>} />
            {/* Facturación. Punto de Venta NO vive aquí: es del producto ALMACEN
                (repo GDM_ALMACEN), igual que inventarios, compras y tesorería. */}
            <Route path="invoices"     element={<ModuleRoute module="invoices"><InvoicesPage /></ModuleRoute>} />
            <Route path="invoices/new"       element={<ModuleRoute module="invoices"><NewInvoicePage /></ModuleRoute>} />
            <Route path="invoices/:id/edit"  element={<ModuleRoute module="invoices"><NewInvoicePage /></ModuleRoute>} />
            <Route path="credit-notes" element={<ModuleRoute module="credit_notes"><CreditNotesPage /></ModuleRoute>} />
            <Route path="customers"    element={<ModuleRoute module="customers"><CustomersPage /></ModuleRoute>} />
            <Route path="reports"      element={<ModuleRoute module="reports"><ReportsPage /></ModuleRoute>} />
            {/* Catálogos. Inventarios, compras, tesorería y proveedores NO viven
                aquí: son del producto ALMACEN (repo GDM_ALMACEN). GDM_FAC es solo
                facturación. SuppliersPage sigue existiendo, pero SOLO para el
                SUPER_ADMIN de la plataforma (ruta /suppliers, más abajo). */}
            <Route path="products" element={<ModuleRoute module="products"><ProductsPage /></ModuleRoute>} />
            {/* Equipo: el ADMIN de la empresa gestiona a sus USER. */}
            <Route path="team" element={<CompanyOnlyRoute><CompanyAdminRoute><TeamPage /></CompanyAdminRoute></CompanyOnlyRoute>} />
            {/* Contrato: lo lee cualquier usuario de empresa; firmarlo exige ADMIN
                (el guard real está en el backend). */}
            <Route path="contract" element={<CompanyOnlyRoute><ContractPage /></CompanyOnlyRoute>} />
            {/* Carta Porte 3.1 + Super Lector XML — módulos V2 */}
            <Route path="carta-porte"                     element={<CompanyOnlyRoute><CartaPortePage /></CompanyOnlyRoute>} />
            <Route path="invoices/:invoiceId/carta-porte" element={<CompanyOnlyRoute><CartaPorteFormPage /></CompanyOnlyRoute>} />
            <Route path="carta-porte/lugares"             element={<CompanyOnlyRoute><CartaPorteLugaresPage /></CompanyOnlyRoute>} />
            <Route path="carta-porte/vehiculos"           element={<CompanyOnlyRoute><CartaPorteVehiculosPage /></CompanyOnlyRoute>} />
            <Route path="carta-porte/aseguradoras"        element={<CompanyOnlyRoute><CartaPorteAseguradorasPage /></CompanyOnlyRoute>} />
            <Route path="carta-porte/operadores"          element={<CompanyOnlyRoute><CartaPorteOperadoresPage /></CompanyOnlyRoute>} />
            <Route path="carta-porte/importar-xml"        element={<CompanyOnlyRoute><CartaPorteImportarXmlPage /></CompanyOnlyRoute>} />
            <Route path="carta-porte/mercancias"          element={<CompanyOnlyRoute><CartaPorteMercanciasPage /></CompanyOnlyRoute>} />
            <Route path="xml-super-import"                element={<CompanyOnlyRoute><SuperXMLImportPage /></CompanyOnlyRoute>} />
            <Route path="tipos-de-cambio"                 element={<CompanyOnlyRoute><TiposDeCambioPage /></CompanyOnlyRoute>} />
            <Route path="diferencia-cambiaria"            element={<CompanyOnlyRoute><DiferenciaCambiariaPage /></CompanyOnlyRoute>} />
            {/* Inventarios, compras y tesorería — fusión ERP */}
            <Route path="warehouses"                      element={<CompanyOnlyRoute><WarehousesPage /></CompanyOnlyRoute>} />
            <Route path="inventory"                       element={<CompanyOnlyRoute><InventoryPage /></CompanyOnlyRoute>} />
            <Route path="purchase-orders"                 element={<CompanyOnlyRoute><PurchaseOrdersPage /></CompanyOnlyRoute>} />
            <Route path="pos"                             element={<CompanyOnlyRoute><PointOfSalePage /></CompanyOnlyRoute>} />
            <Route path="treasury"                        element={<CompanyOnlyRoute><TreasuryPage /></CompanyOnlyRoute>} />
            <Route path="physical-counts"                 element={<CompanyOnlyRoute><PhysicalCountPage /></CompanyOnlyRoute>} />
            <Route path="company"                         element={<CompanyOnlyRoute><CompanyProfilePage /></CompanyOnlyRoute>} />

            {/* Módulos de plataforma — SOLO SUPER_ADMIN (guard por URL directa) */}
            <Route path="admin/packages"  element={<SuperAdminRoute><AdminPackagesPage /></SuperAdminRoute>} />
            <Route path="admin/billing"   element={<SuperAdminRoute><AdminBillingPage /></SuperAdminRoute>} />
            <Route path="admin/prepaid"   element={<SuperAdminRoute><AdminPrepaidPage /></SuperAdminRoute>} />
            <Route path="admin/users"     element={<SuperAdminRoute><AdminUsersPage /></SuperAdminRoute>} />
            <Route path="admin/companies" element={<SuperAdminRoute><AdminCompaniesPage /></SuperAdminRoute>} />
            <Route path="import-xml"      element={<SuperAdminRoute><ImportXMLWizardPage /></SuperAdminRoute>} />
            <Route path="suppliers"       element={<SuperAdminRoute><SuppliersPage /></SuperAdminRoute>} />

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
