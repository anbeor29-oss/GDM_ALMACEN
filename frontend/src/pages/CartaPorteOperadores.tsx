/**
 * CartaPorteOperadores — figuras de transporte por empresa.
 * Tipo 01=Operador exige NumLicencia (SAT); resto no.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCog, Plus, Pencil, Trash2, Search, X, Save } from 'lucide-react';
import api from '@/services/api';

interface Operador { id: string; alias: string; tipo_figura: string; rfc: string; nombre: string; num_licencia: string | null; usos: number; }
const blank = () => ({ alias: '', tipoFigura: '01', rfc: '', numLicencia: '', nombre: '', numRegIdTrib: '', residenciaFiscal: '' });
const TIPOS: Record<string, string> = { '01': 'Operador', '02': 'Propietario', '03': 'Arrendador', '04': 'Notificado' };

export function CartaPorteOperadoresPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState('');
  const [modal, setModal] = useState<{ open: boolean; editingId: string | null; form: any }>({ open: false, editingId: null, form: blank() });
  const [err, setErr] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<Operador[]>({
    queryKey: ['cp-operadores', q, tipo],
    queryFn: () => api.listCPOperadores(q || undefined, tipo || undefined),
  });

  const save = useMutation({
    mutationFn: async () => {
      setErr(null);
      if (modal.editingId) return api.updateCPOperador(modal.editingId, modal.form);
      return api.createCPOperador(modal.form);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cp-operadores'] }); setModal({ open: false, editingId: null, form: blank() }); },
    onError: (e: any) => setErr(e?.response?.data?.error || e?.message || 'Error'),
  });
  const del = useMutation({ mutationFn: (id: string) => api.deleteCPOperador(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['cp-operadores'] }) });

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-fuchsia-100 rounded-lg"><UserCog size={26} className="text-fuchsia-700" /></div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">Operadores</h1>
            <p className="text-sm text-slate-500">Figuras de transporte (choferes, propietarios, arrendadores)</p>
          </div>
        </div>
        <button onClick={() => setModal({ open: true, editingId: null, form: blank() })} className="inline-flex items-center gap-2 px-4 py-2 bg-fuchsia-600 hover:bg-fuchsia-700 text-white rounded-lg text-sm font-medium">
          <Plus size={18} /> Nuevo operador
        </button>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por alias, nombre o RFC…" className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500" />
        </div>
        <select value={tipo} onChange={e => setTipo(e.target.value)} className="input" style={{ maxWidth: 220 }}>
          <option value="">Todos los tipos</option>
          {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Alias</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Tipo</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">RFC</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Nombre</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Licencia</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">Usos</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                <UserCog size={40} className="mx-auto mb-3 text-slate-300" />
                <p className="font-medium">Sin operadores aún</p>
              </td></tr>
            ) : rows.map(o => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{o.alias}</td>
                <td className="px-4 py-3"><span className="px-2 py-0.5 rounded text-xs bg-fuchsia-100 text-fuchsia-700">{o.tipo_figura} · {TIPOS[o.tipo_figura] || '?'}</span></td>
                <td className="px-4 py-3 font-mono text-xs">{o.rfc}</td>
                <td className="px-4 py-3 text-xs">{o.nombre}</td>
                <td className="px-4 py-3 font-mono text-xs">{o.num_licencia || <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-3 text-right text-xs text-slate-500">{o.usos}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-1">
                    <button onClick={() => setModal({ open: true, editingId: o.id, form: { alias: o.alias, tipoFigura: o.tipo_figura, rfc: o.rfc, numLicencia: o.num_licencia || '', nombre: o.nombre, numRegIdTrib: '', residenciaFiscal: '' } })} className="p-1.5 text-sky-600 hover:bg-sky-50 rounded"><Pencil size={14} /></button>
                    <button onClick={() => { if (confirm(`¿Eliminar "${o.alias}"?`)) del.mutate(o.id); }} className="p-1.5 text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal.open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-16" onClick={() => setModal({ open: false, editingId: null, form: blank() })}>
          <div className="bg-white rounded-lg shadow-xl w-[720px] max-w-[95vw]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <h3 className="font-semibold text-slate-800">{modal.editingId ? 'Editar operador' : 'Nuevo operador'}</h3>
              <button onClick={() => setModal({ open: false, editingId: null, form: blank() })} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {err && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{err}</div>}
              <div className="grid grid-cols-3 gap-3">
                <F label="Alias" required span={2}><input value={modal.form.alias} onChange={e => setModal({ ...modal, form: { ...modal.form, alias: e.target.value } })} className="input" placeholder="Juan Molina Ochoa" /></F>
                <F label="Tipo figura" required>
                  <select value={modal.form.tipoFigura} onChange={e => setModal({ ...modal, form: { ...modal.form, tipoFigura: e.target.value } })} className="input">
                    {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
                  </select>
                </F>
                <F label="RFC" required><input value={modal.form.rfc} onChange={e => setModal({ ...modal, form: { ...modal.form, rfc: e.target.value.toUpperCase() } })} maxLength={13} className="input font-mono" /></F>
                <F label="Nombre completo" required span={2}><input value={modal.form.nombre} onChange={e => setModal({ ...modal, form: { ...modal.form, nombre: e.target.value } })} maxLength={300} className="input" /></F>
                <F label="Núm. licencia (obligatorio si tipo=01)" span={2}><input value={modal.form.numLicencia} onChange={e => setModal({ ...modal, form: { ...modal.form, numLicencia: e.target.value } })} maxLength={20} className="input font-mono" /></F>
                <F label="Residencia fiscal (extranjero)"><input value={modal.form.residenciaFiscal} onChange={e => setModal({ ...modal, form: { ...modal.form, residenciaFiscal: e.target.value.toUpperCase() } })} maxLength={3} className="input font-mono" /></F>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg">
              <button onClick={() => setModal({ open: false, editingId: null, form: blank() })} className="px-4 py-2 text-sm text-slate-600">Cancelar</button>
              <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-2 px-4 py-2 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:bg-slate-300 text-white rounded text-sm font-medium">
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
  const cls = span === 2 ? 'col-span-2' : span === 3 ? 'col-span-3' : '';
  return <label className={`block ${cls}`}><span className="block text-xs text-slate-500 mb-1">{label} {required && <span className="text-red-500">*</span>}</span>{children}</label>;
}
