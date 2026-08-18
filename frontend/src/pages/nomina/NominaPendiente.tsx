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
import { useState } from 'react';
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

/**
 * Los cuatro tipos de nómina, como en el sistema anterior.
 *
 * Ahí se elegía por la URL (?tipo=semanal) y cada tipo llevaba su propio
 * calendario de periodos. Aquí son botones porque es lo primero que se decide
 * al entrar: la planta se paga semanal, la oficina quincenal y la dirección
 * mensual, y las tres conviven — el tipo elegido manda sobre todo lo demás.
 *
 * ESPECIAL no es una cuarta periodicidad: es lo que no cae en el calendario —un
 * finiquito, el aguinaldo, el reparto de utilidades—. Por eso sus periodos no
 * se generan en serie, se capturan uno por uno con su concepto.
 */
const TIPOS = [
  { id: 'SEMANAL',   label: 'Semanal',   emoji: '📅', detalle: 'Hasta 53 periodos al año' },
  { id: 'QUINCENAL', label: 'Quincenal', emoji: '📆', detalle: '24 periodos al año' },
  { id: 'MENSUAL',   label: 'Mensual',   emoji: '📋', detalle: '12 periodos al año' },
  { id: 'ESPECIAL',  label: 'Especial',  emoji: '⚡', detalle: 'Finiquitos, aguinaldo, PTU' },
] as const;

function SelectorDeTipo() {
  const [tipo, setTipo] = useState<string>('SEMANAL');
  const elegido = TIPOS.find((t) => t.id === tipo)!;

  return (
    <div className="max-w-2xl mx-auto mb-4">
      <div className="bg-white rounded-lg shadow border p-5">
        <p className="text-sm font-semibold text-gray-700 mb-3">Tipo de nómina</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TIPOS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTipo(t.id)}
              className={`rounded-lg border-2 px-3 py-3 text-center transition ${
                tipo === t.id
                  ? 'border-violet-500 bg-violet-50 text-violet-900'
                  : 'border-gray-200 hover:border-violet-300 text-gray-700'
              }`}
            >
              <span className="text-xl block">{t.emoji}</span>
              <span className="text-sm font-medium block mt-1">{t.label}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">
          <strong>{elegido.label}</strong> — {elegido.detalle}.
          {tipo === 'ESPECIAL'
            ? ' No se genera calendario: cada periodo se captura con sus fechas y su concepto.'
            : ' Los tres tipos ordinarios conviven: la planta puede ser semanal y la oficina quincenal.'}
        </p>
      </div>
    </div>
  );
}

export function NominaCalculoPage() {
  return (
    <>
      <SelectorDeTipo />
      <Pantalla
      titulo="Cálculo de nómina"
      porQue={
        'Aquí van los periodos, la prenómina y la vista previa del CFDI. El motor y el ' +
        'calendario ya están construidos y probados; lo que falta es la pantalla que los ' +
        'usa.'
      }
      listo={[
        'Tarifa del Art. 96, subsidio, UMA y salarios mínimos guardados POR AÑO — se actualizan sin tocar el código.',
        'ISR con mensualización, subsidio al empleo que nunca deja el impuesto en negativo, y cuotas obrero-patronales del IMSS.',
        'Exenciones del Art. 93 por concepto: aguinaldo, prima vacacional, PTU, despensa, alimentación, premios.',
        'INFONAVIT por porcentaje, cuota fija o VSM; pensión alimenticia por orden judicial.',
        'Calendario de periodos semanal (1 a 53), quincenal (1 a 24), mensual (1 a 12) y especial, todos a la vez.',
        'Préstamos de la empresa y créditos FONACOT con su saldo, sus abonos y los periodos que faltan.',
      ]}
      enCamino={[
        'La rejilla de prenómina: un renglón por trabajador, con los días y los conceptos editables.',
        'La vista previa del CFDI de nómina antes de generarlo.',
        'El pre-timbre simulado, para ver los errores del comprobante sin gastar timbres.',
        'El cierre del periodo, que aplica los abonos de préstamos y FONACOT.',
      ]}
      />
    </>
  );
}

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

export default NominaCalculoPage;
