/**
 * /auditoria — qué dice el SAT de nuestros comprobantes.
 *
 *  Lectura: cualquier usuario de la empresa.
 *  Correr la revisión a mano: ADMIN / MANAGER — consulta un servicio externo
 *  y puede tardar, no es una consulta cualquiera.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, authorize } from '../../middleware/authentication';
import { asyncHandler, ValidationError, NotFoundError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import * as service from './auditoria.service';
import multer from 'multer';
import * as lista69b from './lista-69b.service';
import * as descarga69b from './descarga-69b.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/** GET /auditoria — el estado de todo, con las diferencias hasta arriba */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const comprobantes = await service.listarAuditoria(companyId(req), {
      soloDiscrepancias: req.query.soloDiscrepancias === 'true',
      estado:  req.query.estado as string | undefined,
      docType: req.query.docType as string | undefined,
    });
    res.json({ success: true, data: { comprobantes } });
  })
);

/** GET /auditoria/resumen — las tarjetas de la pantalla */
router.get(
  '/resumen',
  asyncHandler(async (req: Request, res: Response) => {
    const resumen = await service.resumenAuditoria(companyId(req));
    res.json({
      success: true,
      data: { ...resumen, horasEntreRevisiones: service.HORAS_ENTRE_REVISIONES },
    });
  })
);

/**
 * POST /auditoria/revisar — corre la revisión ahora.
 *
 * Sin cuerpo revisa lo que lleva más de 72 h sin revisar; con `todos: true`
 * revisa el universo completo, que es lo que se quiere la primera vez.
 */
router.post(
  '/revisar',
  authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.correrAuditoria(companyId(req), {
      soloPendientes: req.body?.todos !== true,
      limite: req.body?.limite,
    });
    res.json({ success: true, data: result });
  })
);

/** POST /auditoria/revisar/:docType/:docId — un comprobante en concreto */
router.post(
  '/revisar/:docType/:docId',
  authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const { docType, docId } = req.params;
    const tablas: Record<string, { tabla: string; uuid: string; total: string }> = {
      invoice:     { tabla: 'invoices',     uuid: 'cfdi_uuid', total: 'i.total' },
      credit_note: { tabla: 'credit_notes', uuid: 'uuid',      total: 'i.total' },
      payment:     { tabla: 'payments',     uuid: 'uuid',      total: '0' },
    };
    const t = tablas[docType];
    if (!t) throw new ValidationError('Tipo de comprobante no válido');

    const r = await query<service.Comprobante>(
      `SELECT $3::varchar AS doc_type, i.id AS doc_id, i.${t.uuid} AS uuid,
              COALESCE(i.serie, '') || '-' || i.folio AS serie_folio,
              ${t.total} AS total,
              ${docType === 'payment' ? `'STAMPED'` : 'i.status'} AS estado_local,
              e.rfc AS rfc_emisor, c.rfc AS rfc_receptor, i.xml_content
         FROM ${t.tabla} i
         JOIN companies e ON e.id = i.company_id
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.id = $1 AND i.company_id = $2 AND i.${t.uuid} IS NOT NULL`,
      [docId, companyId(req), docType]
    );
    if (r.rows.length === 0) throw new NotFoundError('Comprobante timbrado no encontrado');

    const result = await service.revisarComprobante(companyId(req), r.rows[0]);
    res.json({ success: true, data: result });
  })
);


/* ═════════════ LISTAS DEL 69-B DEL CFF ═════════════ */

/* El archivo del SAT se lee en memoria: es una lista pública que se procesa y
 * se descarta, no hay razón para dejarla en el disco de un servidor efímero. */
const subidaLista = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

/** GET /auditoria/69b — nuestros terceros que aparecen en la lista */
router.get(
  '/69b',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await lista69b.cruzar(companyId(req));
    res.json({ success: true, data });
  })
);

/**
 * POST /auditoria/69b/importar — carga el archivo publicado por el SAT.
 *
 * Sólo ADMIN: la lista es global y afecta a todas las empresas de la
 * plataforma, así que no la actualiza cualquiera desde su pantalla.
 */
router.post(
  '/69b/importar',
  authorize('ADMIN', 'SUPER_ADMIN'),
  subidaLista.single('archivo'),
  asyncHandler(async (req: Request, res: Response) => {
    const f = req.file;
    if (!f) throw new ValidationError('Falta el archivo de la lista');
    /* latin1 y no utf8: el SAT publica en Windows-1252 y los nombres con
     * acentos llegaban con rombos. */
    const texto = f.buffer.toString('latin1');
    const r = await lista69b.importarLista(texto, f.originalname, req.user?.userId);
    res.status(201).json({ success: true, data: r });
  })
);

/**
 * POST /auditoria/69b/actualizar — la baja del portal del SAT.
 *
 * Sólo ADMIN, igual que la carga a mano: la lista es global y afecta a todas
 * las empresas de la plataforma. Puede tardar unos segundos —son 4.7 MB y
 * catorce mil renglones— y por eso la pantalla avisa mientras corre.
 */
router.post(
  '/69b/actualizar',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await descarga69b.actualizarDesdeElSat(req.user?.userId);
    res.json({ success: true, data: r });
  })
);

export default router;
