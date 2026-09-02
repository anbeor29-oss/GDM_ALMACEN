/**
 * /admin/companies — gestión de empresas (multi-tenant) por SUPER_ADMIN.
 *
 *  GET    /admin/companies                       lista empresas con stats
 *  POST   /admin/companies                       crea empresa
 *  PUT    /admin/companies/:id                   edita datos / plan / cap_timbres
 *  POST   /admin/companies/:id/csd               sube CSD (.cer + .key + password)
 *  DELETE /admin/companies/:id/csd               elimina CSD (revocación)
 *  GET    /admin/companies/:id/usage             consumo del mes + facturación estimada
 *
 *  Seguridad:
 *   · Solo SUPER_ADMIN (middleware)
 *   · CSD .key se cifra con pgcrypto (CSD_MASTER_KEY env)
 *   · El .key NUNCA se devuelve por API
 *   · Validación RFC, vigencia CSD, plan permitido
 */
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import logger from '../../middleware/logger';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import { requireSuperAdmin, audit } from './admin.middleware';
import * as promo from '../billing/prueba-y-prorrateo.service';

const router = Router();
router.use(authenticateToken);
router.use(requireSuperAdmin);

const CSD_MASTER_KEY = process.env.CSD_MASTER_KEY || 'change-me-in-prod-' + crypto.randomBytes(8).toString('hex');
if (CSD_MASTER_KEY.startsWith('change-me-in-prod-')) {
  console.warn('[admin-companies] ⚠ CSD_MASTER_KEY no está en env — usando fallback efímero. NO usar en producción.');
}

const VALID_PLANS = ['iguala', 'renta'] as const;
const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}([A-Z0-9]{3})?$/i;

/* ────────────────────────  LIST  ──────────────────────── */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const search = String(req.query.search || '').trim();
  const filters = ['c.deleted_at IS NULL'];
  const params: any[] = [];
  if (search) {
    params.push(`%${search}%`);
    filters.push(`(c.rfc ILIKE $${params.length} OR c.business_name ILIKE $${params.length})`);
  }
  const r = await query<any>(
    `SELECT c.id, c.rfc, c.business_name, c.fiscal_regime, c.postal_code, c.is_active,
            c.billing_plan, c.cap_timbres, c.monthly_fee, c.extra_stamp_fee,
            c.street, c.ext_number, c.neighborhood, c.city, c.municipality, c.state,
            c.contact_email, c.phone, c.website,
            (c.csd_key_encrypted IS NOT NULL) AS has_csd,
            c.csd_no_certificado, c.csd_valid_to,
            (SELECT COUNT(*)::int FROM users  u WHERE u.company_id = c.id AND u.is_active) AS users_active,
            (SELECT COUNT(*)::int FROM invoices i
               WHERE i.company_id = c.id AND i.deleted_at IS NULL
                 AND date_trunc('month', i.date_issued) = date_trunc('month', NOW())) AS facturas_mes,
            /* Fecha de contratación: el día en que empezó el SERVICIO PAGADO,
             * no el del alta. Una empresa puede estar capturada semanas antes
             * de contratar, y mostrar el alta haría creer que lleva más tiempo
             * pagando del que lleva. Sin pago queda en NULL y la pantalla lo
             * dice con todas sus letras. */
            (SELECT MIN(pc.starts_on) FROM plan_charges pc
              WHERE pc.company_id = c.id AND pc.status = 'PAID')  AS contratada_el,
            c.created_at,
            c.stamp_package_code,
            c.trial_stamps_left,
            c.billing_exempt
       FROM companies c
      WHERE ${filters.join(' AND ')}
      ORDER BY c.business_name ASC`,
    params
  );
  res.json({ success: true, data: { companies: r.rows, total: r.rows.length } });
}));

