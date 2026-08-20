/**
 * BancosAnio — los doce meses del año de una cuenta, para cargar y conciliar.
 *
 * ── POR QUÉ UNA REJILLA DE DOCE Y NO UNA LISTA ──
 * Una lista muestra lo que hay. Una rejilla de doce muestra **lo que falta**, y
 * eso es lo que importa: un año con marzo y mayo pero sin abril tiene un salto
 * de saldo que no se explica solo, y cada mes por separado se ve perfecto.
 *
 * El hueco es el dato. Por eso los meses sin cargar ocupan su lugar en vez de
 * no aparecer.
 *
 * ── LA CONCILIACIÓN ──
 * Ingresos contra egresos del año, y el saldo con el que se cierra. Es la
 * lectura que se le da al banco cuando se cuadra contra la contabilidad: cuánto
 * entró, cuánto salió, y con cuánto se quedó uno.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload, FileText, CheckCircle2, AlertTriangle, Trash2,
  ChevronLeft, ChevronRight, TrendingUp, TrendingDown,
} from 'lucide-react';
import api from '@/services/api';
import { useCapacidades, CAP } from '@/utils/capacidades';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function BancosAnio({ cuenta, onCargar }: {
  cuenta: any;
  onCargar: (mes: number, anio: number) => void;
}) {
  const qc = useQueryClient();
  const { puede } = useCapacidades();
  const puedeEditar = puede(CAP.pagar);
  const [anio, setAnio] = useState(new Date().getFullYear());

  const q = useQuery({
    queryKey: ['bancos-control', cuenta.id, anio],
    queryFn: () => api.getControlMensual(cuenta.id, anio),
  });
  const d: any = q.data?.data;
  const meses: any[] = d?.meses || [];
  const porMes = new Map<number, any>(meses.map((m: any) => [m.mes, m]));

  const ingresos = meses.reduce((a, m) => a + Number(m.total_depositos || 0), 0);
  const egresos  = meses.reduce((a, m) => a + Number(m.total_retiros || 0), 0);
  const ultimo   = meses.length ? meses[meses.length - 1] : null;

  const borrar = async (estadoId: string, etiqueta: string) => {
    if (!confirm(`¿Quitar el estado de ${etiqueta}?\n\nSus movimientos se van con él.`)) return;
    await api.borrarEstadoDeCuenta(estadoId);
    qc.invalidateQueries({ queryKey: ['bancos-control', cuenta.id] });
    qc.invalidateQueries({ queryKey: ['bancos-cuentas'] });
  };

  return (
    <div className="space-y-4">
      {/* ── El año ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => setAnio(anio - 1)}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><ChevronLeft size={16} /></button>
          <span className="font-semibold text-lg text-gray-900 w-16 text-center">{anio}</span>
          <button onClick={() => setAnio(anio + 1)}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500"><ChevronRight size={16} /></button>
        </div>

        {/* La conciliación del año: lo que entró, lo que salió, con cuánto se
            cierra. Es la lectura que se cuadra contra contabilidad. */}
        <div className="flex flex-wrap gap-5 ml-auto text-sm">
          <Cifra icono={<TrendingUp size={14} className="text-emerald-600" />}
            rotulo="Ingresos del año" valor={money(ingresos)} color="text-emerald-700" />
          <Cifra icono={<TrendingDown size={14} className="text-rose-600" />}
            rotulo="Egresos del año" valor={money(egresos)} color="text-rose-700" />
          <Cifra rotulo="Diferencia" valor={money(ingresos - egresos)}
            color={ingresos - egresos >= 0 ? 'text-emerald-700' : 'text-rose-700'} />
          {ultimo && (
            <Cifra rotulo={`Saldo al ${String(ultimo.mes).padStart(2, '0')}/${ultimo.anio}`}
              valor={money(ultimo.saldo_final)} color="text-gray-900" />
          )}
        </div>
      </div>

      {/* Los saltos entre meses: el final de uno debe ser el inicial del
          siguiente. Van arriba porque invalidan todo lo que viene después. */}
      {d?.saltos?.map((s: string, i: number) => (
        <p key={i} className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {s}
        </p>
      ))}

      {/* ── Los doce meses ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((mes) => {
          const m = porMes.get(mes);
          const etiqueta = `${MESES[mes]} ${anio}`;

          if (!m) {
            /* El mes sin cargar ocupa su lugar: el hueco es el dato. */
            return (
              <button
                key={mes}
                disabled={!puedeEditar}
                onClick={() => onCargar(mes, anio)}
                className="border border-dashed rounded-lg p-3 text-left hover:border-emerald-400
                  hover:bg-emerald-50/40 transition disabled:opacity-60 disabled:cursor-default"
              >
                <p className="font-medium text-gray-500 text-sm">{MESES[mes]}</p>
                <p className="text-xs text-gray-400 mt-1">Sin estado de cuenta</p>
                {puedeEditar && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700 mt-2">
                    <Upload size={12} /> Cargar PDF
                  </span>
                )}
              </button>
            );
          }

          return (
            <div key={mes} className={`border rounded-lg p-3 ${
              m.cuadra ? 'border-emerald-200 bg-emerald-50/30' : 'border-rose-300 bg-rose-50/40'
            }`}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-gray-900 text-sm">{MESES[mes]}</p>
                {m.cuadra
                  ? <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                  : <AlertTriangle size={15} className="text-rose-600 shrink-0" />}
              </div>

              <p className="text-lg font-bold text-gray-900 tabular-nums mt-1">
                {m.saldo_final === null ? '—' : money(m.saldo_final)}
              </p>

              <div className="text-[11px] mt-1 space-y-0.5">
                <p className="text-emerald-700">+ {money(m.total_depositos)}</p>
                <p className="text-rose-700">− {money(m.total_retiros)}</p>
                <p className="text-gray-500">
                  {m.movimientos_total} movimiento(s)
                  {m.inferidos > 0 && ` · ${m.inferidos} inferido(s)`}
                </p>
              </div>

              {!m.cuadra && (
                <p className="text-[11px] text-rose-700 mt-1">No cuadra con su saldo final</p>
              )}

              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-200/70">
                <button
                  onClick={() => api.descargarCsvEstado(
                    m.id,
                    `${cuenta.alias.replace(/[^\w-]+/g, '_')}-${anio}-${String(mes).padStart(2, '0')}.csv`)}
                  title="Bajar el CSV de este mes"
                  className="text-gray-500 hover:text-primary">
                  <FileText size={14} />
                </button>
                {puedeEditar && (
                  <>
                    <button onClick={() => onCargar(mes, anio)}
                      title="Volver a cargar (reemplaza)"
                      className="text-gray-500 hover:text-emerald-700">
                      <Upload size={14} />
                    </button>
                    <button onClick={() => borrar(m.id, etiqueta)}
                      title="Quitar este mes"
                      className="text-gray-400 hover:text-rose-600 ml-auto">
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {d && d.sinCuadrar > 0 && (
        <p className="text-xs text-rose-700">
          <b>{d.sinCuadrar}</b> mes(es) no cuadran contra el saldo final de su documento.
          Mientras sigan así, el saldo de esta cuenta no es confiable.
        </p>
      )}

      <p className="text-[11px] text-gray-500 border-t pt-2">
        Cada mes es un documento cerrado que cuadra consigo mismo. Los <b>huecos</b> importan
        tanto como lo cargado: si falta un mes, todos los saldos posteriores arrastran la
        diferencia y cada uno por separado se ve bien.
      </p>
    </div>
  );
}

function Cifra({ icono, rotulo, valor, color }: any) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-gray-500 flex items-center gap-1">
        {icono} {rotulo}
      </p>
      <p className={`font-bold tabular-nums ${color}`}>{valor}</p>
    </div>
  );
}

export default BancosAnio;
