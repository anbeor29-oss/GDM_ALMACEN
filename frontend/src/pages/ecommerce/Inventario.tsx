/**
 * Comercio Electrónico → Inventario (rebanada 3, embebido · lectura).
 *
 * Existencias por almacén sobre `warehouse_stock` del ERP (mismos datos que ve el
 * despacho). Sólo consulta: los movimientos/ajustes (con capas de costo) siguen en el
 * ERP para no romper el kardex; llegan al módulo en una rebanada posterior.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, ArrowLeft, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/services/api';

export function InventarioEcPage() {
  const [busq, setBusq] = useState('');
  const q = useQuery({ queryKey: ['ec-inventario', busq], queryFn: () => api.getInventarioEc(busq || undefined) });
  const renglones: any[] = (q.data as any)?.data?.renglones || [];

  // Total por producto (suma de almacenes) para el pie de cada grupo.
  const totalProducto = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of renglones) m.set(r.product_id, (m.get(r.product_id) || 0) + Number(r.existencia || 0));
    return m;
  }, [renglones]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <Link to="/ecommerce" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={15} /> Comercio Electrónico</Link>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mt-1"><Boxes className="text-indigo-600" size={24} /> Inventario</h1>
        <p className="text-sm text-gray-500">Existencias por almacén (sólo consulta). Los movimientos se hacen en el ERP.</p>
      </div>

      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
        <input value={busq} onChange={(e) => setBusq(e.target.value)} placeholder="Buscar producto…"
          className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm" />
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Producto</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">SKU</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Almacén</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Existencia</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Total prod.</th>
          </tr></thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Cargando…</td></tr>}
            {!q.isLoading && renglones.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400 italic">Sin existencias registradas.</td></tr>}
            {renglones.map((r, i) => {
              const primero = i === 0 || renglones[i - 1].product_id !== r.product_id;
              return (
                <tr key={`${r.product_id}-${r.warehouse_id}`} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-800">{primero ? r.name : <span className="text-gray-300">↳</span>}</td>
                  <td className="px-3 py-2 font-mono text-gray-600">{primero ? r.sku : ''}</td>
                  <td className="px-3 py-2 text-gray-600">{r.almacen}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(r.existencia || 0).toLocaleString('es-MX')}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-700">{primero ? Number(totalProducto.get(r.product_id) || 0).toLocaleString('es-MX') : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default InventarioEcPage;
