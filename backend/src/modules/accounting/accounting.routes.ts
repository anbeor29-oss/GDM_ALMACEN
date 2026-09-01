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
import * as periodos from './periodos.service';
import * as polizas from './polizas.service';
import * as terceros from './catalogo-terceros.service';
import * as ventas from './ventas-cuentas.service';
import * as compras from './compras-cuentas.service';
import * as activos from './activos-fijos.service';
import * as contpaqi from './contpaqi-import.service';
import { query } from '../../config/database';
import { indexarCfdi } from '../sat-descarga/descarga.service';
import multer from 'multer';
import archiver from 'archiver';
import * as fs from 'fs';
import * as path from 'path';

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

/** GET /accounting/agrupadores — los códigos del Anexo 24 para el desplegable */
router.get(
  '/agrupadores',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: { agrupadores: await catalogo.listarAgrupadoresSat() } });
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
   PERIODOS — el acumulador que alimenta a todos los estados
   ═══════════════════════════════════════════════════════════════════════════ */

/** GET /accounting/periodos/:anio — los doce meses, con lo que tiene cada uno */
router.get(
  '/periodos/:anio',
  asyncHandler(async (req: Request, res: Response) => {
    const anio = Number(req.params.anio);
    if (!anio || anio < 2000 || anio > 2100) throw new ValidationError('Año inválido.');
    const data = await periodos.anioCompleto(companyId(req), anio);
    res.json({ success: true, data });
  })
);

/** GET /accounting/periodos/:anio/:mes */
router.get(
  '/periodos/:anio/:mes',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await periodos.estadoDelPeriodo(
      companyId(req), Number(req.params.anio), Number(req.params.mes));
    res.json({ success: true, data });
  })
);

/**
 * POST /accounting/periodos/:anio/:mes/balanza
 *
 * Alimenta el mes con una balanza externa. A diferencia de la ruta de estados
 * financieros —que sólo LEE un archivo—, esto lo DEJA GUARDADO en el periodo:
 * a partir de aquí todos los estados de ese mes salen de estos saldos, sin
 * volver a subir nada.
 */
router.post(
  '/periodos/:anio/:mes/balanza',
  requireCapability('contabilidad:capturar'),
  subir.single('archivo'),
  asyncHandler(async (req: Request, res: Response) => {
    const f = (req as any).file;
    if (!f) throw new ValidationError('Falta el archivo de la balanza.');
    const anio = Number(req.params.anio);
    const mes = Number(req.params.mes);

    const nombre = (f.originalname || '').toLowerCase();
    const esExcel = /\.xlsx?$/.test(nombre) || /spreadsheet|excel/.test(f.mimetype || '');
    const esPdf = /\.pdf$/.test(nombre) || /pdf/.test(f.mimetype || '');
    if (!esExcel && !esPdf) throw new ValidationError('El archivo tiene que ser Excel o PDF.');

    let lectura;
    try {
      lectura = esExcel ? await balanza.leerBalanzaExcel(f.buffer)
                        : await balanza.leerBalanzaPdf(f.buffer);
    } catch (e: any) { throw new ValidationError(e.message); }

    const analisis = balanza.analizarBalanza(lectura);
    /* No se carga una balanza que no cuadra: quedaría guardada, y todos los
     * estados del mes saldrían de ella. */
    if (!analisis.cuadra) {
      throw new ValidationError(
        `La balanza no cuadra: cargos ${analisis.sumaDebe.toFixed(2)} contra abonos ` +
        `${analisis.sumaHaber.toFixed(2)}. No se guarda: si se cargara, todos los ` +
        `estados de ese mes saldrían de un descuadre.`);
    }

    const validos = await mapeador.agrupadoresValidos();
    const mapeo = mapeador.proponerMapeo(lectura.filas, { agrupadoresValidos: validos });

    const r = await periodos.alimentarDesdeBalanza(
      companyId(req), anio, mes, lectura.filas, mapeo,
      { archivo: f.originalname, userId: req.user?.userId,
        descripcion: lectura.encabezado.razonSocial });

    res.json({
      success: true,
      data: { ...r, encabezado: lectura.encabezado, origen: lectura.origen },
      message:
        `${periodos.nombreMes(mes)} ${anio}: ${r.cuentas} cuentas cargadas` +
        (r.cuentasNuevas ? ` (${r.cuentasNuevas} nuevas en el catálogo)` : '') + '.',
    });
  })
);

