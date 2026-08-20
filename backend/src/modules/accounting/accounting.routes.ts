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
import * as balanza from './balanza-lector.service';
import * as mapeador from './mapeador-sat.service';
import * as motorNif from './nif-motor.service';
import * as estados from './estados-financieros.service';
import multer from 'multer';

const router = Router();
router.use(authenticateToken);

/* 20 MB: una balanza de 5,000 cuentas en PDF no llega ni a la mitad. */
const subir = multer({ storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } });

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
   BALANZA DEL SISTEMA ANTERIOR
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * POST /accounting/balanza/analizar — lee y revisa, SIN guardar nada.
 *
 * Es un paso aparte a propósito. Una balanza que no cuadra no puede ser el
 * saldo inicial de nada, y enterarse de eso DESPUÉS de haberla cargado
 * significa deshacer una póliza de apertura con cientos de renglones.
 *
 * Primero se ve qué trae el archivo; cargar es otra decisión.
 */
router.post(
  '/balanza/analizar',
  requireCapability('contabilidad:capturar'),
  subir.single('archivo'),
  asyncHandler(async (req: Request, res: Response) => {
    const f = (req as any).file;
    if (!f) throw new ValidationError('Falta el archivo de la balanza.');

    const nombre = (f.originalname || '').toLowerCase();
    const esExcel = /\.xlsx?$/.test(nombre)
      || /spreadsheet|excel/.test(f.mimetype || '');
    const esPdf = /\.pdf$/.test(nombre) || /pdf/.test(f.mimetype || '');

    if (!esExcel && !esPdf) {
      throw new ValidationError(
        'El archivo tiene que ser Excel (.xlsx) o PDF. Si tu sistema exporta ' +
        'a otro formato, dilo y se agrega.',
      );
    }

    let lectura;
    try {
      lectura = esExcel
        ? await balanza.leerBalanzaExcel(f.buffer)
        : await balanza.leerBalanzaPdf(f.buffer);
    } catch (e: any) {
      throw new ValidationError(e.message);
    }

    const analisis = balanza.analizarBalanza(lectura);

    /* -- Acomodar el catalogo ajeno sobre la base del SAT --
     * Va en la misma respuesta a proposito: lo que hace falta saber antes
     * de cargar no es solo 'cuadra', es 'y donde va a caer cada cuenta'.
     * Las dos preguntas se contestan mirando el archivo una sola vez. */
    const validos = await mapeador.agrupadoresValidos();
    let mapeo = mapeador.proponerMapeo(lectura.filas, { agrupadoresValidos: validos });
    mapeo = await mapeador.conNombresDelSat(mapeo);
    const resumenMapeo = mapeador.resumenMapeo(mapeo);

    /* Se devuelven las filas para poder verlas en pantalla antes de cargar,
     * pero acotadas: una balanza de 5,000 cuentas no cabe en una respuesta
     * cómoda, y para revisar sirve el resumen más los renglones con problema. */
    res.json({
      success: true,
      data: {
        origen: lectura.origen,
        encabezado: lectura.encabezado,
        analisis,
        filas: analisis.totalFilas <= 1500 ? lectura.filas : undefined,
        mapeo: analisis.totalFilas <= 1500 ? mapeo : undefined,
        resumenMapeo,
        /* Lo dudoso viaja SIEMPRE, aunque el resto se omita por tamano:
         * es justo lo que hay que revisar a mano. */
        porRevisar: resumenMapeo.porRevisar,
        filasOmitidas: analisis.totalFilas > 1500 ? analisis.totalFilas : 0,
      },
      message: analisis.cuadra
        ? `Balanza leída: ${analisis.hojas} cuentas de detalle, cuadra, y ` +
          `${resumenMapeo.mapeadas} de ${resumenMapeo.total} quedaron acomodadas ` +
          `sobre el catálogo del SAT.`
        : `Balanza leída con ${analisis.avisos.filter((a) => a.nivel === 'ERROR').length} ` +
          `problema(s) que hay que resolver antes de cargarla.`,
    });
  })
);

