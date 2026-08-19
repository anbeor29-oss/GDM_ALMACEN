/**
 * Faltantes — qué hay que comprar, antes de generar nada.
 *
 * Se listan los productos agotados o bajo mínimo, se marcan los que se van a
 * pedir, se ajusta la cantidad, y se generan las órdenes.
 *
 * POR QUÉ SE PIDE CONFIRMAR Y NO SE GENERA SOLO
 * `reorder-check` ya existía y crea las órdenes de un golpe, lo que obliga a
 * confiar a ciegas en el análisis. Quien compra sabe cosas que el sistema no:
 * que un proveedor está en huelga, que ese producto ya no se va a manejar, que
 * conviene esperar a la quincena. Ver la lista y decidir es el paso que faltaba.
 *
 * SE AGRUPA POR ALMACÉN Y PROVEEDOR
 * Una orden es a UN proveedor y para UN almacén: así se emite. Agrupar en la
 * pantalla evita que alguien marque diez renglones y se pregunte por qué
 * salieron cuatro órdenes.
 */
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageX, Loader2, AlertTriangle, ShoppingCart } from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cant = (n: any) =>
  Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 3 });

const ETIQUETA: Record<string, { texto: string; clase: string }> = {
  agotado:    { texto: 'Agotado',       clase: 'bg-rose-100 text-rose-800' },
  bajo:       { texto: 'Bajo mínimo',   clase: 'bg-amber-100 text-amber-800' },
  /* El escalón de aviso: todavía por encima del mínimo, pero ya llegando.
   * Va en amarillo claro y no en ámbar para que se distinga de un faltante
   * real de un vistazo — si los dos se ven igual, el aviso deja de avisar. */
  cerca:      { texto: 'Llegando al mínimo', clase: 'bg-yellow-100 text-yellow-800' },
  proyectado: { texto: 'Se agotará',    clase: 'bg-sky-100 text-sky-800' },
};

/** Clave de agrupación: una orden es a un proveedor y para un almacén. */
const claveGrupo = (f: any) => `${f.warehouse_id}||${f.supplier_id || 'sin-proveedor'}`;

