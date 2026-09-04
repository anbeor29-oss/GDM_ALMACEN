/**
 * Super-Admin → Gestión de Usuarios.
 *   · Crear / editar / deshabilitar / resetear password
 *   · Asignar a empresa
 *   · Visible solo para role=SUPER_ADMIN
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { Emoji3D } from '@/components/Emoji3D';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { WORK_GROUP_LABELS, WORK_GROUP_DETAIL, WorkGroup } from '@/utils/permissions';

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
  /* Usuario cuyas empresas se están administrando. Se guarda el objeto entero y
   * no sólo el id: el modal muestra el correo, y volver a buscarlo en la lista
   * para pintar un encabezado sería trabajo de más. */
  const [empresasDe, setEmpresasDe] = useState<any | null>(null);
  const [permsUser, setPermsUser] = useState<any | null>(null);
  const [editUser, setEditUser] = useState<any | null>(null);   // editar rol/grupo/nombre

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
            <Emoji3D e="🛡️" size="xl" /> Usuarios
          </h1>
          <p className="text-gray-600 mt-1">Administra los usuarios que pueden facturar en la plataforma.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg shadow">
          <Emoji3D e="➕" size="base" /> Nuevo usuario
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
                    {/* Editar rol y grupo: p.ej. convertir un USER de contabilidad
                        en ADMIN para que pueda cargar la e.firma. */}
                    {u.role !== 'SUPER_ADMIN' && (
                      <IconBtn title="Editar usuario (rol, grupo, nombre)" color="green"
                        onClick={() => setEditUser(u)}>
                        <Emoji3D e="✏️" size="base" />
                      </IconBtn>
                    )}
                    {/* Los permisos no aplican al SUPER_ADMIN: opera la
                        plataforma y ve todo por definición. */}
                    {u.role !== 'SUPER_ADMIN' && (
                      <IconBtn title="Permisos: módulos y capacidades" color="violet"
                        onClick={() => setPermsUser(u)}>
                        <Emoji3D e="🛡️" size="base" />
                      </IconBtn>
                    )}
                    {/* Empresas del usuario. Se ofrece para todos menos el
                        SUPER_ADMIN, que no opera dentro de una empresa sino
                        sobre la plataforma entera. */}
                    {u.role !== 'SUPER_ADMIN' && (
                      <IconBtn title="Empresas de este usuario" color="sky"
                        onClick={() => setEmpresasDe(u)}>
                        <Emoji3D e="🏢" size="base" />
                      </IconBtn>
                    )}
                    <IconBtn title="Resetear password" color="amber"
                      onClick={() => { if (confirm(`Generar nueva contraseña temporal para ${u.email}?`)) reset.mutate(u.id); }}>
                      <Emoji3D e="🔑" size="base" />
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
                        <Emoji3D e="🎭" size="base" />
                      </IconBtn>
                    )}
                    {u.is_active ? (
                      <IconBtn title="Deshabilitar" color="red"
                        onClick={() => { if (confirm(`Deshabilitar ${u.email}?`)) disable.mutate(u.id); }}>
                        <Emoji3D e="🚫" size="base" />
                      </IconBtn>
                    ) : (
                      <IconBtn title="Re-activar" color="green" onClick={() => enable.mutate(u.id)}>
                        <Emoji3D e="✅" size="base" />
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

      {empresasDe && (
        <EmpresasDeUsuarioModal
          usuario={empresasDe}
          onClose={() => setEmpresasDe(null)}
        />
      )}

      {showCreate && (
        <CreateUserModal
          companies={companies}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['admin-users'] }); }}
        />
      )}

      {permsUser && (
        <PermissionsModal
          user={permsUser}
          onClose={() => setPermsUser(null)}
          onDone={() => { setPermsUser(null); qc.invalidateQueries({ queryKey: ['admin-users'] }); }}
        />
      )}

      {editUser && (
        <EditarUsuarioModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onDone={() => { setEditUser(null); qc.invalidateQueries({ queryKey: ['admin-users'] }); }}
        />
      )}
    </div>
  );
}

/**
 * Editar un usuario: rol, grupo de trabajo y nombre. Sirve, entre otras cosas,
 * para convertir un USER de contabilidad en ADMIN (así puede cargar la e.firma).
 * No ofrece SUPER_ADMIN: ese rol se maneja aparte (opera la plataforma).
 */
