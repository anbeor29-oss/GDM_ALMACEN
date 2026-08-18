/**
 * /nomina — expediente del personal y parámetros patronales.
 *
 * QUIÉN ENTRA AQUÍ
 * La nómina es el dato más sensible del sistema: sueldos, CURP, cuentas
 * bancarias y órdenes judiciales de pensión alimenticia. No es "un módulo más"
 * que se le pueda encender a quien captura facturas.
 *
 * Por eso el acceso está cerrado al grupo ADMIN_ALL (requireModule('nomina'))
 * y la escritura además exige rol ADMIN o SUPER_ADMIN. Es la postura
 * restrictiva a propósito: abrirlo después a un grupo de Recursos Humanos es
 * una línea; recoger sueldos que ya se vieron, no se puede.
 */

import { Router, Request, Response } from 'express';
import { authenticateToken, authorize } from '../../middleware/authentication';
import { requireModule } from '../../middleware/permissions';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as empleados from './empleados.service';
import * as parametros from './parametros.service';
import * as ejercicios from './ejercicios.service';
import * as periodos from './periodos.service';
import * as creditos from './creditos.service';
import * as expediente from './expediente.service';
import * as prenomina from './prenomina.service';
import { generarExcel } from './prenomina-excel.service';
import * as finiquito from './finiquito.service';
import * as cierre from './cierre.service';
import { BANKS_MX } from '../suppliers/banks-mx';
import { PERCEPCIONES, DEDUCCIONES } from './motor';

const router = Router();

router.use(authenticateToken);
router.use(requireModule('nomina'));

/** Sólo ADMIN escribe. MANAGER no: puede ver la plantilla, no cambiar sueldos. */
const soloAdmin = authorize('ADMIN', 'SUPER_ADMIN');

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Falta la empresa activa');
  return req.user.companyId;
}

/* ═════════════════════ CATÁLOGOS DEL SAT ═════════════════════ */

/** Lo que la pantalla necesita para pintar sus selectores. */
router.get(
  '/catalogos',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        tiposContrato: empleados.TIPOS_CONTRATO,
        tiposRegimen: empleados.TIPOS_REGIMEN,
        tiposJornada: empleados.TIPOS_JORNADA,
        periodicidades: empleados.PERIODICIDADES,
        riesgosPuesto: empleados.RIESGOS_PUESTO,
        zonas: empleados.ZONAS,
        tiposNomina: empleados.TIPOS_NOMINA,
        /* Conceptos de percepción y deducción con su regla de exención — los
         * necesita la prenómina para ofrecer el catálogo y explicar por qué un
         * concepto gravó lo que gravó. */
        percepciones: PERCEPCIONES,
        deducciones: DEDUCCIONES,
        clavesSatPeriodicidad: periodos.CLAVE_SAT,
        /* Bancos con su clave de 3 dígitos — la misma que forma los primeros
         * tres de la CLABE y la que va en nomina12:Receptor/@Banco. Se reusa el
         * catálogo que ya usa Proveedores en vez de tener dos listas que un día
         * digan cosas distintas. */
        bancos: BANKS_MX,
        origenesCredito: creditos.ORIGENES,
        tiposBitacora: expediente.TIPOS_BITACORA,
        tiposEntrega: expediente.TIPOS_ENTREGA,
        estadosDevolucion: expediente.ESTADOS_DEVOLUCION,
      },
    });
  })
);


/* ═════════════════ BITÁCORA Y ENTREGAS ═════════════════
 *
 * Lo confidencial se filtra en el SERVIDOR, no en la pantalla: lo que no se
 * manda no se puede mirar en el inspector del navegador. Sólo ADMIN lo ve.
 */

router.get(
  '/empleados/:id/bitacora',
  asyncHandler(async (req: Request, res: Response) => {
    const esAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user?.role || '');
    const notas = await expediente.listarBitacora(companyId(req), req.params.id, {
      verConfidenciales: esAdmin,
    });
    res.json({ success: true, data: { notas, veConfidenciales: esAdmin } });
  })
);

