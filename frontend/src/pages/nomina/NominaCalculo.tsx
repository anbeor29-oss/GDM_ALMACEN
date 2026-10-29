/**
 * NominaCalculo — elegir el tipo, el periodo, y ver lo que se va a pagar.
 *
 * EL ORDEN DE LA PANTALLA ES EL ORDEN DE LA DECISIÓN
 *   1. Qué nómina — la planta es semanal, la oficina quincenal, y conviven.
 *   2. Qué periodo — de los que ya están generados; si no hay, se generan aquí.
 *   3. Quién y cuánto — la rejilla, que sale sola con quien le toca ese periodo.
 *
 * NADA DE ESTO GUARDA
 * La prenómina se corre veinte veces mientras se ajustan cosas. Se calcula al
 * vuelo cada vez; lo que se persiste es el cierre del periodo, que todavía no
 * está construido.
 *
 * A QUIÉN LE TOCA CADA NÓMINA
 * A quien tenga esa periodicidad en su expediente. Por eso los botones enseñan
 * cuánta gente hay en cada una: un tipo con cero trabajadores casi siempre
 * significa que la periodicidad quedó mal capturada, y verlo antes ahorra
 * generar 53 periodos que nadie va a usar.
 */
import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarPlus, Users, AlertTriangle, RefreshCw, Plus, X, Info, FileSpreadsheet, Lock,
  CalendarClock, CheckCircle2, FileDown, Download, Eye, Mail, Stamp, Check,
} from 'lucide-react';
import api from '@/services/api';
import { CeldaDeConceptos } from './CeldaDeConceptos';
import { CapturaDeConceptos, type Linea } from './CapturaDeConceptos';
import { AplicarAVarios } from './AplicarAVarios';
import { CampoFecha } from '@/components/CampoFecha';
import { aTextoMx } from '@/components/CampoFecha';
import { useCapacidades, CAP } from '@/utils/capacidades';

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const TIPOS = [
  { id: 'SEMANAL',   label: 'Semanal',   emoji: '📅', detalle: 'Hasta 53 periodos al año' },
  { id: 'QUINCENAL', label: 'Quincenal', emoji: '📆', detalle: '24 periodos al año' },
  { id: 'MENSUAL',   label: 'Mensual',   emoji: '📋', detalle: '12 periodos al año' },
  { id: 'ESPECIAL',  label: 'Especial',  emoji: '⚡', detalle: 'PTU, finiquitos, aguinaldo y otras' },
] as const;

