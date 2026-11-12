/**
 * PolizasHub — la pantalla de «Pólizas» dividida en PESTAÑAS, una por tipo de
 * movimiento, para ver y contabilizar cada cosa en su lugar (y no andar buscando
 * el pago/cobro en otra pantalla). Pedido del usuario: configurar pestaña por
 * pestaña.
 *
 *   Ventas          → facturas emitidas (devengo: ingreso + cuenta por cobrar).
 *   Compras         → facturas recibidas (devengo: gasto/activo + IVA + por pagar).
 *   Pagos de ventas → timbres de pago emitidos (REP) y ventas PUE: el COBRO que
 *                     cancela la cuenta por cobrar.
 *   Pago de compras → REP recibidos y compras PUE: el PAGO que cancela el pasivo.
 *   Depreciaciones  → la corrida mensual de depreciación del activo fijo.
 *   Nómina          → el asiento de nómina / asimilados.
 *   Libro diario    → TODAS las pólizas juntas (el motor y el editor de siempre).
 *
 * No duplica motor: cada pestaña reutiliza lo que ya existe (la vista de
 * comprobantes, el modal de asiento, la pantalla consolidada de pólizas).
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, TrendingUp, ShoppingCart, Wallet, Coins, Package, Users, Layers, PlayCircle } from 'lucide-react';
import { claseOpcion } from '@/utils/coloresOpciones';
import api from '@/services/api';
import { aniosContables } from '@/utils/anios';
import { DocsContabilizar, IconoCodificada, IconoPendiente, ComboCuenta } from './DocsContabilizar';
import { PagosContabilizar } from './PagosContabilizar';
import { AsientoModal } from '@/components/TablaComprobantesSat';
import { PolizasListaPage } from './PolizasLista';
import { Eye } from 'lucide-react';

const MESES = ['Todo el año', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

type Tab = 'ventas' | 'compras' | 'cobros' | 'pagos' | 'deprec' | 'nomina' | 'libro';
const TABS: Array<[Tab, string, any]> = [
  ['ventas', 'Ventas', TrendingUp],
  ['compras', 'Compras', ShoppingCart],
  ['cobros', 'Pagos de ventas', Wallet],
  ['pagos', 'Pago de compras', Coins],
  ['deprec', 'Depreciaciones', Package],
  ['nomina', 'Nómina', Users],
  ['libro', 'Libro diario', Layers],
];

export function PolizasHubPage() {
  const [params, setParams] = useSearchParams();
  const inicial = (params.get('tab') as Tab) || 'ventas';
  const [tab, setTab] = useState<Tab>(TABS.some(([k]) => k === inicial) ? inicial : 'ventas');
  const ir = (t: Tab) => {
    setTab(t);
    const p = new URLSearchParams(params); p.set('tab', t); setParams(p, { replace: true });
  };

  return (
    <div className="p-6 space-y-5">
      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <BookOpen size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">Pólizas</h1>
          <p className="text-sm text-gray-500">Cada movimiento en su pestaña: ventas, compras, sus cobros y pagos, depreciación y nómina.</p>
        </div>
      </div>

      {/* Pestañas (estilo hoja de Excel: inactivas verde claro, activa azul) */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(([k, label, Icono], i) => (
          <button key={k} onClick={() => ir(k)} className={`${claseOpcion(i, tab === k)} inline-flex items-center gap-1.5`}>
            <Icono size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Contenido de la pestaña */}
      {tab === 'ventas' && <DocsContabilizar modo="ventas" />}
      {tab === 'compras' && <DocsContabilizar modo="compras" />}
      {tab === 'cobros' && <PagosContabilizar modo="cobros" />}
      {tab === 'pagos' && <PagosContabilizar modo="pagos" />}
      {tab === 'deprec' && <DeprecPanel />}
      {tab === 'nomina' && <NominaPanel />}
      {tab === 'libro' && <PolizasListaPage />}
    </div>
  );
}

