/**
 * Pólizas de venta — la contabilización de las facturas emitidas, en tres pasos:
 *   1. Ingresos   — a cada ClaveProdServ (producto) su cuenta 401.
 *   2. Clientes   — la subcuenta de cada cliente (000-00-000), auto o capturada.
 *   3. Pólizas    — una por factura del mes: cargo al cliente, abono a ventas
 *                   (partido por producto) y al IVA (208 PUE / 209 PPD).
 */
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Tag, Users, FileText, PlayCircle, RefreshCw, Check, Pencil } from 'lucide-react';
import api from '@/services/api';
import { CuentaPicker } from '@/components/CuentaPicker';

const money = (n: any, m = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: (m || 'MXN').trim() || 'MXN' }).format(Number(n) || 0);
const fecha = (s?: string) => s ? new Date(s).toLocaleDateString('es-MX') : '—';
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function PolizasVentaPage() {
  const hoy = new Date();
  const [tab, setTab] = useState<'ingresos' | 'clientes' | 'polizas'>('ingresos');
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);

  const ctasQ = useQuery({ queryKey: ['ctas-mov'], queryFn: () => api.getCuentasContables() });
  const cuentas: any[] = (ctasQ.data?.data?.cuentas || []).filter((c: any) => c.permite_movimientos);

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BookOpen size={22} className="text-amber-600" /> Pólizas de venta
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Contabiliza las facturas emitidas: ingresos por producto, clientes y una póliza por factura.
        </p>
      </div>

      {/* Periodo (aplica a Ingresos y Pólizas) */}
      {tab !== 'clientes' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Mes calendario:</span>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input py-1.5 text-sm">
            {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input py-1.5 text-sm w-24">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      )}

      <div className="flex gap-1 border-b">
        {([['ingresos', 'Ingresos (401 por producto)'], ['clientes', 'Clientes'], ['polizas', 'Pólizas']] as const)
          .map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 ${
                tab === k ? 'border-amber-600 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {k === 'ingresos' ? <Tag size={14} /> : k === 'clientes' ? <Users size={14} /> : <FileText size={14} />}
              {label}
            </button>
          ))}
      </div>

      <datalist id="ctas-ventas">
        {cuentas.filter((c) => c.tipo === 'INGRESO').map((c) => <option key={c.id} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
      </datalist>

      {tab === 'ingresos' && <TabIngresos anio={anio} mes={mes} cuentas={cuentas} />}
      {tab === 'clientes' && <TabClientes />}
      {tab === 'polizas' && <TabPolizas anio={anio} mes={mes} />}
    </div>
  );
}

/* ── Tab 1: Ingresos (ClaveProdServ → 401) ────────────────────────────────── */
export function TabIngresos({ anio, mes, cuentas }: { anio: number; mes: number; cuentas: any[] }) {
  const qc = useQueryClient();
  const clave = ['ventas-productos', anio, mes];
  const q = useQuery({ queryKey: clave, queryFn: () => api.getVentasProductos(anio, mes) });
  const productos: any[] = q.data?.data?.productos || [];
  const nombreCta = useMemo(() => new Map<string, string>(cuentas.map((c) => [c.codigo, c.nombre])), [cuentas]);
  const faltan = productos.filter((p) => !p.cuenta).length;

  const guardar = async (p: any, codigo: string) => {
    await api.setVentaProducto(p.clave, p.descripcion || null, codigo.trim() || null);
    qc.invalidateQueries({ queryKey: clave });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 bg-gray-50 border rounded p-3">
        A cada <b>producto</b> (ClaveProdServ del XML) su cuenta de ingreso <b>401</b>. La póliza
        abona a estas cuentas, partiendo cada factura por producto. El IVA lo lleva el sistema a
        208 (PUE) o 209 (PPD) según la factura.
        {faltan > 0 && <b className="text-amber-700"> Faltan {faltan} por asignar.</b>}
      </p>
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">ClaveProdServ</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Descripción</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Veces</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Importe</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 w-72">Cuenta 401</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>}
            {!q.isLoading && productos.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500 italic">
                Sin productos en {MESES[mes]} {anio}. Trae los emitidos del mes en «XML del SAT».
              </td></tr>
            )}
            {productos.map((p) => (
              <RenglonProducto key={p.clave} p={p} nombreCta={nombreCta} onGuardar={guardar} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RenglonProducto({ p, nombreCta, onGuardar }: {
  p: any; nombreCta: Map<string, string>; onGuardar: (p: any, codigo: string) => void;
}) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2 text-xs font-mono text-gray-600">{p.clave}</td>
      <td className="px-4 py-2 text-sm"><p className="truncate max-w-sm">{p.descripcion || '—'}</p></td>
      <td className="px-4 py-2 text-center text-xs text-gray-500">{p.veces}</td>
      <td className="px-4 py-2 text-right text-sm">{money(p.importe)}</td>
      <td className="px-4 py-2">
        <CuentaPicker listId="ctas-ventas" nombreCta={nombreCta} value={p.cuenta}
          onSave={(codigo) => onGuardar(p, codigo)} placeholder="401-xx…" ancho="w-64" />
      </td>
    </tr>
  );
}

/* ── Tab 2: Clientes (subcuentas 000-00-000, auto + captura) ───────────────── */
function TabClientes() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['subcuentas-cliente'], queryFn: () => api.getSubcuentasTercero('cliente') });
  const subs: any[] = q.data?.data?.subcuentas || [];

  const generar = async () => {
    setBusy(true); setMsg('');
    try {
      const r: any = await api.generarSubcuentas('emitidos');
      const d = r.data;
      setMsg(`${d.creadas} nueva(s) · ${d.existentes} ya existían${d.errores?.length ? ` · ${d.errores.length} sin cuenta de control (105.01/105.02)` : ''}.`);
      qc.invalidateQueries({ queryKey: ['subcuentas-cliente'] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo generar'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg shadow border p-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-gray-600 flex-1 min-w-[16rem]">
          Cada cliente tiene su subcuenta bajo 105.01 (nacional) o 105.02 (extranjero), numerada
          <b> 105-01-001, 105-01-002…</b> Se generan solas; puedes capturar/override el código de una.
        </p>
        <button onClick={generar} disabled={busy}
          className="flex items-center gap-1.5 bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm">
          <PlayCircle size={15} /> {busy ? 'Generando…' : 'Generar subcuentas'}
        </button>
        <button onClick={() => q.refetch()} className="text-gray-500 hover:text-gray-700" title="Actualizar">
          <RefreshCw size={16} className={q.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>
      {msg && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">{msg}</p>}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 w-48">Código</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Cliente</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">RFC</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Agrupador</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {!q.isLoading && subs.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500 italic">
                Aún no hay subcuentas. Dale «Generar subcuentas» (necesita clientes en los emitidos).
              </td></tr>
            )}
            {subs.map((s) => <RenglonCliente key={s.id} s={s} onListo={() => qc.invalidateQueries({ queryKey: ['subcuentas-cliente'] })} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RenglonCliente({ s, onListo }: { s: any; onListo: () => void }) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(s.codigo);
  const [err, setErr] = useState('');
  const guardar = async () => {
    setErr('');
    try {
      const r: any = await api.setCodigoSubcuenta(s.id, val.trim());
      if (r?.success === false) { setErr(r.message); return; }
      setEdit(false); onListo();
    } catch (e: any) { setErr(e?.response?.data?.message || 'No se pudo'); }
  };
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2">
        {edit ? (
          <div className="flex items-center gap-1">
            <input autoFocus value={val} onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEdit(false); }}
              className="input py-1 text-sm w-32 font-mono" />
            <button onClick={guardar} className="text-emerald-600"><Check size={15} /></button>
          </div>
        ) : (
          <button onClick={() => { setVal(s.codigo); setEdit(true); }}
            className="group flex items-center gap-1 font-mono text-sm text-gray-800 hover:text-gray-900" title="Capturar/override">
            {s.codigo} <Pencil size={12} className="opacity-0 group-hover:opacity-100 text-gray-400" />
          </button>
        )}
        {err && <p className="text-[11px] text-rose-600">{err}</p>}
      </td>
      <td className="px-4 py-2 text-sm"><p className="truncate max-w-sm">{s.nombre}</p></td>
      <td className="px-4 py-2 text-xs font-mono text-gray-600">{s.tercero_rfc}</td>
      <td className="px-4 py-2 text-xs text-gray-500">{s.codigo_agrupador}</td>
    </tr>
  );
}

/* ── Tab 3: Pólizas (una por factura, por mes) ────────────────────────────── */
function TabPolizas({ anio, mes }: { anio: number; mes: number }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [omitidas, setOmitidas] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['polizas', anio, mes], queryFn: () => api.getPolizas(anio, mes) });
  const polizas: any[] = q.data?.data?.polizas || [];

  const generar = async () => {
    setBusy(true); setMsg(''); setOmitidas([]);
    try {
      const r: any = await api.generarVentas(anio, mes);
      setMsg(`${r.data.creadas} póliza(s) de venta creada(s).`);
      setOmitidas(r.data.omitidas || []);
      qc.invalidateQueries({ queryKey: ['polizas', anio, mes] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo generar'); }
    finally { setBusy(false); }
  };
  const regenerar = async () => {
    if (!window.confirm('¿Borrar las pólizas de CFDI de este mes y volver a generarlas?')) return;
    setBusy(true); setMsg('');
    try { await api.borrarPolizasCfdi(anio, mes); await generar(); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo'); setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg shadow border p-4 flex flex-wrap items-center gap-2">
        <p className="text-sm text-gray-600 flex-1 min-w-[16rem]">
          Una póliza por factura de <b>{MESES[mes]} {anio}</b>: cargo al cliente, abono a ventas
          (por producto) y al IVA. No duplica.
        </p>
        <button onClick={generar} disabled={busy}
          className="flex items-center gap-1.5 bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm">
          <PlayCircle size={15} /> {busy ? 'Generando…' : 'Generar pólizas'}
        </button>
        <button onClick={regenerar} disabled={busy} title="Borrar CFDI del mes y regenerar"
          className="border px-3 py-1.5 rounded-lg hover:bg-gray-50 text-sm text-gray-600">Regenerar</button>
      </div>
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      {omitidas.length > 0 && (
        <details className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <summary className="cursor-pointer">{omitidas.length} omitida(s) — ver por qué</summary>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {omitidas.map((o, i) => <li key={i}><b>{o.folio}</b>: {o.motivo}</li>)}
          </ul>
        </details>
      )}

      <div className="space-y-2">
        {q.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}
        {!q.isLoading && polizas.length === 0 && (
          <p className="text-sm text-gray-500 italic bg-white border rounded-lg p-4 text-center">
            Sin pólizas en el mes. Genera con el botón de arriba.
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
                <span className="ml-auto text-[10px] text-gray-400">{p.origen} · {p.regla || '—'}</span>
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

export default PolizasVentaPage;
