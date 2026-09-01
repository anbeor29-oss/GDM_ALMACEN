/**
 * Importar respaldo — carga en la EMPRESA ACTIVA el paquete de datos que produce
 * la herramienta de extracción a partir de un respaldo de otro sistema.
 *
 * PRIMER PASO: se valida el RFC. El respaldo trae el RFC de su empresa; si no es
 * el de la empresa activa, no se importa (para no mezclar dos contribuyentes).
 *
 * Nota técnica: un respaldo `.bak` es de SQL Server y NO se puede procesar en el
 * servidor (que es Linux/PostgreSQL). Se convierte en la PC con la herramienta
 * local, que deja este paquete; aquí se sube el resultado. Idempotente.
 */
import { useState } from 'react';
import { Database, Upload, PlayCircle, CheckCircle2, FileJson, ShieldAlert } from 'lucide-react';
import api from '@/services/api';

const ARCHIVOS = ['empresa', 'cuentas', 'polizas', 'movimientos', 'poliza_cfdi', 'cfdi', 'saldos'] as const;
type Archivo = typeof ARCHIVOS[number];
const OPCIONALES: Archivo[] = ['saldos'];
const mx = (n: any) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const COMANDO = '.\\importar-respaldo.ps1 -Bak "C:\\ruta\\del\\respaldo.bak" -Nexo "https://TU-NEXO" -Email "tu@correo.com"';

