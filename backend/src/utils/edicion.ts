/**
 * edicion.ts — el candado que impide guardar encima del trabajo de otro.
 *
 * CÓMO SE USA
 *   await tomarEdicion(client, 'customers', id, req.body.edicion);
 *   ...el resto del UPDATE, dentro de la misma transacción...
 *
 * El contador se incrementa Y se compara en la misma sentencia. Hacerlo en dos
 * pasos —leer, comparar, escribir— dejaría una rendija entre la lectura y la
 * escritura por la que se cuela justo lo que se quiere evitar: dos guardados
 * simultáneos que se creen ambos el primero.
 *
 * TIENE QUE IR DENTRO DE LA TRANSACCIÓN DEL GUARDADO
 * Si el UPDATE de los datos falla después, la transacción se revierte y el
 * contador vuelve atrás con él. Un contador que sube por un guardado que no
 * ocurrió obligaría a recargar la pantalla sin motivo.
 *
 * CUANDO NO SE MANDA EL NÚMERO, NO SE COMPARA
 * Los procesos internos —el importador de XML dando de alta un cliente, el
 * cierre del POS— no vienen de un formulario y no tienen un número que
 * devolver. Ahí sólo se incrementa. La protección es para la edición humana,
 * que es donde alguien pierde media hora de captura; exigírsela a un proceso
 * automático sólo lo rompería sin proteger a nadie.
 */

import { PoolClient } from 'pg';
import { transactionQuery } from '../config/database';
import { ConflictError, NotFoundError } from '../middleware/errorHandler';

/**
 * Tablas con contador de edición.
 *
 * Lista blanca explícita: el nombre de la tabla se interpola en el SQL —no
 * puede ir como parámetro— así que sólo pueden llegar valores de aquí.
 */
const TABLAS = [
  'invoices', 'customers', 'products', 'purchase_orders', 'nomina_empleados',
] as const;
export type TablaConEdicion = typeof TABLAS[number];

/** Nombre legible para el mensaje de error. */
const COMO_SE_LLAMA: Record<TablaConEdicion, string> = {
  invoices: 'la factura',
  customers: 'el cliente',
  products: 'el producto',
  purchase_orders: 'la orden de compra',
  nomina_empleados: 'el expediente del trabajador',
};

/**
 * Hereda de ConflictError para que salga con 409 por el mismo camino que el
 * resto: el manejador de errores lee `statusCode`, y una clase suelta con su
 * propio campo `status` habría terminado en un 500 genérico.
 */
export class EdicionEnConflicto extends ConflictError {
  /** Para que la pantalla pueda recargar con el número bueno. */
  edicionActual: number;

  constructor(tabla: TablaConEdicion, edicionActual: number) {
    super(
      `Alguien más guardó ${COMO_SE_LLAMA[tabla]} mientras lo tenías abierto. ` +
      'Tus cambios NO se guardaron para no borrar los suyos. Vuelve a abrirlo, ' +
      'revisa lo que quedó y captura de nuevo lo que falte.'
    );
    this.name = 'EdicionEnConflicto';
    this.edicionActual = edicionActual;
    Object.setPrototypeOf(this, EdicionEnConflicto.prototype);
  }
}

export class DocumentoNoEncontrado extends NotFoundError {
  constructor(tabla: TablaConEdicion) {
    super(`No se encontró ${COMO_SE_LLAMA[tabla]}.`);
    this.name = 'DocumentoNoEncontrado';
    Object.setPrototypeOf(this, DocumentoNoEncontrado.prototype);
  }
}

/**
 * Sube el contador del documento y devuelve el nuevo valor.
 *
 * @param esperada  el número que traía el formulario. Si viene vacío no se
 *                  compara — ver el encabezado.
 * @throws EdicionEnConflicto si alguien guardó en medio.
 */
export async function tomarEdicion(
  client: PoolClient,
  tabla: TablaConEdicion,
  id: string,
  esperada?: number | string | null
): Promise<number> {
  if (!TABLAS.includes(tabla)) {
    throw new Error(`Tabla sin contador de edición: ${tabla}`);
  }

  const n = esperada == null || esperada === '' ? null : Number(esperada);
  const comparando = n != null && Number.isFinite(n) && n > 0;

  const r = await transactionQuery<{ edicion: number }>(
    client,
    `UPDATE ${tabla} SET edicion = edicion + 1
      WHERE id = $1 ${comparando ? 'AND edicion = $2' : ''}
      RETURNING edicion`,
    comparando ? [id, n] : [id]
  );

  if (r.rows.length > 0) return Number(r.rows[0].edicion);

  /* No actualizó nada: o el documento no existe, o el contador no coincide.
   * Se distingue con una lectura, porque decirle "hubo un conflicto" a quien
   * abrió un documento borrado lo mandaría a buscar un choque que no pasó. */
  const actual = await transactionQuery<{ edicion: number }>(
    client,
    `SELECT edicion FROM ${tabla} WHERE id = $1`,
    [id]
  );
  if (actual.rows.length === 0) throw new DocumentoNoEncontrado(tabla);
  throw new EdicionEnConflicto(tabla, Number(actual.rows[0].edicion));
}
