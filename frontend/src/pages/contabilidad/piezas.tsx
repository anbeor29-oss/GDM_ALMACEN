/**
 * Piezas comunes de los estados financieros.
 *
 * ── EL MARCO ES EL CASCARÓN ──
 * Cada estado vive en su propio menú y existe SIEMPRE, tenga datos o no. Un
 * estado que sólo aparece cuando hay algo que mostrar no se puede planear:
 * nadie sabe que existe hasta que ya se llenó.
 *
 * Cuando el mes está vacío, el marco dice qué falta y de dónde puede venir —no
 * muestra ceros. Un estado financiero en ceros parece una empresa quieta, y
 * eso es una afirmación que nadie hizo.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Lock, AlertTriangle, CheckCircle2, Info,
  Inbox, ChevronDown, ChevronsRight,
} from 'lucide-react';
import api from '@/services/api';

export const mx = (n: number) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
export const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n.toFixed(2)}%`;

export const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Los saldos del mes, que alimentan a todos los estados. */
export function usePeriodo(anio: number, mes: number) {
  return useQuery({
    queryKey: ['estados-periodo', anio, mes],
    queryFn: () => api.getEstadosDelPeriodo(anio, mes),
    staleTime: 60 * 1000,
  });
}

/* ═══════════ EL MARCO ═══════════ */

