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
import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X, Save, AlertTriangle, FileText,
  Briefcase, FileSignature, CalendarClock, Banknote, Landmark,
} from 'lucide-react';
import api from '@/services/api';
import { ComboConAlta } from './ComboConAlta';
import { CreditosDelTrabajador } from './CreditosDelTrabajador';
import { ExpedienteDelTrabajador } from './ExpedienteDelTrabajador';
import { FotoDelTrabajador } from './FotoDelTrabajador';
import { CampoFecha, aTextoMx } from '@/components/CampoFecha';
import { revisarRfcPersonaFisica } from '@/utils/rfc';

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
  infonavit_desde: '', pension_desde: '',
};

const CAMPO =
  'w-full border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary';
const ETIQUETA = 'block text-xs font-medium text-gray-600 mb-1';

/** Catálogo c_Estado del SAT: las 32 entidades federativas. */
const ESTADOS_MX: Array<[string, string]> = [
  ['AGU', 'Aguascalientes'], ['BCN', 'Baja California'], ['BCS', 'Baja California Sur'],
  ['CAM', 'Campeche'], ['CHP', 'Chiapas'], ['CHH', 'Chihuahua'], ['CMX', 'Ciudad de México'],
  ['COA', 'Coahuila'], ['COL', 'Colima'], ['DUR', 'Durango'], ['GUA', 'Guanajuato'],
  ['GRO', 'Guerrero'], ['HID', 'Hidalgo'], ['JAL', 'Jalisco'], ['MEX', 'México'],
  ['MIC', 'Michoacán'], ['MOR', 'Morelos'], ['NAY', 'Nayarit'], ['NLE', 'Nuevo León'],
  ['OAX', 'Oaxaca'], ['PUE', 'Puebla'], ['QUE', 'Querétaro'], ['ROO', 'Quintana Roo'],
  ['SLP', 'San Luis Potosí'], ['SIN', 'Sinaloa'], ['SON', 'Sonora'], ['TAB', 'Tabasco'],
  ['TAM', 'Tamaulipas'], ['TLA', 'Tlaxcala'], ['VER', 'Veracruz'], ['YUC', 'Yucatán'],
  ['ZAC', 'Zacatecas'],
];

/** Días de vacaciones por antigüedad (LFT reformada 2023). Igual que el motor. */
function diasDeVacaciones(anos: number): number {
  const a = Math.floor(anos);
  if (a < 1) return 12;
  const primeros = [12, 14, 16, 18, 20];
  if (a <= 5) return primeros[a - 1];
  return 22 + Math.floor((a - 6) / 5) * 2;
}

/**
 * Fecha de nacimiento a partir del RFC de una persona física: las posiciones
 * 5-10 son AAMMDD. Devuelve AAAA-MM-DD (lo que espera CampoFecha) o null si el
 * RFC aún no alcanza o la fecha no existe. El siglo no viene en el RFC: para
 * gente en edad laboral, un año de dos dígitos mayor al actual es de 1900.
 */
function fechaNacDeRfc(rfc: string): string | null {
  const r = String(rfc || '').toUpperCase().replace(/\s/g, '');
  const m = /^[A-ZÑ&]{4}(\d{2})(\d{2})(\d{2})/.exec(r);
  if (!m) return null;
  const [, aa, mm, dd] = m;
  const mmN = +mm, ddN = +dd;
  if (mmN < 1 || mmN > 12 || ddN < 1 || ddN > 31) return null;
  const actual = new Date().getFullYear() % 100;
  const anio = +aa > actual ? 1900 + +aa : 2000 + +aa;
  const d = new Date(anio, mmN - 1, ddN);
  if (d.getMonth() !== mmN - 1 || d.getDate() !== ddN) return null;   // p. ej. 30-feb
  return `${anio}-${mm}-${dd}`;
}

/** Factor de integración: 1 + (aguinaldo + prima%·vacaciones)/365 (Art. 84 LSS). */
function factorIntegracion(aguinaldoDias: number, primaVacPct: number, fechaIngreso?: string): number {
  const anos = fechaIngreso
    ? Math.max(0, (Date.now() - new Date(`${fechaIngreso}T12:00:00`).getTime()) / (365.25 * 86_400_000))
    : 0;
  return 1 + (aguinaldoDias + (primaVacPct / 100) * diasDeVacaciones(anos)) / 365;
}

