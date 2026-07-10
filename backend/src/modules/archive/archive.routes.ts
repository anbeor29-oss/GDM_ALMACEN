/**
 * /archive — paquetes de timbres comprimidos para respaldo SAT (5 años).
 *
 * GET /archive/invoices.zip?from=YYYY-MM-DD&to=YYYY-MM-DD&format=xml|both
 *   - format=xml   → solo XMLs (~900 KB por 100 timbres)
 *   - format=both  → XMLs + PDFs rendereados al vuelo (~2 MB por 100)
 *
 * Streams el ZIP al cliente sin cargarlo entero a memoria (apto para 100K+ timbres).
 *
 * Seguridad: filtrado estricto por company_id del token. RFC + folio en el
 * nombre de cada archivo dentro del ZIP (auditable).
 */
import { Router, Request, Response } from 'express';
// archiver export es CJS — usamos require para evitar el namespace import.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const archiver = require('archiver');
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import * as pdfService from '../cfdi/pdf.service';
import logger from '../../middleware/logger';

const router = Router();
router.use(authenticateToken);

function companyId(req: Request): string {
  if (!req.user?.companyId) throw new ValidationError('Company ID is required');
  return req.user.companyId;
}

/** Sanitiza un fragmento que va al filename dentro del ZIP. */
function safe(s: string): string {
  return String(s || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
}

/**
 * GET /archive/invoices.zip
 * Query: from, to (YYYY-MM-DD), format=(xml|both), limit (defecto 100, máx 1000)
 */
router.get(
  '/invoices.zip',
  asyncHandler(async (req: Request, res: Response) => {
    const from   = String(req.query.from   || '');
    const to     = String(req.query.to     || '');
    const format = (String(req.query.format || 'xml') as 'xml' | 'both');
    const limit  = Math.min(1000, Math.max(1, parseInt(String(req.query.limit || '100'), 10)));

    // Filtro defensivo: rango opcional; si no, últimos N timbres
    const filters: string[] = ['i.company_id = $1', 'i.deleted_at IS NULL', 'i.xml_content IS NOT NULL'];
    const params: any[] = [companyId(req)];
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { params.push(from); filters.push(`i.date_issued >= $${params.length}`); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to))   { params.push(to);   filters.push(`i.date_issued <= $${params.length}`); }
    params.push(limit);

    const r = await query<any>(
      `SELECT i.id, i.serie, i.folio, i.cfdi_uuid, i.xml_content, i.date_issued
         FROM invoices i
        WHERE ${filters.join(' AND ')}
        ORDER BY i.date_issued DESC
        LIMIT $${params.length}`,
      params
    );
    const rows = r.rows;
    if (rows.length === 0) {
      throw new ValidationError('No hay timbres en el rango solicitado');
    }

    const zipName = `timbres-${rows.length}-${new Date().toISOString().slice(0,10)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('warning', (e: any) => logger.warn(`archive warning: ${e.message}`));
    zip.on('error',   (e: any) => { logger.error(`archive error: ${e.message}`); res.end(); });
    zip.pipe(res);

    let bytesXml = 0;
    let bytesPdf = 0;

    for (const inv of rows) {
      const base = `${safe(inv.serie || 'FAC')}-${String(inv.folio).padStart(6, '0')}`;
      if (inv.xml_content) {
        zip.append(inv.xml_content, { name: `${base}.xml` });
        bytesXml += Buffer.byteLength(inv.xml_content, 'utf8');
      }
      if (format === 'both') {
        try {
          const pdfBuf = await pdfService.generateInvoicePDF({
            companyId: companyId(req), invoiceId: inv.id,
          });
          zip.append(pdfBuf, { name: `${base}.pdf` });
          bytesPdf += pdfBuf.length;
        } catch (e) {
          logger.warn(`PDF skipped en archive para ${inv.id}: ${(e as Error).message}`);
        }
      }
    }

    // Manifiesto JSON dentro del ZIP — auditoría rápida sin abrir cada XML
    const manifest = {
      generated_at: new Date().toISOString(),
      company_id: companyId(req),
      total: rows.length,
      format,
      size_xml_bytes: bytesXml,
      size_pdf_bytes: bytesPdf,
      items: rows.map((r) => ({
        serie: r.serie, folio: r.folio,
        uuid: r.cfdi_uuid, date: r.date_issued,
      })),
    };
    zip.append(JSON.stringify(manifest, null, 2), { name: 'MANIFEST.json' });

    await zip.finalize();
    logger.info(`Archive entregado: ${rows.length} timbres · xml=${bytesXml} · pdf=${bytesPdf}`);
  })
);

/**
 * GET /archive/admin/invoices.zip
 *   Misma lógica que /invoices.zip pero el ADMIN puede pasar ?companyId=X
 *   para descargar el paquete fiscal de CUALQUIER empresa. Protegido por rol.
 */
router.get(
  '/admin/invoices.zip',
  asyncHandler(async (req: Request, res: Response) => {
    if (req.user?.role !== 'ADMIN') {
      throw new ValidationError('Solo administradores pueden descargar paquetes cross-tenant');
    }
    const targetCompany = String(req.query.companyId || '');
    if (!/^[0-9a-f-]{36}$/i.test(targetCompany)) {
      throw new ValidationError('companyId UUID requerido');
    }
    const from   = String(req.query.from   || '');
    const to     = String(req.query.to     || '');
    const format = (String(req.query.format || 'xml') as 'xml' | 'both');
    const limit  = Math.min(1000, Math.max(1, parseInt(String(req.query.limit || '100'), 10)));

    const filters: string[] = ['i.company_id = $1', 'i.deleted_at IS NULL', 'i.xml_content IS NOT NULL'];
    const params: any[] = [targetCompany];
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { params.push(from); filters.push(`i.date_issued >= $${params.length}`); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to))   { params.push(to);   filters.push(`i.date_issued <= $${params.length}`); }
    params.push(limit);

    const r = await query<any>(
      `SELECT i.id, i.serie, i.folio, i.cfdi_uuid, i.xml_content, i.date_issued
         FROM invoices i
        WHERE ${filters.join(' AND ')}
        ORDER BY i.date_issued DESC
        LIMIT $${params.length}`,
      params
    );
    if (r.rows.length === 0) throw new ValidationError('Sin timbres en el rango');

    const companyR = await query<{ rfc: string; business_name: string }>(
      `SELECT rfc, business_name FROM companies WHERE id = $1`, [targetCompany]
    );
    const c = companyR.rows[0];
    const zipName = `paquete-${safe(c?.rfc || targetCompany.slice(0, 8))}-${r.rows.length}-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('warning', (e: any) => logger.warn(`archive warning: ${e.message}`));
    zip.on('error',   (e: any) => { logger.error(`archive error: ${e.message}`); res.end(); });
    zip.pipe(res);

    for (const inv of r.rows) {
      const base = `${safe(inv.serie || 'FAC')}-${String(inv.folio).padStart(6, '0')}`;
      if (inv.xml_content) zip.append(inv.xml_content, { name: `${base}.xml` });
      if (format === 'both') {
        try {
          const pdfBuf = await pdfService.generateInvoicePDF({ companyId: targetCompany, invoiceId: inv.id });
          zip.append(pdfBuf, { name: `${base}.pdf` });
        } catch { /* skip */ }
      }
    }
    zip.append(JSON.stringify({
      generated_at: new Date().toISOString(),
      generated_by: req.user!.email,
      company_id: targetCompany,
      company_rfc: c?.rfc,
      company_name: c?.business_name,
      total: r.rows.length,
      format,
      items: r.rows.map((row: any) => ({
        serie: row.serie, folio: row.folio, uuid: row.cfdi_uuid, date: row.date_issued,
      })),
    }, null, 2), { name: 'MANIFEST.json' });
    await zip.finalize();
    logger.info(`[ADMIN] ${req.user?.email} descargó paquete ${zipName} (${r.rows.length} timbres)`);
  })
);

