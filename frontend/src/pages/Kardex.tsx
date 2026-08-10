/**
 * Kardex — la historia de UN producto en UN mes.
 *
 * Se elige el producto, el mes y el año, y sale de qué existencia se partió,
 * qué entró y qué salió con el documento que lo respalda, y con cuánto se
 * cerró. Es el reporte que se lleva a una revisión: el renglón que no cuadra
 * trae al lado el número de factura con el que discutirlo.
 *
 * El almacén es opcional a propósito. Sin elegirlo consolida todo, que es lo
 * que se quiere para saber "cuánto tengo de esto"; eligiéndolo responde por
 * bodega, que es lo que hace falta cuando alguien tiene que ir a contarlo.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Loader2, ArrowDownLeft, ArrowUpRight, Printer } from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cant = (n: any) =>
  Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 3 });

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
               'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function KardexPage() {
  const hoy = new Date();
  const [productId, setProductId] = useState('');
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [warehouseId, setWarehouseId] = useState('');

  const productosQ = useQuery({
    queryKey: ['productos-kardex'],
    queryFn: () => api.getProducts(1, 500),
  });
  const almacenesQ = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.getWarehouses(),
  });

  /* Sólo se consulta con producto elegido. `enabled` y no un if dentro de la
   * función: sin él, react-query lanzaría la petición igual y el backend
   * respondería 400 por falta de productId cada vez que se abre la pantalla. */
  const kardexQ = useQuery({
    queryKey: ['kardex', productId, anio, mes, warehouseId],
    queryFn: () => api.getKardexMensual({ productId, anio, mes, warehouseId: warehouseId || undefined }),
    enabled: !!productId,
  });

  const productos: any[] = (productosQ.data as any)?.data?.products ?? [];
  const almacenes: any[] = (() => {
    const d: any = almacenesQ.data;
    const c = d?.data?.warehouses ?? d?.warehouses ?? d?.data ?? d;
    return Array.isArray(c) ? c : [];
  })();
  const k: any = (kardexQ.data as any)?.data;

  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);

  return (
    <div className="mx-auto max-w-[1200px] p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-lg"><ClipboardList size={22} className="text-amber-700" /></div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Kardex</h1>
            <p className="text-sm text-slate-500">Movimientos de un producto, mes por mes.</p>
          </div>
        </div>
        {k && (
          <button onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 print:hidden">
            <Printer size={15} /> Imprimir
          </button>
        )}
      </div>

      {/* ── Filtros ── */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 grid grid-cols-1 md:grid-cols-4 gap-3 print:hidden">
        <label className="block md:col-span-2">
          <span className="block text-xs text-slate-500 mb-1">Producto</span>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input">
            <option value="">— elige el producto —</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-slate-500 mb-1">Mes</span>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input">
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-slate-500 mb-1">Año</span>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="block text-xs text-slate-500 mb-1">Almacén</span>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input">
            <option value="">Todos los almacenes</option>
            {almacenes.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </label>
      </div>

      {!productId && (
        <p className="text-center text-sm text-slate-400 py-10">
          Elige un producto para ver su movimiento.
        </p>
      )}

      {kardexQ.isLoading && productId && (
        <p className="text-center text-slate-400 py-10"><Loader2 className="inline animate-spin" size={18} /> Calculando…</p>
      )}

      {kardexQ.error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">
          {(kardexQ.error as any)?.response?.data?.message || 'No se pudo obtener el kardex'}
        </div>
      )}

      {k && (
        <>
          <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
            <p className="font-semibold text-slate-800">
              <span className="font-mono text-xs text-slate-500 mr-2">{k.producto.sku}</span>
              {k.producto.name}
            </p>
            <p className="text-xs text-slate-500">
              {MESES[k.periodo.mes - 1]} {k.periodo.anio} · {k.almacen ? `${k.almacen.code} · ${k.almacen.name}` : 'Todos los almacenes'}
            </p>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="text-left px-3 py-2">Fecha</th>
                    <th className="text-left px-3 py-2">Movimiento</th>
                    <th className="text-left px-3 py-2">Documento</th>
                    <th className="text-left px-3 py-2">Almacén</th>
                    <th className="text-right px-3 py-2">Entrada</th>
                    <th className="text-right px-3 py-2">Salida</th>
                    <th className="text-right px-3 py-2">C. unitario</th>
                    <th className="text-right px-3 py-2">Existencia</th>
                  </tr>
                </thead>
                <tbody>
                  {/* El saldo inicial es un renglón más, no una nota al margen:
                      leído de corrido, la columna de existencia cuadra desde la
                      primera fila hasta la última. */}
                  <tr className="border-t border-slate-100 bg-slate-50/60">
                    <td className="px-3 py-2 text-slate-500" colSpan={4}>
                      Existencia al {k.periodo.desde}
                    </td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{cant(k.saldoInicial)}</td>
                  </tr>

                  {k.movimientos.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                      Sin movimientos en este mes.
                    </td></tr>
                  ) : k.movimientos.map((m: any, i: number) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{String(m.fecha).slice(0, 10)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 ${m.esEntrada ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {m.esEntrada ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                          {m.tipoNombre}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{m.documento || '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{m.almacen || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-700">{m.entrada ? cant(m.entrada) : ''}</td>
                      <td className="px-3 py-2 text-right font-mono text-rose-700">{m.salida ? cant(m.salida) : ''}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-500">
                        {m.costoUnitario != null ? `$${money(m.costoUnitario)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{cant(m.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 text-sm">
                  <tr className="border-t-2 border-slate-200">
                    <td className="px-3 py-2 font-semibold text-slate-700" colSpan={4}>Totales del mes</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-700">{cant(k.resumen.totalEntradas)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-rose-700">{cant(k.resumen.totalSalidas)}</td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-right font-mono font-bold">{cant(k.resumen.existenciaFinal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Tarjeta titulo="Existencia al cierre" valor={cant(k.resumen.existenciaFinal)} sufijo={k.producto.unit || ''} />
            <Tarjeta titulo="Costo promedio" valor={`$${money(k.resumen.costoPromedio)}`} />
            <Tarjeta titulo="Valor total" valor={`$${money(k.resumen.valorTotal)}`} destacado />
          </div>
          {/* El valor sale de la valuación de HOY, no del cierre del mes. Se
              dice para que nadie lo lea como "lo que valía en julio". */}
          <p className="text-xs text-slate-400">
            El costo promedio y el valor total corresponden a la existencia actual, que es
            la que usa el resto del sistema para valuar.
          </p>
        </>
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, sufijo, destacado }: {
  titulo: string; valor: string; sufijo?: string; destacado?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-4 ${destacado ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
      <p className="text-xs text-slate-500 mb-1">{titulo}</p>
      <p className={`text-2xl font-bold ${destacado ? 'text-amber-800' : 'text-slate-900'}`}>
        {valor} {sufijo && <span className="text-sm font-normal text-slate-500">{sufijo}</span>}
      </p>
    </div>
  );
}

export default KardexPage;