router.post(
  '/bitacora',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const n = await expediente.crearNota(companyId(req), req.body || {}, req.user?.userId);
    res.status(201).json({ success: true, data: n });
  })
);

/** Se cancela con su motivo. No hay borrado: el rastro es parte del historial. */
router.post(
  '/bitacora/:id/cancelar',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const n = await expediente.cancelarNota(companyId(req), req.params.id, req.body?.motivo);
    res.json({ success: true, data: n });
  })
);

router.get(
  '/empleados/:id/entregas',
  asyncHandler(async (req: Request, res: Response) => {
    const entregas = await expediente.listarEntregas(companyId(req), req.params.id);
    res.json({ success: true, data: { entregas } });
  })
);

router.post(
  '/entregas',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const e = await expediente.registrarEntrega(companyId(req), req.body || {}, req.user?.userId);
    res.status(201).json({ success: true, data: e });
  })
);

router.post(
  '/entregas/:id/devolucion',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const e = await expediente.registrarDevolucion(companyId(req), req.params.id, req.body || {});
    res.json({ success: true, data: e });
  })
);

/** Lo que el trabajador todavía tiene: es la consulta del finiquito. */
router.get(
  '/empleados/:id/en-su-poder',
  asyncHandler(async (req: Request, res: Response) => {
    const articulos = await expediente.enSuPoder(companyId(req), req.params.id);
    res.json({ success: true, data: { articulos } });
  })
);


/* ═════════════════ PRENÓMINA ═════════════════
 *
 * SÓLO CALCULA. La prenómina se corre veinte veces mientras se ajustan días y
 * conceptos; si escribiera, una corrida interrumpida dejaría medio periodo
 * pagado y medio no. Se persiste al cerrar el periodo, no antes.
 */

router.get(
  '/prenomina/:periodoId',
  asyncHandler(async (req: Request, res: Response) => {
    const r = await prenomina.calcular(companyId(req), req.params.periodoId);
    res.json({ success: true, data: r });
  })
);

/**
 * POST /prenomina/:periodoId — recalcula con lo capturado en la rejilla.
 *
 * Body: { captura: [{ empleadoId, dias?, otrosIngresos?, otrasDeducciones? }] }
 *
 * Es POST y no GET porque la captura puede ser larga —cincuenta trabajadores
 * con sus conceptos no caben en una URL— pero NO escribe nada: el resultado se
 * calcula al vuelo, igual que el GET. Lo que se persiste es el cierre.
 */
router.post(
  '/prenomina/:periodoId',
  asyncHandler(async (req: Request, res: Response) => {
    const r = await prenomina.calcular(companyId(req), req.params.periodoId, {
      captura: Array.isArray(req.body?.captura) ? req.body.captura : [],
    });
    res.json({ success: true, data: r });
  })
);

/**
 * POST /prenomina/:periodoId/excel — la prenómina como hoja de cálculo.
 *
 * Es POST porque lleva la captura de la rejilla en el cuerpo: lo que se exporta
 * tiene que ser lo que se está viendo, no un recálculo sin los conceptos que
 * alguien acaba de teclear.
 */
router.post(
  '/prenomina/:periodoId/excel',
  asyncHandler(async (req: Request, res: Response) => {
    const { buffer, nombre } = await generarExcel(
      companyId(req), req.params.periodoId,
      Array.isArray(req.body?.captura) ? req.body.captura : []
    );
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(buffer);
  })
);

/**
 * POST /prenomina/:periodoId/cerrar — congela los recibos y genera los XML.
 *
 * Es lo ÚNICO de la nómina que escribe de verdad, y por eso sólo ADMIN. Va todo
 * en una transacción: recibos, abonos de créditos y el cambio de estatus del
 * periodo. Un cierre a medias —recibos sin abonar los préstamos— haría que al
 * trabajador se le descuente dos veces el periodo siguiente.
 */
