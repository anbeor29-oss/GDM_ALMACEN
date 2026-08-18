/**
 * creditos.service — préstamos de la empresa y créditos FONACOT.
 *
 * POR QUÉ NO ESTÁN EN EL EXPEDIENTE COMO EL INFONAVIT
 * El crédito de vivienda acompaña al trabajador durante años y es casi un
 * atributo suyo; por eso vive en su ficha. Un préstamo no: se pide en marzo, se
 * descuenta ocho semanas y se acaba. Ponerlo como campo del expediente
 * obligaría a borrarlo al terminar —y con él la historia de lo que se le
 * descontó— y haría imposible que alguien tenga dos a la vez, que es lo normal.
 *
 * EL SALDO SE LLEVA, NO SE DEDUCE
 * Cada abono baja el saldo y queda escrito con el periodo en que se aplicó.
 * Calcular "monto menos suma de abonos" al vuelo se ve más limpio hasta el día
 * que el trabajador reclama: con los abonos guardados se puede señalar cuál
 * periodo falló; sin ellos sólo hay un número que no cuadra.
 *
 * EL QUE MANDA ES EL SALDO, NO LA FECHA
 * Un crédito deja de descontarse cuando se liquida, no cuando llega la fecha
 * estimada de término. Basta un periodo sin pago —una incapacidad, una falta—
 * para que las dos cosas dejen de coincidir, y nadie vuelve a ajustar el plan.
 */

import { PoolClient } from 'pg';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';

export const ORIGENES = ['PRESTAMO', 'FONACOT'] as const;
export type Origen = typeof ORIGENES[number];

const CAMPOS = `
  c.id, c.empleado_id, c.origen, c.numero, c.concepto,
  c.monto_original, c.saldo, c.descuento_por_periodo,
  TO_CHAR(c.fecha_inicio, 'YYYY-MM-DD')       AS fecha_inicio,
  TO_CHAR(c.fecha_fin_estimada, 'YYYY-MM-DD') AS fecha_fin_estimada,
  c.estatus, c.notas, c.created_at,
  (c.monto_original - c.saldo) AS abonado,
  /* Cuántos periodos faltan al ritmo actual. Se redondea hacia arriba porque el
   * último abono suele ser menor: son periodos, no dinero. */
  CEIL(c.saldo / NULLIF(c.descuento_por_periodo, 0)) AS periodos_restantes
`;

export interface DatosCredito {
  empleado_id?: string;
  origen?: string;
  numero?: string;
  concepto?: string;
  monto_original?: number;
  descuento_por_periodo?: number;
  fecha_inicio?: string;
  fecha_fin_estimada?: string;
  notas?: string;
}

const texto = (v: any, max: number): string | null => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

const dinero = (v: any, campo: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ValidationError(`${campo} debe ser un importe mayor que cero`);
  }
  return Math.round(n * 100) / 100;
};

const fecha = (v: any, campo: string): string | null => {
  const s = texto(v, 10);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError(`${campo} debe venir como AAAA-MM-DD`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new ValidationError(`${campo} no existe en el calendario`);
  }
  return s;
};

/* ═══════════════════ CONSULTA ═══════════════════ */

export async function listar(
  companyId: string,
  f: { empleadoId?: string; origen?: Origen; soloActivos?: boolean } = {}
) {
  const cond = ['c.company_id = $1'];
  const args: any[] = [companyId];

  if (f.empleadoId) { args.push(f.empleadoId); cond.push(`c.empleado_id = $${args.length}`); }
  if (f.origen)     { args.push(f.origen);     cond.push(`c.origen = $${args.length}`); }
  if (f.soloActivos !== false) cond.push(`c.estatus = 'ACTIVO'`);

  const r = await query<any>(
    `SELECT ${CAMPOS},
            TRIM(e.nombre || ' ' || e.apellido_pat || ' ' || COALESCE(e.apellido_mat,'')) AS trabajador,
            e.num_empleado
       FROM nomina_creditos c
       JOIN nomina_empleados e ON e.id = c.empleado_id
      WHERE ${cond.join(' AND ')}
      ORDER BY e.apellido_pat, c.origen, c.fecha_inicio DESC`,
    args
  );
  return r.rows;
}

export async function obtener(companyId: string, id: string) {
  const r = await query<any>(
    `SELECT ${CAMPOS} FROM nomina_creditos c WHERE c.id = $1 AND c.company_id = $2`,
    [id, companyId]
  );
  if (r.rows.length === 0) throw new NotFoundError('Ese crédito no existe en esta empresa');

  const abonos = await query<any>(
    `SELECT a.id, TO_CHAR(a.fecha, 'YYYY-MM-DD') AS fecha, a.importe, a.saldo_despues,
            a.notas, p.tipo, p.numero AS periodo_numero, p.anio
       FROM nomina_credito_abonos a
       LEFT JOIN nomina_periodos p ON p.id = a.periodo_id
      WHERE a.credito_id = $1
      ORDER BY a.fecha DESC, a.created_at DESC`,
    [id]
  );
  return { ...r.rows[0], abonos: abonos.rows };
}

