/**
 * Comercio Electrónico → Reportes de ventas (rebanada 11).
 *
 * Tablero de ventas web en un rango de fechas: KPIs, serie por día/mes (gráfica de
 * barras sin librería), top productos y desglose por tienda. «Ventas» = pedidos
 * confirmados (no pendientes de pago ni cancelados). Sólo consulta.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ArrowLeft, Package, Store, Receipt, ShoppingBag, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/services/api';

const money = (n: any) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const moneyK = (n: any) => `$${Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;

const primerDiaMes = () => `${new Date().toISOString().slice(0, 7)}-01`;
const hoyYmd = () => new Date().toISOString().slice(0, 10);

/** Etiqueta corta del periodo para el eje X. */
function etiquetaPeriodo(periodo: string, periodicidad: string): string {
  if (periodicidad === 'mes') {
    const [a, m] = periodo.split('-');
    return ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][Number(m)] + ' ' + a.slice(2);
  }
  return periodo.slice(8, 10); // día del mes
}

export function ReportesEcPage() {
  const [desde, setDesde] = useState(primerDiaMes());
  const [hasta, setHasta] = useState(hoyYmd());
  const [storeId, setStoreId] = useState('');

  const tiendasQ = useQuery({ queryKey: ['ec-tiendas'], queryFn: () => api.listTiendas() });
  const tiendas: any[] = (tiendasQ.data as any)?.data?.tiendas || [];

  const q = useQuery({
    queryKey: ['ec-reporte-ventas', desde, hasta, storeId],
    queryFn: () => api.getReporteVentasEc({ desde, hasta, storeId: storeId || undefined }),
  });
  const d: any = (q.data as any)?.data;
  const k = d?.kpis;
  const serie: any[] = d?.serie || [];
  const maxVenta = Math.max(1, ...serie.map((s) => Number(s.ventas)));
  const pasoEtiqueta = Math.max(1, Math.ceil(serie.length / 10));

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <Link to="/ecommerce" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={15} /> Comercio Electrónico</Link>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mt-1"><BarChart3 className="text-violet-600" size={24} /> Reportes de ventas</h1>
        <p className="text-sm text-gray-500">Ventas web por periodo. «Ventas» = pedidos confirmados (no pendientes de pago ni cancelados).</p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 bg-white border rounded-lg p-3">
        <label className="block"><span className="text-[11px] text-gray-500 block mb-0.5">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" /></label>
        <label className="block"><span className="text-[11px] text-gray-500 block mb-0.5">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" /></label>
        <label className="block"><span className="text-[11px] text-gray-500 block mb-0.5">Tienda</span>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white">
            <option value="">Todas</option>
            {tiendas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select></label>
      </div>

      {q.isLoading || !k ? (
        <p className="text-gray-500">Cargando…</p>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Kpi icon={Wallet} color="text-emerald-600 bg-emerald-50" label="Ventas" valor={money(k.ventas)} />
            <Kpi icon={ShoppingBag} color="text-blue-600 bg-blue-50" label="Pedidos" valor={String(k.pedidos)} sub={`ticket prom. ${money(k.ticketPromedio)}`} />
            <Kpi icon={Receipt} color="text-amber-600 bg-amber-50" label="Facturados" valor={String(k.facturados)} sub={`de ${k.pedidos} pedidos`} />
            <Kpi icon={Package} color="text-rose-600 bg-rose-50" label="Pendientes de pago" valor={String(k.pendientes)} sub={money(k.ventasPendientes)} />
          </div>
          {(Number(k.descuentos) > 0 || Number(k.envios) > 0 || Number(k.cancelados) > 0) && (
            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
              {Number(k.descuentos) > 0 && <span>Descuentos (cupones): <b className="text-gray-700">{money(k.descuentos)}</b></span>}
              {Number(k.envios) > 0 && <span>Envíos cobrados: <b className="text-gray-700">{money(k.envios)}</b></span>}
              {Number(k.cancelados) > 0 && <span>Cancelados: <b className="text-gray-700">{k.cancelados}</b></span>}
            </div>
          )}

          {/* Serie */}
          <div className="bg-white border rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Ventas por {d.periodicidad === 'mes' ? 'mes' : 'día'}</h2>
            {serie.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-8 text-center">Sin ventas en el rango.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex items-end gap-1 h-44 min-w-full" style={{ minWidth: serie.length * 22 }}>
                  {serie.map((s, i) => (
                    <div key={s.periodo} className="flex-1 flex flex-col items-center justify-end group" style={{ minWidth: 18 }}>
                      <div className="w-full bg-violet-500 hover:bg-violet-600 rounded-t transition-colors"
                        style={{ height: `${Math.max(2, (Number(s.ventas) / maxVenta) * 100)}%` }}
                        title={`${s.periodo}: ${money(s.ventas)} · ${s.pedidos} pedido(s)`} />
                      <span className="text-[9px] text-gray-400 mt-1 whitespace-nowrap">{i % pasoEtiqueta === 0 ? etiquetaPeriodo(s.periodo, d.periodicidad) : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Top productos */}
            <div className="bg-white border rounded-lg overflow-hidden">
              <h2 className="text-sm font-semibold text-gray-700 px-4 py-2.5 border-b flex items-center gap-1.5"><Package size={15} /> Productos más vendidos</h2>
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {(d.topProductos || []).length === 0 && <tr><td className="px-4 py-6 text-center text-gray-400 italic">Sin ventas.</td></tr>}
                  {(d.topProductos || []).map((p: any) => (
                    <tr key={p.productId} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-800"><p className="truncate max-w-xs">{p.nombre}</p></td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500 whitespace-nowrap">{p.unidades} u.</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-gray-800 whitespace-nowrap">{money(p.importe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Por tienda */}
            <div className="bg-white border rounded-lg overflow-hidden">
              <h2 className="text-sm font-semibold text-gray-700 px-4 py-2.5 border-b flex items-center gap-1.5"><Store size={15} /> Por tienda</h2>
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {(d.porTienda || []).map((t: any) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-800">{t.nombre}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500 whitespace-nowrap">{t.pedidos} ped.</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-gray-800 whitespace-nowrap">{moneyK(t.ventas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, color, label, valor, sub }: { icon: any; color: string; label: string; valor: string; sub?: string }) {
  return (
    <div className="bg-white border rounded-xl p-4">
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}><Icon size={17} /></div>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="mt-2 text-xl font-bold text-gray-900 tabular-nums">{valor}</p>
      {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
    </div>
  );
}

export default ReportesEcPage;
