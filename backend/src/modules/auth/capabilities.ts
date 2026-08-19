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
 * ── LO QUE CADA GRUPO DE TRABAJO PUEDE HACER ──
 *
 * EL HUECO QUE ESTO TAPA
 * El grupo decidía qué pantallas VE un usuario, pero no qué puede HACER en
 * ellas. Un usuario del grupo TESORERIA veía la pantalla de tesorería y no
 * podía programar un solo pago: todos los endpoints de escritura piden
 * `treasury:pay`, y esa capacidad no estaba en la base de un USER — había que
 * otorgársela a mano, usuario por usuario, y nadie lo sabía. La pantalla se
 * abría, los botones estaban ahí, y al oprimirlos salía "no tienes la capacidad
 * requerida".
 *
 * Lo mismo con el cajero: grupo PUNTO_VENTA sin poder cobrar.
 *
 * EL CRITERIO
 * Cada grupo trae lo que su nombre promete, y NADA más. Compras captura
 * órdenes pero no las aprueba —aprobar es la firma de otro—; almacén ajusta
 * existencias pero no toca pagos.
 *
 * ESTO NO SUSTITUYE LOS OTORGAMIENTOS INDIVIDUALES
 * Se SUMA a ellos. Un ADMIN puede seguir elevando a alguien de su equipo con
 * una capacidad puntual —el de compras que además aprueba— sin cambiarlo de
 * grupo.
 */
export const GROUP_CAPABILITIES: Record<string, string[]> = {
  ADMIN_ALL:   ALL_CAPS,
  VENTAS:      ['inventory:view', 'pos:sell', 'reports:view'],
  ALMACEN:     ['inventory:view', 'inventory:adjust', 'warehouse:transfer',
                'physical:count', 'physical:authorize', 'reports:view'],
  /* Captura órdenes y recibe mercancía. NO aprueba: la aprobación es un
   * segundo par de ojos, y si el mismo que captura aprueba, deja de serlo.
   * Quien deba aprobar recibe 'purchasing:approve' a título individual. */
  COMPRAS:     ['inventory:view', 'purchasing:capture', 'reports:view'],
  /* Ésta es la que faltaba: sin ella el grupo veía tesorería sin poder mover
   * nada. Programar la remesa, autorizarla y marcarla pagada son los tres
   * pasos del trabajo, y los tres piden esta capacidad. */
  TESORERIA:   ['treasury:pay', 'reports:view'],
  PUNTO_VENTA: ['pos:sell'],
  /* Nómina no se protege con capacidades sino con el rol (authorize ADMIN),
   * así que aquí sólo van los reportes. Un usuario de RH que deba capturar
   * nómina necesita rol ADMIN —su grupo ya le limita las pantallas a nómina—. */
  RECURSOS_HUMANOS: ['reports:view'],
};

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

/**
 * Devuelve el conjunto EFECTIVO de capacidades de un usuario.
 *
 * Son tres fuentes que se suman: la base de cualquier usuario, lo que implica
 * su GRUPO DE TRABAJO, y lo que su administrador le otorgó a título individual.
 *
 * El grupo se lee de la BASE y no del token: si un administrador cambia a
 * alguien de grupo, el cambio surte efecto en la siguiente petición y no cuando
 * expire su sesión. Es el mismo criterio que ya seguían los otorgamientos.
 */
export async function getEffectiveCapabilities(
  userId: string,
  role: string
): Promise<string[]> {
  if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER') {
    // ADMIN/SUPER: todo. MANAGER: todo lo operativo (= todo en este set).
    return [...ALL_CAPS];
  }
  const r = await query<{ capability: string | null; work_group: string | null }>(
    `SELECT uc.capability, u.work_group
       FROM users u
       LEFT JOIN user_capabilities uc ON uc.user_id = u.id
      WHERE u.id = $1`,
    [userId]
  );
  const granted = r.rows.map((x) => x.capability).filter(Boolean) as string[];
  const grupo = r.rows[0]?.work_group || '';
  const delGrupo = GROUP_CAPABILITIES[grupo] || [];
  return Array.from(new Set([...USER_BASELINE, ...delGrupo, ...granted]));
}

/** ¿El usuario tiene la capacidad? */
export async function userHasCapability(
  userId: string,
  role: string,
  cap: string
): Promise<boolean> {
  if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER') return true;
  if (USER_BASELINE.includes(cap)) return true;

  /* Una sola consulta para las dos fuentes que faltan: el grupo del usuario y
   * su otorgamiento individual. Preguntarlas por separado sería un viaje más a
   * la base en CADA petición protegida. */
  const r = await query<{ work_group: string | null; otorgada: boolean }>(
    `SELECT u.work_group,
            EXISTS (SELECT 1 FROM user_capabilities uc
                     WHERE uc.user_id = u.id AND uc.capability = $2) AS otorgada
       FROM users u WHERE u.id = $1`,
    [userId, cap]
  );
  const fila = r.rows[0];
  if (!fila) return false;
  if (fila.otorgada) return true;
  return (GROUP_CAPABILITIES[fila.work_group || ''] || []).includes(cap);
}

/** Valida que una capacidad exista en el catálogo. */
export function isValidCapability(cap: string): boolean {
  return ALL_CAPS.includes(cap);
}
