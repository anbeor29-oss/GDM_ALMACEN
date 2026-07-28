/**
 * Capacidades finas (§8 ALMACEN) — capa sobre el modelo de roles.
 *
 *  · SUPER_ADMIN / ADMIN → todas las capacidades.
 *  · MANAGER            → todas las OPERATIVAS (conserva su acceso previo).
 *  · USER               → base de sólo lectura + venta, más lo que su ADMIN
 *                         le otorgue explícitamente (user_capabilities).
 *
 *  Esto es NO-rompiente: los endpoints que antes exigían ADMIN/MANAGER siguen
 *  pasando para esos roles; lo nuevo es que un USER puede ser elevado a una
 *  capacidad concreta (encargado de almacén, capturista de compras, etc.).
 */

import { query } from '../../config/database';

/** Catálogo canónico de capacidades con su etiqueta legible. */
export const CAPABILITIES: Record<string, string> = {
  'inventory:view':      'Consultar inventario',
  'inventory:adjust':    'Autorizar ajustes de inventario',
  'warehouse:transfer':  'Realizar traspasos entre almacenes',
  'purchasing:capture':  'Capturar compras y órdenes',
  'purchasing:approve':  'Aprobar compras',
  'physical:count':      'Capturar inventario físico',
  'physical:authorize':  'Autorizar y cerrar conteos',
  'pos:sell':            'Vender en punto de venta',
  'treasury:pay':        'Autorizar pagos a proveedores',
  'reports:view':        'Consultar y exportar reportes',
};

export type Capability = keyof typeof CAPABILITIES;

const ALL_CAPS = Object.keys(CAPABILITIES);

/** Capacidades base que un USER tiene sin necesidad de otorgamiento. */
const USER_BASELINE = ['inventory:view', 'reports:view', 'pos:sell'];

/**
 * "Roles operativos" preconfigurados (§8) — paquetes de capacidades que el
 * ADMIN puede aplicar de un clic a un usuario USER. No son roles de BD; son
 * plantillas de capacidades.
 */
export const CAPABILITY_TEMPLATES: Record<string, { label: string; caps: string[] }> = {
  ALMACENISTA: {
    label: 'Encargado de almacén',
    caps: ['inventory:view', 'inventory:adjust', 'warehouse:transfer', 'physical:count', 'physical:authorize', 'reports:view'],
  },
  COMPRAS: {
    label: 'Capturista / logística de compras',
    caps: ['inventory:view', 'purchasing:capture', 'reports:view'],
  },
  COMPRAS_APROBADOR: {
    label: 'Aprobador de compras',
    caps: ['inventory:view', 'purchasing:capture', 'purchasing:approve', 'treasury:pay', 'reports:view'],
  },
  VENTAS: {
    label: 'Ventas / cajero',
    caps: ['inventory:view', 'pos:sell', 'reports:view'],
  },
  AUDITOR: {
    label: 'Auditor / supervisor (sólo lectura)',
    caps: ['inventory:view', 'reports:view'],
  },
};

/** Devuelve el conjunto EFECTIVO de capacidades de un usuario. */
export async function getEffectiveCapabilities(
  userId: string,
  role: string
): Promise<string[]> {
  if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER') {
    // ADMIN/SUPER: todo. MANAGER: todo lo operativo (= todo en este set).
    return [...ALL_CAPS];
  }
  // USER: base + otorgamientos explícitos
  const r = await query<{ capability: string }>(
    `SELECT capability FROM user_capabilities WHERE user_id = $1`,
    [userId]
  );
  const granted = r.rows.map((x) => x.capability);
  return Array.from(new Set([...USER_BASELINE, ...granted]));
}

/** ¿El usuario tiene la capacidad? */
export async function userHasCapability(
  userId: string,
  role: string,
  cap: string
): Promise<boolean> {
  if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER') return true;
  if (USER_BASELINE.includes(cap)) return true;
  const r = await query(
    `SELECT 1 FROM user_capabilities WHERE user_id = $1 AND capability = $2 LIMIT 1`,
    [userId, cap]
  );
  return r.rows.length > 0;
}

/** Valida que una capacidad exista en el catálogo. */
export function isValidCapability(cap: string): boolean {
  return ALL_CAPS.includes(cap);
}
