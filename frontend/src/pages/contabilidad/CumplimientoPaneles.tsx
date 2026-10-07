/**
 * Cumplimiento — paneles reutilizables (Notificaciones · Declaraciones · Información
 * fiscal · Validar CFDI). Antes vivían en el hub «Cumplimiento fiscal» (ServiciosSat,
 * ya retirado); ahora se consultan en VENTANAS EMERGENTES desde el Panel fiscal.
 * Consultas en línea con la CIEC de la empresa (salvo Validar CFDI, que sólo usa el RFC).
 */
import { useState, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSearch, BadgeCheck, AlertTriangle, Loader2, FileText, Mail, MailOpen, RefreshCw, Upload } from 'lucide-react';
import api from '@/services/api';
import { PuntosCargando } from '@/components/PuntosCargando';
import { aTextoMx } from '@/components/CampoFecha';

const Q_INFO = ['cumpl-info-fiscal'];

/** Abre un documento (data-URL base64) en pestaña nueva vía blob. */
function abrirDoc(dataUrl: string) {
  try {
    const [meta, b64] = dataUrl.split(',');
    const mime = meta.match(/data:(.*?);/)?.[1] || 'application/pdf';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: mime }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch { /* noop */ }
}

/* ═══════════════ Notificaciones y comunicados ═══════════════ */
interface Notif { id?: string; asunto?: string; titulo?: string; fecha?: string; leido?: boolean; texto?: string }

function ItemNotif({ n }: { n: Notif }) {
  const leido = !!n.leido;
  return (
    <li className="flex items-start gap-2.5 py-2">
      {leido ? <MailOpen size={18} className="text-emerald-500 mt-0.5 shrink-0" />
        : <Mail size={18} className="text-rose-500 mt-0.5 shrink-0" />}
      <div className="min-w-0">
        <p className={`text-sm truncate ${leido ? 'text-gray-600' : 'text-gray-900 font-medium'}`}>{n.asunto || n.titulo || 'Sin asunto'}</p>
        {n.fecha && <p className="text-[11px] text-gray-400">{n.fecha}</p>}
        {n.texto && <p className="text-xs text-gray-500 line-clamp-2">{n.texto}</p>}
      </div>
    </li>
  );
}

function ColumnaNotif({ titulo, items }: { titulo: string; items: Notif[] }) {
  // Descendente: primero la más reciente (por fecha si existe).
  const orden = [...items].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h4 className="text-sm font-semibold text-gray-800 mb-1">{titulo}</h4>
      {orden.length === 0
        ? <p className="text-sm text-gray-400 italic py-8 text-center">Sin {titulo.toLowerCase()} por ahora.</p>
        : <ul className="divide-y">{orden.map((n, i) => <ItemNotif key={n.id || i} n={n} />)}</ul>}
    </div>
  );
}

export function PanelNotificaciones() {
  // Comunicados y Avisos del buzón, en orden descendente (el más reciente arriba).
  // Sobre rojo (cerrado) = sin leer; sobre verde (abierto) = leído. El canal del
  // buzón por el proveedor fiscal aún no está conectado: por ahora llega vacío, pero
  // el botón «Actualizar» y la vista ya están listos (además se refresca en el barrido
  // semanal de cumplimiento).
  const q = useQuery({ queryKey: ['buzon-notif'], queryFn: () => api.getBuzonNotificaciones() });
  const d: any = (q.data as any)?.data || {};
  const comunicados: Notif[] = d.comunicados || [];
  const avisos: Notif[] = d.avisos || [];
  const conectado = !!d.conectado;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-gray-500 bg-gray-50 border rounded px-3 py-1.5 flex items-center gap-2 flex-1 min-w-[16rem]">
          <Mail size={13} className="text-rose-500" /> Sin leer &nbsp;·&nbsp; <MailOpen size={13} className="text-emerald-500" /> Leído
          &nbsp;— el más reciente arriba.{!conectado && ' El buzón se conectará con el servicio fiscal; por ahora se actualiza vacío.'}
        </p>
        <button onClick={() => q.refetch()} disabled={q.isFetching}
          title="Trae los comunicados y avisos más recientes del buzón"
          className="flex items-center gap-1.5 border px-3 py-1.5 rounded-lg hover:bg-gray-50 text-sm text-gray-600 disabled:opacity-50 shrink-0">
          {q.isFetching ? <PuntosCargando /> : <RefreshCw size={14} />} Actualizar
        </button>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <ColumnaNotif titulo="Comunicados" items={comunicados} />
        <ColumnaNotif titulo="Avisos" items={avisos} />
      </div>
    </div>
  );
}

