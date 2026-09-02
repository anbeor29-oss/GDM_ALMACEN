/**
 * Pólizas — el libro diario: TODAS las pólizas del mes (ventas, compras, cobros/
 * pagos, nómina y manuales), como se van generando, con opción de eliminar.
 *
 * No las genera: para eso están las pantallas de cada origen. Aquí se ven juntas
 * y se puede borrar una que salió mal (el asiento y sus partidas).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Trash2, AlertTriangle, Pencil, Plus, Save, X } from 'lucide-react';
import api from '@/services/api';
import { CampoFecha } from '@/components/CampoFecha';
import { PartidasPoliza, fmt2, type LineaPoliza } from '@/components/contabilidad/PartidasPoliza';
import { formatCuenta, useMascara } from '@/utils/cuenta';
import { useEjercicios } from '@/components/SelectorPeriodo';

const money = (n: any) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const fecha = (s?: string) => s ? new Date(s + (String(s).length <= 10 ? 'T12:00:00' : '')).toLocaleDateString('es-MX') : '—';
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Clasifica cada póliza en un origen legible, por su regla/origen. */
function categoria(p: any): 'venta' | 'compra' | 'cobropago' | 'nomina' | 'manual' | 'otro' {
  const r = String(p.regla || '');
  if (/^ventas/.test(r)) return 'venta';
  if (/^compras/.test(r)) return 'compra';
  if (/^(cobro|pago)/.test(r)) return 'cobropago';
  if (p.origen === 'NOMINA' || /^nomina/.test(r)) return 'nomina';
  if (p.origen === 'MANUAL' || r === 'manual') return 'manual';
  return 'otro';
}
const ETIQUETA: Record<string, string> = {
  venta: 'Venta', compra: 'Compra', cobropago: 'Cobro/Pago', nomina: 'Nómina', manual: 'Manual', otro: 'Otro',
};
const FILTROS = [
  ['', 'Todas'], ['venta', 'Ventas'], ['compra', 'Compras'],
  ['cobropago', 'Cobros/Pagos'], ['nomina', 'Nómina'], ['manual', 'Manuales'],
] as const;