/** POST /accounting/periodos/:anio/:mes/desde-polizas — deriva la balanza de las pólizas */
router.post(
  '/periodos/:anio/:mes/desde-polizas',
  requireCapability('contabilidad:capturar'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await periodos.alimentarDesdePolizas(
      companyId(req), Number(req.params.anio), Number(req.params.mes), { userId: req.user?.userId });
    res.json({
      success: true, data: r,
      message: `${periodos.nombreMes(Number(req.params.mes))} ${req.params.anio}: balanza actualizada con ` +
        `${r.cuentas} cuenta(s) de las pólizas` + (r.cuadra ? '.' : ' — NO cuadra, revisa.'),
    });
  })
);

/** POST /accounting/periodos/:anio/:mes/cerrar */
router.post(
  '/periodos/:anio/:mes/cerrar',
  requireCapability('contabilidad:cerrar'),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await periodos.cerrarPeriodo(
      companyId(req), Number(req.params.anio), Number(req.params.mes), req.user?.userId);
    res.json({
      success: true, data,
      message: `${periodos.nombreMes(Number(req.params.mes))} ${req.params.anio} cerrado. ` +
               `Sus saldos quedan congelados.`,
    });
  })
);

/** POST /accounting/periodos/:anio/:mes/reabrir */
router.post(
  '/periodos/:anio/:mes/reabrir',
  requireCapability('contabilidad:cerrar'),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await periodos.reabrirPeriodo(
      companyId(req), Number(req.params.anio), Number(req.params.mes));
    res.json({ success: true, data });
  })
);

/**
 * GET /accounting/estados/:anio/:mes
 *
 * Todos los estados del mes, desde los saldos del periodo. Si se pasa
 * ?comparar=true toma el mes anterior para flujo, cambios en capital y
 * análisis horizontal.
 */
router.get(
  '/estados/:anio/:mes',
  asyncHandler(async (req: Request, res: Response) => {
    const cid = companyId(req);
    const anio = Number(req.params.anio);
    const mes = Number(req.params.mes);

    const estadoPeriodo = await periodos.estadoDelPeriodo(cid, anio, mes);
    const ctx = await periodos.contextoDelPeriodo(cid, anio, mes);

    if (!ctx) {
      /* El cascarón vacío: se dice qué falta y cómo se llena, en vez de
       * devolver un juego de estados en ceros que parece una empresa quieta. */
      res.json({
        success: true,
        data: {
          anio, mes, nombreMes: periodos.nombreMes(mes),
          periodo: estadoPeriodo, vacio: true,
          comoSeLlena: [
            'Cargando la balanza del mes desde otro sistema (Excel o PDF).',
            'Con los CFDI emitidos y recibidos del mes, cuando el motor contable los procese.',
            'Con las pólizas capturadas o importadas de otro sistema.',
          ],
        },
        message: `${periodos.nombreMes(mes)} ${anio} todavía no tiene saldos cargados.`,
      });
      return;
    }

    /* El mes anterior: puede ser diciembre del año pasado. */
    const mesAnt = mes === 1 ? 12 : mes - 1;
    const anioAnt = mes === 1 ? anio - 1 : anio;
    const ctxAnt = await periodos.contextoDelPeriodo(cid, anioAnt, mesAnt) ?? undefined;

    const p = await periodos.balanzaDelPeriodo(cid, anio, mes);
    const dias = p ? Math.round(
      (new Date(p.fechaFin).getTime() - new Date(p.fechaInicio).getTime()) / 86400000) + 1 : 30;

    const juego = estados.juegoCompleto(ctx, ctxAnt, dias);
    const nifRes = motorNif.evaluar(ctx);

    res.json({
      success: true,
      data: {
        anio, mes, nombreMes: periodos.nombreMes(mes),
        periodo: estadoPeriodo, vacio: false,
        diasPeriodo: dias,
        comparadoCon: ctxAnt ? { anio: anioAnt, mes: mesAnt } : null,
        ...juego,
        nif: {
          noCumple: nifRes.noCumple, revisar: nifRes.revisar, cumple: nifRes.cumple,
          hallazgos: nifRes.hallazgos.filter((h) => h.estado !== 'NO_APLICA'),
        },
      },
    });
  })
);

