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
import { authenticateToken, authorize, requireCapability } from '../../middleware/authentication';
import { requireModule } from '../../middleware/permissions';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import * as empleados from './empleados.service';
import * as vacaciones from './vacaciones.service';
import * as imssIdse from './imss-idse.service';
import { TipoIdse, validarArchivoIdse } from './imss-idse';
import * as parametros from './parametros.service';
import * as ejercicios from './ejercicios.service';
import * as periodos from './periodos.service';
import * as creditos from './creditos.service';
import * as expediente from './expediente.service';
import * as prenomina from './prenomina.service';
import { generarExcel } from './prenomina-excel.service';
import { generarListaDeRaya } from './lista-de-raya.service';
import * as reportes from './reportes.service';
import * as finiquito from './finiquito.service';
import { generarReciboPDF } from './pdf-recibo.service';
import * as cierre from './cierre.service';
import * as conceptosCuenta from './conceptos-cuenta.service';
import * as nominaPoliza from './nomina-poliza.service';
import { BANKS_MX } from '../suppliers/banks-mx';
import { PERCEPCIONES, DEDUCCIONES } from './motor';

const router = Router();

router.use(authenticateToken);
router.use(requireModule('nomina'));

/** Sólo ADMIN escribe. MANAGER no: puede ver la plantilla, no cambiar sueldos. */
/**
 * Quién puede MOVER la nómina.
 *
 * Antes era `authorize('ADMIN','SUPER_ADMIN')`: sólo administradores. Eso dejaba
 * a Recursos Humanos —el departamento cuyo trabajo ES la nómina— viendo las
 * pantallas en sólo lectura, y obligaba a darles rol de administrador de la
 * empresa entera para que pudieran capturar una quincena.
 *
 * Ahora es una capacidad. La trae el grupo RECURSOS_HUMANOS, y cualquier
 * administrador puede otorgarla a alguien más sin cambiarlo de grupo.
 *
 * OJO CON LO QUE **NO** CAMBIÓ
 * Un MANAGER no la hereda por su rango, aunque herede todas las demás. Sueldos,
 * CURP, cuentas bancarias y órdenes de pensión alimenticia son el dato más
 * sensible del sistema, y el gerente del almacén no tiene por qué verlos por el
 * hecho de ser gerente. Ver NO_HEREDA_MANAGER en capabilities.ts.
 */
const soloAdmin = requireCapability('nomina:manage');

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
    /* Se guarda ANTES de calcular: si el cálculo truena por un dato del
     * expediente, lo que la persona tecleó ya quedó a salvo. Perder media hora
     * de captura por un RFC mal escrito sería el peor de los dos males. */
    if (Array.isArray(req.body?.captura)) {
      await prenomina.guardarCaptura(
        companyId(req), req.params.periodoId, req.body.captura, req.user?.userId
      );
    }
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
    /* Por omisión sale la LISTA DE RAYA —el formato de la casa, con una columna
     * por concepto—. El desglose de dos hojas sigue disponible con
     * ?detalle=true: sirve cuando un número no cuadra y hay que ver el gravado
     * y el exento de cada percepción. */
    const armar = req.query.detalle === 'true' ? generarExcel : generarListaDeRaya;
    const { buffer, nombre } = await armar(
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

/**
 * POST /recibos/timbrar — el paso que no se deshace.
 *
 * Va aparte del cierre a propósito: timbrar gasta timbres y deshacerlo exige
 * una cancelación ante el SAT.
 */
router.post(
  '/recibos/timbrar',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) throw new ValidationError('No elegiste ningún recibo');
    const r = await cierre.timbrarVarios(companyId(req), ids);
    res.json({ success: true, data: r });
  })
);


/**
 * GET /recibos/:id/pdf — el recibo en papel.
 *
 * Sale del XML y no de la base: el XML es lo que se le mandó al SAT y lo que el
 * trabajador puede verificar. Armarlo con las columnas de la tabla haría que
 * una corrección al expediente cambiara el papel sin cambiar el comprobante.
 *
 * Sirve antes y después de timbrar; sin timbre lleva su sello de agua.
 */