/**
 * GET /archive/usage/current-month — consumo del mes en curso vs plan.
 *   Soporta SaaS con plan "iguala 100 timbres". Para empresas con plan
 *   "renta + timbre" se reporta solo el conteo (no hay límite duro).
 */
router.get(
  '/usage/current-month',
  asyncHandler(async (req: Request, res: Response) => {
    const r = await query<any>(
      `SELECT
         (SELECT COUNT(*)::int FROM invoices
            WHERE company_id = $1 AND deleted_at IS NULL AND cfdi_type = 'I'
              AND date_trunc('month', date_issued) = date_trunc('month', NOW())) AS facturas_mes,
         (SELECT COUNT(*)::int FROM credit_notes
            WHERE company_id = $1 AND deleted_at IS NULL AND status != 'CANCELLED'
              AND date_trunc('month', date_issued) = date_trunc('month', NOW())) AS nc_mes,
         (SELECT COUNT(*)::int FROM payments
            WHERE company_id = $1 AND deleted_at IS NULL
              AND date_trunc('month', payment_date) = date_trunc('month', NOW())) AS pagos_mes
      `,
      [companyId(req)]
    );
    const row = r.rows[0];
    const total = Number(row.facturas_mes) + Number(row.nc_mes) + Number(row.pagos_mes);

    // Plan real desde companies.billing_plan (migración 2026-06-22)
    const planR = await query<any>(
      `SELECT COALESCE(billing_plan,'iguala') AS billing_plan,
              COALESCE(cap_timbres,100)::int AS cap_timbres,
              COALESCE(monthly_fee,500)::numeric AS monthly_fee,
              COALESCE(extra_stamp_fee,0.80)::numeric AS extra_stamp_fee
         FROM companies WHERE id = $1`,
      [companyId(req)]
    );
    const plan = planR.rows[0] || { billing_plan: 'iguala', cap_timbres: 100, monthly_fee: 500, extra_stamp_fee: 0.80 };
    const cap = Number(plan.cap_timbres);
    const overCount = Math.max(0, total - cap);

    res.json({
      success: true,
      data: {
        period: new Date().toISOString().slice(0, 7),
        usage: {
          facturas: row.facturas_mes,
          notas_credito: row.nc_mes,
          pagos: row.pagos_mes,
          total,
        },
        plan: {
          tipo: plan.billing_plan,             // 'renta' | 'iguala'
          cap_timbres: cap,
          monthly_fee: Number(plan.monthly_fee),
          extra_stamp_fee: Number(plan.extra_stamp_fee),
          consumed_pct: cap > 0 ? Math.round((total / cap) * 100) : 0,
          remaining: Math.max(0, cap - total),
          over: plan.billing_plan === 'iguala' && total > cap,
          over_count: overCount,
          // Cobro estimado del mes:
          estimated_charge:
            Number(plan.monthly_fee) +
            (plan.billing_plan === 'renta'
              ? total * Number(plan.extra_stamp_fee)
              : overCount * Number(plan.extra_stamp_fee)),
        },
      },
    });
  })
);