/** GET /accounting/estados/:anio/:mes/balanza — la balanza del periodo */
router.get(
  '/estados/:anio/:mes/balanza',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await periodos.balanzaDelPeriodo(
      companyId(req), Number(req.params.anio), Number(req.params.mes));
    res.json({ success: true, data: data ?? { vacio: true } });
  })
);

/** GET /accounting/estados/:anio/:mes/auxiliar?cuenta=CODIGO — el auxiliar de una cuenta */
router.get(
  '/estados/:anio/:mes/auxiliar',
  asyncHandler(async (req: Request, res: Response) => {
    const cuenta = String(req.query.cuenta || '').trim();
    if (!cuenta) throw new ValidationError('Falta la cuenta.');
    const data = await periodos.auxiliarDeCuenta(
      companyId(req), cuenta, Number(req.params.anio), Number(req.params.mes));
    if (!data) { res.status(404).json({ success: false, message: 'No se encontró la cuenta' }); return; }
    res.json({ success: true, data });
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

/* ═══════════════════════════════════════════════════════════════════════════
   PÓLIZAS — paso 1: ventas (de facturas emitidas asignadas)
   ═══════════════════════════════════════════════════════════════════════════ */

/** GET /accounting/ventas/productos?anio&mes — ClaveProdServ de emitidos con su 401 */
router.get(
  '/ventas/productos',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await ventas.clavesProdServDeEmitidos(
      companyId(req), Number(req.query.anio), Number(req.query.mes));
    res.json({ success: true, data: { productos: data } });
  })
);

/** PUT /accounting/ventas/productos — asigna la cuenta 401 a una ClaveProdServ */
router.put(
  '/ventas/productos',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    await ventas.asignarCuentaProducto(
      companyId(req), String(req.body?.clave), req.body?.descripcion ?? null, req.body?.cuenta ?? null);
    res.json({ success: true });
  })
);

/** GET /accounting/compras/productos?anio&mes — ClaveProdServ de recibidos con su cuenta */
router.get(
  '/compras/productos',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await compras.clavesProdServDeRecibidos(
      companyId(req), Number(req.query.anio), Number(req.query.mes));
    res.json({ success: true, data: { productos: data } });
  })
);

/** PUT /accounting/compras/productos — asigna la cuenta (115/601) a una ClaveProdServ */
router.put(
  '/compras/productos',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    await compras.asignarCuentaProductoCompra(
      companyId(req), String(req.body?.clave), req.body?.descripcion ?? null, req.body?.cuenta ?? null);
    res.json({ success: true });
  })
);

/** GET /accounting/subcuentas?tipo=cliente|proveedor — las subcuentas ya creadas */
router.get(
  '/subcuentas',
  asyncHandler(async (req: Request, res: Response) => {
    const tipo = req.query.tipo === 'proveedor' ? 'proveedor' : 'cliente';
    res.json({ success: true, data: { subcuentas: await terceros.listarSubcuentasTercero(companyId(req), tipo) } });
  })
);