/** SDI = salario diario × factor, a dos decimales; null si el diario no es válido. */
function sdiDeSalario(
  salarioDiario: any, fechaIngreso: string | undefined, aguinaldoDias: number, primaVacPct: number
): string | null {
  const s = Number(salarioDiario);
  if (!(s > 0)) return null;
  return (Math.round(s * factorIntegracion(aguinaldoDias, primaVacPct, fechaIngreso) * 100) / 100).toFixed(2);
}

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
/**
 * Un bloque de la ficha, con su rótulo.
 *
 * Existe para que una pantalla de quince campos se lea como cinco preguntas y
 * no como quince renglones. El rótulo es chico y en versalitas a propósito:
 * tiene que ordenar sin competir con los campos, que es lo que se viene a
 * llenar.
 */
function Seccion({ titulo, nota, icono, children }: {
  titulo: string; nota?: string; icono?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-gray-400">{icono}</span>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          {titulo}
        </h3>
        <span className="flex-1 border-t border-gray-200/80" />
      </div>
      {nota && <p className="text-[11px] text-gray-500 -mt-1 mb-2">{nota}</p>}
      {children}
    </section>
  );
}

function Campo({ k, label, tipo = 'text', ancho = '', opciones, f, set, marca, ...rest }: any) {
  return (
    <div className={ancho}>
      <label className={ETIQUETA}>{label}</label>
      {/* Las fechas van por CampoFecha y no por <input type="date">: ese
          control lo dibuja el NAVEGADOR con el formato del sistema, y en una
          máquina en inglés pide mm/dd/aaaa. Aquí siempre es dd/mm/aaaa. */}
      {tipo === 'date' ? (
        <CampoFecha
          value={f[k] ?? ''}
          onChange={(v: string) => set(k, v)}
          className={marca(k) ? 'ring-1 ring-amber-300 rounded-lg' : ''}
        />
      ) : tipo === 'select' ? (
        <select
          className={`${CAMPO} ${marca(k)}`}
          value={f[k] ?? ''}
          onChange={(e) => set(k, e.target.value)}
          {...rest}
        >
          {(opciones || []).map((o: { value: string; label: string }) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <input
          type={tipo}
          className={`${CAMPO} ${marca(k)}`}
          value={f[k] ?? ''}
          onChange={(e) => set(k, e.target.value)}
          {...rest}
        />
      )}
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

const money = (n: any) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const hoyIsoLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * ModifSal — el calendario de modificaciones de salario del trabajador.
 *
 * Cada cambio tiene su fecha efectiva: desde ese día el nuevo salario entra a la
 * nómina (queda en el expediente) y se avisa al IMSS —se encola como movimiento
 * 07 del IDSE, que aparece en Nómina → IMSS · IDSE—. Aquí se registra y se ve el
 * histórico. Sólo con el expediente ya guardado: necesita al trabajador creado.
 */
function ModifSalTab({ empleadoId, esEdicion, fechaIngreso, fi, onAplicado }: {
  empleadoId?: string;
  esEdicion: boolean;
  fechaIngreso?: string;
  fi: { aguinaldo: number; prima: number };
  onAplicado: (salario: string, sdi: string) => void;
}) {
  const [fecha, setFecha] = useState(hoyIsoLocal());
  const [salario, setSalario] = useState('');
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ['modifsal', empleadoId],
    queryFn: () => api.getModificacionesSalario(empleadoId as string),
    enabled: !!empleadoId && esEdicion,
  });
  const lista: any[] = q.data?.data?.modificaciones || [];

  const sdi = salario ? sdiDeSalario(salario, fechaIngreso, fi.aguinaldo, fi.prima) : null;

  if (!esEdicion || !empleadoId) {
    return (
      <p className="text-sm text-gray-500">
        Guarda primero el expediente. Los cambios de salario se registran sobre un trabajador ya dado de alta.
      </p>
    );
  }

  const guardar = async () => {
    if (!(Number(salario) > 0)) { setErr('Escribe el nuevo salario diario.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      await api.agregarModificacionSalario(empleadoId, {
        fecha, salarioDiario: Number(salario),
        sdi: sdi ? Number(sdi) : null, motivo,
      });
      setMsg('Cambio registrado. Se avisará al IMSS: quedó pendiente como movimiento 07 en IMSS · IDSE.');
      if (sdi) onAplicado(String(Number(salario)), sdi);
      setSalario(''); setMotivo('');
      q.refetch();
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'No se pudo registrar el cambio.');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* Nuevo cambio */}
      <div className="bg-white rounded-lg border p-3 space-y-2">
        <p className="text-sm font-semibold text-gray-800">Registrar un cambio de salario</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block text-xs text-gray-600">
            Fecha efectiva
            <CampoFecha value={fecha} onChange={setFecha} className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" />
          </label>
          <label className="block text-xs text-gray-600">
            Nuevo salario diario
            <input type="number" step="0.01" min="0" value={salario}
              onChange={(e) => setSalario(e.target.value)}
              className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" />
          </label>
          <label className="block text-xs text-gray-600">
            Nuevo SDI (se calcula solo)
            <input value={sdi ? money(sdi) : ''} readOnly
              className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5 bg-gray-50 text-gray-600" />
          </label>
        </div>
        <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="Motivo (opcional) — aumento, ajuste, promoción…"
          value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        {err && <p className="text-xs text-rose-600">{err}</p>}
        {msg && <p className="text-xs text-emerald-700">{msg}</p>}
        <div className="flex justify-end">
          <button onClick={guardar} disabled={busy}
            className="bg-rose-600 text-white px-4 py-2 rounded-lg hover:bg-rose-700 text-sm disabled:opacity-50">
            {busy ? 'Guardando…' : 'Registrar cambio'}
          </button>
        </div>
      </div>

      {/* Histórico */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <p className="text-sm font-semibold text-gray-800 px-3 py-2 border-b">Histórico de cambios</p>
        {lista.length === 0 ? (
          <p className="p-4 text-sm text-gray-500 italic text-center">Sin cambios de salario registrados.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Fecha</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Anterior</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Nuevo</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">SDI</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Motivo</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lista.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-1.5">{aTextoMx(m.fecha)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-500">{m.salario_diario_anterior ? money(m.salario_diario_anterior) : '—'}</td>
                  <td className="px-3 py-1.5 text-right font-medium">{money(m.salario_diario)}</td>
                  <td className="px-3 py-1.5 text-right">{m.sdi ? money(m.sdi) : '—'}</td>
                  <td className="px-3 py-1.5 text-gray-600">{m.motivo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function EmpleadoModal({ empleado, inicial, origen, soloDevolver, onClose, onGuardado }: Props) {
  const esEdicion = !!empleado?.id;
  const [bloque, setBloque] = useState<'id' | 'domicilio' | 'laboral' | 'descuentos' | 'modifsal' | 'expediente'>('id');
  const [f, setF] = useState<Record<string, any>>({ ...VACIO, ...(inicial || {}) });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  /* Aguinaldo y prima vacacional de la empresa, para integrar el SDI solo. Si no
   * están capturados, se usa el mínimo legal (Art. 87 y 80 LFT). */
  const [fi, setFi] = useState({ aguinaldo: 15, prima: 25 });
  useEffect(() => {
    api.getNominaParametros()
      .then((r: any) => {
        const p = r?.data || {};
        setFi({
          aguinaldo: Number(p.fi_aguinaldo_dias) > 0 ? Number(p.fi_aguinaldo_dias) : 15,
          prima: Number(p.fi_prima_vac_pct) > 0 ? Number(p.fi_prima_vac_pct) : 25,
        });
      })
      .catch(() => { /* sin parámetros: se queda el mínimo legal */ });
  }, []);

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

  /* Al capturar ciertos campos, otros se llenan solos —lo que el dato ya implica
   * no se vuelve a teclear—:
   *   · RFC → fecha de nacimiento (sólo si está vacía: no pisa lo capturado).
   *   · Salario diario → SDI (diario × factor de integración). Se recalcula
   *     también al cambiar la fecha de ingreso, porque el factor sube con la
   *     antigüedad. El SDI queda editable por si el sueldo es variable. */
  const set = (k: string, v: any) => setF((s) => {
    const next = { ...s, [k]: v };
    if (k === 'rfc') {
      const fn = fechaNacDeRfc(v);
      if (fn && !s.fecha_nacimiento) next.fecha_nacimiento = fn;
    }
    if (k === 'salario_diario') {
      const sdi = sdiDeSalario(v, s.fecha_ingreso, fi.aguinaldo, fi.prima);
      if (sdi != null) next.salario_diario_integrado = sdi;
    }
    if (k === 'fecha_ingreso' && s.salario_diario) {
      const sdi = sdiDeSalario(s.salario_diario, v, fi.aguinaldo, fi.prima);
      if (sdi != null) next.salario_diario_integrado = sdi;
    }
    return next;
  });

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

  /* Control de consistencia del RFC de persona física. NO se corre si el RFC vino
   * de la CIF: ese documento ya es oficial y no se cuestiona. Sólo avisa; nunca
   * corrige ni impide guardar —el RFC oficial lo asigna el SAT—. */
  const revisionRfc = useMemo(() => {
    if (deCif.rfc) return null;
    const r = revisarRfcPersonaFisica({
      rfc: f.rfc, nombre: f.nombre,
      apellidoPat: f.apellido_pat, apellidoMat: f.apellido_mat,
      fechaNacimiento: f.fecha_nacimiento,
    });
    return r.aplica && !r.ok ? r : null;
  }, [f.rfc, f.nombre, f.apellido_pat, f.apellido_mat, f.fecha_nacimiento, deCif.rfc]);

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
    { id: 'modifsal', label: 'ModifSal',
      tono: 'bg-rose-50 border-rose-200', activa: 'border-rose-500 text-rose-700 bg-rose-50' },
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

              {revisionRfc && (
                <div className="mt-3 bg-amber-50 border border-amber-300 text-amber-900 px-3 py-2 rounded-lg text-xs space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle size={14} /> El RFC no cuadra con los datos capturados
                  </p>
                  {revisionRfc.problemas.map((p, i) => <p key={i}>· {p}</p>)}
                  <p className="text-amber-700">
                    Es sólo una alerta, no impide guardar: si el RFC viene de un documento oficial,
                    déjalo. Si no, revisa el nombre, los apellidos, la fecha o el RFC.
                  </p>
                </div>
              )}
              </div>
            </div>
          )}

          {bloque === 'modifsal' && (
            <ModifSalTab
              empleadoId={empleado?.id}
              esEdicion={esEdicion}
              fechaIngreso={f.fecha_ingreso}
              fi={fi}
              onAplicado={(salario, sdi) => { set('salario_diario', salario); set('salario_diario_integrado', sdi); }}
            />
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

          {/* ── Relación laboral ──
              Antes era una rejilla de tres columnas donde casi todo ocupaba
              las tres: quedaba una pila de once combos idénticos, del mismo
              ancho y del mismo color, sin nada que dijera dónde termina un
              asunto y empieza otro. Para encontrar la CLABE había que leerlos
              todos.

              Ahora va en cinco bloques, cada uno con la pregunta que responde.
              El orden es el de una contratación real: qué hace, cómo está
              contratado, cada cuándo se le paga, cuánto gana y dónde se le
              deposita. Los combos de texto largo —contrato y régimen— siguen
              a todo lo ancho porque su contenido lo pide; los cortos van de a
              dos o tres, que es lo que quita la sensación de lista. */}
          {bloque === 'laboral' && (
            <div className="space-y-5">

              <Seccion titulo="Qué hace" icono={<Briefcase size={14} />}>
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
                </div>
              </Seccion>

              <Seccion titulo="Cómo está contratado"
                nota="Los tres van tal cual al CFDI de nómina (Anexo 20)."
                icono={<FileSignature size={14} />}>
                <div className="space-y-3">
                  <Selector {...cc} k="tipo_contrato" label="Tipo de contrato" opciones={c?.tiposContrato} />
                  <Selector {...cc} k="tipo_regimen" label="Tipo de régimen" opciones={c?.tiposRegimen} />
                  <Selector {...cc} k="tipo_jornada" label="Tipo de jornada" opciones={c?.tiposJornada} incluirVacio />
                </div>
              </Seccion>

              <Seccion titulo="Cada cuándo y bajo qué zona" icono={<CalendarClock size={14} />}>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Selector {...cc} k="periodicidad_pago" label="Periodicidad de pago" opciones={c?.periodicidades} />
                  <div>
                    <label className={ETIQUETA}>Tipo de nómina</label>
                    <select className={CAMPO} value={f.tipo_nomina} onChange={(e) => set('tipo_nomina', e.target.value)}>
                      <option value="O">O · Ordinaria</option>
                      <option value="E">E · Extraordinaria</option>
                    </select>
                  </div>
                  <div>
                    <label className={ETIQUETA}>Zona salarial</label>
                    <select className={`${CAMPO} ${marca('zona_geografica')}`} value={f.zona_geografica}
                      onChange={(e) => set('zona_geografica', e.target.value)}>
                      <option value="general">General</option>
                      <option value="frontera_norte">Frontera norte</option>
                    </select>
                    <p className="text-[11px] text-gray-500 mt-1">
                      Cambia el salario mínimo aplicable, y con él la exención de ISR
                      y la cuota obrera.
                    </p>
                  </div>
                  <Campo {...cc} k="entidad_federativa" label="Entidad federativa (c_Estado)" tipo="select"
                    opciones={[{ value: '', label: '— elige —' },
                      ...ESTADOS_MX.map(([c2, n]) => ({ value: c2, label: `${c2} · ${n}` }))]} />
                </div>
              </Seccion>

              {/* Sólo estos dos sueldos. El "salario base de cotización" existía
                  aquí como un tercer campo y no servía más que para confundir:
                  el complemento de nómina trae SalarioBaseCotApor —que es el
                  diario— y SalarioDiarioIntegrado, y con esos dos se calcula
                  todo. La columna sigue en la base para no perder lo que ya se
                  hubiera capturado.

                  "Salario diario" y "SDI" a secas se confunden —y confundirlos
                  mueve la cuota del IMSS de toda la plantilla—, así que cada uno
                  dice qué es y cuál debe ser mayor. */}
              <Seccion titulo="Cuánto gana" icono={<Banknote size={14} />}
                nota="Confundir estos dos mueve la cuota del IMSS de toda la plantilla.">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Campo {...cc} k="salario_diario" label="Salario diario — el del contrato *"
                      tipo="number" step="0.01" />
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Lo que gana al día, sin prestaciones. Es el <b>menor</b> de los dos.
                    </p>
                  </div>
                  <div>
                    <Campo {...cc} k="salario_diario_integrado" label="SDI — base de cotización *"
                      tipo="number" step="0.01" />
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Se llena solo: diario × factor ({fi.aguinaldo}d aguinaldo · {fi.prima}% prima, Art. 84 LSS).
                      Editable si el sueldo es variable.
                    </p>
                  </div>
                  {/* El aviso salta solo si quedaron al revés: el factor de
                      integración nunca baja de 1. */}
                  {Number(f.salario_diario_integrado) > 0 &&
                   Number(f.salario_diario_integrado) < Number(f.salario_diario) && (
                    <p className="sm:col-span-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                      El SDI quedó por debajo del salario diario, y eso es imposible: el
                      factor de integración nunca baja de 1. Lo más probable es que estén
                      invertidos.
                    </p>
                  )}
                </div>
              </Seccion>

              <Seccion titulo="Dónde se le deposita" icono={<Landmark size={14} />}>
                <div className="grid sm:grid-cols-3 gap-3">
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
                        (nomina12:Receptor/@Banco) y la que forma los tres
                        primeros dígitos de la CLABE: si no cuadra con la
                        cuenta, la dispersión rebota. */}
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
                  <Campo {...cc} k="cuenta_clabe" label="CLABE (18 dígitos)" maxLength={18}
                    ancho="sm:col-span-2" />
                </div>
              </Seccion>

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
                    <Campo {...cc} k="infonavit_desde" label="Se retiene desde" tipo="date"
                      ancho="sm:col-span-2" />
                    <p className="sm:col-span-2 text-[11px] text-gray-500">
                      Se guarda la REGLA del descuento tal como viene en la carta del INFONAVIT,
                      no el importe de un periodo. La fecha es la de la carta: antes de ella el
                      crédito existe pero no se retiene. <b>Vacía = desde siempre.</b>
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
                    <Campo {...cc} k="pension_desde" label="Se retiene desde"
                      tipo="date" ancho="sm:col-span-2" />
                    <p className="sm:col-span-2 text-[11px] text-gray-500">
                      Viene de una orden judicial: se captura exactamente como la diga el oficio.
                      La fecha es la de <b>notificación</b> —desde ahí surte efectos para el
                      patrón—, y un oficio de septiembre no alcanza a la quincena de agosto.
                      <b> Vacía = desde siempre.</b>
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
