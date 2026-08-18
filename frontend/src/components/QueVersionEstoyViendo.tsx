/**
 * QueVersionEstoyViendo — un renglón que dice qué código está corriendo.
 *
 * POR QUÉ EXISTE
 * Durante días el diagnóstico de "pedí un cambio y no lo veo" fue a ciegas. La
 * causa casi siempre era la misma: el frontend se había desplegado y el backend
 * no, o al revés, o el navegador miraba un servidor distinto del que se acababa
 * de actualizar. Todas esas situaciones se ven IGUAL desde la pantalla —una
 * interfaz nueva que responde 404— y ninguna se puede distinguir sin abrir las
 * herramientas del navegador.
 *
 * Con esto, la pregunta "¿ya está desplegado?" se contesta mirando, no
 * adivinando: si los dos commits coinciden con el último push, está; si no
 * coinciden entre ellos, falta desplegar uno de los dos.
 *
 * VA EN EL PIE DEL MENÚ, chico y gris: es información de diagnóstico, no algo
 * que se consulte a diario.
 */

import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

export function QueVersionEstoyViendo({ abierto }: { abierto: boolean }) {
  /* El commit con el que se compiló ESTA pantalla. Lo inyecta vite.config al
   * construir; en desarrollo trae la marca de tiempo del arranque. */
  const front = String(import.meta.env.VITE_COMMIT || 'dev').slice(0, 7);

  const q = useQuery({
    queryKey: ['version-backend'],
    queryFn: () => api.getSalud(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const back = q.data?.commit || (q.isError ? '¿?' : '…');

  /* Que no coincidan es exactamente lo que hay que ver: significa que uno de
   * los dos servicios se quedó atrás y la pantalla va a pedir cosas que el
   * servidor todavía no sabe hacer. */
  const desfasado = back !== '…' && back !== '¿?' && front !== 'dev' && back !== front;

  if (!abierto) {
    return (
      <p className="px-2 py-1 text-center text-[9px] text-slate-400" title={`front ${front} · back ${back}`}>
        {desfasado ? '⚠' : ''}{back}
      </p>
    );
  }

  return (
    <div className={`px-3 py-1.5 text-[10px] leading-tight ${
      desfasado ? 'text-amber-700 bg-amber-50' : 'text-slate-400'
    }`}>
      <p>
        pantalla <span className="font-mono">{front}</span>
        {'  ·  '}servidor <span className="font-mono">{back}</span>
      </p>
      {desfasado && (
        <p className="mt-0.5">
          No coinciden: uno de los dos no se ha desplegado, y la pantalla puede
          pedir cosas que el servidor todavía no tiene.
        </p>
      )}
    </div>
  );
}

export default QueVersionEstoyViendo;