/** PUT /accounting/subcuentas/:id/codigo — captura/override manual del código */
router.put(
  '/subcuentas/:id/codigo',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await terceros.fijarCodigoSubcuenta(companyId(req), req.params.id, String(req.body?.codigo || ''));
    if ('error' in r) { res.status(400).json({ success: false, message: r.error }); return; }
    res.json({ success: true, data: r });
  })
);

/** POST /accounting/subcuentas/generar — da de alta la subcuenta de cada tercero */
router.post(
  '/subcuentas/generar',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const dir = req.body?.direccion === 'recibidos' ? 'recibidos' : 'emitidos';
    res.json({ success: true, data: await terceros.generarSubcuentasDeComprobantes(companyId(req), dir) });
  })
);

/** GET /accounting/polizas?anio&mes — las pólizas del mes con sus partidas */
router.get(
  '/polizas',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await polizas.listarPolizas(companyId(req), Number(req.query.anio), Number(req.query.mes));
    res.json({ success: true, data: { polizas: data } });
  })
);

/** POST /accounting/polizas/generar-ventas — arma las pólizas de venta del mes */
router.post(
  '/polizas/generar-ventas',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await polizas.generarVentasDelMes(
      companyId(req), Number(req.body?.anio), Number(req.body?.mes), req.user?.userId);
    res.json({ success: true, data: r });
  })
);

/**
 * POST /accounting/compras/subir-xml — sube uno o varios XML de facturas RECIBIDAS
 * y los indexa en cfdi_recibidos, para contabilizarlos aunque no vinieran de la
 * descarga masiva (recibidos que sólo bajaron como metadato, o compras cargadas
 * por el almacén). El compra debe tener a la empresa como RECEPTOR.
 */
router.post(
  '/compras/subir-xml',
  authorize('ADMIN', 'SUPER_ADMIN'),
  subir.array('archivos', 60),
  asyncHandler(async (req: Request, res: Response) => {
    const files = ((req as any).files || []) as Array<{ originalname: string; buffer: Buffer }>;
    if (!files.length) throw new ValidationError('Sube al menos un archivo XML.');
    const cid = companyId(req);
    const comp = await query<any>('SELECT UPPER(rfc) AS rfc FROM companies WHERE id=$1', [cid]);
    const rfc = (comp.rows[0]?.rfc || '').trim();
    if (!rfc) throw new ValidationError('La empresa activa no tiene RFC configurado.');

    let indexados = 0;
    const errores: Array<{ archivo: string; motivo: string }> = [];
    for (const f of files) {
      try {
        const xml = f.buffer.toString('utf8');
        const emisor = (/<(?:\w+:)?Emisor\b[^>]*\bRfc\s*=\s*"([^"]*)"/i.exec(xml)?.[1] || '').toUpperCase().trim();
        const receptor = (/<(?:\w+:)?Receptor\b[^>]*\bRfc\s*=\s*"([^"]*)"/i.exec(xml)?.[1] || '').toUpperCase().trim();
        if (emisor && emisor === rfc) { errores.push({ archivo: f.originalname, motivo: 'lo emitió la empresa: es una venta, no una compra' }); continue; }
        if (receptor && receptor !== rfc) { errores.push({ archivo: f.originalname, motivo: `el receptor es ${receptor}, no la empresa (${rfc})` }); continue; }
        await indexarCfdi(cid, rfc, 'recibidos', xml);
        indexados++;
      } catch (e: any) {
        errores.push({ archivo: f.originalname, motivo: (e?.message || 'no se pudo leer el XML').slice(0, 140) });
      }
    }
    res.json({ success: true, data: { indexados, errores } });
  })
);

/** POST /accounting/polizas/generar-compras — arma las pólizas de compra del mes */
router.post(
  '/polizas/generar-compras',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await polizas.generarComprasDelMes(
      companyId(req), Number(req.body?.anio), Number(req.body?.mes), req.user?.userId);
    res.json({ success: true, data: r });
  })
);

