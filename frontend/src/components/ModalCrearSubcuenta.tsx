/**
 * Alta RÁPIDA de una subcuenta cuando, al asignar, la cuenta no existe todavía.
 *
 * En vez de guardar un código que no está en el catálogo (y que descuadra la
 * póliza), esta pantallita ofrece CREARLA: muestra la cuenta de MAYOR de la que
 * colgará —adivinada del código o el rubro— y propone la subcuenta con su número
 * (`<mayor>-001`, como los terceros) y un nombre que ya trae puesto (la
 * descripción del producto o el nombre del tercero). Se crea y se asigna sola.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Loader2, CornerDownRight } from 'lucide-react';
import api from '@/services/api';
import { formatCuenta } from '@/utils/cuenta';

/** Anchos de segmento de la máscara ('#-##-##-###' → [1,2,2,3]). */
function anchosDeMascara(m?: string): number[] | null {
  if (!m) return null;
  const a = (m.match(/#+/g) || []).map((g) => g.length);
  return a.length >= 2 ? a : null;
}
/** Ancestros de un código, del más cercano al más lejano (para adivinar el mayor). */
function ancestrosDe(codigo: string, anchos: number[] | null): string[] {
  const base = codigo.replace(/-\d+$/, '');            // si es <base>-NNN, el mayor es <base>
  const out: string[] = [];
  if (base !== codigo) out.push(base);
  const c = base;
  if (anchos && anchos.reduce((x, y) => x + y, 0) === c.length) {
    const segs: Array<[number, number]> = [];
    let i = 0;
    for (const w of anchos) { segs.push([i, i + w]); i += w; }
    let ultimo = -1;
    for (let k = 0; k < segs.length; k++) if (!/^0+$/.test(c.slice(segs[k][0], segs[k][1]))) ultimo = k;
    for (let k = ultimo; k >= 1; k--) {
      const ch = c.split('');
      for (let s = k; s < segs.length; s++) for (let p = segs[s][0]; p < segs[s][1]; p++) ch[p] = '0';
      out.push(ch.join(''));
    }
  } else {
    const n = c.length;
    for (let k = 1; k < n; k++) out.push(c.slice(0, n - k) + '0'.repeat(k));
  }
  return out;
}

export function ModalCrearSubcuenta({
  codigo, sugerirNombre, mascara, onHecho, onCerrar,
}: {
  codigo: string;
  sugerirNombre?: string;
  mascara?: string;
  onHecho: (codigo: string) => void;
  onCerrar: () => void;
}) {
  const ctasQ = useQuery({ queryKey: ['ctas-todas'], queryFn: () => api.getCuentasContables() });
  const cuentas: any[] = ctasQ.data?.data?.cuentas || [];

  // Candidatas a MAYOR: las acumulativas o las que ya tienen hijas (los controles).
  const mayores = useMemo(
    () => cuentas.filter((c) => !c.permite_movimientos || Number(c.hijos) > 0),
    [cuentas]);

  // Mayor sugerido: el ancestro EXISTENTE más cercano al código tecleado.
  const sugerido = useMemo(() => {
    const porCodigo = new Map<string, any>(cuentas.map((c) => [c.codigo, c]));
    for (const anc of ancestrosDe(codigo, anchosDeMascara(mascara))) {
      const c = porCodigo.get(anc);
      if (c) return c;
    }
    return null;
  }, [cuentas, codigo, mascara]);

  const [mayorId, setMayorId] = useState('');
  const [nombre, setNombre] = useState(sugerirNombre || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Al cargar/cambiar el catálogo, fija el mayor sugerido si aún no se eligió uno.
  const mayorSel = mayores.find((m) => m.id === mayorId) || sugerido || mayores[0] || null;

  // Código propuesto: <mayor con guiones>-NNN, con NNN = mayor sufijo dash + 1.
  const propuesto = useMemo(() => {
    if (!mayorSel) return '';
    const base = String(mayorSel.codigo).replace(/\./g, '-');
    const usados = new Set(cuentas.map((c) => c.codigo));
    let n = 1;
    for (const c of cuentas) {
      if (c.parent_id !== mayorSel.id) continue;
      const m = /-(\d+)\s*$/.exec(String(c.codigo));
      if (m) n = Math.max(n, Number(m[1]) + 1);
    }
    let cod = `${base}-${String(n).padStart(3, '0')}`;
    while (usados.has(cod)) { n++; cod = `${base}-${String(n).padStart(3, '0')}`; }
    return cod;
  }, [mayorSel, cuentas]);

  const crear = async () => {
    if (!mayorSel) { setError('Elige la cuenta de mayor de la que colgará.'); return; }
    if (!nombre.trim()) { setError('Ponle un nombre a la subcuenta.'); return; }
    setBusy(true); setError('');
    try {
      await api.crearCuentaContable({
        parentId: mayorSel.id,
        codigo: propuesto,
        nombre: nombre.trim(),
        codigoAgrupador: mayorSel.codigo_agrupador || undefined,
      });
      onHecho(propuesto);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo crear la cuenta.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-900">Crear la cuenta que falta</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {ctasQ.isLoading ? (
            <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Cargando el catálogo…</p>
          ) : (<>
            <p className="text-xs text-gray-500">
              El código <b className="font-mono">{codigo}</b> no existe. Cuélgalo de su cuenta de mayor
              y dale nombre — se crea y se asigna aquí mismo.
            </p>

            {/* Cuenta de MAYOR (agrupadora) */}
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Cuenta de mayor (de la que cuelga)</span>
              <select value={mayorSel?.id || ''} onChange={(e) => setMayorId(e.target.value)}
                className="input w-full mt-1 text-sm">
                {mayores.map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatCuenta(m.codigo, mascara)} — {m.nombre}
                  </option>
                ))}
              </select>
            </label>

            {/* La SUBCUENTA nueva */}
            <div className="bg-gray-50 border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CornerDownRight size={15} className="text-gray-400" />
                <span className="font-mono text-gray-800">{propuesto ? formatCuenta(propuesto, mascara) : '—'}</span>
                <span className="text-[11px] text-gray-400">número automático</span>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Nombre</span>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus
                  placeholder="Nombre de la cuenta" className="input w-full mt-1 text-sm" />
              </label>
              {mayorSel?.codigo_agrupador && (
                <p className="text-[11px] text-gray-500">
                  Hereda el agrupador SAT <b className="font-mono">{mayorSel.codigo_agrupador}</b> y el tipo de su mayor.
                </p>
              )}
            </div>

            {error && <p className="text-sm text-rose-600">{error}</p>}
          </>)}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onCerrar} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
          <button onClick={crear} disabled={busy || ctasQ.isLoading || !mayorSel}
            className="flex items-center gap-1.5 bg-primary text-white px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
            {busy && <Loader2 size={14} className="animate-spin" />} Crear y asignar
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModalCrearSubcuenta;
