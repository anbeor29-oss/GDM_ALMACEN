/**
 * Lista69B — ¿operamos con alguien del artículo 69-B del CFF?
 *
 * LO QUE ESTA PANTALLA TIENE QUE DEJAR CLARO
 * Las cuatro situaciones de la lista no significan lo mismo, y confundirlas es
 * el peor error posible aquí:
 *
 *   · DEFINITIVO — sus comprobantes NO producen efecto fiscal. Lo que se le
 *     dedujo se pierde salvo que se acredite que la operación existió.
 *   · PRESUNTO — el SAT lo señaló y está en plazo de aclarar. Todavía no hay
 *     consecuencia, pero conviene no seguir acumulando.
 *   · DESVIRTUADO / SENTENCIA FAVORABLE — salió de la lista. Se muestra para
 *     que nadie se asuste al verlo en un reporte viejo.
 *
 * Por eso el color y el orden separan al definitivo del resto, en vez de pintar
 * todo de rojo "por si acaso".
 *
 * LA LISTA SE CARGA, NO SE ADIVINA
 * Del archivo que publica el SAT. La pantalla dice de cuándo es el corte: una
 * lista vieja da una falsa tranquilidad y sin la fecha no hay modo de notarlo.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Scale, Upload, AlertOctagon, Clock, CheckCircle2, DownloadCloud } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { fechaMx } from '@/utils/fecha';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const fecha = (d: any) => (d ? fechaMx(d) : '—');

const SITUACION: Record<string, { label: string; cls: string; icono: any }> = {
  DEFINITIVO:          { label: 'Definitivo',  cls: 'bg-rose-100 text-rose-800 border-rose-300', icono: AlertOctagon },
  PRESUNTO:            { label: 'Presunto',    cls: 'bg-amber-100 text-amber-800 border-amber-300', icono: Clock },
  DESVIRTUADO:         { label: 'Desvirtuado', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', icono: CheckCircle2 },
  SENTENCIA_FAVORABLE: { label: 'Sentencia favorable', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', icono: CheckCircle2 },
};

export function Lista69B() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const esAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role || '');
  const [subiendo, setSubiendo] = useState(false);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');

  const q = useQuery({ queryKey: ['lista-69b'], queryFn: () => api.get69B() });
  const d = q.data?.data;
  const coincidencias: any[] = d?.coincidencias || [];
  const definitivos = coincidencias.filter((c) => c.situacion === 'DEFINITIVO');

  const [bajando, setBajando] = useState(false);

  /* Baja el archivo del portal del SAT sin que nadie tenga que ir por él.
   * Sigue existiendo la carga a mano: si el SAT mueve el archivo, esto falla y
   * el botón de subir es la salida que no depende de nadie. */
  const bajarDelSat = async () => {
    setBajando(true); setError(''); setAviso('');
    try {
      const r = await api.actualizar69BDesdeElSat();
      const x: any = r.data;
      setAviso(
        `Padrón actualizado desde el SAT: ${Number(x.renglones).toLocaleString('es-MX')} ` +
        `contribuyentes (${x.nuevos} nuevos, ${x.actualizados} actualizados) en ${x.segundos}s.` +
        (x.ultimaModificacion
          ? ` El archivo del SAT es del ${fechaMx(x.ultimaModificacion)}.`
          : '')
      );
      qc.invalidateQueries({ queryKey: ['lista-69b'] });
    } catch (e: any) {
      setError(
        (e?.response?.data?.message || 'No se pudo bajar la lista del portal del SAT') +
        ' — la lista que ya tenías no se tocó.'
      );
    } finally { setBajando(false); }
  };

  const subir = async (archivo: File) => {
    setSubiendo(true); setError(''); setAviso('');
    try {
      const r = await api.importar69B(archivo);
      const x: any = r.data;
      setAviso(
        `Lista actualizada: ${x.renglones} contribuyente(s) — ${x.nuevos} nuevos, ` +
        `${x.actualizados} actualizados` +
        (x.ignorados ? `, ${x.ignorados} renglones ignorados por no traer RFC o situación válidos.` : '.')
      );
      qc.invalidateQueries({ queryKey: ['lista-69b'] });
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo cargar la lista');
    } finally { setSubiendo(false); }
  };

  return (
    <div className="space-y-6">
      {aviso && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-sm">{aviso}</div>}
      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      {/* Estado de la lista */}
      <div className="bg-white rounded-lg shadow border p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <Scale className="text-emerald-600" size={20} /> Padrón del artículo 69-B
            </h2>
            {d?.lista?.total > 0 ? (
              <p className="text-sm text-gray-600 mt-1">
                {Number(d.lista.total).toLocaleString('es-MX')} contribuyentes en el padrón ·{' '}
                <strong>{Number(d.lista.definitivos).toLocaleString('es-MX')}</strong> definitivos ·
                corte del {fecha(d.lista.ultima_carga)}
                {d.ultimaCarga?.archivo ? ` (${d.ultimaCarga.archivo})` : ''}
              </p>
            ) : (
              <p className="text-sm text-amber-700 mt-1">
                Todavía no se ha cargado el padrón. Sin él, esta pantalla no puede decir
                nada — y no decir nada no es lo mismo que decir que todo está bien.
              </p>
            )}
          </div>
          {esAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={bajarDelSat}
                disabled={bajando || subiendo}
                className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 text-sm"
              >
                <DownloadCloud size={16} />
                {bajando ? 'Bajando del SAT…' : 'Actualizar desde el SAT'}
              </button>
              <label className="flex items-center gap-2 border px-4 py-2 rounded-lg hover:bg-gray-50 cursor-pointer text-sm">
                <Upload size={16} /> {subiendo ? 'Cargando…' : 'Subir archivo'}
                <input type="file" accept=".csv,.txt" className="hidden" disabled={subiendo || bajando}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = ''; }} />
              </label>
            </div>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-3">
          <strong>Actualizar desde el SAT</strong> baja el Listado completo de contribuyentes
          del 69-B directamente del portal de datos abiertos. Si el SAT mueve el archivo,
          la descarga falla sin tocar el padrón que ya tienes, y queda el botón de
          <strong> subir archivo</strong> para cargarlo a mano. El sistema no lo inventa ni lo
          deduce: un señalamiento del 69-B tiene consecuencias fiscales y sólo puede venir
          de la publicación oficial.
        </p>
      </div>

      {/* El resultado del cruce */}
      {definitivos.length > 0 && (
        <div className="bg-rose-50 border border-rose-300 text-rose-900 px-4 py-3 rounded-lg text-sm">
          <strong>{definitivos.length} de tus terceros están en la lista DEFINITIVA.</strong>{' '}
          Los comprobantes que te hayan emitido no producen efecto fiscal: hay 30 días
          para corregir la situación o acreditar que la operación existió de verdad.
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Tercero</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Situación</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Publicación</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Nos facturó</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Le facturamos</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && coincidencias.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500 italic">
                {d?.lista?.total > 0
                  ? 'Ninguno de tus clientes ni proveedores aparece en el padrón. 👌'
                  : 'Carga el padrón para poder cruzarlo con tus terceros.'}
              </td></tr>
            )}
            {coincidencias.map((c) => {
              const s = SITUACION[c.situacion] || { label: c.situacion, cls: 'bg-gray-100 text-gray-700 border-gray-300', icono: Clock };
              const Icono = s.icono;
              const grave = c.situacion === 'DEFINITIVO';
              return (
                <tr key={c.id} className={grave ? 'bg-rose-50/50' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-2 text-sm">
                    <p className="font-medium">{c.business_name}</p>
                    <p className="text-xs text-gray-500 font-mono">
                      {c.rfc} · {c.party_type === 'SUPPLIER' ? 'proveedor' : 'cliente'}
                    </p>
                    {/* El nombre del padrón, cuando no coincide con el nuestro:
                        un RFC correcto con otra razón social merece revisarse. */}
                    {c.nombre_en_lista &&
                      String(c.nombre_en_lista).trim().toUpperCase() !==
                      String(c.business_name).trim().toUpperCase() && (
                      <p className="text-[11px] text-gray-400 truncate max-w-xs">
                        en el padrón: {c.nombre_en_lista}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border font-medium ${s.cls}`}>
                      <Icono size={13} /> {s.label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center text-xs text-gray-600">
                    {fecha(c.publicacion_dof)}
                    {c.oficio_definitivo && (
                      <p className="text-[10px] text-gray-400 truncate max-w-[10rem]" title={c.oficio_definitivo}>
                        {c.oficio_definitivo}
                      </p>
                    )}
                  </td>
                  <td className={`px-4 py-2 text-right text-sm ${grave && Number(c.importe_recibido) > 0 ? 'font-bold text-rose-700' : ''}`}>
                    {Number(c.cfdi_recibidos) > 0
                      ? <>{money(c.importe_recibido)}<span className="block text-[11px] text-gray-400">{c.cfdi_recibidos} CFDI</span></>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-sm">
                    {Number(c.facturas_emitidas) > 0
                      ? <>{money(c.importe_emitido)}<span className="block text-[11px] text-gray-400">{c.facturas_emitidas} facturas</span></>
                      : <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        "Nos facturó" sale de los CFDI que el sistema tiene de ese emisor — hoy, los que
        haya traído la descarga masiva. Si aún no la has corrido, esa columna puede estar
        en blanco aunque sí existan operaciones.
      </p>
    </div>
  );
}
