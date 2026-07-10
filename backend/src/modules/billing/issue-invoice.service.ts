/**
 * issue-invoice.service — emisión del CFDI de cobro HCGM → cliente
 * (dogfooding: la plataforma usa su propio ERP para facturar el servicio).
 *
 * Referencia: docs/DISENO_FACTURACION_PLANES.md §10.1 (Decisión #6)
 *
 * Flujo por cargo mensual (monthly_invoicing PENDING con total > 0):
 *   1. Localiza la empresa plataforma (env PLATFORM_COMPANY_RFC).
 *   2. Upsert del cliente en el catálogo de customers de la plataforma
 *      (datos fiscales copiados de `companies` del cliente).
 *   3. Upsert del producto "SERV-TIMBRADO" (ClaveProdServ 81112000,
 *      ClaveUnidad E48 — Unidad de servicio, preset iva16).
 *   4. Crea la factura: 1 concepto con ValorUnitario = total_mxn (el cargo
 *      es "más IVA": el preset agrega el 16% encima).
 *   5. Timbra con el flujo normal (pac.service.stampInvoice → SW real).
 *   6. Guarda invoice_id + folio + uuid en monthly_invoicing → INVOICED.
 *   7. Envía el CFDI por correo al contact_email del cliente (best-effort).
 *
 * En cualquier error: monthly_invoicing.status = 'ERROR' + last_error para
 * que el super-admin reintente desde la UI.
 */

import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import * as invoicesService from '../invoices/invoices.service';
import * as pacService from '../pac/pac.service';
import { sendInvoiceMail } from '../mailer/mailer.service';

const PLATFORM_PRODUCT_SKU = 'SERV-TIMBRADO';

/**
 * RFC de la empresa que emite los CFDIs de cobro (HCGM). Se lee de env
 * para no hardcodear — si no está configurada, la emisión automática se
 * salta silenciosamente (el cierre igual genera los cargos PENDING).
 */
function platformRfc(): string | null {
  return process.env.PLATFORM_COMPANY_RFC?.trim().toUpperCase() || null;
}

interface PlatformCompany {
  id: string;
  rfc: string;
  business_name: string;
}

async function getPlatformCompany(): Promise<PlatformCompany | null> {
  const rfc = platformRfc();
  if (!rfc) return null;
  const r = await query<PlatformCompany>(
    `SELECT id, rfc, business_name FROM companies WHERE rfc = $1`,
    [rfc]
  );
  return r.rows[0] || null;
}

/**
 * Upsert del cliente (la empresa que paga) dentro del catálogo de customers
 * de la plataforma. Devuelve el customer_id.
 */
