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
import { Building2, ShieldCheck, AlertTriangle, Save, Info } from 'lucide-react';
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
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Parámetros de nómina</h1>
        <p className="text-sm text-gray-500 mt-1">
          Los datos del patrón que el IMSS determina y que no viven en ningún otro lado.
        </p>
      </div>

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
  );
}

export default NominaParametrosPage;
