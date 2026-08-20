/**
 * capacidades — qué puede HACER el usuario, preguntado al servidor.
 *
 * ── POR QUÉ NO SE ADIVINA ──
 * Las pantallas escondían sus botones con reglas propias: "si tu rol es ADMIN
 * puedes pagar", "si eres ADMIN puedes capturar nómina". Adivinar tiene dos
 * formas de fallar, y las dos ocurrieron en este sistema:
 *
 *   ESCONDER DE MÁS. Tesorería y Recursos Humanos veían sus pantallas sin un
 *   solo botón. No parece un problema de permisos —parece que el sistema no
 *   sirve— y por eso nadie lo reporta como lo que es.
 *
 *   ESCONDER DE MENOS. Ofrecer un botón que el servidor va a rechazar. El
 *   usuario lo descubre a clics, y con razón concluye que algo está roto.
 *
 * Y hay algo que el frontend NO PUEDE adivinar de ninguna manera: los
 * otorgamientos individuales. Son renglones en la base —"a Laura le dieron
 * aprobar compras"— que sólo el servidor conoce. Cualquier copia de las reglas
 * aquí sería incompleta por definición.
 *
 * ── ESTO NO ES EL CANDADO ──
 * Es la cortesía de no ofrecer lo que va a ser negado. Cada endpoint verifica
 * por su cuenta: quien llegue por la URL recibe el mismo rechazo.
 */
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

/** Las capacidades del catálogo, para no escribirlas como texto suelto. */
export const CAP = {
  inventarioVer:      'inventory:view',
  inventarioAjustar:  'inventory:adjust',
  traspasos:          'warehouse:transfer',
  comprasCapturar:    'purchasing:capture',
  comprasAprobar:     'purchasing:approve',
  conteoCapturar:     'physical:count',
  conteoAutorizar:    'physical:authorize',
  vender:             'pos:sell',
  pagar:              'treasury:pay',
  reportes:           'reports:view',
  nomina:             'nomina:manage',
  proveedores:        'suppliers:manage',
  ctaCatalogo:        'contabilidad:catalogo',
  ctaCapturar:        'contabilidad:capturar',
  ctaAsentar:         'contabilidad:asentar',
  ctaCerrar:          'contabilidad:cerrar',
} as const;

/**
 * Las capacidades del usuario actual.
 *
 * Se piden una vez y se conservan cinco minutos: no cambian a cada rato, y
 * pedirlas en cada pantalla sería una consulta por navegación. Si un
 * administrador las cambia, el servidor rechaza igual —él resuelve en cada
 * petición— y la pantalla se pone al día en la siguiente recarga.
 */
export function useCapacidades() {
  const { user, isAuthenticated } = useAuthStore();

  const q = useQuery({
    queryKey: ['mis-capacidades', user?.userId],
    queryFn: () => api.getMisCapacidades(),
    enabled: !!isAuthenticated && !!user,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const lista: string[] = q.data?.data?.capabilities || [];

  /* Los administradores no esperan a la respuesta.
   *
   * Sin este atajo, el primer render de cada pantalla les escondería los
   * botones y aparecerían medio segundo después. Un parpadeo así se lee como
   * una falla, y quien lo sufre es justo quien más usa el sistema. */
  const esAdministrador = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const puede = (cap: string): boolean => {
    if (esAdministrador) return true;
    return lista.includes(cap);
  };

  return {
    puede,
    capacidades: lista,
    /* Mientras carga no se sabe. Sirve para no dibujar un botón y quitarlo:
     * quien quiera evitar el parpadeo espera a que esto sea false. */
    cargando: q.isLoading,
  };
}
