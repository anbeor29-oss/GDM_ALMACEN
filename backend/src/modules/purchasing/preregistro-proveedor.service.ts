/**
 * preregistro-proveedor — dar de alta un proveedor con lo mínimo, al vuelo.
 *
 * PARA QUÉ
 * La mercancía llega con su factura y quien recibe tiene el papel en la mano.
 * Si ese proveedor no está en el catálogo, mandarlo a dar de alta un proveedor
 * completo —RFC, régimen fiscal, domicilio— es mandarlo a buscar datos que no
 * tiene mientras el repartidor espera. Lo que pasaba en la práctica es que la
 * mercancía entraba y la deuda no se registraba: nadie la reclamaba hasta que
 * el proveedor llamaba, y para entonces ya había vencido.
 *
 * Con el nombre y los días de crédito alcanza para lo único que urge: que la
 * cuenta por pagar exista, tenga acreedor y tenga fecha de vencimiento.
 *
 * LO QUE UN PREREGISTRO NO PUEDE HACER
 * Nada fiscal. No tiene RFC, así que no se le puede timbrar un complemento de
 * pago ni entra en una declaración. Va marcado con `es_preregistro` para que se
 * pueda perseguir después: "qué proveedores están a medias" es la pregunta que
 * evita que uno se quede así un año.
 *
 * POR QUÉ EL RFC LLEVA "SINRFC-"
 * Porque la columna es NOT NULL y su índice único lo usa el `ON CONFLICT` de la
 * descarga del SAT. Un marcador que empieza con "SINRFC-" no se puede confundir
 * con un RFC, es único, y cualquier validación lo rechaza — que es justo lo que
 * debe pasar si alguien intenta usarlo para timbrar.
 */

import { PoolClient } from 'pg';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

export interface DatosPreregistro {
  /** Como venga en la factura. Es lo único obligatorio. */
  nombre: string;
  /** Los que diga el proveedor. 0 = de contado. */
  creditDays?: number;
}

/** "SINRFC-" + 6 caracteres. Ni parece un RFC ni pasa una validación de RFC. */
function marcadorSinRfc(): string {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += letras[Math.floor(Math.random() * letras.length)];
  return `SINRFC-${s}`;
}

export function esPreregistroRfc(rfc?: string | null): boolean {
  return String(rfc || '').startsWith('SINRFC-');
}

/**
 * Crea el proveedor a medias dentro de una transacción en curso.
 *
 * Antes de crearlo busca por nombre: capturar "Aceros del Norte" dos veces en
 * dos recepciones distintas crearía dos proveedores con la misma deuda
 * repartida, y el saldo de ninguno de los dos sería el real. Se compara sin
 * acentos ni mayúsculas porque nadie teclea igual dos veces.
 */
export async function preregistrarEnTransaccion(
  client: PoolClient,
  companyId: string,
  d: DatosPreregistro
): Promise<{ id: string; business_name: string; nuevo: boolean }> {
  const nombre = String(d.nombre || '').trim().slice(0, 200);
  if (!nombre) {
    throw new ValidationError(
      'Escribe el nombre del proveedor como viene en la factura: sin nombre no ' +
      'hay a quién deberle.'
    );
  }

  const dias = Number.isFinite(Number(d.creditDays)) ? Math.max(0, Math.trunc(Number(d.creditDays))) : 0;
  if (dias > 365) {
    throw new ValidationError('Los días de crédito no pueden pasar de 365');
  }

  /* ¿Ya existe alguien con ese nombre? Se busca entre TODOS los proveedores,
   * no sólo los preregistros: si el de la factura resulta ser uno que ya
   * estaba dado de alta completo, se usa ése y no se duplica.
   *
   * Los acentos se quitan con `translate` y no con `unaccent`: la extensión
   * puede no estar instalada, y una consulta que falla DENTRO de una
   * transacción la aborta entera —no hay "intentar y si no, la otra"—. La
   * recepción de mercancía se caería por un detalle de comparación de texto. */
  const ya = await transactionQuery<any>(
    client,
    `SELECT id, business_name, es_preregistro
       FROM customers
      WHERE company_id = $1 AND party_type = 'SUPPLIER' AND deleted_at IS NULL
        AND UPPER(TRIM(translate(business_name, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')))
          = UPPER(TRIM(translate($2,            'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')))
      ORDER BY es_preregistro ASC
      LIMIT 1`,
    [companyId, nombre]
  );

  if (ya.rows[0]) {
    /* Si el que ya estaba es un preregistro y ahora traen días de crédito, se
     * le ponen: es información nueva sobre el mismo proveedor, no otro. */
    if (ya.rows[0].es_preregistro && dias > 0) {
      await transactionQuery(
        client,
        `UPDATE customers SET credit_days = $2, updated_at = NOW() WHERE id = $1`,
        [ya.rows[0].id, dias]
      );
    }
    return { id: ya.rows[0].id, business_name: ya.rows[0].business_name, nuevo: false };
  }

  /* El marcador es aleatorio; si por un choque astronómico ya existiera, se
   * intenta otra vez en vez de reventar la recepción entera. */
  let ultimoError: any = null;
  for (let intento = 0; intento < 5; intento++) {
    try {
      const r = await transactionQuery<any>(
        client,
        `INSERT INTO customers
           (company_id, rfc, business_name, party_type, credit_days, credit_limit,
            credit_used, es_preregistro)
         VALUES ($1, $2, $3, 'SUPPLIER', $4, 0, 0, true)
         RETURNING id, business_name`,
        [companyId, marcadorSinRfc(), nombre, dias]
      );
      logger.info(
        `[compras] proveedor preregistrado "${nombre}" (${dias} días de crédito)`
      );
      return { id: r.rows[0].id, business_name: r.rows[0].business_name, nuevo: true };
    } catch (e: any) {
      if (e?.code !== '23505') throw e;
      ultimoError = e;
    }
  }
  throw ultimoError;
}

/** El mismo alta, por su cuenta — la usa la pantalla de la orden de compra. */
export async function preregistrar(companyId: string, d: DatosPreregistro) {
  return transaction((client) => preregistrarEnTransaccion(client, companyId, d));
}

/**
 * Los proveedores que quedaron a medias.
 *
 * Sirve para perseguirlos: un preregistro es una deuda con acreedor incompleto,
 * y mientras siga así no se le puede timbrar un complemento de pago.
 */
export async function listarPreregistros(companyId: string) {
  const r = await query<any>(
    `SELECT c.id, c.business_name, c.credit_days, c.created_at,
            COUNT(s.id)::int                       AS facturas,
            COALESCE(SUM(s.amount), 0)             AS total,
            COALESCE(SUM(s.amount) FILTER (WHERE s.status <> 'PAID'), 0) AS por_pagar
       FROM customers c
       LEFT JOIN supplier_payments_schedule s
              ON s.supplier_id = c.id AND s.status <> 'CANCELLED'
      WHERE c.company_id = $1 AND c.es_preregistro AND c.deleted_at IS NULL
      GROUP BY c.id
      ORDER BY por_pagar DESC, c.created_at DESC`,
    [companyId]
  );
  return r.rows.map((x: any) => ({
    ...x,
    total: Number(x.total),
    por_pagar: Number(x.por_pagar),
  }));
}
