/**
 * Balance general (CONTABLE, no NIF) — el estado de situación financiera clásico
 * que entrega el despacho: el ÁRBOL del catálogo del contribuyente (Activo →
 * Activo a corto plazo → Bancos → …), con el saldo de cada cuenta al corte, en
 * dos columnas (Activo | Pasivo + Capital). Mensual (al fin del mes elegido) o
 * anual (al 31/dic). Se descarga en PDF y Excel con el encabezado de la casa.
 *
 * A diferencia de «Situación financiera» (NIF B-6), aquí NO se reagrupa por el
 * código agrupador del SAT: se respeta la numeración y los nombres del catálogo,
 * porque es el documento con el que trabaja —y que firma— el contador.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileDown, CheckCircle2, AlertTriangle, Scale } from 'lucide-react';
import api from '@/services/api';
import { formatCuenta, useMascara } from '@/utils/cuenta';
import { SelectorPeriodo } from '@/components/SelectorPeriodo';
import { mx, MESES } from './piezas';

const fechaLarga = (iso?: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

/* Un renglón del árbol, con sangría por nivel. Las cuentas de mayor (nivel ≤ 2)
 * van en negrita; las de detalle, normales. */
function Renglon({ n, mascara }: { n: any; mascara: string }) {
  const fuerte = n.nivel <= 2;
  return (
    <>
      <tr className={fuerte ? 'bg-gray-50/70' : ''}>
        <td className="px-3 py-1" style={{ paddingLeft: 12 + Math.max(0, n.nivel - 1) * 16 }}>
          <span className={fuerte ? 'font-semibold text-gray-800' : 'text-gray-700'}>{n.nombre}</span>
          {n.codigo && (
            <span className="ml-2 text-[10px] text-gray-400 font-mono">{formatCuenta(n.codigo, mascara)}</span>
          )}
        </td>
        <td className={`px-3 py-1 text-right tabular-nums whitespace-nowrap ${
          n.saldo < 0 ? 'text-rose-700' : fuerte ? 'text-gray-900 font-semibold' : 'text-gray-800'}`}>
          {mx(n.saldo)}
        </td>
      </tr>
      {(n.hijos || []).map((h: any, i: number) => <Renglon key={h.codigo || i} n={h} mascara={mascara} />)}
    </>
  );
}

function Bloque({ titulo, nodos, total, etiquetaTotal, mascara, fuerte }: {
  titulo: string; nodos: any[]; total: number; etiquetaTotal: string; mascara: string; fuerte?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg shadow border overflow-hidden">
      <h3 className="px-4 py-2 bg-gray-100 border-b text-sm font-bold text-gray-800 uppercase tracking-wide">
        {titulo}
      </h3>
      <table className="w-full text-sm">
        <tbody className="divide-y">
          {nodos.length === 0 && (
            <tr><td className="px-4 py-2 text-gray-400 text-sm italic" colSpan={2}>Sin cuentas con saldo.</td></tr>
          )}
          {nodos.map((n, i) => <Renglon key={n.codigo || i} n={n} mascara={mascara} />)}
          <tr className={fuerte ? 'bg-gray-900 text-white font-bold' : 'bg-gray-100 font-semibold text-gray-800'}>
            <td className="px-4 py-2">{etiquetaTotal}</td>
            <td className="px-4 py-2 text-right tabular-nums">{mx(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function BalanceGeneralPage() {
  const hoy = new Date();
  const mascara = useMascara();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [modo, setModo] = useState<'mensual' | 'anual'>('mensual');
  const [msg, setMsg] = useState('');

  const mesEfectivo = modo === 'anual' ? 12 : mes;

  const q = useQuery({
    queryKey: ['balance-general', anio, mesEfectivo],
    queryFn: () => api.getBalanceGeneral(anio, mesEfectivo),
  });
  const d: any = q.data?.data;
  const hayDatos = d && !d.vacio;

  const descargar = async (formato: 'excel' | 'pdf') => {
    setMsg('');
    try { await api.descargarBalanceGeneral(anio, mesEfectivo, formato); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo descargar.'); }
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Scale size={22} className="text-primary" /> Balance general
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            El estado de situación financiera contable, por cuenta del catálogo (no por rubro NIF).
            {hayDatos && <> Al <b>{fechaLarga(d.fechaCorte)}</b>.</>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Mensual (al fin del mes) o anual (al 31/dic). */}
          <div className="flex rounded-lg border overflow-hidden text-sm">
            {(['mensual', 'anual'] as const).map((k) => (
              <button key={k} onClick={() => setModo(k)}
                className={`px-3 py-1.5 ${modo === k ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {k === 'mensual' ? 'Mensual' : 'Anual'}
              </button>
            ))}
          </div>
          {hayDatos && (
            <>
              <button onClick={() => descargar('excel')} title="Descargar Excel" className="btn-export">
                <FileSpreadsheet size={16} /> Excel
              </button>
              <button onClick={() => descargar('pdf')} title="Descargar PDF" className="btn-export">
                <FileDown size={16} /> PDF
              </button>
            </>
          )}
          {/* En anual el mes lo fija diciembre; se deja el año del selector. */}
          <SelectorPeriodo anio={anio} mes={modo === 'anual' ? 12 : mes}
            onAnio={setAnio} onMes={(m) => { setMes(m); setModo('mensual'); }} />
        </div>
      </div>

      {msg && <p className="text-sm text-rose-700">{msg}</p>}
      {q.isLoading && <p className="text-gray-500">Cargando {modo === 'anual' ? `${anio}` : `${MESES[mes]} ${anio}`}…</p>}

      {!q.isLoading && !hayDatos && (
        <p className="text-sm text-gray-600 bg-gray-50 border rounded px-4 py-6 text-center">
          {modo === 'anual' ? `El ejercicio ${anio}` : `${MESES[mes]} ${anio}`} todavía no tiene saldos.
          Genera las pólizas y actualiza la balanza del periodo en{' '}
          <a href="/contabilidad/balanza" className="text-primary hover:underline">Balanza</a>.
        </p>
      )}

      {hayDatos && (
        <>
          <p className={`text-sm rounded px-3 py-2 flex items-center gap-2 border ${
            d.cuadra ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                     : 'text-rose-800 bg-rose-50 border-rose-200'}`}>
            {d.cuadra ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            {d.cuadra
              ? `El balance cuadra: activo ${mx(d.totalActivo)} = pasivo más capital.`
              : `No cuadra por ${mx(d.diferencia)}: activo ${mx(d.totalActivo)} contra ${mx(d.totalPasivoCapital)} de pasivo + capital.`}
          </p>

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <Bloque titulo="Activo" nodos={d.activo} total={d.totalActivo}
              etiquetaTotal="SUMA DEL ACTIVO" mascara={mascara} fuerte />
            <div className="space-y-4">
              <Bloque titulo="Pasivo" nodos={d.pasivo} total={d.totalPasivo}
                etiquetaTotal="Suma del pasivo" mascara={mascara} />
              <Bloque titulo="Capital" nodos={d.capital} total={d.totalCapital}
                etiquetaTotal="Suma del capital" mascara={mascara} />
              <div className="flex justify-between px-4 py-2 rounded bg-gray-900 text-white font-bold">
                <span>PASIVO + CAPITAL</span>
                <span className="tabular-nums">{mx(d.totalPasivoCapital)}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default BalanceGeneralPage;
