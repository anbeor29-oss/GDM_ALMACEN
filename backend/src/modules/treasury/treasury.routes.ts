/**
 * /treasury — programación de pagos a proveedores (Fase 6 ALMACEN).
 *
 *  Lectura: cualquier usuario de la empresa.
 *  Pagar / reprogramar / cancelar / alta manual: ADMIN, MANAGER.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, requireCapability } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as service from './treasury.service';
import * as remesas from './remesas.service';
import { generarPdfRemesa } from './pdf-remesa.service';
import multer from 'multer';
import * as bancos from './bancos.service';
import { BANKS_MX } from '../suppliers/banks-mx';
import { textoDePdf } from './extractor-movimientos.service';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/** GET /treasury/payments — lista de pagos programados */
router.get(
  '/payments',
  asyncHandler(async (req: Request, res: Response) => {
    const payments = await service.listPayments(companyId(req), {
      status: req.query.status as any,
      supplierId: req.query.supplierId as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      sinRemesa: req.query.sinRemesa === 'true',
    });
    res.json({ success: true, data: { payments } });
  })
);

/** GET /treasury/summary — KPIs (vencido / esta semana / pendiente total) */
router.get(
  '/summary',
  asyncHandler(async (req: Request, res: Response) => {
    const summary = await service.getSummary(companyId(req));
    res.json({ success: true, data: summary });
  })
);

/** POST /treasury/payments — alta manual */
router.post(
  '/payments',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.createManual(companyId(req), req.body);
    res.status(201).json({ success: true, data: result });
  })
);

/** POST /treasury/payments/:id/pay — marcar pagado (libera crédito) */
router.post(
  '/payments/:id/pay',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.markPaid(companyId(req), req.params.id, {
      paidAt: req.body?.paidAt,
      notes: req.body?.notes,
    });
    res.json({ success: true, data: result });
  })
);

/** PUT /treasury/payments/:id/reschedule — cambiar fecha de vencimiento */
router.put(
  '/payments/:id/reschedule',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.reschedule(companyId(req), req.params.id, req.body?.dueDate);
    res.json({ success: true, data: result });
  })
);

/** POST /treasury/payments/:id/cancel — cancelar pago (libera crédito) */
router.post(
  '/payments/:id/cancel',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.cancelPayment(companyId(req), req.params.id, req.body?.motivo);
    res.json({ success: true, data: result });
  })
);

/* ═══════════════ REMESAS — la lista del viernes para el lunes ═══════════════ */

/** GET /treasury/payment-runs — corridas con sus totales */
router.get(
  '/payment-runs',
  asyncHandler(async (req: Request, res: Response) => {
    const runs = await remesas.listarRemesas(companyId(req), {
      from:   req.query.from as string | undefined,
      to:     req.query.to as string | undefined,
      status: req.query.status as string | undefined,
    });
    res.json({ success: true, data: { runs } });
  })
);

/** GET /treasury/payment-runs/:id — el reporte que se lleva al banco */
router.get(
  '/payment-runs/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const data = await remesas.detalleRemesa(companyId(req), req.params.id);
    res.json({ success: true, data });
  })
);

/**
 * GET /treasury/payment-runs/:id/pdf — la remesa en una hoja.
 *
 * Quien autoriza firma un papel, no una pantalla, y quien captura las
 * transferencias necesita las CLABE junto a los importes. Se abre en el
 * navegador con ?inline=1 y si no, se descarga.
 */
