/**
 * Conciliación banco → contabilidad (pantalla 50/50).
 *
 * Izquierda: los movimientos del estado de cuenta del banco. Derecha: cómo se
 * contabiliza el seleccionado. El sistema propone el match del XML por importe
 * (±10¢ pregunta) y fecha (±2 días); las comisiones y su IVA van a cuentas fijas.
 * Cada movimiento genera una póliza banco↔contraparte. La contabilidad se cuadra
 * contra el documento del banco, que es la fuente de la verdad del dinero.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Landmark, RefreshCw, Wand2, PlayCircle, Check, X, Upload, Settings2, Undo2, FileText,
} from 'lucide-react';
import { api } from '@/services/api';
import { formatCuenta, useMascara } from '@/utils/cuenta';

const money = (n: any) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const CLASIF: Record<string, { txt: string; color: string }> = {
  cobro:        { txt: 'Cobro cliente',   color: 'bg-emerald-100 text-emerald-800' },
  pago:         { txt: 'Pago proveedor',  color: 'bg-rose-100 text-rose-800' },
  comision:     { txt: 'Comisión',        color: 'bg-amber-100 text-amber-800' },
  iva_comision: { txt: 'IVA comisión',    color: 'bg-amber-100 text-amber-800' },
  traspaso:     { txt: 'Traspaso',        color: 'bg-sky-100 text-sky-800' },
  otro:         { txt: 'Otro',            color: 'bg-gray-100 text-gray-700' },
};
const EST: Record<string, { txt: string; color: string }> = {
  pendiente:     { txt: 'Sin analizar', color: 'text-gray-400' },
  sugerido:      { txt: 'Revisar ±10¢', color: 'text-amber-600' },
  confirmado:    { txt: 'Listo',        color: 'text-emerald-600' },
  contabilizado: { txt: 'Contabilizado', color: 'text-sky-700' },
  omitido:       { txt: 'Omitido',      color: 'text-gray-400 line-through' },
};

/** Selector de cuenta contable (por ID) de las de movimiento. */
function SelCuenta({ ctas, value, onChange, placeholder = '— cuenta —' }: {
  ctas: any[]; value: string; onChange: (id: string) => void; placeholder?: string;
}) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}
      className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full">
      <option value="">{placeholder}</option>
      {ctas.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>)}
    </select>
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

  const cuentasQ = useQuery({ queryKey: ['bancos-cuentas'], queryFn: () => api.getCuentasBancarias() });
  const cuentas: any[] = cuentasQ.data?.data?.cuentas || [];
  const cid = cuentaSel || cuentas[0]?.id || '';
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
  const setBancoCuenta = (id: string) => correr(() => api.actualizarCuentaBancaria(cid, { cuentaContableId: id || null }));
  const marcar = (id: string, data: any) => correr(() => api.marcarMovimiento(id, data));
  const contabilizar = (m: any, contraId?: string) => correr(
    () => api.contabilizarMovimiento(m.id, contraId),
    (r) => { const d = r?.data; if (d?.error) setMsg(d.error); else if (d?.folio) setMsg(`Póliza #${d.folio} creada.`); });
  const deshacer = (id: string) => correr(() => api.descontabilizarMovimiento(id));

  return (
    <div className="p-4 space-y-3 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Landmark size={22} className="text-emerald-600" /> Conciliación contable
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
        <select value={cid} onChange={(e) => { setCuentaSel(e.target.value); setEstadoSel(''); setSelMov(''); }}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm">
          {cuentas.length === 0 && <option value="">— no hay cuentas —</option>}
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.alias} · {c.banco_nombre}</option>)}
        </select>
        <select value={eid} onChange={(e) => { setEstadoSel(e.target.value); setSelMov(''); }}
          className="border border-gray-300 rounded px-2 py-1.5 text-sm" disabled={!estados.length}>
          {estados.length === 0 && <option value="">— sin estados —</option>}
          {estados.map((e) => <option key={e.id} value={e.id}>{MESES[e.mes]} {e.anio}</option>)}
        </select>
        <button onClick={() => setModalSubir(true)} className="flex items-center gap-1 text-sm border rounded px-2 py-1.5 hover:bg-gray-50">
          <Upload size={14} /> Subir estado
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setModalComis(true)} className="flex items-center gap-1 text-sm border rounded px-2 py-1.5 hover:bg-gray-50">
            <Settings2 size={14} /> Cuentas de comisiones
          </button>
          <button onClick={sugerirTodo} disabled={busy || !eid}
            className="flex items-center gap-1 text-sm bg-amber-500 text-white rounded px-3 py-1.5 hover:opacity-90 disabled:opacity-50">
            <Wand2 size={14} /> Sugerir todo
          </button>
          <button onClick={contabilizarTodo} disabled={busy || !eid}
            className="flex items-center gap-1 text-sm bg-emerald-600 text-white rounded px-3 py-1.5 hover:opacity-90 disabled:opacity-50">
            <PlayCircle size={14} /> Contabilizar confirmados
          </button>
        </div>
      </div>

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
          <div className="px-3 py-2 border-b text-xs text-gray-500">{movs.length} movimiento(s)</div>
          <div className="overflow-y-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-left text-xs font-semibold">Fecha</th>
                  <th className="px-2 py-1.5 text-left text-xs font-semibold">Concepto</th>
                  <th className="px-2 py-1.5 text-right text-xs font-semibold">Depósito</th>
                  <th className="px-2 py-1.5 text-right text-xs font-semibold">Retiro</th>
                  <th className="px-2 py-1.5 text-left text-xs font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {movs.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                    {eid ? 'Sin movimientos. Sube un estado o dale «Sugerir todo».' : 'Elige una cuenta y un estado.'}
                  </td></tr>
                )}
                {movs.map((m) => {
                  const c = CLASIF[m.clasificacion || 'otro'];
                  const e = EST[m.concil_estado || 'pendiente'];
                  return (
                    <tr key={m.id} onClick={() => setSelMov(m.id)}
                      className={`cursor-pointer hover:bg-gray-50 ${selMov === m.id ? 'bg-emerald-50' : ''}`}>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">{String(m.fecha).slice(0, 10)}</td>
                      <td className="px-2 py-1.5 text-xs truncate max-w-[180px]" title={m.concepto}>{m.concepto}</td>
                      <td className="px-2 py-1.5 text-right text-xs text-emerald-700">{Number(m.deposito) > 0 ? money(m.deposito) : ''}</td>
                      <td className="px-2 py-1.5 text-right text-xs text-rose-700">{Number(m.retiro) > 0 ? money(m.retiro) : ''}</td>
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

        {/* Derecha: contabilización del seleccionado */}
        <div className="bg-white rounded-lg border shadow-sm p-4">
          {!sel ? (
            <p className="text-sm text-gray-500">Elige un movimiento de la izquierda para contabilizarlo.</p>
          ) : (
            <DetalleMov sel={sel} ctas={ctas} cfg={cfg} mascara={mascara} busy={busy}
              onConfirmar={() => marcar(sel.id, { concilEstado: 'confirmado' })}
              onOmitir={() => marcar(sel.id, { concilEstado: 'omitido' })}
              onContabilizar={(contraId?: string) => contabilizar(sel, contraId)}
              onDeshacer={() => deshacer(sel.id)}
              onAbrirComis={() => setModalComis(true)} />
          )}
        </div>
      </div>

      {modalComis && <ModalComisiones ctas={ctas} cfg={cfg} onClose={() => setModalComis(false)}
        onSave={async (com: string | null, iva: string | null) => { await correr(() => api.setCuentasComisiones(com, iva), () => { qc.invalidateQueries({ queryKey: ['bancos-config'] }); }); setModalComis(false); }} />}
      {modalSubir && <ModalSubir cid={cid} onClose={() => setModalSubir(false)}
        onDone={() => { setModalSubir(false); qc.invalidateQueries({ queryKey: ['bancos-estados', cid] }); }} />}
    </div>
  );
}

/* ── Panel derecho ── */
function DetalleMov({ sel, ctas, cfg, mascara, busy, onConfirmar, onOmitir, onContabilizar, onDeshacer, onAbrirComis }: any) {
  const [contra, setContra] = useState('');
  const dep = Number(sel.deposito) > 0;
  const monto = dep ? sel.deposito : sel.retiro;
  const clas = sel.clasificacion || 'otro';
  const contraparte = dep ? sel.nombre_receptor : sel.nombre_emisor;
  const contraRfc = dep ? sel.rfc_receptor : sel.rfc_emisor;

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-xs text-gray-500">{String(sel.fecha).slice(0, 10)}</div>
        <div className="font-medium text-gray-800">{sel.concepto}</div>
        <div className={`text-lg font-bold ${dep ? 'text-emerald-700' : 'text-rose-700'}`}>
          {dep ? 'Depósito ' : 'Retiro '}{money(monto)}
        </div>
      </div>

      {sel.poliza_id ? (
        <div className="bg-sky-50 border border-sky-200 rounded p-3">
          <p className="text-sky-900 flex items-center gap-1.5"><FileText size={15} /> Contabilizado — póliza #{sel.poliza_folio}</p>
          <button onClick={onDeshacer} disabled={busy} className="mt-2 flex items-center gap-1 text-xs text-rose-600 hover:underline">
            <Undo2 size={13} /> Deshacer (borra la póliza)
          </button>
        </div>
      ) : (
        <>
          {/* Match de XML para cobro/pago */}
          {(clas === 'cobro' || clas === 'pago') && (
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

          {/* Comisión / IVA comisión */}
          {(clas === 'comision' || clas === 'iva_comision') && (
            <div className="border rounded p-3 text-xs">
              {clas === 'comision'
                ? (cfg.comisionesCodigo ? <>Va a <b>{formatCuenta(cfg.comisionesCodigo, mascara)}</b> {cfg.comisionesNombre}</> : <span className="text-rose-600">Falta elegir la cuenta de comisiones. <button onClick={onAbrirComis} className="underline">Elegir</button></span>)
                : (cfg.ivaCodigo ? <>Va a <b>{formatCuenta(cfg.ivaCodigo, mascara)}</b> {cfg.ivaNombre}</> : <span className="text-rose-600">Falta elegir la cuenta de IVA de comisiones. <button onClick={onAbrirComis} className="underline">Elegir</button></span>)}
            </div>
          )}

          {/* Otro: cuenta contra manual */}
          {clas === 'otro' && (
            <div className="border rounded p-3 space-y-1">
              <div className="text-xs text-gray-500">Sin match automático. Elige la cuenta contra la que va:</div>
              <SelCuenta ctas={ctas} value={contra} onChange={setContra} />
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
            <button onClick={() => onContabilizar(clas === 'otro' ? contra : undefined)} disabled={busy || (clas === 'otro' && !contra)}
              className="flex items-center gap-1 text-sm bg-sky-700 text-white rounded px-3 py-1.5 hover:opacity-90 disabled:opacity-50">
              <PlayCircle size={14} /> Contabilizar
            </button>
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

/* ── Modal: cuentas de comisiones (primero una, después la otra) ── */
function ModalComisiones({ ctas, cfg, onClose, onSave }: any) {
  const [com, setCom] = useState(cfg.cuentaComisionesId || '');
  const [iva, setIva] = useState(cfg.cuentaIvaComisionesId || '');
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900">Cuentas de comisiones</h3>
        <p className="text-xs text-gray-500">Se eligen una vez y se aplican a todas las comisiones detectadas.</p>
        <div>
          <label className="text-sm text-gray-700">1. Cuenta de comisiones (gasto)</label>
          <SelCuenta ctas={ctas} value={com} onChange={setCom} />
        </div>
        <div>
          <label className="text-sm text-gray-700">2. Cuenta de IVA de comisiones (acreditable)</label>
          <SelCuenta ctas={ctas} value={iva} onChange={setIva} />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50">Cancelar</button>
          <button onClick={() => onSave(com || null, iva || null)}
            className="text-sm bg-emerald-600 text-white rounded px-3 py-1.5 hover:opacity-90">Guardar</button>
        </div>
      </div>
    </div>
  );
}

/* ── Modal: subir estado de cuenta desde aquí ── */
function ModalSubir({ cid, onClose, onDone }: any) {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const subir = async () => {
    if (!archivo) { setErr('Elige el archivo del estado de cuenta (PDF o CSV).'); return; }
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
          <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="border rounded px-2 py-1.5 text-sm w-24" />
        </div>
        <input type="file" accept=".pdf,.csv,.txt" onChange={(e) => setArchivo(e.target.files?.[0] || null)} className="text-sm" />
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
