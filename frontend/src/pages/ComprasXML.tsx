/**
 * ComprasXML — recepción de mercancía a partir del XML del proveedor.
 *
 * Ruta: /compras/xml
 *
 * Es distinto del importador general: aquí SIEMPRE se trata de una compra, así
 * que la pantalla no pregunta si el emisor es cliente o proveedor — lo es.
 *
 * Lo que resuelve en un solo paso:
 *   · Da de alta al proveedor con lo que trae el XML (o lo reconoce si ya está)
 *   · Da de alta los productos que no existan
 *   · Deja elegir el almacén que recibe
 *   · Permite capturar CUÁNTO SE RECIBIÓ, que no siempre es lo facturado
 *   · Registra la factura como cuenta por pagar
 *
 * La diferencia entre lo facturado y lo recibido es el punto delicado: al
 * kardex entra lo contado, pero al proveedor se le debe lo que facturó. Se
 * registran por separado a propósito — juntarlos escondería el faltante.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Upload, FileText, Package, Building2, AlertTriangle,
  CheckCircle2, Loader2, Save,
} from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ComprasXMLPage() {
  const [xmlB64, setXmlB64] = useState('');
  const [archivo, setArchivo] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState<string[]>([]);

  const [warehouseId, setWarehouseId] = useState('');
  const [costingMethod, setCostingMethod] = useState<'PROMEDIO' | 'ULTIMO' | 'CAPAS'>('PROMEDIO');
  const [recibidas, setRecibidas] = useState<Record<number, string>>({});
  const [conceptos, setConceptos] = useState<Set<number>>(new Set());
  const [afectaInventario, setAfectaInventario] = useState(true);

  const { data: almacenes } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.getWarehouses(),
  });

  const leerArchivo = async (f: File) => {
    setError(''); setOk([]); setPreview(null); setCargando(true);
    try {
      const buf = await f.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      setXmlB64(b64); setArchivo(f.name);
      const res = await api.cfdiPreview(b64);
      const p = res.data ?? res;
      setPreview(p);
      // Todos los conceptos entran por default: el caso normal es recibir todo.
      const idx = new Set<number>((p.conceptos || []).map((_: any, i: number) => i));
      setConceptos(idx);
      // Y la cantidad recibida arranca igual a la facturada, para que el
      // almacenista solo corrija los renglones donde hubo diferencia.
      const r: Record<number, string> = {};
      (p.conceptos || []).forEach((c: any, i: number) => { r[i] = String(c.cantidad ?? 0); });
      setRecibidas(r);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'No se pudo leer el XML');
    } finally {
      setCargando(false);
    }
  };

  const guardar = async () => {
    if (!preview) return;
    setGuardando(true); setError(''); setOk([]);
    try {
      const recQty: Record<number, number> = {};
      conceptos.forEach(i => { recQty[i] = Number(recibidas[i] ?? 0); });

      const res = await api.cfdiCommit({
        sha256: preview.sha256,
        xmlBase64: xmlB64,
        selection: {
          party: 'emisor',           // en una compra, el emisor es el proveedor
          partyKind: 'SUPPLIER',
          concept_indexes: Array.from(conceptos),
        },
        productTaxPresetId: 'iva16',
        prefillInvoice: false,       // a un proveedor no se le factura
        receiveInventory: afectaInventario,
        warehouseId: warehouseId || undefined,
        costingMethod,
        receivedQuantities: recQty,
      });
      const d = res.data ?? res;
      const msgs: string[] = [];
      if (d.party) {
        msgs.push(`Proveedor ${d.party.rfc} — ${d.party.business_name} ${d.party.already_existed ? '(ya estaba)' : '(dado de alta)'}`);
      }
      if (d.products?.length) {
        const nuevos = d.products.filter((p: any) => !p.already_existed).length;
        msgs.push(`Productos: ${d.products.length} en total, ${nuevos} nuevos`);
      }
      if (d.inventory) {
        msgs.push(`Entrada al almacén ${d.inventory.warehouseCode}: ${d.inventory.movements} movimiento(s), ${d.inventory.totalUnits} unidades`);
      }
      if (d.payment) {
        msgs.push(`Cuenta por pagar: $${money(d.payment.amount)} con vencimiento ${String(d.payment.dueDate).slice(0, 10)}`);
      }
      setOk(msgs.length ? msgs : ['Compra registrada']);
      setPreview(null); setXmlB64(''); setArchivo('');
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'No se pudo registrar la compra');
    } finally {
      setGuardando(false);
    }
  };

  const cs = preview?.conceptos || [];
  // Renglones donde lo contado no coincide con lo facturado.
  const diferencias = cs
    .map((c: any, i: number) => ({ i, c, rec: Number(recibidas[i] ?? 0) }))
    .filter((x: any) => conceptos.has(x.i) && x.rec !== Number(x.c.cantidad));

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-emerald-100 rounded-lg"><Upload size={24} className="text-emerald-700" /></div>
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Recibir compra desde XML</h1>
          <p className="text-xs text-slate-500">
            Sube la factura del proveedor: se da de alta el proveedor, los productos, la entrada al almacén y la cuenta por pagar.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}
      {ok.length > 0 && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-800">
          <div className="flex items-center gap-2 font-medium mb-1"><CheckCircle2 size={16} /> Compra registrada</div>
          <ul className="list-disc ml-6 space-y-0.5">{ok.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}

      {/* Carga del archivo */}
      {!preview && (
        <label className="block border-2 border-dashed border-slate-300 rounded-lg p-10 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/40">
          <input
            type="file" accept=".xml,text/xml" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) leerArchivo(f); }}
          />
          {cargando ? (
            <span className="inline-flex items-center gap-2 text-slate-500">
              <Loader2 size={18} className="animate-spin" /> Leyendo el XML…
            </span>
          ) : (
            <>
              <FileText size={32} className="mx-auto text-slate-400 mb-2" />
              <p className="text-sm text-slate-600">Da clic para elegir el XML de la factura de tu proveedor</p>
              <p className="text-xs text-slate-400 mt-1">Un archivo a la vez</p>
            </>
          )}
        </label>
      )}

      {preview && (
        <div className="space-y-4">
          {/* Proveedor */}
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Building2 size={16} className="text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-700">Proveedor</h2>
              <span className="text-xs text-slate-400">· del emisor del XML</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><p className="text-xs text-slate-500">RFC</p><p className="font-mono">{preview.emisor?.rfc}</p></div>
              <div className="md:col-span-2"><p className="text-xs text-slate-500">Razón social</p><p>{preview.emisor?.nombre}</p></div>
              <div><p className="text-xs text-slate-500">Factura</p><p className="font-mono">{[preview.serie, preview.folio].filter(Boolean).join('-') || '—'}</p></div>
            </div>
          </div>

          {/* Destino y costeo */}
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Destino de la mercancía</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs text-slate-500">Almacén que recibe</span>
                <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="input mt-1">
                  <option value="">— el almacén por omisión —</option>
                  {(almacenes?.data ?? almacenes ?? []).map((w: any) => (
                    <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Cómo costear esta entrada</span>
                <select value={costingMethod} onChange={e => setCostingMethod(e.target.value as any)} className="input mt-1">
                  <option value="PROMEDIO">Promedio — prorratea con lo que ya hay</option>
                  <option value="ULTIMO">Último — revalúa todo a este precio</option>
                  <option value="CAPAS">Capas — respeta el precio de cada compra</option>
                </select>
              </label>
              <label className="flex items-center gap-2 mt-6">
                <input type="checkbox" checked={afectaInventario} onChange={e => setAfectaInventario(e.target.checked)} />
                <span className="text-sm text-slate-700">Afectar existencias</span>
              </label>
            </div>
            {!afectaInventario && (
              <p className="mt-2 text-xs text-amber-700">
                Con esto apagado se registran proveedor, productos y la cuenta por pagar, pero el inventario no se mueve. Útil para servicios o gastos.
              </p>
            )}
          </div>

          {/* Partidas */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <Package size={16} className="text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-700">Qué llegó</h2>
              <span className="text-xs text-slate-400">· corrige la columna “Recibido” donde no haya coincidido</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2 w-8"></th>
                    <th className="text-left px-3 py-2">Descripción</th>
                    <th className="text-left px-3 py-2">Clave SAT</th>
                    <th className="text-right px-3 py-2">Facturado</th>
                    <th className="text-right px-3 py-2">Recibido</th>
                    <th className="text-right px-3 py-2">P. unitario</th>
                    <th className="text-right px-3 py-2">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {cs.map((c: any, i: number) => {
                    const marcado = conceptos.has(i);
                    const rec = Number(recibidas[i] ?? 0);
                    const dif = rec - Number(c.cantidad);
                    return (
                      <tr key={i} className={`border-t border-slate-100 ${marcado ? '' : 'opacity-40'}`}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox" checked={marcado}
                            onChange={e => setConceptos(s => {
                              const n = new Set(s); e.target.checked ? n.add(i) : n.delete(i); return n;
                            })}
                          />
                        </td>
                        <td className="px-3 py-2">{c.descripcion}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{c.claveSat}</td>
                        <td className="px-3 py-2 text-right font-mono">{c.cantidad}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number" step="0.001" min="0"
                            value={recibidas[i] ?? ''}
                            disabled={!marcado}
                            onChange={e => setRecibidas(s => ({ ...s, [i]: e.target.value }))}
                            className="w-24 px-2 py-1 border border-slate-300 rounded text-right font-mono disabled:bg-slate-50"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono">${money(c.valorUnitario)}</td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold ${
                          !marcado ? 'text-slate-300' : dif === 0 ? 'text-slate-400' : dif < 0 ? 'text-red-600' : 'text-amber-600'
                        }`}>
                          {marcado && dif !== 0 ? (dif > 0 ? `+${dif}` : dif) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Aviso de faltantes */}
          {diferencias.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
              <div className="flex items-center gap-2 font-medium mb-1">
                <AlertTriangle size={16} /> {diferencias.length} partida(s) con diferencia
              </div>
              <p className="text-xs">
                Al almacén entra lo que capturaste como recibido, y la diferencia queda anotada en el kardex.
                La cuenta por pagar se registra por el <b>total facturado</b>: al proveedor se le debe lo que
                facturó, y el faltante se aclara con él por nota de crédito o reposición.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              onClick={() => { setPreview(null); setXmlB64(''); setArchivo(''); }}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
            >Cancelar</button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">{archivo}</span>
              <button
                onClick={guardar}
                disabled={guardando || conceptos.size === 0}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium"
              >
                {guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {guardando ? 'Registrando…' : 'Registrar compra'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ComprasXMLPage;
