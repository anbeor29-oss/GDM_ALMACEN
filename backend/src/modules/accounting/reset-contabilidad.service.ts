/**
 * Reiniciar contabilidad — deja la contabilidad de UNA empresa en blanco para
 * volver a importar un catálogo y un libro diario limpios, SIN tocar los XML.
 *
 * Borra: pólizas (journal_entries + journal_lines), su enlace con CFDI
 * (journal_entry_cfdi), los saldos por periodo y el CATÁLOGO de cuentas
 * (accounting_accounts) con todo lo que cuelga de él (equivalencias, cuentas
 * fijas, y referencias de conciliación/tarjetas que quedan en NULL).
 *
 * CONSERVA: los XML del respaldo (cfdi_recibidos) y su relación de pagos
 * (cfdi_pago_relacion), los periodos/ejercicios, la máscara/config contable y las
 * asignaciones por ClaveProdServ (venta/compra_producto_cuenta, que ligan por
 * código y se re-enganchan al re-importar el catálogo).
 *
 * Es IRREVERSIBLE y por eso vive sólo en Súper Admin, con confirmación por RFC, y
 * corre en UNA transacción (si algo choca, no borra nada).
 */
import { transaction, transactionQuery } from '../../config/database';

/**
 * Limpia TODO lo que apunta (FK) a `destino`(id) para las filas cuyo id sale de
 * `subIds` (parametrizado con $1 = companyId): lo que no admite NULL se borra, lo
 * que sí, se deja en NULL. Descubre las FK por el catálogo del sistema para no
 * depender de una lista fija.
 */
async function limpiarReferencias(client: any, destino: string, subIds: string, companyId: string) {
  const fks = await transactionQuery<any>(client, `
    SELECT tc.table_name AS t, kcu.column_name AS c, col.is_nullable AS n
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      JOIN information_schema.columns col
        ON col.table_name = kcu.table_name AND col.column_name = kcu.column_name AND col.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND ccu.table_name = $1 AND ccu.column_name = 'id'`, [destino]);
  for (const fk of fks.rows) {
    const scope = `"${fk.c}" IN (${subIds})`;
    if (fk.n === 'YES') {
      await transactionQuery(client, `UPDATE "${fk.t}" SET "${fk.c}" = NULL WHERE ${scope}`, [companyId]);
    } else {
      await transactionQuery(client, `DELETE FROM "${fk.t}" WHERE ${scope}`, [companyId]);
    }
  }
}

export async function reiniciarContabilidad(companyId: string): Promise<{
  polizas: number; saldos: number; cuentas: number;
}> {
  return transaction(async (client) => {
    const entriesSub = `SELECT id FROM journal_entries WHERE company_id = $1`;
    const cuentasSub = `SELECT id FROM accounting_accounts WHERE company_id = $1`;

    // 1) Todo lo que cuelga de las PÓLIZAS (renglones, enlace con CFDI, etc.) y las pólizas.
    await limpiarReferencias(client, 'journal_entries', entriesSub, companyId);
    const pol = await transactionQuery(client, `DELETE FROM journal_entries WHERE company_id = $1`, [companyId]);

    // 2) Saldos por periodo (y de dónde salió cada uno). Los PERIODOS se conservan.
    const src = await transactionQuery<any>(client, `SELECT to_regclass('accounting_period_sources') AS r`);
    if (src.rows[0]?.r) {
      await transactionQuery(client,
        `DELETE FROM accounting_period_sources WHERE periodo_id IN (SELECT id FROM accounting_periods WHERE company_id = $1)`, [companyId]);
    }
    const sal = await transactionQuery(client, `DELETE FROM accounting_period_balances WHERE company_id = $1`, [companyId]);

    // 3) Todo lo que cuelga del CATÁLOGO (equivalencias, cuentas fijas, conciliación → NULL,
    //    y el propio parent_id → NULL para soltar el árbol antes de borrar) y el catálogo.
    await limpiarReferencias(client, 'accounting_accounts', cuentasSub, companyId);
    const cta = await transactionQuery(client, `DELETE FROM accounting_accounts WHERE company_id = $1`, [companyId]);

    return { polizas: pol.rowCount || 0, saldos: sal.rowCount || 0, cuentas: cta.rowCount || 0 };
  });
}
