/**
 * Asignación de cuenta — el puente entre los XML del SAT y la balanza.
 *
 * Cada comprobante que se bajó (emitido o recibido) necesita saber A QUÉ CUENTA
 * del catálogo pertenece para poder sumar sus movimientos en la balanza del mes.
 * Aquí se ve el mes completo y se asigna la cuenta (la del catálogo que permite
 * movimientos), de a uno o en bloque por RFC —el mismo proveedor casi siempre va
 * a la misma cuenta de gasto—.
 *
 * Es asignación de la cuenta PRINCIPAL del comprobante (el gasto o el ingreso).
 * El desglose completo de la póliza —IVA cobrado/no cobrado, la contracuenta de
 * clientes o proveedores— lo arma la regla contable cuando se genere la póliza;
 * esto es el dato del que esa regla parte.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tag, Check, Users, RefreshCw, FileText, PlayCircle, Trash2, X } from 'lucide-react';
import { api } from '@/services/api';

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const money = (n: any, m = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: (m || 'MXN').trim() || 'MXN' }).format(Number(n) || 0);
const fecha = (s?: string) => s ? new Date(s).toLocaleDateString('es-MX') : '—';

export function AsignacionCuentaPage() {
  const hoy = new Date();
  const qc = useQueryClient();
  const [dir, setDir] = useState<'recibidos' | 'emitidos'>('recibidos');
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);

  const ctasQ = useQuery({ queryKey: ['ctas-mov'], queryFn: () => api.getCuentasContables() });
  const cuentas: any[] = (ctasQ.data?.data?.cuentas || []).filter((c: any) => c.permite_movimientos);

  const claveVista = ['sat-vista-asig', dir, anio, mes];
  const compQ = useQuery({
    queryKey: claveVista,
    queryFn: () => api.getSatComprobantesVista({ direccion: dir, anio, mes }),
  });
  const filas: any[] = compQ.data?.data?.comprobantes || [];
  const asignados = filas.filter((f) => f.cuenta_contable).length;

  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);
  const nombreCuenta = useMemo(() => {
    const m = new Map<string, string>();
    cuentas.forEach((c) => m.set(c.codigo, c.nombre));
    return m;
  }, [cuentas]);

  const guardar = async (id: string, codigo: string | null) => {
    await api.setSatCuentaContable(id, codigo);
    qc.invalidateQueries({ queryKey: claveVista });
  };
  const aplicarPorRfc = async (rfc: string, codigo: string) => {
    if (!rfc || !codigo) return;
    const objetivo = filas.filter((f) => f.contraparte_rfc === rfc);
    await Promise.all(objetivo.map((f) => api.setSatCuentaContable(f.id, codigo)));
    qc.invalidateQueries({ queryKey: claveVista });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Tag size={24} className="text-amber-600" /> Asignación de cuenta
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          A qué cuenta del catálogo pertenece cada comprobante del mes. Es de donde la
          balanza toma sus movimientos.
        </p>
      </div>

      {/* Controles */}
      <div className="bg-white rounded-lg shadow border p-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border overflow-hidden text-sm">
          {(['recibidos', 'emitidos'] as const).map((d) => (
            <button key={d} onClick={() => setDir(d)}
              className={`px-4 py-2 ${dir === d ? 'bg-amber-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {d === 'recibidos' ? 'Recibidos (gasto)' : 'Emitidos (ingreso)'}
            </button>
          ))}
        </div>
        <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input py-1.5 text-sm">
          {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input py-1.5 text-sm w-24">
          {anios.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className={asignados === filas.length && filas.length > 0 ? 'text-emerald-700' : 'text-gray-600'}>
            {asignados} de {filas.length} asignados
          </span>
          <button onClick={() => compQ.refetch()} className="text-gray-500 hover:text-gray-700" title="Actualizar">
            <RefreshCw size={16} className={compQ.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {ctasQ.data && cuentas.length === 0 && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
          El catálogo no tiene cuentas de movimiento todavía. Créalas en «Catálogo de cuentas»
          antes de asignar.
        </p>
      )}

      {/* Lista de cuentas para el autocompletado (una sola vez) */}
      <datalist id="ctas-mov">
        {cuentas.map((c) => <option key={c.id} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
      </datalist>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Fecha</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Folio</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">{dir === 'recibidos' ? 'Proveedor' : 'Cliente'}</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Tipo</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Total</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 w-72">Cuenta contable</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {compQ.isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>}
            {!compQ.isLoading && filas.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 italic">
                Sin comprobantes en {MESES[mes]} {anio}.
              </td></tr>
            )}
            {filas.map((f) => (
              <Renglon key={f.id} f={f} nombreCuenta={nombreCuenta}
                onGuardar={guardar} onAplicarRfc={aplicarPorRfc} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Paso 1 del motor: de emitidos asignados nacen las pólizas de venta. */}
      {dir === 'emitidos' && <PolizasPanel anio={anio} mes={mes} />}
    </div>
  );
}

/* ── Pólizas de venta del mes (emitidos) ──────────────────────────────────── */
function PolizasPanel({ anio, mes }: { anio: number; mes: number }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [omitidas, setOmitidas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);
  const [ver, setVer] = useState(false);

  const generar = async () => {
    setCargando(true); setMsg(''); setOmitidas([]);
    try {
      const r: any = await api.generarVentas(anio, mes);
      setMsg(`${r.data.creadas} póliza(s) de venta creada(s).`);
      setOmitidas(r.data.omitidas || []);
      qc.invalidateQueries({ queryKey: ['polizas', anio, mes] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo generar'); }
    finally { setCargando(false); }
  };
  const regenerar = async () => {
    if (!window.confirm('¿Borrar las pólizas de CFDI de este mes y volver a generarlas?')) return;
    setCargando(true); setMsg('');
    try { await api.borrarPolizasCfdi(anio, mes); await generar(); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo regenerar'); setCargando(false); }
  };

  return (
    <div className="bg-white rounded-lg shadow border p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold flex items-center gap-2">
          <FileText size={18} className="text-amber-600" /> Pólizas de venta
        </h3>
        <span className="text-xs text-gray-500">De cada factura con cuenta asignada. No duplica.</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={generar} disabled={cargando}
            className="flex items-center gap-1.5 bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm">
            <PlayCircle size={15} /> {cargando ? 'Generando…' : 'Generar'}
          </button>
          <button onClick={() => setVer(true)}
            className="border px-3 py-1.5 rounded-lg hover:bg-gray-50 text-sm">Ver pólizas</button>
          <button onClick={regenerar} disabled={cargando}
            title="Borrar las de CFDI y regenerar (arranque)"
            className="text-gray-400 hover:text-rose-600"><Trash2 size={15} /></button>
        </div>
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
      {ver && <PolizasModal anio={anio} mes={mes} onClose={() => setVer(false)} />}
    </div>
  );
}

function PolizasModal({ anio, mes, onClose }: { anio: number; mes: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ['polizas', anio, mes], queryFn: () => api.getPolizas(anio, mes) });
  const polizas: any[] = q.data?.data?.polizas || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white rounded-t-xl">
          <h3 className="font-semibold">Pólizas de {MESES[mes]} {anio}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-3">
          {q.isLoading && <p className="text-center text-gray-500 py-6">Cargando…</p>}
          {!q.isLoading && polizas.length === 0 && (
            <p className="text-center text-gray-500 italic py-6">Sin pólizas en el mes. Genera desde el botón.</p>
          )}
          {polizas.map((p) => {
            const cargos = (p.lineas || []).reduce((a: number, l: any) => a + Number(l.cargo || 0), 0);
            const abonos = (p.lineas || []).reduce((a: number, l: any) => a + Number(l.abono || 0), 0);
            return (
              <div key={p.id} className="border rounded-lg overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50 border-b text-sm">
                  <b>#{p.folio}</b>
                  <span className="text-xs bg-gray-200 rounded px-1.5 py-0.5">{p.tipo}</span>
                  <span className="text-gray-500">{fecha(p.fecha)}</span>
                  <span className="text-gray-700 truncate">{p.concepto}</span>
                  <span className="ml-auto text-[10px] text-gray-400">{p.origen} · {p.regla || '—'}</span>
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {(p.lineas || []).map((l: any, i: number) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-3 py-1 font-mono text-gray-500 w-20">{l.codigo}</td>
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
    </div>
  );
}

function Renglon({ f, nombreCuenta, onGuardar, onAplicarRfc }: {
  f: any; nombreCuenta: Map<string, string>;
  onGuardar: (id: string, codigo: string | null) => void;
  onAplicarRfc: (rfc: string, codigo: string) => void;
}) {
  const [val, setVal] = useState(f.cuenta_contable || '');
  const guardar = () => { if ((val || '') !== (f.cuenta_contable || '')) onGuardar(f.id, val.trim() || null); };

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2 text-sm whitespace-nowrap">{fecha(f.fecha_emision)}</td>
      <td className="px-4 py-2 text-sm">{[f.serie, f.folio].filter(Boolean).join('-') || '—'}</td>
      <td className="px-4 py-2 text-sm">
        <p className="truncate max-w-xs">{f.contraparte_nombre || '—'}</p>
        <p className="text-xs text-gray-400 font-mono">{f.contraparte_rfc}</p>
      </td>
      <td className="px-4 py-2 text-center text-xs">{f.tipo_comprobante || '—'}</td>
      <td className="px-4 py-2 text-right font-medium whitespace-nowrap">{money(f.total, f.moneda)}</td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <input list="ctas-mov" value={val} onChange={(e) => setVal(e.target.value)}
            onBlur={guardar} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="Cuenta…" className="input py-1 text-sm w-40" />
          {val && nombreCuenta.get(val) && (
            <span className="text-xs text-gray-500 truncate max-w-[10rem]" title={nombreCuenta.get(val)}>
              {nombreCuenta.get(val)}
            </span>
          )}
          {val && f.contraparte_rfc && (
            <button onClick={() => onAplicarRfc(f.contraparte_rfc, val.trim())}
              title={`Aplicar esta cuenta a todos los de ${f.contraparte_rfc}`}
              className="text-gray-400 hover:text-amber-600 shrink-0"><Users size={15} /></button>
          )}
          {f.cuenta_contable === val && val && <Check size={15} className="text-emerald-500 shrink-0" />}
        </div>
      </td>
    </tr>
  );
}

export default AsignacionCuentaPage;
