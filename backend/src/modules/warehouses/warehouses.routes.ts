/**
 * /warehouses — catálogo de almacenes por empresa (§7 ALMACEN.MD).
 *
 *  Lectura: cualquier usuario autenticado de la empresa.
 *  Escritura: ADMIN/MANAGER. Baja = soft-delete; bloqueada si el almacén
 *  tiene existencias o es el default.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, authorize } from '../../middleware/authentication';
import { asyncHandler, ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';
import { query, transaction, transactionQuery } from '../../config/database';
import { crearCajeroDelAlmacen, CajeroCreado } from './cajero-del-almacen.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

const txt = (v: any, max: number): string | null => {
  const s = v == null ? '' : String(v).trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Lee el domicilio desglosado del cuerpo y arma de paso la versión legible.
 *
 * Las dos representaciones se generan JUNTAS y en un solo lugar a propósito: si
 * cada endpoint armara la cadena por su cuenta, tarde o temprano una edición
 * cambiaría la colonia y dejaría el `address` viejo, y la pantalla mostraría un
 * domicilio que ya no es el que está guardado en los campos.
 *
 * El estado se guarda como CLAVE SAT (AGU, JAL, NLE) porque es lo que exige el
 * Anexo 20; para leerlo se manda aparte el nombre.
 */
function leerDomicilio(body: any) {
  const d = {
    postalCode: txt(body?.postalCode, 5),
    street:     txt(body?.street, 200),
    extNumber:  txt(body?.extNumber, 30),
    intNumber:  txt(body?.intNumber, 30),
    colonia:    txt(body?.colonia, 150),
    municipio:  txt(body?.municipio, 150),
    estado:     txt(body?.estado, 5),
  };
  if (d.postalCode && !/^\d{5}$/.test(d.postalCode)) {
    throw new ValidationError('El código postal debe ser de 5 dígitos');
  }

  // Se arma solo si hay calle o CP: con los campos vacíos, una cadena hecha de
  // comas sueltas se vería como un domicilio capturado a medias.
  const hayAlgo = d.street || d.postalCode;
  const calle = [d.street, d.extNumber, d.intNumber ? `int. ${d.intNumber}` : null]
    .filter(Boolean).join(' ');
  const armado = hayAlgo
    ? [calle, d.colonia, d.municipio, body?.estadoNombre || d.estado, d.postalCode ? `C.P. ${d.postalCode}` : null]
        .filter(Boolean).join(', ')
    : null;

  return { ...d, armado };
}

/** GET /warehouses — lista con métricas de existencias */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const includeInactive = req.query.includeInactive === 'true';
    const params: any[] = [companyId(req)];
    const filters = ['w.company_id = $1', 'w.deleted_at IS NULL'];
    if (!includeInactive) filters.push('w.is_active = true');

    const r = await query<any>(
      `SELECT w.id, w.code, w.name, w.address, w.is_default, w.is_active, w.created_at,
                w.postal_code, w.street, w.ext_number, w.int_number,
                w.colonia, w.municipio, w.estado,
              COUNT(ws.id) FILTER (WHERE ws.quantity > 0)          AS products_with_stock,
              COALESCE(SUM(ws.quantity), 0)                        AS total_units,
              COALESCE(SUM(ws.quantity * ws.avg_cost), 0)          AS total_value
         FROM warehouses w
         LEFT JOIN warehouse_stock ws ON ws.warehouse_id = w.id
        WHERE ${filters.join(' AND ')}
        GROUP BY w.id
        ORDER BY w.is_default DESC, w.code ASC`,
      params
    );

    res.json({ success: true, data: { warehouses: r.rows } });
  })
);

/** POST /warehouses — alta */
router.post(
  '/',
  authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    /* Los espacios se vuelven guiones en vez de rechazar la captura.
     *
     * "BODEGA CENTRO" es el nombre corto que cualquiera escribe, y el sistema
     * contestaba "solo letras/números/guiones" — un mensaje que describe la
     * regla sin decir cuál de los caracteres sobra ni qué hacer. Convertirlo a
     * BODEGA-CENTRO respeta la regla y no le hace perder el viaje a nadie. El
     * resto de caracteres sí se rechaza, porque no hay una sustitución obvia
     * para un acento o un signo. */
    const code = String(req.body?.code || '')
      .trim().toUpperCase().replace(/\s+/g, '-');
    const name = String(req.body?.name || '').trim();
    if (!code || !name) throw new ValidationError('code y name son obligatorios');
    if (!/^[A-Z0-9_-]{1,20}$/.test(code)) {
      throw new ValidationError(
        `El código "${code}" no sirve: hasta 20 caracteres, solo letras sin acentos, ` +
        'números y guiones. Los espacios se convierten en guiones solos.'
      );
    }

    const dom = leerDomicilio(req.body);
    // `address` se sigue llenando: media docena de pantallas la leen.
    const address = dom.armado || (req.body?.address ? String(req.body.address).trim() : null);

    const result = await transaction(async (client) => {
      // Primer almacén de la empresa → default automático
      const countR = await transactionQuery<{ n: string }>(
        client,
        `SELECT COUNT(*)::text AS n FROM warehouses WHERE company_id = $1 AND deleted_at IS NULL`,
        [companyId(req)]
      );
      const isFirst = Number(countR.rows[0].n) === 0;

      const ins = await transactionQuery<any>(
        client,
        `INSERT INTO warehouses
           (company_id, code, name, address, is_default,
            postal_code, street, ext_number, int_number, colonia, municipio, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id, code, name, address, is_default, is_active, created_at,
                   postal_code, street, ext_number, int_number, colonia, municipio, estado`,
        [companyId(req), code, name, address, isFirst,
         dom.postalCode, dom.street, dom.extNumber, dom.intNumber,
         dom.colonia, dom.municipio, dom.estado]
      );
      /* Su cajero, en la MISMA transacción: si el alta del almacén se revierte,
       * no queda un usuario colgando que apunta a una bodega inexistente.
       *
       * `crearCajeroDelAlmacen` nunca lanza — devuelve el motivo. Un almacén es
       * un dato de inventario y no tiene por qué depender de que su cajero se
       * haya podido crear. */
      const cajero = await crearCajeroDelAlmacen(client, {
        companyId: companyId(req),
        warehouseId: ins.rows[0].id,
        warehouseCode: ins.rows[0].code,
        warehouseName: ins.rows[0].name,
        creadorEmail: req.user?.email,
        creadorId: req.user?.userId,
      });
      return { ...ins.rows[0], cajero };
    }).catch((e: any) => {
      if (e?.code === '23505') throw new ConflictError(`Ya existe un almacén con código ${code}`);
      throw e;
    });

    res.status(201).json({ success: true, data: result });
  })
);

