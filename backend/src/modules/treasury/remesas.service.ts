/**
 * remesas.service — la corrida de pagos: qué se le transfiere a quién y qué día.
 *
 * EL CICLO QUE MODELA
 * El viernes se elige proveedor, se marcan las facturas que se le van a pagar y
 * se arman en una remesa con fecha del lunes. Se autoriza —a partir de ahí ya no
 * se le agregan renglones—, se imprime la lista con los datos bancarios y el
 * lunes se ejecuta: un solo movimiento marca pagadas todas sus facturas y libera
 * la línea de crédito de cada proveedor.
 *
 * LA FECHA DE PAGO NO ES EL VENCIMIENTO
 * `due_date` es del proveedor: su factura vence cuando vence. `payment_date` es
 * nuestra: es el día en que se firman transferencias. Se guardan por separado
 * para poder ver qué se pagó tarde en vez de borrar la evidencia.
 *
 * UNA FACTURA, UNA REMESA
 * Al agregar se verifica que el renglón no esté ya en otra corrida viva. Sin ese
 * candado, la misma factura entra en la lista del lunes y en la del martes, y se
 * paga dos veces — el error más caro que puede cometer este módulo.
 */

import { PoolClient } from 'pg';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

export type EstadoRemesa = 'DRAFT' | 'AUTHORIZED' | 'PAID' | 'CANCELLED';

/** Estados en los que la remesa todavía retiene sus facturas. */
const REMESAS_VIVAS = ['DRAFT', 'AUTHORIZED', 'PAID'];

async function siguienteFolio(client: PoolClient, companyId: string): Promise<number> {
  const r = await transactionQuery<{ next: number }>(
    client,
    `SELECT COALESCE(MAX(folio), 0) + 1 AS next FROM payment_runs WHERE company_id = $1`,
    [companyId]
  );
  return Number(r.rows[0].next);
}

/**
 * Mete facturas en una remesa en borrador.
 *
 * Devuelve cuántas entraron y cuáles se rechazaron con su motivo, en vez de
 * abortar todo: si de doce facturas una ya estaba en otra corrida, quien arma
 * la lista prefiere las once y el aviso, no empezar de cero.
 */
async function agregarRenglones(
  client: PoolClient,
  companyId: string,
  runId: string,
  paymentIds: string[]
): Promise<{ agregadas: number; total: number; rechazadas: Array<{ id: string; motivo: string }> }> {
  const rechazadas: Array<{ id: string; motivo: string }> = [];
  let agregadas = 0;
  let total = 0;

  for (const id of paymentIds || []) {
    const r = await transactionQuery<any>(
      client,
      `SELECT sp.id, sp.amount, sp.status, sp.payment_run_id, pr.status AS estado_remesa
         FROM supplier_payments_schedule sp
         LEFT JOIN payment_runs pr ON pr.id = sp.payment_run_id
        WHERE sp.id = $1 AND sp.company_id = $2 FOR UPDATE OF sp`,
      [id, companyId]
    );
    if (r.rows.length === 0) { rechazadas.push({ id, motivo: 'No existe' }); continue; }
    const p = r.rows[0];

    if (p.status !== 'PENDING') {
      rechazadas.push({ id, motivo: `Ya está ${p.status === 'PAID' ? 'pagada' : 'cancelada'}` });
      continue;
    }
    if (p.payment_run_id && p.payment_run_id !== runId && REMESAS_VIVAS.includes(p.estado_remesa)) {
      rechazadas.push({ id, motivo: 'Ya está en otra remesa' });
      continue;
    }
    if (p.payment_run_id === runId) continue;   // ya estaba aquí, no es error

    await transactionQuery(
      client,
      `UPDATE supplier_payments_schedule SET payment_run_id = $1 WHERE id = $2`,
      [runId, id]
    );
    agregadas++;
    total += Number(p.amount);
  }
  return { agregadas, total, rechazadas };
}

/** Crea la remesa y le mete las facturas seleccionadas. */
export async function crearRemesa(
  companyId: string,
  datos: { paymentDate: string; notes?: string; paymentIds?: string[] },
  user: { userId?: string; email?: string }
): Promise<any> {
  if (!datos?.paymentDate) throw new ValidationError('Indica la fecha en que se va a pagar');

  return transaction(async (client) => {
    const folio = await siguienteFolio(client, companyId);
    const ins = await transactionQuery<any>(
      client,
      `INSERT INTO payment_runs
         (company_id, folio, payment_date, notes, created_by, created_by_email)
       VALUES ($1, $2, $3::date, $4, $5, $6)
       RETURNING id, folio, payment_date, status, notes, created_at`,
      [companyId, folio, datos.paymentDate, datos.notes || null,
       user.userId || null, user.email || null]
    );
    const run = ins.rows[0];

    const res = await agregarRenglones(client, companyId, run.id, datos.paymentIds || []);
    logger.info(
      `[tesoreria] remesa #${folio} para el ${datos.paymentDate}: ` +
      `${res.agregadas} factura(s), ${res.total}`
    );
    return { ...run, ...res };
  });
}

