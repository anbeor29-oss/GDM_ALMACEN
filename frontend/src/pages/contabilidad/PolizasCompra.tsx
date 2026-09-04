/**
 * Pólizas de compra — contabiliza las facturas recibidas, en tres pasos:
 *   1. Cargos      — a cada ClaveProdServ su cuenta 115 (inventario) o 601 (gasto).
 *   2. Proveedores — la subcuenta de cada proveedor (000-00-000, desde 201), auto o capturada.
 *   3. Pólizas     — una por factura recibida: cargo a inventario/gasto (por producto)
 *                    y al IVA acreditable (119.01), abono al proveedor.
 *
 * OJO: de recibidos el SAT entrega METADATOS (sin XML). La póliza necesita los
 * conceptos del XML, así que sólo alcanza a los recibidos que tengan XML.
 */
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Tag, Truck, FileText, PlayCircle, RefreshCw, Check, Pencil, AlertTriangle } from 'lucide-react';
import api from '@/services/api';
import { CuentaPicker } from '@/components/CuentaPicker';
import { ModalCrearSubcuenta } from '@/components/ModalCrearSubcuenta';
import { formatCuenta, useMascara } from '@/utils/cuenta';

const money = (n: any, m = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: (m || 'MXN').trim() || 'MXN' }).format(Number(n) || 0);
const fecha = (s?: string) => s ? new Date(s).toLocaleDateString('es-MX') : '—';
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const AvisoXml = () => (
  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-2">
    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
    De recibidos el SAT entrega metadatos (sin XML). Esto contabiliza solo los recibidos que
    <b> tengan XML</b>; los de puro metadato se omiten (no traen conceptos).
  </p>
);