/* ═══════════════ Declaraciones — cuadrícula año × mes ═══════════════ */
const MESES_ABBR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
type AnioEstado = {
  estado: 'cargando' | 'listo' | 'error' | 'guardado';
  conteos?: Record<number, number>;   // del resumen (sólo cuántos, sin el PDF)
  porMes?: Record<number, any[]>;       // contenido completo (con base64) tras abrir el año
  contenidoCargado?: boolean;
  descargadoAt?: string;
  error?: string;
};

export function PanelDeclaraciones() {
  const anioActual = new Date().getFullYear();
  const anios: number[] = [];
  for (let a = anioActual; a >= 2018; a--) anios.push(a);
  const [datos, setDatos] = useState<Record<number, AnioEstado>>({});
  const [sel, setSel] = useState<string | null>(null);

  // Al entrar: pinta la cuadrícula con los años YA respaldados (conteo por mes),
  // SIN tocar SatGo. Así "lo que ya bajaste queda en el calendario".
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r: any = await api.satgoDeclaracionesResumen();
        const lista = r?.data?.anios || [];
        if (!vivo || !lista.length) return;
        setDatos((p) => {
          const n = { ...p };
          for (const a of lista) n[a.ejercicio] = { estado: 'guardado', conteos: a.porMes || {}, descargadoAt: a.descargadoAt };
          return n;
        });
      } catch { /* sin respaldo todavía: arranca vacía */ }
    })();
    return () => { vivo = false; };
  }, []);

  // Trae el contenido (con PDF) de un año. forzar=true vuelve a bajarlo de SatGo y
  // SUSTITUYE el respaldo (es lo que hace el clic en el año).
  const cargarAnio = async (anio: number, forzar = false) => {
    const st = datos[anio];
    if (!forzar && st?.contenidoCargado) return;   // ya está completo en memoria
    if (st?.estado === 'cargando') return;
    setDatos((p) => ({ ...p, [anio]: { ...(p[anio] || { estado: 'cargando' }), estado: 'cargando' } }));
    try {
      const r: any = await api.satgoDeclaracionesContenido(anio, 0, forzar);
      const archivos = r?.data?.archivos || [];
      const porMes: Record<number, any[]> = {};
      for (const f of archivos) (porMes[f.mes] ??= []).push(f);
      setDatos((p) => ({ ...p, [anio]: { estado: 'listo', porMes, contenidoCargado: true, descargadoAt: r?.data?.descargadoAt } }));
    } catch (e: any) {
      setDatos((p) => ({ ...p, [anio]: { ...(p[anio] || { estado: 'error' }), estado: 'error', error: e?.response?.data?.message || 'No se pudo.' } }));
    }
  };

  const clickCelda = (anio: number, mes: number) => {
    const st = datos[anio];
    // Abrir una celda NO regasta cuota: si el año ya está respaldado, su contenido
    // se trae del respaldo (forzar=false). Sólo se baja la primera vez.
    if (!st?.contenidoCargado && st?.estado !== 'cargando') cargarAnio(anio, false);
    setSel(`${anio}-${mes}`);
  };

  /** Cuántos documentos hay en un mes: del contenido cargado o del conteo guardado. */
  const cuentaMes = (a: AnioEstado | undefined, mes: number): number | null => {
    if (!a) return null;
    if (a.porMes) return (a.porMes[mes] || []).length;
    if (a.conteos) return a.conteos[mes] || 0;
    return null;
  };

  const celda = (anio: number, mes: number) => {
    const a = datos[anio];
    const key = `${anio}-${mes}`;
    const activa = sel === key;
    const n = cuentaMes(a, mes);
    let contenido: ReactNode = <span className="text-gray-300">·</span>;
    if (a?.estado === 'cargando') contenido = <Loader2 size={12} className="animate-spin text-primary mx-auto" />;
    else if (a?.estado === 'error') contenido = <span className="text-rose-400" title={a.error}>!</span>;
    else if (n != null) contenido = n > 0
      ? <span className="inline-flex items-center gap-0.5 text-emerald-700"><FileText size={11} />{n}</span>
      : <span className="text-gray-200">—</span>;
    return (
      <td key={mes} className="p-0.5">
        <button onClick={() => clickCelda(anio, mes)}
          className={`w-full h-8 rounded text-xs flex items-center justify-center border transition
            ${activa ? 'border-primary ring-1 ring-primary/40' : 'border-gray-100 hover:border-primary/40 hover:bg-primary/5'}`}>
          {contenido}
        </button>
      </td>
    );
  };

  const [selAnio, selMes] = sel ? sel.split('-').map(Number) : [0, 0];
  const docsSel: any[] = sel ? (datos[selAnio]?.porMes?.[selMes] || []) : [];
  const estadoSel = sel ? datos[selAnio]?.estado : undefined;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Cuadrícula de declaraciones: <b>años en vertical, meses en horizontal</b>. Lo que ya bajaste <b>queda
        guardado</b> y se muestra al entrar sin volver a consultar. Abre una celda para ver sus PDF; cada uno se
        <b> encasilla en el mes</b> en que se presentó. El número indica cuántos documentos hay (Normal, Complementaria…).
      </p>
      <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-1.5 flex items-start gap-1.5">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> El año se baja <b>una sola vez</b> y se conserva comprimido. Da clic en el
        botón <RefreshCw size={11} className="inline mx-0.5" /> de un <b>año</b> sólo cuando quieras <b>volver a bajarlo</b> y sustituir lo guardado (consume cuota).
      </p>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="text-center border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="px-3 py-2 text-xs font-semibold text-gray-600 text-left sticky left-0 bg-gray-50">Año</th>
              {MESES_ABBR.map((m) => <th key={m} className="px-1 py-2 text-[11px] font-semibold text-gray-500 w-12">{m}</th>)}
              <th className="px-1 py-2 text-[11px] font-semibold text-gray-500 w-12">Otros</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {anios.map((a) => (
              <tr key={a} className="hover:bg-gray-50/50">
                <td className="px-2 py-1 text-left sticky left-0 bg-white">
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setSel(`${a}-1`); if (!datos[a]?.contenidoCargado) cargarAnio(a, false); }}
                      className="text-sm font-medium text-gray-700 hover:text-primary flex items-center gap-1">
                      {datos[a]?.estado === 'cargando' && <Loader2 size={12} className="animate-spin" />}{a}
                    </button>
                    <button onClick={() => cargarAnio(a, true)} disabled={datos[a]?.estado === 'cargando'}
                      title={`Volver a bajar ${a} de SatGo y sustituir lo guardado${datos[a]?.descargadoAt ? ' (respaldo del ' + datos[a]?.descargadoAt + ')' : ''}`}
                      className="text-gray-300 hover:text-primary disabled:opacity-40">
                      <RefreshCw size={12} className={datos[a]?.estado === 'cargando' ? 'animate-spin' : ''} />
                    </button>
                  </div>
                </td>
                {MESES_ABBR.map((_, i) => celda(a, i + 1))}
                {celda(a, 0)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sel && (
        <div className="bg-white rounded-lg shadow p-4 space-y-2">
          <h4 className="text-sm font-semibold text-gray-800 flex items-center justify-between gap-2">
            <span>{selMes === 0 ? `Otros documentos ${selAnio}` : `${MESES_ABBR[selMes - 1]} ${selAnio}`}</span>
            {datos[selAnio]?.descargadoAt && <span className="text-[11px] font-normal text-gray-400">respaldo del {datos[selAnio]?.descargadoAt}</span>}
          </h4>
          {estadoSel === 'cargando' && <p className="text-sm text-primary flex items-center gap-2"><PuntosCargando /> Trayendo las declaraciones del año…</p>}
          {estadoSel === 'error' && <p className="text-sm text-rose-700 flex items-center gap-1.5"><AlertTriangle size={14} /> {datos[selAnio]?.error}</p>}
          {(estadoSel === 'listo' || estadoSel === 'guardado') && (docsSel.length
            ? <ul className="divide-y">
                {docsSel.map((f: any, i: number) => (
                  <li key={i} className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-gray-700 flex items-center gap-1.5 truncate">
                      <FileText size={14} className={f.esPdf ? 'text-rose-500' : 'text-gray-400'} />
                      {f.tipo && <span className={`text-[10px] px-1.5 py-0.5 rounded ${/complementaria/i.test(f.tipo) ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{f.tipo}</span>}
                      {f.nombre}
                    </span>
                    <button onClick={() => abrirDoc(f.base64)} className="text-xs text-primary hover:underline shrink-0 ml-3">Abrir</button>
                  </li>
                ))}
              </ul>
            : <p className="text-sm text-gray-500 italic">Sin declaraciones en este periodo.</p>)}
        </div>
      )}
    </div>
  );
}

/* ═══════════════ Información fiscal — vista legible, en memoria ═══════════════ */
const LBL: Record<string, string> = {
  rfc: 'RFC', nombre: 'Nombre / Razón social', curp: 'CURP', situacion: 'Situación',
  detalleSituacion: 'Detalle de situación', fechaSituacion: 'Fecha de situación', fechaNacimiento: 'Fecha de nacimiento',
  fecha: 'Fecha de consulta', hora: 'Hora', ubicacionFiscal: 'Domicilio fiscal', datosIdentificacion: 'Identificación',
  regimenes: 'Regímenes', regimenesFiscales: 'Regímenes fiscales', obligaciones: 'Obligaciones',
  actividadesEconomicas: 'Actividades económicas', estatusDomicilio: 'Estatus del domicilio',
  estatusContribuyenteEnDomicilio: 'Estatus del contribuyente', fechaAltaDomicilio: 'Alta del domicilio',
  entidadFederativa: 'Entidad federativa', municipioDemarcacionTerritorial: 'Municipio / Demarcación',
  localidad: 'Localidad', colonia: 'Colonia', nombreVialidad: 'Vialidad', numeroExterior: 'No. exterior',
  numeroInterior: 'No. interior', entreCalle: 'Entre calle', yCalle: 'y calle', tipoVialidad: 'Tipo de vialidad',
  codigoPostal: 'Código postal', tipoInmueble: 'Tipo de inmueble', telefonoFijo: 'Teléfono fijo',
  telefonoMovil: 'Teléfono móvil', ad: 'Administración', correoElectronico: 'Correo electrónico',
};
const etiqueta = (k: string) => LBL[k] || k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const fmt = (v: any) => v === true ? 'Sí' : v === false ? 'No' : (v == null || v === '') ? '—' : String(v);
const esEscalar = (v: any) => v == null || typeof v !== 'object';

function domicilioLinea(u: any): string {
  const p: string[] = [];
  const via = [u.tipoVialidad, u.nombreVialidad].filter(Boolean).join(' ');
  if (via) p.push(via);
  if (u.numeroExterior) p.push('No. ' + u.numeroExterior);
  if (u.numeroInterior) p.push('Int. ' + u.numeroInterior);
  if (u.colonia) p.push('Col. ' + u.colonia);
  if (u.codigoPostal) p.push('C.P. ' + u.codigoPostal);
  const mun = u.municipioDemarcacionTerritorial || u.localidad;
  if (mun) p.push(mun);
  if (u.entidadFederativa) p.push(u.entidadFederativa);
  return p.join(', ');
}

function Campos({ obj }: { obj: any }) {
  const ent = Object.entries(obj).filter(([, v]) => esEscalar(v));
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
      {ent.map(([k, v]) => (
        <div key={k}>
          <p className="text-[11px] text-gray-400">{etiqueta(k)}</p>
          <p className="text-sm text-gray-800 break-words">{fmt(v)}</p>
        </div>
      ))}
    </div>
  );
}

function Tabla({ filas }: { filas: any[] }) {
  if (!filas.length) return <p className="text-sm text-gray-400 italic">—</p>;
  if (esEscalar(filas[0])) return <p className="text-sm text-gray-800">{filas.map(fmt).join(', ')}</p>;
  const cols = Array.from(new Set(filas.flatMap((f) => Object.keys(f))));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b">{cols.map((c) => <th key={c} className="px-2 py-1 text-left text-[11px] font-semibold text-gray-500">{etiqueta(c)}</th>)}</tr></thead>
        <tbody className="divide-y">
          {filas.map((f, i) => <tr key={i}>{cols.map((c) => <td key={c} className="px-2 py-1 text-gray-700">{fmt(f[c])}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function VistaInfoFiscal({ data }: { data: any }) {
  const entries = Object.entries(data || {});
  const objetos = entries.filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
  const arreglos = entries.filter(([, v]) => Array.isArray(v));
  const hayEscalarRaiz = entries.some(([, v]) => esEscalar(v));
  const todos: any = { ...data };
  for (const [, v] of objetos) Object.assign(todos, v);
  const situacion = todos.situacion || todos.detalleSituacion;
  const activo = /activo/i.test(String(situacion || ''));

  return (
    <div className="space-y-3">
      {(todos.rfc || todos.nombre) && (
        <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-lg font-bold text-gray-900">{todos.nombre || '—'}</p>
            <p className="text-sm font-mono text-gray-500">{todos.rfc || ''}</p>
          </div>
          {situacion && <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${activo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{fmt(situacion)}</span>}
        </div>
      )}
      {hayEscalarRaiz && (
        <div className="bg-white rounded-lg shadow p-4">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">Datos generales</h4>
          <Campos obj={Object.fromEntries(entries.filter(([, v]) => esEscalar(v)))} />
        </div>
      )}
      {objetos.map(([k, v]) => (
        <div key={k} className="bg-white rounded-lg shadow p-4 space-y-2">
          <h4 className="text-sm font-semibold text-gray-800">{etiqueta(k)}</h4>
          {/rfc$|domicili|ubicacion/i.test(k) && domicilioLinea(v as any) && (
            <p className="text-sm text-gray-700 bg-gray-50 border rounded px-3 py-1.5">{domicilioLinea(v as any)}</p>
          )}
          <Campos obj={v} />
        </div>
      ))}
      {arreglos.map(([k, v]) => (
        <div key={k} className="bg-white rounded-lg shadow p-4 space-y-2">
          <h4 className="text-sm font-semibold text-gray-800">{etiqueta(k)}</h4>
          <Tabla filas={v as any[]} />
        </div>
      ))}
    </div>
  );
}

export function PanelInfoFiscal() {
  const qc = useQueryClient();
  const [verJson, setVerJson] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState('');

  // GUARDADO: se presenta lo que ya se consultó (lectura barata de la BD, sin SatGo).
  const q = useQuery({ queryKey: Q_INFO, queryFn: () => api.satgoInfoFiscal() });
  const saved = (q.data as any)?.data as { info: any; actualizado_at?: string } | null | undefined;
  const info = saved?.info ?? null;

  // ACTUALIZAR: re-consulta en el SAT (CIEC), la guarda y refresca la vista.
  const actualizar = async () => {
    setRefrescando(true); setError('');
    try { await api.satgoInfoFiscalRefrescar(); await qc.invalidateQueries({ queryKey: Q_INFO }); }
    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo consultar. Revisa la clave CIEC (Panel fiscal → 32-D → Configurar).'); }
    finally { setRefrescando(false); }
  };

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between gap-2">
        <p className="text-sm text-gray-600">
          Información fiscal de la empresa en el SAT (identidad, domicilio, régimen y obligaciones). Se <b>guarda</b> y se
          presenta aquí; <b>actualízala</b> cuando quieras (requiere la clave CIEC).
          {saved?.actualizado_at && <> · <span className="text-gray-500">Actualizada: {aTextoMx(saved.actualizado_at)}</span></>}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {info && <button onClick={() => setVerJson((v) => !v)} className="text-xs text-gray-500 hover:underline">{verJson ? 'Ver formato' : 'Ver JSON'}</button>}
          <button onClick={actualizar} disabled={refrescando}
            className="flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
            {refrescando ? <PuntosCargando /> : <FileSearch size={15} />} {info ? 'Actualizar' : 'Consultar'}
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-center gap-1.5"><AlertTriangle size={14} /> {error}</p>}
      {!info && !refrescando && !error && <p className="text-sm text-gray-400 italic">Aún no se ha consultado. Da clic en «Consultar» para traerla del SAT y guardarla.</p>}
      {info && (verJson
        ? <pre className="text-xs bg-gray-50 border rounded p-3 overflow-x-auto max-h-[30rem] whitespace-pre-wrap">{JSON.stringify(info, null, 2)}</pre>
        : <VistaInfoFiscal data={info} />)}
    </div>
  );
}

/* ═══════════════ Validación de CFDI ═══════════════ */
/** Extrae del XML del CFDI los 5 datos que pide la consulta del SAT:
 *  re (RFC emisor), rr (RFC receptor), tt (Total), id (UUID) y fe (últimos 8 del sello).
 *  Tolera cualquier prefijo de namespace (cfdi:/tfd: o sin prefijo). */
function datosDeCfdi(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('El archivo no es un XML válido.');
  const first = (local: string): Element | undefined => doc.getElementsByTagNameNS('*', local)[0];
  const comp = first('Comprobante');
  if (!comp) throw new Error('No parece un CFDI (no se encontró el nodo Comprobante).');
  const tfd = first('TimbreFiscalDigital');
  const sello = comp.getAttribute('Sello') || tfd?.getAttribute('SelloCFD') || '';
  return {
    re: (first('Emisor')?.getAttribute('Rfc') || '').toUpperCase(),
    rr: (first('Receptor')?.getAttribute('Rfc') || '').toUpperCase(),
    tt: comp.getAttribute('Total') || '',
    id: (tfd?.getAttribute('UUID') || '').toUpperCase(),
    fe: sello ? sello.slice(-8) : '',
  };
}

export function PanelValidarCfdi() {
  const [f, setF] = useState({ re: '', rr: '', tt: '', id: '', fe: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<any>(null);
  const [cargaMsg, setCargaMsg] = useState('');
  const set = (k: string) => (e: any) => setF((p) => ({ ...p, [k]: e.target.value }));

  // Carga el XML del CFDI y rellena los 5 campos; el usuario sólo da clic en Validar.
  const cargarXml = (file?: File) => {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        setF(datosDeCfdi(String(rd.result || '')));
        setError(''); setData(null);
        setCargaMsg(`Datos cargados de ${file.name}. Revisa y da clic en Validar.`);
      } catch (e: any) { setCargaMsg(''); setError(e?.message || 'No se pudo leer el XML.'); }
    };
    rd.readAsText(file);
  };

  const validar = async () => {
    setBusy(true); setError(''); setData(null);
    try { const r: any = await api.satgoValidarCfdi(f); setData(r?.data ?? r); }
    catch (e: any) { setError(e?.response?.data?.message || 'No se pudo validar el CFDI.'); }
    finally { setBusy(false); }
  };

  const estado = data ? String(
    data?.estado || data?.Estado || data?.estatus || data?.estadoComprobante || data?.CodigoEstatus || '',
  ) : '';
  const esVigente = /vigente/i.test(estado);
  const esCancelado = /cancel/i.test(estado);

  return (
    <div className="bg-white rounded-lg shadow p-5 space-y-4 max-w-2xl">
      <p className="text-sm text-gray-600">Consulta el estatus de un CFDI ante el SAT (vigente / cancelado). Sólo usa el RFC de la empresa; no requiere CIEC.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 border border-primary/40 text-primary rounded-lg px-3 py-2 hover:bg-primary/5 cursor-pointer text-sm font-medium">
          <input type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => cargarXml(e.target.files?.[0])} />
          <Upload size={15} /> Cargar XML del CFDI
        </label>
        <span className="text-xs text-gray-500">Rellena los campos solo; luego da clic en Validar.</span>
      </div>
      {cargaMsg && <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">{cargaMsg}</p>}
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="text-xs text-gray-600">RFC emisor (re)</span>
          <input value={f.re} onChange={set('re')} className="input w-full font-mono uppercase" placeholder="AAA010101AAA" /></label>
        <label className="block"><span className="text-xs text-gray-600">RFC receptor (rr)</span>
          <input value={f.rr} onChange={set('rr')} className="input w-full font-mono uppercase" placeholder="BBB020202BBB" /></label>
        <label className="block"><span className="text-xs text-gray-600">Total (tt)</span>
          <input value={f.tt} onChange={set('tt')} className="input w-full font-mono" placeholder="1160.00" /></label>
        <label className="block"><span className="text-xs text-gray-600">Últimos 8 del sello (fe) — opcional</span>
          <input value={f.fe} onChange={set('fe')} className="input w-full font-mono" placeholder="Xx12Yy34" /></label>
        <label className="block col-span-2"><span className="text-xs text-gray-600">UUID / Folio fiscal (id)</span>
          <input value={f.id} onChange={set('id')} className="input w-full font-mono uppercase" placeholder="12345678-90ab-cdef-1234-567890abcdef" /></label>
      </div>
      <button onClick={validar} disabled={busy}
        className="flex items-center gap-1.5 bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <BadgeCheck size={15} />} Validar
      </button>
      {error && <p className="text-sm text-rose-700 flex items-center gap-1.5"><AlertTriangle size={14} /> {error}</p>}
      {data && (
        <div className="space-y-2">
          {estado && (
            <p className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium ${
              esVigente ? 'bg-emerald-100 text-emerald-700' : esCancelado ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-700'}`}>
              <BadgeCheck size={15} /> {estado}
            </p>
          )}
          <pre className="text-xs bg-gray-50 border rounded p-3 overflow-x-auto max-h-80 whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
