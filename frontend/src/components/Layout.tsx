/**
 * Main Layout Component
 * Sidebar + top bar + outlet de la página activa
 */

import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { GdmLogo } from './GdmLogo';
import { Emoji3D } from './Emoji3D';
import {
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Building2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { canAccess, type ModuleKey } from '@/utils/permissions';
import { useState, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import { useIdleTimeout } from '@/hooks/useIdleTimeout';
import api from '@/services/api';
import { IssuerModal } from './IssuerModal';
import { ForcePasswordChange } from './ForcePasswordChange';
import { ImpersonationBanner } from './ImpersonationBanner';

/** Minutos de inactividad tras los cuales se cierra la sesión. */
const IDLE_MINUTES = 10;

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showIssuer, setShowIssuer] = useState(false);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const doLogout = useCallback(async (reason?: 'idle') => {
    try {
      await api.logout();
    } catch (error) {
      console.error('Logout error:', error);
    }
    logout();
    navigate('/login', { replace: true });
    if (reason === 'idle') {
      // Aviso tras redirigir — el usuario entiende por qué salió.
      setTimeout(() => {
        alert(`Tu sesión se cerró por ${IDLE_MINUTES} minutos de inactividad. Vuelve a iniciar sesión.`);
      }, 100);
    }
  }, [logout, navigate]);

  const handleLogout = () => doLogout();

  // Cierre automático por inactividad (10 min). El hook reinicia el conteo
  // con cualquier interacción del usuario.
  useIdleTimeout(() => doLogout('idle'), IDLE_MINUTES * 60 * 1000);

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <ImpersonationBanner />
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar — claro y moderno con acentos de color */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } bg-white text-slate-700 transition-all duration-300 flex flex-col border-r border-slate-200 shadow-sm`}
      >
        {/* Header del sidebar */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          {sidebarOpen && (
            <div className="flex items-center gap-2.5">
              <GdmLogo size={40} className="shadow-md shrink-0" />
              <div className="leading-tight">
                <h1 className="font-semibold text-sm text-slate-800 tracking-tight">GDM NEXO</h1>
                <p className="font-semibold text-xs text-blue-800">GDM HIGH CONSULTING MÉXICO</p>
              </div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 rounded-lg transition-colors"
            title={sidebarOpen ? 'Colapsar' : 'Expandir'}
          >
            {sidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
          </button>
        </div>

        {/* Navegación */}
        <nav className="flex-1 p-3 space-y-1">
          {/* Operación diaria — SOLO para roles de empresa (no SUPER_ADMIN).
              El SUPER_ADMIN es operador de la plataforma; los módulos operativos
              pertenecen a cada empresa usuaria y aparecen cuando impersona. */}
          {user?.role !== 'SUPER_ADMIN' && (() => {
            const g = user?.workGroup;
            const show = (m: ModuleKey) => canAccess(g, m);
            // Cada entrada se muestra solo si el grupo de trabajo la permite.
            // El dashboard es común a todos.
            const emoji3D = (e: string) => <Emoji3D e={e} />;
            return (
              <>
                {/* Orden solicitado (V2): 1 Dashboard, 2 Facturas, 3 Carta Porte,
                    4 Notas de Crédito, 5 Productos, 6 Lector de XML, 7 Reportes,
                    8 Contrato, y al final Datos de la Empresa. Iconos emoji 3D
                    con drop-shadow para look moderno. Usuarios queda oculto en
                    esta versión (V2 se enfoca en facturación + CP). */}
                <NavItem to="/dashboard"    icon={emoji3D('🏠')} accent="sky"     label="Dashboard"        open={sidebarOpen} />
                {show('invoices')     && <NavItem to="/invoices"     icon={emoji3D('🧾')} accent="amber"   label="Facturas"         open={sidebarOpen} />}
                {show('carta_porte') && (
                  <NavGroup
                    to="/carta-porte"
                    icon={emoji3D('🚚')}
                    label="Carta Porte"
                    accent="amber"
                    open={sidebarOpen}
                    pathPrefix="/carta-porte"
                    children={[
                      { to: '/carta-porte/lugares',      icon: emoji3D('📍'), label: 'Lugares frecuentes' },
                      { to: '/carta-porte/vehiculos',    icon: emoji3D('🚛'), label: 'Vehículos' },
                      { to: '/carta-porte/aseguradoras', icon: emoji3D('🛡️'), label: 'Aseguradoras' },
                      { to: '/carta-porte/operadores',   icon: emoji3D('👨‍✈️'), label: 'Operadores' },
                      { to: '/carta-porte/mercancias',   icon: emoji3D('📦'), label: 'Mercancías' },
                    ]}
                  />
                )}
                {show('credit_notes') && <NavItem to="/credit-notes" icon={emoji3D('📉')} accent="rose"    label="Notas de Crédito" open={sidebarOpen} />}
                {show('credit_notes') && <NavItem to="/payments"     icon={emoji3D('💵')} accent="emerald" label="Complementos de Pago" open={sidebarOpen} />}
                {show('products')     && <NavItem to="/products"     icon={emoji3D('📦')} accent="fuchsia" label="Productos"        open={sidebarOpen} />}
                {show('customers')    && <NavItem to="/customers"    icon={emoji3D('👥')} accent="emerald" label="Clientes"         open={sidebarOpen} />}
                {show('xml_reader')   && <NavItem to="/xml-super-import" icon={emoji3D('📥')} accent="violet"  label="Lector de XML"    open={sidebarOpen} />}
                {/* Inventarios, compras y tesorería — fusión ERP */}
                {show('inventory') && (
                  <NavGroup
                    to="/inventory"
                    icon={emoji3D('🏭')}
                    label="Almacén"
                    accent="amber"
                    open={sidebarOpen}
                    pathPrefix="/inventory"
                    children={[
                      { to: '/inventory',        icon: emoji3D('📊'), label: 'Existencias' },
                      { to: '/warehouses',       icon: emoji3D('🏬'), label: 'Almacenes' },
                      { to: '/physical-counts',  icon: emoji3D('📋'), label: 'Inventario físico' },
                      { to: '/kardex',           icon: emoji3D('📒'), label: 'Kardex' },
                    ]}
                  />
                )}
                {/* Compras y Proveedores comparten menú pero no grupo: tesorería
                    ve proveedores sin ver órdenes de compra, así que las hijas
                    se filtran una por una y el grupo aparece solo si queda alguna. */}
                {(() => {
                  const hijas = [
                    show('purchasing') && { to: '/faltantes', icon: emoji3D('🚨'), label: 'Faltantes' },
                    show('purchasing') && { to: '/purchase-orders', icon: emoji3D('📝'), label: 'Órdenes de compra' },
                    show('purchasing') && { to: '/compras/xml',     icon: emoji3D('📥'), label: 'Recibir XML' },
                    show('suppliers')  && { to: '/suppliers',       icon: emoji3D('🚚'), label: 'Proveedores' },
                  ].filter(Boolean) as Array<{ to: string; icon: JSX.Element; label: string }>;
                  if (hijas.length === 0) return null;
                  return (
                    <NavGroup
                      to={hijas[0].to}
                      icon={emoji3D('🛒')}
                      label="Compras"
                      accent="emerald"
                      open={sidebarOpen}
                      pathPrefix="/purchase-orders"
                      children={hijas}
                    />
                  );
                })()}
                {show('pos')          && <NavItem to="/pos"          icon={emoji3D('🧮')} accent="rose"    label="Punto de Venta"   open={sidebarOpen} />}
                {show('treasury')     && <NavItem to="/treasury"     icon={emoji3D('🏦')} accent="sky"     label="Tesorería"        open={sidebarOpen} />}
                {show('reports')      && <NavItem to="/reports"      icon={emoji3D('📊')} accent="violet"  label="Reportes"         open={sidebarOpen} />}
                {show('exchange_rates') && (
                  <NavGroup
                    to="/tipos-de-cambio"
                    icon={emoji3D('💱')}
                    label="Monedas"
                    accent="emerald"
                    open={sidebarOpen}
                    pathPrefix="/tipos-de-cambio"
                    children={[
                      { to: '/tipos-de-cambio',      icon: emoji3D('🪙'), label: 'Tipos de cambio' },
                      { to: '/diferencia-cambiaria', icon: emoji3D('⚖️'), label: 'Diferencia cambiaria' },
                    ]}
                  />
                )}
                {user?.role === 'ADMIN' && <NavItem to="/contract"   icon={emoji3D('📜')} accent="sky"     label="Contrato"         open={sidebarOpen} />}
                {/* "Datos de la empresa" ya vive en el modal del emisor
                    (top bar → botón DATOS DE MI EMPRESA), incluye el
                    ManifestSigner. Se retira del sidebar para no duplicar. */}
              </>
            );
          })()}

          {/* Módulos de plataforma — SOLO SUPER_ADMIN */}
          {user?.role === 'SUPER_ADMIN' && (
            <>
              <div className={`${sidebarOpen ? 'px-3' : 'text-center'} mb-1`}>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                  {sidebarOpen ? 'Plataforma' : '•'}
                </p>
              </div>
              <NavItem to="/admin/companies" icon={<Emoji3D e="🏢" />} accent="sky"     label="Empresas"              open={sidebarOpen} />
              <NavItem to="/admin/users"     icon={<Emoji3D e="🛡️" />} accent="emerald" label="Usuarios"              open={sidebarOpen} />
              <NavItem to="/admin/accesos"  icon={<Emoji3D e="🔗" />} accent="sky"     label="Accesos por empresa"   open={sidebarOpen} />
              <NavItem to="/admin/packages"  icon={<Emoji3D e="💳" />} accent="violet"  label="Paquetes fiscales"     open={sidebarOpen} />
              <NavItem to="/admin/billing"   icon={<Emoji3D e="💰" />} accent="emerald" label="Facturación y consumo" open={sidebarOpen} />
              <NavItem to="/admin/prepaid"   icon={<Emoji3D e="🛒" />} accent="fuchsia" label="Compras prepago"       open={sidebarOpen} />
              <NavItem to="/admin/promocion" icon={<Emoji3D e="🎁" />} accent="amber"   label="Promoción y cobros"    open={sidebarOpen} />
              <NavItem to="/import-xml"      icon={<Emoji3D e="📥" />} accent="amber"   label="Importar XML"          open={sidebarOpen} />
              {/* Proveedores ya vive en el grupo Compras, que sí ve el ADMIN
                  de la empresa. Aquí duplicaba la entrada. */}
            </>
          )}
        </nav>

        {/* Bloque Emisor + Sesión + Salir */}
        <div className="border-t border-slate-200">
          {/* Emisor (datos de la empresa que factura) */}
          <button
            onClick={() => setShowIssuer(true)}
            className="w-full flex items-center gap-3 px-3 py-3 hover:bg-slate-50 transition-colors text-left group"
            title="Datos del emisor"
          >
            <div className="w-9 h-9 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0 ring-1 ring-indigo-100">
              <Building2 size={18} className="text-indigo-600" />
            </div>
            {sidebarOpen && (
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Emisor</p>
                <p className="text-sm text-slate-700 truncate group-hover:text-indigo-700">
                  Datos de mi empresa
                </p>
              </div>
            )}
          </button>

          {/* Sesión + Salir */}
          <div className="p-3 border-t border-slate-200 bg-slate-50/50">
            {sidebarOpen && (
              <div className="px-3 py-2 mb-1">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Sesión</p>
                <p className="text-sm text-slate-700 truncate">{user?.email}</p>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-600 hover:bg-rose-50 hover:text-rose-600 transition-colors"
            >
              <LogOut size={20} />
              {sidebarOpen && <span className="text-sm font-medium">Cerrar sesión</span>}
            </button>
          </div>
        </div>
      </aside>

      {/* Contenido principal */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-800">
            Bienvenido, <span className="text-blue-600">{user?.email}</span>
          </h2>
          <div className="flex items-center gap-4">
            <span className="text-xs text-blue-700 bg-blue-100 px-3 py-1 rounded-full font-medium">
              {user?.role}
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-auto">
          <div className="p-8">
            <Outlet />
          </div>
        </div>
      </main>

      {showIssuer && user?.companyId && (
        <IssuerModal companyId={user.companyId} onClose={() => setShowIssuer(false)} />
      )}

      {/* Modal NO descartable que aparece tras login si la contraseña sigue siendo temporal */}
      {user?.passwordChangeRequired && <ForcePasswordChange />}
    </div>
    </div>
  );
}

type AccentColor = 'sky' | 'amber' | 'rose' | 'emerald' | 'fuchsia' | 'violet';

const ACCENT_MAP: Record<AccentColor, { activeBg: string; activeText: string; iconActive: string; iconIdle: string; bar: string }> = {
  sky:     { activeBg: 'bg-sky-50',     activeText: 'text-sky-700',     iconActive: 'text-sky-600',     iconIdle: 'text-slate-400 group-hover:text-sky-600',     bar: 'bg-sky-500' },
  amber:   { activeBg: 'bg-amber-50',   activeText: 'text-amber-700',   iconActive: 'text-amber-600',   iconIdle: 'text-slate-400 group-hover:text-amber-600',   bar: 'bg-amber-500' },
  rose:    { activeBg: 'bg-rose-50',    activeText: 'text-rose-700',    iconActive: 'text-rose-600',    iconIdle: 'text-slate-400 group-hover:text-rose-600',    bar: 'bg-rose-500' },
  emerald: { activeBg: 'bg-emerald-50', activeText: 'text-emerald-700', iconActive: 'text-emerald-600', iconIdle: 'text-slate-400 group-hover:text-emerald-600', bar: 'bg-emerald-500' },
  fuchsia: { activeBg: 'bg-fuchsia-50', activeText: 'text-fuchsia-700', iconActive: 'text-fuchsia-600', iconIdle: 'text-slate-400 group-hover:text-fuchsia-600', bar: 'bg-fuchsia-500' },
  violet:  { activeBg: 'bg-violet-50',  activeText: 'text-violet-700',  iconActive: 'text-violet-600',  iconIdle: 'text-slate-400 group-hover:text-violet-600',  bar: 'bg-violet-500' },
};

interface NavChild { to: string; icon: React.ReactNode; label: string; }

/** NavGroup — item con submenú expandible; el header linkea al padre y a la vez
 *  hace toggle. Se autoexpande si la ruta activa cae bajo pathPrefix. */
function NavGroup({
  to, icon, label, open, accent, pathPrefix, children,
}: {
  to: string; icon: React.ReactNode; label: string; open: boolean;
  accent: AccentColor; pathPrefix: string; children: NavChild[];
}) {
  const c = ACCENT_MAP[accent];
  const location = useLocation();
  const isUnderGroup = location.pathname === to || location.pathname.startsWith(pathPrefix + '/');
  const [expanded, setExpanded] = useState<boolean>(isUnderGroup);
  const parentActive = location.pathname === to;

  return (
    <div>
      <div className={`flex items-center rounded-lg transition-all group relative ${
        parentActive ? `${c.activeBg} ${c.activeText} font-medium` : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}>
        {parentActive && (
          <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 ${c.bar} rounded-r`} />
        )}
        <NavLink to={to} title={!open ? label : undefined} className="flex-1 flex items-center gap-3 px-3 py-2.5">
          <span className={parentActive ? c.iconActive : c.iconIdle}>{icon}</span>
          {open && <span className="text-sm">{label}</span>}
        </NavLink>
        {open && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-2 text-slate-400 hover:text-slate-700"
            title={expanded ? 'Colapsar' : 'Expandir'}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>
      {open && expanded && (
        <div className="ml-6 mt-0.5 space-y-0.5 border-l border-slate-200 pl-3">
          {children.map(ch => (
            <NavLink
              key={ch.to}
              to={ch.to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                  isActive
                    ? `${c.activeBg} ${c.activeText} font-medium`
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                }`
              }
            >
              <span className="text-slate-400">{ch.icon}</span>
              <span>{ch.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function NavItem({
  to,
  icon,
  label,
  open,
  accent,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  open: boolean;
  accent: AccentColor;
}) {
  const c = ACCENT_MAP[accent];
  return (
    <NavLink
      to={to}
      title={!open ? label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group relative ${
          isActive
            ? `${c.activeBg} ${c.activeText} font-medium`
            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 ${c.bar} rounded-r`} />
          )}
          <span className={isActive ? c.iconActive : c.iconIdle}>{icon}</span>
          {open && <span className="text-sm">{label}</span>}
        </>
      )}
    </NavLink>
  );
}
