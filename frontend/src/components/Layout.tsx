/**
 * Main Layout Component
 * Sidebar + top bar + outlet de la página activa
 */

import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { GdmLogo } from './GdmLogo';
import {
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Building2,
  ShieldCheck,
  Wallet,
  FileInput,
  Truck,
  DollarSign,
  ShoppingCart,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import api from '@/services/api';
import { IssuerModal } from './IssuerModal';
import { ForcePasswordChange } from './ForcePasswordChange';
import { ImpersonationBanner } from './ImpersonationBanner';
import { canAccess, ModuleKey } from '@/utils/permissions';

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showIssuer, setShowIssuer] = useState(false);
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  // Filtra el menú por grupo de trabajo (ADMIN/SUPER_ADMIN ven todo).
  const can = (m: ModuleKey) => canAccess(user?.role, user?.workGroup, m);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (error) {
      console.error('Logout error:', error);
    }
    logout();
    navigate('/login');
  };

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
                <h1 className="font-semibold text-sm text-slate-800 tracking-tight">GDM ALMACÉN</h1>
                <p className="font-semibold text-xs text-blue-800">High Consulting México</p>
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
          {user?.role !== 'SUPER_ADMIN' && (
            <>
              <NavItem to="/dashboard"    icon={<span className="text-xl leading-none">🏠</span>}  accent="sky"     label="Dashboard"        open={sidebarOpen} />
              {can('pos')             && <NavItem to="/pos"          icon={<span className="text-xl leading-none">🛒</span>}       accent="amber"   label="Punto de venta"   open={sidebarOpen} />}
              {can('invoices')        && <NavItem to="/invoices"     icon={<span className="text-xl leading-none">📄</span>}    accent="amber"   label="Facturas"         open={sidebarOpen} />}
              {can('carta_porte')     && (
                <NavGroup
                  to="/carta-porte"
                  icon={<span className="text-xl leading-none">🚚</span>}
                  label="Carta Porte"
                  accent="sky"
                  open={sidebarOpen}
                  pathPrefix="/carta-porte"
                  children={[
                    { to: '/carta-porte/lugares',      icon: <span className="text-base leading-none">📍</span>, label: 'Lugares frecuentes' },
                    { to: '/carta-porte/vehiculos',    icon: <span className="text-base leading-none">🚚</span>, label: 'Vehículos' },
                    { to: '/carta-porte/aseguradoras', icon: <span className="text-base leading-none">🛡️</span>, label: 'Aseguradoras' },
                    { to: '/carta-porte/operadores',   icon: <span className="text-base leading-none">👤</span>, label: 'Operadores' },
                    { to: '/carta-porte/importar-xml', icon: <span className="text-base leading-none">💼</span>, label: 'Importar XML CP' },
                  ]}
                />
              )}
              {can('credit_notes')    && <NavItem to="/credit-notes" icon={<span className="text-xl leading-none">📉</span>}  accent="rose"    label="Notas de Crédito" open={sidebarOpen} />}
              {can('customers')       && <NavItem to="/customers"    icon={<span className="text-xl leading-none">👥</span>}       accent="emerald" label="Clientes"         open={sidebarOpen} />}
              {can('products')        && <NavItem to="/products"     icon={<span className="text-xl leading-none">📦</span>}       accent="fuchsia" label="Productos"        open={sidebarOpen} />}
              {can('inventory')       && <NavItem to="/inventory"    icon={<span className="text-xl leading-none">📊</span>} accent="fuchsia" label="Inventario"    open={sidebarOpen} />}
              {can('warehouses')      && <NavItem to="/warehouses"   icon={<span className="text-xl leading-none">🏭</span>}   accent="sky"     label="Almacenes"        open={sidebarOpen} />}
              {can('physical_counts') && <NavItem to="/physical-counts" icon={<span className="text-xl leading-none">📋</span>} accent="amber" label="Inventario físico" open={sidebarOpen} />}
              {can('purchase_orders') && <NavItem to="/purchase-orders" icon={<span className="text-xl leading-none">📝</span>} accent="emerald" label="Órdenes de compra" open={sidebarOpen} />}
              {can('import_xml')      && <NavItem to="/import-xml"   icon={<span className="text-xl leading-none">📥</span>}   accent="amber"   label="Compras XML"      open={sidebarOpen} />}
              {can('suppliers')       && <NavItem to="/suppliers"    icon={<span className="text-xl leading-none">🚛</span>}       accent="rose"    label="Proveedores"      open={sidebarOpen} />}
              {can('treasury')        && <NavItem to="/treasury"     icon={<span className="text-xl leading-none">💰</span>}    accent="emerald" label="Tesorería"        open={sidebarOpen} />}
              {can('reports')         && <NavItem to="/reports"      icon={<span className="text-xl leading-none">📈</span>}   accent="violet"  label="Reportes"         open={sidebarOpen} />}
              {user?.role === 'ADMIN' && (
                <NavItem to="/team"       icon={<span className="text-xl leading-none">🔐</span>}  accent="sky"     label="Equipo y permisos" open={sidebarOpen} />
              )}
            </>
          )}

          {/* Módulos de plataforma — SOLO SUPER_ADMIN */}
          {user?.role === 'SUPER_ADMIN' && (
            <>
              <div className={`${sidebarOpen ? 'px-3' : 'text-center'} mb-1`}>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                  {sidebarOpen ? 'Plataforma' : '•'}
                </p>
              </div>
              <NavItem to="/admin/companies" icon={<Building2 size={20} />}  accent="sky"     label="Empresas"          open={sidebarOpen} />
              <NavItem to="/admin/users"     icon={<ShieldCheck size={20} />} accent="emerald" label="Usuarios"          open={sidebarOpen} />
              <NavItem to="/admin/packages"  icon={<Wallet size={20} />}     accent="violet"  label="Paquetes fiscales" open={sidebarOpen} />
              <NavItem to="/admin/billing"   icon={<DollarSign size={20} />} accent="emerald" label="Facturación y consumo" open={sidebarOpen} />
              <NavItem to="/admin/prepaid"   icon={<ShoppingCart size={20} />} accent="fuchsia" label="Compras prepago" open={sidebarOpen} />
              <NavItem to="/import-xml"      icon={<FileInput size={20} />}  accent="amber"   label="Importar XML"      open={sidebarOpen} />
              <NavItem to="/suppliers"       icon={<Truck size={20} />}      accent="rose"    label="Proveedores"       open={sidebarOpen} />
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

/**
 * NavGroup — item de sidebar con submenú expandible. El header actúa como link
 * al `to` del padre y a la vez toggle del submenú. Se autoexpande si la ruta
 * activa cae bajo `pathPrefix`. Con sidebar colapsado (w-20), los hijos se
 * ocultan (solo el icono del padre visible).
 */
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
        <NavLink
          to={to}
          title={!open ? label : undefined}
          className="flex-1 flex items-center gap-3 px-3 py-2.5"
        >
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