export function NominaCalculoPage() {
  /* No es el rol lo que decide, sino la capacidad — y no se adivina: se
   * pregunta al servidor, que es el único que sabe de grupos de trabajo y
   * de otorgamientos individuales. */
  const { puede } = useCapacidades();
  const esAdmin = puede(CAP.nomina);

  const [tipo, setTipo] = useState<string>('SEMANAL');
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [periodoId, setPeriodoId] = useState('');
  const [generando, setGenerando] = useState(false);
  const [creandoEspecial, setCreandoEspecial] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  /* Lo capturado a mano sobre la rejilla, por trabajador. Vive en la pantalla y
   * NO en la base: la prenómina se recalcula al vuelo y sólo el cierre del
   * periodo persiste algo. Al cambiar de periodo se limpia — los conceptos son
   * de esa corrida, no del trabajador. */
  const [captura, setCaptura] = useState<Record<string, { otrosIngresos: Linea[]; otrasDeducciones: Linea[] }>>({});
  const [capturando, setCapturando] = useState<{ lado: 'ingresos' | 'egresos'; renglon: any } | null>(null);
  const [pre, setPre] = useState<any>(null);

  /* Una COLUMNA por cada deducción del Anexo 20 que aparezca (las que no son
   * IMSS/ISR/préstamos/INFONAVIT, que ya tienen su columna fija). Así cada
   * descuento se ve por separado en vez de amontonado en «Otras ded.». */
  const clavesDeduc = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of (pre?.renglones || [])) {
      for (const d of (r.deducciones || [])) {
        if (['001', '002', '011', '012'].includes(d.clave)) continue;
        if (!m.has(d.clave)) m.set(d.clave, d.concepto || `D${d.clave}`);
      }
    }
    return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }, [pre]);
  const dedDe = (r: any, clave: string) =>
    (r.deducciones || []).filter((d: any) => d.clave === clave)
      .reduce((s: number, d: any) => s + (Number(d.importe) || 0), 0);
  const totalDed = (clave: string) =>
    (pre?.renglones || []).reduce((a: number, r: any) => a + dedDe(r, clave), 0);

  /* Lo mismo del lado de INGRESOS: una columna por percepción del Anexo 20 que
   * aparezca (menos el sueldo del periodo, que es la columna «Ingresos»). */
  const clavesPercep = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of (pre?.renglones || [])) {
      for (const p of (r.percepciones || [])) {
        if (p.esSueldoDelPeriodo) continue;
        if (!m.has(p.clave)) m.set(p.clave, p.concepto || `P${p.clave}`);
      }
    }
    return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }, [pre]);
  const percDe = (r: any, clave: string) =>
    (r.percepciones || []).filter((p: any) => p.clave === clave && !p.esSueldoDelPeriodo)
      .reduce((s: number, p: any) => s + (Number(p.importe) || 0), 0);
  const totalPerc = (clave: string) =>
    (pre?.renglones || []).reduce((a: number, r: any) => a + percDe(r, clave), 0);
  const extraCols = clavesDeduc.length + clavesPercep.length;
  const [exportando, setExportando] = useState(false);
  const [cerrando, setCerrando] = useState(false);

  /* El menú del clic derecho y el diálogo de aplicación masiva.
   *
   * El menú se abre donde se soltó el clic, no en una esquina fija: buscar con
   * la vista un menú que apareció lejos del cursor cuesta más que el clic que
   * se ahorró. */
  const [menu, setMenu] = useState<{ x: number; y: number; renglon: any } | null>(null);
  const [masivo, setMasivo] = useState<{ lado: 'ingresos' | 'egresos'; renglon: any } | null>(null);

  const plantillaQ = useQuery({
    queryKey: ['plantilla-por-tipo'],
    queryFn: () => api.getPlantillaPorTipo(),
  });
  const plantilla: any = plantillaQ.data?.data || {};

  const periodosQ = useQuery({
    queryKey: ['periodos-nomina', anio, tipo],
    queryFn: () => api.getPeriodosNomina({ anio, tipo }),
  });
  const periodos: any[] = periodosQ.data?.data?.periodos || [];
  const periodoSel = periodos.find((p: any) => p.id === periodoId);
  const esPtu = periodoSel?.especial_clave === 'PTU';

  const prenominaQ = useQuery({
    queryKey: ['prenomina', periodoId],
    queryFn: () => api.getPrenomina(periodoId),
    enabled: !!periodoId,
  });

  /* Se abre en el periodo que se está pagando, no en "elige el periodo".
   *
   * Quien entra a esta pantalla viene a ver la nómina de ESTA semana, y tener
   * que buscarla en una lista de 53 cada vez es trabajo que la máquina puede
   * hacer. Se elige el primer periodo ABIERTO cuyo rango contiene el día de hoy;
   * si hoy no cae en ninguno —porque ya se cerraron todos hasta la fecha— se
   * toma el primer abierto que venga. Y se queda ahí: en cuanto el periodo se
   * cierra deja de ser candidato y el default salta solo al siguiente.
   *
   * No pisa una elección del usuario: sólo actúa cuando no hay ninguna. */
  useEffect(() => {
    if (periodoId || periodos.length === 0) return;
    const hoy = new Date().toISOString().slice(0, 10);
    const abiertos = periodos.filter((p) => p.estatus !== 'CERRADO');
    if (abiertos.length === 0) return;

    /* El que CONTIENE hoy. Es el caso normal. */
    const deHoy = abiertos.find((p) => p.fecha_inicio <= hoy && hoy <= p.fecha_fin);

    /* Si hoy no cae en ninguno —porque los de esta fecha ya se cerraron, o
     * porque se está mirando otro año— se toma el MÁS CERCANO a hoy, no el
     * primero de la lista. Abrir en la semana 1 de enero cuando estamos en
     * agosto obliga a buscar cada vez, que es justo lo que este default
     * venía a evitar. */
    const distancia = (p: any) => {
      if (p.fecha_fin < hoy) return Date.parse(hoy) - Date.parse(p.fecha_fin);
      if (p.fecha_inicio > hoy) return Date.parse(p.fecha_inicio) - Date.parse(hoy);
      return 0;
    };
    const masCercano = [...abiertos].sort((a, b) => distancia(a) - distancia(b))[0];

    const elegido = deHoy || masCercano;
    if (elegido) setPeriodoId(elegido.id);
  }, [periodos, periodoId]);

  /* El resultado del GET alimenta la pantalla la primera vez; después manda lo
   * que devuelve el recálculo con la captura. */
  useEffect(() => {
    if (!prenominaQ.data?.data) return;
    const d = prenominaQ.data.data;
    setPre(d);

    /* Se repone lo que ya estaba capturado.
     *
     * Sin esto, volver a la pantalla dejaba el estado local en blanco: la
     * rejilla mostraba los importes —porque vienen calculados del servidor—
     * pero al abrir el diálogo de un trabajador aparecía vacío, y el siguiente
     * recálculo mandaba una captura incompleta. Se veía como si el sistema
     * hubiera borrado lo tecleado. */
    const repuesta: Record<string, any> = {};
    for (const r of d.renglones || []) {
      const c = r.capturado;
      if (!c) continue;
      if ((c.otrosIngresos?.length || 0) === 0 && (c.otrasDeducciones?.length || 0) === 0) continue;
      repuesta[r.empleado_id] = {
        otrosIngresos: (c.otrosIngresos || []).map((l: any) => ({
          clave: l.clave, importe: String(l.importe),
          gravadoManual: l.gravadoManual === undefined || l.gravadoManual === null
            ? '' : String(l.gravadoManual),
        })),
        otrasDeducciones: (c.otrasDeducciones || []).map((l: any) => ({
          clave: l.clave, importe: String(l.importe),
          // Las faltas (020) se capturan en DÍAS; se conserva para que un
          // recálculo manual no las degrade a un importe fijo.
          dias: l.dias === undefined || l.dias === null ? undefined : String(l.dias),
        })),
      };
    }
    setCaptura(repuesta);
  }, [prenominaQ.data]);

  /* Un menú contextual que no se cierra al hacer clic fuera se queda flotando
   * encima de todo y hay que perseguirlo. */
  useEffect(() => {
    if (!menu) return;
    const cerrar = () => setMenu(null);
    window.addEventListener('click', cerrar);
    window.addEventListener('scroll', cerrar, true);
    return () => {
      window.removeEventListener('click', cerrar);
      window.removeEventListener('scroll', cerrar, true);
    };
  }, [menu]);

  const cambiarTipo = (t: string) => {
    setTipo(t); setPeriodoId(''); setError(''); setAviso(''); setCaptura({}); setPre(null);
  };

  /* Guarda lo capturado y pide el recálculo. El servidor devuelve la rejilla
   * completa, con el ISR y las cuotas ya movidos por los conceptos nuevos —
   * recalcular en la pantalla daría un número distinto del que se va a timbrar. */
  const aplicarCaptura = async (empleadoId: string, lado: 'ingresos' | 'egresos', lineas: Linea[]) => {
    const nueva = {
      ...captura,
      [empleadoId]: {
        otrosIngresos: lado === 'ingresos' ? lineas : (captura[empleadoId]?.otrosIngresos || []),
        otrasDeducciones: lado === 'egresos' ? lineas : (captura[empleadoId]?.otrasDeducciones || []),
      },
    };
    setCaptura(nueva);
    setCapturando(null);
    setError('');
    try {
      const cuerpo = Object.entries(nueva).map(([id, c]) => ({
        empleadoId: id,
        otrosIngresos: c.otrosIngresos.map((l) => ({
          clave: l.clave,
          importe: Number(l.importe),
          gravadoManual: l.gravadoManual === '' || l.gravadoManual === undefined
            ? undefined : Number(l.gravadoManual),
        })),
        otrasDeducciones: c.otrasDeducciones.map((l) => ({
          clave: l.clave, importe: Number(l.importe),
          dias: l.dias === '' || l.dias === undefined || l.dias === null ? undefined : Number(l.dias),
        })),
      }));
      const r = await api.recalcularPrenomina(periodoId, cuerpo);
      setPre(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo recalcular');
    }
  };

  /* El cuerpo de la captura, tal como lo espera el servidor. Se arma en un solo
   * lugar porque lo usan el recálculo, el Excel y el cierre: si cada uno lo
   * armara por su cuenta, el Excel podría salir con conceptos distintos de los
   * que se cerraron. */
  const cuerpoDeCaptura = () =>
    Object.entries(captura).map(([id, c]) => ({
      empleadoId: id,
      otrosIngresos: c.otrosIngresos.map((l) => ({
        clave: l.clave,
        importe: Number(l.importe),
        gravadoManual: l.gravadoManual === '' || l.gravadoManual === undefined
          ? undefined : Number(l.gravadoManual),
      })),
      otrasDeducciones: c.otrasDeducciones.map((l) => ({
        clave: l.clave, importe: Number(l.importe),
        dias: l.dias === '' || l.dias === undefined || l.dias === null ? undefined : Number(l.dias),
      })),
    }));

  const exportarExcel = async () => {
    setExportando(true); setError('');
    try {
      const p = pre.periodo;
      await api.descargarPrenominaExcel(
        periodoId, cuerpoDeCaptura(),
        `prenomina-${p.tipo.toLowerCase()}-${p.anio}-${String(p.numero).padStart(2, '0')}.xlsx`
      );
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo generar el Excel');
    } finally { setExportando(false); }
  };

  /* El reloj checador arma la nómina: trae las faltas del periodo (y detecta los
   * retardos) y las aplica como deducción. Escribe la captura en el servidor; el
   * refetch reconstruye la rejilla con las faltas ya puestas. */
  const cargarChecador = async () => {
    setError(''); setAviso('');
    try {
      const r: any = await api.prenominaCargarChecador(periodoId);
      const d = r?.data || {};
      await prenominaQ.refetch();
      const totalDias = (d.faltas || 0) + (d.faltasPorRetardo || 0);
      setAviso(
        d.sinTurno
          ? 'Ningún trabajador tiene turno FIJO en el Checador. Asígnales turno en Nómina → Checador → Empleados para que se calculen las faltas.'
          : totalDias === 0
            ? 'Del checador: nadie tuvo faltas en el periodo' +
              (d.retardos ? ` · ${d.retardos} retardo(s) detectado(s).` : '.')
            : `Del checador: ${totalDias} día(s) de falta a ${d.aplicados} trabajador(es) ` +
              `(${d.faltas} por ausencia` +
              (d.faltasPorRetardo ? ` + ${d.faltasPorRetardo} por acumular retardos, ${d.retardosPorFalta}=1 falta` : '') +
              ')' +
              (d.retardos ? ` · ${d.retardos} retardo(s) detectado(s).` : '.')
      );
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo cargar del checador');
    }
  };

  /* Asistencia completa: quita las faltas del checador y deja los días completos
   * del periodo (7/15/16/30) a todos. Para cuando no se usa el checador. */
  const asistenciaCompleta = async () => {
    setError(''); setAviso('');
    try {
      const r: any = await api.prenominaAsistenciaDefault(periodoId);
      const d = r?.data || {};
      await prenominaQ.refetch();
      setAviso(`Asistencia completa: ${d.dias} día(s) del periodo a todos (se quitaron las faltas del checador).`);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo aplicar');
    }
  };

  /* Cerrar es lo único de esta pantalla que ESCRIBE. Por eso pregunta: después
   * del cierre el periodo ya no se recalcula, y sus recibos quedan como están. */
  const cerrarPeriodo = async () => {
    const t = pre.totales;
    const ok = window.confirm(
      `Se van a generar ${t.trabajadores} recibo(s) por ${money(t.neto)}.

` +
      (t.sinPoderTimbrar > 0
        ? `OJO: ${t.sinPoderTimbrar} trabajador(es) no se pueden timbrar todavía.

`
        : '') +
      'Después del cierre el periodo ya no se recalcula. ¿Continuar?'
    );
    if (!ok) return;
    setCerrando(true); setError('');
    try {
      const r = await api.cerrarPeriodoNomina(periodoId, cuerpoDeCaptura());
      const d: any = r.data;
      setAviso(
        `Periodo cerrado: ${d.recibos} recibo(s) generados. ` +
        'Ya están en Nómina → CFDI, listos para revisar antes de timbrar.'
      );
      periodosQ.refetch();
      prenominaQ.refetch();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo cerrar el periodo');
    } finally { setCerrando(false); }
  };

  const generar = async () => {
    setGenerando(true); setError(''); setAviso('');
    try {
      let arranque: string | undefined;
      if (tipo === 'SEMANAL') {
        /* La fecha de arranque no se puede suponer: cada empresa cierra su
         * semana el día que decidió, y adivinar el lunes movería el corte de
         * toda la plantilla. */
        const v = window.prompt(
          '¿En qué fecha arranca la primera semana del año?\n' +
          'Es el día en que tu empresa cierra la semana — no se puede suponer.',
          `${anio}-01-05`
        );
        if (!v) { setGenerando(false); return; }
        arranque = v.trim();
      }
      const r = await api.generarPeriodosNomina(tipo, anio, arranque);
      const d: any = r.data;
      setAviso(
        `${d.creados} periodo(s) generados para ${anio}` +
        (d.respetados ? ` · ${d.respetados} ya cerrados, no se tocaron` : '')
      );
      periodosQ.refetch();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudieron generar los periodos');
    } finally { setGenerando(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Cálculo de nómina</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Lo que captures se guarda solo. Al cerrar el periodo, los importes quedan congelados en los recibos.
        </p>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
      {aviso && <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-sm">{aviso}</div>}

      {/* ── 1 · Tipo de nómina ── */}
      <div className="bg-white rounded-lg shadow border p-5">
        <p className="text-sm font-semibold text-gray-700 mb-3">1 · Tipo de nómina</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TIPOS.map((t) => {
            const gente = plantilla[t.id];
            return (
              <button
                key={t.id}
                onClick={() => cambiarTipo(t.id)}
                /* Compactos: cuatro botones que sólo eligen un modo no necesitan
                   ocupar un tercio de la pantalla. Lo que importa está en una
                   línea — el nombre y cuánta gente le toca. */
                className={`rounded-lg border px-3 py-2 text-left transition flex items-center gap-2 ${
                  tipo === t.id
                    ? 'border-violet-500 bg-violet-50 text-violet-900'
                    : 'border-gray-200 hover:border-violet-300 text-gray-700'
                }`}
              >
                <span className="text-base">{t.emoji}</span>
                <span className="min-w-0">
                  <span className="text-sm font-medium block leading-tight">{t.label}</span>
                  {gente !== undefined && (
                    <span className={`text-[11px] block leading-tight ${gente === 0 ? 'text-amber-600' : 'text-gray-500'}`}>
                      {gente} trabajador{gente === 1 ? '' : 'es'}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {plantilla.sinTipo > 0 && (
          <p className="text-xs text-amber-700 mt-3 flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {plantilla.sinTipo} trabajador(es) tienen una periodicidad que no corresponde a
            ninguna nómina —diario, catorcenal, decenal— y no entrarán en ninguna corrida.
            Revisa su expediente.
          </p>
        )}
      </div>

      {/* ── 2 · Periodo ── */}
      <div className="bg-white rounded-lg shadow border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <p className="text-sm font-semibold text-gray-700">2 · Periodo</p>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Año</label>
            <input type="number" min={2000} max={2100} value={anio}
              onChange={(e) => { setAnio(Number(e.target.value)); setPeriodoId(''); }}
              className="w-24 border rounded-lg px-2 py-1 text-sm" />
            {esAdmin && tipo !== 'ESPECIAL' && (
              <button onClick={generar} disabled={generando}
                className="flex items-center gap-1.5 text-sm bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 disabled:opacity-50">
                <CalendarPlus size={15} />
                {generando ? 'Generando…' : periodos.length ? 'Regenerar' : 'Generar periodos'}
              </button>
            )}
            {esAdmin && tipo === 'ESPECIAL' && (
              <button onClick={() => setCreandoEspecial(true)}
                className="flex items-center gap-1.5 text-sm bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-blue-600">
                <Plus size={15} /> Nuevo especial
              </button>
            )}
          </div>
        </div>

        {tipo === 'ESPECIAL' && (
          <p className="text-xs text-gray-600 mb-3 flex items-start gap-1.5">
            <Info size={13} className="mt-0.5 shrink-0" />
            Los especiales no salen de un calendario: cada uno se captura con sus fechas y
            su concepto — <b>PTU</b>, <b>finiquito</b>, <b>aguinaldo</b> u otra cosa. Al
            crearlo se elige <b>quiénes entran</b>: toda la plantilla para un aguinaldo,
            o sólo unos cuantos para un bono.
          </p>
        )}

        {creandoEspecial && (
          <FormaEspecial
            anio={anio}
            onCancelar={() => setCreandoEspecial(false)}
            onCreado={(id: string) => {
              setCreandoEspecial(false);
              periodosQ.refetch();
              setPeriodoId(id);
            }}
          />
        )}

        {periodosQ.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}

        {!periodosQ.isLoading && periodos.length === 0 && !creandoEspecial && (
          <p className="text-sm text-gray-500 italic">
            {tipo === 'ESPECIAL'
              ? `No hay periodos especiales en ${anio}.`
              : `No hay periodos ${tipo.toLowerCase()}es generados para ${anio}.`}
          </p>
        )}

        {periodos.length > 0 && (
          <select value={periodoId} onChange={(e) => { setPeriodoId(e.target.value); setCaptura({}); setPre(null); }}
            className="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="">— Elige el periodo —</option>
            {periodos.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.numero} · {p.concepto ? `${p.concepto} · ` : ''}
                {aTextoMx(p.fecha_inicio)} al {aTextoMx(p.fecha_fin)} ({p.dias} días)
                {p.estatus !== 'ABIERTO' ? ` · ${p.estatus.toLowerCase()}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ── 3 · PTU: su propio panel (no la rejilla, que pagaría sueldo base) ── */}
      {periodoId && esPtu && <PanelPTU periodoId={periodoId} />}

      {/* ── 3 · La rejilla ── */}
      {periodoId && !esPtu && (
        <div className="bg-white rounded-lg shadow border overflow-hidden">
          <div className="px-5 py-3 border-b flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Users size={16} className="text-violet-600" /> 3 · Prenómina
              {pre && (
                <span className="font-normal text-gray-500">
                  — {pre.periodo.tipo} #{pre.periodo.numero}
                  {pre.periodo.concepto ? ` · ${pre.periodo.concepto}` : ''}
                  {' · '}{aTextoMx(pre.periodo.fecha_inicio)} al {aTextoMx(pre.periodo.fecha_fin)}
                </span>
              )}
            </p>
            {/* Pegados al título y no en la otra orilla: son las tres acciones
                de esta pantalla y buscarlas al final de una línea ancha cuesta
                un viaje de ojos cada vez. */}
            <div className="flex items-center gap-3 ml-4 mr-auto">
              <button onClick={() => prenominaQ.refetch()} disabled={prenominaQ.isFetching}
                className="text-sm text-primary hover:underline flex items-center gap-1">
                <RefreshCw size={14} className={prenominaQ.isFetching ? 'animate-spin' : ''} />
                Recalcular
              </button>
              {/* El reloj checador arma la nómina: faltas/retardos del periodo, o
                  asistencia completa a todos. */}
              {pre?.periodo?.estatus !== 'CERRADO' && (
                <>
                  <button onClick={cargarChecador} disabled={prenominaQ.isFetching || !pre}
                    className="text-sm text-cyan-700 hover:underline flex items-center gap-1 disabled:opacity-50"
                    title="Trae las faltas y retardos del reloj checador y arma la nómina">
                    <CalendarClock size={14} /> Checador
                  </button>
                  <button onClick={asistenciaCompleta} disabled={prenominaQ.isFetching || !pre}
                    className="text-sm text-gray-600 hover:underline flex items-center gap-1 disabled:opacity-50"
                    title="Asistencia completa: días del periodo a todos (quita las faltas del checador)">
                    <CheckCircle2 size={14} /> Asistencia
                  </button>
                </>
              )}
              {/* La prenómina se REVISA, y eso se hace en Excel: se ordena por
                  departamento, se filtra a quien tiene faltas, se compara contra
                  la semana pasada. Va con lo capturado en la rejilla, no con un
                  recálculo sin los conceptos recién tecleados. */}
              <button onClick={exportarExcel} disabled={exportando || !pre}
                className="text-sm text-emerald-700 hover:underline flex items-center gap-1 disabled:opacity-50">
                <FileSpreadsheet size={14} /> {exportando ? 'Generando…' : 'Excel'}
              </button>
              {esAdmin && pre?.periodo?.estatus !== 'CERRADO' && (
                <button onClick={cerrarPeriodo} disabled={cerrando || !pre?.renglones?.length}
                  className="text-sm bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 flex items-center gap-1.5 disabled:opacity-50">
                  <Lock size={14} /> {cerrando ? 'Cerrando…' : 'Cerrar periodo'}
                </button>
              )}
              {pre?.periodo?.estatus === 'CERRADO' && (
                <span className="text-sm text-slate-500 flex items-center gap-1.5">
                  <Lock size={14} /> Periodo cerrado
                </span>
              )}
            </div>
          </div>

          {prenominaQ.isLoading && <p className="px-5 py-8 text-sm text-gray-500">Calculando…</p>}
          {prenominaQ.isError && (
            <p className="px-5 py-6 text-sm text-rose-700">
              {(prenominaQ.error as any)?.response?.data?.message || 'No se pudo calcular'}
            </p>
          )}

          {pre?.avisos?.length > 0 && (
            <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 space-y-1">
              {pre.avisos.map((a: string, i: number) => (
                <p key={i} className="text-xs text-amber-900 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {a}
                </p>
              ))}
            </div>
          )}

          {pre && (
            <div className="overflow-x-auto">
              {/* COLUMNAS ANGOSTAS Y NÚMERO EN LUGAR DEL TIPO.
                  La palabra "SEMANAL" se repetía idéntica en los cincuenta
                  renglones y sólo robaba ancho: el tipo ya está en el encabezado
                  del bloque. Lo que sí cambia renglón a renglón es el número
                  consecutivo, y eso es lo que va en esa columna. */}
              <table className="w-full text-xs tabular-nums">
                <thead className="bg-gray-50 border-b">
                  <tr className="text-[11px] text-gray-600">
                    <th className="px-1.5 py-1.5 text-right w-8">#</th>
                    <th className="px-1.5 py-1.5 text-left w-0">Nombre</th>
                    <th className="px-1.5 py-1.5 text-center w-12">Días</th>
                    <th className="px-1.5 py-1.5 text-right w-24">Ingresos</th>
                    {clavesPercep.map(([k, n]) => (
                      <th key={k} title={n} className="px-1.5 py-1.5 text-right text-emerald-700 whitespace-nowrap max-w-[110px] truncate">{n}</th>
                    ))}
                    <th className="px-1.5 py-1.5 text-right w-24">Otros ing.</th>
                    <th className="px-1.5 py-1.5 text-right w-24 border-r">Percepciones</th>
                    <th className="px-1.5 py-1.5 text-right w-20">IMSS</th>
                    <th className="px-1.5 py-1.5 text-right w-20">ISR</th>
                    <th className="px-1.5 py-1.5 text-right w-20">Préstamos</th>
                    {clavesDeduc.map(([k, n]) => (
                      <th key={k} title={n} className="px-1.5 py-1.5 text-right text-rose-700 whitespace-nowrap max-w-[110px] truncate">{n}</th>
                    ))}
                    <th className="px-1.5 py-1.5 text-right w-24 border-r">Otras ded.</th>
                    <th className="px-1.5 py-1.5 text-right w-24">Neto a cobrar</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pre.renglones.length === 0 && (
                    <tr><td colSpan={11 + extraCols} className="px-4 py-8 text-center text-gray-500 italic">
                      Ningún trabajador con esa periodicidad estuvo activo en este periodo.
                    </td></tr>
                  )}
                  {pre.renglones.map((r: any, i: number) => {
                    const cap = captura[r.empleado_id];
                    return (
                      <tr
                        key={r.empleado_id}
                        className="hover:bg-gray-50"
                        onContextMenu={(ev) => {
                          if (!esAdmin || pre?.periodo?.estatus === 'CERRADO') return;
                          ev.preventDefault();
                          setMenu({ x: ev.clientX, y: ev.clientY, renglon: r });
                        }}
                      >
                        <td className="px-1.5 py-1 text-right text-gray-400">{i + 1}</td>
                        {/* Sin el puesto: se repite en toda la columna —"Ayudante
                            General" diez veces— y empuja los días a la derecha. Está
                            en el expediente, que es donde se consulta. */}
                        <td className="px-1.5 py-1 w-0 whitespace-nowrap">
                          <span className="text-gray-900">{r.nombre}</span>
                          <span className="text-[10px] text-gray-400 ml-1.5">{r.num_empleado}</span>
                          {r.faltantes?.length > 0 && (
                            <span className="block text-[10px] text-amber-700">
                              <AlertTriangle size={9} className="inline mr-0.5" />
                              falta {r.faltantes.join(', ')}
                            </span>
                          )}
                          {r.avisos?.map((a: string, k: number) => (
                            <span key={k} className="block text-[10px] text-amber-700">{a}</span>
                          ))}
                        </td>
                        <td className="px-1.5 py-1 text-center">
                          {r.dias}
                          {r.dias !== r.diasDelPeriodo && (
                            <span className="text-[10px] text-gray-400">/{r.diasDelPeriodo}</span>
                          )}
                        </td>

                        {/* Ingresos = el sueldo del periodo (clave 001). */}
                        <td className="px-1.5 py-1 text-right">{money(r.sueldo)}</td>

                        {/* Una columna por cada percepción del Anexo 20 presente. */}
                        {clavesPercep.map(([k]) => (
                          <td key={k} className="px-1.5 py-1 text-right text-emerald-700">
                            {percDe(r, k) ? money(percDe(r, k)) : '—'}
                          </td>
                        ))}

                        {/* Otros ingresos: doble clic para capturar, mouse encima
                            para ver el desglose con su gravado y su exento. */}
                        <CeldaDeConceptos
                          importe={r.otrosIngresos}
                          /* Todo lo que NO sea el sueldo del periodo. Se filtra por la
                             marca y no por la clave 001: las vacaciones de un finiquito
                             y los retroactivos también la llevan, y por clave se
                             habrían escondido de esta columna. */
                          detalle={r.percepciones.filter((p: any) => !p.esSueldoDelPeriodo)}
                          capturados={cap?.otrosIngresos?.length || 0}
                          titulo="Otros ingresos"
                          onDobleClic={esAdmin ? () => setCapturando({ lado: 'ingresos', renglon: r }) : undefined}
                        />

                        <CeldaDeConceptos
                          importe={r.totalPercepciones}
                          detalle={r.percepciones}
                          titulo="Total de percepciones"
                        />

                        <td className="px-1.5 py-1 text-right text-rose-700">
                          {r.imss > 0 ? money(r.imss) : '—'}
                        </td>
                        <td className="px-1.5 py-1 text-right text-rose-700">
                          {r.isr > 0 ? money(r.isr) : '—'}
                        </td>
                        <td className="px-1.5 py-1 text-right text-rose-700">
                          {r.prestamos > 0 ? money(r.prestamos) : '—'}
                        </td>

                        {/* Una columna por cada descuento del Anexo 20 presente. */}
                        {clavesDeduc.map(([k]) => (
                          <td key={k} className="px-1.5 py-1 text-right text-rose-700">
                            {dedDe(r, k) ? money(dedDe(r, k)) : '—'}
                          </td>
                        ))}

                        {/* Otras deducciones: el total capturable (doble clic). */}
                        <CeldaDeConceptos
                          importe={r.otrasDeducciones}
                          detalle={r.deducciones.filter(
                            (d: any) => !['001', '002', '011', '012'].includes(d.clave)
                          )}
                          capturados={cap?.otrasDeducciones?.length || 0}
                          titulo="Otras deducciones"
                          color="rojo"
                          onDobleClic={esAdmin ? () => setCapturando({ lado: 'egresos', renglon: r }) : undefined}
                        />

                        <td className="px-1.5 py-1 text-right font-semibold whitespace-nowrap">
                          {money(r.neto)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {pre.renglones.length > 0 && (
                  <tfoot className="bg-gray-50 border-t-2">
                    <tr className="font-semibold">
                      <td className="px-1.5 py-1.5" colSpan={2}>
                        {pre.totales.trabajadores} trabajador(es)
                        {pre.totales.sinPoderTimbrar > 0 && (
                          <span className="font-normal text-amber-700 text-[11px]">
                            {' '}· {pre.totales.sinPoderTimbrar} sin poder timbrar
                          </span>
                        )}
                      </td>
                      <td></td>
                      <td className="px-1.5 py-1.5 text-right">{money(pre.totales.sueldo)}</td>
                      {clavesPercep.map(([k]) => (
                        <td key={k} className="px-1.5 py-1.5 text-right text-emerald-700">{money(totalPerc(k))}</td>
                      ))}
                      <td className="px-1.5 py-1.5 text-right">{money(pre.totales.otrosIngresos)}</td>
                      <td className="px-1.5 py-1.5 text-right border-r">{money(pre.totales.totalPercepciones)}</td>
                      <td className="px-1.5 py-1.5 text-right text-rose-700">{money(pre.totales.imss)}</td>
                      <td className="px-1.5 py-1.5 text-right text-rose-700">{money(pre.totales.isr)}</td>
                      <td className="px-1.5 py-1.5 text-right text-rose-700">{money(pre.totales.prestamos)}</td>
                      {clavesDeduc.map(([k]) => (
                        <td key={k} className="px-1.5 py-1.5 text-right text-rose-700">{money(totalDed(k))}</td>
                      ))}
                      <td className="px-1.5 py-1.5 text-right text-rose-700 border-r">{money(pre.totales.otrasDeducciones)}</td>
                      <td className="px-1.5 py-1.5 text-right">{money(pre.totales.neto)}</td>
                    </tr>
                    {/* ── Gravado, exento y subsidio ──
                        Van con su etiqueta arriba y el importe abajo, no en un
                        renglón corrido: son tres cifras contra las que se
                        cuadra el CFDI, y en una sola línea con los consejos de
                        uso se leían como parte del texto de ayuda. */}
                    <tr className="text-[11px]">
                      <td className="px-1.5 pb-2 pt-1" colSpan={11 + extraCols}>
                        <div className="flex flex-wrap gap-x-8 gap-y-1">
                          <Cifra rotulo="Gravado" valor={money(pre.totales.gravado)} />
                          <Cifra rotulo="Exento" valor={money(pre.totales.exento)} />
                          {pre.totales.subsidio > 0 && (
                            <Cifra rotulo="Subsidio al empleo"
                              valor={money(pre.totales.subsidio)} />
                          )}
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {/* El menú del clic derecho. Va en position:fixed y con las coordenadas
              del evento para caer bajo el cursor. */}
          {menu && (
            <div
              className="fixed z-50 bg-white border rounded-lg shadow-lg py-1 text-sm min-w-[15rem]"
              style={{ left: Math.min(menu.x, window.innerWidth - 260), top: menu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <p className="px-3 py-1.5 text-xs text-gray-500 border-b truncate">
                {menu.renglon.nombre}
              </p>
              <button
                className="w-full text-left px-3 py-2 hover:bg-emerald-50 text-emerald-800 flex items-center gap-2"
                onClick={() => { setMasivo({ lado: 'ingresos', renglon: menu.renglon }); setMenu(null); }}
              >
                <Users size={14} /> Aplicar un ingreso a varios…
              </button>
              <button
                className="w-full text-left px-3 py-2 hover:bg-rose-50 text-rose-800 flex items-center gap-2"
                onClick={() => { setMasivo({ lado: 'egresos', renglon: menu.renglon }); setMenu(null); }}
              >
                <Users size={14} /> Aplicar un descuento o falta a varios…
              </button>
              <div className="border-t my-1" />
              <button
                className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700"
                onClick={() => { setCapturando({ lado: 'ingresos', renglon: menu.renglon }); setMenu(null); }}
              >
                Capturar ingresos sólo a {String(menu.renglon.nombre).split(' ')[0]}
              </button>
              <button
                className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700"
                onClick={() => { setCapturando({ lado: 'egresos', renglon: menu.renglon }); setMenu(null); }}
              >
                Capturar descuentos sólo a {String(menu.renglon.nombre).split(' ')[0]}
              </button>
            </div>
          )}

          {masivo && (
            <AplicarAVarios
              periodoId={periodoId}
              renglones={pre?.renglones || []}
              empleadoInicial={masivo.renglon?.empleado_id}
              lado={masivo.lado}
              onCerrar={() => setMasivo(null)}
              /* No se limpia la captura: el refetch trae la lista completa y
                 el efecto de arriba la repone. Limpiarla aquí dejaba la
                 pantalla en blanco medio segundo y perdía lo no guardado. */
              onAplicado={() => prenominaQ.refetch()}
            />
          )}

          {capturando && (
            <CapturaDeConceptos
              lado={capturando.lado}
              nombreTrabajador={capturando.renglon.nombre}
              lineas={
                capturando.lado === 'ingresos'
                  ? (captura[capturando.renglon.empleado_id]?.otrosIngresos || [])
                  : (captura[capturando.renglon.empleado_id]?.otrasDeducciones || [])
              }
              periodoId={periodoId}
              empleadoId={capturando.renglon.empleado_id}
              onCerrar={() => setCapturando(null)}
              onGuardar={(l) => aplicarCaptura(capturando.renglon.empleado_id, capturando.lado, l)}
            />
          )}

          {/* ── Cómo se captura, y qué pasa al cerrar ──
              Eran dos párrafos corridos con cinco ideas dentro. Separados en
              pistas cortas se leen de reojo la primera vez y se dejan de leer
              después, que es lo que se quiere de un texto de ayuda. */}
          <div className="px-5 py-3 border-t space-y-2">
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-gray-500">
              <Pista><b>Doble clic</b> en Otros ingresos u Otras deducciones para capturar</Pista>
              <Pista><b>Clic derecho</b> para aplicar un concepto a varios de un jalón</Pista>
              <Pista><b>Mouse encima</b> de un importe para ver cómo se integra</Pista>
            </div>
            <p className="text-xs text-gray-500">
              Al cerrar se congelan los recibos, se aplican los abonos de préstamos y
              FONACOT, y los XML pasan a CFDI. <b>Timbrar es un paso aparte.</b>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Una cifra del pie: el rótulo chico arriba y el importe legible abajo. */
function Cifra({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="text-gray-400 uppercase tracking-wide text-[10px]">{rotulo}</span>
      <span className="text-gray-800 font-semibold tabular-nums text-xs">{valor}</span>
    </span>
  );
}

/** Una pista de uso, con su viñeta. */
function Pista({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-1 h-1 rounded-full bg-gray-300 shrink-0" />
      {children}
    </span>
  );
}

/**
 * Alta de un periodo especial, en dos pasos: qué es, y a quién alcanza.
 *
 * POR QUÉ EL SEGUNDO PASO
 * Antes alcanzaba a toda la plantilla sin preguntar, porque los especiales se
 * pensaron para el aguinaldo y la PTU. Pero un especial también es un bono a un
 * turno o una gratificación a tres personas, y ahí la rejilla traía a los
 * ochenta: quien lo cerrara generaba setenta y siete recibos de más, y deshacer
 * eso es borrar CFDI.
 *
 * Se elige DESPUÉS del concepto y no antes porque el concepto es lo que dice a
 * quién hay que marcar: nadie sabe a quién elegir hasta que sabe si es el
 * aguinaldo o el bono de agosto.
 */
function FormaEspecial({ anio, onCancelar, onCreado }: any) {
  const HOY = new Date().toISOString().slice(0, 10);
  const [paso, setPaso] = useState<1 | 2>(1);
  const [f, setF] = useState<any>({
    concepto: '', fecha_inicio: `${anio}-01-01`, fecha_fin: `${anio}-12-31`, fecha_pago: HOY,
  });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const campo = 'w-full border rounded-lg px-3 py-1.5 text-sm';

  /* Los casos de siempre, para no teclear el concepto ni las fechas. Asimilados
   * es distinto: cambia el cálculo (ISR mensual, sin subsidio ni IMSS). */
  const plantillas = [
    { label: 'Aguinaldo', concepto: `Aguinaldo ${anio}`, ini: `${anio}-01-01`, fin: `${anio}-12-31`, clave: 'AGUINALDO' },
    { label: 'PTU',       concepto: `PTU ${anio - 1}`,   ini: `${anio - 1}-01-01`, fin: `${anio - 1}-12-31`, clave: 'PTU' },
    { label: 'Finiquito', concepto: 'Finiquito de ',     ini: HOY, fin: HOY },
    { label: 'Asimilados', concepto: `Asimilados ${HOY.slice(0, 7)}`, ini: `${HOY.slice(0, 7)}-01`, fin: HOY, asimilados: true },
  ];

  /* La plantilla activa. Se pide sólo al llegar al paso 2: en el 1 no se usa y
   * traerla antes es una consulta que casi siempre se tira. */
  const plantillaQ = useQuery({
    queryKey: ['empleados-para-especial'],
    queryFn: () => api.getEmpleados({}),
    enabled: paso === 2,
  });
  const trabajadores: any[] = (plantillaQ.data?.data?.empleados || plantillaQ.data?.data || [])
    .filter((e: any) => e.activo);

  const [elegidos, setElegidos] = useState<Record<string, boolean>>({});
  const [busca, setBusca] = useState('');

  /* Arrancan TODOS marcados: el caso común es el aguinaldo, y en el otro es
   * más rápido quitar tres que marcar ochenta. */
  useEffect(() => {
    if (paso !== 2 || trabajadores.length === 0) return;
    setElegidos((v) =>
      Object.keys(v).length > 0
        ? v
        : Object.fromEntries(trabajadores.map((e: any) => [e.id, true])));
  }, [paso, trabajadores.length]);

  const visibles = trabajadores.filter((e: any) => {
    const t = busca.trim().toLowerCase();
    if (!t) return true;
    return `${e.nombre} ${e.apellido_pat || ''} ${e.apellido_mat || ''} ${e.num_empleado}`
      .toLowerCase().includes(t);
  });
  const marcados = trabajadores.filter((e: any) => elegidos[e.id]).length;
  const todos = marcados === trabajadores.length && trabajadores.length > 0;

  const crear = async () => {
    setGuardando(true); setError('');
    try {
      /* Si están TODOS marcados se manda la lista vacía, que es la convención
       * de "toda la plantilla". No es lo mismo que mandar los ochenta ids:
       * quien entre a la empresa mañana debe caer en el aguinaldo, y con la
       * lista fija se quedaría fuera sin que nadie lo notara. */
      const empleadoIds = todos
        ? []
        : trabajadores.filter((e: any) => elegidos[e.id]).map((e: any) => e.id);

      if (!todos && empleadoIds.length === 0) {
        setError('Hay que elegir al menos a un trabajador.');
        return;
      }
      const r = await api.crearPeriodoEspecial({ anio, ...f, empleadoIds });
      onCreado(r.data.id);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo crear');
    } finally { setGuardando(false); }
  };

  return (
    <div className="border border-violet-200 bg-violet-50/40 rounded-lg p-4 space-y-3 mb-3">
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm flex items-center gap-2">
          Nuevo periodo especial
          <span className="text-xs font-normal text-gray-500">
            paso {paso} de 2 · {paso === 1 ? 'qué es' : 'quiénes entran'}
          </span>
        </p>
        <button onClick={onCancelar} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}

      {paso === 1 && (
        <>
          <div className="flex flex-wrap gap-2">
            {plantillas.map((p) => (
              <button key={p.label} type="button"
                onClick={() => setF({ ...f, concepto: p.concepto, fecha_inicio: p.ini, fecha_fin: p.fin, esAsimilados: !!(p as any).asimilados, especialClave: (p as any).clave || null })}
                className={`text-xs border rounded-lg px-3 py-1.5 bg-white hover:border-violet-400 ${
                  (p as any).asimilados && f.esAsimilados ? 'border-violet-500 ring-1 ring-violet-400' : ''}`}>
                {p.label}
              </button>
            ))}
            <span className="text-xs text-gray-500 self-center">o escribe el concepto que necesites</span>
          </div>

          {f.esAsimilados && (
            <p className="text-[11px] text-violet-800 bg-violet-100/60 border border-violet-200 rounded px-2 py-1.5">
              <b>Asimilados a salarios:</b> al ingreso total se le aplica la tarifa <b>mensual</b> del
              ISR (Art. 96) y se retiene. <b>No</b> se aplica subsidio al empleo ni cuotas del IMSS. El
              pago de cada persona se captura como su ingreso en la rejilla.
            </p>
          )}

          <input className={campo} placeholder='Concepto — "Aguinaldo 2026", "Bono de agosto"…'
            value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} />

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Desde</label>
              <CampoFecha value={f.fecha_inicio}
                onChange={(v) => setF({ ...f, fecha_inicio: v })} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Hasta</label>
              <CampoFecha value={f.fecha_fin}
                onChange={(v) => setF({ ...f, fecha_fin: v })} />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Fecha de pago</label>
              <CampoFecha value={f.fecha_pago}
                onChange={(v) => setF({ ...f, fecha_pago: v })} />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onCancelar}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
            <button
              onClick={() => {
                if (!f.concepto.trim()) {
                  setError('Un especial necesita su concepto: en tres meses, "especial 2" no le dice nada a nadie.');
                  return;
                }
                setError(''); setPaso(2);
              }}
              className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-blue-600">
              Siguiente: quiénes entran →
            </button>
          </div>
        </>
      )}

      {paso === 2 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="border rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[180px]"
              placeholder="Buscar por nombre o número…"
              value={busca} onChange={(e) => setBusca(e.target.value)}
            />
            <button type="button"
              onClick={() => setElegidos(Object.fromEntries(trabajadores.map((e: any) => [e.id, true])))}
              className="text-xs border rounded-lg px-3 py-1.5 bg-white hover:border-violet-400">
              Todos
            </button>
            <button type="button"
              onClick={() => setElegidos({})}
              className="text-xs border rounded-lg px-3 py-1.5 bg-white hover:border-violet-400">
              Ninguno
            </button>
          </div>

          <div className="bg-white border rounded-lg max-h-64 overflow-y-auto divide-y">
            {plantillaQ.isLoading && (
              <p className="text-sm text-gray-500 px-3 py-4">Cargando la plantilla…</p>
            )}
            {!plantillaQ.isLoading && visibles.length === 0 && (
              <p className="text-sm text-gray-500 italic px-3 py-4">
                {busca ? 'Nadie coincide con esa búsqueda.' : 'No hay trabajadores activos.'}
              </p>
            )}
            {visibles.map((e: any) => (
              <label key={e.id}
                className="flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" className="rounded"
                  checked={!!elegidos[e.id]}
                  onChange={(ev) => setElegidos({ ...elegidos, [e.id]: ev.target.checked })} />
                <span className="text-gray-400 text-xs w-10">{e.num_empleado}</span>
                <span className="flex-1">
                  {e.nombre} {e.apellido_pat} {e.apellido_mat || ''}
                </span>
                <span className="text-xs text-gray-400">{e.puesto || ''}</span>
              </label>
            ))}
          </div>

          <p className="text-xs text-gray-600">
            {todos ? (
              <>Entran <b>los {trabajadores.length}</b>. Quien se dé de alta después
              también entrará: así debe comportarse un aguinaldo.</>
            ) : (
              <>Entran <b>{marcados}</b> de {trabajadores.length}. El resto no aparecerá
              en la rejilla ni generará recibo al cerrar.</>
            )}
          </p>

          <div className="flex justify-end gap-2">
            <button onClick={() => setPaso(1)}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">← Atrás</button>
            <button disabled={guardando} onClick={crear}
              className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
              {guardando ? 'Creando…' : 'Crear periodo'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════════════ PTU · reparto de utilidades ═══════════════════
 * Panel propio del periodo de PTU (no la rejilla, que pagaría sueldo base).
 * Captura la cantidad a repartir y reparte 50% por días trabajados + 50% por
 * salarios devengados (Art. 123 LFT), con la exención de 15×UMA y el ISR. */
const mxn = (n: any) => `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function PanelPTU({ periodoId }: { periodoId: string }) {
  const q = useQuery({ queryKey: ['ptu', periodoId], queryFn: () => api.getPtu(periodoId) });
  const d: any = q.data?.data;
  const [cant, setCant] = useState('');
  const [msg, setMsg] = useState('');
  const [bajando, setBajando] = useState(false);

  useEffect(() => { if (d) setCant(String(d.cantidadRepartir ?? '')); }, [d?.cantidadRepartir]);

  const cerrado = d?.periodo?.estatus === 'CERRADO';

  const guardarCantidad = async () => {
    if (cerrado) return;
    setMsg('');
    try { await api.guardarPtu(periodoId, { cantidadRepartir: cant === '' ? 0 : Number(cant) }); q.refetch(); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo guardar.'); }
  };
  const guardarFila = async (empleadoId: string, cambios: any) => {
    if (cerrado) return;
    setMsg('');
    try { await api.guardarPtu(periodoId, { detalle: [{ empleadoId, ...cambios }] }); q.refetch(); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo guardar.'); }
  };
  const excel = async () => {
    setBajando(true);
    try { await api.descargarPtuExcel(periodoId, `ptu-${d?.periodo?.anio || ''}.xlsx`); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo generar el Excel.'); }
    finally { setBajando(false); }
  };

  if (q.isLoading || !d) return <div className="bg-white rounded-lg shadow border p-6 text-sm text-gray-500">Cargando PTU…</div>;
  const t = d.totales;

  return (
    <div className="bg-white rounded-lg shadow border overflow-hidden">
      <div className="px-5 py-3 border-b flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Users size={16} className="text-violet-600" /> 3 · Reparto de utilidades (PTU)
          <span className="font-normal text-gray-500">— {d.periodo.concepto} · {aTextoMx(d.periodo.fecha_inicio)} al {aTextoMx(d.periodo.fecha_fin)}</span>
        </p>
        <button onClick={excel} disabled={bajando} className="text-sm text-emerald-700 hover:underline flex items-center gap-1 disabled:opacity-50">
          <FileSpreadsheet size={14} /> {bajando ? 'Generando…' : 'Excel'}
        </button>
      </div>

      <div className="p-5 space-y-4">
        {msg && <p className="text-sm bg-rose-50 border border-rose-200 text-rose-700 rounded px-3 py-2">{msg}</p>}

        {/* a) Cantidad a repartir + resumen */}
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="text-xs font-medium text-gray-600 block mb-1">a) Cantidad a repartir</span>
            <input value={cant} onChange={(e) => setCant(e.target.value)} onBlur={guardarCantidad} type="number" step="any" min="0"
              disabled={cerrado} placeholder="0.00"
              className="w-44 border border-gray-300 rounded-lg px-3 py-2 text-sm text-right disabled:bg-gray-100 disabled:text-gray-500" />
          </label>
          <KpiPtu label="b) Con derecho" valor={`${t.con_derecho}`} sub={t.sin_derecho ? `${t.sin_derecho} sin derecho` : 'trabajadores'} />
          <KpiPtu label="Mitad c/u (50%)" valor={mxn(d.mitad)} sub="días · salarios" />
          <KpiPtu label="Exención" valor={mxn(d.exencion_tope)} sub={`15 × UMA (${mxn(d.uma_diaria)})`} />
          <KpiPtu label="PTU repartido" valor={mxn(t.ptu)} sub={`ISR ${mxn(t.isr)}`} />
          <KpiPtu label="Neto a pagar" valor={mxn(t.neto)} sub={`exento ${mxn(t.exento)}`} />
        </div>

        {d.avisos?.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-0.5">
            {d.avisos.map((a: string, i: number) => (
              <p key={i} className="flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {a}</p>
            ))}
          </div>
        )}

        {/* c)+d) Reparto por trabajador */}
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b text-gray-600">
              <tr>
                <th className="px-2 py-2 text-left">Trabajador</th>
                <th className="px-2 py-2 text-center">Derecho</th>
                <th className="px-2 py-2 text-right">Días trab.</th>
                <th className="px-2 py-2 text-right">Salario diario</th>
                <th className="px-2 py-2 text-right">Sal. devengado</th>
                <th className="px-2 py-2 text-right">PTU días (50%)</th>
                <th className="px-2 py-2 text-right">PTU salario (50%)</th>
                <th className="px-2 py-2 text-right">PTU total</th>
                <th className="px-2 py-2 text-right">Exento</th>
                <th className="px-2 py-2 text-right">Gravado</th>
                <th className="px-2 py-2 text-right">ISR</th>
                <th className="px-2 py-2 text-right">Neto</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.filas.map((f: any) => <FilaPTU key={f.empleado_id} f={f} onGuardar={guardarFila} bloqueado={cerrado} />)}
            </tbody>
            <tfoot className="bg-gray-100 font-semibold text-gray-800">
              <tr>
                <td className="px-2 py-2" colSpan={2}>Totales · {t.con_derecho} con derecho</td>
                <td className="px-2 py-2 text-right tabular-nums">{t.dias}</td>
                <td className="px-2 py-2" />
                <td className="px-2 py-2 text-right tabular-nums">{mxn(t.salario_devengado)}</td>
                <td className="px-2 py-2" colSpan={2} />
                <td className="px-2 py-2 text-right tabular-nums">{mxn(t.ptu)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{mxn(t.exento)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{mxn(t.gravado)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{mxn(t.isr)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{mxn(t.neto)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 flex items-center gap-1">
          <Info size={12} /> Los días y el salario salen automáticos del expediente pero son editables (faltas, incapacidades, sueldo variable). El reparto y el ISR se recalculan al guardar.
        </p>

        {/* e) Recibos: generar, timbrar, correo y bajar en PDF/XML (estándar de NEXO). */}
        <RecibosPtu periodoId={periodoId} cerrado={cerrado} onCambio={() => q.refetch()} />
      </div>
    </div>
  );
}

/**
 * RecibosPtu — los recibos del reparto, en el estándar de la nómina.
 *
 * Generar congela un CFDI extraordinario por trabajador (percepción 003 + ISR) y
 * cierra el periodo. De ahí los recibos son como cualquier otro: se timbran, se
 * marcan para correo y se bajan en PDF/XML con los MISMOS tres iconos del panel
 * de CFDI —PDF en rojo, XML en verde, vista previa en azul—. Los mismos recibos
 * aparecen también en Nómina → CFDI.
 */
function RecibosPtu({ periodoId, cerrado, onCambio }:
  { periodoId: string; cerrado: boolean; onCambio: () => void }) {
  const { puede } = useCapacidades();
  const esAdmin = puede(CAP.nomina);
  const q = useQuery({
    queryKey: ['ptu-recibos', periodoId],
    queryFn: () => api.getRecibosNomina({ periodoId }),
    enabled: cerrado,   // antes de cerrar no hay recibos que traer
  });
  const recibos: any[] = q.data?.data?.recibos || [];

  const [msg, setMsg] = useState('');
  const [generando, setGenerando] = useState(false);
  const [timbrando, setTimbrando] = useState(false);
  const [elegidos, setElegidos] = useState<Record<string, boolean>>({});
  const [viendo, setViendo] = useState<any | null>(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [modoXml, setModoXml] = useState(false);

  const generar = async () => {
    if (!window.confirm(
      'Se van a generar los recibos del reparto de PTU y se cerrará el periodo.\n\n' +
      'Después podrás timbrarlos, marcarlos para correo y bajarlos en PDF/XML. ¿Sigo?'
    )) return;
    setMsg(''); setGenerando(true);
    try {
      const r: any = await api.generarRecibosPtu(periodoId);
      setMsg(`${r.data.recibos} recibo(s) generado(s). Ya puedes timbrarlos y bajarlos aquí, o en Nómina → CFDI.`);
      onCambio(); q.refetch();
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudieron generar los recibos.'); }
    finally { setGenerando(false); }
  };

  const porTimbrar = Object.values(elegidos).filter(Boolean).length;
  const timbrar = async () => {
    const ids = Object.entries(elegidos).filter(([, v]) => v).map(([k]) => k);
    if (ids.length === 0) { setMsg('No marcaste ningún recibo para timbrar.'); return; }
    if (!window.confirm(
      `Se van a timbrar ${ids.length} recibo(s) ante el PAC.\n\n` +
      'Timbrar gasta timbres y deshacerlo exige una cancelación ante el SAT. ¿Sigo?'
    )) return;
    setMsg(''); setTimbrando(true);
    try {
      const r: any = await api.timbrarRecibosNomina(ids);
      const dd = r.data;
      setMsg(`${dd.timbrados} timbrado(s).` +
        (dd.fallaron ? ` ${dd.fallaron} no pasaron: ${dd.fallidos.map((x: any) => `${x.nombre} (${x.motivo})`).join(' · ')}` : ''));
      setElegidos({}); q.refetch();
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo timbrar.'); }
    finally { setTimbrando(false); }
  };

  const marcarCorreo = async (ids: string[], enviar: boolean) => {
    setMsg('');
    try {
      const r: any = await api.marcarEnvioPorCorreo(ids, enviar);
      if (r.data.sinCorreo?.length) {
        setMsg(`${r.data.marcados} marcado(s). OJO: ${r.data.sinCorreo.length} sin correo en su expediente ` +
          `(${r.data.sinCorreo.slice(0, 3).map((x: any) => x.nombre).join(', ')}${r.data.sinCorreo.length > 3 ? '…' : ''}).`);
      }
      q.refetch();
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo marcar.'); }
  };

  const verRecibo = async (r: any) => {
    setMsg(''); setModoXml(false); setPdfUrl('');
    try {
      const dx = await api.getXmlRecibo(r.id);
      setViendo({ ...r, xml: dx.data.xml });
      setPdfUrl(await api.getReciboPdfBlob(r.id));
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo abrir el recibo.'); }
  };
  const cerrarVista = () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(''); setViendo(null); setModoXml(false);
  };

  const timbrados = recibos.filter((r) => r.uuid);
  const marcados = recibos.filter((r) => r.enviar_por_correo);

  return (
    <div className="border-t pt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Stamp size={15} className="text-violet-600" /> e) Recibos de PTU
          {cerrado && <span className="text-[11px] font-normal text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">periodo cerrado</span>}
        </p>
        {esAdmin && !cerrado && (
          <button onClick={generar} disabled={generando}
            className="bg-violet-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-violet-700 flex items-center gap-1.5 disabled:opacity-50">
            <Stamp size={14} /> {generando ? 'Generando…' : 'Generar recibos'}
          </button>
        )}
        {esAdmin && cerrado && porTimbrar > 0 && (
          <button onClick={timbrar} disabled={timbrando}
            className="bg-violet-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-violet-700 flex items-center gap-1.5 disabled:opacity-50">
            <Stamp size={14} /> {timbrando ? 'Timbrando…' : `Timbrar ${porTimbrar}`}
          </button>
        )}
      </div>

      {msg && <p className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded px-3 py-2">{msg}</p>}

      {!cerrado ? (
        <p className="text-[11px] text-gray-400 flex items-center gap-1">
          <Info size={12} /> Primero ajusta el reparto; al <b className="mx-0.5">generar recibos</b> se congela un CFDI de nómina extraordinario por trabajador (sólo la PTU y su ISR, sin sueldo base) y el periodo queda cerrado. Timbrar es un paso aparte, igual que en la nómina normal.
        </p>
      ) : recibos.length === 0 ? (
        <p className="text-sm text-gray-500 italic px-1">
          {q.isLoading ? 'Cargando recibos…' : 'No hay recibos para este periodo.'}
        </p>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-gray-50 border-b text-gray-600">
              <tr>
                <th className="px-2 py-2 text-center w-8" title="Timbrar"><Stamp size={12} className="inline" /></th>
                <th className="px-2 py-2 text-center w-8" title="Enviar por correo"><Mail size={12} className="inline" /></th>
                <th className="px-2 py-2 text-left">Trabajador</th>
                <th className="px-2 py-2 text-left">Folio fiscal (UUID)</th>
                <th className="px-2 py-2 text-right w-24">Neto</th>
                <th className="px-2 py-2 text-center w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recibos.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-2 py-1.5 text-center">
                    {r.uuid
                      ? <Check size={13} className="inline text-emerald-600" />
                      : <input type="checkbox" checked={!!elegidos[r.id]}
                          onChange={(e) => setElegidos({ ...elegidos, [r.id]: e.target.checked })} className="rounded" />}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {esAdmin && (
                      <input type="checkbox" checked={!!r.enviar_por_correo} disabled={!r.uuid}
                        title={!r.uuid ? 'Primero hay que timbrarlo' : (r.correo || 'Sin correo en el expediente')}
                        onChange={(ev) => marcarCorreo([r.id], ev.target.checked)}
                        className="rounded border-gray-300 disabled:opacity-30" />
                    )}
                    {r.enviado_at && <CheckCircle2 size={13} className="inline text-emerald-600" />}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="text-gray-900">{r.nombre}</span>
                    <span className="block text-[10px] text-gray-400 font-mono">{r.num_empleado} · {r.rfc}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    {r.uuid
                      ? <span className="font-mono text-[10px] text-gray-700 select-all break-all">{r.uuid}</span>
                      : <span className="text-[10px] text-amber-700 italic">sin timbrar</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold text-emerald-700">{mxn(r.neto)}</td>
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    {/* Los mismos tres del panel de facturas y de CFDI, en el mismo orden. */}
                    <button onClick={() => api.descargarReciboPdf(r.id, `ptu-${r.num_empleado}.pdf`)}
                      title="Descargar PDF" className="p-1 text-rose-600 hover:bg-rose-50 rounded"><FileDown size={15} /></button>
                    <button onClick={() => api.descargarXmlRecibo(r.id, `ptu-${r.num_empleado}.xml`)}
                      title="Descargar XML" className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Download size={15} /></button>
                    <button onClick={() => verRecibo(r)}
                      title="Vista previa" className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Eye size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cerrado && recibos.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
          <span>{marcados.length} de {timbrados.length} timbrado(s) marcados para correo</span>
          <button onClick={() => marcarCorreo(timbrados.map((r) => r.id), true)} disabled={timbrados.length === 0}
            className="text-primary hover:underline disabled:text-gray-300">marcar todos</button>
          <span className="text-gray-300">·</span>
          <button onClick={() => marcarCorreo(recibos.map((r) => r.id), false)} className="hover:underline">ninguno</button>
          <span className="ml-auto flex items-center gap-1"><Info size={12} /> También aparecen en Nómina → CFDI.</span>
        </div>
      )}

      {viendo && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={cerrarVista}>
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-5 py-3">
              <div>
                <h2 className="font-semibold">{viendo.nombre}</h2>
                <p className="text-xs text-gray-500">{viendo.uuid ? 'Timbrado' : 'Sin timbrar — vista previa'} · PTU</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setModoXml(!modoXml)} className="text-sm text-primary hover:underline">{modoXml ? 'Ver el PDF' : 'Ver el XML'}</button>
                <button onClick={cerrarVista} className="text-gray-400 hover:text-gray-600 ml-2"><X size={20} /></button>
              </div>
            </div>
            {modoXml ? (
              <pre className="p-4 text-[11px] font-mono overflow-x-auto max-h-[70vh] whitespace-pre-wrap break-all bg-slate-50">{viendo.xml}</pre>
            ) : pdfUrl ? (
              <iframe src={pdfUrl} title={`Recibo de ${viendo.nombre}`} className="w-full bg-slate-100" style={{ height: '75vh', border: 0 }} />
            ) : (
              <p className="p-8 text-center text-sm text-gray-500">Generando el PDF…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KpiPtu({ label, valor, sub }: { label: string; valor: string; sub?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 min-w-[7.5rem]">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-base font-bold text-gray-900 tabular-nums">{valor}</p>
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </div>
  );
}

/* Un renglón del reparto: días y salario editables (guardan al salir del campo);
 * el interruptor «derecho» excluye a los directivos a mano. */
function FilaPTU({ f, onGuardar, bloqueado }: { f: any; onGuardar: (id: string, c: any) => void; bloqueado?: boolean }) {
  const [dias, setDias] = useState(String(f.dias ?? ''));
  const [sal, setSal] = useState(String(f.salario_diario ?? ''));
  useEffect(() => { setDias(String(f.dias ?? '')); setSal(String(f.salario_diario ?? '')); }, [f.dias, f.salario_diario]);

  return (
    <tr className={`hover:bg-gray-50 ${f.con_derecho ? '' : 'opacity-50'}`}>
      <td className="px-2 py-1.5"><p className="truncate max-w-[14rem] text-gray-800">{f.nombre}</p><p className="text-[10px] text-gray-400 font-mono">{f.num_empleado}{f.puesto ? ` · ${f.puesto}` : ''}</p></td>
      <td className="px-2 py-1.5 text-center">
        <button onClick={() => !bloqueado && onGuardar(f.empleado_id, { conDerecho: !f.con_derecho })} disabled={bloqueado}
          title={bloqueado
            ? 'El periodo ya está cerrado'
            : f.menos_60
              ? 'Menos de 60 días: sin derecho por default (Art. 127-IV, eventuales). Clic para incluir si es de planta.'
              : (f.con_derecho ? 'Con derecho — clic para excluir (directivo)' : 'Excluido — clic para incluir')}
          className={`w-9 h-5 rounded-full relative transition-colors disabled:opacity-60 ${f.con_derecho ? 'bg-emerald-500' : 'bg-gray-300'}`}>
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${f.con_derecho ? 'left-4' : 'left-0.5'}`} />
        </button>
      </td>
      <td className="px-2 py-1.5 text-right">
        <input value={dias} onChange={(e) => setDias(e.target.value)} type="number" step="any" min="0" disabled={bloqueado}
          onBlur={() => { const v = dias === '' ? null : Number(dias); if (v !== Number(f.dias)) onGuardar(f.empleado_id, { dias: v }); }}
          className="w-16 border border-gray-200 rounded px-1 py-1 text-xs text-right disabled:bg-gray-100 disabled:text-gray-500" />
      </td>
      <td className="px-2 py-1.5 text-right">
        <input value={sal} onChange={(e) => setSal(e.target.value)} type="number" step="any" min="0" disabled={bloqueado}
          onBlur={() => { const v = sal === '' ? null : Number(sal); if (v !== Number(f.salario_diario)) onGuardar(f.empleado_id, { salario: v }); }}
          className="w-20 border border-gray-200 rounded px-1 py-1 text-xs text-right disabled:bg-gray-100 disabled:text-gray-500" />
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{mxn(f.salario_devengado)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{mxn(f.ptu_dias)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{mxn(f.ptu_salario)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums font-medium text-gray-900">{mxn(f.ptu)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{mxn(f.exento)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{mxn(f.gravado)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-rose-700">{mxn(f.isr)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-emerald-700">{mxn(f.neto)}</td>
    </tr>
  );
}

export default NominaCalculoPage;
