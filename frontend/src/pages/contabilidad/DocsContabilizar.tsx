/**
 * DocsContabilizar — la pestaña «Ventas» / «Compras» del hub de Pólizas.
 *
 * Es un WORKLIST de documentos (no de pólizas ya hechas): lista las facturas
 * (tipo I) del periodo —emitidas en «Ventas», recibidas en «Compras»— en
 * acomodo armónico y ORDENADAS por fecha y UUID, con las columnas que pidió el
 * usuario: fecha · UUID · cuenta contable · subtotal · IVA · total, más el
 * estado contable (¿ya tiene póliza?).
 *
 * Desde aquí se CONTABILIZA:
 *   - «Contabilizar pendientes» corre el motor del mes (ventas o compras), que
 *     asienta el devengo (ingreso + cuenta por cobrar / gasto·activo + IVA +
 *     cuenta por pagar). El COBRO/PAGO que cancela esa cuenta vive en su propia
 *     pestaña («Pagos de ventas» / «Pago de compras»).
 *   - Doble clic en un renglón abre su asiento (y, si es PUE/PPD sin pago, deja
 *     generarlo ahí mismo) — reutiliza el modal de la vista de comprobantes.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, ShoppingCart, PlayCircle, RefreshCw, Search, CheckCircle2, Clock, Pencil, Check } from 'lucide-react';
import api from '@/services/api';
import { AsientoModal } from '@/components/TablaComprobantesSat';
import { aniosContables } from '@/utils/anios';

const money = (n: any, moneda = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: (moneda || 'MXN').trim() || 'MXN' })
    .format(Number(n) || 0);
const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const fechaCorta = (s?: string) =>
  s ? new Date(s).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const uuidCorto = (u?: string) => u ? `${u.slice(0, 8)}…${u.slice(-4)}` : '—';
const folioDe = (c: any) => [c.serie, c.folio].filter(Boolean).join('-') || '—';
const MESES = ['Todo el año', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** IVA derivado del documento: total − (subtotal − descuento). NULL si no hay subtotal. */
function ivaDe(c: any): number | null {
  if (c.subtotal == null) return null;
  return round2(Number(c.total || 0) - (Number(c.subtotal || 0) - Number(c.descuento || 0)));
}

