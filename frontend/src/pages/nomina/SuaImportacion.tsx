/**
 * SUA · Importación — NEXO le arma al SUA los .txt que el SUA importa.
 *
 * DOS PASOS, Y EN ESE ORDEN
 * Primero las ALTAS (Aseg.txt + Afil.txt), luego los MOVIMIENTOS (Movt.txt) y
 * los CRÉDITOS (Cred.txt). Un movimiento de alguien que el SUA todavía no conoce
 * se rechaza, así que las pestañas están en ese orden y no hay un botón que
 * mande todo junto.
 *
 * LO QUE ESTA PANTALLA EVITA
 * Recapturar el padrón a mano en el SUA, y mandar dos veces lo mismo: la
 * bitácora marca lo ya enviado y los avisos lo dicen ANTES de generar. El SUA
 * rechaza el archivo completo y deja su explicación en un ErrImp*.txt de su
 * carpeta; por eso cada lote se cierra aquí con el resultado, y ese texto se
 * puede pegar para que quede con el lote.
 *
 * Ref: docs/NEXO_A_SUA.md
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileDown, Search, X, AlertTriangle, CheckCircle2, Info,
  SlidersHorizontal, ClipboardList, Trash2, ChevronDown, ChevronRight, FileWarning,
} from 'lucide-react';
import api from '@/services/api';
import { confirmar } from '@/utils/avisos';
import { claseOpcion } from '@/utils/coloresOpciones';
import { CampoFecha, aTextoMx } from '@/components/CampoFecha';
import { useCapacidades, CAP } from '@/utils/capacidades';

type Pestana = 'altas' | 'movimientos' | 'creditos' | 'bitacora';

const PESTANAS: Array<{ id: Pestana; nombre: string }> = [
  { id: 'altas', nombre: '1 · Altas' },
  { id: 'movimientos', nombre: '2 · Movimientos' },
  { id: 'creditos', nombre: '3 · Créditos' },
  { id: 'bitacora', nombre: 'Bitácora' },
];

/** Tipos de movimiento de crédito del SUA, con su código. */
const TIPOS_CREDITO: Array<{ id: string; nombre: string; codigo: string }> = [
  { id: 'INICIO', nombre: 'Inicio de descuento', codigo: '15' },
  { id: 'SUSPENSION', nombre: 'Suspensión', codigo: '16' },
  { id: 'REINICIO', nombre: 'Reinicio', codigo: '17' },
  { id: 'MODIFICACION_VALOR', nombre: 'Cambio de valor', codigo: '19' },
];

const CODIGO_MOVTO: Record<string, string> = { BAJA: '02', MODIFICACION: '07', REINGRESO: '08' };
const NOMBRE_MOVTO: Record<string, string> = {
  BAJA: 'Baja', MODIFICACION: 'Modificación de salario', REINGRESO: 'Reingreso',
};
const NOMBRE_DESCUENTO: Record<string, string> = {
  porcentaje: 'Porcentaje', cuota_fija: 'Cuota fija', vsm: 'Factor (VSM)',
};