export function PolizasCompraPage() {
  const hoy = new Date();
  const [tab, setTab] = useState<'cargos' | 'proveedores' | 'polizas'>('cargos');
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);

  const ctasQ = useQuery({ queryKey: ['ctas-mov'], queryFn: () => api.getCuentasContables() });
  const cuentas: any[] = (ctasQ.data?.data?.cuentas || []).filter((c: any) => c.permite_movimientos);

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BookOpen size={22} className="text-emerald-700" /> Pólizas de compra
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Contabiliza las facturas recibidas: cargos a inventario/gasto por producto, proveedores
          y una póliza por factura.
        </p>
      </div>

      {tab !== 'proveedores' && (
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
        {([['cargos', 'Cargos (115/601 por producto)'], ['proveedores', 'Proveedores'], ['polizas', 'Pólizas']] as const)
          .map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 ${
                tab === k ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {k === 'cargos' ? <Tag size={14} /> : k === 'proveedores' ? <Truck size={14} /> : <FileText size={14} />}
              {label}
            </button>
          ))}
      </div>

      <datalist id="ctas-compras">
        {cuentas.filter((c) => ['ACTIVO', 'GASTO', 'COSTO'].includes(c.tipo))
          .map((c) => <option key={c.id} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
      </datalist>

      {tab === 'cargos' && <TabCargos anio={anio} mes={mes} cuentas={cuentas} />}
      {tab === 'proveedores' && <TabProveedores />}
      {tab === 'polizas' && <TabPolizasCompra anio={anio} mes={mes} />}
    </div>
  );
}

/* ── Tab 1: Cargos (ClaveProdServ → 115/601) ──────────────────────────────── */
export function TabCargos({ anio, mes, cuentas }: { anio: number; mes: number; cuentas: any[] }) {
  const qc = useQueryClient();
  const mascara = useMascara();
  const [crear, setCrear] = useState<{ p: any; codigo: string } | null>(null);
  const clave = ['compras-productos', anio, mes];
  const q = useQuery({ queryKey: clave, queryFn: () => api.getComprasProductos(anio, mes) });
  const productos: any[] = q.data?.data?.productos || [];
  const nombreCta = useMemo(() => new Map<string, string>(cuentas.map((c) => [c.codigo, c.nombre])), [cuentas]);
  const faltan = productos.filter((p) => !p.cuenta).length;
  const [subMsg, setSubMsg] = useState('');
  const [subiendo, setSubiendo] = useState(false);

  const guardar = async (p: any, codigo: string) => {
    await api.setCompraProducto(p.clave, p.descripcion || null, codigo.trim() || null);
    qc.invalidateQueries({ queryKey: clave });
  };

  // Sugerencia de cuenta por prefijo de ClaveProdServ (misma familia SAT → misma
  // cuenta); si no, la dominante. El usuario confirma.
  const sugQ = useQuery({ queryKey: ['sug-cuenta', 'compras'], queryFn: () => api.getSugerenciasCuenta('compras') });
  const sug: any = sugQ.data?.data || { asignadas: [], dominante: null };
  const sugerir = (clave: string): string | null => {
    let best: string | null = null, bestLen = -1;
    for (const a of (sug.asignadas || [])) {
      const k = String(clave), c = String(a.clave); let i = 0;
      while (i < k.length && i < c.length && k[i] === c[i]) i++;
      if (i > bestLen) { bestLen = i; best = a.cuenta; }
    }
    const s = bestLen >= 4 ? best : (sug.dominante || best);
    return s && nombreCta.has(s) ? s : null;
  };
  const conSug = productos.filter((p) => !p.cuenta && sugerir(p.clave));
  const aplicarSugerencias = async () => {
    for (const p of conSug) { const s = sugerir(p.clave); if (s) await api.setCompraProducto(p.clave, p.descripcion || null, s); }
    qc.invalidateQueries({ queryKey: clave });
  };

  const subir = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setSubiendo(true); setSubMsg('');
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append('archivos', f));
      const r: any = await api.subirXmlCompra(fd);
      const errs = r.data?.errores || [];
      setSubMsg(`${r.data?.indexados || 0} XML contabilizable(s).` +
        (errs.length ? ` ${errs.length} omitido(s): ${errs.map((e: any) => `${e.archivo} (${e.motivo})`).join('; ')}` : ''));
      qc.invalidateQueries({ queryKey: clave });
    } catch (e: any) { setSubMsg(e?.response?.data?.message || 'No se pudieron subir los XML.'); }
    finally { setSubiendo(false); }
  };

  return (
    <div className="space-y-3">
      <AvisoXml />
      <div className="bg-white rounded-lg shadow border p-3 flex flex-wrap items-center gap-3">
        <p className="text-sm text-gray-600 flex-1 min-w-[16rem]">
          ¿Una compra no aparece porque bajó sólo como metadato o vino del almacén?
          <b> Sube su XML</b> aquí y queda contabilizable.
        </p>
        <label className="flex items-center gap-1.5 bg-emerald-700 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-800 text-sm cursor-pointer">
          <input type="file" accept=".xml" multiple className="hidden"
            onChange={(e) => { subir(e.target.files); e.currentTarget.value = ''; }} />
          {subiendo ? 'Subiendo…' : 'Subir XML de compra'}
        </label>
      </div>
      {subMsg && <p className="text-sm text-emerald-700">{subMsg}</p>}
      <p className="text-sm text-gray-600 bg-gray-50 border rounded p-3">
        A cada <b>producto</b> (ClaveProdServ) su cuenta: <b>115</b> si va a inventario o <b>601</b>
        {' '}si es gasto. La póliza carga a estas cuentas por producto, más el <b>IVA acreditable
        (119.01)</b>, contra el proveedor.
        {faltan > 0 && <b className="text-amber-700"> Faltan {faltan} por asignar.</b>}
      </p>
      {conSug.length > 0 && (
        <button onClick={aplicarSugerencias}
          className="flex items-center gap-1.5 border border-emerald-300 text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-emerald-50 text-sm">
          <Check size={15} /> Aplicar sugerencia a {conSug.length} que falta(n)
        </button>
      )}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">ClaveProdServ</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Descripción</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Veces</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Importe</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 w-72">Cuenta (115/601)</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>}
            {!q.isLoading && productos.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500 italic">
                Sin productos con XML en {MESES[mes]} {anio}. (Recuerda: los recibidos suelen venir como metadato.)
              </td></tr>
            )}
            {productos.map((p) => (
              <RenglonProducto key={p.clave} p={p} nombreCta={nombreCta} onGuardar={guardar}
                onCrear={(codigo: string) => setCrear({ p, codigo })}
                sugerencia={!p.cuenta ? sugerir(p.clave) : null} />
            ))}
          </tbody>
        </table>
      </div>

      {crear && (
        <ModalCrearSubcuenta
          codigo={crear.codigo}
          sugerirNombre={crear.p.descripcion || crear.p.clave}
          mascara={mascara}
          onCerrar={() => setCrear(null)}
          onHecho={async (cod) => {
            await guardar(crear.p, cod);
            qc.invalidateQueries({ queryKey: ['ctas-mov'] });
            qc.invalidateQueries({ queryKey: ['ctas-todas'] });
            setCrear(null);
          }}
        />
      )}
    </div>
  );
}

