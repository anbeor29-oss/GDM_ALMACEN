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
      },
    });
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
