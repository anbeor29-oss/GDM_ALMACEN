/**
 * Póliza manual — cargos y abonos capturados a mano, con CUALQUIER cuenta del
 * catálogo. Las pólizas de ventas, compras y nómina sólo tocan sus cuentas; ésta
 * es para todo lo demás (ajustes, provisiones, reclasificaciones…). No se guarda
 * si no cuadra: las sumas de cargo y abono tienen que ser iguales. El UUID es
 * opcional; si se captura, liga la póliza a un CFDI —y con doble clic (o el botón
 * «Ver factura») se abre su vista previa.
 *
 * La pantalla se abre también con el atajo F8 (lo escucha el Layout).
 */
import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText, Plus, Save, Scale, CheckCircle2, AlertTriangle, Eye, Receipt, X, Keyboard,
} from 'lucide-react';
import api from '@/services/api';
import { usePeriodoActivo } from '@/utils/periodoActivo';
import { CampoFecha, aTextoMx } from '@/components/CampoFecha';
import { PartidasPoliza, fmt2, type LineaPoliza } from '@/components/contabilidad/PartidasPoliza';

const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

const money = (n: any, moneda = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: (moneda || 'MXN').trim() || 'MXN' })
    .format(Number(n) || 0);

/** El folio fiscal: 8-4-4-4-12 hex. Con esto habilitamos la vista previa. */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const filaVacia = (): LineaPoliza => ({ codigo: '', nombre: '', concepto: '', cargo: '', abono: '' });

const TIPOS = [
  { id: 'DIARIO', label: 'Diario' },
  { id: 'INGRESO', label: 'Ingresos' },
  { id: 'EGRESO', label: 'Egresos' },
] as const;

/* Pastilla de color por tipo de póliza (activa = sólida; inactiva = contorno). */
const claseTipo = (id: string, activo: boolean) => {
  const on: Record<string, string> = {
    DIARIO: 'bg-slate-600 text-white border-slate-600 shadow-sm',
    INGRESO: 'bg-emerald-600 text-white border-emerald-600 shadow-sm',
    EGRESO: 'bg-rose-600 text-white border-rose-600 shadow-sm',
  };
  const off: Record<string, string> = {
    DIARIO: 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50',
    INGRESO: 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50',
    EGRESO: 'bg-white text-rose-700 border-rose-300 hover:bg-rose-50',
  };
  return activo ? on[id] : off[id];
};