export function PolizasListaPage() {
  const hoy = new Date();
  const qc = useQueryClient();
  const mascara = useMascara();
  /* Se puede llegar desde el auxiliar de la balanza con ?editar=<id>&anio&mes:
   * el mes/año arrancan en los del enlace y, al cargar, se abre el editor de esa
   * póliza. Es el «doble clic en la póliza → editarla» pedido desde la balanza. */
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [anio, setAnio] = useState(Number(params.get('anio')) || hoy.getFullYear());
  const [mes, setMes] = useState(Number(params.get('mes')) || hoy.getMonth() + 1);
  const [filtro, setFiltro] = useState<string>('');
  const [msg, setMsg] = useState('');
  const [editar, setEditar] = useState<any>(null);
  /* Si se llegó desde el auxiliar de la balanza, al cerrar/guardar el editor se
   * regresa allá (no a esta lista): es donde estaba trabajando el usuario. */
  const [volverBalanza, setVolverBalanza] = useState(false);
  const anios = useEjercicios(anio);

  const q = useQuery({ queryKey: ['polizas', anio, mes], queryFn: () => api.getPolizas(anio, mes) });
  const todas: any[] = q.data?.data?.polizas || [];

  const aBalanza = () => navigate(`/contabilidad/balanza?anio=${anio}&mes=${mes}`);

  // Abre el editor de la póliza que venga en ?editar=<id> una vez que cargó la lista.
  const editarId = params.get('editar');
  useEffect(() => {
    if (!editarId || !todas.length) return;
    const p = todas.find((x) => x.id === editarId);
    if (p) {
      setEditar(p);
      if (params.get('desde') === 'balanza') setVolverBalanza(true);
      params.delete('editar'); params.delete('anio'); params.delete('mes'); params.delete('desde');
      setParams(params, { replace: true });
    }
  }, [editarId, todas]); // eslint-disable-line react-hooks/exhaustive-deps
  const polizas = useMemo(
    () => todas.filter((p) => !filtro || categoria(p) === filtro),
    [todas, filtro]);

  const borrar = async (p: any) => {
    if (!window.confirm(`¿Borrar la póliza #${p.folio} (${p.concepto || 'sin concepto'})? Esto no se puede deshacer.`)) return;
    setMsg('');
    try {
      await api.borrarPoliza(p.id);
      setMsg(`Póliza #${p.folio} eliminada.`);
      qc.invalidateQueries({ queryKey: ['polizas', anio, mes] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo borrar.'); }
  };

  const cuenta = (c: string) => todas.filter((p) => categoria(p) === c).length;

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BookOpen size={22} className="text-primary" /> Pólizas
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          El libro diario del mes: todas las pólizas según se generan. Se pueden eliminar.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input py-1.5 text-sm">
          {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input py-1.5 text-sm w-24">
          {anios.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="flex flex-wrap gap-1 ml-2">
          {FILTROS.map(([k, label]) => (
            <button key={k} onClick={() => setFiltro(k)}
              className={`px-2.5 py-1 rounded-lg text-xs border ${
                filtro === k ? 'bg-primary text-white border-primary' : 'text-gray-600 hover:bg-gray-50'}`}>
              {label}{k && cuenta(k) > 0 ? ` (${cuenta(k)})` : ''}
            </button>
          ))}
        </div>
      </div>

      {msg && <p className="text-sm text-emerald-700">{msg}</p>}

      <div className="space-y-2">
        {q.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}
        {!q.isLoading && polizas.length === 0 && (
          <p className="text-sm text-gray-500 italic bg-white border rounded-lg p-4 text-center">
            Sin pólizas {filtro ? `de ${ETIQUETA[filtro].toLowerCase()} ` : ''}en {MESES[mes]} {anio}.
          </p>
        )}
        {polizas.map((p) => {
          const cargos = (p.lineas || []).reduce((a: number, l: any) => a + Number(l.cargo || 0), 0);
          const abonos = (p.lineas || []).reduce((a: number, l: any) => a + Number(l.abono || 0), 0);
          const cuadra = Math.abs(cargos - abonos) <= 0.02;
          return (
            <div key={p.id} className="bg-white border rounded-lg overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50 border-b text-sm">
                <b>#{p.folio}</b>
                <span className="text-gray-500">{fecha(p.fecha)}</span>
                <span className="text-gray-700 truncate">{p.concepto}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">{ETIQUETA[categoria(p)]}</span>
                {!cuadra && (
                  <span className="text-[10px] text-rose-600 flex items-center gap-0.5"><AlertTriangle size={11} /> descuadrada</span>
                )}
                <button onClick={() => setEditar(p)} title="Editar póliza"
                  className="ml-auto text-gray-300 hover:text-primary"><Pencil size={14} /></button>
                <button onClick={() => borrar(p)} title="Eliminar póliza"
                  className="text-gray-300 hover:text-rose-500"><Trash2 size={15} /></button>
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

      {editar && (
        <EditorPoliza
          poliza={editar}
          onCerrar={() => { setEditar(null); if (volverBalanza) { setVolverBalanza(false); aBalanza(); } }}
          onGuardado={async () => {
            setEditar(null);
            qc.invalidateQueries({ queryKey: ['polizas', anio, mes] });
            if (volverBalanza) {
              setVolverBalanza(false);
              /* Se volvió a editar desde la balanza: se recalcula para que refleje
               * el cambio y se regresa allá, que es donde estaba el usuario. */
              try { await api.actualizarBalanzaDesdePolizas(anio, mes); } catch { /* la balanza se puede actualizar a mano */ }
              qc.invalidateQueries({ queryKey: ['balanza-periodo', anio, mes] });
              aBalanza();
            } else {
              setMsg('Póliza actualizada.');
            }
          }}
        />
      )}
    </div>
  );
}

/* ── Editor de una póliza (reemplaza sus partidas; cuadra o no se guarda) ── */
const TIPO_POLIZA_LABEL: Record<string, string> = { DIARIO: 'Diario', INGRESO: 'Ingreso', EGRESO: 'Egreso' };

function EditorPoliza({ poliza, onCerrar, onGuardado }: any) {
  const [fecha, setFecha] = useState<string>(String(poliza.fecha || '').slice(0, 10));
  const [concepto, setConcepto] = useState<string>(poliza.concepto || '');
  const [lineas, setLineas] = useState<LineaPoliza[]>(
    (poliza.lineas || []).map((l: any) => ({
      codigo: l.codigo || '', nombre: l.nombre || '', concepto: l.concepto || '',
      cargo: Number(l.cargo) > 0 ? String(l.cargo) : '',
      abono: Number(l.abono) > 0 ? String(l.abono) : '',
    })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ctasQ = useQuery({ queryKey: ['ctas-mov'], queryFn: () => api.getCuentasContables() });
  const cuentas: any[] = (ctasQ.data?.data?.cuentas || []).filter((c: any) => c.permite_movimientos);

  const onLinea = (i: number, patch: Partial<LineaPoliza>) => {
    setLineas((ls) => ls.map((l, k) => {
      if (k !== i) return l;
      const nl = { ...l, ...patch };
      if (patch.cargo) nl.abono = '';
      if (patch.abono) nl.cargo = '';
      return nl;
    }));
    setError('');
  };
  const cuadrar = (i: number, campo: 'cargo' | 'abono') => {
    setLineas((ls) => {
      const oc = round2(ls.reduce((a, l, k) => a + (k === i ? 0 : Number(l.cargo) || 0), 0));
      const oa = round2(ls.reduce((a, l, k) => a + (k === i ? 0 : Number(l.abono) || 0), 0));
      const falta = campo === 'cargo' ? round2(oa - oc) : round2(oc - oa);
      if (falta <= 0) return ls;
      return ls.map((l, k) => k === i ? { ...l, cargo: campo === 'cargo' ? String(falta) : '', abono: campo === 'abono' ? String(falta) : '' } : l);
    });
  };
  const agregar = () => setLineas((ls) => [...ls, { codigo: '', concepto: '', cargo: '', abono: '' }]);
  const quitar = (i: number) => setLineas((ls) => ls.length > 1 ? ls.filter((_, k) => k !== i) : ls);

  const sumaCargo = round2(lineas.reduce((a, l) => a + (Number(l.cargo) || 0), 0));
  const sumaAbono = round2(lineas.reduce((a, l) => a + (Number(l.abono) || 0), 0));
  const cuadra = sumaCargo > 0 && sumaCargo === sumaAbono;

  const guardar = async () => {
    setBusy(true); setError('');
    try {
      await api.editarPoliza(poliza.id, {
        fecha, concepto: concepto.trim(),
        lineas: lineas
          .filter((l) => l.codigo && (Number(l.cargo) > 0 || Number(l.abono) > 0))
          .map((l) => ({ codigo: l.codigo.trim(), concepto: l.concepto.trim() || undefined, cargo: Number(l.cargo) || 0, abono: Number(l.abono) || 0 })),
      });
      onGuardado();
    } catch (e: any) { setError(e?.response?.data?.message || e.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto ring-1 ring-indigo-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 sticky top-0 bg-gradient-to-r from-indigo-700 to-indigo-600 text-white z-10">
          <div className="flex items-center gap-2.5">
            <h3 className="font-semibold text-base">Editar póliza #{poliza.folio}</h3>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/25 font-medium">
              {TIPO_POLIZA_LABEL[poliza.tipo] || poliza.tipo || 'Diario'}
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/15">{ETIQUETA[categoria(poliza)]}</span>
          </div>
          <button onClick={onCerrar} className="text-white/80 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid sm:grid-cols-[9rem_1fr] gap-3">
            <label className="block">
              <span className="text-xs text-gray-600">Fecha</span>
              <CampoFecha value={fecha} onChange={setFecha} className="input w-full" />
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">Concepto</span>
              <input value={concepto} onChange={(e) => setConcepto(e.target.value)} className="input w-full" />
            </label>
          </div>

          <PartidasPoliza lineas={lineas} cuentas={cuentas}
            sumaCargo={sumaCargo} sumaAbono={sumaAbono}
            onLinea={onLinea} onCuadrar={cuadrar} onQuitar={quitar} idBase="editar-poliza" />

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={agregar} className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"><Plus size={14} /> Agregar renglón</button>
            <span className={`text-sm ${cuadra ? 'text-emerald-700' : 'text-gray-500'}`}>
              {cuadra ? 'Sumas iguales' : sumaCargo === sumaAbono ? 'Captura los importes' : `Diferencia ${fmt2(round2(sumaCargo - sumaAbono))}`}
            </span>
            <button onClick={guardar} disabled={busy || !cuadra}
              className="ml-auto flex items-center gap-1.5 bg-primary text-white px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
              <Save size={15} /> {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
          {error && <p className="text-sm text-rose-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}

export default PolizasListaPage;
