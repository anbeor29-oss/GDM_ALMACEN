/**
 * Auditoría — qué dice el SAT de nuestros comprobantes.
 *
 * Lo que se timbró aquí queda marcado como timbrado aquí. Esta pantalla trae la
 * otra versión de la historia: la del SAT. Se revisa sola cada 72 horas y lo
 * único que hay que mirar todos los días es el número de DIFERENCIAS.
 *
 * NO CANCELA NADA. Si el SAT dice "Cancelado" y aquí sigue vigente, lo enseña y
 * ya: cancelar mueve inventario, saldos y comprobantes relacionados, y es una
 * decisión de alguien, no de una pantalla de consulta.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, AlertTriangle, RefreshCw, Clock, HelpCircle } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

const fechaHora = (d: any) =>
  d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const TIPO: Record<string, string> = {
  invoice: 'Factura',
  credit_note: 'Nota de crédito',
  payment: 'Complemento de pago',
};

const ESTADO_SAT: Record<string, string> = {
  Vigente: 'bg-emerald-100 text-emerald-700',
  Cancelado: 'bg-rose-100 text-rose-700',
  'No Encontrado': 'bg-amber-100 text-amber-700',
};

export function AuditoriaPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const puedeRevisar = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'].includes(user?.role || '');

  const [soloDiferencias, setSoloDiferencias] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');

  const resumenQ = useQuery({ queryKey: ['auditoria-resumen'], queryFn: () => api.getAuditoriaResumen() });
  const s = resumenQ.data?.data;

  const listaQ = useQuery({
    queryKey: ['auditoria', soloDiferencias],
    queryFn: () => api.getAuditoria({ soloDiscrepancias: soloDiferencias || undefined }),
  });
  const comprobantes: any[] = listaQ.data?.data?.comprobantes || [];

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['auditoria'] });
    qc.invalidateQueries({ queryKey: ['auditoria-resumen'] });
  };

  const revisar = async (todos: boolean) => {
    setRevisando(true); setError(''); setAviso('');
    try {
      const r = await api.correrAuditoria(todos);
      const d: any = r.data;
      setAviso(
        `Revisados ${d.revisados} comprobante(s) ante el SAT: ` +
        `${d.discrepancias} diferencia(s)` +
        (d.errores ? `, ${d.errores} sin respuesta del SAT (se reintentan solos).` : '.')
      );
      refrescar();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo correr la revisión');
    } finally { setRevisando(false); }
  };

  const faltanPorRevisar = s ? Number(s.total_comprobantes) - Number(s.revisados) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <ShieldCheck className="text-emerald-600" size={36} /> Auditoría
          </h1>
          <p className="text-gray-600 mt-1">
            Lo que el SAT dice de nuestros comprobantes · revisión automática cada{' '}
            {s?.horasEntreRevisiones ?? 72} horas
          </p>
        </div>
        {puedeRevisar && (
          <div className="flex gap-2">
            <button onClick={() => revisar(false)} disabled={revisando}
              className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50">
              <RefreshCw size={18} className={revisando ? 'animate-spin' : ''} />
              {revisando ? 'Revisando…' : 'Revisar pendientes'}
            </button>
            <button onClick={() => revisar(true)} disabled={revisando}
              title="Vuelve a preguntar por TODOS, sin esperar las 72 horas"
              className="flex items-center gap-2 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-sm">
              Revisar todo
            </button>
          </div>
        )}
      </div>

      {aviso && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-sm">{aviso}</div>}
      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      {/* La diferencia entre "todo bien" y "no se ha revisado nada" tiene que
          verse de un vistazo: son la misma pantalla en ceros. */}
      {s && faltanPorRevisar > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
          <strong>{faltanPorRevisar}</strong> comprobante(s) todavía no se han consultado
          nunca ante el SAT. {puedeRevisar ? 'Usa "Revisar todo" para ponerte al corriente.'
            : 'El proceso automático los irá revisando.'}
        </div>
      )}

      {s && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Tarjeta icon={<AlertTriangle size={22} />} color="rose"
            titulo="Diferencias" valor={s.discrepancias}
            pie="lo que el SAT dice y aquí no" />
          <Tarjeta icon={<ShieldCheck size={22} />} color="emerald"
            titulo="Vigentes" valor={s.vigentes}
            pie={`de ${s.total_comprobantes} comprobantes`} />
          <Tarjeta icon={<Clock size={22} />} color="amber"
            titulo="Esperando al receptor" valor={s.esperando_receptor}
            pie="cancelación en proceso" />
          <Tarjeta icon={<HelpCircle size={22} />} color="sky"
            titulo="Sin respuesta" valor={s.sin_respuesta}
            pie="el SAT no contestó; se reintenta" />
        </div>
      )}

      {s?.alerta_efos > 0 && (
        <div className="bg-rose-50 border border-rose-300 text-rose-800 px-4 py-3 rounded-lg text-sm">
          <strong>{s.alerta_efos}</strong> comprobante(s) con una validación EFOS distinta
          de 100. Revísalos: el SAT marca así a los emisores que aparecen en las listas
          del artículo 69-B del CFF.
        </div>
      )}

      <div className="bg-white rounded-lg shadow border p-4 flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={soloDiferencias}
            onChange={(e) => setSoloDiferencias(e.target.checked)}
            className="rounded border-gray-300" />
          Sólo los que no coinciden
        </label>
        <span className="ml-auto text-sm text-gray-500">
          {comprobantes.length} comprobante(s) · última revisión {fechaHora(s?.ultima_corrida)}
        </span>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Comprobante</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Folio fiscal</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Aquí</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">En el SAT</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Qué significa</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Revisado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {listaQ.isLoading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!listaQ.isLoading && comprobantes.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 italic">
                {soloDiferencias
                  ? 'Ninguna diferencia: lo que dice el SAT coincide con lo que tenemos.'
                  : 'Todavía no se ha revisado ningún comprobante. Corre la primera revisión.'}
              </td></tr>
            )}
            {comprobantes.map((c) => (
              <tr key={c.id} className={c.discrepancia ? 'bg-rose-50/60' : 'hover:bg-gray-50'}>
                <td className="px-4 py-2 text-sm">
                  <p className="font-medium">{c.serie_folio}</p>
                  <p className="text-xs text-gray-500">{TIPO[c.doc_type] || c.doc_type}</p>
                </td>
                <td className="px-4 py-2 text-xs font-mono text-gray-600">{c.uuid}</td>
                <td className="px-4 py-2 text-center text-xs">{c.estado_local}</td>
                <td className="px-4 py-2 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    ESTADO_SAT[c.estado_sat] || 'bg-gray-100 text-gray-600'}`}>
                    {c.estado_sat || '—'}
                  </span>
                  {c.discrepancia && (
                    <p className="text-[11px] text-rose-700 font-semibold mt-0.5">no coincide</p>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-gray-600 max-w-md">
                  {c.error_consulta
                    ? <span className="text-amber-700">Sin respuesta del SAT ({c.error_consulta})</span>
                    : c.resumen}
                </td>
                <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                  {fechaHora(c.ultima_revision)}
                  {c.toca_revisar && <p className="text-[11px] text-amber-700">toca revisar</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Esta pantalla sólo consulta: nunca cancela ni modifica un comprobante. Cuando el
        SAT y el sistema no coincidan, la corrección se hace desde Facturas, a mano y por
        alguien que sepa qué arrastra ese cambio.
      </p>
    </div>
  );
}

function Tarjeta({ icon, titulo, valor, pie, color }: {
  icon: React.ReactNode; titulo: string; valor: any; pie: string;
  color: 'rose' | 'amber' | 'sky' | 'emerald';
}) {
  const cls = {
    rose: 'bg-rose-100 text-rose-600',
    amber: 'bg-amber-100 text-amber-600',
    sky: 'bg-sky-100 text-sky-600',
    emerald: 'bg-emerald-100 text-emerald-600',
  }[color];
  return (
    <div className="bg-white rounded-lg shadow border p-4 flex items-center gap-3">
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${cls}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{titulo}</p>
        <p className="text-2xl font-bold">{valor ?? 0}</p>
        <p className="text-[11px] text-gray-400 truncate">{pie}</p>
      </div>
    </div>
  );
}
