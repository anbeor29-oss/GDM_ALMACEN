/**
 * auditoria.service — le pregunta al SAT si nuestros comprobantes siguen vivos.
 *
 * EL PROBLEMA
 * Timbrar deja el CFDI marcado como timbrado aquí dentro. Lo que pase después
 * en el SAT —una cancelación que el receptor solicitó, un plazo vencido, un
 * comprobante que allá aparece cancelado y aquí se sigue cobrando— no se entera
 * nadie hasta la revisión anual.
 *
 * QUÉ SERVICIO USA, Y POR QUÉ ESE
 * El `ConsultaCFDIService` del SAT: público, sin e.firma, sin cuota conocida.
 * Basta con RFC emisor, RFC receptor, total, UUID y los últimos ocho caracteres
 * del sello. Es exactamente la pregunta que hay que hacer —"¿está vigente?"— y
 * no requiere custodiar la llave privada de nadie.
 *
 * La descarga masiva del documento de arquitectura resuelve otra cosa: traerse
 * los XML que NOS emitieron. Eso necesita e.firma, cola de paquetes y bóveda de
 * credenciales, y se construye aparte. Mezclarlos habría metido el manejo de
 * llaves privadas en una tarea que no lo necesita.
 *
 * CADA 72 HORAS, PERO POR COMPROBANTE
 * El cron corre a diario y toma sólo los que llevan más de 72 horas sin revisar.
 * Programarlo "cada 3 días" con cron de calendario se desfasa en los meses de 31
 * y deja huecos; así cada CFDI se revisa en su propio ciclo, y si un día el
 * proceso no corre, al siguiente se pone al corriente solo.
 *
 * NUNCA ESCRIBE SOBRE EL DOCUMENTO
 * Si el SAT dice "Cancelado" y aquí está vigente, se marca la DISCREPANCIA; no
 * se cancela la factura. Cancelar mueve inventario, saldos y CFDI relacionados:
 * es una decisión de alguien, no de un proceso que corre de madrugada.
 */

import { query } from '../../config/database';
import logger from '../../middleware/logger';
import { consultarEstatusSat } from '../pac/sat-status.service';

/** Horas que deben pasar antes de volver a preguntar por el mismo CFDI. */
export const HORAS_ENTRE_REVISIONES = 72;

/** Pausa entre consultas: el servicio del SAT es público y compartido. */
const PAUSA_MS = 400;

export interface Comprobante {
  doc_type: 'invoice' | 'credit_note' | 'payment';
  doc_id: string;
  uuid: string;
  serie_folio: string;
  total: string | number;
  estado_local: string;
  rfc_emisor: string;
  rfc_receptor: string;
  xml_content: string | null;
}

/**
 * Los tres tipos de CFDI que emitimos, en una sola lista.
 *
 * El complemento de pago va con total 0.00 a propósito: el Anexo 20 obliga a
 * que un comprobante tipo P lleve Total en cero, y el SAT compara ese cero
 * contra la expresión impresa. Mandar el importe pagado devuelve "no
 * encontrado" y parece un CFDI perdido cuando sólo está mal la pregunta.
 */
const SQL_COMPROBANTES = `
  SELECT 'invoice' AS doc_type, i.id AS doc_id, i.cfdi_uuid AS uuid,
         COALESCE(i.serie, '') || '-' || i.folio AS serie_folio,
         i.total, i.status AS estado_local,
         e.rfc AS rfc_emisor, c.rfc AS rfc_receptor, i.xml_content
    FROM invoices i
    JOIN companies e ON e.id = i.company_id
    LEFT JOIN customers c ON c.id = i.customer_id
   WHERE i.company_id = $1 AND i.cfdi_uuid IS NOT NULL

  UNION ALL

  SELECT 'credit_note', cn.id, cn.uuid,
         COALESCE(cn.serie, '') || '-' || cn.folio,
         cn.total, cn.status,
         e.rfc, c.rfc, cn.xml_content
    FROM credit_notes cn
    JOIN companies e ON e.id = cn.company_id
    LEFT JOIN customers c ON c.id = cn.customer_id
   WHERE cn.company_id = $1 AND cn.uuid IS NOT NULL

  UNION ALL

  SELECT 'payment', p.id, p.uuid,
         COALESCE(p.serie, '') || '-' || p.folio,
         0, 'STAMPED',
         e.rfc, c.rfc, p.xml_content
    FROM payments p
    JOIN companies e ON e.id = p.company_id
    LEFT JOIN customers c ON c.id = p.customer_id
   WHERE p.company_id = $1 AND p.uuid IS NOT NULL
`;

