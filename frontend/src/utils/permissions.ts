/**
 * Permisos por GRUPO DE TRABAJO (espejo de backend/src/middleware/permissions.ts).
 *
 * El rol define autoridad; el grupo define QUÉ módulos ve el usuario de empresa.
 * ADMIN_ALL ve todo. SUPER_ADMIN no usa grupos (opera la plataforma).
 * Si cambian los módulos de un grupo, actualizar TAMBIÉN el backend.
 *
 * Este archivo solo esconde entradas del menú: es comodidad, no seguridad.
 * Quien corta el acceso de verdad es el backend (requireModule / capacidades).
 */

export type WorkGroup = 'ADMIN_ALL' | 'VENTAS' | 'ALMACEN' | 'COMPRAS' | 'TESORERIA';

/**
 * Una clave por bloque del menú. 'dashboard' es común a todos los grupos y se
 * lista explícitamente para que no haga falta un caso especial en canAccess.
 */
export type ModuleKey =
  | 'dashboard'
  | 'invoices' | 'carta_porte' | 'credit_notes' | 'customers' | 'products'
  | 'xml_reader' | 'inventory' | 'purchasing' | 'suppliers' | 'pos'
  | 'treasury' | 'reports' | 'exchange_rates';

const ALL_MODULES: ModuleKey[] = [
  'dashboard',
  'invoices', 'carta_porte', 'credit_notes', 'customers', 'products',
  'xml_reader', 'inventory', 'purchasing', 'suppliers', 'pos',
  'treasury', 'reports', 'exchange_rates',
];

/**
 * Criterio de reparto: cada grupo alcanza lo que necesita para trabajar, no lo
 * que "le podría servir". Los cruces son deliberados — VENTAS ve tipos de
 * cambio (factura en dólares), COMPRAS ve existencias (para decidir qué
 * reponer), TESORERIA ve proveedores (les programa pagos).
 */
export const GROUP_MODULES: Record<WorkGroup, ModuleKey[]> = {
  ADMIN_ALL: ALL_MODULES,
  VENTAS: [
    'dashboard', 'invoices', 'carta_porte', 'credit_notes', 'customers',
    'products', 'xml_reader', 'pos', 'reports', 'exchange_rates',
  ],
  ALMACEN:   ['dashboard', 'products', 'inventory', 'reports'],
  COMPRAS:   ['dashboard', 'purchasing', 'suppliers', 'products', 'inventory',
              'xml_reader', 'reports'],
  TESORERIA: ['dashboard', 'treasury', 'suppliers', 'exchange_rates', 'reports'],
};

/** Etiquetas legibles de cada grupo (para selectores). */
export const WORK_GROUP_LABELS: Record<WorkGroup, string> = {
  ADMIN_ALL: 'Administrador (todos los módulos)',
  VENTAS:    'Ventas (facturas, Carta Porte, clientes, NC, POS)',
  ALMACEN:   'Almacén (productos, existencias, inventario físico)',
  COMPRAS:   'Compras (órdenes, recepción XML, proveedores)',
  TESORERIA: 'Tesorería (pagos a proveedores, tipos de cambio)',
};

/** Detalle de lo que ve cada grupo — se muestra bajo el selector al dar de alta. */
export const WORK_GROUP_DETAIL: Record<WorkGroup, string> = {
  ADMIN_ALL: 'Todos los módulos del sistema.',
  VENTAS:    'Facturas, Carta Porte, Notas de crédito, Clientes, Productos, ' +
             'Lector de XML, Punto de Venta, Reportes y Monedas.',
  ALMACEN:   'Productos, Almacén (existencias, almacenes, inventario físico) y ' +
             'Reportes. No ve facturación, compras ni tesorería.',
  COMPRAS:   'Compras (órdenes y recepción de XML), Proveedores, Productos, ' +
             'existencias de Almacén, Lector de XML y Reportes.',
  TESORERIA: 'Tesorería, Proveedores, Monedas y Reportes. No ve facturación ni almacén.',
};

export function canAccess(group: string | undefined, mod: ModuleKey): boolean {
  const g = (group as WorkGroup) || 'ADMIN_ALL';
  return (GROUP_MODULES[g] || GROUP_MODULES.ADMIN_ALL).includes(mod);
}