/** Agrega más facturas a una remesa que sigue en borrador. */
export async function agregarPagosARemesa(
  companyId: string,
  runId: string,
  paymentIds: string[]
): Promise<any> {
  return transaction(async (client) => {
    const run = await bloqueaRemesa(client, companyId, runId);
    if (run.status !== 'DRAFT') {
      throw new ConflictError(
        `La remesa #${run.folio} ya está ${etiqueta(run.status)} — para cambiarla, ` +
        'quítale la autorización primero.'
      );
    }
    const res = await agregarRenglones(client, companyId, runId, paymentIds);
    return { id: run.id, folio: run.folio, ...res };
  });
}

/** Saca una factura de la remesa: vuelve a quedar libre para otra corrida. */
export async function quitarPagoDeRemesa(
  companyId: string,
  runId: string,
  paymentId: string
): Promise<any> {
  return transaction(async (client) => {
    const run = await bloqueaRemesa(client, companyId, runId);
    if (run.status !== 'DRAFT') {
      throw new ConflictError(
        `La remesa #${run.folio} ya está ${etiqueta(run.status)} — no se le pueden quitar renglones.`
      );
    }
    const r = await transactionQuery<any>(
      client,
      `UPDATE supplier_payments_schedule SET payment_run_id = NULL
        WHERE id = $1 AND company_id = $2 AND payment_run_id = $3
        RETURNING id`,
      [paymentId, companyId, runId]
    );
    if (r.rows.length === 0) throw new NotFoundError('Ese pago no está en esta remesa');
    return { id: run.id, folio: run.folio, quitado: paymentId };
  });
}

