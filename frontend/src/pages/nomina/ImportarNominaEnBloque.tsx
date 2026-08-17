/**
 * ImportarNominaEnBloque — la plantilla completa, desde los recibos timbrados.
 *
 * POR QUÉ ESTA PANTALLA
 * Quien arranca en NEXO tiene su plantilla en los XML que ya timbró. De uno en
 * uno son cincuenta idas y vueltas; aquí se sueltan todos, se ve en una tabla
 * lo que se rescató de cada quien, se desmarca a quien no deba entrar y se dan
 * de alta de una vez.
 *
 * SIGUE PREGUNTANDO, PERO UNA VEZ POR TANDA
 * Nada se guarda al soltar los archivos: el primer paso SÓLO LEE. Lo que se ve
 * es lo que se va a crear, y se puede corregir renglón por renglón antes de
 * confirmar. La pregunta no desapareció — dejó de repetirse cincuenta veces.
 *
 * LO QUE LA TABLA TIENE QUE DEJAR VER
 *   · quién ya está dado de alta (no se vuelve a crear),
 *   · a quién le falta algo para poder timbrarle,
 *   · qué datos se DEDUJERON en vez de venir en el XML — sobre todo el reparto
 *     del nombre, que es lo único que el importador no puede saber con certeza.
 */
import { useState, useMemo } from 'react';
import {
  Upload, X, AlertTriangle, CheckCircle2, UserPlus, FileWarning, Pencil,
} from 'lucide-react';
import api from '@/services/api';
import { EmpleadoModal } from './EmpleadoModal';

const money = (n: any) =>
  n === null || n === undefined ? '—'
    : Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

interface Props {
  onClose: () => void;
  onListo: () => void;
}

