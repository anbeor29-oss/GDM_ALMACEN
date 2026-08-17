/**
 * Pantallas de Nómina y Reportes — todavía sin construir, y dicho de frente.
 *
 * POR QUÉ ESTÁN VACÍAS A PROPÓSITO
 * El cálculo de la nómina (periodos, ISR, cuotas del IMSS, subsidio al empleo)
 * y el CFDI de nómina dependen de decisiones que no me tocaba tomar solo:
 * de dónde salen las tarifas y la UMA, si el timbrado va por el PAC que ya usa
 * la facturación, y qué reportes hacen falta. Inventar esas respuestas habría
 * sido peor que dejar la pantalla en blanco: un cálculo de nómina equivocado no
 * se ve roto, se ve como un número.
 *
 * El menú, el gateo por grupo de trabajo y la navegación sí están completos,
 * para que se pueda recorrer y confirmar el camino antes de construir el fondo.
 */
import { Construction, HelpCircle } from 'lucide-react';

function Pendiente({
  titulo, porQue, preguntas,
}: {
  titulo: string;
  porQue: string;
  preguntas: string[];
}) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-lg shadow border p-8">
        <div className="w-14 h-14 mb-4 bg-amber-50 rounded-2xl flex items-center justify-center">
          <Construction className="text-amber-500" size={28} />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{titulo}</h1>
        <p className="text-gray-600 mt-3">{porQue}</p>

        <div className="mt-6 border-t pt-5">
          <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <HelpCircle size={16} className="text-primary" /> Lo que falta decidir
          </p>
          <ul className="mt-2 space-y-1.5">
            {preguntas.map((p) => (
              <li key={p} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-amber-500 mt-0.5">▸</span> {p}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-slate-400 mt-6">
          Mientras tanto, el expediente del personal y los parámetros del patrón ya funcionan.
        </p>
      </div>
    </div>
  );
}

export function NominaCalculoPage() {
  return (
    <Pendiente
      titulo="Cálculo de nómina"
      porQue={
        'Aquí van los periodos, el cálculo del ISR y de las cuotas del IMSS, el subsidio ' +
        'al empleo y el timbrado del recibo. Está sin construir porque el motor depende de ' +
        'decisiones que hay que tomar antes de escribir la primera fórmula.'
      }
      preguntas={[
        'Las tarifas del Art. 96, el subsidio, la UMA y los salarios mínimos: ¿se capturan en una pantalla de parámetros por año, o van fijos en el código como en el sistema anterior?',
        '¿El recibo se timbra con el mismo PAC de la facturación, o se queda en pre-timbre como hasta ahora?',
        '¿Qué periodicidades hacen falta el primer día: semanal, quincenal, mensual?',
        '¿Entran en esta etapa préstamos, FONACOT, vacaciones y acumulados, o van después?',
      ]}
    />
  );
}

export function NominaReportesPage() {
  return (
    <Pendiente
      titulo="Reportes de nómina"
      porQue={
        'El sistema anterior no tenía una pantalla de reportes, así que no hay nada que ' +
        'portar: lo que vaya aquí hay que definirlo desde cero, y prefiero preguntarlo a ' +
        'inventarlo.'
      }
      preguntas={[
        '¿Qué reportes se usan hoy de verdad: lista de raya, dispersión bancaria, acumulados por trabajador, resumen de cuotas obrero-patronales?',
        '¿Alguno tiene que salir en un formato que otro sistema lea (el SUA, el banco)?',
        '¿Se necesitan por periodo, por mes o por ejercicio?',
      ]}
    />
  );
}

export default NominaCalculoPage;
