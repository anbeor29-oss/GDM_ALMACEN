/**
 * Registro de asistencia (requerimiento de ley) — dos vistas:
 *
 *   · Del día  — hoja tipo cálculo: el día arriba; una fila por trabajador con
 *                su ENTRADA y su SALIDA (hora de México) y las horas.
 *   · Historial— el registro electrónico completo: cada checada, con fecha/hora,
 *                tipo, origen (kiosco/campo), estado y UBICACIÓN (coordenadas →
 *                se abren en Google Maps). Se descarga en CSV.
 *
 * Se usa dentro del admin del Checador (pestaña Registro) y también a pantalla
 * completa en `/checador/registro` (para verlo en el celular).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Calendar, MapPin, Download, ClipboardList, Settings, FileSpreadsheet, FileText, ArrowLeft } from 'lucide-react';
import { claseOpcion } from '@/utils/coloresOpciones';
import api from '@/services/api';

const hoy = () => new Date().toLocaleDateString('en-CA');              // YYYY-MM-DD local
const primerDiaMes = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA');
};

export function RegistroAsistencia() {
  const [vista, setVista] = useState<'dia' | 'historial'>('dia');
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 flex-wrap">
        {([['dia', 'Del día'], ['historial', 'Historial']] as const).map(([k, l], i) => (
          <button key={k} onClick={() => setVista(k)} className={claseOpcion(i, vista === k)}>{l}</button>
        ))}
      </div>
      {vista === 'dia' ? <VistaDia /> : <VistaHistorial />}
    </div>
  );
}

function VistaDia() {
  const [fecha, setFecha] = useState(hoy());
  const q = useQuery({ queryKey: ['checador-asis-dia', fecha], queryFn: () => api.checadorAsistenciaDia(fecha) });
  const filas: any[] = q.data?.data?.filas || [];

  return (
    <div className="bg-white rounded-lg shadow border p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-sm text-gray-600 flex items-center gap-1"><Calendar size={15} /> Día</label>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
          className="rounded border px-2 py-1.5 text-sm" />
        <span className="text-xs text-gray-500">{filas.length} trabajador(es) con movimiento</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-gray-50 border-y text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Trabajador</th><th className="px-3 py-2 text-left">Puesto</th><th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Entrada</th><th className="px-3 py-2">Salida</th>
              <th className="px-3 py-2">Horas</th><th className="px-3 py-2">Movs</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">Cargando…</td></tr>
            ) : filas.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-500">Sin checadas ese día.</td></tr>
            ) : filas.map((f) => (
              <tr key={f.empleado_id}>
                <td className="px-3 py-2 font-medium text-gray-800">
                  {f.nombre}
                  {f.hubo_campo && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700">campo</span>}
                </td>
                <td className="px-3 py-2 text-gray-500">{f.puesto || '—'}</td>
                <td className="px-3 py-2 text-center font-mono text-gray-500">{f.num_empleado || '—'}</td>
                <td className="px-3 py-2 text-center font-mono text-emerald-700">{f.entrada || '—'}</td>
                <td className="px-3 py-2 text-center font-mono text-sky-700">{f.salida || '—'}</td>
                <td className="px-3 py-2 text-center font-mono">{f.horas != null ? f.horas : '—'}</td>
                <td className="px-3 py-2 text-center text-gray-500">{f.movimientos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VistaHistorial() {
  const [desde, setDesde] = useState(primerDiaMes());
  const [hasta, setHasta] = useState(hoy());
  const [empleadoId, setEmpleadoId] = useState('');
  const empQ = useQuery({ queryKey: ['checador-emp-hist'], queryFn: () => api.checadorEmpleadosEnrolar() });
  const empleados: any[] = empQ.data?.data || [];
  const q = useQuery({
    queryKey: ['checador-hist', desde, hasta, empleadoId],
    queryFn: () => api.checadorHistorial({ desde, hasta, empleadoId: empleadoId || undefined, limit: 3000 }),
  });
  const filas: any[] = q.data?.data || [];

  const descargarCsv = () => {
    const cab = ['Fecha', 'Hora', 'Trabajador', 'Num', 'Tipo', 'Origen', 'Estado', 'Lat', 'Lng'];
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cuerpo = filas.map((f) =>
      [f.fecha, f.hora, f.nombre, f.num_empleado || '', f.tipo, f.origen, f.estado, f.lat ?? '', f.lng ?? ''].map(esc).join(','));
    const blob = new Blob(['﻿' + [cab.join(','), ...cuerpo].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `asistencia_${desde}_a_${hasta}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-lg shadow border p-4 space-y-3">
      <div className="flex items-end gap-2 flex-wrap">
        <label className="text-xs text-gray-600">Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="block rounded border px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-gray-600">Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="block rounded border px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-gray-600">Trabajador
          <select value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)} className="block rounded border px-2 py-1.5 text-sm max-w-[200px]">
            <option value="">Todos</option>
            {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
        <button onClick={descargarCsv} disabled={!filas.length}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <Download size={15} /> CSV
        </button>
        <button onClick={() => api.descargarHistorialChecador({ desde, hasta, empleadoId: empleadoId || undefined }, 'xlsx')} disabled={!filas.length}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
          <FileSpreadsheet size={15} /> Excel
        </button>
        <button onClick={() => api.descargarHistorialChecador({ desde, hasta, empleadoId: empleadoId || undefined }, 'pdf')} disabled={!filas.length}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50">
          <FileText size={15} /> PDF
        </button>
        <span className="text-xs text-gray-500">{filas.length} registro(s)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead className="bg-gray-50 border-y text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Fecha</th><th className="px-3 py-2">Hora</th>
              <th className="px-3 py-2 text-left">Trabajador</th><th className="px-3 py-2 text-left">Puesto</th><th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Origen</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Ubicación</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">Cargando…</td></tr>
            ) : filas.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">Sin registros en el rango.</td></tr>
            ) : filas.map((f) => (
              <tr key={f.id}>
                <td className="px-3 py-2 font-mono text-gray-600">{f.fecha}</td>
                <td className="px-3 py-2 text-center font-mono">{f.hora}</td>
                <td className="px-3 py-2 font-medium text-gray-800">
                  {f.nombre}{f.num_empleado ? <span className="text-xs text-gray-400 ml-1">#{f.num_empleado}</span> : null}
                </td>
                <td className="px-3 py-2 text-gray-500">{f.puesto || '—'}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    f.tipo === 'ENTRADA' ? 'bg-emerald-100 text-emerald-700'
                    : f.tipo === 'SALIDA' ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-600'}`}>{f.tipo}</span>
                </td>
                <td className="px-3 py-2 text-center text-gray-500">{f.origen === 'APP' ? 'Campo' : 'Kiosco'}</td>
                <td className="px-3 py-2 text-center text-gray-500">{f.estado}</td>
                <td className="px-3 py-2 text-center">
                  {f.lat != null && f.lng != null
                    ? <a className="text-cyan-700 inline-flex items-center gap-0.5" href={`https://www.google.com/maps?q=${f.lat},${f.lng}`} target="_blank" rel="noreferrer"><MapPin size={13} /> ver</a>
                    : <span className="text-gray-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A pantalla completa, para verlo en el celular (fuera del Layout del ERP). */
export function ChecadorRegistroPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Link to="/checador" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 border rounded-lg px-2.5 py-1.5">
              <ArrowLeft size={16} /> Regresar
            </Link>
            <h1 className="text-xl font-bold flex items-center gap-2"><ClipboardList size={22} /> Registro de asistencia</h1>
          </div>
          <Link to="/checador" className="text-gray-400 hover:text-gray-700 p-2" title="Administración" aria-label="Administración">
            <Settings size={20} />
          </Link>
        </div>
        <RegistroAsistencia />
      </div>
    </div>
  );
}

export default RegistroAsistencia;