/** PUT /warehouses/:id — edición (nombre, dirección, activo, default) */
router.put(
  '/:id',
  authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const { name, isActive, isDefault } = req.body || {};
    const dom = leerDomicilio(req.body);
    /* En la edición sí se admite que el domicilio venga vacío: significa
     * "no lo toques". Si el formulario mandó calle o CP, `armado` trae la
     * versión legible y se pisa junto con los campos; así los dos nunca se
     * separan. */
    const address = dom.armado ?? (req.body?.address != null ? String(req.body.address).trim() : null);

    const result = await transaction(async (client) => {
      const curR = await transactionQuery<any>(
        client,
        `SELECT id, is_default FROM warehouses
          WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [req.params.id, companyId(req)]
      );
      if (curR.rows.length === 0) throw new NotFoundError('Almacén no encontrado');
      const current = curR.rows[0];

      if (current.is_default && isActive === false) {
        throw new ConflictError('El almacén default no puede desactivarse — asigna otro default primero');
      }

      // Cambiar default: quitar el actual y poner este (índice único parcial lo garantiza)
      if (isDefault === true && !current.is_default) {
        await transactionQuery(
          client,
          `UPDATE warehouses SET is_default = false
            WHERE company_id = $1 AND is_default = true AND deleted_at IS NULL`,
          [companyId(req)]
        );
      }

      const upd = await transactionQuery<any>(
        client,
        `UPDATE warehouses SET
            name        = COALESCE($1, name),
            address     = COALESCE($2, address),
            is_active   = COALESCE($3, is_active),
            is_default  = COALESCE($4, is_default),
            postal_code = COALESCE($6, postal_code),
            street      = COALESCE($7, street),
            ext_number  = COALESCE($8, ext_number),
            int_number  = COALESCE($9, int_number),
            colonia     = COALESCE($10, colonia),
            municipio   = COALESCE($11, municipio),
            estado      = COALESCE($12, estado),
            updated_at  = NOW()
          WHERE id = $5
          RETURNING id, code, name, address, is_default, is_active,
                    postal_code, street, ext_number, int_number, colonia, municipio, estado`,
        [name != null ? String(name).trim() : null,
         address,
         typeof isActive === 'boolean' ? isActive : null,
         isDefault === true ? true : null,
         req.params.id,
         dom.postalCode, dom.street, dom.extNumber, dom.intNumber,
         dom.colonia, dom.municipio, dom.estado]
      );
      return upd.rows[0];
    });

    res.json({ success: true, data: result });
  })
);

/** DELETE /warehouses/:id — soft-delete, bloqueado con stock o siendo default */
router.delete(
  '/:id',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    await transaction(async (client) => {
      const curR = await transactionQuery<any>(
        client,
        `SELECT id, is_default FROM warehouses
          WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [req.params.id, companyId(req)]
      );
      if (curR.rows.length === 0) throw new NotFoundError('Almacén no encontrado');
      if (curR.rows[0].is_default) {
        throw new ConflictError('El almacén default no puede eliminarse — asigna otro default primero');
      }

      const stockR = await transactionQuery<{ n: string }>(
        client,
        `SELECT COUNT(*)::text AS n FROM warehouse_stock
          WHERE warehouse_id = $1 AND quantity > 0`,
        [req.params.id]
      );
      if (Number(stockR.rows[0].n) > 0) {
        throw new ConflictError(
          'El almacén tiene existencias — traspásalas a otro almacén antes de eliminarlo'
        );
      }

      await transactionQuery(
        client,
        `UPDATE warehouses SET deleted_at = NOW(), is_active = false WHERE id = $1`,
        [req.params.id]
      );
    });

    res.json({ success: true, message: 'Almacén eliminado' });
  })
);

export default router;