router.post(
  '/prenomina/:periodoId/cerrar',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const r = await cierre.cerrarPeriodo(
      companyId(req), req.params.periodoId,
      Array.isArray(req.body?.captura) ? req.body.captura : [],
      req.user?.userId
    );
    res.json({ success: true, data: r });
  })
);


/* ═════════════════ CFDI DE NÓMINA ═════════════════ */

router.get(
  '/recibos',
  asyncHandler(async (req: Request, res: Response) => {
    const recibos = await cierre.listarRecibos(companyId(req), {
      estatus: req.query.estatus as string | undefined,
      periodoId: req.query.periodoId as string | undefined,
    });
    res.json({ success: true, data: { recibos } });
  })
);

/** El XML del recibo — el timbrado si ya lo está, el pre-timbre si no. */
router.get(
  '/recibos/:id/xml',
  asyncHandler(async (req: Request, res: Response) => {
    const r = await cierre.xmlDelRecibo(companyId(req), req.params.id);
    if (req.query.descargar === 'true') {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition',
        `attachment; filename="nomina-${r.num_empleado}.xml"`);
      res.send(r.xml);
      return;
    }
    res.json({ success: true, data: r });
  })
);

/** Marca a quién se le manda el recibo por correo. Es decisión, no envío. */
router.put(
  '/recibos/envio-por-correo',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const r = await cierre.marcarEnvioPorCorreo(
      companyId(req), req.body?.ids || [], !!req.body?.enviar
    );
    res.json({ success: true, data: r });
  })
);


/**
 * POST /conceptos/partir — cuánto grava y cuánto exenta lo que se está
 * capturando, antes de aplicarlo.
 *
 * La pantalla podría hacer esta cuenta sola, pero entonces habría DOS copias de
 * las exenciones del Art. 93 y sólo una se arreglaría el día que cambien.
 */
router.post(
  '/conceptos/partir',
  asyncHandler(async (req: Request, res: Response) => {
    const r = await prenomina.partirConceptos(
      companyId(req),
      String(req.body?.periodoId || ''),
      String(req.body?.empleadoId || ''),
      req.body?.lado === 'egresos' ? 'egresos' : 'ingresos',
      Array.isArray(req.body?.lineas) ? req.body.lineas : []
    );
    res.json({ success: true, data: r });
  })
);


/**
 * GET /empleados/:id/finiquito — qué se le debe a quien se va.
 *
 * Devuelve el finiquito y la liquidación POR SEPARADO. Cuál se paga es una
 * decisión jurídica —depende de si la salida fue renuncia o despido— y el
 * sistema no la toma: la muestra y quien liquida elige.
 *
 * No escribe nada. El pago se hace generando un periodo ESPECIAL.
 */
router.get(
  '/empleados/:id/finiquito',
  asyncHandler(async (req: Request, res: Response) => {
    const r = await finiquito.calcular(
      companyId(req),
      req.params.id,
      String(req.query.fechaBaja || new Date().toISOString().slice(0, 10)),
      {
        vacacionesYaDisfrutadas: Number(req.query.vacacionesYaDisfrutadas) || 0,
        diasPendientesDePagar:   Number(req.query.diasPendientesDePagar) || 0,
      }
    );
    res.json({ success: true, data: r });
  })
);


/** Cuántos trabajadores le tocan a cada tipo — antes de generar nada. */
router.get(
  '/plantilla-por-tipo',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: await prenomina.plantillaPorTipo(companyId(req)) });
  })
);


/* ═════════════════ DEPARTAMENTOS ═════════════════ */

router.get(
  '/departamentos',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: { departamentos: await creditos.listarDepartamentos(companyId(req)) } });
  })
);

router.post(
  '/departamentos',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const d = await creditos.crearDepartamento(companyId(req), req.body?.nombre);
    res.status(201).json({ success: true, data: d });
  })
);


