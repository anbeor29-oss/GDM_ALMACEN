/**
 * Pólizas de cobro y pago — el traslado del IVA al cobrar/pagar (plan §2.4 C/E).
 *
 * De cada complemento de pago (tipo P) con XML del mes:
 *   COBRO (emitido):  banco + 209 no cobrado → cliente + 208 cobrado
 *   PAGO (recibido):  proveedor + 118 pagado → banco + 119 por pagar
 * El IVA sale del propio complemento (respeta el de la factura original). Una
 * póliza por complemento; idempotente.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, PlayCircle, AlertTriangle, Wallet } from 'lucide-react';
import { api } from '@/services/api';

const money = (n: any, m = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: (m || 'MXN').trim() || 'MXN' }).format(Number(n) || 0);
const fecha = (s?: string) => s ? new Date(s).toLocaleDateString('es-MX') : '—';
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function PolizasCobroPago() {
  const hoy = new Date();
  const qc = useQueryClient();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [msg, setMsg] = useState('');
  const [omitidas, setOmitidas] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);

  const q = useQuery({ queryKey: ['polizas', anio, mes], queryFn: () => api.getPolizas(anio, mes) });
  const polizas: any[] = (q.data?.data?.polizas || [])
    .filter((p: any) => /^(cobro|pago)/.test(String(p.regla || '')));

  const generar = async () => {
    setBusy(true); setMsg(''); setOmitidas([]);
    try {
      const r: any = await api.generarCobrosPagos(anio, mes);
      setMsg(`${r.data.creadas} póliza(s) de cobro/pago creada(s).`);
      setOmitidas(r.data.omitidas || []);
      qc.invalidateQueries({ queryKey: ['polizas', anio, mes] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo generar'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg shadow border p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2">
          <ArrowLeftRight size={18} className="text-sky-600" /> Pólizas de cobro y pago
        </h3>
        <p className="text-sm text-gray-600">
          Del complemento de pago timbrado: en <b>cobros</b>, banco y el IVA pasa de 209 (no cobrado)
          a 208 (cobrado) contra el cliente; en <b>pagos</b>, el proveedor y el IVA pasa de 119 (por
          pagar) a 118 (pagado) contra el banco. El monto y el IVA salen del propio complemento.
        </p>
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Los <b>pagos</b> necesitan el complemento del proveedor con XML (recibidos suelen venir como
          metadato); sin XML se omiten. Los <b>cobros</b> (que timbramos nosotros) siempre lo tienen.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input py-1.5 text-sm">
            {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input py-1.5 text-sm w-24">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button onClick={generar} disabled={busy}
            className="flex items-center gap-1.5 bg-sky-600 text-white px-3 py-1.5 rounded-lg hover:bg-sky-700 disabled:opacity-50 text-sm">
            <PlayCircle size={15} /> {busy ? 'Generando…' : 'Generar cobros y pagos'}
          </button>
        </div>
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
        {omitidas.length > 0 && (
          <details className="text-xs text-amber-700">
            <summary className="cursor-pointer">{omitidas.length} omitida(s) — ver por qué</summary>
            <ul className="mt-1 list-disc pl-5 space-y-0.5">
              {omitidas.map((o, i) => <li key={i}><b>{o.folio}</b>: {o.motivo}</li>)}
            </ul>
          </details>
        )}
      </div>

      <PagosPue anio={anio} mes={mes} />

      <div className="space-y-2">
        {!q.isLoading && polizas.length === 0 && (
          <p className="text-sm text-gray-500 italic bg-white border rounded-lg p-4 text-center">
            Sin pólizas de cobro/pago en el mes. Genera con el botón de arriba.
          </p>
        )}
        {polizas.map((p) => {
          const cargos = (p.lineas || []).reduce((a: number, l: any) => a + Number(l.cargo || 0), 0);
          const abonos = (p.lineas || []).reduce((a: number, l: any) => a + Number(l.abono || 0), 0);
          return (
            <div key={p.id} className="bg-white border rounded-lg overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50 border-b text-sm">
                <b>#{p.folio}</b>
                <span className="text-gray-500">{fecha(p.fecha)}</span>
                <span className="text-gray-700 truncate">{p.concepto}</span>
                <span className="ml-auto text-[10px] text-gray-400">{p.regla}</span>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {(p.lineas || []).map((l: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-1 font-mono text-gray-500 w-24">{l.codigo}</td>
                      <td className="px-2 py-1">{l.nombre}{l.concepto ? ` · ${l.concepto}` : ''}</td>
                      <td className="px-3 py-1 text-right w-28">{Number(l.cargo) > 0 ? money(l.cargo) : ''}</td>
                      <td className="px-3 py-1 text-right w-28">{Number(l.abono) > 0 ? money(l.abono) : ''}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold bg-gray-50">
                    <td colSpan={2} className="px-3 py-1 text-right">Sumas</td>
                    <td className="px-3 py-1 text-right">{money(cargos)}</td>
                    <td className="px-3 py-1 text-right">{money(abonos)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Pagos de facturas PUE (pagadas en una sola exhibición). Estas no traen
 * complemento de pago, así que el pago no se genera solo: aquí se elige con qué
 * BANCO se pagó cada una (con un solo banco, se preselecciona) y se genera la
 * póliza de pago (201 proveedor / 102 banco + IVA 119→118).
 */
