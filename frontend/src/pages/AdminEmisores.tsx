/**
 * Súper Admin → «Emisor de facturas».
 *
 * Define qué empresa(s) emiten los CFDI de cobro a los usuarios (GRUPO HCGM, y se
 * puede tener más de una), con una marcada como PREDETERMINADA. Por emisora se
 * configura su correo (SMTP, p. ej. facturas@hcgm.com.mx) y los datos del depósito
 * bancario que se le muestran al cliente. Reemplaza el candado por la variable de
 * entorno PLATFORM_COMPANY_RFC (que queda como respaldo).
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Mail, Landmark, Star, Check, Loader2, Send, Save, AlertTriangle } from 'lucide-react';
import api from '@/services/api';

type Tab = 'emisoras' | 'smtp' | 'deposito';
const TABS: Array<{ k: Tab; label: string; icon: any; color: string }> = [
  { k: 'emisoras', label: 'Emisoras', icon: Building2, color: 'bg-sky-100 text-sky-700 border-sky-200' },
  { k: 'smtp', label: 'Correo (SMTP)', icon: Mail, color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { k: 'deposito', label: 'Depósito', icon: Landmark, color: 'bg-amber-100 text-amber-700 border-amber-200' },
];

export function AdminEmisoresPage() {
  const [tab, setTab] = useState<Tab>('emisoras');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const q = useQuery({ queryKey: ['emisores'], queryFn: () => api.getEmisores() });
  const data = q.data?.data;
  const emisoras: any[] = data?.emisoras || [];
  const candidatas: any[] = data?.candidatas || [];
  const envRfc: string | null = data?.envRfc || null;

  const flash = (ok: string, bad = '') => { setMsg(ok); setErr(bad); if (ok) setTimeout(() => setMsg(''), 4000); };
  const refrescar = () => q.refetch();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Building2 className="text-sky-600" size={26} />
        <h1 className="text-2xl font-bold text-gray-800">Emisor de facturas</h1>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Empresas que emiten los CFDI de cobro a los usuarios (p. ej. <b>GRUPO HCGM</b>), su correo de envío y los datos
        de depósito que ve el cliente.
      </p>

      {/* Pestañas en pastillas de colores */}
      <div className="flex flex-wrap gap-2 mb-5">
        {TABS.map(({ k, label, icon: Ic }) => (
          <button key={k} onClick={() => { setTab(k); setErr(''); }}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
              tab === k ? 'bg-sky-600 text-white border-sky-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            <Ic size={15} /> {label}
          </button>
        ))}
      </div>

      {msg && <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</div>}
      {err && <div className="mb-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}

      {q.isLoading && <p className="text-gray-500 flex items-center gap-2"><Loader2 className="animate-spin" size={16} /> Cargando…</p>}

      {!q.isLoading && tab === 'emisoras' && (
        <EmisorasTab candidatas={candidatas} emisoras={emisoras} envRfc={envRfc} onChange={refrescar} flash={flash} />
      )}
      {!q.isLoading && tab === 'smtp' && (
        <SmtpTab emisoras={emisoras} onChange={refrescar} flash={flash} />
      )}
      {!q.isLoading && tab === 'deposito' && (
        <DepositoTab emisoras={emisoras} onChange={refrescar} flash={flash} />
      )}
    </div>
  );
}

