/**
 * Indicadores económicos — INPC, UMA, salarios mínimos y UMI en un solo lugar.
 *
 *   · INPC: se ACTUALIZA SOLO desde la API del INEGI (botón). Es mensual y es de
 *     la contabilidad/fiscal (actualización de contribuciones, recargos).
 *   · UMA / SM / UMI / Tarifa Art. 96: se muestran de sólo lectura; se editan y
 *     confirman en Nómina → Parámetros (son anuales y no tienen API limpia).
 */
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, RefreshCw, Landmark, ExternalLink, AlertTriangle, CheckCircle2, Calculator, Upload } from 'lucide-react';
import { claseOpcion } from '@/utils/coloresOpciones';
import api from '@/services/api';

const MESES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const money = (n: any) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const num = (n: any) => n === null || n === undefined ? '—' : Number(n).toLocaleString('es-MX', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function IndicadoresPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const q = useQuery({ queryKey: ['indicadores'], queryFn: () => api.getIndicadores() });
  const d: any = q.data?.data || {};
  const inpcQ = useQuery({ queryKey: ['inpc-serie'], queryFn: () => api.getInpcSerie(240) });
  const serie: any[] = inpcQ.data?.data || [];

  const actualizar = async () => {
    setBusy(true); setMsg('');
    try {
      const r: any = await api.actualizarInpc();
      const x = r?.data || {};
      setMsg(`INPC actualizado: ${x.actualizados} periodo(s) (${x.desde} → ${x.hasta}).`);
      qc.invalidateQueries({ queryKey: ['indicadores'] });
      qc.invalidateQueries({ queryKey: ['inpc-serie'] });
    } catch (e: any) {
      setMsg(e?.response?.data?.message || e?.message || 'No se pudo actualizar el INPC.');
    } finally { setBusy(false); }
  };

  const importarArchivo = async (file: File) => {
    setBusy(true); setMsg('');
    try {
      const r: any = await api.importarInpcArchivo(file);
      const x = r?.data || {};
      setMsg(`INPC importado del archivo: ${x.actualizados} periodo(s) (${x.desde} → ${x.hasta}).`);
      qc.invalidateQueries({ queryKey: ['indicadores'] });
      qc.invalidateQueries({ queryKey: ['inpc-serie'] });
    } catch (e: any) {
      setMsg(e?.response?.data?.message || e?.message || 'No se pudo importar el archivo.');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <TrendingUp size={22} className="text-primary" /> Indicadores económicos
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          INPC, UMA, salarios mínimos y UMI. El INPC se baja solo del INEGI; los demás se
          capturan una vez al año en Nómina → Parámetros.
        </p>
      </div>

      {msg && <p className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded px-3 py-2">{msg}</p>}

      {/* ── INPC ── */}
      <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-gray-800">INPC — Índice Nacional de Precios al Consumidor</h2>
          <div className="ml-auto flex items-center gap-2">
            {d.tieneToken === false && (
              <span className="text-xs text-amber-700 flex items-center gap-1" title="Registra un token gratuito del INEGI y ponlo en INEGI_TOKEN (Render)">
                <AlertTriangle size={13} /> Falta el token del INEGI
              </span>
            )}
            <label className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 hover:bg-gray-50 text-sm cursor-pointer"
              title="Sin token: descarga «Índice general» del INPC en el INEGI (CSV o XLSX) y súbelo aquí">
              <Upload size={15} /> Importar CSV/XLSX
              <input type="file" accept=".csv,.xlsx,.xls,.txt" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importarArchivo(f); e.currentTarget.value = ''; }} />
            </label>
            <button onClick={actualizar} disabled={busy}
              className="flex items-center gap-1.5 bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 disabled:opacity-50 text-sm">
              <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> {busy ? 'Actualizando…' : 'Actualizar desde INEGI'}
            </button>
          </div>
        </div>

        {d.inpc ? (
          <p className="text-sm text-gray-700">
            Último dato: <b>{MESES[d.inpc.mes]} {d.inpc.anio}</b> = <b>{num(d.inpc.valor)}</b>
            <span className="text-gray-400"> (base 2ª quincena julio 2018 = 100)</span>
          </p>
        ) : (
          <p className="text-sm text-gray-500 italic">Todavía no hay serie del INPC. Dale «Actualizar desde INEGI».</p>
        )}

        {serie.length > 0 && (() => {
          /* Cuadrícula: los AÑOS en vertical (una fila cada uno, del más reciente
           * arriba) y los MESES en horizontal — aprovecha el espacio y deja ver
           * de un vistazo cómo evolucionó el índice. */
          const porAnio = new Map<number, Record<number, number>>();
          for (const s of serie) {
            if (!porAnio.has(s.anio)) porAnio.set(s.anio, {});
            porAnio.get(s.anio)![s.mes] = s.valor;
          }
          const anios = [...porAnio.keys()].sort((a, b) => b - a);
          const meses = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
          const MESCORTO = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
          return (
            <div className="overflow-x-auto border rounded-md">
              <table className="text-sm border-collapse tabular-nums min-w-max">
                <thead>
                  <tr className="text-xs text-gray-500 border-b">
                    <th className="px-2 py-1.5 text-left sticky left-0 bg-white">Año</th>
                    {meses.map((m) => <th key={m} className="px-2 py-1.5 text-right font-medium">{MESCORTO[m]}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {anios.map((anio) => (
                    <tr key={anio} className="hover:bg-gray-50">
                      <td className="px-2 py-1 font-semibold text-gray-800 sticky left-0 bg-white">{anio}</td>
                      {meses.map((m) => {
                        const v = porAnio.get(anio)![m];
                        return (
                          <td key={m} className="px-2 py-1 text-right text-gray-700">
                            {v != null ? num(v) : <span className="text-gray-300">·</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* ── UMA / SM / UMI / ISR (de sólo lectura) ── */}
      <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Landmark size={17} className="text-emerald-600" />
          <h2 className="font-semibold text-gray-800">UMA, salarios mínimos, UMI y tarifa del Art. 96</h2>
          <a href="/nomina/parametros" className="ml-auto text-sm text-primary hover:underline flex items-center gap-1">
            Editar en Nómina → Parámetros <ExternalLink size={13} />
          </a>
        </div>
        <p className="text-xs text-gray-500">
          Son anuales (UMA 1-feb · salarios mínimos y UMI 1-ene) y sin API pública limpia, así que se
          capturan y se confirman a mano una vez al año. Aquí se muestran para tenerlos a la vista.
        </p>
        <div className="overflow-x-auto border rounded-md">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-2 py-1.5 text-left">Año</th>
                <th className="px-2 py-1.5 text-right">UMA diaria</th>
                <th className="px-2 py-1.5 text-right">UMA mensual</th>
                <th className="px-2 py-1.5 text-right">SM general</th>
                <th className="px-2 py-1.5 text-right">SM frontera</th>
                <th className="px-2 py-1.5 text-right">UMI diaria</th>
                <th className="px-2 py-1.5 text-center">Tarifa ISR</th>
                <th className="px-2 py-1.5 text-center">Confirmado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(d.ejercicios || []).length === 0 && (
                <tr><td colSpan={8} className="px-2 py-4 text-center text-gray-500 italic">Sin ejercicios de nómina cargados.</td></tr>
              )}
              {(d.ejercicios || []).map((e: any) => (
                <tr key={e.anio}>
                  <td className="px-2 py-1.5 font-medium">{e.anio}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(e.umaDiaria)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(e.umaMensual)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(e.smgGeneral)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(e.smgFrontera)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(e.umiDiaria)}</td>
                  <td className="px-2 py-1.5 text-center text-xs">{e.renglonesIsr > 0 ? `${e.renglonesIsr} renglones` : '—'}</td>
                  <td className="px-2 py-1.5 text-center">
                    {e.confirmado
                      ? <CheckCircle2 size={15} className="inline text-emerald-600" />
                      : <AlertTriangle size={15} className="inline text-amber-500" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Herramientas fiscales que usan el INPC ── */}
      <HerramientasFiscales />
    </div>
  );
}

/* ═══════════ Calculadoras (INPC): actualización+recargos, ajuste anual, pérdidas ═══════════ */

const hoyYmd = () => new Date().toISOString().slice(0, 10);

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] text-gray-600 block">{label}</span>
      {children}
    </label>
  );
}
function Reng({ k, v, fuerte }: { k: string; v: string; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1 ${fuerte ? 'font-bold text-gray-900 border-t pt-1.5' : 'text-gray-700'}`}>
      <span>{k}</span><span className="tabular-nums">{v}</span>
    </div>
  );
}

function HerramientasFiscales() {
  const [tab, setTab] = useState<'recargos' | 'inflacion' | 'perdida'>('recargos');
  const money = (n: any) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  const anioActual = new Date().getFullYear();

  // 1) Actualización + recargos
  const [rMonto, setRMonto] = useState('');
  const [rDebio, setRDebio] = useState(`${anioActual}-01-17`);
  const [rPago, setRPago] = useState(hoyYmd());
  const [rRes, setRRes] = useState<any>(null);
  const [rErr, setRErr] = useState('');
  const calcR = async () => {
    setRErr(''); setRRes(null);
    try { const x: any = await api.calcActualizacionRecargos({ monto: Number(rMonto), fechaDebio: rDebio, fechaPago: rPago }); setRRes(x?.data); }
    catch (e: any) { setRErr(e?.response?.data?.message || e?.message || 'No se pudo calcular.'); }
  };

  // 2) Ajuste anual por inflación
  const [aAnio, setAAnio] = useState(anioActual - 1);
  const [aCred, setACred] = useState('');
  const [aDeu, setADeu] = useState('');
  const [aRes, setARes] = useState<any>(null);
  const [aErr, setAErr] = useState('');
  const calcA = async () => {
    setAErr(''); setARes(null);
    try { const x: any = await api.calcAjusteInflacion({ anio: aAnio, saldoPromedioCreditos: Number(aCred), saldoPromedioDeudas: Number(aDeu) }); setARes(x?.data); }
    catch (e: any) { setAErr(e?.response?.data?.message || e?.message || 'No se pudo calcular.'); }
  };

  // 3) Pérdida fiscal
  const [pMonto, setPMonto] = useState('');
  const [pAnioP, setPAnioP] = useState(anioActual - 1);
  const [pAnioA, setPAnioA] = useState(anioActual);
  const [pRes, setPRes] = useState<any>(null);
  const [pErr, setPErr] = useState('');
  const calcP = async () => {
    setPErr(''); setPRes(null);
    try { const x: any = await api.calcPerdidaFiscal({ perdida: Number(pMonto), anioPerdida: pAnioP, anioAplicacion: pAnioA }); setPRes(x?.data); }
    catch (e: any) { setPErr(e?.response?.data?.message || e?.message || 'No se pudo calcular.'); }
  };

  const inputC = 'input text-sm w-full';

  return (
    <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Calculator size={17} className="text-primary" />
        <h2 className="font-semibold text-gray-800">Herramientas fiscales (con INPC)</h2>
      </div>
      <p className="text-xs text-gray-500">
        Usan la serie del INPC de arriba. Si falta el INPC de algún mes, primero dale «Actualizar desde INEGI».
      </p>
      <div className="flex gap-1.5 flex-wrap">
        {([['recargos', 'Actualización y recargos'], ['inflacion', 'Ajuste anual por inflación'], ['perdida', 'Pérdida fiscal']] as const).map(([k, l], i) => (
          <button key={k} onClick={() => setTab(k)} className={claseOpcion(i, tab === k)}>{l}</button>
        ))}
      </div>

      {tab === 'recargos' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs text-gray-500">Pago extemporáneo de una contribución (Art. 17-A y 21 CFF).</p>
            <Campo label="Monto de la contribución"><input type="number" value={rMonto} onChange={(e) => setRMonto(e.target.value)} className={`${inputC} text-right`} placeholder="0.00" /></Campo>
            <div className="grid grid-cols-2 gap-2">
              <Campo label="Debió pagarse el"><input type="date" value={rDebio} onChange={(e) => setRDebio(e.target.value)} className={inputC} /></Campo>
              <Campo label="Se paga el"><input type="date" value={rPago} onChange={(e) => setRPago(e.target.value)} className={inputC} /></Campo>
            </div>
            <button onClick={calcR} className="btn-primary text-sm">Calcular</button>
            {rErr && <p className="text-xs text-rose-600">{rErr}</p>}
          </div>
          {rRes && (
            <div className="bg-gray-50 border rounded p-3 text-sm">
              {rRes.alCorriente ? <p className="text-emerald-700">Está al corriente: no hay actualización ni recargos.</p> : (<>
                <Reng k="Factor de actualización" v={Number(rRes.fa).toFixed(4)} />
                <Reng k="Contribución actualizada" v={money(rRes.montoActualizado)} />
                <Reng k="Actualización" v={money(rRes.actualizacion)} />
                <Reng k={`Recargos (${rRes.meses} mes(es) · ${Number(rRes.sumaTasas).toFixed(2)}%)`} v={money(rRes.recargos)} />
                <Reng k="TOTAL a pagar" v={money(rRes.total)} fuerte />
                <p className="text-[10px] text-gray-400 mt-1">INPC {rRes.inpc.pago.mes}/{rRes.inpc.pago.anio} ÷ {rRes.inpc.debio.mes}/{rRes.inpc.debio.anio}</p>
              </>)}
            </div>
          )}
        </div>
      )}

      {tab === 'inflacion' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs text-gray-500">Personas morales (Art. 44 LISR). Factor = INPC dic ÷ INPC dic del año anterior − 1.</p>
            <Campo label="Ejercicio"><input type="number" value={aAnio} onChange={(e) => setAAnio(Number(e.target.value))} className={inputC} /></Campo>
            <Campo label="Saldo promedio anual de CRÉDITOS"><input type="number" value={aCred} onChange={(e) => setACred(e.target.value)} className={`${inputC} text-right`} placeholder="0.00" /></Campo>
            <Campo label="Saldo promedio anual de DEUDAS"><input type="number" value={aDeu} onChange={(e) => setADeu(e.target.value)} className={`${inputC} text-right`} placeholder="0.00" /></Campo>
            <button onClick={calcA} className="btn-primary text-sm">Calcular</button>
            {aErr && <p className="text-xs text-rose-600">{aErr}</p>}
          </div>
          {aRes && (
            <div className="bg-gray-50 border rounded p-3 text-sm">
              <Reng k="Factor de ajuste anual" v={Number(aRes.factor).toFixed(4)} />
              <Reng k="Base (|deudas − créditos|)" v={money(aRes.base)} />
              <Reng k={`Ajuste anual por inflación (${aRes.tipo})`} v={money(aRes.ajuste)} fuerte />
              <p className="text-[10px] text-gray-400 mt-1">
                {aRes.tipo === 'ACUMULABLE' ? 'Deudas > créditos → es INGRESO acumulable.' : aRes.tipo === 'DEDUCIBLE' ? 'Créditos > deudas → es DEDUCIBLE.' : 'Créditos = deudas.'}
                {' '}INPC dic {aRes.anio} ({Number(aRes.inpcDic).toFixed(3)}) ÷ dic {aRes.anio - 1} ({Number(aRes.inpcDicPrev).toFixed(3)}).
              </p>
            </div>
          )}
        </div>
      )}

      {tab === 'perdida' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-xs text-gray-500">Actualización de pérdida fiscal (Art. 57 LISR): 1ª dic÷jul del año de la pérdida; 2ª jun del año de aplicación ÷ dic.</p>
            <Campo label="Monto de la pérdida (histórica)"><input type="number" value={pMonto} onChange={(e) => setPMonto(e.target.value)} className={`${inputC} text-right`} placeholder="0.00" /></Campo>
            <div className="grid grid-cols-2 gap-2">
              <Campo label="Año de la pérdida"><input type="number" value={pAnioP} onChange={(e) => setPAnioP(Number(e.target.value))} className={inputC} /></Campo>
              <Campo label="Año de aplicación"><input type="number" value={pAnioA} onChange={(e) => setPAnioA(Number(e.target.value))} className={inputC} /></Campo>
            </div>
            <button onClick={calcP} className="btn-primary text-sm">Calcular</button>
            {pErr && <p className="text-xs text-rose-600">{pErr}</p>}
          </div>
          {pRes && (
            <div className="bg-gray-50 border rounded p-3 text-sm">
              <Reng k="Factor 1ª actualización (dic ÷ jul)" v={Number(pRes.fa1).toFixed(4)} />
              <Reng k="Factor 2ª actualización (jun ÷ dic)" v={Number(pRes.fa2).toFixed(4)} />
              <Reng k="Pérdida actualizada" v={money(pRes.actualizada)} fuerte />
              <p className="text-[10px] text-gray-400 mt-1">Factor total {Number(pRes.factorTotal).toFixed(4)}.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default IndicadoresPage;
