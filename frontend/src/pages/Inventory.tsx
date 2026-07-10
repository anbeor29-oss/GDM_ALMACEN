/**
 * Inventario — existencias por almacén + kardex (§1, §2, §7, §10 ALMACEN.MD).
 *
 *  · Semáforo: SUFICIENTE / PREVENTIVO / CRITICO / AGOTADO (§14)
 *  · Ajustes manuales con motivo obligatorio (ADMIN/MANAGER)
 *  · Traspasos atómicos entre almacenes
 *  · Mín/máx por producto y almacén
 *  · Kardex: bitácora inmutable de todos los movimientos
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Boxes, Search, ArrowLeftRight, SlidersHorizontal, History,
  PackagePlus, PackageMinus, AlertTriangle,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

interface StockRow {
  id: string;
  product_id: string;
  sku: string;
  product_name: string;
  category?: string;
  unit_code?: string;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  quantity: number;
  stock_minimum: number;
  stock_maximum: number;
  avg_cost: number;
  stock_value: number;
  semaforo: 'SUFICIENTE' | 'PREVENTIVO' | 'CRITICO' | 'AGOTADO';
}

interface KardexRow {
  id: string;
  movement_type: string;
  quantity: number;
  unit_cost?: number;
  reason?: string;
  user_email?: string;
  created_at: string;
  sku: string;
  product_name: string;
  warehouse_from_code?: string;
  warehouse_to_code?: string;
  reference_type?: string;
}

const SEMAFORO_BADGE: Record<StockRow['semaforo'], string> = {
  SUFICIENTE: 'bg-emerald-100 text-emerald-700',
  PREVENTIVO: 'bg-amber-100 text-amber-700',
  CRITICO:    'bg-red-100 text-red-700',
  AGOTADO:    'bg-gray-200 text-gray-600',
};

const MOVEMENT_LABEL: Record<string, { label: string; cls: string }> = {
  PURCHASE_IN:     { label: 'Entrada compra',      cls: 'bg-emerald-100 text-emerald-700' },
  SALE_OUT:        { label: 'Salida venta',        cls: 'bg-sky-100 text-sky-700' },
  CUSTOMER_RETURN: { label: 'Devolución cliente',  cls: 'bg-emerald-100 text-emerald-700' },
  SUPPLIER_RETURN: { label: 'Devolución proveedor', cls: 'bg-rose-100 text-rose-700' },
  TRANSFER_OUT:    { label: 'Traspaso salida',     cls: 'bg-violet-100 text-violet-700' },
  TRANSFER_IN:     { label: 'Traspaso entrada',    cls: 'bg-violet-100 text-violet-700' },
  ADJUSTMENT_IN:   { label: 'Ajuste +',            cls: 'bg-emerald-100 text-emerald-700' },
  ADJUSTMENT_OUT:  { label: 'Ajuste −',            cls: 'bg-rose-100 text-rose-700' },
  SHRINKAGE:       { label: 'Merma',               cls: 'bg-rose-100 text-rose-700' },
  THEFT:           { label: 'Robo/pérdida',        cls: 'bg-rose-100 text-rose-700' },
  DAMAGED:         { label: 'Dañado',              cls: 'bg-rose-100 text-rose-700' },
  INITIAL:         { label: 'Carga inicial',       cls: 'bg-gray-200 text-gray-600' },
};

const money = (n: number) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const num = (n: number) => Number(n ?? 0).toLocaleString('es-MX');

export function InventoryPage() {
  const [tab, setTab] = useState<'stock' | 'kardex'>('stock');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <Boxes className="text-fuchsia-600" size={36} /> Inventario
          </h1>
          <p className="text-gray-600 mt-1">
            Existencias por almacén · ajustes autorizados · traspasos · kardex
          </p>
        </div>
        <div className="flex bg-gray-200/70 rounded-lg p-1">
          <TabButton active={tab === 'stock'} onClick={() => setTab('stock')}
            icon={<Boxes size={16} />} label="Existencias" />
          <TabButton active={tab === 'kardex'} onClick={() => setTab('kardex')}
            icon={<History size={16} />} label="Kardex" />
        </div>
      </div>

      {tab === 'stock' ? <StockTab /> : <KardexTab />}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
        active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
      }`}>
      {icon}{label}
    </button>
  );
}

/* ============================== EXISTENCIAS ============================== */

