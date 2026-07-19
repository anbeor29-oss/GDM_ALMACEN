/**
 * permissions — grupos de trabajo (work_group) que definen qué MÓDULOS/pantallas
 * ve y puede tocar cada usuario. Ortogonal al rol y a las capacidades finas.
 *
 * SUPER_ADMIN y cualquiera con work_group = ADMIN_ALL ven todo. El resto solo
 * los módulos de su grupo. El backend también lo aplica (requireModule) para que
 * no baste con ocultar el menú.
 */
import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from './errorHandler';

export type WorkGroup = 'ADMIN_ALL' | 'VENTAS' | 'INVENTARIOS' | 'COMPRAS' | 'TESORERIA';

export type ModuleKey =
  | 'dashboard'
  | 'pos' | 'invoices' | 'credit_notes' | 'customers'
  | 'products' | 'inventory' | 'warehouses' | 'physical_counts'
  | 'import_xml' | 'purchase_orders'
  | 'treasury' | 'suppliers'
  | 'reports'
  | 'carta_porte';

/** Módulos por grupo. `dashboard` es común a todos (no se lista aquí).
 *  Carta Porte va con VENTAS porque el complemento acompaña a la factura. */
export const GROUP_MODULES: Record<WorkGroup, ModuleKey[]> = {
  ADMIN_ALL: [
    'pos', 'invoices', 'credit_notes', 'customers',
    'products', 'inventory', 'warehouses', 'physical_counts',
    'import_xml', 'purchase_orders', 'treasury', 'suppliers', 'reports',
    'carta_porte',
  ],
  VENTAS:      ['pos', 'invoices', 'customers', 'credit_notes', 'carta_porte'],
  INVENTARIOS: ['products', 'inventory', 'warehouses', 'physical_counts'],
  COMPRAS:     ['import_xml', 'purchase_orders'],
  TESORERIA:   ['treasury', 'suppliers'],
};

const VALID_GROUPS: WorkGroup[] = ['ADMIN_ALL', 'VENTAS', 'INVENTARIOS', 'COMPRAS', 'TESORERIA'];

export function normalizeGroup(g: unknown): WorkGroup {
  return VALID_GROUPS.includes(g as WorkGroup) ? (g as WorkGroup) : 'ADMIN_ALL';
}

/** ¿El grupo puede acceder al módulo? Dashboard siempre; ADMIN_ALL todo. */
export function groupCanAccess(group: WorkGroup, mod: ModuleKey): boolean {
  if (mod === 'dashboard') return true;
  if (group === 'ADMIN_ALL') return true;
  return GROUP_MODULES[group].includes(mod);
}

/**
 * Middleware: exige que el usuario pueda acceder al módulo `mod`.
 * SUPER_ADMIN pasa siempre; el resto según su work_group.
 */
export function requireModule(mod: ModuleKey) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (role === 'SUPER_ADMIN') return next();
    const group = normalizeGroup((req.user as any)?.workGroup);
    if (groupCanAccess(group, mod)) return next();
    return next(new ForbiddenError(`Tu grupo de trabajo no tiene acceso a este módulo (${mod}).`));
  };
}
