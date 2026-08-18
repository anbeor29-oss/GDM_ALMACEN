/**
 * Parámetros de nómina — lo que le falta a la empresa para ser patrón.
 *
 * POR QUÉ ESTA PANTALLA PIDE TAN POCO
 * El sistema de nómina que se integró traía su propia alta de empresa: RFC,
 * razón social, régimen, domicilio y el CSD. Todo eso YA se capturó en Datos de
 * mi empresa, y volver a pedirlo dejaría dos verdades sobre el mismo RFC —con
 * el riesgo real de timbrar la nómina con un certificado distinto al de la
 * facturación—. Así que arriba se MUESTRA la empresa, sin poder editarla, y
 * abajo se piden únicamente los tres datos que nómina necesita y que no existen
 * en ningún otro lado.
 *
 * LOS MÍNIMOS SE PROPONEN, NO SE GUARDAN SOLOS
 * 15 días de aguinaldo y 25 % de prima vacacional son los mínimos de la LFT, y
 * el botón los llena — pero alguien tiene que confirmarlos. Una empresa que da
 * 30 días de aguinaldo con los mínimos puestos por omisión calcularía mal el
 * SDI y por lo tanto las cuotas, sin que nada se viera roto en pantalla.
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, ShieldCheck, AlertTriangle, Save, Info, ExternalLink } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';

export function NominaParametrosPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const esAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role || '');

  const q = useQuery({ queryKey: ['nomina-parametros'], queryFn: () => api.getNominaParametros() });
  const d: any = q.data?.data;

  const [form, setForm] = useState<any>({
    registro_patronal: '', prima_riesgo: '', fi_aguinaldo_dias: '', fi_prima_vac_pct: '',
  });
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (!d?.parametros) return;
    setForm({
      registro_patronal: d.parametros.registro_patronal ?? '',
      prima_riesgo:      d.parametros.prima_riesgo ?? '',
      fi_aguinaldo_dias: d.parametros.fi_aguinaldo_dias ?? '',
      fi_prima_vac_pct:  d.parametros.fi_prima_vac_pct ?? '',
    });
  }, [d]);

  const guardar = useMutation({
    mutationFn: (datos: any) => api.guardarNominaParametros(datos),
    onSuccess: () => {
      setError(''); setAviso('Parámetros guardados.');
      qc.invalidateQueries({ queryKey: ['nomina-parametros'] });
    },
    onError: (e: any) => {
      setAviso('');
      setError(e?.response?.data?.message || 'No se pudieron guardar los parámetros');
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    guardar.mutate({
      registro_patronal: form.registro_patronal || null,
      prima_riesgo:      form.prima_riesgo === '' ? null : Number(form.prima_riesgo),
      fi_aguinaldo_dias: form.fi_aguinaldo_dias === '' ? undefined : Number(form.fi_aguinaldo_dias),
      fi_prima_vac_pct:  form.fi_prima_vac_pct === '' ? undefined : Number(form.fi_prima_vac_pct),
    });
  };

  const campo = 'w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Parámetros de nómina</h1>
        <p className="text-sm text-gray-500 mt-1">
          A la izquierda lo del patrón, que cada empresa captura. A la derecha lo que
          publica el DOF y es igual para todos.
        </p>
      </div>

      <div className="grid xl:grid-cols-2 gap-6 items-start">
      <div className="space-y-6">

      {aviso && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-sm">{aviso}</div>}
      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      {/* La empresa, de sólo lectura: se captura una vez y en un solo lugar. */}
      <div className="bg-slate-50 border rounded-lg p-5">
        <h2 className="font-semibold flex items-center gap-2 text-slate-700">
          <Building2 size={18} /> Empresa
        </h2>
        {q.isLoading ? (
          <p className="text-sm text-gray-500 mt-2">Cargando…</p>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mt-3 text-sm">
              <p><span className="text-gray-500">Razón social:</span> {d?.empresa?.razonSocial}</p>
              <p><span className="text-gray-500">RFC:</span> <span className="font-mono">{d?.empresa?.rfc}</span></p>
              <p><span className="text-gray-500">Régimen fiscal:</span> {d?.empresa?.regimenFiscal}</p>
              <p><span className="text-gray-500">Código postal:</span> {d?.empresa?.codigoPostal || '—'}</p>
              <p className="sm:col-span-2 flex items-center gap-1.5">
                <span className="text-gray-500">Sello digital:</span>
                {d?.empresa?.tieneCsd
                  ? <span className="text-emerald-700 inline-flex items-center gap-1"><ShieldCheck size={14} /> cargado</span>
                  : <span className="text-amber-700 inline-flex items-center gap-1"><AlertTriangle size={14} /> falta</span>}
              </p>
            </div>
            <p className="text-xs text-gray-500 mt-3 flex items-start gap-1.5">
              <Info size={14} className="mt-0.5 shrink-0" />
              Estos datos y el CSD se capturan una sola vez, en <strong>Datos de mi empresa</strong>.
              La nómina se timbra con ese mismo certificado — no hay otro.
            </p>
          </>
        )}
      </div>

      {/* Lo que falta para poder correr una nómina. */}
      {d?.faltantes?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-sm">
          <p className="font-medium">Todavía falta capturar:</p>
          <ul className="mt-1 space-y-0.5">
            {d.faltantes.map((f: string) => <li key={f}>▸ {f}</li>)}
          </ul>
        </div>
      )}

      <form onSubmit={onSubmit} className="bg-white rounded-lg shadow border p-5 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Registro patronal ante el IMSS
          </label>
          <input
            className={`${campo} font-mono uppercase`}
            value={form.registro_patronal}
            maxLength={11}
            disabled={!esAdmin}
            onChange={(e) => setForm({ ...form, registro_patronal: e.target.value.toUpperCase() })}
            placeholder="Y5512345108"
          />
          <p className="text-xs text-gray-500 mt-1">
            11 posiciones, como aparece en la tarjeta de identificación patronal. Va en cada recibo.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Prima de riesgo de trabajo (%)
          </label>
          <input
            type="number" step="0.00001" min="0.5" max="15"
            className={campo}
            value={form.prima_riesgo}
            disabled={!esAdmin}
            onChange={(e) => setForm({ ...form, prima_riesgo: e.target.value })}
            placeholder="0.54355"
          />
          <p className="text-xs text-gray-500 mt-1">
            La que el IMSS determinó para esta empresa, como porcentaje (0.54355, no 0.0054355).
            Se revisa cada febrero y cambia la cuota patronal.
          </p>
        </div>

        <div className="border-t pt-5">
          <p className="text-sm font-medium text-gray-700">Factor de integración del SDI</p>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">
            Con esto se integra el salario diario (Art. 84 LSS). La ley fija mínimos;
            lo que la empresa dé de más también integra y sube las cuotas.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-700 mb-1">Días de aguinaldo</label>
              <input
                type="number" min={15} max={365}
                className={campo}
                value={form.fi_aguinaldo_dias}
                disabled={!esAdmin}
                onChange={(e) => setForm({ ...form, fi_aguinaldo_dias: e.target.value })}
                placeholder={String(d?.sugeridos?.aguinaldoDias ?? 15)}
              />
              <p className="text-xs text-gray-500 mt-1">Mínimo de ley: 15 (Art. 87 LFT)</p>
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">Prima vacacional (%)</label>
              <input
                type="number" step="0.01" min={25} max={100}
                className={campo}
                value={form.fi_prima_vac_pct}
                disabled={!esAdmin}
                onChange={(e) => setForm({ ...form, fi_prima_vac_pct: e.target.value })}
                placeholder={String(d?.sugeridos?.primaVacPct ?? 25)}
              />
              <p className="text-xs text-gray-500 mt-1">Mínimo de ley: 25 % (Art. 80 LFT)</p>
            </div>
          </div>
          {esAdmin && (
            <button
              type="button"
              className="mt-3 text-sm text-primary hover:underline"
              onClick={() => setForm({
                ...form,
                fi_aguinaldo_dias: d?.sugeridos?.aguinaldoDias ?? 15,
                fi_prima_vac_pct: d?.sugeridos?.primaVacPct ?? 25,
              })}
            >
              Usar los mínimos de ley
            </button>
          )}
        </div>

        {esAdmin ? (
          <button
            type="submit"
            disabled={guardar.isPending}
            className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            <Save size={16} /> {guardar.isPending ? 'Guardando…' : 'Guardar parámetros'}
          </button>
        ) : (
          <p className="text-sm text-gray-500">
            Sólo el administrador de la empresa puede cambiar estos parámetros.
          </p>
        )}
      </form>
      </div>

      {/* ── Columna derecha: lo que publica el DOF ──
          Aquí no se captura: se consulta. Son los números con los que el motor
          calcula, a la vista y con la liga a su fuente, para que cotejar contra
          el DOF sea abrir una pestaña y no buscar el PDF. */}
      <PanelFiscal />
      </div>
    </div>
  );
}


