/**
 * Registro.tsx — alta pública de PRUEBA (self-service). El prospecto captura sus
 * Datos Fiscales + contraseña y entra de inmediato con 72 h para explorar (1 RFC,
 * sin timbrar real). Muestra la tarifa (para que sepa el costo) y, al enviar,
 * crea la empresa de prueba y auto-entra. Después de los 3 días se bloquea salvo
 * que firme el contrato con su e.firma.
 */
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FileText, Building2, Mail, Lock, Loader2, ShieldCheck, Check } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

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
  ['625', '625 · Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas'],
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
  const { login } = useAuthStore();
  const [f, setF] = useState({ razonSocial: '', rfc: '', cp: '', regimen: '601', correo: '', password: '', password2: '', nombre: '', telefono: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string) => (e: any) => setF((p) => ({ ...p, [k]: e.target.value }));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (f.password !== f.password2) { setError('Las contraseñas no coinciden.'); return; }
    if (f.password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return; }
    setBusy(true);
    try {
      const r: any = await api.registrarPrueba({
        rfc: f.rfc, razonSocial: f.razonSocial, cp: f.cp, regimen: f.regimen,
        correo: f.correo, password: f.password, nombre: f.nombre || undefined, telefono: f.telefono || undefined,
      });
      const d = r?.data;
      if (d?.token) {
        login(d.user, d.token, d.refreshToken);
        navigate('/dashboard');
      } else { setError('No se pudo crear la cuenta.'); }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'No se pudo crear la cuenta.');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-4xl font-bold text-slate-900">Crea tu cuenta</h1>
          <p className="text-slate-500 mt-1">
            <b>72 horas gratis</b> para explorar el sistema — 1 RFC, sin tarjeta. Captura tus datos fiscales y entra.
          </p>
        </div>

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
            <label className="block"><span className="text-sm text-slate-600 flex items-center gap-1.5 mb-1"><Lock size={14} /> Contraseña <span className="text-rose-500">*</span></span>
              <input type="password" value={f.password} onChange={set('password')} required minLength={8} className="input w-full" placeholder="mínimo 8 caracteres" /></label>
            <label className="block"><span className="text-sm text-slate-600 flex items-center gap-1.5 mb-1"><Lock size={14} /> Repite la contraseña <span className="text-rose-500">*</span></span>
              <input type="password" value={f.password2} onChange={set('password2')} required className="input w-full" /></label>
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

export default RegistroPage;
