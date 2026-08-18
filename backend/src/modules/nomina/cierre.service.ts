/**
 * cierre.service — cerrar el periodo y dejar los recibos listos.
 *
 * QUÉ PASA AL CERRAR, EN ORDEN
 *   1. Se calcula la prenómina una última vez, con lo capturado.
 *   2. Se congela un recibo por trabajador, con su desglose completo.
 *   3. Se abonan los préstamos y el FONACOT del periodo.
 *   4. Se genera el XML pre-timbre de cada recibo.
 *   5. El periodo queda CERRADO y ya no se recalcula.
 *
 * TODO EN UNA TRANSACCIÓN
 * Un cierre a medias es el peor estado posible: recibos generados sin abonar los
 * préstamos —y el trabajador pagando dos veces al siguiente periodo—, o abonos
 * aplicados sin recibos que los expliquen. O pasa completo, o no pasa.
 *
 * EL XML NACE SIN SELLO
 * Es un pre-timbre: la estructura completa del CFDI 4.0 con su complemento de
 * nómina 1.2, lista para que se revise y para que el PAC la selle. Timbrar es
 * un paso aparte porque cuesta timbres y porque deshacerlo exige una
 * cancelación ante el SAT.
 *
 * NO SE CIERRA DOS VECES
 * El índice único (periodo, empleado) lo impide en la base, no sólo en el
 * código: dos recibos del mismo periodo serían dos CFDI por el mismo pago, y el
 * SAT los vería como ingreso duplicado.
 */

import { PoolClient } from 'pg';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, ConflictError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { calcular, CapturaPorTrabajador } from './prenomina.service';
import { CLAVE_SAT } from './calendario';
import * as pacService from '../pac/pac.service';
import { NotFoundError } from '../../middleware/errorHandler';

/** Escapa lo que va dentro de un atributo XML. */
const x = (v: any): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const n2 = (v: any) => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);

/**
 * Arma el CFDI 4.0 + Nómina 1.2 SIN sello ni timbre.
 *
 * Se construye a mano y no con una plantilla: el orden de los atributos y de los
 * nodos importa para el XSD del SAT, y una plantilla invita a moverlos.
 */
