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
import { CampoFecha } from '@/components/CampoFecha';
import { aTextoMx } from '@/components/CampoFecha';

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
              {/* Una sola columna con los dos importes, uno debajo del otro y
                  rotulados. Dos encabezados sueltos —"Salario diario" y "SDI"—
                  se confunden en cuanto la tabla se estrecha, y confundirlos
                  cambia la cuota del IMSS de toda la plantilla. */}
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Sueldo diario / integrado</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && lista.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500 italic">
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
                    <p className="text-[11px] text-rose-600">baja el {aTextoMx(e.fecha_baja)}</p>
                  )}
                </td>
                <td className="px-3 py-1.5 text-sm">
                  {e.puesto_catalogo || e.puesto || <span className="text-gray-400">—</span>}
                  {e.departamento && <p className="text-[11px] text-gray-500">{e.departamento}</p>}
                </td>
                <td className="px-3 py-1.5 text-center text-xs text-gray-600">{aTextoMx(e.fecha_ingreso)}</td>
                <td className="px-3 py-1.5 text-right text-sm whitespace-nowrap">
                  <span className="block">
                    <span className="text-[10px] text-gray-400 mr-1">diario</span>
                    {money(e.salario_diario)}
                  </span>
                  <span className="block">
                    <span className="text-[10px] text-gray-400 mr-1">SDI</span>
                    {Number(e.salario_diario_integrado) > 0
                      ? money(e.salario_diario_integrado)
                      : <span className="text-amber-600">—</span>}
                  </span>
                  {/* El integrado por debajo del diario es imposible: el factor
                      nunca baja de 1. Casi siempre significa que se capturaron
                      al revés. */}
                  {Number(e.salario_diario_integrado) > 0 &&
                   Number(e.salario_diario_integrado) < Number(e.salario_diario) && (
                    <span className="block text-[10px] text-amber-700">
                      el SDI no puede ser menor que el diario
                    </span>
                  )}
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
  const [vacTomadas, setVacTomadas] = useState('0');
  /* Desde qué día se le debe el sueldo. Es el inicio del periodo especial, y de
   * ahí sale "su semana": el motor cobra los días del periodo como en cualquier
   * nómina. Vacío = sólo el día de la baja, que es lo conservador. */
  const [desdeDias, setDesdeDias] = useState('');

  /* Los días que se le deben salen del RANGO, no se teclean: capturar "5 días"
   * y "del 10 al 15" por separado invita a que no coincidan, y el periodo
   * especial se genera con el rango. */
  const diasDelTramo = (() => {
    if (!desdeDias || desdeDias > fecha) return 0;
    const a = new Date(`${desdeDias}T12:00:00`).getTime();
    const b = new Date(`${fecha}T12:00:00`).getTime();
    return Math.round((b - a) / 86400000) + 1;
  })();

  /* El finiquito se recalcula con cada cambio de fecha o de captura. Es una
   * consulta barata y sin efectos: no escribe nada. */
  const fin = useQuery({
    queryKey: ['finiquito', empleado.id, fecha, desdeDias, vacTomadas],
    queryFn: () => api.getFiniquito(empleado.id, {
      fechaBaja: fecha,
      diasPendientesDePagar: diasDelTramo,
      vacacionesYaDisfrutadas: Number(vacTomadas) || 0,
    }),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(fecha),
    retry: false,
  });
  const calc: any = fin.data?.data;

  /* Dar de baja y dejar el pago listo son DOS cosas.
   *
   * La baja es el aviso al IMSS; el periodo especial es el pago. Se hacen en ese
   * orden y en la misma acción porque en la práctica van juntas, pero si la
   * segunda falla la primera queda hecha — y hay que decirlo, no callarlo. */
  const confirmar = async (pasar: 'FINIQUITO' | 'LIQUIDACION' | null) => {
    setGuardando(true); setError('');
    try {
      await api.darDeBajaEmpleado(empleado.id, fecha, motivo);
      if (pasar) {
        const r = await api.finiquitoANominaEspecial(empleado.id, {
          fechaBaja: fecha,
          tipo: pasar,
          desde: desdeDias || undefined,
          vacacionesYaDisfrutadas: Number(vacTomadas) || 0,
          motivo: motivo || undefined,
        });
        window.alert(r?.data?.aviso || 'Periodo especial creado.');
      }
      onHecho();
    } catch (e: any) {
      const m = e?.response?.data?.message || 'No se pudo completar';
      setError(
        pasar
          ? `${m} — La baja SÍ quedó registrada; lo que falló fue crear el periodo especial. `
            + 'Puedes generarlo a mano en Nómina, tipo Especial.'
          : m
      );
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full p-5 max-h-[90vh] overflow-y-auto">
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
        <CampoFecha value={fecha} onChange={setFecha} />
        <p className="text-xs text-gray-500 mt-1">Es la fecha que va en el aviso al IMSS.</p>

        {/* ── Lo que se le debe ──
            Se calcula al vuelo con la fecha que esté puesta, y NO se guarda:
            cambiar el día cambia los proporcionales, así que verlo antes de
            firmar es justo el punto. */}
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Se le debe el sueldo desde</label>
            <CampoFecha value={desdeDias} max={fecha} onChange={setDesdeDias} />
            <p className="text-[10px] text-gray-500 mt-0.5">
              El primer día no pagado{diasDelTramo > 0 ? ` — ${diasDelTramo} día(s)` : ''}.
              Vacío = sólo el día de la baja.
            </p>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Vacaciones ya disfrutadas</label>
            <input type="number" min={0} step="0.5" value={vacTomadas}
              onChange={(e) => setVacTomadas(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm" />
            <p className="text-[10px] text-gray-500 mt-0.5">
              Días que ya tomó en este año de servicio; se restan de lo proporcional.
            </p>
          </div>
        </div>

        {fin.isFetching && <p className="text-sm text-gray-500 mt-3">Calculando…</p>}
        {fin.isError && (
          <p className="text-sm text-rose-600 mt-3">
            {(fin.error as any)?.response?.data?.message || 'No se pudo calcular el finiquito'}
          </p>
        )}

        {calc && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-gray-600">
              Antigüedad al {calc.fechaBaja}: <b>{calc.antiguedad.texto}</b>
              {' · '}diario {money(calc.empleado.salario_diario)}
              {' · '}SDI {money(calc.empleado.salario_diario_integrado)}
            </p>

            {calc.avisos?.map((a: string, i: number) => (
              <p key={i} className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {a}
              </p>
            ))}

            <div className="grid md:grid-cols-2 gap-3">
              <Cuenta
                titulo="Finiquito"
                subtitulo="Se paga SIEMPRE, se vaya como se vaya"
                conceptos={calc.finiquito.conceptos}
                total={calc.finiquito.total}
                tono="emerald"
              />
              <Cuenta
                titulo="Liquidación"
                subtitulo="SÓLO si el despido es injustificado"
                conceptos={calc.liquidacion.conceptos}
                total={calc.liquidacion.total}
                tono="rose"
              />
            </div>

            <p className="text-sm text-right">
              Finiquito más indemnización:{' '}
              <b className="text-lg">{money(calc.totalConIndemnizacion)}</b>
            </p>
            <p className="text-[11px] text-gray-500">
              Al elegir uno de los dos botones de abajo se crea un periodo <b>ESPECIAL con
              sólo esta persona</b> —no con la plantilla— que trae los días que se le deben
              más estos conceptos. Ahí se le aplican las exenciones del Art. 93 y se timbra.
              Cuál de las dos columnas se paga es decisión de quien liquida.
            </p>
          </div>
        )}
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
          {/* Tres caminos explícitos. Cuál se paga es decisión jurídica y el
              sistema no la toma por nadie: cada botón dice qué va a hacer. */}
          <button
            onClick={() => confirmar(null)}
            disabled={guardando}
            className="px-4 py-2 text-sm border border-rose-300 text-rose-700 rounded-lg hover:bg-rose-50 disabled:opacity-50"
          >
            {guardando ? 'Registrando…' : 'Sólo dar de baja'}
          </button>
          <button
            onClick={() => confirmar('FINIQUITO')}
            disabled={guardando || !calc}
            className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            Baja + finiquito a nómina
          </button>
          <button
            onClick={() => confirmar('LIQUIDACION')}
            disabled={guardando || !calc}
            className="px-4 py-2 text-sm bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"
          >
            Baja + liquidación a nómina
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Una de las dos columnas de la cuenta. Cada renglón trae su fundamento legal:
 * quien firma un finiquito tiene que poder decir de dónde salió cada número, y
 * ponerlo aquí evita la hoja de Excel paralela.
 */
function Cuenta({ titulo, subtitulo, conceptos, total, tono }: any) {
  const colores: any = {
    emerald: 'border-emerald-200 bg-emerald-50',
    rose: 'border-rose-200 bg-rose-50',
  };
  return (
    <div className={`rounded-lg border p-3 ${colores[tono]}`}>
      <p className="font-semibold text-sm">{titulo}</p>
      <p className="text-[11px] text-gray-600 mb-2">{subtitulo}</p>
      <table className="w-full text-xs tabular-nums">
        <tbody className="divide-y divide-black/5">
          {conceptos.map((c: any, i: number) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <span className="text-gray-800">{c.concepto}</span>
                <span className="block text-[10px] text-gray-500">{c.fundamento}</span>
              </td>
              <td className="py-1 text-right whitespace-nowrap align-top">
                <span className="block">{money(c.importe)}</span>
                <span className="block text-[10px] text-gray-500">
                  {c.dias} d × {money(c.base)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-black/10">
          <tr className="font-semibold">
            <td className="pt-1.5">Total</td>
            <td className="pt-1.5 text-right">{money(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default EmpleadosPage;
