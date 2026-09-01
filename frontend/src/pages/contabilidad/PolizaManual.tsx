/**
 * Póliza manual — cargos y abonos capturados a mano, con CUALQUIER cuenta del
 * catálogo. Las pólizas de ventas, compras y nómina sólo tocan sus cuentas; ésta
 * es para todo lo demás (ajustes, provisiones, reclasificaciones…). No se guarda
 * si no cuadra: las sumas de cargo y abono tienen que ser iguales. El UUID es
 * opcional; si se captura, liga la póliza a un CFDI.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Plus, Save, Scale, CheckCircle2, AlertTriangle } from 'lucide-react';
import api from '@/services/api';
import { CampoFecha } from '@/components/CampoFecha';
import { PartidasPoliza, fmt2, type LineaPoliza } from '@/components/contabilidad/PartidasPoliza';

const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

const filaVacia = (): LineaPoliza => ({ codigo: '', nombre: '', concepto: '', cargo: '', abono: '' });

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
  const [lineas, setLineas] = useState<LineaPoliza[]>([filaVacia(), filaVacia(), filaVacia()]);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const ctasQ = useQuery({ queryKey: ['ctas-mov'], queryFn: () => api.getCuentasContables() });
  const cuentas: any[] = (ctasQ.data?.data?.cuentas || []).filter((c: any) => c.permite_movimientos);

  const onLinea = (i: number, patch: Partial<LineaPoliza>) => {
    setLineas((ls) => ls.map((l, k) => {
      if (k !== i) return l;
      const nl = { ...l, ...patch };
      // Una partida es cargo O abono, no las dos: al escribir una, se limpia la otra.
      if (patch.cargo) nl.abono = '';
      if (patch.abono) nl.cargo = '';
      return nl;
    }));
    setMsg(null);
  };
  const agregar = () => setLineas((ls) => [...ls, filaVacia()]);
  const quitar = (i: number) => setLineas((ls) => ls.length > 1 ? ls.filter((_, k) => k !== i) : ls);

  /* Cuadre rápido: al oprimir "−" en un cargo/abono, ese campo se llena con lo
   * que falta para igualar las sumas (como en la contabilidad de escritorio). */
  const cuadrar = (i: number, campo: 'cargo' | 'abono') => {
    setLineas((ls) => {
      const otrosCargo = round2(ls.reduce((a, l, k) => a + (k === i ? 0 : Number(l.cargo) || 0), 0));
      const otrosAbono = round2(ls.reduce((a, l, k) => a + (k === i ? 0 : Number(l.abono) || 0), 0));
      const falta = campo === 'cargo' ? round2(otrosAbono - otrosCargo) : round2(otrosCargo - otrosAbono);
      if (falta <= 0) return ls;                 // este lado ya cuadra o sobra
      return ls.map((l, k) => k === i
        ? { ...l, cargo: campo === 'cargo' ? String(falta) : '', abono: campo === 'abono' ? String(falta) : '' }
        : l);
    });
    setMsg(null);
  };

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
          {' '}Tip: oprime <b>−</b> en un importe y se llena con lo que falta para cuadrar.
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
          <CampoFecha value={fecha} onChange={setFecha} className="input w-full" />
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

      {/* Partidas — misma tabla que el editor de pólizas (uniformidad) */}
      <PartidasPoliza lineas={lineas} cuentas={cuentas}
        sumaCargo={sumaCargo} sumaAbono={sumaAbono}
        onLinea={onLinea} onCuadrar={cuadrar} onQuitar={quitar} idBase="poliza-manual" />

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={agregar} className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          <Plus size={15} /> Agregar renglón
        </button>

        <span className={`flex items-center gap-1.5 text-sm ${cuadra ? 'text-emerald-700' : 'text-gray-500'}`}>
          {cuadra ? <CheckCircle2 size={15} /> : <Scale size={15} />}
          {cuadra
            ? 'Sumas iguales'
            : sumaCargo === sumaAbono ? 'Captura los importes' : `Diferencia ${fmt2(round2(sumaCargo - sumaAbono))}`}
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
