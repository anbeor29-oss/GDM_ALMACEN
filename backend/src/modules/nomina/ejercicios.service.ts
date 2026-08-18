/**
 * ejercicios.service — los parámetros fiscales de cada año.
 *
 * QUÉ CAMBIÓ RESPECTO AL SISTEMA ANTERIOR
 * Allá la tarifa del Art. 96, el subsidio, la UMA y los salarios mínimos eran
 * constantes dentro de nomina.html. Cambian cada año, y con ellas en el código
 * un cambio de tarifa era un despliegue — y si nadie lo hacía a tiempo, el
 * sistema seguía reteniendo con la tabla del año pasado sin que nada se viera
 * roto. Aquí viven versionadas por ejercicio.
 *
 * SON GLOBALES Y LAS EDITA SUPER_ADMIN
 * La UMA y la tarifa del ISR son del país, no de la empresa: si cada empresa
 * tuviera la suya, dos empresas de la misma plataforma calcularían distinto el
 * mismo impuesto. Quien opera la plataforma las mantiene; el resto las lee.
 *
 * NACEN SIN CONFIRMAR
 * La semilla de 2026 se copió del sistema anterior. Copiar no es verificar, y
 * estos números deciden cuánto se le retiene a cada persona: hasta que alguien
 * los coteje contra el DOF y los marque confirmados, la pantalla lo advierte en
 * todas partes.
 */

import { PoolClient } from 'pg';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import { Ejercicio, RenglonTarifa, RenglonSubsidio } from './motor';

/**
 * Carga un ejercicio completo, listo para el motor.
 *
 * Si el año no existe NO cae al anterior: retener con la tarifa del año pasado
 * es un error silencioso que se descubre en la declaración anual.
 */
export async function cargar(anio: number, alDia?: string | null): Promise<Ejercicio> {
  const a = Number(anio);
  if (!Number.isInteger(a)) throw new ValidationError('El ejercicio debe ser un año');

  /* `alDia` es el último día del periodo que se está calculando. Importa para
   * el subsidio al empleo: desde 2026 el decreto trae un transitorio que manda
   * un porcentaje distinto en enero, porque la UMA se actualiza hasta febrero.
   * Sin fecha se toma el renglón sin vigencia, que es como estaban los años
   * anteriores. */
  const dia = alDia && /^\d{4}-\d{2}-\d{2}$/.test(alDia) ? alDia : null;

  const e = await query<any>(
    `SELECT anio, uma_diaria, uma_mensual, smg_general, smg_frontera, confirmado
       FROM nomina_ejercicios WHERE anio = $1`,
    [a]
  );
  if (e.rows.length === 0) {
    throw new NotFoundError(
      `No hay parámetros fiscales cargados para ${a}. Captúralos en ` +
      'Nómina → Parámetros antes de calcular: el sistema no usa los del año ' +
      'anterior porque eso retendría de más o de menos a toda la plantilla.'
    );
  }
  const r = e.rows[0];

  const [tarifa, subsidio] = await Promise.all([
    query<any>(
      `SELECT limite_inferior, limite_superior, cuota_fija, porcentaje
         FROM nomina_tarifa_isr
        WHERE anio = $1 AND periodicidad = 'MENSUAL'
        ORDER BY renglon`,
      [a]
    ),
    query<any>(
      `SELECT limite_inferior, limite_superior, subsidio, porcentaje_uma,
              TO_CHAR(vigente_desde, 'YYYY-MM-DD') AS vigente_desde,
              TO_CHAR(vigente_hasta, 'YYYY-MM-DD') AS vigente_hasta
         FROM nomina_subsidio
        WHERE anio = $1 AND periodicidad = 'MENSUAL'
          AND ($2::date IS NULL
               OR (vigente_desde IS NULL AND vigente_hasta IS NULL)
               OR ($2::date >= COALESCE(vigente_desde, $2::date)
                   AND $2::date <= COALESCE(vigente_hasta, $2::date)))
        ORDER BY renglon`,
      [a, dia]
    ),
  ]);

  const num = (v: any) => (v === null || v === undefined ? null : Number(v));

  return {
    anio: r.anio,
    umaDiaria: Number(r.uma_diaria),
    umaMensual: Number(r.uma_mensual),
    smgGeneral: Number(r.smg_general),
    smgFrontera: Number(r.smg_frontera),
    tarifaIsr: tarifa.rows.map((t): RenglonTarifa => ({
      limite_inferior: Number(t.limite_inferior),
      limite_superior: num(t.limite_superior),
      cuota_fija: Number(t.cuota_fija),
      porcentaje: Number(t.porcentaje),
    })),
    subsidio: subsidio.rows.map((s): RenglonSubsidio => ({
      limite_inferior: Number(s.limite_inferior),
      limite_superior: num(s.limite_superior),
      subsidio: Number(s.subsidio),
      porcentaje_uma: num(s.porcentaje_uma),
      vigente_desde: s.vigente_desde ?? null,
      vigente_hasta: s.vigente_hasta ?? null,
    })),
  };
}

