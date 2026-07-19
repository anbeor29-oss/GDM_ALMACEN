/**
 * CartaPorteImportarXml — sube un CFDI+CP timbrado y semilla los 4 catálogos
 * (lugares, vehículo, aseguradoras, operadores) de golpe.
 *
 * UX: 3 pasos
 *   1) Subir XML  (drag&drop o input file)
 *   2) Preview editable — se ve qué se va a crear con auto-aliases
 *   3) Apply  — llama al endpoint y muestra resumen final
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileUp, Upload, X, Check, ArrowLeft, MapPin, Truck, Shield, UserCog, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '@/services/api';

interface Preview {
  invoice?: { uuid?: string; folio?: string; fecha?: string; total?: number; emisorRfc?: string; receptorRfc?: string; };
  cartaPorte: { idCCP?: string; transpInternac?: string; totalDistRec?: number; };
  lugares: any[];
  vehiculo?: any;
  aseguradoras: any[];
  operadores: any[];
}

export function CartaPorteImportarXmlPage() {
  const navigate = useNavigate();
  const [, setXml] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applied, setApplied] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const previewMut = useMutation({
    mutationFn: (xmlContent: string) => api.cpImportPreview(xmlContent),
    onSuccess: (data) => { setPreview(data); setErr(null); },
    onError: (e: any) => setErr(e?.response?.data?.error || e?.message || 'No se pudo leer el XML'),
  });
  const applyMut = useMutation({
    mutationFn: (payload: any) => api.cpImportApply(payload),
    onSuccess: (data) => setApplied(data),
    onError: (e: any) => setErr(e?.response?.data?.error || e?.message || 'Error al importar'),
  });

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      setErr('El archivo debe ser .xml');
      return;
    }
    const text = await file.text();
    setXml(text);
    setFileName(file.name);
    setApplied(null);
    setErr(null);
    previewMut.mutate(text);
  };

  const restart = () => {
    setXml(null); setFileName(''); setPreview(null); setApplied(null); setErr(null);
    previewMut.reset(); applyMut.reset();
  };

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-100 rounded"><ArrowLeft size={20} /></button>
        <div className="p-2 bg-violet-100 rounded-lg"><FileUp size={26} className="text-violet-700" /></div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Importar Carta Porte desde XML</h1>
          <p className="text-sm text-slate-500">Sube un CFDI timbrado con complemento CP 3.1 y semilla tus catálogos en un click</p>
        </div>
      </div>

      {err && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>{err}</span>
          <button onClick={() => setErr(null)} className="ml-auto text-red-400 hover:text-red-600"><X size={16} /></button>
        </div>
      )}

      {/* PASO 1: upload */}
      {!preview && !applied && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          className={`border-2 border-dashed rounded-lg p-16 text-center transition-colors ${dragOver ? 'border-violet-500 bg-violet-50' : 'border-slate-300 bg-white'}`}
        >
          <Upload size={48} className="mx-auto mb-4 text-slate-400" />
          <h3 className="text-lg font-semibold text-slate-700 mb-2">Arrastra el XML aquí</h3>
          <p className="text-sm text-slate-500 mb-4">O</p>
          <label className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium cursor-pointer">
            <FileUp size={16} /> Elegir archivo
            <input type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
          <p className="text-xs text-slate-400 mt-4">Acepta el XML timbrado de cualquier PAC (SW, Facturama, Diverza…). Solo lee el complemento cartaporte31.</p>
        </div>
      )}

      {previewMut.isPending && (
        <div className="p-8 text-center text-slate-500">Analizando XML…</div>
      )}

      {/* PASO 2: preview */}
      {preview && !applied && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800">Archivo: <span className="font-mono text-sm text-slate-600">{fileName}</span></h3>
              <button onClick={restart} className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"><X size={14} /> Cambiar</button>
            </div>
            <div className="grid grid-cols-4 gap-3 text-xs">
              <Info label="Factura" value={preview.invoice?.folio || '—'} />
              <Info label="Emisor" value={preview.invoice?.emisorRfc || '—'} mono />
              <Info label="UUID" value={preview.invoice?.uuid ? preview.invoice.uuid.slice(0, 8) + '…' : '(no timbrada)'} mono />
              <Info label="IdCCP" value={preview.cartaPorte.idCCP?.slice(0, 12) + '…' || '—'} mono />
              <Info label="TranspInternac" value={preview.cartaPorte.transpInternac || 'No'} />
              <Info label="Distancia" value={preview.cartaPorte.totalDistRec ? `${preview.cartaPorte.totalDistRec} km` : '—'} />
            </div>
          </div>

          {/* Cards */}
          <div className="grid grid-cols-2 gap-4">
            <Card
              icon={<MapPin size={16} className="text-emerald-700" />}
              title={`📍 Lugares (${preview.lugares.length})`}
              color="emerald"
              items={preview.lugares.map(l => ({
                title: l.alias,
                lines: [
                  `${l.tipoDefault} · ${l.rfc}`,
                  l.nombre,
                  [l.calle, l.numExterior].filter(Boolean).join(' '),
                  `${l.estado} · CP ${l.codigoPostal}`,
                ].filter(Boolean),
              }))}
            />
            <Card
              icon={<Truck size={16} className="text-amber-700" />}
              title={`🚚 Vehículo`}
              color="amber"
              items={preview.vehiculo ? [{
                title: preview.vehiculo.alias,
                lines: [
                  `Placa ${preview.vehiculo.placaVm} · ${preview.vehiculo.configVehicular} · ${preview.vehiculo.anioModeloVm}`,
                  `Peso bruto ${preview.vehiculo.pesoBrutoVehicular} t`,
                  `Permiso ${preview.vehiculo.permSct} · ${preview.vehiculo.numPermisoSct}`,
                ],
              }] : []}
            />
            <Card
              icon={<Shield size={16} className="text-sky-700" />}
              title={`🛡 Aseguradoras (${preview.aseguradoras.length})`}
              color="sky"
              items={preview.aseguradoras.map(a => ({
                title: a.alias,
                lines: [
                  `${a.tipo} · ${a.nombreAseguradora}`,
                  `Póliza ${a.numPoliza}`,
                ],
              }))}
            />
            <Card
              icon={<UserCog size={16} className="text-fuchsia-700" />}
              title={`👤 Operadores (${preview.operadores.length})`}
              color="fuchsia"
              items={preview.operadores.map(o => ({
                title: o.alias,
                lines: [
                  `Tipo ${o.tipoFigura} · ${o.nombre}`,
                  `${o.rfc}${o.numLicencia ? ' · Lic. ' + o.numLicencia : ''}`,
                ],
              }))}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button onClick={restart} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
              Cancelar
            </button>
            <button
              onClick={() => applyMut.mutate(preview)}
              disabled={applyMut.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium"
            >
              <Check size={16} /> {applyMut.isPending ? 'Importando…' : 'Importar todo'}
            </button>
          </div>
        </div>
      )}

      {/* PASO 3: resultado */}
      {applied && (
        <div className="space-y-4">
          <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-emerald-100 rounded-lg"><Check size={24} className="text-emerald-700" /></div>
              <div>
                <h3 className="text-lg font-semibold text-emerald-900">Importado correctamente</h3>
                <p className="text-sm text-emerald-700">Estos elementos ya están en tus catálogos</p>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 text-sm">
              <ResultTile label="Lugares"      count={applied.lugares?.length ?? 0} />
              <ResultTile label="Vehículo"     count={applied.vehiculo ? 1 : 0} />
              <ResultTile label="Aseguradoras" count={applied.aseguradoras?.length ?? 0} />
              <ResultTile label="Operadores"   count={applied.operadores?.length ?? 0} />
            </div>
          </div>

          {applied.errors?.length > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
              <p className="font-medium mb-2">Advertencias durante la importación:</p>
              <ul className="list-disc list-inside space-y-1">
                {applied.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={restart} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded text-sm">
              Importar otro XML
            </button>
            <button onClick={() => navigate('/carta-porte/lugares')} className="px-4 py-2 border border-slate-300 hover:bg-slate-50 rounded text-sm">
              Ver mis lugares
            </button>
            <button onClick={() => navigate('/carta-porte/vehiculos')} className="px-4 py-2 border border-slate-300 hover:bg-slate-50 rounded text-sm">
              Ver mis vehículos
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="block text-slate-500 uppercase tracking-wider text-[10px] font-medium">{label}</span>
      <span className={`block ${mono ? 'font-mono' : ''} text-slate-800`}>{value}</span>
    </div>
  );
}

function Card({ icon, title, color, items }: { icon: React.ReactNode; title: string; color: string; items: { title: string; lines: string[] }[] }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <header className={`px-4 py-2 border-b border-slate-200 bg-${color}-50 rounded-t-lg flex items-center gap-2`}>
        {icon}
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </header>
      <div className="p-4 space-y-3">
        {items.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No se detectó en el XML</p>
        ) : items.map((it, i) => (
          <div key={i} className="border-l-2 border-slate-200 pl-3">
            <p className="text-sm font-medium text-slate-800">{it.title}</p>
            {it.lines.map((l, j) => <p key={j} className="text-xs text-slate-500">{l}</p>)}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultTile({ label, count }: { label: string; count: number }) {
  return (
    <div className="bg-white p-3 rounded border border-emerald-100">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-semibold text-emerald-700">{count}</p>
    </div>
  );
}