function RenglonProducto({ p, nombreCta, onGuardar, onCrear, sugerencia }: {
  p: any; nombreCta: Map<string, string>; onGuardar: (p: any, codigo: string) => void;
  onCrear: (codigo: string) => void; sugerencia?: string | null;
}) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2 text-xs font-mono text-gray-600">{p.clave}</td>
      <td className="px-4 py-2 text-sm"><p className="truncate max-w-sm">{p.descripcion || '—'}</p></td>
      <td className="px-4 py-2 text-center text-xs text-gray-500">{p.veces}</td>
      <td className="px-4 py-2 text-right text-sm">{money(p.importe)}</td>
      <td className="px-4 py-2">
        <CuentaPicker listId="ctas-compras" nombreCta={nombreCta} value={p.cuenta}
          onSave={(codigo) => onGuardar(p, codigo)} onCrear={onCrear} placeholder="115/601…" ancho="w-64" />
        {!p.cuenta && sugerencia && (
          <button onClick={() => onGuardar(p, sugerencia)}
            className="mt-1 text-[11px] text-emerald-700 hover:underline flex items-center gap-1"
            title={nombreCta.get(sugerencia)}>
            sugerido: <span className="font-mono">{sugerencia}</span> · usar
          </button>
        )}
      </td>
    </tr>
  );
}

