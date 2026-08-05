/**
 * prueba-y-prorrateo.service — la oferta de lanzamiento y el cobro prepago.
 *
 * EL RECORRIDO QUE MODELA
 *   1. Un prospecto recibe 10 timbres de cortesía, una sola vez.
 *   2. Al agotarlos deja de timbrar, pero sigue usando el resto del sistema.
 *   3. Contrata un paquete. Como es prepago y estamos a media mes, se cobra la
 *      parte proporcional y se le manda el aviso.
 *   4. Cuando el pago entra, se le abonan los timbres y se libera el servicio.
 *
 * POR QUÉ LA CORTESÍA NO ES UN PAQUETE MENSUAL DE 10
 * Sería lo fácil: `monthly_stamps = 10` y listo. Pero el cierre de mes repone
 * la dotación de cada paquete, así que la prueba se renovaría sola cada mes y
 * los 10 timbres de cortesía serían 120 al año por empresa. El saldo vive en
 * `companies.trial_stamps_left`, que nadie repone.
 */

import { PoolClient } from 'pg';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

/** Cuántas empresas pueden estar de cortesía. La oferta es de lanzamiento. */
export const MAX_EMPRESAS_EN_PRUEBA = 3;
export const TIMBRES_DE_CORTESIA = 10;

/* ─────────────────────  PRUEBA GRATIS  ───────────────────── */

export interface EstadoPrueba {
  empresasEnPrueba: number;
  lugaresLibres: number;
  empresas: Array<{
    id: string; rfc: string; business_name: string;
    trial_stamps_left: number; trial_started_at: string | null;
  }>;
}

/** Quién está usando la oferta y cuántos lugares quedan. */
export async function estadoDeLaPrueba(): Promise<EstadoPrueba> {
  const r = await query<any>(
    `SELECT id, rfc, business_name, trial_stamps_left, trial_started_at
       FROM companies
      WHERE stamp_package_code = 'PKG_TRIAL'
        AND deleted_at IS NULL
      ORDER BY trial_started_at DESC NULLS LAST`
  );
  return {
    empresasEnPrueba: r.rows.length,
    lugaresLibres: Math.max(0, MAX_EMPRESAS_EN_PRUEBA - r.rows.length),
    empresas: r.rows,
  };
}

/**
 * Pone a una empresa en prueba con sus 10 timbres.
 *
 * Dos candados, y ninguno es decorativo:
 *   · El cupo de 3 se cuenta DENTRO de la transacción y con la fila bloqueada,
 *     porque dos altas simultáneas contando "2 de 3" dejarían 4 empresas.
 *   · `trial_granted_at` no se borra nunca. Sin él, bastaría cambiar el
 *     paquete y volver a la prueba para tener timbres gratis sin fin.
 */
