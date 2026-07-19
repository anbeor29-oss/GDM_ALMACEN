/**
 * LugarPicker — modal para elegir un lugar frecuente del catálogo por empresa.
 * Estilo similar a CatalogPicker (búsqueda debounced, click para seleccionar).
 */

import { useEffect, useRef, useState } from 'react';
import { X, Search, MapPin } from 'lucide-react';
import api from '@/services/api';

export interface Lugar {
  id: string;
  alias: string;
  tipo_default: 'Origen' | 'Destino' | null;
  rfc: string;
  nombre: string | null;
  calle: string | null;
  num_exterior: string | null;
  estado: string;
  codigo_postal: string;
  usos: number;
}

interface Props {
  open: boolean;
  tipo: 'Origen' | 'Destino';
  onClose: () => void;
  onSelect: (l: Lugar) => void;
}

export function LugarPicker({ open, tipo, onClose, onSelect }: Props) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Lugar[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQ(''); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await api.listCPLugares(q || undefined, tipo);
        setItems(rows);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, tipo, open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-16" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[720px] max-w-[92vw] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <MapPin size={16} className="text-emerald-700" /> Lugares frecuentes ({tipo})
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="px-4 py-3 border-b border-slate-200">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar por alias, nombre o RFC…"
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-center text-sm text-slate-400">Buscando…</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-center text-sm text-slate-400">
              {q ? 'Sin resultados' : 'Aún no tienes lugares guardados. Marca "Guardar en Lugares frecuentes" al capturar una ubicación.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map(it => (
                <li key={it.id}>
                  <button
                    onClick={() => onSelect(it)}
                    className="w-full text-left px-4 py-3 hover:bg-emerald-50 flex gap-3 items-start"
                  >
                    <span className={`px-2 py-0.5 rounded text-[10px] shrink-0 ${it.tipo_default === 'Origen' ? 'bg-sky-100 text-sky-700' : it.tipo_default === 'Destino' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                      {it.tipo_default || 'Ambos'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800">{it.alias}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        <span className="font-mono">{it.rfc}</span>
                        {it.nombre && <> · {it.nombre}</>}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {[it.calle, it.num_exterior].filter(Boolean).join(' ')} · {it.estado} · CP {it.codigo_postal}
                      </p>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">{it.usos} usos</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
