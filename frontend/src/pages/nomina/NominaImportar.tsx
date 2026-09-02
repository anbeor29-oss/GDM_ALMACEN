/**
 * Nómina → Importar respaldo. Trae la nómina histórica de un respaldo de NomiPaq
 * (CONTPAQ Nóminas) a la empresa abierta: empleados, periodos y recibos.
 *
 * El usuario descarga la herramienta (una vez), lee su `.bak` con ella y obtiene
 * un PAQUETE .zip; sube ese .zip AQUÍ, elige qué años cargar, y todo entra sin
 * salir de NEXO. La pantalla descomprime el .zip en el navegador. No duplica.
 */
import { useState } from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import { Users2, Download, Upload, PlayCircle, CheckCircle2, FileArchive } from 'lucide-react';
import api from '@/services/api';

const ARCHIVOS = ['empresa', 'departamentos', 'puestos', 'empleados', 'periodos', 'conceptos', 'movimientos', 'cfdi'] as const;
type Archivo = typeof ARCHIVOS[number];

export function NominaImportarPage() {
  const [datos, setDatos] = useState<Partial<Record<Archivo, any[]>>>({});
  const [empresa, setEmpresa] = useState<{ rfc?: string; nombre?: string } | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [ejerSel, setEjerSel] = useState<Set<number>>(new Set());
  const [forzar, setForzar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [rep, setRep] = useState<any>(null);
  const [error, setError] = useState('');
  const [rfcMismatch, setRfcMismatch] = useState(false);

  const descargarHerramienta = async () => {
    setBajando(true); setError('');
    try { await api.descargarHerramientaNomina(); }
    catch (e: any) { setError(e?.response?.data?.message || e?.message || 'No se pudo descargar la herramienta.'); }
    finally { setBajando(false); }
  };

  const parseJson = (txt: string): any[] => {
    try { const j = JSON.parse(txt.replace(/^﻿/, '')); return Array.isArray(j) ? j : [j]; } catch { return []; }
  };

  const recibir = async (lista: FileList | null) => {
    if (!lista || !lista.length) return;
    setError(''); setRep(null); setRfcMismatch(false); setForzar(false);
    const next: Partial<Record<Archivo, any[]>> = { ...datos };
    try {
      for (const f of Array.from(lista)) {
        if (/\.zip$/i.test(f.name)) {
          const buf = new Uint8Array(await f.arrayBuffer());
          const entradas = unzipSync(buf);
          for (const [nombre, bytes] of Object.entries(entradas)) {
            const base = nombre.replace(/^.*[\\/]/, '').replace(/\.json$/i, '').toLowerCase();
            const match = ARCHIVOS.find((a) => a === base);
            if (match) next[match] = parseJson(strFromU8(bytes as Uint8Array));
          }
        } else if (/\.json$/i.test(f.name)) {
          const base = f.name.replace(/\.json$/i, '').toLowerCase();
          const match = ARCHIVOS.find((a) => a === base);
          if (match) next[match] = parseJson(await f.text());
        }
      }
    } catch { setError('No se pudo leer el paquete (.zip). Genera uno nuevo con la herramienta.'); return; }

    setDatos(next);
    setEmpresa(next.empresa?.[0] || null);
    const per = next.periodos || [];
    if ((next.empleados?.length || 0) > 0 && per.length > 0) {
      const ejs = ([...new Set(per.map((p: any) => Number(p.ejercicio)))].filter(Boolean) as number[]).sort((a, b) => a - b);
      setPreview({
        empleados: next.empleados!.length, periodos: per.length, conceptos: (next.conceptos || []).length,
        movimientos: (next.movimientos || []).length, cfdi: (next.cfdi || []).length, ejercicios: ejs,
      });
      setEjerSel(new Set(ejs));
    } else {
      setPreview(null);
      const leidos = ARCHIVOS.filter((a) => (next[a]?.length || 0) > 0);
      if (leidos.length === 0) {
        setError('No reconocí archivos de nómina en el paquete. Sube el .zip de NÓMINA (NOMINA_*.zip) que dejó la herramienta — el de contabilidad (CONTABILIDAD_*.zip) no sirve aquí.');
      } else {
        setError(`El paquete se leyó (${leidos.join(', ')}) pero le faltan EMPLEADOS y/o PERIODOS, que son los que habilitan «Importar». Vuelve a generar el .zip de nómina con la herramienta.`);
      }
    }
  };

  const importar = async () => {
    setBusy(true); setError(''); setRep(null); setRfcMismatch(false);
    try {
      const fd = new FormData();
      ARCHIVOS.forEach((a) => {
        if (datos[a]) fd.append(a, new Blob([JSON.stringify(datos[a])], { type: 'application/json' }), `${a}.json`);
      });
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

      {/* Pasos + descargar herramienta */}
      <div className="bg-white rounded-lg shadow border p-5 space-y-4">
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <button onClick={descargarHerramienta} disabled={bajando}
            className="flex items-center gap-2 bg-violet-700 text-white px-4 py-2.5 rounded-lg hover:bg-violet-800 disabled:opacity-50 text-sm font-semibold shrink-0">
            <Download size={18} /> {bajando ? 'Preparando…' : 'Descargar la herramienta'}
          </button>
          <p className="text-xs text-violet-900">
            Se baja <b>una vez</b> por computadora. <b>Descomprímela</b> y da doble clic en
            <b> «Importar respaldo nomina»</b>: trae tu <b>dirección</b> y <b>correo</b> ya puestos; elige el
            <b> .bak</b> de NomiPaq, <b>confirma con tu contraseña de NEXO</b> y genera el <b>paquete .zip</b>.
          </p>
        </div>
        <ol className="space-y-2 text-sm text-gray-700">
          <li className="flex gap-3"><span className="shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-800 font-bold grid place-items-center">1</span>
            <span>Con la herramienta, lee el <b>respaldo</b> (<span className="font-mono">.bak</span>) → deja un <b>paquete</b> <span className="font-mono">.zip</span>.</span></li>
          <li className="flex gap-3"><span className="shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-800 font-bold grid place-items-center">2</span>
            <span>Sube el <b>.zip</b> aquí abajo y elige qué <b>años</b> cargar.</span></li>
          <li className="flex gap-3"><span className="shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-800 font-bold grid place-items-center">3</span>
            <span>Da <b>«Importar»</b> — verás el resumen de empleados, periodos y recibos.</span></li>
        </ol>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {rep && <Reporte rep={rep} />}

      {/* Subir el paquete .zip */}
      <div className="bg-white rounded-lg shadow border p-4 space-y-3">
        {empresa?.rfc && (
          <p className="text-sm text-gray-700">Respaldo de <b>{empresa.nombre || '—'}</b> · RFC <b className="font-mono">{empresa.rfc}</b>. Debe coincidir con la empresa abierta.</p>
        )}
        <label className="flex items-center gap-2 bg-violet-700 text-white px-4 py-2 rounded-lg hover:bg-violet-800 text-sm cursor-pointer w-fit">
          <Upload size={16} />
          <input type="file" accept=".zip,.json" multiple className="hidden"
            onChange={(e) => { recibir(e.target.files); e.currentTarget.value = ''; }} />
          Seleccionar el paquete (.zip)
        </label>

        {preview && (
          <div className="border border-violet-200 bg-violet-50 rounded-lg p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700 mb-1 flex items-center gap-1"><FileArchive size={13} /> Previo · lo que se va a importar</p>
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
            disabled={busy || !preview || (preview?.ejercicios?.length > 1 && ejerSel.size === 0)}
            className="flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
            <PlayCircle size={16} /> {busy ? 'Importando…' : 'Importar a la empresa activa'}
          </button>
          {!preview && <span className="text-xs text-amber-700">Sube el paquete .zip que dejó la herramienta.</span>}
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
      {rep.rfc && !rep.rfc.coincide && (
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
