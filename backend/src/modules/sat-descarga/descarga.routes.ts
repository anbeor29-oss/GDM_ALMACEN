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
import * as programacion from './programacion.service';
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

/**
 * POST /sat-descarga/reiniciar — borra trabajos, particiones, paquetes y el
 * consumo del día para monitorear en limpio. NO toca la e.firma ni la config.
 * Sólo ADMIN: es una acción destructiva sobre el histórico de solicitudes.
 */
router.post(
  '/reiniciar',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await service.reiniciarDescarga(companyId(req));
    res.json({
      success: true,
      message: `Monitor reiniciado: ${r.trabajos} trabajo(s) borrados y cupo del día en cero.`,
      data: r,
    });
  })
);

/**
 * POST /sat-descarga/reintentar — re-arma las solicitudes atoradas (rechazadas o
 * fallidas) sin borrar nada más. Para usar tras corregir la causa del rechazo:
 * conserva lo que va en vuelo y el cupo ya gastado del día.
 */
router.post(
  '/reintentar',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await service.reintentarAtoradas(companyId(req));
    res.json({
      success: true,
      message: r.particiones
        ? `${r.particiones} solicitud(es) re-armadas. Se volverán a pedir en la próxima corrida o con "Avanzar ahora".`
        : 'No había solicitudes atoradas que reintentar.',
      data: r,
    });
  })
);

/**
 * POST /sat-descarga/diagnostico — prueba de solo lectura: autentica la e.firma
 * y le pregunta al SAT qué pasa con las solicitudes en vuelo. No cambia nada.
 */
router.post(
  '/diagnostico',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: await service.diagnostico(companyId(req)) });
  })
);

/* ═══════════════════════════════════════════════════════════════════════════
   PROGRAMACIÓN — el día a día y los ejercicios completos
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * GET /sat-descarga/programacion
 *
 * Cómo va la descarga de verdad: el desglose por estado, el presupuesto del
 * día y cuándo corrió el último trabajo diario.
 *
 * El resumen anterior sumaba TERMINADA, SIN_DATOS, RECHAZADA y FALLIDA en un
 * solo número, así que "4/5" no decía si esas cuatro salieron bien sin
 * comprobantes o si el SAT las rechazó — que es justo lo que hay que saber
 * cuando se está probando una e.firma.
 */
router.get(
  '/programacion',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await programacion.comoVa(companyId(req));
    res.json({ success: true, data });
  })
);

/** PUT /sat-descarga/programacion — cada cuánto y cuánto por día */
router.put(
  '/programacion',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const config = await programacion.guardarConfig(companyId(req), {
      diariaActiva: req.body.diariaActiva,
      diariaRecibidos: req.body.diariaRecibidos,
      diariaEmitidos: req.body.diariaEmitidos,
      diasAtras: req.body.diasAtras ? Number(req.body.diasAtras) : undefined,
      xmlPorDia: req.body.xmlPorDia ? Number(req.body.xmlPorDia) : undefined,
      solicitudesPorDia: req.body.solicitudesPorDia
        ? Number(req.body.solicitudesPorDia) : undefined,
    });
    res.json({ success: true, data: { config } });
  })
);

/**
 * POST /sat-descarga/diario — crea ahora el trabajo del día.
 *
 * El cron lo hace solo a las 6:00, pero el botón sirve para el primer día y
 * para cuando se quiere comprobar que la e.firma responde sin esperar.
 */
router.post(
  '/diario',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const r = await programacion.crearTrabajoDiario(companyId(req), req.user?.userId);
    res.json({
      success: true, data: r,
      message: r.creados.length
        ? `${r.creados.length} trabajo(s) creado(s): ` +
          r.creados.map((c: any) => `${c.direccion} ${c.desde} a ${c.hasta}`).join(' · ')
        : (r.omitidos[0] || 'No había nada nuevo que pedir.'),
    });
  })
);

/**
 * POST /sat-descarga/ejercicio — un año completo, mes por mes.
 *
 * No descarga de inmediato: crea los trabajos y el motor los va bajando dentro
 * del presupuesto diario. Un ejercicio con volumen tarda varios días, y eso es
 * lo correcto — bajarlo de golpe dejaría sin cupo a la descarga del día.
 */
router.post(
  '/ejercicio',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const ejercicio = Number(req.body.ejercicio);
    if (!ejercicio) throw new ValidationError('Falta el ejercicio.');
    const r = await programacion.crearTrabajoEjercicio(
      companyId(req), ejercicio,
      {
        recibidos: req.body.recibidos !== false,
        emitidos: req.body.emitidos !== false,
        hastaMes: req.body.hastaMes ? Number(req.body.hastaMes) : undefined,
      },
      req.user?.userId
    );
    res.json({ success: true, data: r, message: r.aviso });
  })
);

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