/* ═════════════════ PRÉSTAMOS Y FONACOT ═════════════════
 *
 * No son atributos del trabajador como el INFONAVIT: empiezan, se descuentan y
 * se acaban. Por eso viven aparte y una persona puede tener varios a la vez.
 */

router.get(
  '/creditos',
  asyncHandler(async (req: Request, res: Response) => {
    const lista = await creditos.listar(companyId(req), {
      empleadoId: req.query.empleadoId as string | undefined,
      origen: req.query.origen as any,
      soloActivos: req.query.incluirCerrados === 'true' ? false : true,
    });
    res.json({ success: true, data: { creditos: lista } });
  })
);

router.get(
  '/creditos/:id',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: await creditos.obtener(companyId(req), req.params.id) });
  })
);

/** Lo que hay que descontarle a alguien en el siguiente periodo. */
router.get(
  '/empleados/:id/creditos-por-descontar',
  asyncHandler(async (req: Request, res: Response) => {
    const l = await creditos.porDescontar(companyId(req), req.params.id);
    res.json({ success: true, data: { creditos: l } });
  })
);

router.post(
  '/creditos',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const c = await creditos.crear(companyId(req), req.body || {});
    res.status(201).json({ success: true, data: c });
  })
);

/** Aplica el descuento de un periodo: baja el saldo y deja el abono escrito. */
router.post(
  '/creditos/:id/abonar',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const r = await creditos.abonar(companyId(req), req.params.id, req.body || {});
    res.json({ success: true, data: r });
  })
);

router.put(
  '/creditos/:id/estatus',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const c = await creditos.cambiarEstatus(
      companyId(req), req.params.id, req.body?.estatus, req.body?.motivo
    );
    res.json({ success: true, data: c });
  })
);


/* ═════════════════ EJERCICIOS FISCALES ═════════════════
 *
 * Son GLOBALES: la UMA y la tarifa del ISR son del país, no de la empresa. Por
 * eso las escribe SUPER_ADMIN, que es quien opera la plataforma — si las
 * editara cada ADMIN, dos empresas del mismo NEXO calcularían distinto el mismo
 * impuesto. Leerlas sí puede cualquiera que tenga nómina.
 */

const soloPlataforma = authorize('SUPER_ADMIN');

router.get(
  '/ejercicios',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: { ejercicios: await ejercicios.listar() } });
  })
);

router.get(
  '/ejercicios/:anio',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: await ejercicios.detalle(Number(req.params.anio)) });
  })
);

router.put(
  '/ejercicios/:anio',
  soloPlataforma,
  asyncHandler(async (req: Request, res: Response) => {
    await ejercicios.guardar(
      { ...(req.body || {}), anio: Number(req.params.anio) },
      req.user?.userId
    );
    res.json({ success: true, data: await ejercicios.detalle(Number(req.params.anio)) });
  })
);

/** Firma de que alguien cotejó los números contra el DOF. */
router.post(
  '/ejercicios/:anio/confirmar',
  soloPlataforma,
  asyncHandler(async (req: Request, res: Response) => {
    const d = await ejercicios.confirmar(Number(req.params.anio), req.user!.userId);
    res.json({ success: true, data: d });
  })
);


/* ═════════════════ PERIODOS ═════════════════ */

router.get(
  '/periodos',
  asyncHandler(async (req: Request, res: Response) => {
    const lista = await periodos.listar(companyId(req), {
      anio: req.query.anio ? Number(req.query.anio) : undefined,
      tipo: req.query.tipo as periodos.TipoPeriodo | undefined,
      desde: req.query.desde ? Number(req.query.desde) : undefined,
      hasta: req.query.hasta ? Number(req.query.hasta) : undefined,
    });
    res.json({ success: true, data: { periodos: lista, maximos: periodos.MAXIMO_POR_TIPO } });
  })
);

