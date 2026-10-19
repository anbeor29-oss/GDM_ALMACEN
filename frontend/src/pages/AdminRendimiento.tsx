/**
 * Rendimiento (Render) — panel de salud del servicio, solo SUPER_ADMIN.
 *
 * De un vistazo: memoria del proceso Node y del contenedor, y disco ocupado por
 * la base de datos (lo que de verdad crece en Render). Sólo lee; se refresca a
 * mano. Sirve para decidir cuándo subir de plan o depurar tablas pesadas.
 */
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw, HardDrive, Cpu, Database } from 'lucide-react';
import api from '@/services/api';

const KB = 1024, MB = KB * 1024, GB = MB * 1024;
function human(bytes: number): string {
  const b = Number(bytes) || 0;
  if (b >= GB) return `${(b / GB).toFixed(2)} GB`;
  if (b >= MB) return `${(b / MB).toFixed(1)} MB`;
  if (b >= KB) return `${(b / KB).toFixed(0)} KB`;
  return `${b} B`;
}
function duracion(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return [d ? `${d}d` : '', h ? `${h}h` : '', `${m}m`].filter(Boolean).join(' ');
}

export function AdminRendimientoPage() {
  const q = useQuery({ queryKey: ['admin-rendimiento'], queryFn: () => api.getRendimiento(), refetchInterval: 30_000 });
  const d: any = q.data?.data;
  const node = d?.node || {};
  const osd = d?.os || {};
  const db = d?.db || { total_bytes: 0, tablas: [] };
  const memUsadaPct = osd.totalmem ? Math.round(((osd.totalmem - osd.freemem) / osd.totalmem) * 100) : null;

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Activity size={24} className="text-rose-600" /> Rendimiento (Render)
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Memoria del servicio y disco de la base de datos. Se actualiza solo cada 30 s.</p>
        </div>
        <button onClick={() => q.refetch()} className="inline-flex items-center gap-1.5 text-sm text-gray-600 border rounded-lg px-3 py-1.5 hover:bg-gray-50">
          <RefreshCw size={15} className={q.isFetching ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {q.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}
      {q.isError && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">No se pudo leer el rendimiento.</p>}

      {d && (
        <>
          {/* Memoria */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Tarjeta icon={<Cpu size={16} className="text-indigo-600" />} titulo="Memoria del proceso (RSS)"
              valor={human(node.rss)} pie={`Heap ${human(node.heapUsed)} / ${human(node.heapTotal)}`} />
            <Tarjeta icon={<Cpu size={16} className="text-emerald-600" />} titulo="Memoria del contenedor"
              valor={memUsadaPct != null ? `${memUsadaPct}% usada` : human(osd.totalmem)}
              pie={`${human(osd.totalmem - osd.freemem)} de ${human(osd.totalmem)} · libre ${human(osd.freemem)}`}
              alerta={memUsadaPct != null && memUsadaPct >= 85} />
            <Tarjeta icon={<HardDrive size={16} className="text-amber-600" />} titulo="Disco de la base de datos"
              valor={human(db.total_bytes)} pie={`${db.tablas?.length || 0} tablas · ${osd.cpus || '?'} CPU · activo ${duracion(node.uptime_s || 0)}`} />
          </div>

          {/* Tablas más pesadas */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Database size={16} className="text-amber-600" /> Tablas más pesadas de la base
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-2 text-left">Tabla</th>
                  <th className="px-4 py-2 text-right">Tamaño</th>
                  <th className="px-4 py-2 text-right">Filas (aprox.)</th>
                  <th className="px-4 py-2 text-right w-40">% del total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(db.tablas || []).map((t: any) => {
                  const pct = db.total_bytes ? (t.bytes / db.total_bytes) * 100 : 0;
                  return (
                    <tr key={t.tabla}>
                      <td className="px-4 py-1.5 font-mono text-xs text-gray-700">{t.tabla}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{human(t.bytes)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums text-gray-500">{Number(t.filas_aprox).toLocaleString('es-MX')}</td>
                      <td className="px-4 py-1.5">
                        <div className="flex items-center gap-2 justify-end">
                          <div className="flex-1 max-w-[120px] h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-amber-400" style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          <span className="tabular-nums text-xs text-gray-500 w-10 text-right">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {(!db.tablas || db.tablas.length === 0) && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400 italic">Sin datos de tablas (permisos del catálogo).</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400">Lectura del {new Date(d.ts).toLocaleString('es-MX')} · Node {node.version} · {osd.platform}</p>
        </>
      )}
    </div>
  );
}

function Tarjeta({ icon, titulo, valor, pie, alerta }: { icon: React.ReactNode; titulo: string; valor: string; pie?: string; alerta?: boolean }) {
  return (
    <div className={`rounded-xl border shadow-sm p-4 ${alerta ? 'bg-rose-50 border-rose-200' : 'bg-white border-gray-200'}`}>
      <p className="text-[11px] uppercase tracking-wide text-gray-400 flex items-center gap-1.5">{icon} {titulo}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${alerta ? 'text-rose-700' : 'text-gray-900'}`}>{valor}</p>
      {pie && <p className="text-xs text-gray-500 mt-0.5">{pie}</p>}
    </div>
  );
}

export default AdminRendimientoPage;
