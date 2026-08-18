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
  FileCode2, Download, Eye, Mail, AlertTriangle, X, CheckCircle2,
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
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

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

  const verXml = async (r: any) => {
    setError('');
    try {
      const d = await api.getXmlRecibo(r.id);
      setViendo({ ...r, xml: d.data.xml });
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo leer el XML');
    }
  };

  const pendientes = recibos.filter((r) => r.estatus === 'PENDIENTE');
  const marcados = recibos.filter((r) => r.enviar_por_correo);

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
          <div className="ml-auto flex items-center gap-2 text-sm">
            <Mail size={15} className="text-gray-500" />
            <span className="text-gray-600">{marcados.length} de {recibos.length} para correo</span>
            <button onClick={() => marcarCorreo(recibos.map((r) => r.id), true)}
              className="text-primary hover:underline">marcar todos</button>
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
              <th className="px-2 py-2 text-center w-10" title="Enviar por correo">
                <Mail size={13} className="inline" />
              </th>
              <th className="px-2 py-2 text-left">Trabajador</th>
              <th className="px-2 py-2 text-left w-40">Periodo</th>
              <th className="px-2 py-2 text-center w-12">Días</th>
              <th className="px-2 py-2 text-right w-28">Percepciones</th>
              <th className="px-2 py-2 text-right w-28">Deducciones</th>
              <th className="px-2 py-2 text-right w-28">Neto</th>
              <th className="px-2 py-2 text-center w-24">Estado</th>
              <th className="px-2 py-2 text-center w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && recibos.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-500 italic">
                No hay recibos {estatus === 'PENDIENTE' ? 'sin timbrar' : ''}.
                Se generan al cerrar un periodo en Nómina → Cálculo.
              </td></tr>
            )}
            {recibos.map((r) => {
              const e = ESTATUS[r.estatus] || ESTATUS.PENDIENTE;
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-2 py-1.5 text-center">
                    {esAdmin && r.estatus === 'PENDIENTE' && (
                      <input type="checkbox" checked={!!r.enviar_por_correo}
                        onChange={(ev) => marcarCorreo([r.id], ev.target.checked)}
                        title={r.correo || 'Sin correo en el expediente'}
                        className="rounded border-gray-300" />
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
                  <td className="px-2 py-1.5 text-center">{r.dias}</td>
                  <td className="px-2 py-1.5 text-right">{money(r.total_percepciones)}</td>
                  <td className="px-2 py-1.5 text-right text-rose-700">{money(r.total_deducciones)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">{money(r.neto)}</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${e.cls}`}>{e.label}</span>
                    {r.uuid && (
                      <span className="block text-[10px] text-gray-400 font-mono truncate max-w-[6rem] mx-auto"
                        title={r.uuid}>{r.uuid.slice(0, 8)}…</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    {/* Los mismos iconos del panel de facturas. */}
                    <button onClick={() => verXml(r)} title="Ver el XML"
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Eye size={16} /></button>
                    <button onClick={() => api.descargarXmlRecibo(r.id, `nomina-${r.num_empleado}.xml`)}
                      title="Descargar XML"
                      className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"><Download size={16} /></button>
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
                <td className="px-2 py-2 text-right">{money(totales.percepciones)}</td>
                <td className="px-2 py-2 text-right text-rose-700">{money(totales.deducciones)}</td>
                <td className="px-2 py-2 text-right">{money(totales.neto)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-xs text-gray-500">
        El timbrado ante el PAC todavía no está conectado: los XML de arriba son el
        pre-timbre, con la estructura completa del CFDI 4.0 y su complemento de nómina
        1.2, listos para revisarse. Es a propósito que sea un paso aparte — timbrar gasta
        timbres y deshacerlo exige una cancelación ante el SAT.
      </p>

      {viendo && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full my-8">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <div>
                <h2 className="font-semibold">{viendo.nombre}</h2>
                <p className="text-xs text-gray-500">
                  {viendo.estatus === 'TIMBRADO' ? 'XML timbrado' : 'XML pre-timbre'} ·
                  {' '}{viendo.tipo} #{viendo.periodo_numero}
                </p>
              </div>
              <button onClick={() => setViendo(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <pre className="p-4 text-[11px] font-mono overflow-x-auto max-h-[70vh] whitespace-pre-wrap break-all bg-slate-50">
              {viendo.xml}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default NominaCFDIPage;
