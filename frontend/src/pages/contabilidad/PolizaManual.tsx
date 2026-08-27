/**
 * Póliza manual — cargos y abonos capturados a mano, con CUALQUIER cuenta del
 * catálogo. Las pólizas de ventas, compras y nómina sólo tocan sus cuentas; ésta
 * es para todo lo demás (ajustes, provisiones, reclasificaciones…). No se guarda
 * si no cuadra: las sumas de cargo y abono tienen que ser iguales. El UUID es
 * opcional; si se captura, liga la póliza a un CFDI.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Plus, Trash2, Save, Scale, CheckCircle2, AlertTriangle } from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

interface Linea { codigo: string; concepto: string; cargo: string; abono: string }
const filaVacia = (): Linea => ({ codigo: '', concepto: '', cargo: '', abono: '' });

const TIPOS = [
  { id: 'DIARIO', label: 'Diario' },
  { id: 'INGRESO', label: 'Ingresos' },
  { id: 'EGRESO', label: 'Egresos' },
] as const;

export function PolizaManualPage() {
  const hoy = new Date().toISOString().slice(0, 10);
  const [tipo, setTipo] = useState<'DIARIO' | 'INGRESO' | 'EGRESO'>('DIARIO');
  const [fecha, setFecha] = useState(hoy);
  const [concepto, setConcepto] = useState('');
  const [uuid, setUuid] = useState('');
  const [lineas, setLineas] = useState<Linea[]>([filaVacia(), filaVacia(), filaVacia()]);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const ctasQ = useQuery({ queryKey: ['ctas-mov'], queryFn: () => api.getCuentasContables() });
  const cuentas: any[] = (ctasQ.data?.data?.cuentas || []).filter((c: any) => c.permite_movimientos);
  const nombreDe = useMemo(() => new Map<string, string>(cuentas.map((c: any) => [c.codigo, c.nombre])), [cuentas]);

  const set = (i: number, campo: keyof Linea, valor: string) => {
    setLineas((ls) => ls.map((l, k) => {
      if (k !== i) return l;
      const nl = { ...l, [campo]: valor };
      // Una partida es cargo O abono, no las dos: al escribir una, se limpia la otra.
      if (campo === 'cargo' && valor) nl.abono = '';
      if (campo === 'abono' && valor) nl.cargo = '';
      return nl;
    }));
    setMsg(null);
  };
  const agregar = () => setLineas((ls) => [...ls, filaVacia()]);
  const quitar = (i: number) => setLineas((ls) => ls.length > 1 ? ls.filter((_, k) => k !== i) : ls);

  const sumaCargo = round2(lineas.reduce((a, l) => a + (Number(l.cargo) || 0), 0));
  const sumaAbono = round2(lineas.reduce((a, l) => a + (Number(l.abono) || 0), 0));
  const cuadra = sumaCargo > 0 && sumaCargo === sumaAbono;
  const conImporte = lineas.filter((l) => l.codigo && (Number(l.cargo) > 0 || Number(l.abono) > 0)).length;

  const guardar = async () => {
    setBusy(true); setMsg(null);
    try {
      const r: any = await api.crearPolizaManual({
        tipo, fecha, concepto: concepto.trim() || undefined, uuid: uuid.trim() || null,
        lineas: lineas
          .filter((l) => l.codigo && (Number(l.cargo) > 0 || Number(l.abono) > 0))
          .map((l) => ({ codigo: l.codigo.trim(), concepto: l.concepto.trim() || undefined, cargo: Number(l.cargo) || 0, abono: Number(l.abono) || 0 })),
      });
      setMsg({ tipo: 'ok', texto: `Póliza #${r.data?.poliza?.folio} guardada.` });
      setLineas([filaVacia(), filaVacia(), filaVacia()]);
      setConcepto(''); setUuid('');
    } catch (e: any) {
      setMsg({ tipo: 'err', texto: e?.response?.data?.message || e.message || 'No se pudo guardar la póliza.' });
    } finally { setBusy(false); }
  };

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText size={22} className="text-primary" /> Póliza manual
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Cargos y abonos a mano, con cualquier cuenta del catálogo. Se guarda sólo si las sumas cuadran.
        </p>
      </div>

      {/* Encabezado */}
      <div className="bg-white rounded-lg shadow border p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs text-gray-600">Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as any)} className="input w-full">
            {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-600">Fecha</span>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="input w-full" />
        </label>
        <label className="block lg:col-span-2">
          <span className="text-xs text-gray-600">Concepto</span>
          <input value={concepto} onChange={(e) => setConcepto(e.target.value)}
            placeholder="Descripción de la póliza" className="input w-full" />
        </label>
        <label className="block lg:col-span-2">
          <span className="text-xs text-gray-600">UUID del CFDI <span className="text-gray-400">(opcional)</span></span>
          <input value={uuid} onChange={(e) => setUuid(e.target.value)}
            placeholder="Liga la póliza a un comprobante" className="input w-full font-mono text-xs" />
        </label>
      </div>

      {/* Datalist de TODAS las cuentas de movimiento */}
      <datalist id="ctas-poliza-manual">
        {cuentas.map((c) => <option key={c.id} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
      </datalist>

      {/* Partidas */}
      <div className="bg-white rounded-lg shadow border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-56">No. de cuenta</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Concepto del movimiento</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 w-32">Debe (cargo)</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 w-32">Haber (abono)</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {lineas.map((l, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-3 py-1.5">
                  <input list="ctas-poliza-manual" value={l.codigo}
                    onChange={(e) => set(i, 'codigo', e.target.value)}
                    placeholder="Cuenta" className="border rounded px-2 py-1 text-sm w-full font-mono" />
                  {l.codigo && nombreDe.get(l.codigo) && (
                    <span className="text-[11px] text-gray-500 truncate block">{nombreDe.get(l.codigo)}</span>
                  )}
                  {l.codigo && !nombreDe.get(l.codigo) && (
                    <span className="text-[11px] text-rose-500 block">no está en el catálogo</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <input value={l.concepto} onChange={(e) => set(i, 'concepto', e.target.value)}
                    placeholder={concepto || 'Concepto'} className="border rounded px-2 py-1 text-sm w-full" />
                </td>
                <td className="px-3 py-1.5">
                  <input type="number" step="0.01" min="0" value={l.cargo}
                    onChange={(e) => set(i, 'cargo', e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-full text-right" />
                </td>
                <td className="px-3 py-1.5">
                  <input type="number" step="0.01" min="0" value={l.abono}
                    onChange={(e) => set(i, 'abono', e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-full text-right" />
                </td>
                <td className="px-1">
                  <button onClick={() => quitar(i)} title="Quitar renglón"
                    className="text-gray-300 hover:text-rose-500"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2">
            <tr className="font-semibold bg-gray-50">
              <td className="px-3 py-2 text-right text-gray-500" colSpan={2}>Sumas</td>
              <td className="px-3 py-2 text-right">{money(sumaCargo)}</td>
              <td className="px-3 py-2 text-right">{money(sumaAbono)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={agregar} className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          <Plus size={15} /> Agregar renglón
        </button>

        <span className={`flex items-center gap-1.5 text-sm ${cuadra ? 'text-emerald-700' : 'text-gray-500'}`}>
          {cuadra ? <CheckCircle2 size={15} /> : <Scale size={15} />}
          {cuadra
            ? 'Sumas iguales'
            : sumaCargo === sumaAbono ? 'Captura los importes' : `Diferencia ${money(round2(sumaCargo - sumaAbono))}`}
        </span>

        <button onClick={guardar} disabled={busy || !cuadra || conImporte < 2}
          className="ml-auto flex items-center gap-1.5 bg-primary text-white px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
          <Save size={15} /> {busy ? 'Guardando…' : 'Guardar póliza'}
        </button>
      </div>

      {msg && (
        <p className={`text-sm flex items-center gap-1.5 ${msg.tipo === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>
          {msg.tipo === 'ok' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {msg.texto}
        </p>
      )}
    </div>
  );
}

export default PolizaManualPage;
