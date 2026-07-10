/**
 * /admin/prepaid — gestión de prepago FLEX para SUPER_ADMIN.
 *
 *  GET   /admin/prepaid/balances                saldos de todas las empresas FLEX
 *  GET   /admin/prepaid/:companyId/purchases    histórico de compras de UNA empresa
 *  POST  /admin/prepaid/:companyId/recharge     suma un bloque al saldo
 *  PATCH /admin/prepaid/:companyId/threshold    ajusta el umbral de aviso
 *
 * Todos protegidos por requireSuperAdmin.
 * Referencia: docs/DISENO_FACTURACION_PLANES.md
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError, NotFoundError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import { requireSuperAdmin, audit } from './admin.middleware';
import * as billingService from '../billing/billing.service';

const router = Router();
router.use(authenticateToken);
router.use(requireSuperAdmin);

/* ─────────────── Saldos de empresas FLEX ─────────────── */

router.get('/balances', asyncHandler(async (_req: Request, res: Response) => {
  // Lista TODAS las empresas con plan PKG_FLEX (tengan o no fila de balance
  // aún — LEFT JOIN con COALESCE 0). Incluye la última recarga y el total
  // histórico comprado para dar contexto en la UI.
  const r = await query<any>(
    `SELECT c.id, c.rfc, c.business_name,
            COALESCE(pb.balance, 0)        AS balance,
            COALESCE(pb.low_threshold, 5)  AS low_threshold,
            pb.low_notified_at,
            pb.zero_notified_at,
            lastp.granted_at               AS last_recharge_at,
            lastp.stamps_bought            AS last_recharge_stamps,
            COALESCE(tot.total_stamps, 0)  AS lifetime_stamps,
            COALESCE(tot.total_mxn, 0)     AS lifetime_mxn,
            -- Consumo del mes en curso (para contexto)
            COALESCE(used.n, 0)            AS used_current_month
       FROM companies c
       LEFT JOIN prepaid_stamp_balance pb ON pb.company_id = c.id
       LEFT JOIN LATERAL (
         SELECT granted_at, stamps_bought
           FROM prepaid_stamp_purchases
          WHERE company_id = c.id
          ORDER BY granted_at DESC LIMIT 1
       ) lastp ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(stamps_bought)::int AS total_stamps,
                SUM(total_mxn)::numeric AS total_mxn
           FROM prepaid_stamp_purchases
          WHERE company_id = c.id
       ) tot ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS n FROM stamp_usage
          WHERE company_id = c.id
            AND billing_period = date_trunc('month', NOW())::date
       ) used ON TRUE
      WHERE c.stamp_package_code = 'PKG_FLEX'
      ORDER BY c.business_name`
  );

  res.status(200).json({
    success: true,
    data: {
      count: r.rows.length,
      default_unit_price: billingService.PREPAID_UNIT_PRICE_MXN,
      companies: r.rows,
    },
  });
}));

/* ─────────────── Histórico de compras por empresa ─────────────── */

router.get('/:companyId/purchases', asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.params;
  const compR = await query<any>(
    `SELECT id, rfc, business_name FROM companies WHERE id = $1`,
    [companyId]
  );
  if (compR.rows.length === 0) throw new NotFoundError('Empresa no encontrada');

  const r = await query<any>(
    `SELECT p.*, u.email AS granted_by_email
       FROM prepaid_stamp_purchases p
       LEFT JOIN users u ON u.id = p.granted_by
      WHERE p.company_id = $1
      ORDER BY p.granted_at DESC
      LIMIT 100`,
    [companyId]
  );

  res.status(200).json({
    success: true,
    data: {
      company: compR.rows[0],
      count: r.rows.length,
      purchases: r.rows,
    },
  });
}));

/* ─────────────── Recargar bloque ─────────────── */

router.post('/:companyId/recharge', asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.params;
  const stampsBought = parseInt(String(req.body?.stampsBought || 0), 10);
  const unitPriceMxn = req.body?.unitPriceMxn != null
    ? Number(req.body.unitPriceMxn)
    : undefined;
  const paymentMethod = String(req.body?.paymentMethod || '').trim() || undefined;
  const paymentReference = String(req.body?.paymentReference || '').trim() || undefined;
  const notes = String(req.body?.notes || '').trim() || undefined;

  if (!stampsBought || stampsBought < 1 || stampsBought > 10_000) {
    throw new ValidationError('stampsBought debe ser un entero entre 1 y 10,000');
  }
  if (unitPriceMxn != null && (isNaN(unitPriceMxn) || unitPriceMxn < 0)) {
    throw new ValidationError('unitPriceMxn inválido');
  }

  const compR = await query<any>(
    `SELECT id, rfc, business_name, stamp_package_code FROM companies WHERE id = $1`,
    [companyId]
  );
  if (compR.rows.length === 0) throw new NotFoundError('Empresa no encontrada');
  const company = compR.rows[0];
  if (company.stamp_package_code !== 'PKG_FLEX') {
    throw new ValidationError(
      `La empresa ${company.rfc} tiene plan ${company.stamp_package_code}, no PKG_FLEX. ` +
      `Las recargas prepago solo aplican al plan Uso libre.`
    );
  }

  const result = await billingService.recharge({
    companyId,
    stampsBought,
    unitPriceMxn,
    paymentMethod,
    paymentReference,
    notes,
    grantedBy: req.user?.userId,
  });

  await audit(req, {
    action: 'prepaid.recharge',
    targetId: companyId,
    payload: {
      rfc: company.rfc,
      stamps: stampsBought,
      unit_price: unitPriceMxn ?? billingService.PREPAID_UNIT_PRICE_MXN,
      balance_after: result.balanceAfter,
    },
  } as any).catch(() => {});

  res.status(200).json({
    success: true,
    message: `Recarga aplicada: +${stampsBought} timbres`,
    data: {
      company: { id: company.id, rfc: company.rfc, business_name: company.business_name },
      balance_after: result.balanceAfter,
      purchase_id: result.purchaseId,
    },
  });
}));

/* ─────────────── Ajustar umbral de aviso ─────────────── */

router.patch('/:companyId/threshold', asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.params;
  const threshold = parseInt(String(req.body?.threshold ?? ''), 10);
  if (isNaN(threshold) || threshold < 0 || threshold > 100) {
    throw new ValidationError('threshold debe ser un entero entre 0 y 100');
  }

  // Asegura fila (getPrepaidBalance la crea si falta)
  await billingService.getPrepaidBalance(companyId);

  const r = await query<any>(
    `UPDATE prepaid_stamp_balance
        SET low_threshold = $2, updated_at = NOW()
      WHERE company_id = $1
    RETURNING company_id, balance, low_threshold`,
    [companyId, threshold]
  );

  res.status(200).json({ success: true, data: r.rows[0] });
}));

export default router;
