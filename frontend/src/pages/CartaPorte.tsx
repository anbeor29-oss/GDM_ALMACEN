/**
 * CartaPorte Page — listado de facturas con Complemento Carta Porte 3.1.
 *
 * Fase inicial (Bloque 4): solo tabla de facturas DRAFT/STAMPED que YA tienen CP,
 * más botón "Nueva Carta Porte" que redirige a NewInvoice (la CP se captura
 * junto con la factura). El formulario dedicado llega en el Bloque 5.
 *
 * Ancho: max-w-[1200px] (decisión de 2026-07-17 · ver PLAN_MANANA.md §5).
 */

import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Route as RouteIcon, Plus, FileText, MapPin, Package2 } from 'lucide-react';
import api from '@/services/api';
interface CartaPorteRow {
  invoiceId: string;
  invoiceNumber: string;
  invoiceStatus: string;
  origen: string;
  destino: string;
  transportista: string;
  fecha: string;
}

export function CartaPortePage() {
  const navigate = useNavigate();

  // Placeholder: la ruta backend GET /carta-porte todavía no existe (Bloque 5).
  // De momento solo muestra el chrome de la página; la tabla se llena en el
  // siguiente bloque con el endpoint de listado.
  const { data: rows = [], isLoading } = useQuery<CartaPorteRow[]>({
    queryKey: ['carta-porte-list'],
    queryFn: async () => (await api.listCartaPorte()).items || [],
  });

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-sky-100 rounded-lg">
            <RouteIcon size={28} className="text-sky-700" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Carta Porte 3.1</h1>
            <p className="text-sm text-slate-500">Complemento de traslado de mercancías (SAT)</p>
          </div>
        </div>
        <button
          onClick={() => navigate('/invoices/new?withCartaPorte=1')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={18} />
          Nueva Carta Porte
        </button>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <InfoCard icon={<FileText size={18} className="text-sky-700" />} label="Complemento" value="Version 3.1" />
        <InfoCard icon={<MapPin size={18} className="text-emerald-700" />} label="Multimodal" value="Auto, Marítimo, Aéreo, Ferroviario" />
        <InfoCard icon={<Package2 size={18} className="text-amber-700" />} label="Catálogos SAT" value="34 cargados" />
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">IdCCP</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Factura</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Origen</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Destino</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Transportista</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Fecha</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  <RouteIcon size={40} className="mx-auto mb-3 text-slate-300" />
                  <p className="font-medium">Aún no hay Cartas Porte</p>
                  <p className="text-xs mt-1">Al crear una factura, marca "Incluir Carta Porte" para capturar el complemento</p>
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={r.invoiceId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{r.invoiceId.slice(0, 8)}</td>
                  <td className="px-4 py-3">{r.invoiceNumber}</td>
                  <td className="px-4 py-3">{r.origen}</td>
                  <td className="px-4 py-3">{r.destino}</td>
                  <td className="px-4 py-3">{r.transportista}</td>
                  <td className="px-4 py-3">{r.fecha}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => navigate(`/invoices/${r.invoiceId}/edit`)}
                      className="text-sky-600 hover:text-sky-800 text-xs font-medium"
                    >
                      Abrir
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs uppercase tracking-wider text-slate-500 font-medium">{label}</span>
      </div>
      <p className="text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}
