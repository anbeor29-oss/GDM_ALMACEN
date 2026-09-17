/**
 * Periodo de TRABAJO — el mes en el que hay que estar parado en todas las
 * pantallas de contabilidad: el SIGUIENTE al último mes cerrado. Con el cierre a
 * diciembre 2025, todo arranca en enero 2026; al cerrar enero, en febrero. Así el
 * usuario no anda cambiando el mes a mano de una pantalla a otra.
 *
 * `usePeriodoTrabajo` deja el selector en ese mes al cargar, pero respeta al
 * usuario: en cuanto cambia el mes/año (o si venía fijado por la URL), ya no lo
 * vuelve a mover.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

export function usePeriodoActivo(): { anio: number; mes: number } | undefined {
  const q = useQuery({
    queryKey: ['periodo-activo'],
    queryFn: () => api.getPeriodoActivo(),
    staleTime: 5 * 60 * 1000,
  });
  return q.data?.data;
}

export function usePeriodoTrabajo(inicialAnio?: number, inicialMes?: number) {
  const hoy = new Date();
  const activo = usePeriodoActivo();
  const [anio, setAnioRaw] = useState(inicialAnio ?? hoy.getFullYear());
  const [mes, setMesRaw] = useState(inicialMes ?? hoy.getMonth() + 1);
  // Si venía fijado (URL) o el usuario ya tocó el selector, no se auto-mueve.
  const [tocado, setTocado] = useState(inicialAnio != null || inicialMes != null);

  useEffect(() => {
    if (activo && !tocado) { setAnioRaw(activo.anio); setMesRaw(activo.mes); }
  }, [activo, tocado]);

  const setAnio = (a: number) => { setTocado(true); setAnioRaw(a); };
  const setMes = (m: number) => { setTocado(true); setMesRaw(m); };
  return { anio, mes, setAnio, setMes };
}
