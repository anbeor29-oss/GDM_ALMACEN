/**
 * periodos.service — el calendario de la nómina.
 *
 * LAS TRES PERIODICIDADES CONVIVEN
 * Una misma empresa paga semanal a la planta, quincenal a la oficina y mensual
 * a la dirección. Por eso el calendario se genera POR TIPO y los tres viven a
 * la vez: la clave única es (empresa, año, tipo, número).
 *
 * DE DÓNDE SALEN LAS FECHAS
 *   · Semanal   — de una fecha de arranque que da la empresa. No se puede
 *                 deducir: cada quien cierra su semana el día que decidió, y
 *                 suponer el lunes movería el corte de toda la plantilla.
 *                 Van del 1 al 53, porque hay años con 53 semanas y truncar en
 *                 52 dejaría una semana sin poder pagarse.
 *   · Quincenal — del calendario: del 1 al 15 y del 16 al fin de mes. 24 al año.
 *   · Mensual   — del calendario. 12 al año.
 *
 * LOS DÍAS SON LOS DEL CALENDARIO
 * La segunda quincena de febrero tiene 13 o 14 días, no 15. Se guarda lo que
 * realmente dura el periodo, que es lo que el IMSS cuenta; si la empresa paga
 * 15 fijos, eso se ajusta por trabajador en la prenómina, que es donde se ve
 * el efecto en el recibo.
 *
 * NO SE BORRA UN PERIODO CERRADO
 * Regenerar el calendario respeta lo ya cerrado: un periodo pagado y timbrado
 * no puede desaparecer porque alguien recalculó las fechas.
 */

import { PoolClient } from 'pg';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';
import {
  TipoPeriodo, MAXIMO_POR_TIPO, CLAVE_SAT, calendario, aFecha, aTexto,
} from './calendario';

export { TipoPeriodo, MAXIMO_POR_TIPO, CLAVE_SAT, calendario };

/**
 * Escribe el calendario del año.
 *
 * Los periodos CERRADOS se dejan intactos y se reportan como respetados: un
 * periodo ya pagado y timbrado no cambia de fechas porque alguien regeneró el
 * calendario.
 */
export async function generar(
  companyId: string,
  tipo: TipoPeriodo,
  anio: number,
  fechaArranque?: string
) {
  if (!MAXIMO_POR_TIPO[tipo]) throw new ValidationError('El tipo de periodo no es válido');
  const filas = calendario(tipo, anio, fechaArranque);

  return transaction(async (client: PoolClient) => {
    const cerrados = await transactionQuery<{ numero: number }>(
      client,
      `SELECT numero FROM nomina_periodos
        WHERE company_id = $1 AND anio = $2 AND tipo = $3 AND estatus = 'CERRADO'`,
      [companyId, anio, tipo]
    );
    const intocables = new Set(cerrados.rows.map((r) => r.numero));

    /* Se borran sólo los que se pueden volver a generar. */
    await transactionQuery(
      client,
      `DELETE FROM nomina_periodos
        WHERE company_id = $1 AND anio = $2 AND tipo = $3 AND estatus <> 'CERRADO'`,
      [companyId, anio, tipo]
    );

    let creados = 0;
    for (const f of filas) {
      if (intocables.has(f.numero)) continue;
      await transactionQuery(
        client,
        `INSERT INTO nomina_periodos
           (company_id, anio, tipo, numero, fecha_inicio, fecha_fin, dias)
         VALUES ($1,$2,$3,$4,$5::date,$6::date,$7)`,
        [companyId, anio, tipo, f.numero, f.fecha_inicio, f.fecha_fin, f.dias]
      );
      creados++;
    }

    return {
      tipo, anio, creados,
      respetados: intocables.size,
      total: filas.length,
    };
  });
}

/**
 * Crea un periodo ESPECIAL: un finiquito, el aguinaldo, la PTU.
 *
 * No se generan por calendario porque cada uno empieza y termina donde diga el
 * caso — un finiquito cubre del 1 al 12, un aguinaldo el año entero. Por eso se
 * capturan de uno en uno, con su concepto: sin él, una lista de "especial 1,
 * especial 2, especial 3" no le dice nada a nadie tres meses después.
 */
