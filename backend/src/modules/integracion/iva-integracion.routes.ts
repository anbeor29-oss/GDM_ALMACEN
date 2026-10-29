/**
 * /integracion/iva — puente servidor-a-servidor con IVA.HTML (iva.hcgm.com.mx).
 *
 * IVA.HTML es una app aparte (su propia BD). Para que sus clientes aparezcan en
 * Súper Admin → Facturación → «IVA (servicio)» y se les pueda facturar, IVA avisa
 * aquí cada alta (autoregistro) y cada compra de créditos.
 *
 *  POST /integracion/iva/cliente   { rfc, nombre, correo, telefono?, cp?, regimen?, empresa?, motivo? }
 *
 * Auth: header `x-iva-token` = env IVA_INTEGRACION_TOKEN (el mismo valor va en el
 * servicio `iva` de Render como NEXO_IVA_TOKEN). Sin la variable, el puente está apagado.
 *
 * Crea (si no existe) una EMPRESA SIN USUARIOS con producto IVA y prueba_inicio=NOW()
 * → sale en «Solicitudes en prueba». Si el RFC ya es cliente NEXO, lo marca AMBOS.
 * No crea usuarios ni da acceso al ERP.
 */
import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import { validateRFC } from '../auth/auth.service';
import logger from '../../middleware/logger';

const router = Router();

function requireIvaToken(req: Request, res: Response, next: NextFunction) {
  const esperado = process.env.IVA_INTEGRACION_TOKEN || '';
  if (!esperado) return res.status(503).json({ success: false, error: 'Integración IVA apagada (falta IVA_INTEGRACION_TOKEN).' });
  const dado = String(req.get('x-iva-token') || '');
  const a = Buffer.from(dado), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ success: false, error: 'Token de integración inválido.' });
  }
  return next();
}
router.use(requireIvaToken);

router.post('/cliente', asyncHandler(async (req: Request, res: Response) => {
  const d = req.body || {};
  const rfc = String(d.rfc || '').toUpperCase().trim();
  if (!validateRFC(rfc)) throw new ValidationError('RFC inválido.');
  const razon = String(d.empresa || d.nombre || '').trim().toUpperCase() || rfc;
  const correo = String(d.correo || '').toLowerCase().trim() || null;
  const cp = /^\d{5}$/.test(String(d.cp || '').trim()) ? String(d.cp).trim() : null;
  const regimen = /^\d{3}$/.test(String(d.regimen || '').trim()) ? String(d.regimen).trim() : null;

  const ex = await query<any>(
    `SELECT id, COALESCE(producto,'NEXO') AS producto FROM companies
      WHERE UPPER(rfc) = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [rfc]);

  let companyId: string, creada = false;
  if (ex.rows.length) {
    const e = ex.rows[0];
    companyId = e.id;
    const producto = e.producto === 'IVA' || e.producto === 'AMBOS' ? e.producto : 'AMBOS';
    // Sólo rellena lo que falte: nunca pisa datos fiscales capturados en NEXO.
    await query(
      `UPDATE companies SET producto = $2,
              postal_code = COALESCE(postal_code, $3), email = COALESCE(email, $4),
              phone = COALESCE(phone, $5), updated_at = NOW()
        WHERE id = $1`, [companyId, producto, cp, correo, d.telefono || null]);
  } else {
    const r = await query<{ id: string }>(
      `INSERT INTO companies
         (rfc, business_name, fiscal_regime, postal_code, email, phone, contact_email,
          is_active, verified_with_sat, next_invoice_folio, default_invoice_series, subscription_plan,
          prueba_inicio, producto)
       VALUES ($1,$2,$3,$4,$5,$6,$5, true, false, 1, 'F', 'STARTER', NOW(), 'IVA')
       RETURNING id`,
      [rfc, razon, regimen || '612', cp, correo, d.telefono || null]);
    companyId = r.rows[0].id;
    creada = true;
  }
  logger.info(`[integracion-iva] ${creada ? 'alta' : 'actualiza'} ${rfc} (${d.motivo || 'REGISTRO'}) → ${companyId}`);
  res.json({ success: true, data: { companyId, creada } });
}));

export default router;
