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
import { DocsContabilizar, IconoCodificada, IconoPendiente } from './DocsContabilizar';
import { TablaComprobantesSat } from '@/components/TablaComprobantesSat';
import { PolizasListaPage } from './PolizasLista';

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
      {tab === 'cobros' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
            <b>Pagos de ventas</b> — el COBRO que cancela la cuenta por cobrar. Aquí están los comprobantes
            emitidos: los <b>timbres de pago (REP)</b> y las ventas <b>PUE</b>. Doble clic en un renglón abre su
            asiento; el cobro de las ventas PUE se asienta al «Contabilizar» en la pestaña Ventas.
          </p>
          <TablaComprobantesSat direccion="emitidos" />
        </div>
      )}
      {tab === 'pagos' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <b>Pago de compras</b> — el PAGO que cancela el pasivo (cargo al proveedor e IVA acreditable, abono a
            bancos). Doble clic en una factura recibida abre su asiento y, si es PUE o PPD sin complemento, deja
            generar el pago ahí mismo.
          </p>
          <TablaComprobantesSat direccion="recibidos" />
        </div>
      )}
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

function NominaPanel() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const periodosQ = useQuery({ queryKey: ['nomina-poliza-periodos'], queryFn: () => api.getPeriodosOrdinariosPoliza() });
  const finiqQ = useQuery({ queryKey: ['nomina-poliza-finiquitos'], queryFn: () => api.getFiniquitosParaPoliza() });
  const periodos: any[] = periodosQ.data?.data?.periodos || [];
  const finiquitos: any[] = finiqQ.data?.data?.finiquitos || [];

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
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Users className="text-amber-600" size={22} />
        <div>
          <h2 className="font-semibold text-gray-900">Nómina</h2>
          <p className="text-xs text-gray-500">Baja a contabilidad las pólizas que genera el módulo de Nómina: percepciones→gasto, deducciones→retenciones, neto→por pagar.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={bajarPendientes} disabled={!!busy || pendientes === 0}
            className="inline-flex items-center gap-1.5 border border-amber-300 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-100 disabled:opacity-40">
            <PlayCircle size={15} /> {busy === 'todas' ? 'Bajando…' : `Bajar pendientes${pendientes ? ` (${pendientes})` : ''}`}
          </button>
        </div>
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

export default PolizasHubPage;
