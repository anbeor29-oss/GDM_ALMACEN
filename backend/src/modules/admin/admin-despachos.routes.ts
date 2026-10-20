/**
 * /admin/despachos — despachos contables (la firma que administra a sus empresas
 * cliente y donde se FIJAN LOS PRECIOS del servicio). Sólo SUPER_ADMIN.
 *
 *  GET    /admin/despachos            lista despachos + nº de empresas + precios
 *  POST   /admin/despachos            alta de despacho
 *  PUT    /admin/despachos/:id        edita nombre / precios / emisora / activo
 *  DELETE /admin/despachos/:id        baja (soft-delete; sus empresas quedan «sin despacho»)
 *  POST   /admin/despachos/:id/asignar  mete varias empresas al despacho de un tirón
 *
 * Los precios son NULL = «hereda el global» (facturacion_config). Un despacho grande
 * puede pactar su propio precio por usuario y escalón de timbres.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError, NotFoundError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import { requireSuperAdmin, audit } from './admin.middleware';

const router = Router();
router.use(authenticateToken);
router.use(requireSuperAdmin);

const UUID = /^[0-9a-f-]{36}$/i;
/** Número ≥ 0 o null (para los campos de precio heredables). */
const numOrNull = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError('Los valores no pueden ser negativos.');
  return n;
};
const intOrNull = (v: any): number | null => {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
};

/* ────────────────────────  LIST  ──────────────────────── */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const r = await query<any>(
    `SELECT d.id, d.nombre, d.precio_usuario_mxn, d.timbres_incluidos, d.timbre_extra_mxn,
            d.timbres_por_usuario, d.timbre_extra_por_usuario, d.emisora_predeterminada_id,
            d.notas, d.activo,
            em.business_name AS emisora_nombre, em.rfc AS emisora_rfc,
            (SELECT COUNT(*)::int FROM companies c
              WHERE c.despacho_id = d.id AND c.deleted_at IS NULL) AS empresas,
            (SELECT COUNT(*)::int FROM users u
               JOIN companies c ON c.id = u.company_id
              WHERE c.despacho_id = d.id AND c.deleted_at IS NULL
                AND u.is_active = TRUE AND u.deleted_at IS NULL
                AND u.role <> 'SUPER_ADMIN' AND COALESCE(u.work_group,'') <> 'CHECADOR') AS usuarios
       FROM despachos_contables d
       LEFT JOIN companies em ON em.id = d.emisora_predeterminada_id
      WHERE d.deleted_at IS NULL
      ORDER BY d.activo DESC, d.nombre`);
  res.json({ success: true, data: { despachos: r.rows } });
}));

/* ────────────────────────  CREATE  ──────────────────────── */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const b = req.body as any;
  const nombre = String(b?.nombre || '').trim();
  if (nombre.length < 2) throw new ValidationError('Captura el nombre del despacho.');
  if (b?.emisoraPredeterminadaId && !UUID.test(b.emisoraPredeterminadaId)) throw new ValidationError('Emisora inválida.');

  const r = await query<any>(
    `INSERT INTO despachos_contables
       (nombre, precio_usuario_mxn, timbres_incluidos, timbre_extra_mxn,
        timbres_por_usuario, timbre_extra_por_usuario, emisora_predeterminada_id, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, nombre`,
    [nombre, numOrNull(b?.precioUsuario), intOrNull(b?.timbresIncluidos), numOrNull(b?.timbreExtra),
     intOrNull(b?.timbresPorUsuario), numOrNull(b?.timbreExtraPorUsuario),
     b?.emisoraPredeterminadaId || null, String(b?.notas || '').trim() || null]);
  await audit(req, { action: 'DESPACHO_CREATED', targetKind: 'despacho', targetId: r.rows[0].id, payload: { nombre } });
  res.status(201).json({ success: true, data: r.rows[0], message: `Despacho «${nombre}» creado.` });
}));

