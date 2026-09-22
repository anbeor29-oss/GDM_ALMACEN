/**
 * Importar respaldo (XML) — en NÓMINA.
 *
 * Misma recuperación que en Contabilidad, pero a la mano para clientes de
 * SÓLO NÓMINA: sube el .zip del respaldo y los CFDI se rescatan a la bóveda.
 * Los de nómina (tipo N) aparecen luego en Nómina → CFDI → «Recuperados».
 * Reusa el mismo componente para no duplicar la lógica.
 */
import { Database } from 'lucide-react';
import { RecuperarXmlRespaldo } from '@/pages/contabilidad/ImportarContpaqi';

export function ImportarRespaldoNominaPage() {
  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Database size={22} className="text-emerald-700" /> Importar respaldo (XML)
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Recupera los XML/CFDI de un respaldo <b>.zip</b> a la bóveda. Los de <b>nómina</b> aparecen en
          <b> Nómina → CFDI → Recuperados</b> (timbrados de periodos anteriores). No duplica: repetirlo es seguro.
        </p>
      </div>
      <RecuperarXmlRespaldo />
    </div>
  );
}

export default ImportarRespaldoNominaPage;
