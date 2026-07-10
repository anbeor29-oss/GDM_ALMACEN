/**
 * IssuerModal — datos del EMISOR de las facturas (la empresa del usuario)
 * Conforme a CFF Art. 29-A fracc. I, II, IV (RFC, Régimen, CP del lugar de expedición)
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Landmark, Save, FileUp, Loader2, KeyRound, Image as ImageIcon } from 'lucide-react';
import api from '@/services/api';
import { ManifestSigner } from './ManifestSigner';

const upper = (v: string) => (v || '').toUpperCase();

interface Props {
  companyId: string;
  onClose: () => void;
}

export function IssuerModal({ companyId, onClose }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, any>>({});
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [csfMsg, setCsfMsg] = useState<{ type: 'ok' | 'warn'; text: string } | null>(null);
  const [csfLoading, setCsfLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: company, isLoading } = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => api.getCompany(companyId),
  });

  const { data: regimenes } = useQuery({
    queryKey: ['catalog', 'regimenFiscal'],
    queryFn: () => api.getCatalog('regimenFiscal'),
    staleTime: Infinity,
  });
  const { data: estados } = useQuery({
    queryKey: ['catalog', 'estado'],
    queryFn: () => api.getCatalog('estado'),
    staleTime: Infinity,
  });

  // Cuando llega la empresa, llenamos el form
  useEffect(() => {
    if (company?.data) {
      setForm({ ...company.data });
    }
  }, [company]);

  const mutation = useMutation({
    mutationFn: (data: any) => api.updateCompany(companyId, data),
    onSuccess: () => {
      setMsg({ type: 'ok', text: 'Datos del emisor actualizados.' });
      queryClient.invalidateQueries({ queryKey: ['company', companyId] });
    },
    onError: (e: any) =>
      setMsg({ type: 'err', text: e.response?.data?.message || e.message }),
  });

  // Llenar campos del emisor desde una CSF (PDF del SAT)
  const onPickCSF = async (file: File) => {
    setCsfMsg(null);
    setMsg(null);
    setCsfLoading(true);
    try {
      const res = await api.extractCSF(file);
      const d = res.data;
      setForm((prev) => ({
        ...prev,
        business_name: upper(d.businessName || prev.business_name),
        fiscal_regime: d.fiscalRegime || prev.fiscal_regime,
        postal_code: d.postalCode || prev.postal_code,
        state: d.state || prev.state,
        municipality: upper(d.municipality || prev.municipality),
        city: upper(d.city || prev.city),
        neighborhood: upper(d.neighborhood || prev.neighborhood),
        street: upper(d.street || prev.street),
        ext_number: d.extNumber || prev.ext_number,
      }));
      const avisos: string[] = [];
      // Si el RFC de la CSF no coincide con el del emisor registrado, avisar
      if (d.rfc && form.rfc && d.rfc.toUpperCase() !== String(form.rfc).toUpperCase()) {
        avisos.push(`el RFC de la CSF (${d.rfc}) no coincide con el del emisor registrado (${form.rfc})`);
      }
      if (d.unresolvedRegimen) avisos.push(`régimen "${d.raw?.regimen}" no se pudo mapear, selecciónalo a mano`);
      if (d.unresolvedState) avisos.push(`estado "${d.raw?.estado}" no se pudo mapear`);
      setCsfMsg(
        avisos.length
          ? { type: 'warn', text: `CSF leída. Revisa: ${avisos.join('; ')}.` }
          : { type: 'ok', text: 'CSF leída y campos llenados. Verifica antes de guardar.' }
      );
    } catch (e: any) {
      setMsg({ type: 'err', text: e.response?.data?.message || e.message || 'Error al leer la CSF' });
    } finally {
      setCsfLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    // El backend acepta snake_case en updateCompany — mapeamos solo lo editable
    mutation.mutate({
      business_name: form.business_name,
      fiscal_regime: form.fiscal_regime,
      email: form.email,
      phone: form.phone,
      postal_code: form.postal_code,
      state: form.state,
      municipality: form.municipality,
      city: form.city,
      neighborhood: form.neighborhood,
      street: form.street,
      ext_number: form.ext_number,
      default_invoice_series: form.default_invoice_series,
      next_invoice_folio: form.next_invoice_folio,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between p-6 border-b border-gray-200 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Landmark className="text-blue-600" size={20} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Datos del Emisor</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Empresa que emite las facturas — CFF Art. 29-A
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-gray-600">Cargando datos del emisor…</div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Carga de CSF */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
              <FileUp className="text-blue-600 flex-shrink-0" size={22} />
              <div className="flex-1">
                <p className="text-sm font-semibold text-blue-900">Leer Constancia de Situación Fiscal</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={(e) => e.target.files?.[0] && onPickCSF(e.target.files[0])}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={csfLoading}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2"
              >
                {csfLoading ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />}
                {csfLoading ? 'Procesando…' : 'Subir PDF'}
              </button>
            </div>

            {csfMsg && (
              <div className={`px-4 py-2 rounded-lg text-sm ${
                csfMsg.type === 'ok'
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-yellow-50 border border-yellow-200 text-yellow-800'
              }`}>
                {csfMsg.text}
              </div>
            )}

            {msg && (
              <div
                className={`px-4 py-3 rounded-lg text-sm ${
                  msg.type === 'ok'
                    ? 'bg-green-50 border border-green-200 text-green-700'
                    : 'bg-red-50 border border-red-200 text-red-700'
                }`}
              >
                {msg.text}
              </div>
            )}

            <Section>Identificación fiscal</Section>
            <div className="grid grid-cols-2 gap-4">
              <FieldRO label="RFC del emisor" value={form.rfc} mono />
              <Field label="Razón Social">
                <input
                  type="text"
                  value={form.business_name || ''}
                  onChange={(e) => setForm({ ...form, business_name: upper(e.target.value) })}
                  className="input uppercase"
                />
              </Field>
              <Field label="Régimen Fiscal">
                <select
                  value={form.fiscal_regime || ''}
                  onChange={(e) => setForm({ ...form, fiscal_regime: e.target.value })}
                  className="input"
                  title={
                    regimenes?.data?.entries?.find((r: any) => r.catalog_key === form.fiscal_regime)?.description || ''
                  }
                >
                  <option value="">— seleccionar —</option>
                  {regimenes?.data?.entries?.map((r: any) => (
                    <option key={r.catalog_key} value={r.catalog_key}
                      title={`${r.catalog_key} — ${r.description}`}>
                      {r.catalog_key} — {r.description}
                    </option>
                  ))}
                </select>
                {form.fiscal_regime && (
                  <p className="text-xs text-gray-500 mt-1 leading-tight">
                    {regimenes?.data?.entries?.find((r: any) => r.catalog_key === form.fiscal_regime)?.description}
                  </p>
                )}
              </Field>
              <Field label="Serie (prefijo)" hint="Suele cambiarse por año o sucursal">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.default_invoice_series || ''}
                    onChange={(e) => setForm({ ...form, default_invoice_series: e.target.value.toUpperCase().slice(0, 25) })}
                    placeholder="F"
                    maxLength={25}
                    className="input uppercase font-mono"
                  />
                  <select
                    value=""
                    onChange={(e) => e.target.value && setForm({ ...form, default_invoice_series: e.target.value })}
                    className="input"
                    title="Sugerencias de serie"
                  >
                    <option value="">— sugerir —</option>
                    <option value="F">F</option>
                    <option value="FAC">FAC</option>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value={`F${new Date().getFullYear()}`}>F{new Date().getFullYear()}</option>
                    <option value={`A${new Date().getFullYear()}`}>A{new Date().getFullYear()}</option>
                    <option value="MTZ">MTZ</option>
                    <option value="CDMX">CDMX</option>
                  </select>
                </div>
              </Field>
              <Field label="Folio siguiente" hint="Próximo número a asignar">
                <input
                  type="number"
                  min={1}
                  value={form.next_invoice_folio || 1}
                  onChange={(e) => setForm({ ...form, next_invoice_folio: parseInt(e.target.value, 10) || 1 })}
                  className="input"
                />
              </Field>
            </div>

            <Section>Domicilio fiscal (lugar de expedición)</Section>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Calle">
                <input
                  type="text"
                  value={form.street || ''}
                  onChange={(e) => setForm({ ...form, street: upper(e.target.value) })}
                  className="input uppercase"
                />
              </Field>
              <Field label="Número">
                <input
                  type="text"
                  value={form.ext_number || ''}
                  onChange={(e) => setForm({ ...form, ext_number: upper(e.target.value) })}
                  className="input uppercase"
                />
              </Field>
              <Field label="Colonia">
                <input
                  type="text"
                  value={form.neighborhood || ''}
                  onChange={(e) => setForm({ ...form, neighborhood: upper(e.target.value) })}
                  className="input uppercase"
                />
              </Field>
              <Field label="Municipio">
                <input
                  type="text"
                  value={form.municipality || ''}
                  onChange={(e) => setForm({ ...form, municipality: upper(e.target.value) })}
                  className="input uppercase"
                />
              </Field>
              <Field label="Estado">
                <select
                  value={form.state || ''}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  className="input"
                >
                  <option value="">— seleccionar —</option>
                  {estados?.data?.entries?.map((s: any) => (
                    <option key={s.catalog_key} value={s.catalog_key}>
                      {s.catalog_key} — {s.description}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Código Postal" hint="5 dígitos">
                <input
                  type="text"
                  value={form.postal_code || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      postal_code: e.target.value.replace(/\D/g, '').slice(0, 5),
                    })
                  }
                  className="input font-mono"
                  maxLength={5}
                />
              </Field>
            </div>

            <Section>Contacto</Section>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Email">
                <input
                  type="email"
                  value={form.email || ''}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="input"
                />
              </Field>
              <Field label="Teléfono">
                <input
                  type="text"
                  value={form.phone || ''}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="input"
                />
              </Field>
            </div>

            {/* Logo + CSD */}
            <Section>Logo de la empresa (3×3 cm en el PDF)</Section>
            <LogoUploader companyId={companyId} />

            <Section>CSD — Certificado de Sello Digital (para timbrar)</Section>
            <CSDUploader companyId={companyId} />

            <Section>Manifiesto PAC — autorización al proveedor de timbrado</Section>
            <ManifestSigner />

            <div className="flex gap-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cerrar
              </button>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Save size={16} />
                {mutation.isPending ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ──────────────── Logo ──────────────── */

function LogoUploader({ companyId }: { companyId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // 3 cm × 3 cm a 96 DPI ≈ 113×113 px (display)
  const logoUrl = api.companyLogoUrl(companyId) + `&v=${version}`;

  const pick = async (f?: File) => {
    if (!f) return;
    setError('');
    setBusy(true);
    try {
      await api.uploadCompanyLogo(companyId, f);
      setVersion((v) => v + 1);
      queryClient.invalidateQueries({ queryKey: ['company', companyId] });
    } catch (e: any) {
      setError(e.response?.data?.message || e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div className="flex-shrink-0 w-[113px] h-[113px] border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden">
        <img
          key={version}
          src={logoUrl}
          alt="Logo"
          className="max-w-full max-h-full object-contain"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      </div>
      <div className="flex-1 space-y-2">
        <p className="text-xs text-gray-600">
          Recomendado: cuadrado 300×300 px (PNG con fondo transparente). Se mostrará en
          una caja de aprox. 3×3 cm en cada factura PDF.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          hidden
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm"
        >
          <ImageIcon size={16} />
          {busy ? 'Subiendo…' : 'Subir logo'}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}

/* ──────────────── CSD ──────────────── */

function CSDUploader({ companyId }: { companyId: string }) {
  const [cer, setCer] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  const [pwd, setPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const status = useQuery({
    queryKey: ['csd-status', companyId],
    queryFn: () => api.getCompanyUploadStatus(companyId),
  });
  const s = status.data?.data || {};

  const submit = async () => {
    if (!cer || !key || !pwd) {
      setMsg({ type: 'err', text: 'Selecciona el .cer, el .key y captura la contraseña.' });
      return;
    }
    setMsg(null);
    setBusy(true);
    try {
      await api.uploadCompanyCSD(companyId, cer, key, pwd);
      setMsg({ type: 'ok', text: 'CSD guardado y contraseña cifrada en el servidor.' });
      setCer(null); setKey(null); setPwd('');
      status.refetch();
    } catch (e: any) {
      setMsg({ type: 'err', text: e.response?.data?.message || e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {s.has_cer && s.has_key && s.has_password && (
        <div className="text-xs bg-green-50 border border-green-200 text-green-800 rounded px-3 py-2">
          ✓ CSD cargado — última actualización: {s.csd_uploaded_at?.slice(0, 19).replace('T',' ')}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <FileBox
          label="Archivo .cer"
          accept=".cer,application/x-x509-ca-cert"
          file={cer}
          onPick={setCer}
        />
        <FileBox
          label="Archivo .key"
          accept=".key"
          file={key}
          onPick={setKey}
        />
      </div>
      <Field label="Contraseña del CSD">
        <div className="flex">
          <input
            type={showPwd ? 'text' : 'password'}
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            className="input rounded-r-none"
            placeholder="••••••••"
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => setShowPwd((v) => !v)}
            className="bg-gray-100 hover:bg-gray-200 border border-l-0 border-gray-300 px-3 rounded-r-lg text-gray-600 text-sm"
          >
            {showPwd ? 'Ocultar' : 'Ver'}
          </button>
        </div>
      </Field>
      {msg && (
        <p className={`text-xs rounded px-3 py-2 ${
          msg.type === 'ok'
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>{msg.text}</p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={busy || !cer || !key || !pwd}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm"
      >
        <KeyRound size={16} />
        {busy ? 'Guardando…' : 'Guardar CSD'}
      </button>
      <p className="text-xs text-gray-500">
        La contraseña se almacena cifrada con AES-256-GCM. Sólo se usará al timbrar; nunca se
        regresa al frontend.
      </p>
    </div>
  );
}

function FileBox({
  label,
  accept,
  file,
  onPick,
}: {
  label: string;
  accept: string;
  file: File | null;
  onPick: (f: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <span className="text-sm font-medium text-gray-700 block mb-1">{label}</span>
      <input ref={ref} type="file" accept={accept} hidden onChange={(e) => onPick(e.target.files?.[0] || null)} />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={`w-full text-left px-3 py-2 border-2 border-dashed rounded-lg text-sm ${
          file ? 'border-green-300 bg-green-50 text-green-800' : 'border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100'
        }`}
      >
        {file ? `✓ ${file.name}` : 'Click para seleccionar…'}
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700 block mb-1">{label}</span>
      {children}
      {hint && <span className="text-xs text-gray-500 block mt-1">{hint}</span>}
    </label>
  );
}

function FieldRO({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700 block mb-1">{label}</span>
      <input
        type="text"
        value={value || '—'}
        readOnly
        className={`input bg-gray-50 text-gray-700 ${mono ? 'font-mono' : ''}`}
      />
    </label>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-200 pb-1">
      {children}
    </h3>
  );
}