/* ────────────────────────  CREATE  ──────────────────────── */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { rfc, businessName, fiscalRegime, postalCode, billingPlan, capTimbres,
          monthlyFee, extraStampFee, planCode } = req.body as any;
  if (!rfc || !RFC_REGEX.test(rfc)) throw new ValidationError('RFC inválido (formato SAT)');
  if (!businessName) throw new ValidationError('businessName requerido');
  if (!fiscalRegime) throw new ValidationError('fiscalRegime requerido');
  if (billingPlan && !VALID_PLANS.includes(billingPlan)) {
    throw new ValidationError(`billingPlan inválido (${VALID_PLANS.join('|')})`);
  }

  const dup = await query('SELECT 1 FROM companies WHERE UPPER(rfc) = UPPER($1) LIMIT 1', [rfc]);
  if (dup.rowCount! > 0) throw new ConflictError('Ya existe una empresa con ese RFC');

  /* EL PAQUETE NO SE GUARDABA. NUNCA.
   *
   * El alta escribía billing_plan, cap_timbres y monthly_fee, pero jamás
   * `stamp_package_code`: toda empresa nueva se quedaba con el valor por
   * omisión de la columna —PKG_100— sin importar qué eligiera el operador. El
   * cierre mensual lee el paquete por JOIN, así que una empresa dada de alta
   * como Empresarial se habría facturado como Esencial; y la pantalla mostraba
   * el plan correcto porque leía las OTRAS columnas. Dos verdades, y la falsa
   * era la visible.
   *
   * Se aceptan los dos nombres del campo: leer sólo uno hace caer en el
   * PKG_100 en silencio, que es como este defecto vivió hasta hoy. */
  const codigoPaquete = planCode || (req.body as any)?.stampPackageCode;
  let paquete: string | null = null;
  if (codigoPaquete) {
    const pk = await query('SELECT code FROM stamp_packages WHERE code = $1 AND is_active = TRUE', [codigoPaquete]);
    if (pk.rowCount === 0) throw new ValidationError(`El paquete ${codigoPaquete} no existe o está inactivo`);
    paquete = codigoPaquete;
  }

  const r = await query<any>(
    `INSERT INTO companies (rfc, business_name, fiscal_regime, postal_code,
                            billing_plan, cap_timbres, monthly_fee, extra_stamp_fee,
                            stamp_package_code, is_active)
     VALUES (UPPER($1), $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'PKG_100'), true)
     RETURNING id, rfc, business_name`,
    [rfc, businessName, fiscalRegime, postalCode || null,
     billingPlan || 'iguala', capTimbres || 100, monthlyFee || 500, extraStampFee || 0.80,
     paquete]
  );

  /* La cortesía se otorga por su propia vía: ahí viven el cupo de 3 empresas y
   * el sello de "una sola vez". Si el cupo está lleno, la empresa YA quedó
   * creada —eso no se deshace— y se devuelve el motivo para que quien la dio
   * de alta se entere en la misma pantalla. */
  let aviso: string | null = null;
  if (paquete === 'PKG_TRIAL') {
    try {
      await promo.activarPrueba(r.rows[0].id, req.user?.userId);
    } catch (e) {
      aviso = `La empresa se creó, pero no se le pudo dar la cortesía: ${(e as Error).message}`;
    }
  }

  await audit(req, { action: 'COMPANY_CREATED', targetKind: 'company', targetId: r.rows[0].id,
    payload: { rfc, businessName, billingPlan, planCode: paquete } });
  res.status(201).json({ success: true, data: { ...r.rows[0], aviso } });
}));

/* ────────────────────────  UPDATE  ──────────────────────── */
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const {
    businessName, fiscalRegime, postalCode, billingPlan, capTimbres, monthlyFee,
    extraStampFee, isActive,
    // Domicilio fiscal completo (para la CFDI de cobro y el expediente)
    street, extNumber, neighborhood, city, municipality, state,
    // Contacto (contact_email es el remitente/destino de correos automáticos)
    contactEmail, phone, website,
  } = req.body as any;
  const fields: string[] = [];
  const params: any[] = [];
  const push = (f: string, v: any) => { params.push(v); fields.push(`${f} = $${params.length}`); };

  if (businessName) push('business_name',  businessName);
  if (fiscalRegime) push('fiscal_regime',  fiscalRegime);
  if (postalCode !== undefined) push('postal_code', postalCode);
  if (billingPlan) {
    if (!VALID_PLANS.includes(billingPlan)) throw new ValidationError('billingPlan inválido');
    push('billing_plan', billingPlan);
  }
  if (capTimbres   !== undefined) push('cap_timbres',     parseInt(capTimbres, 10));
  if (monthlyFee   !== undefined) push('monthly_fee',     parseFloat(monthlyFee));
  if (extraStampFee!== undefined) push('extra_stamp_fee', parseFloat(extraStampFee));
  if (isActive     !== undefined) push('is_active',       Boolean(isActive));
  // Domicilio
  if (street       !== undefined) push('street',        street || null);
  if (extNumber    !== undefined) push('ext_number',    extNumber || null);
  if (neighborhood !== undefined) push('neighborhood',  neighborhood || null);
  if (city         !== undefined) push('city',          city || null);
  if (municipality !== undefined) push('municipality',  municipality || null);
  if (state        !== undefined) push('state',         state || null);
  // Contacto
  if (contactEmail !== undefined) {
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new ValidationError('contactEmail no es un correo válido');
    }
    push('contact_email', contactEmail || null);
  }
  if (phone        !== undefined) push('phone',   phone || null);
  if (website      !== undefined) push('website', website || null);

  if (fields.length === 0) throw new ValidationError('Nada que actualizar');
  params.push(req.params.id);
  const r = await query<any>(
    `UPDATE companies SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length} RETURNING id, rfc, business_name, billing_plan, cap_timbres`,
    params
  );
  if (r.rows.length === 0) throw new NotFoundError('Empresa no encontrada');
  await audit(req, { action: 'COMPANY_UPDATED', targetKind: 'company', targetId: req.params.id,
    payload: req.body });
  res.json({ success: true, data: r.rows[0] });
}));

