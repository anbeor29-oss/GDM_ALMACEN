/**
 * Calendario de cobertura — qué días ya están en NEXO y cuáles faltan.
 *
 * UN SOLO calendario para emitidos + recibidos (antes eran dos, con un toggle).
 * Cada día trae el NÚMERO de comprobantes y se pinta con el PEOR estado de las dos
 * direcciones —verde sólo si las dos están cubiertas—. Doble clic en un día abre su
 * detalle (emitidos y recibidos por separado), para no tener que desplegar tanto.
 * El estado sale de cruzar los CFDI indexados con las solicitudes del motor
 * (GET /sat-descarga/cobertura-combinada).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Download, RefreshCw, X } from 'lucide-react';
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
const etiqueta = (estado: string) => LEYENDA.find(([k]) => k === estado)?.[1] || estado;

export function CalendarioSatPage() {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [detalle, setDetalle] = useState<any | null>(null);

  const q = useQuery({
    queryKey: ['cobertura-combinada', anio],
    queryFn: () => api.getCoberturaCombinada(anio),
  });
  const data: any = q.data?.data;
  const dias: any[] = data?.dias || [];
  const resumen: any = data?.resumen || { nexo: 0, proceso: 0, sincomp: 0, falta: 0 };
  const anioMin: number = data?.anioMin || anio;

  const porDia = useMemo(() => {
    const m = new Map<string, any>();
    for (const d of dias) m.set(d.dia, d);
    return m;
  }, [dias]);

  const totalXml = useMemo(() => dias.reduce((a, d) => a + (d.total || 0), 0), [dias]);

  const llenar = async () => {
    if (!window.confirm(`¿Crear los trabajos de descarga (emitidos y recibidos) para los meses de ${anio} con días faltantes? El motor los baja dentro del presupuesto diario.`)) return;
    setBusy(true); setMsg('');
    try {
      const re: any = await api.llenarHuecosSat(anio, 'recibidos');
      const em: any = await api.llenarHuecosSat(anio, 'emitidos');
      const n = (re?.data?.creados || 0) + (em?.data?.creados || 0);
      setMsg(n ? `${n} trabajo(s) creados. El motor los bajará dentro del presupuesto.` : 'No había huecos que pedir (o ya hay trabajos vivos sobre ellos).');
      q.refetch();
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo crear los trabajos.'); }
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
          Emitidos y recibidos en un solo calendario. El número es cuántos comprobantes hay ese día;
          <b> doble clic</b> en un día para ver el detalle. Verde sólo si las dos direcciones están cubiertas.
        </p>
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input py-1.5 text-sm w-28">
          {Array.from({ length: Math.max(1, hoy.getFullYear() - anioMin + 1) }, (_, i) => hoy.getFullYear() - i)
            .map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={() => q.refetch()} title="Actualizar" className="p-1.5 text-gray-500 hover:text-gray-700">
          <RefreshCw size={16} className={q.isFetching ? 'animate-spin' : ''} />
        </button>
        <span className="text-xs text-gray-500">{totalXml.toLocaleString('es-MX')} comprobante(s) en {anio}</span>
        <button onClick={llenar} disabled={busy}
          className="ml-auto flex items-center gap-1.5 bg-primary text-white px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
          <Download size={15} /> {busy ? 'Creando…' : 'Llenar huecos del año'}
        </button>
      </div>

      {/* Leyenda + resumen (en días) */}
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
            <Mes key={i} anio={anio} mes={i} porDia={porDia} onDia={setDetalle} />
          ))}
        </div>
      )}

      {detalle && <ModalDia info={detalle} onClose={() => setDetalle(null)} />}
    </div>
  );
}

function Mes({ anio, mes, porDia, onDia }: { anio: number; mes: number; porDia: Map<string, any>; onDia: (d: any) => void }) {
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
          const info = porDia.get(iso);
          const estado = info?.estado || 'falta';
          const total = info?.total || 0;
          return (
            <button key={i} onDoubleClick={() => info && onDia({ ...info, iso })}
              title={info ? `${iso} · ${etiqueta(estado)}${total ? ` · ${total} comprobante(s)` : ''} · doble clic para el detalle` : iso}
              className={`aspect-square flex flex-col items-center justify-center rounded leading-none ${COLOR[estado]}`}>
              <span className="text-[11px]">{d}</span>
              {total > 0 && <span className="text-[9px] font-semibold opacity-80">{total}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* Detalle de un día: emitidos y recibidos por separado (doble clic). */
function ModalDia({ info, onClose }: { info: any; onClose: () => void }) {
  const fila = (titulo: string, dir: any) => (
    <div className="flex items-center justify-between gap-3 py-2 border-b last:border-0">
      <div>
        <div className="font-medium text-gray-800">{titulo}</div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
          <span className={`w-3 h-3 rounded ${COLOR[dir?.estado || 'falta']}`} />
          {etiqueta(dir?.estado || 'falta')}
        </div>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold text-gray-900">{dir?.cfdi || 0}</div>
        <div className="text-[11px] text-gray-400">comprobante(s)</div>
      </div>
    </div>
  );
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">{info.iso}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        {fila('Emitidos', info.emi)}
        {fila('Recibidos', info.rec)}
      </div>
    </div>
  );
}

export default CalendarioSatPage;
