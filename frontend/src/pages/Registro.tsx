/**
 * Registro.tsx — alta pública de PRUEBA (self-service). El prospecto captura sus
 * Datos Fiscales (SIN contraseña); el sistema crea la empresa de prueba + su admin
 * con una CONTRASEÑA TEMPORAL. Luego inicia sesión (correo precargado) y la cambia;
 * al entrar arranca la prueba de 72 h (sin timbrar real). Muestra la tarifa.
 */
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FileText, Building2, Mail, Loader2, ShieldCheck, Check, Copy, KeyRound } from 'lucide-react';
import api from '@/services/api';
import { GdmLogo } from '@/components/GdmLogo';

const REGIMENES: Array<[string, string]> = [
  ['601', '601 · General de Ley Personas Morales'],
  ['603', '603 · Personas Morales con Fines no Lucrativos'],
  ['605', '605 · Sueldos y Salarios'],
  ['606', '606 · Arrendamiento'],
  ['607', '607 · Enajenación o Adquisición de Bienes'],
  ['608', '608 · Demás ingresos'],
  ['610', '610 · Residentes en el Extranjero'],
  ['611', '611 · Ingresos por Dividendos'],
  ['612', '612 · Personas Físicas con Actividades Empresariales y Profesionales'],
  ['614', '614 · Ingresos por Intereses'],
  ['615', '615 · Régimen de los ingresos por obtención de premios'],
  ['616', '616 · Sin obligaciones fiscales'],
  ['620', '620 · Sociedades Cooperativas de Producción'],
  ['621', '621 · Incorporación Fiscal'],
  ['622', '622 · Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras'],
  ['623', '623 · Opcional para Grupos de Sociedades'],
  ['624', '624 · Coordinados'],
  ['625', '625 · Actividades Empresariales con ingresos por Plataformas Tecnológicas'],
  ['626', '626 · Régimen Simplificado de Confianza (RESICO)'],
];

const PRECIOS: Array<[string, string]> = [
  ['Usuario facturable (cualquier rol)', '$750 / mes'],
  ['Checador (kioscos + celulares)', '$0 — gratis, ilimitados'],
  ['Timbres incluidos', '1,000 / mes base · +500 por cada usuario adicional'],
  ['Timbre extra (excedente, +IVA)', 'desde $1.30 (1 usuario) · +$0.20 por usuario'],
  ['Contrato', 'MENSUAL · sin plazo forzoso (cancela cuando quieras)'],
];

