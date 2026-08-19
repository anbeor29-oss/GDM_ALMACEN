/**
 * expediente.service — la bitácora del trabajador y lo que trae puesto.
 *
 * LA BITÁCORA NO SE BORRA
 * Un reconocimiento y un acta administrativa son hechos fechados: pasaron. Si
 * se pudieran borrar, el historial diría lo que convenga el día que se consulte
 * —y ese día suele ser el de un conflicto—. Se cancelan con su motivo y queda
 * el rastro de que existieron.
 *
 * QUIÉN ESCRIBIÓ QUEDA ESCRITO
 * Una sanción anónima no sirve para nada cuando se discute. Cada nota guarda el
 * usuario que la capturó y la fecha en que lo hizo, que no es lo mismo que la
 * fecha del hecho.
 *
 * LO CONFIDENCIAL VIVE EN LA MISMA BITÁCORA
 * Marcado, no escondido en otra tabla. Todo forma el historial de la persona;
 * lo único que cambia es quién puede leerlo. Con dos tablas, la mitad de las
 * notas termina en el lugar equivocado.
 *
 * LAS ENTREGAS SON UN COMPROBANTE, NO UN INVENTARIO
 * La ley obliga al patrón a dar el equipo de protección y a poder demostrarlo
 * (Art. 132 Fr. XVII LFT, NOM-017). Por eso lo que importa es la fecha, quién
 * lo recibió y si sigue en su poder — no cuántas piezas quedan en el almacén.
 */

import { query } from '../../config/database';
import { ValidationError, NotFoundError, ConflictError } from '../../middleware/errorHandler';

export const TIPOS_BITACORA = ['LOGRO', 'SANCION', 'INCIDENCIA', 'NOTA'] as const;
export const TIPOS_ENTREGA = ['UNIFORME', 'EPP', 'HERRAMIENTA', 'OTRO'] as const;
export const ESTADOS_DEVOLUCION = ['BUENO', 'USADO', 'DANADO', 'EXTRAVIADO'] as const;

const texto = (v: any, max: number): string | null => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
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

