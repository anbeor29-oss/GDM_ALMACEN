/**
 * Super-Admin → Gestión de Empresas (multi-tenant).
 *   · Crear empresa con plan (iguala / renta), cap_timbres, monthly_fee
 *   · Subir CSD (.cer + .key + password) — cifrado en BD
 *   · Ver consumo del mes + facturación estimada
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Plus, FileKey, Trash2, X, ShieldCheck, ScanText, Upload,
  AlertTriangle, Loader2, Pencil, Save,
} from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

export function AdminCompaniesPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [csdTarget, setCsdTarget] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [editTarget, setEditTarget] = useState<any>(null);

  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 p-6 rounded-lg">
        <p className="font-semibold mb-1">Acceso restringido</p>
        <p className="text-sm">Esta sección requiere rol <b>SUPER_ADMIN</b>. Tu rol: <b>{user?.role}</b>.</p>
      </div>
    );
  }

  const q = useQuery({ queryKey: ['admin-companies'], queryFn: () => api.adminListCompanies() });
  const rows = q.data?.data?.companies || [];

  const delCsd = useMutation({
    mutationFn: (id: string) => api.adminDeleteCSD(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-companies'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <Building2 className="text-indigo-600" size={36}/> Empresas
          </h1>
          <p className="text-gray-600 mt-1">Empresas registradas en la plataforma SaaS, plan y sellos digitales.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg shadow">
          <Plus size={18}/> Nueva empresa
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">RFC</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Razón social</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Plan</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Cap / Usados</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">CSD</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Usuarios</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((c: any) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm font-mono">{c.rfc}</td>
                <td className="px-4 py-2 text-sm font-medium">{c.business_name}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-1 rounded font-medium ${
                    c.billing_plan==='iguala' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {c.billing_plan} · ${c.monthly_fee}
                  </span>
                </td>
                <td className="px-4 py-2 text-right text-sm">
                  <b>{c.facturas_mes}</b><span className="text-gray-400"> / {c.cap_timbres}</span>
                </td>
                <td className="px-4 py-2 text-center">
                  {c.has_csd ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-emerald-50 text-emerald-700 rounded border border-emerald-200">
                      <ShieldCheck size={12}/> cargado
                    </span>
                  ) : <span className="text-xs text-gray-400 italic">sin CSD</span>}
                </td>
                <td className="px-4 py-2 text-center text-sm">{c.users_active}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <button title="Editar datos generales y domicilio" onClick={() => setEditTarget(c)}
                      className="p-1.5 text-sky-600 hover:bg-sky-50 rounded"><Pencil size={16}/></button>
                    <button title="Cargar CSD" onClick={() => setCsdTarget(c)}
                      className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded"><FileKey size={16}/></button>
                    {c.has_csd && (
                      <button title="Revocar CSD" onClick={() => { if (confirm(`Revocar el CSD de ${c.rfc}?`)) delCsd.mutate(c.id); }}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"><Trash2 size={16}/></button>
                    )}
                    <button
                      title="Eliminar empresa completa (2 pasos)"
                      onClick={() => setDeleteTarget(c)}
                      className="p-1.5 text-rose-700 hover:bg-rose-100 rounded border border-transparent hover:border-rose-300"
                    >
                      <AlertTriangle size={16}/>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!q.isLoading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 italic">Sin empresas</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateCompanyModal onClose={()=>setShowCreate(false)}
          onDone={()=>{ setShowCreate(false); qc.invalidateQueries({ queryKey: ['admin-companies'] }); }}/>
      )}
      {csdTarget && (
        <CSDUploadModal company={csdTarget} onClose={()=>setCsdTarget(null)}
          onDone={()=>{ setCsdTarget(null); qc.invalidateQueries({ queryKey: ['admin-companies'] }); }}/>
      )}
      {deleteTarget && (
        <DangerDeleteModal
          company={deleteTarget}
          onClose={()=>setDeleteTarget(null)}
          onDone={()=>{ setDeleteTarget(null); qc.invalidateQueries({ queryKey: ['admin-companies'] }); }}
        />
      )}
      {editTarget && (
        <EditCompanyModal
          company={editTarget}
          onClose={()=>setEditTarget(null)}
          onDone={()=>{ setEditTarget(null); qc.invalidateQueries({ queryKey: ['admin-companies'] }); }}
          onOpenCsd={()=>{ const c = editTarget; setEditTarget(null); setCsdTarget(c); }}
        />
      )}
    </div>
  );
}

/* ─────────────── Modal: editar empresa (datos + domicilio + contacto) ─────────────── */

