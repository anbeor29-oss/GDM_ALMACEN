/**
 * ¿Un CFDI ya está contabilizado, venga de donde venga? (predicado SQL reutilizable)
 *
 * Un comprobante puede tener póliza por TRES vías, y el motor histórico sólo miraba la
 * primera —por eso re-codificaba lo que ya venía en un respaldo y lo marcaba como
 * «pendiente de clasificar»—:
 *   1) `journal_entries.origen_uuid = uuid`   → la que pone el propio motor de NEXO.
 *   2) `journal_lines.uuid_cfdi = uuid`        → pólizas manuales o importadas que
 *      etiquetan el renglón. Se EXCLUYEN las de banco (`origen='BANCO'`): un pago
 *      conciliado etiqueta el CFDI pero NO asienta el documento (su pasivo/ingreso),
 *      así que ésa no cuenta como «ya contabilizada la factura».
 *   3) `journal_entry_cfdi.uuid = uuid`        → el ligado de los respaldos de Contalink
 *      (su `origen_uuid` es `CTLK:<hash>`, NUNCA el UUID del CFDI).
 *
 * Documento NEXO_Requerimientos_Recuperacion §1 y §2: una factura ya contabilizada en el
 * respaldo NO debe volver a codificarse ni aparecer como pendiente de clasificar. Este
 * predicado es la definición ÚNICA de «ya contabilizado» que usan el motor de pólizas,
 * el diagnóstico de cuadre y el aviso de «productos sin clasificar».
 *
 * `alias` = el alias de la tabla `cfdi_recibidos` en la consulta (se usan `.company_id`
 * y `.uuid`). Devuelve un predicado booleano entre paréntesis, listo para intercalar.
 */
export function cfdiYaContabilizado(alias = 'c'): string {
  const a = alias;
  return `(
    EXISTS (SELECT 1 FROM journal_entries e
             WHERE e.company_id=${a}.company_id AND e.origen_uuid=${a}.uuid)
    OR EXISTS (SELECT 1 FROM journal_lines jl
                 JOIN journal_entries je ON je.id=jl.entry_id
                WHERE je.company_id=${a}.company_id AND jl.uuid_cfdi=${a}.uuid
                  AND je.origen <> 'BANCO')
    OR EXISTS (SELECT 1 FROM journal_entry_cfdi jec
                WHERE jec.company_id=${a}.company_id AND jec.uuid=${a}.uuid)
  )`;
}

/** La negación: el CFDI AÚN no tiene póliza por ninguna vía. */
export function cfdiSinPoliza(alias = 'c'): string {
  return `NOT ${cfdiYaContabilizado(alias)}`;
}
