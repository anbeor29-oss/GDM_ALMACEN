/**
 * Periodo por DEFAULT de las pantallas de contabilidad/reportes/tesorería.
 *
 * Por decisión del usuario (2026-10-27) **arrancan en el MES ACTUAL** (hoy), no en
 * el mes siguiente al cerrado: parado en octubre, todas muestran octubre. Antes
 * saltaban al «periodo activo» (mes siguiente al último cierre), que con el cierre
 * a diciembre-2025 dejaba todo en enero-2026 aunque ya fuera otro mes.
 *
 * `usePeriodoTrabajo` deja el selector en el mes actual al cargar y respeta al
 * usuario: en cuanto cambia el mes/año (o si venía fijado por la URL), no lo mueve.
 * Si alguna pantalla quisiera el viejo comportamiento (saltar al periodo activo),
 * puede pasar `preferirActual=false`.
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

export function usePeriodoTrabajo(inicialAnio?: number, inicialMes?: number, preferirActual = true) {
  const hoy = new Date();
  const activo = usePeriodoActivo();
  const [anio, setAnioRaw] = useState(inicialAnio ?? hoy.getFullYear());
  const [mes, setMesRaw] = useState(inicialMes ?? hoy.getMonth() + 1);
  // Por default arranca en el MES ACTUAL y ahí se queda. Sólo se auto-movería al
  // «periodo activo» (mes siguiente al cerrado) si una pantalla pasa
  // preferirActual=false y además no venía fijado por URL ni lo tocó el usuario.
  const [tocado, setTocado] = useState(inicialAnio != null || inicialMes != null || preferirActual);

  useEffect(() => {
    if (activo && !tocado) { setAnioRaw(activo.anio); setMesRaw(activo.mes); }
  }, [activo, tocado]);

  const setAnio = (a: number) => { setTocado(true); setAnioRaw(a); };
  const setMes = (m: number) => { setTocado(true); setMesRaw(m); };
  return { anio, mes, setAnio, setMes };
}