export function PolizaManualPage() {
  const hoy = new Date().toISOString().slice(0, 10);
  const [tipo, setTipo] = useState<'DIARIO' | 'INGRESO' | 'EGRESO'>('DIARIO');
  const [fecha, setFecha] = useState(hoy);
  /* La póliza manual arranca en el MES DE TRABAJO (siguiente al último cerrado):
   * si hoy ya cae en ese mes, se respeta hoy; si el mes de trabajo va atrasado,
   * se posa en su día 1 para no capturar en un mes equivocado. Sólo la 1ª vez. */
  const activo = usePeriodoActivo();
  const fechaAplicada = useRef(false);
  useEffect(() => {
    if (!activo || fechaAplicada.current) return;
    fechaAplicada.current = true;
    const hoyD = new Date();
    const esMesTrabajo = hoyD.getFullYear() === activo.anio && hoyD.getMonth() + 1 === activo.mes;
    if (!esMesTrabajo) setFecha(`${activo.anio}-${String(activo.mes).padStart(2, '0')}-01`);
  }, [activo]);
  const [concepto, setConcepto] = useState('');
  const [uuid, setUuid] = useState('');
  const [verCfdi, setVerCfdi] = useState(false);
  const [lineas, setLineas] = useState<LineaPoliza[]>([filaVacia(), filaVacia(), filaVacia()]);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const uuidLimpio = uuid.trim();
  const uuidValido = RE_UUID.test(uuidLimpio);

  const ctasQ = useQuery({ queryKey: ['ctas-mov'], queryFn: () => api.getCuentasContables() });
  const cuentas: any[] = (ctasQ.data?.data?.cuentas || []).filter((c: any) => c.permite_movimientos);

  const onLinea = (i: number, patch: Partial<LineaPoliza>) => {
    setLineas((ls) => ls.map((l, k) => {
      if (k !== i) return l;
      const nl = { ...l, ...patch };
      // Una partida es cargo O abono, no las dos: al escribir una, se limpia la otra.
      if (patch.cargo) nl.abono = '';
      if (patch.abono) nl.cargo = '';
      return nl;
    }));
    setMsg(null);
  };
  const agregar = () => setLineas((ls) => [...ls, filaVacia()]);
  const quitar = (i: number) => setLineas((ls) => ls.length > 1 ? ls.filter((_, k) => k !== i) : ls);

  /* Cuadre rápido: al oprimir "−" en un cargo/abono, ese campo se llena con lo
   * que falta para igualar las sumas (como en la contabilidad de escritorio). */
  const cuadrar = (i: number, campo: 'cargo' | 'abono') => {
    setLineas((ls) => {
      const otrosCargo = round2(ls.reduce((a, l, k) => a + (k === i ? 0 : Number(l.cargo) || 0), 0));
      const otrosAbono = round2(ls.reduce((a, l, k) => a + (k === i ? 0 : Number(l.abono) || 0), 0));
      const falta = campo === 'cargo' ? round2(otrosAbono - otrosCargo) : round2(otrosCargo - otrosAbono);
      if (falta <= 0) return ls;                 // este lado ya cuadra o sobra
      return ls.map((l, k) => k === i
        ? { ...l, cargo: campo === 'cargo' ? String(falta) : '', abono: campo === 'abono' ? String(falta) : '' }
        : l);
    });
    setMsg(null);
  };

  const sumaCargo = round2(lineas.reduce((a, l) => a + (Number(l.cargo) || 0), 0));
  const sumaAbono = round2(lineas.reduce((a, l) => a + (Number(l.abono) || 0), 0));
  const diferencia = round2(sumaCargo - sumaAbono);
  // Importes NO cero (un ajuste puede ser negativo); cuadra = ≥2 partidas y sumas iguales (con signo).
  const conImporte = lineas.filter((l) => l.codigo && (Number(l.cargo) !== 0 || Number(l.abono) !== 0)).length;
  const cuadra = conImporte >= 2 && sumaCargo === sumaAbono;

  const guardar = async () => {
    setBusy(true); setMsg(null);
    try {
      const r: any = await api.crearPolizaManual({
        tipo, fecha, concepto: concepto.trim() || undefined, uuid: uuidLimpio || null,
        lineas: lineas
          .filter((l) => l.codigo && (Number(l.cargo) !== 0 || Number(l.abono) !== 0))
          .map((l) => ({ codigo: l.codigo.trim(), concepto: l.concepto.trim() || undefined, cargo: Number(l.cargo) || 0, abono: Number(l.abono) || 0 })),
      });
      setMsg({ tipo: 'ok', texto: `Póliza #${r.data?.poliza?.folio} guardada.` });
      setLineas([filaVacia(), filaVacia(), filaVacia()]);
      setConcepto(''); setUuid('');
    } catch (e: any) {
      setMsg({ tipo: 'err', texto: e?.response?.data?.message || e.message || 'No se pudo guardar la póliza.' });
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      {/* Encabezado robusto con acento índigo→violeta (paleta de contabilidad). */}
      <div className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white p-5 shadow-md">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-white/15 p-2 ring-1 ring-white/25"><FileText size={22} /></div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold flex items-center gap-2 flex-wrap">
              Póliza manual
              <span title="Atajo: abre esta pantalla con la tecla F8"
                className="text-[11px] font-semibold bg-white/20 ring-1 ring-white/30 rounded px-1.5 py-0.5 flex items-center gap-1">
                <Keyboard size={12} /> F8
              </span>
            </h1>
            <p className="text-sm text-indigo-100 mt-0.5">
              Cargos y abonos a mano, con cualquier cuenta del catálogo. Se guarda sólo si las sumas cuadran.
            </p>
          </div>
        </div>
      </div>

      {/* Encabezado de la póliza */}
      <div className="bg-white rounded-xl shadow border p-4 space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="lg:col-span-2">
            <span className="text-xs font-medium text-gray-600">Tipo de póliza</span>
            <div className="mt-1 flex gap-2">
              {TIPOS.map((t) => (
                <button key={t.id} type="button" onClick={() => setTipo(t.id)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${claseTipo(t.id, tipo === t.id)}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Fecha</span>
            <CampoFecha value={fecha} onChange={setFecha} className="input w-full mt-1" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Concepto</span>
            <input value={concepto} onChange={(e) => setConcepto(e.target.value)}
              placeholder="Descripción de la póliza" className="input w-full mt-1" />
          </label>
        </div>

        {/* UUID del CFDI — RESALTADO: caja propia, icono, y vista previa por doble clic.
            El borde cambia de color según el estado (vacío · escribiendo · válido). */}
        <div className={`rounded-xl border-2 p-4 transition-colors ${
          uuidValido ? 'border-emerald-400 bg-emerald-50/50'
            : uuidLimpio ? 'border-amber-300 bg-amber-50/40'
              : 'border-indigo-200 bg-indigo-50/40'}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className="rounded-lg bg-indigo-600 text-white p-1.5 shadow-sm"><Receipt size={16} /></div>
            <div className="min-w-0">
              <span className="text-sm font-semibold text-indigo-900">CFDI ligado</span>
              <span className="text-[11px] text-gray-500 ml-1.5">UUID · opcional</span>
            </div>
            {uuidValido && (
              <button type="button" onClick={() => setVerCfdi(true)}
                className="ml-auto flex items-center gap-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg px-2.5 py-1.5 hover:bg-indigo-700 shadow-sm">
                <Eye size={14} /> Ver factura
              </button>
            )}
          </div>
          <input value={uuid}
            onChange={(e) => setUuid(e.target.value)}
            onDoubleClick={() => { if (uuidValido) setVerCfdi(true); }}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            title="Doble clic para ver la vista previa de la factura ligada"
            className={`w-full font-mono text-sm rounded-lg border px-3 py-2 bg-white outline-none tracking-tight transition-shadow ${
              uuidValido ? 'border-emerald-400 focus:ring-2 focus:ring-emerald-300'
                : uuidLimpio ? 'border-amber-300 focus:ring-2 focus:ring-amber-300'
                  : 'border-indigo-200 focus:ring-2 focus:ring-indigo-300'}`} />
          <p className="text-[11px] mt-1.5">
            {uuidValido ? (
              <span className="text-emerald-700 font-medium flex items-center gap-1">
                <Eye size={12} /> Doble clic en el UUID (o «Ver factura») para la vista previa del comprobante.
              </span>
            ) : uuidLimpio ? (
              <span className="text-amber-700">El folio fiscal tiene 36 caracteres con guiones (8-4-4-4-12).</span>
            ) : (
              <span className="text-gray-500">Liga la póliza a un comprobante del SAT; al escribir un UUID válido podrás previsualizarlo.</span>
            )}
          </p>
        </div>
      </div>

      {/* Partidas — misma tabla que el editor de pólizas (uniformidad) */}
      <PartidasPoliza lineas={lineas} cuentas={cuentas}
        sumaCargo={sumaCargo} sumaAbono={sumaAbono}
        onLinea={onLinea} onCuadrar={cuadrar} onQuitar={quitar} />

      {/* Información del atajo de cuadre (tecla «−») */}
      <div className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-900">
        <Scale size={15} className="mt-0.5 shrink-0 text-indigo-600" />
        <p>
          Para <b>cuadrar</b> al instante: pon el cursor en un importe <b>vacío</b> (Debe o Haber) y oprime la tecla
          <kbd className="mx-1 px-1.5 py-0.5 rounded bg-white border border-indigo-300 font-mono text-[11px] align-middle">−</kbd>
          ; el renglón se llena con la diferencia que falta para igualar las sumas. (Con un importe ya escrito, «−» alterna el signo.)
        </p>
      </div>

      {/* Barra de cuadre — verde al cuadrar, ámbar mientras falta */}
      <div className={`rounded-xl border p-3 flex flex-wrap items-center gap-x-6 gap-y-2 ${
        cuadra ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
        <span className={`flex items-center gap-1.5 text-sm font-semibold ${cuadra ? 'text-emerald-800' : 'text-amber-800'}`}>
          {cuadra ? <CheckCircle2 size={16} /> : <Scale size={16} />}
          {cuadra ? 'Póliza cuadrada' : conImporte < 2 ? 'Captura los importes' : 'Falta cuadrar'}
        </span>
        <span className="text-sm text-gray-600">Debe <b className="tabular-nums text-sky-800 ml-0.5">{fmt2(sumaCargo)}</b></span>
        <span className="text-sm text-gray-600">Haber <b className="tabular-nums text-violet-800 ml-0.5">{fmt2(sumaAbono)}</b></span>
        <span className="text-sm text-gray-600">
          Diferencia <b className={`tabular-nums ml-0.5 ${diferencia === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{fmt2(diferencia)}</b>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={agregar} className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          <Plus size={15} /> Agregar renglón
        </button>

        <button onClick={guardar} disabled={busy || !cuadra || conImporte < 2}
          className="ml-auto flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold shadow-sm">
          <Save size={15} /> {busy ? 'Guardando…' : 'Guardar póliza'}
        </button>
      </div>

      {msg && (
        <p className={`text-sm flex items-center gap-1.5 ${msg.tipo === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>
          {msg.tipo === 'ok' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {msg.texto}
        </p>
      )}

      {verCfdi && uuidValido && (
        <CfdiPreviewModal uuid={uuidLimpio} onClose={() => setVerCfdi(false)} />
      )}
    </div>
  );
}

/* ── Vista previa del CFDI ligado (doble clic en el UUID) ──────────────────────
 * Sólo LECTURA: la ficha del comprobante que está en la bóveda (emisor, folio,
 * total, fecha, método) y, si ya está contabilizado, sus asientos. Aquí no se
 * paga ni se genera nada: es para confirmar que el UUID es la factura correcta. */
function CfdiPreviewModal({ uuid, onClose }: { uuid: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['cfdi-preview', uuid], queryFn: () => api.getAsientoPorUuid(uuid) });
  const d: any = q.data?.data;
  const c = d?.comprobante;

  // Cerrar con Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-t-xl z-10">
          <span className="text-sm font-semibold flex items-center gap-2"><Receipt size={16} /> Vista previa de la factura</span>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          {q.isLoading && <p className="text-center text-gray-500 py-10">Cargando comprobante…</p>}

          {!q.isLoading && !c && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                No se encontró este CFDI en la bóveda. Puede que el UUID no exista o que el comprobante
                aún no esté respaldado (impórtalo desde <b>XML del SAT</b> para verlo aquí).
              </span>
            </div>
          )}

          {!q.isLoading && c && (
            <>
              {/* Ficha del comprobante */}
              <div className="rounded-xl border border-indigo-200 overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-indigo-50 border-b border-indigo-200">
                  <span className="font-bold text-indigo-900">{c.folio}</span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    d.esRecibido ? 'bg-sky-100 text-sky-800' : 'bg-violet-100 text-violet-800'}`}>
                    {d.esRecibido ? 'Recibido' : 'Emitido'}
                  </span>
                  {c.metodoPago && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                      {c.metodoPago}{d.esPue ? ' · contado' : c.metodoPago === 'PPD' ? ' · crédito' : ''}
                    </span>
                  )}
                  {d.yaPagada && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 flex items-center gap-1">
                      <CheckCircle2 size={12} /> Pagada
                    </span>
                  )}
                  <span className="ml-auto text-lg font-bold text-gray-900">{money(c.total, c.moneda)}</span>
                </div>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-sm">
                  <Dato etiqueta={d.esRecibido ? 'Emisor (proveedor)' : 'Emisor'} valor={c.proveedor || '—'} ancho />
                  <Dato etiqueta="RFC" valor={c.rfc || '—'} mono />
                  <Dato etiqueta="Fecha" valor={aTextoMx(c.fecha)} />
                  <Dato etiqueta="Moneda" valor={c.moneda || 'MXN'} />
                  <Dato etiqueta="UUID" valor={uuid} mono ancho />
                </div>
              </div>

              {/* Asientos contables que ya tocan este CFDI (si los hay) */}
              {(!d.asientos || d.asientos.length === 0) ? (
                <p className="text-sm text-gray-500 italic bg-gray-50 border rounded-lg p-4 text-center">
                  Este comprobante todavía no tiene póliza. Al ligarlo aquí y guardar, quedará asociado a ésta.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Asientos contables</p>
                  {d.asientos.map((a: any) => {
                    const cargos = a.lineas.reduce((s: number, l: any) => s + Number(l.cargo || 0), 0);
                    const abonos = a.lineas.reduce((s: number, l: any) => s + Number(l.abono || 0), 0);
                    return (
                      <div key={a.id} className="border rounded-lg overflow-hidden">
                        <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50 border-b text-sm">
                          <b className="text-indigo-600">#{a.folio}</b>
                          <span className="text-gray-500">{aTextoMx(a.fecha)}</span>
                          <span className="text-gray-700 truncate">{a.concepto}</span>
                          <span className="ml-auto text-[10px] text-gray-400">{a.regla}</span>
                        </div>
                        <table className="w-full text-xs">
                          <tbody>
                            {a.lineas.map((l: any, i: number) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="px-3 py-1 font-mono text-gray-500 w-24">{l.codigo}</td>
                                <td className="px-2 py-1">{l.nombre}{l.concepto ? ` · ${l.concepto}` : ''}</td>
                                <td className="px-3 py-1 text-right w-28 font-mono text-sky-800">{Number(l.cargo) > 0 ? fmt2(l.cargo) : ''}</td>
                                <td className="px-3 py-1 text-right w-28 font-mono text-violet-800">{Number(l.abono) > 0 ? fmt2(l.abono) : ''}</td>
                              </tr>
                            ))}
                            <tr className="font-semibold bg-gray-50">
                              <td colSpan={2} className="px-3 py-1 text-right">Sumas</td>
                              <td className="px-3 py-1 text-right font-mono text-sky-900">{fmt2(cargos)}</td>
                              <td className="px-3 py-1 text-right font-mono text-violet-900">{fmt2(abonos)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Dato({ etiqueta, valor, mono, ancho }: { etiqueta: string; valor: string; mono?: boolean; ancho?: boolean }) {
  return (
    <div className={ancho ? 'sm:col-span-2' : ''}>
      <span className="text-[11px] text-gray-500">{etiqueta}</span>
      <p className={`text-gray-900 ${mono ? 'font-mono text-xs break-all' : ''}`}>{valor}</p>
    </div>
  );
}

export default PolizaManualPage;
