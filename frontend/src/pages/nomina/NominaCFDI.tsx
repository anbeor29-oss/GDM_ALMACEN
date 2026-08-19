/**
 * NominaCFDI — los recibos generados, antes y después de timbrar.
 *
 * POR QUÉ ES UNA PANTALLA APARTE Y NO EL FINAL DE LA PRENÓMINA
 * Porque son dos momentos con dueños distintos. La prenómina la revisa quien
 * hace la nómina, ajustando días y conceptos. Timbrar es un acto fiscal: gasta
 * timbres, y deshacerlo exige una cancelación ante el SAT. Meterlo al final de
 * la misma pantalla convierte "seguir bajando" en "timbrar cincuenta recibos".
 *
 * LO QUE ESTA PANTALLA TIENE QUE DEJAR VER
 * Qué está PENDIENTE —o sea, generado pero sin timbrar—, porque eso es trabajo
 * sin terminar; y a quién se le va a mandar por correo, que es una decisión
 * aparte del timbrado y se toma antes.
 *
 * EL CORREO SE MARCA, NO SE MANDA
 * Marcar es decir "a éste sí"; el envío ocurre después del timbrado. Separarlos
 * permite revisar la lista sin arriesgar que salga un correo con un recibo que
 * todavía tiene un error.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileCode2, FileDown, Download, Eye, Mail, AlertTriangle, X, CheckCircle2, Stamp, Check,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const ESTATUS: Record<string, { label: string; cls: string }> = {
  PENDIENTE: { label: 'Sin timbrar', cls: 'bg-amber-100 text-amber-800' },
  TIMBRADO:  { label: 'Timbrado',    cls: 'bg-emerald-100 text-emerald-800' },
  CANCELADO: { label: 'Cancelado',   cls: 'bg-rose-100 text-rose-700' },
};

export function NominaCFDIPage() {
  const { user } = useAuthStore();
  const esAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role || '');

  const [estatus, setEstatus] = useState('PENDIENTE');
  const [viendo, setViendo] = useState<any | null>(null);
  /* La vista previa es el PDF, no el XML: es lo que el trabajador recibe y lo
   * que se revisa antes de timbrar. El XML sigue a un clic, para quien necesita
   * ver la estructura. */
  const [pdfUrl, setPdfUrl] = useState('');
  const [modoXml, setModoXml] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  /* Los recibos marcados para timbrar. Es una selección aparte del check de
   * envío por correo: una cosa es a quién se le manda el recibo y otra cuáles
   * se mandan al SAT. */
  const [elegidos, setElegidos] = useState<Record<string, boolean>>({});
  const [timbrando, setTimbrando] = useState(false);

  const q = useQuery({
    queryKey: ['nomina-recibos', estatus],
    queryFn: () => api.getRecibosNomina({ estatus: estatus || undefined }),
  });
  const recibos: any[] = q.data?.data?.recibos || [];

  const totales = recibos.reduce(
    (a, r) => ({
      percepciones: a.percepciones + Number(r.total_percepciones || 0),
      deducciones: a.deducciones + Number(r.total_deducciones || 0),
      neto: a.neto + Number(r.neto || 0),
    }),
    { percepciones: 0, deducciones: 0, neto: 0 }
  );

  /* Timbrar es el paso que NO se deshace: pide confirmación con el número a la
   * vista. Deshacerlo exige una cancelación ante el SAT, así que un clic de más
   * cuesta trabajo real. */
  const timbrar = async () => {
    const ids = Object.entries(elegidos).filter(([, v]) => v).map(([k]) => k);
    if (ids.length === 0) { setError('No marcaste ningún recibo'); return; }
    const sinTimbrar = recibos.filter((r) => ids.includes(r.id) && !r.uuid).length;
    if (!window.confirm(
      `Se van a timbrar ${sinTimbrar} recibo(s) ante el PAC.\n\n` +
      'Timbrar gasta timbres y deshacerlo exige una cancelación ante el SAT. ¿Sigo?'
    )) return;

    setError(''); setAviso(''); setTimbrando(true);
    try {
      const r = await api.timbrarRecibosNomina(ids);
      const d: any = r.data;
      setAviso(
        `${d.timbrados} recibo(s) timbrado(s).` +
        (d.fallaron > 0
          ? ` ${d.fallaron} no pasaron: ` +
            d.fallidos.map((x: any) => `${x.nombre} (${x.motivo})`).join(' · ')
          : '')
      );
      setElegidos({});
      q.refetch();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo timbrar');
    } finally {
      setTimbrando(false);
    }
  };

  const porTimbrar = Object.values(elegidos).filter(Boolean).length;

  /* ── Marcar todos los que se pueden timbrar ──
   *
   * "Todos" son los que NO tienen folio fiscal: uno ya timbrado no se vuelve a
   * mandar —eso sería un duplicado ante el SAT— y por eso ni siquiera tiene
   * casilla. Con cincuenta recibos, marcarlos de uno en uno es medio minuto de
   * clics y una oportunidad de saltarse justo el que faltaba. */
  const timbrables = recibos.filter((r) => !r.uuid);
  const todosMarcados =
    timbrables.length > 0 && timbrables.every((r) => elegidos[r.id]);

  const marcarTodosParaTimbrar = () => {
    const n: Record<string, boolean> = { ...elegidos };
    for (const r of timbrables) n[r.id] = !todosMarcados;
    setElegidos(n);
  };

  /* El blob del PDF se libera al cerrar: cada uno que no se revoca se queda en
   * memoria hasta que se recargue la página. */
  const cerrarVista = () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(''); setViendo(null); setModoXml(false);
  };

  const marcarCorreo = async (ids: string[], enviar: boolean) => {
    setError(''); setAviso('');
    try {
      const r = await api.marcarEnvioPorCorreo(ids, enviar);
      const d: any = r.data;
      if (d.sinCorreo?.length > 0) {
        setAviso(
          `${d.marcados} marcado(s). OJO: ${d.sinCorreo.length} no tienen correo en su ` +
          `expediente (${d.sinCorreo.slice(0, 3).map((x: any) => x.nombre).join(', ')}` +
          `${d.sinCorreo.length > 3 ? '…' : ''}) y no se les podrá mandar.`
        );
      }
      q.refetch();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo marcar');
    }
  };

  /* Se traen los dos de una vez: el XML para el modo estructura y el PDF para
   * la vista previa. Pedir el XML sólo al cambiar de pestaña haría que ese clic
   * esperara, y el XML es texto — no pesa. */
  const verRecibo = async (r: any) => {
    setError(''); setModoXml(false); setPdfUrl('');
    try {
      const d = await api.getXmlRecibo(r.id);
      setViendo({ ...r, xml: d.data.xml });
      setPdfUrl(await api.getReciboPdfBlob(r.id));
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo abrir el recibo');
    }
  };

  const pendientes = recibos.filter((r) => r.estatus === 'PENDIENTE');
  const marcados = recibos.filter((r) => r.enviar_por_correo);
  /* Sólo lo timbrado se puede mandar: un pre-timbre no ampara ningún pago. */
  const timbrados = recibos.filter((r) => r.uuid);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileCode2 className="text-violet-600" size={24} /> CFDI de nómina
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Los recibos que generó el cierre del periodo. Aquí se revisan antes de timbrar.
        </p>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
      {aviso && <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">{aviso}</div>}

      <div className="bg-white rounded-lg shadow border p-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {[
            { id: 'PENDIENTE', label: 'Sin timbrar' },
            { id: 'TIMBRADO', label: 'Timbrados' },
            { id: '', label: 'Todos' },
          ].map((f) => (
            <button key={f.id} onClick={() => setEstatus(f.id)}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                estatus === f.id ? 'bg-violet-100 text-violet-800 font-medium' : 'text-gray-600 hover:bg-gray-100'
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {esAdmin && recibos.length > 0 && (
          <div className="ml-auto flex items-center gap-3 text-sm">
            {porTimbrar > 0 && (
              <button
                onClick={timbrar}
                disabled={timbrando}
                className="bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 flex items-center gap-1.5 disabled:opacity-50"
              >
                <Stamp size={14} />
                {timbrando ? 'Timbrando…' : `Timbrar ${porTimbrar}`}
              </button>
            )}
            <Mail size={15} className="text-gray-500" />
            <span className="text-gray-600">
              {marcados.length} de {timbrados.length} timbrado(s) para correo
            </span>
            <button onClick={() => marcarCorreo(timbrados.map((r) => r.id), true)}
              disabled={timbrados.length === 0}
              className="text-primary hover:underline disabled:text-gray-300 disabled:no-underline">
              marcar todos
            </button>
            <span className="text-gray-300">·</span>
            <button onClick={() => marcarCorreo(recibos.map((r) => r.id), false)}
              className="text-gray-500 hover:underline">ninguno</button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="bg-gray-50 border-b">
            <tr className="text-xs text-gray-600">
              {/* Dos columnas de marca distintas y a propósito: una decide a
                  quién se le MANDA el recibo, la otra cuáles se mandan al SAT.
                  Juntarlas haría que marcar para correo timbrara sin querer. */}
              <th className="px-2 py-2 text-center w-10">
                {timbrables.length > 0 ? (
                  <button
                    onClick={marcarTodosParaTimbrar}
                    title={todosMarcados
                      ? 'Quitar la marca a todos'
                      : `Marcar los ${timbrables.length} sin timbrar`}
                    className={`p-1 rounded transition ${
                      todosMarcados
                        ? 'bg-violet-600 text-white'
                        : 'text-gray-500 hover:bg-violet-100 hover:text-violet-700'
                    }`}
                  >
                    <Stamp size={13} />
                  </button>
                ) : (
                  <span title="No hay recibos sin timbrar">
                    <Stamp size={13} className="inline text-gray-300" />
                  </span>
                )}
              </th>
              <th className="px-2 py-2 text-center w-10" title="Enviar por correo">
                <Mail size={13} className="inline" />
              </th>
              <th className="px-2 py-2 text-left">Trabajador</th>
              <th className="px-2 py-2 text-left w-40">Periodo</th>
              {/* El folio fiscal en lugar del desglose: lo que se busca en esta
                  pantalla es el CFDI, y el UUID es con lo que se le busca ante
                  el SAT y con lo que el trabajador lo reclama. El desglose ya
                  está en la prenómina y en el propio recibo. */}
              <th className="px-2 py-2 text-left">Folio fiscal (UUID)</th>
              <th className="px-2 py-2 text-right w-28">Neto</th>
              <th className="px-2 py-2 text-center w-24">Estado</th>
              <th className="px-2 py-2 text-center w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && recibos.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500 italic">
                No hay recibos {estatus === 'PENDIENTE' ? 'sin timbrar' : ''}.
                Se generan al cerrar un periodo en Nómina → Cálculo.
              </td></tr>
            )}
            {recibos.map((r) => {
              const e = ESTATUS[r.estatus] || ESTATUS.PENDIENTE;
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  {/* Ya timbrado: no se puede volver a marcar. El candado también
                      está en el servidor — un doble clic no puede costar una
                      cancelación ante el SAT. */}
                  <td className="px-2 py-1.5 text-center">
                    {r.uuid ? (
                      <Check size={14} className="inline text-emerald-600" />
                    ) : (
                      <input type="checkbox" checked={!!elegidos[r.id]}
                        onChange={(e) => setElegidos({ ...elegidos, [r.id]: e.target.checked })}
                        className="rounded" />
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {/* La casilla del correo se habilita con el recibo TIMBRADO.
                        Estaba al revés: sólo aparecía en los PENDIENTES, que es
                        justo cuando no hay nada que mandar — un pre-timbre no
                        ampara ningún pago ante el SAT. */}
                    {esAdmin && (
                      <input
                        type="checkbox"
                        checked={!!r.enviar_por_correo}
                        disabled={!r.uuid}
                        title={
                          !r.uuid
                            ? 'Primero hay que timbrarlo: sin folio fiscal no ampara el pago'
                            : (r.correo || 'Sin correo en el expediente')
                        }
                        onChange={(ev) => marcarCorreo([r.id], ev.target.checked)}
                        className="rounded border-gray-300 disabled:opacity-30"
                      />
                    )}
                    {r.enviado_at && <CheckCircle2 size={14} className="inline text-emerald-600" />}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="text-gray-900">{r.nombre}</span>
                    <span className="text-[11px] text-gray-400 ml-1.5 font-mono">
                      {r.num_empleado} · {r.rfc}
                    </span>
                    {r.enviar_por_correo && !r.correo && (
                      <span className="block text-[11px] text-amber-700">
                        <AlertTriangle size={10} className="inline mr-0.5" />
                        marcado para correo pero su expediente no trae uno
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-gray-600">
                    {r.tipo} #{r.periodo_numero}
                    {r.concepto && <span className="block text-gray-400">{r.concepto}</span>}
                    <span className="block text-gray-400">{r.fecha_inicio} a {r.fecha_fin}</span>
                  </td>
                  {/* El UUID completo y seleccionable: se copia para buscarlo en
                      el portal del SAT o para responderle al trabajador. Cortarlo
                      obligaría a abrir el recibo para leerlo. */}
                  <td className="px-2 py-1.5">
                    {r.uuid ? (
                      <span className="font-mono text-[11px] text-gray-700 select-all break-all">
                        {r.uuid}
                      </span>
                    ) : (
                      <span className="text-[11px] text-gray-400 italic">sin timbrar</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold">{money(r.neto)}</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${e.cls}`}>{e.label}</span>
                  </td>
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    {/* Los mismos iconos del panel de facturas. */}
                    {/* Los mismos tres del panel de facturas y en el mismo
                        orden: PDF en rojo, XML en verde, vista previa en azul.
                        Que cambien de lugar entre pantallas obliga a leer los
                        tooltips cada vez. */}
                    <button onClick={() => api.descargarReciboPdf(r.id, `recibo-${r.num_empleado}.pdf`)}
                      title="Descargar PDF"
                      className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg">
                      <FileDown size={16} />
                    </button>
                    <button onClick={() => api.descargarXmlRecibo(r.id, `nomina-${r.num_empleado}.xml`)}
                      title="Descargar XML"
                      className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"><Download size={16} /></button>
                    <button onClick={() => verRecibo(r)} title="Vista previa"
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Eye size={16} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {recibos.length > 0 && (
            <tfoot className="bg-gray-50 border-t-2">
              <tr className="font-semibold">
                <td colSpan={4} className="px-2 py-2">
                  {recibos.length} recibo(s)
                  {pendientes.length > 0 && estatus === '' && (
                    <span className="font-normal text-amber-700 text-xs">
                      {' '}· {pendientes.length} sin timbrar
                    </span>
                  )}
                </td>
                {/* Percepciones y deducciones siguen sumándose, pero como una
                    línea de apoyo: la columna que importa aquí es el neto. */}
                <td className="px-2 py-2 text-[11px] font-normal text-gray-500">
                  percepciones {money(totales.percepciones)} · deducciones{' '}
                  <span className="text-rose-700">{money(totales.deducciones)}</span>
                </td>
                <td className="px-2 py-2 text-right">{money(totales.neto)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Timbrar es un paso <b>aparte del cierre</b>, a propósito: el cierre congela los
        importes y arma el XML —las dos cosas se pueden rehacer—, mientras que timbrar
        gasta un timbre y deshacerlo exige una cancelación ante el SAT. Separarlos permite
        revisar cincuenta recibos y timbrar cuarenta y nueve. Un recibo que ya tiene UUID
        no se vuelve a timbrar: sería un segundo CFDI por el mismo pago.
      </p>

      {viendo && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full my-8">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <div>
                <h2 className="font-semibold">{viendo.nombre}</h2>
                <p className="text-xs text-gray-500">
                  {viendo.uuid ? 'Timbrado' : 'Sin timbrar — vista previa'} ·
                  {' '}{viendo.tipo} #{viendo.periodo_numero} de {viendo.anio}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Dos vistas del mismo recibo: el papel que recibe el
                    trabajador y la estructura que recibe el SAT. */}
                <button
                  onClick={() => setModoXml(!modoXml)}
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  <FileCode2 size={14} /> {modoXml ? 'Ver el PDF' : 'Ver el XML'}
                </button>
                <button
                  onClick={() => api.descargarReciboPdf(
                    viendo.id, `recibo-${viendo.num_empleado}.pdf`)}
                  className="text-sm text-rose-700 hover:underline flex items-center gap-1"
                >
                  <Download size={14} /> PDF
                </button>
                <button
                  onClick={() => api.descargarXmlRecibo(
                    viendo.id, `nomina-${viendo.num_empleado}.xml`)}
                  className="text-sm text-emerald-700 hover:underline flex items-center gap-1"
                >
                  <Download size={14} /> XML
                </button>
                <button onClick={cerrarVista} className="text-gray-400 hover:text-gray-600 ml-2">
                  <X size={20} />
                </button>
              </div>
            </div>

            {modoXml ? (
              <pre className="p-4 text-[11px] font-mono overflow-x-auto max-h-[70vh] whitespace-pre-wrap break-all bg-slate-50">
                {viendo.xml}
              </pre>
            ) : pdfUrl ? (
              <iframe
                src={pdfUrl}
                title={`Recibo de ${viendo.nombre}`}
                className="w-full bg-slate-100"
                style={{ height: '75vh', border: 0 }}
              />
            ) : (
              <p className="p-8 text-center text-sm text-gray-500">Generando el PDF…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NominaCFDIPage;
