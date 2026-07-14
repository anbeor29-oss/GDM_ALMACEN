/**
 * permissions — grupos de trabajo (espejo del backend). Definen qué módulos ve
 * cada usuario en el menú. ADMIN, SUPER_ADMIN y grupo ADMIN_ALL ven todo.
 */
export type WorkGroup = 'ADMIN_ALL' | 'VENTAS' | 'INVENTARIOS' | 'COMPRAS' | 'TESORERIA';

export type ModuleKey =
  | 'dashboard'
  | 'pos' | 'invoices' | 'credit_notes' | 'customers'
  | 'products' | 'inventory' | 'warehouses' | 'physical_counts'
  | 'import_xml' | 'purchase_orders'
  | 'treasury' | 'suppliers'
  | 'reports';

/** Módulos por grupo. `dashboard` es común a todos. */
export const GROUP_MODULES: Record<WorkGroup, ModuleKey[]> = {
  ADMIN_ALL: [
    'pos', 'invoices', 'credit_notes', 'customers',
    'products', 'inventory', 'warehouses', 'physical_counts',
    'import_xml', 'purchase_orders', 'treasury', 'suppliers', 'reports',
  ],
  VENTAS:      ['pos', 'invoices', 'customers', 'credit_notes'],
  INVENTARIOS: ['products', 'inventory', 'warehouses', 'physical_counts'],
  COMPRAS:     ['import_xml', 'purchase_orders'],
  TESORERIA:   ['treasury', 'suppliers'],
};

export const WORK_GROUP_LABELS: Record<WorkGroup, string> = {
  ADMIN_ALL:   'Acceso total (todos los módulos)',
  VENTAS:      'Ventas (POS, facturas, clientes, notas de crédito)',
  INVENTARIOS: 'Inventarios (productos, inventario, almacenes, físico)',
  COMPRAS:     'Compras (compras XML, órdenes de compra)',
  TESORERIA:   'Tesorería (tesorería, proveedores)',
};

const VALID_GROUPS: WorkGroup[] = ['ADMIN_ALL', 'VENTAS', 'INVENTARIOS', 'COMPRAS', 'TESORERIA'];

export function normalizeGroup(g: unknown): WorkGroup {
  return VALID_GROUPS.includes(g as WorkGroup) ? (g as WorkGroup) : 'ADMIN_ALL';
}

/** ¿El usuario (rol + grupo) puede ver el módulo? Dashboard siempre. */
export function canAccess(role: string | undefined, group: unknown, mod: ModuleKey): boolean {
  if (mod === 'dashboard') return true;
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return true;
  const g = normalizeGroup(group);
  if (g === 'ADMIN_ALL') return true;
  return GROUP_MODULES[g].includes(mod);
}
