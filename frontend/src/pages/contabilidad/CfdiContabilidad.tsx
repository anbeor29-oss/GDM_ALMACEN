/**
 * CFDI en Contabilidad — los comprobantes de la bóveda (emitidos y recibidos),
 * incluidos los RECUPERADOS del respaldo. Sólo consulta y descarga: ya están
 * contabilizados; generar pólizas va por Pólizas de venta/compra.
 *
 * Reusa `TablaComprobantesSat` (la misma tabla del módulo XML del SAT) para no
 * duplicar la vista; aquí vive dentro de Contabilidad.
 */
import { useState } from 'react';
import { FileCode2 } from 'lucide-react';
import { TablaComprobantesSat } from '@/components/TablaComprobantesSat';
import { claseOpcion } from '@/utils/coloresOpciones';

export function CfdiContabilidadPage() {
  const [tab, setTab] = useState<'recibidos' | 'emitidos'>('recibidos');
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileCode2 size={22} className="text-emerald-700" /> CFDI (XML del SAT)
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Los comprobantes de la bóveda —emitidos y recibidos—, incluidos los recuperados del
          respaldo. Consulta y descarga; la contabilización va por Pólizas de venta/compra.
        </p>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {([['recibidos', 'Recibidos'], ['emitidos', 'Emitidos']] as const).map(([k, l], i) => (
          <button key={k} onClick={() => setTab(k)} className={claseOpcion(i, tab === k)}>{l}</button>
        ))}
      </div>
      {tab === 'recibidos'
        ? <TablaComprobantesSat direccion="recibidos" />
        : <TablaComprobantesSat direccion="emitidos" />}
    </div>
  );
}

export default CfdiContabilidadPage;
