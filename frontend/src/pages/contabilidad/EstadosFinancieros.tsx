/**
 * Estados financieros — situación financiera, resultados y razones.
 *
 * ── DE DÓNDE SALEN LAS CIFRAS HOY ──
 * De la balanza que se sube en esta pantalla. Mientras la contabilidad de NEXO
 * no genere sus propios saldos, el estado es una lectura del archivo — y se
 * dice así, en la pantalla. Presentarlo como si el sistema lo hubiera
 * producido sería atribuirse un dato que viene de afuera.
 *
 * ── LO PRIMERO QUE SE VE ES SI CUADRA ──
 * Un balance descuadrado que se presenta igual es la peor salida posible: se
 * ve como un estado financiero. Por eso el cuadre va arriba de todo y en rojo,
 * antes que cualquier cifra.
 */
import { useState } from 'react';
import {
  Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, TrendingUp,
  Scale, Info, ChevronDown, ChevronRight,
} from 'lucide-react';
import api from '@/services/api';

const mx = (n: number) =>
  n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n.toFixed(2)}%`;

const COLOR_SEMAFORO: Record<string, string> = {
  VERDE: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  AMBAR: 'bg-amber-100 text-amber-800 border-amber-200',
  ROJO: 'bg-rose-100 text-rose-800 border-rose-200',
  SIN_DATO: 'bg-gray-100 text-gray-600 border-gray-200',
};

export function EstadosFinancierosPage() {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [anterior, setAnterior] = useState<File | null>(null);
  const [fechaCorte, setFechaCorte] = useState(new Date().toISOString().slice(0, 10));
  const [diasPeriodo, setDiasPeriodo] = useState(365);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState<'balance' | 'resultados' | 'razones' | 'nif' | 'horizontal'>('balance');

  const generar = async () => {
    if (!archivo) return;
    setError(''); setBusy(true); setD(null);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      if (anterior) fd.append('anterior', anterior);
      fd.append('fechaCorte', fechaCorte);
      fd.append('diasPeriodo', String(diasPeriodo));
      const r = await api.generarEstadosFinancieros(fd);
      setD(r.data);
      setTab('balance');
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Scale size={22} className="text-primary" /> Estados financieros
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Situación financiera (B-6), resultado integral (B-3) y razones, sobre el
          código agrupador del SAT.
        </p>
      </div>

      {/* ── Carga ── */}
      <div className="bg-white rounded-lg shadow border p-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Cargador etiqueta="Balanza del periodo *" archivo={archivo} onElegir={setArchivo} />
          <Cargador etiqueta="Balanza anterior (para comparar)" archivo={anterior}
            onElegir={setAnterior} opcional />
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <label className="block">
            <span className="text-xs text-gray-600">Fecha de corte</span>
            <input type="date" value={fechaCorte} onChange={(e) => setFechaCorte(e.target.value)}
              className="input" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-600">Días del periodo</span>
            <input type="number" value={diasPeriodo}
              onChange={(e) => setDiasPeriodo(Number(e.target.value))}
              className="input w-28" />
            {/* Usar 365 sobre una balanza de un mes multiplica por doce los
                días de cartera, y el número sale con toda la cara de ser bueno. */}
            <span className="block text-[11px] text-gray-500 max-w-[15rem]">
              Los días que abarca la balanza. Con 365 sobre un mes, las rotaciones
              salen doce veces más largas.
            </span>
          </label>
          <button onClick={generar} disabled={busy || !archivo}
            className="btn-primary disabled:opacity-50">
            {busy ? 'Calculando…' : 'Generar estados'}
          </button>
        </div>

        {error && (
          <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {d && (
        <>
          {/* ── El cuadre, antes que cualquier cifra ── */}
          {d.avisos?.map((a: string, i: number) => (
            <p key={i} className="text-sm text-rose-800 bg-rose-50 border border-rose-200
              rounded px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {a}
            </p>
          ))}
          {d.situacionFinanciera.cuadra && !d.avisos?.length && (
            <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200
              rounded px-3 py-2 flex items-center gap-2">
              <CheckCircle2 size={15} /> El balance cuadra: activo ={' '}
              {mx(d.situacionFinanciera.activoTotal)} = pasivo más capital.
            </p>
          )}

          <p className="text-xs text-gray-500 flex items-center gap-1.5">
            <Info size={13} />
            {d.encabezado?.razonSocial && <b>{d.encabezado.razonSocial} · </b>}
            Calculado desde la balanza que subiste ({d.origen}), {d.balanza.hojas} cuentas
            de detalle. NEXO todavía no genera estos saldos: los lee del archivo.
          </p>

          {/* ── Pestañas ── */}
          <div className="flex flex-wrap gap-1 border-b">
            {([
              ['balance', 'Situación financiera'],
              ['resultados', 'Resultado integral'],
              ['razones', 'Razones'],
              ['nif', `NIF${d.nif.noCumple ? ` (${d.nif.noCumple})` : ''}`],
              ...(d.horizontal ? [['horizontal', 'Comparativo'] as const] : []),
            ] as Array<[string, string]>).map(([k, t]) => (
              <button key={k} onClick={() => setTab(k as any)}
                className={`px-3 py-2 text-sm border-b-2 -mb-px ${
                  tab === k ? 'border-primary text-primary font-medium'
                            : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                {t}
              </button>
            ))}
          </div>

          {tab === 'balance' && <Balance b={d.situacionFinanciera} />}
          {tab === 'resultados' && <Resultados r={d.resultadoIntegral} />}
          {tab === 'razones' && <Razones razones={d.razones} />}
          {tab === 'nif' && <Nif nif={d.nif} />}
          {tab === 'horizontal' && d.horizontal && <Horizontal filas={d.horizontal} />}
        </>
      )}
    </div>
  );
}

