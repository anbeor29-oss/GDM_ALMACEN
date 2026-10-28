/**
 * Pedidos — tablero de pedidos de la tienda (rebanada 5).
 *
 * Lista los pedidos web; cada uno se puede «Pagar y facturar» (pedido→CFDI→póliza)
 * para cobros fuera de línea. Con Mercado Pago configurado, eso lo hace el webhook
 * al aprobarse el pago; este botón sirve para cerrar a mano.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, Loader2, CheckCircle, Receipt, Truck, X, Save, Package } from 'lucide-react';
import api from '@/services/api';
import { aTextoMx } from '@/components/CampoFecha';

const fmt = (n: any) => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TONO: Record<string, string> = {
  PENDIENTE_PAGO: 'bg-amber-100 text-amber-700',
  PAGADO: 'bg-sky-100 text-sky-700',
  SURTIDO: 'bg-indigo-100 text-indigo-700',
  ENVIADO: 'bg-violet-100 text-violet-700',
  ENTREGADO: 'bg-emerald-100 text-emerald-700',
  FACTURADO: 'bg-emerald-100 text-emerald-700',
  CANCELADO: 'bg-rose-100 text-rose-700',
};

export function PedidosEcPage() {
  const qc = useQueryClient();
  const [procesando, setProcesando] = useState<string>('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [envio, setEnvio] = useState<any | null>(null);   // pedido cuyo envío se actualiza

  const { data, isLoading } = useQuery({ queryKey: ['ec-pedidos'], queryFn: () => api.getPedidosEc() });
  const pedidos: any[] = data?.data?.pedidos || [];

  const pagarFacturar = async (id: string) => {
    setProcesando(id); setMsg(null);
    try {
      const r = await api.pagarYFacturarPedidoEc(id);
      setMsg({ type: 'ok', text: r.message || 'Pedido facturado.' });
      qc.invalidateQueries({ queryKey: ['ec-pedidos'] });
    } catch (e: any) {
      setMsg({ type: 'err', text: e.response?.data?.message || e.message });
    } finally { setProcesando(''); }
  };

  return (
    <div className="p-6 max-w-6xl space-y-4">
      <div className="flex items-center gap-2">
        <ShoppingBag className="text-emerald-600" size={22} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pedidos</h1>
          <p className="text-sm text-gray-500">Pedidos de la tienda. «Pagar y facturar» genera el CFDI y su póliza.</p>
        </div>
      </div>

      {msg && (
        <p className={`text-sm rounded-lg px-3 py-2 ${msg.type === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-rose-50 border border-rose-200 text-rose-700'}`}>{msg.text}</p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16 text-gray-400"><Loader2 className="animate-spin" size={26} /></div>
      ) : pedidos.length === 0 ? (
        <div className="text-center py-16 text-gray-500">Aún no hay pedidos.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase">
                <th className="px-4 py-3">Folio</th>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Factura</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono font-medium text-gray-900">{p.numero}</td>
                  <td className="px-4 py-2.5 text-gray-600">{aTextoMx(p.created_at) || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-700">{p.cliente_nombre}{p.cliente_email ? <span className="text-xs text-gray-400"> · {p.cliente_email}</span> : null}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-gray-900">
                    ${fmt(p.total)} {p.moneda}
                    {Number(p.envio_total) > 0 && (
                      <div className="text-[10px] font-normal text-gray-400">incl. envío ${fmt(p.envio_total)}{p.envio_metodo ? ` · ${p.envio_metodo}` : ''}</div>
                    )}
                    {Number(p.descuento) > 0 && (
                      <div className="text-[10px] font-normal text-emerald-600">cupón {p.cupon_codigo} −${fmt(p.descuento)}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TONO[p.estado] || 'bg-gray-100 text-gray-600'}`}>{p.estado}</span>
                    {p.guia && <div className="text-[10px] text-gray-400 mt-1 flex items-center gap-0.5"><Package size={10} /> {p.paqueteria || 'Guía'} {p.guia}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">
                    {p.invoice_id
                      ? <span className="inline-flex items-center gap-1 text-emerald-700"><Receipt size={13} /> {p.serie || 'FAC'}-{String(p.folio).padStart(6, '0')}{p.cfdi_uuid ? ' ✓' : ' (borrador)'}</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {!p.invoice_id && p.estado !== 'CANCELADO' && (
                      <button onClick={() => pagarFacturar(p.id)} disabled={procesando === p.id}
                        className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg">
                        {procesando === p.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                        Pagar y facturar
                      </button>
                    )}
                    {p.estado !== 'PENDIENTE_PAGO' && p.estado !== 'CANCELADO' && (
                      <button onClick={() => setEnvio(p)}
                        className="inline-flex items-center gap-1.5 ml-1.5 border border-gray-300 text-gray-700 hover:bg-gray-50 text-xs px-3 py-1.5 rounded-lg">
                        <Truck size={14} /> Envío
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {envio && <EnvioPedidoModal pedido={envio} onClose={() => setEnvio(null)}
        onDone={(t) => { setEnvio(null); setMsg({ type: 'ok', text: t }); qc.invalidateQueries({ queryKey: ['ec-pedidos'] }); }} />}
    </div>
  );
}

/* Modal para avanzar el surtido del pedido y capturar la paquetería y la guía. */
function EnvioPedidoModal({ pedido, onClose, onDone }: { pedido: any; onClose: () => void; onDone: (t: string) => void }) {
  const [estado, setEstado] = useState(['SURTIDO', 'ENVIADO', 'ENTREGADO'].includes(pedido.estado) ? pedido.estado : 'SURTIDO');
  const [paqueteria, setPaqueteria] = useState(pedido.paqueteria || '');
  const [guia, setGuia] = useState(pedido.guia || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const guardar = async () => {
    setErr(''); setBusy(true);
    try {
      await api.actualizarEnvioPedidoEc(pedido.id, { estado, paqueteria, guia });
      onDone(`Pedido ${pedido.numero}: envío actualizado a ${estado.toLowerCase()}.`);
    } catch (e: any) { setErr(e?.response?.data?.message || 'No se pudo actualizar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2"><Truck size={18} className="text-gray-600" /><h2 className="font-bold text-gray-900">Envío · {pedido.numero}</h2></div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3">
          {err && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{err}</div>}
          <label className="block">
            <span className="text-xs font-medium text-gray-600 block mb-1">Estado del envío</span>
            <select value={estado} onChange={(e) => setEstado(e.target.value)} className="w-full border border-gray-300 rounded px-3 py-2 text-sm bg-white">
              <option value="SURTIDO">Surtido (preparado)</option>
              <option value="ENVIADO">Enviado (en camino)</option>
              <option value="ENTREGADO">Entregado</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-xs font-medium text-gray-600 block mb-1">Paquetería</span>
              <input value={paqueteria} onChange={(e) => setPaqueteria(e.target.value)} placeholder="DHL, Estafeta…" className="w-full border border-gray-300 rounded px-3 py-2 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-gray-600 block mb-1">Número de guía</span>
              <input value={guia} onChange={(e) => setGuia(e.target.value)} placeholder="1234567890" className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono" /></label>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t bg-slate-50">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50 text-sm">Cancelar</button>
          <button onClick={guardar} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 font-semibold text-sm">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