function PagosPue({ anio, mes }: { anio: number; mes: number }) {
  const qc = useQueryClient();
  const [asig, setAsig] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [omitidas, setOmitidas] = useState<any[]>([]);

  const pendQ = useQuery({ queryKey: ['pagos-pue', anio, mes], queryFn: () => api.getPagosPuePendientes(anio, mes) });
  const pend: any[] = pendQ.data?.data?.pendientes || [];
  const bancosQ = useQuery({ queryKey: ['bancos-cuentas'], queryFn: () => api.getCuentasBancarias() });
  const bancos: any[] = (bancosQ.data?.data?.cuentas || [])
    .filter((c: any) => c.cuenta_contable_id && c.tipo !== 'TARJETA_CREDITO');
  const unSolo = bancos.length === 1 ? bancos[0].id : '';
  const bancoDe = (uuid: string) => asig[uuid] || unSolo || bancos[0]?.id || '';

  const generar = async () => {
    setBusy(true); setMsg(''); setOmitidas([]);
    try {
      const asignaciones: Record<string, string> = {};
      for (const p of pend) { const b = bancoDe(p.uuid); if (b) asignaciones[p.uuid] = b; }
      const r: any = await api.generarPagosPue(anio, mes, { asignaciones });
      setMsg(`${r.data.creadas} pago(s) de contado generado(s).`);
      setOmitidas(r.data.omitidas || []);
      qc.invalidateQueries({ queryKey: ['pagos-pue', anio, mes] });
      qc.invalidateQueries({ queryKey: ['polizas', anio, mes] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo generar'); }
    finally { setBusy(false); }
  };

  if (pendQ.isLoading) return null;

  return (
    <div className="bg-white rounded-lg shadow border p-4 space-y-3">
      <h3 className="font-semibold flex items-center gap-2">
        <Wallet size={18} className="text-emerald-600" /> Pagos de facturas de contado (PUE)
      </h3>
      <p className="text-sm text-gray-600">
        Las facturas <b>PUE</b> ya están pagadas pero no traen complemento, así que su pago no se genera
        solo. Elige con qué <b>banco</b> se pagó cada una y se crea la póliza de pago
        (<span className="font-mono text-xs">201 proveedor / 102 banco</span>, con el IVA de 119 a 118).
        Antes deben tener su <b>compra</b> (el pasivo) generada.
      </p>

      {bancos.length === 0 ? (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          No hay cuentas de banco con su cuenta contable (102-xx). Asígnala en <b>Tesorería → Bancos</b> (o en
          Conciliación) para poder generar los pagos.
        </p>
      ) : pend.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No hay facturas PUE pendientes de pago en el mes.</p>
      ) : (
        <>
          {bancos.length > 1 && (
            <p className="text-[11px] text-gray-500">
              Tienes {bancos.length} bancos: elige el correcto en cada renglón (por defecto va el primero).
            </p>
          )}
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold">Fecha</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Folio</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Proveedor</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Total</th>
                  <th className="px-2 py-1.5 text-right font-semibold">IVA</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Banco con que se pagó</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pend.map((p) => (
                  <tr key={p.uuid} className="hover:bg-gray-50">
                    <td className="px-2 py-1 whitespace-nowrap">{fecha(p.fecha)}</td>
                    <td className="px-2 py-1 font-mono">{p.folio}</td>
                    <td className="px-2 py-1 max-w-[220px] truncate" title={p.proveedor}>{p.proveedor}</td>
                    <td className="px-2 py-1 text-right font-mono">{money(p.total)}</td>
                    <td className="px-2 py-1 text-right font-mono text-gray-500">{p.iva ? money(p.iva) : ''}</td>
                    <td className="px-2 py-1">
                      <select value={bancoDe(p.uuid)} onChange={(e) => setAsig((a) => ({ ...a, [p.uuid]: e.target.value }))}
                        className="input py-1 text-xs" disabled={bancos.length === 1}>
                        {bancos.map((b) => <option key={b.id} value={b.id}>{b.alias} · {b.banco_nombre}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={generar} disabled={busy}
              className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm">
              <PlayCircle size={15} /> {busy ? 'Generando…' : `Generar ${pend.length} pago(s)`}
            </button>
            <span className="text-[11px] text-gray-400">Se puede deshacer borrando la póliza si te equivocas de banco.</span>
          </div>
        </>
      )}

      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      {omitidas.length > 0 && (
        <details className="text-xs text-amber-700">
          <summary className="cursor-pointer">{omitidas.length} omitida(s) — ver por qué</summary>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {omitidas.map((o, i) => <li key={i}><b>{o.folio}</b>: {o.motivo}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

export default PolizasCobroPago;
