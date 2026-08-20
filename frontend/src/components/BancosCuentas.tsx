/**
 * BancosCuentas — las cuentas de la empresa, su saldo y el control mes a mes.
 *
 * ── EL SALDO QUE SE MUESTRA ES "AL CORTE" ──
 * Es el saldo final del último estado de cuenta procesado. NO es el saldo de
 * hoy, y la pantalla lo dice en cada tarjeta con el mes al que corresponde: un
 * saldo de hace cuatro meses, presentado sin fecha, se lee como si fuera de hoy
 * y se programan pagos contra dinero que ya no está.
 *
 * ── POR QUÉ EL CONTROL ES MES A MES ──
 * Un estado de cuenta es un documento cerrado: saldo inicial, movimientos y
 * saldo final, y las tres cifras cuadran entre sí. Ese cuadre es lo único que
 * permite afirmar que lo extraído está completo, y por eso los movimientos
 * siempre cuelgan de su estado.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Landmark, Plus, Upload, Trash2, ChevronRight, AlertTriangle,
  CheckCircle2, FileText, X,
} from 'lucide-react';
import api from '@/services/api';
import { CampoFecha } from '@/components/CampoFecha';
import { fechaMx } from '@/utils/fecha';
import { useCapacidades, CAP } from '@/utils/capacidades';
import { BancosAnio } from '@/components/BancosAnio';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function BancosCuentas() {
  const qc = useQueryClient();
  const { puede } = useCapacidades();
  const puedeEditar = puede(CAP.pagar);

  const [alta, setAlta] = useState(false);
  /* La carga lleva el mes y el año ya puestos cuando se entra desde una casilla
   * de la rejilla: es el dato que se acaba de señalar, y volver a pedirlo es
   * donde se carga julio encima de agosto. */
  const [cargando, setCargando] = useState<{ cuenta: any; mes?: number; anio?: number } | null>(null);
  const [elegida, setElegida] = useState<string | null>(null);
  const [error, setError] = useState('');

  const q = useQuery({ queryKey: ['bancos-cuentas'], queryFn: () => api.getCuentasBancarias() });
  const cuentas: any[] = q.data?.data?.cuentas || [];

  const refrescar = () => qc.invalidateQueries({ queryKey: ['bancos-cuentas'] });
  const elegidaObj = cuentas.find((c: any) => c.id === elegida);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Landmark size={18} className="text-emerald-600" /> Cuentas bancarias
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            El saldo es <b>al corte</b> del último estado de cuenta cargado, no el de hoy.
          </p>
        </div>
        {puedeEditar && (
          <button onClick={() => setAlta(true)}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 text-sm">
            <Plus size={16} /> Nueva cuenta
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {q.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}

      {!q.isLoading && cuentas.length === 0 && (
        <div className="bg-white rounded-lg shadow border p-8 text-center">
          <Landmark size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-600">Todavía no hay cuentas dadas de alta.</p>
          <p className="text-sm text-gray-500 mt-1">
            Da de alta la primera con su <b>saldo de partida</b>: sin él, el primer estado
            de cuenta no tiene contra qué cuadrar.
          </p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {cuentas.map((c) => (
          <div key={c.id} className={`bg-white rounded-lg shadow border p-4 ${
            elegida === c.id ? 'ring-2 ring-emerald-400' : ''
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 truncate">{c.alias}</p>
                <p className="text-xs text-gray-500">
                  {c.banco_nombre}
                  {c.clabe ? ` · CLABE ${c.clabe}` : ''}
                  {c.moneda !== 'MXN' ? ` · ${c.moneda}` : ''}
                </p>
              </div>
              {puedeEditar && (
                <button
                  onClick={async () => {
                    if (!confirm(`¿Quitar la cuenta "${c.alias}"?\n\nSus estados de cuenta y movimientos se van con ella.`)) return;
                    try { await api.borrarCuentaBancaria(c.id); refrescar(); }
                    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo quitar'); }
                  }}
                  className="text-gray-400 hover:text-rose-600 shrink-0" title="Quitar cuenta">
                  <Trash2 size={15} />
                </button>
              )}
            </div>

            <div className="mt-3">
              <p className="text-[11px] text-gray-500 uppercase tracking-wide">
                Saldo al corte
              </p>
              <p className="text-2xl font-bold text-gray-900 tabular-nums">
                {money(c.saldo_al_corte)}
              </p>
              {/* De cuándo es ese saldo. Sin esta línea, uno de hace cuatro
                  meses se lee como si fuera de hoy. */}
              <p className={`text-xs mt-0.5 ${c.corte ? 'text-gray-500' : 'text-amber-700'}`}>
                {c.corte
                  ? `Al cierre de ${c.corte} · ${c.estados_cargados} mes(es) cargado(s)`
                  : 'Sin estados de cuenta: es el saldo de partida que se capturó'}
              </p>
              {c.corte && c.ultimo_cuadra === false && (
                <p className="text-xs text-rose-700 mt-1 flex items-start gap-1">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  El último estado <b>no cuadró</b>: este saldo no es confiable hasta revisarlo.
                </p>
              )}
              {c.corte && c.ultimo_advertencias > 0 && (
                <p className="text-xs text-amber-700 mt-1">
                  {c.ultimo_advertencias} movimiento(s) con advertencia en el último mes.
                </p>
              )}
            </div>

            <div className="flex items-center gap-3 mt-3 pt-3 border-t">
              {puedeEditar && (
                <button onClick={() => setCargando({ cuenta: c })}
                  className="text-sm text-emerald-700 hover:underline flex items-center gap-1.5">
                  <Upload size={14} /> Cargar estado de cuenta
                </button>
              )}
              <button onClick={() => setElegida(elegida === c.id ? null : c.id)}
                className="text-sm text-primary hover:underline flex items-center gap-1 ml-auto">
                {elegida === c.id ? 'Ocultar los meses' : 'Ver los meses'}
                <ChevronRight size={14}
                  className={elegida === c.id ? 'rotate-90 transition-transform' : 'transition-transform'} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Los doce meses de la cuenta elegida ──
          Aquí es donde se carga el PDF de cada mes y donde se concilia: una
          rejilla de doce muestra LO QUE FALTA, que es lo que una lista esconde.
          El hueco de un mes descuadra todos los saldos posteriores, y cada uno
          por separado se ve perfecto. */}
      {elegidaObj && (
        <div className="bg-white rounded-lg shadow border p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-gray-800">
              {elegidaObj.alias}
              <span className="ml-2 text-xs font-normal text-gray-500">
                {elegidaObj.banco_nombre}
              </span>
            </h3>
            <p className="text-xs text-gray-500">
              Carga el PDF de cada mes en su casilla
            </p>
          </div>
          <BancosAnio
            cuenta={elegidaObj}
            onCargar={(mes, anio) => setCargando({ cuenta: elegidaObj, mes, anio })}
          />
        </div>
      )}

      {alta && (
        <ModalCuenta onCerrar={() => setAlta(false)}
          onListo={() => { setAlta(false); refrescar(); }} />
      )}
      {cargando && (
        <ModalCargarEstado
          cuenta={cargando.cuenta}
          mesInicial={cargando.mes}
          anioInicial={cargando.anio}
          onCerrar={() => setCargando(null)}
          onListo={() => { setCargando(null); refrescar(); }}
        />
      )}
    </div>
  );
}

/* ═══════════ ALTA DE CUENTA ═══════════ */

function ModalCuenta({ onCerrar, onListo }: any) {
  const [f, setF] = useState({
    bancoClave: '', bancoNombre: '', alias: '', numeroCuenta: '', clabe: '',
    moneda: 'MXN', saldoInicial: '', saldoInicialFecha: '',
  });

  /* Los bancos del catálogo SPEI, con su clave de 3 dígitos. Tecleados a mano
   * nacen "Bancrea", "BANCREA" y "Banco Bancrea" como tres bancos distintos —y
   * la clave, que es lo que de verdad importa, no se captura nunca. */
  const bancosQ = useQuery({
    queryKey: ['catalogo-bancos'],
    queryFn: () => api.getCatalogoBancos(),
    staleTime: 24 * 60 * 60 * 1000,
  });
  const bancos: any[] = bancosQ.data?.data?.bancos || [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const guardar = async () => {
    setBusy(true); setError('');
    try {
      await api.crearCuentaBancaria({
        ...f,
        saldoInicial: f.saldoInicial === '' ? 0 : Number(f.saldoInicial),
        saldoInicialFecha: f.saldoInicialFecha || undefined,
      });
      onListo();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo dar de alta');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-bold text-gray-900">Nueva cuenta bancaria</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3">
          {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</p>}

          <label className="block">
            <span className="text-xs text-gray-600">Cómo la llaman *</span>
            <input value={f.alias} onChange={(e) => setF({ ...f, alias: e.target.value })}
              placeholder="Bancrea principal · nómina · dólares" className="input w-full" />
            <span className="text-[11px] text-gray-500">
              Es lo que se lee en la pantalla: el número de cuenta no distingue nada de un vistazo.
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-600">Banco *</span>
              <select
                value={f.bancoClave}
                onChange={(e) => {
                  const b = bancos.find((x: any) => x.code === e.target.value);
                  /* Se guardan los dos: la clave para cuadrar contra la CLABE,
                     y el nombre para leerlo en pantalla. */
                  setF({ ...f, bancoClave: e.target.value, bancoNombre: b?.name || '' });
                }}
                className="input w-full">
                <option value="">— Elige el banco —</option>
                {bancos.map((b: any) => (
                  <option key={b.code} value={b.code}>{b.code} · {b.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">Moneda</span>
              <select value={f.moneda} onChange={(e) => setF({ ...f, moneda: e.target.value })}
                className="input w-full">
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-600">Número de cuenta</span>
              <input value={f.numeroCuenta} onChange={(e) => setF({ ...f, numeroCuenta: e.target.value })}
                className="input w-full font-mono" />
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">CLABE (18 dígitos)</span>
              <input value={f.clabe}
                onChange={(e) => setF({ ...f, clabe: e.target.value.replace(/\D/g, '') })}
                maxLength={18} className="input w-full font-mono" />
              {/* Los tres primeros dígitos de la CLABE SON la clave del banco.
                  Si no cuadran, uno de los dos está mal capturado — y el que se
                  entera es el dinero: la transferencia rebota, o sale a la
                  institución equivocada. Se avisa aquí, no al guardar. */}
              {f.clabe.length >= 3 && f.bancoClave && f.clabe.slice(0, 3) !== f.bancoClave && (
                <span className="block text-[11px] text-rose-700 mt-1">
                  La CLABE empieza con {f.clabe.slice(0, 3)}
                  {bancos.find((b: any) => b.code === f.clabe.slice(0, 3))
                    ? ` (${bancos.find((b: any) => b.code === f.clabe.slice(0, 3)).name})`
                    : ''}
                  , no con {f.bancoClave}. Uno de los dos está mal.
                </span>
              )}
            </label>
          </div>

          {/* El punto de partida: sin él, el primer estado no tiene contra qué
              cuadrar y todos los saldos salen desfasados. */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
            <p className="text-xs font-medium text-emerald-900">Punto de partida</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-emerald-900">Saldo inicial</span>
                <input type="number" step="0.01" value={f.saldoInicial}
                  onChange={(e) => setF({ ...f, saldoInicial: e.target.value })}
                  className="input w-full text-right" placeholder="0.00" />
              </label>
              <label className="block">
                <span className="text-xs text-emerald-900">A esta fecha</span>
                <CampoFecha value={f.saldoInicialFecha}
                  onChange={(v) => setF({ ...f, saldoInicialFecha: v })} />
              </label>
            </div>
            <p className="text-[11px] text-emerald-800">
              El saldo con el que arranca el control. Después ya no se puede cambiar si
              hay estados cargados: movería todos los saldos calculados.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-5 border-t bg-gray-50">
          <button onClick={onCerrar} className="px-4 py-2 text-sm text-gray-600 hover:bg-white rounded-lg">
            Cancelar
          </button>
          <button onClick={guardar} disabled={busy || !f.alias.trim() || !f.bancoClave}
            className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {busy ? 'Guardando…' : 'Dar de alta'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════ CARGAR ESTADO DE CUENTA ═══════════ */

function ModalCargarEstado({ cuenta, mesInicial, anioInicial, onCerrar, onListo }: any) {
  const hoy = new Date();
  /* Si se entró desde una casilla, el mes ya está señalado: volver a pedirlo
   * es donde se carga julio encima de agosto. */
  const [anio, setAnio] = useState(anioInicial || hoy.getFullYear());
  const [mes, setMes] = useState(mesInicial || hoy.getMonth() + 1);
  const [texto, setTexto] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState<any>(null);

  const procesar = async () => {
    setBusy(true); setError(''); setResultado(null);
    try {
      const r = await api.cargarEstadoDeCuenta({
        cuentaId: cuenta.id, anio, mes,
        texto: archivo ? undefined : texto,
        archivo: archivo || undefined,
      });
      setResultado(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo procesar');
    } finally { setBusy(false); }
  };

  const ext = resultado?.extraccion;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white">
          <div>
            <h3 className="font-bold text-gray-900">Cargar estado de cuenta</h3>
            <p className="text-xs text-gray-500">{cuenta.alias} · {cuenta.banco_nombre}</p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</p>}

          <div className="grid grid-cols-2 gap-3 max-w-sm">
            <label className="block">
              <span className="text-xs text-gray-600">Mes</span>
              <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input w-full">
                {MESES.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">Año</span>
              <input type="number" min={2000} max={2100} value={anio}
                onChange={(e) => setAnio(Number(e.target.value))} className="input w-full" />
            </label>
          </div>

          {/* ── De dónde sale el texto ──
              El CSV del portal es siempre mejor que el PDF: no hay nada que
              adivinar sobre las columnas. Se dice, para que quien tenga los dos
              elija el bueno. */}
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700">1 · El documento</p>
            <input type="file" accept=".pdf,.csv,.txt,text/plain"
              onChange={(e) => { setArchivo(e.target.files?.[0] || null); setResultado(null); }}
              className="text-sm" />
            <p className="text-[11px] text-gray-500">
              Si tu banco da <b>CSV</b>, úsalo: es más confiable que el PDF porque no hay
              que adivinar dónde termina una columna y empieza otra. Un PDF <b>escaneado</b>
              {' '}no se puede leer aquí — este servidor no tiene OCR.
            </p>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700">
              …o pega el texto {archivo && <span className="text-gray-400">(se ignora si subiste archivo)</span>}
            </p>
            <textarea value={texto} onChange={(e) => { setTexto(e.target.value); setResultado(null); }}
              rows={6} disabled={!!archivo}
              placeholder={'SALDO INICIAL   23,500.00\n6-JUL-26  TRANSFERENCIA SPEI ENVIADA  3,500.00  20,000.00\n…'}
              className="input w-full font-mono text-xs disabled:bg-gray-50" />
          </div>

          {!resultado && (
            <div className="flex justify-end">
              <button onClick={procesar} disabled={busy || (!archivo && !texto.trim())}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {busy ? 'Procesando…' : 'Procesar y guardar'}
              </button>
            </div>
          )}

          {/* ── El resultado: lo primero es si CUADRA ──
              Un extractor que no dice que descuadró es peor que uno que no
              extrae nada: alguien va a programar pagos contra un saldo
              inventado. */}
          {ext && (
            <div className="space-y-3">
              <div className={`rounded-lg border p-3 ${
                ext.cuadra ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
              }`}>
                <p className={`font-semibold flex items-center gap-2 ${
                  ext.cuadra ? 'text-emerald-900' : 'text-rose-900'
                }`}>
                  {ext.cuadra ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  {ext.cuadra
                    ? 'Cuadra con el saldo final del documento'
                    : 'NO cuadra — revísalo antes de usar este saldo'}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2 text-sm">
                  <Cifra r="Banco" v={ext.banco} />
                  <Cifra r="Movimientos" v={String(ext.movimientos.length)} />
                  <Cifra r="Retiros" v={money(ext.totalRetiros)} />
                  <Cifra r="Depósitos" v={money(ext.totalDepositos)} />
                  <Cifra r="Saldo inicial" v={ext.saldoInicial === null ? '—' : money(ext.saldoInicial)} />
                  <Cifra r="Saldo final" v={ext.saldoFinal === null ? '—' : money(ext.saldoFinal)} />
                </div>
                {/* ── El enlace con el mes anterior ──
                    Cada estado puede cuadrar CONSIGO MISMO y la serie estar
                    rota: basta con que falte un mes para que todos los saldos
                    posteriores arrastren el hueco, y cada uno por separado se
                    vea perfecto. */}
                {resultado.enlaza === false && (
                  <p className="text-sm text-rose-900 bg-rose-100 border border-rose-300 rounded px-3 py-2 mt-2 flex items-start gap-2">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      <b>No enlaza con el mes anterior.</b> El saldo con el que abre este
                      estado no es el que cerró el mes pasado — revisa el aviso de abajo:
                      o falta un mes de por medio, o una de las dos cargas está incompleta.
                    </span>
                  </p>
                )}
                {resultado.enlaza === true && (
                  <p className="text-xs text-emerald-800 mt-2">
                    Enlaza con el mes anterior: abre donde el pasado cerró.
                  </p>
                )}
                {resultado.reemplazo && (
                  <p className="text-xs text-amber-800 mt-2">
                    Ya había un estado de <b>{MESES[mes]} {anio}</b>: éste lo <b>reemplazó</b>.
                    Un mes cargado dos veces daría el saldo del doble.
                  </p>
                )}
              </div>

              {ext.avisos.map((a: string, i: number) => (
                <p key={i} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  {a}
                </p>
              ))}

              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead className="bg-gray-50 border-b text-gray-600">
                    <tr>
                      <th className="px-2 py-2 text-left w-24">Fecha</th>
                      <th className="px-2 py-2 text-left">Concepto</th>
                      <th className="px-2 py-2 text-right w-24">Retiro</th>
                      <th className="px-2 py-2 text-right w-24">Depósito</th>
                      <th className="px-2 py-2 text-right w-28">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {ext.movimientos.map((m: any, i: number) => (
                      <tr key={i} className={m.inferido ? 'bg-amber-50' : ''}>
                        <td className="px-2 py-1.5">{fechaMx(m.fecha)}</td>
                        <td className="px-2 py-1.5">
                          {m.concepto}
                          {m.inferido && (
                            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-amber-200 text-amber-900 rounded">
                              inferido
                            </span>
                          )}
                          {m.advertencia && (
                            <span className="block text-[11px] text-amber-700">{m.advertencia}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right text-rose-700">
                          {m.retiro ? money(m.retiro) : ''}
                        </td>
                        <td className="px-2 py-1.5 text-right text-emerald-700">
                          {m.deposito ? money(m.deposito) : ''}
                        </td>
                        <td className="px-2 py-1.5 text-right font-medium">
                          {money(m.saldo ?? m.saldoCalculado)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2">
                {/* El archivo puente: las mismas columnas del banco, ya
                    normalizadas, para llevarlas a contabilidad o a Excel. */}
                <button
                  onClick={() => api.descargarCsvEstado(
                    resultado.estado.id,
                    `${cuenta.alias.replace(/[^\w-]+/g, '_')}-${anio}-${String(mes).padStart(2, '0')}.csv`)}
                  className="mr-auto px-4 py-2 text-sm border rounded-lg text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
                  <FileText size={14} /> Bajar CSV
                </button>
                <button onClick={() => setResultado(null)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                  Cargar otro
                </button>
                <button onClick={onListo}
                  className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                  Listo
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Cifra({ r, v }: { r: string; v: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{r}</p>
      <p className="font-semibold text-gray-900">{v}</p>
    </div>
  );
}

export default BancosCuentas;
