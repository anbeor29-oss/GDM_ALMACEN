/**
 * CartaPorteVehiculos — flota de la empresa para Carta Porte.
 * Estilo idéntico a Productos: tabla + modal alta/edición + soft delete.
 * Referencia aseguradoras existentes vía selects.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Truck, Plus, Pencil, Trash2, Search, X, Save } from 'lucide-react';
import api from '@/services/api';

interface Vehiculo {
  id: string;
  alias: string;
  perm_sct: string;
  num_permiso_sct: string;
  config_vehicular: string;
  peso_bruto_vehicular: number;
  placa_vm: string;
  anio_modelo_vm: number;
  aseguradora_resp_civil_id: string | null;
  resp_civil_nombre: string | null;
  resp_civil_poliza: string | null;
  usos: number;
}

const blank = () => ({
  alias: '', permSct: '', numPermisoSct: '', configVehicular: '',
  pesoBrutoVehicular: '', placaVm: '', anioModeloVm: String(new Date().getFullYear()),
  aseguradoraRespCivilId: '', aseguradoraMedAmbId: '', aseguradoraCargaId: '',
});

export function CartaPorteVehiculosPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<{ open: boolean; editingId: string | null; form: any }>({ open: false, editingId: null, form: blank() });
  const [err, setErr] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<Vehiculo[]>({
    queryKey: ['cp-vehiculos', q],
    queryFn: () => api.listCPVehiculos(q || undefined),
  });
  const { data: aseguradoras = [] } = useQuery<any[]>({
    queryKey: ['cp-aseguradoras-all'],
    queryFn: () => api.listCPAseguradoras(),
  });

  const save = useMutation({
    mutationFn: async () => {
      setErr(null);
      const payload = { ...modal.form };
      if (!payload.aseguradoraRespCivilId) delete payload.aseguradoraRespCivilId;
      if (!payload.aseguradoraMedAmbId)   delete payload.aseguradoraMedAmbId;
      if (!payload.aseguradoraCargaId)    delete payload.aseguradoraCargaId;
      if (modal.editingId) return api.updateCPVehiculo(modal.editingId, payload);
      return api.createCPVehiculo(payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cp-vehiculos'] }); setModal({ open: false, editingId: null, form: blank() }); },
    onError: (e: any) => setErr(e?.response?.data?.error || e?.message || 'Error'),
  });
  const del = useMutation({ mutationFn: (id: string) => api.deleteCPVehiculo(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['cp-vehiculos'] }) });

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-lg"><Truck size={26} className="text-amber-700" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Vehículos</h1>
            <p className="text-sm text-slate-500">Flota registrada para Carta Porte</p>
          </div>
        </div>
        <button onClick={() => setModal({ open: true, editingId: null, form: blank() })} className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium">
          <Plus size={18} /> Nuevo vehículo
        </button>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por alias, placa o permiso…" className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Alias</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Placa</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Config</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Año</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Permiso SCT</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Aseguradora R.C.</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">Usos</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                <Truck size={40} className="mx-auto mb-3 text-slate-300" />
                <p className="font-medium">Sin vehículos aún</p>
                <p className="text-xs mt-1">Agrega uno con "Nuevo vehículo" para reutilizarlo en tus Cartas Porte</p>
              </td></tr>
            ) : rows.map(v => (
              <tr key={v.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{v.alias}</td>
                <td className="px-4 py-3 font-mono text-xs">{v.placa_vm}</td>
                <td className="px-4 py-3 font-mono text-xs">{v.config_vehicular}</td>
                <td className="px-4 py-3 text-xs">{v.anio_modelo_vm}</td>
                <td className="px-4 py-3 text-xs">{v.perm_sct} · <span className="text-slate-500">{v.num_permiso_sct}</span></td>
                <td className="px-4 py-3 text-xs">{v.resp_civil_nombre || <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-3 text-right text-xs text-slate-500">{v.usos}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-1">
                    <button onClick={() => setModal({ open: true, editingId: v.id, form: {
                      alias: v.alias, permSct: v.perm_sct, numPermisoSct: v.num_permiso_sct,
                      configVehicular: v.config_vehicular, pesoBrutoVehicular: String(v.peso_bruto_vehicular),
                      placaVm: v.placa_vm, anioModeloVm: String(v.anio_modelo_vm),
                      aseguradoraRespCivilId: v.aseguradora_resp_civil_id || '',
                      aseguradoraMedAmbId: '', aseguradoraCargaId: '',
                    } })} className="p-1.5 text-sky-600 hover:bg-sky-50 rounded"><Pencil size={14} /></button>
                    <button onClick={() => { if (confirm(`¿Eliminar "${v.alias}"?`)) del.mutate(v.id); }} className="p-1.5 text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal.open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-12" onClick={() => setModal({ open: false, editingId: null, form: blank() })}>
          <div className="bg-white rounded-lg shadow-xl w-[900px] max-w-[95vw] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <h3 className="font-semibold text-slate-800">{modal.editingId ? 'Editar vehículo' : 'Nuevo vehículo'}</h3>
              <button onClick={() => setModal({ open: false, editingId: null, form: blank() })} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {err && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{err}</div>}
              <div className="grid grid-cols-4 gap-3">
                <F label="Alias" required span={2}><input value={modal.form.alias} onChange={e => setModal({ ...modal, form: { ...modal.form, alias: e.target.value } })} className="input" placeholder="Camión C2 - 45UV5W" /></F>
                <F label="Placa" required><input value={modal.form.placaVm} onChange={e => setModal({ ...modal, form: { ...modal.form, placaVm: e.target.value.toUpperCase() } })} maxLength={10} className="input font-mono" /></F>
                <F label="Año" required><input type="number" value={modal.form.anioModeloVm} onChange={e => setModal({ ...modal, form: { ...modal.form, anioModeloVm: e.target.value } })} className="input" /></F>
                <F label="Configuración vehicular (clave SAT)" required><input value={modal.form.configVehicular} onChange={e => setModal({ ...modal, form: { ...modal.form, configVehicular: e.target.value.toUpperCase() } })} maxLength={4} className="input font-mono" placeholder="C2, T3S2..." /></F>
                <F label="Peso bruto vehicular (ton)" required><input type="number" step="0.001" value={modal.form.pesoBrutoVehicular} onChange={e => setModal({ ...modal, form: { ...modal.form, pesoBrutoVehicular: e.target.value } })} className="input" /></F>
                <F label="Permiso SCT (clave)" required><input value={modal.form.permSct} onChange={e => setModal({ ...modal, form: { ...modal.form, permSct: e.target.value.toUpperCase() } })} className="input font-mono" placeholder="TPAF01" /></F>
                <F label="Núm. de permiso SCT" required><input value={modal.form.numPermisoSct} onChange={e => setModal({ ...modal, form: { ...modal.form, numPermisoSct: e.target.value } })} className="input" /></F>
                <F label="Aseguradora Resp. Civil (opcional)" span={2}>
                  <select value={modal.form.aseguradoraRespCivilId} onChange={e => setModal({ ...modal, form: { ...modal.form, aseguradoraRespCivilId: e.target.value } })} className="input">
                    <option value="">— sin asociar —</option>
                    {aseguradoras.filter(a => a.tipo === 'RespCivil').map((a: any) => (
                      <option key={a.id} value={a.id}>{a.alias} · {a.nombre_aseguradora} · {a.num_poliza}</option>
                    ))}
                  </select>
                </F>
                <F label="Aseguradora Medio Ambiente (opcional)" span={2}>
                  <select value={modal.form.aseguradoraMedAmbId} onChange={e => setModal({ ...modal, form: { ...modal.form, aseguradoraMedAmbId: e.target.value } })} className="input">
                    <option value="">— sin asociar —</option>
                    {aseguradoras.filter(a => a.tipo === 'MedAmbiente').map((a: any) => (
                      <option key={a.id} value={a.id}>{a.alias} · {a.num_poliza}</option>
                    ))}
                  </select>
                </F>
                <F label="Aseguradora Carga (opcional)" span={2}>
                  <select value={modal.form.aseguradoraCargaId} onChange={e => setModal({ ...modal, form: { ...modal.form, aseguradoraCargaId: e.target.value } })} className="input">
                    <option value="">— sin asociar —</option>
                    {aseguradoras.filter(a => a.tipo === 'Carga').map((a: any) => (
                      <option key={a.id} value={a.id}>{a.alias} · {a.num_poliza}</option>
                    ))}
                  </select>
                </F>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg">
              <button onClick={() => setModal({ open: false, editingId: null, form: blank() })} className="px-4 py-2 text-sm text-slate-600">Cancelar</button>
              <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white rounded text-sm font-medium">
                <Save size={16} /> {save.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function F({ label, children, required, span = 1 }: { label: string; children: React.ReactNode; required?: boolean; span?: number }) {
  const cls = span === 2 ? 'col-span-2' : span === 3 ? 'col-span-3' : span === 4 ? 'col-span-4' : '';
  return (
    <label className={`block ${cls}`}>
      <span className="block text-xs text-slate-500 mb-1">{label} {required && <span className="text-red-500">*</span>}</span>
      {children}
    </label>
  );
}