export function construirXmlPretimbre(datos: {
  empresa: any;
  periodo: any;
  recibo: any;
  empleado: any;
}): string {
  const { empresa, periodo, recibo, empleado } = datos;

  const percepciones = recibo.percepciones || [];
  const deducciones = recibo.deducciones || [];

  const totalGravado = percepciones.reduce((a: number, p: any) => a + (Number(p.gravado) || 0), 0);
  const totalExento = percepciones.reduce((a: number, p: any) => a + (Number(p.exento) || 0), 0);
  const totalSueldos = percepciones
    .filter((p: any) => !['022', '023', '025'].includes(p.clave))
    .reduce((a: number, p: any) => a + (Number(p.importe) || 0), 0);

  const retencionIsr = deducciones
    .filter((d: any) => d.clave === '002')
    .reduce((a: number, d: any) => a + (Number(d.importe) || 0), 0);
  const otrasDeducciones = deducciones
    .filter((d: any) => d.clave !== '002')
    .reduce((a: number, d: any) => a + (Number(d.importe) || 0), 0);

  const nodosPercepciones = percepciones.map((p: any) =>
    `        <nomina12:Percepcion TipoPercepcion="${x(p.clave)}" Clave="P${x(p.clave)}" ` +
    `Concepto="${x(p.concepto)}" ImporteGravado="${n2(p.gravado)}" ImporteExento="${n2(p.exento)}"/>`
  ).join('\n');

  const nodosDeducciones = deducciones.map((d: any) =>
    `        <nomina12:Deduccion TipoDeduccion="${x(d.clave)}" Clave="D${x(d.clave)}" ` +
    `Concepto="${x(d.concepto)}" Importe="${n2(d.importe)}"/>`
  ).join('\n');

  /* La fecha de pago es la del periodo si está fijada; si no, su último día.
   * El SAT la exige y no admite una fecha futura sin motivo. */
  const fechaPago = periodo.fecha_pago || periodo.fecha_fin;

  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
                  xmlns:nomina12="http://www.sat.gob.mx/nomina12"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd http://www.sat.gob.mx/nomina12 http://www.sat.gob.mx/sitio_internet/cfd/nomina/nomina12.xsd"
                  Version="4.0"
                  TipoDeComprobante="N"
                  Fecha="${x(new Date().toISOString().slice(0, 19))}"
                  Moneda="MXN"
                  SubTotal="${n2(recibo.total_percepciones)}"
                  Descuento="${n2(recibo.total_deducciones)}"
                  Total="${n2(recibo.neto)}"
                  Exportacion="01"
                  LugarExpedicion="${x(empresa.postal_code || '')}"
                  MetodoPago="PUE"
                  FormaPago="99">
  <cfdi:Emisor Rfc="${x(empresa.rfc)}" Nombre="${x(empresa.business_name)}" RegimenFiscal="${x(empresa.fiscal_regime || '601')}"/>
  <cfdi:Receptor Rfc="${x(recibo.rfc)}" Nombre="${x(recibo.nombre)}" ` +
    `DomicilioFiscalReceptor="${x(empleado.codigo_postal || '')}" ` +
    `RegimenFiscalReceptor="${x(empleado.regimen_fiscal || '605')}" UsoCFDI="CN01"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111505" Cantidad="1" ClaveUnidad="ACT" ` +
    `Descripcion="Pago de nómina" ValorUnitario="${n2(recibo.total_percepciones)}" ` +
    `Importe="${n2(recibo.total_percepciones)}" Descuento="${n2(recibo.total_deducciones)}" ObjetoImp="01"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <nomina12:Nomina Version="1.2" TipoNomina="O"
                     FechaPago="${x(fechaPago)}"
                     FechaInicialPago="${x(periodo.fecha_inicio)}"
                     FechaFinalPago="${x(periodo.fecha_fin)}"
                     NumDiasPagados="${recibo.dias}"
                     TotalPercepciones="${n2(totalSueldos)}"
                     TotalDeducciones="${n2(recibo.total_deducciones)}">
      <nomina12:Emisor RegistroPatronal="${x(empresa.registro_patronal || '')}"/>
      <nomina12:Receptor Curp="${x(recibo.curp || '')}"
                         NumSeguridadSocial="${x(recibo.nss || '')}"
                         FechaInicioRelLaboral="${x(empleado.fecha_ingreso || '')}"
                         TipoContrato="${x(empleado.tipo_contrato || '01')}"
                         TipoRegimen="${x(empleado.tipo_regimen || '02')}"
                         NumEmpleado="${x(recibo.num_empleado)}"
                         PeriodicidadPago="${x(CLAVE_SAT[periodo.tipo as keyof typeof CLAVE_SAT] || '99')}"
                         SalarioBaseCotApor="${n2(empleado.salario_diario_integrado)}"
                         SalarioDiarioIntegrado="${n2(empleado.salario_diario_integrado)}"
                         ClaveEntFed="${x(empleado.entidad_federativa || '')}"${
    empleado.tipo_jornada ? `\n                         TipoJornada="${x(empleado.tipo_jornada)}"` : ''
  }${
    empleado.departamento ? `\n                         Departamento="${x(empleado.departamento)}"` : ''
  }${
    empleado.puesto ? `\n                         Puesto="${x(empleado.puesto)}"` : ''
  }/>
      <nomina12:Percepciones TotalSueldos="${n2(totalSueldos)}" ` +
    `TotalGravado="${n2(totalGravado)}" TotalExento="${n2(totalExento)}">
${nodosPercepciones}
      </nomina12:Percepciones>
      <nomina12:Deducciones TotalOtrasDeducciones="${n2(otrasDeducciones)}" ` +
    `TotalImpuestosRetenidos="${n2(retencionIsr)}">
${nodosDeducciones}
      </nomina12:Deducciones>
    </nomina12:Nomina>
  </cfdi:Complemento>
</cfdi:Comprobante>`;
}

/**
 * Cierra el periodo. Es lo único de la nómina que escribe de verdad.
 */
