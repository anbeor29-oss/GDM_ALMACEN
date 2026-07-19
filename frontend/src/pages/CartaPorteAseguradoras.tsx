/**
 * CartaPorteAseguradoras — pólizas de la empresa para CP.
 * Tres tipos: RespCivil (obligatoria), MedAmbiente (materiales peligrosos),
 * Carga (si el cliente lo pide).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Plus, Pencil, Trash2, Search, X, Save } from 'lucide-react';
import api from '@/services/api';

interface Aseguradora {
  id: string; alias: string; tipo: 'RespCivil' | 'MedAmbiente' | 'Carga';
  nombre_aseguradora: string; num_poliza: string; prima_seguro: number | null; usos: number;
}
const blank = () => ({ alias: '', tipo: 'RespCivil', nombreAseguradora: '', numPoliza: '', primaSeguro: '' });
const TIPO_LABEL: Record<string, string> = { RespCivil: 'Resp. Civil', MedAmbiente: 'Medio Ambiente', Carga: 'Carga' };
const TIPO_COLOR: Record<string, string> = { RespCivil: 'sky', MedAmbiente: 'emerald', Carga: 'amber' };

export function CartaPorteAseguradorasPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState<'' | 'RespCivil' | 'MedAmbiente' | 'Carga'>('');
  const [modal, setModal] = useState<{ open: boolean; editingId: string | null; form: any }>({ open: false, editingId: null, form: blank() });
  const [err, setErr] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<Aseguradora[]>({
    queryKey: ['cp-aseguradoras', q, tipo],
    queryFn: () => api.listCPAseguradoras(q || undefined, tipo || undefined),
  });

  const save = useMutation({
    mutationFn: async () => {
      setErr(null);
      const payload = { ...modal.form, primaSeguro: modal.form.primaSeguro || undefined };
      if (modal.editingId) return api.updateCPAseguradora(modal.editingId, payload);
      return api.createCPAseguradora(payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cp-aseguradoras'] }); setModal({ open: false, editingId: null, form: blank() }); },
    onError: (e: any) => setErr(e?.response?.data?.error || e?.message || 'Error'),
  });
  const del = useMutation({ mutationFn: (id: string) => api.deleteCPAseguradora(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['cp-aseguradoras'] }) });

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-sky-100 rounded-lg"><Shield size={26} className="text-sky-700" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Aseguradoras</h1>
            <p className="text-sm text-slate-500">Pólizas por tipo para Carta Porte</p>
          </div>
        </div>
        <button onClick={() => setModal({ open: true, editingId: null, form: blank() })} className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-medium">
          <Plus size={18} /> Nueva póliza
        </button>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por alias, nombre o póliza…" className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        </div>
        <select value={tipo} onChange={e => setTipo(e.target.value as any)} className="input" style={{ maxWidth: 220 }}>
          <option value="">Todos los tipos</option>
          <option value="RespCivil">Resp. Civil</option>
          <option value="MedAmbiente">Medio Ambiente</option>
          <option value="Carga">Carga</option>
        </select>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Alias</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Tipo</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Aseguradora</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Póliza</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">Prima</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                <Shield size={40} className="mx-auto mb-3 text-slate-300" />
                <p className="font-medium">Sin pólizas aún</p>
              </td></tr>
            ) : rows.map(a => (
              <tr key={a.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{a.alias}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs bg-${TIPO_COLOR[a.tipo]}-100 text-${TIPO_COLOR[a.tipo]}-700`}>
                    {TIPO_LABEL[a.tipo]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">{a.nombre_aseguradora}</td>
                <td className="px-4 py-3 font-mono text-xs">{a.num_poliza}</td>
                <td className="px-4 py-3 text-right text-xs">{a.prima_seguro ? `$${Number(a.prima_seguro).toFixed(2)}` : <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-1">
                    <button onClick={() => setModal({ open: true, editingId: a.id, form: { alias: a.alias, tipo: a.tipo, nombreAseguradora: a.nombre_aseguradora, numPoliza: a.num_poliza, primaSeguro: a.prima_seguro ? String(a.prima_seguro) : '' } })} className="p-1.5 text-sky-600 hover:bg-sky-50 rounded"><Pencil size={14} /></button>
                    <button onClick={() => { if (confirm(`¿Eliminar "${a.alias}"?`)) del.mutate(a.id); }} className="p-1.5 text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal.open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-16" onClick={() => setModal({ open: false, editingId: null, form: blank() })}>
          <div className="bg-white rounded-lg shadow-xl w-[600px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <h3 className="font-semibold text-slate-800">{modal.editingId ? 'Editar póliza' : 'Nueva póliza'}</h3>
              <button onClick={() => setModal({ open: false, editingId: null, form: blank() })} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {err && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{err}</div>}
              <div className="grid grid-cols-2 gap-3">
                <F label="Alias" required span={2}><input value={modal.form.alias} onChange={e => setModal({ ...modal, form: { ...modal.form, alias: e.target.value } })} className="input" placeholder="MAPS Resp. Civil - 20312279" /></F>
                <F label="Tipo" required>
                  <select value={modal.form.tipo} onChange={e => setModal({ ...modal, form: { ...modal.form, tipo: e.target.value } })} className="input">
                    <option value="RespCivil">Responsabilidad Civil</option>
                    <option value="MedAmbiente">Medio Ambiente</option>
                    <option value="Carga">Carga</option>
                  </select>
                </F>
                <F label="Prima seguro (Carga)"><input type="number" step="0.01" value={modal.form.primaSeguro} onChange={e => setModal({ ...modal, form: { ...modal.form, primaSeguro: e.target.value } })} className="input" placeholder="Opcional" /></F>
                <F label="Nombre aseguradora" required span={2}><input value={modal.form.nombreAseguradora} onChange={e => setModal({ ...modal, form: { ...modal.form, nombreAseguradora: e.target.value } })} maxLength={150} className="input" /></F>
                <F label="Número de póliza" required span={2}><input value={modal.form.numPoliza} onChange={e => setModal({ ...modal, form: { ...modal.form, numPoliza: e.target.value } })} maxLength={50} className="input font-mono" /></F>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg">
              <button onClick={() => setModal({ open: false, editingId: null, form: blank() })} className="px-4 py-2 text-sm text-slate-600">Cancelar</button>
              <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white rounded text-sm font-medium">
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
  const cls = span === 2 ? 'col-span-2' : '';
  return <label className={`block ${cls}`}><span className="block text-xs text-slate-500 mb-1">{label} {required && <span className="text-red-500">*</span>}</span>{children}</label>;
}
