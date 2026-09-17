/**
 * NominaGuard — bloquea la nómina hasta que estén CAPTURADOS TODOS LOS PARÁMETROS
 * patronales (registro patronal, prima de riesgo, factor de integración y CSD).
 *
 * Sin esos parámetros el cálculo sale mal en silencio, así que la nómina no se
 * abre hasta tenerlos. La única pantalla que pasa siempre es la de Parámetros
 * —es donde se capturan—. El backend ya sabe qué falta (`faltantes`); aquí sólo
 * se usa para dejar pasar o mandar a capturar.
 */
import type { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock, SlidersHorizontal, AlertTriangle } from 'lucide-react';
import api from '@/services/api';

export function NominaGuard({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['nomina-parametros'], queryFn: () => api.getNominaParametros() });
  const faltantes: string[] = q.data?.data?.faltantes || [];

  // La pantalla de Parámetros pasa siempre (es donde se capturan).
  const esParametros = pathname.startsWith('/nomina/parametros');

  if (q.isLoading) return <div className="p-6 text-sm text-gray-500">Cargando nómina…</div>;
  if (esParametros || faltantes.length === 0) return <>{children}</>;

  return (
    <div className="p-6">
      <div className="max-w-lg mx-auto bg-white border rounded-lg shadow-sm p-6 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
          <Lock size={22} />
        </div>
        <h1 className="mt-3 text-xl font-bold text-gray-900">Nómina bloqueada</h1>
        <p className="text-sm text-gray-600 mt-1">
          Antes de usar la nómina hay que capturar los parámetros patronales. Sin ellos el
          cálculo saldría mal.
        </p>
        <ul className="mt-4 text-left text-sm text-gray-700 space-y-1.5 max-w-sm mx-auto">
          {faltantes.map((f, i) => (
            <li key={i} className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" /> Falta: {f}
            </li>
          ))}
        </ul>
        <button onClick={() => navigate('/nomina/parametros')}
          className="mt-5 inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-blue-600 text-sm">
          <SlidersHorizontal size={16} /> Capturar parámetros
        </button>
      </div>
    </div>
  );
}

export default NominaGuard;
