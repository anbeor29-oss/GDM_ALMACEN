/**
 * Nómina → Importar respaldo. Trae la nómina histórica de un respaldo de
 * NomiPaq (CONTPAQ Nóminas) a la empresa abierta. Mismo principio que el
 * importador de contabilidad: un `.bak` es binario de SQL Server y sólo se
 * puede leer en la PC con una herramienta, que deja un paquete; ese paquete se
 * sube aquí y se elige qué cargar, sin salir de NEXO.
 *
 * Esta pantalla es el HOGAR del importador. La carga efectiva se habilita en
 * cuanto quede el pequeño ajuste de base (marcador de origen para no duplicar)
 * — ver PLAN_MIGRACION_NOMINA y la memoria de migración de nómina.
 */
import { Users2, Wrench, Layers, ShieldCheck } from 'lucide-react';

export function NominaImportarPage() {
  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Users2 size={22} className="text-violet-700" /> Importar respaldo de nómina
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Pasa la nómina histórica de un respaldo de NomiPaq (empleados, periodos, recibos y CFDI)
          a la empresa que tengas abierta. No duplica: repetirlo es seguro.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow border p-5 space-y-4">
        <p className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <Layers size={18} className="text-violet-700" /> Cómo va a funcionar (igual que el de contabilidad)
        </p>
        <ol className="space-y-3 text-sm text-gray-700">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-800 font-bold grid place-items-center">1</span>
            <span><b>Descargar la herramienta</b> (ya configurada con esta dirección) y abrirla en la computadora.</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-800 font-bold grid place-items-center">2</span>
            <span>Elegir el <b>respaldo</b> (<span className="font-mono">.bak</span> de NomiPaq). La herramienta lo lee y deja un <b>paquete</b>.</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-800 font-bold grid place-items-center">3</span>
            <span>Subir el paquete <b>aquí</b>, elegir qué <b>ejercicios</b> cargar y ver el resumen — sin salir del sistema.</span>
          </li>
        </ol>
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-900 flex gap-2">
        <ShieldCheck size={18} className="mt-0.5 shrink-0" />
        <div>
          <b>Comparación con NomiPaq: NEXO ya cubre todas las entidades</b> (empleados, periodos, conceptos,
          percepciones/deducciones, CFDI con UUID, IMSS y créditos). El detalle de la carga se está afinando
          con un pequeño ajuste para no duplicar lo migrado.
        </div>
      </div>

      <div className="bg-white rounded-lg shadow border p-4 text-sm text-gray-500 flex items-center gap-2">
        <Wrench size={16} className="text-gray-400" />
        La carga de paquetes se habilita aquí en cuanto quede ese ajuste. Mientras tanto, esta pantalla es el
        acceso del importador de nómina en el menú.
      </div>
    </div>
  );
}

export default NominaImportarPage;