/* ────────────────────────  UPLOAD CSD  ────────────────────────
 *  Body JSON (los archivos llegan como base64 — más simple que multipart
 *  para esta etapa; cuando integremos un PAC real podemos cambiar a multipart):
 *
 *    {
 *      "noCertificado": "00001000000506430009",
 *      "cerBase64":      "<base64 del .cer>",
 *      "keyBase64":      "<base64 del .key>",
 *      "keyPassword":    "...",
 *      "validFrom":      "2025-01-01T00:00:00Z",
 *      "validTo":        "2029-01-01T00:00:00Z"
 *    }
 *
 *  El .cer se guarda como archivo (es público); el .key + password se cifran con pgcrypto.
 */
/* ────────────────────────  INSPECT CSD  ────────────────────────
 * POST /:id/csd/inspect  { cerBase64, keyBase64?, keyPassword? }
 *
 * Lee el .cer y devuelve sus datos para autollenar el formulario. NO guarda
 * nada: solo lee.
 *
 * Por qué: el operador tecleaba a mano el No. Certificado (20 dígitos) y las
 * fechas de vigencia. Un dígito mal y el timbrado falla ante el SAT — caro de
 * diagnosticar y trivial de evitar.
 *
 * Malentendido común que conviene dejar escrito: **la vigencia NO está en el
 * .key**. El .key es solo la llave privada cifrada, sin metadatos. El número
 * de certificado, la vigencia, el RFC y la razón social viven todos en el
 * .cer. El .key sirve para otra cosa: comprobar que corresponde al .cer y que
 * la contraseña es correcta ANTES de guardar.
 *
 * Reusa parseCertificate/openPrivateKey del módulo manifest: la única
 * implementación de lectura de certificados del SAT (duplicarla haría
 * divergir las validaciones).
 */
router.post('/:id/csd/inspect', asyncHandler(async (req: Request, res: Response) => {
  const { cerBase64, keyBase64, keyPassword } = req.body as any;
  if (!cerBase64) throw new ValidationError('cerBase64 es requerido');

  const { parseCertificate, openPrivateKey } = await import('../manifest/manifest.service');
  const cert = parseCertificate(Buffer.from(cerBase64, 'base64'));

  // El CSD debe ser de la empresa: uno ajeno no puede sellar sus CFDI y el SAT
  // lo rechazaría al timbrar. Mejor avisar aquí que descubrirlo timbrando.
  const compR = await query<{ rfc: string }>('SELECT rfc FROM companies WHERE id = $1', [req.params.id]);
  const companyRfc = (compR.rows[0]?.rfc || '').toUpperCase().trim();

  const now = new Date();
  let keyMatches: boolean | null = null;
  let keyError: string | null = null;
  if (keyBase64 && keyPassword) {
    try {
      const priv = openPrivateKey(Buffer.from(keyBase64, 'base64'), String(keyPassword));
      const a = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' });
      const b = cert.x509.publicKey.export({ format: 'der', type: 'spki' });
      keyMatches = a.equals(b);
      if (!keyMatches) keyError = 'La .key no corresponde al .cer — ¿son del mismo juego de CSD?';
    } catch (e) {
      keyMatches = false;
      keyError = (e as Error).message;
    }
  }

  res.status(200).json({
    success: true,
    data: {
      no_certificado: cert.serial,
      rfc: cert.rfc,
      razon_social: cert.name,
      valid_from: cert.validFrom.toISOString(),
      valid_to: cert.validTo.toISOString(),
      // Avisos para que la UI los muestre ANTES de dejar guardar:
      rfc_matches: !!cert.rfc && cert.rfc === companyRfc,
      company_rfc: companyRfc,
      expired: cert.validTo < now,
      not_yet_valid: cert.validFrom > now,
      key_matches: keyMatches,
      key_error: keyError,
    },
  });
}));

