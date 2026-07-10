/**
 * Super-Admin → Gestión de Usuarios.
 *   · Crear / editar / deshabilitar / resetear password
 *   · Asignar a empresa
 *   · Visible solo para role=SUPER_ADMIN
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { UserPlus, KeyRound, UserX, UserCheck, X, Shield, UserCog } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

const ROLES = [
  { value: 'SUPER_ADMIN', label: 'Super Admin (plataforma)' },
  { value: 'ADMIN',       label: 'Admin (empresa)' },
  { value: 'MANAGER',     label: 'Manager' },
  { value: 'USER',        label: 'Usuario' },
];

export function AdminUsersPage() {
  const navigate = useNavigate();
  const { user, login: storeLogin } = useAuthStore();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 p-6 rounded-lg">
        <p className="font-semibold mb-1">Acceso restringido</p>
        <p className="text-sm">Esta sección requiere rol <b>SUPER_ADMIN</b>. Tu rol: <b>{user?.role}</b>.</p>
      </div>
    );
  }

  const usersQ = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => api.adminListUsers({ search, limit: 100 }),
  });
  const companiesQ = useQuery({
    queryKey: ['admin-companies'],
    queryFn: () => api.adminListCompanies(),
  });
  const companies = companiesQ.data?.data?.companies || [];

  const reset = useMutation({
    mutationFn: (id: string) => api.adminResetPassword(id),
    onSuccess: (res) => {
      alert(`Nueva contraseña temporal:\n\n${res.data.temporary_password}\n\nCompártela al usuario; al iniciar sesión se forzará el cambio.`);
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
  const disable = useMutation({
    mutationFn: (id: string) => api.adminDisableUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  const enable = useMutation({
    mutationFn: (id: string) => api.adminEnableUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  /** Impersonar: reemplaza el JWT local por el del usuario target y navega al dashboard. */
  const impersonate = useMutation({
    mutationFn: (id: string) => api.adminImpersonate(id),
    onSuccess: (res) => {
      // Conservamos el refresh token actual del super-admin para no perder su sesión
      // cuando termine el soporte (al hacer logout vuelve al login normal).
      const newUser = {
        userId: res.data.user.id,
        email:  res.data.user.email,
        role:   res.data.user.role,
        companyId: res.data.user.companyId,
        impersonatedBy: res.data.user.impersonatedBy,
      };
      storeLogin(newUser as any, res.data.token,
        useAuthStore.getState().refreshToken || '');
      navigate('/dashboard');
    },
    onError: (e: any) => alert(e?.response?.data?.message || e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <Shield className="text-indigo-600" size={36}/> Usuarios
          </h1>
          <p className="text-gray-600 mt-1">Administra los usuarios que pueden facturar en la plataforma.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg shadow">
          <UserPlus size={18}/> Nuevo usuario
        </button>
      </div>

      <div className="bg-white rounded-lg shadow border p-4">
        <input
          value={search} onChange={(e)=>setSearch(e.target.value)}
          placeholder="Buscar por email o nombre…"
          className="input w-full md:w-96"
        />
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Email</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Nombre</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Rol</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Empresa</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Estado</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(usersQ.data?.data?.users || []).map((u: any) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm font-mono">{u.email}</td>
                <td className="px-4 py-2 text-sm">{u.first_name} {u.last_name}</td>
                <td className="px-4 py-2"><RoleBadge role={u.role}/></td>
                <td className="px-4 py-2 text-sm">
                  {u.company_name ? (
                    <span><b>{u.company_rfc}</b> <span className="text-gray-500">· {u.company_name}</span></span>
                  ) : <span className="text-gray-400 italic">—</span>}
                </td>
                <td className="px-4 py-2 text-center">
                  {u.is_active ? (
                    <span className="text-xs px-2 py-1 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200">Activo</span>
                  ) : (
                    <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-full">Deshabilitado</span>
                  )}
                  {u.password_change_required && (
                    <span className="block text-[10px] text-amber-700 mt-1">cambio pendiente</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <IconBtn title="Resetear password" color="amber"
                      onClick={() => { if (confirm(`Generar nueva contraseña temporal para ${u.email}?`)) reset.mutate(u.id); }}>
                      <KeyRound size={16}/>
                    </IconBtn>
                    {/* Solo se puede suplantar a usuarios distintos del propio super-admin
                        y nunca a otro SUPER_ADMIN (el backend también lo bloquea). */}
                    {u.role !== 'SUPER_ADMIN' && u.is_active && u.id !== user?.userId && (
                      <IconBtn title="Suplantar (soporte)" color="indigo"
                        onClick={() => {
                          if (confirm(`¿Iniciar sesión como ${u.email}?\nLa acción quedará registrada en audit_log.`)) {
                            impersonate.mutate(u.id);
                          }
                        }}>
                        <UserCog size={16}/>
                      </IconBtn>
                    )}
                    {u.is_active ? (
                      <IconBtn title="Deshabilitar" color="red"
                        onClick={() => { if (confirm(`Deshabilitar ${u.email}?`)) disable.mutate(u.id); }}>
                        <UserX size={16}/>
                      </IconBtn>
                    ) : (
                      <IconBtn title="Re-activar" color="green" onClick={() => enable.mutate(u.id)}>
                        <UserCheck size={16}/>
                      </IconBtn>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!usersQ.isLoading && (usersQ.data?.data?.users || []).length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 italic">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateUserModal
          companies={companies}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['admin-users'] }); }}
        />
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const palette: Record<string, string> = {
    SUPER_ADMIN: 'bg-indigo-100 text-indigo-800',
    ADMIN:       'bg-violet-100 text-violet-800',
    MANAGER:     'bg-sky-100 text-sky-800',
    USER:        'bg-slate-100 text-slate-700',
  };
  return <span className={`text-xs px-2 py-1 rounded font-medium ${palette[role] || 'bg-gray-100'}`}>{role}</span>;
}

function IconBtn({ color, title, onClick, children }: any) {
  const map: Record<string, string> = {
    amber:'text-amber-600 hover:bg-amber-50',
    red:'text-red-600 hover:bg-red-50',
    green:'text-emerald-600 hover:bg-emerald-50',
    indigo:'text-indigo-600 hover:bg-indigo-50',
  };
  return <button type="button" title={title} onClick={onClick} className={`p-1.5 rounded ${map[color]}`}>{children}</button>;
}

function CreateUserModal({ companies, onClose, onDone }: any) {
  const [form, setForm] = useState({ email:'', firstName:'', lastName:'', role:'USER', companyId:'' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const res = await api.adminCreateUser({ ...form });
      alert(
        `✅ Usuario creado.\n\n` +
        `Email: ${res.data.email}\n` +
        `Contraseña temporal: ${res.data.temporary_password}\n\n` +
        `Compártela al usuario. Al iniciar sesión se le pedirá cambiarla.`
      );
      onDone();
    } catch (e: any) { setError(e.response?.data?.message || e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <UserPlus className="text-indigo-700" size={20}/>
            </div>
            <h2 className="font-bold text-gray-900">Nuevo usuario</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded"><X size={20}/></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}
          <label className="block"><span className="text-sm font-medium block mb-1">Email *</span>
            <input type="email" required className="input w-full"
              value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})}/></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-sm font-medium block mb-1">Nombre *</span>
              <input required className="input w-full" value={form.firstName}
                onChange={(e)=>setForm({...form,firstName:e.target.value})}/></label>
            <label className="block"><span className="text-sm font-medium block mb-1">Apellido *</span>
              <input required className="input w-full" value={form.lastName}
                onChange={(e)=>setForm({...form,lastName:e.target.value})}/></label>
          </div>
          <label className="block"><span className="text-sm font-medium block mb-1">Rol *</span>
            <select className="input w-full" value={form.role}
              onChange={(e)=>setForm({...form,role:e.target.value})}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select></label>
          {form.role !== 'SUPER_ADMIN' && (
            <label className="block"><span className="text-sm font-medium block mb-1">Empresa *</span>
              <select required className="input w-full" value={form.companyId}
                onChange={(e)=>setForm({...form,companyId:e.target.value})}>
                <option value="">— seleccionar —</option>
                {companies.map((c: any) => <option key={c.id} value={c.id}>{c.rfc} · {c.business_name}</option>)}
              </select></label>
          )}
          <p className="text-xs text-gray-500">
            Se generará una contraseña temporal. El usuario debe cambiarla en el primer login.
          </p>
        </div>
        <div className="flex gap-3 p-5 border-t">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancelar</button>
          <button type="submit" disabled={busy} className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
            {busy ? 'Creando…' : 'Crear usuario'}
          </button>
        </div>
      </form>
    </div>
  );
}