/* ═══════════════════════════════════════════════════════════════════════════
   ESTADOS FINANCIEROS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * POST /accounting/estados-financieros
 *
 * Sube una balanza —o dos, para el comparativo— y devuelve el juego completo:
 * situacion financiera, resultado integral, razones y analisis horizontal.
 *
 * Se corre en el momento y no se guarda todavia: mientras la contabilidad de
 * NEXO no genere sus propios saldos, el estado es una lectura del archivo que
 * se acaba de subir. Guardarlo daria la impresion de que el sistema lo produjo.
 */
router.post(
  '/estados-financieros',
  subir.fields([{ name: 'archivo', maxCount: 1 }, { name: 'anterior', maxCount: 1 }]),
  asyncHandler(async (req: Request, res: Response) => {
    const fs2 = (req as any).files || {};
    const f = fs2.archivo?.[0];
    if (!f) throw new ValidationError('Falta el archivo de la balanza.');

    const leer = async (file: any) => {
      const n = (file.originalname || '').toLowerCase();
      const esExcel = /\.xlsx?$/.test(n) || /spreadsheet|excel/.test(file.mimetype || '');
      const esPdf = /\.pdf$/.test(n) || /pdf/.test(file.mimetype || '');
      if (!esExcel && !esPdf) throw new ValidationError('El archivo tiene que ser Excel o PDF.');
      try {
        return esExcel ? await balanza.leerBalanzaExcel(file.buffer)
                       : await balanza.leerBalanzaPdf(file.buffer);
      } catch (e: any) { throw new ValidationError(e.message); }
    };

    const validos = await mapeador.agrupadoresValidos();
    const contextoDe = (lectura: any, fecha: string) =>
      motorNif.contextoDeBalanza(
        lectura.filas,
        mapeador.proponerMapeo(lectura.filas, { agrupadoresValidos: validos }),
        fecha);

    const fechaCorte = (req.body.fechaCorte as string) || new Date().toISOString().slice(0, 10);
    const lectura = await leer(f);
    const ctx = contextoDe(lectura, fechaCorte);

    let ctxAnterior;
    const fAnt = fs2.anterior?.[0];
    if (fAnt) {
      const lecturaAnt = await leer(fAnt);
      ctxAnterior = contextoDe(lecturaAnt, req.body.fechaCorteAnterior || '');
    }

    /* Los dias del periodo mandan en las rotaciones: usar 365 sobre una
     * balanza de un mes multiplica por doce los dias de cartera. */
    const diasPeriodo = Number(req.body.diasPeriodo) > 0
      ? Number(req.body.diasPeriodo) : 365;

    const juego = estados.juegoCompleto(ctx, ctxAnterior, diasPeriodo);
    const analisisBalanza = balanza.analizarBalanza(lectura);
    const nifRes = motorNif.evaluar(ctx);

    res.json({
      success: true,
      data: {
        encabezado: lectura.encabezado,
        origen: lectura.origen,
        fechaCorte,
        diasPeriodo,
        ...juego,
        balanza: {
          totalFilas: analisisBalanza.totalFilas,
          hojas: analisisBalanza.hojas,
          cuadra: analisisBalanza.cuadra,
          sumaDebe: analisisBalanza.sumaDebe,
          sumaHaber: analisisBalanza.sumaHaber,
        },
        nif: {
          noCumple: nifRes.noCumple, revisar: nifRes.revisar, cumple: nifRes.cumple,
          hallazgos: nifRes.hallazgos.filter((h) => h.estado !== 'NO_APLICA'),
        },
      },
      message: juego.situacionFinanciera.cuadra
        ? `Estados financieros al ${fechaCorte}. El balance cuadra.`
        : `Estados financieros al ${fechaCorte}. ATENCION: el balance no cuadra por ` +
          `${juego.situacionFinanciera.diferencia.toFixed(2)}.`,
    });
  })
);

/* ═══════════════════════════════════════════════════════════════════════════
   MOTOR NIF
   ═══════════════════════════════════════════════════════════════════════════ */