/** Vista previa del calendario SIN escribirlo — para poder revisarlo antes. */
router.post(
  '/periodos/previsualizar',
  asyncHandler(async (req: Request, res: Response) => {
    const { tipo, anio, fechaArranque } = req.body || {};
    res.json({
      success: true,
      data: { periodos: periodos.calendario(tipo, Number(anio), fechaArranque) },
    });
  })
);

router.post(
  '/periodos/generar',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { tipo, anio, fechaArranque } = req.body || {};
    const r = await periodos.generar(companyId(req), tipo, Number(anio), fechaArranque);
    res.status(201).json({ success: true, data: r });
  })
);

/**
 * POST /periodos/especial — un finiquito, un aguinaldo, una PTU.
 *
 * No salen de un calendario: cada uno empieza y termina donde diga el caso, y
 * por eso se capturan de uno en uno con su concepto. El número se asigna solo,
 * siguiendo al último especial del año.
 */
router.post(
  '/periodos/especial',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const p = await periodos.crearEspecial(companyId(req), req.body || {});
    res.status(201).json({ success: true, data: p });
  })
);

router.put(
  '/periodos/:id/fecha-pago',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const p = await periodos.fijarFechaDePago(companyId(req), req.params.id, req.body?.fecha_pago);
    res.json({ success: true, data: p });
  })
);

router.post(
  '/periodos/:id/cerrar',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const p = await periodos.cerrar(companyId(req), req.params.id, req.user!.userId);
    res.json({ success: true, data: p });
  })
);

/* ═════════════════════ PARÁMETROS PATRONALES ═════════════════════ */

router.get(
  '/parametros',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: await parametros.obtener(companyId(req)) });
  })
);

router.put(
  '/parametros',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: await parametros.actualizar(companyId(req), req.body || {}) });
  })
);

/* ═════════════════════ PUESTOS ═════════════════════ */

router.get(
  '/puestos',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: { puestos: await empleados.listarPuestos(companyId(req)) } });
  })
);

router.post(
  '/puestos',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const p = await empleados.crearPuesto(companyId(req), req.body?.nombre, req.body?.riesgo_puesto);
    res.status(201).json({ success: true, data: p });
  })
);

/* ═════════════════════ EXPEDIENTE ═════════════════════ */

router.get(
  '/empleados',
  asyncHandler(async (req: Request, res: Response) => {
    const lista = await empleados.listar(companyId(req), {
      buscar: req.query.buscar as string | undefined,
      /* Por omisión sólo la plantilla activa: quien busca a alguien casi
       * siempre busca a alguien que trabaja aquí hoy. */
      soloActivos: req.query.incluirBajas === 'true' ? false : true,
      departamento: req.query.departamento as string | undefined,
    });
    res.json({ success: true, data: { empleados: lista } });
  })
);

router.get(
  '/empleados/resumen',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: await empleados.resumen(companyId(req)) });
  })
);

router.get(
  '/empleados/siguiente-numero',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: { numero: await empleados.siguienteNumero(companyId(req)) } });
  })
);

router.get(
  '/empleados/:id',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: await empleados.obtener(companyId(req), req.params.id) });
  })
);

router.post(
  '/empleados',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const e = await empleados.crear(companyId(req), req.body || {});
    res.status(201).json({ success: true, data: e });
  })
);

router.put(
  '/empleados/:id',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const e = await empleados.actualizar(companyId(req), req.params.id, req.body || {});
    res.json({ success: true, data: e });
  })
);

/**
 * Baja. No es un DELETE porque no se borra nada: los recibos timbrados siguen
 * apuntando al expediente y la autoridad puede pedirlos cinco años después.
 */
router.post(
  '/empleados/:id/baja',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const r = await empleados.darDeBaja(
      companyId(req), req.params.id, req.body?.fecha_baja, req.body?.motivo
    );
    res.json({ success: true, data: r });
  })
);

router.post(
  '/empleados/:id/reingreso',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const r = await empleados.reingresar(companyId(req), req.params.id, req.body?.fecha_reingreso);
    res.json({ success: true, data: r });
  })
);

export default router;