/* ── Pestaña 1: qué empresas son emisoras + cuál es la predeterminada ── */
function EmisorasTab({ candidatas, emisoras, envRfc, onChange, flash }: any) {
  const [busy, setBusy] = useState('');
  const marcar = async (c: any, esEmisor: boolean, predeterminado: boolean) => {
    setBusy(c.id);
    try { await api.setEmisor(c.id, { esEmisor, predeterminado }); flash('Guardado.'); onChange(); }
    catch (e: any) { flash('', e?.response?.data?.message || 'No se pudo guardar.'); }
    finally { setBusy(''); }
  };

  return (
    <div className="space-y-4">
      {emisoras.length === 0 && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Aún no hay ninguna emisora marcada.{envRfc
            ? <> Mientras tanto se usa la del entorno <code className="font-mono">{envRfc}</code> como respaldo.</>
            : <> El cobro automático no emitirá CFDI hasta que marques una.</>}</span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-left">
              <th className="px-4 py-2.5">Empresa</th>
              <th className="px-3 py-2.5">RFC</th>
              <th className="px-3 py-2.5 text-center">CSD</th>
              <th className="px-3 py-2.5 text-center">SMTP</th>
              <th className="px-3 py-2.5 text-center">Emisora</th>
              <th className="px-3 py-2.5 text-center">Predeterminada</th>
            </tr>
          </thead>
          <tbody>
            {candidatas.map((c: any) => {
              const em = emisoras.find((e: any) => e.id === c.id);
              const esEmisor = !!em;
              const predet = !!em?.predeterminado;
              return (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{c.business_name}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{c.rfc}</td>
                  <td className="px-3 py-2.5 text-center">{em ? (em.tiene_csd ? <Check className="inline text-emerald-600" size={16} /> : <span className="text-rose-500 text-xs">falta</span>) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2.5 text-center">{em ? (em.tiene_smtp ? <Check className="inline text-emerald-600" size={16} /> : <span className="text-amber-600 text-xs">—</span>) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2.5 text-center">
                    <input type="checkbox" checked={esEmisor} disabled={busy === c.id}
                      onChange={(e) => marcar(c, e.target.checked, e.target.checked && predet)} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button disabled={!esEmisor || busy === c.id}
                      onClick={() => marcar(c, true, !predet)}
                      title={esEmisor ? 'Marcar como predeterminada' : 'Primero márcala como emisora'}
                      className={`inline-flex items-center gap-1 ${predet ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'} disabled:opacity-40`}>
                      <Star size={18} fill={predet ? 'currentColor' : 'none'} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        Una emisora es una empresa de NEXO con su <b>CSD</b> cargado. La <b>predeterminada</b> (★) es la que cobra a los
        usuarios; puedes tener varias y cambiarla cuando quieras.
      </p>
    </div>
  );
}

/* ── Pestaña 2: SMTP por emisora ── */
function SmtpTab({ emisoras, onChange, flash }: any) {
  const [sel, setSel] = useState<string>(emisoras[0]?.id || '');
  const em = emisoras.find((e: any) => e.id === sel);
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState('');

  useEffect(() => {
    setF({
      mail_host: em?.mail_host || '', mail_port: em?.mail_port || 587,
      mail_secure: !!em?.mail_secure, mail_user: em?.mail_user || '',
      mail_from: em?.mail_from || '', mail_pass: '',
    });
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  if (emisoras.length === 0) return <SinEmisoras />;
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  const guardar = async () => {
    setBusy(true);
    try { await api.setEmisorSmtp(sel, f); flash('Correo (SMTP) guardado.'); onChange(); }
    catch (e: any) { flash('', e?.response?.data?.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };
  const probar = async () => {
    setBusy(true);
    try { const r = await api.testEmisorSmtp(sel, testTo || undefined); flash(r?.message || 'Prueba enviada.'); }
    catch (e: any) { flash('', e?.response?.data?.message || 'No se pudo enviar la prueba.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <SelectorEmisora emisoras={emisoras} sel={sel} setSel={setSel} />
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        <Campo label="Servidor (host)"><input className="input" value={f.mail_host || ''} onChange={(e) => set('mail_host', e.target.value)} placeholder="mail.hcgm.com.mx" /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Puerto"><input className="input" type="number" value={f.mail_port || ''} onChange={(e) => set('mail_port', Number(e.target.value))} placeholder="587" /></Campo>
          <Campo label="Seguridad">
            <select className="input" value={f.mail_secure ? '1' : '0'} onChange={(e) => set('mail_secure', e.target.value === '1')}>
              <option value="0">STARTTLS (587)</option>
              <option value="1">SSL/TLS (465)</option>
            </select>
          </Campo>
        </div>
        <Campo label="Usuario"><input className="input" value={f.mail_user || ''} onChange={(e) => set('mail_user', e.target.value)} placeholder="facturas@hcgm.com.mx" /></Campo>
        <Campo label="Contraseña"><input className="input" type="password" value={f.mail_pass || ''} onChange={(e) => set('mail_pass', e.target.value)} placeholder={em?.tiene_smtp ? '•••••• (se conserva si lo dejas vacío)' : ''} /></Campo>
        <Campo label="Remitente (From)"><input className="input" value={f.mail_from || ''} onChange={(e) => set('mail_from', e.target.value)} placeholder="GRUPO HCGM <facturas@hcgm.com.mx>" /></Campo>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button onClick={guardar} disabled={busy} className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-50">
            {busy ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Guardar
          </button>
          <input className="input flex-1 min-w-[180px]" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="correo para la prueba (opcional)" />
          <button onClick={probar} disabled={busy} className="inline-flex items-center gap-1.5 border border-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">
            <Send size={15} /> Enviar prueba
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Pestaña 3: datos del depósito por emisora ── */
function DepositoTab({ emisoras, onChange, flash }: any) {
  const [sel, setSel] = useState<string>(emisoras[0]?.id || '');
  const em = emisoras.find((e: any) => e.id === sel);
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setF({
      deposito_banco: em?.deposito_banco || '', deposito_titular: em?.deposito_titular || '',
      deposito_clabe: em?.deposito_clabe || '', deposito_cuenta: em?.deposito_cuenta || '',
      deposito_referencia: em?.deposito_referencia || '', deposito_notas: em?.deposito_notas || '',
    });
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  if (emisoras.length === 0) return <SinEmisoras />;
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  const guardar = async () => {
    setBusy(true);
    try { await api.setEmisorDeposito(sel, f); flash('Datos de depósito guardados.'); onChange(); }
    catch (e: any) { flash('', e?.response?.data?.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <SelectorEmisora emisoras={emisoras} sel={sel} setSel={setSel} />
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Banco"><input className="input" value={f.deposito_banco || ''} onChange={(e) => set('deposito_banco', e.target.value)} placeholder="BBVA" /></Campo>
          <Campo label="Titular"><input className="input" value={f.deposito_titular || ''} onChange={(e) => set('deposito_titular', e.target.value)} placeholder="GRUPO HCGM S.A. DE C.V." /></Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="CLABE (18 dígitos)"><input className="input" inputMode="numeric" maxLength={18} value={f.deposito_clabe || ''} onChange={(e) => set('deposito_clabe', e.target.value.replace(/\D/g, ''))} placeholder="012150000000000000" /></Campo>
          <Campo label="No. de cuenta"><input className="input" value={f.deposito_cuenta || ''} onChange={(e) => set('deposito_cuenta', e.target.value)} placeholder="0000000000" /></Campo>
        </div>
        <Campo label="Referencia / concepto sugerido"><input className="input" value={f.deposito_referencia || ''} onChange={(e) => set('deposito_referencia', e.target.value)} placeholder="RFC del cliente + mes" /></Campo>
        <Campo label="Notas (opcional)"><textarea className="input" rows={2} value={f.deposito_notas || ''} onChange={(e) => set('deposito_notas', e.target.value)} placeholder="Instrucciones adicionales para el cliente." /></Campo>
        <button onClick={guardar} disabled={busy} className="inline-flex items-center gap-1.5 bg-amber-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-amber-700 disabled:opacity-50">
          {busy ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Guardar
        </button>
      </div>
    </div>
  );
}

function SelectorEmisora({ emisoras, sel, setSel }: any) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-500">Emisora:</span>
      <select className="input max-w-sm" value={sel} onChange={(e) => setSel(e.target.value)}>
        {emisoras.map((e: any) => (
          <option key={e.id} value={e.id}>{e.business_name} · {e.rfc}{e.predeterminado ? ' ★' : ''}</option>
        ))}
      </select>
    </div>
  );
}

function SinEmisoras() {
  return (
    <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2 max-w-xl">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>Primero marca al menos una empresa como <b>emisora</b> en la pestaña «Emisoras».</span>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: any }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

export default AdminEmisoresPage;
