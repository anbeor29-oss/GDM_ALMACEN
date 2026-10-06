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
import { BookOpen, Trash2, AlertTriangle, Pencil, Plus, Save, X, PlayCircle, Eye, Printer, ChevronRight, ChevronDown, Wand2, CheckCircle2, Stethoscope } from 'lucide-react';
import api from '@/services/api';
import { CampoFecha } from '@/components/CampoFecha';
import { PartidasPoliza, fmt2, type LineaPoliza } from '@/components/contabilidad/PartidasPoliza';
import { TablaComprobantesSat } from '@/components/TablaComprobantesSat';
import { formatCuenta, useMascara } from '@/utils/cuenta';
import { aniosContables } from '@/utils/anios';
import { usePeriodoTrabajo } from '@/utils/periodoActivo';

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
  // Las de conciliación bancaria (origen BANCO: 'otro'/comisión/tarjeta que no
  // casaron con un CFDI) se organizan como MANUALES —son asientos que el usuario
  // arma/confirma a mano—. Los cobros/pagos de banco casados ya salieron arriba
  // por su regla (cobro/pago/pago_pue).
  if (p.origen === 'MANUAL' || p.origen === 'BANCO' || r === 'manual') return 'manual';
  return 'otro';
}
const ETIQUETA: Record<string, string> = {
  venta: 'Venta', compra: 'Compra', cobropago: 'Cobro/Pago', nomina: 'Nómina', manual: 'Manual', otro: 'Otro',
};
/** Color por tipo de póliza: pastilla del badge, acento del renglón y punto del filtro. */
const COLOR_CAT: Record<string, { badge: string; accent: string; dot: string }> = {
  venta:     { badge: 'bg-emerald-100 text-emerald-700', accent: 'border-l-emerald-400', dot: 'bg-emerald-500' },
  compra:    { badge: 'bg-sky-100 text-sky-700',         accent: 'border-l-sky-400',     dot: 'bg-sky-500' },
  cobropago: { badge: 'bg-violet-100 text-violet-700',   accent: 'border-l-violet-400',  dot: 'bg-violet-500' },
  nomina:    { badge: 'bg-amber-100 text-amber-700',     accent: 'border-l-amber-400',   dot: 'bg-amber-500' },
  manual:    { badge: 'bg-slate-100 text-slate-600',     accent: 'border-l-slate-300',   dot: 'bg-slate-400' },
  otro:      { badge: 'bg-gray-100 text-gray-600',       accent: 'border-l-gray-300',    dot: 'bg-gray-400' },
};
const FILTROS = [
  ['', 'Todas'], ['venta', 'Ventas'], ['compra', 'Compras'],
  ['cobropago', 'Cobros/Pagos'], ['nomina', 'Nómina'], ['manual', 'Manuales'],
  // PPD/PUE no es un origen de póliza: es la pantalla de comprobantes recibidos
  // (el mismo menú de EML → Recibidos) para, con doble clic, contabilizar el pago
  // de las facturas recibidas con método PUE. No lleva conteo de pólizas.
  ['ppdpue', 'PPD/PUE'],
] as const;