router.get(
  '/recibos/:id/pdf',
  asyncHandler(async (req: Request, res: Response) => {
    const { buffer, nombre } = await generarReciboPDF(companyId(req), req.params.id);
    const disp = req.query.descargar === 'true' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disp}; filename="${nombre}"`);
    res.send(buffer);
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
 * POST /prenomina/:periodoId/aplicar-a-varios — el mismo concepto a muchos.
 *
 * Un bono de fin de mes o el día festivo le toca a la plantilla entera.
 * Capturarlo cien veces es donde se cuelan los errores.
 */
router.post(
  '/prenomina/:periodoId/aplicar-a-varios',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const r = await prenomina.aplicarAVarios(
      companyId(req), req.params.periodoId,
      {
        lado: req.body?.lado === 'egresos' ? 'egresos' : 'ingresos',
        clave: String(req.body?.clave || ''),
        importe: Number(req.body?.importe),
        dias: req.body?.dias === undefined ? undefined : Number(req.body.dias),
        empleadoIds: Array.isArray(req.body?.empleadoIds) ? req.body.empleadoIds : [],
        gravadoManual: req.body?.gravadoManual,
      },
      req.user?.userId
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
        indemnizacionDias: req.query.indemnizacionDias != null
          ? Number(req.query.indemnizacionDias) : undefined,
      }
    );
    res.json({ success: true, data: r });
  })
);


/**
 * POST /empleados/:id/finiquito/a-nomina-especial — deja el pago listo.
 *
 * Crea un periodo ESPECIAL de UNA sola persona con sus días pendientes y los
 * conceptos del finiquito o de la liquidación. No da de baja al trabajador: eso
 * es otra acción, y separarlas permite recalcular sin volver a darla.
 */
router.post(
  '/empleados/:id/finiquito/a-nomina-especial',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const r = await finiquito.pasarANominaEspecial(
      companyId(req),
      req.params.id,
      {
        fechaBaja: String(req.body?.fechaBaja || ''),
        tipo: req.body?.tipo === 'LIQUIDACION' ? 'LIQUIDACION' : 'FINIQUITO',
        desde: req.body?.desde,
        vacacionesYaDisfrutadas: Number(req.body?.vacacionesYaDisfrutadas) || 0,
        indemnizacionDias: req.body?.indemnizacionDias != null
          ? Number(req.body.indemnizacionDias) : undefined,
        motivo: req.body?.motivo,
        fechaPago: req.body?.fechaPago,
      }
    );
    res.json({ success: true, data: r });
  })
);


/* ═════════════════════ REPORTES ═════════════════════ */

/**
 * GET /reportes/periodos?anio= — qué periodos CERRADOS hay.
 *
 * La pantalla lo pide antes de ofrecer un rango: proponer "del 1 al 53" cuando
 * sólo hay ocho cerrados manda a pedir reportes vacíos.
 */
router.get(
  '/reportes/periodos',
  asyncHandler(async (req: Request, res: Response) => {
    const anio = Number(req.query.anio) || new Date().getFullYear();
    const r = await reportes.periodosDisponibles(companyId(req), anio);
    res.json({ success: true, data: { anio, porTipo: r } });
  })
);

/** GET /reportes/:que/excel — el mismo reporte, en hoja de cálculo. */
router.get(
  '/reportes/:que/excel',
  asyncHandler(async (req: Request, res: Response) => {
    const { buffer, nombre } = await reportes.generarExcel(
      companyId(req),
      req.params.que as reportes.TipoReporte,
      {
        anio:  Number(req.query.anio)  || new Date().getFullYear(),
        tipo:  (req.query.tipo as any) || 'SEMANAL',
        desde: Number(req.query.desde) || 1,
        hasta: Number(req.query.hasta) || Number(req.query.desde) || 1,
        empleadoId: (req.query.empleadoId as string) || undefined,
        acumulado: req.query.acumulado === 'true',
      }
    );
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(buffer);
  })
);


/**
 * GET /reportes/:que — prenomina | cfdi | isr | imss
 *
 * Salen de los periodos CERRADOS, sin recalcular: un reporte que recalcula con
 * los datos de hoy daría cifras distintas de las que se pagaron y se
 * declararon, y entonces no sirve para cuadrar.
 */
router.get(
  '/reportes/:que',
  asyncHandler(async (req: Request, res: Response) => {
    const r = await reportes.generar(
      companyId(req),
      req.params.que as reportes.TipoReporte,
      {
        anio:  Number(req.query.anio)  || new Date().getFullYear(),
        tipo:  (req.query.tipo as any) || 'SEMANAL',
        desde: Number(req.query.desde) || 1,
        hasta: Number(req.query.hasta) || Number(req.query.desde) || 1,
        empleadoId: (req.query.empleadoId as string) || undefined,
        acumulado: req.query.acumulado === 'true',
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

/**
 * GET/PUT /periodos/:id/participantes — quiénes entran a un especial.
 *
 * La lista vacía significa "toda la plantilla", y así se devuelve: traducirla
 * aquí a todos los ids haría que un alta posterior ya no entrara al aguinaldo.
 */
router.get(
  '/periodos/:id/participantes',
  asyncHandler(async (req: Request, res: Response) => {
    const ids = await periodos.participantes(companyId(req), req.params.id);
    res.json({ success: true, data: { empleadoIds: ids, todos: ids.length === 0 } });
  })
);

router.put(
  '/periodos/:id/participantes',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const r = await periodos.fijarParticipantes(
      companyId(req), req.params.id, req.body?.empleadoIds || []
    );
    res.json({ success: true, data: r });
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
    const cid = companyId(req);
    const e = await empleados.crear(cid, req.body || {});
    /* Un alta manual es un alta ante el IMSS (movimiento 08): se encola con su
     * fecha de ingreso y su SBC, y aparece en IMSS · IDSE. La importación masiva
     * de XML NO pasa por aquí (usa su propia ruta), así que no encola altas de
     * trabajadores ya registrados. Si un alta no aplicara, se descarta en la cola. */
    if (e?.activo && /^\d{4}-\d{2}-\d{2}$/.test(String(e.fecha_ingreso || ''))) {
      try {
        await imssIdse.encolarPendiente(cid, {
          empleadoId: e.id, tipo: 'ALTA', fecha: e.fecha_ingreso,
          sbc: Number(e.salario_diario_integrado) || undefined, origen: 'alta',
        });
      } catch { /* el alta ya quedó; el pendiente es un extra */ }
    }
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
    const cid = companyId(req);
    const r = await empleados.darDeBaja(cid, req.params.id, req.body?.fecha_baja, req.body?.motivo);
    /* La baja se encola para el IDSE: aparece sola en Nómina → IMSS · IDSE. Es
     * secundario a la baja misma, así que un fallo aquí no la tumba. */
    const fechaBaja = String(req.body?.fecha_baja || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fechaBaja)) {
      try {
        await imssIdse.encolarPendiente(cid, {
          empleadoId: req.params.id, tipo: 'BAJA', fecha: fechaBaja, origen: 'baja',
        });
      } catch { /* el pendiente es un extra: la baja ya quedó registrada */ }
    }
    res.json({ success: true, data: r });
  })
);

router.post(
  '/empleados/:id/reingreso',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const cid = companyId(req);
    const r = await empleados.reingresar(cid, req.params.id, req.body?.fecha_reingreso);
    /* El reingreso es un alta ante el IMSS (movimiento 08): también se encola. */
    const fechaRe = String(req.body?.fecha_reingreso || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fechaRe)) {
      try {
        await imssIdse.encolarPendiente(cid, {
          empleadoId: req.params.id, tipo: 'ALTA', fecha: fechaRe, origen: 'reingreso',
        });
      } catch { /* extra: el reingreso ya quedó */ }
    }
    res.json({ success: true, data: r });
  })
);

/* ── Vacaciones (control + prima) ── */
router.get(
  '/empleados/:id/vacaciones',
  asyncHandler(async (req: Request, res: Response) => {
    const [lista, res_] = await Promise.all([
      vacaciones.listar(companyId(req), req.params.id),
      vacaciones.resumen(companyId(req), req.params.id),
    ]);
    res.json({ success: true, data: { vacaciones: lista, resumen: res_ } });
  })
);

router.post(
  '/empleados/:id/vacaciones',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const r = await vacaciones.agregar(companyId(req), req.params.id, {
      fechaInicio: String(req.body?.fechaInicio || ''),
      fechaFin: String(req.body?.fechaFin || ''),
      dias: Number(req.body?.dias),
      tipo: req.body?.tipo === 'PAGADA' ? 'PAGADA' : 'DISFRUTADA',
      motivo: req.body?.motivo,
    });
    res.json({ success: true, data: r });
  })
);

router.delete(
  '/empleados/:id/vacaciones/:vacId',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    await vacaciones.eliminar(companyId(req), req.params.id, req.params.vacId);
    res.json({ success: true });
  })
);

/* ── Modificaciones de salario (ModifSal) ── */
router.get(
  '/empleados/:id/modificaciones-salario',
  asyncHandler(async (req: Request, res: Response) => {
    const modificaciones = await empleados.listarModificacionesSalario(companyId(req), req.params.id);
    res.json({ success: true, data: { modificaciones } });
  })
);

router.post(
  '/empleados/:id/modificaciones-salario',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const cid = companyId(req);
    const r = await empleados.agregarModificacionSalario(cid, req.params.id, {
      fecha: String(req.body?.fecha || ''),
      salarioDiario: Number(req.body?.salarioDiario),
      sdi: req.body?.sdi != null ? Number(req.body.sdi) : null,
      motivo: req.body?.motivo,
    });
    /* La modificación se avisa al IMSS: se encola como movimiento 07 del IDSE con
     * su fecha efectiva y el nuevo SBC. Secundario a la modificación misma. */
    try {
      await imssIdse.encolarPendiente(cid, {
        empleadoId: req.params.id, tipo: 'MODIFICACION', fecha: r.fecha,
        sbc: r.sdi ?? undefined, origen: 'modif_salario',
      });
    } catch { /* el pendiente es un extra: la modificación ya quedó */ }
    res.json({ success: true, data: r });
  })
);

/* ═════════════════════ IMSS · IDSE (§5–§8, §25) ═════════════════════
 *
 * Genera el archivo de longitud fija que sube al IDSE: altas/reingresos, bajas
 * y modificaciones de salario. Es una atribución de nómina, no de cualquiera con
 * el módulo abierto —mueve la afiliación de la gente ante el instituto—, así que
 * va con la misma llave que el resto de lo sensible: `nomina:manage`.
 *
 * Devuelve el TXT tal cual (text/plain, adjunto). El IDSE espera el archivo, no
 * un JSON; envolverlo obligaría a la pantalla a desenvolverlo y a nadie le sirve.
 */
router.post(
  '/imss/idse',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const tipo = String(req.body?.tipo || '').toUpperCase() as TipoIdse;
    if (!['ALTA', 'BAJA', 'MODIFICACION'].includes(tipo)) {
      throw new ValidationError('Tipo de movimiento inválido. Usa ALTA, BAJA o MODIFICACION.');
    }
    const cfg = {
      guia: req.body?.guia,
      tipoTrabajador: req.body?.tipoTrabajador,
      tipoSalario: req.body?.tipoSalario,
      jornada: req.body?.jornada,
    };
    const { contenido, nombre } = await imssIdse.generar(
      companyId(req), tipo, req.body?.movimientos || [], cfg,
    );
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(contenido);
  })
);

/**
 * POST /nomina/imss/idse/mixto — UN archivo con movimientos de tipos mezclados.
 * Cada movimiento trae su tipo (ALTA/BAJA/MODIFICACION) y sus datos; es lo que
 * genera el constructor unificado con un solo botón.
 */
router.post(
  '/imss/idse/mixto',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const cfg = {
      guia: req.body?.guia, tipoTrabajador: req.body?.tipoTrabajador,
      tipoSalario: req.body?.tipoSalario, jornada: req.body?.jornada,
    };
    const { contenido, nombre } = await imssIdse.generarMixto(
      companyId(req), req.body?.movimientos || [], cfg,
    );
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(contenido);
  })
);

/**
 * POST /nomina/imss/idse/validar — revisa un TXT del IDSE (el que generó este
 * módulo o uno de otro sistema) contra las posiciones de la guía, antes de
 * subirlo. Devuelve todos los problemas de una vez.
 */
router.post(
  '/imss/idse/validar',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const contenido = String(req.body?.contenido ?? '');
    if (!contenido.trim()) throw new ValidationError('Pega o sube el contenido del archivo a validar.');
    res.json({ success: true, data: validarArchivoIdse(contenido) });
  })
);

/* Cola de pendientes: lo que la baja (y el reingreso) mandan al menú IDSE. */
router.get(
  '/imss/idse/pendientes',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: { pendientes: await imssIdse.listarPendientes(companyId(req)) } });
  })
);

router.delete(
  '/imss/idse/pendientes/:id',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    await imssIdse.descartarPendiente(companyId(req), req.params.id);
    res.json({ success: true });
  })
);

/** Genera UN archivo con los movimientos pendientes elegidos (tipos mezclados). */
router.post(
  '/imss/idse/pendientes/generar',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const cfg = {
      guia: req.body?.guia,
      tipoTrabajador: req.body?.tipoTrabajador,
      tipoSalario: req.body?.tipoSalario,
      jornada: req.body?.jornada,
    };
    const { contenido, nombre } = await imssIdse.generarDesdePendientes(companyId(req), ids, cfg);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(contenido);
  })
);

/** Confirma que los movimientos ya pasaron en el IDSE (pasan a la lista de enviados). */
router.post(
  '/imss/idse/pendientes/enviados',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    await imssIdse.marcarEnviados(companyId(req), ids);
    res.json({ success: true });
  })
);

/** La segunda lista: lo ya confirmado en el IDSE. */
router.get(
  '/imss/idse/enviados',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: { enviados: await imssIdse.listarEnviados(companyId(req)) } });
  })
);

/** Regresa movimientos enviados a la lista de pendientes. */
router.post(
  '/imss/idse/enviados/regresar',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    await imssIdse.regresarPendientes(companyId(req), ids);
    res.json({ success: true });
  })
);

/* ── Conceptos de nómina → cuenta (config de la póliza de pasivo) ── */
router.get(
  '/conceptos-cuenta',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: { conceptos: await conceptosCuenta.conceptosConCuenta(companyId(req)) } });
  })
);
router.put(
  '/conceptos-cuenta',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const ok = await conceptosCuenta.asignarCuentaConcepto(
      companyId(req), String(req.body?.grupo), String(req.body?.clave), req.body?.cuenta ?? null);
    if (!ok) { res.status(404).json({ success: false, message: 'Concepto no reconocido' }); return; }
    res.json({ success: true });
  })
);

/* ── Póliza de pasivo de nómina (finiquitos timbrados) ── */
router.get(
  '/poliza/finiquitos',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: { finiquitos: await nominaPoliza.finiquitosTimbrados(companyId(req)) } });
  })
);
router.get(
  '/poliza/:reciboId',
  asyncHandler(async (req: Request, res: Response) => {
    const [representacion, armado] = await Promise.all([
      nominaPoliza.representacionFiniquito(companyId(req), req.params.reciboId),
      nominaPoliza.armarPoliza(companyId(req), req.params.reciboId),
    ]);
    res.json({ success: true, data: { representacion, poliza: armado } });
  })
);
router.post(
  '/poliza/:reciboId/generar',
  soloAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const r = await nominaPoliza.generarPoliza(companyId(req), req.params.reciboId, req.user?.userId);
    res.json({ success: true, data: r });
  })
);

export default router;