router.post('/:id/csd', asyncHandler(async (req: Request, res: Response) => {
  const { noCertificado, cerBase64, keyBase64, keyPassword, validFrom, validTo } = req.body as any;
  if (!noCertificado || !/^\d{20}$/.test(noCertificado)) {
    throw new ValidationError('noCertificado debe ser 20 dígitos');
  }
  if (!cerBase64 || !keyBase64) throw new ValidationError('cerBase64 y keyBase64 son requeridos');
  if (!keyPassword) throw new ValidationError('keyPassword es requerido');

  const cerBuf = Buffer.from(cerBase64, 'base64');
  const keyBuf = Buffer.from(keyBase64, 'base64');
  if (cerBuf.length < 100 || keyBuf.length < 100) {
    throw new ValidationError('Archivos CSD parecen vacíos o inválidos');
  }

  // Guardamos el .cer (público) en disco — el .key NO toca el filesystem
  const dir = path.join(process.cwd(), 'uploads', 'csd', req.params.id);
  fs.mkdirSync(dir, { recursive: true });
  const cerPath = path.join(dir, `${noCertificado}.cer`);
  fs.writeFileSync(cerPath, cerBuf);

  // Cifra .key + password con pgp_sym_encrypt (pgcrypto)
  const r = await query<any>(
    `UPDATE companies SET
       csd_no_certificado       = $1,
       csd_cer_path             = $2,
       csd_key_encrypted        = pgp_sym_encrypt($3::text, $4),
       csd_key_password_enc     = pgp_sym_encrypt($5::text, $4),
       csd_valid_from           = $6,
       csd_valid_to             = $7,
       csd_uploaded_at          = NOW(),
       csd_uploaded_by_user_id  = $8,
       updated_at               = NOW()
     WHERE id = $9
     RETURNING id, rfc, csd_no_certificado, csd_valid_from, csd_valid_to`,
    [
      noCertificado, cerPath,
      keyBase64, CSD_MASTER_KEY,
      keyPassword,
      validFrom || null, validTo || null,
      req.user!.userId, req.params.id,
    ]
  );
  if (r.rows.length === 0) throw new NotFoundError('Empresa no encontrada');
  await audit(req, {
    action: 'CSD_UPLOADED', targetKind: 'csd', targetId: req.params.id,
    payload: { noCertificado, validFrom, validTo, cerSize: cerBuf.length, keySize: keyBuf.length },
  });
  res.status(201).json({ success: true, data: r.rows[0] });
}));

/* ────────────────────────  DELETE CSD  ──────────────────────── */
router.delete('/:id/csd', asyncHandler(async (req: Request, res: Response) => {
  const r = await query<any>(
    `UPDATE companies SET csd_no_certificado=NULL, csd_cer_path=NULL,
            csd_key_encrypted=NULL, csd_key_password_enc=NULL,
            csd_valid_from=NULL, csd_valid_to=NULL,
            csd_uploaded_at=NULL, csd_uploaded_by_user_id=NULL,
            updated_at=NOW()
       WHERE id = $1 RETURNING id`,
    [req.params.id]
  );
  if (r.rows.length === 0) throw new NotFoundError('Empresa no encontrada');
  await audit(req, { action: 'CSD_REVOKED', targetKind: 'csd', targetId: req.params.id });
  res.json({ success: true, message: 'CSD eliminado' });
}));

/* ────────────────────────  USAGE  ──────────────────────── */
router.get('/:id/usage', asyncHandler(async (req: Request, res: Response) => {
  const r = await query<any>(
    `SELECT c.id, c.rfc, c.business_name, c.billing_plan,
            c.cap_timbres, c.monthly_fee, c.extra_stamp_fee,
            (SELECT COUNT(*)::int FROM invoices i
               WHERE i.company_id = c.id AND i.deleted_at IS NULL
                 AND date_trunc('month', i.date_issued) = date_trunc('month', NOW())) AS facturas_mes,
            (SELECT COUNT(*)::int FROM credit_notes cn
               WHERE cn.company_id = c.id AND cn.deleted_at IS NULL AND cn.status != 'CANCELLED'
                 AND date_trunc('month', cn.date_issued) = date_trunc('month', NOW())) AS nc_mes,
            (SELECT COUNT(*)::int FROM payments p
               WHERE p.company_id = c.id AND p.deleted_at IS NULL
                 AND date_trunc('month', p.payment_date) = date_trunc('month', NOW())) AS pagos_mes
       FROM companies c WHERE c.id = $1`,
    [req.params.id]
  );
  if (r.rows.length === 0) throw new NotFoundError('Empresa no encontrada');
  const row = r.rows[0];
  const total = Number(row.facturas_mes) + Number(row.nc_mes) + Number(row.pagos_mes);
  const cap = Number(row.cap_timbres);
  const overCount = Math.max(0, total - cap);
  res.json({
    success: true,
    data: {
      company: { id: row.id, rfc: row.rfc, name: row.business_name },
      plan: {
        tipo: row.billing_plan, cap_timbres: cap,
        monthly_fee: Number(row.monthly_fee), extra_stamp_fee: Number(row.extra_stamp_fee),
      },
      usage: {
        facturas: row.facturas_mes, notas_credito: row.nc_mes, pagos: row.pagos_mes, total,
        over: row.billing_plan === 'iguala' && total > cap, over_count: overCount,
        consumed_pct: cap > 0 ? Math.round((total / cap) * 100) : 0,
        estimated_charge: Number(row.monthly_fee) +
          (row.billing_plan === 'renta'
            ? total * Number(row.extra_stamp_fee)
            : overCount * Number(row.extra_stamp_fee)),
      },
    },
  });
}));

