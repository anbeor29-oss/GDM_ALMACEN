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
 *   · Deja elegir el almacén que recibe: uno para toda la factura, y otro
 *     distinto en los renglones que se vayan a otra bodega
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
  CheckCircle2, Loader2, Save, Landmark,
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
  const [fallidas, setFallidas] = useState<Array<{ index: number; descripcion: string; motivo: string }>>([]);

  const [warehouseId, setWarehouseId] = useState('');
  /* Destino por renglón. Sólo guarda los que se desviaron: lo que no está aquí
   * entra al almacén de arriba, que es el caso normal. Así una compra que llega
   * completa a una sola bodega no obliga a tocar la columna ni una vez. */
  const [almacenPorPartida, setAlmacenPorPartida] = useState<Record<number, string>>({});
  const [costingMethod, setCostingMethod] = useState<'PROMEDIO' | 'ULTIMO' | 'CAPAS'>('PROMEDIO');
  const [recibidas, setRecibidas] = useState<Record<number, string>>({});
  const [conceptos, setConceptos] = useState<Set<number>>(new Set());
  const [afectaInventario, setAfectaInventario] = useState(true);

  const { data: almacenes } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.getWarehouses(),
  });

  const leerArchivo = async (f: File) => {
    setError(''); setOk([]); setFallidas([]); setPreview(null); setCargando(true);
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
      // Los destinos del XML anterior no aplican a este: si se quedaran, una
      // partida heredaría la bodega de una compra que no tiene nada que ver.
      setAlmacenPorPartida({});
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'No se pudo leer el XML');
    } finally {
      setCargando(false);
    }
  };

  const guardar = async () => {
    if (!preview) return;
    setGuardando(true); setError(''); setOk([]); setFallidas([]);
    try {
      const recQty: Record<number, number> = {};
      conceptos.forEach(i => { recQty[i] = Number(recibidas[i] ?? 0); });

      // Solo los renglones marcados Y desviados. Mandar el destino de una
      // partida que el usuario desmarco haria que el backend validara un
      // almacen que no va a usar.
      const destinos: Record<number, string> = {};
      conceptos.forEach(i => { if (almacenPorPartida[i]) destinos[i] = almacenPorPartida[i]; });

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
        warehouseByConcept: Object.keys(destinos).length ? destinos : undefined,
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
        const reparto = d.inventory.porAlmacen || [];
        if (reparto.length > 1) {
          // Repartida: se nombra cada bodega. Un total unico obligaria a ir a
          // buscar al kardex donde quedo cada cosa.
          msgs.push(
            `Entrada repartida en ${reparto.length} almacenes — ` +
            reparto.map((w: any) => `${w.warehouseCode}: ${w.totalUnits} unidades`).join(' · ')
          );
        } else {
          msgs.push(`Entrada al almacén ${d.inventory.warehouseCode}: ${d.inventory.movements} movimiento(s), ${d.inventory.totalUnits} unidades`);
        }
      } else if (afectaInventario) {
        msgs.push('Sin movimiento de inventario — ninguna partida llegó a producto.');
      }
      if (d.payment) {
        msgs.push(
          d.payment.alreadyExisted
            ? `Cuenta por pagar: ya existía por $${money(d.payment.amount)} — no se duplicó.`
            : `Cuenta por pagar en Tesorería: $${money(d.payment.amount)}, vence ${String(d.payment.dueDate).slice(0, 10)}` +
              (d.payment.creditDays ? ` (${d.payment.creditDays} días de crédito)` : ' (sin días de crédito)')
        );
      }
      setOk(msgs.length ? msgs : ['Compra registrada']);
      // Las partidas que no se pudieron dar de alta se muestran aparte y NO se
      // borran de pantalla al terminar: si se limpian, nadie se entera.
      setFallidas(d.products_failed || []);
      setPreview(null); setXmlB64(''); setArchivo('');
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'No se pudo registrar la compra');
    } finally {
      setGuardando(false);
    }
  };

  const cs = preview?.conceptos || [];
  /* La lista de almacenes, saque la forma que saque la respuesta.
   *
   * `GET /warehouses` contesta { success, data: { warehouses: [...] } } — el
   * arreglo va DOS niveles adentro. El desdoble que había aquí se quedaba en
   * `data`, que es un objeto, y llamarle .map() o .find() truena y deja la
   * pantalla en blanco sin más pista que el error en consola.
   *
   * Se prueban las tres formas y se termina comprobando que sea de verdad un
   * arreglo: si mañana el endpoint cambia, la pantalla se queda sin almacenes
   * que ofrecer, que es molesto pero se puede leer y corregir. Tumbar la
   * página entera no. */
  const rawAlmacenes: any = almacenes;
  const listaAlmacenes: any[] = (() => {
    const c = rawAlmacenes?.data?.warehouses ?? rawAlmacenes?.warehouses
           ?? rawAlmacenes?.data ?? rawAlmacenes;
    return Array.isArray(c) ? c : [];
  })();
  const almacenElegido = listaAlmacenes.find((w: any) => w.id === warehouseId);
  const emisor = preview?.emisor;
  const receptor = preview?.receptor;

  // Renglones donde lo contado no coincide con lo facturado.
  const diferencias = cs
    .map((c: any, i: number) => ({ i, c, rec: Number(recibidas[i] ?? 0) }))
    .filter((x: any) => conceptos.has(x.i) && x.rec !== Number(x.c.cantidad));

  /**
   * Motivos por los que NO se debe registrar esta compra. El backend los
   * rechaza igual; aquí se enseñan antes para no hacer perder el viaje.
   */
  const bloqueos: string[] = [];
  if (preview) {
    if (emisor?.rfc_valido === false) {
      bloqueos.push(`El RFC del proveedor ("${emisor.rfc}") no es válido: ${emisor.rfc_motivo}.`);
    }
    if (emisor?.is_self) {
      bloqueos.push('El emisor de este XML es tu propia empresa: es una factura que TÚ emitiste, no una compra.');
    }
    // El receptor de una compra tiene que ser mi empresa. Si no lo es, o el
    // archivo está equivocado o se subió al módulo que no era.
    if (receptor && !receptor.is_self) {
      bloqueos.push(
        `El receptor de la factura es ${receptor.rfc}${receptor.nombre ? ` (${receptor.nombre})` : ''}, ` +
        'que no es tu empresa. Esta factura no te la emitieron a ti.'
      );
    }
  }

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
      {fallidas.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
          <div className="flex items-center gap-2 font-medium mb-1">
            <AlertTriangle size={16} /> {fallidas.length} partida(s) NO entraron al catálogo
          </div>
          <p className="text-xs mb-2">
            Estas partidas no se dieron de alta como producto y por lo tanto <b>no entraron al almacén</b>.
            La cuenta por pagar sí se registró por el total de la factura. Da de alta el producto a mano
            en Productos y captura la entrada, o corrige el dato que falla y vuelve a subir el XML.
          </p>
          <ul className="space-y-1">
            {fallidas.map((f, i) => (
              <li key={i} className="text-xs border-l-2 border-amber-300 pl-2">
                <b>Partida {f.index + 1}:</b> {f.descripcion}
                <span className="block text-amber-700">{f.motivo}</span>
              </li>
            ))}
          </ul>
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
          {/* Avisos que hay que leer ANTES de guardar */}
          {bloqueos.map((b, i) => (
            <div key={i} className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{b}</span>
            </div>
          ))}
          {preview.already_imported?.yes && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                Este mismo archivo ya se subió el {String(preview.already_imported.ts || '').slice(0, 10)}
                {preview.already_imported.by_user ? ` por ${preview.already_imported.by_user}` : ''}.
                Si lo registras de nuevo, ni las existencias ni la cuenta por pagar se duplican.
              </span>
            </div>
          )}

          {/* Proveedor */}
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Building2 size={16} className="text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-700">Proveedor</h2>
              <span className="text-xs text-slate-400">· del emisor del XML</span>
              {emisor?.exists_in_catalog
                ? <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600">ya registrado</span>
                : <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">se dará de alta</span>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500">RFC</p>
                <p className={`font-mono ${emisor?.rfc_valido === false ? 'text-red-600 font-semibold' : ''}`}>
                  {emisor?.rfc || '—'}
                </p>
                {emisor?.rfc_valido === false
                  ? <p className="text-[11px] text-red-600 mt-0.5">{emisor.rfc_motivo}</p>
                  : <p className="text-[11px] text-emerald-600 mt-0.5">
                      RFC válido{emisor?.rfc_tipo === 'MORAL' ? ' · persona moral'
                                : emisor?.rfc_tipo === 'FISICA' ? ' · persona física' : ''}
                    </p>}
              </div>
              <div className="md:col-span-2">
                <p className="text-xs text-slate-500">Razón social</p>
                <p>{emisor?.nombre || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Factura</p>
                <p className="font-mono">{[preview.serie, preview.folio].filter(Boolean).join('-') || '—'}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Total ${money(preview.total)}
                </p>
              </div>
            </div>
          </div>

          {/* Cuenta por pagar — se explica antes de generarla */}
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Landmark size={16} className="text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-700">Cuenta por pagar</h2>
            </div>
            <p className="text-sm text-slate-600">
              Se programará en Tesorería por <b>${money(preview.total)}</b>
              {emisor?.exists_in_catalog ? (
                Number(emisor.credit_days) > 0
                  ? <> con vencimiento a <b>{emisor.credit_days} días</b> de la fecha de la factura,
                      según el crédito pactado con este proveedor.</>
                  : <> con vencimiento <b>inmediato</b>: este proveedor no tiene días de crédito
                      pactados. Se cambia en su ficha de Proveedores.</>
              ) : (
                <> con vencimiento inmediato. Al ser proveedor nuevo entra con <b>0 días</b> de
                   crédito; ajústalo en su ficha si acordaron plazo.</>
              )}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              El importe es el total de la factura, con impuestos: es lo que se le va a transferir.
            </p>
          </div>

          {/* Destino y costeo */}
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Destino de la mercancía</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs text-slate-500">Almacén que recibe</span>
                <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="input mt-1">
                  <option value="">— el almacén por omisión —</option>
                  {listaAlmacenes.map((w: any) => (
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
                    <th className="text-left px-3 py-2">Entra a</th>
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
                        <td className="px-3 py-2">
                          {c.descripcion}
                          {c.exists_in_catalog
                            ? <span className="block text-[10px] text-slate-400">ya está en el catálogo</span>
                            : <span className="block text-[10px] text-emerald-600">se dará de alta</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{c.clave_sat}</td>
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
                        <td className="px-3 py-2">
                          <select
                            value={almacenPorPartida[i] ?? ''}
                            disabled={!marcado || !afectaInventario}
                            onChange={e => setAlmacenPorPartida(s => {
                              const n = { ...s };
                              // Vacío = "el de la factura". Se BORRA la clave en vez
                              // de guardar '', para que el backend reciba solo los
                              // renglones que de verdad se desviaron.
                              if (e.target.value) n[i] = e.target.value; else delete n[i];
                              return n;
                            })}
                            className="w-40 px-2 py-1 border border-slate-300 rounded text-xs disabled:bg-slate-50 disabled:text-slate-400"
                          >
                            <option value="">
                              {almacenElegido ? `• ${almacenElegido.code}` : '• el de la factura'}
                            </option>
                            {listaAlmacenes.map((w: any) => (
                              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">${money(c.valor_unitario)}</td>
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
                disabled={guardando || conceptos.size === 0 || bloqueos.length > 0}
                title={bloqueos.length > 0 ? bloqueos.join(' ') : undefined}
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