export function MarcoEstado({ titulo, norma, descripcion, children }: {
  titulo: string; norma?: string; descripcion: string;
  children: (d: any) => React.ReactNode;
}) {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const q = usePeriodo(anio, mes);
  const d: any = q.data?.data;

  const mover = (n: number) => {
    let m = mes + n, a = anio;
    if (m < 1) { m = 12; a--; } else if (m > 12) { m = 1; a++; }
    setMes(m); setAnio(a);
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            {titulo}
            {norma && (
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-teal-100 text-teal-800">
                NIF {norma}
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{descripcion}</p>
        </div>

        {/* El mes. Todos los estados se cortan por mes. */}
        <div className="flex items-center gap-1 bg-white rounded-lg border shadow-sm px-1">
          <button onClick={() => mover(-1)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
            <ChevronLeft size={16} />
          </button>
          <span className="font-semibold text-gray-900 w-40 text-center text-sm">
            {MESES[mes]} {anio}
          </span>
          <button onClick={() => mover(1)} className="p-1.5 rounded hover:bg-gray-100 text-gray-500">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {d?.periodo?.estado === 'CERRADO' && (
        <p className="text-xs text-gray-600 bg-gray-100 border rounded px-3 py-1.5 inline-flex items-center gap-1.5">
          <Lock size={13} /> Mes cerrado el{' '}
          {d.periodo.cerradoAt ? new Date(d.periodo.cerradoAt).toLocaleDateString('es-MX') : '—'}.
          Sus saldos están congelados.
        </p>
      )}

      {q.isLoading && <p className="text-gray-500">Cargando {MESES[mes]}…</p>}

      {d?.vacio && <Vacio d={d} anio={anio} mes={mes} />}

      {d && !d.vacio && (
        <>
          {d.avisos?.map((a: string, i: number) => (
            <p key={i} className="text-sm text-rose-800 bg-rose-50 border border-rose-200
              rounded px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {a}
            </p>
          ))}
          <Procedencia d={d} />
          {children(d)}
        </>
      )}
    </div>
  );
}

/** El cascarón vacío: qué falta y de dónde puede venir. */
function Vacio({ d, anio, mes }: any) {
  return (
    <div className="bg-white rounded-lg border shadow-sm p-6 text-center">
      <Inbox size={32} className="mx-auto text-gray-300" />
      <h3 className="mt-3 font-semibold text-gray-800">
        {MESES[mes]} {anio} todavía no tiene saldos
      </h3>
      <p className="text-sm text-gray-500 mt-1 max-w-lg mx-auto">
        El estado existe y está listo; lo que falta son las cifras del mes.
        Se pueden alimentar de tres formas:
      </p>
      <ul className="mt-4 text-sm text-left max-w-md mx-auto space-y-2">
        {(d.comoSeLlena || []).map((t: string, i: number) => (
          <li key={i} className="flex items-start gap-2 text-gray-700">
            <ChevronsRight size={15} className="mt-0.5 shrink-0 text-primary" /> {t}
          </li>
        ))}
      </ul>
      {d.periodo?.estado === 'SIN_EJERCICIO' && (
        <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200
          rounded px-3 py-2 inline-block">
          El ejercicio {anio} no está abierto. Actívalo en el catálogo de cuentas.
        </p>
      )}
      <a href="/contabilidad/periodos"
        className="btn-primary inline-flex items-center gap-1.5 mt-5 text-sm">
        Ir a periodos y cargar el mes
      </a>
    </div>
  );
}

/** De dónde salieron las cifras. Un saldo sin procedencia no se puede defender. */
function Procedencia({ d }: any) {
  const f = d.periodo?.fuentes || [];
  if (!f.length) return null;
  return (
    <p className="text-xs text-gray-500 flex items-start gap-1.5">
      <Info size={13} className="mt-0.5 shrink-0" />
      <span>
        {d.periodo.cuentasConSaldo} cuentas ·{' '}
        {f.map((x: any) => `${ETIQUETA_FUENTE[x.fuente] || x.fuente}${
          x.archivo ? ` (${x.archivo})` : ''}`).join(' · ')}
        {d.comparadoCon && ` · comparado con ${MESES[d.comparadoCon.mes]} ${d.comparadoCon.anio}`}
      </span>
    </p>
  );
}

export const ETIQUETA_FUENTE: Record<string, string> = {
  BALANZA_EXTERNA: 'Balanza de otro sistema',
  CFDI_EMITIDOS: 'CFDI emitidos',
  CFDI_RECIBIDOS: 'CFDI recibidos',
  NOMINA: 'Nómina timbrada',
  POLIZAS: 'Pólizas',
  MANUAL: 'Captura manual',
};

/* ═══════════ TABLA DE SECCIÓN (balance) ═══════════ */

export function SeccionBalance({ s }: any) {
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
            <RenglonRubro key={r.clave} r={r} abierto={abierto === r.clave}
              onAlternar={() => setAbierto(abierto === r.clave ? null : r.clave)} />
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

function RenglonRubro({ r, abierto, onAlternar }: any) {
  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-4 py-1.5">
          {r.detalle ? (
            <button onClick={onAlternar} className="flex items-center gap-1 text-left hover:text-primary">
              {abierto ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {r.nombre}
            </button>
          ) : <span className="ml-[18px]">{r.nombre}</span>}
          <span className="block ml-[18px] text-[10px] text-gray-400 font-mono">{r.codigos}</span>
        </td>
        <td className={`px-4 py-1.5 text-right tabular-nums whitespace-nowrap ${
          r.importe < 0 ? 'text-rose-700' : 'text-gray-900'}`}>{mx(r.importe)}</td>
        <td className="px-3 py-1.5 text-right text-xs text-gray-400 w-16">{pct(r.vertical)}</td>
      </tr>
      {abierto && r.detalle?.map((x: any, i: number) => (
        <tr key={i} className="bg-gray-50/60 text-xs">
          <td className="pl-10 pr-4 py-1 text-gray-600">{x.nombre}</td>
          <td className={`px-4 py-1 text-right tabular-nums ${
            x.importe < 0 ? 'text-rose-600' : 'text-gray-700'}`}>{mx(x.importe)}</td>
          <td />
        </tr>
      ))}
    </>
  );
}

export function Total({ etiqueta, valor, fuerte }: any) {
  return (
    <div className={`flex justify-between px-4 py-2 rounded ${
      fuerte ? 'bg-gray-900 text-white font-bold' : 'bg-gray-100 font-semibold text-gray-800'}`}>
      <span>{etiqueta}</span>
      <span className="tabular-nums">{mx(valor)}</span>
    </div>
  );
}

/* ═══════════ LISTA SIMPLE DE RUBROS (flujo) ═══════════ */

export function ListaRubros({ titulo, rubros, total, etiquetaTotal }: any) {
  const conCifra = rubros.filter((r: any) => Math.abs(r.importe) >= 1);
  return (
    <div className="bg-white rounded-lg shadow border overflow-hidden">
      <h3 className="px-4 py-2 bg-gray-50 border-b text-sm font-semibold text-gray-800">
        {titulo}
      </h3>
      <table className="w-full text-sm">
        <tbody className="divide-y">
          {conCifra.length === 0 && (
            <tr><td className="px-4 py-2 text-gray-500 text-sm">Sin movimientos en el periodo.</td></tr>
          )}
          {conCifra.map((r: any) => (
            <tr key={r.clave}>
              <td className="px-4 py-1.5 pl-8">
                {r.nombre}
                {r.codigos && <span className="ml-2 text-[10px] text-gray-400 font-mono">{r.codigos}</span>}
              </td>
              <td className={`px-4 py-1.5 text-right tabular-nums whitespace-nowrap ${
                r.importe < 0 ? 'text-rose-700' : 'text-gray-900'}`}>{mx(r.importe)}</td>
            </tr>
          ))}
          <tr className="bg-gray-50 font-semibold">
            <td className="px-4 py-2">{etiquetaTotal}</td>
            <td className={`px-4 py-2 text-right tabular-nums ${
              total < 0 ? 'text-rose-700' : 'text-gray-900'}`}>{mx(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════ ESTADO NO DISPONIBLE ═══════════ */

export function NoDisponible({ motivo }: { motivo?: string }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
      <h3 className="text-sm font-semibold text-amber-900 flex items-center gap-2">
        <AlertTriangle size={15} /> Este estado todavía no se puede armar
      </h3>
      <p className="text-sm text-amber-800 mt-1.5">{motivo}</p>
    </div>
  );
}

export function Cuadre({ ok, texto }: { ok: boolean; texto: string }) {
  return (
    <p className={`text-sm rounded px-3 py-2 flex items-center gap-2 border ${
      ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
         : 'text-rose-800 bg-rose-50 border-rose-200'}`}>
      {ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {texto}
    </p>
  );
}