/**
 * Lo que hay que descontarle a un trabajador en un periodo.
 *
 * Devuelve el importe del periodo o el saldo, lo que sea MENOR: el último abono
 * de un crédito casi nunca es completo, y cobrar de más obligaría a devolverle.
 */
export async function porDescontar(companyId: string, empleadoId: string) {
  const r = await query<any>(
    `SELECT ${CAMPOS} FROM nomina_creditos c
      WHERE c.company_id = $1 AND c.empleado_id = $2 AND c.estatus = 'ACTIVO' AND c.saldo > 0
      ORDER BY c.origen, c.fecha_inicio`,
    [companyId, empleadoId]
  );
  return r.rows.map((c: any) => ({
    ...c,
    importe: Math.min(Number(c.descuento_por_periodo), Number(c.saldo)),
    /* La clave del c_TipoDeduccion con la que va en el CFDI. */
    claveSat: c.origen === 'FONACOT' ? '011' : '012',
  }));
}

/* ═══════════════════ ESCRITURA ═══════════════════ */

export async function crear(companyId: string, d: DatosCredito) {
  const origen = String(d.origen || '').toUpperCase().trim() as Origen;
  if (!ORIGENES.includes(origen)) {
    throw new ValidationError('El origen del crédito debe ser PRESTAMO o FONACOT');
  }
  if (!d.empleado_id) throw new ValidationError('Falta el trabajador');

  const monto = dinero(d.monto_original, 'El monto del crédito');
  const cuota = dinero(d.descuento_por_periodo, 'El descuento por periodo');
  if (cuota > monto) {
    throw new ValidationError(
      'El descuento por periodo no puede ser mayor que el crédito completo.'
    );
  }
  const inicio = fecha(d.fecha_inicio, 'La fecha de inicio');
  if (!inicio) throw new ValidationError('La fecha de inicio es obligatoria');
  const fin = fecha(d.fecha_fin_estimada, 'La fecha estimada de término');
  if (fin && fin < inicio) {
    throw new ValidationError('La fecha de término no puede ser anterior a la de inicio');
  }

  const numero = texto(d.numero, 30);
  /* El FONACOT SIEMPRE trae número: es con el que el instituto identifica el
   * crédito y con el que se concilia lo retenido. Un préstamo interno puede no
   * tenerlo. */
  if (origen === 'FONACOT' && !numero) {
    throw new ValidationError('Un crédito FONACOT necesita su número de crédito');
  }

  /* El trabajador tiene que ser de esta empresa: sin esta comprobación un id
   * ajeno crearía un descuento sobre alguien de otra plantilla. */
  const e = await query<any>(
    `SELECT id FROM nomina_empleados
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [d.empleado_id, companyId]
  );
  if (e.rows.length === 0) throw new NotFoundError('Ese trabajador no existe en esta empresa');

  try {
    const r = await query<{ id: string }>(
      `INSERT INTO nomina_creditos
         (company_id, empleado_id, origen, numero, concepto, monto_original, saldo,
          descuento_por_periodo, fecha_inicio, fecha_fin_estimada, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8::date,$9::date,$10)
       RETURNING id`,
      [companyId, d.empleado_id, origen, numero, texto(d.concepto, 200),
       monto, cuota, inicio, fin, texto(d.notas, 2000)]
    );
    return obtener(companyId, r.rows[0].id);
  } catch (err: any) {
    if (err?.code === '23505') {
      throw new ConflictError(
        `Ya hay un crédito FONACOT con el número ${numero} en esta empresa. ` +
        'Capturarlo dos veces le descontaría el doble al trabajador.'
      );
    }
    throw err;
  }
}

/**
 * Aplica el descuento de un periodo. Baja el saldo y deja el abono escrito.
 *
 * Se liquida solo al llegar a cero: el estatus no depende de que alguien se
 * acuerde de cerrarlo.
 */
export async function abonar(
  companyId: string,
  creditoId: string,
  datos: { importe?: number; fecha?: string; periodoId?: string; notas?: string }
) {
  const f = fecha(datos.fecha, 'La fecha del abono') || new Date().toISOString().slice(0, 10);

  return transaction(async (client: PoolClient) => {
    /* FOR UPDATE: dos cierres de nómina simultáneos sobre el mismo crédito
     * leerían el mismo saldo y lo bajarían una sola vez. */
    const c = await transactionQuery<any>(
      client,
      `SELECT id, saldo, descuento_por_periodo, estatus
         FROM nomina_creditos
        WHERE id = $1 AND company_id = $2
        FOR UPDATE`,
      [creditoId, companyId]
    );
    if (c.rows.length === 0) throw new NotFoundError('Ese crédito no existe en esta empresa');
    const cr = c.rows[0];

    if (cr.estatus !== 'ACTIVO') {
      throw new ConflictError(`El crédito está ${cr.estatus.toLowerCase()}: no admite abonos.`);
    }

    const saldo = Number(cr.saldo);
    if (saldo <= 0) throw new ConflictError('El crédito ya está liquidado');

    /* Nunca se cobra más que el saldo: el último abono casi nunca es completo. */
    const pedido = datos.importe !== undefined
      ? dinero(datos.importe, 'El importe del abono')
      : Number(cr.descuento_por_periodo);
    const importe = Math.min(pedido, saldo);
    const nuevoSaldo = Math.round((saldo - importe) * 100) / 100;

    try {
      await transactionQuery(
        client,
        `INSERT INTO nomina_credito_abonos
           (credito_id, periodo_id, fecha, importe, saldo_despues, notas)
         VALUES ($1,$2,$3::date,$4,$5,$6)`,
        [creditoId, datos.periodoId || null, f, importe, nuevoSaldo, texto(datos.notas, 2000)]
      );
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictError(
          'Ese crédito ya tiene un abono en este periodo. Aplicarlo otra vez le ' +
          'descontaría dos veces en la misma raya.'
        );
      }
      throw err;
    }

    /* `$2::numeric` y no `$2` a secas.
     *
     * El mismo parámetro se usa para asignar y para comparar, y sin el tipo
     * escrito Postgres no puede deducir uno solo: revienta con 42P08 "se
     * dedujeron tipos de dato inconsistentes". Es el mismo tropiezo que ya
     * hubo en tesorería y en compras — cuando un parámetro aparece dos veces
     * en contextos distintos, hay que decirle de qué es. */
    await transactionQuery(
      client,
      `UPDATE nomina_creditos
          SET saldo = $2::numeric,
              estatus = CASE WHEN $2::numeric <= 0 THEN 'LIQUIDADO' ELSE estatus END,
              updated_at = NOW()
        WHERE id = $1`,
      [creditoId, nuevoSaldo]
    );

    return { creditoId, importe, saldo: nuevoSaldo, liquidado: nuevoSaldo <= 0 };
  });
}

/**
 * Cambia el estatus a mano.
 *
 * SUSPENDIDO existe porque un trabajador incapacitado deja de tener de dónde
 * descontar y el crédito no se cancela: se detiene y se reanuda.
 */
export async function cambiarEstatus(companyId: string, id: string, estatus: string, motivo?: string) {
  const e = String(estatus || '').toUpperCase().trim();
  if (!['ACTIVO', 'SUSPENDIDO', 'CANCELADO', 'LIQUIDADO'].includes(e)) {
    throw new ValidationError('Estatus no válido');
  }
  const r = await query(
    `UPDATE nomina_creditos
        SET estatus = $3,
            notas = CASE WHEN $4::text IS NULL THEN notas
                         ELSE COALESCE(notas || E'\\n', '') || $4::text END,
            updated_at = NOW()
      WHERE id = $1 AND company_id = $2`,
    [id, companyId, e, motivo || null]
  );
  if (r.rowCount === 0) throw new NotFoundError('Ese crédito no existe en esta empresa');
  return obtener(companyId, id);
}

/* ═══════════════════ CATÁLOGOS: PUESTOS Y DEPARTAMENTOS ═══════════════════ */

export async function listarDepartamentos(companyId: string) {
  const r = await query<any>(
    `SELECT d.id, d.nombre, d.activo,
            COUNT(e.id) FILTER (WHERE e.activo AND e.deleted_at IS NULL) AS empleados
       FROM nomina_departamentos d
       LEFT JOIN nomina_empleados e
              ON e.company_id = d.company_id
             AND UPPER(TRIM(e.departamento)) = UPPER(TRIM(d.nombre))
      WHERE d.company_id = $1
      GROUP BY d.id
      ORDER BY d.nombre`,
    [companyId]
  );
  return r.rows;
}

export async function crearDepartamento(companyId: string, nombre: string) {
  const n = texto(nombre, 100);
  if (!n) throw new ValidationError('El departamento necesita un nombre');
  try {
    const r = await query<any>(
      `INSERT INTO nomina_departamentos (company_id, nombre)
       VALUES ($1,$2) RETURNING id, nombre, activo`,
      [companyId, n]
    );
    return r.rows[0];
  } catch (e: any) {
    if (e?.code === '23505') throw new ConflictError(`El departamento "${n}" ya existe`);
    throw e;
  }
}