/* ═══════════ CARGADOR ═══════════ */

function Cargador({ etiqueta, archivo, onElegir, opcional }: any) {
  return (
    <label className="block">
      <span className="text-xs text-gray-600">{etiqueta}</span>
      <div className={`border border-dashed rounded px-3 py-3 text-sm cursor-pointer
        hover:border-primary ${archivo ? 'border-emerald-300 bg-emerald-50/40' : ''}`}>
        <input type="file" accept=".xlsx,.xls,.pdf" className="hidden"
          onChange={(e) => onElegir(e.target.files?.[0] || null)} />
        <span className="flex items-center gap-2 text-gray-700">
          {archivo ? <FileSpreadsheet size={16} className="text-emerald-600" />
                   : <Upload size={16} className="text-gray-400" />}
          {archivo ? archivo.name : (opcional ? 'Excel o PDF (opcional)' : 'Elige el Excel o PDF')}
        </span>
      </div>
    </label>
  );
}

/* ═══════════ SITUACIÓN FINANCIERA ═══════════ */

function Balance({ b }: any) {
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-4">
        <SeccionBalance s={b.activoCirculante} />
        <SeccionBalance s={b.activoNoCirculante} />
        <Total etiqueta="ACTIVO TOTAL" valor={b.activoTotal} fuerte />
      </div>
      <div className="space-y-4">
        <SeccionBalance s={b.pasivoCorto} />
        <SeccionBalance s={b.pasivoLargo} />
        <Total etiqueta="Pasivo total" valor={b.pasivoTotal} />
        <SeccionBalance s={b.capital} />
        <Total etiqueta="PASIVO + CAPITAL" valor={b.pasivoTotal + b.capitalTotal} fuerte />
        {!b.cuadra && (
          <p className="text-sm text-rose-700 font-medium text-right">
            Diferencia: {mx(b.diferencia)}
          </p>
        )}
      </div>
    </div>
  );
}