function EditCompanyModal({
  company, onClose, onDone, onOpenCsd,
}: {
  company: any;
  onClose: () => void;
  onDone: () => void;
  onOpenCsd: () => void;
}) {
  const [form, setForm] = useState({
    businessName: company.business_name || '',
    fiscalRegime: company.fiscal_regime || '601',
    postalCode:   company.postal_code || '',
    street:       company.street || '',
    extNumber:    company.ext_number || '',
    neighborhood: company.neighborhood || '',
    city:         company.city || '',
    municipality: company.municipality || '',
    state:        company.state || '',
    contactEmail: company.contact_email || '',
    phone:        company.phone || '',
    website:      company.website || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.businessName.trim()) { setError('La razón social es obligatoria'); return; }
    if (form.postalCode && !/^\d{5}$/.test(form.postalCode)) {
      setError('El CP debe ser de 5 dígitos'); return;
    }
    setBusy(true);
    try {
      await api.adminUpdateCompany(company.id, form);
      onDone();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  const F = ({ label, k, ph, span2 = false }: { label: string; k: keyof typeof form; ph?: string; span2?: boolean }) => (
    <label className={`block ${span2 ? 'col-span-2' : ''}`}>
      <span className="text-xs font-medium text-gray-600 block mb-1">{label}</span>
      <input
        value={form[k]}
        onChange={set(k)}
        placeholder={ph}
        className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-sky-100 rounded-lg flex items-center justify-center">
              <Pencil className="text-sky-700" size={20}/>
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Editar empresa</h2>
              <p className="text-xs text-slate-500 font-mono">{company.rfc}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={20}/></button>
        </div>

        <div className="p-5 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}

          {/* Datos generales */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-sky-700 mb-2">Datos generales</p>
            <div className="grid grid-cols-2 gap-3">
              <F label="Razón social *" k="businessName" span2 />
              <F label="Régimen fiscal (c_RegimenFiscal)" k="fiscalRegime" ph="601" />
              <F label="Código postal fiscal" k="postalCode" ph="20000" />
            </div>
          </div>

          {/* Domicilio */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-sky-700 mb-2">Domicilio</p>
            <div className="grid grid-cols-2 gap-3">
              <F label="Calle" k="street" />
              <F label="Número exterior" k="extNumber" />
              <F label="Colonia" k="neighborhood" />
              <F label="Ciudad / Localidad" k="city" />
              <F label="Municipio" k="municipality" />
              <F label="Estado" k="state" />
            </div>
          </div>

          {/* Contacto */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-sky-700 mb-2">Contacto</p>
            <div className="grid grid-cols-2 gap-3">
              <F label="Email de contacto (correos del sistema)" k="contactEmail" ph="facturas@empresa.mx" />
              <F label="Teléfono" k="phone" />
              <F label="Sitio web" k="website" ph="https://…" span2 />
            </div>
          </div>

          {/* Sellos */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 flex items-center justify-between">
            <div className="text-xs text-indigo-900">
              <p className="font-semibold">Sellos digitales (CSD)</p>
              <p>
                {company.has_csd
                  ? `Cargado — cert ${company.csd_no_certificado || 's/n'} · vence ${company.csd_valid_to ? String(company.csd_valid_to).slice(0, 10) : '—'}`
                  : 'Sin CSD cargado'}
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenCsd}
              className="flex items-center gap-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded"
            >
              <FileKey size={14}/> {company.has_csd ? 'Actualizar CSD' : 'Cargar CSD'}
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-gray-200 bg-slate-50 sticky bottom-0">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50">
            Cancelar
          </button>
          <button type="submit" disabled={busy}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 font-semibold">
            {busy ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>}
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ─────────────── Modal: eliminar empresa completa (2 pasos) ─────────────── */

function DangerDeleteModal({
  company, onClose, onDone,
}: {
  company: any;
  onClose: () => void;
  onDone: () => void;
}) {
  // Paso 1: preview + escribir RFC. Paso 2: escribir "ELIMINAR".
  const [step, setStep] = useState<1 | 2>(1);
  const [rfcInput, setRfcInput] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [preview, setPreview] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const rfcOk = rfcInput.trim().toUpperCase() === String(company.rfc).toUpperCase();
  const eliminarOk = confirmText.trim().toUpperCase() === 'ELIMINAR';

  // Al abrir el modal, dispara un dryRun para mostrar qué se va a borrar.
  useEffect(() => {
    (async () => {
      try {
        const r = await api.adminFullDeleteCompanyDryRun(company.id, company.rfc);
        setPreview(r.data?.would_delete || null);
      } catch (e: any) {
        // Si el dryRun falla es porque el confirmRfc que le mandé es incorrecto;
        // dejamos el preview vacío pero el usuario aún puede continuar (el
        // borrado real vuelve a validar server-side).
        setError(e.response?.data?.message || e.message);
      }
    })();
  }, [company.id, company.rfc]);

  const goToStep2 = () => {
    setError('');
    if (!rfcOk) {
      setError(`El RFC no coincide. Debe ser exactamente "${company.rfc}".`);
      return;
    }
    setStep(2);
  };

  const executeDelete = async () => {
    setError('');
    if (!eliminarOk) {
      setError('Escribe la palabra "ELIMINAR" (en mayúsculas) para confirmar.');
      return;
    }
    setBusy(true);
    try {
      await api.adminFullDeleteCompany(company.id, {
        confirmRfc: company.rfc,
        confirmText: 'ELIMINAR',
      });
      alert(
        `Empresa ${company.rfc} eliminada por completo.\n\n` +
        `Los usuarios, CSD, facturas, pagos, NC, clientes y productos ` +
        `fueron borrados. El RFC queda libre para re-registrarse.`
      );
      onDone();
    } catch (e: any) {
      setError(e.response?.data?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 bg-rose-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-rose-200 rounded-lg flex items-center justify-center">
              <AlertTriangle className="text-rose-700" size={20}/>
            </div>
            <div>
              <h2 className="font-bold text-rose-900">Eliminar empresa completa</h2>
              <p className="text-xs text-rose-700">
                {company.business_name} — {company.rfc}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-rose-100 rounded"><X size={20}/></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Indicador de paso */}
          <div className="flex items-center justify-center gap-3 text-xs">
            <span className={`px-3 py-1 rounded-full font-semibold ${step === 1 ? 'bg-rose-600 text-white' : 'bg-emerald-100 text-emerald-800 border border-emerald-300'}`}>
              {step === 1 ? '1' : '✓'} Identificar
            </span>
            <span className="w-8 h-px bg-gray-300"></span>
            <span className={`px-3 py-1 rounded-full font-semibold ${step === 2 ? 'bg-rose-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
              2 Confirmar
            </span>
          </div>

          {/* Preview de lo que se borrará */}
          {preview && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">
                Se eliminarán
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <span className="text-slate-600">Facturas</span>            <span className="text-right font-mono font-semibold">{preview.invoices}</span>
                <span className="text-slate-600">Items de factura</span>    <span className="text-right font-mono font-semibold">{preview.invoice_items}</span>
                <span className="text-slate-600">Pagos</span>               <span className="text-right font-mono font-semibold">{preview.payments}</span>
                <span className="text-slate-600">Notas de crédito</span>    <span className="text-right font-mono font-semibold">{preview.credit_notes}</span>
                <span className="text-slate-600">Clientes</span>            <span className="text-right font-mono font-semibold">{preview.customers}</span>
                <span className="text-slate-600">Productos</span>           <span className="text-right font-mono font-semibold">{preview.products}</span>
                <span className="text-slate-600">Usuarios</span>            <span className="text-right font-mono font-semibold">{preview.users}</span>
                <span className="text-slate-900 font-semibold pt-1 border-t border-slate-200">Empresa (registro)</span>
                <span className="text-right font-mono font-bold pt-1 border-t border-slate-200">1</span>
              </div>
              <p className="text-[11px] text-slate-500 italic mt-3">
                Incluye CSD (.cer + .key cifrados), logo, config de plan y bitácora asociada.
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}

          {step === 1 && (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-900">
                  <b>Esta operación es irreversible.</b> Escribe el RFC exacto de la empresa
                  para pasar al segundo paso de confirmación.
                </p>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-gray-700 block mb-1">
                  RFC de la empresa
                </span>
                <input
                  value={rfcInput}
                  onChange={(e) => setRfcInput(e.target.value.toUpperCase())}
                  placeholder={company.rfc}
                  className="w-full border border-slate-300 rounded px-3 py-2 font-mono text-sm uppercase focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                />
                <p className={`text-xs mt-1 ${rfcOk ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {rfcOk ? '✓ RFC correcto' : `Debe ser exactamente ${company.rfc}`}
                </p>
              </label>
            </>
          )}

          {step === 2 && (
            <>
              <div className="bg-rose-50 border-2 border-rose-300 rounded-lg p-4">
                <p className="text-sm text-rose-900 font-semibold mb-1">
                  Último paso — confirmación final
                </p>
                <p className="text-xs text-rose-800">
                  Escribe la palabra <b className="font-mono">ELIMINAR</b> (en mayúsculas)
                  para ejecutar el borrado definitivo. No hay Papelera; los datos NO se
                  pueden recuperar después.
                </p>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-gray-700 block mb-1">
                  Escribe: ELIMINAR
                </span>
                <input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                  placeholder="ELIMINAR"
                  className="w-full border border-slate-300 rounded px-3 py-2 font-mono text-sm uppercase focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                />
              </label>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-gray-200 bg-slate-50">
          {step === 2 && (
            <button
              onClick={() => setStep(1)}
              disabled={busy}
              className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50"
            >
              ← Atrás
            </button>
          )}
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-white disabled:opacity-50"
          >
            Cancelar
          </button>
          {step === 1 ? (
            <button
              onClick={goToStep2}
              disabled={!rfcOk}
              className="px-5 py-2 rounded-lg text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
            >
              Continuar →
            </button>
          ) : (
            <button
              onClick={executeDelete}
              disabled={busy || !eliminarOk}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-white bg-rose-700 hover:bg-rose-800 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
            >
              {busy ? <Loader2 size={16} className="animate-spin"/> : <AlertTriangle size={16}/>}
              {busy ? 'Eliminando…' : 'Eliminar definitivamente'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Catálogo de planes (espejo de stamp_packages) ─────────────── */

interface StampPlanOption {
  code: string;
  label: string;                // texto que va en el <option>
  billingPlan: 'iguala' | 'renta';
  capTimbres: number;           // 0 = sin cap (pay-per-stamp)
  monthlyFee: number;
}

const PLAN_OPTIONS: StampPlanOption[] = [
  { code:'PKG_100',  label:'Esencial · 100 timbres · $399/mes',    billingPlan:'iguala', capTimbres:100, monthlyFee:399 },
  { code:'PKG_200',  label:'Pyme · 200 timbres · $699/mes',        billingPlan:'iguala', capTimbres:200, monthlyFee:699 },
  { code:'PKG_500',  label:'Empresarial · 500 timbres · $1,399/mes', billingPlan:'iguala', capTimbres:500, monthlyFee:1399 },
  { code:'PKG_FLEX', label:'Uso libre (pay-per-stamp) · sin renta', billingPlan:'renta',  capTimbres:0,   monthlyFee:0 },
];

/* ─────────────── Modal Nueva Empresa ─────────────── */

function CreateCompanyModal({ onClose, onDone }: any) {
  const [form, setForm] = useState({
    rfc:'', businessName:'', fiscalRegime:'601', postalCode:'',
    // Default: plan Pyme (PKG_200) — el más recomendado.
    planCode:'PKG_200',
    billingPlan:'iguala' as 'iguala'|'renta',
    capTimbres:200, monthlyFee:699,
    // Timbre extra fijo $2.00 MXN — se puede ajustar por empresa si se negocia.
    extraStampFee:2.00,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [csfLoading, setCsfLoading] = useState(false);

  // Aplica un plan al form (autollena billing_plan + cap + fee)
  const applyPlan = (code: string) => {
    const p = PLAN_OPTIONS.find((x) => x.code === code);
    if (!p) return;
    setForm((f) => ({
      ...f,
      planCode: p.code,
      billingPlan: p.billingPlan,
      capTimbres: p.capTimbres,
      monthlyFee: p.monthlyFee,
    }));
  };

  // Lector de CIF: sube PDF a /csf/extract y autollena RFC + razón + régimen + CP.
  const handleReadCIF = async (file: File) => {
    setError(''); setCsfLoading(true);
    try {
      const r = await api.extractCSF(file);
      const d = r.data || {};
      setForm((f) => ({
        ...f,
        rfc: (d.rfc || f.rfc).toUpperCase(),
        businessName: (d.businessName || d.razonSocial || f.businessName).toUpperCase(),
        fiscalRegime: d.fiscalRegime || d.regimenFiscal || f.fiscalRegime,
        postalCode: d.postalCode || d.cp || f.postalCode,
      }));
    } catch (e: any) {
      setError(e.response?.data?.message || 'No se pudo leer el CIF. Verifica que sea un PDF de Constancia de Situación Fiscal SAT.');
    } finally { setCsfLoading(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      // Enviamos también `stampPackageCode` para que el backend lo guarde
      // en la nueva columna `stamp_package_code` cuando esté disponible.
      await api.adminCreateCompany({
        ...form,
        stampPackageCode: form.planCode,
      });
      onDone();
    } catch (e: any) {
      setError(e.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  const currentPlan = PLAN_OPTIONS.find((x) => x.code === form.planCode)!;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-bold">Nueva empresa</h2>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded"><X size={20}/></button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}

          {/* ─── Botón lector de CIF (CSF SAT) ─── */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-blue-900 mb-1 flex items-center gap-2">
              <ScanText size={16}/> Leer Constancia de Situación Fiscal (CIF)
            </p>
            <p className="text-xs text-blue-700 mb-2">
              Sube el PDF de la CSF del SAT y autollenamos RFC, razón social, régimen y CP.
            </p>
            <label className="inline-flex items-center gap-2 cursor-pointer bg-white border border-blue-300 rounded px-3 py-1.5 hover:bg-blue-100 text-sm">
              <Upload size={14}/> {csfLoading ? 'Leyendo PDF…' : 'Seleccionar PDF'}
              <input type="file" accept="application/pdf,.pdf" className="hidden"
                disabled={csfLoading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleReadCIF(f); }}/>
            </label>
          </div>

          {/* ─── Datos fiscales (llenados a mano o por CIF) ─── */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-sm font-medium block mb-1">RFC *</span>
              <input required className="input w-full font-mono uppercase" maxLength={13}
                value={form.rfc} onChange={(e)=>setForm({...form,rfc:e.target.value.toUpperCase()})}/></label>
            <label className="block"><span className="text-sm font-medium block mb-1">Régimen fiscal *</span>
              <input required className="input w-full" value={form.fiscalRegime}
                onChange={(e)=>setForm({...form,fiscalRegime:e.target.value})}/></label>
          </div>
          <label className="block"><span className="text-sm font-medium block mb-1">Razón social *</span>
            <input required className="input w-full uppercase" value={form.businessName}
              onChange={(e)=>setForm({...form,businessName:e.target.value.toUpperCase()})}/></label>
          <label className="block"><span className="text-sm font-medium block mb-1">CP fiscal</span>
            <input className="input w-full" maxLength={5} value={form.postalCode}
              onChange={(e)=>setForm({...form,postalCode:e.target.value})}/></label>

          {/* ─── Plan de cobro con selector ─── */}
          <div className="border-t pt-3">
            <p className="text-sm font-semibold text-gray-700 mb-2">Plan de cobro</p>

            <label className="block">
              <span className="text-sm block mb-1">Paquete de timbres</span>
              <select className="input w-full" value={form.planCode}
                onChange={(e)=>applyPlan(e.target.value)}>
                {PLAN_OPTIONS.map((p) => (
                  <option key={p.code} value={p.code}>{p.label}</option>
                ))}
              </select>
            </label>

            {/* Resumen del plan seleccionado (read-only, autollenado) */}
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="bg-gray-50 border rounded px-3 py-2">
                <p className="text-[10px] uppercase text-gray-500">Cap timbres/mes</p>
                <p className="text-lg font-bold text-gray-900">
                  {currentPlan.capTimbres || '∞'}
                </p>
              </div>
              <div className="bg-gray-50 border rounded px-3 py-2">
                <p className="text-[10px] uppercase text-gray-500">Renta mensual</p>
                <p className="text-lg font-bold text-gray-900">
                  ${currentPlan.monthlyFee.toLocaleString('es-MX')}
                </p>
              </div>
              <label className="block bg-white border rounded px-3 py-2">
                <span className="text-[10px] uppercase text-gray-500 block">Timbre extra</span>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold text-gray-900">$</span>
                  <input type="number" step="0.01" min="0"
                    className="text-lg font-bold text-gray-900 border-0 p-0 w-full focus:ring-0"
                    value={form.extraStampFee}
                    onChange={(e)=>setForm({...form,extraStampFee:parseFloat(e.target.value)||0})}/>
                </div>
              </label>
            </div>
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancelar</button>
          <button type="submit" disabled={busy} className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
            {busy?'Creando…':'Crear empresa'}
          </button>
        </div>
      </form>
    </div>
  );
}

function CSDUploadModal({ company, onClose, onDone }: any) {
  const [form, setForm] = useState({ noCertificado:'', keyPassword:'', validFrom:'', validTo:'' });
  const [cerFile, setCerFile] = useState<File|null>(null);
  const [keyFile, setKeyFile] = useState<File|null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);

  async function fileToB64(f: File): Promise<string> {
    const buf = new Uint8Array(await f.arrayBuffer());
    let s = ''; for (let i=0;i<buf.length;i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!cerFile || !keyFile) return setError('Selecciona los archivos .cer y .key');
    setBusy(true);
    try {
      await api.adminUploadCSD(company.id, {
        noCertificado: form.noCertificado,
        cerBase64: await fileToB64(cerFile),
        keyBase64: await fileToB64(keyFile),
        keyPassword: form.keyPassword,
        validFrom: form.validFrom || undefined,
        validTo:   form.validTo   || undefined,
      });
      onDone();
    } catch (e: any) { setError(e.response?.data?.message || e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="font-bold">Cargar CSD</h2>
            <p className="text-xs text-gray-500">{company.rfc} · {company.business_name}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded"><X size={20}/></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}
          <label className="block"><span className="text-sm font-medium block mb-1">No. Certificado (20 dígitos) *</span>
            <input required className="input w-full font-mono" maxLength={20} pattern="\d{20}"
              value={form.noCertificado} onChange={(e)=>setForm({...form,noCertificado:e.target.value})}/></label>
          <label className="block"><span className="text-sm font-medium block mb-1">Archivo .cer (público) *</span>
            <input required type="file" accept=".cer" onChange={(e)=>setCerFile(e.target.files?.[0]||null)}/></label>
          <label className="block"><span className="text-sm font-medium block mb-1">Archivo .key (privado) *</span>
            <input required type="file" accept=".key" onChange={(e)=>setKeyFile(e.target.files?.[0]||null)}/></label>
          <label className="block"><span className="text-sm font-medium block mb-1">Password del .key *</span>
            <input required type="password" className="input w-full"
              value={form.keyPassword} onChange={(e)=>setForm({...form,keyPassword:e.target.value})}/></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-sm block mb-1">Vigente desde</span>
              <input type="date" className="input w-full" value={form.validFrom}
                onChange={(e)=>setForm({...form,validFrom:e.target.value})}/></label>
            <label className="block"><span className="text-sm block mb-1">Vigente hasta</span>
              <input type="date" className="input w-full" value={form.validTo}
                onChange={(e)=>setForm({...form,validTo:e.target.value})}/></label>
          </div>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded">
            El .key y su password se cifran con pgcrypto antes de almacenarse. Nunca se devuelven por API.
          </p>
        </div>
        <div className="flex gap-3 p-5 border-t">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancelar</button>
          <button type="submit" disabled={busy} className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
            {busy?'Subiendo…':'Cargar CSD'}
          </button>
        </div>
      </form>
    </div>
  );
}