/** El sello viene dentro del XML timbrado; sus últimos 8 son la parte útil. */
function selloDelXml(xml: string | null): string | null {
  if (!xml) return null;
  const m = /Sello="([^"]+)"/.exec(xml);
  return m ? m[1] : null;
}

/**
 * ¿Lo que dice el SAT contradice lo que tenemos aquí?
 *
 * Sólo cuenta la contradicción real: cancelado allá y vigente aquí, o al revés.
 *
 * "No Encontrado" NO se marca como discrepancia, aunque lo parezca. El SAT tarda
 * en publicar un comprobante recién timbrado, y un CFDI de pruebas nunca va a
 * aparecer. Marcarlo en rojo llenaría la pantalla de alarmas que no significan
 * nada y enterraría las dos o tres que sí. Se cuenta aparte, en su propia
 * columna del resumen, que es donde se ve si son cuatro o son cuatrocientos.
 */
function hayDiscrepancia(estadoLocal: string, estadoSat: string): boolean {
  const localCancelado = estadoLocal === 'CANCELLED';
  if (estadoSat === 'Cancelado' && !localCancelado) return true;
  if (estadoSat === 'Vigente' && localCancelado) return true;
  return false;
}

/** Revisa UN comprobante y guarda el resultado. */
export async function revisarComprobante(companyId: string, c: Comprobante): Promise<any> {
  const r = await consultarEstatusSat({
    rfcEmisor: c.rfc_emisor,
    rfcReceptor: c.rfc_receptor || '',
    total: c.total,
    uuid: c.uuid,
    sello: selloDelXml(c.xml_content),
  });

  const discrepancia = r.encontrado && hayDiscrepancia(c.estado_local, r.estado);

  const ins = await query<any>(
    `INSERT INTO auditoria_cfdi
       (company_id, doc_type, doc_id, uuid, serie_folio,
        estado_sat, es_cancelable, estatus_cancelacion, codigo_estatus,
        validacion_efos, resumen, estado_local, discrepancia, error_consulta,
        revisiones)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, 1)
     ON CONFLICT (company_id, uuid) DO UPDATE SET
       estado_sat          = EXCLUDED.estado_sat,
       es_cancelable       = EXCLUDED.es_cancelable,
       estatus_cancelacion = EXCLUDED.estatus_cancelacion,
       codigo_estatus      = EXCLUDED.codigo_estatus,
       validacion_efos     = EXCLUDED.validacion_efos,
       resumen             = EXCLUDED.resumen,
       estado_local        = EXCLUDED.estado_local,
       discrepancia        = EXCLUDED.discrepancia,
       error_consulta      = EXCLUDED.error_consulta,
       serie_folio         = EXCLUDED.serie_folio,
       revisiones          = auditoria_cfdi.revisiones + 1,
       ultima_revision     = NOW()
     RETURNING *`,
    [companyId, c.doc_type, c.doc_id, c.uuid, c.serie_folio,
     r.estado || null, r.esCancelable || null, r.estatusCancelacion || null,
     r.codigoEstatus || null, r.validacionEfos || null, r.resumen || null,
     c.estado_local, discrepancia, r.error || null]
  );

  if (discrepancia) {
    logger.warn(
      `[auditoria] DISCREPANCIA ${c.serie_folio} (${c.uuid}): ` +
      `aquí ${c.estado_local}, el SAT dice ${r.estado}`
    );
  }
  return ins.rows[0];
}

/**
 * Corrida de auditoría de una empresa.
 *
 * @param soloPendientes true = sólo los que llevan más de 72 h sin revisar
 *                       (lo que hace el cron); false = todo (botón "revisar
 *                       ahora", cuando alguien quiere certeza en el momento).
 */
