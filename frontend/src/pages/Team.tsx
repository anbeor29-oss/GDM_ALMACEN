/**
 * Equipo — el ADMIN de la empresa gestiona las capacidades de su personal (§8).
 *
 *  ADMIN y MANAGER tienen acceso operativo completo (no editable). Los usuarios
 *  con rol USER (cajeros, encargados de almacén, capturistas) reciben solo las
 *  capacidades que aquí se les otorguen — con plantillas de un clic para los
 *  roles operativos típicos.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, ShieldCheck, Lock, Check } from 'lucide-react';
import api from '@/services/api';

const ROLE_BADGE: Record<string, { label: string; cls: string }> = {
  ADMIN:   { label: 'Administrador', cls: 'bg-indigo-100 text-indigo-700' },
  MANAGER: { label: 'Gerente',       cls: 'bg-sky-100 text-sky-700' },
  USER:    { label: 'Operativo',     cls: 'bg-gray-100 text-gray-700' },
};

export function TeamPage() {
  const [editUser, setEditUser] = useState<any | null>(null);

  const usersQ = useQuery({ queryKey: ['team-users'], queryFn: () => api.getTeamUsers() });
  const users: any[] = usersQ.data?.data?.users || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
          <Users className="text-indigo-600" size={36} /> Equipo y permisos
        </h1>
        <p className="text-gray-600 mt-1">
          Otorga capacidades finas a tu personal operativo (§8): encargado de almacén,
          capturista de compras, cajero, auditor…
        </p>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Usuario</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Rol</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Capacidades</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {usersQ.isLoading && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!usersQ.isLoading && users.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500 italic">
                Sin usuarios en tu empresa todavía. El SUPER_ADMIN los da de alta.
              </td></tr>
            )}
            {users.map((u) => {
              const badge = ROLE_BADGE[u.role] || { label: u.role, cls: 'bg-gray-100 text-gray-600' };
              return (
                <tr key={u.id} className={`hover:bg-gray-50 ${!u.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2">
                    <p className="font-medium text-sm">{u.first_name} {u.last_name}</p>
                    <p className="text-xs text-gray-500">{u.email}</p>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                  </td>
                  <td className="px-4 py-2">
                    {u.editable ? (
                      <span className="text-xs text-gray-600">{u.capabilities.length} capacidad(es)</span>
                    ) : (
                      <span className="text-xs text-emerald-700 inline-flex items-center gap-1">
                        <ShieldCheck size={13} /> Acceso completo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {u.editable ? (
                      <button onClick={() => setEditUser(u)}
                        className="text-sm text-primary hover:underline">Gestionar</button>
                    ) : (
                      <Lock size={14} className="text-gray-300 mx-auto" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editUser && (
        <CapabilitiesModal user={editUser} onClose={() => setEditUser(null)} />
      )}
    </div>
  );
}

function CapabilitiesModal({ user, onClose }: { user: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set(user.capabilities));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const catQ = useQuery({ queryKey: ['team-capabilities'], queryFn: () => api.getTeamCapabilities() });
  const capabilities: Array<{ key: string; label: string }> = catQ.data?.data?.capabilities || [];
  const templates: Array<{ key: string; label: string; caps: string[] }> = catQ.data?.data?.templates || [];

  const toggle = (cap: string) => {
    const next = new Set(selected);
    next.has(cap) ? next.delete(cap) : next.add(cap);
    setSelected(next);
  };
  const applyTemplate = (caps: string[]) => setSelected(new Set(caps));

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      await api.setUserCapabilities(user.id, Array.from(selected));
      qc.invalidateQueries({ queryKey: ['team-users'] });
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo guardar');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white">
          <div>
            <h2 className="font-bold">Capacidades de {user.first_name} {user.last_name}</h2>
            <p className="text-xs text-gray-500">{user.email}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">{error}</div>}

          {/* Plantillas de rol operativo */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Aplicar rol predefinido:</p>
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button key={t.key} onClick={() => applyTemplate(t.caps)}
                  className="text-xs px-3 py-1.5 border border-gray-200 rounded-full hover:border-indigo-400 hover:bg-indigo-50">
                  {t.label}
                </button>
              ))}
              <button onClick={() => setSelected(new Set())}
                className="text-xs px-3 py-1.5 border border-gray-200 rounded-full hover:bg-gray-50 text-gray-500">
                Ninguna
              </button>
            </div>
          </div>

          {/* Capacidades individuales */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Capacidades:</p>
            <div className="space-y-1">
              {capabilities.map((c) => (
                <label key={c.key}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(c.key)} />
                  <div className="flex-1">
                    <span className="text-sm text-gray-800">{c.label}</span>
                    <span className="ml-2 text-xs text-gray-400 font-mono">{c.key}</span>
                  </div>
                  {selected.has(c.key) && <Check size={16} className="text-emerald-600" />}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 p-5 border-t bg-gray-50 sticky bottom-0">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {saving ? 'Guardando…' : `Guardar (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