/** Lo que necesita la pantalla: el ejercicio, sus tablas y si está confirmado. */
export async function detalle(anio: number) {
  const ej = await cargar(anio);
  const meta = await query<any>(
    `SELECT e.fuente, e.confirmado, e.confirmado_at, e.updated_at,
            NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '') AS confirmado_por
       FROM nomina_ejercicios e
       LEFT JOIN users u ON u.id = e.confirmado_por
      WHERE e.anio = $1`,
    [anio]
  );
  return { ...ej, ...meta.rows[0], avisos: revisar(ej) };
}

export async function listar() {
  const r = await query<any>(
    `SELECT e.anio, e.uma_diaria, e.uma_mensual, e.smg_general, e.smg_frontera,
            e.confirmado, e.fuente,
            (SELECT COUNT(*) FROM nomina_tarifa_isr t WHERE t.anio = e.anio) AS renglones_isr,
            (SELECT COUNT(*) FROM nomina_subsidio  s WHERE s.anio = e.anio) AS renglones_subsidio
       FROM nomina_ejercicios e
      ORDER BY e.anio DESC`
  );
  return r.rows;
}

/**
 * Revisa la coherencia de las tablas y devuelve lo que se ve mal.
 *
 * No bloquea: avisa. Una tarifa con un hueco no truena el cálculo —simplemente
 * deja de subir de renglón— y por eso hay que verlo antes, no después.
 */
