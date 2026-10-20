/**
 * AdminDemos — bandeja de onboarding (súper admin):
 *   · Empresas que FIRMARON → elaborar su factura y pasarlas a PRODUCCIÓN.
 *   · Solicitudes de demostración en línea (durante la prueba).
 */
import { useState, useMemo, Fragment } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MonitorPlay, Check, Phone, Mail, FileSignature, ChevronRight, ChevronDown, Building2, X } from 'lucide-react';
import api from '@/services/api';

export function AdminDemosPage() {
  const qc = useQueryClient();
  const firmasQ = useQuery({ queryKey: ['admin-firmas'], queryFn: () => api.getFirmas() });
  const demosQ = useQuery({ queryKey: ['admin-demos'], queryFn: () => api.getDemos() });
  const firmas: any[] = firmasQ.data?.data || [];
  const demos: any[] = demosQ.data?.data || [];

  /* Árbol por despacho: agrupa las firmas por la emisora de su empresa (o la
   * predeterminada). Encabezados colapsables; «Sin despacho» para el resto. */
  const [colapsado, setColapsado] = useState<Set<string>>(new Set());
  const alternarGrupo = (id: string) => setColapsado((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const gruposFirmas = useMemo(() => {
    const m = new Map<string, { nombre: string; rows: any[] }>();
    for (const f of firmas) {
      const key = f.despacho_id || '__none__';
      const nombre = f.despacho_nombre || 'Sin despacho';
      if (!m.has(key)) m.set(key, { nombre, rows: [] });
      m.get(key)!.rows.push(f);
    }
    return [...m.entries()].sort((a, b) => a[0] === '__none__' ? 1 : b[0] === '__none__' ? -1 : a[1].nombre.localeCompare(b[1].nombre));
  }, [firmas]);

  /* Doble clic en el encabezado de un grupo → asignar esas empresas a un despacho
   * (emisora de cobro). Así se agrupan bajo su nombre sin ir empresa por empresa. */
  const emisorasQ = useQuery({ queryKey: ['admin-emisores'], queryFn: () => api.adminListEmisores() });
  const emisoras: any[] = ((emisorasQ.data as any)?.data?.emisores || []).filter((e: any) => e.es_emisor);
  const [asignar, setAsignar] = useState<{ nombre: string; companyIds: string[] } | null>(null);
  const [asignando, setAsignando] = useState(false);
  const hacerAsignar = async (emisoraId: string | null) => {
    if (!asignar) return;
    setAsignando(true);
    try {
      await api.asignarEmisoraEmpresas(asignar.companyIds, emisoraId);
      setAsignar(null);
      qc.invalidateQueries({ queryKey: ['admin-firmas'] });
    } catch (e: any) { alert(e?.response?.data?.message || 'No se pudo agrupar.'); }
    finally { setAsignando(false); }
  };

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
              {gruposFirmas.map(([key, g]) => (
                <Fragment key={key}>
                  <tr className="bg-indigo-50/70 border-y border-indigo-100">
                    <td colSpan={6} className="px-4 py-1.5">
                      <button onClick={() => alternarGrupo(key)}
                        onDoubleClick={() => setAsignar({ nombre: g.nombre, companyIds: g.rows.map((r: any) => r.company_id).filter(Boolean) })}
                        title="Doble clic para asignar estas empresas a un despacho (emisora)"
                        className="flex items-center gap-1.5 text-sm font-semibold text-indigo-800 hover:text-indigo-900 select-none">
                        {colapsado.has(key) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        {g.nombre}
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">{g.rows.length}</span>
                        <span className="text-[10px] font-normal text-indigo-400 ml-1">doble clic para nombrar el despacho</span>
                      </button>
                    </td>
                  </tr>
                  {!colapsado.has(key) && g.rows.map((f: any) => (
                <tr key={f.id} className={`hover:bg-gray-50 ${f.estado === 'ATENDIDA' ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-2 text-sm text-gray-600 whitespace-nowrap pl-8">{f.firmado}</td>
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
                </Fragment>
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

      {asignar && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setAsignar(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h3 className="font-bold text-gray-900 flex items-center gap-2"><Building2 size={18} className="text-indigo-600" /> Asignar a un despacho</h3>
              <button onClick={() => setAsignar(null)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <p className="text-gray-600">Vas a agrupar las <b>{asignar.companyIds.length}</b> empresa(s) de «{asignar.nombre}» bajo una <b>emisora de cobro</b> (el despacho que las factura). Se agruparán por ese nombre en todas las pantallas.</p>
              {emisoras.length === 0 ? (
                <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">No hay emisoras marcadas. Primero marca una empresa como emisora de cobro en <b>Súper Admin → Emisor de facturas</b>.</p>
              ) : (
                <div className="space-y-1.5">
                  {emisoras.map((e) => (
                    <button key={e.id} onClick={() => hacerAsignar(e.id)} disabled={asignando}
                      className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50">
                      <span className="font-medium text-gray-800">{e.business_name}</span> <span className="text-[11px] text-gray-400 font-mono">{e.rfc}</span>
                      {e.predeterminado && <span className="ml-1 text-[10px] text-indigo-600">(predeterminada)</span>}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => hacerAsignar(null)} disabled={asignando}
                className="text-xs text-gray-500 hover:underline">Quitar despacho (dejar sin agrupar)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDemosPage;