function EditarUsuarioModal({ user, onClose, onDone }: { user: any; onClose: () => void; onDone: () => void }) {
  const [firstName, setFirstName] = useState(user.first_name || '');
  const [lastName, setLastName] = useState(user.last_name || '');
  const [role, setRole] = useState(user.role || 'USER');
  const [workGroup, setWorkGroup] = useState<string>(user.work_group || 'CONTABILIDAD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const rolesEditables = ROLES.filter((r) => r.value !== 'SUPER_ADMIN');

  const guardar = async () => {
    setBusy(true); setError('');
    try {
      await api.adminUpdateUser(user.id, { firstName, lastName, role, workGroup });
      onDone();
    } catch (e: any) { setError(e?.response?.data?.message || e?.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-900">Editar usuario</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-500 font-mono">{user.email}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Nombre</span>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="input w-full mt-1 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Apellido</span>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="input w-full mt-1 text-sm" />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Rol</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="input w-full mt-1 text-sm">
              {rolesEditables.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Grupo de trabajo</span>
            <select value={workGroup} onChange={(e) => setWorkGroup(e.target.value)} className="input w-full mt-1 text-sm">
              {(Object.keys(WORK_GROUP_LABELS) as WorkGroup[]).map((g) => (
                <option key={g} value={g}>{WORK_GROUP_LABELS[g]}</option>
              ))}
            </select>
          </label>
          <p className="text-[11px] text-gray-500">
            Convertir a <b>Admin (empresa)</b> le da acceso completo dentro de su empresa —incluida la carga de la e.firma— sin ser super administrador.
          </p>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
          <button onClick={guardar} disabled={busy}
            className="bg-primary text-white px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Permisos de un usuario — las DOS capas, que conviene no confundir:
 *
 *   · Grupo de trabajo → QUÉ PANTALLAS ve. Es lo que esconde módulos del menú.
 *   · Capacidades      → QUÉ PUEDE HACER dentro de esas pantallas.
 *
 * Un almacenista y un auditor pueden compartir grupo (los dos ven Almacén) y
 * diferir en capacidades: uno autoriza ajustes de inventario y el otro solo
 * mira. Por eso se editan juntas pero se muestran separadas.
 *
 * ADMIN y MANAGER tienen todas las capacidades por su rol: el bloque se
 * desactiva en vez de mentir con casillas que no hacen nada.
 */
function PermissionsModal({ user, onClose, onDone }: any) {
  const [data, setData] = useState<any | null>(null);
  const [workGroup, setWorkGroup] = useState<string>('');
  const [caps, setCaps] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const cargar = async () => {
    try {
      const r = await api.adminGetUserPermissions(user.id);
      const d: any = r.data;
      setData(d);
      setWorkGroup(d.work_group || 'ADMIN_ALL');
      setCaps(new Set(d.granted_capabilities || []));
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message);
    }
  };
  useEffect(() => { cargar(); /* eslint-disable-next-line */ }, [user.id]);

  const guardar = async () => {
    setBusy(true); setError('');
    try {
      await api.adminSetUserPermissions(user.id, {
        workGroup,
        // Solo se mandan si aplican: para ADMIN/MANAGER el backend lo rechaza
        // a propósito, y mandarlas sería pedirle que falle.
        ...(data?.capabilities_apply ? { capabilities: Array.from(caps) } : {}),
      });
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  const toggle = (k: string) => setCaps(s => {
    const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n;
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white">
          <div>
            <h2 className="font-bold text-lg">Permisos de {user.first_name} {user.last_name}</h2>
            <p className="text-xs text-gray-500 font-mono">{user.email} · {user.role}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-5">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}
          {!data && !error && <p className="text-sm text-gray-500">Cargando permisos…</p>}

          {data && (
            <>
              {/* ── Capa 1: qué pantallas ve ── */}
              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-1">Grupo de trabajo</h3>
                <p className="text-xs text-slate-500 mb-2">Define qué módulos aparecen en su menú.</p>
                <select value={workGroup} onChange={e => setWorkGroup(e.target.value)} className="input w-full">
                  {(Object.keys(WORK_GROUP_LABELS) as WorkGroup[]).map(g => (
                    <option key={g} value={g}>{WORK_GROUP_LABELS[g]}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-600 mt-2 bg-slate-50 border border-slate-200 rounded px-3 py-2">
                  {WORK_GROUP_DETAIL[workGroup as WorkGroup]}
                </p>
              </section>

              {/* ── Capa 2: qué puede hacer ── */}
              <section>
                <h3 className="text-sm font-semibold text-slate-700 mb-1">Capacidades</h3>
                {!data.capabilities_apply ? (
                  <p className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    El rol <b>{user.role}</b> ya incluye todas las capacidades operativas.
                    Las capacidades finas solo aplican a usuarios <b>Operativos (USER)</b>.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-slate-500 mb-2">
                      Acciones que puede ejecutar dentro de las pantallas que ve.
                      Consultar inventario, vender y ver reportes los tiene de base cualquier operativo.
                    </p>

                    {/* Plantillas: un clic en vez de recordar qué marca cada puesto */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {(data.templates || []).map((t: any) => (
                        <button
                          key={t.key} type="button"
                          onClick={() => setCaps(new Set(t.caps))}
                          className="text-xs px-2.5 py-1 rounded-full border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                          title={t.caps.join(', ')}
                        >{t.label}</button>
                      ))}
                    </div>

                    <div className="border rounded-lg divide-y">
                      {(data.catalog || []).map((c: any) => (
                        <label key={c.key} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                          <input type="checkbox" checked={caps.has(c.key)} onChange={() => toggle(c.key)} />
                          <span className="text-sm text-slate-700 flex-1">{c.label}</span>
                          <span className="text-[10px] font-mono text-slate-400">{c.key}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </div>

        <div className="flex gap-3 p-5 border-t sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancelar</button>
          <button type="button" onClick={guardar} disabled={busy || !data}
            className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
            {busy ? 'Guardando…' : 'Guardar permisos'}
          </button>
        </div>
      </div>
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
    violet:'text-violet-600 hover:bg-violet-50',
  };
  return <button type="button" title={title} onClick={onClick} className={`p-1.5 rounded ${map[color]}`}>{children}</button>;
}

/**
 * Alta de usuario.
 *
 * Se EXPORTA para que el listado de empresas pueda abrirla sin duplicarla: dar
 * de alta a la gente de una empresa se hace mirando la empresa, no buscándola
 * en un combo de cincuenta. Dos copias de este formulario divergirían justo en
 * la validación del grupo de trabajo, que ya rompió una vez.
 *
 * `companyFija` preselecciona y BLOQUEA la empresa. Cuando se entra desde el
 * renglón de una empresa, elegir otra en el combo sólo puede ser un error: el
 * usuario quedaría en la empresa equivocada y nadie lo notaría hasta que
 * entrara y viera datos ajenos.
 */
export function CreateUserModal({ companies, onClose, onDone, companyFija }: any) {
  const [form, setForm] = useState({
    email:'', firstName:'', lastName:'', role:'USER',
    companyId: companyFija || '', workGroup:'ADMIN_ALL',
  });
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
              <Emoji3D e="➕" size="lg" />
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
              <select disabled={!!companyFija} required className="input w-full" value={form.companyId}
                onChange={(e)=>setForm({...form,companyId:e.target.value})}>
                <option value="">— seleccionar —</option>
                {companies.map((c: any) => <option key={c.id} value={c.id}>{c.rfc} · {c.business_name}</option>)}
              </select></label>
          )}
          {(form.role === 'USER' || form.role === 'MANAGER') && (
            <label className="block"><span className="text-sm font-medium block mb-1">Grupo de trabajo <span className="text-gray-400 font-normal">(define qué pantallas ve)</span></span>
              <select className="input w-full" value={form.workGroup}
                onChange={(e)=>setForm({...form,workGroup:e.target.value})}>
                {(Object.keys(WORK_GROUP_LABELS) as WorkGroup[]).map(g => (
                  <option key={g} value={g}>{WORK_GROUP_LABELS[g]}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {WORK_GROUP_DETAIL[form.workGroup as WorkGroup]}
              </p></label>
          )}
          <p className="text-xs text-gray-500">
            Se generará una contraseña temporal. El usuario debe cambiarla en el primer login.
            {' '}ADMIN y SUPER_ADMIN ven todos los módulos.
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


/**
 * Empresas a las que tiene acceso un usuario.
 *
 * POR QUÉ EXISTE
 * `user_companies` permite que un correo administre varios RFC, pero hasta ahora
 * sólo se podía llenar con un INSERT a mano. Esta pantalla es su cara visible.
 *
 * Lo que se ve aquí determina a qué datos fiscales puede entrar esa persona, así
 * que la lista se recarga desde el servidor después de cada cambio en vez de
 * modificarse en memoria: si una asociación falla a medias, es preferible ver el
 * estado real y no el que el navegador supone.
 */
function EmpresasDeUsuarioModal({ usuario, onClose }: { usuario: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [porAgregar, setPorAgregar] = useState('');
  const [grupo, setGrupo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const asignadasQ = useQuery({
    queryKey: ['admin-user-companies', usuario.id],
    queryFn: () => api.empresasDeUsuario(usuario.id),
  });
  const asignadas: any[] = (asignadasQ.data as any)?.data || [];

  const todasQ = useQuery({
    queryKey: ['admin-companies-todas'],
    queryFn: () => api.adminListCompanies(),
  });
  const todas: any[] = ((todasQ.data as any)?.data?.companies || (todasQ.data as any)?.data || []);

  // Sólo las que aún no tiene: ofrecer una ya asignada sería un clic que falla.
  const disponibles = todas.filter((c: any) => !asignadas.some((a: any) => a.id === c.id));

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['admin-user-companies', usuario.id] });
    qc.invalidateQueries({ queryKey: ['admin-users'] });
  };

  const agregar = async () => {
    if (!porAgregar) return;
    setBusy(true); setError('');
    try {
      await api.asociarEmpresaAUsuario(usuario.id, porAgregar, grupo || undefined);
      setPorAgregar(''); setGrupo('');
      refrescar();
    } catch (e: any) {
      setError(e.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  const quitar = async (companyId: string, nombre: string) => {
    if (!confirm(
      `Quitar el acceso de ${usuario.email} a ${nombre}?\n\n` +
      `Dejará de ver sus facturas, clientes y reportes. Los datos de la empresa no se tocan.`
    )) return;
    setBusy(true); setError('');
    try {
      await api.desasociarEmpresaDeUsuario(usuario.id, companyId);
      refrescar();
    } catch (e: any) {
      setError(e.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between p-5 border-b">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Empresas del usuario</h2>
            <p className="text-sm text-gray-500 font-mono mt-0.5">{usuario.email}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>
          )}

          <p className="text-xs text-slate-600">
            Un mismo correo puede administrar varios RFC y cambiar entre ellos desde el
            Dashboard, sin cerrar sesión. Los datos de cada empresa siguen separados:
            asociarlas <b>no</b> los mezcla.
          </p>

          {/* Asignadas */}
          <div className="border border-slate-200 rounded-lg">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-sm font-medium text-slate-700">
              Con acceso ({asignadas.length})
            </div>
            {asignadasQ.isLoading ? (
              <p className="p-4 text-sm text-slate-500">Cargando…</p>
            ) : !asignadas.length ? (
              <p className="p-4 text-sm text-slate-500 italic">
                Sin empresas asignadas. Este usuario no podrá entrar hasta que tenga al menos una.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {asignadas.map((e: any) => (
                  <div key={e.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{e.business_name}</p>
                      <p className="text-xs font-mono text-slate-500">
                        {e.rfc}
                        {e.work_group ? ` · ${e.work_group}` : ''}
                      </p>
                    </div>
                    {e.is_default && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded shrink-0">
                        Por omisión
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => quitar(e.id, e.business_name)}
                      className="text-xs px-2 py-1 border border-rose-200 text-rose-700 rounded hover:bg-rose-50 disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Agregar */}
          <div className="border border-slate-200 rounded-lg p-3 space-y-2">
            <span className="text-sm font-medium text-slate-700">Dar acceso a otra empresa</span>
            <div className="flex flex-wrap gap-2">
              <select
                className="input flex-1 min-w-[14rem]"
                value={porAgregar}
                onChange={(e) => setPorAgregar(e.target.value)}
              >
                <option value="">Elige una empresa…</option>
                {disponibles.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.business_name} — {c.rfc}</option>
                ))}
              </select>
              {/* El grupo es POR EMPRESA: la misma persona puede ser de Ventas
                  en una y de Tesorería en otra. Vacío hereda el del usuario. */}
              <select className="input w-44" value={grupo} onChange={(e) => setGrupo(e.target.value)}>
                <option value="">Grupo por omisión</option>
                <option value="ADMIN_ALL">Todo (ADMIN_ALL)</option>
                <option value="VENTAS">Ventas</option>
                <option value="ALMACEN">Almacén</option>
                <option value="COMPRAS">Compras</option>
                <option value="TESORERIA">Tesorería</option>
              </select>
              <button
                type="button"
                onClick={agregar}
                disabled={busy || !porAgregar}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                Agregar
              </button>
            </div>
            {!disponibles.length && todas.length > 0 && (
              <p className="text-xs text-slate-500 italic">Ya tiene acceso a todas las empresas.</p>
            )}
          </div>
        </div>

        <div className="flex justify-end p-5 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-slate-300 rounded hover:bg-slate-50">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
