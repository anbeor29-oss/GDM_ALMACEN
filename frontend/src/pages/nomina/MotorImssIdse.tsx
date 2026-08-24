/**
 * IMSS · IDSE — movimientos afiliatorios (altas/reingresos, bajas y
 * modificaciones de salario) para subir al IDSE del IMSS.
 *
 * LO QUE ESTA PANTALLA RESUELVE
 * El IDSE pide un archivo de texto de posición fija que a mano es imposible de
 * teclear sin equivocarse. Aquí se elige el tipo de movimiento y los trabajadores,
 * se completan los pocos datos que el sistema no puede saber (fecha del acto, la
 * clínica en un alta, la causa en una baja) y el servidor arma el TXT con el NSS,
 * el nombre, el CURP y el salario base que YA viven en el expediente.
 *
 * NO GENERA A MEDIAS
 * Si a alguien le falta el NSS, o a una baja le falta la causa, el archivo no se
 * produce y la pantalla lista a todos los que hay que corregir. El IMSS rechaza
 * el lote completo por un renglón malo; más vale enterarse aquí.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HeartPulse, Search, UserPlus, UserMinus, TrendingUp, X, Download,
  AlertTriangle, CheckCircle2, SlidersHorizontal,
} from 'lucide-react';
import api from '@/services/api';
import { CampoFecha } from '@/components/CampoFecha';
import { useCapacidades, CAP } from '@/utils/capacidades';

type Tipo = 'ALTA' | 'BAJA' | 'MODIFICACION';

/** Causas de baja del IMSS (posición 149 del registro). */
const CAUSAS_BAJA: Record<string, string> = {
  '1': 'Término de contrato', '2': 'Separación voluntaria', '3': 'Abandono de empleo',
  '4': 'Defunción', '5': 'Clausura', '6': 'Otras', '7': 'Ausentismo',
  '8': 'Rescisión de contrato', '9': 'Jubilación', 'A': 'Pensión',
};

const TIPOS: { clave: Tipo; label: string; icono: any; ayuda: string }[] = [
  { clave: 'ALTA',         label: 'Alta / Reingreso',   icono: UserPlus,   ayuda: 'Inscribe o reinscribe al trabajador. Movimiento 08.' },
  { clave: 'BAJA',         label: 'Baja',               icono: UserMinus,  ayuda: 'Da de baja al trabajador con su causa. Movimiento 02.' },
  { clave: 'MODIFICACION', label: 'Modif. de salario',  icono: TrendingUp, ayuda: 'Cambia el salario base de cotización. Movimiento 07.' },
];

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/** Hoy en AAAA-MM-DD según el reloj local (sin corrimiento por UTC). */
function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Lo editable por trabajador seleccionado. */
interface Fila {
  fecha: string;
  sbc: string;
  umf: string;
  clave: string;
  curp: string;
  causaBaja: string;
}

