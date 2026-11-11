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
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, TrendingUp, ShoppingCart, Wallet, Coins, Package, Users, Layers, PlayCircle } from 'lucide-react';
import { claseOpcion } from '@/utils/coloresOpciones';
import api from '@/services/api';
import { aniosContables } from '@/utils/anios';
import { DocsContabilizar } from './DocsContabilizar';
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

/* ── Nómina: pendiente de configurar en su turno (regla de asimilados confirmada) ── */
function NominaPanel() {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Users className="text-amber-600" size={22} />
        <div>
          <h2 className="font-semibold text-gray-900">Nómina / asimilados</h2>
          <p className="text-xs text-gray-500">El asiento de la nómina y los asimilados recibidos.</p>
        </div>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 space-y-2">
        <p className="font-medium">Esta pestaña se configura enseguida (pestaña por pestaña).</p>
        <p className="text-amber-800">
          El asiento confirmado para una factura de <b>asimilados PUE</b> recibida es:
        </p>
        <table className="text-xs bg-white/70 rounded-lg border border-amber-200 w-full max-w-md">
          <thead><tr className="text-left text-amber-700"><th className="px-3 py-1.5">Cuenta</th><th className="px-3 py-1.5 text-right">Cargo</th><th className="px-3 py-1.5 text-right">Abono</th></tr></thead>
          <tbody className="divide-y divide-amber-100">
            <tr><td className="px-3 py-1.5">Asimilados a salarios (gasto)</td><td className="px-3 py-1.5 text-right">total</td><td></td></tr>
            <tr><td className="px-3 py-1.5">Retención ISR asimilados</td><td></td><td className="px-3 py-1.5 text-right">ISR</td></tr>
            <tr><td className="px-3 py-1.5">Bancos</td><td></td><td className="px-3 py-1.5 text-right">neto</td></tr>
          </tbody>
        </table>
        <p className="text-amber-800">Se asentará como regla del motor al detectar un CFDI de nómina/asimilados recibido, igual que hoy con compras/ventas PUE.</p>
      </div>
    </div>
  );
}

export default PolizasHubPage;
