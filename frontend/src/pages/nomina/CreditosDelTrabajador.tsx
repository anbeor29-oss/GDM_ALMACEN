/**
 * CreditosDelTrabajador — préstamos de la empresa y créditos FONACOT.
 *
 * POR QUÉ NO SON CASILLAS COMO EL INFONAVIT
 * El crédito de vivienda acompaña a la persona durante años, así que en su
 * ficha cabe como una casilla con su regla de descuento. Un préstamo no: se
 * pide, se descuenta unas semanas y se acaba — y mientras tanto puede haber
 * otro encima. Como casilla habría que borrarlo al terminar, y con él la
 * historia de lo que se le descontó.
 *
 * LO QUE ESTA PANTALLA TIENE QUE DEJAR VER
 * El SALDO, que es lo único que alguien pregunta ("¿cuánto me falta?"), y
 * cuántos periodos quedan al ritmo actual. Lo demás —monto original, fecha— es
 * contexto.
 *
 * NO SE ABONA DESDE AQUÍ
 * Los abonos los aplica el cierre de la nómina, con el periodo al que
 * pertenecen. Un botón de "abonar" suelto en esta pantalla invitaría a
 * descontar dos veces lo mismo: una a mano y otra en la raya.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Coins, Plus, X, AlertTriangle, Ban } from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const ETIQUETA: Record<string, { texto: string; cls: string }> = {
  PRESTAMO: { texto: 'Préstamo de la empresa', cls: 'bg-sky-100 text-sky-800' },
  FONACOT:  { texto: 'FONACOT',                cls: 'bg-violet-100 text-violet-800' },
};

const ESTATUS: Record<string, string> = {
  ACTIVO: 'text-emerald-700',
  LIQUIDADO: 'text-slate-500',
  SUSPENDIDO: 'text-amber-700',
  CANCELADO: 'text-slate-400 line-through',
};

export function CreditosDelTrabajador({
  empleadoId, puedeEditar,
}: {
  empleadoId?: string;
  puedeEditar: boolean;
}) {
  const [alta, setAlta] = useState(false);
  const [error, setError] = useState('');

  const q = useQuery({
    queryKey: ['creditos-nomina', empleadoId],
    queryFn: () => api.getCreditosNomina({ empleadoId, incluirCerrados: true }),
    enabled: !!empleadoId,
  });
  const creditos: any[] = q.data?.data?.creditos || [];

  /* Sin expediente guardado no hay a qué colgar un crédito: el trabajador
   * todavía no tiene id. Se dice, en vez de enseñar una lista vacía que
   * parecería que no tiene ninguno. */
  if (!empleadoId) {
    return (
      <div className="border rounded-lg p-5 text-sm text-gray-600 bg-slate-50">
        <p className="font-medium text-gray-700">Préstamos y FONACOT</p>
        <p className="mt-1">
          Se capturan cuando el expediente ya está guardado. Da de alta al
          trabajador primero y vuelve a abrir su ficha.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm">{error}</div>
      )}

      <div className="flex items-center justify-between">
        <p className="font-medium text-sm text-gray-700 flex items-center gap-2">
          <Coins size={16} className="text-sky-600" /> Préstamos y créditos FONACOT
        </p>
        {puedeEditar && !alta && (
          <button type="button" onClick={() => setAlta(true)}
            className="flex items-center gap-1.5 text-sm text-primary hover:underline">
            <Plus size={15} /> Agregar
          </button>
        )}
      </div>

      {alta && (
        <FormaDeCredito
          empleadoId={empleadoId}
          onCancelar={() => setAlta(false)}
          onGuardado={() => { setAlta(false); q.refetch(); }}
        />
      )}

      {q.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}

      {!q.isLoading && creditos.length === 0 && !alta && (
        <p className="text-sm text-gray-500 italic border rounded-lg px-4 py-6 text-center">
          No tiene préstamos ni créditos FONACOT.
        </p>
      )}

      {creditos.map((c) => {
        const e = ETIQUETA[c.origen] || { texto: c.origen, cls: 'bg-gray-100 text-gray-700' };
        const avance = Number(c.monto_original) > 0
          ? (Number(c.abonado) / Number(c.monto_original)) * 100
          : 0;
        return (
          <div key={c.id} className="border rounded-lg p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ${e.cls}`}>{e.texto}</span>
                {c.numero && <span className="ml-2 text-xs font-mono text-gray-500">{c.numero}</span>}
                <span className={`ml-2 text-xs ${ESTATUS[c.estatus] || ''}`}>{c.estatus.toLowerCase()}</span>
                {c.concepto && <p className="text-sm text-gray-700 mt-0.5">{c.concepto}</p>}
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Saldo</p>
                <p className="font-bold text-gray-900">{money(c.saldo)}</p>
              </div>
            </div>

            {/* La barra dice de un vistazo cuánto lleva pagado. */}
            <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, avance)}%` }} />
            </div>

            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
              <span>Crédito: <b>{money(c.monto_original)}</b></span>
              <span>Abonado: <b>{money(c.abonado)}</b></span>
              <span>Por periodo: <b>{money(c.descuento_por_periodo)}</b></span>
              {c.estatus === 'ACTIVO' && Number(c.saldo) > 0 && (
                <span>Faltan <b>{c.periodos_restantes}</b> periodo(s)</span>
              )}
              <span className="text-gray-400">desde {c.fecha_inicio}</span>
            </div>

            {puedeEditar && c.estatus === 'ACTIVO' && (
              <div className="mt-2 flex gap-3">
                <button type="button"
                  onClick={async () => {
                    setError('');
                    try {
                      await api.cambiarEstatusCreditoNomina(c.id, 'SUSPENDIDO', 'Suspendido desde el expediente');
                      q.refetch();
                    } catch (err: any) {
                      setError(err?.response?.data?.message || 'No se pudo suspender');
                    }
                  }}
                  className="text-xs text-amber-700 hover:underline flex items-center gap-1">
                  <Ban size={12} /> Suspender
                </button>
              </div>
            )}
            {puedeEditar && c.estatus === 'SUSPENDIDO' && (
              <button type="button"
                onClick={async () => {
                  setError('');
                  try {
                    await api.cambiarEstatusCreditoNomina(c.id, 'ACTIVO', 'Reanudado desde el expediente');
                    q.refetch();
                  } catch (err: any) {
                    setError(err?.response?.data?.message || 'No se pudo reanudar');
                  }
                }}
                className="mt-2 text-xs text-emerald-700 hover:underline">
                Reanudar el descuento
              </button>
            )}
          </div>
        );
      })}

      <p className="text-[11px] text-gray-500 flex items-start gap-1.5">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        Los abonos los aplica el cierre de la nómina, con el periodo al que pertenecen.
        Un crédito deja de descontarse cuando llega a cero, no cuando llega su fecha
        estimada: basta un periodo sin pago para que las dos cosas dejen de coincidir.
      </p>
    </div>
  );
}

/** Alta de un crédito. Corto a propósito: son seis datos, no un expediente. */
function FormaDeCredito({
  empleadoId, onCancelar, onGuardado,
}: {
  empleadoId: string;
  onCancelar: () => void;
  onGuardado: () => void;
}) {
  const [f, setF] = useState<any>({
    origen: 'PRESTAMO', numero: '', concepto: '',
    monto_original: '', descuento_por_periodo: '',
    fecha_inicio: new Date().toISOString().slice(0, 10),
    fecha_fin_estimada: '',
  });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const campo = 'w-full border rounded-lg px-3 py-1.5 text-sm';
  const etiqueta = 'block text-xs font-medium text-gray-600 mb-1';
  const set = (k: string, v: any) => setF({ ...f, [k]: v });

  const guardar = async () => {
    setGuardando(true); setError('');
    try {
      await api.crearCreditoNomina({
        empleado_id: empleadoId,
        origen: f.origen,
        numero: f.numero || null,
        concepto: f.concepto || null,
        monto_original: Number(f.monto_original),
        descuento_por_periodo: Number(f.descuento_por_periodo),
        fecha_inicio: f.fecha_inicio,
        fecha_fin_estimada: f.fecha_fin_estimada || null,
      });
      onGuardado();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  };

  /* Cuántos periodos saldría, con lo capturado. Se enseña mientras se escribe
   * porque es la comprobación que hace cualquiera de cabeza, y ver "104
   * periodos" delata de inmediato una cuota mal tecleada. */
  const periodos =
    Number(f.monto_original) > 0 && Number(f.descuento_por_periodo) > 0
      ? Math.ceil(Number(f.monto_original) / Number(f.descuento_por_periodo))
      : null;

  return (
    <div className="border border-sky-200 bg-sky-50/40 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm">Nuevo crédito</p>
        <button type="button" onClick={onCancelar} className="text-gray-400 hover:text-gray-600">
          <X size={16} />
        </button>
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className={etiqueta}>Origen</label>
          <select className={campo} value={f.origen} onChange={(e) => set('origen', e.target.value)}>
            <option value="PRESTAMO">Préstamo de la empresa</option>
            <option value="FONACOT">Crédito FONACOT</option>
          </select>
        </div>
        <div>
          <label className={etiqueta}>
            Número de crédito {f.origen === 'FONACOT' && <span className="text-rose-600">*</span>}
          </label>
          <input className={campo} value={f.numero} onChange={(e) => set('numero', e.target.value)}
            placeholder={f.origen === 'FONACOT' ? 'El que asignó el FONACOT' : 'Opcional'} />
        </div>
        <div className="sm:col-span-2">
          <label className={etiqueta}>Concepto</label>
          <input className={campo} value={f.concepto} onChange={(e) => set('concepto', e.target.value)}
            placeholder="Ej. préstamo personal, compra de herramienta…" />
        </div>
        <div>
          <label className={etiqueta}>Monto del crédito *</label>
          <input type="number" step="0.01" className={campo}
            value={f.monto_original} onChange={(e) => set('monto_original', e.target.value)} />
        </div>
        <div>
          <label className={etiqueta}>Descuento por periodo *</label>
          <input type="number" step="0.01" className={campo}
            value={f.descuento_por_periodo} onChange={(e) => set('descuento_por_periodo', e.target.value)} />
          {periodos !== null && (
            <p className={`text-[11px] mt-1 ${periodos > 60 ? 'text-amber-700' : 'text-gray-500'}`}>
              Saldría en {periodos} periodo(s){periodos > 60 && ' — revisa la cuota'}
            </p>
          )}
        </div>
        <div>
          <label className={etiqueta}>Inicio *</label>
          <input type="date" className={campo}
            value={f.fecha_inicio} onChange={(e) => set('fecha_inicio', e.target.value)} />
        </div>
        <div>
          <label className={etiqueta}>Término estimado</label>
          <input type="date" className={campo}
            value={f.fecha_fin_estimada} onChange={(e) => set('fecha_fin_estimada', e.target.value)} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar}
          className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
          Cancelar
        </button>
        <button type="button" onClick={guardar} disabled={guardando}
          className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
          {guardando ? 'Guardando…' : 'Guardar crédito'}
        </button>
      </div>
    </div>
  );
}

export default CreditosDelTrabajador;
