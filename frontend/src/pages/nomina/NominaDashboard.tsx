/**
 * Tablero de nómina — qué falta para poder pagar.
 *
 * NO ES UN TABLERO DE CIFRAS, ES UNA LISTA DE PENDIENTES
 * Antes del primer cálculo lo único que importa es si el sistema puede timbrar:
 * si falta el registro patronal, si falta la prima de riesgo, si hay
 * expedientes sin NSS. Un tablero bonito con la suma de sueldos no sirve de
 * nada el día que el PAC rechaza cincuenta recibos por un dato que llevaba
 * meses vacío y que nadie miró.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Users, AlertTriangle, CheckCircle2, Settings2, FileText,
  Banknote, Home, Scale, Landmark,
} from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export function NominaDashboardPage() {
  const resumen = useQuery({ queryKey: ['empleados-resumen'], queryFn: () => api.getEmpleadosResumen() });
  const params = useQuery({ queryKey: ['nomina-parametros'], queryFn: () => api.getNominaParametros() });

  const r: any = resumen.data?.data;
  const p: any = params.data?.data;
  const faltaEmpresa: string[] = p?.faltantes || [];
  const todoListo = faltaEmpresa.length === 0 && Number(r?.incompletos || 0) === 0 && Number(r?.activos || 0) > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nómina</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {p?.empresa?.razonSocial} · <span className="font-mono">{p?.empresa?.rfc}</span>
        </p>
      </div>

      {todoListo && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          Los parámetros del patrón están completos y ningún expediente tiene huecos.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tarjeta titulo="En plantilla" valor={r?.activos ?? '—'} icono={<Users size={18} />}
          pie={r?.bajas ? `${r.bajas} baja(s) en el histórico` : undefined} />
        <Tarjeta titulo="Suma de salarios diarios" valor={r ? money(r.sumaSalarioDiario) : '—'}
          icono={<Banknote size={18} />}
          pie={r?.activos ? `promedio ${money(r.sumaSalarioDiario / r.activos)}` : undefined} />
        <Tarjeta titulo="Con INFONAVIT" valor={r?.conInfonavit ?? '—'} icono={<Home size={18} />} />
        <Tarjeta titulo="Con pensión alimenticia" valor={r?.conPension ?? '—'}
          icono={<Scale size={18} />}
          pie={r?.pensionFija
            ? `${money(r.pensionFija)} de cuota fija` +
              (r.pensionPorcentaje ? ` · ${r.pensionPorcentaje} por porcentaje` : '')
            : r?.pensionPorcentaje ? `${r.pensionPorcentaje} por porcentaje del neto` : undefined} />
      </div>

      {/* ── Lo que se descuenta por fuera del ISR y el IMSS ──
          Cuatro compromisos con cuatro dueños distintos —el instituto, la
          empresa, el INFONAVIT y un juzgado— y cada uno reclama por su lado.
          Verlos juntos es lo que evita descubrir en la revisión que un crédito
          llevaba tres periodos sin descontarse. */}
      {(r?.fonacot?.creditos > 0 || r?.prestamos?.creditos > 0 ||
        r?.conInfonavit > 0 || r?.conPension > 0) && (
        <div className="bg-white rounded-lg shadow border p-5">
          <h2 className="font-semibold flex items-center gap-2 text-gray-800">
            <Landmark size={18} className="text-amber-600" /> Descuentos comprometidos
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Los cuatro tienen dueño distinto y cada uno reclama por su lado.
            Se aplican al cerrar cada periodo.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <Credito
              titulo="FONACOT"
              nota="Lo asigna el instituto; el patrón sólo retiene y entera."
              d={r?.fonacot}
              color="bg-orange-50 border-orange-200 text-orange-900"
            />
            <Credito
              titulo="Préstamos de la empresa"
              nota="Convenio interno: el saldo es dinero de la empresa."
              d={r?.prestamos}
              color="bg-sky-50 border-sky-200 text-sky-900"
            />

            {/* ── INFONAVIT y pensión: se descuentan, pero NO llevan saldo ──
                Un crédito de la empresa se acaba cuando se paga; éstos siguen
                hasta que el instituto o el juzgado digan otra cosa. Por eso
                muestran la REGLA del descuento y no un saldo que no existe.

                Y sólo se suma lo de CUOTA FIJA: el porcentaje sale del SDI y
                los VSM del valor de la UMI por los días del periodo. Sumar eso
                aquí daría un total que no corresponde a ningún mes. */}
            <Regla
              titulo="INFONAVIT"
              nota="La regla viene en la carta del instituto; el importe se calcula cada periodo."
              trabajadores={r?.conInfonavit || 0}
              fijo={r?.infonavitFijo || 0}
              variables={[
                ['por porcentaje del SDI', r?.infonavitPorcentaje || 0],
                ['en veces salario mínimo (VSM)', r?.infonavitVsm || 0],
              ]}
              extra={r?.infonavitSeguro
                ? `Seguro de daños: ${money(r.infonavitSeguro)} diarios en total`
                : undefined}
              color="bg-rose-50 border-rose-200 text-rose-900"
            />
            <Regla
              titulo="Pensión alimenticia"
              nota="Viene de una orden judicial: no se suspende ni se ajusta sin otro oficio."
              trabajadores={r?.conPension || 0}
              fijo={r?.pensionFija || 0}
              variables={[['por porcentaje del neto', r?.pensionPorcentaje || 0]]}
              color="bg-violet-50 border-violet-200 text-violet-900"
            />
          </div>
        </div>
      )}

      {/* Lo que impide correr una nómina */}
      {(faltaEmpresa.length > 0 || Number(r?.incompletos || 0) > 0) && (
        <div className="bg-white rounded-lg shadow border p-5">
          <h2 className="font-semibold flex items-center gap-2 text-amber-800">
            <AlertTriangle size={18} /> Antes del primer cálculo
          </h2>
          <div className="mt-3 space-y-3 text-sm">
            {faltaEmpresa.length > 0 && (
              <div>
                <p className="text-gray-700 font-medium">De la empresa:</p>
                <ul className="mt-1 space-y-0.5 text-gray-600">
                  {faltaEmpresa.map((x) => <li key={x}>▸ {x}</li>)}
                </ul>
                <Link to="/nomina/parametros" className="inline-flex items-center gap-1.5 mt-2 text-primary hover:underline">
                  <Settings2 size={14} /> Ir a Parámetros
                </Link>
              </div>
            )}
            {Number(r?.incompletos || 0) > 0 && (
              <div>
                <p className="text-gray-700 font-medium">
                  De los trabajadores: {r.incompletos} expediente(s) sin NSS, sin CP fiscal,
                  sin entidad federativa o sin SDI.
                </p>
                <Link to="/nomina/empleados" className="inline-flex items-center gap-1.5 mt-2 text-primary hover:underline">
                  <Users size={14} /> Ir a Empleados
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {Number(r?.activos || 0) === 0 && (
        <div className="bg-white rounded-lg shadow border p-6 text-center">
          <FileText className="mx-auto text-gray-300" size={36} />
          <p className="mt-3 font-medium text-gray-800">Todavía no hay nadie en la plantilla</p>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            Se puede dar de alta a mano, o rescatar el expediente de un recibo de nómina que
            ya se haya timbrado antes, desde el Lector de XML.
          </p>
          <div className="flex justify-center gap-3 mt-4">
            <Link to="/nomina/empleados" className="bg-primary text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-600">
              Dar de alta
            </Link>
            <Link to="/xml-super-import" className="border px-4 py-2 rounded-lg text-sm hover:bg-gray-50">
              Importar de un XML
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Una tarjeta del tablero. El pie lleva el dato que le da contexto al número
 * de arriba —el promedio, cuántas bajas— sin robarle protagonismo: si sube al
 * mismo tamaño, ya son dos números peleando y no se lee ninguno.
 */
function Tarjeta({ titulo, valor, icono, pie }: {
  titulo: string; valor: any; icono?: React.ReactNode; pie?: string;
}) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <p className="text-xs text-gray-500 flex items-center gap-1.5">{icono} {titulo}</p>
      <p className="text-xl font-bold mt-1 text-gray-900">{valor}</p>
      {pie && <p className="text-[11px] text-gray-400 mt-0.5">{pie}</p>}
    </div>
  );
}

export default NominaDashboardPage;


/**
 * Un origen de crédito. Muestra las tres cifras que se preguntan al revisar:
 * a cuántos, cuánto falta y cuánto se va cada periodo. Sin la última no se
 * puede saber si el saldo va a alcanzar a liquidarse antes de que el
 * trabajador se vaya.
 */
function Credito({ titulo, nota, d, color }: any) {
  const hay = Number(d?.creditos || 0) > 0;
  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <div className="flex items-baseline justify-between">
        <span className="font-semibold text-sm">{titulo}</span>
        <span className="text-xs opacity-70">
          {hay
            ? `${d.trabajadores} trabajador(es) · ${d.creditos} crédito(s)`
            : 'sin créditos vigentes'}
        </span>
      </div>
      {hay && (
        <div className="flex gap-6 mt-2">
          <div>
            <p className="text-[11px] opacity-70">Saldo por descontar</p>
            <p className="text-lg font-bold tabular-nums">{money(d.saldo)}</p>
          </div>
          <div>
            <p className="text-[11px] opacity-70">Cada periodo</p>
            <p className="text-lg font-bold tabular-nums">{money(d.porPeriodo)}</p>
          </div>
        </div>
      )}
      <p className="text-[11px] opacity-60 mt-1.5">{nota}</p>
    </div>
  );
}


/**
 * Un descuento que se rige por una REGLA y no por un saldo.
 *
 * El INFONAVIT y la pensión alimenticia no se acaban cuando se paga cierta
 * cantidad: siguen hasta que el instituto o el juzgado digan otra cosa. Poner
 * un "saldo por descontar" ahí sería inventarlo.
 *
 * Lo que sí se puede decir es cuánto pesa la parte de CUOTA FIJA, que es la
 * única sumable sin conocer el periodo, y cuántos van por una regla variable.
 */
function Regla({ titulo, nota, trabajadores, fijo, variables, extra, color }: any) {
  const hay = Number(trabajadores || 0) > 0;
  const conRegla = (variables || []).filter(([, n]: any) => Number(n) > 0);
  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <div className="flex items-baseline justify-between">
        <span className="font-semibold text-sm">{titulo}</span>
        <span className="text-xs opacity-70">
          {hay ? `${trabajadores} trabajador(es)` : 'nadie con este descuento'}
        </span>
      </div>
      {hay && (
        <>
          <div className="flex gap-6 mt-2">
            {Number(fijo) > 0 && (
              <div>
                <p className="text-[11px] opacity-70">Cuota fija, cada periodo</p>
                <p className="text-lg font-bold tabular-nums">{money(fijo)}</p>
              </div>
            )}
            {conRegla.map(([etiqueta, n]: any) => (
              <div key={etiqueta}>
                <p className="text-[11px] opacity-70">{etiqueta}</p>
                <p className="text-lg font-bold tabular-nums">{n}</p>
              </div>
            ))}
          </div>
          {conRegla.length > 0 && (
            <p className="text-[11px] opacity-70 mt-1">
              Esos se calculan en cada periodo: dependen del salario y de los días.
            </p>
          )}
          {extra && <p className="text-[11px] opacity-70 mt-0.5">{extra}</p>}
        </>
      )}
      <p className="text-[11px] opacity-60 mt-1.5">{nota}</p>
    </div>
  );
}
