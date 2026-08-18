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
import { X, Save, AlertTriangle } from 'lucide-react';
import api from '@/services/api';
import { ComboConAlta } from './ComboConAlta';
import { CreditosDelTrabajador } from './CreditosDelTrabajador';

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
  rfc: '', curp: '', nss: '', fecha_nacimiento: '', email: '', telefono: '',
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

export function EmpleadoModal({ empleado, inicial, origen, soloDevolver, onClose, onGuardado }: Props) {
  const esEdicion = !!empleado?.id;
  const [bloque, setBloque] = useState<'id' | 'domicilio' | 'laboral' | 'descuentos'>('id');
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

  const campo = 'w-full border rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary';
  const etiqueta = 'block text-xs font-medium text-gray-600 mb-1';

  /* Marca visual de los campos que el importador DEDUJO: son los que hay que
   * mirar dos veces antes de guardar. */
  const marca = (k: string) =>
    origen?.[k] === 'deducido' ? 'ring-1 ring-amber-300 bg-amber-50/40' : '';

  const Campo = ({ k, label, tipo = 'text', ancho = '', ...rest }: any) => (
    <div className={ancho}>
      <label className={etiqueta}>{label}</label>
      <input
        type={tipo}
        className={`${campo} ${marca(k)}`}
        value={f[k] ?? ''}
        onChange={(e) => set(k, e.target.value)}
        {...rest}
      />
    </div>
  );

  const Selector = ({ k, label, opciones, incluirVacio, ancho = '' }: any) => (
    <div className={ancho}>
      <label className={etiqueta}>{label}</label>
      <select className={`${campo} ${marca(k)}`} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)}>
        {incluirVacio && <option value="">— sin especificar —</option>}
        {Object.entries(opciones || {}).map(([clave, texto]) => (
          <option key={clave} value={clave}>{clave} · {String(texto)}</option>
        ))}
      </select>
    </div>
  );

  const BLOQUES = [
    { id: 'id', label: 'Identificación' },
    { id: 'domicilio', label: 'Domicilio fiscal' },
    { id: 'laboral', label: 'Relación laboral' },
    { id: 'descuentos', label: 'Descuentos' },
  ] as const;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full my-8">
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
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                bloque === b.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          {bloque === 'id' && (
            <div className="grid sm:grid-cols-3 gap-3">
              <Campo k="num_empleado" label="Número de empleado *" />
              <Campo k="nombre" label="Nombre(s) *" ancho="sm:col-span-2" />
              <Campo k="apellido_pat" label="Apellido paterno *" />
              <Campo k="apellido_mat" label="Apellido materno" />
              <div />
              <Campo k="rfc" label="RFC *" maxLength={13} style={{ textTransform: 'uppercase' }} />
              <Campo k="curp" label="CURP *" maxLength={18} ancho="sm:col-span-2" style={{ textTransform: 'uppercase' }} />
              <Campo k="nss" label="NSS (11 dígitos)" maxLength={13} />
              <Campo k="fecha_nacimiento" label="Fecha de nacimiento" tipo="date" />
              <div />
              <Campo k="email" label="Correo" tipo="email" ancho="sm:col-span-2" />
              <Campo k="telefono" label="Teléfono" />
            </div>
          )}

          {bloque === 'domicilio' && (
            <>
              <p className="text-xs text-gray-500">
                El código postal tiene que ser el que el SAT tiene registrado para ese RFC:
                si no coincide, el timbrado se rechaza con el error CFDI40147.
              </p>
              <div className="grid sm:grid-cols-3 gap-3">
                <Campo k="codigo_postal" label="Código postal" maxLength={5} />
                <Campo k="calle" label="Calle" ancho="sm:col-span-2" />
                <Campo k="num_exterior" label="Número exterior" />
                <Campo k="num_interior" label="Número interior" />
                <Campo k="colonia" label="Colonia" />
                <Campo k="municipio" label="Municipio / alcaldía" ancho="sm:col-span-2" />
                <Campo k="estado" label="Estado" />
                <Campo k="regimen_fiscal" label="Régimen fiscal" maxLength={3} />
                <Campo k="uso_cfdi" label="Uso del CFDI" maxLength={5} />
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
              <Campo k="fecha_ingreso" label="Fecha de ingreso *" tipo="date" />
              <Selector k="tipo_contrato" label="Tipo de contrato" opciones={c?.tiposContrato} ancho="sm:col-span-3" />
              <Selector k="tipo_regimen" label="Tipo de régimen" opciones={c?.tiposRegimen} ancho="sm:col-span-3" />
              <Selector k="tipo_jornada" label="Tipo de jornada" opciones={c?.tiposJornada} incluirVacio ancho="sm:col-span-3" />
              <Selector k="periodicidad_pago" label="Periodicidad de pago" opciones={c?.periodicidades} ancho="sm:col-span-2" />
              <div>
                <label className={etiqueta}>Tipo de nómina</label>
                <select className={campo} value={f.tipo_nomina} onChange={(e) => set('tipo_nomina', e.target.value)}>
                  <option value="O">O · Ordinaria</option>
                  <option value="E">E · Extraordinaria</option>
                </select>
              </div>
              <Campo k="entidad_federativa" label="Entidad federativa (c_Estado)" maxLength={3} />
              <div className="sm:col-span-2">
                <label className={etiqueta}>Zona salarial</label>
                <select className={`${campo} ${marca('zona_geografica')}`} value={f.zona_geografica} onChange={(e) => set('zona_geografica', e.target.value)}>
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
              <Campo k="salario_diario" label="Salario diario *" tipo="number" step="0.01" />
              <Campo k="salario_diario_integrado" label="Salario diario integrado *" tipo="number" step="0.01" />
              <div>
                <label className={etiqueta}>Banco</label>
                <select
                  className={`${campo} ${marca('banco_clave')}`}
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
              <Campo k="cuenta_clabe" label="CLABE (18 dígitos)" maxLength={18} ancho="sm:col-span-2" />
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
                    <Campo k="infonavit_num_credito" label="Número de crédito" />
                    <div>
                      <label className={etiqueta}>Forma del descuento</label>
                      <select className={campo} value={f.infonavit_tipo_descuento} onChange={(e) => set('infonavit_tipo_descuento', e.target.value)}>
                        <option value="">— elegir —</option>
                        <option value="porcentaje">Porcentaje sobre el SDI</option>
                        <option value="cuota_fija">Cuota fija mensual</option>
                        <option value="vsm">Veces salario mínimo</option>
                      </select>
                    </div>
                    <Campo k="infonavit_descuento" label="Valor del descuento" tipo="number" step="0.0001" />
                    <Campo k="infonavit_seguro_danos" label="Seguro de daños (diario)" tipo="number" step="0.01" />
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
                      <label className={etiqueta}>Forma del descuento</label>
                      <select className={campo} value={f.pension_tipo} onChange={(e) => set('pension_tipo', e.target.value)}>
                        <option value="">— elegir —</option>
                        <option value="porcentaje">Porcentaje de percepciones</option>
                        <option value="cuota_fija">Cuota fija mensual</option>
                      </select>
                    </div>
                    <Campo k="pension_monto" label="Valor" tipo="number" step="0.0001" />
                    <Campo k="pension_beneficiario" label="Beneficiario" />
                    <Campo k="pension_num_oficio" label="Número de oficio judicial" />
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
