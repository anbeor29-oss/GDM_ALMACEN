/**
 * admin-emisores.routes — Súper Admin → «Emisor de facturas».
 *
 * Configura qué empresa(s) emiten los CFDI de cobro a los usuarios (GRUPO HCGM
 * y, si se quiere, más de una), su correo (SMTP) y los datos del depósito que se
 * le muestran al cliente. Reemplaza el candado por variable de entorno
 * PLATFORM_COMPANY_RFC (que queda como respaldo si no hay emisora marcada).
 *
 * Todo se apoya en la tabla `companies`: una emisora es una empresa normal (con
 * su CSD y su SMTP) marcada con `es_emisor_plataforma`; una sola queda como
 * `emisor_predeterminado`.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { requireSuperAdmin, audit } from './admin.middleware';
import { query } from '../../config/database';
import { encryptPass, invalidateSMTPCache, sendTestMail } from '../mailer/mailer.service';

const router = Router();
router.use(authenticateToken);
router.use(requireSuperAdmin);

// "tiene_csd": el CSD puede vivir en la BD (csd_key_data / csd_key_encrypted) o,
// en instalaciones viejas, como archivo (csd_key_path). Se cubren los tres.
const COLS = `id, rfc, business_name,
  COALESCE(es_emisor_cobro,false)       AS es_emisor,
  COALESCE(emisor_predeterminado,false) AS predeterminado,
  (csd_key_data IS NOT NULL OR csd_key_encrypted IS NOT NULL OR csd_key_path IS NOT NULL) AS tiene_csd,
  mail_host, mail_port, mail_secure, mail_user, mail_from,
  (mail_pass_enc IS NOT NULL) AS tiene_smtp,
  deposito_banco, deposito_titular, deposito_clabe, deposito_cuenta,
  deposito_referencia, deposito_notas`;

/** GET /admin/emisores — emisoras actuales + empresas candidatas + RFC del env. */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const emisoras = (await query<any>(
    `SELECT ${COLS} FROM companies
      WHERE es_emisor_cobro = TRUE AND deleted_at IS NULL
      ORDER BY emisor_predeterminado DESC, business_name`)).rows;
  const candidatas = (await query<any>(
    `SELECT id, rfc, business_name, COALESCE(es_emisor_cobro,false) AS es_emisor
       FROM companies WHERE deleted_at IS NULL ORDER BY business_name`)).rows;
  res.json({
    success: true,
    data: { emisoras, candidatas, envRfc: process.env.PLATFORM_COMPANY_RFC?.trim().toUpperCase() || null },
  });
}));

/** POST /admin/emisores/:id — marca/desmarca emisora y/o predeterminada. */
router.post('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const esEmisor = req.body?.esEmisor === true || req.body?.esEmisor === 'true';
  const predeterminado = req.body?.predeterminado === true || req.body?.predeterminado === 'true';

  const emp = (await query<any>(`SELECT id FROM companies WHERE id=$1 AND deleted_at IS NULL`, [id])).rows[0];
  if (!emp) throw new ValidationError('La empresa no existe.');

  // Una emisora no puede ser predeterminada si deja de ser emisora.
  const predet = esEmisor && predeterminado;
  if (predet) {
    // Sólo una predeterminada: baja la bandera a las demás.
    await query(`UPDATE companies SET emisor_predeterminado = FALSE WHERE emisor_predeterminado = TRUE AND id <> $1`, [id]);
  }
  await query(
    `UPDATE companies SET es_emisor_cobro = $2, emisor_predeterminado = $3 WHERE id = $1`,
    [id, esEmisor, predet]);

  await audit(req, { action: 'EMISOR_SET', targetKind: 'company', targetId: id, payload: { esEmisor, predeterminado: predet } });
  res.json({ success: true });
}));

/** PUT /admin/emisores/:id/smtp — configura el SMTP de la emisora (reusa mailer). */
router.put('/:id/smtp', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { mail_host, mail_port, mail_secure, mail_user, mail_pass, mail_from } = req.body || {};
  if (!mail_host || !mail_user) throw new ValidationError('mail_host y mail_user son obligatorios.');

  const fields = ['mail_host=$1', 'mail_port=$2', 'mail_secure=$3', 'mail_user=$4', 'mail_from=$5', 'mail_updated_at=NOW()'];
  const values: any[] = [mail_host, Number(mail_port) || 587, mail_secure === true || mail_secure === 'true', mail_user, mail_from || mail_user];
  if (mail_pass && String(mail_pass).length > 0) {
    fields.push(`mail_pass_enc=$${values.length + 1}`);
    values.push(encryptPass(String(mail_pass)));
  }
  values.push(id);
  const r = await query(`UPDATE companies SET ${fields.join(', ')} WHERE id=$${values.length} AND deleted_at IS NULL`, values);
  if (!r.rowCount) throw new ValidationError('La empresa no existe.');
  invalidateSMTPCache(id);
  await audit(req, { action: 'EMISOR_SMTP', targetKind: 'company', targetId: id, payload: { mail_host, mail_user } });
  res.json({ success: true });
}));

/** POST /admin/emisores/:id/smtp/test — manda un correo de prueba al admin. */
router.post('/:id/smtp/test', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const to = (req.body?.to && String(req.body.to).trim()) || (req as any).user?.email;
  if (!to) throw new ValidationError('Indica un correo de destino.');
  try {
    await sendTestMail(id, to);
    res.json({ success: true, message: `Correo de prueba enviado a ${to}.` });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e?.message || 'No se pudo enviar la prueba.' });
  }
}));

/** PUT /admin/emisores/:id/deposito — datos bancarios que se le muestran al cliente. */
router.put('/:id/deposito', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const b = req.body || {};
  const clabe = String(b.deposito_clabe || '').replace(/\D/g, '');
  if (clabe && clabe.length !== 18) throw new ValidationError('La CLABE debe tener 18 dígitos.');
  const r = await query(
    `UPDATE companies SET deposito_banco=$2, deposito_titular=$3, deposito_clabe=$4,
            deposito_cuenta=$5, deposito_referencia=$6, deposito_notas=$7, deposito_updated_at=NOW()
      WHERE id=$1 AND deleted_at IS NULL`,
    [id, b.deposito_banco || null, b.deposito_titular || null, clabe || null,
     b.deposito_cuenta || null, b.deposito_referencia || null, b.deposito_notas || null]);
  if (!r.rowCount) throw new ValidationError('La empresa no existe.');
  await audit(req, { action: 'EMISOR_DEPOSITO', targetKind: 'company', targetId: id });
  res.json({ success: true });
}));

export default router;
