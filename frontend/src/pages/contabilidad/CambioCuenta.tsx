/**
 * Cambio de cuenta — mantenimiento del catálogo tras una migración.
 *
 *   · Sustituir temporal: mover las partidas de una cuenta (la temporal
 *     MIG-TEMPORAL) a una cuenta real del catálogo, opcional por rango de fechas.
 *   · Unificar duplicadas: cuando el mismo tercero quedó capturado dos veces (por
 *     un typo o mayúsculas/minúsculas), fusionar una cuenta en la otra y borrar la
 *     sobrante, sin duplicar.
 *
 * Tras cualquiera, el backend recalcula la balanza de los años afectados.
 */
import { useState, useEffect } from 'react';
import api from '@/services/api';
import { ArrowLeftRight, GitMerge, Search, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatCuenta, useMascara } from '@/utils/cuenta';
import { fechaMx } from '@/utils/fecha';

type Cuenta = { id: string; codigo: string; nombre: string; permite_movimientos?: boolean };

const money = (n: any) => Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/** Las partidas (renglones de póliza) que tocan una cuenta, con su rango de fechas.
 *  Para ver qué hay en MIG-TEMPORAL —y desde cuándo— o en la cuenta origen. */
function PartidasDe({ cuentaId }: { cuentaId?: string }) {
  const [data, setData] = useState<any>(null);
  const [cargando, setCargando] = useState(false);
  useEffect(() => {
    if (!cuentaId) { setData(null); return; }
    let alive = true; setCargando(true);
    api.getPartidasCuenta(cuentaId)
      .then((r: any) => { if (alive) setData(r?.data || null); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setCargando(false); });
    return () => { alive = false; };
  }, [cuentaId]);
  if (!cuentaId) return null;
  if (cargando) return <p className="text-sm text-gray-400">Cargando pólizas…</p>;
  if (!data) return null;

  return (
    <div className="bg-white rounded-lg shadow border p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold text-gray-800">{data.total} partida(s)</span>
        {data.total > 0 && <span className="text-gray-500">del <b>{fechaMx(data.desde)}</b> al <b>{fechaMx(data.hasta)}</b></span>}
        {data.total > 0 && <span className="text-gray-500">cargos {money(data.cargo)} · abonos {money(data.abono)}</span>}
      </div>
      {data.total === 0 ? (
        <p className="text-sm text-gray-400">Sin partidas en esta cuenta.</p>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b text-gray-500 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1">Fecha</th>
                <th className="text-left px-2 py-1">Póliza</th>
                <th className="text-left px-2 py-1">Concepto</th>
                <th className="text-right px-2 py-1">Cargo</th>
                <th className="text-right px-2 py-1">Abono</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.partidas.map((x: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-2 py-1 whitespace-nowrap">{fechaMx(x.fecha)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">#{x.folio ?? '—'} <span className="text-gray-400">{x.origen}</span></td>
                  <td className="px-2 py-1 truncate max-w-xs">{x.concepto || x.linea_concepto || '—'}</td>
                  <td className="px-2 py-1 text-right">{Number(x.cargo) > 0 ? money(x.cargo) : ''}</td>
                  <td className="px-2 py-1 text-right">{Number(x.abono) > 0 ? money(x.abono) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.truncado && <p className="text-xs text-gray-400 mt-1">Se muestran las primeras {data.partidas.length}. Reasigna por rango de fechas si son muchas.</p>}
        </div>
      )}
    </div>
  );
}

/** Buscador de cuenta que devuelve la cuenta elegida (id, código, nombre). */
function BuscarCuenta({ etiqueta, elegida, onElegir, soloMovimientos }: {
  etiqueta: string; elegida: Cuenta | null;
  onElegir: (c: Cuenta | null) => void; soloMovimientos?: boolean;
}) {
  const mascara = useMascara();
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<Cuenta[]>([]);
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setOpts([]); return; }
    const t = setTimeout(() => {
      api.getCuentasContables({ q: q.trim(), soloMovimientos })
        .then((r: any) => setOpts(r?.data?.cuentas || [])).catch(() => setOpts([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, soloMovimientos]);

  return (
    <div className="relative">
      <label className="text-xs text-gray-500">{etiqueta}</label>
      {elegida ? (
        <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-emerald-50 border-emerald-200">
          <span className="font-mono text-sm text-gray-800">{formatCuenta(elegida.codigo, mascara)}</span>
          <span className="text-sm text-gray-600 truncate flex-1">{elegida.nombre}</span>
          <button onClick={() => { onElegir(null); setQ(''); }} className="text-xs text-gray-400 hover:text-rose-600">cambiar</button>
        </div>
      ) : (
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setAbierto(true); }}
            onFocus={() => setAbierto(true)}
            placeholder="Código o nombre de la cuenta…" className="input w-full pl-8" />
          {abierto && opts.length > 0 && (
            <div className="absolute z-20 mt-1 w-full max-h-60 overflow-auto bg-white border rounded-lg shadow-lg text-sm">
              {opts.map((c) => (
                <button key={c.id} onClick={() => { onElegir(c); setAbierto(false); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-sky-50 flex items-center gap-2">
                  <span className="font-mono text-gray-700">{formatCuenta(c.codigo, mascara)}</span>
                  <span className="text-gray-600 truncate">{c.nombre}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CambioCuentaPage() {
  const mascara = useMascara();
  const [tab, setTab] = useState<'temporal' | 'unificar'>('temporal');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // ── Sustituir temporal ──
  const [origen, setOrigen] = useState<Cuenta | null>(null);
  const [destino, setDestino] = useState<Cuenta | null>(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  // Precarga la cuenta temporal (MIG-TEMPORAL) como origen por defecto.
  useEffect(() => {
    api.getCuentasContables({ q: 'MIG-TEMPORAL' })
      .then((r: any) => { const c = (r?.data?.cuentas || [])[0]; if (c) setOrigen(c); })
      .catch(() => {});
  }, []);

  const reasignar = async () => {
    if (!origen || !destino) { setError('Elige la cuenta origen y la destino.'); return; }
    setBusy(true); setError(''); setMsg('');
    try {
      const r: any = await api.reasignarCuenta(origen.id, destino.id, desde || undefined, hasta || undefined);
      setMsg(r?.message || 'Listo.');
    } catch (e: any) { setError(e?.response?.data?.message || e?.message || 'No se pudo reasignar.'); }
    finally { setBusy(false); }
  };

  // ── Unificar duplicadas ──
  const [q, setQ] = useState('');
  const [grupos, setGrupos] = useState<Cuenta[][]>([]);
  const [cargando, setCargando] = useState(false);
  const [verId, setVerId] = useState<string | null>(null);   // cuenta cuyas pólizas se ven
  const buscarDuplicadas = async () => {
    setCargando(true); setError(''); setMsg('');
    try {
      const r: any = await api.cuentasDuplicadas(q.trim() || undefined);
      setGrupos(r?.data?.grupos || []);
    } catch (e: any) { setError(e?.response?.data?.message || e?.message || 'No se pudo buscar.'); }
    finally { setCargando(false); }
  };
  const fusionar = async (origenId: string, destinoId: string) => {
    if (!confirm('¿Fusionar esta cuenta en la otra? Se moverán sus partidas y se borrará la cuenta origen. No se puede deshacer.')) return;
    setBusy(true); setError(''); setMsg('');
    try {
      const r: any = await api.fusionarCuenta(origenId, destinoId);
      setMsg(r?.message || 'Cuentas unificadas.');
      await buscarDuplicadas();
    } catch (e: any) { setError(e?.response?.data?.message || e?.message || 'No se pudo fusionar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ArrowLeftRight size={22} className="text-primary" /> Cambio de cuenta
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Sustituye la cuenta temporal de migración por una real, y unifica cuentas duplicadas.
          El sistema mueve las partidas y recalcula la balanza de los años afectados.
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {([['temporal', 'Sustituir cuenta temporal', ArrowLeftRight], ['unificar', 'Unificar duplicadas', GitMerge]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => { setTab(k); setMsg(''); setError(''); }}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px ${tab === k ? 'border-primary text-primary font-semibold' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>}
      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-3 text-sm flex items-start gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{msg}</div>}

      {tab === 'temporal' && (
        <div className="bg-white rounded-lg shadow border p-5 space-y-4">
          <p className="text-sm text-gray-600">
            Mueve las partidas de la cuenta <b>origen</b> (por defecto la temporal de migración)
            a la cuenta <b>destino</b>. Si pones fechas, sólo mueve las de ese rango.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <BuscarCuenta etiqueta="Cuenta origen (la que se vacía)" elegida={origen} onElegir={setOrigen} />
            <BuscarCuenta etiqueta="Cuenta destino (la real del catálogo)" elegida={destino} onElegir={setDestino} soloMovimientos />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-gray-500 block">Desde (opcional)</label>
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="input" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block">Hasta (opcional)</label>
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="input" />
            </div>
            <button onClick={reasignar} disabled={busy || !origen || !destino}
              className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-40 text-sm font-semibold">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowLeftRight size={16} />} Reasignar
            </button>
          </div>
        </div>
      )}

      {tab === 'temporal' && origen && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">
            Pólizas en «{origen.nombre}» — para saber qué reasignar y desde qué fecha:
          </p>
          <PartidasDe cuentaId={origen.id} />
        </div>
      )}

      {tab === 'unificar' && (
        <div className="bg-white rounded-lg shadow border p-5 space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') buscarDuplicadas(); }}
                placeholder="Nombre o código (deja vacío para ver todas las duplicadas)…" className="input w-full pl-8" />
            </div>
            <button onClick={buscarDuplicadas} disabled={cargando}
              className="flex items-center gap-2 border px-4 py-2 rounded-lg hover:bg-gray-50 text-sm text-gray-700 disabled:opacity-40">
              {cargando ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Buscar duplicadas
            </button>
          </div>

          {grupos.length === 0 && !cargando && (
            <p className="text-sm text-gray-400">Sin grupos de cuentas con el mismo nombre. Da «Buscar duplicadas».</p>
          )}

          {grupos.map((g, i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2">
              <p className="text-xs text-gray-500">Mismo nombre — <b>{g[0].nombre}</b>. Deja una y funde las demás en ella:</p>
              {g.map((c) => (
                <div key={c.id}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-gray-700 w-40">{formatCuenta(c.codigo, mascara)}</span>
                    <span className="text-gray-600 flex-1 truncate">{c.nombre}</span>
                    <button onClick={() => setVerId(verId === c.id ? null : c.id)}
                      className="text-xs text-gray-500 hover:text-primary underline whitespace-nowrap">
                      {verId === c.id ? 'ocultar' : 'ver pólizas'}
                    </button>
                    <div className="flex gap-1">
                      {g.filter((o) => o.id !== c.id).map((o) => (
                        <button key={o.id} onClick={() => fusionar(c.id, o.id)} disabled={busy}
                          title={`Mover «${c.codigo}» a «${o.codigo}» y borrar «${c.codigo}»`}
                          className="flex items-center gap-1 border px-2 py-0.5 rounded text-xs text-gray-600 hover:bg-sky-50 disabled:opacity-40">
                          <GitMerge size={12} /> fundir en {formatCuenta(o.codigo, mascara)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {verId === c.id && <div className="mt-2"><PartidasDe cuentaId={c.id} /></div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
