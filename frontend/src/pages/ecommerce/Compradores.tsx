/**
 * Comercio Electrónico → Clientes web (rebanada 10).
 *
 * Lista de los compradores REGISTRADOS en las tiendas de la empresa (cuentas de
 * storefront, separadas de los usuarios de NEXO). Sólo consulta: cuántos pedidos y
 * cuánto han comprado. El alta la hace el propio comprador en la tienda.
 */
import { useQuery } from '@tanstack/react-query';
import { Users, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/services/api';

const money = (n: any) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString('es-MX') : '—');

export function CompradoresEcPage() {
  const q = useQuery({ queryKey: ['ec-compradores'], queryFn: () => api.getCompradoresEc() });
  const rows: any[] = (q.data as any)?.data?.compradores || [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <Link to="/ecommerce" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={15} /> Comercio Electrónico</Link>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mt-1"><Users className="text-teal-600" size={24} /> Clientes web</h1>
        <p className="text-sm text-gray-500">Compradores registrados en tus tiendas. Las cuentas las crean ellos mismos al comprar.</p>
      </div>

      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Nombre</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Correo</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Tienda</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Pedidos</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Comprado</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Alta</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Último acceso</th>
          </tr></thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">Cargando…</td></tr>}
            {!q.isLoading && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400 italic">Aún no hay compradores registrados.</td></tr>}
            {rows.map((c) => (
              <tr key={c.id} className={`hover:bg-gray-50 ${c.activo ? '' : 'opacity-60'}`}>
                <td className="px-3 py-2 font-medium text-gray-800">{c.nombre}</td>
                <td className="px-3 py-2 text-gray-600">{c.email}{c.telefono ? <span className="text-xs text-gray-400"> · {c.telefono}</span> : null}</td>
                <td className="px-3 py-2 text-gray-600">{c.tienda}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">{c.pedidos}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">{money(c.comprado)}</td>
                <td className="px-3 py-2 text-center text-gray-500 text-xs">{fecha(c.created_at)}</td>
                <td className="px-3 py-2 text-center text-gray-500 text-xs">{fecha(c.last_login_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CompradoresEcPage;