/**
 * POST /sat-descarga/trabajos — "tráeme lo de este periodo".
 *
 * `direccion` admite 'ambos', y entonces se crean DOS trabajos. No es un
 * capricho de la interfaz: el SAT tiene operaciones distintas para emitidos y
 * recibidos y no acepta pedir las dos en una solicitud. Que el usuario tenga
 * que apretar dos botones para expresar "todo lo del mes" era trasladarle esa
 * costura; aquí se resuelve del lado que sabe de ella.
 */
router.post(
  '/trabajos',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const pedida = String(req.body?.direccion || 'recibidos');
    const direcciones: Array<'recibidos' | 'emitidos'> =
      pedida === 'ambos' ? ['recibidos', 'emitidos']
      : pedida === 'emitidos' ? ['emitidos']
      : ['recibidos'];

    /* El 301 "no se permite la descarga de xml que se encuentren cancelados" salta
     * cuando el rango de RECIBIDOS mezcla vigentes y cancelados. La estrategia:
     *   · EMITIDOS  → CFDI + Metadata (sin acotar: el XML propio siempre baja).
     *   · RECIBIDOS → se piden los VIGENTES (EstadoComprobante=1) como CFDI (su XML,
     *     base de la póliza de compra) + Metadata; los CANCELADOS van APARTE, por
     *     el checkbox "También los cancelados" (Metadata EstadoComprobante=0), ya
     *     que su XML el SAT no lo entrega.
     * Si aun así el SAT rechazara el CFDI de recibidos, queda «Subir XML de compra»
     * (Contabilidad → Pólizas de compra) para contabilizar el comprobante. */
    const tipoPedido = req.body?.tipo;
    const base = { desde: req.body?.desde, hasta: req.body?.hasta, filtros: req.body?.filtros };
    const nuevo = (direccion: 'recibidos' | 'emitidos', tipo: 'CFDI' | 'Metadata', estado?: string) =>
      service.crearTrabajo(
        companyId(req),
        { ...base, direccion, tipo, filtros: estado ? { ...(base.filtros || {}), estadoComprobante: estado } : base.filtros },
        req.user?.userId);

    const trabajos = [];
    for (const direccion of direcciones) {
      if (tipoPedido) {
        trabajos.push(await nuevo(direccion, tipoPedido));
      } else if (direccion === 'recibidos') {
        /* Los VIGENTES sí traen XML si se acota a EstadoComprobante=1: se piden su
         * CFDI (el XML, base de la póliza de compra) y su metadato. Los CANCELADOS
         * van en un pedido APARTE (el checkbox "También los cancelados" lanza un
         * Metadata con EstadoComprobante=0), porque su XML el SAT no lo entrega. */
        trabajos.push(await nuevo('recibidos', 'CFDI', '1'));
        trabajos.push(await nuevo('recibidos', 'Metadata', '1'));
      } else {
        trabajos.push(await nuevo('emitidos', 'CFDI'));
        trabajos.push(await nuevo('emitidos', 'Metadata'));
      }
    }

    res.status(201).json({
      success: true,
      data: {
        trabajos,
        /* Se devuelven sumados porque es lo que la pantalla anuncia: al usuario
         * le importa cuántas solicitudes salieron, no cómo se repartieron. */
        particiones_total: trabajos.reduce((a, t) => a + Number(t.particiones_total || 0), 0),
        dias_por_bloque: trabajos[0]?.dias_por_bloque,
      },
    });
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

/** GET /sat-descarga/comprobantes/vista — la tabla del submenú (Emitidos/Recibidos) */
router.get(
  '/comprobantes/vista',
  asyncHandler(async (req: Request, res: Response) => {
    const comprobantes = await service.listarComprobantesVista(companyId(req), {
      direccion: (req.query.direccion as string) || 'emitidos',
      anio:      req.query.anio ? Number(req.query.anio) : undefined,
      mes:       req.query.mes ? Number(req.query.mes) : undefined,
      buscar:    req.query.buscar as string | undefined,
    });
    res.json({ success: true, data: { comprobantes } });
  })
);

/** GET /sat-descarga/comprobantes/:id — detalle: XML+pagos (emitidos) o ficha (recibidos) */
router.get(
  '/comprobantes/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await service.detalleComprobante(companyId(req), req.params.id);
    if (!data) { res.status(404).json({ success: false, message: 'No se encontró el comprobante' }); return; }
    res.json({ success: true, data });
  })
);

/** PUT /sat-descarga/comprobantes/:id/cuenta — asigna la cuenta contable (CC) */
router.put(
  '/comprobantes/:id/cuenta',
  authorize('ADMIN', 'SUPER_ADMIN'),
  asyncHandler(async (req: Request, res: Response) => {
    const ok = await service.asignarCuentaContable(
      companyId(req), req.params.id, (req.body?.cuenta ?? null) as string | null);
    if (!ok) { res.status(404).json({ success: false, message: 'No se encontró el comprobante' }); return; }
    res.json({ success: true });
  })
);

export default router;
