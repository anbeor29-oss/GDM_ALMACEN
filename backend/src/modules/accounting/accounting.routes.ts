/**
 * /accounting — catálogo de cuentas, ejercicios y periodos (Fase 1 contable).
 *
 *  Lectura del catálogo: cualquier usuario que alcance el módulo 'contabilidad'.
 *  Alta y edición de cuentas: capacidad 'contabilidad:catalogo'.
 *  Activar contabilidad / sembrar referencias: sólo ADMIN y SUPER_ADMIN.
 *
 * ── POR QUÉ LA SIEMBRA DE REFERENCIAS NO ES POR EMPRESA ──
 * Las NIF y el Anexo 24 son del país, no de la empresa: la ruta que las siembra
 * es de plataforma. Ponerla por empresa haría que la tercera empresa tuviera un
 * Anexo 24 distinto al de la primera sin que nadie lo notara.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, requireCapability, authorize } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as catalogo from './catalogo.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/* ═══════════════════════════════════════════════════════════════════════════
   REFERENCIAS (plataforma)
   ═══════════════════════════════════════════════════════════════════════════ */

/** POST /accounting/referencias/sembrar — NIF + código agrupador del SAT */
router.post(
  '/referencias/sembrar',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (_req: Request, res: Response) => {
    const r = await catalogo.sembrarReferencias();
    res.json({
      success: true,
      data: {
        ...r,
        /* Se devuelve lo que FALTA, no sólo lo que se sembró: un catálogo
         * incompleto que se reporta como "listo" es el que nadie completa. */
        faltantes: catalogo.faltantesDelAnexo24(),
      },
      message:
        `${r.satSembrados} códigos del Anexo 24 y ${r.nifSembradas} normas NIF. ` +
        `Faltan ~${r.nivel2Pendiente} subcuentas que el resumen no detalla.`,
    });
  })
);

/** GET /accounting/referencias/faltantes — qué falta del Anexo 24 */
router.get(
  '/referencias/faltantes',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: { faltantes: catalogo.faltantesDelAnexo24() } });
  })
);

/* ═══════════════════════════════════════════════════════════════════════════
   ACTIVACIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

/** POST /accounting/activar — configuración + ejercicio + 12 periodos + catálogo */
router.post(
  '/activar',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const anio = Number(req.body.anio);
    if (!anio || anio < 2000 || anio > 2100) {
      throw new ValidationError('Falta el año del ejercicio, o está fuera de rango.');
    }
    const r = await catalogo.activarContabilidad(companyId(req), {
      anio,
      mesInicioEjercicio: req.body.mesInicioEjercicio
        ? Number(req.body.mesInicioEjercicio) : 1,
      metodoValuacionInv: req.body.metodoValuacionInv,
      sembrarCatalogo: req.body.sembrarCatalogo !== false,
      hastaNivel: req.body.hastaNivel === 1 ? 1 : 2,
    });
    res.json({
      success: true,
      data: r,
      message:
        `Ejercicio ${r.anio} listo: ${r.periodos} periodo(s) y ${r.cuentas} cuenta(s).`,
    });
  })
);

/* ═══════════════════════════════════════════════════════════════════════════
   CATÁLOGO
   ═══════════════════════════════════════════════════════════════════════════ */

/** GET /accounting/cuentas */
router.get(
  '/cuentas',
  asyncHandler(async (req: Request, res: Response) => {
    const cuentas = await catalogo.listarCuentas(companyId(req), {
      busqueda: req.query.q as string | undefined,
      tipo: req.query.tipo as string | undefined,
      soloMovimientos: req.query.soloMovimientos === 'true',
      soloActivas: req.query.soloActivas !== 'false',
      nivel: req.query.nivel ? Number(req.query.nivel) : undefined,
    });
    res.json({ success: true, data: { cuentas } });
  })
);

/** GET /accounting/cuentas/arbol */
router.get(
  '/cuentas/arbol',
  asyncHandler(async (req: Request, res: Response) => {
    const arbol = await catalogo.arbolDeCuentas(companyId(req));
    res.json({ success: true, data: { arbol } });
  })
);

/** GET /accounting/cuentas/revision — lo que está mal antes de que importe */
router.get(
  '/cuentas/revision',
  asyncHandler(async (req: Request, res: Response) => {
    const revision = await catalogo.revisarCatalogo(companyId(req));
    res.json({ success: true, data: revision });
  })
);

/** GET /accounting/cuentas/:id */
router.get(
  '/cuentas/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const cuenta = await catalogo.obtenerCuenta(companyId(req), req.params.id);
    if (!cuenta) throw new ValidationError('La cuenta no existe.');
    const equivalencias = await catalogo.equivalenciasDeCuenta(companyId(req), req.params.id);
    res.json({ success: true, data: { cuenta, equivalencias } });
  })
);

/** POST /accounting/cuentas */
router.post(
  '/cuentas',
  requireCapability('contabilidad:catalogo'),
  asyncHandler(async (req: Request, res: Response) => {
    const cuenta = await catalogo.crearCuenta(companyId(req), req.body);
    res.status(201).json({ success: true, data: { cuenta } });
  })
);

/** PATCH /accounting/cuentas/:id */
router.patch(
  '/cuentas/:id',
  requireCapability('contabilidad:catalogo'),
  asyncHandler(async (req: Request, res: Response) => {
    const cuenta = await catalogo.actualizarCuenta(companyId(req), req.params.id, req.body);
    res.json({ success: true, data: { cuenta } });
  })
);

/** DELETE /accounting/cuentas/:id — desactiva, nunca borra */
router.delete(
  '/cuentas/:id',
  requireCapability('contabilidad:catalogo'),
  asyncHandler(async (req: Request, res: Response) => {
    const cuenta = await catalogo.desactivarCuenta(companyId(req), req.params.id);
    res.json({
      success: true,
      data: { cuenta },
      message: 'La cuenta quedó desactivada. No se borra: sus pólizas la siguen usando.',
    });
  })
);

/* ═══════════════════════════════════════════════════════════════════════════
   EQUIVALENCIAS CON OTROS CATÁLOGOS
   ═══════════════════════════════════════════════════════════════════════════ */

/** GET /accounting/catalogos-externos */
router.get(
  '/catalogos-externos',
  asyncHandler(async (req: Request, res: Response) => {
    const catalogos = await catalogo.listarCatalogosExternos(companyId(req));
    res.json({ success: true, data: { catalogos } });
  })
);

/** PUT /accounting/cuentas/:id/equivalencia */
router.put(
  '/cuentas/:id/equivalencia',
  requireCapability('contabilidad:catalogo'),
  asyncHandler(async (req: Request, res: Response) => {
    const { catalogo: cat, codigoExterno, descripcion } = req.body;
    const equivalencia = await catalogo.fijarEquivalencia(
      companyId(req), req.params.id, cat, codigoExterno, descripcion,
    );
    res.json({ success: true, data: { equivalencia } });
  })
);

/* ═══════════════════════════════════════════════════════════════════════════
   NIF
   ═══════════════════════════════════════════════════════════════════════════ */

/** GET /accounting/nif — las normas, para el combo de clasificación */
router.get(
  '/nif',
  asyncHandler(async (_req: Request, res: Response) => {
    const { query } = await import('../../config/database');
    const r = await query(
      `SELECT clave, serie, titulo, ambito, resumen FROM nif_normas
        WHERE vigente ORDER BY serie, clave`,
    );
    res.json({ success: true, data: { normas: r.rows } });
  })
);

export default router;