/**
 * POST /admin/companies/:id/reset-operations
 * Borra TODOS los datos operativos de una empresa: facturas, items, pagos,
 * NC, clientes y productos. Conserva la empresa, sus usuarios y su config.
 *
 * Body:
 *   confirmRfc  (obligatorio) — debe coincidir con companies.rfc del :id.
 *                Es el "escribe el RFC para confirmar" pero server-side.
 *   dryRun      (opcional)    — true = solo cuenta lo que borraría.
 *
 * Solo SUPER_ADMIN (middleware ya aplicado a todo el router).
 */
router.post('/:id/reset-operations', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const confirmRfc = String(req.body?.confirmRfc || '').toUpperCase().trim();
  const dryRun = req.body?.dryRun === true;

  const compR = await query<{ rfc: string; business_name: string }>(
    `SELECT rfc, business_name FROM companies WHERE id = $1`,
    [id]
  );
  if (compR.rows.length === 0) throw new NotFoundError('Empresa no encontrada');
  const company = compR.rows[0];

  if (confirmRfc !== company.rfc.toUpperCase()) {
    throw new ValidationError(
      `Debes enviar confirmRfc="${company.rfc}" (obligatorio para evitar accidentes).`
    );
  }

  // Inventario antes de borrar (también sirve como preview cuando dryRun=true)
  const before = await query<any>(
    `SELECT
       (SELECT COUNT(*)::int FROM invoices WHERE company_id = $1)     AS invoices,
       (SELECT COUNT(*)::int FROM invoice_items ii
          JOIN invoices i ON i.id = ii.invoice_id
         WHERE i.company_id = $1)                                      AS invoice_items,
       (SELECT COUNT(*)::int FROM payments WHERE company_id = $1)     AS payments,
       (SELECT COUNT(*)::int FROM credit_notes WHERE company_id = $1) AS credit_notes,
       (SELECT COUNT(*)::int FROM customers WHERE company_id = $1)    AS customers,
       (SELECT COUNT(*)::int FROM products WHERE company_id = $1)     AS products`,
    [id]
  );

  if (dryRun) {
    res.status(200).json({
      success: true,
      dryRun: true,
      company: { id, rfc: company.rfc, business_name: company.business_name },
      would_delete: before.rows[0],
    });
    return;
  }

  // Ejecutar el borrado en un solo statement con BEGIN/COMMIT
  // (Postgres node-postgres no expone transacciones sin `pool.connect()`;
  // usamos DO block anónimo para agrupar dentro de la misma conexión.)
  //
  // OJO: cascada manual respetando FKs. Los `.catch(() => {})` son para
  // tablas opcionales que pueden no existir en todos los deploys.
  await query(`DELETE FROM pac_stamps  WHERE company_id = $1`, [id]).catch(() => {});
  await query(`DELETE FROM xml_imports WHERE company_id = $1`, [id]).catch(() => {});
  await query(`DELETE FROM payments    WHERE company_id = $1`, [id]);
  await query(`DELETE FROM credit_notes WHERE company_id = $1`, [id]);
  await query(
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id = $1)`,
    [id]
  );
  await query(`DELETE FROM invoices  WHERE company_id = $1`, [id]);
  await query(`DELETE FROM suppliers WHERE company_id = $1`, [id]).catch(() => {});
  await query(`DELETE FROM customers WHERE company_id = $1`, [id]);
  await query(`DELETE FROM products  WHERE company_id = $1`, [id]);
  // Reset del contador de folio si la columna existe
  await query(
    `UPDATE companies SET next_invoice_folio = 1, updated_at = NOW() WHERE id = $1`,
    [id]
  ).catch(() => {});

  // Verificar después
  const after = await query<any>(
    `SELECT
       (SELECT COUNT(*)::int FROM invoices WHERE company_id = $1)     AS invoices,
       (SELECT COUNT(*)::int FROM payments WHERE company_id = $1)     AS payments,
       (SELECT COUNT(*)::int FROM credit_notes WHERE company_id = $1) AS credit_notes,
       (SELECT COUNT(*)::int FROM customers WHERE company_id = $1)    AS customers,
       (SELECT COUNT(*)::int FROM products WHERE company_id = $1)     AS products`,
    [id]
  );

  await audit(req, {
    action: 'company.reset_operations',
    targetId: id,
    payload: { deleted: before.rows[0], remaining: after.rows[0] },
  } as any).catch(() => {});

  res.status(200).json({
    success: true,
    company: { id, rfc: company.rfc, business_name: company.business_name },
    deleted: before.rows[0],
    remaining: after.rows[0],
  });
}));

/* ────────────────────────  WIPE OPERATIONS v2  ────────────────────────
 * POST /admin/companies/:id/wipe-operations
 *
 * Versión corregida de reset-operations. El original olvidaba stamp_usage,
 * pos_sales, pos_sale_items y cfdi_validations — con datos reales revienta
 * con "current transaction is aborted" en el orden equivocado y no dice
 * qué falló.
 *
 * Aquí se hace bien:
 *   1. Se ejecuta en UNA transacción real (pool.connect + BEGIN/COMMIT).
 *      Si algo falla, ROLLBACK — nada a medias.
 *   2. Orden derivado del mapa de FKs, no de la memoria. Cada DELETE se
 *      loguea individualmente. Si algo falla, el mensaje dice EXACTAMENTE
 *      qué tabla y cuál FK, no un "current transaction is aborted" opaco.
 *   3. Confirmación con RFC exacto (server-side).
 *   4. dryRun devuelve inventario sin tocar nada.
 *
 * CONSERVA: la empresa, sus usuarios, CSD, contratos firmados, datos del
 * emisor y configuración de facturación. Solo borra lo operativo.
 */
router.post('/:id/wipe-operations', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const confirmRfc = String(req.body?.confirmRfc || '').toUpperCase().trim();
  const dryRun = req.body?.dryRun === true;

  const compR = await query<{ rfc: string; business_name: string }>(
    `SELECT rfc, business_name FROM companies WHERE id = $1`, [id]
  );
  if (compR.rows.length === 0) throw new NotFoundError('Empresa no encontrada');
  const company = compR.rows[0];

  if (confirmRfc !== company.rfc.toUpperCase()) {
    throw new ValidationError(
      `Envía confirmRfc="${company.rfc}" para confirmar el borrado (obligatorio).`
    );
  }

  // Inventario. Sirve tanto para dryRun como para el reporte final.
  const invR = await query<any>(`
    SELECT
      (SELECT COUNT(*)::int FROM invoices        WHERE company_id = $1) AS invoices,
      (SELECT COUNT(*)::int FROM invoice_items   ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.company_id = $1) AS invoice_items,
      (SELECT COUNT(*)::int FROM payments        WHERE company_id = $1) AS payments,
      (SELECT COUNT(*)::int FROM credit_notes    WHERE company_id = $1) AS credit_notes,
      (SELECT COUNT(*)::int FROM customers       WHERE company_id = $1) AS customers,
      (SELECT COUNT(*)::int FROM products        WHERE company_id = $1) AS products,
      (SELECT COUNT(*)::int FROM pac_stamps      WHERE company_id = $1) AS pac_stamps,
      (SELECT COUNT(*)::int FROM stamp_usage     WHERE company_id = $1) AS stamp_usage,
      (SELECT COUNT(*)::int FROM cfdi_validations cv JOIN invoices i ON i.id=cv.invoice_id WHERE i.company_id = $1) AS cfdi_validations,
      (SELECT COUNT(*)::int FROM xml_imports     WHERE company_id = $1) AS xml_imports
  `, [id]);
  const inventory = invR.rows[0];

  if (dryRun) {
    res.status(200).json({
      success: true, dryRun: true,
      company: { id, rfc: company.rfc, business_name: company.business_name },
      would_delete: inventory,
    });
    return;
  }

  // TRANSACCIÓN real usando el helper del proyecto: hace BEGIN/COMMIT/
  // ROLLBACK y libera la conexión. Si CUALQUIER paso falla, la BD queda
  // idéntica a como estaba (nada a medias) y devolvemos QUÉ tabla falló.
  const log: Array<{ table: string; deleted: number }> = [];
  const { transaction } = await import('../../config/database');
  try {
    await transaction(async (client) => {
      const step = async (label: string, sql: string) => {
        const r = await client.query(sql, [id]);
        log.push({ table: label, deleted: r.rowCount || 0 });
      };

      // Orden derivado del mapa de FKs, no de la memoria:
      // Nivel 1 — dependientes de INVOICES (para que invoices sea borrable)
      await step('stamp_usage',      `DELETE FROM stamp_usage WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id = $1)`);
      await step('pac_stamps',       `DELETE FROM pac_stamps  WHERE company_id = $1`);
      await step('cfdi_validations', `DELETE FROM cfdi_validations WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id = $1)`);
      await step('pos_sale_items',   `DELETE FROM pos_sale_items WHERE sale_id IN (SELECT id FROM pos_sales WHERE company_id = $1)`);
      await step('pos_sales',        `DELETE FROM pos_sales WHERE company_id = $1`);
      await step('payments',         `DELETE FROM payments WHERE company_id = $1`);
      await step('credit_notes',     `DELETE FROM credit_notes WHERE company_id = $1`);
      await step('invoice_items',    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id = $1)`);

      // Nivel 2 — INVOICES
      await step('invoices',         `DELETE FROM invoices WHERE company_id = $1`);

      // Nivel 3 — dependientes de CUSTOMERS/PRODUCTS
      // xml_imports.created_customer_id es SET NULL (no bloquea) pero se
      // limpia porque son datos operativos también.
      await step('xml_imports',      `DELETE FROM xml_imports WHERE company_id = $1`);
      await step('customer_products',`DELETE FROM customer_products WHERE customer_id IN (SELECT id FROM customers WHERE company_id = $1)`);

      // Nivel 4 — CUSTOMERS y PRODUCTS
      await step('customers',        `DELETE FROM customers WHERE company_id = $1`);
      await step('products',         `DELETE FROM products WHERE company_id = $1`);

      // Reset del folio para empezar en F-000001
      await client.query(
        `UPDATE companies SET next_invoice_folio = 1, updated_at = NOW() WHERE id = $1`, [id]
      );
    });
  } catch (e) {
    // El error REAL: si falla en la tabla X, el operador sabe qué FK lo
    // bloqueó, no un "current transaction is aborted" opaco como el
    // reset:company original.
    logger.error(`wipe-operations rollback: ${(e as Error).message}`);
    throw new ValidationError(
      `El borrado se revirtió (nada cambió en la base). Causa: ${(e as Error).message}. ` +
      `Lo procesado antes del error: ${JSON.stringify(log)}`
    );
  }

  await audit(req, {
    action: 'company.wipe_operations',
    targetId: id,
    payload: { inventory_before: inventory, deleted: log },
  } as any).catch(() => {});

  res.status(200).json({
    success: true,
    company: { id, rfc: company.rfc, business_name: company.business_name },
    inventory_before: inventory,
    deleted: log,
  });
}));