export async function cerrarPeriodo(
  companyId: string,
  periodoId: string,
  captura: CapturaPorTrabajador[] = [],
  userId?: string
) {
  /* El cálculo va FUERA de la transacción: es lento —cincuenta trabajadores con
   * su motor— y tenerlo dentro mantendría bloqueos abiertos sin necesidad. Lo
   * que se escribe después es rápido. */
  const pre = await calcular(companyId, periodoId, { captura });

  if (pre.renglones.length === 0) {
    throw new ValidationError(
      'No hay ningún trabajador en este periodo. No hay nada que cerrar.'
    );
  }
  if (pre.periodo.estatus === 'CERRADO') {
    throw new ConflictError('Ese periodo ya está cerrado.');
  }

  const emp = await query<any>(
    `SELECT rfc, business_name, fiscal_regime, postal_code, registro_patronal
       FROM companies WHERE id = $1`,
    [companyId]
  );
  const empresa = emp.rows[0];

  /* Los datos del expediente que van en el CFDI y NO están en la prenómina. */
  const detalles = await query<any>(
    `SELECT id, curp, nss, codigo_postal, regimen_fiscal, tipo_contrato, tipo_regimen,
            tipo_jornada, entidad_federativa, departamento, puesto, email,
            salario_diario_integrado, rfc,
            TO_CHAR(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso
       FROM nomina_empleados
      WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, pre.renglones.map((r) => r.empleado_id)]
  );
  const porId = new Map(detalles.rows.map((e: any) => [e.id, e]));

  return transaction(async (client: PoolClient) => {
    let recibos = 0;
    let abonados = 0;

    for (const r of pre.renglones) {
      const e = porId.get(r.empleado_id);
      if (!e) continue;

      const fila = {
        num_empleado: r.num_empleado,
        nombre: r.nombre,
        rfc: e.rfc,
        curp: e.curp,
        nss: e.nss,
        dias: r.dias,
        total_percepciones: r.totalPercepciones,
        total_deducciones: r.totalDeducciones,
        neto: r.neto,
        percepciones: r.percepciones,
        deducciones: r.deducciones,
      };

      const xml = construirXmlPretimbre({
        empresa, periodo: pre.periodo, recibo: fila, empleado: e,
      });

      const ins = await transactionQuery<{ id: string }>(
        client,
        `INSERT INTO nomina_recibos
           (company_id, periodo_id, empleado_id, num_empleado, nombre, rfc, curp, nss,
            dias, total_percepciones, total_deducciones, total_otros_pagos,
            total_gravado, total_exento, isr, imss, neto,
            percepciones, deducciones, xml_pretimbre, correo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 $18::jsonb,$19::jsonb,$20,$21)
         ON CONFLICT (periodo_id, empleado_id) DO NOTHING
         RETURNING id`,
        [
          companyId, periodoId, r.empleado_id, r.num_empleado, r.nombre,
          e.rfc, e.curp, e.nss, r.dias,
          r.totalPercepciones, r.totalDeducciones, r.subsidio,
          r.gravado, r.exento, r.isr, r.imss, r.neto,
          JSON.stringify(r.percepciones), JSON.stringify(r.deducciones),
          xml, e.email || null,
        ]
      );
      if (ins.rows.length > 0) recibos++;
    }

    /* ── Los abonos de préstamos y FONACOT ──
     *
     * Es el paso que NO puede quedar fuera de la transacción: si los recibos se
     * guardan y los abonos no, al trabajador se le descuenta otra vez el
     * siguiente periodo y el saldo nunca baja. */
    const creditos = await transactionQuery<any>(
      client,
      `SELECT c.id, c.empleado_id, c.saldo, c.descuento_por_periodo
         FROM nomina_creditos c
        WHERE c.company_id = $1 AND c.estatus = 'ACTIVO' AND c.saldo > 0
          AND c.empleado_id = ANY($2::uuid[])
        FOR UPDATE`,
      [companyId, pre.renglones.map((r) => r.empleado_id)]
    );

    for (const c of creditos.rows) {
      const importe = Math.min(Number(c.descuento_por_periodo), Number(c.saldo));
      if (importe <= 0) continue;
      const nuevoSaldo = Math.round((Number(c.saldo) - importe) * 100) / 100;

      const ab = await transactionQuery(
        client,
        `INSERT INTO nomina_credito_abonos
           (credito_id, periodo_id, fecha, importe, saldo_despues, notas)
         VALUES ($1,$2,$3::date,$4,$5,$6)
         ON CONFLICT (credito_id, periodo_id) WHERE periodo_id IS NOT NULL
         DO NOTHING`,
        [c.id, periodoId, pre.periodo.fecha_fin, importe, nuevoSaldo,
         `Aplicado al cerrar ${pre.periodo.tipo} #${pre.periodo.numero}`]
      );
      /* Si el abono ya existía —un cierre anterior que se reintentó— el saldo
       * no se vuelve a bajar. */
      if (ab.rowCount > 0) {
        await transactionQuery(
          client,
          `UPDATE nomina_creditos
              SET saldo = $2::numeric,
                  estatus = CASE WHEN $2::numeric <= 0 THEN 'LIQUIDADO' ELSE estatus END,
                  updated_at = NOW()
            WHERE id = $1`,
          [c.id, nuevoSaldo]
        );
        abonados++;
      }
    }

    await transactionQuery(
      client,
      `UPDATE nomina_periodos
          SET estatus = 'CERRADO', cerrado_at = NOW(), cerrado_por = $3
        WHERE id = $1 AND company_id = $2`,
      [periodoId, companyId, userId || null]
    );

    /* El borrador ya no sirve: los importes quedaron congelados en los recibos.
     * Dejarlo invitaría a editarlo y a preguntarse por qué no cambia nada. */
    await transactionQuery(
      client,
      `DELETE FROM nomina_captura WHERE company_id = $1 AND periodo_id = $2`,
      [companyId, periodoId]
    );

    logger.info(
      `[nómina] periodo ${pre.periodo.tipo} #${pre.periodo.numero} cerrado: ` +
      `${recibos} recibos, ${abonados} abonos de crédito`
    );

    return {
      recibos,
      abonados,
      periodo: `${pre.periodo.tipo} #${pre.periodo.numero}`,
      neto: pre.totales.neto,
      sinPoderTimbrar: pre.totales.sinPoderTimbrar,
    };
  });
}

