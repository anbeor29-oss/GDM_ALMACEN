/**
 * importar-xml.service — del recibo timbrado al expediente del trabajador.
 *
 * QUÉ PROBLEMA RESUELVE
 * Quien llega a NEXO con años de nómina hecha en otro lado tiene su plantilla
 * completa en los XML que ya timbró. Recapturar cincuenta expedientes a mano es
 * medio día de trabajo y —lo que importa— la forma más segura de meter un RFC
 * o una CURP mal escritos, que no se descubren hasta que el PAC rechaza el
 * siguiente recibo.
 *
 * ESTE SERVICIO NO DA DE ALTA A NADIE
 * Propone. Devuelve lo que rescató del XML, dice de dónde salió cada dato y qué
 * le falta, y ahí se detiene. El alta ocurre sólo cuando alguien confirma en
 * pantalla, con el expediente que haya decidido — que puede no ser el que se
 * propuso. Fue una condición explícita: preguntar antes de crear al trabajador
 * y con qué datos.
 *
 * SÓLO SE IMPORTA LO QUE ESTA EMPRESA EMITIÓ
 * Se comprueban DOS cosas antes de leer nada: que el RFC del emisor sea el de
 * la empresa activa, y que el REGISTRO PATRONAL del complemento sea el suyo.
 * Lo segundo no sobra: una misma razón social puede tener varios registros ante
 * el IMSS, y el trabajador pertenece a uno solo. Cualquiera de los dos que no
 * cuadre detiene la importación con el motivo escrito, no en silencio.
 *
 * EL NOMBRE NO SE PARTE A OJO
 * El CFDI trae el nombre en una sola cadena ("MARIA DE LOS ANGELES DE LA TORRE
 * GARCIA") y partirlo por espacios es una lotería. Aquí se usa la CURP, que se
 * construye con reglas fijas de RENAPO a partir de los apellidos y el nombre:
 * se prueban todos los cortes posibles y se conserva el que reproduce las
 * cuatro primeras letras de la CURP. Si ninguno las reproduce, el corte se
 * marca como incierto y la pantalla pide confirmarlo en vez de inventarlo.
 */

import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import * as empleados from './empleados.service';
import { partirNombre } from './nombre-mexicano';

/* El reparto del nombre vive aparte (nombre-mexicano.ts): es una función pura
 * y así se puede probar sin levantar la base de datos. */

/* ═══════════════ LA PROPUESTA ═══════════════ */

/** De dónde salió cada dato — la pantalla lo muestra para que se pueda juzgar. */
export type Origen = 'xml' | 'deducido' | 'omision';

export interface PropuestaExpediente {
  /** Si ya está dado de alta, aquí viene; entonces no hay nada que crear. */
  yaExiste: null | { id: string; num_empleado: string; nombre_completo: string };
  /** Los datos rescatados, listos para el formulario. */
  datos: Record<string, any>;
  /** Campo → de dónde viene. */
  origen: Record<string, Origen>;
  /** Lo que el XML no trae y hay que capturar antes de poder timbrarle. */
  faltantes: string[];
  /** Avisos que la pantalla debe enseñar antes de que alguien confirme. */
  avisos: string[];
  /** Contexto del recibo, para que se vea de qué XML se está hablando. */
  recibo: {
    uuid?: string;
    fechaPago?: string;
    periodo?: string;
    diasPagados?: number;
    totalPercepciones?: number;
    totalDeducciones?: number;
    neto?: number;
  };
}

/**
 * Arma la propuesta a partir de un XML ya detectado. No escribe nada.
 */
