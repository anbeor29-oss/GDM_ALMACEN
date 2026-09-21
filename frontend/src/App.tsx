/**
 * Main App Component
 * Router configuration
 */

import { useEffect, useRef, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { LoginPage } from '@/pages/Login';
import { PublicHomePage } from '@/pages/PublicHome';
import { TerminosPage, PrivacidadPage } from '@/pages/LegalDoc';
import { CheckadorKioscoPage } from '@/pages/nomina/CheckadorKiosco';
import { CheckadorEnrolarPage } from '@/pages/nomina/CheckadorEnrolar';
import { ChecadorRegistroPage } from '@/pages/nomina/RegistroAsistencia';
import { ChecadorCampoPage } from '@/pages/nomina/ChecadorCampo';
import { useAuthStore } from '@/store/auth';
import { canAccess, type ModuleKey, homeDe } from '@/utils/permissions';

/**
 * TODO el ERP de escritorio va aquí, cargado PEREZOSO. Así el kiosco/checador
 * (tabletas y celulares modestos) NO descarga el ERP completo para abrirse: sólo
 * baja este pedazo quien entra de verdad al sistema. Ver ErpPrivado.tsx.
 */
const ErpPrivado = lazy(() => import('./ErpPrivado'));

/** Se ve un instante mientras baja el pedazo del ERP (solo la primera vez). */
function CargandoErp() {
  return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Cargando…</div>;
}

const queryClient = new QueryClient();

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
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
export function CompanyOnlyRoute({ children }: { children: React.ReactNode }) {
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
export function ModuleRoute({ module, children }: { module: ModuleKey; children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role === 'SUPER_ADMIN') return <Navigate to="/admin/companies" replace />;
  /* Se rebota a la casa del grupo, NO al dashboard: si el grupo tampoco lo
   * alcanza —y seis de los siete no— el rebote sería a otra negativa. */
  if (!canAccess(user?.workGroup, module)) return <Navigate to={homeDe(user)} replace />;
  return <>{children}</>;
}

/**
 * Rutas del CHECADOR a pantalla completa (kiosco y campo). Las alcanza la cuenta
 * UNIVERSAL del grupo CHECADOR —que sólo checa— además de Recursos Humanos y
 * ADMIN. Enrolar y el registro NO usan esto: siguen con ModuleRoute('nomina'),
 * así que la cuenta CHECADOR queda fuera de ellos.
 */
function ChecadorRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role === 'SUPER_ADMIN') return <Navigate to="/admin/companies" replace />;
  const g = (user?.workGroup || (user as any)?.work_group || 'ADMIN_ALL') as string;
  if (!['ADMIN_ALL', 'RECURSOS_HUMANOS', 'CHECADOR'].includes(g)) return <Navigate to={homeDe(user)} replace />;
  return <>{children}</>;
}

/**
 * Ruta gateada por ROL ADMIN de empresa. Gestionar usuarios es una cuestión de
 * AUTORIDAD, no de grupo de trabajo: por eso no pasa por ModuleRoute. El
 * SUPER_ADMIN administra usuarios desde /admin/users, no desde aquí.
 */
export function CompanyAdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  if (user?.role !== 'ADMIN') return <Navigate to={homeDe(user)} replace />;
  return <>{children}</>;
}

/**
 * Módulos administrativos de plataforma — sólo SUPER_ADMIN.
 * Si un usuario común escribe /import-xml o /admin/... a mano, lo enviamos
 * al dashboard en lugar de renderizar la página.
 */
export function SuperAdminRoute({ children }: { children: React.ReactNode }) {
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

          {/* PANTALLA COMPLETA, SIN la cáscara del ERP (sidebar/header): el checador
              corre en tabletas y celulares y debe verse solo él —no "todo el
              sistema"—. Requiere login (ProtectedRoute) y el módulo nómina, pero NO
              el Layout de escritorio. */}
          <Route element={<ProtectedRoute><Outlet /></ProtectedRoute>}>
            {/* Checar: lo alcanza la cuenta universal CHECADOR (+ RH/ADMIN). */}
            <Route path="checador/kiosco"   element={<ChecadorRoute><CheckadorKioscoPage /></ChecadorRoute>} />
            <Route path="checador/campo"    element={<ChecadorRoute><ChecadorCampoPage /></ChecadorRoute>} />
            {/* Enrolar y registro: sólo RH/ADMIN (la cuenta CHECADOR rebota al kiosco). */}
            <Route path="checador/enrolar"  element={<ModuleRoute module="nomina"><CheckadorEnrolarPage /></ModuleRoute>} />
            <Route path="checador/registro" element={<ModuleRoute module="nomina"><ChecadorRegistroPage /></ModuleRoute>} />
          </Route>

          {/* La raíz "/" — landing público, o redirect si hay sesión (liviano). */}
          <Route path="/" element={<RootLanding />} />

          {/* TODO lo demás —el ERP de escritorio y las rutas desconocidas— entra
              al módulo PEREZOSO. El checador (kiosco/campo/registro/enrolar) queda
              arriba y NO lo descarga. */}
          <Route path="/*" element={<Suspense fallback={<CargandoErp />}><ErpPrivado /></Suspense>} />
        </Routes>
      </Router>
    </QueryClientProvider>
  );
}
