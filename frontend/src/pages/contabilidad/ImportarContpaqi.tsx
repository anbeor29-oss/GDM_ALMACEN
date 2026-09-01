/**
 * Importar respaldo — pasa la contabilidad de un respaldo a la empresa activa.
 *
 * Para el usuario final es UN paso: en la computadora abre la herramienta, elige
 * el archivo del respaldo, y todo lo demás corre solo hasta un resumen. Un
 * respaldo .bak es de SQL Server y sólo se puede abrir en la PC (no en el
 * servidor), por eso el proceso vive en la herramienta.
 *
 * Abajo, plegado, queda la vía técnica (subir el paquete ya extraído): sólo la
 * usa el equipo de sistemas.
 */
import { useState } from 'react';
import { Database, Upload, PlayCircle, CheckCircle2, FileJson, MousePointerClick, Download } from 'lucide-react';
import api from '@/services/api';

const ARCHIVOS = ['empresa', 'cuentas', 'polizas', 'movimientos', 'poliza_cfdi', 'cfdi', 'saldos'] as const;
type Archivo = typeof ARCHIVOS[number];
const OPCIONALES: Archivo[] = ['saldos'];
const mx = (n: any) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);

export function ImportarContpaqiPage() {
  const [files, setFiles] = useState<Partial<Record<Archivo, File>>>({});
  const [empresa, setEmpresa] = useState<{ rfc?: string; nombre?: string } | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [forzar, setForzar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rep, setRep] = useState<any>(null);
  const [error, setError] = useState('');
  const [rfcMismatch, setRfcMismatch] = useState(false);
  const [bajando, setBajando] = useState(false);

  const descargarHerramienta = async () => {
    setBajando(true); setError('');
    try { await api.descargarHerramientaRespaldo(); }
    catch (e: any) { setError(e?.response?.data?.message || e?.message || 'No se pudo descargar la herramienta.'); }
    finally { setBajando(false); }
  };

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
    if (next.cuentas && next.polizas && next.movimientos) {
      const [cuentas, pol, mov, cfdi, pc] = await Promise.all([
        leerJson(next.cuentas), leerJson(next.polizas), leerJson(next.movimientos), leerJson(next.cfdi), leerJson(next.poliza_cfdi)]);
      const car = mov.filter((m: any) => m.tm === 0).reduce((a: number, m: any) => a + Number(m.importe || 0), 0);
      const ab = mov.filter((m: any) => m.tm === 1).reduce((a: number, m: any) => a + Number(m.importe || 0), 0);
      setPreview({
        cuentas: cuentas.length, polizas: pol.length, movimientos: mov.length, cfdi: cfdi.length, ligas: pc.length,
        cargos: Math.round(car * 100) / 100, abonos: Math.round(ab * 100) / 100,
        ejercicios: [...new Set(pol.map((p: any) => p.ejercicio))].filter(Boolean).sort(),
      });
    } else { setPreview(null); }
  };

  const faltan = ARCHIVOS.filter((a) => !OPCIONALES.includes(a) && !files[a]);
  const importar = async () => {
    setBusy(true); setError(''); setRep(null); setRfcMismatch(false);
    try {
      const fd = new FormData();
      ARCHIVOS.forEach((a) => { if (files[a]) fd.append(a, files[a]!); });
      if (forzar) fd.append('forzar', 'true');
      const r: any = await api.importarRespaldo(fd);
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
          <Database size={22} className="text-emerald-700" /> Importar respaldo
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Pasa la contabilidad de un respaldo a la empresa que tengas abierta. No duplica: repetirlo es seguro.
        </p>
      </div>

      {/* Instrucción simple para el usuario final */}
      <div className="bg-white rounded-lg shadow border p-5 space-y-4">
        <p className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <MousePointerClick size={18} className="text-emerald-700" /> En 3 pasos, desde la computadora
        </p>

        {/* Paso 0: descargar la herramienta ya configurada con la dirección de este servidor */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <button onClick={descargarHerramienta} disabled={bajando}
            className="flex items-center gap-2 bg-emerald-700 text-white px-4 py-2.5 rounded-lg hover:bg-emerald-800 disabled:opacity-50 text-sm font-semibold shrink-0">
            <Download size={18} /> {bajando ? 'Preparando…' : 'Descargar la herramienta'}
          </button>
          <p className="text-xs text-emerald-900">
            Se descarga <b>ya lista</b> para conectarse a este NEXO (no hay que escribir ninguna dirección).
            Sólo se baja <b>una vez</b> por computadora. Al abrir el archivo, <b>descomprímelo</b> y verás la herramienta <b>«Importar respaldo»</b>.
          </p>
        </div>

        <ol className="space-y-3 text-sm text-gray-700">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold grid place-items-center">1</span>
            <span>Da <b>doble clic</b> en <b>«Importar respaldo»</b> (dentro de la carpeta que descargaste).</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold grid place-items-center">2</span>
            <span>Da clic en <b>«Elegir…»</b> y selecciona el <b>archivo del respaldo</b> (termina en <span className="font-mono">.bak</span>).</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold grid place-items-center">3</span>
            <span>Da clic en <b>«Importar»</b> y espera. Al terminar verás un <b>resumen</b> de lo que entró.</span>
          </li>
        </ol>
        <p className="text-xs text-gray-500 border-t pt-3">
          Todo corre solo: la herramienta lee el respaldo y lo carga en la <b>empresa que tengas abierta aquí</b>.
          Antes de escribir, revisa que sea la empresa correcta (se confirma por su RFC).
        </p>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {rep && <Reporte rep={rep} />}

      {/* Vía técnica, plegada: subir el paquete ya extraído */}
      <details className="bg-white rounded-lg shadow border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-600">Opción avanzada · para el equipo de sistemas (subir los archivos del paquete)</summary>
        <div className="px-4 pb-4 space-y-3 border-t pt-3">
          {empresa?.rfc && (
            <p className="text-sm text-gray-700">Respaldo de <b>{empresa.nombre || '—'}</b> · RFC <b className="font-mono">{empresa.rfc}</b>. Debe coincidir con la empresa abierta.</p>
          )}
          <label className="flex items-center gap-2 bg-emerald-700 text-white px-4 py-2 rounded-lg hover:bg-emerald-800 text-sm cursor-pointer w-fit">
            <Upload size={16} />
            <input type="file" accept=".json" multiple className="hidden"
              onChange={(e) => { recibir(e.target.files); e.currentTarget.value = ''; }} />
            Seleccionar los archivos del paquete
          </label>
          <div className="grid sm:grid-cols-3 gap-2">
            {ARCHIVOS.map((a) => (
              <div key={a} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded border ${
                files[a] ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 text-gray-400'}`}>
                {files[a] ? <CheckCircle2 size={14} /> : <FileJson size={14} />}
                <span className="font-mono">{a}.json</span>
                {OPCIONALES.includes(a) && !files[a] && <span className="text-[10px]">(opcional)</span>}
              </div>
            ))}
          </div>
          {preview && (
            <div className="border border-sky-200 bg-sky-50 rounded-lg p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700 mb-1">Previo · lo que se va a importar</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-gray-700">
                <span>Ejercicios: <b>{(preview.ejercicios || []).join(', ') || '—'}</b></span>
                <span>Cuentas: <b>{preview.cuentas}</b></span>
                <span>Pólizas: <b>{preview.polizas}</b></span>
                <span>Movimientos: <b>{preview.movimientos}</b></span>
                <span>CFDI: <b>{preview.cfdi}</b></span>
                <span>Ligas póliza-UUID: <b>{preview.ligas}</b></span>
              </div>
              <p className={`text-xs mt-1 ${Math.abs(preview.cargos - preview.abonos) < 0.01 ? 'text-emerald-700' : 'text-rose-700'}`}>
                Cargos {mx(preview.cargos)} {Math.abs(preview.cargos - preview.abonos) < 0.01 ? '=' : '≠'} Abonos {mx(preview.abonos)}
                {Math.abs(preview.cargos - preview.abonos) < 0.01 ? ' · cuadra' : ` · dif ${mx(preview.cargos - preview.abonos)}`}
              </p>
            </div>
          )}
          {rfcMismatch && (
            <label className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              <input type="checkbox" checked={forzar} onChange={(e) => setForzar(e.target.checked)} />
              El RFC no coincide — <b>importar de todos modos</b>.
            </label>
          )}
          <div className="flex items-center gap-3">
            <button onClick={importar} disabled={busy || faltan.length > 0}
              className="flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
              <PlayCircle size={16} /> {busy ? 'Importando…' : 'Importar a la empresa activa'}
            </button>
            {faltan.length > 0 && <span className="text-xs text-amber-700">Faltan: {faltan.map((a) => `${a}.json`).join(', ')}</span>}
          </div>
        </div>
      </details>
    </div>
  );
}

function Reporte({ rep }: { rep: any }) {
  return (
    <div className="bg-white rounded-lg shadow border p-4 space-y-3">
      <h2 className="font-semibold text-gray-800 flex items-center gap-2"><CheckCircle2 size={18} className="text-emerald-600" /> Resumen de la importación</h2>
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <Tarjeta titulo="Ejercicios" valor={(rep.ejerciciosActivados || []).join(', ') || '—'} />
        <Tarjeta titulo="Cuentas" valor={`${rep.cuentas?.creadas ?? 0} nuevas${rep.cuentas?.agrupadorRellenado ? ` · ${rep.cuentas.agrupadorRellenado} con agrupador SAT rellenado` : ''}${rep.cuentas?.sinAgrupador ? ` · ${rep.cuentas.sinAgrupador} aún sin agrupador` : ''}`} />
        <Tarjeta titulo="Pólizas" valor={`${rep.polizas?.creadas ?? 0} creadas · ${rep.polizas?.yaExistian ?? 0} ya estaban · ${rep.polizas?.omitidas ?? 0} omitidas`} />
        <Tarjeta titulo="Comprobantes (CFDI)" valor={`${rep.cfdi?.creados ?? 0} nuevos`} />
      </div>
      {rep.polizas?.conTemporal?.length > 0 && (
        <details className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2" open>
          <summary className="cursor-pointer font-semibold">⚠ {rep.polizas.conTemporal.length} póliza(s) quedaron con una cuenta temporal — hay que reasignarles la cuenta</summary>
          <p className="mt-1">Entraron completas (no se perdió nada), pero una parte quedó en la cuenta «MIG-TEMPORAL». Búscalas en <b>Pólizas</b> y cámbiales la cuenta correcta.</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {rep.polizas.conTemporal.slice(0, 40).map((m: any, i: number) => <li key={i}><b>{m.folio}</b>: {m.motivo}</li>)}
          </ul>
        </details>
      )}
      {rep.polizas?.motivos?.length > 0 && (
        <details className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <summary className="cursor-pointer">{rep.polizas.motivos.length} póliza(s) omitida(s) — ver por qué</summary>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {rep.polizas.motivos.map((m: any, i: number) => <li key={i}><span className="font-mono">{String(m.guid).slice(0, 8)}</span>: {m.motivo}</li>)}
          </ul>
        </details>
      )}
      <p className="text-xs text-gray-500">
        Siguiente: en <b>Balanza de comprobación</b>, dale «Actualizar desde pólizas» y compara los saldos contra el origen.
      </p>
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

export default ImportarContpaqiPage;