function StockTab() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const canWrite = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'].includes(user?.role || '');

  const [warehouseId, setWarehouseId] = useState('');
  const [search, setSearch] = useState('');
  const [belowMin, setBelowMin] = useState(false);
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const [transferring, setTransferring] = useState<StockRow | null>(null);
  const [limits, setLimits] = useState<StockRow | null>(null);

  const whQ = useQuery({ queryKey: ['warehouses'], queryFn: () => api.getWarehouses() });
  const warehouses = whQ.data?.data?.warehouses || [];

  const q = useQuery({
    queryKey: ['inventory-stock', warehouseId, search, belowMin],
    queryFn: () => api.getInventoryStock({
      warehouseId: warehouseId || undefined,
      search: search || undefined,
      belowMin: belowMin || undefined,
      limit: 300,
    }),
  });
  const rows: StockRow[] = q.data?.data?.stock || [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['inventory-stock'] });
    qc.invalidateQueries({ queryKey: ['inventory-kardex'] });
    qc.invalidateQueries({ queryKey: ['warehouses'] });
  };

  const alertCount = rows.filter((r) => r.semaforo === 'CRITICO' || r.semaforo === 'AGOTADO').length;

  return (
    <>
      <div className="bg-white rounded-lg shadow border p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por SKU, nombre o código de barras…"
            className="input pl-9 w-full" />
        </div>
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
          className="input w-auto">
          <option value="">Todos los almacenes</option>
          {warehouses.map((w: any) => (
            <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-700 whitespace-nowrap">
          <input type="checkbox" checked={belowMin} onChange={(e) => setBelowMin(e.target.checked)} />
          Solo bajo mínimo
        </label>
        {alertCount > 0 && (
          <span className="ml-auto flex items-center gap-1.5 text-sm text-red-700 bg-red-50 px-3 py-1.5 rounded-full font-medium">
            <AlertTriangle size={14} /> {alertCount} en crítico/agotado
          </span>
        )}
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">SKU</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Producto</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Almacén</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Existencia</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Mín / Máx</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Costo prom.</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Valuación</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Semáforo</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500 italic">
                Sin existencias registradas. Las entradas llegan por compras XML, ajustes o carga inicial.
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-sm">{r.sku}</td>
                <td className="px-4 py-2 font-medium text-sm">{r.product_name}</td>
                <td className="px-4 py-2 text-sm">
                  <span className="font-mono text-xs bg-sky-50 text-sky-700 px-2 py-0.5 rounded">
                    {r.warehouse_code}
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-semibold">{num(r.quantity)}</td>
                <td className="px-4 py-2 text-right text-sm text-gray-500">
                  {num(r.stock_minimum)} / {num(r.stock_maximum)}
                </td>
                <td className="px-4 py-2 text-right text-sm">{money(r.avg_cost)}</td>
                <td className="px-4 py-2 text-right text-sm font-medium">{money(r.stock_value)}</td>
                <td className="px-4 py-2 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEMAFORO_BADGE[r.semaforo]}`}>
                    {r.semaforo}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {canWrite && (
                    <div className="flex items-center justify-center gap-1">
                      <button title="Ajuste manual" onClick={() => setAdjusting(r)}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded">
                        <SlidersHorizontal size={16} />
                      </button>
                      <button title="Traspasar a otro almacén" onClick={() => setTransferring(r)}
                        className="p-1.5 text-violet-600 hover:bg-violet-50 rounded">
                        <ArrowLeftRight size={16} />
                      </button>
                      <button title="Mínimo / máximo" onClick={() => setLimits(r)}
                        className="p-1.5 text-amber-600 hover:bg-amber-50 rounded">
                        <AlertTriangle size={16} />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adjusting && (
        <AdjustModal row={adjusting} onClose={() => setAdjusting(null)}
          onSaved={() => { setAdjusting(null); refresh(); }} />
      )}
      {transferring && (
        <TransferModal row={transferring} warehouses={warehouses}
          onClose={() => setTransferring(null)}
          onSaved={() => { setTransferring(null); refresh(); }} />
      )}
      {limits && (
        <LimitsModal row={limits} onClose={() => setLimits(null)}
          onSaved={() => { setLimits(null); refresh(); }} />
      )}
    </>
  );
}

/* ================================ KARDEX ================================ */

function KardexTab() {
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState('');

  const whQ = useQuery({ queryKey: ['warehouses'], queryFn: () => api.getWarehouses() });
  const warehouses = whQ.data?.data?.warehouses || [];

  const q = useQuery({
    queryKey: ['inventory-kardex', warehouseId, type],
    queryFn: () => api.getKardex({
      warehouseId: warehouseId || undefined,
      type: type || undefined,
      limit: 200,
    }),
  });
  const rows: KardexRow[] = q.data?.data?.movements || [];

  return (
    <>
      <div className="bg-white rounded-lg shadow border p-4 flex flex-wrap items-center gap-3">
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input w-auto">
          <option value="">Todos los almacenes</option>
          {warehouses.map((w: any) => (
            <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="input w-auto">
          <option value="">Todos los movimientos</option>
          {Object.entries(MOVEMENT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <span className="ml-auto text-sm text-gray-500">
          {q.data?.data?.total ?? 0} movimientos
        </span>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Fecha</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Tipo</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Producto</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Cantidad</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Origen → Destino</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Motivo</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Usuario</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 italic">
                Sin movimientos con esos filtros.
              </td></tr>
            )}
            {rows.map((m) => {
              const mt = MOVEMENT_LABEL[m.movement_type] || { label: m.movement_type, cls: 'bg-gray-100 text-gray-600' };
              return (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm whitespace-nowrap">
                    {new Date(m.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${mt.cls}`}>
                      {mt.label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm">
                    <span className="font-mono text-xs text-gray-500">{m.sku}</span>{' '}
                    <span className="font-medium">{m.product_name}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-sm">{num(m.quantity)}</td>
                  <td className="px-4 py-2 text-center text-xs font-mono">
                    {m.warehouse_from_code || '—'} → {m.warehouse_to_code || '—'}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-600 max-w-64 truncate" title={m.reason}>
                    {m.reason || '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{m.user_email || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ================================ MODALES ================================ */

function ModalShell({ title, icon, children, onClose }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            {icon}
            <h2 className="font-bold">{title}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ProductHeader({ row }: { row: StockRow }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-sm">
      <p className="font-medium">{row.product_name}</p>
      <p className="text-gray-500 text-xs mt-0.5">
        <span className="font-mono">{row.sku}</span> · {row.warehouse_code} — {row.warehouse_name} ·
        existencia actual: <span className="font-semibold text-gray-700">{num(row.quantity)}</span>
      </p>
    </div>
  );
}

function AdjustModal({ row, onClose, onSaved }: {
  row: StockRow; onClose: () => void; onSaved: () => void;
}) {
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [typed, setTyped] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setError('');
    const qty = Number(quantity);
    if (!qty || qty <= 0) { setError('Cantidad inválida'); return; }
    if (!reason.trim()) { setError('El motivo es obligatorio en ajustes'); return; }
    setSaving(true);
    try {
      await api.adjustInventory({
        productId: row.product_id,
        warehouseId: row.warehouse_id,
        direction: typed ? undefined : direction,
        movementType: (typed || undefined) as any,
        quantity: qty,
        unitCost: unitCost ? Number(unitCost) : undefined,
        reason: reason.trim(),
      });
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo aplicar el ajuste');
    } finally {
      setSaving(false);
    }
  };

  const isOut = typed !== '' || direction === 'OUT';

  return (
    <ModalShell title="Ajuste manual de inventario" onClose={onClose}
      icon={<div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
        <SlidersHorizontal className="text-emerald-700" size={20} /></div>}>
      <div className="p-5 space-y-4">
        {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">{error}</div>}
        <ProductHeader row={row} />

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => { setDirection('IN'); setTyped(''); }}
            className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${
              !typed && direction === 'IN'
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            <PackagePlus size={16} /> Entrada (+)
          </button>
          <button onClick={() => { setDirection('OUT'); setTyped(''); }}
            className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${
              !typed && direction === 'OUT'
                ? 'border-rose-500 bg-rose-50 text-rose-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            <PackageMinus size={16} /> Salida (−)
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Baja tipificada (opcional)</label>
          <select value={typed} onChange={(e) => setTyped(e.target.value)} className="input">
            <option value="">— Ajuste genérico —</option>
            <option value="SHRINKAGE">Merma</option>
            <option value="THEFT">Robo o pérdida</option>
            <option value="DAMAGED">Producto dañado</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad *</label>
            <input type="number" min="0" step="any" value={quantity}
              onChange={(e) => setQuantity(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Costo unitario {isOut ? '(n/a en salidas)' : ''}
            </label>
            <input type="number" min="0" step="any" value={unitCost} disabled={isOut}
              onChange={(e) => setUnitCost(e.target.value)}
              placeholder={String(row.avg_cost ?? 0)} className="input disabled:bg-gray-100" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Motivo * (queda en el kardex)</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder="Ej. conteo físico, corrección de captura, merma por caducidad…" className="input" />
        </div>
      </div>
      <div className="flex justify-end gap-3 p-5 border-t bg-gray-50">
        <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
          {saving ? 'Aplicando…' : 'Aplicar ajuste'}
        </button>
      </div>
    </ModalShell>
  );
}

function TransferModal({ row, warehouses, onClose, onSaved }: {
  row: StockRow; warehouses: any[]; onClose: () => void; onSaved: () => void;
}) {
  const [toId, setToId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const targets = warehouses.filter((w) => w.id !== row.warehouse_id && w.is_active);

  const handleSave = async () => {
    setError('');
    const qty = Number(quantity);
    if (!toId) { setError('Selecciona el almacén destino'); return; }
    if (!qty || qty <= 0) { setError('Cantidad inválida'); return; }
    if (qty > Number(row.quantity)) {
      setError(`Existencia insuficiente: disponible ${num(row.quantity)}`); return;
    }
    setSaving(true);
    try {
      await api.transferInventory({
        productId: row.product_id,
        warehouseFromId: row.warehouse_id,
        warehouseToId: toId,
        quantity: qty,
        reason: reason.trim() || undefined,
      });
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo realizar el traspaso');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Traspaso entre almacenes" onClose={onClose}
      icon={<div className="w-10 h-10 bg-violet-100 rounded-lg flex items-center justify-center">
        <ArrowLeftRight className="text-violet-700" size={20} /></div>}>
      <div className="p-5 space-y-4">
        {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">{error}</div>}
        <ProductHeader row={row} />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Almacén destino *</label>
          <select value={toId} onChange={(e) => setToId(e.target.value)} className="input">
            <option value="">— Selecciona —</option>
            {targets.map((w) => (
              <option key={w.id} value={w.id}>{w.code} — {w.name}</option>
            ))}
          </select>
          {targets.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">
              No hay otro almacén activo — crea uno en la pantalla Almacenes.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad *</label>
          <input type="number" min="0" step="any" value={quantity}
            onChange={(e) => setQuantity(e.target.value)} className="input" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Ej. reabasto sucursal norte" className="input" />
        </div>

        <p className="text-xs text-gray-500">
          El traspaso es atómico: salida y entrada quedan ligadas en el kardex y el costo
          promedio viaja con la mercancía.
        </p>
      </div>
      <div className="flex justify-end gap-3 p-5 border-t bg-gray-50">
        <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
        <button onClick={handleSave} disabled={saving || targets.length === 0}
          className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
          {saving ? 'Traspasando…' : 'Traspasar'}
        </button>
      </div>
    </ModalShell>
  );
}

function LimitsModal({ row, onClose, onSaved }: {
  row: StockRow; onClose: () => void; onSaved: () => void;
}) {
  const [minimum, setMinimum] = useState(String(row.stock_minimum ?? 0));
  const [maximum, setMaximum] = useState(String(row.stock_maximum ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setError('');
    const mn = Number(minimum); const mx = Number(maximum);
    if (mn < 0 || mx < 0) { setError('Los valores no pueden ser negativos'); return; }
    if (mx > 0 && mx < mn) { setError('El máximo no puede ser menor que el mínimo'); return; }
    setSaving(true);
    try {
      await api.setStockLimits({
        productId: row.product_id,
        warehouseId: row.warehouse_id,
        stockMinimum: mn,
        stockMaximum: mx,
      });
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudieron guardar los límites');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Mínimo y máximo por almacén" onClose={onClose}
      icon={<div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
        <AlertTriangle className="text-amber-700" size={20} /></div>}>
      <div className="p-5 space-y-4">
        {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">{error}</div>}
        <ProductHeader row={row} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mínimo</label>
            <input type="number" min="0" step="any" value={minimum}
              onChange={(e) => setMinimum(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Máximo</label>
            <input type="number" min="0" step="any" value={maximum}
              onChange={(e) => setMaximum(e.target.value)} className="input" />
          </div>
        </div>
        <p className="text-xs text-gray-500">
          El semáforo y las alertas preventivas (próximas fases) usan estos límites por almacén.
        </p>
      </div>
      <div className="flex justify-end gap-3 p-5 border-t bg-gray-50">
        <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </ModalShell>
  );
}