/* ────────────────────────  UPDATE  ──────────────────────── */
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  if (!UUID.test(req.params.id)) throw new ValidationError('Despacho inválido.');
  const b = req.body as any;
  const fields: string[] = [];
  const params: any[] = [];
  const push = (f: string, v: any) => { params.push(v); fields.push(`${f} = $${params.length}`); };

  if (b?.nombre !== undefined) {
    const nombre = String(b.nombre).trim();
    if (nombre.length < 2) throw new ValidationError('Nombre inválido.');
    push('nombre', nombre);
  }
  if (b?.precioUsuario          !== undefined) push('precio_usuario_mxn',       numOrNull(b.precioUsuario));
  if (b?.timbresIncluidos       !== undefined) push('timbres_incluidos',        intOrNull(b.timbresIncluidos));
  if (b?.timbreExtra            !== undefined) push('timbre_extra_mxn',         numOrNull(b.timbreExtra));
  if (b?.timbresPorUsuario      !== undefined) push('timbres_por_usuario',      intOrNull(b.timbresPorUsuario));
  if (b?.timbreExtraPorUsuario  !== undefined) push('timbre_extra_por_usuario', numOrNull(b.timbreExtraPorUsuario));
  if (b?.emisoraPredeterminadaId !== undefined) {
    if (b.emisoraPredeterminadaId && !UUID.test(b.emisoraPredeterminadaId)) throw new ValidationError('Emisora inválida.');
    push('emisora_predeterminada_id', b.emisoraPredeterminadaId || null);
  }
  if (b?.notas  !== undefined) push('notas',  String(b.notas || '').trim() || null);
  if (b?.activo !== undefined) push('activo', Boolean(b.activo));

  if (!fields.length) throw new ValidationError('Nada que actualizar.');
  params.push(req.params.id);
  const r = await query<any>(
    `UPDATE despachos_contables SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length} AND deleted_at IS NULL RETURNING id, nombre`, params);
  if (!r.rows.length) throw new NotFoundError('Despacho no encontrado.');
  await audit(req, { action: 'DESPACHO_UPDATED', targetKind: 'despacho', targetId: req.params.id, payload: b });
  res.json({ success: true, data: r.rows[0] });
}));

/* ────────────────────────  DELETE (soft)  ──────────────────────── */
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  if (!UUID.test(req.params.id)) throw new ValidationError('Despacho inválido.');
  // Las empresas del despacho quedan «sin despacho» (no se borran).
  await query(`UPDATE companies SET despacho_id = NULL, updated_at = NOW() WHERE despacho_id = $1`, [req.params.id]);
  const r = await query<any>(
    `UPDATE despachos_contables SET deleted_at = NOW(), activo = FALSE, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL RETURNING id, nombre`, [req.params.id]);
  if (!r.rows.length) throw new NotFoundError('Despacho no encontrado.');
  await audit(req, { action: 'DESPACHO_DELETED', targetKind: 'despacho', targetId: req.params.id });
  res.json({ success: true, message: `Despacho «${r.rows[0].nombre}» dado de baja; sus empresas quedaron sin despacho.` });
}));

/* ──────────  Asignar varias empresas al despacho de un tirón  ──────────
 * companyIds = lista de empresas a meter en este despacho. */
router.post('/:id/asignar', asyncHandler(async (req: Request, res: Response) => {
  if (!UUID.test(req.params.id)) throw new ValidationError('Despacho inválido.');
  const companyIds: string[] = Array.isArray(req.body?.companyIds) ? req.body.companyIds : [];
  if (!companyIds.length) throw new ValidationError('No hay empresas que asignar.');
  if (companyIds.some((x) => !UUID.test(String(x)))) throw new ValidationError('Lista de empresas inválida.');
  const existe = (await query<any>(`SELECT 1 FROM despachos_contables WHERE id=$1 AND deleted_at IS NULL`, [req.params.id])).rows[0];
  if (!existe) throw new NotFoundError('Despacho no encontrado.');
  const r = await query<any>(
    `UPDATE companies SET despacho_id = $1, updated_at = NOW()
      WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL RETURNING id`,
    [req.params.id, companyIds]);
  await audit(req, { action: 'DESPACHO_ASIGNAR', targetKind: 'despacho', targetId: req.params.id, payload: { n: r.rowCount } });
  res.json({ success: true, data: { asignadas: r.rowCount }, message: `${r.rowCount} empresa(s) asignada(s) al despacho.` });
}));

export default router;