/** POST /accounting/polizas/generar-cobros-pagos — cobros y pagos (del complemento) del mes */
router.post(
  '/polizas/generar-cobros-pagos',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await polizas.generarCobrosPagosDelMes(
      companyId(req), Number(req.body?.anio), Number(req.body?.mes), req.user?.userId);
    res.json({ success: true, data: r });
  })
);

/** POST /accounting/polizas/manual — una póliza capturada a mano (cargos/abonos) */
router.post(
  '/polizas/manual',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await polizas.crearPolizaManual(companyId(req), req.body || {}, req.user?.userId);
    res.json({ success: true, data: { poliza: r } });
  })
);

/** DELETE /accounting/polizas/cfdi?anio&mes — borra las de origen CFDI (re-generar) */
router.delete(
  '/polizas/cfdi',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const borradas = await polizas.borrarVentasDelMes(companyId(req), Number(req.query.anio), Number(req.query.mes));
    res.json({ success: true, data: { borradas } });
  })
);

/** PUT /accounting/polizas/:id — edita las partidas/encabezado de una póliza */
router.put(
  '/polizas/:id',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await polizas.editarPoliza(companyId(req), req.params.id, req.body || {});
    res.json({ success: true, data: { poliza: r } });
  })
);

/** DELETE /accounting/polizas/:id — borra UNA póliza (cualquier origen) */
router.delete(
  '/polizas/:id',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const ok = await polizas.borrarPoliza(companyId(req), req.params.id);
    if (!ok) { res.status(404).json({ success: false, message: 'No se encontró la póliza' }); return; }
    res.json({ success: true });
  })
);

/* ═══════════════════════════════════════════════════════════════════════════
   ACTIVOS FIJOS Y DEPRECIACIÓN (LISR 33-35)
   ═══════════════════════════════════════════════════════════════════════════ */

/** GET /accounting/activos — la cédula (con depreciación mensual/anual y valor en libros) */
router.get(
  '/activos',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await activos.listarActivos(companyId(req));
    res.json({ success: true, data: { activos: data } });
  })
);

/** GET /accounting/activos/detectar?anio&mes — propone activos fijos desde las compras con XML */
router.get(
  '/activos/detectar',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await activos.detectarDesdeCompras(
      companyId(req), Number(req.query.anio), Number(req.query.mes));
    res.json({ success: true, data: { detectados: data } });
  })
);

/** GET /accounting/activos/:id/cedula — la depreciación mes a mes de un activo */
router.get(
  '/activos/:id/cedula',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await activos.cedulaMensual(companyId(req), req.params.id);
    if (!data) { res.status(404).json({ success: false, message: 'No se encontró el activo' }); return; }
    res.json({ success: true, data });
  })
);

/** POST /accounting/activos — registra un activo (alta manual o desde un candidato) */
router.post(
  '/activos',
  requireCapability('contabilidad:capturar'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await activos.registrarActivo(companyId(req), req.body || {}, req.user?.userId);
    res.json({ success: true, data: r });
  })
);

/** POST /accounting/activos/registrar-detectados — registra en bloque los candidatos elegidos */
router.post(
  '/activos/registrar-detectados',
  requireCapability('contabilidad:capturar'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await activos.registrarDetectados(companyId(req), req.body?.activos || [], req.user?.userId);
    res.json({ success: true, data: r });
  })
);

/** PUT /accounting/activos/:id — edita tasa, cuentas, mes de inicio, baja… */
router.put(
  '/activos/:id',
  requireCapability('contabilidad:capturar'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await activos.actualizarActivo(companyId(req), req.params.id, req.body || {});
    res.json({ success: true, data: r });
  })
);