async function upsertPlatformCustomer(
  platformCompanyId: string,
  client: { rfc: string; business_name: string; fiscal_regime: string | null; postal_code: string | null; contact_email: string | null }
): Promise<string> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM customers
      WHERE company_id = $1 AND rfc = $2 AND deleted_at IS NULL`,
    [platformCompanyId, client.rfc]
  );
  if (existing.rows.length > 0) {
    // Refresca email si cambió (para que el envío llegue al contacto actual)
    if (client.contact_email) {
      await query(
        `UPDATE customers SET email = COALESCE($3, email), updated_at = NOW()
          WHERE id = $1 AND company_id = $2`,
        [existing.rows[0].id, platformCompanyId, client.contact_email]
      );
    }
    return existing.rows[0].id;
  }

  const ins = await query<{ id: string }>(
    `INSERT INTO customers
       (company_id, rfc, business_name, fiscal_regime, default_cfdi_use,
        postal_code, email, is_active)
     VALUES ($1, $2, $3, $4, 'G03', $5, $6, true)
     RETURNING id`,
    [
      platformCompanyId,
      client.rfc,
      client.business_name,
      client.fiscal_regime || '601',
      client.postal_code || '00000',
      client.contact_email || null,
    ]
  );
  logger.info(`Platform customer creado: ${client.rfc} → ${ins.rows[0].id}`);
  return ins.rows[0].id;
}

/**
 * Upsert del producto de servicio de timbrado en el catálogo de la plataforma.
 * ClaveProdServ 81112000 = "Servicios de datos en línea", la clave usual para
 * servicios de facturación electrónica. Unidad E48 = "Unidad de servicio".
 */
async function upsertPlatformProduct(platformCompanyId: string): Promise<string> {
  const existing = await query<{ id: string }>(
    `SELECT id FROM products
      WHERE company_id = $1 AND sku = $2 AND deleted_at IS NULL`,
    [platformCompanyId, PLATFORM_PRODUCT_SKU]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const ins = await query<{ id: string }>(
    `INSERT INTO products
       (company_id, sku, name, description, clave_sat, unit_code, unit_name,
        base_price, tax_type, tax_rate, tax_preset_id, is_active)
     VALUES ($1, $2, 'Servicio de facturación electrónica',
             'Renta mensual y timbres CFDI 4.0 según plan contratado',
             '81112000', 'E48', 'Unidad de servicio',
             0, 'IVA', 0.16, 'iva16', true)
     RETURNING id`,
    [platformCompanyId, PLATFORM_PRODUCT_SKU]
  );
  logger.info(`Platform product creado: ${PLATFORM_PRODUCT_SKU} → ${ins.rows[0].id}`);
  return ins.rows[0].id;
}

export interface IssueResult {
  invoicingId: string;
  status: 'INVOICED' | 'ERROR' | 'SKIPPED';
  detail: string;
  invoiceFolio?: string;
  invoiceUuid?: string;
}

/**
 * Emite y timbra el CFDI de cobro para UN cargo mensual.
 * Idempotente: si el cargo ya está INVOICED/PAID, no re-emite.
 */
export async function issuePlatformInvoice(invoicingId: string): Promise<IssueResult> {
  // 1) Cargar el cargo + datos del cliente
  const miR = await query<any>(
    `SELECT mi.*, c.rfc AS client_rfc, c.business_name AS client_name,
            c.fiscal_regime AS client_regime, c.postal_code AS client_cp,
            c.contact_email AS client_email
       FROM monthly_invoicing mi
       JOIN companies c ON c.id = mi.company_id
      WHERE mi.id = $1`,
    [invoicingId]
  );
  const mi = miR.rows[0];
  if (!mi) throw new ValidationError('Cargo mensual no encontrado');

  if (mi.status === 'INVOICED' || mi.status === 'PAID') {
    return {
      invoicingId, status: 'SKIPPED',
      detail: `Ya tiene CFDI emitido (${mi.invoice_folio || mi.invoice_uuid || 'ref registrada'})`,
    };
  }
  if (Number(mi.total_mxn) <= 0) {
    return { invoicingId, status: 'SKIPPED', detail: 'Total 0 — no se emite CFDI' };
  }

  // 2) Empresa plataforma
  const platform = await getPlatformCompany();
  if (!platform) {
    return {
      invoicingId, status: 'SKIPPED',
      detail: 'PLATFORM_COMPANY_RFC no configurado o la empresa no existe — emisión manual',
    };
  }
  if (platform.id === mi.company_id) {
    return { invoicingId, status: 'SKIPPED', detail: 'La plataforma no se factura a sí misma' };
  }

  const periodLabel = new Date(mi.billing_period).toISOString().slice(0, 7); // YYYY-MM

  try {
    // 3) Upserts
    const customerId = await upsertPlatformCustomer(platform.id, {
      rfc: mi.client_rfc,
      business_name: mi.client_name,
      fiscal_regime: mi.client_regime,
      postal_code: mi.client_cp,
      contact_email: mi.client_email,
    });
    const productId = await upsertPlatformProduct(platform.id);

    // 4) Crear factura — 1 concepto, precio = total (más IVA vía preset iva16)
    const desc =
      `Servicio de facturación electrónica ${periodLabel} — plan ${mi.package_code}` +
      (Number(mi.stamps_extra) > 0
        ? ` (incluye ${mi.stamps_extra} timbres extra)`
        : '');
    const invoice = await invoicesService.createInvoice(platform.id, {
      customerId,
      cfdiType: 'I',
      paymentForm: '99',        // Por definir — se ajusta al cobrar
      paymentMethod: 'PPD',     // obliga complemento de pago al cobrar
      cfdiUse: 'G03',
      items: [{
        productId,
        quantity: 1,
        unitPrice: Number(mi.total_mxn),
        taxPresetId: 'iva16',
        description: desc,
      } as any],
    });

    // 5) Timbrar con el flujo normal (SW real si está configurado)
    const stamp = await pacService.stampInvoice(platform.id, invoice.id);
    const folio = `${invoice.serie || 'FAC'}-${String(invoice.folio).padStart(6, '0')}`;

    // 6) Actualizar el cargo → INVOICED
    await query(
      `UPDATE monthly_invoicing
          SET status = 'INVOICED',
              invoice_id = $2,
              invoice_folio = $3,
              invoice_uuid = $4,
              last_error = NULL
        WHERE id = $1`,
      [invoicingId, invoice.id, folio, stamp.uuid || null]
    );

    // 7) Correo al cliente (best-effort — no revierte la emisión si falla)
    if (mi.client_email) {
      try {
        await sendInvoiceMail({
          companyId: platform.id,
          to: mi.client_email,
          subject: `Cargo del mes ${periodLabel} — ${platform.business_name}`,
          message:
            `Adjuntamos la factura por el servicio de facturación electrónica ` +
            `del período ${periodLabel}.\n\n` +
            `Plan: ${mi.package_code}\n` +
            `Timbres usados: ${mi.stamps_used}` +
            (Number(mi.stamps_extra) > 0 ? ` (${mi.stamps_extra} extra)` : '') + `\n` +
            `Total: $${Number(mi.total_mxn).toFixed(2)} + IVA\n\n` +
            `Quedamos atentos a cualquier duda.`,
          attachments: [
            { kind: 'invoice_pdf', id: invoice.id },
            { kind: 'invoice_xml', id: invoice.id },
          ],
        });
      } catch (mailErr) {
        logger.warn(
          `CFDI ${folio} emitido pero el correo a ${mi.client_email} falló: ` +
          `${(mailErr as Error).message}`
        );
      }
    }

    logger.info(
      `CFDI de cobro emitido: ${folio} (${stamp.uuid}) → ${mi.client_rfc} por ` +
      `$${Number(mi.total_mxn).toFixed(2)} + IVA [${periodLabel}]`
    );
    return {
      invoicingId, status: 'INVOICED',
      detail: `CFDI ${folio} timbrado y enviado`,
      invoiceFolio: folio,
      invoiceUuid: stamp.uuid,
    };
  } catch (e) {
    const msg = (e as Error).message || 'Error desconocido al emitir CFDI';
    await query(
      `UPDATE monthly_invoicing SET status = 'ERROR', last_error = $2 WHERE id = $1`,
      [invoicingId, msg.slice(0, 2000)]
    );
    logger.error(`Emisión CFDI de cobro falló para ${invoicingId}: ${msg}`);
    return { invoicingId, status: 'ERROR', detail: msg };
  }
}

/**
 * Emite los CFDIs de todos los cargos PENDING (o ERROR, para reintentos
 * masivos) de un período. Procesa secuencialmente para no saturar al PAC.
 */
export async function issueAllForPeriod(periodStr: string): Promise<IssueResult[]> {
  const pending = await query<{ id: string }>(
    `SELECT id FROM monthly_invoicing
      WHERE billing_period = $1
        AND status IN ('PENDING', 'ERROR')
        AND total_mxn > 0
      ORDER BY generated_at`,
    [periodStr]
  );

  const results: IssueResult[] = [];
  for (const row of pending.rows) {
    results.push(await issuePlatformInvoice(row.id));
  }
  logger.info(
    `issueAllForPeriod ${periodStr}: ${results.filter(r => r.status === 'INVOICED').length} emitidos, ` +
    `${results.filter(r => r.status === 'ERROR').length} errores, ` +
    `${results.filter(r => r.status === 'SKIPPED').length} skipped`
  );
  return results;
}
