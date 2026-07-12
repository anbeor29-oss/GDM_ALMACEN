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
import { WarehousesPage }     from '@/pages/Warehouses';
import { InventoryPage }      from '@/pages/Inventory';
import { PurchaseOrdersPage } from '@/pages/PurchaseOrders';
import { PointOfSalePage }    from '@/pages/PointOfSale';
import { TreasuryPage }       from '@/pages/Treasury';
import { PhysicalCountPage }  from '@/pages/PhysicalCount';
import { TeamPage }           from '@/pages/Team';
import { useAuthStore } from '@/store/auth';

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

          {/* Layout privado — bajo "/" — pero la ruta index es el landing público */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            {/* Operación diaria — ADMIN / MANAGER / USER (SUPER_ADMIN redirigido) */}
            <Route path="dashboard"    element={<CompanyOnlyRoute><DashboardPage /></CompanyOnlyRoute>} />
            <Route path="invoices"     element={<CompanyOnlyRoute><InvoicesPage /></CompanyOnlyRoute>} />
            <Route path="invoices/new"       element={<CompanyOnlyRoute><NewInvoicePage /></CompanyOnlyRoute>} />
            <Route path="invoices/:id/edit"  element={<CompanyOnlyRoute><NewInvoicePage /></CompanyOnlyRoute>} />
            <Route path="customers"    element={<CompanyOnlyRoute><CustomersPage /></CompanyOnlyRoute>} />
            <Route path="products"     element={<CompanyOnlyRoute><ProductsPage /></CompanyOnlyRoute>} />
            <Route path="reports"      element={<CompanyOnlyRoute><ReportsPage /></CompanyOnlyRoute>} />
            <Route path="credit-notes" element={<CompanyOnlyRoute><CreditNotesPage /></CompanyOnlyRoute>} />
            <Route path="warehouses"   element={<CompanyOnlyRoute><WarehousesPage /></CompanyOnlyRoute>} />
            <Route path="inventory"    element={<CompanyOnlyRoute><InventoryPage /></CompanyOnlyRoute>} />
            <Route path="purchase-orders" element={<CompanyOnlyRoute><PurchaseOrdersPage /></CompanyOnlyRoute>} />
            <Route path="pos"          element={<CompanyOnlyRoute><PointOfSalePage /></CompanyOnlyRoute>} />
            <Route path="treasury"     element={<CompanyOnlyRoute><TreasuryPage /></CompanyOnlyRoute>} />
            <Route path="physical-counts" element={<CompanyOnlyRoute><PhysicalCountPage /></CompanyOnlyRoute>} />
            <Route path="team"         element={<CompanyOnlyRoute><TeamPage /></CompanyOnlyRoute>} />

            {/* Módulos de plataforma — SOLO SUPER_ADMIN (guard por URL directa) */}
            <Route path="admin/packages"  element={<SuperAdminRoute><AdminPackagesPage /></SuperAdminRoute>} />
            <Route path="admin/billing"   element={<SuperAdminRoute><AdminBillingPage /></SuperAdminRoute>} />
            <Route path="admin/prepaid"   element={<SuperAdminRoute><AdminPrepaidPage /></SuperAdminRoute>} />
            <Route path="admin/users"     element={<SuperAdminRoute><AdminUsersPage /></SuperAdminRoute>} />
            <Route path="admin/companies" element={<SuperAdminRoute><AdminCompaniesPage /></SuperAdminRoute>} />
            {/* Compras XML y Proveedores: en GDM ALMACÉN son operación diaria de la
                empresa (alimentan el inventario §5) — accesibles para roles de empresa
                Y para SUPER_ADMIN (impersonando o directo), por eso sin guard de rol. */}
            <Route path="import-xml"      element={<ImportXMLWizardPage />} />
            <Route path="suppliers"       element={<SuppliersPage />} />

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