/* ── Depreciaciones: la corrida mensual (reutiliza el generador del motor) ──── */
function DeprecPanel() {
  const qc = useQueryClient();
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState<number>(hoy.getMonth() + 1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const anios = aniosContables();

  const correr = async () => {
    if (!mes) { setMsg('Elige un mes concreto: la depreciación es mensual.'); return; }
    setBusy(true); setMsg('');
    try {
      const r: any = await api.generarDepreciacion(anio, mes);
      const d = r?.data || {};
      setMsg(d.creadas != null ? `${d.creadas} póliza(s) de depreciación generada(s).` : (r?.message || 'Depreciación generada.'));
      qc.invalidateQueries({ queryKey: ['polizas'] });
    } catch (e: any) { setMsg(e?.response?.data?.message || e?.message || 'No se pudo generar la depreciación.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Package className="text-violet-600" size={22} />
        <div>
          <h2 className="font-semibold text-gray-900">Depreciación del mes</h2>
          <p className="text-xs text-gray-500">Línea recta sobre el activo fijo (LISR 33-35): gasto 701/702, depreciación acumulada 171/183.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input py-1.5 text-sm">
            {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input py-1.5 text-sm w-24">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button onClick={correr} disabled={busy}
            className="inline-flex items-center gap-1.5 border border-violet-300 bg-violet-50 text-violet-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-violet-100 disabled:opacity-40">
            <PlayCircle size={15} /> {busy ? 'Generando…' : 'Generar depreciación'}
          </button>
        </div>
      </div>
      {msg && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>}
      <p className="text-[11px] text-gray-400 px-1">
        La póliza mensual es idempotente (no se duplica). El detalle de activos y su cálculo vive en
        <b> Activo fijo</b>; aquí se corre y se asienta la depreciación del periodo.
      </p>
    </div>
  );
}

/* ── Nómina: BAJA a contabilidad las pólizas que genera el módulo de Nómina ──
 * Lista las corridas (periodos ordinarios) y los finiquitos TIMBRADOS; cada uno
 * se contabiliza (provisión: percepciones→601, deducciones→216/205, neto→210).
 * Es el «bajar de la sección de nómina las pólizas que se generen». */
const ETIQ_TIPO: Record<string, string> = { SEMANAL: 'Semana', QUINCENAL: 'Quincena', MENSUAL: 'Mes' };
const fechaMx = (s?: string) => s ? new Date(s + (String(s).length <= 10 ? 'T12:00:00' : '')).toLocaleDateString('es-MX') : '—';

/* ── Nómina: dos subpestañas (emitida = del módulo; recibida = la que te pagan) ── */
function NominaPanel() {
  const hoy = new Date();
  const [sub, setSub] = useState<'emitida' | 'recibida'>('emitida');
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState<number>(hoy.getMonth() + 1);
  const anios = aniosContables();
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Users className="text-amber-600" size={22} />
        <div>
          <h2 className="font-semibold text-gray-900">Nómina</h2>
          <p className="text-xs text-gray-500">Emitida: baja las pólizas del módulo de Nómina. Recibida: contabiliza la nómina/asimilados que te pagan.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input py-1.5 text-sm">
            {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input py-1.5 text-sm w-24">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
      <div className="flex gap-1.5">
        {([['emitida', 'Nómina emitida'], ['recibida', 'Nómina recibida']] as const).map(([k, label], i) => (
          <button key={k} onClick={() => setSub(k)} className={claseOpcion(i, sub === k)}>{label}</button>
        ))}
      </div>
      {sub === 'emitida' ? <NominaEmitida anio={anio} mes={mes} /> : <NominaRecibida anio={anio} mes={mes} />}
    </div>
  );
}

function NominaEmitida({ anio, mes }: { anio: number; mes: number }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const periodosQ = useQuery({ queryKey: ['nomina-poliza-periodos'], queryFn: () => api.getPeriodosOrdinariosPoliza() });
  const finiqQ = useQuery({ queryKey: ['nomina-poliza-finiquitos'], queryFn: () => api.getFiniquitosParaPoliza() });
  const mesDe = (s?: string) => s ? new Date(s + (String(s).length <= 10 ? 'T12:00:00' : '')).getMonth() + 1 : 0;
  const enPeriodo = (f?: string, a?: number) => Number(a) === anio && (mes === 0 || mesDe(f) === mes);
  const periodos: any[] = (periodosQ.data?.data?.periodos || []).filter((p: any) => enPeriodo(p.fecha_pago || p.fecha_fin, p.anio));
  const finiquitos: any[] = (finiqQ.data?.data?.finiquitos || []).filter((f: any) => mes === 0 || (mesDe(f.fecha_baja) === mes && new Date((f.fecha_baja || '') + 'T12:00:00').getFullYear() === anio));

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['nomina-poliza-periodos'] });
    qc.invalidateQueries({ queryKey: ['nomina-poliza-finiquitos'] });
    qc.invalidateQueries({ queryKey: ['polizas'] });
  };

  const bajarPeriodo = async (id: string, etiqueta: string) => {
    setBusy(id); setMsg('');
    try {
      const r: any = await api.generarPolizaPeriodoNomina(id);
      setMsg(r?.data?.creada === false ? `${etiqueta}: ya tenía póliza.` : `${etiqueta}: póliza contabilizada.`);
      refrescar();
    } catch (e: any) { setMsg(e?.response?.data?.message || e?.message || 'No se pudo bajar la póliza.'); }
    finally { setBusy(''); }
  };
  const bajarFiniquito = async (reciboId: string, nombre: string) => {
    setBusy(reciboId); setMsg('');
    try {
      const r: any = await api.generarPolizaNomina(reciboId);
      setMsg(r?.data?.creada === false ? `${nombre}: ya tenía póliza.` : `${nombre}: finiquito contabilizado.`);
      refrescar();
    } catch (e: any) { setMsg(e?.response?.data?.message || e?.message || 'No se pudo bajar la póliza.'); }
    finally { setBusy(''); }
  };
  const bajarPendientes = async () => {
    setBusy('todas'); setMsg('');
    let n = 0;
    try {
      for (const p of periodos.filter((x) => !x.con_poliza && x.timbrados > 0)) {
        try { await api.generarPolizaPeriodoNomina(p.id); n++; } catch { /* sigue con las demás */ }
      }
      setMsg(`${n} corrida(s) de nómina contabilizada(s).`);
      refrescar();
    } finally { setBusy(''); }
  };

  const pendientes = periodos.filter((p) => !p.con_poliza && p.timbrados > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-gray-500">Corridas del módulo de Nómina (provisión): percepciones→gasto, deducciones→retenciones, neto→por pagar.</span>
        <button onClick={bajarPendientes} disabled={!!busy || pendientes === 0}
          className="ml-auto inline-flex items-center gap-1.5 border border-amber-300 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-100 disabled:opacity-40">
          <PlayCircle size={15} /> {busy === 'todas' ? 'Bajando…' : `Bajar pendientes${pendientes ? ` (${pendientes})` : ''}`}
        </button>
      </div>
      {msg && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>}

      {/* Corridas ordinarias */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-xs font-semibold text-gray-600">
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Corrida</th>
              <th className="px-3 py-2 text-left">Concepto</th>
              <th className="px-3 py-2 text-center">Recibos</th>
              <th className="px-3 py-2 text-center">Timbrados</th>
              <th className="px-3 py-2 text-center w-28">Contabilizar</th>
              <th className="px-3 py-2 text-center w-12">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {periodosQ.isLoading && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">Cargando…</td></tr>}
            {!periodosQ.isLoading && periodos.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-500 italic">Sin corridas de nómina. Se generan en el módulo de Nómina.</td></tr>
            )}
            {periodos.map((p) => {
              const etiqueta = `${ETIQ_TIPO[p.tipo] || p.tipo} ${p.numero}/${p.anio}`;
              return (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fechaMx(p.fecha_pago || p.fecha_fin)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">{etiqueta}</td>
                  <td className="px-3 py-2"><p className="truncate max-w-[16rem]" title={p.concepto}>{p.concepto || '—'}</p></td>
                  <td className="px-3 py-2 text-center tabular-nums text-gray-600">{p.recibos}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-gray-600">{p.timbrados}</td>
                  <td className="px-3 py-2 text-center">
                    {p.con_poliza
                      ? <span className="text-[11px] text-emerald-700">lista</span>
                      : <button onClick={() => bajarPeriodo(p.id, etiqueta)} disabled={!!busy || p.timbrados === 0}
                          title={p.timbrados === 0 ? 'Aún no hay recibos timbrados' : 'Bajar la póliza de esta corrida'}
                          className="text-[11px] border border-amber-300 bg-amber-50 text-amber-700 px-2 py-1 rounded hover:bg-amber-100 disabled:opacity-40">
                          {busy === p.id ? '…' : 'Bajar'}
                        </button>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {p.con_poliza
                      ? <span title="Codificada"><IconoCodificada /></span>
                      : <span title="Pendiente de codificar"><IconoPendiente /></span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Finiquitos / liquidaciones timbrados */}
      {finiquitos.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <div className="px-3 pt-3 text-xs font-semibold text-gray-500">Finiquitos / liquidaciones timbrados</div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-xs font-semibold text-gray-600">
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Empleado</th>
                <th className="px-3 py-2 text-right">Neto</th>
                <th className="px-3 py-2 text-center w-28">Contabilizar</th>
                <th className="px-3 py-2 text-center w-12">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {finiquitos.map((f) => (
                <tr key={f.recibo_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fechaMx(f.fecha_baja)}</td>
                  <td className="px-3 py-2"><p className="truncate max-w-[16rem]">{f.nombre}</p></td>
                  <td className="px-3 py-2 text-right tabular-nums">{new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(f.neto) || 0)}</td>
                  <td className="px-3 py-2 text-center">
                    {f.con_poliza
                      ? <span className="text-[11px] text-emerald-700">lista</span>
                      : <button onClick={() => bajarFiniquito(f.recibo_id, f.nombre)} disabled={!!busy}
                          className="text-[11px] border border-amber-300 bg-amber-50 text-amber-700 px-2 py-1 rounded hover:bg-amber-100 disabled:opacity-40">
                          {busy === f.recibo_id ? '…' : 'Bajar'}
                        </button>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {f.con_poliza ? <span title="Codificada"><IconoCodificada /></span> : <span title="Pendiente"><IconoPendiente /></span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-gray-400 px-1">
        Las pólizas se generan en el módulo de <b>Nómina</b> (provisión por corrida); aquí se BAJAN a la
        contabilidad y aparecen también en el Libro diario. <IconoCodificada size={13} /> codificada ·
        <IconoPendiente size={13} /> pendiente.
      </p>
    </div>
  );
}

/* ── Nómina RECIBIDA: la que te pagan (CFDI tipo N recibidos) ── */
function NominaRecibida({ anio, mes }: { anio: number; mes: number }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [asiento, setAsiento] = useState<string | null>(null);
  const claveVista: any[] = ['nomina-recibida', anio, mes];
  const q = useQuery({ queryKey: claveVista, queryFn: () => api.getNominaRecibidaContabilizable(anio, mes) });
  const filas: any[] = q.data?.data?.nominas || [];
  const pend = filas.filter((f) => !f.contabilizado).length;
  const mny = (n: any) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
  const CLASE: Record<string, string> = { sueldos: 'Sueldos', asimilados: 'Asimilados', jubilacion: 'Jubilación', otro: 'Otro' };
  // Catálogo de movimiento para los combos (acceso al catálogo de cuentas).
  const ctasQ = useQuery({ queryKey: ['ctas-mov'], queryFn: () => api.getCuentasContables() });
  const ctasMov = ((ctasQ.data as any)?.data?.cuentas || [])
    .filter((c: any) => c.permite_movimientos).map((c: any) => ({ codigo: c.codigo, nombre: c.nombre }));
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: claveVista });
    qc.invalidateQueries({ queryKey: ['polizas'] });
    qc.invalidateQueries({ queryKey: ['asiento'] });
  };
  const uno = async (uuid: string, nombre: string) => {
    setBusy(uuid); setMsg('');
    try { const r: any = await api.contabilizarNominaRecibida(uuid); setMsg(r?.data?.ok ? `${nombre}: contabilizada.` : `${nombre}: ${r?.data?.error || 'pendiente'}.`); refrescar(); }
    catch (e: any) { setMsg(e?.response?.data?.message || e?.message || 'No se pudo contabilizar.'); }
    finally { setBusy(''); }
  };
  const todas = async () => {
    setBusy('todas'); setMsg('');
    try {
      const r: any = await api.contabilizarNominaRecibidaMes(anio, mes); const d = r?.data || {};
      let m = `${d.creadas ?? 0} contabilizada(s).`;
      if (d.omitidas?.length) m += ` ${d.omitidas.length} pendiente(s): ${d.omitidas.slice(0, 2).map((o: any) => o.motivo).join(' · ')}${d.omitidas.length > 2 ? '…' : ''}.`;
      setMsg(m); refrescar();
    } catch (e: any) { setMsg(e?.response?.data?.message || e?.message || 'No se pudo contabilizar.'); }
    finally { setBusy(''); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-gray-500">Nómina/asimilados que te pagan (CFDI tipo N): Cargo Banco (neto) + ISR a favor · Abono Ingreso. Captura la <b>cuenta de ingreso</b> y la de <b>ISR a favor</b> (1-1-60-02).</span>
        <button onClick={todas} disabled={!!busy || pend === 0}
          className="ml-auto inline-flex items-center gap-1.5 border border-amber-300 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-100 disabled:opacity-40">
          <PlayCircle size={15} /> {busy === 'todas' ? 'Contabilizando…' : `Contabilizar pendientes${pend ? ` (${pend})` : ''}`}
        </button>
      </div>
      {msg && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-xs font-semibold text-gray-600">
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Emisor</th>
              <th className="px-3 py-2 text-left">Clase</th>
              <th className="px-3 py-2 text-left">Cuenta ingreso</th>
              <th className="px-3 py-2 text-left">Cuenta ISR a favor</th>
              <th className="px-3 py-2 text-right">Percepciones</th>
              <th className="px-3 py-2 text-right">ISR</th>
              <th className="px-3 py-2 text-right">Neto</th>
              <th className="px-3 py-2 text-center w-12">Póliza</th>
              <th className="px-3 py-2 text-center w-28">Contabilizar</th>
              <th className="px-3 py-2 text-center w-12">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={11} className="px-3 py-6 text-center text-gray-500">Cargando…</td></tr>}
            {!q.isLoading && filas.length === 0 && (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-gray-500 italic">Sin nómina recibida en el periodo (CFDI tipo N recibidos).</td></tr>
            )}
            {filas.map((f) => (
              <tr key={f.uuid} className="hover:bg-gray-50">
                <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fechaMx(f.fecha)}</td>
                <td className="px-3 py-2"><p className="truncate max-w-[12rem]" title={f.nombreEmisor}>{f.nombreEmisor || f.rfcEmisor || '—'}</p></td>
                <td className="px-3 py-2 text-gray-600">{CLASE[f.clase] || f.clase}</td>
                <td className="px-3 py-2">
                  {f.id ? <ComboCuenta id={f.id} valor={f.cuenta_contable} campo="cuenta" opciones={ctasMov} claveVista={claveVista} /> : '—'}
                </td>
                <td className="px-3 py-2">
                  {f.id ? <ComboCuenta id={f.id} valor={f.cuenta_contable_2} campo="cuenta2" opciones={ctasMov} claveVista={claveVista} /> : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{mny(f.totalPercepciones)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{mny(f.isr)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{mny(f.neto)}</td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => setAsiento(f.uuid)} title="Ver / previsualizar la póliza"
                    className="text-gray-300 hover:text-sky-600"><Eye size={17} /></button>
                </td>
                <td className="px-3 py-2 text-center">
                  {f.contabilizado
                    ? <span className="text-[11px] text-emerald-700">lista</span>
                    : <button onClick={() => uno(f.uuid, f.nombreEmisor || f.rfcEmisor)} disabled={!!busy}
                        className="text-[11px] border border-amber-300 bg-amber-50 text-amber-700 px-2 py-1 rounded hover:bg-amber-100 disabled:opacity-40">
                        {busy === f.uuid ? '…' : 'Contabilizar'}
                      </button>}
                </td>
                <td className="px-3 py-2 text-center">
                  {f.contabilizado ? <span title="Codificada"><IconoCodificada /></span> : <span title="Pendiente"><IconoPendiente /></span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 px-1">
        Asiento: Cargo Banco (neto) + Cargo ISR retenido a favor / Abono Ingreso por nómina. Captura las cuentas en los
        combos (despliegan el catálogo); el ISR por defecto usa 1-1-60-02 si no capturas otra. El <b>ojo</b> muestra la póliza.
      </p>
      {asiento && <AsientoModal uuid={asiento} onClose={() => setAsiento(null)} claveVista={claveVista} />}
    </div>
  );
}

export default PolizasHubPage;