export async function crearEspecial(
  companyId: string,
  d: { anio?: number; concepto?: string; fecha_inicio?: string; fecha_fin?: string; fecha_pago?: string }
) {
  const concepto = String(d.concepto || '').trim().slice(0, 200);
  if (!concepto) {
    throw new ValidationError(
      'Un periodo especial necesita su concepto: "Aguinaldo 2026", "Finiquito de Juan Pérez", "PTU 2025".'
    );
  }
  const ini = aTexto(aFecha(String(d.fecha_inicio || '')));
  const fin = aTexto(aFecha(String(d.fecha_fin || '')));
  if (fin < ini) throw new ValidationError('La fecha final no puede ser anterior a la inicial');

  const pago = d.fecha_pago ? aTexto(aFecha(String(d.fecha_pago))) : null;
  const anio = Number(d.anio) || Number(ini.slice(0, 4));

  const dias = Math.round(
    (new Date(`${fin}T00:00:00Z`).getTime() - new Date(`${ini}T00:00:00Z`).getTime()) / 86400000
  ) + 1;

  return transaction(async (client: PoolClient) => {
    /* El número sigue al último especial del año. Se toma dentro de la
     * transacción para que dos capturas simultáneas no se lleven el mismo. */
    /* NO se puede usar `SELECT MAX(...) FOR UPDATE`: Postgres no admite bloqueo
     * de filas junto a una funcion de agregacion —el MAX no corresponde a una
     * fila concreta que bloquear—. Se usa un bloqueo de aviso sobre la pareja
     * (empresa, ano), que serializa exactamente lo que hay que serializar: la
     * asignacion del numero. Se libera solo al terminar la transaccion. */
    await transactionQuery(
      client,
      `SELECT pg_advisory_xact_lock(hashtext($1::text), $2::int)`,
      [`nomina_especial:${companyId}`, anio]
    );
    const ultimo = await transactionQuery<{ n: number }>(
      client,
      `SELECT COALESCE(MAX(numero), 0) AS n FROM nomina_periodos
        WHERE company_id = $1 AND anio = $2 AND tipo = 'ESPECIAL'`,
      [companyId, anio]
    );
    const numero = Number(ultimo.rows[0]?.n || 0) + 1;
    if (numero > MAXIMO_POR_TIPO.ESPECIAL) {
      throw new ValidationError(
        `Ya hay ${MAXIMO_POR_TIPO.ESPECIAL} periodos especiales en ${anio}. Revisa si alguno sobra.`
      );
    }

    const r = await transactionQuery<{ id: string }>(
      client,
      `INSERT INTO nomina_periodos
         (company_id, anio, tipo, numero, fecha_inicio, fecha_fin, fecha_pago, dias, concepto)
       VALUES ($1,$2,'ESPECIAL',$3,$4::date,$5::date,$6::date,$7,$8)
       RETURNING id`,
      [companyId, anio, numero, ini, fin, pago, dias, concepto]
    );
    return obtenerEnTransaccion(client, companyId, r.rows[0].id);
  });
}

async function obtenerEnTransaccion(client: PoolClient, companyId: string, id: string) {
  const r = await transactionQuery<any>(
    client,
    `SELECT ${CAMPOS} FROM nomina_periodos p WHERE p.id = $1 AND p.company_id = $2`,
    [id, companyId]
  );
  return r.rows[0];
}

/* ═══════════════════ CONSULTA ═══════════════════ */

const CAMPOS = `
  p.id, p.anio, p.tipo, p.numero, p.dias, p.estatus,
  TO_CHAR(p.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
  TO_CHAR(p.fecha_fin,    'YYYY-MM-DD') AS fecha_fin,
  TO_CHAR(p.fecha_pago,   'YYYY-MM-DD') AS fecha_pago,
  p.cerrado_at, p.concepto
`;

