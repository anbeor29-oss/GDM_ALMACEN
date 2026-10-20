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
import { Building2, Mail, Landmark, Star, Check, Loader2, Send, Save, AlertTriangle, Plus, KeyRound, X, Upload } from 'lucide-react';
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
  const [showNueva, setShowNueva] = useState(false);
  const [csdTarget, setCsdTarget] = useState<any>(null);
  /* Por omisión se muestran SÓLO las empresas marcadas como emisoras (para no
   * llenar la pantalla con todas); un toggle revela el resto para marcar una nueva. */
  const [verTodas, setVerTodas] = useState(false);
  const filas = verTodas ? candidatas : candidatas.filter((c: any) => emisoras.some((e: any) => e.id === c.id));
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

      <div className="flex justify-between items-center gap-2">
        <button onClick={() => setVerTodas((v) => !v)}
          className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50">
          {verTodas ? 'Mostrar sólo emisoras' : 'Mostrar todas las empresas (para marcar una)'}
        </button>
        <button onClick={() => setShowNueva((v) => !v)}
          className="inline-flex items-center gap-1.5 bg-sky-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-sky-700">
          <Plus size={15} /> Nueva empresa emisora
        </button>
      </div>
      {showNueva && <NuevaEmisora onDone={() => { setShowNueva(false); onChange(); }} flash={flash} />}

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
            {filas.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400 italic">Sin emisoras marcadas. Usa «Mostrar todas» para marcar una, o «Nueva empresa emisora».</td></tr>
            )}
            {filas.map((c: any) => {
              const em = emisoras.find((e: any) => e.id === c.id);
              const esEmisor = !!em;
              const predet = !!em?.predeterminado;
              return (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{c.business_name}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{c.rfc}</td>
                  <td className="px-3 py-2.5 text-center">
                    {!em ? <span className="text-gray-300">—</span>
                      : em.tiene_csd ? <Check className="inline text-emerald-600" size={16} />
                      : <button onClick={() => setCsdTarget(c)} className="text-xs text-sky-600 hover:underline inline-flex items-center gap-1"><Upload size={12} /> Cargar</button>}
                  </td>
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
        usuarios; puedes tener varias y cambiarla cuando quieras. Captura una emisora nueva aquí o desde <b>Empresas</b>;
        su contabilidad vive en NEXO como cualquier empresa.
      </p>

      {csdTarget && (
        <CsdUploader company={csdTarget} onClose={() => setCsdTarget(null)}
          onDone={() => { setCsdTarget(null); flash('CSD cargado.'); onChange(); }} />
      )}
    </div>
  );
}

/* Alta rápida de una empresa emisora (razón social + datos fiscales mínimos).
 * Crea la empresa y la marca como emisora; su CSD se carga con «Cargar» en la fila. */
function NuevaEmisora({ onDone, flash }: any) {
  const [f, setF] = useState<any>({ businessName: '', rfc: '', fiscalRegime: '601', postalCode: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF((p: any) => ({ ...p, [k]: e.target.value }));
  const REGIMENES = ['601', '603', '605', '606', '612', '620', '621', '622', '626', '628'];

  const crear = async () => {
    if (!f.businessName.trim() || !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(f.rfc.trim())) {
      flash('', 'Captura razón social y un RFC válido.'); return;
    }
    setBusy(true);
    try {
      const r: any = await api.adminCreateCompany({
        businessName: f.businessName.trim(), rfc: f.rfc.trim().toUpperCase(),
        fiscalRegime: f.fiscalRegime, postalCode: f.postalCode.trim() || undefined,
      });
      const id = r?.data?.id || r?.data?.company?.id || r?.id;
      if (id) await api.setEmisor(id, { esEmisor: true, predeterminado: false });
      flash('Empresa emisora creada. Ahora carga su CSD con «Cargar» en su fila.');
      onDone();
    } catch (e: any) {
      flash('', e?.response?.data?.message || 'No se pudo crear la empresa.');
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-sky-800">Nueva empresa emisora</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Campo label="Razón social"><input className="input" value={f.businessName} onChange={set('businessName')} placeholder="RAZÓN SOCIAL S.A. DE C.V." /></Campo>
        <Campo label="RFC"><input className="input font-mono uppercase" maxLength={13} value={f.rfc} onChange={set('rfc')} placeholder="XAXX010101000" /></Campo>
        <Campo label="Régimen fiscal">
          <select className="input" value={f.fiscalRegime} onChange={set('fiscalRegime')}>
            {REGIMENES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Campo>
        <Campo label="Código postal"><input className="input font-mono" maxLength={5} value={f.postalCode} onChange={set('postalCode')} placeholder="20126" /></Campo>
      </div>
      <button onClick={crear} disabled={busy} className="inline-flex items-center gap-1.5 bg-sky-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-sky-700 disabled:opacity-50">
        {busy ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />} Crear y marcar como emisora
      </button>
      <p className="text-[11px] text-gray-500">Luego carga su <b>CSD</b> (.cer + .key) con el botón «Cargar» de su fila para que pueda timbrar.</p>
    </div>
  );
}

/* Carga el CSD (.cer + .key + contraseña) de una emisora; reusa inspect + upload
 * del panel de Empresas (el .cer trae No. de certificado y vigencia). */
function CsdUploader({ company, onClose, onDone }: any) {
  const [cerFile, setCerFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [pwd, setPwd] = useState('');
  const [cert, setCert] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const fileToB64 = async (file: File): Promise<string> => {
    const buf = new Uint8Array(await file.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  };

  const inspect = async (cer: File | null, key: File | null, p: string) => {
    if (!cer) { setCert(null); return; }
    setErr('');
    try {
      const r: any = await api.adminInspectCSD(company.id, {
        cerBase64: await fileToB64(cer),
        keyBase64: key && p ? await fileToB64(key) : undefined,
        keyPassword: key && p ? p : undefined,
      });
      setCert(r.data);
    } catch (e: any) { setCert(null); setErr(e?.response?.data?.message || e?.message); }
  };

  const subir = async () => {
    if (!cerFile || !keyFile || !pwd) { setErr('Selecciona el .cer, el .key y la contraseña.'); return; }
    setBusy(true); setErr('');
    try {
      await api.adminUploadCSD(company.id, {
        noCertificado: cert?.no_certificado || '',
        cerBase64: await fileToB64(cerFile),
        keyBase64: await fileToB64(keyFile),
        keyPassword: pwd,
        validFrom: (cert?.valid_from || '').slice(0, 10) || undefined,
        validTo: (cert?.valid_to || '').slice(0, 10) || undefined,
      });
      onDone();
    } catch (e: any) { setErr(e?.response?.data?.message || e?.message || 'No se pudo cargar el CSD.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-semibold text-gray-700 flex items-center gap-2"><KeyRound size={16} /> Cargar CSD · {company.business_name}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <Campo label="Archivo .cer (público)">
            <input type="file" accept=".cer" className="text-sm"
              onChange={(e) => { const fFile = e.target.files?.[0] || null; setCerFile(fFile); inspect(fFile, keyFile, pwd); }} />
          </Campo>
          <Campo label="Archivo .key (privado)">
            <input type="file" accept=".key" className="text-sm"
              onChange={(e) => { const fFile = e.target.files?.[0] || null; setKeyFile(fFile); inspect(cerFile, fFile, pwd); }} />
          </Campo>
          <Campo label="Contraseña del .key">
            <input type="password" className="input" value={pwd}
              onChange={(e) => setPwd(e.target.value)} onBlur={() => inspect(cerFile, keyFile, pwd)} />
          </Campo>
          {cert && (
            <div className="text-xs bg-gray-50 border rounded-lg p-2.5 space-y-0.5 text-gray-600">
              <p>No. certificado: <b className="font-mono">{cert.no_certificado}</b></p>
              <p>Vigencia: {(cert.valid_from || '').slice(0, 10)} → {(cert.valid_to || '').slice(0, 10)}</p>
              <p>RFC del .cer: <b className="font-mono">{cert.rfc || '—'}</b> {cert.rfc_matches ? <span className="text-emerald-600">✓ coincide</span> : <span className="text-rose-600">✗ no coincide con {cert.company_rfc}</span>}</p>
              {cert.key_matches === false && <p className="text-rose-600">La .key o la contraseña no corresponden al .cer.</p>}
              {cert.expired && <p className="text-rose-600">⚠ El certificado está vencido.</p>}
            </div>
          )}
          {err && <p className="text-sm text-rose-600">{err}</p>}
          <button onClick={subir} disabled={busy || !cerFile || !keyFile || !pwd}
            className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-50">
            {busy ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />} Cargar CSD
          </button>
        </div>
      </div>
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
