/**
 * Proveedores — pantalla READ-ONLY (decisión del negocio).
 *
 *  · Mismo modelo que customers, pero filtrados por party_type='SUPPLIER'.
 *  · No exponemos botones de editar/eliminar; sólo búsqueda y consulta.
 *  · La página acepta navegación a "ver detalle" para auditoría.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Truck, Search, Eye, Lock } from 'lucide-react';
import api from '@/services/api';

interface Supplier {
  id: string;
  rfc: string;
  business_name: string;
  fiscal_regime?: string;
  postal_code?: string;
  email?: string;
  phone?: string;
  imports_count?: number;
  created_at?: string;
}

export function SuppliersPage() {
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<Supplier | null>(null);

  const q = useQuery({
    queryKey: ['suppliers', search],
    queryFn: () => api.listSuppliers({ search, limit: 200 }),
  });
  const rows: Supplier[] = q.data?.data?.suppliers || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <Truck className="text-indigo-600" size={36}/> Proveedores
          </h1>
          <p className="text-gray-600 mt-1 flex items-center gap-1">
            <Lock size={14}/> Vista de solo lectura · capturados al importar XMLs recibidos
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500 uppercase">Registrados</p>
          <p className="text-2xl font-bold text-gray-900">{q.data?.data?.total ?? 0}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow border p-4">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por RFC o razón social…"
            className="input pl-9 w-full"
          />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">RFC</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Razón social</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Régimen</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">CP</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">XMLs</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 italic">
                Sin proveedores. Los proveedores se crean al importar XMLs recibidos en "Importar XML".
              </td></tr>
            )}
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono">{s.rfc}</td>
                <td className="px-4 py-2 font-medium uppercase">{s.business_name}</td>
                <td className="px-4 py-2 text-sm">{s.fiscal_regime || '—'}</td>
                <td className="px-4 py-2 text-sm">{s.postal_code || '—'}</td>
                <td className="px-4 py-2 text-center text-sm">{s.imports_count ?? 0}</td>
                <td className="px-4 py-2 text-center">
                  <button title="Ver detalle"
                    onClick={() => setDetail(s)}
                    className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded">
                    <Eye size={16}/>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && <DetailModal supplier={detail} onClose={() => setDetail(null)}/>}
    </div>
  );
}

function DetailModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <Truck className="text-indigo-700" size={20}/>
            </div>
            <div>
              <h2 className="font-bold">{supplier.business_name}</h2>
              <p className="text-xs text-gray-500 font-mono">{supplier.rfc}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">✕</button>
        </div>
        <div className="p-5 space-y-2 text-sm">
          <Row k="Régimen fiscal"   v={supplier.fiscal_regime}/>
          <Row k="Código postal"    v={supplier.postal_code}/>
          <Row k="Email"            v={supplier.email}/>
          <Row k="Teléfono"         v={supplier.phone}/>
          <Row k="XMLs importados"  v={String(supplier.imports_count ?? 0)}/>
          <Row k="Creado"           v={supplier.created_at ? new Date(supplier.created_at).toLocaleString('es-MX') : undefined}/>
        </div>
        <div className="p-5 border-t bg-amber-50 text-amber-900 text-xs flex items-start gap-2">
          <Lock size={14} className="shrink-0 mt-0.5"/>
          <p>Los proveedores son de sólo lectura. Se crean automáticamente al importar XMLs donde tu empresa figura como receptor.</p>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  return (
    <div className="flex justify-between border-b last:border-b-0 py-1">
      <span className="text-gray-500">{k}</span>
      <span className="text-gray-800">{v || <span className="italic text-gray-400">—</span>}</span>
    </div>
  );
}
