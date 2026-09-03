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

export type WorkGroup =
  | 'ADMIN_ALL' | 'VENTAS' | 'ALMACEN' | 'COMPRAS' | 'TESORERIA' | 'PUNTO_VENTA'
  | 'RECURSOS_HUMANOS' | 'CONTABILIDAD';

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
  | 'treasury' | 'reports' | 'exchange_rates' | 'auditoria' | 'mensajes'
  | 'nomina' | 'contabilidad';

const ALL_MODULES: ModuleKey[] = [
  'invoices', 'carta_porte', 'credit_notes', 'customers', 'products',
  'xml_reader', 'inventory', 'purchasing', 'suppliers', 'pos',
  'treasury', 'reports', 'exchange_rates', 'auditoria', 'mensajes',
  'nomina', 'contabilidad',
];

/**
 * Módulos permitidos por grupo (dashboard es común, no se lista).
 *
 * Criterio: cada grupo alcanza lo que necesita para trabajar, no lo que "le
 * podría servir". Los cruces son deliberados:
 *   · VENTAS ve exchange_rates porque cotiza y factura en dólares.
 *   · COMPRAS ve products, pero NO el módulo de almacén: pide y recibe, no
 *     administra existencias. Lo que necesita saber —qué falta— lo tiene en su
 *     propia pantalla de Faltantes, que vive en compras.
 *   · TESORERIA ve suppliers porque les programa pagos, y NO auditoría:
 *     cotejar lo que el SAT dice de nuestros comprobantes es otro trabajo.
 * Lo que cada quien puede HACER dentro de esas pantallas lo decide el sistema
 * de capacidades (requireCapability), no este mapa.
 */
/* NOTA SOBRE EL DASHBOARD, EL CONTRATO Y LOS REPORTES
 *
 * Ninguno aparece en las listas de los grupos operativos, y es a propósito: el
 * resumen del negocio, las condiciones comerciales con GDM y los reportes
 * —ventas por periodo, saldos, márgenes— son información de la DIRECCIÓN. Quien
 * captura no los necesita para trabajar, y verlos es ver el negocio entero.
 *
 * Ojo: los reportes DE NÓMINA son otra cosa y siguen con Recursos Humanos.
 * Cuelgan del módulo 'nomina', no de 'reports'. */
export const GROUP_MODULES: Record<WorkGroup, ModuleKey[]> = {
  /* 'nomina' sólo la alcanzan ADMIN_ALL y RECURSOS_HUMANOS: los sueldos, la
   * CURP, las cuentas bancarias y las órdenes de pensión alimenticia son el
   * dato más sensible del sistema, y no es un módulo que se le encienda a quien
   * captura facturas. */
  ADMIN_ALL: ALL_MODULES,
  VENTAS: [
    'invoices', 'carta_porte', 'credit_notes', 'customers', 'products',
    'xml_reader', 'pos', 'exchange_rates', 'mensajes',
  ],
  ALMACEN:   ['products', 'inventory', 'mensajes'],
  COMPRAS:   ['purchasing', 'suppliers', 'products', 'xml_reader', 'mensajes'],
  TESORERIA: ['treasury', 'suppliers', 'exchange_rates', 'mensajes'],
  /* Cajero de mostrador: SÓLO la caja.
   *
   * VENTAS ya existía pero alcanza facturas, clientes y Carta Porte, que es
   * demasiado para quien únicamente cobra: un cajero con acceso a facturación
   * puede timbrar por error, y en un turno compartido nadie sabría quién fue.
   *
   * Este mapa es el que MANDA — el del frontend sólo decide qué pinta el menú.
   * Si sólo se hubiera agregado allá, el cajero no vería las otras pantallas
   * pero podría llegar a ellas escribiendo la URL. */
  /* El cajero recibe recados como cualquiera: 'se acabó el rollo de la
   * impresora' tiene que poder salir de la caja. */
  PUNTO_VENTA: ['pos', 'mensajes'],
  /* Recursos Humanos: la nómina completa y nada más.
   *
   * Ve 'nomina' y 'xml_reader' —lo segundo porque el expediente del personal se
   * puede rescatar de los recibos ya timbrados, y ese es justamente su trabajo—
   * más reportes y mensajes. NO ve facturas, clientes, inventarios ni tesorería:
   * quien maneja sueldos no necesita ver las ventas, y al revés tampoco. */
  RECURSOS_HUMANOS: ['nomina', 'xml_reader', 'mensajes'],

  /* Contabilidad: el catálogo, las pólizas y los estados financieros.
   *
   * Ve 'contabilidad' y, en sólo lectura, los módulos de donde salen las
   * cifras que tiene que explicar: facturas, compras, tesorería e inventario.
   * Un contador que no puede abrir la factura que originó una póliza no puede
   * hacer su trabajo — y perseguirla por correo es peor control, no mejor.
   *
   * NO ve 'nomina': el asiento de nómina le llega en cifras totales por
   * concepto, que es justo lo que necesita. El sueldo de cada trabajador con
   * nombre y apellido no. */
  CONTABILIDAD: [
    'contabilidad', 'auditoria', 'invoices', 'purchasing', 'treasury', 'inventory',
    'customers', 'suppliers', 'xml_reader', 'exchange_rates', 'mensajes',
  ],};

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