/** POST /accounting/nif/sincronizar — registra las reglas y clasifica el catálogo */
router.post(
  '/nif/sincronizar',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const reglas = await motorNif.sincronizarReglas();
    const catalogo = await motorNif.clasificarCatalogoSat();
    const empresa = await motorNif.clasificarCuentasEmpresa(companyId(req));
    res.json({
      success: true,
      data: { reglas, catalogo, empresa },
      message:
        `${reglas.total} reglas activas. Catálogo: ${catalogo.especifica} cuentas con ` +
        `NIF específica, ${catalogo.noAplica} sin NIF aplicable y ${catalogo.depende} ` +
        `que dependen de su contenido.`,
    });
  })
);

/** GET /accounting/nif/reglas — el catálogo de reglas, con lo que exige cada una */
router.get(
  '/nif/reglas',
  asyncHandler(async (_req: Request, res: Response) => {
    const { query: q } = await import('../../config/database');
    const r = await q(
      `SELECT r.*, n.titulo AS norma_titulo FROM nif_reglas r
         JOIN nif_normas n ON n.clave = r.norma
        WHERE r.activa ORDER BY r.norma, r.clave`);
    res.json({ success: true, data: { reglas: r.rows } });
  })
);

/**
 * POST /accounting/nif/evaluar — corre las reglas sobre una balanza.
 *
 * Recibe el archivo y devuelve los hallazgos. Se guarda la corrida para poder
 * comparar contra la del mes pasado: lo que importa no es sólo qué está mal
 * hoy, es si se está corrigiendo.
 */
router.post(
  '/nif/evaluar',
  requireCapability('contabilidad:capturar'),
  subir.single('archivo'),
  asyncHandler(async (req: Request, res: Response) => {
    const f = (req as any).file;
    if (!f) throw new ValidationError('Falta el archivo de la balanza.');

    const nombre = (f.originalname || '').toLowerCase();
    const esExcel = /\.xlsx?$/.test(nombre) || /spreadsheet|excel/.test(f.mimetype || '');
    const esPdf = /\.pdf$/.test(nombre) || /pdf/.test(f.mimetype || '');
    if (!esExcel && !esPdf) throw new ValidationError('El archivo tiene que ser Excel o PDF.');

    let lectura;
    try {
      lectura = esExcel
        ? await balanza.leerBalanzaExcel(f.buffer)
        : await balanza.leerBalanzaPdf(f.buffer);
    } catch (e: any) { throw new ValidationError(e.message); }

    const validos = await mapeador.agrupadoresValidos();
    const mapeo = mapeador.proponerMapeo(lectura.filas, { agrupadoresValidos: validos });

    const fechaCorte = (req.body.fechaCorte as string)
      || new Date().toISOString().slice(0, 10);

    const ctx = motorNif.contextoDeBalanza(lectura.filas, mapeo, fechaCorte);
    const resultado = motorNif.evaluar(ctx);

    const guardar = req.body.guardar !== 'false';
    const evaluacionId = guardar
      ? await motorNif.guardarEvaluacion(companyId(req), resultado, 'BALANZA', req.user?.userId)
      : undefined;

    res.json({
      success: true,
      data: { ...resultado, evaluacionId, encabezado: lectura.encabezado },
      message:
        `${resultado.reglasCorridas} reglas: ${resultado.noCumple} incumplimiento(s), ` +
        `${resultado.revisar} por revisar, ${resultado.cumple} en orden.`,
    });
  })
);

/** GET /accounting/nif/evaluaciones — el histórico */
router.get(
  '/nif/evaluaciones',
  asyncHandler(async (req: Request, res: Response) => {
    const evaluaciones = await motorNif.evaluacionesDe(companyId(req));
    res.json({ success: true, data: { evaluaciones } });
  })
);

/** GET /accounting/nif/evaluaciones/:id — los hallazgos de una corrida */
router.get(
  '/nif/evaluaciones/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const hallazgos = await motorNif.hallazgosDe(req.params.id);
    res.json({ success: true, data: { hallazgos } });
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
