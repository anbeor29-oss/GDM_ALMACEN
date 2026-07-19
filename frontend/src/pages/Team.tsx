/**
 * Equipo — el ADMIN de la empresa gestiona su personal (§8):
 *   · Alta de usuarios (rol + grupo de trabajo)
 *   · Edición inline de rol, grupo de trabajo, nombre y estado activo
 *   · Capacidades finas para USER (plantillas de un clic)
 *
 * Grupos de trabajo (define qué módulos ve el usuario en el sidebar):
 *   · ADMIN_ALL   — todo
 *   · VENTAS      — POS, Facturas, Clientes, NC, **Carta Porte**
 *   · INVENTARIOS — Productos, Inventario, Almacenes, Físico
 *   · COMPRAS     — Compras XML, Órdenes de compra
 *   · TESORERIA   — Tesorería, Proveedores
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, ShieldCheck, Lock, Check, Plus, Pencil, Trash2, X, Save } from 'lucide-react';
import api from '@/services/api';

const ROLE_BADGE: Record<string, { label: string; cls: string }> = {
  ADMIN:   { label: 'Administrador', cls: 'bg-indigo-100 text-indigo-700' },
  MANAGER: { label: 'Gerente',       cls: 'bg-sky-100 text-sky-700' },
  USER:    { label: 'Operativo',     cls: 'bg-gray-100 text-gray-700' },
};

const GROUP_BADGE: Record<string, { label: string; cls: string }> = {
  ADMIN_ALL:   { label: 'Acceso total',    cls: 'bg-emerald-100 text-emerald-700' },
  VENTAS:      { label: 'Ventas + CP',     cls: 'bg-amber-100 text-amber-700' },
  INVENTARIOS: { label: 'Inventarios',     cls: 'bg-fuchsia-100 text-fuchsia-700' },
  COMPRAS:     { label: 'Compras',         cls: 'bg-orange-100 text-orange-700' },
  TESORERIA:   { label: 'Tesorería',       cls: 'bg-rose-100 text-rose-700' },
};

const GROUP_DESCR: Record<string, string> = {
  ADMIN_ALL:   'Todos los módulos',
  VENTAS:      'Punto de venta, facturas, clientes, notas de crédito, Carta Porte',
  INVENTARIOS: 'Productos, inventario, almacenes, inventario físico',
  COMPRAS:     'Compras XML, órdenes de compra',
  TESORERIA:   'Tesorería, proveedores',
};

export function TeamPage() {
  const qc = useQueryClient();
  const [editUser, setEditUser] = useState<any | null>(null);   // modal capacidades
  const [userModal, setUserModal] = useState<{ open: boolean; user: any | null }>({ open: false, user: null });

  const usersQ = useQuery({ queryKey: ['team-users'], queryFn: () => api.getTeamUsers() });
  const users: any[] = usersQ.data?.data?.users || [];

  const handleDelete = async (u: any) => {
    if (!confirm(`¿Eliminar a ${u.first_name} ${u.last_name || ''}? Su acceso se desactiva.`)) return;
    try {
      await api.deleteTeamUser(u.id);
      qc.invalidateQueries({ queryKey: ['team-users'] });
    } catch (e: any) {
      alert(e?.response?.data?.message || 'No se pudo eliminar');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <Users className="text-indigo-600" size={36} /> Equipo y permisos
          </h1>
          <p className="text-gray-600 mt-1">
            Da de alta a tu personal y asígnales <b>grupo de trabajo</b> — Ventas ve facturas y Carta Porte,
            Inventarios ve almacenes, Tesorería ve pagos, etc.
          </p>
        </div>
        <button
          onClick={() => setUserModal({ open: true, user: null })}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"
        >
          <Plus size={18} /> Nuevo usuario
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Usuario</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Rol</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Grupo de trabajo</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Capacidades</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {usersQ.isLoading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!usersQ.isLoading && users.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500 italic">
                Sin usuarios en tu empresa todavía. Click en "Nuevo usuario" arriba.
              </td></tr>
            )}
            {users.map((u) => {
              const roleBadge = ROLE_BADGE[u.role] || { label: u.role, cls: 'bg-gray-100 text-gray-600' };
              const wg = u.work_group || 'ADMIN_ALL';
              const wgBadge = GROUP_BADGE[wg] || { label: wg, cls: 'bg-gray-100 text-gray-600' };
              return (
                <tr key={u.id} className={`hover:bg-gray-50 ${!u.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2">
                    <p className="font-medium text-sm">{u.first_name} {u.last_name || ''}</p>
                    <p className="text-xs text-gray-500">{u.email}</p>
                    {!u.is_active && <span className="text-[10px] text-red-600 font-semibold">DESACTIVADO</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge.cls}`}>{roleBadge.label}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${wgBadge.cls}`}>{wgBadge.label}</span>
                    <p className="text-[10px] text-gray-400 mt-0.5">{GROUP_DESCR[wg]}</p>
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
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => setUserModal({ open: true, user: u })}
                        className="p-1.5 text-sky-600 hover:bg-sky-50 rounded"
                        title="Editar datos, rol y grupo"
                      ><Pencil size={14} /></button>
                      {u.editable ? (
                        <button
                          onClick={() => setEditUser(u)}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"
                          title="Capacidades finas"
                        ><ShieldCheck size={14} /></button>
                      ) : (
                        <span className="p-1.5"><Lock size={14} className="text-gray-300" /></span>
                      )}
                      <button
                        onClick={() => handleDelete(u)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                        title="Desactivar"
                      ><Trash2 size={14} /></button>
                    </div>
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
      {userModal.open && (
        <UserModal
          user={userModal.user}
          onClose={() => setUserModal({ open: false, user: null })}
          onSaved={() => qc.invalidateQueries({ queryKey: ['team-users'] })}
        />
      )}
    </div>
  );
}

/* ─── Alta / edición de usuario ─── */