/** DELETE /accounting/activos/:id — borra un activo sin depreciación asentada */
router.delete(
  '/activos/:id',
  requireCapability('contabilidad:capturar'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await activos.borrarActivo(companyId(req), req.params.id);
    if (!r.ok) { res.status(400).json({ success: false, message: r.motivo || 'No se pudo borrar' }); return; }
    res.json({ success: true });
  })
);

/** POST /accounting/polizas/generar-depreciacion — la póliza de depreciación del mes */
router.post(
  '/polizas/generar-depreciacion',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await activos.generarDepreciacionDelMes(
      companyId(req), Number(req.body?.anio), Number(req.body?.mes), req.user?.userId);
    res.json({ success: true, data: r });
  })
);

/* ═══════════════════════════════════════════════════════════════════════════
   IMPORTADOR CONTPAQi (migración de respaldos, cualquier empresa/RFC)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * POST /accounting/contpaqi/importar — sube el paquete JSON que produce el
 * extractor (cuentas, polizas, movimientos, poliza_cfdi, cfdi, saldos) y lo
 * carga en la empresa activa usando el motor de NEXO. Idempotente.
 */
router.post(
  '/contpaqi/importar',
  authorize('ADMIN', 'SUPER_ADMIN'),
  subir.fields([
    { name: 'empresa', maxCount: 1 }, { name: 'cuentas', maxCount: 1 }, { name: 'polizas', maxCount: 1 },
    { name: 'movimientos', maxCount: 1 }, { name: 'poliza_cfdi', maxCount: 1 },
    { name: 'cfdi', maxCount: 1 }, { name: 'saldos', maxCount: 1 },
  ]),
  asyncHandler(async (req: Request, res: Response) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const leer = (n: string): any[] => {
      const f = files?.[n]?.[0];
      if (!f) return [];
      const txt = f.buffer.toString('utf8').replace(/^﻿/, ''); // quita BOM de PowerShell
      try { const j = JSON.parse(txt); return Array.isArray(j) ? j : []; }
      catch { throw new ValidationError(`El archivo ${n}.json no es JSON válido.`); }
    };
    const paquete = {
      empresa: leer('empresa'), cuentas: leer('cuentas'), polizas: leer('polizas'), movimientos: leer('movimientos'),
      poliza_cfdi: leer('poliza_cfdi'), cfdi: leer('cfdi'), saldos: leer('saldos'),
    };
    if (!paquete.cuentas.length || !paquete.polizas.length) {
      throw new ValidationError('El paquete necesita al menos cuentas.json y polizas.json.');
    }
    const forzar = req.body?.forzar === 'true' || req.body?.forzar === true;
    const rep = await contpaqi.importarContpaqi(companyId(req), paquete, req.user?.userId, { forzar });
    res.json({ success: true, data: rep });
  })
);

/**
 * GET /accounting/contpaqi/herramienta — descarga la herramienta local para
 * importar respaldos .bak, YA configurada con la URL de ESTE servidor (así el
 * usuario no la teclea y sirve aunque la URL cambie en producción).
 */
router.get(
  '/contpaqi/herramienta',
  asyncHandler(async (req: Request, res: Response) => {
    const dir = path.resolve(__dirname, '../../../scripts/contpaqi');
    const origin = `https://${req.get('host')}`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="Importar respaldo NEXO.zip"');
    // @types/archiver v8 no tipa el default como callable, aunque en runtime lo es.
    const zip = (archiver as unknown as (f: string, o?: any) => import('archiver').Archiver)(
      'zip', { zlib: { level: 9 } });
    zip.on('error', (e: Error) => { res.destroy(e); });
    zip.pipe(res);
    for (const f of ['importar-respaldo.ps1', 'extraer-contpaqi.ps1', 'Importar respaldo.cmd']) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) zip.file(p, { name: f });
    }
    zip.append(origin, { name: 'nexo.txt' });    // la dirección de este servidor, para la herramienta
    await zip.finalize();
  })
);

export default router;