function SeccionBalance({ s }: any) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const conSaldo = s.rubros.filter((r: any) => Math.abs(r.importe) >= 1);
  if (!conSaldo.length) return null;

  return (
    <div className="bg-white rounded-lg shadow border overflow-hidden">
      <h3 className="px-4 py-2 bg-gray-50 border-b text-sm font-semibold text-gray-800">
        {s.nombre}
      </h3>
      <table className="w-full text-sm">
        <tbody className="divide-y">
          {conSaldo.map((r: any) => (
            <>
              <tr key={r.clave} className="hover:bg-gray-50">
                <td className="px-4 py-1.5">
                  {r.detalle ? (
                    <button onClick={() => setAbierto(abierto === r.clave ? null : r.clave)}
                      className="flex items-center gap-1 text-left hover:text-primary">
                      {abierto === r.clave ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      {r.nombre}
                    </button>
                  ) : <span className="ml-[18px]">{r.nombre}</span>}
                  <span className="block ml-[18px] text-[10px] text-gray-400 font-mono">
                    {r.codigos}
                  </span>
                </td>
                <td className={`px-4 py-1.5 text-right tabular-nums whitespace-nowrap ${
                  r.importe < 0 ? 'text-rose-700' : 'text-gray-900'}`}>
                  {mx(r.importe)}
                </td>
                <td className="px-3 py-1.5 text-right text-xs text-gray-400 w-16">
                  {pct(r.vertical)}
                </td>
              </tr>
              {abierto === r.clave && r.detalle?.map((x: any, i: number) => (
                <tr key={`${r.clave}-${i}`} className="bg-gray-50/60 text-xs">
                  <td className="pl-10 pr-4 py-1 text-gray-600">{x.nombre}</td>
                  <td className={`px-4 py-1 text-right tabular-nums ${
                    x.importe < 0 ? 'text-rose-600' : 'text-gray-700'}`}>{mx(x.importe)}</td>
                  <td />
                </tr>
              ))}
            </>
          ))}
          <tr className="bg-gray-50 font-semibold">
            <td className="px-4 py-2">Total {s.nombre.toLowerCase()}</td>
            <td className="px-4 py-2 text-right tabular-nums">{mx(s.total)}</td>
            <td className="px-3 py-2 text-right text-xs text-gray-500">{pct(s.vertical)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Total({ etiqueta, valor, fuerte }: any) {
  return (
    <div className={`flex justify-between px-4 py-2 rounded ${
      fuerte ? 'bg-gray-900 text-white font-bold' : 'bg-gray-100 font-semibold text-gray-800'}`}>
      <span>{etiqueta}</span>
      <span className="tabular-nums">{mx(valor)}</span>
    </div>
  );
}

/* ═══════════ RESULTADOS ═══════════ */

const SUBTOTALES = ['INGRESOS_NETOS', 'UTILIDAD_BRUTA', 'UTILIDAD_OPERACION', 'UAI', 'UTILIDAD_NETA'];

function Resultados({ r }: any) {
  return (
    <div className="bg-white rounded-lg shadow border overflow-hidden max-w-3xl">
      <table className="w-full text-sm">
        <tbody className="divide-y">
          {r.renglones.filter((x: any) => Math.abs(x.importe) >= 1 || SUBTOTALES.includes(x.clave))
            .map((x: any) => {
            const esSubtotal = SUBTOTALES.includes(x.clave);
            return (
              <tr key={x.clave} className={esSubtotal ? 'bg-gray-50 font-semibold' : ''}>
                <td className={`px-4 py-1.5 ${esSubtotal ? '' : 'pl-8'}`}>
                  {x.nombre}
                  {x.codigos && (
                    <span className="ml-2 text-[10px] text-gray-400 font-mono">{x.codigos}</span>
                  )}
                </td>
                <td className={`px-4 py-1.5 text-right tabular-nums whitespace-nowrap ${
                  x.importe < 0 ? 'text-rose-700' : 'text-gray-900'}`}>
                  {mx(x.importe)}
                </td>
                <td className="px-3 py-1.5 text-right text-xs text-gray-400 w-16">
                  {pct(x.vertical)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {r.diferenciaCon305 !== null && Math.abs(r.diferenciaCon305) > 1 && (
        <p className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-t">
          La utilidad calculada no coincide con la cuenta 305 de la balanza
          ({mx(r.resultadoSegun305)}). Diferencia: {mx(r.diferenciaCon305)}.
        </p>
      )}
    </div>
  );
}

/* ═══════════ RAZONES ═══════════ */

function Razones({ razones }: any) {
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {razones.map((z: any) => (
        <div key={z.clave} className={`rounded-lg border p-3 ${COLOR_SEMAFORO[z.semaforo]}`}>
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="font-semibold text-sm">{z.nombre}</h4>
            <span className="text-lg font-bold tabular-nums whitespace-nowrap">
              {z.valor === null ? '—'
                : z.unidad === 'PORCENTAJE' ? `${z.valor.toFixed(2)}%`
                : z.unidad === 'PESOS' ? mx(z.valor)
                : z.unidad === 'DIAS' ? `${Math.round(z.valor)} d`
                : z.valor.toFixed(2)}
            </span>
          </div>
          <p className="text-[11px] opacity-75 font-mono mt-0.5">{z.formula}</p>
          <p className="text-xs mt-1.5">{z.interpretacion}</p>
          {/* Las cifras base: sin ellas la razón es una opinión. */}
          <p className="text-[10px] opacity-70 mt-1.5 font-mono break-words">
            {Object.entries(z.base).map(([k, v]: any) =>
              `${k}: ${typeof v === 'number' ? v.toLocaleString('es-MX') : v}`).join(' · ')}
          </p>
          {z.referencia && (
            <p className="text-[10px] opacity-70 mt-1">Referencia: {z.referencia}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ═══════════ NIF ═══════════ */

function Nif({ nif }: any) {
  const icono: Record<string, any> = {
    NO_CUMPLE: <AlertTriangle size={15} className="text-rose-600 shrink-0 mt-0.5" />,
    REQUIERE_REVISION: <Info size={15} className="text-amber-600 shrink-0 mt-0.5" />,
    CUMPLE: <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" />,
  };
  const fondo: Record<string, string> = {
    NO_CUMPLE: 'border-rose-200 bg-rose-50/50',
    REQUIERE_REVISION: 'border-amber-200 bg-amber-50/40',
    CUMPLE: 'border-emerald-200 bg-emerald-50/30',
  };
  return (
    <div className="space-y-2 max-w-4xl">
      {nif.hallazgos.map((h: any, i: number) => (
        <div key={i} className={`rounded border p-3 ${fondo[h.estado] || ''}`}>
          <div className="flex items-start gap-2">
            {icono[h.estado]}
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-gray-900">
                <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 mr-2">
                  {h.norma}
                </span>
                {h.titulo}
              </h4>
              <p className="text-sm text-gray-700 mt-1">{h.mensaje}</p>
              {h.estado !== 'CUMPLE' && (
                <>
                  <p className="text-xs text-gray-600 mt-1.5"><b>Qué exige:</b> {h.queExige}</p>
                  <p className="text-xs text-gray-600 mt-0.5"><b>Si no:</b> {h.consecuencia}</p>
                  {h.fundamento && (
                    <p className="text-[11px] text-gray-500 mt-0.5">{h.fundamento}</p>
                  )}
                </>
              )}
              {h.cuentas?.length > 0 && (
                <p className="text-[11px] text-gray-500 mt-1 break-words">
                  {h.cuentas.slice(0, 5).join(' · ')}
                  {h.cuentas.length > 5 && ` … y ${h.cuentas.length - 5} más`}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
      {!nif.hallazgos.length && (
        <p className="text-sm text-gray-500">Ninguna regla NIF aplicable a estos saldos.</p>
      )}
    </div>
  );
}

/* ═══════════ HORIZONTAL ═══════════ */

function Horizontal({ filas }: any) {
  return (
    <div className="bg-white rounded-lg shadow border overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-600">
          <tr>
            <th className="px-4 py-2 text-left">Rubro</th>
            <th className="px-4 py-2 text-right">Actual</th>
            <th className="px-4 py-2 text-right">Anterior</th>
            <th className="px-4 py-2 text-right">Variación</th>
            <th className="px-4 py-2 text-right">%</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {filas.map((f: any) => (
            <tr key={f.clave} className={f.alerta ? 'bg-amber-50/60' : ''}>
              <td className="px-4 py-1.5">
                {f.alerta && <TrendingUp size={12} className="inline mr-1 text-amber-600" />}
                {f.nombre}
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums">{mx(f.actual)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-gray-500">{mx(f.anterior)}</td>
              <td className={`px-4 py-1.5 text-right tabular-nums ${
                f.variacion < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{mx(f.variacion)}</td>
              <td className="px-4 py-1.5 text-right text-xs text-gray-500">
                {f.variacionPct === null ? '—' : `${f.variacionPct.toFixed(1)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-gray-500 border-t">
        Se marca alerta cuando la variación pasa el 20% <b>y</b> supera $500,000. Sólo con el
        porcentaje, un rubro que va de $100 a $200 sale como +100% y entierra al que se
        movió medio millón.
      </p>
    </div>
  );
}

export default EstadosFinancierosPage;
