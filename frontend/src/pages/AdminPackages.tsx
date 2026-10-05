/**
 * Super-Admin → Paquetes de uso.
 *
 *  Antes esta pantalla vendía "paquetes fiscales" (los 4 planes de timbrado con
 *  precio). En NEXO el sistema se despliega completo y los módulos se controlan
 *  desde el super administrador, así que los planes con precio ya no aplican: la
 *  sección quedó en blanco, reservada para el concepto de "paquetes de uso".
 *
 *  Lo que SÍ se conserva es la descarga de respaldo SAT (ZIP con los XMLs de una
 *  compañía por rango de fechas) — es la única herramienta funcional de la página
 *  y sirve para la retención fiscal de 5 años (Anexo 20).
 *
 *  Guard duro: role === 'SUPER_ADMIN'. El backend también lo valida.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Building2, Calendar, Package } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { aniosContables } from '@/utils/anios';

const MESES = ['Todo el año', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

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
          <Package size={20} /> Paquetes de uso
        </h1>
        <p className="text-gray-600 mt-2">
          Descarga de respaldos SAT por empresa.
        </p>
      </div>

      {/* ─── SECCIÓN A: reservada (en blanco) ───
          Sin planes de timbrado con precio: el sistema se despliega completo y
          los módulos se activan desde el super administrador. */}

      {/* ─── SECCIÓN B: Descarga de respaldo SAT ─── */}
      <SectionDownloadZip />
    </div>
  );
}

/* ─────────────── Sección: descarga de respaldo SAT ─────────────── */

function SectionDownloadZip() {
  const [companyId, setCompanyId] = useState('');
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(0);   // 0 = todo el año
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
      // Año + mes → rango. Mes 0 = todo el ejercicio.
      const d2 = (x: number) => String(x).padStart(2, '0');
      const from = mes ? `${anio}-${d2(mes)}-01` : `${anio}-01-01`;
      const to = mes ? `${anio}-${d2(mes)}-${d2(new Date(anio, mes, 0).getDate())}` : `${anio}-12-31`;
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
              <Calendar size={16} /> Año
            </span>
            <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input">
              {aniosContables().map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700 flex items-center gap-2 mb-1">
              <Calendar size={16} /> Mes
            </span>
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input">
              {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
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