async function bloqueaRemesa(client: PoolClient, companyId: string, runId: string): Promise<any> {
  const r = await transactionQuery<any>(
    client,
    `SELECT id, folio, status, payment_date FROM payment_runs
      WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [runId, companyId]
  );
  if (r.rows.length === 0) throw new NotFoundError('Remesa no encontrada');
  return r.rows[0];
}

function etiqueta(estado: string): string {
  return estado === 'AUTHORIZED' ? 'autorizada'
       : estado === 'PAID' ? 'pagada'
       : estado === 'CANCELLED' ? 'cancelada' : 'en borrador';
}

/** Lista de remesas con sus totales. */
export async function listarRemesas(
  companyId: string,
  filtros: { from?: string; to?: string; status?: string } = {}
): Promise<any[]> {
  const params: any[] = [companyId];
  const where = ['pr.company_id = $1'];
  if (filtros.status) { params.push(filtros.status); where.push(`pr.status = $${params.length}`); }
  if (filtros.from)   { params.push(filtros.from);   where.push(`pr.payment_date >= $${params.length}::date`); }
  if (filtros.to)     { params.push(filtros.to);     where.push(`pr.payment_date <= $${params.length}::date`); }

  const r = await query<any>(
    `SELECT pr.id, pr.folio, pr.payment_date, pr.status, pr.notes,
            pr.created_by_email, pr.created_at, pr.authorized_at, pr.paid_at,
            COUNT(sp.id)::int                        AS facturas,
            COUNT(DISTINCT sp.supplier_id)::int      AS proveedores,
            COALESCE(SUM(sp.amount), 0)              AS total
       FROM payment_runs pr
       LEFT JOIN supplier_payments_schedule sp ON sp.payment_run_id = pr.id
      WHERE ${where.join(' AND ')}
      GROUP BY pr.id
      ORDER BY pr.payment_date DESC, pr.folio DESC`,
    params
  );
  return r.rows;
}

/**
 * Detalle de la remesa: es el reporte que se imprime y se lleva al banco.
 *
 * Trae los datos bancarios del proveedor —banco, CLABE, beneficiario— porque
 * sin ellos la lista no sirve para transferir y alguien tiene que ir a buscarlos
 * proveedor por proveedor. Los renglones vienen ordenados por proveedor para
 * que las transferencias del mismo destinatario queden juntas.
 */
export async function detalleRemesa(companyId: string, runId: string): Promise<any> {
  const runR = await query<any>(
    `SELECT pr.*, u.email AS autorizada_por
       FROM payment_runs pr
       LEFT JOIN users u ON u.id = pr.authorized_by
      WHERE pr.id = $1 AND pr.company_id = $2`,
    [runId, companyId]
  );
  if (runR.rows.length === 0) throw new NotFoundError('Remesa no encontrada');

  const renglones = await query<any>(
    `SELECT sp.id, sp.invoice_number, sp.subtotal, sp.tax_rate, sp.amount,
            sp.due_date, sp.status, sp.notes,
            (sp.due_date < CURRENT_DATE) AS vencida,
            c.id AS supplier_id, c.business_name AS supplier_name, c.rfc AS supplier_rfc,
            c.bank_name, c.bank_clabe, c.bank_account, c.bank_account_holder,
            po.folio AS orden_folio
       FROM supplier_payments_schedule sp
       JOIN customers c ON c.id = sp.supplier_id
       LEFT JOIN purchase_orders po ON po.id = sp.purchase_order_id
      WHERE sp.payment_run_id = $1
      ORDER BY c.business_name, sp.due_date`,
    [runId]
  );

  const total = renglones.rows.reduce((a: number, r: any) => a + Number(r.amount), 0);
  return { run: runR.rows[0], renglones: renglones.rows, total };
}

/**
 * Cambia el estado de la remesa.
 *
 * DRAFT → AUTHORIZED  firma: se congela el contenido.
 * AUTHORIZED → PAID   ejecución: marca pagadas TODAS sus facturas y libera el
 *                     crédito de cada proveedor, en una sola transacción.
 * → CANCELLED         suelta las facturas, que quedan libres para otra corrida.
 *
 * Pagar exige autorización previa a propósito: la corrida se arma un día y se
 * ejecuta otro, y ese paso intermedio es donde alguien la revisa. Permitir
 * "pagar" un borrador convertiría la autorización en un adorno.
 */
export async function cambiarEstadoRemesa(
  companyId: string,
  runId: string,
  nuevo: EstadoRemesa,
  user: { userId?: string; email?: string }
): Promise<any> {
  return transaction(async (client) => {
    const run = await bloqueaRemesa(client, companyId, runId);

    if (run.status === nuevo) return run;
    if (['PAID', 'CANCELLED'].includes(run.status)) {
      throw new ConflictError(`La remesa #${run.folio} ya está ${etiqueta(run.status)}.`);
    }
    if (nuevo === 'PAID' && run.status !== 'AUTHORIZED') {
      throw new ConflictError(
        `Autoriza la remesa #${run.folio} antes de marcarla pagada.`
      );
    }
    if (nuevo === 'AUTHORIZED' && run.status !== 'DRAFT') {
      throw new ConflictError(`La remesa #${run.folio} no está en borrador.`);
    }

    let pagadas = 0;
    let importePagado = 0;

    if (nuevo === 'PAID') {
      const renglones = await transactionQuery<any>(
        client,
        `SELECT id, supplier_id, amount FROM supplier_payments_schedule
          WHERE payment_run_id = $1 AND company_id = $2 AND status = 'PENDING'
          FOR UPDATE`,
        [runId, companyId]
      );
      if (renglones.rows.length === 0) {
        throw new ValidationError('La remesa no tiene facturas pendientes que pagar.');
      }
      for (const p of renglones.rows) {
        await transactionQuery(
          client,
          `UPDATE supplier_payments_schedule
              SET status = 'PAID', paid_at = NOW()
            WHERE id = $1`,
          [p.id]
        );
        /* Libera crédito con GREATEST para que nunca quede negativo — misma
         * regla que el pago individual de tesorería. */
        await transactionQuery(
          client,
          `UPDATE customers
              SET credit_used = GREATEST(COALESCE(credit_used, 0) - $1, 0), updated_at = NOW()
            WHERE id = $2`,
          [p.amount, p.supplier_id]
        );
        pagadas++;
        importePagado += Number(p.amount);
      }
    }

    if (nuevo === 'CANCELLED') {
      /* Las facturas NO se cancelan: se sueltan. La deuda sigue existiendo,
       * simplemente no se paga en esta corrida. */
      await transactionQuery(
        client,
        `UPDATE supplier_payments_schedule SET payment_run_id = NULL
          WHERE payment_run_id = $1 AND status = 'PENDING'`,
        [runId]
      );
    }

    const upd = await transactionQuery<any>(
      client,
      /* `$1::varchar` en todas sus apariciones: sin el cast, Postgres deduce
       * varchar por la asignación y text por la comparación, y rechaza la
       * consulta entera con "inconsistent types deduced for parameter". */
      `UPDATE payment_runs SET
          status        = $1::varchar,
          authorized_by = CASE WHEN $1::varchar = 'AUTHORIZED' THEN $2::uuid ELSE authorized_by END,
          authorized_at = CASE WHEN $1::varchar = 'AUTHORIZED' THEN NOW()    ELSE authorized_at END,
          paid_at       = CASE WHEN $1::varchar = 'PAID'       THEN NOW()    ELSE paid_at END,
          updated_at    = NOW()
        WHERE id = $3
        RETURNING id, folio, payment_date, status, authorized_at, paid_at`,
      [nuevo, user.userId || null, runId]
    );

    logger.info(
      `[tesoreria] remesa #${run.folio} → ${nuevo}` +
      (pagadas ? ` (${pagadas} factura(s), ${importePagado} pagados)` : '')
    );
    return { ...upd.rows[0], pagadas, importePagado };
  });
}
