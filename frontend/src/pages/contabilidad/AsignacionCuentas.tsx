/**
 * Asignación de cuentas — un solo lugar para decir a qué cuenta contable va cada
 * cosa antes de que la póliza se arme. Antes estaban regadas: ventas en Facturas,
 * compras en Proveedores, conceptos en Nómina. Aquí se juntan en pestañas, y cada
 * una reutiliza el mismo tablero que ya vivía en su pantalla.
 *
 *   Ventas   — cada ClaveProdServ (producto) a su cuenta de ingreso 401.
 *   Compras  — cada ClaveProdServ a su 115 (inventario) / 601 (gasto).
 *   Nómina   — cada concepto (percepción/deducción/provisión) a su cuenta.
 *   Pagos    — cobros y pagos no se asignan por partida: usan cuentas fijas por
 *              agrupador (208/209 y 118/119 del IVA, banco 102.01). Aquí sólo se
 *              comprueba que esas cuentas existan.
 */
import { useMemo, useState } from 'react';
import { claseOpcion } from '@/utils/coloresOpciones';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tag, Truck, HeartPulse, ArrowLeftRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import api from '@/services/api';
import { useMascara } from '@/utils/cuenta';
import { SelectorCuentaId } from '@/components/SelectorCuenta';
import { TabIngresos } from './PolizasVenta';
import { TabCargos } from './PolizasCompra';
import { ConceptosCuentasNomina } from '../nomina/NominaReportes';
import { aniosContables } from '@/utils/anios';
import { usePeriodoTrabajo } from '@/utils/periodoActivo';

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

type Pest = 'ventas' | 'compras' | 'nomina' | 'pagos';
const PESTANAS: Array<{ id: Pest; nombre: string; icono: any }> = [
  { id: 'ventas', nombre: 'Ventas (401)', icono: Tag },
  { id: 'compras', nombre: 'Compras (115/601)', icono: Truck },
  { id: 'nomina', nombre: 'Nómina', icono: HeartPulse },
  { id: 'pagos', nombre: 'Cobros y pagos', icono: ArrowLeftRight },
];

export function AsignacionCuentasPage() {
  const [pest, setPest] = useState<Pest>('ventas');
  const { anio, mes, setAnio, setMes } = usePeriodoTrabajo();
  const anios = aniosContables();

  const ctasQ = useQuery({ queryKey: ['ctas-mov'], queryFn: () => api.getCuentasContables() });
  const cuentas: any[] = (ctasQ.data?.data?.cuentas || []).filter((c: any) => c.permite_movimientos);

  const conMes = pest === 'ventas' || pest === 'compras';

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Asignación de cuentas</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          A qué cuenta del catálogo va cada producto o concepto. Con esto la póliza sale exacta.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-1.5 flex-1">
          {PESTANAS.map((p, i) => {
            const Ico = p.icono;
            return (
              <button key={p.id} onClick={() => setPest(p.id)}
                className={`inline-flex items-center gap-1.5 ${claseOpcion(i, pest === p.id)}`}>
                <Ico size={14} /> {p.nombre}
              </button>
            );
          })}
        </div>
        {conMes && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Mes:</span>
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input py-1.5 text-sm">
              <option value={0}>Todo el año</option>
              {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input py-1.5 text-sm w-24">
              {anios.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Datalists que necesitan los tableros embebidos. */}
      <datalist id="ctas-ventas">
        {cuentas.filter((c) => c.tipo === 'INGRESO').map((c) => <option key={c.id} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
      </datalist>
      <datalist id="ctas-compras">
        {cuentas.filter((c) => ['ACTIVO', 'GASTO', 'COSTO'].includes(c.tipo)).map((c) => <option key={c.id} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
      </datalist>

      {pest === 'ventas' && <TabIngresos anio={anio} mes={mes} cuentas={cuentas} />}
      {pest === 'compras' && <TabCargos anio={anio} mes={mes} cuentas={cuentas} />}
      {pest === 'nomina' && <ConceptosCuentasNomina />}
      {pest === 'pagos' && <PagosInfo cuentas={cuentas} />}
    </div>
  );
}

/* Cobros y pagos no se asignan por partida: usan cuentas fijas por agrupador.
 * Aquí sólo se comprueba que existan (si falta una, la póliza de cobro/pago se
 * omite). */
/* Cobros y pagos: cuentas fijas ASIGNABLES por rol (agrupador). Si el catálogo
 * del cliente no usa la numeración del SAT, aquí se elige qué cuenta hace cada
 * papel; el motor (cuentaPorAgrupador) respeta ese override. */
function PagosInfo({ cuentas }: { cuentas: any[] }) {
  const qc = useQueryClient();
  const mascara = useMascara();
  const fijasQ = useQuery({ queryKey: ['cuentas-fijas'], queryFn: () => api.getCuentasFijas() });
  const fijas: Record<string, any> = fijasQ.data?.data || {};
  const porAgrup = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of cuentas) if (c.codigo_agrupador && !m.has(c.codigo_agrupador)) m.set(c.codigo_agrupador, c);
    return m;
  }, [cuentas]);
  const asignar = useMutation({
    mutationFn: (v: { agr: string; id: string | null }) => api.setCuentaFija(v.agr, v.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cuentas-fijas'] }),
  });
  const necesarias: Array<[string, string]> = [
    ['102.01', 'Banco (cobros y pagos)'],
    ['208.01', 'IVA trasladado cobrado'],
    ['209.01', 'IVA trasladado no cobrado'],
    ['118.01', 'IVA acreditable pagado'],
    ['119.01', 'IVA acreditable por pagar'],
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 bg-gray-50 border rounded p-3">
        Los <b>cobros y pagos</b> usan estas cuentas fijas. Si tu catálogo <b>no</b> usa la
        numeración del SAT, <b>asigna aquí</b> qué cuenta de tu catálogo hace cada papel — el motor
        la respeta aunque no se llame como en el Anexo 24.
      </p>
      <div className="bg-white rounded-lg shadow border divide-y">
        {necesarias.map(([agr, desc]) => {
          const fija = fijas[agr];
          const fallback = porAgrup.get(agr);
          const actualId = fija?.account_id || fallback?.id || '';
          return (
            <div key={agr} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-mono text-gray-500 w-14">{agr}</span>
              <span className="text-gray-700 flex-1 min-w-[10rem]">{desc}</span>
              <div className="w-72">
                <SelectorCuentaId cuentas={cuentas} value={actualId || null} mascara={mascara} permitirCrear={false}
                  placeholder="— Elegir cuenta —" onChange={(id) => asignar.mutate({ agr, id: id || null })} />
              </div>
              {fija ? (
                <span className="flex items-center gap-1 text-emerald-700 text-xs"><CheckCircle2 size={13} /> asignada</span>
              ) : fallback ? (
                <span className="text-gray-400 text-xs">por agrupador</span>
              ) : (
                <span className="flex items-center gap-1 text-rose-600 text-xs"><AlertTriangle size={13} /> sin cuenta</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AsignacionCuentasPage;
