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
import { ArrowLeftRight, PlayCircle, AlertTriangle } from 'lucide-react';
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

export default PolizasCobroPago;
