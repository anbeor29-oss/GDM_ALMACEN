/**
 * Cuadre contable — la auditoría que certifica que la contabilidad cierra.
 *
 * Tres pruebas, de lo micro a lo macro:
 *   1. Póliza por póliza: cada asiento tiene sus cargos = sus abonos.
 *   2. Balanza: todos los cargos = todos los abonos.
 *   3. Balance ↔ estado de resultados: activo = pasivo + capital, y la utilidad
 *      del estado de resultados coincide con la del capital.
 *
 * No cambia nada: sólo diagnostica y señala DÓNDE está el descuadre.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { api } from '@/services/api';
import { aniosContables } from '@/utils/anios';
import { formatCuenta, useMascara } from '@/utils/cuenta';

const money = (n: any) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);

const MESES = ['Todo el año', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Una tarjeta de resultado: verde si cuadra, rojo si no. */
function Prueba({ ok, titulo, children }: { ok: boolean; titulo: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border shadow-sm p-4 ${ok ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
      <div className="flex items-center gap-2 mb-2">
        {ok ? <CheckCircle2 size={18} className="text-emerald-600" />
            : <XCircle size={18} className="text-rose-600" />}
        <h3 className={`text-sm font-semibold ${ok ? 'text-emerald-800' : 'text-rose-800'}`}>{titulo}</h3>
      </div>
      {children}
    </div>
  );
}

export function ValidacionContablePage() {
  const hoy = new Date();
  const mascara = useMascara();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(0);
  const anios = aniosContables();

  const q = useQuery({
    queryKey: ['validacion-contable', anio, mes],
    queryFn: () => api.getValidacionContable(anio, mes),
  });
  const d: any = q.data?.data;
  const bz = d?.balanza;
  const bal = d?.balance;
  const desc: any[] = d?.polizasDescuadradas || [];

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldCheck size={22} className="text-amber-600" /> Cuadre contable
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Revisa póliza por póliza que cada cargo tenga su abono, que la balanza cuadre
          y que el balance cierre con el estado de resultados.
        </p>
      </div>

      {/* Controles */}
      <div className="bg-white rounded-lg border shadow-sm p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[11px] text-gray-600 block">Año</label>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input text-sm">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-gray-600 block">Hasta el mes</label>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input text-sm">
            {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
        </div>
        <span className="text-xs text-gray-400 ml-auto">
          Corte al {d?.hasta || '…'} · acumulado desde el inicio
        </span>
      </div>

      {q.isLoading ? (
        <p className="text-sm text-gray-500">Revisando…</p>
      ) : !d ? (
        <p className="text-sm text-gray-500">Sin datos para el periodo.</p>
      ) : (
        <>
          {/* Veredicto general */}
          <div className={`rounded-lg border p-4 flex items-start gap-3 ${
            d.todoBien ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
            {d.todoBien
              ? <CheckCircle2 size={22} className="text-emerald-600 mt-0.5 shrink-0" />
              : <AlertTriangle size={22} className="text-amber-600 mt-0.5 shrink-0" />}
            <div className="text-sm">
              <p className={`font-semibold ${d.todoBien ? 'text-emerald-800' : 'text-amber-800'}`}>
                {d.todoBien
                  ? 'La contabilidad cuadra: pólizas, balanza y balance certifican.'
                  : 'Hay descuadres que revisar. Cada tarjeta de abajo dice dónde.'}
              </p>
              {!d.todoBien && (
                <ul className="mt-1 text-amber-900/80 list-disc list-inside space-y-0.5">
                  {desc.length > 0 && <li>{desc.length} póliza(s) sin cuadrar.</li>}
                  {bz && !bz.cuadra && <li>La balanza difiere en {money(bz.diferencia)}.</li>}
                  {bal && !bal.cuadra && <li>El balance difiere en {money(bal.diferencia)}.</li>}
                  {bal && bal.cuentasSinRubro?.length > 0 &&
                    <li>{bal.cuentasSinRubro.length} cuenta(s) con saldo fuera de todo rubro (sin agrupador SAT).</li>}
                  {bal && bal.difResultado != null && Math.abs(bal.difResultado) >= 0.5 &&
                    <li>La utilidad del estado de resultados no coincide con la cuenta 305 por {money(bal.difResultado)}.</li>}
                </ul>
              )}
            </div>
          </div>

          {/* Pruebas 2 y 3 lado a lado */}
          <div className="grid gap-3 md:grid-cols-2">
            {/* Balanza */}
            {bz && (
              <Prueba ok={bz.cuadra} titulo="Balanza (cargos = abonos)">
                <dl className="text-sm space-y-1">
                  <div className="flex justify-between"><dt className="text-gray-600">Total cargos</dt>
                    <dd className="font-mono">{money(bz.cargos)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-600">Total abonos</dt>
                    <dd className="font-mono">{money(bz.abonos)}</dd></div>
                  <div className="flex justify-between border-t pt-1 font-semibold">
                    <dt>Diferencia</dt>
                    <dd className={`font-mono ${bz.cuadra ? 'text-emerald-700' : 'text-rose-700'}`}>{money(bz.diferencia)}</dd></div>
                </dl>
              </Prueba>
            )}

            {/* Balance vs Estado de resultados */}
            {mes === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                <p className="font-semibold text-gray-700 mb-1">Balance ↔ Estado de resultados</p>
                Elige un mes específico (no «Todo el año») para contrastar el balance del cierre
                contra el estado de resultados de ese periodo.
              </div>
            ) : !bal ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                <p className="font-semibold text-gray-700 mb-1">Balance ↔ Estado de resultados</p>
                {MESES[mes]} {anio} todavía no tiene saldos cargados en su balanza de periodo.
              </div>
            ) : (
              <Prueba ok={bal.cuadra} titulo="Balance ↔ Estado de resultados">
                <dl className="text-sm space-y-1">
                  <div className="flex justify-between"><dt className="text-gray-600">Activo total</dt>
                    <dd className="font-mono">{money(bal.activo)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-600">Pasivo + capital</dt>
                    <dd className="font-mono">{money(bal.pasivoMasCapital)}</dd></div>
                  <div className="flex justify-between border-t pt-1 font-semibold">
                    <dt>Diferencia</dt>
                    <dd className={`font-mono ${bal.cuadra ? 'text-emerald-700' : 'text-rose-700'}`}>{money(bal.diferencia)}</dd></div>
                  <div className="flex justify-between pt-2 mt-1 border-t"><dt className="text-gray-600">Utilidad (estado de resultados)</dt>
                    <dd className="font-mono">{money(bal.utilidadEstadoResultados)}</dd></div>
                  {bal.difResultado != null && (
                    <div className="flex justify-between"><dt className="text-gray-600">vs cuenta 305 (dif.)</dt>
                      <dd className={`font-mono ${Math.abs(bal.difResultado) < 0.5 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {money(bal.difResultado)}</dd></div>
                  )}
                </dl>
              </Prueba>
            )}
          </div>

          {/* Cuentas con saldo que quedaron fuera de todo rubro — la causa más común
              de que el balance no cuadre sin que ninguna póliza esté descuadrada. */}
          {bal && bal.cuentasSinRubro?.length > 0 && (
            <div className="bg-white rounded-lg border border-rose-200 shadow-sm overflow-hidden">
              <div className="px-4 py-2 border-b bg-rose-50 text-sm font-semibold text-rose-800">
                {bal.cuentasSinRubro.length} cuenta(s) con saldo sin código agrupador del SAT — quedan fuera del estado
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Cuenta</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Nombre</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {bal.cuentasSinRubro.map((c: any, i: number) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-mono text-xs">{formatCuenta(c.codigo, mascara)}</td>
                        <td className="px-3 py-1.5 text-xs">{c.nombre}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-xs">{money(c.saldo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-4 py-2 text-xs text-gray-500 border-t">
                Estas cuentas tienen saldo pero no llegaron a ningún rubro del balance. Asígnales su
                código agrupador en el <span className="font-medium">Catálogo de cuentas</span> (o con
                «Generar subcuentas») para que entren al estado y el balance cierre.
              </p>
            </div>
          )}

          {/* Pólizas descuadradas */}
          <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
            <div className="px-4 py-2 border-b flex items-center gap-2 text-sm">
              {desc.length === 0
                ? <><CheckCircle2 size={16} className="text-emerald-600" />
                    <span className="font-semibold text-emerald-800">Todas las pólizas cuadran</span>
                    <span className="text-gray-500">— cada asiento tiene sus cargos = sus abonos.</span></>
                : <><XCircle size={16} className="text-rose-600" />
                    <span className="font-semibold text-rose-800">{desc.length} póliza(s) sin cuadrar</span>
                    <span className="text-gray-500 ml-auto text-xs">Suma de descuadres: {money(d.sumaDescuadres)}</span></>}
            </div>
            {desc.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Fecha</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Folio</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Tipo</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Origen</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Concepto</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold">Cargos</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold">Abonos</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Motivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {desc.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5 text-xs whitespace-nowrap">{p.fecha}</td>
                        <td className="px-3 py-1.5 text-xs text-gray-500">#{p.folio}</td>
                        <td className="px-3 py-1.5 text-xs">{p.tipo}{p.estado && p.estado !== 'ASENTADA' ? ` · ${p.estado}` : ''}</td>
                        <td className="px-3 py-1.5 text-xs">{p.origen}</td>
                        <td className="px-3 py-1.5 text-xs">{p.concepto || '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-xs">{money(p.cargos)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-xs">{money(p.abonos)}</td>
                        <td className="px-3 py-1.5 text-xs text-rose-700">{p.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default ValidacionContablePage;
