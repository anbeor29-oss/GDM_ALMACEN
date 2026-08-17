/**
 * Empleados — el expediente del personal.
 *
 * LO QUE ESTA PANTALLA TIENE QUE DEJAR CLARO
 * Un expediente incompleto NO impide dar de alta a alguien: el trabajador entra
 * el lunes y ese día muchas veces no se tiene el NSS ni su CP fiscal. Lo que sí
 * hace falta es que se VEA lo que falta, porque cada uno de esos huecos es un
 * timbrado rechazado el día de la primera nómina. Por eso cada renglón trae su
 * aviso y el listado dice cuántos expedientes están incompletos.
 *
 * LA BAJA NO BORRA
 * Los recibos timbrados siguen apuntando al expediente y la autoridad puede
 * pedirlos cinco años después. Dar de baja marca la fecha —que además es la del
 * aviso al IMSS— y saca a la persona del listado; no borra nada.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users, Plus, Search, AlertTriangle, UserMinus, UserPlus, Pencil, X, Upload,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { EmpleadoModal } from './EmpleadoModal';
import { ImportarNominaEnBloque } from './ImportarNominaEnBloque';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export function EmpleadosPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const esAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role || '');

  const [buscar, setBuscar] = useState('');
  const [incluirBajas, setIncluirBajas] = useState(false);
  const [editando, setEditando] = useState<any | null>(null);
  const [abriendoAlta, setAbriendoAlta] = useState(false);
  const [bajaDe, setBajaDe] = useState<any | null>(null);
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState('');

  const q = useQuery({
    queryKey: ['empleados', buscar, incluirBajas],
    queryFn: () => api.getEmpleados({ buscar, incluirBajas }),
  });
  const resumen = useQuery({
    queryKey: ['empleados-resumen'],
    queryFn: () => api.getEmpleadosResumen(),
  });

  const lista: any[] = q.data?.data?.empleados || [];
  const r: any = resumen.data?.data;

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['empleados'] });
    qc.invalidateQueries({ queryKey: ['empleados-resumen'] });
  };

  const abrirEdicion = async (id: string) => {
    setError('');
    try {
      const e = await api.getEmpleado(id);
      setEditando(e.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo abrir el expediente');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="text-primary" size={24} /> Empleados
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            El expediente del personal. Un trabajador no es un usuario del sistema.
          </p>
        </div>
        {esAdmin && (
          <div className="flex flex-wrap gap-2">
            {/* Primero el que sirve para arrancar: quien llega con la plantilla
                en XML no quiere teclear cincuenta expedientes. */}
            <button
              onClick={() => setImportando(true)}
              className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 text-sm"
            >
              <Upload size={16} /> Importar de recibos de nómina
            </button>
            <button
              onClick={() => setAbriendoAlta(true)}
              className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-blue-600 text-sm"
            >
              <Plus size={16} /> Nuevo trabajador
            </button>
          </div>
        )}
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      {/* Resumen de la plantilla */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tarjeta titulo="En plantilla" valor={r?.activos ?? '—'} />
        <Tarjeta titulo="Suma de salarios diarios" valor={r ? money(r.sumaSalarioDiario) : '—'} />
        <Tarjeta titulo="Con crédito INFONAVIT" valor={r?.conInfonavit ?? '—'} />
        <Tarjeta
          titulo="Expedientes incompletos"
          valor={r?.incompletos ?? '—'}
          alerta={Number(r?.incompletos || 0) > 0}
        />
      </div>

      {Number(r?.incompletos || 0) > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong>{r.incompletos}</strong> expediente(s) no tienen todo lo que el SAT pide
            para timbrar un recibo. Se pueden completar ahora o el día del primer cálculo,
            pero no después: sin esos datos el PAC rechaza el CFDI.
          </span>
        </div>
      )}

      {/* Buscador */}
      <div className="bg-white rounded-lg shadow border p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[16rem]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
            placeholder="Nombre, número de empleado, RFC, CURP o NSS…"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={incluirBajas}
            onChange={(e) => setIncluirBajas(e.target.checked)}
          />
          Ver también las bajas
        </label>
      </div>

      {/* Listado */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Núm.</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Trabajador</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Puesto</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Ingreso</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Salario diario</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">SDI</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && lista.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500 italic">
                {buscar
                  ? 'Nadie coincide con esa búsqueda.'
                  : 'Todavía no hay nadie en la plantilla. Da de alta al primer trabajador, o impórtalo desde un recibo de nómina ya timbrado en el Lector de XML.'}
              </td></tr>
            )}
            {lista.map((e) => (
              <tr key={e.id} className={e.activo ? 'hover:bg-gray-50' : 'bg-slate-50/60 text-gray-500'}>
                <td className="px-3 py-1.5 text-sm font-mono">{e.num_empleado}</td>
                <td className="px-3 py-1.5 text-sm">
                  <p className="font-medium text-gray-900">{e.nombre_completo}</p>
                  <p className="text-[11px] text-gray-500 font-mono">{e.rfc} · {e.curp}</p>
                  {e.faltantes?.length > 0 && (
                    <p className="text-[11px] text-amber-700 flex items-center gap-1 mt-0.5">
                      <AlertTriangle size={11} /> falta: {e.faltantes.join(', ')}
                    </p>
                  )}
                  {!e.activo && (
                    <p className="text-[11px] text-rose-600">baja el {e.fecha_baja}</p>
                  )}
                </td>
                <td className="px-3 py-1.5 text-sm">
                  {e.puesto_catalogo || e.puesto || <span className="text-gray-400">—</span>}
                  {e.departamento && <p className="text-[11px] text-gray-500">{e.departamento}</p>}
                </td>
                <td className="px-3 py-1.5 text-center text-xs text-gray-600">{e.fecha_ingreso}</td>
                <td className="px-3 py-1.5 text-right text-sm">{money(e.salario_diario)}</td>
                <td className="px-3 py-1.5 text-right text-sm">
                  {Number(e.salario_diario_integrado) > 0
                    ? money(e.salario_diario_integrado)
                    : <span className="text-amber-600">—</span>}
                </td>
                <td className="px-3 py-1.5 text-center whitespace-nowrap">
                  <button
                    onClick={() => abrirEdicion(e.id)}
                    className="text-gray-500 hover:text-primary p-1"
                    title="Abrir expediente"
                  >
                    <Pencil size={15} />
                  </button>
                  {esAdmin && e.activo && (
                    <button
                      onClick={() => setBajaDe(e)}
                      className="text-gray-500 hover:text-rose-600 p-1"
                      title="Dar de baja"
                    >
                      <UserMinus size={15} />
                    </button>
                  )}
                  {esAdmin && !e.activo && (
                    <button
                      onClick={async () => {
                        const hoy = new Date().toISOString().slice(0, 10);
                        await api.reingresarEmpleado(e.id, hoy);
                        refrescar();
                      }}
                      className="text-gray-500 hover:text-emerald-600 p-1"
                      title="Reingreso"
                    >
                      <UserPlus size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(abriendoAlta || editando) && (
        <EmpleadoModal
          empleado={editando}
          onClose={() => { setAbriendoAlta(false); setEditando(null); }}
          onGuardado={() => { setAbriendoAlta(false); setEditando(null); refrescar(); }}
        />
      )}

      {importando && (
        <ImportarNominaEnBloque
          onClose={() => setImportando(false)}
          onListo={refrescar}
        />
      )}

      {bajaDe && (
        <ModalBaja
          empleado={bajaDe}
          onClose={() => setBajaDe(null)}
          onHecho={() => { setBajaDe(null); refrescar(); }}
        />
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, alerta }: { titulo: string; valor: any; alerta?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${alerta ? 'bg-amber-50 border-amber-200' : 'bg-white'}`}>
      <p className="text-xs text-gray-500">{titulo}</p>
      <p className={`text-xl font-bold mt-1 ${alerta ? 'text-amber-800' : 'text-gray-900'}`}>{valor}</p>
    </div>
  );
}

/** La baja pide su fecha porque es la que va en el aviso al IMSS. */
function ModalBaja({ empleado, onClose, onHecho }: any) {
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const confirmar = async () => {
    setGuardando(true); setError('');
    try {
      await api.darDeBajaEmpleado(empleado.id, fecha, motivo);
      onHecho();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo registrar la baja');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5">
        <div className="flex items-start justify-between">
          <h2 className="font-semibold text-lg">Dar de baja a {empleado.nombre_completo}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-600 mt-2">
          El expediente NO se borra: los recibos que ya se le timbraron siguen apuntando a él.
          Sale de la plantilla activa y queda con su fecha de baja.
        </p>
        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}
        <label className="block text-sm font-medium text-gray-700 mt-4 mb-1">Fecha de baja</label>
        <input
          type="date"
          className="w-full border rounded-lg px-3 py-2 text-sm"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
        />
        <p className="text-xs text-gray-500 mt-1">Es la fecha que va en el aviso al IMSS.</p>
        <label className="block text-sm font-medium text-gray-700 mt-3 mb-1">Motivo (opcional)</label>
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Renuncia voluntaria, término de contrato…"
        />
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={guardando}
            className="px-4 py-2 text-sm bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"
          >
            {guardando ? 'Registrando…' : 'Registrar baja'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EmpleadosPage;
