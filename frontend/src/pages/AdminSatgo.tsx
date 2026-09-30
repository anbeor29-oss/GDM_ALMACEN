/**
 * Super-Admin → SatGo (proveedor fiscal).
 *
 * Conecta la cuenta de SatGo: (1) URL base de la API, (2) canjea el token del
 * portal por una API Key PERMANENTE (CreateKey), que se guarda cifrada. De ahí
 * NEXO genera tokens cortos solo. Por RFC usa la clave CIEC de cada empresa.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cloud, Save, KeyRound, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

export function AdminSatgoPage() {
  const { user } = useAuthStore();
  const cfgQ = useQuery({ queryKey: ['satgo-config'], queryFn: () => api.getSatgoConfig() });
  const cfg = cfgQ.data?.data;
  const [baseUrl, setBaseUrl] = useState('');
  const [ambiente, setAmbiente] = useState('PRUEBAS');
  const [portalToken, setPortalToken] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  if (user?.role !== 'SUPER_ADMIN') {
    return <div className="bg-amber-50 border border-amber-200 text-amber-900 p-6 rounded-lg">
      <p className="font-semibold">Acceso restringido</p><p className="text-sm">Requiere rol SUPER_ADMIN.</p></div>;
  }

  const guardarUrl = async () => {
    setBusy('url'); setMsg('');
    try { await api.setSatgoConfig({ baseUrl: baseUrl.trim() || undefined, ambiente }); await cfgQ.refetch(); setBaseUrl(''); setMsg('Configuración guardada.'); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo guardar.'); }
    finally { setBusy(''); }
  };
  const bootstrap = async () => {
    setBusy('boot'); setMsg('');
    try { await api.bootstrapSatgo(portalToken.trim()); await cfgQ.refetch(); setPortalToken(''); setMsg('API Key permanente obtenida y guardada (cifrada).'); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo obtener la API Key.'); }
    finally { setBusy(''); }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3"><Cloud size={28} className="text-sky-600" /> SatGo (proveedor fiscal)</h1>
        <p className="text-gray-600 mt-1">Conecta la cuenta de SatGo para CIF/CSF, Opinión 32-D, OC IMSS, Declaraciones e Info Fiscal por RFC.</p>
      </div>

      <div className="bg-white border rounded-lg p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 text-sm">
          {cfg?.tieneKey ? <CheckCircle2 size={18} className="text-emerald-600" /> : <AlertTriangle size={18} className="text-amber-500" />}
          <span>{cfg?.tieneKey ? 'API Key configurada' : 'Falta la API Key'}</span>
        </div>
        <span className="text-xs text-gray-500">URL base: <span className="font-mono">{cfg?.baseUrl || '—'}</span> · Ambiente: <b>{cfg?.ambiente}</b></span>
        {cfg && !cfg.bovedaLista && <span className="text-xs text-rose-600 flex items-center gap-1"><AlertTriangle size={13} /> Falta SAT_VAULT_KEY en el servidor.</span>}
      </div>

      <div className="bg-white border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold text-gray-800">1 · URL base de la API</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block flex-1 min-w-[16rem]"><span className="text-xs text-gray-600 block mb-1">URL base (de «API &amp; Consultas» de SatGo)</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={cfg?.baseUrl || 'https://api.sat-go.com'} className="input py-1.5 text-sm w-full font-mono" /></label>
          <label className="block"><span className="text-xs text-gray-600 block mb-1">Ambiente</span>
            <select value={ambiente} onChange={(e) => setAmbiente(e.target.value)} className="input py-1.5 text-sm">
              <option value="PRUEBAS">Pruebas</option><option value="PRODUCCION">Producción</option>
            </select></label>
          <button onClick={guardarUrl} disabled={busy === 'url'} className="bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm inline-flex items-center gap-1.5">
            {busy === 'url' ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Guardar
          </button>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold text-gray-800">2 · Obtener la API Key permanente</h2>
        <p className="text-xs text-gray-500">Pega el <b>token del portal</b> de SatGo (de «API &amp; Consultas» → Access Token). NEXO lo canjea por una <b>API Key permanente</b> (CreateKey) y la guarda <b>cifrada</b>; el token del portal no se conserva. Hazlo una vez.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block flex-1 min-w-[20rem]"><span className="text-xs text-gray-600 block mb-1">Token del portal (Access Token)</span>
            <input value={portalToken} onChange={(e) => setPortalToken(e.target.value)} placeholder="eyJhbGciOiJ…" className="input py-1.5 text-xs w-full font-mono" type="password" /></label>
          <button onClick={bootstrap} disabled={busy === 'boot' || !portalToken.trim()} className="bg-sky-600 text-white px-4 py-2 rounded-lg hover:bg-sky-700 disabled:opacity-50 text-sm inline-flex items-center gap-1.5">
            {busy === 'boot' ? <Loader2 className="animate-spin" size={15} /> : <KeyRound size={15} />} Obtener API Key
          </button>
        </div>
      </div>

      {msg && <p className="text-sm bg-gray-50 border rounded px-3 py-2 text-gray-700">{msg}</p>}
      <p className="text-xs text-gray-500 flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
        Por RFC, la consulta usa la <b>clave CIEC</b> de cada empresa (Contabilidad → Opinión de Cumplimiento → Configurar → credencial). El acceso FIEL vía SatGo queda pendiente.</p>
    </div>
  );
}

export default AdminSatgoPage;