export function revisar(e: Ejercicio): string[] {
  const avisos: string[] = [];

  if (!e.tarifaIsr.length) avisos.push('No hay tarifa del Art. 96 cargada.');
  if (!e.subsidio.length) avisos.push('No hay tabla de subsidio al empleo cargada.');

  const revisarEscalones = (
    filas: Array<{ limite_inferior: number; limite_superior: number | null }>,
    nombre: string
  ) => {
    for (let i = 0; i < filas.length - 1; i++) {
      const a = filas[i];
      const b = filas[i + 1];
      if (a.limite_superior === null) {
        avisos.push(`${nombre}: el renglón ${i + 1} no tiene techo pero no es el último.`);
        continue;
      }
      /* El límite inferior del siguiente debe ser un centavo más que el techo
       * del anterior. Un hueco mayor deja bases sin renglón. */
      const salto = Math.round((b.limite_inferior - a.limite_superior) * 100) / 100;
      if (salto !== 0.01) {
        avisos.push(
          `${nombre}: entre el renglón ${i + 1} (hasta ${a.limite_superior}) y el ` +
          `${i + 2} (desde ${b.limite_inferior}) hay un salto de ${salto}, no de un centavo.`
        );
      }
    }
    const ultimo = filas[filas.length - 1];
    if (ultimo && ultimo.limite_superior !== null) {
      avisos.push(`${nombre}: el último renglón tiene techo; las bases mayores se quedarían fuera.`);
    }
  };

  revisarEscalones(e.tarifaIsr, 'Tarifa del ISR');

  /* El subsidio YA NO ES UNA ESCALERA.
   *
   * Hasta 2023 era una tabla de once renglones y revisarla con la misma regla
   * que la tarifa tenía sentido. Desde el decreto de 2024 es un solo importe
   * para quien gana hasta cierto tope: que el último renglón TENGA techo es lo
   * correcto —arriba del tope simplemente no hay subsidio—, y exigirle que
   * termine abierto levantaba un aviso falso.
   *
   * Además, desde 2026 un mismo ejercicio puede traer dos renglones con el
   * mismo rango de ingresos y distinta vigencia (el transitorio de enero). Leer
   * esos dos como escalones consecutivos daba un "salto" absurdo de -11,492.65.
   * Por eso se agrupan por vigencia y cada grupo se revisa por su cuenta. */
  const porVigencia = new Map<string, typeof e.subsidio>();
  for (const s of e.subsidio) {
    const k = `${s.vigente_desde || 'inicio'}..${s.vigente_hasta || 'fin'}`;
    if (!porVigencia.has(k)) porVigencia.set(k, []);
    porVigencia.get(k)!.push(s);
  }
  for (const [vigencia, filas] of porVigencia) {
    const cual = porVigencia.size > 1 ? `Subsidio al empleo (${vigencia})` : 'Subsidio al empleo';
    if (filas[0].limite_inferior !== 0.01) {
      avisos.push(`${cual}: no empieza en 0.01, sino en ${filas[0].limite_inferior}.`);
    }
    for (let i = 0; i < filas.length - 1; i++) {
      const a = filas[i], b = filas[i + 1];
      if (a.limite_superior === null) {
        avisos.push(`${cual}: el renglón ${i + 1} no tiene techo pero no es el último.`);
        continue;
      }
      const salto = Math.round((b.limite_inferior - a.limite_superior) * 100) / 100;
      if (salto !== 0.01) {
        avisos.push(
          `${cual}: entre el renglón ${i + 1} (hasta ${a.limite_superior}) y el ` +
          `${i + 2} (desde ${b.limite_inferior}) hay un salto de ${salto}, no de un centavo.`
        );
      }
    }
  }

  if (e.smgFrontera < e.smgGeneral) {
    avisos.push('El salario mínimo de frontera es menor que el general: revisa si están invertidos.');
  }
  return avisos;
}

/* ═══════════════════ ESCRITURA ═══════════════════ */

export interface DatosEjercicio {
  anio: number;
  uma_diaria: number;
  uma_mensual: number;
  smg_general: number;
  smg_frontera: number;
  fuente?: string;
  tarifa?: Array<{ limite_inferior: number; limite_superior: number | null; cuota_fija: number; porcentaje: number }>;
  subsidio?: Array<{ limite_inferior: number; limite_superior: number | null; subsidio: number }>;
}

const positivo = (v: any, campo: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`${campo} debe ser un número mayor que cero`);
  return n;
};

/**
 * Da de alta o reemplaza un ejercicio completo.
 *
 * Las tablas se reemplazan enteras y no renglón por renglón: una tarifa a
 * medio actualizar —cinco renglones nuevos y seis viejos— calcularía mal y se
 * vería normal. O entra completa, o no entra.
 *
 * Guardar SIEMPRE deja el ejercicio como NO confirmado: quien cambió un número
 * es justamente quien no puede dar fe de que ya está revisado.
 */