export function PolizasListaPage() {
  const qc = useQueryClient();
  const mascara = useMascara();
  /* Se puede llegar desde el auxiliar de la balanza con ?editar=<id>&anio&mes:
   * el mes/año arrancan en los del enlace y, al cargar, se abre el editor de esa
   * póliza. Es el «doble clic en la póliza → editarla» pedido desde la balanza. */
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Arranca en el mes de trabajo (siguiente al último cerrado); la URL lo puede fijar.
  const pAnio = params.get('anio') ? Number(params.get('anio')) : undefined;
  const pMes = params.get('mes') != null && params.get('mes') !== '' ? Number(params.get('mes')) : undefined;
  const { anio, mes, setAnio, setMes } = usePeriodoTrabajo(pAnio, pMes);
  const [filtro, setFiltro] = useState<string>('');
  const [msg, setMsg] = useState('');
  const [generando, setGenerando] = useState('');
  const [todoAnio, setTodoAnio] = useState(false);
  const [editar, setEditar] = useState<any>(null);
  const [previa, setPrevia] = useState<any>(null);   // póliza en previsualización/PDF
  /* Lista COMPACTA: cada póliza es un solo renglón (folio + concepto); con doble
   * clic (o el chevron) se despliegan sus partidas. Se recuerda cuáles están
   * abiertas para no cerrarlas al refrescar. El #folio en azul abre el editor. */
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const alternar = (id: string) => setAbiertas((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  /* Si se llegó desde el auxiliar de la balanza, al cerrar/guardar el editor se
   * regresa allá (no a esta lista): es donde estaba trabajando el usuario. */
  const [volverBalanza, setVolverBalanza] = useState(false);
  /* Igual que volverBalanza, pero para «Cambio de cuenta»: si se llegó a editar desde
   * ahí (?desde=cambio&cuenta=<id>), al cerrar/guardar se regresa a esa pantalla con
   * la cuenta ya seleccionada, para seguir cuadrando. */
  const [volverCambio, setVolverCambio] = useState(false);
  const [cuentaCambio, setCuentaCambio] = useState('');
  const anios = aniosContables();

  const q = useQuery({ queryKey: ['polizas', anio, mes], queryFn: () => api.getPolizas(anio, mes) });
  const todas: any[] = q.data?.data?.polizas || [];

  const aBalanza = () => navigate(`/contabilidad/balanza?anio=${anio}&mes=${mes}`);
  const aCambio = () => navigate(`/contabilidad/cambio-cuenta${cuentaCambio ? `?cuenta=${cuentaCambio}` : ''}`);

  // Generar las pólizas del mes desde AQUÍ: todo se concentra en Contabilidad. La
  // asignación de cuentas de cada tipo se hace en su pantalla de «asignar cuenta».
  const generar = async (tipo: string, fn: () => Promise<any>) => {
    setGenerando(tipo); setMsg('');
    try {
      const r: any = await fn();
      setMsg(r?.message || r?.data?.message || 'Pólizas generadas.');
      await qc.invalidateQueries({ queryKey: ['polizas', anio, mes] });
    } catch (e: any) { setMsg(e?.response?.data?.message || e?.message || 'No se pudo generar.'); }
    finally { setGenerando(''); }
  };
  /* Importa las pólizas históricas desde el TXT de CPQ (el catálogo debe estar antes). */
  const importarTxt = async (file: File) => {
    setGenerando('txt'); setMsg('');
    try {
      const fd = new FormData(); fd.append('archivo', file);
      const r: any = await api.importarPolizasTxt(fd);
      let m = r?.message || 'Pólizas importadas.';
      const om = r?.data?.omitidas as Array<{ folio: string; motivo: string }> | undefined;
      if (om?.length) m += ` Omitidas ${om.length}: ${om.slice(0, 2).map((o) => `${o.folio} (${o.motivo})`).join(' · ')}${om.length > 2 ? '…' : ''}.`;
      setMsg(m);
      await qc.invalidateQueries({ queryKey: ['polizas', anio, mes] });
    } catch (e: any) { setMsg(e?.response?.data?.message || e?.message || 'No se pudo importar el TXT.'); }
    finally { setGenerando(''); }
  };
  /* «De un tirón»: asigna cuentas de producto (ventas+compras) con match claro y
   * genera las subcuentas de terceros. Deja sólo los dudosos por revisar. */
  const autoAsignar = async () => {
    setGenerando('auto'); setMsg('');
    try {
      const mesEfectivo = (todoAnio || mes === 0) ? 0 : mes;
      const r: any = await api.autoAsignarCuentasTodo(anio, mesEfectivo);
      const d = r.data;
      const pend = (d.ventas?.pendientes?.length || 0) + (d.compras?.pendientes?.length || 0);
      setMsg(
        `Auto-asignado: ${d.ventas?.asignadas || 0} de venta y ${d.compras?.asignadas || 0} de compra. ` +
        `Subcuentas nuevas: ${d.subClientes?.creadas || 0} cliente(s), ${d.subProveedores?.creadas || 0} proveedor(es). ` +
        (pend ? `Quedan ${pend} producto(s) dudoso(s) por revisar en «Asignar cuentas».` : 'Sin dudosos: todo quedó asignado.'));
      await qc.invalidateQueries({ queryKey: ['polizas', anio, mes] });
    } catch (e: any) { setMsg(e?.response?.data?.message || e?.message || 'No se pudo auto-asignar.'); }
    finally { setGenerando(''); }
  };
  const GENERADORES: Array<[string, string, () => Promise<any>]> = [
    ['ventas', 'Ventas', () => api.generarVentas(anio, mes, todoAnio || mes === 0)],
    ['compras', 'Compras', () => api.generarCompras(anio, mes, todoAnio || mes === 0)],
    ['cobros', 'Cobros/Pagos', () => api.generarCobrosPagos(anio, mes, todoAnio || mes === 0)],
    /* La depreciación es un cálculo MENSUAL (no acumula por año aquí): ignora el
       toggle y siempre corre el mes elegido. */
    ['deprec', 'Depreciación', () => api.generarDepreciacion(anio, mes)],
  ];

  // Abre el editor de la póliza que venga en ?editar=<id> una vez que cargó la lista.
  const editarId = params.get('editar');
  useEffect(() => {
    if (!editarId || !todas.length) return;
    const p = todas.find((x) => x.id === editarId);
    if (p) {
      setEditar(p);
      if (params.get('desde') === 'balanza') setVolverBalanza(true);
      if (params.get('desde') === 'cambio') { setVolverCambio(true); setCuentaCambio(params.get('cuenta') || ''); }
      params.delete('editar'); params.delete('anio'); params.delete('mes'); params.delete('desde'); params.delete('cuenta');
      setParams(params, { replace: true });
    }
  }, [editarId, todas]); // eslint-disable-line react-hooks/exhaustive-deps
  const polizas = useMemo(
    () => todas.filter((p) => !filtro || categoria(p) === filtro),
    [todas, filtro]);
  /* Resumen del periodo para las tarjetas: cuántas pólizas, cargos totales y
   * cuántas quedaron descuadradas. */
  const stats = useMemo(() => {
    let cargos = 0, descuadradas = 0;
    for (const p of todas) {
      const c = (p.lineas || []).reduce((a: number, l: any) => a + Number(l.cargo || 0), 0);
      const a = (p.lineas || []).reduce((s: number, l: any) => s + Number(l.abono || 0), 0);
      cargos += c;
      if (Math.abs(c - a) > 0.02) descuadradas++;
    }
    return { total: todas.length, cargos, descuadradas };
  }, [todas]);

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
    <div className="p-6 space-y-5 max-w-5xl">
      {/* Encabezado con el periodo a la derecha */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <BookOpen size={22} />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">Pólizas</h1>
          <p className="text-sm text-gray-500">Libro diario del mes — todas las pólizas conforme se generan.</p>
        </div>
        {filtro !== 'ppdpue' && (
          <div className="ml-auto flex items-center gap-2">
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input py-1.5 text-sm">
              <option value={0}>Todo el año</option>
              {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input py-1.5 text-sm w-24">
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Tarjetas de resumen */}
      {filtro !== 'ppdpue' && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">Pólizas</p>
            <p className="text-2xl font-bold text-gray-900 tabular-nums">{stats.total}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">Cargos del periodo</p>
            <p className="text-2xl font-bold text-gray-900 tabular-nums">{money(stats.cargos)}</p>
          </div>
          <div className={`rounded-xl border shadow-sm p-3 ${stats.descuadradas > 0 ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}`}>
            <p className="text-[11px] uppercase tracking-wide text-gray-400">Cuadre</p>
            <p className={`text-lg font-bold flex items-center gap-1.5 mt-1 ${stats.descuadradas > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
              {stats.descuadradas > 0
                ? <><AlertTriangle size={16} /> {stats.descuadradas} descuadrada(s)</>
                : <><CheckCircle2 size={16} /> Todo cuadra</>}
            </p>
          </div>
        </div>
      )}

      {/* Filtros por tipo, con color y conteo */}
      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map(([k, label]) => {
          const n = k ? cuenta(k) : todas.length;
          const activo = filtro === k;
          const col = k && k !== 'ppdpue' ? COLOR_CAT[k] : null;
          return (
            <button key={k} onClick={() => setFiltro(k)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                activo ? 'bg-primary text-white border-primary shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {col && <span className={`w-1.5 h-1.5 rounded-full ${activo ? 'bg-white/80' : col.dot}`} />}
              {label}
              {k !== 'ppdpue' && <span className={`tabular-nums ${activo ? 'text-white/80' : 'text-gray-400'}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      {filtro !== 'ppdpue' && (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 w-24 shrink-0">{todoAnio ? `Generar ${anio}` : 'Generar mes'}</span>
          <label className="flex items-center gap-1 text-xs text-gray-500 mr-1" title="Genera Ventas/Compras/Cobros de todos los meses del año (la depreciación sigue siendo mensual)">
            <input type="checkbox" checked={todoAnio} onChange={(e) => setTodoAnio(e.target.checked)} /> todo el año
          </label>
          {GENERADORES.map(([k, label, fn]) => (
            <button key={k} onClick={() => generar(k, fn)} disabled={!!generando}
              className="inline-flex items-center gap-1 border border-gray-200 bg-white px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 hover:border-primary hover:text-primary disabled:opacity-40 transition-colors">
              <PlayCircle size={14} /> {generando === k ? 'Generando…' : label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-gray-100">
          <span className="text-xs font-semibold text-gray-500 w-24 shrink-0">Asignar cuentas</span>
          <button onClick={autoAsignar} disabled={!!generando}
            title="Asigna de un tirón las cuentas de producto con match claro (misma familia SAT) de ventas y compras, y genera las subcuentas de clientes/proveedores. Sólo deja los dudosos por revisar a mano."
            className="inline-flex items-center gap-1 border border-emerald-300 bg-emerald-50 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
            <Wand2 size={14} /> {generando === 'auto' ? 'Asignando…' : 'Auto-asignar todo'}
          </button>
          <button onClick={() => navigate('/invoices/polizas-venta')}
            className="border border-gray-200 bg-white px-3 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-50">Ventas</button>
          <button onClick={() => navigate('/compras/polizas')}
            className="border border-gray-200 bg-white px-3 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-50">Compras</button>
          <label
            title="Importa las pólizas históricas desde el TXT de CPQ. Casa cada renglón por código de cuenta, así que importa el catálogo primero. No duplica: se salta las que ya tengan el mismo UUID."
            className={`ml-auto inline-flex items-center gap-1 border border-violet-300 bg-violet-50 text-violet-700 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer hover:bg-violet-100 ${generando ? 'opacity-40 pointer-events-none' : ''}`}>
            <BookOpen size={14} /> {generando === 'txt' ? 'Importando…' : 'Importar CPQ (.txt)'}
            <input type="file" accept=".txt" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importarTxt(f); e.currentTarget.value = ''; }} />
          </label>
        </div>
      </div>
      )}

      {filtro !== 'ppdpue' && <DiagnosticoCuadre anio={anio} mes={mes} />}

      {msg && filtro !== 'ppdpue' && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>
      )}

      {/* PPD/PUE: la misma pantalla de EML → Recibidos. Doble clic en un recibido
          abre su asiento y genera el pago del CFDI recibido con método PUE. */}
      {filtro === 'ppdpue' ? (
        <TablaComprobantesSat direccion="recibidos" />
      ) : (
      <div className="space-y-2">
        {q.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}
        {!q.isLoading && polizas.length === 0 && (
          <p className="text-sm text-gray-500 italic bg-white border rounded-xl p-6 text-center">
            Sin pólizas {filtro ? `de ${ETIQUETA[filtro].toLowerCase()} ` : ''}en {(MESES[mes] || 'todo el año')} {anio}.
          </p>
        )}
        {polizas.map((p) => {
          const cargos = (p.lineas || []).reduce((a: number, l: any) => a + Number(l.cargo || 0), 0);
          const abonos = (p.lineas || []).reduce((a: number, l: any) => a + Number(l.abono || 0), 0);
          const cuadra = Math.abs(cargos - abonos) <= 0.02;
          const abierta = abiertas.has(p.id);
          const cat = categoria(p);
          const col = COLOR_CAT[cat] || COLOR_CAT.otro;
          return (
            <div key={p.id} className={`bg-white border border-gray-200 border-l-4 ${col.accent} rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden`}>
              {/* Renglón: doble clic en él (o el chevron) despliega/contrae. */}
              <div onDoubleClick={() => alternar(p.id)} title="Doble clic para desplegar o contraer"
                className="group flex items-center gap-2.5 px-3 py-2.5 text-sm cursor-pointer select-none">
                <button onClick={() => alternar(p.id)} onDoubleClick={(e) => e.stopPropagation()}
                  className="text-gray-300 hover:text-gray-600 shrink-0" title={abierta ? 'Contraer' : 'Desplegar'}>
                  {abierta ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <button onClick={() => setEditar(p)} onDoubleClick={(e) => e.stopPropagation()} title="Editar esta póliza (cambios manuales)"
                  className="font-bold text-blue-600 hover:underline tabular-nums shrink-0">#{p.folio}</button>
                <span className="text-gray-400 text-xs shrink-0 w-20 tabular-nums">{fecha(p.fecha)}</span>
                <span className="text-gray-700 truncate flex-1 min-w-0">{p.concepto}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${col.badge}`}>{ETIQUETA[cat]}</span>
                {!cuadra && (
                  <span className="text-[10px] text-rose-600 flex items-center gap-0.5 shrink-0"><AlertTriangle size={11} /> descuadrada</span>
                )}
                <span className="text-sm font-semibold text-gray-800 font-mono tabular-nums shrink-0 w-28 text-right">{money(cargos)}</span>
                <div className="flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setPrevia(p)} onDoubleClick={(e) => e.stopPropagation()} title="Previsualizar / PDF"
                    className="text-gray-300 hover:text-sky-600 p-1"><Eye size={15} /></button>
                  <button onClick={() => setEditar(p)} onDoubleClick={(e) => e.stopPropagation()} title="Editar póliza"
                    className="text-gray-300 hover:text-primary p-1"><Pencil size={14} /></button>
                  <button onClick={() => borrar(p)} onDoubleClick={(e) => e.stopPropagation()} title="Eliminar póliza"
                    className="text-gray-300 hover:text-rose-500 p-1"><Trash2 size={15} /></button>
                </div>
              </div>
              {abierta && (
                <table className="w-full text-xs border-t border-gray-100">
                  <tbody>
                    {(p.lineas || []).map((l: any, i: number) => (
                      <tr key={i} className="border-b border-gray-50 last:border-0">
                        <td className="px-3 py-1.5 font-mono text-gray-500 w-28">{formatCuenta(l.codigo, mascara)}</td>
                        <td className="px-2 py-1.5 text-gray-700">{l.nombre}{l.concepto ? ` · ${l.concepto}` : ''}</td>
                        <td className="px-3 py-1.5 text-right w-28 tabular-nums">{Number(l.cargo) > 0 ? money(l.cargo) : ''}</td>
                        <td className="px-3 py-1.5 text-right w-28 tabular-nums">{Number(l.abono) > 0 ? money(l.abono) : ''}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold bg-gray-50/70">
                      <td colSpan={2} className="px-3 py-1.5 text-right text-gray-600">Sumas</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(cargos)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(abonos)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
      )}

      {previa && <PreviaPoliza poliza={previa} mascara={mascara} onCerrar={() => setPrevia(null)} />}
      {editar && (
        <EditorPoliza
          poliza={editar}
          onCerrar={() => {
            setEditar(null);
            if (volverBalanza) { setVolverBalanza(false); aBalanza(); }
            else if (volverCambio) { setVolverCambio(false); aCambio(); }
          }}
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
            } else if (volverCambio) {
              /* Se editó desde Cambio de cuenta: se regresa allá con la cuenta ya
               * seleccionada para seguir cuadrando. Se recalcula la balanza del mes
               * para que el saldo refleje el ajuste. */
              setVolverCambio(false);
              try { await api.actualizarBalanzaDesdePolizas(anio, mes); } catch { /* se puede actualizar a mano */ }
              aCambio();
            } else {
              setMsg('Póliza actualizada.');
            }
          }}
        />
      )}
    </div>
  );
}

/* ── Previsualización / PDF de una póliza (el UUID del CFDI va en AZUL) ── */
function PreviaPoliza({ poliza, mascara, onCerrar }: any) {
  const lineas: any[] = poliza.lineas || [];
  const cargos = lineas.reduce((a, l) => a + Number(l.cargo || 0), 0);
  const abonos = lineas.reduce((a, l) => a + Number(l.abono || 0), 0);
  const uuid = poliza.origen_uuid || '';

  /* Se abre una ventana con la póliza como documento propio y se manda a imprimir:
   * el usuario elige «Guardar como PDF». Es la misma idea de la previsualización de
   * facturas, pero para la póliza, y con el UUID en azul. */
  const imprimir = () => {
    const filas = lineas.map((l) => `
      <tr>
        <td class="mono">${formatCuenta(l.codigo, mascara)}</td>
        <td>${(l.nombre || '')}${l.concepto ? ' · ' + l.concepto : ''}${l.uuid_cfdi ? ` <span class="uuid">${l.uuid_cfdi}</span>` : ''}</td>
        <td class="num">${Number(l.cargo) > 0 ? money(l.cargo) : ''}</td>
        <td class="num">${Number(l.abono) > 0 ? money(l.abono) : ''}</td>
      </tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Póliza ${poliza.folio}</title>
      <style>
        body{font-family:system-ui,Arial,sans-serif;margin:28px;color:#111}
        h1{font-size:17px;margin:0 0 2px} .meta{color:#555;font-size:12px;margin:0 0 2px}
        .uuid{color:#2563eb;font-family:ui-monospace,monospace;font-size:11px}
        table{width:100%;border-collapse:collapse;font-size:12px;margin-top:12px}
        th,td{border-bottom:1px solid #ddd;padding:5px 7px;text-align:left;vertical-align:top}
        th{background:#f3f4f6;font-size:10px;text-transform:uppercase;color:#555}
        td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        td.mono{font-family:ui-monospace,monospace;white-space:nowrap}
        tfoot td{font-weight:700;border-top:2px solid #333}
      </style></head><body>
      <h1>Póliza #${poliza.folio} · ${TIPO_POLIZA_LABEL[poliza.tipo] || poliza.tipo || 'Diario'}</h1>
      <p class="meta">${fecha(poliza.fecha)} · ${(poliza.concepto || '')}</p>
      ${uuid ? `<p class="meta">UUID CFDI: <span class="uuid">${uuid}</span></p>` : ''}
      <table>
        <thead><tr><th>Cuenta</th><th>Concepto</th><th class="num">Cargo</th><th class="num">Abono</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr><td></td><td class="num">Sumas</td><td class="num">${money(cargos)}</td><td class="num">${money(abonos)}</td></tr></tfoot>
      </table>
      </body></html>`;
    const w = window.open('', '_blank', 'width=820,height=900');
    if (!w) return;
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => w.print(), 250);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white">
          <div>
            <h3 className="font-semibold text-gray-900">Póliza #{poliza.folio} · {TIPO_POLIZA_LABEL[poliza.tipo] || poliza.tipo || 'Diario'}</h3>
            <p className="text-xs text-gray-500">{fecha(poliza.fecha)} · {poliza.concepto}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={imprimir} className="flex items-center gap-1.5 border border-sky-300 text-sky-700 px-3 py-1.5 rounded-lg text-sm hover:bg-sky-50">
              <Printer size={15} /> Imprimir / PDF
            </button>
            <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
          </div>
        </div>
        <div className="p-5">
          {uuid && (
            <p className="text-xs text-gray-500 mb-2">UUID CFDI: <span className="font-mono text-blue-600">{uuid}</span></p>
          )}
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left">Cuenta</th>
                <th className="px-3 py-2 text-left">Concepto</th>
                <th className="px-3 py-2 text-right">Cargo</th>
                <th className="px-3 py-2 text-right">Abono</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{formatCuenta(l.codigo, mascara)}</td>
                  <td className="px-3 py-1.5 text-xs">
                    {l.nombre}{l.concepto ? ` · ${l.concepto}` : ''}
                    {l.uuid_cfdi && <span className="ml-1.5 font-mono text-[10px] text-blue-600">{l.uuid_cfdi}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{Number(l.cargo) > 0 ? money(l.cargo) : ''}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{Number(l.abono) > 0 ? money(l.abono) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold bg-gray-50">
                <td colSpan={2} className="px-3 py-2 text-right">Sumas</td>
                <td className="px-3 py-2 text-right font-mono">{money(cargos)}</td>
                <td className="px-3 py-2 text-right font-mono">{money(abonos)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
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
            {poliza.origen_uuid && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/15 font-mono" title="UUID del CFDI que originó la póliza">
                UUID: {poliza.origen_uuid}
              </span>
            )}
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

/* Diagnóstico de cuadre / organización de XML del periodo: qué CFDI ya tienen
 * póliza, cuáles están listos, a cuáles les falta cuenta de producto (con las
 * claves) o bajaron sin XML, y si hay pólizas descuadradas. Solo lectura; se
 * calcula al abrirlo. Cierra el bucle con «Auto-asignar todo» y «Generar». */
function DiagnosticoCuadre({ anio, mes }: { anio: number; mes: number }) {
  const [abierto, setAbierto] = useState(false);
  const q = useQuery({
    queryKey: ['cuadre-cfdi', anio, mes],
    queryFn: () => api.getDiagnosticoCuadre(anio, mes),
    enabled: abierto,
  });
  const d: any = q.data?.data;

  const Fila = ({ titulo, x }: { titulo: string; x: any }) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs py-1.5 border-b last:border-0">
      <span className="font-medium text-gray-700 w-20">{titulo}</span>
      <span className="text-gray-500">{x.total} en total</span>
      <span className="text-emerald-700">{x.contabilizados} contabilizados</span>
      {x.listos > 0 && <span className="text-sky-700">{x.listos} listos para generar</span>}
      {x.sinCuenta > 0 && <span className="text-amber-700">{x.sinCuenta} sin cuenta de producto</span>}
      {x.sinXml > 0 && <span className="text-gray-500">{x.sinXml} sin XML (metadato)</span>}
      {x.otros > 0 && <span className="text-gray-400">{x.otros} otros</span>}
      {x.noClasificados > 0 && <span className="text-gray-400">(+{x.noClasificados} sin revisar)</span>}
    </div>
  );

  return (
    <div className="border rounded-lg bg-white">
      <button onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
        {abierto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Stethoscope size={15} className="text-primary" />
        <span className="font-medium">Cuadre de XML</span>
        <span className="text-xs text-gray-400">— qué falta por contabilizar y por qué</span>
      </button>
      {abierto && (
        <div className="px-3 pb-3">
          {q.isLoading && <p className="text-sm text-gray-500">Analizando…</p>}
          {d && (
            <div className="space-y-2">
              <div className="rounded-lg border divide-y px-3">
                <Fila titulo="Emitidos" x={d.emitidos} />
                <Fila titulo="Recibidos" x={d.recibidos} />
              </div>

              {(d.emitidos.clavesSinCuenta.length > 0 || d.recibidos.clavesSinCuenta.length > 0) && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  <p className="font-medium">Productos sin cuenta (asígnalos con «Auto-asignar todo», arriba):</p>
                  {d.emitidos.clavesSinCuenta.length > 0 && (
                    <p className="mt-0.5">Ventas: <span className="font-mono">{d.emitidos.clavesSinCuenta.slice(0, 12).join(', ')}{d.emitidos.clavesSinCuenta.length > 12 ? '…' : ''}</span></p>
                  )}
                  {d.recibidos.clavesSinCuenta.length > 0 && (
                    <p className="mt-0.5">Compras: <span className="font-mono">{d.recibidos.clavesSinCuenta.slice(0, 12).join(', ')}{d.recibidos.clavesSinCuenta.length > 12 ? '…' : ''}</span></p>
                  )}
                </div>
              )}

              <p className={`text-xs flex items-center gap-1.5 ${d.descuadradas > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                {d.descuadradas > 0 ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                {d.descuadradas > 0 ? `${d.descuadradas} póliza(s) descuadrada(s) en el mes — revísalas.` : 'Ninguna póliza descuadrada.'}
              </p>

              <p className="text-[11px] text-gray-500">
                Los «listos» sólo esperan «Generar Ventas/Compras». Los «sin cuenta» necesitan «Auto-asignar
                todo» antes. Los «sin XML» (recibidos que bajaron como metadato) no se contabilizan hasta subir su XML.
              </p>
              <button onClick={() => q.refetch()} className="text-xs text-gray-500 hover:text-gray-700 underline">Actualizar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PolizasListaPage;
