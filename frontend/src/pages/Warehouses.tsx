/**
 * Almacenes — CRUD del catálogo de almacenes (§7 ALMACEN.MD).
 *
 *  · El primer almacén creado se vuelve default automáticamente.
 *  · El default no puede desactivarse ni eliminarse (reasignar primero).
 *  · Eliminar exige almacén sin existencias (el backend lo bloquea).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Warehouse, Plus, Pencil, Trash2, Star, MapPin } from 'lucide-react';
import api from '@/services/api';

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  address?: string;
  is_default: boolean;
  is_active: boolean;
  products_with_stock: number;
  total_units: number;
  total_value: number;
  created_at?: string;
}

const money = (n: number) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export function WarehousesPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<WarehouseRow | null>(null);
  const [error, setError] = useState('');

  const q = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.getWarehouses(true),
  });
  const rows: WarehouseRow[] = q.data?.data?.warehouses || [];

  const refresh = () => qc.invalidateQueries({ queryKey: ['warehouses'] });

  const handleDelete = async (w: WarehouseRow) => {
    if (!window.confirm(`¿Eliminar el almacén ${w.code} — ${w.name}?`)) return;
    setError('');
    try {
      await api.deleteWarehouse(w.id);
      refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo eliminar el almacén');
    }
  };

  const handleSetDefault = async (w: WarehouseRow) => {
    setError('');
    try {
      await api.updateWarehouse(w.id, { isDefault: true });
      refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo cambiar el default');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <Warehouse className="text-sky-600" size={36} /> Almacenes
          </h1>
          <p className="text-gray-600 mt-1">
            Existencias separadas por almacén · traspasos · mínimos y máximos por ubicación
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
        >
          <Plus size={18} /> Nuevo almacén
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Código</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Nombre</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Dirección</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Productos</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Unidades</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Valuación</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Estado</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500 italic">
                Sin almacenes. Crea el primero — será el almacén default de la empresa.
              </td></tr>
            )}
            {rows.map((w) => (
              <tr key={w.id} className={`hover:bg-gray-50 ${!w.is_active ? 'opacity-50' : ''}`}>
                <td className="px-4 py-2 font-mono font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {w.is_default && <Star size={14} className="text-amber-500 fill-amber-400" />}
                    {w.code}
                  </span>
                </td>
                <td className="px-4 py-2 font-medium">{w.name}</td>
                <td className="px-4 py-2 text-sm text-gray-600">
                  {w.address ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={12} className="text-gray-400" />{w.address}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-2 text-center text-sm">{w.products_with_stock}</td>
                <td className="px-4 py-2 text-right text-sm">{Number(w.total_units).toLocaleString('es-MX')}</td>
                <td className="px-4 py-2 text-right text-sm font-medium">{money(w.total_value)}</td>
                <td className="px-4 py-2 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    w.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'
                  }`}>
                    {w.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-center gap-1">
                    {!w.is_default && w.is_active && (
                      <button title="Hacer default"
                        onClick={() => handleSetDefault(w)}
                        className="p-1.5 text-amber-500 hover:bg-amber-50 rounded">
                        <Star size={16} />
                      </button>
                    )}
                    <button title="Editar"
                      onClick={() => setEditing(w)}
                      className="p-1.5 text-sky-600 hover:bg-sky-50 rounded">
                      <Pencil size={16} />
                    </button>
                    {!w.is_default && (
                      <button title="Eliminar"
                        onClick={() => handleDelete(w)}
                        className="p-1.5 text-rose-600 hover:bg-rose-50 rounded">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <WarehouseModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {editing && (
        <WarehouseModal
          warehouse={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function WarehouseModal({
  warehouse,
  onClose,
  onSaved,
}: {
  warehouse?: WarehouseRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!warehouse;
  const [code, setCode] = useState(warehouse?.code || '');
  const [name, setName] = useState(warehouse?.name || '');
  const [address, setAddress] = useState(warehouse?.address || '');
  const [isActive, setIsActive] = useState(warehouse?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setError('');
    if (!isEdit && !code.trim()) { setError('El código es obligatorio'); return; }
    if (!name.trim()) { setError('El nombre es obligatorio'); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await api.updateWarehouse(warehouse.id, {
          name: name.trim(),
          address: address.trim() || undefined,
          isActive,
        });
      } else {
        await api.createWarehouse({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          address: address.trim() || undefined,
        });
      }
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo guardar el almacén');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-sky-100 rounded-lg flex items-center justify-center">
              <Warehouse className="text-sky-700" size={20} />
            </div>
            <h2 className="font-bold">{isEdit ? `Editar ${warehouse.code}` : 'Nuevo almacén'}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}
          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Código *</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Ej. BODEGA1, SUC-NORTE" maxLength={20} className="input" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Bodega principal" className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)}
              placeholder="Calle, número, colonia, ciudad" className="input" />
          </div>
          {isEdit && !warehouse.is_default && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Almacén activo
            </label>
          )}
        </div>

        <div className="flex justify-end gap-3 p-5 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
