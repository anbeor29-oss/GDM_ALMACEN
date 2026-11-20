/**
 * Reports Controller
 */

import { Request, Response } from 'express';
import * as reportsService from './reports.service';
import { ValidationError } from '../../middleware/errorHandler';

function getCompanyId(req: Request): string {
  if (!req.user?.companyId) {
    throw new ValidationError('Company ID is required');
  }
  return req.user.companyId;
}

function getDateRange(req: Request) {
  return {
    dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
    dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
  };
}

/**
 * GET /api/v1/reports/collections
 * Reporte de cobranza
 */
export async function getCollections(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const report = await reportsService.getCollectionsReport(companyId);

  res.status(200).json({ success: true, data: report });
}

/**
 * GET /api/v1/reports/sales
 * Reporte de ventas
 */
export async function getSales(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const report = await reportsService.getSalesReport(companyId, getDateRange(req));

  res.status(200).json({ success: true, data: report });
}

/**
 * GET /api/v1/reports/sales-detail?year=YYYY&month=MM
 * Reporte de ventas detallado por periodo (mes obligatorio opcional).
 */
export async function getSalesDetail(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const year = parseInt(req.query.year as string, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ValidationError('Parámetro "year" inválido');
  }
  let month: number | undefined;
  if (req.query.month !== undefined && req.query.month !== '') {
    month = parseInt(req.query.month as string, 10);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new ValidationError('Parámetro "month" inválido');
    }
  }
  const report = await reportsService.getSalesDetailReport(companyId, { year, month });
  res.status(200).json({ success: true, data: report });
}

/**
 * GET /api/v1/reports/tax
 * Reporte fiscal
 */
export async function getTax(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const report = await reportsService.getTaxReport(companyId, getDateRange(req));

  res.status(200).json({ success: true, data: report });
}

/**
 * GET /api/v1/reports/status
 * Reporte de estados
 */
export async function getStatus(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const report = await reportsService.getStatusReport(companyId);

  res.status(200).json({ success: true, data: report });
}

/**
 * GET /api/v1/reports/dashboard
 * Métricas del dashboard
 */
export async function getDashboard(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const metrics = await reportsService.getDashboardMetrics(companyId);

  res.status(200).json({ success: true, data: metrics });
}

/**
 * GET /api/v1/reports/receivables?customerId=...
 * Cobranza detallada: facturas con saldo > 0.20 por cliente, con pagos y NC.
 */
export async function getReceivables(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const customerId = (req.query.customerId as string) || undefined;
  const report = await reportsService.getReceivablesReport(companyId, customerId);
  res.status(200).json({ success: true, data: report });
}

/**
 * GET /api/v1/reports/receivables/pdf?customerId=...
 * Mismo reporte pero renderizado como PDF (con paginación X/Y).
 */
export async function getReceivablesPDF(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const customerId = (req.query.customerId as string) || undefined;
  const { generateReceivablesReportPDF } = await import('./receivables-pdf.service');
  const pdf = await generateReceivablesReportPDF(companyId, customerId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="cobranza.pdf"');
  res.send(pdf);
}

/** Filtros comunes del historial de facturas (fecha/cliente). */
function filtrosHistorial(req: Request) {
  return {
    desde: (req.query.desde as string) || undefined,
    hasta: (req.query.hasta as string) || undefined,
    customerId: (req.query.customerId as string) || undefined,
  };
}

/** GET /reports/invoices-history — historial de facturas EMITIDAS por cliente/fecha
 *  con estado de pago (pagada/pendiente/cancelada) + pronóstico por antigüedad. */
export async function getInvoicesHistory(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const { historialFacturas } = await import('./historial-facturas.service');
  const data = await historialFacturas(companyId, filtrosHistorial(req));
  res.status(200).json({ success: true, data });
}

/** GET /reports/invoices-history.xlsx — el mismo historial en Excel (pestaña verde). */
export async function getInvoicesHistoryExcel(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const { historialFacturasExcel } = await import('./historial-facturas.service');
  const { buffer, nombre } = await historialFacturasExcel(companyId, filtrosHistorial(req));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(buffer);
}

/**
 * GET /api/v1/reports/sales-summary
 * Resumen por mes y año: venta, cobrada, no cobrada y adeudo acumulado.
 */
export async function getSalesSummary(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const report = await reportsService.getSalesSummaryReport(companyId);
  res.status(200).json({ success: true, data: report });
}

/**
 * GET /api/v1/reports/sales-summary/pdf
 * El mismo resumen en PDF, inline para verlo en el navegador.
 */
export async function getSalesSummaryPDF(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const { generateSalesSummaryPDF } = await import('./sales-pdf.service');
  const pdf = await generateSalesSummaryPDF(companyId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="resumen-ventas.pdf"');
  res.send(pdf);
}

/**
 * GET /api/v1/reports/unpaid
 * Todas las facturas no pagadas, lista plana, sin importar la antigüedad.
 */
export async function getUnpaid(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const report = await reportsService.getUnpaidInvoicesReport(companyId);
  res.status(200).json({ success: true, data: report });
}

/**
 * GET /api/v1/reports/unpaid/pdf
 * Las facturas no pagadas en PDF, inline para verlo en el navegador.
 */
export async function getUnpaidPDF(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const { generateUnpaidInvoicesPDF } = await import('./sales-pdf.service');
  const pdf = await generateUnpaidInvoicesPDF(companyId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="facturas-no-pagadas.pdf"');
  res.send(pdf);
}

export default {
  getCollections,
  getSales,
  getSalesSummary,
  getSalesSummaryPDF,
  getUnpaid,
  getUnpaidPDF,
  getTax,
  getStatus,
  getDashboard,
  getReceivables,
  getReceivablesPDF,
};
