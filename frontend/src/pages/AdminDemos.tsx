/**
 * AdminDemos — bandeja de onboarding (súper admin):
 *   · Empresas que FIRMARON → elaborar su factura y pasarlas a PRODUCCIÓN.
 *   · Solicitudes de demostración en línea (durante la prueba).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MonitorPlay, Check, Phone, Mail, FileSignature } from 'lucide-react';
import api from '@/services/api';

export function AdminDemosPage() {
  const qc = useQueryClient();
  const firmasQ = useQuery({ queryKey: ['admin-firmas'], queryFn: () => api.getFirmas() });
  const demosQ = useQuery({ queryKey: ['admin-demos'], queryFn: () => api.getDemos() });
  const firmas: any[] = firmasQ.data?.data || [];
  const demos: any[] = demosQ.data?.data || [];

  const atenderFirma = async (id: string) => {
    try { await api.atenderFirma(id); qc.invalidateQueries({ queryKey: ['admin-firmas'] }); } catch { /* noop */ }
  };
  const atenderDemo = async (id: string) => {
    try { await api.atenderDemoAdmin(id); qc.invalidateQueries({ queryKey: ['admin-demos'] }); } catch { /* noop */ }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2"><FileSignature size={26} className="text-emerald-600" /> Onboarding</h1>
        <p className="text-gray-500 mt-1">Empresas que firmaron (facturar + pasar a producción) y solicitudes de demostración.</p>
      </div>

      {/* Firmas: lo accionable */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><FileSignature size={15} className="text-emerald-600" /> Empresas que firmaron</h2>
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Firmado</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Empresa / RFC</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Correo</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Ambiente</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Estado</th>
                <th className="px-4 py-2 w-40"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {!firmasQ.isLoading && firmas.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500 italic">Sin firmas por atender.</td></tr>
              )}
              {firmas.map((f) => (
                <tr key={f.id} className={`hover:bg-gray-50 ${f.estado === 'ATENDIDA' ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-2 text-sm text-gray-600 whitespace-nowrap">{f.firmado}</td>
                  <td className="px-4 py-2 text-sm"><p className="font-medium text-gray-800">{f.business_name || '—'}</p><p className="text-xs font-mono text-gray-500">{f.rfc || ''}</p></td>
                  <td className="px-4 py-2 text-xs text-gray-500">{f.email || ''}</td>
                  <td className="px-4 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${f.timbrado_ambiente === 'PRODUCCION' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{f.timbrado_ambiente || 'PRUEBAS'}</span></td>
                  <td className="px-4 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${f.estado === 'ATENDIDA' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{f.estado}</span></td>
                  <td className="px-4 py-2 text-right">
                    {f.estado !== 'ATENDIDA' && (
                      <button onClick={() => atenderFirma(f.id)} className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"><Check size={13} /> Facturada y en prod</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Demos */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><MonitorPlay size={15} className="text-sky-600" /> Solicitudes de demostración</h2>
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Fecha</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Empresa / RFC</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Contacto</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Mensaje</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Estado</th>
                <th className="px-4 py-2 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {!demosQ.isLoading && demos.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500 italic">Sin solicitudes de demostración.</td></tr>
              )}
              {demos.map((d) => (
                <tr key={d.id} className={`hover:bg-gray-50 ${d.estado === 'ATENDIDA' ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-2 text-sm text-gray-600 whitespace-nowrap">{d.creado}</td>
                  <td className="px-4 py-2 text-sm"><p className="font-medium text-gray-800">{d.business_name || '—'}</p><p className="text-xs font-mono text-gray-500">{d.rfc || ''}</p></td>
                  <td className="px-4 py-2 text-sm">
                    {d.contacto && <p className="text-gray-800">{d.contacto}</p>}
                    {d.correo && <p className="text-xs text-gray-500 flex items-center gap-1"><Mail size={11} /> {d.correo}</p>}
                    {d.telefono && <p className="text-xs text-gray-500 flex items-center gap-1"><Phone size={11} /> {d.telefono}</p>}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500"><p className="max-w-xs">{d.mensaje || ''}</p></td>
                  <td className="px-4 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${d.estado === 'ATENDIDA' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{d.estado}</span></td>
                  <td className="px-4 py-2 text-right">
                    {d.estado !== 'ATENDIDA' && (
                      <button onClick={() => atenderDemo(d.id)} className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"><Check size={13} /> Atender</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default AdminDemosPage;
