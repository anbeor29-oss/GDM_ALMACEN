/**
 * Importar de CONTPAQi — sube el paquete JSON que produce el extractor
 * (scripts/contpaqi/extraer-contpaqi.ps1) y lo carga en la EMPRESA ACTIVA.
 *
 * Reutilizable para cualquier empresa/RFC: el importador usa el RFC de la
 * empresa activa para clasificar emitidos/recibidos. Idempotente: re-importar
 * no duplica (pólizas por Guid, CFDI por UUID, cuentas por código).
 */
import { useState } from 'react';
import { Database, Upload, PlayCircle, CheckCircle2, AlertTriangle, FileJson } from 'lucide-react';
import api from '@/services/api';

const ARCHIVOS = ['cuentas', 'polizas', 'movimientos', 'poliza_cfdi', 'cfdi', 'saldos'] as const;
type Archivo = typeof ARCHIVOS[number];

export function ImportarContpaqiPage() {
  const [files, setFiles] = useState<Partial<Record<Archivo, File>>>({});
  const [busy, setBusy] = useState(false);
  const [rep, setRep] = useState<any>(null);
  const [error, setError] = useState('');

  const recibir = (lista: FileList | null) => {
    if (!lista) return;
    const next: Partial<Record<Archivo, File>> = { ...files };
    Array.from(lista).forEach((f) => {
      const base = f.name.replace(/\.json$/i, '').toLowerCase();
      const match = ARCHIVOS.find((a) => a === base);
      if (match) next[match] = f;
    });
    setFiles(next);
    setError(''); setRep(null);
  };

  const faltan = ARCHIVOS.filter((a) => a !== 'saldos' && !files[a]); // saldos es opcional
  const importar = async () => {
    setBusy(true); setError(''); setRep(null);
    try {
      const fd = new FormData();
      ARCHIVOS.forEach((a) => { if (files[a]) fd.append(a, files[a]!); });
      const r: any = await api.importarContpaqi(fd);
      setRep(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'No se pudo importar.');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Database size={22} className="text-emerald-700" /> Importar de CONTPAQi
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Sube el paquete JSON del extractor. Se carga en la <b>empresa activa</b>, usando su RFC.
          No duplica: re-importar el mismo paquete es seguro.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>
          Escribe en la contabilidad de la <b>empresa que tengas activa ahora</b>. Verifica que sea la correcta
          antes de importar (idealmente una empresa de prueba la primera vez). Genera el paquete con
          <b> scripts/contpaqi/extraer-contpaqi.ps1</b>.
        </span>
      </div>

      <div className="bg-white rounded-lg shadow border p-4 space-y-3">
        <label className="flex items-center gap-2 bg-emerald-700 text-white px-4 py-2 rounded-lg hover:bg-emerald-800 text-sm cursor-pointer w-fit">
          <Upload size={16} />
          <input type="file" accept=".json" multiple className="hidden"
            onChange={(e) => { recibir(e.target.files); e.currentTarget.value = ''; }} />
          Seleccionar los JSON del paquete
        </label>

        <div className="grid sm:grid-cols-3 gap-2">
          {ARCHIVOS.map((a) => (
            <div key={a} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded border ${
              files[a] ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 text-gray-400'}`}>
              {files[a] ? <CheckCircle2 size={14} /> : <FileJson size={14} />}
              <span className="font-mono">{a}.json</span>
              {a === 'saldos' && !files[a] && <span className="text-[10px]">(opcional)</span>}
            </div>
          ))}
        </div>

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
            cuenta contra CONTPAQi, ejercicio por ejercicio.
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
