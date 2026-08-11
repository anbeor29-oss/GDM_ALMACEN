/**
 * /sat-descarga — el motor de descarga masiva, visto desde la pantalla.
 *
 * QUIÉN PUEDE QUÉ
 * Cargar la e.firma y lanzar trabajos: sólo ADMIN. Es la credencial con la que
 * el SAT identifica al contribuyente; no es una atribución que se reparta.
 * Consultar los comprobantes ya traídos: cualquiera con el módulo Auditoría,
 * porque para eso se trajeron.
 *
 * LO QUE NO EXISTE A PROPÓSITO
 * No hay ruta que devuelva el .cer, el .key ni la contraseña. Entran, se cifran
 * y se usan. Una bóveda con puerta de salida no es una bóveda.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticateToken, authorize } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as service from './descarga.service';
import { bovedaLista } from './boveda';
import { EfirmaInvalida } from './efirma';

const router = Router();
router.use(authenticateToken);

/* En memoria y con tope: la e.firma nunca toca el disco del servidor. En Render
 * el disco además es efímero, así que un archivo escrito ahí sería un secreto
 * abandonado en una máquina que se recicla. */
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024, files: 2 },
});

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/** GET /sat-descarga/credencial — qué e.firma hay, sin devolverla */
router.get(
  '/credencial',
  asyncHandler(async (req: Request, res: Response) => {
    const credencial = await service.credencialDeEmpresa(companyId(req));
    res.json({ success: true, data: { credencial, bovedaLista: bovedaLista() } });
  })
);

/** POST /sat-descarga/credencial — carga la e.firma (.cer + .key + contraseña) */
router.post(
  '/credencial',
  authorize('ADMIN', 'SUPER_ADMIN'),
  subida.fields([{ name: 'cer', maxCount: 1 }, { name: 'key', maxCount: 1 }]),
  asyncHandler(async (req: Request, res: Response) => {
    const archivos = req.files as Record<string, Express.Multer.File[]> | undefined;
    const cer = archivos?.cer?.[0]?.buffer;
    const key = archivos?.key?.[0]?.buffer;
    const password = String(req.body?.password || '');

    /* La bóveda se revisa ANTES de mirar los archivos.
     *
     * Sin esto, la contraseña de la e.firma ya viajó hasta aquí para morir en un
     * error de configuración del servidor —y el usuario recibía un 500 genérico
     * en vez de saber qué falta. Se contesta con el motivo y sin tocar nada. */
    if (!bovedaLista()) {
      throw new ValidationError(
        'El servidor todavía no tiene configurada la llave de la bóveda ' +
        '(SAT_VAULT_KEY). Hasta que exista, la e.firma no se puede guardar cifrada ' +
        'y el módulo no la acepta. Es una variable de entorno del backend.'
      );
    }

    if (!cer || !key) throw new ValidationError('Faltan los archivos .cer y .key de la e.firma');
    if (!password) throw new ValidationError('Falta la contraseña de la clave privada');

    try {
      const data = await service.guardarCredencial(
        companyId(req),
        { cer, key, password, borrarAlTerminar: req.body?.borrarAlTerminar !== 'false' },
        req.user?.userId
      );
      res.status(201).json({ success: true, data });
    } catch (e) {
      /* Los motivos de EfirmaInvalida están escritos para que quien los lea sepa
       * qué hacer, así que viajan tal cual con un 400 en vez de convertirse en
       * un 500 genérico. */
      if (e instanceof EfirmaInvalida) throw new ValidationError(e.message);
      throw e;
    }
  })
);

/** DELETE /sat-descarga/credencial — borra la e.firma guardada */
router.delete(
  '/credencial',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    await service.borrarCredencial(companyId(req));
    res.json({ success: true, message: 'e.firma borrada' });
  })
);

/** GET /sat-descarga/trabajos */
router.get(
  '/trabajos',
  asyncHandler(async (req: Request, res: Response) => {
    const trabajos = await service.listarTrabajos(companyId(req));
    res.json({ success: true, data: { trabajos } });
  })
);

/** GET /sat-descarga/trabajos/:id — con sus particiones */
router.get(
  '/trabajos/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.detalleTrabajo(companyId(req), req.params.id);
    res.json({ success: true, data });
  })
);

/** POST /sat-descarga/trabajos — "tráeme lo recibido de enero" */
router.post(
  '/trabajos',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const trabajo = await service.crearTrabajo(companyId(req), {
      desde:      req.body?.desde,
      hasta:      req.body?.hasta,
      direccion:  req.body?.direccion === 'emitidos' ? 'emitidos' : 'recibidos',
      tipo:       req.body?.tipo,
      filtros:    req.body?.filtros,
    }, req.user?.userId);
    res.status(201).json({ success: true, data: trabajo });
  })
);

/**
 * POST /sat-descarga/avanzar — un paso del motor, a mano.
 *
 * Es la MISMA función que corre el cron. Dos caminos distintos para lo mismo
 * garantizarían que uno de los dos se quede atrás.
 */
router.post(
  '/avanzar',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await service.avanzar(companyId(req), req.body?.trabajoId);
    res.json({ success: true, data: r });
  })
);

/** GET /sat-descarga/comprobantes — los XML ya traídos */
router.get(
  '/comprobantes',
  asyncHandler(async (req: Request, res: Response) => {
    const comprobantes = await service.listarComprobantes(companyId(req), {
      anio:      req.query.anio ? Number(req.query.anio) : undefined,
      mes:       req.query.mes ? Number(req.query.mes) : undefined,
      direccion: req.query.direccion as string | undefined,
      rfc:       req.query.rfc as string | undefined,
      buscar:    req.query.buscar as string | undefined,
    });
    res.json({ success: true, data: { comprobantes } });
  })
);

/** GET /sat-descarga/comprobantes/resumen */
router.get(
  '/comprobantes/resumen',
  asyncHandler(async (req: Request, res: Response) => {
    const resumen = await service.resumenComprobantes(
      companyId(req),
      req.query.anio ? Number(req.query.anio) : undefined,
      req.query.mes ? Number(req.query.mes) : undefined
    );
    res.json({ success: true, data: resumen });
  })
);

export default router;
