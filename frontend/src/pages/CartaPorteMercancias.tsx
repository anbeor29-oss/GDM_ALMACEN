/**
 * CartaPorteMercancias — vista de mercancías transportadas.
 *
 *   · Tab "Catálogo" — plantillas reusables (dedup por claveSat+desc+cliente).
 *   · Tab "Bitácora" — rastro por viaje para inspecciones SAT.
 *
 * NO es inventario propio (eso vive en Productos). Aquí se registra la
 * mercancía de clientes que la empresa transporta.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Search, Package, ClipboardList } from 'lucide-react';
import api from '@/services/api';

export function CartaPorteMercanciasPage() {
  const [tab, setTab] = useState<'catalog' | 'bitacora'>('catalog');
  const [search, setSearch] = useState('');
  const qc = useQueryClient();

  const catalog = useQuery({
    queryKey: ['mercancias-catalog', search],
    queryFn: () => api.listMercanciasCatalog({ search: search || undefined }),
    enabled: tab === 'catalog',
  });

  const bitacora = useQuery({
    queryKey: ['mercancias-bitacora'],
    queryFn: () => api.listMercanciasBitacora(),
    enabled: tab === 'bitacora',
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.deleteMercanciaCatalog(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mercancias-catalog'] }),
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span>📦</span> Mercancías transportadas
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Mercancía de clientes en tránsito. <b>No es inventario propio</b> — se registra para inspecciones SAT.
          </p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200 mb-4">
        <button
          onClick={() => setTab('catalog')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${
            tab === 'catalog' ? 'border-rose-500 text-rose-700' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Package size={16} /> Catálogo (plantillas)
        </button>
        <button
          onClick={() => setTab('bitacora')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${
            tab === 'bitacora' ? 'border-rose-500 text-rose-700' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <ClipboardList size={16} /> Bitácora (viajes)
        </button>
      </div>

      {tab === 'catalog' && (
        <div>
          <div className="mb-4 flex items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por descripción o clave SAT…"
                className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <span className="text-xs text-slate-500">{catalog.data?.items?.length ?? 0} mercancías</span>
          </div>

          {catalog.isLoading ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
                  <tr>
                    <th className="text-left px-4 py-3">Clave SAT</th>
                    <th className="text-left px-4 py-3">Descripción</th>
                    <th className="text-left px-4 py-3">Unidad</th>
                    <th className="text-right px-4 py-3">Peso/u (kg)</th>
                    <th className="text-right px-4 py-3">Valor/u</th>
                    <th className="text-left px-4 py-3">Cliente típico</th>
                    <th className="text-right px-4 py-3">Veces</th>
                    <th className="w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {(catalog.data?.items || []).map((m: any) => (
                    <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-xs">{m.clave_sat}</td>
                      <td className="px-4 py-2">{m.descripcion}</td>
                      <td className="px-4 py-2 text-xs">{m.clave_unidad || '—'}</td>
                      <td className="px-4 py-2 text-right">{m.peso_unitario_kg ? Number(m.peso_unitario_kg).toFixed(2) : '—'}</td>
                      <td className="px-4 py-2 text-right">
                        {m.valor_unitario ? `$${Number(m.valor_unitario).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {m.cliente_nombre || m.cliente_rfc || <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right font-medium">{m.veces_transportada}</td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => { if (confirm(`¿Eliminar "${m.descripcion}" del catálogo?`)) delMut.mutate(m.id); }}
                          className="text-rose-500 hover:text-rose-700"
                          title="Eliminar del catálogo (no borra bitácora)"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(catalog.data?.items || []).length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-sm text-slate-500">
                        Sin mercancías en el catálogo. Importa un XML de Carta Porte desde el Super Lector.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'bitacora' && (
        <div>
          <p className="text-xs text-slate-500 mb-3">
            Últimos viajes registrados. Cada renglón es una mercancía en un viaje específico — es el rastro fiscal para inspecciones.
          </p>
          {bitacora.isLoading ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
                  <tr>
                    <th className="text-left px-4 py-3">Fecha viaje</th>
                    <th className="text-left px-4 py-3">Clave SAT</th>
                    <th className="text-left px-4 py-3">Descripción</th>
                    <th className="text-right px-4 py-3">Cant</th>
                    <th className="text-right px-4 py-3">Peso (kg)</th>
                    <th className="text-right px-4 py-3">Valor</th>
                    <th className="text-left px-4 py-3">Remitente</th>
                    <th className="text-left px-4 py-3">Destinatario</th>
                    <th className="text-left px-4 py-3">UUID</th>
                  </tr>
                </thead>
                <tbody>
                  {(bitacora.data?.items || []).map((m: any) => (
                    <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 text-xs whitespace-nowrap">
                        {m.fecha_viaje ? new Date(m.fecha_viaje).toLocaleDateString('es-MX') : '—'}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{m.clave_sat}</td>
                      <td className="px-4 py-2 max-w-[280px] truncate" title={m.descripcion}>{m.descripcion}</td>
                      <td className="px-4 py-2 text-right">{Number(m.cantidad).toFixed(2)} {m.clave_unidad}</td>
                      <td className="px-4 py-2 text-right">{m.peso_kg ? Number(m.peso_kg).toFixed(2) : '—'}</td>
                      <td className="px-4 py-2 text-right">
                        {m.valor_mercancia ? `$${Number(m.valor_mercancia).toLocaleString('es-MX')}` : '—'}
                      </td>
                      <td className="px-4 py-2 text-xs">{m.remitente_nombre || m.remitente_rfc || '—'}</td>
                      <td className="px-4 py-2 text-xs">{m.destinatario_nombre || m.destinatario_rfc || '—'}</td>
                      <td className="px-4 py-2 font-mono text-[10px] text-slate-400">{m.uuid_cfdi?.slice(0, 8) || '—'}</td>
                    </tr>
                  ))}
                  {(bitacora.data?.items || []).length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-sm text-slate-500">
                        Sin viajes registrados aún.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
