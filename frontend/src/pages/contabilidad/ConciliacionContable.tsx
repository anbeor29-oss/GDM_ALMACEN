/**
 * Conciliación banco → contabilidad (pantalla 50/50).
 *
 * Izquierda: los movimientos del estado de cuenta del banco. Derecha: cómo se
 * contabiliza el seleccionado. El sistema propone el match del XML por importe
 * (±10¢ pregunta) y fecha (±2 días); las comisiones y su IVA van a cuentas fijas.
 * Cada movimiento genera una póliza banco↔contraparte. La contabilidad se cuadra
 * contra el documento del banco, que es la fuente de la verdad del dinero.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SelectorCuenta } from '@/components/SelectorCuenta';
import { aTextoMx } from '@/components/CampoFecha';
import {
  Landmark, RefreshCw, Wand2, PlayCircle, Check, X, Upload, Settings2, Undo2, FileText, Link2, BookOpen,
  Sparkles, Coins,
} from 'lucide-react';
import { api } from '@/services/api';
import { formatCuenta, useMascara } from '@/utils/cuenta';
import { aniosContables } from '@/utils/anios';
import { usePeriodoTrabajo } from '@/utils/periodoActivo';

const money = (n: any) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const CLASIF: Record<string, { txt: string; color: string }> = {
  cobro:          { txt: 'Cobro cliente',    color: 'bg-emerald-100 text-emerald-800' },
  pago:           { txt: 'Pago proveedor',   color: 'bg-rose-100 text-rose-800' },
  comision:       { txt: 'Comisión',         color: 'bg-amber-100 text-amber-800' },
  iva_comision:   { txt: 'IVA comisión',     color: 'bg-amber-100 text-amber-800' },
  traspaso:       { txt: 'Traspaso',         color: 'bg-sky-100 text-sky-800' },
  compra_tarjeta: { txt: 'Compra tarjeta',   color: 'bg-violet-100 text-violet-800' },
  interes_tarjeta:{ txt: 'Interés tarjeta',  color: 'bg-amber-100 text-amber-800' },
  pago_tarjeta:   { txt: 'Pago a tarjeta',   color: 'bg-teal-100 text-teal-800' },
  otro:           { txt: 'Otro',             color: 'bg-gray-100 text-gray-700' },
};
const EST: Record<string, { txt: string; color: string }> = {
  pendiente:     { txt: 'Sin analizar', color: 'text-gray-400' },
  sugerido:      { txt: 'Revisar ±10¢', color: 'text-amber-600' },
  confirmado:    { txt: 'Listo',        color: 'text-emerald-600' },
  contabilizado: { txt: 'Contabilizado', color: 'text-sky-700' },
  conciliado:    { txt: 'Conciliado',   color: 'text-teal-700' },
  omitido:       { txt: 'Omitido',      color: 'text-gray-400 line-through' },
};

/** Selector de cuenta contable BUSCABLE (por ID) — envuelve a SelectorCuenta, que
 *  trabaja por código, resolviendo código↔id y el alta de una cuenta nueva. */
function SelCuenta({ ctas, value, onChange, placeholder = '— cuenta —' }: {
  ctas: any[]; value: string; onChange: (id: string) => void; placeholder?: string;
}) {
  const [pend, setPend] = useState('');
  const codActual = ctas.find((c) => c.id === value)?.codigo || '';
  // Cuando una cuenta recién creada aparece en el catálogo, resuelve su id.
  useEffect(() => {
    if (pend) { const c = ctas.find((x) => x.codigo === pend); if (c) { onChange(c.id); setPend(''); } }
  }, [ctas, pend]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SelectorCuenta cuentas={ctas} value={pend || codActual} placeholder={placeholder}
      onChange={(cod) => { const c = ctas.find((x) => x.codigo === cod); if (c) onChange(c.id); else setPend(cod); }} />
  );
}

/**
 * Línea muda bajo el concepto de cada movimiento: su CUENTA CONTABLE contraparte
 * (cliente/proveedor casado, comisión, o la cuenta «otro» elegida) y el DOCUMENTO
 * con el que quedó ligado (UUID del CFDI o folio de la póliza). Sale de lo que ya
 * devuelve el backend por movimiento; así el egreso muestra su cuenta y su liga sin
 * tener que abrir el detalle.
 */
function ContraDoc({ m, mascara }: { m: any; mascara: string }) {
  const partes: string[] = [];
  const tit: string[] = [];
  if (m.clasificacion === 'cobro') {
    const n = m.nombre_receptor || m.rfc_receptor;
    if (n) { partes.push(n); tit.push(`Cliente: ${n}`); }
  } else if (m.clasificacion === 'pago') {
    const n = m.nombre_emisor || m.rfc_emisor;
    if (n) { partes.push(n); tit.push(`Proveedor: ${n}`); }
  } else if (m.clasificacion === 'comision') { partes.push('Comisiones bancarias'); }
  else if (m.clasificacion === 'iva_comision') { partes.push('IVA de comisiones'); }
  else if (m.contra_codigo) {
    partes.push(formatCuenta(m.contra_codigo, mascara));
    tit.push(`${m.contra_codigo} ${m.contra_nombre || ''}`.trim());
  }
  if (m.poliza_folio) { partes.push(`Pól. #${m.poliza_folio}`); tit.push(`Póliza #${m.poliza_folio}`); }
  else if (m.cfdi_uuid) { partes.push(`CFDI …${String(m.cfdi_uuid).slice(-6)}`); tit.push(`UUID: ${m.cfdi_uuid}`); }
  if (!partes.length) return null;
  return (
    <div className="text-[11px] text-gray-400 truncate flex items-center gap-1" title={tit.join(' · ') || partes.join(' · ')}>
      <Link2 size={10} className="shrink-0" /> {partes.join(' · ')}
    </div>
  );
}

