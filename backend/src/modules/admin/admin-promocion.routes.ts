/**
 * /admin/promocion — la oferta de lanzamiento y el cobro prepago prorrateado.
 *
 *  GET   /admin/promocion/prueba                 quién está de cortesía y cuántos lugares quedan
 *  POST  /admin/promocion/prueba/:companyId      le da sus 10 timbres
 *  GET   /admin/promocion/cotizar                cuánto pagaría si contrata hoy
 *  POST  /admin/promocion/cobros                 genera el cargo prorrateado y el aviso
 *  GET   /admin/promocion/cobros                 los cargos, filtrables por estado
 *  POST  /admin/promocion/cobros/:id/pagado      registra el pago y libera el servicio
 *  PATCH /admin/promocion/exencion/:companyId    marca/desmarca empresa propia
 *
 * Todo bajo requireSuperAdmin: son decisiones de dinero.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import { requireSuperAdmin, audit } from './admin.middleware';
import * as promo from '../billing/prueba-y-prorrateo.service';

const router = Router();
router.use(authenticateToken);
router.use(requireSuperAdmin);

/* ─────────────── Prueba de cortesía ─────────────── */

router.get('/prueba', asyncHandler(async (_req: Request, res: Response) => {
  const estado = await promo.estadoDeLaPrueba();

  /* Las candidatas: las que nunca han recibido la cortesía. Se manda la lista
   * hecha para que la pantalla no tenga que cruzar dos consultas y arriesgarse
   * a ofrecer la promoción a alguien que ya la usó. */
  const cand = await query<any>(
    `SELECT id, rfc, business_name, stamp_package_code
       FROM companies
      WHERE deleted_at IS NULL
        AND trial_granted_at IS NULL
        AND billing_exempt = FALSE
      ORDER BY business_name`
  );

  res.json({
    success: true,
    data: {
      ...estado,
      maximo: promo.MAX_EMPRESAS_EN_PRUEBA,
      timbresPorEmpresa: promo.TIMBRES_DE_CORTESIA,
      candidatas: cand.rows,
    },
  });
}));

router.post('/prueba/:companyId', asyncHandler(async (req: Request, res: Response) => {
  const r = await promo.activarPrueba(req.params.companyId, req.user?.userId);
  await audit(req, { action: 'promocion.prueba', targetId: req.params.companyId,
    payload: { rfc: r.rfc, timbres: promo.TIMBRES_DE_CORTESIA } } as any).catch(() => {});
  res.status(201).json({ success: true, data: r });
}));

/* ─────────────── Cotizador ─────────────── */

/**
 * Cuánto se le cobraría si contrata hoy — o en la fecha que se indique.
 *
 * Existe como consulta aparte para poder DECIRLE el importe al cliente antes
 * de generar nada. Sin esto, la única forma de saber cuánto paga sería crear
 * el cargo, y un cliente que se arrepiente dejaría un cobro fantasma.
 */
router.get('/cotizar', asyncHandler(async (req: Request, res: Response) => {
  const code = String(req.query.packageCode || '');
  if (!code) throw new ValidationError('Falta packageCode');
  const desde = req.query.desde ? new Date(String(req.query.desde)) : undefined;
  if (desde && isNaN(desde.getTime())) throw new ValidationError('La fecha "desde" no es válida');
  res.json({ success: true, data: await promo.calcularProrrateo(code, desde) });
}));

/* ─────────────── Cobros ─────────────── */

router.get('/cobros', asyncHandler(async (req: Request, res: Response) => {
  const estado = String(req.query.status || 'PENDING').toUpperCase();
  const params: any[] = [];
  let filtro = '';
  if (estado !== 'TODOS') { params.push(estado); filtro = `WHERE pc.status = $1`; }

  const r = await query<any>(
    `SELECT pc.*, c.rfc, c.business_name, sp.name AS package_name
       FROM plan_charges pc
       JOIN companies c ON c.id = pc.company_id
       JOIN stamp_packages sp ON sp.code = pc.package_code
       ${filtro}
      ORDER BY pc.created_at DESC
      LIMIT 200`,
    params
  );
  res.json({ success: true, data: { cobros: r.rows } });
}));

router.post('/cobros', asyncHandler(async (req: Request, res: Response) => {
  const { companyId, packageCode, desde } = req.body || {};
  if (!companyId || !packageCode) throw new ValidationError('Faltan companyId y packageCode');
  const r = await promo.generarCobro({
    companyId,
    packageCode,
    desde: desde ? new Date(desde) : undefined,
    userId: req.user?.userId,
  });
  await audit(req, { action: 'promocion.cobro', targetId: companyId,
    payload: { paquete: packageCode, importe: r.prorrateo.amount,
               dias: `${r.prorrateo.daysCharged}/${r.prorrateo.daysInMonth}` } } as any).catch(() => {});
  res.status(201).json({ success: true, data: r });
}));

router.post('/cobros/:id/pagado', asyncHandler(async (req: Request, res: Response) => {
  const r = await promo.registrarPago({
    chargeId: req.params.id,
    nota: req.body?.nota,
    invoiceId: req.body?.invoiceId,
  });
  await audit(req, { action: 'promocion.pago', targetId: req.params.id,
    payload: { paquete: r.package_code, importe: r.amount_mxn } } as any).catch(() => {});
  res.json({ success: true, data: r });
}));

/* ─────────────── Exención ─────────────── */

/**
 * Marca una empresa como propia: deja de entrar al cierre mensual.
 *
 * Es una bandera editable y no una lista de RFC dentro del código, para que
 * dar de alta otra empresa del grupo no exija tocar el servidor. Se pide el
 * motivo cuando se activa: dentro de un año, "por qué esta empresa no factura"
 * tiene que poder responderse sin preguntarle a nadie.
 */
router.patch('/exencion/:companyId', asyncHandler(async (req: Request, res: Response) => {
  const exempt = req.body?.exempt === true;
  const motivo = exempt ? String(req.body?.motivo || '').trim() : null;
  if (exempt && !motivo) {
    throw new ValidationError('Escribe el motivo de la exención — sin él, nadie sabrá después por qué esta empresa no se factura.');
  }
  const r = await query<any>(
    `UPDATE companies
        SET billing_exempt = $2, billing_exempt_reason = $3
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, rfc, business_name, billing_exempt, billing_exempt_reason`,
    [req.params.companyId, exempt, motivo]
  );
  if (r.rows.length === 0) throw new ValidationError('Empresa no encontrada');
  await audit(req, { action: 'promocion.exencion', targetId: req.params.companyId,
    payload: { exempt, motivo } } as any).catch(() => {});
  res.json({ success: true, data: r.rows[0] });
}));

export default router;
