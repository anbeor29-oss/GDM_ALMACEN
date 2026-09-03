/**
 * Importar respaldo — pasa la contabilidad de un respaldo a la empresa activa.
 *
 * Un respaldo `.bak` es binario de SQL Server y sólo se puede abrir en la PC (no
 * en el servidor). Por eso una HERRAMIENTA local lo lee y deja un PAQUETE `.zip`;
 * ese `.zip` se sube AQUÍ, se elige qué años cargar, y todo entra sin salir de
 * NEXO. La pantalla descomprime el `.zip` en el navegador. No duplica: repetirlo
 * es seguro. (Mismo flujo que el importador de nómina.)
 */
import { useState } from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import { Database, Download, Upload, PlayCircle, CheckCircle2, FileArchive } from 'lucide-react';
import api from '@/services/api';

const ARCHIVOS = ['empresa', 'cuentas', 'polizas', 'movimientos', 'poliza_cfdi', 'cfdi', 'saldos'] as const;
type Archivo = typeof ARCHIVOS[number];
const mx = (n: any) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);

export function ImportarContpaqiPage() {
  const [datos, setDatos] = useState<Partial<Record<Archivo, any[]>>>({});
  const [empresa, setEmpresa] = useState<{ rfc?: string; nombre?: string } | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [ejerSel, setEjerSel] = useState<Set<number>>(new Set());
  const [forzar, setForzar] = useState(false);
  const [soloCatalogo, setSoloCatalogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [rep, setRep] = useState<any>(null);
  const [error, setError] = useState('');
  const [rfcMismatch, setRfcMismatch] = useState(false);

  const descargarHerramienta = async () => {
    setBajando(true); setError('');
    try { await api.descargarHerramientaRespaldo(); }
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
          const entradas = unzipSync(new Uint8Array(await f.arrayBuffer()));
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
    const cuentas = next.cuentas || []; const pol = next.polizas || []; const mov = next.movimientos || [];
    if (cuentas.length && pol.length && mov.length) {
      const car = mov.filter((m: any) => m.tm === 0).reduce((a: number, m: any) => a + Number(m.importe || 0), 0);
      const ab = mov.filter((m: any) => m.tm === 1).reduce((a: number, m: any) => a + Number(m.importe || 0), 0);
      const ejs = ([...new Set(pol.map((p: any) => Number(p.ejercicio)))].filter(Boolean) as number[]).sort((a, b) => a - b);
      setPreview({
        cuentas: cuentas.length, polizas: pol.length, movimientos: mov.length,
        cfdi: (next.cfdi || []).length, ligas: (next.poliza_cfdi || []).length,
        cargos: Math.round(car * 100) / 100, abonos: Math.round(ab * 100) / 100, ejercicios: ejs,
      });
      setEjerSel(new Set(ejs));
    } else { setPreview(null); }
  };

  const importar = async () => {
    setBusy(true); setError(''); setRep(null); setRfcMismatch(false);
    try {
      const fd = new FormData();
      ARCHIVOS.forEach((a) => {
        if (datos[a]) fd.append(a, new Blob([JSON.stringify(datos[a])], { type: 'application/json' }), `${a}.json`);
      });
      if (forzar) fd.append('forzar', 'true');
      if (soloCatalogo) fd.append('soloCatalogo', 'true');
      if (preview?.ejercicios?.length && ejerSel.size && ejerSel.size < preview.ejercicios.length) {
        fd.append('ejercicios', [...ejerSel].join(','));
      }
      const r: any = await api.importarRespaldo(fd);
      setRep(r.data);
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'No se pudo importar.';
      setError(msg);
      if (/RFC del respaldo/i.test(msg)) setRfcMismatch(true);
    } finally { setBusy(false); }
  };

  const cuadra = preview && Math.abs(preview.cargos - preview.abonos) < 0.01;

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

      {/* Pasos + descargar herramienta */}
      <div className="bg-white rounded-lg shadow border p-5 space-y-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <button onClick={descargarHerramienta} disabled={bajando}
            className="flex items-center gap-2 bg-emerald-700 text-white px-4 py-2.5 rounded-lg hover:bg-emerald-800 disabled:opacity-50 text-sm font-semibold shrink-0">
            <Download size={18} /> {bajando ? 'Preparando…' : 'Descargar la herramienta'}
          </button>
          <p className="text-xs text-emerald-900">
            Se baja <b>una vez</b> por computadora. <b>Descomprímela</b> y da doble clic en
            <b> «Importar respaldo»</b>: trae tu <b>dirección</b> y <b>correo</b> ya puestos; elige el
            <b> .bak</b> de CONTPAQi, <b>confirma con tu contraseña de NEXO</b> y genera el <b>paquete .zip</b>.
          </p>
        </div>
        <ol className="space-y-2 text-sm text-gray-700">
          <li className="flex gap-3"><span className="shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold grid place-items-center">1</span>
            <span>Con la herramienta, lee el <b>respaldo</b> (<span className="font-mono">.bak</span>) → deja un <b>paquete</b> <span className="font-mono">.zip</span>.</span></li>
          <li className="flex gap-3"><span className="shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold grid place-items-center">2</span>
            <span>Sube el <b>.zip</b> aquí abajo y elige qué <b>años</b> cargar.</span></li>
          <li className="flex gap-3"><span className="shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold grid place-items-center">3</span>
            <span>Da <b>«Importar»</b> — verás el resumen de cuentas, pólizas y CFDI.</span></li>
        </ol>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {rep && <Reporte rep={rep} />}

      {/* Subir el paquete .zip */}
      <div className="bg-white rounded-lg shadow border p-4 space-y-3">
        {empresa?.rfc && (
          <p className="text-sm text-gray-700">Respaldo de <b>{empresa.nombre || '—'}</b> · RFC <b className="font-mono">{empresa.rfc}</b>. Debe coincidir con la empresa abierta.</p>
        )}
        <label className="flex items-center gap-2 bg-emerald-700 text-white px-4 py-2 rounded-lg hover:bg-emerald-800 text-sm cursor-pointer w-fit">
          <Upload size={16} />
          <input type="file" accept=".zip,.json" multiple className="hidden"
            onChange={(e) => { recibir(e.target.files); e.currentTarget.value = ''; }} />
          Seleccionar el paquete (.zip)
        </label>

        {preview && (
          <div className="border border-sky-200 bg-sky-50 rounded-lg p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700 mb-1 flex items-center gap-1"><FileArchive size={13} /> Previo · lo que se va a importar</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-gray-700">
              <span>Ejercicios: <b>{(preview.ejercicios || []).join(', ') || '—'}</b></span>
              <span>Cuentas: <b>{preview.cuentas}</b></span>
              <span>Pólizas: <b>{preview.polizas}</b></span>
              <span>Movimientos: <b>{preview.movimientos}</b></span>
              <span>CFDI: <b>{preview.cfdi}</b></span>
              <span>Ligas póliza-UUID: <b>{preview.ligas}</b></span>
            </div>
            <p className={`text-xs mt-1 ${cuadra ? 'text-emerald-700' : 'text-rose-700'}`}>
              Cargos {mx(preview.cargos)} {cuadra ? '=' : '≠'} Abonos {mx(preview.abonos)}
              {cuadra ? ' · cuadra' : ` · dif ${mx(preview.cargos - preview.abonos)}`}
            </p>
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
                    className={`px-3 py-1 rounded-full text-sm border ${on ? 'bg-emerald-700 text-white border-emerald-700' : 'text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
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

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={importar}
            disabled={busy || !preview || (preview?.ejercicios?.length > 1 && ejerSel.size === 0)}
            className="flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
            <PlayCircle size={16} /> {busy ? 'Importando…' : soloCatalogo ? 'Importar SÓLO el catálogo' : 'Importar a la empresa activa'}
          </button>
          <label className="flex items-center gap-1.5 text-sm text-gray-600"
            title="Trae sólo el catálogo de cuentas para revisarlo/corregirlo; luego re-importas SIN esto para las pólizas">
            <input type="checkbox" checked={soloCatalogo} onChange={(e) => setSoloCatalogo(e.target.checked)} />
            Sólo el catálogo (revisarlo antes de las pólizas)
          </label>
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
        <Tarjeta titulo="Ejercicios" valor={(rep.ejerciciosActivados || []).join(', ') || '—'} />
        <Tarjeta titulo="Cuentas" valor={`${rep.cuentas?.creadas ?? 0} nuevas${rep.cuentas?.agrupadorRellenado ? ` · ${rep.cuentas.agrupadorRellenado} con agrupador SAT rellenado` : ''}${rep.cuentas?.sinAgrupador ? ` · ${rep.cuentas.sinAgrupador} aún sin agrupador` : ''}`} />
        <Tarjeta titulo="Pólizas" valor={`${rep.polizas?.creadas ?? 0} creadas · ${rep.polizas?.yaExistian ?? 0} ya estaban · ${rep.polizas?.omitidas ?? 0} omitidas`} />
        <Tarjeta titulo="Comprobantes (CFDI)" valor={`${rep.cfdi?.creados ?? 0} nuevos`} />
        <Tarjeta titulo="Balanza" valor={`${rep.balanzaPeriodos ?? 0} periodo(s) actualizados`} />
        <Tarjeta titulo="XML del SAT" valor={rep.satDescarga > 0 ? `${rep.satDescarga} descarga(s) iniciada(s) desde el SAT` : 'no iniciada (revisa e.firma en los avisos)'} />
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
