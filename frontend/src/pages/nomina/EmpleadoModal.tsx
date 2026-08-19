/**
 * EmpleadoModal — alta y edición del expediente.
 *
 * ESTÁ PARTIDO EN CUATRO BLOQUES Y NO EN UNA LISTA LARGA
 * Identificación, domicilio, relación laboral y descuentos. Son cuatro momentos
 * distintos de la captura: lo primero llega con la credencial en la mano, el
 * domicilio con el comprobante, la relación laboral la decide quien contrata y
 * los descuentos llegan meses después con un oficio o una carta del INFONAVIT.
 * Un formulario de cincuenta campos seguidos hace que se capture lo que se ve,
 * no lo que se tiene.
 *
 * LOS AVISOS SON DEL SERVIDOR, NO DE LA PANTALLA
 * Las reglas —RFC de persona física, CURP de 18, mínimos de la LFT— viven en el
 * backend porque son las mismas para cualquiera que llame a la API. Aquí sólo
 * se muestran; duplicarlas en JavaScript garantizaría que un día digan cosas
 * distintas.
 */
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Save, AlertTriangle, FileText } from 'lucide-react';
import api from '@/services/api';
import { ComboConAlta } from './ComboConAlta';
import { CreditosDelTrabajador } from './CreditosDelTrabajador';
import { ExpedienteDelTrabajador } from './ExpedienteDelTrabajador';
import { FotoDelTrabajador } from './FotoDelTrabajador';

interface Props {
  /** null = alta. Con expediente = edición. */
  empleado?: any | null;
  /** Valores con los que abrir el formulario (los rescatados de un XML). */
  inicial?: Record<string, any>;
  /** Qué campos vienen del XML y cuáles se dedujeron — se marca en pantalla. */
  origen?: Record<string, string>;
  /**
   * No guarda: devuelve lo capturado a quien abrió el modal.
   *
   * Lo usa el alta en bloque, donde corregir un renglón NO debe crear a esa
   * persona por su cuenta: el alta de toda la tanda ocurre después, junta, y en
   * un solo lugar. Guardar aquí haría que corregir el nombre de alguien lo
   * diera de alta antes de que se confirme el resto.
   */
  soloDevolver?: boolean;
  onClose: () => void;
  onGuardado: (e: any) => void;
}

const VACIO: Record<string, any> = {
  num_empleado: '', nombre: '', apellido_pat: '', apellido_mat: '',
  rfc: '', curp: '', nss: '', fecha_nacimiento: '', email: '', telefono: '', foto: null,
  codigo_postal: '', calle: '', num_exterior: '', num_interior: '',
  colonia: '', municipio: '', estado: '',
  regimen_fiscal: '605', uso_cfdi: 'CN01',
  puesto: '', departamento: '', fecha_ingreso: '',
  tipo_contrato: '01', tipo_regimen: '02', tipo_jornada: '',
  periodicidad_pago: '04', tipo_nomina: 'O',
  entidad_federativa: '', zona_geografica: 'general',
  salario_diario: '', salario_diario_integrado: '',
  banco_clave: '', cuenta_clabe: '',
  tiene_infonavit: false, infonavit_num_credito: '',
  infonavit_tipo_descuento: '', infonavit_descuento: '', infonavit_seguro_danos: '',
  tiene_pension_alimenticia: false, pension_tipo: '', pension_monto: '',
  pension_beneficiario: '', pension_num_oficio: '',
};

const CAMPO =
  'w-full border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary';
const ETIQUETA = 'block text-xs font-medium text-gray-600 mb-1';

/**
 * ── POR QUÉ ESTOS DOS VIVEN AQUÍ Y NO DENTRO DEL MODAL ──
 *
 * Estaban definidos dentro de `EmpleadoModal`. Eso creaba un **tipo de
 * componente nuevo en cada render**, y React no tiene forma de saber que el
 * `<input>` de este render es el mismo del anterior: lo desmonta y lo vuelve a
 * montar. Un input recién montado no tiene el foco.
 *
 * El resultado era que se escribía una letra, el estado cambiaba, el modal se
 * volvía a dibujar y el cursor se salía del campo. Había que hacer clic para
 * cada letra. Definidos aquí afuera, el tipo es siempre el mismo, React
 * reutiliza el nodo y el foco se queda donde está.
 *
 * Es la razón por la que un componente NUNCA se define dentro de otro.
 */
