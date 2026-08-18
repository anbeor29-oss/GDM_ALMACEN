/**
 * CapturaDeConceptos — otros ingresos y otros egresos de un trabajador.
 *
 * DE DÓNDE SALE EL CATÁLOGO
 * Del servidor, que lo saca del mismo sitio que el motor de cálculo: las claves
 * del c_TipoPercepcion y c_TipoDeduccion del Anexo 20, cada una con su regla de
 * exención. Copiar la lista aquí garantizaría que un día la pantalla ofrezca un
 * concepto que el motor no sabe gravar.
 *
 * LA EXENCIÓN NO SE CAPTURA, SE CALCULA
 * El aguinaldo está exento hasta 30 salarios mínimos, los vales hasta el 40 %
 * de la UMA mensual, los premios de puntualidad hasta el 10 % del sueldo. Eso lo
 * decide el Art. 93 según el concepto y no quien captura — por eso aquí sólo se
 * escribe el importe y el reparto aparece al recalcular.
 *
 * SALVO EN LOS CONCEPTOS 'manual'
 * Horas extra, prima dominical, indemnización: ahí la ley no fija una exención
 * automática y hay que decir cuánto grava. El campo aparece SÓLO en esos, en
 * vez de estar siempre y que alguien lo llene donde no debe.
 */
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Plus, Trash2 } from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export interface Linea {
  clave: string;
  importe: number | string;
  gravadoManual?: number | string;
  concepto?: string;
}

interface Props {
  /** 'ingresos' → percepciones · 'egresos' → deducciones */
  lado: 'ingresos' | 'egresos';
  nombreTrabajador: string;
  lineas: Linea[];
  /* Para preguntarle al motor cuánto grava lo capturado. Sin esto la pantalla
   * tendría que calcular la exención por su cuenta, y entonces la regla del
   * Art. 93 viviría en dos lugares. */
  periodoId?: string;
  empleadoId?: string;
  onGuardar: (l: Linea[]) => void;
  onCerrar: () => void;
}

