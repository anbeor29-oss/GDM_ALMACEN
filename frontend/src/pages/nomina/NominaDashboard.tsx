/**
 * Tablero de nómina — qué falta para poder pagar.
 *
 * NO ES UN TABLERO DE CIFRAS, ES UNA LISTA DE PENDIENTES
 * Antes del primer cálculo lo único que importa es si el sistema puede timbrar:
 * si falta el registro patronal, si falta la prima de riesgo, si hay
 * expedientes sin NSS. Un tablero bonito con la suma de sueldos no sirve de
 * nada el día que el PAC rechaza cincuenta recibos por un dato que llevaba
 * meses vacío y que nadie miró.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users, AlertTriangle, CheckCircle2, Settings2, FileText } from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export function NominaDashboardPage() {
  const resumen = useQuery({ queryKey: ['empleados-resumen'], queryFn: () => api.getEmpleadosResumen() });
  const params = useQuery({ queryKey: ['nomina-parametros'], queryFn: () => api.getNominaParametros() });

  const r: any = resumen.data?.data;
  const p: any = params.data?.data;
  const faltaEmpresa: string[] = p?.faltantes || [];
  const todoListo = faltaEmpresa.length === 0 && Number(r?.incompletos || 0) === 0 && Number(r?.activos || 0) > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nómina</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {p?.empresa?.razonSocial} · <span className="font-mono">{p?.empresa?.rfc}</span>
        </p>
      </div>

      {todoListo && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          Los parámetros del patrón están completos y ningún expediente tiene huecos.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tarjeta titulo="En plantilla" valor={r?.activos ?? '—'} icono={<Users size={18} />} />
        <Tarjeta titulo="Suma de salarios diarios" valor={r ? money(r.sumaSalarioDiario) : '—'} />
        <Tarjeta titulo="Con INFONAVIT" valor={r?.conInfonavit ?? '—'} />
        <Tarjeta titulo="Con pensión alimenticia" valor={r?.conPension ?? '—'} />
      </div>

      {/* Lo que impide correr una nómina */}
      {(faltaEmpresa.length > 0 || Number(r?.incompletos || 0) > 0) && (
        <div className="bg-white rounded-lg shadow border p-5">
          <h2 className="font-semibold flex items-center gap-2 text-amber-800">
            <AlertTriangle size={18} /> Antes del primer cálculo
          </h2>
          <div className="mt-3 space-y-3 text-sm">
            {faltaEmpresa.length > 0 && (
              <div>
                <p className="text-gray-700 font-medium">De la empresa:</p>
                <ul className="mt-1 space-y-0.5 text-gray-600">
                  {faltaEmpresa.map((x) => <li key={x}>▸ {x}</li>)}
                </ul>
                <Link to="/nomina/parametros" className="inline-flex items-center gap-1.5 mt-2 text-primary hover:underline">
                  <Settings2 size={14} /> Ir a Parámetros
                </Link>
              </div>
            )}
            {Number(r?.incompletos || 0) > 0 && (
              <div>
                <p className="text-gray-700 font-medium">
                  De los trabajadores: {r.incompletos} expediente(s) sin NSS, sin CP fiscal,
                  sin entidad federativa o sin SDI.
                </p>
                <Link to="/nomina/empleados" className="inline-flex items-center gap-1.5 mt-2 text-primary hover:underline">
                  <Users size={14} /> Ir a Empleados
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {Number(r?.activos || 0) === 0 && (
        <div className="bg-white rounded-lg shadow border p-6 text-center">
          <FileText className="mx-auto text-gray-300" size={36} />
          <p className="mt-3 font-medium text-gray-800">Todavía no hay nadie en la plantilla</p>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            Se puede dar de alta a mano, o rescatar el expediente de un recibo de nómina que
            ya se haya timbrado antes, desde el Lector de XML.
          </p>
          <div className="flex justify-center gap-3 mt-4">
            <Link to="/nomina/empleados" className="bg-primary text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-600">
              Dar de alta
            </Link>
            <Link to="/xml-super-import" className="border px-4 py-2 rounded-lg text-sm hover:bg-gray-50">
              Importar de un XML
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, icono }: { titulo: string; valor: any; icono?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <p className="text-xs text-gray-500 flex items-center gap-1.5">{icono} {titulo}</p>
      <p className="text-xl font-bold mt-1 text-gray-900">{valor}</p>
    </div>
  );
}

export default NominaDashboardPage;
