/**
 * Contrato de prestación de servicios — lectura y firma con e.firma.
 *
 * ⚠️ El TEXTO legal del contrato está pendiente de redacción (lo marca el
 * propio documento con "[PENDIENTE — texto legal]"). Esta pantalla y el flujo
 * de firma sí están completos: cuando el abogado entregue el texto, solo se
 * edita backend/src/modules/contracts/contract-text.ts y se sube la versión.
 *
 * La e.firma (.cer + .key + contraseña) se manda al backend para firmar y NO
 * se guarda: ni el archivo, ni la contraseña. Igual que el manifiesto del PAC.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSignature, ShieldCheck, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

/** Lee un File a base64 (sin el prefijo data:...;base64,). */
function fileToB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error(`No se pudo leer ${file.name}`));
    r.readAsDataURL(file);
  });
}

export function ContractPage() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const isAdmin = me?.role === 'ADMIN';

  const { data, isLoading } = useQuery({
    queryKey: ['contract'],
    queryFn: () => api.getContract(),
  });

  const [cer, setCer] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const sign = useMutation({
    mutationFn: async () => {
      if (!cer || !key || !password) throw new Error('Sube el .cer, la .key y escribe la contraseña');
      const [cerB64, keyB64] = await Promise.all([fileToB64(cer), fileToB64(key)]);
      return api.signContract({ cerB64, keyB64, password });
    },
    onSuccess: () => {
      // La contraseña se limpia en cuanto deja de hacer falta.
      setPassword(''); setCer(null); setKey(null); setErr(null);
      qc.invalidateQueries({ queryKey: ['contract'] });
    },
    onError: (e: any) => setErr(e?.response?.data?.message || e.message || 'No se pudo firmar'),
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-600" size={32} /></div>;
  }

  const c = data?.data;
  const firma = c?.signature;
  const vigente = firma && !firma.outdated;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold text-gray-900">Contrato de servicios</h1>
        <p className="text-gray-600 mt-2">
          Términos y Condiciones del servicio de facturación, firmados con tu e.firma.
        </p>
      </div>

      {/* Estado */}
      {vigente ? (
        <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={22} />
          <div className="text-sm">
            <p className="font-bold text-emerald-900">Contrato firmado</p>
            <p className="text-emerald-800">
              Versión {firma.version} · firmado por <b>{firma.signer_name || firma.signer_rfc}</b> (RFC {firma.signer_rfc})
              el {new Date(firma.signed_at).toLocaleString('es-MX')}.
            </p>
            <p className="text-emerald-700 mt-1 font-mono text-xs break-all">
              Huella SHA-256: {firma.contract_sha256}
            </p>
          </div>
        </div>
      ) : firma?.outdated ? (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={22} />
          <div className="text-sm">
            <p className="font-bold text-amber-900">Los Términos y Condiciones cambiaron</p>
            <p className="text-amber-800">
              Firmaste la versión {firma.version} y la vigente es la {c.version_vigente}.
              Vuelve a firmar para aceptar la versión actual.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-4 flex items-start gap-3">
          <FileSignature className="text-blue-600 shrink-0 mt-0.5" size={22} />
          <div className="text-sm">
            <p className="font-bold text-blue-900">Contrato pendiente de firma</p>
            <p className="text-blue-800">Lee el documento y fírmalo con la e.firma de tu empresa.</p>
          </div>
        </div>
      )}

      {/* Texto del contrato */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Documento · versión {c?.version_vigente}</h2>
        </div>
        <pre className="p-6 text-xs leading-relaxed text-gray-800 whitespace-pre-wrap font-sans max-h-[50vh] overflow-y-auto">
          {c?.contract_text}
        </pre>
      </div>

      {/* Firma */}
      {!isAdmin ? (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-600">
          Solo el administrador de la empresa puede firmar el contrato.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-lg p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-indigo-600" size={20} />
            <h2 className="font-bold text-gray-900">Firmar con e.firma</h2>
          </div>
          <p className="text-sm text-gray-600">
            Usa la e.firma (FIEL) de tu empresa. Los archivos y la contraseña se usan
            únicamente para generar la firma: <b>no se guardan</b> en el sistema.
          </p>

          {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{err}</p>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Certificado (.cer)</label>
              <input type="file" accept=".cer"
                onChange={(e) => setCer(e.target.files?.[0] || null)}
                className="w-full text-sm border border-gray-300 rounded-lg p-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Llave privada (.key)</label>
              <input type="file" accept=".key"
                onChange={(e) => setKey(e.target.files?.[0] || null)}
                className="w-full text-sm border border-gray-300 rounded-lg p-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña de la e.firma</label>
              <input type="password" value={password} autoComplete="off"
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <button
            onClick={() => { setErr(null); sign.mutate(); }}
            disabled={sign.isPending || !cer || !key || !password}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg font-semibold"
          >
            {sign.isPending ? <Loader2 size={18} className="animate-spin" /> : <FileSignature size={18} />}
            {vigente ? 'Volver a firmar' : 'Aceptar y firmar'}
          </button>
        </div>
      )}
    </div>
  );
}

export default ContractPage;
