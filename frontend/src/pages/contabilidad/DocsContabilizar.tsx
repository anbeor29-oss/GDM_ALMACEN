/**
 * DocsContabilizar — la pestaña «Ventas» / «Compras» del hub de Pólizas.
 *
 * Worklist de las facturas (tipo I) del periodo, ORDENADO por fecha y folio, en
 * el acomodo pedido por el usuario:
 *   Fecha · Folio · Nombre (cliente/proveedor) · Cuenta · [2ª cuenta] ·
 *   Subtotal · IVA · Total · 👁 (ver póliza) · estado (codificada/pendiente).
 *
 * Asiento (lo arma el motor; aquí se capturan las cuentas variables en combos del
 * catálogo y se contabiliza):
 *   Ventas  → Cargo CLIENTE (combo 105) · Abono Ingreso (fija) · Abono IVA por
 *             pagar (fija, de las asignaciones).
 *   Compras → Cargo GASTO/COMPRA/ACTIVO (combo, 2ª cuenta) · Cargo IVA por
 *             acreditar (fija) · Abono PROVEEDOR (combo, 1ª cuenta).
 *
 * Las cuentas capturadas MANDAN: el motor prefiere la cuenta del combo sobre su
 * resolución automática. «Que se vayan contabilizando en automático»: al cargar
 * el periodo corre el motor (idempotente) y deja PENDIENTES sólo las de cuenta
 * desconocida.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, ShoppingCart, PlayCircle, RefreshCw, Search, Eye } from 'lucide-react';
import api from '@/services/api';
import { AsientoModal } from '@/components/TablaComprobantesSat';
import { aniosContables } from '@/utils/anios';
import { confirmar } from '@/utils/avisos';

const money = (n: any, moneda = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: (moneda || 'MXN').trim() || 'MXN' })
    .format(Number(n) || 0);
const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const fechaCorta = (s?: string) =>
  s ? new Date(s).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const folioDe = (c: any) => [c.serie, c.folio].filter(Boolean).join('-') || '—';
const MESES = ['Todo el año', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** IVA derivado del documento: total − (subtotal − descuento). NULL si no hay subtotal. */
function ivaDe(c: any): number | null {
  if (c.subtotal == null) return null;
  return round2(Number(c.total || 0) - (Number(c.subtotal || 0) - Number(c.descuento || 0)));
}

/* ── Íconos de estado, diseñados a juego con los de comprobantes (documento) ──
 * Codificada: documento con sello de verificación (verde). Pendiente: documento
 * con puntos suspensivos (ámbar) = «aún por asentar». */
