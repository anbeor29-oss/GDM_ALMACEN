/**
 * Nómina → Importar respaldo. Trae la nómina histórica de un respaldo de
 * NomiPaq (CONTPAQ Nóminas) a la empresa abierta: empleados, periodos y recibos.
 * Un `.bak` es binario de SQL Server y sólo se lee en la PC con la herramienta,
 * que deja un paquete de JSON; ese paquete se sube AQUÍ, se elige qué años cargar
 * y todo entra sin salir de NEXO. No duplica: repetirlo es seguro.
 */
import { useState } from 'react';
import { Users2, Upload, PlayCircle, CheckCircle2, FileJson } from 'lucide-react';
import api from '@/services/api';

const ARCHIVOS = ['empresa', 'departamentos', 'puestos', 'empleados', 'periodos', 'conceptos', 'movimientos', 'cfdi'] as const;
type Archivo = typeof ARCHIVOS[number];
const OPCIONALES: Archivo[] = ['empresa', 'departamentos', 'puestos', 'cfdi'];

export function NominaImportarPage() {
  const [files, setFiles] = useState<Partial<Record<Archivo, File>>>({});
  const [empresa, setEmpresa] = useState<{ rfc?: string; nombre?: string } | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [ejerSel, setEjerSel] = useState<Set<number>>(new Set());
  const [forzar, setForzar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rep, setRep] = useState<any>(null);
  const [error, setError] = useState('');
  const [rfcMismatch, setRfcMismatch] = useState(false);

  const leerJson = async (f?: File): Promise<any[]> => {
    if (!f) return [];
    try { const j = JSON.parse((await f.text()).replace(/^﻿/, '')); return Array.isArray(j) ? j : [j]; } catch { return []; }
  };

  const recibir = async (lista: FileList | null) => {
    if (!lista) return;
    const next: Partial<Record<Archivo, File>> = { ...files };
    for (const f of Array.from(lista)) {
      const base = f.name.replace(/\.json$/i, '').toLowerCase();
      const match = ARCHIVOS.find((a) => a === base);
      if (match) next[match] = f;
    }
    setFiles(next); setError(''); setRep(null); setRfcMismatch(false); setForzar(false);
    if (next.empresa) { const j = await leerJson(next.empresa); setEmpresa(j[0] || null); }
    if (next.empleados && next.periodos) {
      const [empl, per, con, mov, cfd] = await Promise.all([
        leerJson(next.empleados), leerJson(next.periodos), leerJson(next.conceptos), leerJson(next.movimientos), leerJson(next.cfdi)]);
      const ejs = ([...new Set(per.map((p: any) => Number(p.ejercicio)))].filter(Boolean) as number[]).sort((a, b) => a - b);
      setPreview({ empleados: empl.length, periodos: per.length, conceptos: con.length, movimientos: mov.length, cfdi: cfd.length, ejercicios: ejs });
      setEjerSel(new Set(ejs));
    } else { setPreview(null); }
  };

  const faltan = ARCHIVOS.filter((a) => !OPCIONALES.includes(a) && !files[a]);
  const importar = async () => {
    setBusy(true); setError(''); setRep(null); setRfcMismatch(false);
    try {
      const fd = new FormData();
      ARCHIVOS.forEach((a) => { if (files[a]) fd.append(a, files[a]!); });
      if (forzar) fd.append('forzar', 'true');
      if (preview?.ejercicios?.length && ejerSel.size && ejerSel.size < preview.ejercicios.length) {
        fd.append('ejercicios', [...ejerSel].join(','));
      }
      const r: any = await api.importarNominaRespaldo(fd);
      setRep(r.data);
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'No se pudo importar.';
      setError(msg);
      if (/RFC del respaldo/i.test(msg)) setRfcMismatch(true);
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users2 size={22} className="text-violet-700" /> Importar respaldo de nómina
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Trae la nómina histórica de un respaldo de NomiPaq (empleados, periodos, recibos y su CFDI)
          a la empresa que tengas abierta. No duplica: repetirlo es seguro.
        </p>
      </div>

      {/* Pasos */}
      <div className="bg-white rounded-lg shadow border p-5 space-y-3 text-sm text-gray-700">
        <p className="font-semibold text-gray-800">En 3 pasos</p>
        <ol className="space-y-2">
          <li className="flex gap-3"><span className="shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-800 font-bold grid place-items-center">1</span>
            <span>Con la herramienta, lee el <b>respaldo</b> (<span className="font-mono">.bak</span>) de NomiPaq. Deja un <b>paquete</b> de archivos <span className="font-mono">.json</span>.</span></li>
          <li className="flex gap-3"><span className="shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-800 font-bold grid place-items-center">2</span>
            <span>Sube el paquete <b>aquí</b> y elige qué <b>años</b> cargar.</span></li>
          <li className="flex gap-3"><span className="shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-800 font-bold grid place-items-center">3</span>
            <span>Da <b>«Importar»</b> — verás un resumen de empleados, periodos y recibos que entraron.</span></li>
        </ol>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {rep && <Reporte rep={rep} />}

      {/* Subir el paquete */}
      <div className="bg-white rounded-lg shadow border p-4 space-y-3">
        {empresa?.rfc && (
          <p className="text-sm text-gray-700">Respaldo de <b>{empresa.nombre || '—'}</b> · RFC <b className="font-mono">{empresa.rfc}</b>. Debe coincidir con la empresa abierta.</p>
        )}
        <label className="flex items-center gap-2 bg-violet-700 text-white px-4 py-2 rounded-lg hover:bg-violet-800 text-sm cursor-pointer w-fit">
          <Upload size={16} />
          <input type="file" accept=".json" multiple className="hidden"
            onChange={(e) => { recibir(e.target.files); e.currentTarget.value = ''; }} />
          Seleccionar los archivos del paquete
        </label>
        <div className="grid sm:grid-cols-4 gap-2">
          {ARCHIVOS.map((a) => (
            <div key={a} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded border ${
              files[a] ? 'border-violet-200 bg-violet-50 text-violet-800' : 'border-gray-200 text-gray-400'}`}>
              {files[a] ? <CheckCircle2 size={14} /> : <FileJson size={14} />}
              <span className="font-mono text-xs">{a}.json</span>
              {OPCIONALES.includes(a) && !files[a] && <span className="text-[10px]">(opc.)</span>}
            </div>
          ))}
        </div>

        {preview && (
          <div className="border border-violet-200 bg-violet-50 rounded-lg p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700 mb-1">Previo · lo que se va a importar</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-gray-700">
              <span>Ejercicios: <b>{(preview.ejercicios || []).join(', ') || '—'}</b></span>
              <span>Empleados: <b>{preview.empleados}</b></span>
              <span>Periodos: <b>{preview.periodos}</b></span>
              <span>Conceptos: <b>{preview.conceptos}</b></span>
              <span>Movimientos: <b>{preview.movimientos}</b></span>
              <span>CFDI: <b>{preview.cfdi}</b></span>
            </div>
          </div>
        )}

        {preview?.ejercicios?.length > 1 && (
          <div className="border rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-600 mb-2">¿Qué años importar? (elige uno, varios o todos)</p>
            <div className="flex flex-wrap gap-2">
              {preview.ejercicios.map((a: number) => {
                const on = ejerSel.has(a);
                return (
                  <button key={a} type="button"
                    onClick={() => setEjerSel((s) => { const n = new Set(s); if (n.has(a)) n.delete(a); else n.add(a); return n; })}
                    className={`px-3 py-1 rounded-full text-sm border ${on ? 'bg-violet-700 text-white border-violet-700' : 'text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                    {on ? '✓ ' : ''}{a}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {rfcMismatch && (
          <label className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
            <input type="checkbox" checked={forzar} onChange={(e) => setForzar(e.target.checked)} />
            El RFC no coincide — <b>importar de todos modos</b>.
          </label>
        )}

        <div className="flex items-center gap-3">
          <button onClick={importar}
            disabled={busy || faltan.length > 0 || (preview?.ejercicios?.length > 1 && ejerSel.size === 0)}
            className="flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
            <PlayCircle size={16} /> {busy ? 'Importando…' : 'Importar a la empresa activa'}
          </button>
          {faltan.length > 0 && <span className="text-xs text-amber-700">Faltan: {faltan.map((a) => `${a}.json`).join(', ')}</span>}
        </div>
      </div>
    </div>
  );
}

function Reporte({ rep }: { rep: any }) {
  return (
    <div className="bg-white rounded-lg shadow border p-4 space-y-3">
      <h2 className="font-semibold text-gray-800 flex items-center gap-2"><CheckCircle2 size={18} className="text-emerald-600" /> Resumen de la importación</h2>
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <Tarjeta titulo="Ejercicios" valor={(rep.ejercicios || []).join(', ') || '—'} />
        <Tarjeta titulo="Empleados" valor={`${rep.empleados?.creados ?? 0} nuevos · ${rep.empleados?.actualizados ?? 0} actualizados`} />
        <Tarjeta titulo="Periodos" valor={`${rep.periodos?.creados ?? 0} creados · ${rep.periodos?.yaExistian ?? 0} ya estaban · ${rep.periodos?.omitidos ?? 0} omitidos`} />
        <Tarjeta titulo="Recibos" valor={`${rep.recibos?.creados ?? 0} creados · ${rep.recibos?.yaExistian ?? 0} ya estaban · ${rep.recibos?.omitidos ?? 0} omitidos`} />
      </div>
      {!rep.rfc?.coincide && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Se importó con el RFC <b className="font-mono">{rep.rfc?.respaldo}</b> hacia la empresa <b className="font-mono">{rep.rfc?.empresaActiva}</b>.
        </p>
      )}
      {rep.avisos?.length > 0 && (
        <details className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <summary className="cursor-pointer">{rep.avisos.length} aviso(s)</summary>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">{rep.avisos.slice(0, 40).map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>
        </details>
      )}
      <p className="text-xs text-gray-500">Los recibos quedaron como histórico (origen NomiPaq). No se re-timbran; son el registro de lo ya pagado.</p>
    </div>
  );
}

function Tarjeta({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="border rounded-lg px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{titulo}</p>
      <p className="text-sm text-gray-800 mt-0.5">{valor}</p>
    </div>
  );
}

export default NominaImportarPage;