export function CapturaDeConceptos({ lado, nombreTrabajador, lineas, periodoId, empleadoId, onGuardar, onCerrar }: Props) {
  const [filas, setFilas] = useState<Linea[]>(lineas.length ? lineas : [{ clave: '', importe: '' }]);

  const cat = useQuery({ queryKey: ['nomina-catalogos'], queryFn: () => api.getNominaCatalogos() });
  const percepciones: any[] = cat.data?.data?.percepciones || [];
  const deducciones: any[] = cat.data?.data?.deducciones || [];
  const catalogo = lado === 'ingresos' ? percepciones : deducciones;

  const conceptoDe = (clave: string) => catalogo.find((c: any) => c.clave === clave);

  const set = (i: number, campo: keyof Linea, v: any) => {
    const f = [...filas];
    (f[i] as any)[campo] = v;
    setFilas(f);
  };

  const total = filas.reduce((a, f) => a + (Number(f.importe) || 0), 0);

  /* ── Cuánto de esto grava, según el Anexo 20 ──
   *
   * Se le pregunta al motor cada vez que cambia la captura, con medio segundo
   * de espera para no disparar una consulta por cada tecla. Mientras responde
   * se conserva el desglose anterior: parpadear en cada dígito se lee peor que
   * ir medio segundo atrás. */
  const [desglose, setDesglose] = useState<any>(null);
  const [partiendo, setPartiendo] = useState(false);

  const listasParaPartir = filas.filter((f) => f.clave && Number(f.importe) > 0);
  const huella = JSON.stringify(
    listasParaPartir.map((f) => [f.clave, f.importe, f.gravadoManual])
  );

  useEffect(() => {
    if (!periodoId || !empleadoId || listasParaPartir.length === 0) {
      setDesglose(null);
      return;
    }
    let vivo = true;
    setPartiendo(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.partirConceptos({
          periodoId, empleadoId, lado,
          lineas: listasParaPartir.map((f) => ({
            clave: f.clave,
            importe: Number(f.importe),
            gravadoManual:
              f.gravadoManual === undefined || f.gravadoManual === ''
                ? undefined
                : Number(f.gravadoManual),
          })),
        });
        if (vivo) setDesglose(r.data);
      } catch {
        /* Que no se pueda partir no debe impedir capturar: el recálculo del
         * periodo lo vuelve a hacer, y ahí sí con todo. */
        if (vivo) setDesglose(null);
      } finally {
        if (vivo) setPartiendo(false);
      }
    }, 500);
    return () => { vivo = false; clearTimeout(t); };
  }, [huella, periodoId, empleadoId, lado]);

  /* Cómo se explica la exención de cada concepto, sin repetir la fórmula del
   * motor: se dice la REGLA, no el resultado — el resultado sale al recalcular. */
  const explicacion = (c: any): string => {
    if (!c) return '';
    switch (c.tipo) {
      case 'exento_total':    return 'No causa ISR.';
      case 'gravado_total':   return 'Grava por completo.';
      case 'smg':             return `Exento hasta ${c.factor} veces el salario mínimo (Art. 93).`;
      case 'uma_diaria':      return `Exento hasta ${c.factor} × UMA diaria × días trabajados.`;
      case 'uma_mensual_pct': return `Exento hasta el ${c.factor * 100} % de la UMA mensual.`;
      case 'sal_pct':         return `Exento hasta el ${c.factor * 100} % del salario del periodo.`;
      case 'manual':          return 'La ley no fija exención automática: indica cuánto grava.';
      default:                return '';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full my-8">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="font-semibold">
              {lado === 'ingresos' ? 'Otros ingresos' : 'Otros egresos'}
            </h2>
            <p className="text-xs text-gray-500">{nombreTrabajador}</p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-600">
            Claves del Anexo 20 ({lado === 'ingresos' ? 'c_TipoPercepcion' : 'c_TipoDeduccion'}).
            {lado === 'ingresos' && ' La exención la calcula el sistema según el concepto — tú capturas el importe.'}
          </p>

          <div className="space-y-2">
            {filas.map((f, i) => {
              const c = conceptoDe(String(f.clave));
              const esManual = c?.tipo === 'manual';
              return (
                <div key={i} className="border rounded-lg p-2.5">
                  <div className="flex gap-2 items-start">
                    <select
                      className="flex-1 border rounded-lg px-2 py-1.5 text-sm min-w-0"
                      value={f.clave}
                      onChange={(e) => set(i, 'clave', e.target.value)}
                    >
                      <option value="">— elige el concepto —</option>
                      {catalogo.map((x: any) => (
                        <option key={x.clave} value={x.clave}>
                          {x.clave} · {x.nombre}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number" step="0.01" placeholder="Importe"
                      className="w-32 border rounded-lg px-2 py-1.5 text-sm text-right"
                      value={f.importe}
                      onChange={(e) => set(i, 'importe', e.target.value)}
                    />
                    <button
                      onClick={() => setFilas(filas.filter((_, k) => k !== i))}
                      className="p-1.5 text-gray-400 hover:text-rose-600 shrink-0"
                      title="Quitar"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  {c && (
                    <p className="text-[11px] text-gray-500 mt-1">{explicacion(c)}</p>
                  )}

                  {esManual && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <label className="text-[11px] text-gray-600">Cuánto grava</label>
                      <input
                        type="number" step="0.01"
                        placeholder={`por omisión, todo (${money(f.importe || 0)})`}
                        className="flex-1 border rounded-lg px-2 py-1 text-xs text-right"
                        value={f.gravadoManual ?? ''}
                        onChange={(e) => set(i, 'gravadoManual', e.target.value)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={() => setFilas([...filas, { clave: '', importe: '' }])}
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            <Plus size={15} /> Agregar concepto
          </button>

          {/* Gravado y exento ANTES de la suma: es como el CFDI los reporta por
              separado, y es contra lo que se cuadra la declaración. Sale del
              motor, no de una fórmula repetida aquí. */}
          {lado === 'ingresos' && (
            <div className="border-t pt-3 space-y-1">
              {desglose?.lineas?.length > 0 ? (
                <>
                  {desglose.lineas.map((l: any, i: number) => {
                    const c = conceptoDe(l.clave);
                    return (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-gray-600 truncate mr-3">
                          <span className="text-gray-400 font-mono mr-1">{l.clave}</span>
                          {c?.nombre || 'Concepto'}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          <span className="text-gray-500">grava </span>
                          <b className="text-gray-800">{money(l.gravado)}</b>
                          <span className="text-gray-400 mx-1">·</span>
                          <span className="text-gray-500">exento </span>
                          <b className="text-emerald-700">{money(l.exento)}</b>
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between text-xs font-semibold border-t pt-1.5">
                    <span className="text-gray-700">
                      Según el Anexo 20 {partiendo && <span className="font-normal text-gray-400">· recalculando…</span>}
                    </span>
                    <span className="tabular-nums">
                      <span className="text-gray-500 font-normal">gravado </span>
                      {money(desglose.totales.gravado)}
                      <span className="text-gray-400 mx-1">·</span>
                      <span className="text-gray-500 font-normal">exento </span>
                      <span className="text-emerald-700">{money(desglose.totales.exento)}</span>
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-400 italic">
                  Captura un concepto con importe para ver cuánto grava y cuánto queda exento.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm text-gray-600">
              Total capturado: <b>{money(total)}</b>
            </span>
            <div className="flex gap-2">
              <button onClick={onCerrar}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancelar
              </button>
              <button
                onClick={() => onGuardar(
                  /* Las filas sin concepto o sin importe se descartan aquí y no
                   * en el servidor: son renglones que el usuario dejó a medias,
                   * no un error que valga la pena reportarle. */
                  filas.filter((f) => f.clave && Number(f.importe) > 0)
                )}
                className="px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-blue-600"
              >
                Aplicar y recalcular
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CapturaDeConceptos;
