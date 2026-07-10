/**
 * ManifestSigner — firma del manifiesto PAC con la e.firma (FIEL).
 *
 * Se muestra dentro del IssuerModal (configuración del emisor). El flujo:
 *   1. Si ya hay manifiesto firmado → badge verde con datos + descarga PDF.
 *   2. Si no → texto del manifiesto (colapsable) + carga de .cer/.key +
 *      contraseña + botón "Firmar con mi e.firma".
 *
 * La .key se manda al backend SOLO para firmar en memoria — nunca se guarda.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileSignature, ShieldCheck, Download, ChevronDown, Loader2, AlertTriangle,
} from 'lucide-react';
import api from '@/services/api';

function fileToB64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

export function ManifestSigner() {
  const qc = useQueryClient();
  const statusQ = useQuery({
    queryKey: ['manifest-status'],
    queryFn: () => api.getManifestStatus(),
  });
  const textQ = useQuery({
    queryKey: ['manifest-text'],
    queryFn: () => api.getManifestText(),
    enabled: !statusQ.data?.data?.manifest, // solo si aún no firma
  });

  const manifest = statusQ.data?.data?.manifest;
  const [showText, setShowText] = useState(false);
  const [cer, setCer] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const downloadPdf = async () => {
    try {
      const blob = await api.manifestPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'manifiesto-firmado.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.response?.data?.message || e.message);
    }
  };

  const sign = async () => {
    setError('');
    if (!cer || !key || !password) {
      setError('Selecciona el .cer, la .key y captura la contraseña de tu e.firma.');
      return;
    }
    setBusy(true);
    try {
      const [cerB64, keyB64] = await Promise.all([fileToB64(cer), fileToB64(key)]);
      const r = await api.signManifest({ cerB64, keyB64, password });
      alert(
        `✅ Manifiesto firmado correctamente\n\n` +
        `Firmante: ${r.data.signerName || r.data.signerRfc}\n` +
        `No. serie e.firma: ${r.data.certSerial}\n\n` +
        `Puedes descargar la constancia PDF desde esta misma sección.`
      );
      setCer(null); setKey(null); setPassword('');
      qc.invalidateQueries({ queryKey: ['manifest-status'] });
    } catch (e: any) {
      setError(e.response?.data?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  if (statusQ.isLoading) {
    return <p className="text-sm text-gray-500 italic">Cargando estado del manifiesto…</p>;
  }

  /* ── Ya firmado ── */
  if (manifest) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2">
        <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
          <ShieldCheck size={18}/> Manifiesto firmado
        </div>
        <div className="text-xs text-emerald-900 space-y-0.5">
          <p><b>Firmante:</b> {manifest.signer_name || '—'} ({manifest.signer_rfc})</p>
          <p><b>No. serie e.firma:</b> <span className="font-mono">{manifest.cert_serial}</span></p>
          <p><b>Fecha de firma:</b> {new Date(manifest.signed_at).toLocaleString('es-MX')}</p>
        </div>
        <button
          type="button"
          onClick={downloadPdf}
          className="flex items-center gap-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded"
        >
          <Download size={14}/> Descargar constancia PDF
        </button>
      </div>
    );
  }

  /* ── Pendiente de firma ── */
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 text-amber-900 font-semibold text-sm">
        <AlertTriangle size={18}/> Manifiesto pendiente de firma
      </div>
      <p className="text-xs text-amber-800">
        Para timbrar ante el SAT, el contribuyente debe autorizar expresamente al
        Proveedor de Certificación (SW SAPIEN). Firma este manifiesto una sola vez
        con tu <b>e.firma (FIEL)</b> — no con el CSD.
      </p>

      {/* Texto colapsable */}
      <button
        type="button"
        onClick={() => setShowText(!showText)}
        className="flex items-center gap-1 text-xs text-amber-900 font-medium hover:underline"
      >
        <ChevronDown size={14} className={showText ? 'rotate-180 transition-transform' : 'transition-transform'}/>
        {showText ? 'Ocultar texto del manifiesto' : 'Leer el texto que vas a firmar'}
      </button>
      {showText && (
        <pre className="bg-white border border-amber-200 rounded p-3 text-[10.5px] leading-relaxed whitespace-pre-wrap font-sans text-slate-700 max-h-64 overflow-y-auto">
          {textQ.data?.data?.text || 'Cargando…'}
        </pre>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-xs">
          {error}
        </div>
      )}

      {/* Carga de la e.firma */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-amber-900 block mb-1">Certificado (.cer)</span>
          <input
            type="file" accept=".cer"
            onChange={(e) => setCer(e.target.files?.[0] || null)}
            className="block w-full text-xs file:mr-2 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-amber-600 file:text-white hover:file:bg-amber-700 file:cursor-pointer"
          />
          {cer && <p className="text-[10px] text-emerald-700 mt-0.5">✓ {cer.name}</p>}
        </label>
        <label className="block">
          <span className="text-xs font-medium text-amber-900 block mb-1">Clave privada (.key)</span>
          <input
            type="file" accept=".key"
            onChange={(e) => setKey(e.target.files?.[0] || null)}
            className="block w-full text-xs file:mr-2 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-amber-600 file:text-white hover:file:bg-amber-700 file:cursor-pointer"
          />
          {key && <p className="text-[10px] text-emerald-700 mt-0.5">✓ {key.name}</p>}
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-amber-900 block mb-1">Contraseña de la e.firma</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="w-full border border-amber-300 rounded px-3 py-2 text-sm"
          autoComplete="new-password"
        />
      </label>
      <p className="text-[10px] text-amber-700 italic">
        Tu .key se usa únicamente para generar la firma y se descarta — no se
        almacena en el servidor.
      </p>

      <button
        type="button"
        onClick={sign}
        disabled={busy || !cer || !key || !password}
        className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-semibold px-4 py-2.5 rounded-lg"
      >
        {busy ? <Loader2 size={16} className="animate-spin"/> : <FileSignature size={16}/>}
        {busy ? 'Firmando…' : 'Firmar manifiesto con mi e.firma'}
      </button>
    </div>
  );
}

export default ManifestSigner;