/* ── Tab 2: Proveedores (subcuentas desde 201) ────────────────────────────── */
function TabProveedores() {
  const qc = useQueryClient();
  const mascara = useMascara();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['subcuentas-prov'], queryFn: () => api.getSubcuentasTercero('proveedor') });
  const subs: any[] = q.data?.data?.subcuentas || [];

  const generar = async () => {
    setBusy(true); setMsg('');
    try {
      const r: any = await api.generarSubcuentas('recibidos');
      const d = r.data;
      setMsg(`${d.creadas} nueva(s) · ${d.existentes} ya existían${d.errores?.length ? ` · ${d.errores.length} sin cuenta de control (201.01/201.02)` : ''}.`);
      qc.invalidateQueries({ queryKey: ['subcuentas-prov'] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo generar'); }
    finally { setBusy(false); }
  };

  const capturar = async () => {
    setBusy(true); setMsg('');
    try { const r: any = await api.capturarTercerosCatalogo('proveedor'); setMsg(r?.message || 'Proveedores capturados en el catálogo.'); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo capturar en el catálogo.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg shadow border p-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-gray-600 flex-1 min-w-[16rem]">
          Cada proveedor tiene su subcuenta bajo 201.01 (nacional) o 201.02 (extranjero). Se generan
          solas —de los recibidos <b>y del catálogo de proveedores</b>—. «Capturar en catálogo» los
          mete en la pantalla de Proveedores.
        </p>
        <button onClick={capturar} disabled={busy}
          className="flex items-center gap-1.5 border border-emerald-300 text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-emerald-50 disabled:opacity-50 text-sm">
          <Truck size={15} /> Capturar en catálogo
        </button>
        <button onClick={generar} disabled={busy}
          className="flex items-center gap-1.5 bg-emerald-700 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-800 disabled:opacity-50 text-sm">
          <PlayCircle size={15} /> {busy ? 'Generando…' : 'Generar subcuentas'}
        </button>
        <button onClick={() => q.refetch()} className="text-gray-500 hover:text-gray-700" title="Actualizar">
          <RefreshCw size={16} className={q.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>
      {msg && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">{msg}</p>}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 w-48">Código</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Proveedor</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">RFC</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Agrupador</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {!q.isLoading && subs.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500 italic">
                Aún no hay subcuentas. Dale «Generar subcuentas»: toma los proveedores de los recibidos y del catálogo.
              </td></tr>
            )}
            {subs.map((s) => <RenglonProveedor key={s.id} s={s} mascara={mascara} onListo={() => qc.invalidateQueries({ queryKey: ['subcuentas-prov'] })} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RenglonProveedor({ s, onListo, mascara }: { s: any; onListo: () => void; mascara?: string }) {
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
            {formatCuenta(s.codigo, mascara)} <Pencil size={12} className="opacity-0 group-hover:opacity-100 text-gray-400" />
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

/* ── Tab 3: Pólizas de compra ─────────────────────────────────────────────── */
function TabPolizasCompra({ anio, mes }: { anio: number; mes: number }) {
  const qc = useQueryClient();
  const mascara = useMascara();
  const [msg, setMsg] = useState('');
  const [omitidas, setOmitidas] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['polizas', anio, mes], queryFn: () => api.getPolizas(anio, mes) });
  const polizas: any[] = (q.data?.data?.polizas || []).filter((p: any) => String(p.regla || '').startsWith('compras'));

  const generar = async (todoAnio = false) => {
    setBusy(true); setMsg(''); setOmitidas([]);
    try {
      const r: any = await api.generarCompras(anio, mes, todoAnio);
      setMsg(`${r.data.creadas} póliza(s) de compra creada(s)${todoAnio ? ` en todo ${anio}` : ''}.`);
      setOmitidas(r.data.omitidas || []);
      qc.invalidateQueries({ queryKey: ['polizas', anio, mes] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo generar'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <AvisoXml />
      <div className="bg-white rounded-lg shadow border p-4 flex flex-wrap items-center gap-2">
        <p className="text-sm text-gray-600 flex-1 min-w-[16rem]">
          Una póliza por factura recibida de <b>{MESES[mes]} {anio}</b> con XML: cargo a
          inventario/gasto (por producto) y al IVA acreditable, abono al proveedor. No duplica.
        </p>
        <button onClick={() => generar(false)} disabled={busy}
          className="flex items-center gap-1.5 bg-emerald-700 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-800 disabled:opacity-50 text-sm">
          <PlayCircle size={15} /> {busy ? 'Generando…' : 'Generar pólizas del mes'}
        </button>
        <button onClick={() => generar(true)} disabled={busy} title={`Genera las pólizas de compra de todos los meses de ${anio}`}
          className="border border-emerald-300 px-3 py-1.5 rounded-lg hover:bg-emerald-50 text-sm text-emerald-700 disabled:opacity-50">Todo el año</button>
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
        {!q.isLoading && polizas.length === 0 && (
          <p className="text-sm text-gray-500 italic bg-white border rounded-lg p-4 text-center">
            Sin pólizas de compra en el mes. Genera con el botón de arriba.
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
                      <td className="px-3 py-1 font-mono text-gray-500 w-24">{formatCuenta(l.codigo, mascara)}</td>
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

export default PolizasCompraPage;