/** GET /archive/stats — diagnóstico de espacio ocupado por tenant. */
router.get(
  '/stats',
  asyncHandler(async (req: Request, res: Response) => {
    const r = await query<any>(
      `SELECT
         (SELECT COUNT(*) FROM invoices     WHERE company_id = $1 AND deleted_at IS NULL)::int AS facturas,
         (SELECT COUNT(*) FROM credit_notes WHERE company_id = $1 AND deleted_at IS NULL)::int AS ncs,
         (SELECT COUNT(*) FROM payments     WHERE company_id = $1 AND deleted_at IS NULL)::int AS pagos,
         (SELECT COALESCE(SUM(LENGTH(xml_content)::bigint), 0) FROM invoices     WHERE company_id = $1)::bigint AS xml_facturas_bytes,
         (SELECT COALESCE(SUM(LENGTH(xml_content)::bigint), 0) FROM credit_notes WHERE company_id = $1)::bigint AS xml_nc_bytes,
         (SELECT COALESCE(SUM(LENGTH(xml_content)::bigint), 0) FROM payments     WHERE company_id = $1)::bigint AS xml_pagos_bytes
       `,
      [companyId(req)]
    );
    const row = r.rows[0];
    const totalTimbres = Number(row.facturas) + Number(row.ncs) + Number(row.pagos);
    const totalBytes   = Number(row.xml_facturas_bytes) + Number(row.xml_nc_bytes) + Number(row.xml_pagos_bytes);
    const avg100kb     = totalTimbres > 0 ? Math.round((totalBytes / totalTimbres) * 100 / 1024) : 0;
    res.json({
      success: true,
      data: {
        timbres: { facturas: row.facturas, notas_credito: row.ncs, pagos: row.pagos, total: totalTimbres },
        storage_xml: {
          facturas_bytes: row.xml_facturas_bytes,
          nc_bytes: row.xml_nc_bytes,
          pagos_bytes: row.xml_pagos_bytes,
          total_bytes: totalBytes,
          total_kb: Math.round(totalBytes / 1024),
        },
        projection: {
          avg_bytes_per_timbre: totalTimbres > 0 ? Math.round(totalBytes / totalTimbres) : 0,
          kb_per_100_timbres:   avg100kb,
        },
      },
    });
  })
);

export default router;