export function ConciliacionContablePage() {
  const qc = useQueryClient();
  const mascara = useMascara();
  const [cuentaSel, setCuentaSel] = useState('');
  const [estadoSel, setEstadoSel] = useState('');
  const [selMov, setSelMov] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [modalComis, setModalComis] = useState(false);
  const [modalSubir, setModalSubir] = useState(false);
  const [ocultarConcil, setOcultarConcil] = useState(false);   // ocultar lo ya conciliado
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());   // conciliación manual por lote
  const [selLinea, setSelLinea] = useState('');   // línea de la 102 elegida para cotejo manual

  const cuentasQ = useQuery({ queryKey: ['bancos-cuentas'], queryFn: () => api.getCuentasBancarias() });
  const cuentas: any[] = cuentasQ.data?.data?.cuentas || [];
  const cid = cuentaSel || cuentas[0]?.id || '';
  const esTarjeta = cuentas.find((c) => c.id === cid)?.tipo === 'TARJETA_CREDITO';
  const cuenta = cuentas.find((c) => c.id === cid);

  const estadosQ = useQuery({ queryKey: ['bancos-estados', cid], queryFn: () => api.getEstadosBancarios(cid), enabled: !!cid });
  const estados: any[] = estadosQ.data?.data?.estados || [];
  const eid = estadoSel || estados[0]?.id || '';

  const movsQ = useQuery({ queryKey: ['concil', eid], queryFn: () => api.getConciliacion(eid), enabled: !!eid });
  const movs: any[] = movsQ.data?.data?.movimientos || [];

  const cfgQ = useQuery({ queryKey: ['bancos-config'], queryFn: () => api.getBancosConfig() });
  const cfg: any = cfgQ.data?.data || {};

  const ctasQ = useQuery({ queryKey: ['ctas-mov'], queryFn: () => api.getCuentasContables() });
  const ctas: any[] = (ctasQ.data?.data?.cuentas || []).filter((c: any) => c.permite_movimientos);

  const libroQ = useQuery({ queryKey: ['libro', eid], queryFn: () => api.getLibroBanco(eid), enabled: !!eid });
  const libro: any[] = libroQ.data?.data?.lineas || [];

  // Un movimiento del banco está "conciliado" si ya se contabilizó o se cotejó.
  const conciliado = (m: any) => ['contabilizado', 'conciliado'].includes(m.concil_estado);
  const movsVis = ocultarConcil ? movs.filter((m) => !conciliado(m)) : movs;
  const libroVis = ocultarConcil ? libro.filter((l) => !l.empatado_con) : libro;
  const pendientes = movs.filter((m) => !conciliado(m) && m.concil_estado !== 'omitido').length;
  // Contador de avance: Banco = movimientos del estado conciliados/total; Cuenta =
  // partidas del libro (contabilidad) empatadas/total.
  const bancoConcil = movs.filter(conciliado).length;
  const cuentaConcil = libro.filter((l) => l.empatado_con).length;

  const sel = movs.find((m) => m.id === selMov) || null;
  const refetch = () => {
    qc.invalidateQueries({ queryKey: ['concil', eid] });
    qc.invalidateQueries({ queryKey: ['bancos-cuentas'] });
  };
  const correr = async (fn: () => Promise<any>, ok?: (r: any) => void) => {
    setBusy(true); setMsg('');
    try { const r = await fn(); ok?.(r); refetch(); }
    catch (e: any) { setMsg(e?.response?.data?.message || e.message || 'No se pudo.'); }
    finally { setBusy(false); }
  };

  const sugerirTodo = () => correr(() => api.sugerirConciliacion(eid), (r) => {
    const d = r?.data || {}; setMsg(`Revisados ${d.revisados}: ${d.confirmados} listos, ${d.sugeridos} por revisar (±10¢), ${d.comisiones} comisiones, ${d.otros} sin match.`);
  });
  const contabilizarTodo = () => correr(() => api.contabilizarEstado(eid), (r) => {
    const d = r?.data || {}; setMsg(`${d.contabilizadas} contabilizada(s).${d.errores?.length ? ` ${d.errores.length} con detalle pendiente.` : ''}`);
  });
  const cotejar = () => correr(() => api.cotejarConLibro(eid), (r) => {
    const d = r?.data || {}; setMsg(d.error ? d.error
      : `${d.conciliados} movimiento(s) empatados con la contabilidad. ${d.enLibroSinBanco} en el libro sin banco (en tránsito).`);
    qc.invalidateQueries({ queryKey: ['libro', eid] });
  });
  // TODO EN 1 CLIC: cotejar (empata con lo ya asentado, evita duplicar) → sugerir
  // (clasifica el resto) → contabilizar (crea las pólizas de lo confirmado).
  const conciliarTodo = () => correr(async () => {
    const c: any = await api.cotejarConLibro(eid);
    const s: any = await api.sugerirConciliacion(eid);
    const k: any = await api.contabilizarEstado(eid);
    return { c: c?.data || {}, s: s?.data || {}, k: k?.data || {} };
  }, (r) => {
    setMsg(`Conciliado en 1 paso: ${r.c.conciliados || 0} cotejado(s) con la contabilidad · ` +
      `${r.s.confirmados || 0} listo(s) y ${r.s.sugeridos || 0} por revisar (±10¢) · ` +
      `${r.k.contabilizadas || 0} póliza(s) creada(s).` +
      (r.k.errores?.length ? ` ${r.k.errores.length} con detalle pendiente.` : ''));
    qc.invalidateQueries({ queryKey: ['libro', eid] });
  });
  /* ── Conciliación MANUAL por lote (checkboxes a la izquierda) ──
   * Movimientos que el auto-clasificador deja en «Otro» (p. ej. comisiones cuyo
   * concepto es genérico «MOVIMIENTO BANCARIO») se marcan a mano y se contabilizan
   * en bloque. Cada uno genera su póliza comisión→banco. */
  const seleccionables = movsVis.filter((m) => !conciliado(m) && m.concil_estado !== 'omitido');
  const toggleSel = (id: string) => setSeleccion((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleSelTodos = (on: boolean) => setSeleccion(on ? new Set(seleccionables.map((m) => m.id)) : new Set());
  const idsSel = () => [...seleccion].filter((id) => movs.some((m) => m.id === id && !conciliado(m)));

  const contabilizarSelComoComision = () => {
    if (!cfg.comisionesCodigo) {
      setMsg('Primero elige la cuenta de comisiones (botón «Cuentas de comisiones»).');
      setModalComis(true);
      return;
    }
    const ids = idsSel();
    if (!ids.length) return;
    correr(async () => {
      let ok = 0; const errs: string[] = [];
      for (const id of ids) {
        await api.marcarMovimiento(id, { clasificacion: 'comision', concilEstado: 'confirmado' });
        const r: any = await api.contabilizarMovimiento(id);
        if (r?.data?.error) errs.push(r.data.error); else ok++;
      }
      return { ok, errs };
    }, (r) => {
      setMsg(`${r.ok} comisión(es) contabilizada(s) en su póliza (comisión → banco).` +
        (r.errs.length ? ` ${r.errs.length} con detalle: ${r.errs[0]}` : ''));
      setSeleccion(new Set());
      qc.invalidateQueries({ queryKey: ['libro', eid] });
    });
  };
  const omitirSel = () => {
    const ids = idsSel();
    if (!ids.length) return;
    correr(async () => {
      for (const id of ids) await api.marcarMovimiento(id, { concilEstado: 'omitido' });
      return {};
    }, () => { setMsg(`${ids.length} movimiento(s) omitido(s).`); setSeleccion(new Set()); });
  };

  /* ── Cotejo MANUAL: banco (izq., checkboxes) ↔ 102 (der., checkbox) ──
   * El usuario marca UNO O VARIOS movimientos del banco a la izquierda (p. ej. tres
   * comisiones 150 + 5 + 24.80) y UNA línea de la 102 a la derecha (p. ej. el cargo
   * de 179.80) y las liga a mano, aunque el importe/fecha no hayan casado solos. */
  const lineaSel = libro.find((l: any) => l.id === selLinea) || null;
  const lineaMonto = lineaSel ? (Number(lineaSel.cargo) || Number(lineaSel.abono)) : 0;
  const movsSelPend = idsSel().map((id) => movs.find((m) => m.id === id)).filter(Boolean) as any[];
  const sumaSel = movsSelPend.reduce(
    (a, m) => a + (Number(m.deposito) > 0 ? Number(m.deposito) : Number(m.retiro)), 0);
  const puedeCotejarManual = movsSelPend.length > 0 && !!lineaSel && !lineaSel.empatado_con;
  const cotejarManual = () => {
    if (!puedeCotejarManual) return;
    correr(async () => {
      const r: any = await api.cotejarManualMovimientos(idsSel(), selLinea);
      if (r?.data?.error) throw new Error(r.data.error);
      return r?.data;
    }, (d: any) => {
      setMsg(`${d?.ok ?? 0} movimiento(s) conciliado(s) a mano con la línea #${lineaSel!.folio}.`);
      setSelLinea(''); setSeleccion(new Set());
      qc.invalidateQueries({ queryKey: ['libro', eid] });
    });
  };

  const setBancoCuenta = (id: string) => correr(() => api.actualizarCuentaBancaria(cid, { cuentaContableId: id || null }));
  const marcar = (id: string, data: any) => correr(() => api.marcarMovimiento(id, data));
  const contabilizar = (m: any, contraId?: string) => correr(
    () => api.contabilizarMovimiento(m.id, contraId),
    (r) => { const d = r?.data; if (d?.error) setMsg(d.error); else if (d?.folio) setMsg(`Póliza #${d.folio} creada.`); });
  const contabilizarNomina = (m: any, reciboIds: string[]) => correr(
    () => api.contabilizarNominaMovimiento(m.id, reciboIds),
    (r) => { const d = r?.data; if (d?.error) setMsg(d.error); else if (d?.folio) setMsg(`Póliza #${d.folio} creada (pago de nómina).`); });
  const contabilizarEspecial = (m: any, payload: any) => correr(
    () => api.contabilizarEspecialMovimiento(m.id, payload),
    (r) => { const d = r?.data; if (d?.error) setMsg(d.error); else if (d?.folio) setMsg(`Póliza #${d.folio} creada.`); });
  const deshacer = (id: string) => correr(() => api.descontabilizarMovimiento(id));
  const descargarConcil = async () => {
    if (!eid) return;
    try { await api.descargarConciliacionBancaria(eid); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo generar el reporte de conciliación.'); }
  };

  return (
    <div className="p-4 space-y-3 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Landmark size={22} className="text-emerald-600" /> Conciliación bancaria
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Cuadra el estado de cuenta contra los XML: el banco es la fuente del dinero. Cada movimiento genera su póliza.
          </p>
        </div>
        <button onClick={() => movsQ.refetch()} className="text-gray-500 hover:text-gray-700" title="Actualizar">
          <RefreshCw size={16} className={movsQ.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Controles */}
      <div className="bg-white rounded-lg border shadow-sm p-3 flex flex-wrap items-center gap-2">
        <select value={cid} onChange={(e) => { setCuentaSel(e.target.value); setEstadoSel(''); setSelMov(''); setSeleccion(new Set()); setSelLinea(''); }}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm">
          {cuentas.length === 0 && <option value="">— no hay cuentas —</option>}
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.alias} · {c.banco_nombre}</option>)}
        </select>
        <select value={eid} onChange={(e) => { setEstadoSel(e.target.value); setSelMov(''); setSeleccion(new Set()); setSelLinea(''); }}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm" disabled={!estados.length}>
          {estados.length === 0 && <option value="">— sin estados —</option>}
          {estados.map((e) => <option key={e.id} value={e.id}>{MESES[e.mes]} {e.anio}</option>)}
        </select>

        {/* Contador de avance: Banco (estado de cuenta) y Cuenta (contabilidad) */}
        {eid && (
          <div className="flex items-center gap-2 text-xs text-gray-600 border rounded-lg px-2.5 py-1 bg-gray-50">
            <span className="inline-flex items-center gap-1" title="Movimientos del estado de cuenta conciliados / total">
              <Landmark size={13} className="text-sky-600" /> Banco <b className="tabular-nums">{bancoConcil}/{movs.length}</b>
            </span>
            <span className="text-gray-300">·</span>
            <span className="inline-flex items-center gap-1" title="Partidas del libro (contabilidad) empatadas / total">
              <BookOpen size={13} className="text-violet-600" /> Cuenta <b className="tabular-nums">{cuentaConcil}/{libro.length}</b>
            </span>
          </div>
        )}

        <button onClick={() => setModalSubir(true)} disabled={!cid}
          className="flex items-center gap-1 text-sm border rounded px-2 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          title={cid ? 'Subir un estado de cuenta' : 'Primero crea una cuenta de banco en Tesorería → Bancos'}>
          <Upload size={14} /> Subir estado
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setModalComis(true)} className="flex items-center gap-1 text-sm border rounded px-2 py-1.5 hover:bg-gray-50">
            <Settings2 size={14} /> Cuentas de comisiones
          </button>
          <button onClick={conciliarTodo} disabled={busy || !eid}
            className="flex items-center gap-1.5 text-sm bg-emerald-600 text-white rounded-lg px-4 py-2 font-medium hover:opacity-90 disabled:opacity-50 shadow-sm"
            title="Todo en un clic: coteja con la contabilidad, sugiere y contabiliza lo confirmado">
            <Sparkles size={15} /> Conciliar todo
          </button>
          <button onClick={descargarConcil} disabled={!eid}
            className="flex items-center gap-1 text-sm border rounded px-2 py-1.5 hover:bg-gray-50 disabled:opacity-50"
            title="Descargar el documento de conciliación bancaria (PDF)">
            <FileText size={14} /> Conciliación PDF
          </button>
        </div>
      </div>

      {/* Los tres pasos por separado (control fino) + ver sólo lo pendiente */}
      {eid && (
        <div className="flex flex-wrap items-center gap-2 px-1 text-xs">
          <span className="text-gray-400">Pasos sueltos:</span>
          <button onClick={cotejar} disabled={busy}
            className="flex items-center gap-1 border border-teal-300 text-teal-700 rounded px-2 py-1 hover:bg-teal-50 disabled:opacity-50"
            title="Empata los movimientos del banco con lo ya asentado en la 102">
            <Link2 size={12} /> Cotejar
          </button>
          <button onClick={sugerirTodo} disabled={busy}
            className="flex items-center gap-1 border border-amber-300 text-amber-700 rounded px-2 py-1 hover:bg-amber-50 disabled:opacity-50">
            <Wand2 size={12} /> Sugerir
          </button>
          <button onClick={contabilizarTodo} disabled={busy}
            className="flex items-center gap-1 border border-emerald-300 text-emerald-700 rounded px-2 py-1 hover:bg-emerald-50 disabled:opacity-50">
            <PlayCircle size={12} /> Contabilizar
          </button>
          <label className="ml-auto flex items-center gap-1.5 text-gray-600 cursor-pointer">
            <input type="checkbox" checked={ocultarConcil} onChange={(e) => setOcultarConcil(e.target.checked)} />
            Ocultar lo ya conciliado (dejar sólo lo pendiente)
          </label>
        </div>
      )}

      {cuentas.length === 0 && (
        <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded px-3 py-2">
          No hay cuentas de banco. Créalas en <b>Tesorería → Bancos</b> (con su cuenta contable 102-xx),
          sube ahí o aquí el estado de cuenta, y regresa a contabilizar.
        </p>
      )}

      {/* Cuenta contable del banco (102-xx) */}
      <div className="bg-white rounded-lg border shadow-sm p-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-600">Cuenta contable del banco (102-xx):</span>
        {cuenta?.cuenta_contable_codigo
          ? <span className="font-mono font-semibold text-gray-800">{formatCuenta(cuenta.cuenta_contable_codigo, mascara)}</span>
          : <span className="text-rose-600">sin asignar — elígela para poder contabilizar</span>}
        <div className="w-72"><SelCuenta ctas={ctas} value={cuenta?.cuenta_contable_id || ''} onChange={setBancoCuenta} placeholder="— elegir cuenta de banco —" /></div>
      </div>

      {msg && <p className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded px-3 py-2">{msg}</p>}

      {/* 50 / 50 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Izquierda: movimientos del banco */}
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-3 py-2 border-b text-xs text-gray-500 flex items-center gap-2 flex-wrap min-h-[34px]">
            <span>{movs.length} movimiento(s){pendientes > 0 ? ` · ${pendientes} por conciliar` : movs.length ? ' · todo conciliado ✓' : ''}</span>
            {seleccion.size > 0 && (
              <span className="ml-auto flex items-center gap-2">
                <span className="text-emerald-700 font-medium">{seleccion.size} seleccionado(s)</span>
                <button onClick={contabilizarSelComoComision} disabled={busy}
                  className="flex items-center gap-1 bg-amber-500 text-white rounded px-2 py-1 hover:opacity-90 disabled:opacity-50"
                  title="Marca los seleccionados como comisión y crea su póliza (comisión → banco)">
                  <Coins size={12} /> Contabilizar como comisión
                </button>
                <button onClick={omitirSel} disabled={busy}
                  className="border rounded px-2 py-1 hover:bg-gray-50 text-gray-600" title="Descartar los seleccionados">
                  Omitir
                </button>
                <button onClick={() => setSeleccion(new Set())} className="text-gray-400 hover:text-gray-600">Limpiar</button>
              </span>
            )}
          </div>
          <div className="overflow-y-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 w-8" title="Seleccionar para conciliación manual">
                    <input type="checkbox" aria-label="Seleccionar todos"
                      checked={seleccionables.length > 0 && seleccion.size >= seleccionables.length}
                      onChange={(e) => toggleSelTodos(e.target.checked)} disabled={!seleccionables.length} />
                  </th>
                  <th className="px-2 py-1.5 text-left text-xs font-semibold">Fecha</th>
                  <th className="px-2 py-1.5 text-left text-xs font-semibold">Concepto</th>
                  <th className="px-2 py-1.5 text-right text-xs font-semibold">{esTarjeta ? 'Cargo' : 'Depósito'}</th>
                  <th className="px-2 py-1.5 text-right text-xs font-semibold">{esTarjeta ? 'Pago' : 'Retiro'}</th>
                  <th className="px-2 py-1.5 text-left text-xs font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {movsVis.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                    {movs.length === 0
                      ? (eid ? 'Sin movimientos. Sube un estado o dale «Conciliar todo».' : 'Elige una cuenta y un estado.')
                      : 'Todo conciliado 🎉 — quita «Ocultar lo ya conciliado» para verlos.'}
                  </td></tr>
                )}
                {movsVis.map((m) => {
                  const c = CLASIF[m.clasificacion || 'otro'];
                  const e = EST[m.concil_estado || 'pendiente'];
                  return (
                    <tr key={m.id} onClick={() => setSelMov(m.id)}
                      className={`cursor-pointer ${selMov === m.id ? 'bg-emerald-100' : seleccion.has(m.id) ? 'bg-amber-50' : conciliado(m) ? 'bg-emerald-50/50 hover:bg-emerald-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-2 py-1.5 align-top" onClick={(e) => e.stopPropagation()}>
                        {!conciliado(m) && m.concil_estado !== 'omitido' && (
                          <input type="checkbox" checked={seleccion.has(m.id)} onChange={() => toggleSel(m.id)}
                            aria-label="Seleccionar movimiento" />
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap align-top">{String(m.fecha).slice(0, 10)}</td>
                      <td className="px-2 py-1.5 text-xs max-w-[220px]">
                        <div className="truncate" title={m.concepto}>{m.concepto}</div>
                        <ContraDoc m={m} mascara={mascara} />
                      </td>
                      <td className={`px-2 py-1.5 text-right text-xs ${esTarjeta ? 'text-rose-700' : 'text-emerald-700'}`}>{Number(m.deposito) > 0 ? money(m.deposito) : ''}</td>
                      <td className={`px-2 py-1.5 text-right text-xs ${esTarjeta ? 'text-emerald-700' : 'text-rose-700'}`}>{Number(m.retiro) > 0 ? money(m.retiro) : ''}</td>
                      <td className="px-2 py-1.5 text-xs">
                        {m.clasificacion && <span className={`inline-block px-1.5 py-0.5 rounded ${c?.color} mr-1`}>{c?.txt}</span>}
                        <span className={e?.color}>{e?.txt}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Derecha: la CONTABILIDAD de la 102 (cargos/abonos) para cotejar; arriba,
            la acción del movimiento elegido de la izquierda. */}
        <div className="space-y-3">
          {sel && (
            <div className="bg-white rounded-lg border shadow-sm p-4">
              <DetalleMov sel={sel} ctas={ctas} cfg={cfg} mascara={mascara} busy={busy} esTarjeta={esTarjeta}
                onConfirmar={() => marcar(sel.id, { concilEstado: 'confirmado' })}
                onOmitir={() => marcar(sel.id, { concilEstado: 'omitido' })}
                onContabilizar={(contraId?: string) => contabilizar(sel, contraId)}
                onContabilizarNomina={(reciboIds: string[]) => contabilizarNomina(sel, reciboIds)}
                onContabilizarEspecial={(payload: any) => contabilizarEspecial(sel, payload)}
                onDeshacer={() => deshacer(sel.id)}
                onAbrirComis={() => setModalComis(true)} />
            </div>
          )}

          {/* Cotejo manual: movimientos del banco (izq., checkboxes) ↔ línea de la 102 (der.). */}
          {lineaSel && !lineaSel.empatado_con && (
            <div className={`rounded-lg border p-3 text-sm flex items-center gap-2 flex-wrap ${
              movsSelPend.length ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200 text-gray-500'}`}>
              {movsSelPend.length ? (
                <>
                  <span>
                    Conciliar a mano: <b>{movsSelPend.length}</b> movimiento(s) del banco
                    {' '}(Σ <b>{money(sumaSel)}</b>) ↔ contabilidad <b>#{lineaSel.folio}</b> {money(lineaMonto)}
                    {Math.abs(sumaSel - lineaMonto) > 0.01 && (
                      <span className="text-rose-600"> · ⚠ los importes no cuadran (dif. {money(sumaSel - lineaMonto)})</span>
                    )}
                  </span>
                  <button onClick={cotejarManual} disabled={busy}
                    className="ml-auto flex items-center gap-1 bg-emerald-600 text-white rounded px-3 py-1.5 hover:opacity-90 disabled:opacity-50">
                    <Link2 size={14} /> Conciliar
                  </button>
                </>
              ) : (
                <span className="flex items-center gap-1"><Link2 size={13} /> Marca a la izquierda uno o varios movimientos del banco que correspondan a esta línea de la 102, y dale Conciliar.</span>
              )}
            </div>
          )}

          <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
            <div className="px-3 py-2 border-b text-xs text-gray-500 flex items-center gap-2">
              <BookOpen size={13} /> Contabilidad de la 102 · {libro.length} mov ·
              <span className="text-teal-700">{libro.filter((l: any) => l.empatado_con).length} ✓ empatado</span> /
              <span className="text-amber-600">{libro.filter((l: any) => !l.empatado_con).length} en tránsito</span>
            </div>
            <div className="overflow-y-auto max-h-[70vh]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 w-8" title="Marca la línea para conciliarla a mano con el movimiento seleccionado"></th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold">Fecha</th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold">Folio</th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold">Concepto</th>
                    <th className="px-2 py-1.5 text-right text-xs font-semibold">Cargo</th>
                    <th className="px-2 py-1.5 text-right text-xs font-semibold">Abono</th>
                    <th className="px-2 py-1.5 text-center text-xs font-semibold">Cotejo</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {libroVis.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                      {libro.length > 0 ? 'Todo empatado 🎉 — quita «Ocultar lo ya conciliado» para verlos.'
                        : !cuenta?.cuenta_contable_id ? 'Asigna la cuenta contable del banco (102) arriba.'
                        : libroQ.isFetching ? 'Cargando…'
                        : 'La 102 no tiene movimientos en este periodo. Dale «Conciliar todo» para generar las pólizas.'}
                    </td></tr>
                  )}
                  {libroVis.map((l) => (
                    <tr key={l.id} className={selLinea === l.id ? 'bg-amber-50' : l.empatado_con ? 'bg-teal-50/50' : ''}>
                      <td className="px-2 py-1.5 align-top">
                        {!l.empatado_con && (
                          <input type="checkbox" checked={selLinea === l.id}
                            onChange={() => setSelLinea(selLinea === l.id ? '' : l.id)}
                            aria-label="Elegir línea para cotejo manual" />
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">{aTextoMx(l.fecha)}</td>
                      <td className="px-2 py-1.5 text-xs text-gray-500">#{l.folio}</td>
                      <td className="px-2 py-1.5 text-xs truncate max-w-[200px]" title={l.concepto || l.poliza_concepto}>{l.concepto || l.poliza_concepto}</td>
                      <td className="px-2 py-1.5 text-right text-xs">{Number(l.cargo) ? money(l.cargo) : ''}</td>
                      <td className="px-2 py-1.5 text-right text-xs">{Number(l.abono) ? money(l.abono) : ''}</td>
                      <td className="px-2 py-1.5 text-center text-xs">
                        {l.empatado_con ? <span className="text-teal-700">✓</span> : <span className="text-amber-600">tránsito</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {modalComis && <ModalComisiones ctas={ctas} cfg={cfg} onClose={() => setModalComis(false)}
        onSave={async (com: string | null, iva: string | null, inte: string | null) => { await correr(() => api.setCuentasComisiones(com, iva, inte), () => { qc.invalidateQueries({ queryKey: ['bancos-config'] }); }); setModalComis(false); }} />}
      {modalSubir && <ModalSubir cid={cid} onClose={() => setModalSubir(false)}
        onDone={() => { setModalSubir(false); qc.invalidateQueries({ queryKey: ['bancos-estados', cid] }); }} />}
    </div>
  );
}

/* ── Panel derecho ── */
function DetalleMov({ sel, ctas, cfg, mascara, busy, esTarjeta, onConfirmar, onOmitir, onContabilizar, onContabilizarNomina, onContabilizarEspecial, onDeshacer, onAbrirComis }: any) {
  const [contra, setContra] = useState('');
  const [modo, setModo] = useState<'cuenta' | 'nomina' | 'ingreso' | 'proveedor'>('cuenta');   // modo de la sección "otro"
  useEffect(() => { setModo('cuenta'); }, [sel.id]);   // al cambiar de movimiento, vuelve al modo base
  const dep = Number(sel.deposito) > 0;
  const monto = dep ? sel.deposito : sel.retiro;
  const clas = sel.clasificacion || 'otro';
  /* En tarjeta: deposito = CARGO (compra), retiro = PAGO. En un cargo, la
   * contraparte del CFDI es el proveedor (recibido). */
  const contraparte = (dep && !esTarjeta) ? sel.nombre_receptor : sel.nombre_emisor;
  const contraRfc = (dep && !esTarjeta) ? sel.rfc_receptor : sel.rfc_emisor;
  const etqMonto = esTarjeta ? (dep ? 'Cargo (compra) ' : 'Pago ') : (dep ? 'Depósito ' : 'Retiro ');
  const colorMonto = esTarjeta ? (dep ? 'text-rose-700' : 'text-emerald-700') : (dep ? 'text-emerald-700' : 'text-rose-700');
  const esCompraTarjeta = clas === 'compra_tarjeta';

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-xs text-gray-500">{String(sel.fecha).slice(0, 10)}</div>
        <div className="font-medium text-gray-800">{sel.concepto}</div>
        <div className={`text-lg font-bold ${colorMonto}`}>
          {etqMonto}{money(monto)}
        </div>
      </div>

      {sel.poliza_id ? (
        sel.concil_estado === 'conciliado' ? (
          <div className="bg-teal-50 border border-teal-200 rounded p-3">
            <p className="text-teal-900 flex items-center gap-1.5"><Link2 size={15} /> Conciliado con la contabilidad — póliza #{sel.poliza_folio} (ya estaba asentada)</p>
            <button onClick={onDeshacer} disabled={busy} className="mt-2 flex items-center gap-1 text-xs text-rose-600 hover:underline">
              <Undo2 size={13} /> Deshacer el cotejo (no borra la póliza)
            </button>
          </div>
        ) : (
          <div className="bg-sky-50 border border-sky-200 rounded p-3">
            <p className="text-sky-900 flex items-center gap-1.5"><FileText size={15} /> Contabilizado — póliza #{sel.poliza_folio}</p>
            <button onClick={onDeshacer} disabled={busy} className="mt-2 flex items-center gap-1 text-xs text-rose-600 hover:underline">
              <Undo2 size={13} /> Deshacer (borra la póliza)
            </button>
          </div>
        )
      ) : (
        <>
          {/* Match de XML para cobro/pago/compra de tarjeta */}
          {(clas === 'cobro' || clas === 'pago' || esCompraTarjeta) && (
            <div className="border rounded p-3 space-y-1">
              <div className="text-xs text-gray-500">{clas === 'cobro' ? 'Cliente (XML emitido)' : 'Proveedor (XML recibido)'}</div>
              {sel.cfdi_uuid ? (
                <>
                  <div className="font-medium">{contraparte || contraRfc || '—'}</div>
                  <div className="text-xs text-gray-500 font-mono">{contraRfc}</div>
                  <div className="text-xs text-gray-600">XML: {money(sel.cfdi_total)} · {sel.cfdi_fecha}</div>
                  {Number(sel.concil_diff) > 0 && (
                    <div className="text-amber-700 text-xs mt-1">
                      Difiere por {money(sel.concil_diff)} del importe del banco. ¿Es el mismo?
                    </div>
                  )}
                </>
              ) : <div className="text-gray-400 text-xs">Sin XML casado.</div>}
            </div>
          )}

          {/* Compra de tarjeta: a qué gasto va (si no hay CFDI o para forzar la cuenta). */}
          {esCompraTarjeta && (
            <div className="border rounded p-3 space-y-1">
              <div className="text-xs text-gray-500">
                {sel.cfdi_uuid ? 'Con CFDI va a gasto + IVA acreditable / abona la tarjeta. Puedes forzar otra cuenta de gasto:' : 'Sin CFDI. Elige la cuenta de gasto (o se usa la de por defecto de la tarjeta):'}
              </div>
              <SelCuenta ctas={ctas} value={contra} onChange={setContra} />
            </div>
          )}

          {/* Interés de tarjeta → cuenta de intereses */}
          {clas === 'interes_tarjeta' && (
            <div className="border rounded p-3 text-xs">
              {cfg.interesesCodigo
                ? <>Va a <b>{formatCuenta(cfg.interesesCodigo, mascara)}</b> {cfg.interesesNombre} / abona la tarjeta</>
                : <span className="text-rose-600">Falta elegir la cuenta de intereses de tarjeta. <button onClick={onAbrirComis} className="underline">Elegir</button></span>}
            </div>
          )}

          {/* Pago a la tarjeta: se concilia contra el banco, no se asienta aquí. */}
          {clas === 'pago_tarjeta' && (
            <div className="border rounded p-3 text-xs bg-teal-50 border-teal-200 text-teal-900">
              Este pago abona a la tarjeta y sale del BANCO. Se contabiliza desde el estado del banco
              (ahí aparece como retiro) y aquí sólo se concilia con <b>Cotejar con el libro</b>.
            </div>
          )}

          {/* Comisión / IVA comisión */}
          {(clas === 'comision' || clas === 'iva_comision') && (
            <div className="border rounded p-3 text-xs">
              {clas === 'comision'
                ? (cfg.comisionesCodigo ? <>Va a <b>{formatCuenta(cfg.comisionesCodigo, mascara)}</b> {cfg.comisionesNombre}</> : <span className="text-rose-600">Falta elegir la cuenta de comisiones. <button onClick={onAbrirComis} className="underline">Elegir</button></span>)
                : (cfg.ivaCodigo ? <>Va a <b>{formatCuenta(cfg.ivaCodigo, mascara)}</b> {cfg.ivaNombre}</> : <span className="text-rose-600">Falta elegir la cuenta de IVA de comisiones. <button onClick={onAbrirComis} className="underline">Elegir</button></span>)}
            </div>
          )}

          {/* Otro: cuenta directa, o modos especiales según depósito/retiro */}
          {clas === 'otro' && (
            <div className="border rounded p-3 space-y-2">
              <div className="flex gap-1.5 flex-wrap">
                <ModoBtn activo={modo === 'cuenta'} onClick={() => setModo('cuenta')}>Cuenta directa</ModoBtn>
                {dep && <ModoBtn activo={modo === 'ingreso'} onClick={() => setModo('ingreso')}>Ingreso (con IVA)</ModoBtn>}
                {!dep && <ModoBtn activo={modo === 'nomina'} onClick={() => setModo('nomina')}>Nómina (pagar recibos)</ModoBtn>}
                {!dep && <ModoBtn activo={modo === 'proveedor'} onClick={() => setModo('proveedor')}>Proveedor (cancelar pasivo)</ModoBtn>}
              </div>
              {modo === 'cuenta' && (
                <>
                  <div className="text-xs text-gray-500">Sin match automático. Elige la cuenta contra la que va (cliente, deudor/acreedor diverso o cualquier cuenta):</div>
                  <SelCuenta ctas={ctas} value={contra} onChange={setContra} />
                </>
              )}
              {modo === 'ingreso' && dep && (
                <IngresoConIva ctas={ctas} monto={Number(monto)} busy={busy}
                  onContabilizar={(p: any) => onContabilizarEspecial({ modo: 'ingreso', ...p })} />
              )}
              {modo === 'nomina' && !dep && (
                <NominaPorPagar monto={Number(monto)} busy={busy} onContabilizar={(ids: string[]) => onContabilizarNomina(ids)} />
              )}
              {modo === 'proveedor' && !dep && (
                <ProveedorPasivo ctas={ctas} monto={Number(monto)} busy={busy}
                  onContabilizar={(p: any) => onContabilizarEspecial({ modo: 'proveedor_pasivo', ...p })} />
              )}
            </div>
          )}

          {/* Acciones */}
          <div className="flex flex-wrap gap-2 pt-1">
            {sel.concil_estado === 'sugerido' && (
              <button onClick={onConfirmar} disabled={busy}
                className="flex items-center gap-1 text-sm bg-emerald-600 text-white rounded px-3 py-1.5 hover:opacity-90 disabled:opacity-50">
                <Check size={14} /> Sí, es el mismo
              </button>
            )}
            {clas !== 'pago_tarjeta' && !(clas === 'otro' && modo !== 'cuenta') && (
              <button onClick={() => onContabilizar((clas === 'otro' || esCompraTarjeta) ? (contra || undefined) : undefined)}
                disabled={busy || (clas === 'otro' && !contra)}
                className="flex items-center gap-1 text-sm bg-sky-700 text-white rounded px-3 py-1.5 hover:opacity-90 disabled:opacity-50">
                <PlayCircle size={14} /> Contabilizar
              </button>
            )}
            <button onClick={onOmitir} disabled={busy}
              className="flex items-center gap-1 text-sm border rounded px-3 py-1.5 hover:bg-gray-50 text-gray-600">
              <X size={14} /> Omitir
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* Botón de modo de la sección "otro". */
function ModoBtn({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: any }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs rounded px-2.5 py-1 border ${activo ? 'bg-sky-600 text-white border-sky-600' : 'text-gray-600 hover:bg-gray-50'}`}>
      {children}
    </button>
  );
}

/* ── Sub-panel: depósito sin datos → ingreso con desglose de IVA ──
   Cargo Bancos / abono Ingresos (base) + abono IVA trasladado (IVA del total por la tasa). */
function IngresoConIva({ ctas, monto, busy, onContabilizar }: { ctas: any; monto: number; busy: boolean; onContabilizar: (p: any) => void }) {
  const [tasa, setTasa] = useState(0.16);
  const [ingresos, setIngresos] = useState('');
  const [iva, setIva] = useState('');
  const base = tasa > 0 ? Math.round((monto / (1 + tasa)) * 100) / 100 : monto;
  const ivaImp = Math.round((monto - base) * 100) / 100;
  const listo = !!ingresos && (tasa === 0 || !!iva);
  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500">Sin datos del depósito: regístralo como ingreso. Cargo Bancos / abono Ingresos + IVA trasladado.</div>
      <label className="block text-xs text-gray-600">Tasa de IVA
        <select value={tasa} onChange={(e) => setTasa(Number(e.target.value))} className="input w-full mt-0.5 text-sm">
          <option value={0.16}>16%</option>
          <option value={0.08}>8% (frontera)</option>
          <option value={0}>0% / Exento</option>
        </select>
      </label>
      <div className="text-xs text-gray-600">Cuenta de Ingresos</div>
      <SelCuenta ctas={ctas} value={ingresos} onChange={setIngresos} placeholder="— cuenta de ingresos —" />
      {tasa > 0 && (
        <>
          <div className="text-xs text-gray-600">Cuenta de IVA trasladado (cobrado)</div>
          <SelCuenta ctas={ctas} value={iva} onChange={setIva} placeholder="— IVA trasladado —" />
        </>
      )}
      <div className="text-xs text-gray-600 bg-slate-50 border rounded px-2 py-1">
        Depósito {money(monto)} = Base {money(base)}{tasa > 0 ? ` + IVA ${money(ivaImp)}` : ''}
      </div>
      <button onClick={() => onContabilizar({ tasa, ingresosCuentaId: ingresos, ivaCuentaId: iva || undefined })}
        disabled={busy || !listo}
        className="flex items-center gap-1 text-sm bg-sky-700 text-white rounded px-3 py-1.5 hover:opacity-90 disabled:opacity-50">
        <PlayCircle size={14} /> Contabilizar ingreso
      </button>
    </div>
  );
}

/* ── Sub-panel: retiro que cancela el pasivo de una compra PPD ──
   Cargo Proveedores + IVA acreditable (pagado) / abono Banco + IVA acreditable por pagar. */
function ProveedorPasivo({ ctas, monto, busy, onContabilizar }: { ctas: any; monto: number; busy: boolean; onContabilizar: (p: any) => void }) {
  const [tasa, setTasa] = useState(0.16);
  const [prov, setProv] = useState('');
  const [ivaPag, setIvaPag] = useState('');
  const [ivaPp, setIvaPp] = useState('');
  const iva = Math.round((monto - monto / (1 + tasa)) * 100) / 100;
  const baseImp = Math.round((monto - iva) * 100) / 100;
  const listo = !!prov && !!ivaPag && !!ivaPp;
  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500">Cancela el pasivo de una compra PPD: cargo Proveedores + IVA acreditable (pagado) / abono Banco + IVA acreditable por pagar.</div>
      <label className="block text-xs text-gray-600">Tasa de IVA
        <select value={tasa} onChange={(e) => setTasa(Number(e.target.value))} className="input w-full mt-0.5 text-sm">
          <option value={0.16}>16%</option>
          <option value={0.08}>8% (frontera)</option>
        </select>
      </label>
      <div className="text-xs text-gray-600">Cuenta de Proveedores</div>
      <SelCuenta ctas={ctas} value={prov} onChange={setProv} placeholder="— proveedores —" />
      <div className="text-xs text-gray-600">IVA acreditable (pagado)</div>
      <SelCuenta ctas={ctas} value={ivaPag} onChange={setIvaPag} placeholder="— IVA acreditable pagado —" />
      <div className="text-xs text-gray-600">IVA acreditable por pagar</div>
      <SelCuenta ctas={ctas} value={ivaPp} onChange={setIvaPp} placeholder="— IVA acreditable por pagar —" />
      <div className="text-xs text-gray-600 bg-slate-50 border rounded px-2 py-1">
        Retiro {money(monto)} · IVA {money(iva)} · base {money(baseImp)}
      </div>
      <button onClick={() => onContabilizar({ tasa, proveedorCuentaId: prov, ivaPagadoCuentaId: ivaPag, ivaPorPagarCuentaId: ivaPp })}
        disabled={busy || !listo}
        className="flex items-center gap-1 text-sm bg-sky-700 text-white rounded px-3 py-1.5 hover:opacity-90 disabled:opacity-50">
        <PlayCircle size={14} /> Contabilizar
      </button>
    </div>
  );
}

/* ── Sub-panel: pago de nómina (recibos por pagar) ──
   Para un RETIRO sin match: se eligen los recibos timbrados que suman el egreso.
   Al contabilizar, el backend arma cargo 210.01 Nómina por pagar / abono Bancos. */
function NominaPorPagar({ monto, busy, onContabilizar }: { monto: number; busy: boolean; onContabilizar: (ids: string[]) => void }) {
  const q = useQuery({ queryKey: ['nomina-por-pagar'], queryFn: () => api.getNominaPorPagar() });
  const recibos: any[] = (q.data as any)?.data || [];
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const suma = recibos.filter((r) => sel.has(r.recibo_id)).reduce((a, r) => a + Number(r.neto || 0), 0);
  const dif = Math.round((suma - monto) * 100) / 100;
  const cuadra = Math.abs(dif) <= 0.02 && sel.size > 0;
  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500">
        Elige los recibos que suman el pago. Al contabilizar: <b>cargo Nómina por pagar (210.01)</b> / abono Bancos.
      </div>
      {q.isLoading ? (
        <p className="text-xs text-gray-500">Cargando recibos…</p>
      ) : recibos.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No hay recibos de nómina timbrados por pagar.</p>
      ) : (
        <div className="border rounded max-h-56 overflow-y-auto divide-y">
          {recibos.map((r) => (
            <label key={r.recibo_id} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-slate-50 cursor-pointer">
              <input type="checkbox" checked={sel.has(r.recibo_id)} onChange={() => toggle(r.recibo_id)} />
              <span className="flex-1 min-w-0 truncate">
                {r.nombre} <span className="text-gray-400">· {r.num_empleado} · per. {r.periodo_numero} · {r.fecha_fin}</span>
              </span>
              <span className="font-mono shrink-0">{money(Number(r.neto))}</span>
            </label>
          ))}
        </div>
      )}
      <div className={`text-xs flex items-center justify-between ${cuadra ? 'text-emerald-700 font-medium' : 'text-gray-600'}`}>
        <span>Seleccionado: <b>{money(suma)}</b> · Retiro: {money(monto)}</span>
        {sel.size > 0 && !cuadra && <span className="text-amber-700">Difiere {money(Math.abs(dif))}</span>}
      </div>
      <button onClick={() => onContabilizar(Array.from(sel))} disabled={busy || !cuadra}
        className="flex items-center gap-1 text-sm bg-sky-700 text-white rounded px-3 py-1.5 hover:opacity-90 disabled:opacity-50">
        <PlayCircle size={14} /> Contabilizar nómina
      </button>
    </div>
  );
}

/* ── Modal: cuentas de comisiones (primero una, después la otra) ── */
function ModalComisiones({ ctas, cfg, onClose, onSave }: any) {
  const [com, setCom] = useState(cfg.cuentaComisionesId || '');
  const [iva, setIva] = useState(cfg.cuentaIvaComisionesId || '');
  const [inte, setInte] = useState(cfg.cuentaInteresesId || '');
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900">Cuentas de comisiones e intereses</h3>
        <p className="text-xs text-gray-500">Se eligen una vez y se aplican a comisiones (banco y tarjeta) e intereses de tarjeta.</p>
        <div>
          <label className="text-sm text-gray-700">1. Cuenta de comisiones (gasto)</label>
          <SelCuenta ctas={ctas} value={com} onChange={setCom} />
        </div>
        <div>
          <label className="text-sm text-gray-700">2. Cuenta de IVA de comisiones/intereses (acreditable)</label>
          <SelCuenta ctas={ctas} value={iva} onChange={setIva} />
        </div>
        <div>
          <label className="text-sm text-gray-700">3. Cuenta de intereses de tarjeta (gasto financiero)</label>
          <SelCuenta ctas={ctas} value={inte} onChange={setInte} />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50">Cancelar</button>
          <button onClick={() => onSave(com || null, iva || null, inte || null)}
            className="text-sm bg-emerald-600 text-white rounded px-3 py-1.5 hover:opacity-90">Guardar</button>
        </div>
      </div>
    </div>
  );
}

/* ── Modal: subir estado de cuenta desde aquí ── */
function ModalSubir({ cid, onClose, onDone }: any) {
  // El estado a subir arranca en el mes de trabajo (siguiente al último cerrado).
  const { anio, mes, setAnio, setMes } = usePeriodoTrabajo();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const subir = async () => {
    if (!cid) { setErr('Primero crea o elige una cuenta de banco (Tesorería → Bancos).'); return; }
    if (!archivo) { setErr('Elige el archivo del estado de cuenta (PDF, CSV o Excel).'); return; }
    setBusy(true); setErr('');
    try { await api.cargarEstadoDeCuenta({ cuentaId: cid, anio, mes, archivo }); onDone(); }
    catch (e: any) { setErr(e?.response?.data?.message || e.message || 'No se pudo cargar.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900">Subir estado de cuenta</h3>
        <div className="flex gap-2">
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="border rounded px-2 py-1.5 text-sm flex-1">
            {MESES.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="border rounded px-2 py-1.5 text-sm w-28">
            {aniosContables().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-center justify-between gap-2">
          <input type="file" accept=".pdf,.csv,.txt,.xlsx,.xls" onChange={(e) => setArchivo(e.target.files?.[0] || null)} className="text-sm" />
          <button type="button" onClick={() => api.descargarPlantillaEstado()}
            className="text-[11px] text-emerald-700 hover:underline shrink-0">↓ Plantilla Excel</button>
        </div>
        {err && <p className="text-xs text-rose-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50">Cancelar</button>
          <button onClick={subir} disabled={busy} className="text-sm bg-emerald-600 text-white rounded px-3 py-1.5 hover:opacity-90 disabled:opacity-50">
            {busy ? 'Subiendo…' : 'Subir'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConciliacionContablePage;