function UserModal({ user, onClose, onSaved }: { user: any | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!user;
  const [form, setForm] = useState({
    email:     user?.email || '',
    password:  '',
    firstName: user?.first_name || '',
    lastName:  user?.last_name || '',
    role:      user?.role || 'USER',
    workGroup: user?.work_group || 'ADMIN_ALL',
    isActive:  user ? user.is_active : true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true); setError('');
    try {
      if (isEdit) {
        await api.updateTeamUser(user.id, {
          firstName: form.firstName,
          lastName:  form.lastName,
          role:      form.role,
          workGroup: form.workGroup,
          isActive:  form.isActive,
        });
      } else {
        await api.createTeamUser({
          email:     form.email,
          password:  form.password,
          firstName: form.firstName,
          lastName:  form.lastName,
          role:      form.role,
          workGroup: form.workGroup,
        });
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'No se pudo guardar');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white">
          <h2 className="font-bold text-lg">{isEdit ? `Editar ${user.first_name}` : 'Nuevo usuario'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <F label="Nombre" required>
              <input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} className="input" maxLength={80} />
            </F>
            <F label="Apellido">
              <input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} className="input" maxLength={80} />
            </F>
            <F label="Email" required span={2}>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value.toLowerCase() })} disabled={isEdit}
                     className={`input ${isEdit ? 'bg-slate-100 cursor-not-allowed' : ''}`} />
              {isEdit && <p className="text-[10px] text-slate-400 mt-1">El email no se puede cambiar</p>}
            </F>
            {!isEdit && (
              <F label="Contraseña temporal" required span={2}>
                <input type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                       placeholder="Mín 8 caracteres. Pídele que la cambie al primer login." className="input font-mono" />
              </F>
            )}
            <F label="Rol" required>
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="input">
                <option value="USER">Operativo (capacidades finas)</option>
                <option value="MANAGER">Gerente (acceso completo)</option>
                <option value="ADMIN">Administrador (gestiona el equipo)</option>
              </select>
            </F>
            <F label="Grupo de trabajo" required>
              <select value={form.workGroup} onChange={e => setForm({ ...form, workGroup: e.target.value })} className="input">
                <option value="ADMIN_ALL">Acceso total — ve todo</option>
                <option value="VENTAS">Ventas — facturas + Carta Porte</option>
                <option value="INVENTARIOS">Inventarios — almacenes y stock</option>
                <option value="COMPRAS">Compras — OC y compras XML</option>
                <option value="TESORERIA">Tesorería — pagos y proveedores</option>
              </select>
              <p className="text-[10px] text-slate-500 mt-1">{GROUP_DESCR[form.workGroup]}</p>
            </F>
            {isEdit && (
              <F label="Estado" span={2}>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} />
                  <span className="text-sm">Usuario activo (puede iniciar sesión)</span>
                </label>
              </F>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 p-5 border-t bg-gray-50 sticky bottom-0">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
          <button
            onClick={save}
            disabled={saving || !form.firstName || !form.email || (!isEdit && form.password.length < 8)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={16} /> {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear usuario'}
          </button>
        </div>
      </div>
    </div>
  );
}

function F({ label, children, required, span = 1 }: { label: string; children: React.ReactNode; required?: boolean; span?: number }) {
  const cls = span === 2 ? 'col-span-2' : '';
  return (
    <label className={`block ${cls}`}>
      <span className="block text-xs text-slate-500 mb-1">{label} {required && <span className="text-red-500">*</span>}</span>
      {children}
    </label>
  );
}

/* ─── Modal de capacidades (§8) ─── */

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