export async function proponerDesdeXml(
  companyId: string,
  det: any
): Promise<PropuestaExpediente> {
  if (det?.type !== 'CFDI_NOMINA' || !det?.nomina) {
    throw new ValidationError('Ese XML no trae complemento de nómina');
  }

  /* ── El emisor tiene que ser esta empresa ──
   *
   * Dos candados, y los dos son necesarios:
   *
   *   1. El RFC del emisor contra el de la empresa activa. Sin esto, cargar el
   *      recibo de otra empresa metería a su trabajador en esta plantilla.
   *   2. El REGISTRO PATRONAL del complemento contra el de la empresa. Una
   *      misma razón social puede tener varios registros ante el IMSS, y el
   *      trabajador pertenece a UNO. Importarlo bajo otro lo pondría a cotizar
   *      donde no está dado de alta.
   *
   * Si la empresa todavía no tiene capturado su registro patronal, no hay
   * contra qué comparar y el importe se detiene: es preferible pedir un dato
   * que ya se necesita para timbrar, que dejar entrar un expediente que después
   * nadie sabría de dónde salió. */
  const emp = await query<any>(
    `SELECT rfc, business_name, registro_patronal FROM companies WHERE id = $1`,
    [companyId]
  );
  const empresa = emp.rows[0];
  const rfcEmisor = String(det.emisor?.rfc || '').toUpperCase();
  if (!empresa) throw new ValidationError('No se encontró la empresa activa');
  if (rfcEmisor !== String(empresa.rfc).toUpperCase()) {
    throw new ValidationError(
      `Ese recibo lo emitió ${det.emisor?.nombre || rfcEmisor} (${rfcEmisor}), no ` +
      `${empresa.business_name} (${empresa.rfc}). El trabajador es de otro patrón y ` +
      'no puede entrar a esta plantilla.'
    );
  }

  const normalizarRp = (v: any) => String(v || '').toUpperCase().replace(/[\s-]/g, '').trim();
  const rpDelRecibo = normalizarRp(det.nomina.registroPatronal);
  const rpDeLaEmpresa = normalizarRp(empresa.registro_patronal);

  if (!rpDeLaEmpresa) {
    throw new ValidationError(
      'Esta empresa todavía no tiene capturado su registro patronal del IMSS, así ' +
      'que no hay contra qué comparar el del recibo' +
      (rpDelRecibo ? ` (el XML trae ${rpDelRecibo})` : '') +
      '. Captúralo en Nómina → Parámetros y vuelve a intentarlo.'
    );
  }
  if (!rpDelRecibo) {
    throw new ValidationError(
      'El recibo no trae registro patronal en el complemento de nómina, así que no ' +
      'se puede comprobar que el trabajador sea de esta empresa. No se importa.'
    );
  }
  if (rpDelRecibo !== rpDeLaEmpresa) {
    throw new ValidationError(
      `El recibo viene del registro patronal ${rpDelRecibo} y esta empresa opera con ` +
      `el ${rpDeLaEmpresa}. Ese trabajador cotiza en otro registro: importarlo aquí lo ` +
      'pondría en una nómina que no le corresponde.'
    );
  }

  const t = det.nomina.trabajador || {};
  const avisos: string[] = [];
  const origen: Record<string, Origen> = {};

  const rfc = String(det.receptor?.rfc || '').toUpperCase().trim();
  const curp = String(t.curp || '').toUpperCase().trim();

  /* ── ¿Ya está dado de alta? ── */
  const existente = await empleados.buscarPorIdentidad(companyId, { rfc, curp });
  if (existente) {
    return {
      yaExiste: {
        id: existente.id,
        num_empleado: existente.num_empleado,
        nombre_completo: existente.nombre_completo,
      },
      datos: {},
      origen: {},
      faltantes: empleados.faltantesParaTimbrar(existente),
      avisos: [
        `${existente.nombre_completo} ya está en la plantilla como empleado ` +
        `${existente.num_empleado}. No hay nada que dar de alta.`,
      ],
      recibo: contextoDelRecibo(det),
    };
  }

  /* ── El nombre ── */
  const partes = partirNombre(det.receptor?.nombre || '', curp);
  if (partes.incierto) {
    avisos.push(
      `El nombre "${det.receptor?.nombre}" viene en una sola línea y no se pudo ` +
      'confirmar contra la CURP dónde terminan los nombres y empiezan los ' +
      'apellidos. Revisa el reparto antes de guardar.'
    );
  }

  const datos: Record<string, any> = {};
  const del = (campo: string, valor: any, de: Origen = 'xml') => {
    if (valor === undefined || valor === null || valor === '') return;
    datos[campo] = valor;
    origen[campo] = de;
  };

  del('nombre', partes.nombre, partes.incierto ? 'deducido' : 'xml');
  del('apellido_pat', partes.apellido_pat, partes.incierto ? 'deducido' : 'xml');
  del('apellido_mat', partes.apellido_mat, partes.incierto ? 'deducido' : 'xml');
  del('rfc', rfc);
  del('curp', curp);
  del('nss', t.numSeguridadSocial ? String(t.numSeguridadSocial).replace(/[\s-]/g, '') : undefined);
  del('num_empleado', t.numEmpleado);
  del('puesto', t.puesto);
  del('departamento', t.departamento);
  del('fecha_ingreso', t.fechaInicioRelLaboral);
  del('tipo_contrato', t.tipoContrato);
  del('tipo_regimen', t.tipoRegimen);
  del('tipo_jornada', t.tipoJornada);
  del('periodicidad_pago', t.periodicidadPago);
  del('entidad_federativa', t.claveEntFed);
  del('banco_clave', t.banco);
  del('cuenta_clabe', t.cuentaBancaria ? String(t.cuentaBancaria).replace(/\s/g, '') : undefined);
  del('salario_diario_integrado', t.salarioDiarioIntegrado);
  del('tipo_nomina', det.nomina.tipoNomina);
  /* El CP fiscal del receptor sí viene en el CFDI 4.0, en el comprobante y no
   * en el complemento. Es justo el dato que el SAT valida al timbrar. */
  del('codigo_postal', det.receptor?.domicilioFiscal);

  /* El SBC (SalarioBaseCotApor) es lo que se le reportó al IMSS. NO es el
   * salario diario del contrato: puede traer ya la integración y viene topado
   * a 25 UMA. Se propone como SBC, no como salario, y se dice por qué. */
  if (t.salarioBaseCotApor !== undefined) {
    del('sbc', t.salarioBaseCotApor);
    avisos.push(
      'El XML trae el salario base de cotización que se le reportó al IMSS, no el ' +
      'salario diario del contrato. El salario diario hay que capturarlo: el SBC ' +
      'viene topado a 25 UMA y en sueldos altos no coincide.'
    );
  }

  del('regimen_fiscal', '605', 'omision');
  del('uso_cfdi', det.receptor?.usoCfdi || 'CN01', det.receptor?.usoCfdi ? 'xml' : 'omision');

  /* La zona salarial NO viene en el CFDI y cambia la exención de ISR e IMSS.
   * Se deja en 'general' y se avisa, en vez de deducirla del estado: hay
   * municipios de frontera y municipios que no lo son en el mismo estado. */
  del('zona_geografica', 'general', 'omision');
  avisos.push(
    'La zona salarial no viene en el XML y se dejó en "general". Si el trabajador ' +
    'está en la franja fronteriza norte hay que cambiarla: mueve el salario mínimo ' +
    'aplicable y con él la exención de ISR y la cuota obrera del IMSS.'
  );

  /* Si el XML trae descuento de INFONAVIT (D004/D005 del c_TipoDeduccion) se
   * dice, pero NO se llena solo: el importe de un recibo es de ESE periodo, y
   * el expediente guarda la regla del descuento, no su resultado. */
  const infonavit = (det.nomina.deducciones || []).filter(
    (d: any) => d.tipo === '004' || d.tipo === '005'
  );
  if (infonavit.length > 0) {
    avisos.push(
      `El recibo trae descuento de INFONAVIT (${infonavit
        .map((d: any) => `${d.concepto} $${Number(d.importe).toFixed(2)}`)
        .join(', ')}). El expediente guarda la REGLA del descuento —porcentaje, ` +
      'cuota fija o VSM— no el importe de un periodo, así que hay que capturarla.'
    );
  }
  const pension = (det.nomina.deducciones || []).filter((d: any) => d.tipo === '007');
  if (pension.length > 0) {
    avisos.push(
      'El recibo trae pensión alimenticia. Viene de una orden judicial: captura el ' +
      'número de oficio, el beneficiario y la forma del descuento tal como los diga ' +
      'el oficio.'
    );
  }

  const faltantes: string[] = [];
  if (!datos.nss) faltantes.push('NSS');
  if (!datos.codigo_postal) faltantes.push('código postal fiscal');
  if (!datos.entidad_federativa) faltantes.push('entidad federativa');
  if (!datos.tipo_jornada) faltantes.push('tipo de jornada');
  faltantes.push('salario diario del contrato');

  if (!datos.num_empleado) {
    datos.num_empleado = await empleados.siguienteNumero(companyId);
    origen.num_empleado = 'deducido';
  }

  return {
    yaExiste: null,
    datos,
    origen,
    faltantes,
    avisos,
    recibo: contextoDelRecibo(det),
  };
}

function contextoDelRecibo(det: any) {
  const n = det.nomina || {};
  return {
    uuid: det.uuid,
    fechaPago: n.fechaPago,
    periodo: n.fechaInicialPago && n.fechaFinalPago
      ? `${n.fechaInicialPago} al ${n.fechaFinalPago}`
      : undefined,
    diasPagados: n.numDiasPagados,
    totalPercepciones: n.totalPercepciones,
    totalDeducciones: n.totalDeducciones,
    neto: det.total,
  };
}
