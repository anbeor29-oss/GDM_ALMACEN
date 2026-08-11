/**
 * usePresencia — anuncia que estás en esta pantalla y te dice quién más está.
 *
 * CÓMO SE USA
 *   const { otros, soyElPrimero } = usePresencia('carta_porte', id);
 *
 * Late cada 30 segundos y se despide al desmontar. Si el navegador se cierra
 * sin avisar, el renglón muere solo a los 90 segundos en el servidor: nadie
 * cierra sesión con el botón, se cierra la laptop.
 *
 * NO BLOQUEA NADA
 * Devuelve información para mostrar un aviso. La decisión de seguir capturando
 * es de la persona, que es justo lo que se pidió: los dos pueden trabajar, pero
 * viéndose.
 *
 * SI EL SERVIDOR FALLA, LA PANTALLA SIGUE
 * Un error de red aquí no puede impedir que alguien capture una factura. Los
 * fallos se tragan a propósito y el aviso simplemente no aparece.
 */
import { useEffect, useState } from 'react';
import api from '@/services/api';

export interface Presente {
  userId: string;
  email: string;
  nombre: string;
  entroAt: string;
  minutos: number;
}

/** Cada cuánto se avisa que seguimos aquí. El servidor da por muerto a los 90 s. */
const LATIDO_MS = 30_000;

export function usePresencia(recurso: string, recursoId?: string | null) {
  const [otros, setOtros] = useState<Presente[]>([]);
  const [soyElPrimero, setSoyElPrimero] = useState(true);

  useEffect(() => {
    /* Sin id no hay a quién anunciarse: es una pantalla de alta que todavía no
     * existe como documento. Se podría usar 'nuevo', pero dos personas dando de
     * alta cosas distintas no se estorban, y avisarlo sería ruido. */
    if (!recursoId) { setOtros([]); setSoyElPrimero(true); return; }

    let vivo = true;

    const latir = async () => {
      try {
        const r = await api.presenciaEntrar(recurso, String(recursoId));
        if (!vivo) return;
        setOtros(r.data?.presentes || []);
        setSoyElPrimero(r.data?.soyElPrimero ?? true);
      } catch {
        /* Ver el encabezado: la pantalla nunca se detiene por esto. */
      }
    };

    latir();
    const id = setInterval(latir, LATIDO_MS);

    return () => {
      vivo = false;
      clearInterval(id);
      api.presenciaSalir(recurso, String(recursoId)).catch(() => {});
    };
  }, [recurso, recursoId]);

  return { otros, soyElPrimero };
}