export function DocsContabilizar({ modo }: { modo: 'ventas' | 'compras' }) {
  const qc = useQueryClient();
  const ventas = modo === 'ventas';
  const direccion = ventas ? 'emitidos' : 'recibidos';
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState<number>(hoy.getMonth() + 1);
  const [buscar, setBuscar] = useState('');
  const [asiento, setAsiento] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const anios = aniosContables();
  const claveVista: any[] = ['sat-vista', direccion, anio, mes];

  const q = useQuery({
    queryKey: claveVista,
    queryFn: () => api.getSatComprobantesVista({ direccion, anio, mes }),
  });

  // Sólo FACTURAS (tipo I): las notas de crédito y los complementos de pago tienen
  // su propio tratamiento. Orden pedido: por fecha y, dentro del día, por UUID.
  const filas = useMemo(() => {
    const todas: any[] = q.data?.data?.comprobantes || [];
    const t = buscar.trim().toLowerCase();
    return todas
      .filter((c) => (c.tipo_comprobante || 'I') === 'I')
      .filter((c) => !t || [c.contraparte_nombre, c.contraparte_rfc, c.folio, c.uuid, c.cuenta_contable]
        .some((v) => String(v || '').toLowerCase().includes(t)))
      .sort((a, b) => {
        const fa = String(a.fecha_emision || ''), fb = String(b.fecha_emision || '');
        return fa === fb ? String(a.uuid).localeCompare(String(b.uuid)) : fa.localeCompare(fb);
      });
  }, [q.data, buscar]);

  const tot = useMemo(() => {
    let sub = 0, iva = 0, total = 0, pend = 0;
    for (const c of filas) {
      sub += Number(c.subtotal || 0);
      iva += ivaDe(c) || 0;
      total += Number(c.total || 0);
      if (!c.contabilizado) pend++;
    }
    return { sub: round2(sub), iva: round2(iva), total: round2(total), pend, n: filas.length };
  }, [filas]);

  const contabilizar = async () => {
    setBusy(true); setMsg('');
    try {
      const r: any = ventas ? await api.generarVentas(anio, mes) : await api.generarCompras(anio, mes);
      const d = r?.data || {};
      const om = (d.omitidas || []) as Array<{ folio: string; motivo: string }>;
      let m = `${d.creadas ?? 0} póliza(s) generada(s).`;
      if (ventas && d.cobrosPue) m += ` ${d.cobrosPue} cobro(s) PUE.`;
      if (!ventas && d.pagosPue) m += ` ${d.pagosPue} pago(s) PUE.`;
      if (om.length) m += ` ${om.length} omitida(s): ${om.slice(0, 3).map((o) => `${o.folio} (${o.motivo})`).join(' · ')}${om.length > 3 ? '…' : ''}.`;
      setMsg(m);
      qc.invalidateQueries({ queryKey: claveVista });
      qc.invalidateQueries({ queryKey: ['polizas'] });
    } catch (e: any) { setMsg(e?.response?.data?.message || e?.message || 'No se pudo contabilizar.'); }
    finally { setBusy(false); }
  };

  const Color = ventas
    ? { ic: TrendingUp, chip: 'text-emerald-700', btn: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' }
    : { ic: ShoppingCart, chip: 'text-sky-700', btn: 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100' };
  const Icono = Color.ic;

  return (
    <div className="space-y-4">
      {/* Encabezado: título + periodo */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Icono className={Color.chip} size={22} />
        <div>
          <h2 className="font-semibold text-gray-900">{ventas ? 'Ventas' : 'Compras'} del periodo</h2>
          <p className="text-xs text-gray-500">
            {ventas ? 'Facturas emitidas' : 'Facturas recibidas'} — devengo del {ventas ? 'ingreso y la cuenta por cobrar' : 'gasto/activo, el IVA y la cuenta por pagar'}.
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
              placeholder={ventas ? 'Cliente, RFC, UUID…' : 'Proveedor, RFC, UUID…'}
              className="input pl-8 py-1.5 text-sm w-44" />
          </div>
          <button onClick={() => q.refetch()} className="text-gray-500 hover:text-gray-700" title="Actualizar">
            <RefreshCw size={16} className={q.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Acción + resumen */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={contabilizar} disabled={busy || tot.pend === 0}
          title="Corre el motor del mes: asienta el devengo de las facturas que aún no tienen póliza"
          className={`inline-flex items-center gap-1.5 border px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 ${Color.btn}`}>
          <PlayCircle size={15} /> {busy ? 'Contabilizando…' : `Contabilizar pendientes${tot.pend ? ` (${tot.pend})` : ''}`}
        </button>
        <span className="text-xs text-gray-500">
          {tot.n} factura(s) · {tot.pend} pendiente(s) · {tot.n - tot.pend} contabilizada(s)
        </span>
        <div className="ml-auto text-xs text-gray-500 flex gap-4">
          <span>Subtotal <b className="text-gray-700 tabular-nums">{money(tot.sub)}</b></span>
          <span>IVA <b className="text-gray-700 tabular-nums">{money(tot.iva)}</b></span>
          <span>Total <b className="text-gray-800 tabular-nums">{money(tot.total)}</b></span>
        </div>
      </div>
      {msg && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>}

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-xs font-semibold text-gray-600">
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Folio</th>
              <th className="px-3 py-2 text-left">{ventas ? 'Cliente' : 'Proveedor'}</th>
              <th className="px-3 py-2 text-left">UUID</th>
              <th className="px-3 py-2 text-left">Cuenta</th>
              <th className="px-3 py-2 text-right">Subtotal</th>
              <th className="px-3 py-2 text-right">IVA</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-center w-32">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && filas.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-500 italic">
                Sin facturas {ventas ? 'emitidas' : 'recibidas'} en {mes ? MESES[mes] : 'el año'} {anio}.
              </td></tr>
            )}
            {filas.map((c) => {
              const iva = ivaDe(c);
              const cancelado = String(c.estado_sat || '').toLowerCase() === 'cancelado';
              return (
                <tr key={c.id} onDoubleClick={() => setAsiento(c.uuid)}
                  title="Doble clic para ver / generar su asiento contable"
                  className={`${cancelado ? 'bg-rose-50/40' : 'hover:bg-gray-50'} cursor-pointer`}>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fechaCorta(c.fecha_emision)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">{folioDe(c)}</td>
                  <td className="px-3 py-2"><p className="truncate max-w-[14rem]" title={c.contraparte_nombre}>{c.contraparte_nombre || '—'}</p></td>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-500" title={c.uuid}>{uuidCorto(c.uuid)}</td>
                  <td className="px-3 py-2"><CuentaCell id={c.id} valor={c.cuenta_contable} claveVista={claveVista} /></td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{c.subtotal != null ? money(c.subtotal, c.moneda) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{iva != null ? money(iva, c.moneda) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{money(c.total, c.moneda)}</td>
                  <td className="px-3 py-2 text-center">
                    {cancelado ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-rose-600">Cancelado</span>
                    ) : c.contabilizado ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        <CheckCircle2 size={12} /> Contabilizada
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                        <Clock size={12} /> Pendiente
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {filas.length > 0 && (
            <tfoot>
              <tr className="border-t-2 bg-gray-50 font-semibold text-gray-800">
                <td colSpan={5} className="px-3 py-2 text-right text-xs text-gray-500">Sumas del periodo</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(tot.sub)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(tot.iva)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(tot.total)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-[11px] text-gray-400 px-1">
        Orden por fecha y UUID. <b>Doble clic</b> en un renglón abre su asiento (la póliza); el
        {ventas ? ' cobro' : ' pago'} que cancela la cuenta por {ventas ? 'cobrar' : 'pagar'} se hace en la pestaña
        «{ventas ? 'Pagos de ventas' : 'Pago de compras'}».
      </p>

      {asiento && (
        <AsientoModal uuid={asiento} onClose={() => setAsiento(null)} claveVista={claveVista} />
      )}
    </div>
  );
}

/** Celda de cuenta contable editable en línea (asigna la CC del comprobante). */
function CuentaCell({ id, valor, claveVista }: { id: string; valor?: string | null; claveVista: any[] }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(valor || '');
  const [guardando, setGuardando] = useState(false);
  const guardar = async () => {
    setGuardando(true);
    try {
      await api.setSatCuentaContable(id, texto.trim() || null);
      qc.invalidateQueries({ queryKey: claveVista });
      setEditando(false);
    } finally { setGuardando(false); }
  };
  if (editando) {
    return (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(false); }}
          placeholder="Cuenta" className="input py-1 text-xs w-24" />
        <button onClick={guardar} disabled={guardando} className="text-emerald-600 hover:text-emerald-700"><Check size={15} /></button>
      </div>
    );
  }
  return (
    <button onClick={(e) => { e.stopPropagation(); setTexto(valor || ''); setEditando(true); }}
      className="group flex items-center gap-1 text-sm text-gray-700 hover:text-gray-900" title="Asignar cuenta contable">
      {valor ? <span className="font-mono text-xs">{valor}</span>
             : <span className="text-gray-300 group-hover:text-gray-500 text-xs">— asignar</span>}
      <Pencil size={11} className="opacity-0 group-hover:opacity-100 text-gray-400" />
    </button>
  );
}

export default DocsContabilizar;