/** El trabajador tiene que ser de esta empresa. */
async function esDeLaEmpresa(companyId: string, empleadoId: string) {
  const r = await query(
    `SELECT 1 FROM nomina_empleados
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [empleadoId, companyId]
  );
  if (r.rows.length === 0) throw new NotFoundError('Ese trabajador no existe en esta empresa');
}

/* ═══════════════════ BITÁCORA ═══════════════════ */

/**
 * Las notas del trabajador.
 *
 * `verConfidenciales` lo decide quien llama según el rol: un MANAGER que revisa
 * asistencias no tiene por qué leer una nota reservada. Se filtra en el SQL y
 * no en la pantalla — lo que no se manda no se puede mirar en el inspector.
 */
export async function listarBitacora(
  companyId: string,
  empleadoId: string,
  opciones: { verConfidenciales?: boolean } = {}
) {
  const r = await query<any>(
    `SELECT b.id, b.tipo, TO_CHAR(b.fecha, 'YYYY-MM-DD') AS fecha,
            b.titulo, b.detalle, b.confidencial, b.dias_suspension,
            b.cancelada, b.motivo_cancelacion, b.created_at,
            NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '') AS creada_por,
            u.email AS creada_por_correo
       FROM nomina_bitacora b
       LEFT JOIN users u ON u.id = b.creada_por
      WHERE b.company_id = $1 AND b.empleado_id = $2
        AND ($3::boolean OR NOT b.confidencial)
      ORDER BY b.fecha DESC, b.created_at DESC`,
    [companyId, empleadoId, !!opciones.verConfidenciales]
  );
  return r.rows;
}

export async function crearNota(
  companyId: string,
  datos: {
    empleado_id?: string; tipo?: string; fecha?: string; titulo?: string;
    detalle?: string; confidencial?: boolean; dias_suspension?: number;
  },
  userId?: string
) {
  if (!datos.empleado_id) throw new ValidationError('Falta el trabajador');
  await esDeLaEmpresa(companyId, datos.empleado_id);

  const tipo = String(datos.tipo || '').toUpperCase().trim();
  if (!TIPOS_BITACORA.includes(tipo as any)) {
    throw new ValidationError(`El tipo debe ser uno de: ${TIPOS_BITACORA.join(', ')}`);
  }
  const f = fecha(datos.fecha, 'La fecha de la nota');
  if (!f) throw new ValidationError('La nota necesita su fecha: es la del hecho, no la de captura');

  const titulo = texto(datos.titulo, 200);
  if (!titulo) throw new ValidationError('La nota necesita un título');

  /* Los días de suspensión sólo tienen sentido en una sanción. En un
   * reconocimiento serían un dato imposible de interpretar después. */
  let dias: number | null = null;
  if (datos.dias_suspension !== undefined && datos.dias_suspension !== null) {
    if (tipo !== 'SANCION') {
      throw new ValidationError('Los días de suspensión sólo aplican a una sanción');
    }
    const n = Number(datos.dias_suspension);
    if (!Number.isInteger(n) || n <= 0 || n > 90) {
      throw new ValidationError('Los días de suspensión deben ser un entero entre 1 y 90');
    }
    dias = n;
  }

  const r = await query<any>(
    `INSERT INTO nomina_bitacora
       (company_id, empleado_id, tipo, fecha, titulo, detalle, confidencial,
        dias_suspension, creada_por)
     VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9)
     RETURNING id`,
    [companyId, datos.empleado_id, tipo, f, titulo, texto(datos.detalle, 5000),
     !!datos.confidencial, dias, userId || null]
  );
  return { id: r.rows[0].id };
}

/**
 * Cancela una nota. NO la borra.
 *
 * Exige el motivo: una nota que desaparece sin explicación es indistinguible de
 * una que nunca se escribió, y ahí se pierde la utilidad del historial.
 */
export async function cancelarNota(
  companyId: string, id: string, motivo: string
) {
  const m = texto(motivo, 1000);
  if (!m) throw new ValidationError('Cancelar una nota exige decir por qué');

  const r = await query(
    `UPDATE nomina_bitacora
        SET cancelada = true, motivo_cancelacion = $3
      WHERE id = $1 AND company_id = $2 AND NOT cancelada`,
    [id, companyId, m]
  );
  if (r.rowCount === 0) {
    throw new ConflictError('Esa nota no existe en esta empresa o ya estaba cancelada');
  }
  return { id, cancelada: true };
}

/* ═══════════════════ UNIFORMES Y EQUIPO DE PROTECCIÓN ═══════════════════ */

export async function listarEntregas(companyId: string, empleadoId: string) {
  const r = await query<any>(
    `SELECT e.id, e.tipo, e.articulo, e.talla, e.cantidad,
            TO_CHAR(e.fecha_entrega, 'YYYY-MM-DD')    AS fecha_entrega,
            TO_CHAR(e.fecha_reposicion, 'YYYY-MM-DD') AS fecha_reposicion,
            e.devuelto,
            TO_CHAR(e.fecha_devolucion, 'YYYY-MM-DD') AS fecha_devolucion,
            e.estado_devolucion, e.costo, e.notas, e.created_at,
            TO_CHAR(e.descontar_desde, 'YYYY-MM-DD') AS descontar_desde,
            e.descontado_periodo_id,
            /* En qué periodo se cobró, en palabras. Sin esto, cuando alguien
             * reclama "me lo descontaron dos veces" no hay qué enseñarle. */
            CASE WHEN p.id IS NOT NULL
                 THEN p.tipo || ' #' || p.numero || ' · ' || p.anio END AS descontado_en,
            NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '') AS entregado_por,
            /* Cuándo toca reponerlo, mirado desde hoy: unas botas de seguridad
             * llevan tres años puestas y nadie se entera si no se dice. */
            (e.fecha_reposicion IS NOT NULL AND NOT e.devuelto
             AND e.fecha_reposicion <= CURRENT_DATE) AS vencido
       FROM nomina_entregas e
       LEFT JOIN users u ON u.id = e.entregado_por
       LEFT JOIN nomina_periodos p ON p.id = e.descontado_periodo_id
      WHERE e.company_id = $1 AND e.empleado_id = $2
      ORDER BY e.devuelto, e.fecha_entrega DESC`,
    [companyId, empleadoId]
  );
  return r.rows;
}

export async function registrarEntrega(
  companyId: string,
  datos: {
    empleado_id?: string; tipo?: string; articulo?: string; talla?: string;
    cantidad?: number; fecha_entrega?: string; fecha_reposicion?: string;
    costo?: number; notas?: string; descontar_desde?: string;
  },
  userId?: string
) {
  if (!datos.empleado_id) throw new ValidationError('Falta el trabajador');
  await esDeLaEmpresa(companyId, datos.empleado_id);

  const tipo = String(datos.tipo || '').toUpperCase().trim();
  if (!TIPOS_ENTREGA.includes(tipo as any)) {
    throw new ValidationError(`El tipo debe ser uno de: ${TIPOS_ENTREGA.join(', ')}`);
  }
  const articulo = texto(datos.articulo, 200);
  if (!articulo) throw new ValidationError('Falta decir qué se entregó');

  const f = fecha(datos.fecha_entrega, 'La fecha de entrega');
  if (!f) throw new ValidationError('La entrega necesita su fecha: es lo que la vuelve comprobante');

  const rep = fecha(datos.fecha_reposicion, 'La fecha de reposición');
  if (rep && rep < f) {
    throw new ValidationError('La reposición no puede ser anterior a la entrega');
  }

  const cant = datos.cantidad === undefined ? 1 : Number(datos.cantidad);
  if (!Number.isInteger(cant) || cant <= 0) {
    throw new ValidationError('La cantidad debe ser un entero mayor que cero');
  }

  const costo = datos.costo === undefined || datos.costo === null ? null : Number(datos.costo);
  if (costo !== null && (!Number.isFinite(costo) || costo < 0)) {
    throw new ValidationError('El costo no puede ser negativo');
  }

  /* ── Desde cuándo se cobra ──
   *
   * Con costo, se cobra: por omisión desde el día de la entrega, así que cae
   * en el primer periodo que cierre después. Sin costo —o con cero— no hay
   * nada que cobrar y la fecha se deja en NULL: el uniforme lo pone la
   * empresa, que es el caso normal.
   *
   * Se guarda la fecha y no un "sí/no" porque el descuento tiene que saber a
   * partir de qué periodo aplica; con un booleano, una entrega capturada tarde
   * caería en el periodo equivocado. */
  const cobrable = costo !== null && costo > 0;
  const desde = cobrable
    ? (fecha(datos.descontar_desde, 'La fecha desde la que se descuenta') || f)
    : null;
  if (desde && desde < f) {
    throw new ValidationError('No se puede empezar a descontar antes de haberlo entregado');
  }

  const r = await query<any>(
    `INSERT INTO nomina_entregas
       (company_id, empleado_id, tipo, articulo, talla, cantidad,
        fecha_entrega, fecha_reposicion, costo, notas, entregado_por, descontar_desde)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12::date)
     RETURNING id`,
    [companyId, datos.empleado_id, tipo, articulo, texto(datos.talla, 20), cant,
     f, rep, costo, texto(datos.notas, 2000), userId || null, desde]
  );
  return { id: r.rows[0].id };
}

/**
 * Marca un artículo como devuelto.
 *
 * Pide el estado en que volvió porque de eso depende si se repone, se descuenta
 * o no pasa nada — y esa decisión se toma después, con el dato a la vista.
 */
export async function registrarDevolucion(
  companyId: string, id: string,
  datos: { fecha?: string; estado?: string; notas?: string }
) {
  const f = fecha(datos.fecha, 'La fecha de devolución') || new Date().toISOString().slice(0, 10);
  const estado = String(datos.estado || '').toUpperCase().trim();
  if (estado && !ESTADOS_DEVOLUCION.includes(estado as any)) {
    throw new ValidationError(`El estado debe ser uno de: ${ESTADOS_DEVOLUCION.join(', ')}`);
  }

  const r = await query(
    `UPDATE nomina_entregas
        SET devuelto = true, fecha_devolucion = $3::date,
            estado_devolucion = NULLIF($4, ''),
            notas = CASE WHEN $5::text IS NULL THEN notas
                         ELSE COALESCE(notas || E'\\n', '') || $5::text END
      WHERE id = $1 AND company_id = $2 AND NOT devuelto
        AND $3::date >= fecha_entrega`,
    [id, companyId, f, estado, texto(datos.notas, 2000)]
  );
  if (r.rowCount === 0) {
    throw new ConflictError(
      'No se pudo registrar la devolución: el artículo no existe, ya estaba ' +
      'devuelto, o la fecha es anterior a la de entrega.'
    );
  }
  return { id, devuelto: true, fecha_devolucion: f };
}

/**
 * Lo que el trabajador todavía tiene en su poder.
 *
 * Es la consulta del finiquito: antes de liquidar a alguien hay que saber qué
 * hay que pedirle de vuelta.
 */
export async function enSuPoder(companyId: string, empleadoId: string) {
  const r = await query<any>(
    `SELECT id, tipo, articulo, talla, cantidad, costo,
            TO_CHAR(fecha_entrega, 'YYYY-MM-DD') AS fecha_entrega
       FROM nomina_entregas
      WHERE company_id = $1 AND empleado_id = $2 AND NOT devuelto
      ORDER BY fecha_entrega`,
    [companyId, empleadoId]
  );
  return r.rows;
}


/* ═══════════════ LO ENTREGADO QUE FALTA POR COBRAR ═══════════════ */

export interface EntregaPorCobrar {
  id: string;
  empleado_id: string;
  articulo: string;
  cantidad: number;
  /** El costo TOTAL de la entrega, que es lo que se descuenta de una vez. */
  importe: number;
}

/**
 * Las entregas con costo que todavía no se han cobrado y ya les toca.
 *
 * "Ya les toca" es que `descontar_desde` haya llegado antes de que termine el
 * periodo. Así una entrega del 20 de agosto cae en la quincena que cierra el
 * 31 y no en la que cerró el 15 —que ya se pagó—.
 *
 * Se cobra el costo COMPLETO de una vez y no en parcialidades: quien quiera
 * repartirlo lo captura como préstamo de la empresa, que para eso existe y
 * lleva su saldo. Un uniforme de doscientos pesos en cuatro pagos de cincuenta
 * es más trabajo de seguimiento que el dinero que representa.
 */
export async function entregasPorCobrar(
  companyId: string,
  hasta: string,
  empleadoIds?: string[]
): Promise<EntregaPorCobrar[]> {
  const args: any[] = [companyId, hasta];
  let filtro = '';
  if (empleadoIds?.length) {
    args.push(empleadoIds);
    filtro = ` AND e.empleado_id = ANY($${args.length}::uuid[])`;
  }
  const r = await query<any>(
    `SELECT e.id, e.empleado_id, e.articulo, e.cantidad, e.costo
       FROM nomina_entregas e
      WHERE e.company_id = $1
        AND e.descontado_periodo_id IS NULL
        AND e.costo > 0
        AND e.descontar_desde IS NOT NULL
        AND e.descontar_desde <= $2::date${filtro}
      ORDER BY e.descontar_desde, e.created_at`,
    args
  );
  return r.rows.map((x: any) => ({
    id: x.id,
    empleado_id: x.empleado_id,
    articulo: x.articulo,
    cantidad: Number(x.cantidad),
    importe: Number(x.costo),
  }));
}

/**
 * Marca como cobradas las entregas que entraron a un periodo.
 *
 * Se guarda EN QUÉ periodo y no un simple "ya se cobró": es lo único que
 * permite enseñarle el recibo a quien reclame, y si el periodo se reabre el
 * descuento vuelve a quedar pendiente solo.
 */
export async function marcarEntregasCobradas(
  client: any, companyId: string, periodoId: string, ids: string[]
) {
  if (!ids.length) return 0;
  const r = await client.query(
    `UPDATE nomina_entregas
        SET descontado_periodo_id = $1, descontado_at = NOW()
      WHERE company_id = $2 AND id = ANY($3::uuid[])
        AND descontado_periodo_id IS NULL`,
    [periodoId, companyId, ids]
  );
  return r.rowCount || 0;
}
