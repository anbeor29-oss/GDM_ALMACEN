/**
 * Calendario de cobertura — qué días ya están en NEXO y cuáles faltan.
 *
 * Pinta, mes por mes desde el inicio del respaldo, el estado de cada día de la
 * descarga de XML del SAT. El estado sale de cruzar los CFDI ya indexados con las
 * solicitudes del motor (GET /sat-descarga/cobertura). El botón «Llenar huecos»
 * crea trabajos SÓLO para los meses con días en gris, sin re-pedir lo cubierto.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Download, RefreshCw } from 'lucide-react';
import api from '@/services/api';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

const COLOR: Record<string, string> = {
  nexo: 'bg-emerald-100 text-emerald-800',
  proceso: 'bg-amber-100 text-amber-800',
  sincomp: 'bg-sky-100 text-sky-800',
  falta: 'bg-gray-50 text-gray-400 border border-gray-200',
};
const LEYENDA: Array<[string, string]> = [
  ['nexo', 'En NEXO (con XML)'],
  ['proceso', 'En proceso'],
  ['sincomp', 'Pedido sin comprobantes'],
  ['falta', 'Falta por pedir'],
];

export function CalendarioSatPage() {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [direccion, setDireccion] = useState<'recibidos' | 'emitidos'>('recibidos');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ['cobertura-sat', anio, direccion],
    queryFn: () => api.getCoberturaSat(anio, direccion),
  });
  const data: any = q.data?.data;
  const dias: any[] = data?.dias || [];
  const resumen: any = data?.resumen || { nexo: 0, proceso: 0, sincomp: 0, falta: 0 };
  const anioMin: number = data?.anioMin || anio;

  const estadoDe = useMemo(() => {
    const m = new Map<string, any>();
    for (const d of dias) m.set(d.dia, d);
    return m;
  }, [dias]);

  const llenar = async () => {
    if (!window.confirm(`¿Crear los trabajos de descarga para los meses de ${anio} con días faltantes (${direccion})? El motor los baja dentro del presupuesto diario.`)) return;
    setBusy(true); setMsg('');
    try { const r: any = await api.llenarHuecosSat(anio, direccion); setMsg(r?.message || 'Trabajos creados.'); q.refetch(); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo crear los trabajos.'); }
    finally { setBusy(false); }
  };

  const mesesAMostrar = anio >= hoy.getFullYear() ? hoy.getMonth() + 1 : 12;

  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <CalendarDays size={22} className="text-emerald-600" /> Calendario de descarga
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Los días que ya están en NEXO y los que faltan, desde el inicio del respaldo.
        </p>
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border overflow-hidden text-sm">
          {(['recibidos', 'emitidos'] as const).map((d) => (
            <button key={d} onClick={() => setDireccion(d)}
              className={`px-3 py-1.5 ${direccion === d ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {d === 'recibidos' ? 'Recibidos' : 'Emitidos'}
            </button>
          ))}
        </div>
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input py-1.5 text-sm w-28">
          {Array.from({ length: Math.max(1, hoy.getFullYear() - anioMin + 1) }, (_, i) => hoy.getFullYear() - i)
            .map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={() => q.refetch()} title="Actualizar" className="p-1.5 text-gray-500 hover:text-gray-700">
          <RefreshCw size={16} className={q.isFetching ? 'animate-spin' : ''} />
        </button>
        <button onClick={llenar} disabled={busy}
          className="ml-auto flex items-center gap-1.5 bg-primary text-white px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
          <Download size={15} /> {busy ? 'Creando…' : 'Llenar huecos del año'}
        </button>
      </div>

      {/* Leyenda + resumen */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600">
        {LEYENDA.map(([k, label]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`w-3.5 h-3.5 rounded ${COLOR[k]}`} />
            {label} <b className="text-gray-800">{resumen[k] ?? 0}</b>
          </span>
        ))}
      </div>

      {msg && <p className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded px-3 py-2">{msg}</p>}

      {q.isLoading ? (
        <p className="text-sm text-gray-500">Cargando…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: mesesAMostrar }, (_, i) => (
            <Mes key={i} anio={anio} mes={i} estadoDe={estadoDe} />
          ))}
        </div>
      )}
    </div>
  );
}

function Mes({ anio, mes, estadoDe }: { anio: number; mes: number; estadoDe: Map<string, any> }) {
  const primero = new Date(Date.UTC(anio, mes, 1)).getUTCDay();
  const dim = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const celdas: Array<number | null> = [];
  for (let i = 0; i < primero; i++) celdas.push(null);
  for (let d = 1; d <= dim; d++) celdas.push(d);

  return (
    <div className="bg-white rounded-lg border shadow-sm p-3">
      <div className="text-sm font-medium text-gray-800 mb-2">{MESES[mes]}</div>
      <div className="grid grid-cols-7 gap-1">
        {DOW.map((w, i) => <div key={i} className="text-[10px] text-gray-400 text-center">{w}</div>)}
        {celdas.map((d, i) => {
          if (d === null) return <div key={i} />;
          const iso = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const info = estadoDe.get(iso);
          const estado = info?.estado || 'falta';
          const titulo = info
            ? `${iso} · ${LEYENDA.find(([k]) => k === estado)?.[1]}${info.cfdi ? ` · ${info.cfdi} CFDI` : ''}`
            : iso;
          return (
            <div key={i} title={titulo}
              className={`aspect-square flex items-center justify-center text-[11px] rounded ${COLOR[estado]}`}>
              {d}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default CalendarioSatPage;