/* ═══════════════════ LOS RECIBOS YA GENERADOS ═══════════════════ */

/**
 * Los CFDI de nómina de la empresa, para la pantalla de revisión.
 *
 * Se listan SIN el XML: son varios KB por recibo y la lista no los usa —
 * traerlos haría que abrir la pantalla con cien recibos moviera un megabyte
 * para enseñar nombres e importes.
 */
export async function listarRecibos(
  companyId: string,
  f: { estatus?: string; periodoId?: string } = {}
) {
  const cond = ['r.company_id = $1'];
  const args: any[] = [companyId];
  if (f.estatus)   { args.push(f.estatus);   cond.push(`r.estatus = $${args.length}`); }
  if (f.periodoId) { args.push(f.periodoId); cond.push(`r.periodo_id = $${args.length}`); }

  const r = await query<any>(
    `SELECT r.id, r.num_empleado, r.nombre, r.rfc, r.dias,
            r.total_percepciones, r.total_deducciones, r.total_gravado, r.total_exento,
            r.isr, r.imss, r.neto, r.estatus, r.uuid, r.timbrado_at,
            r.enviar_por_correo, r.enviado_at, r.correo, r.created_at,
            p.tipo, p.numero AS periodo_numero, p.anio, p.concepto,
            TO_CHAR(p.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
            TO_CHAR(p.fecha_fin, 'YYYY-MM-DD')    AS fecha_fin
       FROM nomina_recibos r
       JOIN nomina_periodos p ON p.id = r.periodo_id
      WHERE ${cond.join(' AND ')}
      ORDER BY p.anio DESC, p.numero DESC, r.num_empleado`,
    args
  );
  return r.rows;
}

/** El XML de un recibo, para verlo o bajarlo. */
export async function xmlDelRecibo(companyId: string, id: string) {
  const r = await query<any>(
    `SELECT num_empleado, nombre, estatus, xml_pretimbre, xml_timbrado
       FROM nomina_recibos WHERE id = $1 AND company_id = $2`,
    [id, companyId]
  );
  if (r.rows.length === 0) throw new ValidationError('Ese recibo no existe en esta empresa');
  const x = r.rows[0];
  /* El timbrado manda sobre el pre-timbre: una vez sellado, el bueno es ése. */
  return { ...x, xml: x.xml_timbrado || x.xml_pretimbre };
}

/**
 * Marca o desmarca el envío por correo de varios recibos.
 *
 * Es una DECISIÓN, no un envío: se marca antes de timbrar y el envío ocurre
 * después. Separarlos permite revisar a quién se le va a mandar sin arriesgar
 * que salga un correo con un recibo que todavía no está bien.
 */
