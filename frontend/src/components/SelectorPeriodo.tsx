import { useEffect, useState } from 'react';
import api from '@/services/api';

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/**
 * Selector de periodo (mes + año) compartido por la Balanza y los estados. El AÑO
 * es un combo con los ejercicios de la empresa (los años del respaldo, ej. 2018→),
 * más el año en curso; el MES, los 12 meses. Reemplaza al viejo input de año a mano
 * y al stepper ◀▶, para que todos los estados se elijan igual.
 */
export function SelectorPeriodo({ anio, mes, onAnio, onMes }: {
  anio: number; mes: number;
  onAnio: (a: number) => void; onMes: (m: number) => void;
}) {
  const [anios, setAnios] = useState<number[]>([]);
  useEffect(() => {
    let alive = true;
    api.getEjerciciosContables().then((a) => { if (alive) setAnios(a); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  // El año elegido siempre debe estar en la lista, aunque el servidor no lo devuelva.
  const lista = anios.includes(anio) ? anios : [anio, ...anios].sort((a, b) => b - a);

  return (
    <div className="flex items-center gap-2">
      <select value={mes} onChange={(e) => onMes(Number(e.target.value))} className="input">
        {MESES.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>
      <select value={anio} onChange={(e) => onAnio(Number(e.target.value))} className="input">
        {lista.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
    </div>
  );
}
