/**
 * Permisos por GRUPO DE TRABAJO.
 *
 * El rol (SUPER_ADMIN/ADMIN/MANAGER/USER) define autoridad; el grupo define
 * QUÉ módulos ve/usa un usuario de empresa. Esta es la fuente de verdad — el
 * frontend replica el mismo mapa (frontend/src/utils/permissions.ts). Si
 * cambian los módulos de un grupo, cambiar en AMBOS lados.
 *
 * ADMIN_ALL ve todo. SUPER_ADMIN no usa grupos (opera la plataforma).
 *
 * El vocabulario de grupos vive en un lugar más: el CHECK de users.work_group
 * (migración 2026-07-28c_unificar_work_groups.sql). Agregar un grupo aquí sin
 * agregarlo allá hace fallar el alta de usuarios con ese grupo.
 */

import { Request, Response, NextFunction } from 'express';

export type WorkGroup = 'ADMIN_ALL' | 'VENTAS' | 'ALMACEN' | 'COMPRAS' | 'TESORERIA' | 'PUNTO_VENTA';

/**
 * Claves de módulo protegibles — una por bloque del menú.
 *
 * Nota histórica: cuando esto era SOLO facturación, inventarios/compras/
 * tesorería/POS pertenecían al producto ALMACÉN y no se declaraban aquí. En
 * GDM Nexo los dos productos son uno, así que el mapa cubre el ERP completo:
 * un módulo que exista en el menú y NO aparezca en esta lista no lo puede
 * ocultar ningún grupo.
 */
export type ModuleKey =
  | 'invoices' | 'carta_porte' | 'credit_notes' | 'customers' | 'products'
  | 'xml_reader' | 'inventory' | 'purchasing' | 'suppliers' | 'pos'
  | 'treasury' | 'reports' | 'exchange_rates' | 'auditoria';

const ALL_MODULES: ModuleKey[] = [
  'invoices', 'carta_porte', 'credit_notes', 'customers', 'products',
  'xml_reader', 'inventory', 'purchasing', 'suppliers', 'pos',
  'treasury', 'reports', 'exchange_rates', 'auditoria',
];

/**
 * Módulos permitidos por grupo (dashboard es común, no se lista).
 *
 * Criterio: cada grupo alcanza lo que necesita para trabajar, no lo que "le
 * podría servir". Los cruces son deliberados:
 *   · VENTAS ve exchange_rates porque cotiza y factura en dólares.
 *   · COMPRAS ve inventory (para decidir qué reponer) y products.
 *   · TESORERIA ve suppliers porque les programa pagos.
 * Lo que cada quien puede HACER dentro de esas pantallas lo decide el sistema
 * de capacidades (requireCapability), no este mapa.
 */
export const GROUP_MODULES: Record<WorkGroup, ModuleKey[]> = {
  ADMIN_ALL: ALL_MODULES,
  VENTAS: [
    'invoices', 'carta_porte', 'credit_notes', 'customers', 'products',
    'xml_reader', 'pos', 'reports', 'exchange_rates',
  ],
  ALMACEN:   ['products', 'inventory', 'reports'],
  COMPRAS:   ['purchasing', 'suppliers', 'products', 'inventory', 'xml_reader', 'reports'],
  TESORERIA: ['treasury', 'suppliers', 'exchange_rates', 'reports', 'auditoria'],
  /* Cajero de mostrador: SÓLO la caja.
   *
   * VENTAS ya existía pero alcanza facturas, clientes y Carta Porte, que es
   * demasiado para quien únicamente cobra: un cajero con acceso a facturación
   * puede timbrar por error, y en un turno compartido nadie sabría quién fue.
   *
   * Este mapa es el que MANDA — el del frontend sólo decide qué pinta el menú.
   * Si sólo se hubiera agregado allá, el cajero no vería las otras pantallas
   * pero podría llegar a ellas escribiendo la URL. */
  PUNTO_VENTA: ['pos'],
};

export function groupCanAccess(group: WorkGroup | undefined, mod: ModuleKey): boolean {
  const g = group || 'ADMIN_ALL';
  return (GROUP_MODULES[g] || GROUP_MODULES.ADMIN_ALL).includes(mod);
}

/**
 * Middleware: exige que el usuario pertenezca a un grupo con acceso al módulo.
 * SUPER_ADMIN siempre pasa (opera la plataforma). Usar en rutas sensibles de
 * escritura para que, p.ej., un usuario de VENTAS no modifique inventarios.
 */
export function requireModule(mod: ModuleKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Autenticación requerida' });
    }
    if (req.user.role === 'SUPER_ADMIN') return next();
    const group = (req.user.workGroup as WorkGroup) || 'ADMIN_ALL';
    if (!groupCanAccess(group, mod)) {
      return res.status(403).json({
        success: false,
        message: `Tu grupo de trabajo (${group}) no tiene acceso a este módulo.`,
      });
    }
    return next();
  };
}
