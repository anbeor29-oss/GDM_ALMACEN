/**
 * Comercio Electrónico → Inventario (rebanada 3, embebido · lectura).
 *
 * Existencias por almacén sobre `warehouse_stock` del ERP (mismos datos que ve el
 * despacho). Sólo consulta: los movimientos/ajustes (con capas de costo) siguen en el
 * ERP para no romper el kardex; llegan al módulo en una rebanada posterior.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, ArrowLeft, Search, PackagePlus, X, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '@/services/api';

export function InventarioEcPage() {
  const qc = useQueryClient();
  const [busq, setBusq] = useState('');
  const [ajustar, setAjustar] = useState<any | null>(null);   // producto a capturar
  const q = useQuery({ queryKey: ['ec-inventario', busq], queryFn: () => api.getInventarioEc(busq || undefined) });
  const renglones: any[] = (q.data as any)?.data?.renglones || [];
  const almacenesQ = useQuery({ queryKey: ['ec-almacenes'], queryFn: () => api.getAlmacenesEc() });
  const almacenes: any[] = (almacenesQ.data as any)?.data?.almacenes || [];
  const refrescar = () => qc.invalidateQueries({ queryKey: ['ec-inventario'] });

  // Total por producto (suma de almacenes) para el pie de cada grupo.
  const totalProducto = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of renglones) m.set(r.product_id, (m.get(r.product_id) || 0) + Number(r.existencia || 0));
    return m;
  }, [renglones]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <Link to="/ecommerce" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft size={15} /> Comercio Electrónico</Link>
        <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2 mt-1"><Boxes className="text-indigo-600" size={24} /> Inventario</h1>
        <p className="text-sm text-gray-500">Existencias por almacén. Captura entradas/salidas con «Entrada» — el movimiento entra al kardex del ERP.</p>
      </div>

      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
        <input value={busq} onChange={(e) => setBusq(e.target.value)} placeholder="Buscar producto…"
          className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm" />
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Producto</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">SKU</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Almacén</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Existencia</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Total prod.</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
          </tr></thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">Cargando…</td></tr>}
            {!q.isLoading && renglones.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400 italic">Sin productos. Da de alta productos en «Productos».</td></tr>}
            {renglones.map((r, i) => {
              const primero = i === 0 || renglones[i - 1].product_id !== r.product_id;
              return (
                <tr key={`${r.product_id}-${r.warehouse_id || 'sin'}`} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-800">{primero ? r.name : <span className="text-gray-300">↳</span>}</td>
                  <td className="px-3 py-2 font-mono text-gray-600">{primero ? r.sku : ''}</td>
                  <td className="px-3 py-2 text-gray-600">{r.almacen || <span className="text-gray-300 italic">sin existencias</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{Number(r.existencia || 0).toLocaleString('es-MX')}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-700">{primero ? Number(totalProducto.get(r.product_id) || 0).toLocaleString('es-MX') : ''}</td>
                  <td className="px-3 py-2 text-center">
                    {primero && (
                      <button onClick={() => setAjustar(r)}
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded px-2 py-1" title="Capturar entrada o salida de existencias">
                        <PackagePlus size={14} /> Entrada
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {ajustar && (
        <ModalAjuste producto={ajustar} almacenes={almacenes}
          onClose={() => setAjustar(null)}
          onDone={() => { setAjustar(null); refrescar(); }} />
      )}
    </div>
  );
}

/** Captura de entrada/salida de existencias de un producto (va al kardex del ERP). */
function ModalAjuste({ producto, almacenes, onClose, onDone }:
  { producto: any; almacenes: any[]; onClose: () => void; onDone: () => void }) {
  const [almacenId, setAlmacenId] = useState<string>(producto.warehouse_id || almacenes[0]?.id || '');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const guardar = async () => {
    if (!almacenId) { setError('Elige el almacén.'); return; }
    const c = Number(cantidad);
    if (!(c > 0)) { setError('Captura una cantidad mayor a 0.'); return; }
    setBusy(true); setError('');
    try {
      await api.ajustarInventarioEc({
        productId: producto.product_id, warehouseId: almacenId, direction,
        quantity: c, unitCost: costo === '' ? undefined : Number(costo),
        reason: motivo.trim() || undefined,
      });
      onDone();
    } catch (e: any) { setError(e?.response?.data?.message || 'No se pudo registrar el movimiento.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><PackagePlus size={18} className="text-indigo-600" /> Movimiento de existencias</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <p className="text-gray-600">Producto: <b>{producto.name}</b> <span className="font-mono text-gray-400">{producto.sku}</span></p>

          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-semibold text-gray-600 block mb-1">Almacén</span>
              <select value={almacenId} onChange={(e) => setAlmacenId(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-2 text-sm">
                {almacenes.length === 0 && <option value="">No hay almacenes</option>}
                {almacenes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></label>
            <label className="block"><span className="text-xs font-semibold text-gray-600 block mb-1">Tipo</span>
              <select value={direction} onChange={(e) => setDirection(e.target.value as 'IN' | 'OUT')} className="w-full border border-slate-300 rounded px-2 py-2 text-sm">
                <option value="IN">Entrada (+)</option><option value="OUT">Salida (−)</option>
              </select></label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-semibold text-gray-600 block mb-1">Cantidad</span>
              <input value={cantidad} onChange={(e) => setCantidad(e.target.value)} inputMode="decimal" min="0" type="number"
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm text-right tabular-nums" /></label>
            {direction === 'IN' && (
              <label className="block"><span className="text-xs font-semibold text-gray-600 block mb-1">Costo unitario (opcional)</span>
                <input value={costo} onChange={(e) => setCosto(e.target.value)} inputMode="decimal" min="0" type="number" placeholder="—"
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm text-right tabular-nums" /></label>
            )}
          </div>

          <label className="block"><span className="text-xs font-semibold text-gray-600 block mb-1">Motivo (opcional)</span>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="p. ej. Alta inicial, compra, conteo físico…"
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm" /></label>

          {error && <p className="text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</p>}
          <p className="text-[11px] text-gray-400">El movimiento queda en el kardex del ERP (inventory_movements) con su costeo; no se escribe el stock a mano.</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border text-gray-700 hover:bg-gray-100">Cancelar</button>
          <button onClick={guardar} disabled={busy || !almacenId || !(Number(cantidad) > 0)}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <PackagePlus size={15} />} {busy ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default InventarioEcPage;
