/**
 * Super-Admin → Paquetes fiscales.
 *
 *  Dos secciones en una página:
 *    (A) Planes de timbrado — muestra los 4 paquetes con precios (PKG_100,
 *        PKG_200, PKG_500, PKG_FLEX). El SUPER_ADMIN los asigna a cada
 *        empresa desde el módulo Empresas.
 *    (B) Descarga de paquete SAT — genera ZIP con XMLs (+ opcional PDF) de
 *        una compañía para respaldo fiscal de 5 años (Anexo 20).
 *
 *  Guard duro: role === 'SUPER_ADMIN'. El backend también lo valida.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Building2, Calendar, Wallet, Check, Zap, Star, Rocket, Coins } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

/* ─────────────── Catálogo de planes (espejo de stamp_packages) ─────────────── */

interface StampPlan {
  code: string;
  name: string;
  monthlyStamps: number | null;   // null = uso libre / pay-per-stamp
  monthlyFeeMXN: number;
  extraStampMXN: number;
  color: string;                   // clases Tailwind del color de acento
  ring: string;
  bg: string;
  icon: JSX.Element;
  highlight?: boolean;             // el plan destacado
  bulletpoints: string[];
}

const PLANS: StampPlan[] = [
  {
    code: 'PKG_100',
    name: 'Esencial',
    monthlyStamps: 100,
    monthlyFeeMXN: 399,
    extraStampMXN: 2.5,
    color: 'text-emerald-700',
    ring: 'border-emerald-200',
    bg: 'bg-emerald-50',
    icon: <Zap size={28} className="text-emerald-600" />,
    bulletpoints: [
      '100 timbres CFDI 4.0 al mes',
      'Timbrado ilimitado dentro del cap',
      'Reportes de cobranza, ventas y fiscal',
      'Notas de crédito y complementos de pago',
      'Multi-usuario (ADMIN + operativos)',
      'Timbre extra: $2.50 MXN + IVA',
    ],
  },
  {
    code: 'PKG_200',
    name: 'Pyme',
    monthlyStamps: 200,
    monthlyFeeMXN: 699,
    extraStampMXN: 2.25,
    color: 'text-indigo-700',
    ring: 'border-indigo-200',
    bg: 'bg-indigo-50',
    icon: <Star size={28} className="text-indigo-600" />,
    highlight: true,
    bulletpoints: [
      '200 timbres CFDI 4.0 al mes',
      'Todo lo del plan Esencial',
      'Importación de XMLs recibidos',
      'Gestión de proveedores',
      'Reporte de cobranza detallado',
      'Timbre extra: $2.25 MXN + IVA',
    ],
  },
  {
    code: 'PKG_500',
    name: 'Empresarial',
    monthlyStamps: 500,
    monthlyFeeMXN: 1399,
    extraStampMXN: 2.0,
    color: 'text-violet-700',
    ring: 'border-violet-200',
    bg: 'bg-violet-50',
    icon: <Rocket size={28} className="text-violet-600" />,
    bulletpoints: [
      '500 timbres CFDI 4.0 al mes',
      'Todo lo del plan Pyme',
      'Prioridad en soporte',
      'Backup mensual SAT en ZIP',
      'Multi-empresa (multi-tenant)',
      'Timbre extra: $2.00 MXN + IVA',
    ],
  },
  {
    code: 'PKG_FLEX',
    name: 'Uso libre',
    monthlyStamps: null,
    monthlyFeeMXN: 0,
    extraStampMXN: 4.99,
    color: 'text-slate-700',
    ring: 'border-slate-200',
    bg: 'bg-slate-50',
    icon: <Coins size={28} className="text-slate-600" />,
    bulletpoints: [
      'Sin renta mensual',
      'Timbre a $4.99 MXN + IVA',
      'Ideal para bajo volumen (< 30/mes)',
      'Facturación al final del mes',
      'Sin compromiso de permanencia',
    ],
  },
];

/* ─────────────── Página ─────────────── */

export function AdminPackagesPage() {
  const { user } = useAuthStore();

  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 p-6 rounded-lg">
        <p className="font-semibold mb-1">Acceso restringido</p>
        <p className="text-sm">
          Esta sección requiere rol <b>SUPER_ADMIN</b>. Tu rol actual: <b>{user?.role}</b>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
          <Wallet className="text-indigo-600" size={36} /> Paquetes fiscales
        </h1>
        <p className="text-gray-600 mt-2">
          Planes de timbrado disponibles y descarga de respaldos SAT.
        </p>
      </div>

      {/* ─── SECCIÓN A: Planes de timbrado ─── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Planes de timbrado</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((p) => <PlanCard key={p.code} plan={p} />)}
        </div>
        <p className="text-xs text-gray-500 mt-4">
          La asignación de plan a una empresa se hace desde el módulo{' '}
          <b>Empresas → editar → Plan de timbrado</b>.
        </p>
      </section>

      {/* ─── SECCIÓN B: Descarga de respaldo SAT ─── */}
      <SectionDownloadZip />
    </div>
  );
}

/* ─────────────── Componente: card de plan ─────────────── */

