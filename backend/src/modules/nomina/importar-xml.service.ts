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
 * El RFC del emisor tiene que ser el de la empresa activa: sin eso, cargar el
 * recibo de otra empresa metería a su trabajador en esta plantilla.
 *
 * El REGISTRO PATRONAL se compara además, porque una misma razón social puede
 * tener varios registros ante el IMSS y el trabajador pertenece a uno solo.
 * Pero sólo DETIENE cuando hay dos y son distintos: si la empresa todavía no lo
 * tiene capturado no hay contra qué comparar, y bloquear ahí dejaba sin importar
 * nada a quien apenas empieza. En ese caso se avisa y se ofrece el del recibo.
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
  /** El registro patronal del recibo, cuando la empresa todavía no tiene uno. */
  registroPatronalSugerido?: string;
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

  /* SÓLO SE DETIENE CUANDO DE VERDAD NO COINCIDEN.
   *
   * La primera versión también bloqueaba cuando la empresa todavía no tenía
   * capturado su registro patronal, y eso resultó peor que el problema que
   * evitaba: una empresa que apenas empieza no lo tiene, así que TODAS sus
   * importaciones fallaban con un mensaje que además no se alcanzaba a ver
   * desde el lote. El resultado práctico era que el lector "reconocía" a los
   * trabajadores y no daba de alta a ninguno.
   *
   * No tener con qué comparar no es lo mismo que no coincidir. Cuando falta, se
   * avisa fuerte y se ofrece el del recibo para capturarlo; cuando hay dos y son
   * distintos, ahí sí no pasa. */
  if (rpDeLaEmpresa && rpDelRecibo && rpDelRecibo !== rpDeLaEmpresa) {
    throw new ValidationError(
      `El recibo viene del registro patronal ${rpDelRecibo} y esta empresa opera con ` +
      `el ${rpDeLaEmpresa}. Ese trabajador cotiza en otro registro: importarlo aquí lo ` +
      'pondría en una nómina que no le corresponde.'
    );
  }

  const t = det.nomina.trabajador || {};
  const avisos: string[] = [];

  if (!rpDeLaEmpresa) {
    avisos.push(
      'Esta empresa todavía no tiene capturado su registro patronal del IMSS' +
      (rpDelRecibo ? `; el recibo trae el ${rpDelRecibo}` : '') +
      '. Sin él no se puede timbrar nómina y no hay contra qué comparar los ' +
      'recibos que se importen. Captúralo en Nómina → Parámetros.'
    );
  } else if (!rpDelRecibo) {
    avisos.push(
      'El recibo no trae registro patronal en el complemento, así que no se pudo ' +
      `comprobar contra el de la empresa (${rpDeLaEmpresa}). Revisa que el trabajador ` +
      'sea de esta nómina antes de darlo de alta.'
    );
  }

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
  del('tipo_nomina', det.nomina.tipoNomina);
  /* El CP fiscal del receptor sí viene en el CFDI 4.0, en el comprobante y no
   * en el complemento. Es justo el dato que el SAT valida al timbrar. */
  del('codigo_postal', det.receptor?.domicilioFiscal);

  /* ── LOS DOS SUELDOS ─────────────────────────────────────────────────────
   *
   * El complemento trae dos y sólo estos dos importan para el expediente:
   *
   *   SalarioBaseCotApor     → salario diario
   *   SalarioDiarioIntegrado → salario diario integrado
   *
   * Antes el primero se guardaba en un campo `sbc` aparte y el salario diario
   * quedaba vacío, así que TODOS los expedientes importados nacían señalados
   * como incompletos por un dato que el recibo sí traía. Se hablaba además de
   * un tercer concepto —el SBC— que sólo servía para confundir la pantalla.
   *
   * Cuando el recibo trae uno solo, sirve para los dos campos: es lo que el
   * patrón reportó y es con lo que se le viene calculando. Se marca `deducido`
   * el que se copió, para que se vea que no venía por separado. */
  const sd = t.salarioBaseCotApor;
  const sdi = t.salarioDiarioIntegrado;
  if (sd !== undefined && sd !== null) del('salario_diario', sd);
  else if (sdi !== undefined && sdi !== null) del('salario_diario', sdi, 'deducido');

  if (sdi !== undefined && sdi !== null) del('salario_diario_integrado', sdi);
  else if (sd !== undefined && sd !== null) del('salario_diario_integrado', sd, 'deducido');

  del('regimen_fiscal', '605', 'omision');
  del('uso_cfdi', det.receptor?.usoCfdi || 'CN01', det.receptor?.usoCfdi ? 'xml' : 'omision');

  /* ZONA SALARIAL: SIEMPRE GENERAL (centro del país).
   *
   * No viene en el CFDI y no se puede deducir del estado —hay municipios de
   * frontera y municipios que no lo son dentro del mismo estado—. La empresa
   * confirmó que toda su plantilla es de zona general, así que se fija y se
   * deja de preguntar. Si algún día contrata en la franja fronteriza norte, se
   * cambia en el expediente: mueve el salario mínimo aplicable y con él la
   * exención de ISR y la cuota obrera del IMSS. */
  del('zona_geografica', 'general', 'omision');

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

  /* Lo que de verdad falta, no lo que "convendría revisar".
   *
   * El salario diario estaba aquí SIEMPRE, aunque el recibo lo trajera: con eso
   * todos los expedientes importados nacían marcados como incompletos y la
   * señal dejaba de significar nada. Ahora sólo se lista lo que en efecto no
   * llegó. */
  const faltantes: string[] = [];
  if (!datos.nss) faltantes.push('NSS');
  if (!datos.codigo_postal) faltantes.push('código postal fiscal');
  if (!datos.entidad_federativa) faltantes.push('entidad federativa');
  if (!datos.tipo_jornada) faltantes.push('tipo de jornada');
  if (!datos.salario_diario) faltantes.push('salario diario');
  if (!datos.salario_diario_integrado) faltantes.push('salario diario integrado');

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
    registroPatronalSugerido:
      rpDelRecibo && !rpDeLaEmpresa ? rpDelRecibo : undefined,
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
