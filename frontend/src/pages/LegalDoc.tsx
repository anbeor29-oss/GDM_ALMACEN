/**
 * LegalDoc — página pública que renderiza el texto oficial de los documentos
 * legales servidos por el backend (GET /api/v1/legal/terms · /privacy-notice).
 *
 * Uso: rutas /terminos y /privacidad — accesibles sin sesión desde el pie de
 * página del landing. El texto se carga en tiempo real desde el backend para
 * garantizar que siempre corresponde a la versión vigente.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, ArrowLeft, Download } from 'lucide-react';
import { GdmLogo } from '@/components/GdmLogo';

interface Props {
  /** Ruta relativa bajo /api/v1/legal/ — 'terms' o 'privacy-notice'. */
  endpoint: 'terms' | 'privacy-notice';
  title: string;
  subtitle?: string;
}

export function LegalDoc({ endpoint, title, subtitle }: Props) {
  const [text, setText] = useState<string>('');
  const [version, setVersion] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = import.meta.env.VITE_API_BASE || '';
        const url = `${base}/api/v1/legal/${endpoint}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const t = await r.text();
        if (cancelled) return;
        setText(t);
        setVersion(r.headers.get('X-Version') || '');
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Error al cargar');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [endpoint]);

  const downloadTxt = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${endpoint}-${version || 'v1'}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-slate-600 hover:text-slate-900">
            <ArrowLeft size={18} /> <GdmLogo size={28} /> <span className="font-semibold">GDM Facturación</span>
          </Link>
          {text && (
            <button
              onClick={downloadTxt}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 border border-slate-300 rounded hover:bg-slate-100"
            >
              <Download size={14} /> Descargar (.txt)
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <FileText size={22} className="text-indigo-700" />
            </div>
            <h1 className="text-2xl font-semibold text-slate-800">{title}</h1>
          </div>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
          {version && (
            <p className="text-xs text-slate-400 mt-1">Versión vigente: <span className="font-mono">{version}</span></p>
          )}
        </div>

        {loading && <p className="text-slate-500 text-center py-12">Cargando…</p>}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            No se pudo cargar el documento: {error}
          </div>
        )}
        {text && !loading && (
          <div className="bg-white border border-slate-200 rounded-lg p-8 shadow-sm">
            <pre className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-slate-800">
              {text}
            </pre>
          </div>
        )}

        <div className="mt-8 text-center text-xs text-slate-500">
          <Link to="/terminos" className="hover:text-slate-800 underline">Términos y Condiciones</Link>
          <span className="mx-3">·</span>
          <Link to="/privacidad" className="hover:text-slate-800 underline">Aviso de Privacidad</Link>
          <span className="mx-3">·</span>
          <span>© 2026 GRUPO HCGM, S.A. DE C.V.</span>
        </div>
      </main>
    </div>
  );
}

export function TerminosPage() {
  return <LegalDoc endpoint="terms" title="Términos y Condiciones de Uso"
                   subtitle="Contrato de prestación de servicios GDM Facturación" />;
}

export function PrivacidadPage() {
  return <LegalDoc endpoint="privacy-notice" title="Aviso de Privacidad Integral"
                   subtitle="Tratamiento de datos personales conforme a la LFPDPPP" />;
}