export function ImportarContpaqiPage() {
  const [files, setFiles] = useState<Partial<Record<Archivo, File>>>({});
  const [empresa, setEmpresa] = useState<{ rfc?: string; nombre?: string } | null>(null);
  const [preview, setPreview] = useState<any>(null);
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
    // Lee el RFC del respaldo (empresa.json) para mostrarlo como primer paso.
    if (next.empresa) { const j = await leerJson(next.empresa); setEmpresa(j[0] || null); }
    // PREVIO: conteos de lo que se va a importar, sin subir nada.
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
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Database size={22} className="text-emerald-700" /> Importar respaldo
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Carga en la <b>empresa activa</b> la contabilidad de un respaldo. Valida el RFC antes de escribir.
          No duplica: re-importar el mismo paquete es seguro.
        </p>
      </div>

      <details className="text-sm text-gray-600 bg-gray-50 border rounded-lg px-4 py-3">
        <summary className="cursor-pointer font-medium text-gray-700">Cómo funciona (el paso del respaldo .bak)</summary>
        <p className="mt-2">
          Un respaldo <b>.bak</b> es de SQL Server y se procesa <b>en la PC</b> (aquí el servidor es Linux y no puede
          restaurarlo). La herramienta local restaura el <b>.bak</b> y deja un paquete de datos; ese paquete es el que
          se sube aquí y se carga por el motor de NEXO. Así el respaldo entra sin depender del sistema de origen.
        </p>
      </details>

      {/* Opción A: un solo comando desde la PC (recomendada) */}
      <div className="bg-white rounded-lg shadow border p-4 space-y-2">
        <p className="text-sm font-semibold text-gray-800">Opción A · Un solo comando <span className="text-[11px] font-normal text-emerald-700">(recomendada)</span></p>
        <p className="text-sm text-gray-600">
          Desde la PC (con SQL Server), señalas el <b>.bak</b> y la herramienta hace todo:
          restaura → extrae → te muestra el previo → busca la empresa por su RFC → importa. Nunca tocas archivos sueltos.
        </p>
        <div className="flex items-start gap-2">
          <pre className="flex-1 text-xs bg-gray-900 text-gray-100 rounded px-3 py-2 overflow-x-auto whitespace-pre-wrap">{COMANDO}</pre>
          <button onClick={() => navigator.clipboard?.writeText(COMANDO)}
            className="text-xs border rounded px-2 py-1 text-gray-600 hover:bg-gray-50 shrink-0">Copiar</button>
        </div>
        <p className="text-[11px] text-gray-400">
          En <span className="font-mono">backend/scripts/contpaqi/</span>. Agrega <span className="font-mono">-DryRun</span> para
          ver sólo el previo sin importar. Pide la contraseña sin mostrarla.
        </p>
      </div>

      <p className="text-sm font-semibold text-gray-800 pt-1">Opción B · Subir el paquete ya extraído</p>

      {/* Paso 1: validación de empresa/RFC */}
      <div className="bg-white rounded-lg shadow border p-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Paso 1 · Empresa del respaldo</p>
        {empresa?.rfc ? (
          <div className="flex items-center gap-2 text-sm">
            <ShieldAlert size={16} className="text-amber-600 shrink-0" />
            <span>
              El respaldo es de <b>{empresa.nombre || '—'}</b> · RFC <b className="font-mono">{empresa.rfc}</b>.
              Se importará a la <b>empresa que tengas activa</b>: verifica que su RFC sea <b className="font-mono">{empresa.rfc}</b>.
              Si no coincide, el servidor lo detiene.
            </span>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Selecciona los archivos del paquete (incluido <b>empresa.json</b>) para ver el RFC del respaldo.</p>
        )}
      </div>

      {/* Paso 2: subir el paquete */}
      <div className="bg-white rounded-lg shadow border p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Paso 2 · Paquete del respaldo</p>
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
            Sé que el RFC no coincide e <b>importar de todos modos</b> (misma empresa con RFC recapturado, etc.).
          </label>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button onClick={importar} disabled={busy || faltan.length > 0}
            className="flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
            <PlayCircle size={16} /> {busy ? 'Importando… (puede tardar)' : 'Importar a la empresa activa'}
          </button>
          {faltan.length > 0 && <span className="text-xs text-amber-700">Faltan: {faltan.map((a) => `${a}.json`).join(', ')}</span>}
        </div>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {rep && (
        <div className="bg-white rounded-lg shadow border p-4 space-y-3">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2"><CheckCircle2 size={18} className="text-emerald-600" /> Reporte de importación</h2>
          {rep.rfc && (
            <div className={`text-sm rounded px-3 py-2 border ${rep.rfc.coincide ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
              RFC respaldo <b className="font-mono">{rep.rfc.respaldo}</b> · empresa activa <b className="font-mono">{rep.rfc.empresaActiva}</b> — {rep.rfc.coincide ? 'coinciden ✓' : 'NO coinciden (se forzó)'}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <Tarjeta titulo="Ejercicios activados" valor={(rep.ejerciciosActivados || []).join(', ') || '—'} />
            <Tarjeta titulo="Cuentas" valor={`${rep.cuentas?.creadas ?? 0} creadas · ${rep.cuentas?.omitidas ?? 0} ya existían${rep.cuentas?.sinAgrupador ? ` · ${rep.cuentas.sinAgrupador} sin agrupador` : ''}`} />
            <Tarjeta titulo="Pólizas" valor={`${rep.polizas?.creadas ?? 0} creadas · ${rep.polizas?.yaExistian ?? 0} ya existían · ${rep.polizas?.omitidas ?? 0} omitidas`} />
            <Tarjeta titulo="CFDI" valor={`${rep.cfdi?.creados ?? 0} nuevos (${rep.cfdi?.emitidos ?? 0} emitidos / ${rep.cfdi?.recibidos ?? 0} recibidos)`} />
          </div>

          {rep.polizas?.motivos?.length > 0 && (
            <details className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              <summary className="cursor-pointer">{rep.polizas.motivos.length} póliza(s) omitida(s) — ver por qué</summary>
              <ul className="mt-1 list-disc pl-5 space-y-0.5">
                {rep.polizas.motivos.map((m: any, i: number) => <li key={i}><span className="font-mono">{String(m.guid).slice(0, 8)}</span>: {m.motivo}</li>)}
              </ul>
            </details>
          )}
          {rep.avisos?.length > 0 && (
            <details className="text-xs text-gray-600 bg-gray-50 border rounded px-3 py-2">
              <summary className="cursor-pointer">{rep.avisos.length} aviso(s)</summary>
              <ul className="mt-1 list-disc pl-5 space-y-0.5">{rep.avisos.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>
            </details>
          )}
          <p className="text-xs text-gray-500">
            Siguiente: en <b>Balanza de comprobación</b>, dale «Actualizar desde pólizas» y compara los saldos por
            cuenta contra el sistema de origen, ejercicio por ejercicio.
          </p>
        </div>
      )}
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