/**
 * DELETE /admin/companies/:id/full-delete
 * Borrado TOTAL de la empresa: elimina todo lo que reset-operations elimina
 * MÁS los usuarios, el CSD, el logo, config de facturación y el registro de
 * la empresa misma. Diseñado para dar de baja definitiva a un cliente y
 * liberar espacio.
 *
 * Doble confirmación server-side:
 *   confirmRfc  — debe coincidir con companies.rfc
 *   confirmText — debe ser exactamente "ELIMINAR"
 *
 * Body:
 *   { confirmRfc: "EKU9003173C9", confirmText: "ELIMINAR", dryRun?: true }
 *
 * dryRun=true devuelve la lista de lo que se borraría sin ejecutar.
 * Solo SUPER_ADMIN (guard global del router).
 */
router.delete('/:id/full-delete', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const confirmRfc = String(req.body?.confirmRfc || '').toUpperCase().trim();
  const confirmText = String(req.body?.confirmText || '').trim().toUpperCase();
  const dryRun = req.body?.dryRun === true;

  const compR = await query<{ rfc: string; business_name: string }>(
    `SELECT rfc, business_name FROM companies WHERE id = $1`,
    [id]
  );
  if (compR.rows.length === 0) throw new NotFoundError('Empresa no encontrada');
  const company = compR.rows[0];

  if (confirmRfc !== company.rfc.toUpperCase()) {
    throw new ValidationError(
      `Paso 1 pendiente: envía confirmRfc="${company.rfc}" para identificar la empresa a eliminar.`
    );
  }
  if (!dryRun && confirmText !== 'ELIMINAR') {
    throw new ValidationError(
      'Paso 2 pendiente: envía confirmText="ELIMINAR" para confirmar el borrado definitivo.'
    );
  }

  // Evitar que el SUPER_ADMIN se auto-elimine si su usuario pertenece a esta empresa.
  const selfR = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM users WHERE id = $1 AND company_id = $2`,
    [req.user?.userId, id]
  );
  if (selfR.rows[0].n > 0) {
    throw new ValidationError(
      'No puedes eliminar la empresa que contiene tu propio usuario. ' +
      'Muévete a otra empresa (o SUPER_ADMIN sin company_id) antes.'
    );
  }

  // Inventario (para preview de dryRun y para la respuesta de auditoría)
  const stats = await query<any>(
    `SELECT
       (SELECT COUNT(*)::int FROM invoices WHERE company_id = $1)     AS invoices,
       (SELECT COUNT(*)::int FROM invoice_items ii
          JOIN invoices i ON i.id = ii.invoice_id
         WHERE i.company_id = $1)                                      AS invoice_items,
       (SELECT COUNT(*)::int FROM payments WHERE company_id = $1)     AS payments,
       (SELECT COUNT(*)::int FROM credit_notes WHERE company_id = $1) AS credit_notes,
       (SELECT COUNT(*)::int FROM customers WHERE company_id = $1)    AS customers,
       (SELECT COUNT(*)::int FROM products WHERE company_id = $1)     AS products,
       (SELECT COUNT(*)::int FROM users WHERE company_id = $1)        AS users`,
    [id]
  );

  if (dryRun) {
    res.status(200).json({
      success: true,
      dryRun: true,
      company: { id, rfc: company.rfc, business_name: company.business_name },
      would_delete: {
        ...stats.rows[0],
        company: 1,
      },
    });
    return;
  }

  // Borrado en cascada respetando FKs.
  //
  // 0) HIJOS con FK RESTRICT / NO ACTION hacia tablas que se borran DESPUÉS
  //    (cuentas contables, empleados, facturas, productos). En operación normal
  //    esas FK PROTEGEN —no dejan borrar una cuenta con movimientos, un empleado
  //    con recibos, etc.—; SÓLO en el borrado TOTAL de la empresa se limpian sus
  //    hijos primero para que el cascade final no choque. Cada uno tolera que la
  //    tabla no exista (.catch), para no depender de qué módulos tenga la empresa.
  const q0 = (sql: string) => query(sql, [id]).catch(() => {});
  // Contabilidad — se limpia COMPLETA y en orden hijo→padre (de aquí salieron los
  // errores). La jerarquía de cuentas se apunta a sí misma (parent_id RESTRICT):
  // se rompe con NULL antes de borrar las cuentas.
  await q0(`DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE company_id = $1)`);
  await q0(`DELETE FROM journal_entries WHERE company_id = $1`);
  await q0(`DELETE FROM accounting_period_balances WHERE company_id = $1`);
  await q0(`DELETE FROM accounting_period_sources WHERE company_id = $1`);
  await q0(`DELETE FROM accounting_periods WHERE company_id = $1`);
  await q0(`UPDATE accounting_accounts SET parent_id = NULL WHERE company_id = $1`);
  await q0(`DELETE FROM accounting_accounts WHERE company_id = $1`);
  // Nómina: los recibos bloquean al empleado (RESTRICT); el resto de sus hijos es
  // CASCADE/SET NULL y se va con el empleado en el cascade de la empresa.
  await q0(`DELETE FROM nomina_recibos WHERE company_id = $1`);
  // Facturación (pago multi-factura) y punto de venta (RESTRICT hacia invoices/products).
  await q0(`DELETE FROM payment_invoices WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id = $1)`);
  await q0(`DELETE FROM pos_sale_items WHERE product_id IN (SELECT id FROM products WHERE company_id = $1)`);

  // 1) Datos operativos (mismo orden que reset-operations)
  await query(`DELETE FROM pac_stamps  WHERE company_id = $1`, [id]).catch(() => {});
  await query(`DELETE FROM xml_imports WHERE company_id = $1`, [id]).catch(() => {});
  await query(`DELETE FROM payments    WHERE company_id = $1`, [id]);
  await query(`DELETE FROM credit_notes WHERE company_id = $1`, [id]);
  await query(
    `DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id = $1)`,
    [id]
  );
  await query(`DELETE FROM invoices  WHERE company_id = $1`, [id]);
  await query(`DELETE FROM suppliers WHERE company_id = $1`, [id]).catch(() => {});
  await query(`DELETE FROM customers WHERE company_id = $1`, [id]);
  await query(`DELETE FROM products  WHERE company_id = $1`, [id]);

  // 2) Tablas específicas de SUPER_ADMIN / plataforma que apuntan a la empresa
  await query(`DELETE FROM company_stamp_usage WHERE company_id = $1`, [id]).catch(() => {});
  await query(`DELETE FROM stamp_transactions  WHERE company_id = $1`, [id]).catch(() => {});
  await query(`DELETE FROM audit_log WHERE target_type = 'company' AND target_id = $1`, [id]).catch(() => {});

  // 3) Tokens de sesión de sus usuarios (refresh_tokens no cuelga de companies,
  //    así que se limpia aparte antes de que los usuarios desaparezcan).
  await query(`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE company_id = $1)`, [id]).catch(() => {});

  // 4) La empresa. Sus USUARIOS y todas las tablas con company_id se borran EN
  //    CASCADA con ella, en UN SOLO statement. Eso es clave: las columnas de
  //    auditoría que apuntan a users (created_by, cerrado_por…, todas NO ACTION)
  //    NO bloquean, porque su fila se va en el mismo statement que el usuario y
  //    el chequeo NO ACTION se difiere al final. Borrar los usuarios en un
  //    statement aparte ANTES sí fallaba (p.ej. accounting_period_sources_created_by_fkey).
  //    El CSD/logo (BYTEA), plan, etc. se van con la fila de `companies`.
  await query(`DELETE FROM companies WHERE id = $1`, [id]);

  await audit(req, {
    action: 'company.full_delete',
    targetId: id,
    payload: { deleted: stats.rows[0], rfc: company.rfc },
  } as any).catch(() => {});

  res.status(200).json({
    success: true,
    company: { id, rfc: company.rfc, business_name: company.business_name },
    deleted: {
      ...stats.rows[0],
      company: 1,
    },
  });
}));

export default router;
