/**
 * CatalogPicker — modal universal para elegir un valor de un catálogo SAT.
 *
 * Uso:
 *   const [open, setOpen] = useState(false);
 *   ...
 *   <CatalogPicker
 *     name="clave-prod-serv"
 *     title="Clave de producto/servicio"
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     onSelect={(item) => { setClave(item.clave); setOpen(false); }}
 *   />
 *
 * Búsqueda: mientras teclea, hace GET /carta-porte/catalogs/:name?q=... (debounced).
 * Muestra hasta 50 resultados. Cierra con Esc o click fuera.
 */

import { useEffect, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import api from '@/services/api';

export interface CatalogItem {
  clave: string;
  descripcion: string;
  [key: string]: any;
}

interface Props {
  name: string;          // slug del catálogo (ver carta-porte-catalogs.routes.ts)
  title: string;         // heading del modal
  open: boolean;
  onClose: () => void;
  onSelect: (item: CatalogItem) => void;
  showExtras?: string[]; // cols extra a mostrar (ej: ['nombre'] para claveUnidad)
}

export function CatalogPicker({ name, title, open, onClose, onSelect, showExtras = [] }: Props) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setItems([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.searchCartaPorteCatalog(name, q);
        setItems(res.items || []);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, name, open]);

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
          <h3 className="font-semibold text-slate-800">{title}</h3>
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
              placeholder="Escribe clave o parte de la descripción…"
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-center text-sm text-slate-400">Buscando…</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-center text-sm text-slate-400">{q ? 'Sin resultados' : 'Escribe para buscar'}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map(it => (
                <li key={it.clave}>
                  <button
                    onClick={() => onSelect(it)}
                    className="w-full text-left px-4 py-2.5 hover:bg-sky-50 flex gap-3 items-start"
                  >
                    <span className="font-mono text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded shrink-0">{it.clave}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-800 leading-tight">{it.descripcion}</p>
                      {showExtras.length > 0 && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {showExtras.map(k => it[k]).filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
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