export function MotorImssIdsePage() {
  const { puede } = useCapacidades();
  const esAdmin = puede(CAP.nomina);

  const [tipo, setTipo] = useState<Tipo>('ALTA');
  const [buscar, setBuscar] = useState('');
  const [incluirBajas, setIncluirBajas] = useState(false);
  const [sel, setSel] = useState<Record<string, Fila>>({});
  const [verParametros, setVerParametros] = useState(false);
  const [cfg, setCfg] = useState({ guia: '01400', tipoTrabajador: '1', tipoSalario: '2', jornada: '0' });

  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [generando, setGenerando] = useState(false);

  /* En un reingreso hay que poder tomar a alguien que está de baja. */
  const q = useQuery({
    queryKey: ['empleados-idse', buscar, incluirBajas],
    queryFn: () => api.getEmpleados({ buscar, incluirBajas: incluirBajas || tipo === 'ALTA' }),
  });
  const lista: any[] = q.data?.data?.empleados || [];
  const porId = useMemo(() => new Map(lista.map((e) => [e.id, e])), [lista]);

  const seleccionados = Object.keys(sel);

  const alternar = (e: any) => {
    setOk(''); setError('');
    setSel((prev) => {
      const copia = { ...prev };
      if (copia[e.id]) { delete copia[e.id]; return copia; }
      copia[e.id] = {
        fecha: hoyIso(),
        sbc: String(Number(e.sbc ?? e.salario_diario_integrado ?? 0) || ''),
        umf: '',
        clave: e.num_empleado || '',
        curp: e.curp || '',
        causaBaja: '',
      };
      return copia;
    });
  };

  const editar = (id: string, campo: keyof Fila, valor: string) =>
    setSel((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }));

  const limpiar = () => { setSel({}); setOk(''); setError(''); };

  const generar = async () => {
    setError(''); setOk(''); setGenerando(true);
    try {
      const movimientos = seleccionados.map((id) => {
        const f = sel[id];
        return {
          empleadoId: id,
          fecha: f.fecha,
          sbc: f.sbc === '' ? undefined : Number(f.sbc),
          umf: f.umf || undefined,
          claveTrabajador: f.clave || undefined,
          curp: f.curp || undefined,
          causaBaja: f.causaBaja || undefined,
        };
      });
      await api.generarIdse({ tipo, movimientos, ...cfg });
      setOk(`Archivo IDSE de ${movimientos.length} movimiento(s) descargado. Súbelo en el portal del IDSE.`);
    } catch (e: any) {
      setError(e?.message || 'No se pudo generar el archivo.');
    } finally {
      setGenerando(false);
    }
  };

  const faltaNss = (e: any) => !e?.nss;

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 grid place-items-center">
          <HeartPulse size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">IMSS · IDSE</h1>
          <p className="text-sm text-gray-500">
            Genera el archivo de movimientos afiliatorios (altas, bajas y modificaciones de salario).
          </p>
        </div>
      </div>

      {/* Selector de tipo */}
      <div className="grid sm:grid-cols-3 gap-3">
        {TIPOS.map((t) => {
          const activo = tipo === t.clave;
          const Icono = t.icono;
          return (
            <button
              key={t.clave}
              onClick={() => { setTipo(t.clave); setOk(''); setError(''); }}
              className={`text-left rounded-lg border p-3 transition ${
                activo ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className={`flex items-center gap-2 font-semibold ${activo ? 'text-violet-800' : 'text-gray-800'}`}>
                <Icono size={18} /> {t.label}
              </div>
              <p className="text-xs text-gray-500 mt-1">{t.ayuda}</p>
            </button>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Padrón ── */}
        <div className="bg-white rounded-lg shadow border overflow-hidden">
          <div className="p-3 border-b space-y-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
                placeholder="Buscar por nombre, número, RFC, CURP o NSS…"
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
              />
            </div>
            {tipo !== 'ALTA' && (
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={incluirBajas} onChange={(e) => setIncluirBajas(e.target.checked)} />
                Incluir a los que ya están de baja
              </label>
            )}
          </div>
          <div className="max-h-[26rem] overflow-y-auto divide-y">
            {q.isLoading && <p className="p-4 text-sm text-gray-500">Cargando plantilla…</p>}
            {!q.isLoading && lista.length === 0 && (
              <p className="p-6 text-sm text-gray-500 italic text-center">Nadie coincide con esa búsqueda.</p>
            )}
            {lista.map((e) => {
              const marcado = !!sel[e.id];
              return (
                <button
                  key={e.id}
                  onClick={() => alternar(e)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-50 ${marcado ? 'bg-violet-50/60' : ''}`}
                >
                  <input type="checkbox" readOnly checked={marcado} className="pointer-events-none" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{e.nombre_completo}</p>
                    <p className="text-[11px] text-gray-500 font-mono">
                      #{e.num_empleado || '—'} · NSS {e.nss || <span className="text-rose-600">falta</span>}
                      {!e.activo && <span className="text-rose-600"> · baja</span>}
                    </p>
                  </div>
                  <span className="text-xs text-gray-500 shrink-0">{money(e.sbc || e.salario_diario_integrado)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Movimientos a generar ── */}
        <div className="bg-white rounded-lg shadow border overflow-hidden flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-800">
              {seleccionados.length} movimiento(s) de {TIPOS.find((t) => t.clave === tipo)!.label.toLowerCase()}
            </p>
            {seleccionados.length > 0 && (
              <button onClick={limpiar} className="text-xs text-gray-500 hover:text-rose-600">Quitar todos</button>
            )}
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {seleccionados.length === 0 ? (
              <p className="p-6 text-sm text-gray-500 italic text-center">
                Elige trabajadores de la lista de la izquierda para armar el archivo.
              </p>
            ) : (
              <ul className="divide-y">
                {seleccionados.map((id) => {
                  const e = porId.get(id);
                  const f = sel[id];
                  return (
                    <li key={id} className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{e?.nombre_completo || 'Trabajador'}</p>
                          <p className="text-[11px] font-mono text-gray-500">
                            NSS {e?.nss || <span className="text-rose-600 font-semibold">falta — captúralo en el expediente</span>}
                          </p>
                        </div>
                        <button onClick={() => alternar(e)} className="text-gray-400 hover:text-rose-600 shrink-0">
                          <X size={16} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[11px] text-gray-500">
                          {tipo === 'BAJA' ? 'Fecha de baja' : tipo === 'MODIFICACION' ? 'Fecha del cambio' : 'Fecha de alta'}
                          <CampoFecha value={f.fecha} onChange={(iso) => editar(id, 'fecha', iso)} className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" />
                        </label>

                        {(tipo === 'ALTA' || tipo === 'MODIFICACION') && (
                          <label className="text-[11px] text-gray-500">
                            Salario base (SBC)
                            <input
                              type="number" step="0.01" min="0" value={f.sbc}
                              onChange={(ev) => editar(id, 'sbc', ev.target.value)}
                              className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5"
                            />
                          </label>
                        )}

                        {tipo === 'ALTA' && (
                          <label className="text-[11px] text-gray-500">
                            UMF (clínica)
                            <input
                              value={f.umf} maxLength={3} placeholder="p. ej. 12"
                              onChange={(ev) => editar(id, 'umf', ev.target.value.replace(/\D/g, ''))}
                              className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5"
                            />
                          </label>
                        )}

                        {tipo === 'BAJA' && (
                          <label className="text-[11px] text-gray-500">
                            Causa de baja
                            <select
                              value={f.causaBaja}
                              onChange={(ev) => editar(id, 'causaBaja', ev.target.value)}
                              className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5 bg-white"
                            >
                              <option value="">— elige —</option>
                              {Object.entries(CAUSAS_BAJA).map(([k, v]) => (
                                <option key={k} value={k}>{k} · {v}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Parámetros del archivo (rara vez cambian) */}
          <div className="border-t">
            <button
              onClick={() => setVerParametros((v) => !v)}
              className="w-full px-3 py-2 flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700"
            >
              <SlidersHorizontal size={14} />
              Parámetros del archivo (guía, tipo de trabajador, salario, jornada)
            </button>
            {verParametros && (
              <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <label className="text-[11px] text-gray-500">
                  Guía
                  <input value={cfg.guia} onChange={(e) => setCfg({ ...cfg, guia: e.target.value })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" />
                </label>
                <label className="text-[11px] text-gray-500">
                  Tipo trabajador
                  <input value={cfg.tipoTrabajador} maxLength={1} onChange={(e) => setCfg({ ...cfg, tipoTrabajador: e.target.value })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" />
                </label>
                <label className="text-[11px] text-gray-500">
                  Tipo salario
                  <select value={cfg.tipoSalario} onChange={(e) => setCfg({ ...cfg, tipoSalario: e.target.value })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5 bg-white">
                    <option value="1">1 · Fijo</option>
                    <option value="2">2 · Variable</option>
                    <option value="3">3 · Mixto</option>
                  </select>
                </label>
                <label className="text-[11px] text-gray-500">
                  Jornada
                  <input value={cfg.jornada} maxLength={1} onChange={(e) => setCfg({ ...cfg, jornada: e.target.value })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Avisos */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2 whitespace-pre-line">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}
      {ok && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> <span>{ok}</span>
        </div>
      )}

      {/* Acción */}
      <div className="flex items-center justify-end gap-3">
        {seleccionados.some((id) => faltaNss(porId.get(id))) && (
          <p className="text-xs text-amber-700 flex items-center gap-1 mr-auto">
            <AlertTriangle size={13} /> Hay seleccionados sin NSS: el IMSS lo exige y el archivo no se generará hasta capturarlo.
          </p>
        )}
        <button
          onClick={generar}
          disabled={!esAdmin || generando || seleccionados.length === 0}
          className="bg-violet-600 text-white px-4 py-2 rounded-lg hover:bg-violet-700 flex items-center gap-2 disabled:opacity-50"
          title={!esAdmin ? 'Necesitas la capacidad de nómina para generar movimientos' : undefined}
        >
          <Download size={16} />
          {generando ? 'Generando…' : 'Generar archivo IDSE'}
        </button>
      </div>
    </div>
  );
}
