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
  | 'RECURSOS_HUMANOS' | 'CONTABILIDAD';

/**
 * Una clave por bloque del menú. 'dashboard' es común a todos los grupos y se
 * lista explícitamente para que no haga falta un caso especial en canAccess.
 */
export type ModuleKey =
  | 'dashboard'
  | 'invoices' | 'carta_porte' | 'credit_notes' | 'customers' | 'products'
  | 'xml_reader' | 'inventory' | 'purchasing' | 'suppliers' | 'pos'
  | 'treasury' | 'reports' | 'exchange_rates' | 'auditoria' | 'mensajes'
  | 'nomina' | 'contabilidad';

const ALL_MODULES: ModuleKey[] = [
  'dashboard',
  'invoices', 'carta_porte', 'credit_notes', 'customers', 'products',
  'xml_reader', 'inventory', 'purchasing', 'suppliers', 'pos',
  'treasury', 'reports', 'exchange_rates', 'auditoria', 'mensajes',
  /* Nómina sólo la alcanzan ADMIN_ALL y RECURSOS_HUMANOS: sueldos, CURP,
   * cuentas bancarias y órdenes de pensión alimenticia no son "un módulo
   * más". */
  'nomina', 'contabilidad',
];

/**
 * Criterio de reparto: cada grupo alcanza lo que necesita para trabajar, no lo
 * que "le podría servir". Los cruces son deliberados — VENTAS ve tipos de
 * cambio (factura en dólares) y TESORERIA ve proveedores (les programa pagos).
 */
export const GROUP_MODULES: Record<WorkGroup, ModuleKey[]> = {
  ADMIN_ALL: ALL_MODULES,
  VENTAS: [
    'invoices', 'carta_porte', 'credit_notes', 'customers',
    'products', 'xml_reader', 'pos', 'exchange_rates', 'mensajes',
  ],
  ALMACEN:   ['products', 'inventory', 'mensajes'],
  /* Compras pide y recibe; no administra existencias. Lo que necesita saber
   * —qué falta— lo tiene en Faltantes, que vive en su propio módulo. */
  COMPRAS:   ['purchasing', 'suppliers', 'products',
              'xml_reader', 'mensajes'],
  /* Tesorería paga; cotejar lo que el SAT dice de nuestros comprobantes es
   * otro trabajo y otra persona. */
  TESORERIA: ['treasury', 'suppliers', 'exchange_rates', 'mensajes'],
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
  PUNTO_VENTA: ['pos', 'mensajes'],
  /* Recursos Humanos: la nómina y nada más. Lleva 'xml_reader' porque el
   * expediente del personal se rescata de los recibos ya timbrados. */
  RECURSOS_HUMANOS: ['nomina', 'xml_reader', 'mensajes'],
  /* Contabilidad ve de dónde salen las cifras que tiene que explicar, pero
   * NO ve nómina: el asiento le llega en totales por concepto, que es lo que
   * necesita. El sueldo con nombre y apellido, no. */
  CONTABILIDAD: [
    'contabilidad', 'auditoria', 'treasury', 'inventory',
    'customers', 'suppliers', 'xml_reader', 'exchange_rates', 'mensajes',
  ],
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
  CONTABILIDAD: 'Contabilidad',
};

/** Detalle de lo que ve cada grupo — se muestra bajo el selector al dar de alta. */
export const WORK_GROUP_DETAIL: Record<WorkGroup, string> = {
  ADMIN_ALL: 'Todos los módulos del sistema.',
  VENTAS:    'Facturas, Carta Porte, Notas de crédito, Clientes, Productos, ' +
             'Lector de XML, Punto de Venta y Monedas.',
  ALMACEN:   'Productos y Almacén (existencias, almacenes, inventario físico). ' +
             'No ve facturación, compras, tesorería ni reportes.',
  COMPRAS:   'Compras (órdenes, faltantes y recepción de XML), Proveedores, ' +
             'Productos y Lector de XML. No ve el módulo de Almacén ni los reportes.',
  TESORERIA: 'Tesorería completa —cuentas por pagar, remesas y programación de ' +
             'pagos—, expedientes de Proveedores y Monedas. No ve facturación, ' +
             'almacén, auditoría ni reportes.',
  PUNTO_VENTA: 'Únicamente el Punto de Venta. No ve facturación, catálogos, ' +
               'almacén, compras ni reportes. Pensado para el cajero de mostrador.',
  RECURSOS_HUMANOS: 'Nómina completa (expediente del personal, cálculo, ' +
               'parámetros y reportes), Lector de XML y Reportes. No ve ' +
               'facturación, clientes, almacén ni tesorería.',
  CONTABILIDAD: 'Catálogo de cuentas, pólizas, balanza y estados financieros. '
    + 'Ve facturas, compras, tesorería e inventario para poder explicar sus '
    + 'cifras; NO ve nómina con nombre y apellido.',
};

export function canAccess(group: string | undefined, mod: ModuleKey): boolean {
  const g = (group as WorkGroup) || 'ADMIN_ALL';
  return (GROUP_MODULES[g] || GROUP_MODULES.ADMIN_ALL).includes(mod);
}

/* ── Y LO QUE ESTE ARCHIVO **NO** DECIDE ──
 *
 * Qué puede HACER alguien dentro de una pantalla no se resuelve aquí. Hubo un
 * intento —`puedeMoverNomina`, que miraba el rol y el grupo— y duró poco: no
 * podía saber de los otorgamientos individuales, que son renglones en la base
 * que sólo el servidor conoce. Cualquier regla escrita de este lado nace
 * incompleta.
 *
 * Eso vive en `utils/capacidades.ts`, que lo PREGUNTA en vez de deducirlo.
 * Aquí sólo se decide qué módulos aparecen en el menú.
 */


/**
 * ── LA CASA DE CADA GRUPO ──
 *
 * A dónde llega alguien al entrar, y a dónde se le manda si teclea una
 * dirección que no le toca.
 *
 * POR QUÉ HACE FALTA
 * Antes todo caía en `/dashboard`, y el dashboard estaba en TODOS los grupos
 * justamente por eso. Al sacarlo —el resumen del negocio, con sus ventas y sus
 * saldos, es información de la dirección y no de quien captura— ese destino
 * dejó de existir para seis de los siete grupos.
 *
 * Sin este mapa, quitarle el dashboard a un grupo lo dejaría dando vueltas:
 * pide una pantalla, se le niega, se le manda al dashboard, que también se le
 * niega, y otra vez. Un bucle de redirecciones, no una pantalla de error.
 *
 * Cada quien llega a lo que viene a hacer, que además es mejor que un tablero
 * que no puede usar.
 */
export const HOME_POR_GRUPO: Record<string, string> = {
  ADMIN_ALL:        '/dashboard',
  VENTAS:           '/invoices',
  ALMACEN:          '/inventory',
  COMPRAS:          '/purchase-orders',
  TESORERIA:        '/treasury',
  PUNTO_VENTA:      '/pos',
  RECURSOS_HUMANOS: '/nomina',
  CONTABILIDAD: '/contabilidad/cuentas',
};

/** A dónde mandar a este usuario. Sin grupo conocido, al dashboard. */
export function homeDe(user: any): string {
  const grupo = user?.workGroup || user?.work_group || 'ADMIN_ALL';
  return HOME_POR_GRUPO[grupo] || '/dashboard';
}