export function IconoCodificada({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="m9 14.5 1.8 1.8L15 12.5" />
    </svg>
  );
}
export function IconoPendiente({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <circle cx="9" cy="15.5" r=".6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="15.5" r=".6" fill="currentColor" stroke="none" />
      <circle cx="15" cy="15.5" r=".6" fill="currentColor" stroke="none" />
    </svg>
  );
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
  const [autoOn, setAutoOn] = useState(true);
  const anios = aniosContables();
  const claveVista: any[] = ['sat-vista', direccion, anio, mes];
  const autoRef = useRef<string>('');

  const q = useQuery({
    queryKey: claveVista,
    queryFn: () => api.getSatComprobantesVista({ direccion, anio, mes }),
  });

  // Catálogo de movimientos para los combos. El combo despliega el catálogo:
  // clientes (agrupador 105), proveedores (201/205) y, para la 2ª cuenta de
  // compras, TODO el catálogo (gasto/compra/activo/costo).
  const ctasQ = useQuery({ queryKey: ['ctas-mov'], queryFn: () => api.getCuentasContables() });
  const ctas = useMemo(() => {
    const all: any[] = (ctasQ.data?.data?.cuentas || []).filter((c: any) => c.permite_movimientos);
    const opt = (c: any) => ({ codigo: c.codigo, nombre: c.nombre });
    const fam = (prefs: string[]) => {
      const f = all.filter((c: any) => prefs.some((p) => String(c.codigo_agrupador || '').startsWith(p)));
      return (f.length ? f : all).map(opt);
    };
    return { cliente: fam(['105']), proveedor: fam(['201', '205']), gasto: all.map(opt) };
  }, [ctasQ.data]);

  // Sólo FACTURAS (tipo I). Orden pedido: por fecha y, dentro del día, por folio.
  const filas = useMemo(() => {
    const todas: any[] = q.data?.data?.comprobantes || [];
    const t = buscar.trim().toLowerCase();
    return todas
      .filter((c) => (c.tipo_comprobante || 'I') === 'I')
      .filter((c) => !t || [c.contraparte_nombre, c.contraparte_rfc, c.folio, c.cuenta_contable]
        .some((v) => String(v || '').toLowerCase().includes(t)))
      .sort((a, b) => {
        const fa = String(a.fecha_emision || ''), fb = String(b.fecha_emision || '');
        return fa === fb ? folioDe(a).localeCompare(folioDe(b)) : fa.localeCompare(fb);
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

  const contabilizar = async (silencioso = false) => {
    setBusy(true); if (!silencioso) setMsg('');
    try {
      const r: any = ventas ? await api.generarVentas(anio, mes) : await api.generarCompras(anio, mes);
      const d = r?.data || {};
      const om = (d.omitidas || []) as Array<{ folio: string; motivo: string }>;
      let m = `${d.creadas ?? 0} póliza(s) generada(s).`;
      if (ventas && d.cobrosPue) m += ` ${d.cobrosPue} cobro(s) PUE.`;
      if (!ventas && d.pagosPue) m += ` ${d.pagosPue} pago(s) PUE.`;
      if (om.length) m += ` ${om.length} pendiente(s) por cuenta: ${om.slice(0, 3).map((o) => `${o.folio} (${o.motivo})`).join(' · ')}${om.length > 3 ? '…' : ''}.`;
      if (!silencioso || (d.creadas ?? 0) > 0) setMsg(m);
      qc.invalidateQueries({ queryKey: claveVista });
      qc.invalidateQueries({ queryKey: ['polizas'] });
      qc.invalidateQueries({ queryKey: ['asiento'] });
    } catch (e: any) { if (!silencioso) setMsg(e?.response?.data?.message || e?.message || 'No se pudo contabilizar.'); }
    finally { setBusy(false); }
  };

  // Si una factura sale «codificada» pero su póliza no aparece (está ligada a un
  // respaldo de OTRO periodo), esto DESLIGA ese respaldo y la recodifica en el mes.
  const recodificar = async () => {
    if (!(await confirmar('Esto DESLIGA el enlace de respaldo de las facturas del mes que NO tienen póliza propia y las recodifica en el periodo. No borra ninguna póliza existente. ¿Continuar?'))) return;
    setBusy(true); setMsg('');
    try {
      const r: any = await api.recodificarPeriodo(anio, mes, modo);
      const d = r?.data || {};
      let m = `Recodificado: ${d.desligados ?? 0} desligada(s), ${d.creadas ?? 0} póliza(s) generada(s).`;
      if (d.omitidas?.length) m += ` ${d.omitidas.length} pendiente(s): ${d.omitidas.slice(0, 2).map((o: any) => `${o.folio} (${o.motivo})`).join(' · ')}${d.omitidas.length > 2 ? '…' : ''}.`;
      setMsg(m);
      qc.invalidateQueries({ queryKey: claveVista });
      qc.invalidateQueries({ queryKey: ['polizas'] });
      qc.invalidateQueries({ queryKey: ['asiento'] });
    } catch (e: any) { setMsg(e?.response?.data?.message || e?.message || 'No se pudo recodificar.'); }
    finally { setBusy(false); }
  };

  // «Que se vayan contabilizando en automático»: una corrida por periodo cuando
  // hay pendientes (el motor es idempotente; deja fuera las de cuenta desconocida).
  useEffect(() => {
    const key = `${modo}-${anio}-${mes}`;
    if (!autoOn || q.isLoading || busy || autoRef.current === key) return;
    if (tot.pend > 0) { autoRef.current = key; contabilizar(true); }
  }, [q.data, tot.pend, q.isLoading, busy, autoOn, modo, anio, mes]); // eslint-disable-line react-hooks/exhaustive-deps

  const Icono = ventas ? TrendingUp : ShoppingCart;
  const chip = ventas ? 'text-emerald-700' : 'text-sky-700';
  const btn = ventas ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                     : 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100';
  const nCols = ventas ? 9 : 10;   // columnas de la tabla (para el colSpan de vacío/carga)
  const preSpan = ventas ? 4 : 5;  // columnas antes de «Subtotal» (para el pie de sumas)

  return (
    <div className="space-y-4">
      {/* Encabezado + periodo */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Icono className={chip} size={22} />
        <div>
          <h2 className="font-semibold text-gray-900">{ventas ? 'Ventas' : 'Compras'} del periodo</h2>
          <p className="text-xs text-gray-500">
            {ventas ? 'Cargo al cliente · abono a ingreso e IVA por pagar.' : 'Cargo a gasto/compra/activo e IVA por acreditar · abono al proveedor.'}
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
              placeholder={ventas ? 'Cliente, RFC…' : 'Proveedor, RFC…'}
              className="input pl-8 py-1.5 text-sm w-40" />
          </div>
          <button onClick={() => q.refetch()} className="text-gray-500 hover:text-gray-700" title="Actualizar">
            <RefreshCw size={16} className={q.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Acción + resumen */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => contabilizar(false)} disabled={busy}
          className={`inline-flex items-center gap-1.5 border px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 ${btn}`}>
          <PlayCircle size={15} /> {busy ? 'Generando pólizas…' : `Generar pólizas${tot.pend ? ` (${tot.pend} pend.)` : ''}`}
        </button>
        <label className="flex items-center gap-1 text-xs text-gray-500" title="Al abrir el periodo, contabiliza solo las que tengan cuenta conocida">
          <input type="checkbox" checked={autoOn} onChange={(e) => setAutoOn(e.target.checked)} /> automático
        </label>
        <button onClick={recodificar} disabled={busy}
          title="¿La factura sale «codificada» pero el ojo no muestra su póliza? Está ligada a un respaldo de otro periodo. Esto la desliga y la recodifica en el mes."
          className="text-xs border border-amber-300 bg-amber-50 text-amber-700 px-2.5 py-1.5 rounded-lg hover:bg-amber-100 disabled:opacity-40">
          Recodificar respaldo
        </button>
        <span className="text-xs text-gray-500">{tot.n} factura(s) · {tot.pend} pendiente(s) · {tot.n - tot.pend} codificada(s)</span>
        <div className="ml-auto text-xs text-gray-500 flex gap-4">
          <span>Subtotal <b className="text-gray-700 tabular-nums">{money(tot.sub)}</b></span>
          <span>IVA <b className="text-gray-700 tabular-nums">{money(tot.iva)}</b></span>
          <span>Total <b className="text-gray-800 tabular-nums">{money(tot.total)}</b></span>
        </div>
      </div>
      {msg && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>}

      {/* Tabla — acomodo: Fecha · Folio · Nombre · Cuenta · [2ª cuenta] · Subtotal · IVA · Total · ojo · estado */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-xs font-semibold text-gray-600">
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Folio</th>
              <th className="px-3 py-2 text-left">{ventas ? 'Cliente' : 'Proveedor'}</th>
              <th className="px-3 py-2 text-left">{ventas ? 'Cuenta (cliente)' : 'Cuenta (proveedor)'}</th>
              {!ventas && <th className="px-3 py-2 text-left">2ª cuenta (gasto/activo)</th>}
              <th className="px-3 py-2 text-right">Subtotal</th>
              <th className="px-3 py-2 text-right">IVA</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-center w-16">Póliza</th>
              <th className="px-3 py-2 text-center w-12">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={nCols} className="px-3 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && filas.length === 0 && (
              <tr><td colSpan={nCols} className="px-3 py-8 text-center text-gray-500 italic">
                Sin facturas {ventas ? 'emitidas' : 'recibidas'} en {mes ? MESES[mes] : 'el año'} {anio}.
              </td></tr>
            )}
            {filas.map((c) => {
              const iva = ivaDe(c);
              const cancelado = String(c.estado_sat || '').toLowerCase() === 'cancelado';
              return (
                <tr key={c.id} className={cancelado ? 'bg-rose-50/40' : 'hover:bg-gray-50'}>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fechaCorta(c.fecha_emision)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">{folioDe(c)}</td>
                  <td className="px-3 py-2"><p className="truncate max-w-[14rem]" title={c.contraparte_nombre}>{c.contraparte_nombre || '—'}</p></td>
                  <td className="px-3 py-2">
                    <ComboCuenta id={c.id} valor={c.cuenta_contable} campo="cuenta"
                      opciones={ventas ? ctas.cliente : ctas.proveedor} claveVista={claveVista} />
                  </td>
                  {!ventas && (
                    <td className="px-3 py-2">
                      <ComboCuenta id={c.id} valor={c.cuenta_contable_2} campo="cuenta2"
                        opciones={ctas.gasto} claveVista={claveVista} />
                    </td>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{c.subtotal != null ? money(c.subtotal, c.moneda) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{iva != null ? money(iva, c.moneda) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{money(c.total, c.moneda)}</td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => setAsiento(c.uuid)} title="Ver / previsualizar la póliza"
                      className="text-gray-300 hover:text-sky-600"><Eye size={17} /></button>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {cancelado
                      ? <span className="text-[11px] text-rose-600" title="Cancelado ante el SAT">Cancelado</span>
                      : c.contabilizado
                        ? <span title="Codificada (ya tiene póliza)"><IconoCodificada /></span>
                        : <span title="Pendiente de codificar"><IconoPendiente /></span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {filas.length > 0 && (
            <tfoot>
              <tr className="border-t-2 bg-gray-50 font-semibold text-gray-800">
                <td colSpan={preSpan} className="px-3 py-2 text-right text-xs text-gray-500">Sumas del periodo</td>
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
        Orden por fecha y folio. El <b>ojo</b> previsualiza la póliza; el {ventas ? 'cobro' : 'pago'} que cancela la
        cuenta por {ventas ? 'cobrar' : 'pagar'} se hace en «{ventas ? 'Pagos de ventas' : 'Pago de compras'}».
        <IconoCodificada size={13} /> codificada · <IconoPendiente size={13} /> pendiente.
      </p>

      {asiento && (
        <AsientoModal uuid={asiento} onClose={() => setAsiento(null)} claveVista={claveVista} />
      )}
    </div>
  );
}

/* ── Combo de cuenta (datalist: despliega el catálogo; se escribe o se elige) ──
 * campo='cuenta' guarda la cuenta_contable (cliente/proveedor); campo='cuenta2'
 * guarda la cuenta_contable_2 (gasto/compra/activo de compras). */
function ComboCuenta({ id, valor, opciones, campo, claveVista }: {
  id: string; valor?: string | null; opciones: Array<{ codigo: string; nombre: string }>;
  campo: 'cuenta' | 'cuenta2'; claveVista: any[];
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState(valor || '');
  const [guardando, setGuardando] = useState(false);
  const listId = `ctas-${campo}-${id}`;
  useEffect(() => { setTexto(valor || ''); }, [valor]);

  const guardar = async () => {
    const v = texto.trim();
    if ((v || '') === (valor || '')) return;
    setGuardando(true);
    try {
      if (campo === 'cuenta2') await api.setSatCuentaContable2(id, v || null);
      else await api.setSatCuentaContable(id, v || null);
      qc.invalidateQueries({ queryKey: claveVista });
      qc.invalidateQueries({ queryKey: ['polizas'] });
    } finally { setGuardando(false); }
  };
  return (
    <div className="flex items-center gap-1">
      <input list={listId} value={texto} onChange={(e) => setTexto(e.target.value)} onBlur={guardar}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder="— asignar" className={`input py-1 text-xs w-32 font-mono ${guardando ? 'opacity-50' : ''}`} />
      <datalist id={listId}>
        {opciones.slice(0, 600).map((o) => <option key={o.codigo} value={o.codigo}>{o.codigo} — {o.nombre}</option>)}
      </datalist>
    </div>
  );
}

export default DocsContabilizar;