export async function listar(
  companyId: string,
  f: { anio?: number; tipo?: TipoPeriodo; desde?: number; hasta?: number } = {}
) {
  const cond = ['p.company_id = $1'];
  const args: any[] = [companyId];

  if (f.anio) { args.push(f.anio); cond.push(`p.anio = $${args.length}`); }
  if (f.tipo) { args.push(f.tipo); cond.push(`p.tipo = $${args.length}`); }
  /* El rango de periodos que pide un reporte: "de la 1 a la 53". */
  if (f.desde) { args.push(f.desde); cond.push(`p.numero >= $${args.length}`); }
  if (f.hasta) { args.push(f.hasta); cond.push(`p.numero <= $${args.length}`); }

  const r = await query<any>(
    `SELECT ${CAMPOS} FROM nomina_periodos p
      WHERE ${cond.join(' AND ')}
      ORDER BY p.anio DESC, p.tipo, p.numero`,
    args
  );
  return r.rows;
}

export async function obtener(companyId: string, id: string) {
  const r = await query<any>(
    `SELECT ${CAMPOS} FROM nomina_periodos p WHERE p.id = $1 AND p.company_id = $2`,
    [id, companyId]
  );
  if (r.rows.length === 0) throw new NotFoundError('Ese periodo no existe en esta empresa');
  return r.rows[0];
}

/** El periodo en que cae una fecha — para saber dónde va un movimiento. */
export async function porFecha(companyId: string, fecha: string, tipo: TipoPeriodo) {
  const f = aFecha(fecha);
  const r = await query<any>(
    `SELECT ${CAMPOS} FROM nomina_periodos p
      WHERE p.company_id = $1 AND p.tipo = $2
        AND p.fecha_inicio <= $3::date AND p.fecha_fin >= $3::date
      LIMIT 1`,
    [companyId, tipo, aTexto(f)]
  );
  return r.rows[0] || null;
}

/* ═══════════════════ ESTADO ═══════════════════ */

export async function fijarFechaDePago(companyId: string, id: string, fechaPago: string) {
  const f = aTexto(aFecha(fechaPago));
  const r = await query(
    `UPDATE nomina_periodos SET fecha_pago = $3::date
      WHERE id = $1 AND company_id = $2 AND estatus <> 'CERRADO'`,
    [id, companyId, f]
  );
  if (r.rowCount === 0) {
    throw new ConflictError('El periodo no existe o ya está cerrado');
  }
  return obtener(companyId, id);
}

/**
 * Cierra el periodo. Después de esto ya no se recalcula ni se regenera.
 *
 * Es el equivalente a decir "esto ya se pagó". La marca lleva quién y cuándo
 * porque es la última oportunidad de haber revisado los números.
 */
export async function cerrar(companyId: string, id: string, userId: string) {
  const p = await obtener(companyId, id);
  if (p.estatus === 'CERRADO') throw new ConflictError('Ese periodo ya estaba cerrado');
  if (p.estatus !== 'CALCULADO') {
    throw new ValidationError(
      'Sólo se cierra un periodo ya calculado. Corre la prenómina antes: cerrar ' +
      'sin calcular dejaría un periodo sin recibos y sin posibilidad de generarlos.'
    );
  }
  await query(
    `UPDATE nomina_periodos
        SET estatus = 'CERRADO', cerrado_at = NOW(), cerrado_por = $3
      WHERE id = $1 AND company_id = $2`,
    [id, companyId, userId]
  );
  return obtener(companyId, id);
}

/** Reabrir sólo lo que no se ha cerrado — deja el periodo listo para recalcular. */
export async function marcarCalculado(companyId: string, id: string) {
  const r = await query(
    `UPDATE nomina_periodos SET estatus = 'CALCULADO'
      WHERE id = $1 AND company_id = $2 AND estatus = 'ABIERTO'`,
    [id, companyId]
  );
  if (r.rowCount === 0) throw new ConflictError('El periodo no existe o ya no está abierto');
  return obtener(companyId, id);
}
