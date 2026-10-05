/**
 * Super-Admin → SatGo (proveedor fiscal).
 *
 * Conecta la cuenta de SatGo: (1) URL base de la API, (2) canjea el token del
 * portal por una API Key PERMANENTE (CreateKey), que se guarda cifrada. De ahí
 * NEXO genera tokens cortos solo. Por RFC usa la clave CIEC de cada empresa.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cloud, Save, KeyRound, CheckCircle2, AlertTriangle, Loader2, Landmark, BarChart3 } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

/** Tarjeta de un conector externo (SAT, Banco de México, INEGI). */
function Conector({ icon, nombre, ok, detalle, nota }: {
  icon: ReactNode; nombre: string; ok: boolean; detalle?: string; nota?: string;
}) {
  return (
    <div className="border rounded-lg p-4 bg-white flex items-start gap-3">
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-800">{nombre}</span>
          {ok
            ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><CheckCircle2 size={12} /> Conectado</span>
            : <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"><AlertTriangle size={12} /> Falta configurar</span>}
        </div>
        {detalle && <p className="text-xs text-gray-600 mt-1">{detalle}</p>}
        {nota && <p className="text-[11px] text-gray-400 mt-0.5">{nota}</p>}
      </div>
    </div>
  );
}

export function AdminSatgoPage() {
  const { user } = useAuthStore();
  const cfgQ = useQuery({ queryKey: ['satgo-config'], queryFn: () => api.getSatgoConfig() });
  const cfg = cfgQ.data?.data;
  const conQ = useQuery({ queryKey: ['conectores-estado'], queryFn: () => api.getConectoresEstado() });
  const con = conQ.data?.data as any;
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
        <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3"><Cloud size={28} className="text-sky-600" /> Conector fiscal</h1>
        <p className="text-gray-600 mt-1">Conecta el servicio fiscal para CIF/CSF, Opinión 32-D, IMSS, Declaraciones e Información Fiscal por RFC.</p>
      </div>

      {/* ── Tablero de conectores externos ──
          Todos los servicios de los que depende NEXO en un solo lugar, para
          notar al vuelo si alguno cambia o deja de responder. */}
      <div className="space-y-2">
        <h2 className="font-semibold text-gray-800">Conectores de datos</h2>
        <p className="text-xs text-gray-500 -mt-1">Servicios externos que alimentan a NEXO. Vigila aquí si alguno cambia o deja de responder.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Conector
            icon={<Cloud size={20} className="text-sky-600" />}
            nombre="SAT (SatGo)"
            ok={!!con?.satgo?.token}
            detalle={con?.satgo ? `${con.satgo.baseUrl || 'sin URL'} · ${con.satgo.ambiente || '—'}` : (conQ.isLoading ? 'Cargando…' : '—')}
            nota="CIF/CSF, Opinión 32-D, IMSS, Declaraciones."
          />
          <Conector
            icon={<Landmark size={20} className="text-emerald-600" />}
            nombre="Banco de México"
            ok={!!con?.banxico?.token}
            detalle={
              con?.banxico?.usd
                ? `USD $${Number(con.banxico.usd.valor).toFixed(4)} (${con.banxico.usd.fecha})${con.banxico.usd.vigente ? '' : ' · arrastrado'}`
                : (con?.banxico?.ultimoError ? `Último error: ${con.banxico.ultimoError.detalle}` : 'Tipo de cambio FIX/DOF')
            }
            nota={con?.banxico?.token ? 'Tipo de cambio (Art. 20 CFF).' : 'Pon BANXICO_TOKEN en el servidor.'}
          />
          <Conector
            icon={<BarChart3 size={20} className="text-indigo-600" />}
            nombre="INEGI"
            ok={!!con?.inegi?.token}
            detalle={
              con?.inegi?.inpc
                ? `INPC ${String(con.inegi.inpc.mes).padStart(2, '0')}/${con.inegi.inpc.anio}: ${Number(con.inegi.inpc.valor).toFixed(3)}`
                : 'Índice Nacional de Precios (INPC)'
            }
            nota={con?.inegi?.token ? 'INPC: recargos, pérdidas, ajuste anual.' : 'Pon INEGI_TOKEN en el servidor.'}
          />
        </div>
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
          <label className="block flex-1 min-w-[16rem]"><span className="text-xs text-gray-600 block mb-1">URL base del servicio (de «API &amp; Consultas»)</span>
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
        <p className="text-xs text-gray-500">Pega el <b>token del portal</b> del proveedor (de «API &amp; Consultas» → Access Token). NEXO lo canjea por una <b>API Key permanente</b> y la guarda <b>cifrada</b>; el token del portal no se conserva. Hazlo una vez.</p>
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
        Por RFC, la consulta usa la <b>clave CIEC</b> de cada empresa (Contabilidad → Cumplimiento fiscal → Configurar). El IMSS va sólo por RFC (sin CIEC). El acceso FIEL queda pendiente.</p>
    </div>
  );
}

export default AdminSatgoPage;