function PlanCard({ plan }: { plan: StampPlan }) {
  const priceLabel = plan.monthlyFeeMXN === 0
    ? 'Sin renta'
    : `$${plan.monthlyFeeMXN.toLocaleString('es-MX')}`;
  const perLabel = plan.monthlyFeeMXN === 0 ? 'pay-per-stamp' : '/ mes';

  return (
    <div
      className={`bg-white rounded-xl border-2 ${plan.ring} p-5 flex flex-col relative overflow-hidden ${
        plan.highlight ? 'shadow-lg' : 'shadow-sm'
      }`}
    >
      {plan.highlight && (
        <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-bl-lg">
          Recomendado
        </div>
      )}

      <div className={`w-14 h-14 ${plan.bg} rounded-xl flex items-center justify-center mb-3`}>
        {plan.icon}
      </div>

      <h3 className={`text-xl font-bold ${plan.color}`}>{plan.name}</h3>
      <p className="text-xs text-gray-500 font-mono mb-3">{plan.code}</p>

      <div className="mb-1">
        <span className="text-3xl font-bold text-gray-900">{priceLabel}</span>
        {' '}
        <span className="text-sm text-gray-500">MXN {perLabel}</span>
      </div>
      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-4">Precios más IVA</p>

      {plan.monthlyStamps !== null && (
        <div className={`${plan.bg} rounded-lg px-3 py-2 mb-4 flex items-center justify-between`}>
          <span className="text-xs text-gray-600">Timbres/mes</span>
          <span className={`font-bold ${plan.color}`}>{plan.monthlyStamps}</span>
        </div>
      )}

      <ul className="space-y-1.5 flex-1 text-sm text-gray-700">
        {plan.bulletpoints.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <Check size={16} className={`${plan.color} shrink-0 mt-0.5`} />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 pt-4 border-t border-gray-100 text-[11px] text-gray-500">
        Timbre extra: <b>${plan.extraStampMXN.toFixed(2)} MXN</b>
        <span className="text-gray-400"> (+ IVA)</span>
      </div>
    </div>
  );
}

/* ─────────────── Sección: descarga de respaldo SAT ─────────────── */

function SectionDownloadZip() {
  const [companyId, setCompanyId] = useState('');
  const [from, setFrom] = useState(() => firstOfMonth());
  const [to, setTo] = useState(() => todayISO());
  const [format, setFormat] = useState<'xml' | 'both'>('xml');
  const [limit, setLimit] = useState(100);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  // El SUPER_ADMIN ve TODAS las empresas usuarias — usamos el endpoint admin
  // (adminListCompanies) porque listCompanies solo devuelve la del JWT.
  const companiesQ = useQuery({
    queryKey: ['admin-companies-zip'],
    queryFn: () => api.adminListCompanies(),
    retry: 0,
  });
  const companies = (companiesQ.data?.data?.companies || []) as Array<{
    id: string; rfc: string; business_name: string;
  }>;

  const handleDownload = async () => {
    setError('');
    if (!companyId) { setError('Selecciona o pega un companyId'); return; }
    setDownloading(true);
    try {
      const blob = await api.adminDownloadPackage({ companyId, from, to, format, limit });
      const fname = `paquete-${companyId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.zip`;
      await api.downloadFile(blob, fname);
    } catch (e: any) {
      setError(e.response?.data?.message || e.message || 'Error en la descarga');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-800 mb-1">Respaldo SAT (ZIP)</h2>
      <p className="text-xs text-gray-500 mb-4">
        Genera un paquete comprimido con los XMLs (y opcionalmente PDFs) de una
        compañía en un rango de fechas. Retención SAT: 5 años.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-lg p-6 space-y-4 max-w-3xl">
        <label className="block">
          <span className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-1">
            <Building2 size={16} /> Empresa usuaria
          </span>
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="input">
            <option value="">
              {companiesQ.isLoading
                ? 'Cargando empresas…'
                : companies.length === 0
                  ? 'No hay empresas registradas'
                  : `— seleccionar empresa (${companies.length} disponible${companies.length === 1 ? '' : 's'}) —`}
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.rfc} · {c.business_name}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-gray-500 mt-1">
            El ZIP se genera solo con las facturas emitidas por esta empresa.
          </p>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-1">
              <Calendar size={16} /> Desde
            </span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-1">
              <Calendar size={16} /> Hasta
            </span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-gray-700 block mb-1">Formato</span>
            <select value={format} onChange={(e) => setFormat(e.target.value as any)} className="input">
              <option value="xml">Solo XML (~1 KB / timbre)</option>
              <option value="both">XML + PDF (~12 KB / timbre)</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700 block mb-1">Límite</span>
            <input
              type="number" min={1} max={1000} value={limit}
              onChange={(e) => setLimit(Math.min(1000, parseInt(e.target.value) || 100))}
              className="input"
            />
          </label>
        </div>

        <button
          onClick={handleDownload}
          disabled={downloading || !companyId}
          className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg shadow"
        >
          <Download size={18} />
          {downloading ? 'Generando ZIP…' : 'Descargar paquete'}
        </button>

        <p className="text-xs text-gray-500 leading-relaxed">
          El ZIP incluye un <code>MANIFEST.json</code> con metadatos auditables
          (lista de UUIDs, fechas, quién descargó). Para retención SAT de 5 años,
          guarda los paquetes mensuales en almacenamiento frío (S3 Glacier / Azure Archive).
        </p>
      </div>
    </section>
  );
}

/* ─────────────── helpers ─────────────── */

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonth(): string {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
}
