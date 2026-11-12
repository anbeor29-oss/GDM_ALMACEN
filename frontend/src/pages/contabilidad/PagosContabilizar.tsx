/**
 * PagosContabilizar — las pestañas «Pagos de ventas» (cobro) y «Pago de compras»
 * (pago) del hub de Pólizas. Worklist de las facturas del periodo con su estado
 * de LIQUIDACIÓN (cobrada/pagada) y el botón para contabilizar los cobros/pagos.
 *
 * El asiento lo arma el motor existente (generarCobrosPagos, que procesa los
 * complementos de pago REP) — no se inventa IVA aquí:
 *   Cobro (ventas):  Cargo Banco / Abono Cliente  + Cargo 209 (IVA por pagar) /
 *                    Abono 208 (IVA pagado).
 *   Pago (compras):  Cargo Proveedor / Abono Banco + Cargo 118 (IVA acreditable) /
 *                    Abono 119 (IVA por acreditar).
 * El banco y las cuentas de IVA salen de las Asignaciones del catálogo.
 *
 * Acomodo pedido: Fecha · Folio · Nombre · Subtotal · IVA · Total · 👁 (ver
 * póliza) · estado. SIN UUID y SIN RFC.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, Coins, PlayCircle, RefreshCw, Search, Eye } from 'lucide-react';
import api from '@/services/api';
import { AsientoModal } from '@/components/TablaComprobantesSat';
import { IconoCodificada, IconoPendiente } from './DocsContabilizar';
import { aniosContables } from '@/utils/anios';

const money = (n: any, moneda = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: (moneda || 'MXN').trim() || 'MXN' })
    .format(Number(n) || 0);
const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const fechaCorta = (s?: string) =>
  s ? new Date(s).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const folioDe = (c: any) => [c.serie, c.folio].filter(Boolean).join('-') || '—';
const MESES = ['Todo el año', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
function ivaDe(c: any): number | null {
  if (c.subtotal == null) return null;
  return round2(Number(c.total || 0) - (Number(c.subtotal || 0) - Number(c.descuento || 0)));
}

export function PagosContabilizar({ modo }: { modo: 'cobros' | 'pagos' }) {
  const qc = useQueryClient();
  const cobros = modo === 'cobros';
  const direccion = cobros ? 'emitidos' : 'recibidos';
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState<number>(hoy.getMonth() + 1);
  const [buscar, setBuscar] = useState('');
  const [asiento, setAsiento] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoOn, setAutoOn] = useState(true);
  const anios = aniosContables();
  const claveVista: any[] = ['sat-vista', direccion, anio, mes];
  const autoRef = useRef<string>('');

  const q = useQuery({ queryKey: claveVista, queryFn: () => api.getSatComprobantesVista({ direccion, anio, mes }) });

  const filas = useMemo(() => {
    const todas: any[] = q.data?.data?.comprobantes || [];
    const t = buscar.trim().toLowerCase();
    return todas
      .filter((c) => (c.tipo_comprobante || 'I') === 'I')
      .filter((c) => !t || [c.contraparte_nombre, c.contraparte_rfc, c.folio].some((v) => String(v || '').toLowerCase().includes(t)))
      .sort((a, b) => {
        const fa = String(a.fecha_emision || ''), fb = String(b.fecha_emision || '');
        return fa === fb ? folioDe(a).localeCompare(folioDe(b)) : fa.localeCompare(fb);
      });
  }, [q.data, buscar]);

  const tot = useMemo(() => {
    let sub = 0, iva = 0, total = 0, pend = 0;
    for (const c of filas) {
      sub += Number(c.subtotal || 0); iva += ivaDe(c) || 0; total += Number(c.total || 0);
      if (!c.pagado) pend++;
    }
    return { sub: round2(sub), iva: round2(iva), total: round2(total), pend, n: filas.length };
  }, [filas]);

  const contabilizar = async (silencioso = false) => {
    setBusy(true); if (!silencioso) setMsg('');
    try {
      const r: any = await api.generarCobrosPagos(anio, mes, false, modo);
      const d = r?.data || {};
      const om = (d.omitidas || []) as Array<{ folio: string; motivo: string }>;
      let m = `${d.creadas ?? 0} ${cobros ? 'cobro(s)' : 'pago(s)'} contabilizado(s).`;
      if (om.length) m += ` ${om.length} sin procesar: ${om.slice(0, 3).map((o) => `${o.folio} (${o.motivo})`).join(' · ')}${om.length > 3 ? '…' : ''}.`;
      if (!silencioso || (d.creadas ?? 0) > 0) setMsg(m);
      qc.invalidateQueries({ queryKey: claveVista });
      qc.invalidateQueries({ queryKey: ['polizas'] });
    } catch (e: any) { if (!silencioso) setMsg(e?.response?.data?.message || e?.message || 'No se pudo contabilizar.'); }
    finally { setBusy(false); }
  };

  // Contabiliza en automático al abrir el periodo (idempotente: procesa los
  // complementos de pago que aún no tienen póliza).
  useEffect(() => {
    const key = `${modo}-${anio}-${mes}`;
    if (!autoOn || q.isLoading || busy || autoRef.current === key) return;
    autoRef.current = key; contabilizar(true);
  }, [q.data, q.isLoading, busy, autoOn, modo, anio, mes]); // eslint-disable-line react-hooks/exhaustive-deps

  const Icono = cobros ? Wallet : Coins;
  const chip = cobros ? 'text-emerald-700' : 'text-sky-700';
  const btn = cobros ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                     : 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100';

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Icono className={chip} size={22} />
        <div>
          <h2 className="font-semibold text-gray-900">{cobros ? 'Pagos de ventas (cobro)' : 'Pago de compras'}</h2>
          <p className="text-xs text-gray-500">
            {cobros
              ? 'Cargo a Banco · abono al Cliente · IVA de «por pagar» (209) a «pagado» (208).'
              : 'Cargo al Proveedor · abono a Banco · IVA de «por acreditar» (119) a «acreditable» (118).'}
            {' '}Banco e IVA, de las Asignaciones.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input py-1.5 text-sm">
            {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input py-1.5 text-sm w-24">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)}
              placeholder={cobros ? 'Cliente, RFC…' : 'Proveedor, RFC…'} className="input pl-8 py-1.5 text-sm w-40" />
          </div>
          <button onClick={() => q.refetch()} className="text-gray-500 hover:text-gray-700" title="Actualizar">
            <RefreshCw size={16} className={q.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => contabilizar(false)} disabled={busy}
          className={`inline-flex items-center gap-1.5 border px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 ${btn}`}>
          <PlayCircle size={15} /> {busy ? 'Contabilizando…' : `Contabilizar ${cobros ? 'cobros' : 'pagos'} (complementos)`}
        </button>
        <label className="flex items-center gap-1 text-xs text-gray-500" title="Al abrir el periodo procesa los complementos de pago">
          <input type="checkbox" checked={autoOn} onChange={(e) => setAutoOn(e.target.checked)} /> automático
        </label>
        <span className="text-xs text-gray-500">{tot.n} factura(s) · {tot.pend} por {cobros ? 'cobrar' : 'pagar'} · {tot.n - tot.pend} {cobros ? 'cobrada(s)' : 'pagada(s)'}</span>
        <div className="ml-auto text-xs text-gray-500 flex gap-4">
          <span>Subtotal <b className="text-gray-700 tabular-nums">{money(tot.sub)}</b></span>
          <span>IVA <b className="text-gray-700 tabular-nums">{money(tot.iva)}</b></span>
          <span>Total <b className="text-gray-800 tabular-nums">{money(tot.total)}</b></span>
        </div>
      </div>
      {msg && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-xs font-semibold text-gray-600">
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Folio</th>
              <th className="px-3 py-2 text-left">{cobros ? 'Cliente' : 'Proveedor'}</th>
              <th className="px-3 py-2 text-right">Subtotal</th>
              <th className="px-3 py-2 text-right">IVA</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-center w-16">Póliza</th>
              <th className="px-3 py-2 text-center w-12">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">Cargando…</td></tr>}
            {!q.isLoading && filas.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500 italic">
                Sin facturas {cobros ? 'emitidas' : 'recibidas'} en {mes ? MESES[mes] : 'el año'} {anio}.
              </td></tr>
            )}
            {filas.map((c) => {
              const iva = ivaDe(c);
              const cancelado = String(c.estado_sat || '').toLowerCase() === 'cancelado';
              return (
                <tr key={c.id} className={cancelado ? 'bg-rose-50/40' : 'hover:bg-gray-50'}>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fechaCorta(c.fecha_emision)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">{folioDe(c)}</td>
                  <td className="px-3 py-2"><p className="truncate max-w-[16rem]" title={c.contraparte_nombre}>{c.contraparte_nombre || '—'}</p></td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{c.subtotal != null ? money(c.subtotal, c.moneda) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{iva != null ? money(iva, c.moneda) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{money(c.total, c.moneda)}</td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => setAsiento(c.uuid)} title="Ver / generar el cobro/pago (la póliza)"
                      className="text-gray-300 hover:text-sky-600"><Eye size={17} /></button>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {cancelado
                      ? <span className="text-[11px] text-rose-600" title="Cancelado ante el SAT">Cancelado</span>
                      : c.pagado
                        ? <span title={cobros ? 'Cobrada' : 'Pagada'}><IconoCodificada /></span>
                        : <span title={cobros ? 'Por cobrar' : 'Por pagar'}><IconoPendiente /></span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {filas.length > 0 && (
            <tfoot>
              <tr className="border-t-2 bg-gray-50 font-semibold text-gray-800">
                <td colSpan={3} className="px-3 py-2 text-right text-xs text-gray-500">Sumas del periodo</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(tot.sub)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(tot.iva)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(tot.total)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-[11px] text-gray-400 px-1">
        El <b>ojo</b> abre la póliza del {cobros ? 'cobro' : 'pago'} (y, si es una factura {cobros ? 'PUE' : 'PUE/PPD'} sin
        complemento, deja generarlo con el banco). <IconoCodificada size={13} /> {cobros ? 'cobrada' : 'pagada'} ·
        <IconoPendiente size={13} /> por {cobros ? 'cobrar' : 'pagar'}.
      </p>

      {asiento && <AsientoModal uuid={asiento} onClose={() => setAsiento(null)} claveVista={claveVista} />}
    </div>
  );
}

export default PagosContabilizar;
