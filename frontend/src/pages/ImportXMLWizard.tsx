/**
 * Importar XML — wizard de 3 pasos:
 *  1) Sube XML (drag-and-drop o file picker)
 *  2) Preview: muestra Emisor + Receptor + Conceptos con checkboxes
 *  3) Confirma — elige qué crear (cliente y/o productos) y opcional pre-llenar factura
 *
 *  El backend NO persiste nada hasta el paso 3. Dedup automático por SHA-256.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, CheckCircle2, AlertCircle, Building2, User, Boxes, ArrowRight, X, History } from 'lucide-react';
import api from '@/services/api';

type Party = 'emisor' | 'receptor' | 'none';
type PartyKind = 'CUSTOMER' | 'SUPPLIER';

interface PreviewedConcept {
  index: number;
  clave_sat: string; clave_unidad: string; descripcion: string;
  cantidad: number; valor_unitario: number; importe: number;
  exists_in_catalog: boolean; existing_product_id?: string;
}
interface PreviewedParty {
  rfc: string; nombre?: string; regimen_fiscal?: string;
  exists_in_catalog: boolean; existing_customer_id?: string;
  existing_party_type?: PartyKind;
  is_self: boolean;
}
interface PreviewResult {
  sha256: string; cfdi_uuid: string | null;
  fecha_emision?: string; folio?: string; serie?: string; total?: number;
  emisor: PreviewedParty; receptor: PreviewedParty;
  conceptos: PreviewedConcept[];
  already_imported: { yes: boolean; ts?: string; by_user?: string; status?: string };
  suggestion: { party: Party; kind: PartyKind; reason: string };
}

function fmt(n: any) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
}
async function fileToB64(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

export function ImportXMLWizardPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [xmlB64, setXmlB64] = useState<string>('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Estado de selección del paso 3
  const [party, setParty] = useState<Party>('emisor');
  const [partyKind, setPartyKind] = useState<PartyKind>('CUSTOMER');
  const [conceptIdxs, setConceptIdxs] = useState<Set<number>>(new Set());
  const [prefill, setPrefill] = useState(true);
  const [committing, setCommitting] = useState(false);

  const reset = () => {
    setFile(null); setXmlB64(''); setPreview(null);
    setError(''); setParty('emisor'); setPartyKind('CUSTOMER');
    setConceptIdxs(new Set()); setPrefill(true);
  };

  const handleFile = async (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.xml$/i.test(f.name)) { setError('Solo archivos .xml'); return; }
    if (f.size > 1_048_576)      { setError('Archivo excede 1 MB'); return; }
    setError(''); setLoading(true);
    try {
      const b64 = await fileToB64(f);
      setXmlB64(b64); setFile(f);
      const res = await api.cfdiPreview(b64);
      const data = res.data as PreviewResult;
      setPreview(data);
      // Defaults inteligentes: marcar todos los conceptos NUEVOS por defecto
      const defaults = new Set<number>();
      data.conceptos.forEach((c) => { if (!c.exists_in_catalog) defaults.add(c.index); });
      setConceptIdxs(defaults);
      // Aplicamos la sugerencia server-side (basada en RFC de "mi empresa")
      setParty(data.suggestion.party);
      setPartyKind(data.suggestion.kind);
      // Si la party sugerida es 'none' (ambiguo), igual permitimos elegir manualmente
      if (data.suggestion.party === 'none') {
        if (!data.emisor.exists_in_catalog && data.emisor.rfc && !data.emisor.is_self) {
          setParty('emisor');
        } else if (!data.receptor.exists_in_catalog && data.receptor.rfc && !data.receptor.is_self) {
          setParty('receptor');
        }
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'Error parseando XML');
      setFile(null);
    } finally { setLoading(false); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0]);
  };

  const toggleConcept = (idx: number) => {
    const next = new Set(conceptIdxs);
    next.has(idx) ? next.delete(idx) : next.add(idx);
    setConceptIdxs(next);
  };

  const submitCommit = async () => {
    if (!preview) return;
    setCommitting(true); setError('');
    try {
      const res = await api.cfdiCommit({
        sha256: preview.sha256,
        xmlBase64: xmlB64,
        selection: {
          party,
          partyKind,
          concept_indexes: Array.from(conceptIdxs),
        },
        productTaxPresetId: 'iva16',
        // Solo redirigimos a Nueva Factura cuando creamos CLIENTE (a un proveedor no le facturamos)
        prefillInvoice: prefill && party !== 'none' && partyKind === 'CUSTOMER',
      });
      const data = res.data;
      const msgParts: string[] = [];
      if (data.party) {
        const label = data.party.kind === 'SUPPLIER' ? 'Proveedor' : 'Cliente';
        msgParts.push(`${label}: ${data.party.rfc} — ${data.party.business_name} ${data.party.already_existed ? '(ya existía)' : '(creado)'}`);
      }
      if (data.products.length > 0) {
        const nuevos = data.products.filter((p: any) => !p.already_existed).length;
        msgParts.push(`Productos: ${data.products.length} (${nuevos} nuevos)`);
      }
      alert(`✅ Importación completada\n\n${msgParts.join('\n') || 'Sin cambios al catálogo'}`);
      if (data.next?.redirectTo) navigate(data.next.redirectTo);
      else reset();
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message);
    } finally { setCommitting(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <FileText className="text-indigo-600" size={36}/> Importar desde XML
          </h1>
          <p className="text-gray-600 mt-1">Sube un CFDI y elige qué quieres capturar al catálogo.</p>
        </div>
        {preview && (
          <button onClick={reset} className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
            <X size={16}/> Cancelar
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex gap-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5"/> {error}
        </div>
      )}

      {!preview && (
        <div className="bg-white rounded-lg shadow p-12 text-center"
          onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
          <Upload size={48} className="mx-auto text-gray-400 mb-4"/>
          <p className="text-lg font-medium text-gray-700">Arrastra tu XML aquí</p>
          <p className="text-sm text-gray-500 mb-4">o selecciona un archivo</p>
          <label className="inline-block">
            <input type="file" accept=".xml,application/xml,text/xml" hidden
              onChange={(e) => handleFile(e.target.files?.[0])}/>
            <span className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg cursor-pointer">
              {loading ? 'Procesando…' : 'Seleccionar XML'}
            </span>
          </label>
          <p className="text-xs text-gray-400 mt-3">Máx. 1 MB · CFDI 4.0 / 3.3 / 3.2</p>
        </div>
      )}

      {preview && (
        <>
          {/* Alerta de duplicado */}
          {preview.already_imported.yes && (
            <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-3 rounded-lg flex items-start gap-3">
              <History size={20} className="shrink-0 mt-0.5"/>
              <div>
                <p className="font-semibold">Este XML ya fue importado antes</p>
                <p className="text-sm">
                  El {new Date(preview.already_imported.ts!).toLocaleString('es-MX')} por{' '}
                  <span className="font-mono">{preview.already_imported.by_user}</span>{' '}
                  (estado: {preview.already_imported.status}).
                  Puedes confirmar de nuevo si quieres actualizar el catálogo.
                </p>
              </div>
            </div>
          )}

          {/* Header del CFDI */}
          <div className="bg-white rounded-lg shadow p-4 text-sm grid grid-cols-2 md:grid-cols-5 gap-3">
            <div><span className="text-gray-500 text-xs uppercase">Archivo</span><p className="font-mono truncate">{file?.name}</p></div>
            <div><span className="text-gray-500 text-xs uppercase">Folio</span><p>{preview.serie || ''}-{preview.folio || '—'}</p></div>
            <div><span className="text-gray-500 text-xs uppercase">Fecha</span><p>{preview.fecha_emision || '—'}</p></div>
            <div><span className="text-gray-500 text-xs uppercase">UUID</span><p className="font-mono text-xs truncate">{preview.cfdi_uuid || 'sin timbre'}</p></div>
            <div><span className="text-gray-500 text-xs uppercase">Total</span><p className="font-semibold">$ {fmt(preview.total)}</p></div>
          </div>

          {/* Auto-sugerencia (calculada por el backend con RFC de "mi empresa") */}
          {preview.suggestion.party !== 'none' && (
            <div className="bg-sky-50 border border-sky-200 text-sky-900 px-4 py-3 rounded-lg flex items-start gap-2">
              <CheckCircle2 size={18} className="shrink-0 mt-0.5"/>
              <div>
                <p className="font-semibold">Sugerencia automática</p>
                <p className="text-sm">{preview.suggestion.reason}</p>
              </div>
            </div>
          )}

          {/* Selección de la parte a importar */}
          <div className="bg-white rounded-lg shadow p-5">
            <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
              <User size={18}/> ¿Qué parte quieres capturar?
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <PartyCard label="Emisor (quien facturó)" tag="emisor" party={preview.emisor}
                selected={party === 'emisor'} onSelect={() => setParty('emisor')}
                disabled={preview.emisor.is_self}
                icon={<Building2 size={18}/>}/>
              <PartyCard label="Receptor (a quien le facturaron)" tag="receptor" party={preview.receptor}
                selected={party === 'receptor'} onSelect={() => setParty('receptor')}
                disabled={preview.receptor.is_self}
                icon={<User size={18}/>}/>
              <button type="button" onClick={() => setParty('none')}
                className={`text-left border-2 rounded-lg p-4 transition ${party==='none' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <p className="font-semibold text-gray-800">Ninguno</p>
                <p className="text-xs text-gray-500 mt-1">Solo importar productos al catálogo.</p>
              </button>
            </div>

            {/* Selector CLIENTE vs PROVEEDOR — solo si se elige una party */}
            {party !== 'none' && (
              <div className="mt-4 border-t pt-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Esta parte se creará como:</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPartyKind('CUSTOMER')}
                    className={`flex-1 border-2 rounded-lg p-3 transition ${
                      partyKind === 'CUSTOMER'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}>
                    <p className="font-semibold flex items-center gap-1">
                      <User size={16}/> Cliente
                    </p>
                    <p className="text-xs mt-1 opacity-80">Yo le facturo. Puedo emitirle CFDIs.</p>
                  </button>
                  <button type="button" onClick={() => setPartyKind('SUPPLIER')}
                    className={`flex-1 border-2 rounded-lg p-3 transition ${
                      partyKind === 'SUPPLIER'
                        ? 'border-amber-500 bg-amber-50 text-amber-900'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}>
                    <p className="font-semibold flex items-center gap-1">
                      <Building2 size={16}/> Proveedor
                    </p>
                    <p className="text-xs mt-1 opacity-80">Me factura. Solo registro, no editable.</p>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Selección de productos */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-5 border-b flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Boxes size={18}/> Productos del XML
              </h2>
              <div className="text-xs text-gray-500">
                {conceptIdxs.size} de {preview.conceptos.length} seleccionados
                <button type="button"
                  onClick={() => setConceptIdxs(new Set(preview.conceptos.map((c) => c.index)))}
                  className="ml-3 text-indigo-600 hover:underline">todos</button>
                <button type="button" onClick={() => setConceptIdxs(new Set())}
                  className="ml-2 text-gray-500 hover:underline">ninguno</button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 w-10"></th>
                  <th className="px-3 py-2 text-left">Descripción</th>
                  <th className="px-3 py-2 text-left">Clave SAT</th>
                  <th className="px-3 py-2 text-left">Unidad</th>
                  <th className="px-3 py-2 text-right">Cantidad</th>
                  <th className="px-3 py-2 text-right">P. Unit.</th>
                  <th className="px-3 py-2 text-center">Catálogo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {preview.conceptos.map((c) => (
                  <tr key={c.index} className={c.exists_in_catalog ? 'bg-emerald-50/40' : ''}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={conceptIdxs.has(c.index)}
                        onChange={() => toggleConcept(c.index)}/>
                    </td>
                    <td className="px-3 py-2 font-medium">{c.descripcion}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.clave_sat}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.clave_unidad}</td>
                    <td className="px-3 py-2 text-right">{fmt(c.cantidad)}</td>
                    <td className="px-3 py-2 text-right">$ {fmt(c.valor_unitario)}</td>
                    <td className="px-3 py-2 text-center">
                      {c.exists_in_catalog ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                          <CheckCircle2 size={12}/> ya existe
                        </span>
                      ) : <span className="text-xs text-gray-400">nuevo</span>}
                    </td>
                  </tr>
                ))}
                {preview.conceptos.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500 italic">
                    El XML no tiene conceptos importables
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Acción final */}
          <div className="bg-white rounded-lg shadow p-5 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={prefill} onChange={(e) => setPrefill(e.target.checked)}
                disabled={party === 'none'}/>
              Pre-rellenar una nueva factura con este cliente
            </label>
            <button onClick={submitCommit} disabled={committing}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg disabled:opacity-50 shadow">
              {committing ? 'Importando…' : <>Confirmar importación <ArrowRight size={16}/></>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PartyCard({
  label, party, selected, onSelect, icon, disabled,
}: { label: string; tag: Party; party: PreviewedParty; selected: boolean;
     onSelect: () => void; icon: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      className={`text-left border-2 rounded-lg p-4 transition ${
        disabled ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed' :
        selected ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500 mb-2">
        {icon} {label}
      </div>
      {party.rfc ? (
        <>
          <p className="font-mono font-semibold">{party.rfc}</p>
          <p className="text-sm text-gray-700 truncate">{party.nombre || '—'}</p>
          {party.regimen_fiscal && (
            <p className="text-xs text-gray-500 mt-1">Régimen {party.regimen_fiscal}</p>
          )}
          <div className="text-xs mt-2 space-y-0.5">
            {party.is_self && (
              <span className="inline-flex items-center gap-1 text-indigo-700 font-semibold">
                <CheckCircle2 size={12}/> es tu empresa (no se importa)
              </span>
            )}
            {!party.is_self && party.exists_in_catalog && (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2 size={12}/> ya en catálogo como {party.existing_party_type || 'CUSTOMER'}
              </span>
            )}
            {!party.is_self && !party.exists_in_catalog && (
              <span className="text-amber-700">se creará nuevo</span>
            )}
          </div>
        </>
      ) : <p className="text-xs text-gray-400 italic">— sin RFC en el XML —</p>}
    </button>
  );
}