function Campo({ k, label, tipo = 'text', ancho = '', f, set, marca, ...rest }: any) {
  return (
    <div className={ancho}>
      <label className={ETIQUETA}>{label}</label>
      <input
        type={tipo}
        className={`${CAMPO} ${marca(k)}`}
        value={f[k] ?? ''}
        onChange={(e) => set(k, e.target.value)}
        {...rest}
      />
    </div>
  );
}

function Selector({ k, label, opciones, incluirVacio, ancho = '', f, set, marca }: any) {
  return (
    <div className={ancho}>
      <label className={ETIQUETA}>{label}</label>
      <select className={`${CAMPO} ${marca(k)}`} value={f[k] ?? ''}
        onChange={(e) => set(k, e.target.value)}>
        {incluirVacio && <option value="">— sin especificar —</option>}
        {Object.entries(opciones || {}).map(([clave, texto]) => (
          <option key={clave} value={clave}>{clave} · {String(texto)}</option>
        ))}
      </select>
    </div>
  );
}

export function EmpleadoModal({ empleado, inicial, origen, soloDevolver, onClose, onGuardado }: Props) {
  const esEdicion = !!empleado?.id;
  const [bloque, setBloque] = useState<'id' | 'domicilio' | 'laboral' | 'descuentos' | 'expediente'>('id');
  const [f, setF] = useState<Record<string, any>>({ ...VACIO, ...(inicial || {}) });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cat = useQuery({ queryKey: ['nomina-catalogos'], queryFn: () => api.getNominaCatalogos() });
  const c: any = cat.data?.data;

  /* Puestos y departamentos son catálogos de la empresa: se eligen de la lista
   * y lo que falte se agrega desde el mismo combo. Escribirlos a mano es como
   * nacen "PRODUCCION" y "Producción" como dos departamentos distintos. */
  const puestosQ = useQuery({ queryKey: ['nomina-puestos'], queryFn: () => api.getNominaPuestos() });
  const deptosQ = useQuery({ queryKey: ['nomina-departamentos'], queryFn: () => api.getNominaDepartamentos() });
  const puestos: any[] = puestosQ.data?.data?.puestos || [];
  const departamentos: any[] = deptosQ.data?.data?.departamentos || [];

  const agregarPuesto = async (nombre: string) => {
    await api.crearNominaPuesto(nombre);
    await puestosQ.refetch();
    return nombre;
  };
  const agregarDepto = async (nombre: string) => {
    await api.crearNominaDepartamento(nombre);
    await deptosQ.refetch();
    return nombre;
  };

  useEffect(() => {
    if (empleado) {
      const limpio: Record<string, any> = { ...VACIO };
      for (const k of Object.keys(VACIO)) {
        if (empleado[k] !== undefined && empleado[k] !== null) limpio[k] = empleado[k];
      }
      limpio.edicion = empleado.edicion;
      setF(limpio);
    }
  }, [empleado]);

  /* En un alta a mano se propone el siguiente número libre. Con `inicial` no:
   * ahí el número ya viene del XML o lo propuso el importador. */
  useEffect(() => {
    if (esEdicion || inicial?.num_empleado) return;
    api.getSiguienteNumEmpleado()
      .then((r) => setF((v) => (v.num_empleado ? v : { ...v, num_empleado: r.data.numero })))
      .catch(() => { /* si falla, se captura a mano */ });
  }, [esEdicion, inicial]);

  const set = (k: string, v: any) => setF((s) => ({ ...s, [k]: v }));

  /* ── Leer la CIF ──
   *
   * El mismo extractor que ya usan los clientes (`/csf/extract`). Aquí sólo
   * sirve la rama de PERSONA FÍSICA: un trabajador no puede ser una moral, y
   * si alguien sube la constancia de la empresa hay que decírselo en vez de
   * llenar el expediente con la razón social.
   *
   * Lo leído se marca en ámbar igual que lo que deduce el importador de XML:
   * el SAT pega las palabras en el PDF —"PROLONGACIONADORATRICES"— y hay
   * campos que salen sin espacios. Se ven de un vistazo y se corrigen. */
  const [leyendoCif, setLeyendoCif] = useState(false);
  const [cifAviso, setCifAviso] = useState('');
  const [deCif, setDeCif] = useState<Record<string, true>>({});

  const leerCif = async (archivo: File) => {
    setLeyendoCif(true); setCifAviso(''); setError('');
    try {
      const r = await api.extractCSF(archivo);
      const m: any = r.data || {};
      const raw: any = m.raw || {};

      if (raw.tipo === 'PM') {
        setCifAviso(
          `Esa constancia es de una persona MORAL (${m.businessName || raw.denominacion || ''}). ` +
          'El expediente de un trabajador necesita la constancia de la persona física.'
        );
        return;
      }

      /* Sólo se pisa lo que la CIF trae. Un campo vacío en el PDF no debe
       * borrar lo que ya estaba capturado a mano. */
      const traer: Array<[string, any]> = [
        ['rfc', raw.rfc], ['curp', raw.curp],
        ['nombre', raw.nombre],
        ['apellido_pat', raw.apellido_paterno],
        ['apellido_mat', raw.apellido_materno],
        ['codigo_postal', raw.codigo_postal || m.postalCode],
        ['calle', raw.nombre_vialidad || m.street],
        ['num_exterior', raw.numero_exterior || m.extNumber],
        ['num_interior', raw.numero_interior],
        ['colonia', raw.colonia || m.neighborhood],
        ['municipio', raw.municipio || m.municipality],
        ['estado', m.state || ''],
        ['regimen_fiscal', m.fiscalRegime || ''],
      ];

      const marcados: Record<string, true> = {};
      setF((v) => {
        const n = { ...v };
        for (const [k, valor] of traer) {
          const t = String(valor ?? '').trim();
          if (!t) continue;
          n[k] = t;
          marcados[k] = true;
        }
        return n;
      });
      setDeCif(marcados);

      const faltan: string[] = [];
      if (!raw.rfc) faltan.push('RFC');
      if (!raw.curp) faltan.push('CURP');
      if (m.unresolvedRegimen) faltan.push('régimen fiscal');
      if (m.unresolvedState) faltan.push('estado');

      setCifAviso(
        `Se llenaron ${Object.keys(marcados).length} campos desde la constancia` +
        (faltan.length
          ? `. No se pudo sacar: ${faltan.join(', ')} — captúralo a mano.`
          : '. Revisa los marcados en ámbar: el SAT pega las palabras en el PDF ' +
            'y a veces salen sin espacios.')
      );
    } catch (e: any) {
      setCifAviso('');
      setError(
        e?.response?.data?.message ||
        'No se pudo leer la constancia. ¿Es el PDF original del SAT, sin escanear?'
      );
    } finally {
      setLeyendoCif(false);
    }
  };

  const guardar = async () => {
    setGuardando(true); setError('');
    /* Los vacíos se mandan como null y no como "": el servidor distingue "no lo
     * tengo" de "lo borré", y "" haría fallar los CHECK de formato. */
    const payload: Record<string, any> = {};
    for (const [k, v] of Object.entries(f)) payload[k] = v === '' ? null : v;

    if (soloDevolver) { setGuardando(false); onGuardado(payload); return; }

    try {
      const r = esEdicion
        ? await api.actualizarEmpleado(empleado.id, payload)
        : await api.crearEmpleado(payload);
      onGuardado(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo guardar el expediente');
    } finally {
      setGuardando(false);
    }
  };


  /* Marca visual de los campos que el importador DEDUJO: son los que hay que
   * mirar dos veces antes de guardar. */
  const marca = (k: string) =>
    origen?.[k] === 'deducido' || deCif[k]
      ? 'ring-1 ring-amber-300 bg-amber-50/40' : '';

  /* Lo que Campo y Selector necesitan del formulario. Va por props y no por
   * cierre porque los dos viven FUERA de este componente — ver el comentario
   * de arriba: definirlos aquí adentro era lo que borraba el foco. */
  const cc = { f, set, marca };

  /* Un color por bloque.
   *
   * Cinco pestañas iguales obligan a leer el rótulo cada vez para saber dónde
   * estás. Con un color de fondo distinto en cada una, la pantalla se reconoce
   * de reojo: el ojo aprende "el azul es identificación" en dos usos. El tono
   * es bajo a propósito —fondo de 50, borde de 200— para que no compita con lo
   * que sí importa, que son los campos. */
  /* El catálogo del SAT para el CP capturado. Sólo pregunta con cinco dígitos
   * completos: con tres no hay nada que resolver y sería una consulta por cada
   * tecla. El municipio y el estado se rellenan solos la primera vez y luego se
   * dejan en paz, por si el usuario los corrigió a mano. */
  const cpQ = useQuery({
    queryKey: ['cp-sat', f.codigo_postal],
    queryFn: () => api.resolverCodigoPostal(f.codigo_postal),
    enabled: /^\d{5}$/.test(f.codigo_postal || ''),
    staleTime: 60 * 60 * 1000,
    /* Un reintento: si la primera llamada cae justo cuando el servidor se
     * reinicia, sin reintento el combo se queda vacío hasta recargar la página
     * entera — y parece que la función no existe. */
    retry: 1,
  });
  /* Sin `.data`: este endpoint responde el objeto directo. Ver el comentario
   * de resolverCodigoPostal en api.ts — leerlo con envoltorio dejaba el combo
   * vacío aunque el catálogo tuviera las colonias. */
  const cpDatos: any = cpQ.data || {};
  const colonias: any[]   = cpDatos.colonias || [];
  const municipios: any[] = cpDatos.municipios || [];
  const estadoDelCp: string = cpDatos.estado || '';
  const estadoNombre: string = cpDatos.estadoDescripcion || '';

  /* El estado se rellena solo la primera vez y luego se deja en paz, por si
   * alguien lo corrigió a mano. Los dos digitos del CP determinan el estado sin
   * ambigüedad (Anexo 20), así que no hay nada que elegir. */
  useEffect(() => {
    if (!estadoDelCp || f.estado) return;
    set('estado', estadoDelCp);
  }, [estadoDelCp]);

  const BLOQUES = [
    { id: 'id', label: 'Identificación',
      tono: 'bg-sky-50 border-sky-200', activa: 'border-sky-500 text-sky-700 bg-sky-50' },
    { id: 'domicilio', label: 'Domicilio fiscal',
      tono: 'bg-emerald-50 border-emerald-200', activa: 'border-emerald-500 text-emerald-700 bg-emerald-50' },
    { id: 'laboral', label: 'Relación laboral',
      tono: 'bg-violet-50 border-violet-200', activa: 'border-violet-500 text-violet-700 bg-violet-50' },
    { id: 'descuentos', label: 'Descuentos',
      tono: 'bg-amber-50 border-amber-200', activa: 'border-amber-500 text-amber-700 bg-amber-50' },
    /* La bitácora y las entregas van al final: se consultan, no se capturan al
     * dar de alta. Poner primero lo que se llena el primer día y al final lo que
     * se acumula con los años. */
    { id: 'expediente', label: 'Bitácora y entregas',
      tono: 'bg-slate-50 border-slate-200', activa: 'border-slate-500 text-slate-700 bg-slate-50' },
  ] as const;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className={`bg-white rounded-lg shadow-xl w-full my-8 ${
          bloque === 'expediente' ? 'max-w-6xl' : 'max-w-3xl'
        }`}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-lg">
            {esEdicion
              ? `Expediente de ${empleado.nombre_completo}`
              : 'Alta de trabajador'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        {origen && Object.values(origen).includes('deducido') && (
          <div className="mx-5 mt-4 bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded-lg text-xs flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            Los campos con borde ámbar no venían tal cual en el XML: se dedujeron.
            Revísalos antes de guardar.
          </div>
        )}

        <div className="flex gap-1 px-5 pt-4 border-b">
          {BLOQUES.map((b) => (
            <button
              key={b.id}
              onClick={() => setBloque(b.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px rounded-t transition ${
                bloque === b.id
                  ? b.activa
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>

        <div className={`p-5 space-y-4 border-t-0 border ${
          BLOQUES.find((b) => b.id === bloque)?.tono || ''
        }`}>
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          {bloque === 'id' && (
            <div className="flex flex-col sm:flex-row gap-5">
              {/* La foto a la izquierda, junto a los datos que la identifican:
                  es el orden de una credencial y el de cualquier expediente en
                  papel. */}
              <div className="shrink-0 sm:pt-5 space-y-2">
                <FotoDelTrabajador
                  valor={f.foto}
                  onChange={(v) => set('foto', v)}
                  disabled={false}
                />

                {/* Leer la CIF: doce campos de un jalón en vez de teclearlos.
                    Va junto a la foto porque es lo PRIMERO que se hace en un
                    alta —antes de capturar nada— y ahí lo encuentra el ojo. */}
                <label className={`flex items-center justify-center gap-1.5 w-[120px] text-xs
                  border rounded-lg py-1.5 cursor-pointer transition ${
                    leyendoCif
                      ? 'bg-gray-100 text-gray-400 cursor-wait'
                      : 'border-sky-300 text-sky-700 hover:bg-sky-50'
                  }`}>
                  <FileText size={13} />
                  {leyendoCif ? 'Leyendo…' : 'Leer CIF'}
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    disabled={leyendoCif}
                    onChange={(e) => {
                      const a = e.target.files?.[0];
                      /* Se limpia el input para que subir el MISMO archivo dos
                         veces vuelva a disparar el evento. */
                      e.target.value = '';
                      if (a) leerCif(a);
                    }}
                  />
                </label>
              </div>
              <div className="flex-1">
              {cifAviso && (
                <p className="text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded px-3 py-2 mb-3">
                  {cifAviso}
                </p>
              )}
              <div className="grid sm:grid-cols-3 gap-3">
              <Campo {...cc} k="num_empleado" label="Número de empleado *" />
              <Campo {...cc} k="nombre" label="Nombre(s) *" ancho="sm:col-span-2" />
              <Campo {...cc} k="apellido_pat" label="Apellido paterno *" />
              <Campo {...cc} k="apellido_mat" label="Apellido materno" />
              <div />
              <Campo {...cc} k="rfc" label="RFC *" maxLength={13} style={{ textTransform: 'uppercase' }} />
              <Campo {...cc} k="curp" label="CURP *" maxLength={18} ancho="sm:col-span-2" style={{ textTransform: 'uppercase' }} />
              <Campo {...cc} k="nss" label="NSS (11 dígitos)" maxLength={13} />
              <Campo {...cc} k="fecha_nacimiento" label="Fecha de nacimiento" tipo="date" />
              <div />
              <Campo {...cc} k="email" label="Correo" tipo="email" ancho="sm:col-span-2" />
              <Campo {...cc} k="telefono" label="Teléfono" />
              </div>
              </div>
            </div>
          )}

          {bloque === 'expediente' && (
            <ExpedienteDelTrabajador
              empleadoId={empleado?.id}
              puedeEditar={!soloDevolver}
            />
          )}

          {bloque === 'domicilio' && (
            <>
              <p className="text-xs text-gray-500">
                El código postal tiene que ser el que el SAT tiene registrado para ese RFC:
                si no coincide, el timbrado se rechaza con el error CFDI40147.
              </p>
              <div className="grid sm:grid-cols-3 gap-3">
                <Campo {...cc} k="codigo_postal" label="Código postal" maxLength={5} />
                <Campo {...cc} k="calle" label="Calle" ancho="sm:col-span-2" />
                <Campo {...cc} k="num_exterior" label="Número exterior" />
                <Campo {...cc} k="num_interior" label="Número interior" />

                {/* Colonia, municipio y estado salen del catálogo del SAT, no de
                    lo que se teclee: es el MISMO catálogo contra el que el PAC
                    valida. Una colonia escrita a mano con una letra distinta
                    rebota el timbrado, y el error llega días después. */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    Colonia
                    {cpQ.isFetching && <span className="text-gray-400"> · buscando…</span>}
                  </label>
                  {colonias.length > 0 ? (
                    <select
                      value={f.colonia}
                      onChange={(e) => set('colonia', e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">— Elige la colonia —</option>
                      {colonias.map((c: any) => (
                        <option key={c.clave} value={c.descripcion}>{c.descripcion}</option>
                      ))}
                    </select>
                  ) : (
                    <Campo {...cc} k="colonia" label="" />
                  )}

                  {/* Sin combo hay TRES motivos distintos y desde la pantalla se
                      veían iguales: un campo de texto vacío. Decir cuál es
                      convierte el próximo reporte en un diagnóstico. */}
                  {colonias.length > 0 ? (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {colonias.length} colonia(s) en el CP {f.codigo_postal}
                    </p>
                  ) : cpQ.isError ? (
                    <p className="text-[10px] text-rose-600 mt-0.5">
                      No se pudo consultar el catálogo:{' '}
                      {(cpQ.error as any)?.response?.status
                        ? `error ${(cpQ.error as any).response.status}`
                        : (cpQ.error as any)?.message || 'sin respuesta'}
                      . Se puede escribir a mano.
                    </p>
                  ) : !/^\d{5}$/.test(f.codigo_postal || '') ? (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Captura el código postal completo y aparecen las colonias.
                    </p>
                  ) : cpQ.isFetching ? null : (
                    <p className="text-[10px] text-amber-700 mt-0.5">
                      El catálogo del SAT no tiene colonias para el CP {f.codigo_postal}.
                      Se puede escribir a mano.
                    </p>
                  )}
                </div>
                {/* Municipio: la lista del estado que resolvió el CP. Es el mismo
                    catálogo contra el que valida el PAC, y tecleado a mano una
                    letra distinta rebota el timbrado días después. */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Municipio / alcaldía</label>
                  {municipios.length > 0 ? (
                    <select
                      value={f.municipio}
                      onChange={(e) => set('municipio', e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="">— Elige el municipio —</option>
                      {municipios.map((m: any) => (
                        <option key={m.clave} value={m.descripcion}>{m.descripcion}</option>
                      ))}
                    </select>
                  ) : (
                    <Campo {...cc} k="municipio" label="" />
                  )}
                  {municipios.length > 0 && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {municipios.length} municipio(s) de {estadoDelCp}
                    </p>
                  )}
                </div>

                {/* El estado NO se elige: los dos primeros dígitos del CP lo
                    determinan sin ambigüedad. Se muestra para confirmar, no para
                    capturar — poder cambiarlo sólo permitiría contradecir al CP. */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Estado</label>
                  <input
                    value={estadoNombre ? `${f.estado} · ${estadoNombre}` : f.estado}
                    readOnly
                    className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700"
                  />
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Lo determina el código postal.
                  </p>
                </div>
                <Campo {...cc} k="regimen_fiscal" label="Régimen fiscal" maxLength={3} />
                <Campo {...cc} k="uso_cfdi" label="Uso del CFDI" maxLength={5} />
              </div>
            </>
          )}

          {bloque === 'laboral' && (
            <div className="grid sm:grid-cols-3 gap-3">
              <ComboConAlta
                label="Puesto"
                opciones={puestos}
                valor={f.puesto}
                onChange={(v) => set('puesto', v)}
                onAgregar={agregarPuesto}
              />
              <ComboConAlta
                label="Departamento"
                opciones={departamentos}
                valor={f.departamento}
                onChange={(v) => set('departamento', v)}
                onAgregar={agregarDepto}
              />
              <Campo {...cc} k="fecha_ingreso" label="Fecha de ingreso *" tipo="date" />
              <Selector {...cc} k="tipo_contrato" label="Tipo de contrato" opciones={c?.tiposContrato} ancho="sm:col-span-3" />
              <Selector {...cc} k="tipo_regimen" label="Tipo de régimen" opciones={c?.tiposRegimen} ancho="sm:col-span-3" />
              <Selector {...cc} k="tipo_jornada" label="Tipo de jornada" opciones={c?.tiposJornada} incluirVacio ancho="sm:col-span-3" />
              <Selector {...cc} k="periodicidad_pago" label="Periodicidad de pago" opciones={c?.periodicidades} ancho="sm:col-span-2" />
              <div>
                <label className={ETIQUETA}>Tipo de nómina</label>
                <select className={CAMPO} value={f.tipo_nomina} onChange={(e) => set('tipo_nomina', e.target.value)}>
                  <option value="O">O · Ordinaria</option>
                  <option value="E">E · Extraordinaria</option>
                </select>
              </div>
              <Campo {...cc} k="entidad_federativa" label="Entidad federativa (c_Estado)" maxLength={3} />
              <div className="sm:col-span-2">
                <label className={ETIQUETA}>Zona salarial</label>
                <select className={`${CAMPO} ${marca('zona_geografica')}`} value={f.zona_geografica} onChange={(e) => set('zona_geografica', e.target.value)}>
                  <option value="general">General</option>
                  <option value="frontera_norte">Frontera norte</option>
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  Cambia el salario mínimo aplicable, y con él la exención de ISR y la cuota obrera.
                </p>
              </div>
              {/* Sólo estos dos sueldos. El "salario base de cotización" existía
                  aquí como un tercer campo y no servía más que para confundir:
                  el complemento de nómina trae SalarioBaseCotApor —que es el
                  diario— y SalarioDiarioIntegrado, y con esos dos se calcula
                  todo. La columna sigue en la base para no perder lo que ya se
                  hubiera capturado. */}
              {/* Los dos importes juntos y explicados. "Salario diario" y "SDI"
                  a secas se confunden —y confundirlos mueve la cuota del IMSS de
                  toda la plantilla—, así que cada uno dice qué es y cuál debe ser
                  mayor. El aviso salta solo si quedaron al revés: el factor de
                  integración nunca baja de 1. */}
              <div className="sm:col-span-3 grid sm:grid-cols-2 gap-3 p-3 rounded-lg bg-white/70 border">
                <div>
                  <Campo {...cc} k="salario_diario" label="Salario diario — el del contrato *"
                    tipo="number" step="0.01" />
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Lo que gana al día, sin prestaciones. Es el MENOR de los dos.
                  </p>
                </div>
                <div>
                  <Campo {...cc} k="salario_diario_integrado" label="SDI — base de cotización *"
                    tipo="number" step="0.01" />
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Diario + aguinaldo y prima vacacional (Art. 84 LSS). Siempre el MAYOR.
                  </p>
                </div>
                {Number(f.salario_diario_integrado) > 0 &&
                 Number(f.salario_diario_integrado) < Number(f.salario_diario) && (
                  <p className="sm:col-span-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    El SDI quedó por debajo del salario diario, y eso es imposible: el factor
                    de integración nunca baja de 1. Lo más probable es que estén invertidos.
                  </p>
                )}
              </div>
              <div>
                <label className={ETIQUETA}>Banco</label>
                <select
                  className={`${CAMPO} ${marca('banco_clave')}`}
                  value={f.banco_clave ?? ''}
                  onChange={(e) => set('banco_clave', e.target.value)}
                >
                  <option value="">— sin especificar —</option>
                  {(c?.bancos || []).map((b: any) => (
                    <option key={b.code} value={b.code}>{b.name}</option>
                  ))}
                </select>
                {/* La clave del SAT, visible. Es la que viaja en el CFDI
                    (nomina12:Receptor/@Banco) y la que forma los tres primeros
                    dígitos de la CLABE: si no cuadra con la cuenta, la
                    dispersión rebota. */}
                {f.banco_clave ? (
                  <p className="text-[11px] text-rose-600 font-mono mt-1">
                    Clave SAT: {f.banco_clave}
                  </p>
                ) : (
                  <p className="text-[11px] text-gray-400 mt-1">
                    La clave aparece aquí al elegir el banco.
                  </p>
                )}
              </div>
              <Campo {...cc} k="cuenta_clabe" label="CLABE (18 dígitos)" maxLength={18} ancho="sm:col-span-2" />
            </div>
          )}

          {bloque === 'descuentos' && (
            <div className="space-y-5">
              <div className="border rounded-lg p-4">
                <label className="flex items-center gap-2 font-medium text-sm">
                  <input
                    type="checkbox"
                    checked={!!f.tiene_infonavit}
                    onChange={(e) => set('tiene_infonavit', e.target.checked)}
                  />
                  Tiene crédito INFONAVIT
                </label>
                {f.tiene_infonavit && (
                  <div className="grid sm:grid-cols-2 gap-3 mt-3">
                    <Campo {...cc} k="infonavit_num_credito" label="Número de crédito" />
                    <div>
                      <label className={ETIQUETA}>Forma del descuento</label>
                      <select className={CAMPO} value={f.infonavit_tipo_descuento} onChange={(e) => set('infonavit_tipo_descuento', e.target.value)}>
                        <option value="">— elegir —</option>
                        <option value="porcentaje">Porcentaje sobre el SDI</option>
                        <option value="cuota_fija">Cuota fija mensual</option>
                        <option value="vsm">Veces salario mínimo</option>
                      </select>
                    </div>
                    <Campo {...cc} k="infonavit_descuento" label="Valor del descuento" tipo="number" step="0.0001" />
                    <Campo {...cc} k="infonavit_seguro_danos" label="Seguro de daños (diario)" tipo="number" step="0.01" />
                    <p className="sm:col-span-2 text-[11px] text-gray-500">
                      Se guarda la REGLA del descuento tal como viene en la carta del INFONAVIT,
                      no el importe de un periodo.
                    </p>
                  </div>
                )}
              </div>

              <div className="border rounded-lg p-4">
                <label className="flex items-center gap-2 font-medium text-sm">
                  <input
                    type="checkbox"
                    checked={!!f.tiene_pension_alimenticia}
                    onChange={(e) => set('tiene_pension_alimenticia', e.target.checked)}
                  />
                  Tiene pensión alimenticia
                </label>
                {f.tiene_pension_alimenticia && (
                  <div className="grid sm:grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className={ETIQUETA}>Forma del descuento</label>
                      <select className={CAMPO} value={f.pension_tipo} onChange={(e) => set('pension_tipo', e.target.value)}>
                        <option value="">— elegir —</option>
                        <option value="porcentaje">Porcentaje de percepciones</option>
                        <option value="cuota_fija">Cuota fija mensual</option>
                      </select>
                    </div>
                    <Campo {...cc} k="pension_monto" label="Valor" tipo="number" step="0.0001" />
                    <Campo {...cc} k="pension_beneficiario" label="Beneficiario" />
                    <Campo {...cc} k="pension_num_oficio" label="Número de oficio judicial" />
                    <p className="sm:col-span-2 text-[11px] text-gray-500">
                      Viene de una orden judicial: se captura exactamente como la diga el oficio.
                    </p>
                  </div>
                )}
              </div>

              {/* Préstamos y FONACOT van DEBAJO de las dos casillas y no como
                  una tercera: no son un atributo del trabajador sino eventos con
                  saldo, y una misma persona puede tener varios a la vez. */}
              <div className="border-t pt-4">
                <CreditosDelTrabajador
                  empleadoId={empleado?.id}
                  puedeEditar={!soloDevolver}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="flex items-center gap-2 px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            <Save size={15} /> {guardando ? 'Guardando…' : soloDevolver ? 'Usar estos datos' : esEdicion ? 'Guardar cambios' : 'Dar de alta'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EmpleadoModal;
