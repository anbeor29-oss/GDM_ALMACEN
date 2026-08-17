/**
 * PropuestaDeExpediente — lo que se rescató del recibo, antes de dar de alta.
 *
 * ESTA PANTALLA EXISTE PARA PODER DECIR QUE NO
 * La condición fue explícita: preguntar antes de crear al trabajador y con qué
 * datos. Un importador que lee un XML y da de alta en el mismo golpe es más
 * cómodo hasta el día que mete a la plantilla a alguien que no debía estar, o
 * con un nombre partido al revés. Aquí se ve todo lo rescatado, de dónde salió
 * cada dato y qué falta; y sólo entonces se abre el formulario.
 */
import { useState } from 'react';
import { X, AlertTriangle, FileCheck2, UserPlus, ArrowRight } from 'lucide-react';
import { EmpleadoModal } from './EmpleadoModal';

const money = (n: any) =>
  n === undefined || n === null ? '—'
    : Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/** Etiqueta legible de cada campo — el nombre de la columna no le dice nada a nadie. */
const NOMBRES: Record<string, string> = {
  num_empleado: 'Número de empleado',
  nombre: 'Nombre(s)',
  apellido_pat: 'Apellido paterno',
  apellido_mat: 'Apellido materno',
  rfc: 'RFC',
  curp: 'CURP',
  nss: 'NSS',
  codigo_postal: 'Código postal fiscal',
  puesto: 'Puesto',
  departamento: 'Departamento',
  fecha_ingreso: 'Fecha de ingreso',
  tipo_contrato: 'Tipo de contrato',
  tipo_regimen: 'Tipo de régimen',
  tipo_jornada: 'Tipo de jornada',
  periodicidad_pago: 'Periodicidad de pago',
  tipo_nomina: 'Tipo de nómina',
  entidad_federativa: 'Entidad federativa',
  zona_geografica: 'Zona salarial',
  banco_clave: 'Banco',
  cuenta_clabe: 'CLABE',
  salario_diario_integrado: 'Salario diario integrado',
  sbc: 'Salario base de cotización',
  regimen_fiscal: 'Régimen fiscal',
  uso_cfdi: 'Uso del CFDI',
};

const ORIGEN_ETIQUETA: Record<string, { texto: string; clase: string }> = {
  xml:      { texto: 'del XML',    clase: 'bg-emerald-100 text-emerald-800' },
  deducido: { texto: 'deducido',   clase: 'bg-amber-100 text-amber-800' },
  omision:  { texto: 'por omisión', clase: 'bg-slate-100 text-slate-600' },
};

export function PropuestaDeExpediente({
  propuesta, onCerrar, onAlta,
}: {
  propuesta: any;
  onCerrar: () => void;
  onAlta: () => void;
}) {
  const [abriendoForm, setAbriendoForm] = useState(false);

  /* Si ya está en la plantilla no hay nada que dar de alta, y decirlo así
   * evita el duplicado que después parte el CFDI anual del trabajador. */
  if (propuesta.yaExiste) {
    return (
      <div className="bg-white rounded-lg shadow border p-5">
        <div className="flex items-start justify-between">
          <h3 className="font-semibold flex items-center gap-2 text-emerald-800">
            <FileCheck2 size={18} /> Este trabajador ya está en la plantilla
          </h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-700 mt-2">
          <strong>{propuesta.yaExiste.nombre_completo}</strong> es el empleado{' '}
          <span className="font-mono">{propuesta.yaExiste.num_empleado}</span>. No hay nada que crear.
        </p>
        {propuesta.faltantes?.length > 0 && (
          <p className="text-sm text-amber-800 mt-2">
            A su expediente todavía le falta: {propuesta.faltantes.join(', ')}.
          </p>
        )}
      </div>
    );
  }

  const campos = Object.keys(propuesta.datos || {});

  return (
    <>
      <div className="bg-white rounded-lg shadow border p-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold flex items-center gap-2 text-violet-800">
              <UserPlus size={18} /> Esto se rescató del recibo
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Nada se ha guardado todavía. Revisa lo de abajo y confirma en el formulario.
            </p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {/* De qué recibo estamos hablando */}
        <div className="mt-3 grid sm:grid-cols-3 gap-2 text-xs bg-slate-50 rounded p-3">
          <div>Periodo: <b>{propuesta.recibo?.periodo || '—'}</b></div>
          <div>Fecha de pago: <b>{propuesta.recibo?.fechaPago || '—'}</b></div>
          <div>Días pagados: <b>{propuesta.recibo?.diasPagados ?? '—'}</b></div>
          <div>Percepciones: <b>{money(propuesta.recibo?.totalPercepciones)}</b></div>
          <div>Deducciones: <b>{money(propuesta.recibo?.totalDeducciones)}</b></div>
          <div>Neto: <b>{money(propuesta.recibo?.neto)}</b></div>
        </div>

        {/* Los avisos ANTES de la tabla: es lo que hay que leer, no lo que se
            rescató bien. */}
        {propuesta.avisos?.length > 0 && (
          <div className="mt-4 space-y-2">
            {propuesta.avisos.map((a: string, i: number) => (
              <div key={i} className="bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded-lg text-xs flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{a}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {campos.map((k) => (
                <tr key={k}>
                  <td className="py-1.5 pr-3 text-gray-600 w-1/3">{NOMBRES[k] || k}</td>
                  <td className="py-1.5 font-medium text-gray-900">
                    {String(propuesta.datos[k])}
                  </td>
                  <td className="py-1.5 text-right">
                    {(() => {
                      const o = ORIGEN_ETIQUETA[propuesta.origen?.[k]] || ORIGEN_ETIQUETA.omision;
                      return (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${o.clase}`}>
                          {o.texto}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {propuesta.faltantes?.length > 0 && (
          <div className="mt-4 bg-slate-50 border rounded-lg px-3 py-2 text-xs text-gray-700">
            <p className="font-medium">El XML no trae, y hay que capturarlo:</p>
            <p className="mt-0.5">{propuesta.faltantes.join(' · ')}</p>
          </div>
        )}

        {propuesta.registroPatronalSugerido && (
          <div className="mt-3 bg-sky-50 border border-sky-200 text-sky-900 px-3 py-2 rounded-lg text-xs">
            El recibo trae el registro patronal <b>{propuesta.registroPatronalSugerido}</b> y la
            empresa todavía no lo tiene capturado. Se puede copiar en Nómina → Parámetros.
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCerrar} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            No dar de alta
          </button>
          <button
            onClick={() => setAbriendoForm(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700"
          >
            Revisar y dar de alta <ArrowRight size={15} />
          </button>
        </div>
      </div>

      {abriendoForm && (
        <EmpleadoModal
          inicial={propuesta.datos}
          origen={propuesta.origen}
          onClose={() => setAbriendoForm(false)}
          onGuardado={() => { setAbriendoForm(false); onAlta(); }}
        />
      )}
    </>
  );
}

export default PropuestaDeExpediente;
