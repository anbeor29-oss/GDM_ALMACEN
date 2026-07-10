/**
 * Endpoints para subir certificados (CSD: .cer + .key + contraseña) y logo de la empresa.
 *
 * Los archivos se guardan en `uploads/companies/{companyId}/` (fuera del bundle TS).
 * La contraseña del CSD se cifra con AES-256-GCM usando ENCRYPTION_KEY del .env.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError, ForbiddenError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import { config } from '../../config/environment';
import logger from '../../middleware/logger';

const router = Router();
router.use(authenticateToken);

const UPLOAD_ROOT = path.join(__dirname, '..', '..', '..', 'uploads', 'companies');

function ensureCompanyDir(companyId: string): string {
  const dir = path.join(UPLOAD_ROOT, companyId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function checkAccess(req: Request, companyId: string) {
  if (req.user?.companyId !== companyId && req.user?.role !== 'ADMIN') {
    throw new ForbiddenError('You do not have access to this company');
  }
}

/* ------------ Cifrado de contraseña del CSD ------------ */

function getKey(): Buffer {
  // ENCRYPTION_KEY es una cadena de 32 chars. La usamos como buffer directo.
  const raw = (config.encryption.key || '').padEnd(32, '0').slice(0, 32);
  return Buffer.from(raw, 'utf8');
}

function encryptPassword(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Formato: base64(iv | tag | enc)
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/* ------------ Multer (memoria, validación por extensión) ------------ */

const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

/* =====================================================================
 * POST /companies/:id/csd
 * multipart: cer (.cer), key (.key), + body.password
 * ===================================================================== */

router.post(
  '/:id/csd',
  memUpload.fields([
    { name: 'cer', maxCount: 1 },
    { name: 'key', maxCount: 1 },
  ]),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    checkAccess(req, id);

    const files = req.files as Record<string, Express.Multer.File[]>;
    const cer = files?.cer?.[0];
    const key = files?.key?.[0];
    const password = String(req.body?.password || '');

    if (!cer || !key) throw new ValidationError('Se requieren los archivos .cer y .key');
    if (!password) throw new ValidationError('Se requiere la contraseña del CSD');

    // Validación simple por extensión
    if (!/\.cer$/i.test(cer.originalname)) {
      throw new ValidationError('El archivo del certificado debe terminar en .cer');
    }
    if (!/\.key$/i.test(key.originalname)) {
      throw new ValidationError('El archivo de llave debe terminar en .key');
    }

    const dir = ensureCompanyDir(id);
    const cerPath = path.join(dir, 'csd.cer');
    const keyPath = path.join(dir, 'csd.key');
    fs.writeFileSync(cerPath, cer.buffer);
    fs.writeFileSync(keyPath, key.buffer);

    const encrypted = encryptPassword(password);
    await query(
      `UPDATE companies
          SET csd_cer_path = $1,
              csd_key_path = $2,
              csd_password_encrypted = $3,
              csd_uploaded_at = NOW(),
              updated_at = NOW()
        WHERE id = $4`,
      [cerPath, keyPath, encrypted, id]
    );

    logger.info(`CSD subido para empresa ${id} (${cer.originalname}, ${key.originalname})`);

    res.status(200).json({
      success: true,
      message: 'CSD guardado correctamente',
      data: { cer: cer.originalname, key: key.originalname, uploadedAt: new Date().toISOString() },
    });
  })
);

/* =====================================================================
 * GET /companies/:id/csd-status — qué tiene cargado (sin exponer secretos)
 * ===================================================================== */

router.get(
  '/:id/csd-status',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    checkAccess(req, id);

    const r = await query<{
      csd_uploaded_at: string | null;
      logo_uploaded_at: string | null;
      has_cer: boolean;
      has_key: boolean;
      has_password: boolean;
      has_logo: boolean;
    }>(
      `SELECT csd_uploaded_at, logo_uploaded_at,
              csd_cer_path IS NOT NULL AS has_cer,
              csd_key_path IS NOT NULL AS has_key,
              csd_password_encrypted IS NOT NULL AS has_password,
              logo_path IS NOT NULL AS has_logo
         FROM companies WHERE id = $1`,
      [id]
    );
    res.status(200).json({ success: true, data: r.rows[0] || {} });
  })
);

/* =====================================================================
 * POST /companies/:id/logo  — multipart: logo (imagen)
 * ===================================================================== */

router.post(
  '/:id/logo',
  memUpload.single('logo'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    checkAccess(req, id);

    const file = req.file;
    if (!file) throw new ValidationError('Falta el archivo "logo"');
    if (!/^image\//.test(file.mimetype)) {
      throw new ValidationError(`El archivo debe ser una imagen, recibido: ${file.mimetype}`);
    }
    if (file.size > 1_048_576) {
      throw new ValidationError(`El logo excede 1 MB (${Math.round(file.size / 1024)} KB). Comprímelo antes.`);
    }

    // Guardado dual: BD (persistente en Render) + filesystem (dev local).
    // En Render sin disco persistente, el filesystem se pierde en cada deploy —
    // pero la BYTEA de la BD siempre está.
    try {
      const dir = ensureCompanyDir(id);
      for (const f of fs.readdirSync(dir)) {
        if (/^logo\./.test(f)) fs.unlinkSync(path.join(dir, f));
      }
      const ext = (file.originalname.match(/\.[a-zA-Z0-9]+$/) || ['.png'])[0].toLowerCase();
      const logoPath = path.join(dir, 'logo' + ext);
      fs.writeFileSync(logoPath, file.buffer);
      await query(
        `UPDATE companies SET logo_path = $1 WHERE id = $2`,
        [logoPath, id]
      );
    } catch (_e) {
      // FS puede fallar en Render (read-only o sin permiso) — no es error fatal
      // porque el logo también quedará en la BD.
    }

    await query(
      `UPDATE companies
          SET logo_data = $1,
              logo_mimetype = $2,
              logo_uploaded_at = NOW(),
              updated_at = NOW()
        WHERE id = $3`,
      [file.buffer, file.mimetype, id]
    );

    res.status(200).json({
      success: true,
      message: 'Logo guardado',
      data: { sizeKB: Math.round(file.size / 1024), mimetype: file.mimetype },
    });
  })
);

/* =====================================================================
 * GET /companies/:id/logo  — sirve la imagen (no requiere auth para que el
 *   <img src> del frontend funcione directo)
 * ===================================================================== */

const publicRouter = Router();

publicRouter.get(
  '/:id/logo',
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    // Prioridad: 1) BD (BYTEA — persistente en Render).
    //            2) filesystem (fallback dev local).
    const r = await query<{ logo_data: Buffer | null; logo_mimetype: string | null; logo_path: string | null }>(
      `SELECT logo_data, logo_mimetype, logo_path FROM companies WHERE id = $1`,
      [id]
    );
    const row = r.rows[0];
    if (!row) { res.status(404).end(); return; }

    if (row.logo_data) {
      res.set('Content-Type', row.logo_mimetype || 'image/png');
      res.set('Cache-Control', 'public, max-age=300');
      res.send(row.logo_data);
      return;
    }
    if (row.logo_path && fs.existsSync(row.logo_path)) {
      res.sendFile(row.logo_path);
      return;
    }
    res.status(404).end();
  })
);

export default router;
export { publicRouter as publicLogoRouter };