export async function guardar(d: DatosEjercicio, userId?: string) {
  const anio = Number(d.anio);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    throw new ValidationError('El año del ejercicio no es válido');
  }

  const uma_diaria  = positivo(d.uma_diaria, 'La UMA diaria');
  const uma_mensual = positivo(d.uma_mensual, 'La UMA mensual');
  const smg_general = positivo(d.smg_general, 'El salario mínimo general');
  const smg_frontera = positivo(d.smg_frontera, 'El salario mínimo de frontera');

  if (smg_frontera < smg_general) {
    throw new ValidationError(
      'El salario mínimo de la frontera norte no puede ser menor que el general. ' +
      'Revisa si los dos valores están invertidos.'
    );
  }

  return transaction(async (client: PoolClient) => {
    await transactionQuery(
      client,
      `INSERT INTO nomina_ejercicios
         (anio, uma_diaria, uma_mensual, smg_general, smg_frontera, fuente, confirmado)
       VALUES ($1,$2,$3,$4,$5,$6,false)
       ON CONFLICT (anio) DO UPDATE SET
         uma_diaria = EXCLUDED.uma_diaria,
         uma_mensual = EXCLUDED.uma_mensual,
         smg_general = EXCLUDED.smg_general,
         smg_frontera = EXCLUDED.smg_frontera,
         fuente = COALESCE(EXCLUDED.fuente, nomina_ejercicios.fuente),
         confirmado = false,
         confirmado_por = NULL,
         confirmado_at = NULL,
         updated_at = NOW()`,
      [anio, uma_diaria, uma_mensual, smg_general, smg_frontera, d.fuente || null]
    );

    if (d.tarifa) {
      if (d.tarifa.length === 0) throw new ValidationError('La tarifa no puede quedar vacía');
      await transactionQuery(client, `DELETE FROM nomina_tarifa_isr WHERE anio = $1 AND periodicidad = 'MENSUAL'`, [anio]);
      let n = 0;
      for (const t of d.tarifa) {
        n++;
        const pct = Number(t.porcentaje);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          throw new ValidationError(`El porcentaje del renglón ${n} de la tarifa no es válido`);
        }
        await transactionQuery(
          client,
          `INSERT INTO nomina_tarifa_isr
             (anio, periodicidad, renglon, limite_inferior, limite_superior, cuota_fija, porcentaje)
           VALUES ($1,'MENSUAL',$2,$3,$4,$5,$6)`,
          [anio, n, Number(t.limite_inferior), t.limite_superior === null ? null : Number(t.limite_superior),
           Number(t.cuota_fija), pct]
        );
      }
    }

    if (d.subsidio) {
      await transactionQuery(client, `DELETE FROM nomina_subsidio WHERE anio = $1 AND periodicidad = 'MENSUAL'`, [anio]);
      let n = 0;
      for (const s of d.subsidio) {
        n++;
        await transactionQuery(
          client,
          `INSERT INTO nomina_subsidio
             (anio, periodicidad, renglon, limite_inferior, limite_superior, subsidio)
           VALUES ($1,'MENSUAL',$2,$3,$4,$5)`,
          [anio, n, Number(s.limite_inferior), s.limite_superior === null ? null : Number(s.limite_superior),
           Number(s.subsidio)]
        );
      }
    }

    return { anio, userId: userId || null };
  });
}

/**
 * Marca el ejercicio como cotejado contra la publicación oficial.
 *
 * Queda escrito QUIÉN y CUÁNDO. Es la firma de que alguien revisó los números
 * con los que se le retiene a la gente — si después salen mal, se sabe a quién
 * preguntarle, y esa es justamente la razón de que exista el campo.
 */
export async function confirmar(anio: number, userId: string) {
  const ej = await cargar(anio);
  const avisos = revisar(ej);
  if (avisos.length > 0) {
    throw new ValidationError(
      `No se puede confirmar ${anio} con las tablas así: ${avisos.join(' ')}`
    );
  }
  const r = await query(
    `UPDATE nomina_ejercicios
        SET confirmado = true, confirmado_por = $2, confirmado_at = NOW(), updated_at = NOW()
      WHERE anio = $1`,
    [anio, userId]
  );
  if (r.rowCount === 0) throw new NotFoundError(`No existe el ejercicio ${anio}`);
  return detalle(anio);
}
