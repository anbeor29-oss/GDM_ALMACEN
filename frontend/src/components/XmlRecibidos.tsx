/**
 * XmlRecibidos — descarga masiva del SAT y los comprobantes que trajo.
 *
 * LA PANTALLA CUENTA UN PROCESO LARGO, NO UNA ACCIÓN
 * Pedirle un año al SAT no es apretar un botón y esperar: son decenas de
 * solicitudes que él procesa en minutos u horas. Por eso lo que se ve no es una
 * barra de progreso sino el estado de cada trabajo, y un botón para empujarlo
 * si alguien tiene prisa. Prometer inmediatez aquí sería mentir.
 *
 * LA e.firma SE PIDE UNA VEZ Y NO SE DEVUELVE NUNCA
 * Se sube, se cifra y se usa. La pantalla sólo muestra RFC, número de serie y
 * vigencia — lo suficiente para saber cuál está cargada y cuándo hay que
 * renovarla.
 */
import { Fragment, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound, Download, Trash2, PlayCircle, FileText, AlertTriangle, RefreshCw,
  ChevronRight, ChevronDown,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { fechaMx } from '@/utils/fecha';
import { CampoFecha } from '@/components/CampoFecha';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const fecha = (d: any) => (d ? fechaMx(d) : '—');

/** AAAA-MM-DD en hora local: `toISOString` cambia el día al pasar por UTC. */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const primerDiaDelMes = (d: Date) => iso(new Date(d.getFullYear(), d.getMonth(), 1));

/**
 * Atajos de periodo.
 *
 * Son los cortes con los que de verdad se trabaja: el mes que se está
 * conciliando, el anterior cuando se cierra, el trimestre para los pagos
 * provisionales y el ejercicio completo cuando llega la anual. Teclear dos
 * fechas para eso, cada vez, es trabajo que la pantalla puede ahorrar.
 */
function atajos(hoy: Date): Array<{ nombre: string; desde: string; hasta: string }> {
  const a = hoy.getFullYear();
  const m = hoy.getMonth();
  const finDeMes = (anio: number, mes: number) => iso(new Date(anio, mes + 1, 0));
  return [
    { nombre: 'Este mes',      desde: iso(new Date(a, m, 1)),      hasta: iso(hoy) },
    { nombre: 'Mes pasado',    desde: iso(new Date(a, m - 1, 1)),  hasta: finDeMes(a, m - 1) },
    { nombre: 'Últimos 3 meses', desde: iso(new Date(a, m - 2, 1)), hasta: iso(hoy) },
    { nombre: `Año ${a}`,      desde: iso(new Date(a, 0, 1)),      hasta: iso(hoy) },
    { nombre: `Año ${a - 1}`,  desde: iso(new Date(a - 1, 0, 1)),  hasta: finDeMes(a - 1, 11) },
  ];
}

const ESTADO_TRABAJO: Record<string, { label: string; cls: string }> = {
  CREADO:      { label: 'Creado',      cls: 'bg-gray-200 text-gray-700' },
  EN_PROCESO:  { label: 'En proceso',  cls: 'bg-sky-100 text-sky-700' },
  TERMINADO:   { label: 'Terminado',   cls: 'bg-emerald-100 text-emerald-700' },
  CON_ERRORES: { label: 'Con errores', cls: 'bg-amber-100 text-amber-700' },
  CANCELADO:   { label: 'Cancelado',   cls: 'bg-rose-100 text-rose-700' },
};

export function XmlRecibidos({ direccionInicial }: {
  /**
   * Con qué dirección abre la pantalla.
   *
   * La usan los dos submenús de "XML del SAT": recibidos y emitidos son
   * consultas distintas al SAT —el servicio las pide por separado— y responden
   * preguntas distintas. Sin esto, entrar por "emitidos" abría la pantalla en
   * recibidos y había que cambiarlo a mano cada vez.
   *
   * Sigue siendo un valor INICIAL y no una imposición: el selector queda
   * disponible, porque a veces se entra por un lado y se termina pidiendo el
   * otro sin querer salirse.
   */
  direccionInicial?: 'recibidos' | 'emitidos';
} = {}) {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const esAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role || '');

  const hoy = new Date();
  /* El periodo es un RANGO libre, no un mes.
   *
   * Con año y mes había que pedir doce veces para traerse un ejercicio, y cada
   * petición es una vuelta completa de solicitud, espera y recogida. El SAT
   * entrega miles de comprobantes por paquete: acotar la pantalla a un mes
   * desperdiciaba esa capacidad y multiplicaba el trabajo de quien la usa. */
  const [desde, setDesde] = useState(primerDiaDelMes(hoy));
  const [hasta, setHasta] = useState(iso(hoy));
  const [que, setQue] = useState<'recibidos' | 'emitidos' | 'ambos'>(direccionInicial || 'recibidos');
  /* Los cancelados no se pueden bajar como XML; sólo su metadato. Cuando se marca,
   * junto al pedido normal se lanza otro de tipo Metadata acotado a cancelados. */
  const [cancelados, setCancelados] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  const [expandido, setExpandido] = useState<string | null>(null);

  /* Los filtros de la lista de abajo salen del mismo rango: pedir un periodo y
   * que la tabla siga mostrando otro sería enseñar lo que no se acaba de traer. */
  const anio = Number(desde.slice(0, 4));
  const mes = desde.slice(0, 7) === hasta.slice(0, 7) ? Number(desde.slice(5, 7)) : undefined;

  const credQ = useQuery({ queryKey: ['sat-credencial'], queryFn: () => api.getSatCredencial() });
  const credencial = credQ.data?.data?.credencial;
  const bovedaLista = credQ.data?.data?.bovedaLista;

  const trabajosQ = useQuery({ queryKey: ['sat-trabajos'], queryFn: () => api.getSatTrabajos() });
  const trabajos: any[] = trabajosQ.data?.data?.trabajos || [];

  const compQ = useQuery({
    queryKey: ['sat-comprobantes', anio, mes],
    queryFn: () => api.getSatComprobantes({ anio, mes }),
  });
  const comprobantes: any[] = compQ.data?.data?.comprobantes || [];

  const resumenQ = useQuery({
    queryKey: ['sat-resumen', anio, mes],
    queryFn: () => api.getSatResumen(anio, mes),
  });
  const resumen = resumenQ.data?.data;

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['sat-trabajos'] });
    qc.invalidateQueries({ queryKey: ['sat-comprobantes'] });
    qc.invalidateQueries({ queryKey: ['sat-resumen'] });
    qc.invalidateQueries({ queryKey: ['sat-credencial'] });
  };

  const avanzar = async () => {
    setCargando(true); setError(''); setAviso('');
    try {
      const r = await api.avanzarSatDescarga();
      const d: any = r.data;
      setAviso(
        `${d.solicitados} solicitud(es) enviadas · ${d.verificados} verificadas · ` +
        `${d.descargados} paquete(s) recogidos · ${d.divididos} rango(s) partidos.` +
        (d.errores?.length ? ` Con avisos: ${d.errores[0]}` : '')
      );
      refrescar();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo avanzar');
    } finally { setCargando(false); }
  };

  const dias = Math.max(
    1,
    Math.round((new Date(hasta).getTime() - new Date(desde).getTime()) / 86_400_000) + 1
  );

  const pedirPeriodo = async () => {
    if (new Date(hasta) < new Date(desde)) {
      setError('La fecha final es anterior a la inicial.');
      return;
    }
    setCargando(true); setError(''); setAviso('');
    try {
      const r = await api.crearSatTrabajo({ desde, hasta, direccion: que });
      const d: any = r.data;
      /* Los cancelados van en un pedido aparte, de metadatos: no topan con el 301
       * ("no se descargan XML cancelados") porque no se pide el XML, sólo el dato. */
      if (cancelados) {
        await api.crearSatTrabajo({ desde, hasta, direccion: que, tipo: 'Metadata', filtros: { estadoComprobante: '0' } });
      }
      setAviso(
        `${d.trabajos.length === 2 ? 'Dos trabajos creados' : 'Trabajo creado'} con ` +
        `${d.particiones_total} solicitud(es) de ${d.dias_por_bloque} días` +
        (cancelados ? ', más el de cancelados (metadatos)' : '') + '. El SAT tarda ' +
        'de minutos a horas; el proceso avanza solo cada 15 minutos, o con "Avanzar ahora".'
      );
      refrescar();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo crear el trabajo');
    } finally { setCargando(false); }
  };

  return (
    <div className="space-y-6">
      {aviso && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-sm">{aviso}</div>}
      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      {bovedaLista === false && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-3 rounded-lg text-sm space-y-1">
          <p>
            <strong>Falta configurar la bóveda.</strong> La descarga masiva guarda la
            e.firma cifrada y necesita su llave maestra en el servidor
            (<code>SAT_VAULT_KEY</code>, de 32 caracteres o más). Sin ella, el módulo no
            acepta credenciales — a propósito: una bóveda con llave conocida no protege nada.
          </p>
          <p className="text-xs">
            Se agrega en las variables de entorno del backend. Mientras tanto, esta
            pantalla no pide la e.firma: no tendría dónde guardarla.
          </p>
        </div>
      )}

      {/* ── La e.firma ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow border p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <KeyRound className="text-emerald-600" size={20} /> e.firma del contribuyente
        </h2>
        {credencial ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span><strong>{credencial.rfc}</strong></span>
            <span className="text-gray-500 font-mono text-xs">serie {credencial.numero_serie}</span>
            <span className={credencial.vencida ? 'text-rose-700 font-semibold' : 'text-gray-600'}>
              vence {fecha(credencial.vigencia_hasta)}{credencial.vencida && ' · VENCIDA'}
            </span>
            {esAdmin && (
              <button
                onClick={async () => {
                  if (!window.confirm('¿Borrar la e.firma guardada? Habrá que cargarla otra vez para descargar.')) return;
                  await api.borrarSatCredencial(); refrescar();
                }}
                className="ml-auto flex items-center gap-1.5 text-rose-600 hover:bg-rose-50 px-2 py-1 rounded text-sm">
                <Trash2 size={15} /> Borrar
              </button>
            )}
          </div>
        ) : bovedaLista === false ? (
          /* Sin bóveda no se pide la e.firma.
           *
           * Pedirla igual —como pasaba antes— hacía que alguien eligiera sus
           * archivos, tecleara la contraseña de su llave privada y la mandara por
           * la red para recibir a cambio un error de configuración del servidor.
           * Si ya se sabe que va a fallar, no se pide. */
          <p className="text-sm text-gray-500 italic">
            La carga de la e.firma se habilita en cuanto el servidor tenga su llave
            maestra (el aviso de arriba).
          </p>
        ) : esAdmin ? (
          <FormaEfirma onCargada={(msg) => { setAviso(msg); refrescar(); }} onError={setError} />
        ) : (
          <p className="text-sm text-gray-500 italic">
            No hay e.firma cargada. Sólo un administrador puede cargarla.
          </p>
        )}
      </div>

      {/* ── Pedir y avanzar ────────────────────────────────────────────── */}
      {credencial && !credencial.vencida && esAdmin && (
        <div className="bg-white rounded-lg shadow border p-5 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Download className="text-emerald-600" size={20} /> Traer comprobantes del SAT
          </h2>
          {/* Atajos: los cortes con los que de verdad se trabaja. */}
          <div className="flex flex-wrap gap-2">
            {atajos(hoy).map((a) => {
              const activo = a.desde === desde && a.hasta === hasta;
              return (
                <button key={a.nombre}
                  onClick={() => { setDesde(a.desde); setHasta(a.hasta); }}
                  className={`px-3 py-1 rounded-full text-xs border ${
                    activo
                      ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-medium'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                  {a.nombre}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Desde</span>
              <CampoFecha value={desde} onChange={(v) => setDesde(v)} className="input w-44" />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Hasta</span>
              <CampoFecha value={hasta} onChange={(v) => setHasta(v)} className="input w-44" />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600 mb-1">Qué traer</span>
              <select value={que} onChange={(e) => setQue(e.target.value as any)} className="input w-48">
                <option value="recibidos">Recibidos</option>
                <option value="emitidos">Emitidos</option>
                <option value="ambos">Recibidos y emitidos</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600 pb-2"
              title="El XML de un cancelado no se puede bajar; se recupera su metadato (UUID, partes, monto, fecha de cancelación).">
              <input type="checkbox" checked={cancelados} onChange={(e) => setCancelados(e.target.checked)} />
              También los cancelados
            </label>
            <button onClick={pedirPeriodo} disabled={cargando}
              className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 text-sm">
              <Download size={16} /> {cargando ? 'Pidiendo…' : 'Pedir al SAT'}
            </button>
            <button onClick={avanzar} disabled={cargando}
              title="El proceso avanza solo cada 15 minutos; esto lo empuja ahora"
              className="ml-auto flex items-center gap-2 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-sm">
              <PlayCircle size={16} className={cargando ? 'animate-spin' : ''} /> Avanzar ahora
            </button>
          </div>

          <p className="text-xs text-gray-500">
            {dias} día(s) seleccionados{que === 'ambos' && ', en dos trabajos (el SAT pide emitidos y recibidos por separado)'}.
            El SAT entrega por lotes: acepta la solicitud, la procesa de minutos a horas y deja
            un paquete que caduca a las 72 horas. El motor pide, espera y recoge solo; si un
            rango trae demasiados comprobantes, lo parte a la mitad y reintenta.
            {dias > 180 && ' En periodos largos se empieza con bloques de 30 días para no gastar el límite diario de solicitudes del SAT.'}
          </p>
        </div>
      )}

      {/* ── Trabajos ───────────────────────────────────────────────────── */}
      {trabajos.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <p className="px-4 pt-3 text-xs text-gray-500">
            Toca un renglón para ver, solicitud por solicitud, qué contestó el SAT.
          </p>
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="w-8"></th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Periodo</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Qué</th>
                <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Solicitudes</th>
                <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Paquetes</th>
                <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">XML</th>
                <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {trabajos.map((t) => {
                const e = ESTADO_TRABAJO[t.estado] || { label: t.estado, cls: 'bg-gray-100 text-gray-600' };
                const abierto = expandido === t.id;
                return (
                  <Fragment key={t.id}>
                    <tr className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandido(abierto ? null : t.id)}>
                      <td className="pl-3 text-gray-400">
                        {abierto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </td>
                      <td className="px-4 py-2 text-sm">
                        {fecha(t.fecha_desde)} → {fecha(t.fecha_hasta)}
                        {t.ultimo_mensaje && (
                          <p className="text-[11px] text-rose-600 mt-0.5 line-clamp-2 max-w-md">
                            {t.ultimo_mensaje}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm">{t.direccion} · {t.tipo}</td>
                      <td className="px-4 py-2 text-center text-sm">
                        {t.particiones_listas}/{t.particiones_total}
                      </td>
                      <td className="px-4 py-2 text-center text-sm">{t.paquetes}</td>
                      <td className="px-4 py-2 text-center text-sm font-semibold">{t.xml_total}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${e.cls}`}>{e.label}</span>
                      </td>
                    </tr>
                    {abierto && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <TrabajoDetalle trabajoId={t.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Los comprobantes traídos ───────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow border p-4 flex flex-wrap items-center gap-4">
        <h2 className="font-semibold flex items-center gap-2">
          <FileText className="text-emerald-600" size={20} /> Comprobantes del periodo
        </h2>
        {resumen && (
          <span className="text-sm text-gray-600">
            {resumen.total} comprobante(s) · {resumen.recibidos} recibidos de{' '}
            {resumen.emisores} emisor(es) · {money(resumen.importe_recibidos)}
          </span>
        )}
        <button onClick={refrescar} className="ml-auto text-gray-500 hover:text-gray-700" title="Actualizar">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Fecha</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Emisor</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Folio fiscal</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Tipo</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {compQ.isLoading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!compQ.isLoading && comprobantes.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500 italic">
                Sin comprobantes de ese mes. Pide el periodo arriba: lo que el SAT entregue
                aparecerá aquí conforme llegue.
              </td></tr>
            )}
            {comprobantes.map((c) => {
              const cancelado = c.estado_sat === 'Cancelado';
              return (
              <tr key={c.id} className={cancelado ? 'bg-rose-50/40 text-gray-500' : 'hover:bg-gray-50'}>
                <td className="px-4 py-2 text-sm whitespace-nowrap">{fecha(c.fecha_emision)}</td>
                <td className="px-4 py-2 text-sm">
                  <p className="font-medium truncate max-w-xs">{c.nombre_emisor || '—'}</p>
                  <p className="text-xs text-gray-500 font-mono">{c.rfc_emisor}</p>
                </td>
                <td className="px-4 py-2 text-xs font-mono text-gray-600">
                  {c.uuid}
                  {cancelado && (
                    <span className="ml-2 text-[10px] font-sans bg-rose-100 text-rose-700 rounded px-1.5 py-0.5">Cancelado</span>
                  )}
                </td>
                <td className="px-4 py-2 text-center text-xs">{c.tipo_comprobante || '—'}</td>
                <td className="px-4 py-2 text-right font-semibold">{money(c.total)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* Estado real de cada solicitud (partición) y de cada paquete. Es lo que la
 * tabla de arriba esconde: "5/8 listas" mete en el mismo saco lo TERMINADO, lo
 * SIN DATOS y lo RECHAZADO, y sólo aquí se separan con su motivo. */
const ESTADO_PARTICION: Record<string, { label: string; cls: string }> = {
  PENDIENTE:  { label: 'Pendiente',  cls: 'bg-gray-100 text-gray-600' },
  SOLICITADA: { label: 'Solicitada', cls: 'bg-sky-100 text-sky-700' },
  EN_PROCESO: { label: 'En proceso', cls: 'bg-sky-100 text-sky-700' },
  TERMINADA:  { label: 'Con datos',  cls: 'bg-emerald-100 text-emerald-700' },
  SIN_DATOS:  { label: 'Sin datos',  cls: 'bg-slate-100 text-slate-600' },
  DIVIDIDA:   { label: 'Partida',    cls: 'bg-violet-100 text-violet-700' },
  RECHAZADA:  { label: 'Rechazada',  cls: 'bg-rose-100 text-rose-700' },
  FALLIDA:    { label: 'Fallida',    cls: 'bg-rose-100 text-rose-700' },
};

const COLOR_PAQUETE: Record<string, string> = {
  PENDIENTE: 'text-gray-600', DESCARGANDO: 'text-sky-700',
  EXTRAIDO: 'text-emerald-700', FALLIDO: 'text-rose-700',
};

/**
 * El detalle de un trabajo: una tarjeta por solicitud (partición) con el estado
 * y el mensaje TEXTUAL del SAT, y debajo sus paquetes. Es la respuesta a "dice
 * 5/8 pero no aparece nada": aquí se ve si esas cinco fueron rechazadas (con su
 * código), si vinieron sin datos, o si el paquete está y falta bajarlo.
 */
function TrabajoDetalle({ trabajoId }: { trabajoId: string }) {
  const q = useQuery({
    queryKey: ['sat-trabajo-detalle', trabajoId],
    queryFn: () => api.getSatTrabajoDetalle(trabajoId),
    refetchInterval: 30_000,
  });
  const d: any = q.data?.data;

  if (q.isLoading) return <p className="p-3 text-sm text-gray-500 bg-gray-50/70">Cargando detalle…</p>;
  const parts: any[] = d?.particiones || [];
  if (parts.length === 0) {
    return <p className="p-3 text-sm text-gray-500 bg-gray-50/70">Este trabajo todavía no tiene solicitudes.</p>;
  }

  return (
    <div className="p-3 bg-gray-50/70 space-y-2">
      <p className="text-[11px] text-gray-500">
        Cada tarjeta es una solicitud al SAT. <b>Rechazada</b> con un código es un problema de la
        solicitud (p. ej. el sello); <b>Sin datos</b> significa que no había comprobantes en ese rango;
        <b> Con datos</b> trae paquetes que se bajan solos.
      </p>
      {parts.map((p) => {
        const ep = ESTADO_PARTICION[p.estado] || { label: p.estado, cls: 'bg-gray-100 text-gray-600' };
        const paquetes: any[] = p.paquetes || [];
        return (
          <div key={p.id} className="rounded border bg-white p-2">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="font-medium text-gray-800">{fecha(p.desde)} → {fecha(p.hasta)}</span>
              <span className={`px-2 py-0.5 rounded-full font-medium ${ep.cls}`}>{ep.label}</span>
              {p.codigo_sat && <span className="font-mono text-[10px] text-gray-500">[{p.codigo_sat}]</span>}
              {p.cfdi_contados > 0 && <span className="text-gray-600">{p.cfdi_contados} CFDI</span>}
              {p.intentos > 0 && <span className="text-gray-400">· {p.intentos} intento(s)</span>}
            </div>
            {p.mensaje_sat && <p className="mt-1 text-[11px] text-gray-600">{p.mensaje_sat}</p>}
            {paquetes.length > 0 && (
              <ul className="mt-1.5 pl-2 border-l-2 border-gray-100 space-y-1">
                {paquetes.map((q: any) => (
                  <li key={q.id} className="text-[11px] flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-gray-400">{String(q.id_paquete_sat).slice(0, 8)}…</span>
                    <span className={`font-medium ${COLOR_PAQUETE[q.estado] || 'text-gray-600'}`}>{q.estado}</span>
                    <span className="text-gray-600">{q.xml_extraidos ?? 0} XML</span>
                    {q.mensaje && <span className="text-rose-600">· {q.mensaje}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FormaEfirma({ onCargada, onError }: {
  onCargada: (msg: string) => void; onError: (msg: string) => void;
}) {
  const [cer, setCer] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [subiendo, setSubiendo] = useState(false);

  const subir = async () => {
    if (!cer || !key || !password) { onError('Faltan el .cer, el .key o la contraseña'); return; }
    setSubiendo(true); onError('');
    try {
      const r = await api.subirSatCredencial(cer, key, password);
      onCargada(`e.firma de ${r.data.rfc} cargada. Vence el ${fecha(r.data.vigencia_hasta)}.`);
      setCer(null); setKey(null); setPassword('');
    } catch (e: any) {
      onError(e?.response?.data?.message || 'No se pudo cargar la e.firma');
    } finally { setSubiendo(false); }
  };

  return (
    <div className="space-y-3">
      <div className="bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded text-xs flex gap-2">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <span>
          Es la <strong>e.firma</strong> (antes FIEL), no el CSD con el que se timbra.
          Suele estar en otra carpeta y sus archivos empiezan con FIEL. La contraseña es
          la de la <strong>clave privada</strong>, que no siempre es la del portal.
          Se guarda cifrada y no se puede volver a descargar por ninguna vía.
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Archivo .cer</span>
          <input type="file" accept=".cer" onChange={(e) => setCer(e.target.files?.[0] || null)}
            className="text-sm w-full" />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Archivo .key</span>
          <input type="file" accept=".key" onChange={(e) => setKey(e.target.files?.[0] || null)}
            className="text-sm w-full" />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600 mb-1">Contraseña de la clave privada</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="input w-full" autoComplete="off" />
        </label>
      </div>
      <button onClick={subir} disabled={subiendo}
        className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm">
        <KeyRound size={16} /> {subiendo ? 'Validando…' : 'Cargar e.firma'}
      </button>
    </div>
  );
}
