/**
 * AdminAccesos.tsx — quién administra qué empresas.
 *
 * POR QUÉ EXISTE ESTA PANTALLA
 * Dar de alta una empresa y dar de alta un usuario eran dos actos que no se
 * tocaban: al terminar los dos, nada los ligaba, y no había ningún lugar donde
 * ver esa relación. La asociación existía como un botón dentro de la fila de
 * Usuarios, pero eso responde "¿a qué empresas entra esta persona?" y no la
 * pregunta que de verdad se hace quien administra la plataforma: "¿quién tiene
 * acceso a qué, y falta ligar algo?".
 *
 * Aquí se ve de un vistazo. La columna de la izquierda lista a los usuarios con
 * cuántas empresas administra cada uno —incluido el cero, que es el caso que hay
 * que resolver—; la derecha muestra los datos de quien se elija y su lista de
 * empresas, con lo necesario para agregar o quitar.
 *
 * NO DUPLICA EL ALTA
 * Los usuarios se crean en Usuarios y las empresas en Empresas. Esta pantalla no
 * los crea: sólo los relaciona. Ofrecer aquí un tercer formulario de alta sería
 * un cuarto lugar donde equivocarse.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Building2, ShieldCheck, AlertCircle } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

export default function AdminAccesosPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [busqueda, setBusqueda] = useState('');
  const [elegido, setElegido] = useState<any | null>(null);

  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 p-6 rounded-lg">
        <p className="font-semibold mb-1">Acceso restringido</p>
        <p className="text-sm">Esta sección requiere rol <b>SUPER_ADMIN</b>.</p>
      </div>
    );
  }

  const usuariosQ = useQuery({
    queryKey: ['admin-users', busqueda],
    queryFn: () => api.adminListUsers({ search: busqueda }),
  });
  const usuarios: any[] = (usuariosQ.data as any)?.data?.users
    || (usuariosQ.data as any)?.data || [];

  /* El SUPER_ADMIN no aparece: no opera dentro de una empresa sino sobre la
   * plataforma entera, así que asignarle empresas no significaría nada. */
  const operativos = usuarios.filter((u: any) => u.role !== 'SUPER_ADMIN');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Accesos por empresa</h1>
        <p className="text-gray-600 mt-1">
          Qué empresas administra cada usuario. Un mismo correo puede tener varias
          y cambiar entre ellas desde su Dashboard.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Usuarios ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-3 border-b border-slate-200">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por correo o nombre"
                className="input w-full pl-9 text-sm"
              />
            </div>
          </div>

          <div className="max-h-[32rem] overflow-y-auto divide-y divide-slate-100">
            {usuariosQ.isLoading ? (
              <p className="p-4 text-sm text-slate-500">Cargando…</p>
            ) : !operativos.length ? (
              <p className="p-4 text-sm text-slate-500 italic">Sin usuarios operativos.</p>
            ) : (
              operativos.map((u: any) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setElegido(u)}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${
                    elegido?.id === u.id ? 'bg-indigo-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {u.first_name} {u.last_name}
                  </p>
                  <p className="text-xs font-mono text-slate-500 truncate">{u.email}</p>
                  <ConteoEmpresas userId={u.id} />
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── Detalle ─────────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          {elegido ? (
            <PanelDeUsuario
              usuario={elegido}
              onCambio={() => {
                qc.invalidateQueries({ queryKey: ['admin-user-companies', elegido.id] });
                qc.invalidateQueries({ queryKey: ['conteo-empresas', elegido.id] });
              }}
            />
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-10 text-center">
              <Building2 size={40} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-600">Elige un usuario de la lista.</p>
              <p className="text-sm text-slate-400 mt-1">
                Verás sus datos y las empresas que administra.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Cuántas empresas administra un usuario, bajo su nombre en la lista.
 *
 * El caso importante es el CERO: un usuario sin empresas no puede entrar al
 * sistema, y sin este aviso ese estado sólo se descubre cuando la persona
 * reporta que no puede trabajar.
 */
function ConteoEmpresas({ userId }: { userId: string }) {
  const q = useQuery({
    queryKey: ['conteo-empresas', userId],
    queryFn: () => api.empresasDeUsuario(userId),
  });
  const n = ((q.data as any)?.data || []).length;
  if (q.isLoading) return null;
  return n === 0 ? (
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 mt-1">
      <AlertCircle size={12} /> sin empresa asignada
    </span>
  ) : (
    <span className="text-[11px] text-slate-500 mt-1 block">
      {n} {n === 1 ? 'empresa' : 'empresas'}
    </span>
  );
}

function PanelDeUsuario({ usuario, onCambio }: { usuario: any; onCambio: () => void }) {
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
  const disponibles = todas.filter((c: any) => !asignadas.some((a: any) => a.id === c.id));

  const agregar = async () => {
    if (!porAgregar) return;
    setBusy(true); setError('');
    try {
      await api.asociarEmpresaAUsuario(usuario.id, porAgregar, grupo || undefined);
      setPorAgregar(''); setGrupo('');
      onCambio();
    } catch (e: any) {
      setError(e.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  const quitar = async (companyId: string, nombre: string) => {
    if (!confirm(
      `¿Quitar el acceso de ${usuario.email} a ${nombre}?\n\n` +
      `Dejará de ver sus facturas, clientes y reportes. Los datos de la empresa no se tocan.`
    )) return;
    setBusy(true); setError('');
    try {
      await api.desasociarEmpresaDeUsuario(usuario.id, companyId);
      onCambio();
    } catch (e: any) {
      setError(e.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* Datos del usuario */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {usuario.first_name} {usuario.last_name}
            </h2>
            <p className="text-sm font-mono text-slate-500">{usuario.email}</p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded">
            <ShieldCheck size={13} /> {usuario.role}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4 text-sm">
          <Dato titulo="Estado" valor={usuario.is_active ? 'Activo' : 'Inactivo'} />
          <Dato titulo="Grupo por omisión" valor={usuario.work_group || '—'} />
          <Dato titulo="Teléfono" valor={usuario.phone || '—'} />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>
      )}

      {/* Empresas administradas */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200">
        <div className="px-5 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800">
            Empresas que administra ({asignadas.length})
          </h3>
        </div>

        {asignadasQ.isLoading ? (
          <p className="p-5 text-sm text-slate-500">Cargando…</p>
        ) : !asignadas.length ? (
          <div className="p-5">
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Este usuario <b>no tiene ninguna empresa asignada</b>, así que no podrá
              entrar al sistema. Asígnale al menos una abajo.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {asignadas.map((e: any) => (
              <div key={e.id} className="flex items-center gap-3 px-5 py-3">
                <Building2 size={18} className="text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{e.business_name}</p>
                  <p className="text-xs font-mono text-slate-500">
                    {e.rfc}{e.work_group ? ` · ${e.work_group}` : ''}
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

        {/* Alta de acceso */}
        <div className="border-t border-slate-200 p-5 space-y-2 bg-slate-50">
          <span className="text-sm font-medium text-slate-700 block">Dar acceso a otra empresa</span>
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
            {/* El grupo es POR EMPRESA: la misma persona puede ser de Ventas en
                una y de Tesorería en otra. Vacío hereda el del usuario. */}
            <select className="input w-48" value={grupo} onChange={(e) => setGrupo(e.target.value)}>
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
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className="text-slate-800">{valor}</p>
    </div>
  );
}