export async function correrAuditoria(
  companyId: string,
  opts: { soloPendientes?: boolean; limite?: number } = {}
): Promise<any> {
  const limite = Math.min(500, Math.max(1, opts.limite ?? 200));

  const filtro = opts.soloPendientes
    ? `AND (a.ultima_revision IS NULL
            OR a.ultima_revision < NOW() - INTERVAL '${HORAS_ENTRE_REVISIONES} hours')`
    : '';

  const pendientes = await query<Comprobante>(
    `SELECT t.* FROM (${SQL_COMPROBANTES}) t
       LEFT JOIN auditoria_cfdi a ON a.company_id = $1 AND a.uuid = t.uuid
      WHERE TRUE ${filtro}
      ORDER BY a.ultima_revision ASC NULLS FIRST
      LIMIT ${limite}`,
    [companyId]
  );

  let revisados = 0;
  let discrepancias = 0;
  let errores = 0;

  for (const c of pendientes.rows) {
    const r = await revisarComprobante(companyId, c);
    revisados++;
    if (r.discrepancia) discrepancias++;
    if (r.error_consulta) errores++;
    /* Pausa entre consultas: el servicio es público y compartido con todo el
     * país. Ir despacio es la diferencia entre auditar y hacer ruido. */
    if (revisados < pendientes.rows.length) {
      await new Promise((res) => setTimeout(res, PAUSA_MS));
    }
  }

  logger.info(
    `[auditoria] empresa ${companyId}: ${revisados} comprobante(s) revisados, ` +
    `${discrepancias} discrepancia(s), ${errores} sin respuesta del SAT`
  );
  return { revisados, discrepancias, errores, pendientesRestantes: Math.max(0, pendientes.rows.length - revisados) };
}

/** Corre la auditoría de TODAS las empresas — es lo que llama el cron. */
export async function correrAuditoriaGlobal(): Promise<any> {
  const empresas = await query<any>(
    `SELECT id, rfc, business_name FROM companies WHERE deleted_at IS NULL`
  );
  const resultados: any[] = [];
  for (const e of empresas.rows) {
    try {
      const r = await correrAuditoria(e.id, { soloPendientes: true });
      resultados.push({ rfc: e.rfc, ...r });
    } catch (err) {
      /* Una empresa que falla no debe dejar sin auditar a las demás. */
      logger.error(`[auditoria] falló la empresa ${e.rfc}: ${(err as Error).message}`);
      resultados.push({ rfc: e.rfc, error: (err as Error).message });
    }
  }
  return resultados;
}

/** Lo que muestra la pantalla: el estado de todo, con las diferencias arriba. */
export async function listarAuditoria(
  companyId: string,
  filtros: { soloDiscrepancias?: boolean; estado?: string; docType?: string } = {}
): Promise<any[]> {
  const params: any[] = [companyId];
  const where = ['a.company_id = $1'];
  if (filtros.soloDiscrepancias) where.push('a.discrepancia = true');
  if (filtros.estado)  { params.push(filtros.estado);  where.push(`a.estado_sat = $${params.length}`); }
  if (filtros.docType) { params.push(filtros.docType); where.push(`a.doc_type = $${params.length}`); }

  const r = await query<any>(
    `SELECT a.*,
            (a.ultima_revision < NOW() - INTERVAL '${HORAS_ENTRE_REVISIONES} hours') AS toca_revisar
       FROM auditoria_cfdi a
      WHERE ${where.join(' AND ')}
      ORDER BY a.discrepancia DESC, a.ultima_revision DESC`,
    params
  );
  return r.rows;
}

/** Tarjetas de la pantalla: el panorama en cinco números. */
export async function resumenAuditoria(companyId: string): Promise<any> {
  const r = await query<any>(
    `SELECT
       COUNT(*)::int                                                          AS revisados,
       COUNT(*) FILTER (WHERE discrepancia)::int                              AS discrepancias,
       COUNT(*) FILTER (WHERE estado_sat = 'Vigente')::int                    AS vigentes,
       COUNT(*) FILTER (WHERE estado_sat = 'Cancelado')::int                  AS cancelados,
       COUNT(*) FILTER (WHERE estatus_cancelacion = 'En proceso')::int        AS esperando_receptor,
       COUNT(*) FILTER (WHERE estado_sat = 'No Encontrado')::int              AS no_encontrados,
       COUNT(*) FILTER (WHERE error_consulta IS NOT NULL)::int                AS sin_respuesta,
       COUNT(*) FILTER (WHERE validacion_efos IS NOT NULL
                          AND validacion_efos <> '100')::int                  AS alerta_efos,
       MAX(ultima_revision)                                                   AS ultima_corrida
     FROM auditoria_cfdi WHERE company_id = $1`,
    [companyId]
  );

  /* Cuántos CFDI existen contra cuántos se han revisado alguna vez: sin este
   * número, una pantalla con "0 discrepancias" puede significar que todo está
   * bien o que no se ha revisado nada. */
  const totalR = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM (${SQL_COMPROBANTES}) t`,
    [companyId]
  );

  return { ...r.rows[0], total_comprobantes: totalR.rows[0].n };
}
