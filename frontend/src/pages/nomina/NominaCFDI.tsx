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
 * EL CORREO SE MARCA Y LUEGO SE MANDA
 * Marcar es decir "a éste sí"; el envío ocurre después del timbrado. Separarlos
 * permite revisar la lista sin arriesgar que salga un correo con un recibo que
 * todavía tiene un error. Durante un tiempo sólo existió la primera mitad: se
 * marcaba y el correo nunca salía. El botón «Enviar» es la segunda.
 */
import { useState, useMemo, useEffect } from 'react';
import { confirmar } from '@/utils/avisos';
import { useQuery } from '@tanstack/react-query';
import {
  FileCode2, FileDown, Download, Eye, Mail, AlertTriangle, X, CheckCircle2, Stamp, Check, Search, UserCog, Send,
} from 'lucide-react';
import api from '@/services/api';
import { aTextoMx } from '@/components/CampoFecha';
import { useCapacidades, CAP } from '@/utils/capacidades';
import { claseOpcion } from '@/utils/coloresOpciones';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const ESTATUS: Record<string, { label: string; cls: string }> = {
  PENDIENTE: { label: 'Sin timbrar', cls: 'bg-amber-100 text-amber-800' },
  TIMBRADO:  { label: 'Timbrado',    cls: 'bg-emerald-100 text-emerald-800' },
  CANCELADO: { label: 'Cancelado',   cls: 'bg-rose-100 text-rose-700' },
};

/**
 * CapturaCorreo — el correo que falta, capturado donde se descubre que falta.
 *
 * Mandar al trabajador a la pantalla de expedientes a mitad del envío es la
 * forma segura de que el recibo se quede sin mandar. Se guarda en los dos
 * lados (recibo y expediente) para no volver a capturarlo el mes que entra.
 */
function CapturaCorreo({ id, marcado, onSave }: {
  id: string; marcado: boolean; onSave: (id: string, correo: string) => Promise<string | null>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [motivo, setMotivo] = useState('');

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)}
        className={`block text-[11px] underline decoration-dotted ${marcado ? 'text-amber-700' : 'text-gray-400 hover:text-gray-600'}`}>
        <AlertTriangle size={10} className="inline mr-0.5" />
        {marcado ? 'marcado para correo, pero su expediente no trae uno — capturarlo' : 'sin correo — capturarlo'}
      </button>
    );
  }
  return (
    <span className="block mt-0.5">
      <span className="flex items-center gap-1">
        <input autoFocus type="email" value={valor}
          onChange={(e) => { setValor(e.target.value); setMotivo(''); }}
          placeholder="correo@dominio.com"
          className={`text-[11px] border rounded px-1.5 py-0.5 w-52 ${motivo ? 'border-rose-400' : 'border-gray-300'}`}
          onKeyDown={(e) => { if (e.key === 'Escape') setAbierto(false); }} />
        <button disabled={guardando || !valor.trim()}
          onClick={async () => {
            setGuardando(true);
            const err = await onSave(id, valor.trim());
            setGuardando(false);
            // Sólo se cierra si de verdad guardó: cerrar con el correo rechazado
            // es decirle al usuario que quedó cuando no quedó.
            if (err) setMotivo(err); else { setMotivo(''); setAbierto(false); }
          }}
          className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-600 text-white disabled:opacity-40">
          {guardando ? '…' : 'Guardar'}
        </button>
        <button onClick={() => { setMotivo(''); setAbierto(false); }}
          className="text-[11px] text-gray-400 hover:text-gray-600">cancelar</button>
      </span>
      {motivo && (
        <span className="block text-[11px] text-rose-700 mt-0.5 max-w-xs leading-snug">{motivo}</span>
      )}
    </span>
  );
}

/**
 * ResultadoEnvio — quién recibió su recibo y quién no, con el porqué.
 *
 * «3 enviados» no sirve para nada cuando son veinte: lo que hace falta saber es
 * a quién hay que capturarle el correo y qué buzón rebotó.
 */
