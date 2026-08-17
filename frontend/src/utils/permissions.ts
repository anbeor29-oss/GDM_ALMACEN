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

export type WorkGroup =
  | 'ADMIN_ALL' | 'VENTAS' | 'ALMACEN' | 'COMPRAS' | 'TESORERIA' | 'PUNTO_VENTA'
  | 'RECURSOS_HUMANOS';

/**
 * Una clave por bloque del menú. 'dashboard' es común a todos los grupos y se
 * lista explícitamente para que no haga falta un caso especial en canAccess.
 */
export type ModuleKey =
  | 'dashboard'
  | 'invoices' | 'carta_porte' | 'credit_notes' | 'customers' | 'products'
  | 'xml_reader' | 'inventory' | 'purchasing' | 'suppliers' | 'pos'
  | 'treasury' | 'reports' | 'exchange_rates' | 'auditoria' | 'mensajes'
  | 'nomina';

const ALL_MODULES: ModuleKey[] = [
  'dashboard',
  'invoices', 'carta_porte', 'credit_notes', 'customers', 'products',
  'xml_reader', 'inventory', 'purchasing', 'suppliers', 'pos',
  'treasury', 'reports', 'exchange_rates', 'auditoria', 'mensajes',
  /* Nómina sólo la alcanzan ADMIN_ALL y RECURSOS_HUMANOS: sueldos, CURP,
   * cuentas bancarias y órdenes de pensión alimenticia no son "un módulo
   * más". */
  'nomina',
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
    'products', 'xml_reader', 'pos', 'reports', 'exchange_rates', 'mensajes',
  ],
  ALMACEN:   ['dashboard', 'products', 'inventory', 'reports', 'mensajes'],
  COMPRAS:   ['dashboard', 'purchasing', 'suppliers', 'products', 'inventory',
              'xml_reader', 'reports', 'mensajes'],
  TESORERIA: ['dashboard', 'treasury', 'suppliers', 'exchange_rates', 'reports',
              'auditoria', 'mensajes'],
  /* Cajero de mostrador: SÓLO el punto de venta.
   *
   * VENTAS ya existía, pero alcanza facturas, clientes, Carta Porte y el lector
   * de XML — demasiado para quien únicamente cobra en mostrador. Un cajero con
   * acceso a la facturación puede timbrar por error, y en un turno con varias
   * personas nadie sabría quién fue.
   *
   * No lleva 'products' ni 'inventory': la pantalla del POS busca lo que vende
   * por su propio endpoint, así que no necesita el catálogo abierto. Lo que ve
   * es la caja y nada más — salvo los mensajes: "se acabó el rollo de la
   * impresora" tiene que poder salir de ahí. */
  PUNTO_VENTA: ['dashboard', 'pos', 'mensajes'],
  /* Recursos Humanos: la nómina y nada más. Lleva 'xml_reader' porque el
   * expediente del personal se rescata de los recibos ya timbrados. */
  RECURSOS_HUMANOS: ['dashboard', 'nomina', 'xml_reader', 'reports', 'mensajes'],
};

/** Etiquetas legibles de cada grupo (para selectores). */
export const WORK_GROUP_LABELS: Record<WorkGroup, string> = {
  ADMIN_ALL: 'Administrador (todos los módulos)',
  VENTAS:    'Ventas (facturas, Carta Porte, clientes, NC, POS)',
  ALMACEN:   'Almacén (productos, existencias, inventario físico)',
  COMPRAS:   'Compras (órdenes, recepción XML, proveedores)',
  TESORERIA: 'Tesorería (pagos a proveedores, tipos de cambio)',
  PUNTO_VENTA: 'Punto de venta (sólo caja)',
  RECURSOS_HUMANOS: 'Recursos Humanos (sólo nómina)',
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
  PUNTO_VENTA: 'Únicamente el Punto de Venta. No ve facturación, catálogos, ' +
               'almacén, compras ni reportes. Pensado para el cajero de mostrador.',
  RECURSOS_HUMANOS: 'Nómina completa (expediente del personal, cálculo, ' +
               'parámetros y reportes), Lector de XML y Reportes. No ve ' +
               'facturación, clientes, almacén ni tesorería.',
};

export function canAccess(group: string | undefined, mod: ModuleKey): boolean {
  const g = (group as WorkGroup) || 'ADMIN_ALL';
  return (GROUP_MODULES[g] || GROUP_MODULES.ADMIN_ALL).includes(mod);
}