router.get(
  '/payment-runs/:id/pdf',
  asyncHandler(async (req: Request, res: Response) => {
    const buf = await generarPdfRemesa(companyId(req), req.params.id);
    const inline = req.query.inline === '1' || req.query.inline === 'true';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="remesa-${req.params.id.slice(0, 8)}.pdf"`
    );
    res.send(buf);
  })
);

/** POST /treasury/payment-runs — arma la remesa con las facturas elegidas */
router.post(
  '/payment-runs',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await remesas.crearRemesa(companyId(req), {
      paymentDate: req.body?.paymentDate,
      notes:       req.body?.notes,
      paymentIds:  req.body?.paymentIds,
    }, { userId: req.user?.userId, email: req.user?.email });
    res.status(201).json({ success: true, data: result });
  })
);

/** POST /treasury/payment-runs/:id/payments — agregar más facturas */
router.post(
  '/payment-runs/:id/payments',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await remesas.agregarPagosARemesa(
      companyId(req), req.params.id, req.body?.paymentIds || []
    );
    res.json({ success: true, data: result });
  })
);

/** DELETE /treasury/payment-runs/:id/payments/:paymentId — sacar una factura */
router.delete(
  '/payment-runs/:id/payments/:paymentId',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await remesas.quitarPagoDeRemesa(
      companyId(req), req.params.id, req.params.paymentId
    );
    res.json({ success: true, data: result });
  })
);

/** PUT /treasury/payment-runs/:id/status — autorizar, pagar o cancelar */
router.put(
  '/payment-runs/:id/status',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const status = String(req.body?.status || '').toUpperCase() as remesas.EstadoRemesa;
    if (!status) throw new ValidationError('status es obligatorio');
    const result = await remesas.cambiarEstadoRemesa(
      companyId(req), req.params.id, status,
      { userId: req.user?.userId, email: req.user?.email }
    );
    res.json({ success: true, data: result });
  })
);



/* ═══════════════════ BANCOS ═══════════════════
 *
 * Cuentas bancarias, estados de cuenta y el saldo AL CORTE. Todo pide
 * `treasury:pay`: quien programa los pagos es quien necesita saber cuánto hay.
 */

const subir = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

/**
 * GET /treasury/bancos/catalogo — los bancos con su clave de 3 dígitos.
 *
 * Es el catálogo de participantes SPEI (claves ABM/CNBV), el mismo que usa
 * nómina. Se expone también aquí porque el grupo TESORERIA no alcanza el módulo
 * de nómina, y sin esto tendría que teclear el nombre del banco a mano — que es
 * como nacen "Bancrea", "BANCREA" y "Banco Bancrea" como tres bancos distintos.
 *
 * La clave importa más que el nombre: son los tres primeros dígitos de la
 * CLABE, y si no cuadran con la cuenta, la transferencia rebota.
 */
router.get(
  '/bancos/catalogo',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: { bancos: BANKS_MX } });
  })
);

router.get(
  '/bancos/cuentas',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: { cuentas: await bancos.listarCuentas(companyId(req)) } });
  })
);

router.post(
  '/bancos/cuentas',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const c = await bancos.crearCuenta(companyId(req), req.body || {});
    res.status(201).json({ success: true, data: c });
  })
);

router.put(
  '/bancos/cuentas/:id',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    const c = await bancos.actualizarCuenta(companyId(req), req.params.id, req.body || {});
    res.json({ success: true, data: c });
  })
);

router.delete(
  '/bancos/cuentas/:id',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: await bancos.borrarCuenta(companyId(req), req.params.id) });
  })
);

/**
 * POST /treasury/bancos/estados — carga un estado de cuenta.
 *
 * Acepta el texto pegado o un archivo. Con un PDF se intenta leer su texto y
 * **se rechaza si los importes llegan pegados**: entregar cifras que se
 * partieron mal es peor que no entregar nada. Los escaneados no se pueden: este
 * servidor no tiene OCR.
 */
router.post(
  '/bancos/estados',
  requireCapability('treasury:pay'),
  subir.single('archivo'),
  asyncHandler(async (req: Request, res: Response) => {
    let texto = String(req.body?.texto || '');
    let origen: 'PDF' | 'TEXTO' | 'CSV' = 'TEXTO';
    let archivoNombre: string | undefined;

    if (req.file) {
      archivoNombre = req.file.originalname;
      const esPdf = /\.pdf$/i.test(archivoNombre) || /pdf/i.test(req.file.mimetype || '');
      if (esPdf) {
        const r = await textoDePdf(req.file.buffer);
        if (!r.utilizable) throw new ValidationError(r.motivo || 'No se pudo leer el PDF');
        texto = r.texto;
        origen = 'PDF';
      } else {
        /* CSV o texto plano: es la fuente más confiable que hay, porque no hay
         * nada que adivinar sobre la disposición de las columnas. */
        texto = req.file.buffer.toString('utf8');
        origen = /\.csv$/i.test(archivoNombre) ? 'CSV' : 'TEXTO';
      }
    }

    const r = await bancos.cargarEstadoDeCuenta(
      companyId(req),
      {
        cuentaId: req.body?.cuentaId,
        anio: Number(req.body?.anio),
        mes: Number(req.body?.mes),
        texto,
        origen,
        archivoNombre,
      },
      req.user?.userId
    );
    res.status(201).json({ success: true, data: r });
  })
);

router.get(
  '/bancos/cuentas/:id/estados',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({
      success: true,
      data: { estados: await bancos.listarEstados(companyId(req), req.params.id) },
    });
  })
);

router.get(
  '/bancos/cuentas/:id/control',
  asyncHandler(async (req: Request, res: Response) => {
    const anio = req.query.anio ? Number(req.query.anio) : undefined;
    res.json({
      success: true,
      data: await bancos.controlMensual(companyId(req), req.params.id, anio),
    });
  })
);

router.get(
  '/bancos/estados/:id',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: await bancos.detalleEstado(companyId(req), req.params.id) });
  })
);

router.delete(
  '/bancos/estados/:id',
  requireCapability('treasury:pay'),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: await bancos.borrarEstado(companyId(req), req.params.id) });
  })
);

/**
 * GET /treasury/bancos/estados/:id/csv — el archivo puente.
 *
 * Las mismas columnas del banco, ya normalizadas, con el saldo arrastrado al
 * lado del declarado y una columna INFERIDO: un movimiento que dedujo el
 * sistema no puede llegar a contabilidad sin decir que lo es.
 */
router.get(
  '/bancos/estados/:id/csv',
  asyncHandler(async (req: Request, res: Response) => {
    const { csv, nombre } = await bancos.csvDeEstado(companyId(req), req.params.id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(csv);
  })
);

/** GET /treasury/bancos/estados/:id/excel — el estado de cuenta como .xlsx. */
router.get(
  '/bancos/estados/:id/excel',
  asyncHandler(async (req: Request, res: Response) => {
    const { buffer, nombre } = await bancos.excelDeEstado(companyId(req), req.params.id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(buffer);
  })
);

export default router;