/** Primer y último día del mes en curso, en AAAA-MM-DD. */
function mesActual(): { desde: string; hasta: string } {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return {
    desde: `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`,
    hasta: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(ultimo)}`,
  };
}

const pesos = (n: any) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/** Lo que se marcó de un candidato: si entra, con qué fecha y qué tipo. */
interface Marca {
  incluir: boolean;
  fecha: string;
  tipo?: string;        // movimientos y créditos
  sbc?: string;         // corrige el del expediente
}

export function SuaImportacionPage() {
  const { puede } = useCapacidades();
  const esAdmin = puede(CAP.nomina);
  const qc = useQueryClient();

  const [pestana, setPestana] = useState<Pestana>('altas');
  const [rango, setRango] = useState(mesActual);
  const [marcas, setMarcas] = useState<Record<string, Marca>>({});
  const [verParametros, setVerParametros] = useState(false);
  const [conAfiliatorios, setConAfiliatorios] = useState(true);
  const [cfg, setCfg] = useState({
    tipoTrabajador: '1', semanaJornada: '0', tipoSalario: '0',
    umf: '000', ocupacion: '', claveUbicacion: '', claveMunicipio: '',
    pensionado: '0', tablaDisminucion: 'N',
  });

  /* Modificaciones de salario: no salen de un rango de fechas, las agrega quien
   * captura buscando al trabajador. */
  const [buscar, setBuscar] = useState('');
  const [extra, setExtra] = useState<Record<string, any>>({});

  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [avisos, setAvisos] = useState<string[]>([]);
  const [generando, setGenerando] = useState(false);
  const [abierto, setAbierto] = useState<Record<string, boolean>>({});
  const [erroresDe, setErroresDe] = useState<{ id: string; texto: string } | null>(null);
  /** El ErrImp ya guardado de un lote, cuando se pide verlo. */
  const [guardado, setGuardado] = useState<{ id: string; texto: string } | null>(null);

  const candQ = useQuery({
    queryKey: ['sua-candidatos', rango.desde, rango.hasta],
    queryFn: () => api.getSuaCandidatos(rango.desde, rango.hasta),
    enabled: Boolean(rango.desde && rango.hasta),
  });
  const candidatos: any[] = candQ.data?.data?.candidatos || [];

  const lotesQ = useQuery({ queryKey: ['sua-lotes'], queryFn: () => api.getSuaLotes() });
  const lotes: any[] = lotesQ.data?.data?.lotes || [];

  const busQ = useQuery({
    queryKey: ['sua-empleados', buscar],
    queryFn: () => api.getEmpleados({ buscar }),
    enabled: pestana === 'movimientos' && buscar.trim().length >= 2,
  });
  const encontrados: any[] = busQ.data?.data?.empleados || [];

  /* Una llave por candidato: el mismo trabajador puede aparecer como baja y como
   * crédito en el mismo rango, y cada renglón se marca por su cuenta. */
  const llave = (c: any) => `${c.empleado_id}|${c.motivo}`;
  const marca = (c: any): Marca =>
    marcas[llave(c)] || {
      incluir: false,
      fecha: c.fecha || '',
      tipo: c.motivo === 'CREDITO' ? 'INICIO' : c.motivo,
      sbc: '',
    };
  const marcar = (c: any, cambio: Partial<Marca>) =>
    setMarcas((p) => ({ ...p, [llave(c)]: { ...marca(c), ...cambio } }));

  const deMotivo = (...motivos: string[]) => candidatos.filter((c) => motivos.includes(c.motivo));
  const marcados = (lista: any[]) => lista.filter((c) => marca(c).incluir);

  const limpiarMensajes = () => { setError(''); setOk(''); setAvisos([]); };

  /** Guarda los .txt que devolvió el backend y cuenta lo que pasó. */
  async function entregar(data: any, queFue: string) {
    const archivos: any[] = data?.archivos || [];
    for (const a of archivos) await api.guardarTxtSua(a.nombre, a.contenido);
    setAvisos(data?.avisos || []);
    setOk(
      `${queFue}: ${archivos.map((a) => `${a.nombre} (${a.renglones})`).join(' + ')}. ` +
      (data?.loteId ? 'Quedó en la bitácora.' : 'OJO: no quedó en la bitácora.'),
    );
    qc.invalidateQueries({ queryKey: ['sua-lotes'] });
    qc.invalidateQueries({ queryKey: ['sua-candidatos'] });
    setMarcas({});
  }

  async function generarAltas() {
    const lista = marcados(deMotivo('ALTA'));
    if (!lista.length) { setError('Marca al menos un trabajador.'); return; }
    limpiarMensajes(); setGenerando(true);
    try {
      const r = await api.generarSuaAltas({
        altas: lista.map((c) => {
          const m = marca(c);
          return { empleadoId: c.empleado_id, fecha: m.fecha || undefined,
                   sbc: m.sbc ? Number(m.sbc) : undefined };
        }),
        afiliatorios: conAfiliatorios,
        ...cfg,
      });
      await entregar(r.data, 'Altas generadas');
    } catch (e: any) { setError(e?.response?.data?.message || e?.message || 'No se pudo generar.'); }
    finally { setGenerando(false); }
  }

  async function generarMovimientos() {
    const delRango = marcados(deMotivo('BAJA', 'REINGRESO'));
    const agregados = Object.values(extra).filter((x: any) => x.incluir);
    if (!delRango.length && !agregados.length) { setError('Marca al menos un movimiento.'); return; }
    limpiarMensajes(); setGenerando(true);
    try {
      const r = await api.generarSuaMovimientos({
        movimientos: [
          ...delRango.map((c) => {
            const m = marca(c);
            return { empleadoId: c.empleado_id, tipo: c.motivo, fecha: m.fecha,
                     sbc: m.sbc ? Number(m.sbc) : undefined };
          }),
          ...agregados.map((x: any) => ({
            empleadoId: x.id, tipo: 'MODIFICACION', fecha: x.fecha,
            sbc: x.sbc ? Number(x.sbc) : undefined,
          })),
        ],
        ...cfg,
      });
      await entregar(r.data, 'Movimientos generados');
      setExtra({});
    } catch (e: any) { setError(e?.response?.data?.message || e?.message || 'No se pudo generar.'); }
    finally { setGenerando(false); }
  }

  async function generarCreditos() {
    const lista = marcados(deMotivo('CREDITO'));
    if (!lista.length) { setError('Marca al menos un crédito.'); return; }
    limpiarMensajes(); setGenerando(true);
    try {
      const r = await api.generarSuaCreditos({
        creditos: lista.map((c) => {
          const m = marca(c);
          return { empleadoId: c.empleado_id, tipo: m.tipo || 'INICIO', fecha: m.fecha };
        }),
        ...cfg,
      });
      await entregar(r.data, 'Créditos generados');
    } catch (e: any) { setError(e?.response?.data?.message || e?.message || 'No se pudo generar.'); }
    finally { setGenerando(false); }
  }

  async function cerrarLote(lote: any, resultado: 'IMPORTADO' | 'CON_ERRORES' | 'PENDIENTE') {
    limpiarMensajes();
    try {
      const pegado = erroresDe && erroresDe.id === lote.id ? erroresDe.texto : '';
      const txt = resultado === 'CON_ERRORES' ? pegado : undefined;
      await api.registrarSuaResultado(lote.id, resultado, txt);
      setErroresDe(null);
      setOk(
        resultado === 'IMPORTADO' ? 'Lote marcado como importado.'
        : resultado === 'CON_ERRORES'
          ? 'Lote marcado con errores: sus movimientos vuelven a aparecer como pendientes.'
          : 'Lote de vuelta a pendiente.',
      );
      qc.invalidateQueries({ queryKey: ['sua-lotes'] });
      qc.invalidateQueries({ queryKey: ['sua-candidatos'] });
    } catch (e: any) { setError(e?.response?.data?.message || e?.message || 'No se pudo guardar.'); }
  }

  async function borrarLote(lote: any) {
    if (!await confirmar(
      `¿Borrar este lote de ${lote.num_renglones} renglón(es) de la bitácora?\n\n` +
      'Lo que tenía dejará de contar como enviado y volverá a aparecer como pendiente.',
    )) return;
    try {
      await api.borrarSuaLote(lote.id);
      qc.invalidateQueries({ queryKey: ['sua-lotes'] });
      qc.invalidateQueries({ queryKey: ['sua-candidatos'] });
      setOk('Lote borrado de la bitácora.');
    } catch (e: any) { setError(e?.response?.data?.message || e?.message || 'No se pudo borrar.'); }
  }

  const cuantos = useMemo(() => ({
    altas: deMotivo('ALTA').length,
    movimientos: deMotivo('BAJA', 'REINGRESO').length,
    creditos: deMotivo('CREDITO').length,
    bitacora: lotes.length,
  }), [candidatos, lotes]);

  if (!esAdmin) {
    return (
      <div className="p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-sm">
          Esta pantalla mueve la afiliación de la gente ante el IMSS, así que es de nómina.
          Pídele a quien administra la nómina que la abra.
        </div>
      </div>
    );
  }

  /* ─────────────── Un renglón de la tabla de candidatos ─────────────── */
  const Renglon = ({ c, children }: { c: any; children?: any }) => {
    const m = marca(c);
    return (
      <tr className={`border-b border-gray-100 ${m.incluir ? 'bg-blue-50/40' : ''}`}>
        <td className="px-2 py-2">
          <input
            type="checkbox" className="w-4 h-4"
            checked={m.incluir}
            disabled={!c.listo}
            onChange={(e) => marcar(c, { incluir: e.target.checked })}
          />
        </td>
        <td className="px-2 py-2 text-xs text-gray-500">{c.num_empleado || '—'}</td>
        <td className="px-2 py-2">
          <div className="text-sm text-gray-900">{c.quien}</div>
          <div className="text-xs text-gray-500 font-mono">{c.nss || 'sin NSS'}</div>
        </td>
        {children}
        <td className="px-2 py-2 text-xs">
          {c.falta ? (
            <span className="inline-flex items-center gap-1 text-rose-700">
              <AlertTriangle className="w-3.5 h-3.5" /> {c.falta}
            </span>
          ) : c.enviado ? (
            <span className="inline-flex items-center gap-1 text-amber-700" title={c.enviado_detalle || ''}>
              <Info className="w-3.5 h-3.5" /> ya se mandó {aTextoMx(c.enviado_en)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" /> listo
            </span>
          )}
        </td>
      </tr>
    );
  };

  const Tabla = ({ children, cols }: { children: any; cols: string[] }) => (
    <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-2 py-2 w-8"></th>
            <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">No.</th>
            <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">Trabajador</th>
            {cols.map((c) => (
              <th key={c} className="px-2 py-2 text-left text-xs font-medium text-gray-500">{c}</th>
            ))}
            <th className="px-2 py-2 text-left text-xs font-medium text-gray-500">Estado</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );

  const Vacio = ({ texto }: { texto: string }) => (
    <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
      {texto}
    </div>
  );

  const BotonGenerar = ({ onClick, children, n }: { onClick: () => void; children: any; n: number }) => (
    <button
      onClick={onClick}
      disabled={generando || n === 0}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm
                 font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <FileDown className="w-4 h-4" />
      {generando ? 'Generando…' : children}
      {n > 0 && <span className="bg-white/20 rounded px-1.5">{n}</span>}
    </button>
  );

  return (
    <div className="p-6 space-y-4 bg-white min-h-full">
      {/* ── Encabezado ── */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">SUA · Importación</h1>
        <p className="text-sm text-gray-600 mt-1">
          NEXO le arma al SUA los archivos que el SUA importa, para no recapturar nada.
          Van en dos tiempos: <strong>primero las altas</strong> (el SUA tiene que conocer al
          trabajador) y <strong>luego sus movimientos</strong>.
        </p>
      </div>

      {/* ── Pestañas ── */}
      <div className="flex flex-wrap gap-2">
        {PESTANAS.map((p, i) => (
          <button
            key={p.id}
            onClick={() => { setPestana(p.id); limpiarMensajes(); }}
            className={claseOpcion(i, pestana === p.id)}
          >
            {p.nombre}
            {(cuantos as any)[p.id] > 0 && (
              <span className="ml-1.5 opacity-70">({(cuantos as any)[p.id]})</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Rango y parámetros ── */}
      {pestana !== 'bitacora' && (
        <div className="flex flex-wrap items-end gap-3 border border-gray-200 rounded-lg p-3 bg-gray-50">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Desde</label>
            <CampoFecha value={rango.desde} onChange={(v) => setRango((r) => ({ ...r, desde: v }))} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Hasta</label>
            <CampoFecha value={rango.hasta} onChange={(v) => setRango((r) => ({ ...r, hasta: v }))} />
          </div>
          <button
            onClick={() => setVerParametros((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300
                       text-sm text-gray-700 hover:bg-white"
          >
            <SlidersHorizontal className="w-4 h-4" /> Parámetros del SUA
          </button>
          {candQ.isFetching && <span className="text-xs text-gray-500">buscando…</span>}
        </div>
      )}

      {verParametros && pestana !== 'bitacora' && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <p className="text-xs text-gray-600">
            Lo que el SUA pide y el expediente no guarda. Los valores que ya están puestos son
            los que predominan en el SUA: trabajador permanente, semana completa, salario fijo.
            La clave de municipio es la del catálogo del SUA (A01, Y45…) y puede ir vacía.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {([
              ['tipoTrabajador', 'Tipo de trabajador (1-4)'],
              ['semanaJornada', 'Semana/jornada (0-6)'],
              ['tipoSalario', 'Tipo de salario (0-2)'],
              ['umf', 'UMF / clínica'],
              ['ocupacion', 'Ocupación'],
              ['claveUbicacion', 'Clave de ubicación'],
              ['claveMunicipio', 'Clave de municipio'],
              ['pensionado', 'Pensionado (0/1)'],
              ['tablaDisminucion', 'Tabla de disminución (N/S)'],
            ] as Array<[string, string]>).map(([k, etiqueta]) => (
              <div key={k}>
                <label className="block text-xs text-gray-500 mb-1">{etiqueta}</label>
                <input
                  value={(cfg as any)[k]}
                  onChange={(e) => setCfg((c) => ({ ...c, [k]: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Mensajes ── */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-800 whitespace-pre-line flex gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <div>{error}</div>
        </div>
      )}
      {ok && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800 flex gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> <div>{ok}</div>
        </div>
      )}
      {avisos.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
          <div className="font-medium mb-1">Léelo antes de importar en el SUA:</div>
          <ul className="list-disc pl-5 space-y-0.5">
            {avisos.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}

      {/* ─────────────────────────── ALTAS ─────────────────────────── */}
      {pestana === 'altas' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Genera <code>Aseg.txt</code> con el padrón y, si lo dejas marcado,{' '}
            <code>Afil.txt</code> con los datos afiliatorios. En el SUA se importan los dos.
          </p>
          {deMotivo('ALTA').length === 0 ? (
            <Vacio texto="No hay trabajadores que ingresaran en este rango de fechas." />
          ) : (
            <Tabla cols={['Fecha de alta', 'SBC']}>
              {deMotivo('ALTA').map((c) => (
                <Renglon key={llave(c)} c={c}>
                  <td className="px-2 py-2">
                    <CampoFecha value={marca(c).fecha} onChange={(v) => marcar(c, { fecha: v })} />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={marca(c).sbc ?? ''}
                      onChange={(e) => marcar(c, { sbc: e.target.value })}
                      placeholder={String(c.sbc ?? '')}
                      className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                    />
                    <div className="text-xs text-gray-400 text-right">{pesos(c.sbc)}</div>
                  </td>
                </Renglon>
              ))}
            </Tabla>
          )}
          <div className="flex items-center gap-4">
            <BotonGenerar onClick={generarAltas} n={marcados(deMotivo('ALTA')).length}>
              Generar altas
            </BotonGenerar>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox" className="w-4 h-4"
                checked={conAfiliatorios}
                onChange={(e) => setConAfiliatorios(e.target.checked)}
              />
              incluir Afil.txt
            </label>
          </div>
        </div>
      )}

      {/* ──────────────────────── MOVIMIENTOS ──────────────────────── */}
      {pestana === 'movimientos' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Genera <code>Movt.txt</code>: bajas ({CODIGO_MOVTO.BAJA}), modificaciones de
            salario ({CODIGO_MOVTO.MODIFICACION}) y reingresos ({CODIGO_MOVTO.REINGRESO}).
            El alta no va aquí y la baja del SUA no lleva causa: no existe el campo.
          </p>

          {deMotivo('BAJA', 'REINGRESO').length === 0 ? (
            <Vacio texto="No hay bajas ni reingresos en este rango de fechas." />
          ) : (
            <Tabla cols={['Movimiento', 'Fecha', 'SBC']}>
              {deMotivo('BAJA', 'REINGRESO').map((c) => (
                <Renglon key={llave(c)} c={c}>
                  <td className="px-2 py-2 text-sm">
                    <span className="font-mono text-xs bg-gray-100 rounded px-1.5 py-0.5 mr-1">
                      {CODIGO_MOVTO[c.motivo]}
                    </span>
                    {NOMBRE_MOVTO[c.motivo]}
                  </td>
                  <td className="px-2 py-2">
                    <CampoFecha value={marca(c).fecha} onChange={(v) => marcar(c, { fecha: v })} />
                  </td>
                  <td className="px-2 py-2 text-sm text-right text-gray-500">
                    {c.motivo === 'BAJA' ? '—' : pesos(c.sbc)}
                  </td>
                </Renglon>
              ))}
            </Tabla>
          )}

          {/* Modificación de salario: se agrega a mano, no sale de un rango. */}
          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <div className="text-sm font-medium text-gray-800">
              Agregar una modificación de salario
            </div>
            <div className="relative max-w-md">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" />
              <input
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                placeholder="Busca por nombre, NSS o número de empleado"
                className="w-full pl-8 pr-8 py-2 border border-gray-300 rounded-lg text-sm"
              />
              {buscar && (
                <button onClick={() => setBuscar('')} className="absolute right-2 top-2.5">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              )}
            </div>
            {buscar.trim().length >= 2 && (
              <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                {encontrados.map((e: any) => (
                  <button
                    key={e.id}
                    onClick={() => setExtra((p) => ({
                      ...p,
                      [e.id]: {
                        id: e.id, quien: e.nombre_completo || `${e.nombre} ${e.apellido_pat}`,
                        nss: e.nss, incluir: true,
                        fecha: rango.desde,
                        sbc: e.sbc != null ? String(e.sbc) : (e.salario_diario_integrado ?? ''),
                      },
                    }))}
                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-blue-50"
                  >
                    {e.nombre_completo || `${e.nombre} ${e.apellido_pat}`}
                    <span className="text-xs text-gray-500 font-mono ml-2">{e.nss || 'sin NSS'}</span>
                  </button>
                ))}
                {encontrados.length === 0 && !busQ.isFetching && (
                  <div className="text-xs text-gray-500 px-2 py-2">Nadie con eso.</div>
                )}
              </div>
            )}

            {Object.values(extra).length > 0 && (
              <div className="space-y-2 pt-1">
                {Object.values(extra).map((x: any) => (
                  <div key={x.id} className="flex flex-wrap items-end gap-2 bg-gray-50 rounded p-2">
                    <div className="flex-1 min-w-[180px]">
                      <div className="text-sm text-gray-900">{x.quien}</div>
                      <div className="text-xs text-gray-500 font-mono">{x.nss || 'sin NSS'}</div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Fecha</label>
                      <CampoFecha
                        value={x.fecha}
                        onChange={(v) => setExtra((p) => ({ ...p, [x.id]: { ...x, fecha: v } }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Nuevo SBC</label>
                      <input
                        value={x.sbc}
                        onChange={(e) => setExtra((p) => ({ ...p, [x.id]: { ...x, sbc: e.target.value } }))}
                        className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm text-right"
                      />
                    </div>
                    <button
                      onClick={() => setExtra((p) => { const n = { ...p }; delete n[x.id]; return n; })}
                      className="p-2 text-gray-400 hover:text-rose-600"
                      title="Quitar"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <BotonGenerar
            onClick={generarMovimientos}
            n={marcados(deMotivo('BAJA', 'REINGRESO')).length
               + Object.values(extra).filter((x: any) => x.incluir).length}
          >
            Generar movimientos
          </BotonGenerar>
        </div>
      )}

      {/* ───────────────────────── CRÉDITOS ───────────────────────── */}
      {pestana === 'creditos' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Genera <code>Cred.txt</code> con los movimientos de crédito INFONAVIT. El número,
            el tipo y el valor del descuento salen del expediente; aquí se dice qué movimiento
            es y con qué fecha. El SUA no acepta uno con fecha anterior al último que recibió.
          </p>
          {deMotivo('CREDITO').length === 0 ? (
            <Vacio texto="Ningún trabajador activo tiene crédito INFONAVIT en su expediente." />
          ) : (
            <Tabla cols={['Movimiento', 'Fecha', 'Crédito', 'Descuento']}>
              {deMotivo('CREDITO').map((c) => (
                <Renglon key={llave(c)} c={c}>
                  <td className="px-2 py-2">
                    <select
                      value={marca(c).tipo || 'INICIO'}
                      onChange={(e) => marcar(c, { tipo: e.target.value })}
                      className="px-2 py-1.5 border border-gray-300 rounded text-sm"
                    >
                      {TIPOS_CREDITO.map((t) => (
                        <option key={t.id} value={t.id}>{t.codigo} · {t.nombre}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <CampoFecha value={marca(c).fecha} onChange={(v) => marcar(c, { fecha: v })} />
                  </td>
                  <td className="px-2 py-2 text-xs font-mono text-gray-600">
                    {c.num_credito || '—'}
                  </td>
                  <td className="px-2 py-2 text-xs text-gray-600">
                    {c.tipo_descuento ? NOMBRE_DESCUENTO[c.tipo_descuento] || c.tipo_descuento : '—'}
                    {c.descuento != null && <span className="ml-1 text-gray-400">{c.descuento}</span>}
                  </td>
                </Renglon>
              ))}
            </Tabla>
          )}
          <BotonGenerar onClick={generarCreditos} n={marcados(deMotivo('CREDITO')).length}>
            Generar créditos
          </BotonGenerar>
        </div>
      )}

      {/* ───────────────────────── BITÁCORA ───────────────────────── */}
      {pestana === 'bitacora' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Lo que se le mandó al SUA. El SUA no devuelve acuse —deja sus rechazos en los{' '}
            <code>ErrImp*.txt</code> de su carpeta—, así que dile aquí cómo le fue. Un lote
            marcado <strong>con errores</strong> deja de contar como enviado y sus movimientos
            vuelven a aparecer como pendientes.
          </p>

          {lotes.length === 0 ? (
            <Vacio texto="Todavía no se ha generado nada para el SUA." />
          ) : (
            <div className="space-y-2">
              {lotes.map((l) => (
                <div key={l.id} className="border border-gray-200 rounded-lg bg-white">
                  <div className="flex flex-wrap items-center gap-3 p-3">
                    <button
                      onClick={() => setAbierto((p) => ({ ...p, [l.id]: !p[l.id] }))}
                      className="text-gray-400 hover:text-gray-700"
                    >
                      {abierto[l.id] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <div className="flex-1 min-w-[200px]">
                      <div className="text-sm font-medium text-gray-900">
                        {l.paso} · {l.archivos || '—'}
                        <span className="ml-2 text-xs text-gray-500">{l.num_renglones} renglón(es)</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {aTextoMx(String(l.created_at).slice(0, 10))}
                        {l.creado_por ? ` · ${l.creado_por}` : ''}
                        {l.registro_patronal ? ` · ${l.registro_patronal}` : ''}
                      </div>
                    </div>
                    <span className={
                      l.resultado === 'IMPORTADO' ? 'text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-800'
                      : l.resultado === 'CON_ERRORES' ? 'text-xs px-2 py-1 rounded bg-rose-100 text-rose-800'
                      : 'text-xs px-2 py-1 rounded bg-gray-100 text-gray-700'
                    }>
                      {l.resultado === 'CON_ERRORES' ? 'con errores'
                        : l.resultado === 'IMPORTADO' ? 'importado' : 'pendiente'}
                    </span>
                    {l.resultado !== 'IMPORTADO' && (
                      <button
                        onClick={() => cerrarLote(l, 'IMPORTADO')}
                        className="text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                      >
                        Entró al SUA
                      </button>
                    )}
                    <button
                      onClick={() => setErroresDe(
                        erroresDe?.id === l.id ? null : { id: l.id, texto: '' },
                      )}
                      className="text-xs px-2 py-1 rounded border border-rose-300 text-rose-700 hover:bg-rose-50"
                    >
                      <FileWarning className="w-3.5 h-3.5 inline mr-1" />
                      Lo rechazó
                    </button>
                    {l.tiene_errores_txt && (
                      <button
                        onClick={async () => {
                          try { setGuardado({ id: l.id, texto: await api.getSuaLoteErrores(l.id) }); }
                          catch (e: any) { setError(e?.message || 'No se pudo leer el ErrImp.'); }
                        }}
                        className="text-xs text-blue-700 hover:underline"
                      >
                        ver ErrImp
                      </button>
                    )}
                    <button
                      onClick={() => borrarLote(l)}
                      className="p-1.5 text-gray-400 hover:text-rose-600" title="Borrar de la bitácora"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {erroresDe && erroresDe.id === l.id && (
                    <div className="border-t border-gray-100 p-3 space-y-2 bg-rose-50/40">
                      <div className="text-xs text-gray-700">
                        Pega aquí el <code>ErrImp*.txt</code> que dejó el SUA en su carpeta
                        (<code>ErrImpTr</code> altas, <code>ErrImpMv</code> movimientos,{' '}
                        <code>ErrImpCr</code> créditos). Se guarda tal cual.
                      </div>
                      <textarea
                        value={erroresDe.texto}
                        onChange={(e) => setErroresDe({ id: l.id, texto: e.target.value })}
                        rows={5}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs font-mono"
                        placeholder="A016872710351018203185…!Error: Ya existe un Movimiento de Crédito en esta fecha o posterior"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => cerrarLote(l, 'CON_ERRORES')}
                          className="text-xs px-3 py-1.5 rounded bg-rose-600 text-white hover:bg-rose-700"
                        >
                          Guardar como rechazado
                        </button>
                        <button
                          onClick={() => setErroresDe(null)}
                          className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-700"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {guardado && guardado.id === l.id && (
                    <div className="border-t border-gray-100 p-3 bg-gray-50">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-xs font-medium text-gray-700">
                          ErrImp guardado con este lote
                        </div>
                        <button onClick={() => setGuardado(null)} className="text-gray-400 hover:text-gray-700">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <pre className="text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto
                                      bg-white border border-gray-200 rounded p-2">{guardado.texto}</pre>
                    </div>
                  )}

                  {abierto[l.id] && (
                    <div className="border-t border-gray-100 overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            {['Tipo', 'Trabajador', 'NSS', 'Fecha', 'Importe', 'Crédito'].map((h) => (
                              <th key={h} className="px-3 py-1.5 text-left text-xs font-medium text-gray-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(l.renglones || []).map((r: any, i: number) => (
                            <tr key={i} className="border-b border-gray-50">
                              <td className="px-3 py-1.5 text-xs font-mono">{r.tipo}</td>
                              <td className="px-3 py-1.5 text-sm">{r.nombre}</td>
                              <td className="px-3 py-1.5 text-xs font-mono text-gray-500">{r.nss}</td>
                              <td className="px-3 py-1.5 text-xs">{aTextoMx(r.fecha)}</td>
                              <td className="px-3 py-1.5 text-xs text-right">{r.importe ?? '—'}</td>
                              <td className="px-3 py-1.5 text-xs font-mono text-gray-500">{r.num_credito || ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="text-xs text-gray-500 flex items-start gap-1.5">
            <ClipboardList className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Borra un lote si el archivo se generó y nunca se importó: mientras esté ahí, el
            sistema cree que esos movimientos ya fueron.
          </div>
        </div>
      )}
    </div>
  );
}

export default SuaImportacionPage;
