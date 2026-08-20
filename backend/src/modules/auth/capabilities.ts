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
  'nomina:manage':       'Capturar, calcular y cerrar la nómina',
  'suppliers:manage':    'Dar de alta y mantener expedientes de proveedores',
  'contabilidad:catalogo': 'Mantener el catálogo de cuentas',
  'contabilidad:capturar': 'Capturar pólizas en borrador',
  'contabilidad:asentar':  'Asentar y reversar pólizas',
  'contabilidad:cerrar':   'Cerrar periodos y ejercicios contables',
  'reports:view':        'Consultar y exportar reportes',
};

export type Capability = keyof typeof CAPABILITIES;

const ALL_CAPS = Object.keys(CAPABILITIES);

/**
 * Capacidades que NO se heredan por ser MANAGER.
 *
 * ── POR QUÉ EXISTE ESTA EXCEPCIÓN ──
 * Antes, la nómina estaba cerrada con `authorize('ADMIN','SUPER_ADMIN')`, que
 * deja fuera a los MANAGER. Al pasarla a capacidades habría quedado abierta a
 * todos ellos sin que nadie lo pidiera —MANAGER recibe el juego completo—, y
 * eso es exactamente lo que no puede pasar: sueldos, CURP, cuentas bancarias y
 * órdenes de pensión alimenticia son el dato más sensible del sistema, y el
 * gerente del almacén no tiene por qué verlos por el hecho de ser gerente.
 *
 * Un MANAGER que sí deba manejar nómina la recibe: por su grupo de trabajo
 * (RECURSOS_HUMANOS) o por otorgamiento individual. Lo que no hay es herencia
 * automática.
 */
/* 'contabilidad:cerrar' se suma por la misma razón que la nómina, aunque el
 * dato no sea sensible: cerrar un periodo es un candado, y un gerente que lo
 * cierra por error deja al contador sin poder capturar el mes —sin haber
 * pedido nunca esa facultad. */
const NO_HEREDA_MANAGER = ['nomina:manage', 'contabilidad:cerrar'];

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
  COMPRAS:     ['inventory:view', 'purchasing:capture', 'suppliers:manage', 'reports:view'],
  /* Ésta es la que faltaba: sin ella el grupo veía tesorería sin poder mover
   * nada. Programar la remesa, autorizarla y marcarla pagada son los tres
   * pasos del trabajo, y los tres piden esta capacidad. */
  /* Tesorería mantiene los expedientes de proveedores.
   *
   * Es quien descubre lo que falta: al programar una transferencia se topa con
   * la CLABE vacía, con los días de crédito equivocados o con el RFC que nunca
   * se capturó. Mandarla a pedirle a un administrador que corrija cada dato es
   * garantizar que el dato se quede mal — y que la transferencia salga a la
   * cuenta de ayer. */
  TESORERIA:   ['treasury:pay', 'suppliers:manage', 'reports:view'],
  PUNTO_VENTA: ['pos:sell'],
  /* Recursos Humanos maneja la nómina completa: capturar, calcular y cerrar.
   *
   * No se partió en "captura" y "cierre" como en compras porque aquí no habría
   * a quién darle una sin la otra: el grupo entero es el departamento de
   * nómina, y una nómina capturada y sin cerrar no le paga a nadie. Quien deba
   * revisar antes de cerrar lo hace mirando la prenómina, que para eso existe.
   *
   * Si algún día hace falta un auxiliar que capture sin cerrar, será una
   * capacidad nueva y un grupo nuevo — no una que se pueda restar de éste. */
  RECURSOS_HUMANOS: ['nomina:manage', 'reports:view'],
  CONTABILIDAD: [
    'contabilidad:catalogo', 'contabilidad:capturar', 'contabilidad:asentar',
    'contabilidad:cerrar', 'inventory:view', 'reports:view',
  ],
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
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return [...ALL_CAPS];
  if (role === 'MANAGER') {
    /* Todo lo operativo, menos lo que no se hereda por rango. Ver
     * NO_HEREDA_MANAGER: la nómina no se abre por ser gerente. */
    const base = ALL_CAPS.filter((c) => !NO_HEREDA_MANAGER.includes(c));
    const extra = await capacidadesDeGrupoYOtorgadas(userId);
    return Array.from(new Set([...base, ...extra]));
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
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return true;
  /* El MANAGER hereda todo MENOS lo sensible; para eso cae al camino normal y
   * se resuelve por su grupo o por otorgamiento. */
  if (role === 'MANAGER' && !NO_HEREDA_MANAGER.includes(cap)) return true;
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


/**
 * Lo que le dan a un usuario su grupo de trabajo y sus otorgamientos.
 *
 * Vive aparte porque lo usan los dos caminos —el conjunto efectivo y la
 * pregunta puntual— y tenerlo duplicado garantizaba que un día uno de los dos
 * dejara de mirar el grupo.
 */
async function capacidadesDeGrupoYOtorgadas(userId: string): Promise<string[]> {
  const r = await query<{ capability: string | null; work_group: string | null }>(
    `SELECT uc.capability, u.work_group
       FROM users u
       LEFT JOIN user_capabilities uc ON uc.user_id = u.id
      WHERE u.id = $1`,
    [userId]
  );
  const otorgadas = r.rows.map((x) => x.capability).filter(Boolean) as string[];
  const delGrupo = GROUP_CAPABILITIES[r.rows[0]?.work_group || ''] || [];
  return [...delGrupo, ...otorgadas];
}