export function FaltantesPage() {
  const qc = useQueryClient();
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [generando, setGenerando] = useState(false);

  const q = useQuery({ queryKey: ['faltantes'], queryFn: () => api.getFaltantes() });
  const filas: any[] = (q.data as any)?.data?.faltantes ?? [];

  /** Id de renglón: producto + almacén, que es lo que hace único al faltante. */
  const idFila = (f: any) => `${f.warehouse_id}|${f.product_id}`;

  const grupos = useMemo(() => {
    const m = new Map<string, { warehouse: any; supplier: any; filas: any[] }>();
    for (const f of filas) {
      const k = claveGrupo(f);
      if (!m.has(k)) {
        m.set(k, {
          warehouse: { id: f.warehouse_id, code: f.warehouse_code, name: f.warehouse_name },
          supplier: f.supplier_id
            ? { id: f.supplier_id, name: f.supplier_name, rfc: f.supplier_rfc }
            : null,
          filas: [],
        });
      }
      m.get(k)!.filas.push(f);
    }
    return Array.from(m.entries());
  }, [filas]);

  const cantidadDe = (f: any) => {
    const v = cantidades[idFila(f)];
    if (v !== undefined) return Number(v) || 0;
    return Number(f.sugerido) || 0;
  };

  const seleccionados = filas.filter(f => marcados[idFila(f)] && cantidadDe(f) > 0);

  const generar = async () => {
    setError(''); setMsg(''); setGenerando(true);
    try {
      /* Se agrupa por almacén + proveedor y se emite una orden por grupo. Lo
       * hace la pantalla y no el backend porque es la pantalla la que sabe qué
       * marcó el usuario; el endpoint de alta ya recibe una orden a la vez. */
      const porGrupo = new Map<string, any[]>();
      for (const f of seleccionados) {
        const k = claveGrupo(f);
        if (!porGrupo.has(k)) porGrupo.set(k, []);
        porGrupo.get(k)!.push(f);
      }

      const creadas: string[] = [];
      const fallidas: string[] = [];
      for (const [, fs] of porGrupo) {
        try {
          const r: any = await api.createPurchaseOrder({
            warehouseId: fs[0].warehouse_id,
            supplierId: fs[0].supplier_id || undefined,
            items: fs.map(f => ({ productId: f.product_id, quantity: cantidadDe(f) })),
            notes: 'Generada desde Faltantes',
          });
          creadas.push((r?.data?.folio) || (r?.folio) || '—');
        } catch (e: any) {
          /* Una orden que falla no cancela las demás: si el proveedor A tiene
           * un problema, no hay razón para que el pedido al proveedor B se
           * quede sin hacer. Se reporta cuál falló. */
          fallidas.push(`${fs[0].warehouse_code}/${fs[0].supplier_name || 'sin proveedor'}: ${e?.response?.data?.message || e.message}`);
        }
      }

      if (creadas.length) setMsg(`Se generaron ${creadas.length} orden(es): ${creadas.join(', ')}`);
      if (fallidas.length) setError(`No se pudieron generar: ${fallidas.join(' · ')}`);
      setMarcados({});
      qc.invalidateQueries({ queryKey: ['faltantes'] });
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    } finally {
      setGenerando(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1200px] p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-rose-100 rounded-lg"><PackageX size={22} className="text-rose-700" /></div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Faltantes</h1>
          <p className="text-sm text-slate-500">
            Agotados, bajo mínimo, y los que ya están llegando. Marca lo que vas a pedir.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}
      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded text-sm">{msg}</div>
      )}

      {q.isLoading && <p className="text-center text-slate-400 py-10"><Loader2 className="inline animate-spin" size={18} /> Revisando existencias…</p>}

      {!q.isLoading && filas.length === 0 && (
        <div className="text-center py-12">
          <p className="text-slate-500">No hay faltantes. Todo está por encima del mínimo.</p>
          {/* Si nadie configuró mínimos, esta pantalla puede verse vacía aunque
              haya productos por acabarse. Decirlo evita la falsa tranquilidad. */}
          <p className="text-xs text-slate-400 mt-2">
            Se listan los agotados, los que están en o bajo su mínimo, y los que
            andan hasta 2 unidades arriba — el aviso temprano, porque el proveedor
            no entrega el mismo día. Si un producto
            debería aparecer, revisa su mínimo en Existencias.
          </p>
        </div>
      )}

      {grupos.map(([clave, g]) => (
        <div key={clave} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-800">{g.warehouse.code} · {g.warehouse.name}</p>
              <p className="text-xs text-slate-500">
                {g.supplier
                  ? <>Proveedor habitual: <b>{g.supplier.name}</b> <span className="font-mono">{g.supplier.rfc}</span></>
                  : <span className="text-amber-700">Sin proveedor habitual — la orden saldrá sin proveedor asignado</span>}
              </p>
            </div>
            <button
              onClick={() => {
                const todos = g.filas.every(f => marcados[idFila(f)]);
                setMarcados(s => {
                  const n = { ...s };
                  g.filas.forEach(f => { n[idFila(f)] = !todos; });
                  return n;
                });
              }}
              className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50"
            >
              Marcar todo
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  <th className="text-left px-3 py-2">Producto</th>
                  <th className="text-left px-3 py-2">Situación</th>
                  <th className="text-right px-3 py-2">Existencia</th>
                  <th className="text-right px-3 py-2">Mínimo</th>
                  <th className="text-right px-3 py-2">Pedir</th>
                  <th className="text-right px-3 py-2">Último precio</th>
                </tr>
              </thead>
              <tbody>
                {g.filas.map((f) => {
                  const id = idFila(f);
                  const et = ETIQUETA[f.situacion] || ETIQUETA.proyectado;
                  return (
                    <tr key={id} className={`border-t border-slate-100 ${f.ya_pedido ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={!!marcados[id]}
                          onChange={(e) => setMarcados(s => ({ ...s, [id]: e.target.checked }))} />
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs text-slate-500 mr-2">{f.sku}</span>
                        {f.product_name}
                        {/* Avisar de la orden abierta es la diferencia entre
                            pedir de más y no pedir. Se marca en el renglón, no
                            en una nota al pie que nadie lee. */}
                        {f.ya_pedido && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                            ya hay orden abierta
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${et.clase}`}>{et.texto}</span>
                        {f.days_to_minimum != null && f.situacion === 'proyectado' && (
                          <span className="ml-2 text-xs text-slate-500">en {Math.round(Number(f.days_to_minimum))} días</span>
                        )}
                        {/* Cuánto le falta para tocar el mínimo. "Llegando" sin
                            número no dice si faltan dos piezas o veinte. */}
                        {f.situacion === 'cerca' && Number(f.sobre_el_minimo) > 0 && (
                          <span className="ml-2 text-xs text-slate-500">
                            {cant(f.sobre_el_minimo)} arriba del mínimo
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{cant(f.quantity)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-500">{cant(f.stock_minimum)}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number" min="0" step="0.001"
                          value={cantidades[id] ?? String(Number(f.sugerido) || '')}
                          onChange={(e) => setCantidades(s => ({ ...s, [id]: e.target.value }))}
                          className="w-24 px-2 py-1 border border-slate-300 rounded text-right font-mono"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-500">
                        {f.last_price ? `$${money(f.last_price)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {filas.length > 0 && (
        <div className="sticky bottom-0 bg-white border-t border-slate-200 py-3 flex items-center justify-between">
          <p className="text-sm text-slate-600">
            {seleccionados.length === 0
              ? 'Marca los productos que vas a pedir.'
              : <>Se generarán <b>{new Set(seleccionados.map(claveGrupo)).size}</b> orden(es) con <b>{seleccionados.length}</b> producto(s).</>}
          </p>
          <button
            onClick={generar}
            disabled={seleccionados.length === 0 || generando}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium"
          >
            {generando ? <Loader2 size={16} className="animate-spin" /> : <ShoppingCart size={16} />}
            {generando ? 'Generando…' : 'Generar órdenes de compra'}
          </button>
        </div>
      )}
    </div>
  );
}

export default FaltantesPage;