export async function marcarEnvioPorCorreo(
  companyId: string, ids: string[], enviar: boolean
) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError('No se indicó ningún recibo');
  }
  const r = await query(
    `UPDATE nomina_recibos SET enviar_por_correo = $3
      WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, ids, !!enviar]
  );

  /* A quién no se le puede mandar: sin correo en el expediente, marcarlo no
   * sirve de nada y hay que decirlo en vez de dejarlo marcado sin efecto. */
  const sinCorreo = await query<any>(
    `SELECT num_empleado, nombre FROM nomina_recibos
      WHERE company_id = $1 AND id = ANY($2::uuid[])
        AND enviar_por_correo AND (correo IS NULL OR correo = '')`,
    [companyId, ids]
  );

  return { marcados: r.rowCount, sinCorreo: sinCorreo.rows };
}

/**
 * Timbra un recibo de nómina ante el PAC.
 *
 * POR QUÉ ES UN PASO APARTE Y NO PARTE DEL CIERRE
 * Timbrar gasta un timbre y deshacerlo exige una cancelación ante el SAT. El
 * cierre congela los importes y arma el XML —dos cosas reversibles— y aquí se
 * da el paso que no lo es. Separarlos permite revisar cincuenta recibos y
 * timbrar cuarenta y nueve.
 *
 * NO SE TIMBRA DOS VECES
 * Un recibo con UUID ya está en el SAT. Volver a mandarlo generaría un segundo
 * CFDI por el mismo pago, que para el SAT es ingreso duplicado del trabajador y
 * sólo se arregla cancelando. El candado está aquí y no sólo en la pantalla:
 * un doble clic no puede costar una cancelación.
 */
export async function timbrarRecibo(companyId: string, reciboId: string) {
  const r = await query<any>(
    `SELECT id, num_empleado, nombre, estatus, uuid, xml_pretimbre
       FROM nomina_recibos WHERE id = $1 AND company_id = $2`,
    [reciboId, companyId]
  );
  const recibo = r.rows[0];
  if (!recibo) throw new NotFoundError('No encontré ese recibo');

  if (recibo.uuid) {
    throw new ConflictError(
      `El recibo de ${recibo.nombre} ya está timbrado (UUID ${recibo.uuid}). ` +
      'Para rehacerlo hay que cancelarlo ante el SAT primero.'
    );
  }
  if (!recibo.xml_pretimbre) {
    throw new ValidationError('Ese recibo no tiene XML: vuelve a cerrar el periodo.');
  }

  const timbre = await pacService.timbrarXml(companyId, recibo.xml_pretimbre);
  if (!timbre.success || !timbre.uuid) {
    throw new ValidationError(
      `El PAC no timbró el recibo de ${recibo.nombre}` +
      (timbre.errors?.length ? `: ${timbre.errors.join('; ')}` : '.')
    );
  }

  await query(
    `UPDATE nomina_recibos
        SET estatus      = 'TIMBRADO',
            uuid         = $2,
            xml_timbrado = $3,
            timbrado_at  = NOW()
      WHERE id = $1 AND company_id = $4`,
    [reciboId, timbre.uuid, timbre.xml_stamped || recibo.xml_pretimbre, companyId]
  );

  logger.info(`[nómina] recibo de ${recibo.nombre} timbrado — UUID ${timbre.uuid}`);
  return { id: reciboId, uuid: timbre.uuid, nombre: recibo.nombre };
}

/**
 * Timbra varios. Sigue aunque alguno falle.
 *
 * Con cincuenta recibos, que el número doce truene no puede dejar sin timbrar a
 * los treinta y ocho de atrás: cada uno va por su cuenta y al final se dice
 * cuáles pasaron y cuáles no, con su motivo. Lo contrario obligaría a adivinar
 * dónde se quedó y a arriesgar timbrar dos veces los primeros.
 */
export async function timbrarVarios(companyId: string, ids: string[]) {
  const hechos: any[] = [];
  const fallidos: any[] = [];

  for (const id of ids || []) {
    try {
      hechos.push(await timbrarRecibo(companyId, id));
    } catch (e: any) {
      const r = await query<any>(
        `SELECT nombre FROM nomina_recibos WHERE id = $1 AND company_id = $2`,
        [id, companyId]
      );
      fallidos.push({
        id,
        nombre: r.rows[0]?.nombre || id,
        motivo: e?.message || 'Error al timbrar',
      });
    }
  }
  return { timbrados: hechos.length, fallaron: fallidos.length, hechos, fallidos };
}