export function RegistroPage() {
  const navigate = useNavigate();
  const [f, setF] = useState({ razonSocial: '', rfc: '', cp: '', regimen: '601', correo: '', nombre: '', telefono: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creada, setCreada] = useState<{ correo: string; passwordTemporal: string } | null>(null);
  const set = (k: string) => (e: any) => setF((p) => ({ ...p, [k]: e.target.value }));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r: any = await api.registrarPrueba({
        rfc: f.rfc, razonSocial: f.razonSocial, cp: f.cp, regimen: f.regimen,
        correo: f.correo, nombre: f.nombre || undefined, telefono: f.telefono || undefined,
      });
      const d = r?.data;
      if (d?.passwordTemporal) setCreada({ correo: d.correo, passwordTemporal: d.passwordTemporal });
      else setError('No se pudo crear la cuenta.');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'No se pudo crear la cuenta.');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6 flex items-center gap-3">
          <GdmLogo size={52} className="shadow-md rounded-full shrink-0" />
          <div>
            <h1 className="text-3xl font-bold text-slate-900 leading-tight">Crea tu cuenta</h1>
            <p className="text-slate-500 text-sm"><b>72 horas gratis</b> para explorar — 1 RFC, sin tarjeta. · GRUPO HCGM</p>
          </div>
        </div>

        {creada ? (
          <PantallaCreada creada={creada} onEntrar={() => navigate('/login', { state: { email: creada.correo } })} />
        ) : (
          <form onSubmit={enviar} className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="bg-slate-800 px-6 py-4 flex items-center gap-3">
              <span className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center"><FileText size={18} className="text-white" /></span>
              <h2 className="text-white font-semibold text-lg">Datos de Facturación</h2>
            </div>
            <div className="h-1 bg-gradient-to-r from-sky-400 to-emerald-400" />

            <div className="p-6 grid sm:grid-cols-2 gap-4">
              <label className="block sm:col-span-2"><span className="text-sm text-slate-600 flex items-center gap-1.5 mb-1"><Building2 size={14} /> Nombre / Razón Social <span className="text-rose-500">*</span></span>
                <input value={f.razonSocial} onChange={set('razonSocial')} required className="input w-full" placeholder="GRUPO HCGM S.A. DE C.V." /></label>
              <label className="block"><span className="text-sm text-slate-600 flex items-center gap-1.5 mb-1"><FileText size={14} /> RFC <span className="text-rose-500">*</span></span>
                <input value={f.rfc} onChange={set('rfc')} required maxLength={13} className="input w-full font-mono uppercase" placeholder="XAXX010101000" /></label>
              <label className="block"><span className="text-sm text-slate-600 flex items-center gap-1.5 mb-1"><FileText size={14} /> Código Postal <span className="text-rose-500">*</span></span>
                <input value={f.cp} onChange={set('cp')} required maxLength={5} className="input w-full font-mono" placeholder="20126" /></label>
              <label className="block sm:col-span-2"><span className="text-sm text-slate-600 flex items-center gap-1.5 mb-1"><FileText size={14} /> Régimen Fiscal <span className="text-rose-500">*</span></span>
                <select value={f.regimen} onChange={set('regimen')} className="input w-full">
                  {REGIMENES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></label>
              <label className="block sm:col-span-2"><span className="text-sm text-slate-600 flex items-center gap-1.5 mb-1"><Mail size={14} /> Correo de contacto <span className="text-rose-500">*</span></span>
                <input type="email" value={f.correo} onChange={set('correo')} required className="input w-full" placeholder="tucorreo@empresa.com" />
                <span className="text-xs text-slate-400">A este correo llegarán tus facturas y será tu usuario de acceso.</span></label>
            </div>

            {error && <p className="mx-6 mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</p>}

            <div className="px-6 pb-6">
              <button type="submit" disabled={busy}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-sky-500 to-emerald-500 text-white font-semibold px-4 py-3 rounded-xl hover:opacity-95 disabled:opacity-50">
                {busy ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />} Crear mi cuenta de prueba
              </button>
              <p className="text-center text-sm text-slate-500 mt-3">¿Ya tienes cuenta? <Link to="/login" className="text-sky-600 font-medium hover:underline">Inicia sesión</Link></p>
            </div>
          </form>
        )}

        {/* Tarifa (para que sepan el costo desde el inicio) */}
        <div className="mt-8">
          <p className="text-slate-600 mb-3">La misma tarifa para una empresa de <b>1 usuario o de 100</b> (sin descuentos por tamaño). Los timbres incluidos crecen con tus usuarios.</p>
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-blue-900 text-white"><th className="text-left px-4 py-2.5 font-semibold">Concepto</th><th className="text-left px-4 py-2.5 font-semibold">Valor</th></tr></thead>
              <tbody className="divide-y">
                {PRECIOS.map(([c, v], i) => (
                  <tr key={i} className={i % 2 ? 'bg-slate-50/60' : ''}>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{c}</td>
                    <td className="px-4 py-2.5 text-slate-600">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-3 flex items-center gap-1.5"><Check size={13} className="text-emerald-500" /> Para seguir usándolo después de la prueba, firma el contrato con tu e.firma. Sin plazo forzoso.</p>
        </div>
      </div>
    </div>
  );
}

/** Pantalla de éxito: muestra la contraseña temporal y manda a iniciar sesión. */
function PantallaCreada({ creada, onEntrar }: { creada: { correo: string; passwordTemporal: string }; onEntrar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(creada.passwordTemporal); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* noop */ }
  };
  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 text-center">
      <div className="mx-auto mb-3 w-14 h-14 rounded-full bg-emerald-50 grid place-items-center"><ShieldCheck className="text-emerald-600" size={28} /></div>
      <h2 className="text-2xl font-bold text-slate-900">¡Cuenta creada!</h2>
      <p className="text-slate-600 mt-2 text-sm">Inicia sesión con tu correo y esta <b>contraseña temporal</b>. Al entrar te pediremos cambiarla, y ahí arrancan tus <b>72 horas</b>.</p>

      <div className="mt-4 text-left bg-slate-50 border rounded-xl p-4 space-y-2">
        <div><span className="text-xs text-slate-400">Correo (usuario)</span><p className="font-mono text-slate-800">{creada.correo}</p></div>
        <div>
          <span className="text-xs text-slate-400 flex items-center gap-1"><KeyRound size={12} /> Contraseña temporal</span>
          <div className="flex items-center gap-2">
            <p className="font-mono text-lg font-bold text-slate-900 tracking-wide">{creada.passwordTemporal}</p>
            <button onClick={copiar} className="text-sky-600 hover:text-sky-700 text-xs inline-flex items-center gap-1"><Copy size={13} /> {copiado ? 'Copiado' : 'Copiar'}</button>
          </div>
        </div>
      </div>

      <button onClick={onEntrar} className="mt-5 w-full bg-gradient-to-r from-sky-500 to-emerald-500 text-white font-semibold px-4 py-3 rounded-xl hover:opacity-95">
        Ir a iniciar sesión
      </button>
      <p className="text-xs text-slate-400 mt-3">Anota tu contraseña temporal; la cambiarás en el primer acceso.</p>
    </div>
  );
}

export default RegistroPage;
