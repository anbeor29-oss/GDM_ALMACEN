/**
 * Pantallas de Nómina y Reportes — el fondo todavía se está construyendo.
 *
 * QUÉ CAMBIÓ RESPECTO A LA PRIMERA ENTREGA
 * Estas pantallas nacieron en blanco porque el motor dependía de decisiones sin
 * tomar. Ya están tomadas, y aquí se listan: así, quien entre sabe con qué se
 * va a calcular su nómina antes de que exista la pantalla, y puede corregirlo
 * a tiempo en vez de descubrirlo en el primer recibo.
 *
 * Lo que ya funciona por debajo —tarifas por ejercicio, motor de cálculo y
 * calendario de periodos— se dice también, porque es lo que se puede ir
 * revisando mientras tanto.
 */
import { Construction, CheckCircle2, Clock } from 'lucide-react';

function Pantalla({
  titulo, porQue, listo, enCamino,
}: {
  titulo: string;
  porQue: string;
  listo: string[];
  enCamino: string[];
}) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-lg shadow border p-8">
        <div className="w-14 h-14 mb-4 bg-violet-50 rounded-2xl flex items-center justify-center">
          <Construction className="text-violet-500" size={28} />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{titulo}</h1>
        <p className="text-gray-600 mt-3">{porQue}</p>

        <div className="mt-6 border-t pt-5">
          <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600" /> Ya funciona por debajo
          </p>
          <ul className="mt-2 space-y-1.5">
            {listo.map((x) => (
              <li key={x} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-emerald-500 mt-0.5">✓</span> {x}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5">
          <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Clock size={16} className="text-amber-500" /> Falta la pantalla
          </p>
          <ul className="mt-2 space-y-1.5">
            {enCamino.map((x) => (
              <li key={x} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-amber-500 mt-0.5">▸</span> {x}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-slate-400 mt-6">
          Mientras tanto, el expediente del personal y los parámetros del patrón ya se
          pueden capturar completos.
        </p>
      </div>
    </div>
  );
}

/* El selector de tipo y la pantalla de cálculo se mudaron a NominaCalculo.tsx
 * cuando dejaron de ser un anuncio y pasaron a hacer algo: generar periodos y
 * calcular la prenómina de verdad. Aquí sólo queda Reportes. */

export function NominaReportesPage() {
  return (
    <Pantalla
      titulo="Reportes de nómina"
      porQue={
        'Cuatro reportes, todos con rango de periodos: de la 1 a la 53 en semanal, de la ' +
        '1 a la 24 en quincenal. Los datos que necesitan ya se calculan; falta armar las ' +
        'pantallas y la exportación.'
      }
      listo={[
        'El cálculo por trabajador y por periodo, con el desglose completo de cada renglón.',
        'El rango de periodos por tipo, para pedir "de la semana 1 a la 53".',
      ]}
      enCamino={[
        'Prenómina — lo que se va a pagar, antes de pagarlo.',
        'Vista previa de los CFDI del periodo.',
        'ISR por nómina, acumulable por rango de periodos.',
        'IMSS por nómina, acumulable por rango de periodos.',
      ]}
    />
  );
}

export default NominaReportesPage;
