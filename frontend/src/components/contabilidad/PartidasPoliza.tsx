/**
 * PartidasPoliza — la tabla de cargos y abonos de una póliza, en UN solo lugar.
 *
 * La usan el editor de pólizas (modal) y la póliza manual, para que las dos se
 * vean y se capturen igual (misma paleta índigo/azul/violeta, mismos formatos):
 *   · Cuenta (código) en un combo angosto.
 *   · Nombre de la cuenta en su propio combo de texto (elegir por nombre llena el
 *     código, y al revés).
 *   · Concepto.
 *   · Debe y Haber como importe #,###.## (sin los botones de subir/bajar), con
 *     «−» para que el sistema cuadre el renglón.
 *
 * El estado (las líneas) vive en el padre; aquí sólo se pintan y se avisan los
 * cambios con `onLinea(i, patch)`.
 */
import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';

/** #,###.## con dos decimales, sin símbolo — el formato contable de importes. */
export const fmt2 = (n: any) =>
  new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

export interface LineaPoliza {
  codigo: string;
  nombre?: string;
  concepto: string;
  cargo: string;
  abono: string;
}

/**
 * Un campo de importe: se ve como #,###.## cuando no se edita, y en crudo
 * mientras se escribe. Sin `type number` (no salen los botones de subir/bajar);
 * «−» pide cuadrar el renglón.
 */
export function CampoImporte({ value, onChange, onMinus, className }: {
  value: string; onChange: (v: string) => void; onMinus: () => void; className?: string;
}) {
  const [foco, setFoco] = useState(false);
  const [draft, setDraft] = useState('');
  const mostrado = foco ? draft : (value ? fmt2(value) : '');
  return (
    <input
      type="text" inputMode="decimal" value={mostrado}
      onFocus={() => { setDraft(value); setFoco(true); }}
      onBlur={() => setFoco(false)}
      onChange={(e) => { const limpio = e.target.value.replace(/[^\d.]/g, ''); setDraft(limpio); onChange(limpio); }}
      onKeyDown={(e) => { if (e.key === '-') { e.preventDefault(); onMinus(); (e.target as HTMLInputElement).blur(); } }}
      title="− para cuadrar"
      className={className}
    />
  );
}

export function PartidasPoliza({
  lineas, cuentas, sumaCargo, sumaAbono, onLinea, onCuadrar, onQuitar, idBase,
}: {
  lineas: LineaPoliza[];
  cuentas: any[];
  sumaCargo: number;
  sumaAbono: number;
  onLinea: (i: number, patch: Partial<LineaPoliza>) => void;
  onCuadrar: (i: number, campo: 'cargo' | 'abono') => void;
  onQuitar: (i: number) => void;
  idBase: string;
}) {
  const nombreDe = useMemo(() => new Map<string, string>(cuentas.map((c: any) => [c.codigo, c.nombre])), [cuentas]);
  const codigoDeNombre = useMemo(() => new Map<string, string>(cuentas.map((c: any) => [c.nombre, c.codigo])), [cuentas]);
  const idCod = `${idBase}-cuentas`;
  const idNom = `${idBase}-nombres`;

  return (
    <div className="border rounded-lg overflow-x-auto">
      <datalist id={idCod}>
        {cuentas.map((c) => <option key={c.id} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
      </datalist>
      <datalist id={idNom}>
        {cuentas.map((c) => <option key={c.id} value={c.nombre}>{c.codigo}</option>)}
      </datalist>

      <table className="w-full text-sm">
        <thead className="border-b border-indigo-200 bg-indigo-50/60">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-indigo-900 w-32">Cuenta</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-indigo-900 w-56">Nombre de la cuenta</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-indigo-900">Concepto</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-sky-800 w-36 bg-sky-100/70">Debe</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-violet-800 w-36 bg-violet-100/70">Haber</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {lineas.map((l, i) => {
            const invalido = !!l.codigo && !nombreDe.has(l.codigo);
            return (
              <tr key={i}>
                <td className="px-2 py-1.5 align-top">
                  <input list={idCod} value={l.codigo} placeholder="Cuenta"
                    onChange={(e) => onLinea(i, { codigo: e.target.value, ...(nombreDe.has(e.target.value) ? { nombre: nombreDe.get(e.target.value)! } : {}) })}
                    className={`border rounded px-2 py-1 text-sm w-full font-mono ${invalido ? 'border-rose-400 text-rose-700' : ''}`} />
                  {invalido && <span className="text-[11px] text-rose-500 block">no existe</span>}
                </td>
                <td className="px-2 py-1.5 align-top">
                  <input list={idNom} value={l.nombre || ''} placeholder="Nombre de la cuenta"
                    onChange={(e) => onLinea(i, { nombre: e.target.value, ...(codigoDeNombre.has(e.target.value) ? { codigo: codigoDeNombre.get(e.target.value)! } : {}) })}
                    className="border rounded px-2 py-1 text-sm w-full" />
                </td>
                <td className="px-2 py-1.5 align-top">
                  <input value={l.concepto} onChange={(e) => onLinea(i, { concepto: e.target.value })}
                    className="border rounded px-2 py-1 text-sm w-full" />
                </td>
                <td className="px-2 py-1.5 align-top bg-sky-50/40">
                  <CampoImporte value={l.cargo} onChange={(v) => onLinea(i, { cargo: v })} onMinus={() => onCuadrar(i, 'cargo')}
                    className="border rounded px-2 py-1 text-sm w-full text-right tabular-nums outline-none focus:ring-2 focus:ring-sky-300" />
                </td>
                <td className="px-2 py-1.5 align-top bg-violet-50/40">
                  <CampoImporte value={l.abono} onChange={(v) => onLinea(i, { abono: v })} onMinus={() => onCuadrar(i, 'abono')}
                    className="border rounded px-2 py-1 text-sm w-full text-right tabular-nums outline-none focus:ring-2 focus:ring-violet-300" />
                </td>
                <td className="px-1 align-top pt-2">
                  <button onClick={() => onQuitar(i)} title="Quitar renglón" className="text-gray-300 hover:text-rose-500"><Trash2 size={14} /></button>
                </td>
              </tr>
            );
          })}
          <tr className="font-semibold bg-indigo-50 border-t border-indigo-200">
            <td colSpan={3} className="px-3 py-2 text-right text-indigo-900">Sumas</td>
            <td className="px-3 py-2 text-right tabular-nums text-sky-900">{fmt2(sumaCargo)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-violet-900">{fmt2(sumaAbono)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