export function ImportarNominaEnBloque({ onClose, onListo }: Props) {
  const [leyendo, setLeyendo] = useState(false);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState<any | null>(null);
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [editando, setEditando] = useState<any | null>(null);
  const [resultado, setResultado] = useState<any | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

  const filas: any[] = revision?.trabajadores || [];
  const nuevos = useMemo(() => filas.filter((t) => t.estado === 'nuevo'), [filas]);
  const elegidos = useMemo(() => nuevos.filter((t) => marcados[t.archivo]), [nuevos, marcados]);

  const leerArchivos = async (lista: FileList | File[]) => {
    const xmls = Array.from(lista).filter((f) => f.name.toLowerCase().endsWith('.xml'));
    if (xmls.length === 0) { setError('Los archivos deben ser .xml'); return; }

    setLeyendo(true); setError(''); setResultado(null);
    try {
      const archivos = await Promise.all(
        xmls.map(async (f) => ({ nombre: f.name, xml: await f.text() }))
      );
      const r = await api.revisarEmpleadosDeNomina(archivos);
      const d: any = r.data;
      setRevision(d);
      /* Se marcan por omisión los que se pueden dar de alta. Quien ya existe o
       * traiga error no se marca: no hay nada que crear. */
      const m: Record<string, boolean> = {};
      for (const t of d.trabajadores) if (t.estado === 'nuevo') m[t.archivo] = true;
      setMarcados(m);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudieron leer los recibos');
    } finally { setLeyendo(false); }
  };

  const darDeAlta = async () => {
    if (elegidos.length === 0) { setError('Marca al menos un trabajador'); return; }
    setCreando(true); setError('');
    try {
      const r = await api.altaDeEmpleadosEnBloque(
        elegidos.map((t) => ({ archivo: t.archivo, datos: t.propuesta.datos }))
      );
      setResultado(r.data);
      onListo();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudieron dar de alta');
    } finally { setCreando(false); }
  };

  /* Al corregir un expediente en el modal, el cambio se queda en la tabla y se
   * usa al confirmar: por eso el alta manda `datos` y no vuelve a leer el XML. */
  const guardarCorreccion = (archivo: string, datos: any) => {
    setRevision((r: any) => ({
      ...r,
      trabajadores: r.trabajadores.map((t: any) =>
        t.archivo === archivo
          ? { ...t, propuesta: { ...t.propuesta, datos: { ...t.propuesta.datos, ...datos } } }
          : t
      ),
    }));
    setEditando(null);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full my-8">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <UserPlus size={20} className="text-violet-600" />
            Dar de alta desde recibos de nómina
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm">{error}</div>
          )}

          {/* ── Resultado del alta ── */}
          {resultado && (
            <div className="space-y-3">
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-sm">
                <p className="font-semibold flex items-center gap-2">
                  <CheckCircle2 size={16} /> {resultado.creados} trabajador(es) dados de alta
                  {resultado.fallidos > 0 && ` · ${resultado.fallidos} no se pudieron`}
                </p>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    {resultado.altas.map((a: any, i: number) => (
                      <tr key={i} className={a.ok ? '' : 'bg-rose-50/50'}>
                        <td className="px-3 py-1.5">
                          {a.ok ? <CheckCircle2 size={15} className="text-emerald-600" />
                                : <AlertTriangle size={15} className="text-rose-600" />}
                        </td>
                        <td className="px-3 py-1.5 font-medium">{a.nombre}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-gray-500">{a.rfc}</td>
                        <td className="px-3 py-1.5 text-xs">
                          {a.ok ? `empleado ${a.num_empleado}`
                                : <span className="text-rose-700">{a.motivo}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <button onClick={onClose} className="px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-blue-600">
                  Cerrar
                </button>
              </div>
            </div>
          )}

          {/* ── Soltar archivos ── */}
          {!resultado && !revision && (
            <>
              <label
                onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
                onDragLeave={() => setArrastrando(false)}
                onDrop={(e) => { e.preventDefault(); setArrastrando(false); leerArchivos(e.dataTransfer.files); }}
                className={`block border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition ${
                  arrastrando ? 'border-violet-500 bg-violet-50' : 'border-gray-300 hover:border-violet-400'
                }`}
              >
                <Upload className="mx-auto text-gray-400" size={32} />
                <p className="mt-3 font-medium text-gray-700">
                  {leyendo ? 'Leyendo los recibos…' : 'Suelta aquí los XML de nómina'}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  O haz clic para elegirlos. Hasta 200 por tanda.
                </p>
                <input type="file" accept=".xml" multiple className="hidden" disabled={leyendo}
                  onChange={(e) => { if (e.target.files?.length) leerArchivos(e.target.files); e.target.value = ''; }} />
              </label>
              <div className="bg-slate-50 border rounded-lg px-4 py-3 text-xs text-gray-600">
                <p className="font-medium text-gray-700">Nada se guarda al soltarlos.</p>
                <p className="mt-1">
                  Primero se lee todo y se enseña lo que trae cada recibo; el alta ocurre
                  cuando lo confirmes. Si el mismo trabajador viene en varios recibos se
                  cuenta una sola vez, con los datos del <strong>más reciente</strong> — el
                  salario del último recibo es el vigente.
                </p>
              </div>
            </>
          )}

          {/* ── Lo que se rescató ── */}
          {!resultado && revision && (
            <>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-gray-600">
                  {revision.resumen.archivos} archivo(s) · {revision.resumen.personas} persona(s)
                </span>
                <span className="text-emerald-700">{revision.resumen.nuevos} por dar de alta</span>
                {revision.resumen.yaExisten > 0 && (
                  <span className="text-gray-500">{revision.resumen.yaExisten} ya estaban</span>
                )}
                {revision.resumen.errores > 0 && (
                  <span className="text-amber-700">{revision.resumen.errores} con problema</span>
                )}
                <button
                  onClick={() => { setRevision(null); setMarcados({}); }}
                  className="ml-auto text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Empezar de nuevo
                </button>
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr className="text-left text-xs text-gray-600">
                      <th className="px-3 py-2 w-8"></th>
                      <th className="px-3 py-2">Trabajador</th>
                      <th className="px-3 py-2">Núm.</th>
                      <th className="px-3 py-2">Puesto</th>
                      <th className="px-3 py-2">Ingreso</th>
                      <th className="px-3 py-2 text-right">SDI</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filas.map((t) => {
                      const d = t.propuesta?.datos || {};
                      const nombre = [d.nombre, d.apellido_pat, d.apellido_mat].filter(Boolean).join(' ');
                      const dedujo = t.propuesta?.origen?.apellido_pat === 'deducido';
                      return (
                        <tr key={t.archivo} className={
                          t.estado === 'error' ? 'bg-amber-50/50'
                            : t.estado === 'existe' ? 'bg-slate-50/60 text-gray-500'
                            : marcados[t.archivo] ? 'bg-emerald-50/40' : ''
                        }>
                          <td className="px-3 py-1.5">
                            {t.estado === 'nuevo' && (
                              <input type="checkbox" checked={!!marcados[t.archivo]}
                                onChange={(e) => setMarcados({ ...marcados, [t.archivo]: e.target.checked })}
                                className="rounded border-gray-300" />
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            {t.estado === 'error' ? (
                              <span className="text-gray-500 italic">{t.archivo}</span>
                            ) : (
                              <>
                                <p className="font-medium text-gray-900">
                                  {nombre || t.propuesta?.yaExiste?.nombre_completo}
                                </p>
                                <p className="text-[11px] text-gray-500 font-mono">
                                  {d.rfc || ''} {d.curp ? `· ${d.curp}` : ''}
                                </p>
                                {dedujo && (
                                  <p className="text-[11px] text-amber-700 flex items-center gap-1">
                                    <AlertTriangle size={11} /> el reparto del nombre se dedujo — revísalo
                                  </p>
                                )}
                                {t.recibos > 1 && (
                                  <p className="text-[11px] text-gray-400">{t.recibos} recibos · se usa el más reciente</p>
                                )}
                              </>
                            )}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-xs">{d.num_empleado || '—'}</td>
                          <td className="px-3 py-1.5 text-xs">{d.puesto || '—'}</td>
                          <td className="px-3 py-1.5 text-xs">{d.fecha_ingreso || '—'}</td>
                          <td className="px-3 py-1.5 text-right text-xs">
                            {d.salario_diario_integrado ? money(d.salario_diario_integrado) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-xs">
                            {t.estado === 'nuevo' && (
                              t.propuesta?.faltantes?.length
                                ? <span className="text-amber-700">falta: {t.propuesta.faltantes.join(', ')}</span>
                                : <span className="text-emerald-700">completo</span>
                            )}
                            {t.estado === 'existe' && <span>ya estaba en la plantilla</span>}
                            {t.estado === 'error' && (
                              <span className="text-amber-800 flex items-start gap-1">
                                <FileWarning size={12} className="mt-0.5 shrink-0" /> {t.motivo}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {t.estado === 'nuevo' && (
                              <button onClick={() => setEditando(t)} title="Corregir antes de dar de alta"
                                className="text-gray-400 hover:text-primary p-1">
                                <Pencil size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Los avisos del lote, sin repetir el mismo cincuenta veces. */}
              {(() => {
                const todos = new Set<string>();
                for (const t of filas) for (const a of t.propuesta?.avisos || []) todos.add(a);
                if (todos.size === 0) return null;
                return (
                  <div className="space-y-2">
                    {[...todos].map((a, i) => (
                      <div key={i} className="bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded-lg text-xs flex items-start gap-2">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                        <span>{a}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="flex items-center justify-end gap-2 border-t pt-4">
                <span className="mr-auto text-sm text-gray-600">
                  {elegidos.length} de {nuevos.length} marcados
                </span>
                <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                  Cancelar
                </button>
                <button
                  onClick={darDeAlta}
                  disabled={creando || elegidos.length === 0}
                  className="flex items-center gap-2 px-5 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50"
                >
                  <UserPlus size={15} />
                  {creando ? 'Dando de alta…' : `Dar de alta a ${elegidos.length}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {editando && (
        <EmpleadoModal
          inicial={editando.propuesta.datos}
          origen={editando.propuesta.origen}
          soloDevolver
          onClose={() => setEditando(null)}
          onGuardado={(datos: any) => guardarCorreccion(editando.archivo, datos)}
        />
      )}
    </div>
  );
}

export default ImportarNominaEnBloque;