function ResultadoEnvio({ data, onClose }: { data: any; onClose: () => void }) {
  const COLOR: Record<string, string> = {
    ENVIADO: 'bg-emerald-100 text-emerald-800',
    FALLO:   'bg-rose-100 text-rose-700',
    OMITIDO: 'bg-amber-100 text-amber-800',
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-bold flex items-center gap-2"><Send size={18} className="text-emerald-600" /> Resultado del envío</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-3 text-sm">
            <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-800">{data.enviados} enviado(s)</span>
            {data.fallidos > 0 && <span className="px-2 py-1 rounded bg-rose-100 text-rose-700">{data.fallidos} con error</span>}
            {data.omitidos > 0 && <span className="px-2 py-1 rounded bg-amber-100 text-amber-800">{data.omitidos} omitido(s)</span>}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b"><tr>
              <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600">Trabajador</th>
              <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600">Correo</th>
              <th className="px-2 py-1.5 text-left text-xs font-semibold text-gray-600">Resultado</th>
            </tr></thead>
            <tbody className="divide-y">
              {(data.detalle || []).map((d: any) => (
                <tr key={d.id}>
                  <td className="px-2 py-1.5">{d.nombre}<span className="text-[11px] text-gray-400 ml-1 font-mono">{d.num_empleado}</span></td>
                  <td className="px-2 py-1.5 text-xs text-gray-600">{d.correo || '—'}</td>
                  <td className="px-2 py-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${COLOR[d.estado] || 'bg-gray-100 text-gray-600'}`}>{d.estado}</span>
                    {d.mensaje && <span className="block text-[11px] text-gray-500 mt-0.5">{d.mensaje}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function NominaCFDIPage() {
  /* No es el rol lo que decide, sino la capacidad — y no se adivina: se
   * pregunta al servidor, que es el único que sabe de grupos de trabajo y
   * de otorgamientos individuales. */
  const { puede } = useCapacidades();
  const esAdmin = puede(CAP.nomina);

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
    enabled: estatus !== 'RECUPERADOS',
  });
  const recibosTodos: any[] = q.data?.data?.recibos || [];

  /* EL PERIODO ACOTA LO QUE SE VE Y LO QUE SE MANDA.
   * La lista trae TODOS los recibos de la empresa, de todos los periodos. Con un
   * solo «marcar todos» + «Enviar» eso serían años de recibos saliendo de golpe
   * a los trabajadores. El envío se hace por periodo, que es como se paga. */
  const periodos = useMemo(() => {
    const m = new Map<string, { id: string; label: string; anio: number; num: number }>();
    for (const r of recibosTodos) {
      if (!r.periodo_id || m.has(r.periodo_id)) continue;
      m.set(r.periodo_id, {
        id: r.periodo_id,
        label: r.tipo === 'ESPECIAL' && r.concepto
          ? `${r.concepto} ${r.anio}`
          : `${r.tipo} #${r.periodo_numero} · ${r.anio}`,
        anio: Number(r.anio) || 0, num: Number(r.periodo_numero) || 0,
      });
    }
    return [...m.values()].sort((a, b) => b.anio - a.anio || b.num - a.num);
  }, [recibosTodos]);

  const [periodoId, setPeriodoId] = useState('');
  // Por omisión, el periodo MÁS RECIENTE: es el que se acaba de cerrar y el que
  // se va a mandar. Si el elegido deja de existir al cambiar de pestaña, se cae
  // al más reciente en vez de dejar la lista vacía sin explicación.
  useEffect(() => {
    if (!periodos.length) return;
    if (!periodoId || !periodos.some((p) => p.id === periodoId)) setPeriodoId(periodos[0].id);
  }, [periodos]); // eslint-disable-line react-hooks/exhaustive-deps

  const recibos = periodoId === '__todos__'
    ? recibosTodos
    : recibosTodos.filter((r) => r.periodo_id === periodoId);
  const periodoActual = periodos.find((p) => p.id === periodoId);

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
    if (!await confirmar(
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

  /* ENVIAR DE VERDAD.
   * Sólo sale lo TIMBRADO y marcado. A quien ya se le mandó se omite salvo que
   * se pida reenviar: mandar dos veces el mismo recibo confunde al trabajador
   * sobre cuál es el bueno. El resultado se enseña renglón por renglón porque
   * «3 enviados» no dice quién se quedó sin correo. */
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<any | null>(null);

  const enviarCorreos = async (reenviar: boolean) => {
    const listos = recibos.filter((r) => r.enviar_por_correo && r.uuid);
    if (listos.length === 0) { setError('No hay recibos timbrados y marcados para correo.'); return; }
    const alcance = periodoId === '__todos__'
      ? 'TODOS LOS PERIODOS a la vez'
      : (periodoActual?.label || 'el periodo en pantalla');
    if (!await confirmar(
      `Se le va a mandar su recibo de ${alcance} a ${listos.length} trabajador(es), ` +
      'con el PDF y el XML timbrado.' +
      (reenviar ? '\n\nSe REENVIARÁ también a quienes ya lo recibieron.' : '') + '\n\n¿Sigo?'
    )) return;
    setError(''); setAviso(''); setEnviando(true);
    try {
      const r = await api.enviarRecibosCorreo({ ids: listos.map((x) => x.id), reenviar });
      setResultado(r.data);
      setAviso((r as any).message || 'Envío terminado.');
      q.refetch();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudieron enviar los recibos');
    } finally { setEnviando(false); }
  };

  /* El correo del trabajador se captura AQUÍ, que es donde se descubre que
   * falta. Se guarda también en el expediente para que el mes que entra ya no
   * falte: corregirlo sólo en el recibo es volver a capturarlo cada periodo. */
  /* Devuelve `null` si guardó, o el MOTIVO si no. El motivo se enseña dentro
   * de la cajita —no arriba de la pantalla— porque ahí está la vista puesta y
   * ahí es donde se corrige. Antes el error se tragaba: la cajita se cerraba
   * como si hubiera guardado y el correo malo seguía igual. */
  const guardarCorreo = async (id: string, correo: string): Promise<string | null> => {
    setError('');
    try {
      await api.setCorreoRecibo(id, correo);
      q.refetch();
      return null;
    } catch (e: any) {
      return e?.response?.data?.message || 'No se pudo guardar el correo';
    }
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
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'PENDIENTE', label: 'Sin timbrar' },
            { id: 'TIMBRADO', label: 'Timbrados' },
            { id: '', label: 'Todos' },
            { id: 'RECUPERADOS', label: 'Recuperados' },
          ].map((f, i) => (
            <button key={f.id} onClick={() => setEstatus(f.id)} className={claseOpcion(i, estatus === f.id)}>
              {f.label}
            </button>
          ))}
        </div>

        {periodos.length > 0 && (
          <label className="text-sm text-gray-600 flex items-center gap-1.5">
            Periodo:
            <select value={periodoId} onChange={(e) => setPeriodoId(e.target.value)}
              className="input py-1.5 text-sm max-w-[16rem]">
              {periodos.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              <option value="__todos__">Todos los periodos</option>
            </select>
          </label>
        )}

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
            {marcados.length > 0 && (
              <button
                onClick={() => enviarCorreos(false)}
                disabled={enviando}
                title="Manda el PDF y el XML timbrado a cada trabajador marcado"
                className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send size={14} />
                {enviando ? 'Enviando…' : `Enviar ${marcados.length}`}
              </button>
            )}
          </div>
        )}
      </div>

      {resultado && <ResultadoEnvio data={resultado} onClose={() => setResultado(null)} />}

      {estatus === 'RECUPERADOS' ? <CfdiRecuperados /> : (<>
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
                    {esAdmin && r.uuid && (
                      r.correo
                        ? <span className="block text-[11px] text-gray-500">{r.correo}</span>
                        : <CapturaCorreo id={r.id} marcado={!!r.enviar_por_correo} onSave={guardarCorreo} />
                    )}
                    {r.enviado_error && (
                      <span className="block text-[11px] text-rose-700" title={r.enviado_error}>
                        <AlertTriangle size={10} className="inline mr-0.5" />
                        el último envío falló: {String(r.enviado_error).slice(0, 70)}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-gray-600">
                    {r.tipo} #{r.periodo_numero}
                    {r.concepto && <span className="block text-gray-400">{r.concepto}</span>}
                    <span className="block text-gray-400">{aTextoMx(r.fecha_inicio)} a {aTextoMx(r.fecha_fin)}</span>
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
      </>)}

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

/* ── CFDI de nómina RECUPERADOS del respaldo (histórico timbrado en la bóveda) ──
 * Timbrados de periodos anteriores: ordenar por fecha/trabajador, descargar XML y
 * pasar al trabajador a activo de un clic (si ya existe; el alta va por Empleados). */
function CfdiRecuperados() {
  const [anio, setAnio] = useState<number>(0);   // 0 = todos los ejercicios
  const qAnios = useQuery({ queryKey: ['nomina-cfdi-recuperados-anios'], queryFn: () => api.getAniosNominaRecuperados() });
  const anios: number[] = qAnios.data?.data || [];
  const q = useQuery({ queryKey: ['nomina-cfdi-recuperados', anio], queryFn: () => api.getCfdiNominaRecuperados(anio || undefined) });
  const filas: any[] = q.data?.data || [];
  const [busca, setBusca] = useState('');
  const [orden, setOrden] = useState<{ campo: 'fecha' | 'nombre'; dir: 1 | -1 }>({ campo: 'fecha', dir: -1 });
  const [msg, setMsg] = useState('');
  const [activando, setActivando] = useState('');
  const [completando, setCompletando] = useState('');

  const ordenar = (campo: 'fecha' | 'nombre') =>
    setOrden((o) => ({ campo, dir: (o.campo === campo ? (o.dir === 1 ? -1 : 1) : 1) as 1 | -1 }));

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const arr = filas.filter((f) => !t || `${f.nombre} ${f.rfc}`.toLowerCase().includes(t));
    arr.sort((a, b) => {
      const va = orden.campo === 'fecha' ? String(a.fecha_emision || '') : String(a.nombre || '');
      const vb = orden.campo === 'fecha' ? String(b.fecha_emision || '') : String(b.nombre || '');
      return va < vb ? -orden.dir : va > vb ? orden.dir : 0;
    });
    return arr;
  }, [filas, busca, orden]);

  const activar = async (f: any) => {
    setActivando(f.uuid); setMsg('');
    try {
      const r: any = await api.activarTrabajadorRecuperado(f.uuid);
      const d = r?.data || {};
      setMsg(
        d.estado === 'activado' ? `${d.nombre} pasó a trabajadores activos.`
          : d.estado === 'ya_activo' ? `${d.nombre} ya estaba activo.`
            : `${d.nombre || d.rfc} no existe como empleado: descarga su XML y dálo de alta en Empleados.`);
      q.refetch();
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo activar.'); }
    finally { setActivando(''); }
  };

  const completar = async (f: any) => {
    setCompletando(f.uuid); setMsg('');
    try {
      const r: any = await api.completarTrabajadorRecuperado(f.uuid);
      const d = r?.data || {};
      setMsg(
        d.estado === 'completado' ? `${d.nombre}: se completaron ${d.campos.length} dato(s) desde el XML (${d.campos.join(', ')}).`
          : d.estado === 'sin_cambios' ? `${d.nombre} ya tenía todos sus datos: nada que completar.`
            : `${d.nombre || d.rfc} no existe como empleado: dálo de alta con su XML.`);
      q.refetch();
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo completar.'); }
    finally { setCompletando(''); }
  };

  const flecha = (campo: string) => (orden.campo === campo ? (orden.dir === 1 ? ' ▲' : ' ▼') : '');

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg border shadow-sm p-3 text-sm text-gray-600">
        Timbrados de <b>periodos anteriores</b> rescatados del respaldo. Descarga el XML de quien necesites
        para darlo de alta (Empleados → alta con XML). El <b>check</b> pasa al trabajador a <b>activo</b> si ya existe,
        y <b>Completar</b> rellena sus datos vacíos (NSS, puesto, salarios…) con los del recibo, sin pisar lo capturado.
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar trabajador o RFC…"
            className="w-full border rounded-lg pl-8 pr-3 py-1.5 text-sm" />
        </div>
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}
          title="Filtrar por ejercicio" className="border rounded-lg px-2 py-1.5 text-sm">
          <option value={0}>Todos los años</option>
          {anios.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="text-xs text-gray-500">{lista.length} de {filas.length}</span>
      </div>
      {msg && <p className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded px-3 py-2">{msg}</p>}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-xs text-gray-600">
            <tr>
              <th className="px-2 py-2 text-center w-16" title="Pasar a activos">Activar</th>
              <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => ordenar('nombre')}>Trabajador{flecha('nombre')}</th>
              <th className="px-3 py-2 text-left cursor-pointer select-none w-32" onClick={() => ordenar('fecha')}>Fecha{flecha('fecha')}</th>
              <th className="px-3 py-2 text-left">Folio fiscal (UUID)</th>
              <th className="px-2 py-2 text-center w-20" title="Completar datos vacíos del empleado con los del recibo">Datos</th>
              <th className="px-2 py-2 text-center w-16">XML</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>}
            {!q.isLoading && lista.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500 italic">
                No hay CFDI de nómina recuperados. Recupéralos en Contabilidad → Importar respaldo.
              </td></tr>)}
            {lista.map((f) => (
              <tr key={f.uuid} className="hover:bg-gray-50">
                <td className="px-2 py-1.5 text-center">
                  {!f.existe ? (
                    <span title="No existe como empleado: dálo de alta con su XML"><AlertTriangle size={15} className="inline text-amber-500" /></span>
                  ) : f.activo ? (
                    <span title="Ya está activo"><CheckCircle2 size={16} className="inline text-emerald-600" /></span>
                  ) : (
                    <button onClick={() => activar(f)} disabled={activando === f.uuid}
                      title="Pasar a trabajadores activos"
                      className="p-1 rounded hover:bg-emerald-100 text-gray-400 hover:text-emerald-700 disabled:opacity-50">
                      <Check size={15} />
                    </button>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <span className="text-gray-900">{f.nombre || '—'}</span>
                  <span className="block text-[11px] text-gray-400 font-mono">{f.rfc}{f.num_empleado ? ` · #${f.num_empleado}` : ''}</span>
                </td>
                <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{aTextoMx(f.fecha_emision)}</td>
                <td className="px-3 py-1.5"><span className="font-mono text-[11px] text-gray-700 select-all break-all">{f.uuid}</span></td>
                <td className="px-2 py-1.5 text-center">
                  {f.existe ? (
                    <button onClick={() => completar(f)} disabled={completando === f.uuid}
                      title="Completar los datos vacíos del empleado (NSS, puesto, salarios…) con los del recibo"
                      className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg disabled:opacity-50"><UserCog size={16} /></button>
                  ) : <span className="text-gray-300" title="Primero dálo de alta con su XML">—</span>}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button onClick={() => api.descargarXmlNominaRecuperado(f.uuid, `nomina_${f.rfc}_${String(f.uuid).slice(0, 8)}.xml`)}
                    title="Descargar XML" className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"><Download size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default NominaCFDIPage;
