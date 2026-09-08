/**
 * Reportes especiales — versiones de DIAGNÓSTICO de la balanza y del estado de
 * situación financiera, agrupadas por dígito agrupador del SAT y con cada cuenta
 * contable, para ver DÓNDE está el error (cuentas sin agrupador o mal agrupadas que
 * descuadran el balance sin descuadrar ninguna póliza).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSearch, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api } from '@/services/api';
import { aniosContables } from '@/utils/anios';
import { formatCuenta, useMascara } from '@/utils/cuenta';

const money = (n: any) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function ReportesEspecialesPage() {
  const hoy = new Date();
  const mascara = useMascara();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [tab, setTab] = useState<'balanza' | 'situacion'>('situacion');

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileSearch size={22} className="text-violet-600" /> Reportes especiales
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          La balanza y la situación financiera agrupadas por dígito agrupador del SAT y por
          cuenta contable, para localizar dónde está el error.
        </p>
      </div>

      <div className="bg-white rounded-lg border shadow-sm p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[11px] text-gray-600 block">Año</label>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input text-sm">
            {aniosContables().map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-gray-600 block">Mes</label>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input text-sm">
            {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="ml-auto flex gap-1 border rounded-lg p-0.5 bg-gray-50">
          {([['situacion', 'Situación financiera'], ['balanza', 'Balanza']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-md text-sm ${tab === k ? 'bg-white shadow font-medium text-violet-700' : 'text-gray-600'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'balanza'
        ? <BalanzaEspecial anio={anio} mes={mes} mascara={mascara} />
        : <SituacionEspecial anio={anio} mes={mes} mascara={mascara} />}
    </div>
  );
}

/* ── Balanza especial: grupos por agrupador, con cada cuenta ── */
function BalanzaEspecial({ anio, mes, mascara }: any) {
  const q = useQuery({ queryKey: ['bal-especial', anio, mes], queryFn: () => api.getBalanzaEspecial(anio, mes) });
  const d: any = q.data?.data;
  if (q.isLoading) return <p className="text-sm text-gray-500">Cargando…</p>;
  if (!d) return <p className="text-sm text-gray-500 italic bg-white border rounded-lg p-4 text-center">{MESES[mes]} {anio} todavía no tiene balanza cargada.</p>;

  return (
    <div className="space-y-3">
      <div className={`rounded-lg border px-4 py-2 text-sm flex flex-wrap items-center gap-x-6 ${d.cuadra ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
        <span className="flex items-center gap-1.5 font-medium">
          {d.cuadra ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertTriangle size={16} className="text-rose-600" />}
          {d.cuadra ? 'La balanza cuadra' : 'La balanza NO cuadra'}
        </span>
        <span>Cargos {money(d.sumaCargos)}</span>
        <span>Abonos {money(d.sumaAbonos)}</span>
        {d.sinAgrupador > 0 && <span className="text-rose-700 font-medium">{d.sinAgrupador} cuenta(s) sin agrupador</span>}
      </div>

      {d.grupos.map((g: any, i: number) => (
        <div key={i} className={`bg-white border rounded-lg overflow-hidden ${g.sinAgrupador ? 'border-rose-300' : ''}`}>
          <div className={`px-3 py-2 border-b flex flex-wrap items-center gap-x-3 text-sm ${g.sinAgrupador ? 'bg-rose-50 text-rose-800' : 'bg-gray-50'}`}>
            <span className="font-mono font-semibold">{g.sinAgrupador ? '(sin agrupador)' : g.agrupador}</span>
            {g.agrupadorNombre && <span className="text-gray-600">{g.agrupadorNombre}</span>}
            <span className="text-xs text-gray-400">{g.cuentas.length} cuenta(s)</span>
            <span className="ml-auto font-mono">saldo {money(g.saldoFinal)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50/60 text-gray-500">
                <tr>
                  <th className="px-3 py-1.5 text-left font-semibold">Cuenta</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Nombre</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Saldo inicial</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Cargos</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Abonos</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Saldo final</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {g.cuentas.map((c: any, k: number) => (
                  <tr key={k} className="hover:bg-gray-50">
                    <td className="px-3 py-1 font-mono whitespace-nowrap">{formatCuenta(c.codigo, mascara)}</td>
                    <td className="px-2 py-1">{c.nombre}</td>
                    <td className="px-3 py-1 text-right font-mono">{money(c.saldoInicial)}</td>
                    <td className="px-3 py-1 text-right font-mono">{c.cargos ? money(c.cargos) : ''}</td>
                    <td className="px-3 py-1 text-right font-mono">{c.abonos ? money(c.abonos) : ''}</td>
                    <td className="px-3 py-1 text-right font-mono">{money(c.saldoFinal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Situación especial: sección → agrupador → cuenta, + fuera de rubro ── */
function SituacionEspecial({ anio, mes, mascara }: any) {
  const q = useQuery({ queryKey: ['sit-especial', anio, mes], queryFn: () => api.getSituacionEspecial(anio, mes) });
  const d: any = q.data?.data;
  if (q.isLoading) return <p className="text-sm text-gray-500">Cargando…</p>;
  if (!d) return <p className="text-sm text-gray-500 italic bg-white border rounded-lg p-4 text-center">{MESES[mes]} {anio} todavía no tiene saldos cargados.</p>;
  const o = d.oficial || {};

  return (
    <div className="space-y-3">
      {/* Cuadre oficial (las cifras del estado probado) */}
      <div className={`rounded-lg border px-4 py-2 text-sm flex flex-wrap items-center gap-x-6 gap-y-1 ${o.cuadra ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
        <span className="flex items-center gap-1.5 font-medium">
          {o.cuadra ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertTriangle size={16} className="text-rose-600" />}
          {o.cuadra ? 'El balance cuadra' : 'El balance NO cuadra'}
        </span>
        <span>Activo {money(o.activo)}</span>
        <span>Pasivo + capital {money(o.pasivoMasCapital)}</span>
        <span className={Math.abs(Number(o.diferencia)) >= 0.5 ? 'text-rose-700 font-semibold' : ''}>Diferencia {money(o.diferencia)}</span>
        <span className="text-gray-500">Utilidad {money(o.utilidad)}</span>
      </div>

      {/* Cuentas fuera de rubro: la causa del descuadre */}
      {d.fueraDeRubro?.length > 0 && (
        <div className="bg-white rounded-lg border border-rose-300 overflow-hidden">
          <div className="px-3 py-2 border-b bg-rose-50 text-sm font-semibold text-rose-800">
            {d.fueraDeRubro.length} cuenta(s) con saldo FUERA de todo rubro — aquí está el error
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-1.5 text-left font-semibold">Cuenta</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Nombre</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Agrupador</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Sección</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {d.fueraDeRubro.map((f: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-1 font-mono whitespace-nowrap">{formatCuenta(f.codigo, mascara)}</td>
                    <td className="px-2 py-1">{f.nombre}</td>
                    <td className="px-2 py-1 font-mono">{f.agrupador || <span className="text-rose-600">sin</span>}</td>
                    <td className="px-2 py-1">{f.seccion}</td>
                    <td className="px-3 py-1 text-right font-mono">{money(f.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-xs text-gray-500 border-t">
            Estas cuentas no entran a ningún rubro del balance. Corrige su agrupador SAT en el
            Catálogo de cuentas (o con «Proponer agrupador») para que el balance cierre.
          </p>
        </div>
      )}

      {/* Cada sección → agrupador → cuentas */}
      {d.secciones.map((s: any) => (
        <div key={s.seccion} className="bg-white border rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b bg-gray-50 flex items-center gap-2 text-sm">
            <span className="font-semibold text-gray-800">{s.seccion}</span>
            <span className="ml-auto font-mono">{money(s.total)}</span>
          </div>
          {s.grupos.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">Sin cuentas con saldo.</p>
          ) : s.grupos.map((g: any, i: number) => (
            <div key={i} className="border-b last:border-0">
              <div className="px-3 py-1 bg-gray-50/40 flex items-center gap-2 text-xs">
                <span className="font-mono font-medium text-gray-700">{g.agrupador}</span>
                {g.agrupadorNombre && <span className="text-gray-500">{g.agrupadorNombre}</span>}
                <span className="ml-auto font-mono text-gray-600">{money(g.subtotal)}</span>
              </div>
              <table className="w-full text-xs">
                <tbody className="divide-y">
                  {g.cuentas.map((c: any, k: number) => (
                    <tr key={k} className="hover:bg-gray-50">
                      <td className="px-3 py-1 font-mono whitespace-nowrap w-28">{formatCuenta(c.codigo, mascara)}</td>
                      <td className="px-2 py-1">{c.nombre}</td>
                      <td className="px-3 py-1 text-right font-mono w-32">{money(c.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default ReportesEspecialesPage;