/**
 * PanelFiscal — los números del DOF, a la vista y con su liga.
 *
 * POR QUÉ CONSULTA Y NO CAPTURA
 * La UMA, la tarifa del Art. 96 y el salario mínimo son del país, no de la
 * empresa: si cada quien pudiera moverlos, dos empresas del mismo sistema
 * retendrían distinto el mismo impuesto. Se cargan por migración cotejada
 * contra el DOF y aquí sólo se ven. Cambiarlos es tarea del SUPER_ADMIN.
 *
 * POR QUÉ VAN LAS LIGAS
 * Cada enero y cada febrero estos números cambian, y el trabajo de verificarlos
 * empieza por encontrar la publicación. Tenerlas aquí convierte "cotejar contra
 * el DOF" en abrir una pestaña.
 */
function PanelFiscal() {
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(anioActual);
  const [verTarifa, setVerTarifa] = useState(true);

  const q = useQuery({
    queryKey: ['ejercicio-nomina', anio],
    queryFn: () => api.getEjercicioNomina(anio),
    retry: false,
  });
  const e: any = q.data?.data;

  const mxn = (v: any) =>
    v === null || v === undefined
      ? '—'
      : Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

  const FUENTES = [
    { que: 'Tarifas del ISR — Anexo 8 de la RMF', donde: 'SAT',
      url: 'https://www.sat.gob.mx/normatividad/22988/anexos-de-la-resolucion-miscelanea-fiscal-' },
    { que: 'Valor de la UMA', donde: 'INEGI',
      url: 'https://www.inegi.org.mx/temas/uma/' },
    { que: 'Unidad Mixta Infonavit (UMI)', donde: 'INFONAVIT',
      url: 'https://portalmx.infonavit.org.mx/' },
    { que: 'Salarios mínimos vigentes', donde: 'CONASAMI',
      url: 'https://www.gob.mx/conasami/documentos/tabla-de-salarios-minimos-generales-y-profesionales-por-areas-geograficas' },
    { que: 'Subsidio al empleo y decretos', donde: 'DOF',
      url: 'https://www.dof.gob.mx/' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow border p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2 text-slate-700">
            <Info size={18} /> Valores del ejercicio
          </h2>
          <select
            value={anio}
            onChange={(ev) => setAnio(Number(ev.target.value))}
            className="border rounded-lg px-2 py-1 text-sm"
          >
            {[anioActual + 1, anioActual, anioActual - 1, anioActual - 2].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        {q.isLoading && <p className="text-sm text-gray-500 mt-3">Cargando…</p>}
        {q.isError && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3">
            No hay parámetros cargados para {anio}. El sistema no usa los del año anterior:
            retendría de más o de menos a toda la plantilla.
          </p>
        )}

        {e && (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 mt-4 text-sm">
              {/* El servidor manda estos campos en camelCase —umaDiaria, no
                  uma_diaria— porque vienen del objeto Ejercicio que usa el
                  motor, no de la fila de la tabla. Leerlos con el nombre de la
                  columna dejaba todo en "—" y el tope en NaN. */}
              <Dato titulo="UMA diaria"      valor={mxn(e.umaDiaria)} />
              <Dato titulo="UMA mensual"     valor={mxn(e.umaMensual)} />
              <Dato titulo="UMI diaria"      valor={mxn(e.umiDiaria)}
                    nota="Créditos INFONAVIT en VSM" />
              <Dato titulo="Salario mínimo"  valor={mxn(e.smgGeneral)} nota="Zona general" />
              <Dato titulo="Mínimo frontera" valor={mxn(e.smgFrontera)}
                    nota="Zona Libre de la Frontera Norte" />
              <Dato titulo="Tope de 25 UMA"
                    valor={e.umaDiaria ? mxn(Number(e.umaDiaria) * 25) : '—'}
                    nota="Art. 28 LSS — SBC máximo" />
            </div>

            <div className="mt-4 flex items-center gap-2 flex-wrap">
              {e.confirmado ? (
                <span className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 inline-flex items-center gap-1">
                  <ShieldCheck size={13} /> Cotejado contra el DOF
                </span>
              ) : (
                <span className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-flex items-center gap-1">
                  <AlertTriangle size={13} /> Sin cotejar contra el DOF
                </span>
              )}
              <span className="text-xs text-gray-500">
                {e.tarifaIsr?.length || 0} renglones de tarifa
              </span>
            </div>

            {e.fuente && (
              <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">{e.fuente}</p>
            )}
          </>
        )}
      </div>

      {/* La tarifa completa, plegada: son once renglones que casi nunca se
          miran, pero cuando se miran se miran enteros. */}
      {e?.tarifaIsr?.length > 0 && (
        <div className="bg-white rounded-lg shadow border p-5">
          <button
            onClick={() => setVerTarifa(!verTarifa)}
            className="w-full flex items-center justify-between font-semibold text-slate-700"
          >
            <span>Tarifa mensual del Art. 96 LISR</span>
            <span className="text-xs font-normal text-primary">
              {verTarifa ? 'ocultar' : 'ver los renglones'}
            </span>
          </button>

          {verTarifa && (
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-xs tabular-nums">
                <thead className="bg-gray-50 border-b text-gray-600">
                  <tr>
                    <th className="px-2 py-1.5 text-right">Límite inferior</th>
                    <th className="px-2 py-1.5 text-right">Límite superior</th>
                    <th className="px-2 py-1.5 text-right">Cuota fija</th>
                    <th className="px-2 py-1.5 text-right">% excedente</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {e.tarifaIsr.map((r: any, i: number) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-2 py-1 text-right">{mxn(r.limite_inferior)}</td>
                      <td className="px-2 py-1 text-right">
                        {r.limite_superior === null
                          ? <span className="text-gray-400">en adelante</span>
                          : mxn(r.limite_superior)}
                      </td>
                      <td className="px-2 py-1 text-right">{mxn(r.cuota_fija)}</td>
                      <td className="px-2 py-1 text-right">{Number(r.porcentaje).toFixed(2)} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* El subsidio va FUERA del desplegable: desde 2024 son uno o dos
              renglones —no una escalera de once— y caben a la vista. Esconderlo
              obligaba a abrir la tarifa para ver un dato que se consulta más. */}
          {e.subsidio?.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <p className="text-sm font-medium text-slate-700 mb-2">Subsidio al empleo</p>
              <table className="w-full text-xs tabular-nums">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-2 py-1 text-left">Vigencia</th>
                    <th className="px-2 py-1 text-right">Hasta ingresos de</th>
                    <th className="px-2 py-1 text-right">% de la UMA</th>
                    <th className="px-2 py-1 text-right">Subsidio</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {e.subsidio.map((sb: any, i: number) => (
                    <tr key={i}>
                      <td className="px-2 py-1">
                        {sb.vigente_desde || sb.vigente_hasta
                          ? `${sb.vigente_desde || 'inicio'} al ${sb.vigente_hasta || 'fin de año'}`
                          : 'todo el ejercicio'}
                      </td>
                      <td className="px-2 py-1 text-right">{mxn(sb.limite_superior)}</td>
                      <td className="px-2 py-1 text-right">
                        {sb.porcentaje_uma ? `${Number(sb.porcentaje_uma).toFixed(2)} %` : '—'}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold">{mxn(sb.subsidio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="bg-slate-50 border rounded-lg p-5">
        <h2 className="font-semibold text-slate-700 mb-1">Dónde se actualizan</h2>
        <p className="text-xs text-gray-500 mb-3">
          Cambian cada año: las tarifas y el subsidio a finales de diciembre, el salario
          mínimo el 1 de enero, la UMA y la UMI el 1 de febrero.
        </p>
        <ul className="space-y-2">
          {FUENTES.map((f) => (
            <li key={f.url} className="text-sm flex items-start gap-2">
              <ExternalLink size={13} className="mt-1 shrink-0 text-gray-400" />
              <span>
                <a href={f.url} target="_blank" rel="noopener noreferrer"
                   className="text-primary hover:underline">{f.que}</a>
                <span className="text-xs text-gray-500"> · {f.donde}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-gray-500 mt-3">
          Cargarlos es tarea del SUPER_ADMIN, por migración y cotejando renglón por renglón.
          Copiar la tabla del año pasado retendría de más o de menos a toda la plantilla.
        </p>
      </div>
    </div>
  );
}

function Dato({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{titulo}</p>
      <p className="font-semibold tabular-nums">{valor}</p>
      {nota && <p className="text-[10px] text-gray-400">{nota}</p>}
    </div>
  );
}

export default NominaParametrosPage;