export async function activarPrueba(companyId: string, userId?: string) {
  return transaction(async (client: PoolClient) => {
    const cR = await transactionQuery<any>(client,
      `SELECT id, rfc, business_name, stamp_package_code, trial_granted_at
         FROM companies WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [companyId]
    );
    if (cR.rows.length === 0) throw new NotFoundError('Empresa no encontrada');
    const empresa = cR.rows[0];

    if (empresa.trial_granted_at) {
      throw new ConflictError(
        `${empresa.business_name} ya recibió sus ${TIMBRES_DE_CORTESIA} timbres de cortesía ` +
        `el ${String(empresa.trial_granted_at).slice(0, 10)}. La prueba es una sola vez.`
      );
    }

    const ocupados = await transactionQuery<{ n: string }>(client,
      `SELECT COUNT(*)::text AS n FROM companies
        WHERE stamp_package_code = 'PKG_TRIAL' AND deleted_at IS NULL`
    );
    if (Number(ocupados.rows[0].n) >= MAX_EMPRESAS_EN_PRUEBA) {
      throw new ConflictError(
        `Los ${MAX_EMPRESAS_EN_PRUEBA} lugares de la promoción están ocupados. ` +
        'Cuando una de esas empresas contrate un paquete se libera su lugar.'
      );
    }

    const upd = await transactionQuery<any>(client,
      `UPDATE companies
          SET stamp_package_code = 'PKG_TRIAL',
              trial_stamps_left  = $2,
              trial_started_at   = NOW(),
              trial_granted_at   = NOW(),
              billing_period_start = date_trunc('month', NOW())::date
        WHERE id = $1
        RETURNING id, rfc, business_name, trial_stamps_left`,
      [companyId, TIMBRES_DE_CORTESIA]
    );
    logger.info(`[prueba] ${empresa.rfc} entra a la promoción con ${TIMBRES_DE_CORTESIA} timbres (por ${userId || 'sistema'})`);
    return upd.rows[0];
  });
}

/**
 * ¿Puede timbrar una empresa que está de prueba?
 *
 * Se llama desde `assertCanStamp`, ANTES de ir al PAC. Bloquea sólo el
 * timbrado: capturar, importar XML, mover inventario y consultar sigue
 * funcionando. Un cliente al que se le apaga el sistema entero pierde el
 * acceso a lo que ya capturó, y esa conversación no termina en venta.
 */
export async function verificarTimbresDePrueba(companyId: string): Promise<void> {
  const r = await query<any>(
    `SELECT stamp_package_code, trial_stamps_left, business_name
       FROM companies WHERE id = $1`, [companyId]
  );
  const c = r.rows[0];
  if (!c || c.stamp_package_code !== 'PKG_TRIAL') return;

  if (Number(c.trial_stamps_left ?? 0) <= 0) {
    throw new ValidationError(
      `Se agotaron los ${TIMBRES_DE_CORTESIA} timbres de cortesía. Para seguir timbrando ` +
      'hay que contratar un paquete; todo lo que capturaste se conserva. ' +
      'Escríbenos y te activamos el plan el mismo día.'
    );
  }
}

/**
 * Descuenta un timbre de cortesía. Se llama junto con `recordStampUsed`,
 * dentro de la misma transacción del timbrado.
 *
 * El `GREATEST(...,0)` evita que el saldo quede negativo si dos timbrados
 * salen a la vez: el bloqueo de arriba se consultó antes, y entre la consulta
 * y el descuento cabe otra petición.
 */
export async function descontarTimbreDePrueba(client: PoolClient, companyId: string): Promise<void> {
  await transactionQuery(client,
    `UPDATE companies
        SET trial_stamps_left = GREATEST(COALESCE(trial_stamps_left, 0) - 1, 0)
      WHERE id = $1 AND stamp_package_code = 'PKG_TRIAL'`,
    [companyId]
  );
}

/* ─────────────────────  COBRO PREPAGO PRORRATEADO  ───────────────────── */

export interface Prorrateo {
  packageCode: string;
  packageName: string;
  startsOn: string;
  endsOn: string;
  billingPeriod: string;
  daysCharged: number;
  daysInMonth: number;
  fullStamps: number;
  fullPrice: number;
  stampsGranted: number;
  amount: number;
  esMesCompleto: boolean;
}

const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Calcula qué se cobra si el paquete arranca en `desde`.
 *
 * Se prorratean LAS DOS COSAS —precio y timbres— por días restantes del mes.
 * Cobrar la mitad y entregar el paquete completo suena generoso hasta que
 * alguien contrata el día 28, timbra 100 y no vuelve: los timbres le cuestan
 * dinero real al PAC.
 *
 * El día de alta SE COBRA: quien contrata el día 15 de un mes de 31 paga 17
 * días, no 16. Ese día ya puede timbrar.
 *
 * Los timbres se redondean HACIA ARRIBA. La diferencia es de un timbre y
 * discutirlo con un cliente nuevo cuesta más que regalarlo.
 */
export async function calcularProrrateo(packageCode: string, desde?: Date): Promise<Prorrateo> {
  const pR = await query<any>(
    `SELECT code, name, monthly_stamps, monthly_fee_mxn FROM stamp_packages
      WHERE code = $1 AND is_active = TRUE`, [packageCode]
  );
  if (pR.rows.length === 0) throw new NotFoundError(`El paquete ${packageCode} no existe o está inactivo`);
  const pkg = pR.rows[0];
  if (pkg.code === 'PKG_TRIAL') {
    throw new ValidationError('La prueba no se cobra. Se activa desde el botón de la promoción.');
  }

  const inicio = desde || new Date();
  const anio = inicio.getFullYear();
  const mes = inicio.getMonth();
  const diasDelMes = new Date(anio, mes + 1, 0).getDate();
  const finDeMes = new Date(anio, mes, diasDelMes);
  const diasCobrados = diasDelMes - inicio.getDate() + 1;

  const factor = diasCobrados / diasDelMes;
  const fullPrice = Number(pkg.monthly_fee_mxn);
  const fullStamps = Number(pkg.monthly_stamps);

  return {
    packageCode: pkg.code,
    packageName: pkg.name,
    startsOn: iso(inicio),
    endsOn: iso(finDeMes),
    billingPeriod: iso(new Date(anio, mes, 1)),
    daysCharged: diasCobrados,
    daysInMonth: diasDelMes,
    fullStamps,
    fullPrice,
    stampsGranted: Math.ceil(fullStamps * factor),
    amount: Math.round(fullPrice * factor * 100) / 100,
    esMesCompleto: diasCobrados === diasDelMes,
  };
}

/**
 * Genera el cargo prepago y deja la empresa esperando el pago.
 *
 * Lo que NO hace: abonar los timbres ni cambiar el paquete. Eso ocurre al
 * registrar el pago. Es prepago — si se entregara el servicio aquí, el aviso
 * sería un recordatorio amable y no una condición.
 */
export async function generarCobro(opts: {
  companyId: string;
  packageCode: string;
  desde?: Date;
  userId?: string;
}) {
  const pro = await calcularProrrateo(opts.packageCode, opts.desde);

  return transaction(async (client: PoolClient) => {
    const cR = await transactionQuery<any>(client,
      `SELECT id, rfc, business_name, billing_exempt FROM companies
        WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [opts.companyId]
    );
    if (cR.rows.length === 0) throw new NotFoundError('Empresa no encontrada');
    const empresa = cR.rows[0];
    if (empresa.billing_exempt) {
      throw new ValidationError(
        `${empresa.business_name} está marcada como exenta de facturación (empresa propia). ` +
        'Si de verdad hay que cobrarle, quita primero la exención.'
      );
    }

    const ins = await transactionQuery<any>(client,
      `INSERT INTO plan_charges
         (company_id, package_code, billing_period, starts_on, ends_on,
          days_charged, days_in_month, full_stamps, full_price_mxn,
          stamps_granted, amount_mxn, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [opts.companyId, pro.packageCode, pro.billingPeriod, pro.startsOn, pro.endsOn,
       pro.daysCharged, pro.daysInMonth, pro.fullStamps, pro.fullPrice,
       pro.stampsGranted, pro.amount, opts.userId || null]
    ).catch((e: any) => {
      if (e?.code === '23505') {
        throw new ConflictError(
          `${empresa.business_name} ya tiene un cobro de ${pro.billingPeriod.slice(0, 7)}. ` +
          'Revísalo antes de generar otro: cancélalo o regístralo como pagado.'
        );
      }
      throw e;
    });

    logger.info(`[cobro] ${empresa.rfc} · ${pro.packageCode} · $${pro.amount} por ${pro.daysCharged}/${pro.daysInMonth} días`);
    return { cargo: ins.rows[0], prorrateo: pro, empresa };
  });
}

/**
 * Registra el pago: abona los timbres, cambia el paquete y libera el servicio.
 *
 * Todo dentro de una transacción. Si el abono de timbres fallara después de
 * marcar el cargo como pagado, la empresa quedaría pagando sin poder timbrar
 * — y nadie lo notaría hasta que llamara enojada.
 */
export async function registrarPago(opts: {
  chargeId: string;
  nota?: string;
  invoiceId?: string;
}) {
  return transaction(async (client: PoolClient) => {
    const chR = await transactionQuery<any>(client,
      `SELECT * FROM plan_charges WHERE id = $1 FOR UPDATE`, [opts.chargeId]
    );
    if (chR.rows.length === 0) throw new NotFoundError('Cargo no encontrado');
    const cargo = chR.rows[0];
    if (cargo.status === 'PAID') {
      throw new ConflictError('Ese cobro ya estaba registrado como pagado.');
    }
    if (cargo.status === 'CANCELLED') {
      throw new ConflictError('Ese cobro está cancelado. Genera uno nuevo.');
    }

    await transactionQuery(client,
      `UPDATE plan_charges
          SET status = 'PAID', paid_at = NOW(), payment_note = $2,
              invoice_id = COALESCE($3, invoice_id), updated_at = NOW()
        WHERE id = $1`,
      [opts.chargeId, opts.nota || null, opts.invoiceId || null]
    );

    /* El paquete se asigna aquí, no al generar el aviso.
     *
     * `billing_period_start` se mueve al día en que empieza el servicio: el
     * cierre de mes cuenta el consumo desde ahí, y si se dejara en el día 1 el
     * cliente pagaría por días en los que todavía no tenía el sistema.
     *
     * La prueba se cierra poniendo el saldo de cortesía en 0: ya contrató, y
     * dejarle timbres gratis sueltos haría que el cobro no cuadre con lo que
     * se timbró. */
    await transactionQuery(client,
      `UPDATE companies
          SET stamp_package_code   = $2,
              billing_period_start = $3,
              trial_stamps_left    = CASE WHEN stamp_package_code = 'PKG_TRIAL'
                                          THEN 0 ELSE trial_stamps_left END
        WHERE id = $1`,
      [cargo.company_id, cargo.package_code, cargo.starts_on]
    );

    /* Los timbres del prorrateo NO se copian a ningún contador aparte.
     *
     * La tentación era abonarlos a `prepaid_stamp_balance`, pero esa bolsa es
     * exclusiva del plan FLEX: para un PKG_100 el saldo se quedaría ahí sin que
     * nadie lo mirara, mientras el cierre de mes seguiría dando el cupo
     * completo de 100. Dos cifras para lo mismo y ninguna correcta.
     *
     * El cupo del primer mes sale del propio cargo: `close-month` busca el
     * plan_charge PAGADO del periodo y usa su `stamps_granted`. Una sola
     * fuente, y la que además explica el importe.
     *
     * FLEX es la excepción real, porque ahí los timbres SON la bolsa prepago. */
    if (cargo.package_code === 'PKG_FLEX' && Number(cargo.stamps_granted) > 0) {
      await transactionQuery(client,
        `INSERT INTO prepaid_stamp_balance (company_id, balance)
         VALUES ($1, $2)
         ON CONFLICT (company_id) DO UPDATE
           SET balance = prepaid_stamp_balance.balance + EXCLUDED.balance,
               updated_at = NOW()`,
        [cargo.company_id, Number(cargo.stamps_granted)]
      );
    }

    logger.info(`[cobro] pagado ${opts.chargeId} — ${cargo.stamps_granted} timbres abonados`);
    return { ...cargo, status: 'PAID' };
  });
}
