/**
 * Express Application Setup
 * Configures middleware and routes
 */

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { config } from './config/environment';
import logger from './middleware/logger';
import {
  errorHandler,
  notFoundHandler,
  asyncHandler,
} from './middleware/errorHandler';

// Module routes
import authRoutes from './modules/auth/auth.routes';
import companiesRoutes from './modules/companies/companies.routes';
import companiesUploadsRoutes, { publicLogoRouter } from './modules/companies/companies-uploads.routes';
import customersRoutes from './modules/customers/customers.routes';
import productsRoutes from './modules/products/products.routes';
import productsImportRoutes from './modules/products/products-import.routes';
import invoicesRoutes from './modules/invoices/invoices.routes';
import cfdiRoutes from './modules/cfdi/cfdi.routes';
import cfdiParserRoutes from './modules/cfdi-parser/cfdi-parser.routes';
import satValidatorRoutes from './modules/sat-validator/sat-validator.routes';
import reportsRoutes from './modules/reports/reports.routes';
import pacRoutes from './modules/pac/pac.routes';
import catalogsRoutes from './modules/catalogs/catalogs.routes';
import csfRoutes from './modules/csf/csf.routes';
import mailerRoutes from './modules/mailer/mailer.routes';
import paymentsRoutes from './modules/payments/payments.routes';
import creditNotesRoutes from './modules/credit-notes/credit-notes.routes';
import archiveRoutes from './modules/archive/archive.routes';
import adminUsersRoutes     from './modules/admin/admin-users.routes';
import adminCompaniesRoutes from './modules/admin/admin-companies.routes';
import adminAuditRoutes     from './modules/admin/admin-audit.routes';
import adminBillingRoutes   from './modules/admin/admin-billing.routes';
import adminPrepaidRoutes   from './modules/admin/admin-prepaid.routes';
import manifestRoutes       from './modules/manifest/manifest.routes';
import cfdiImportRoutes     from './modules/cfdi-import/cfdi-import.routes';
import suppliersRoutes      from './modules/suppliers/suppliers.routes';
import warehousesRoutes     from './modules/warehouses/warehouses.routes';
import inventoryRoutes      from './modules/inventory/inventory.routes';
import inventoryReportsRoutes from './modules/inventory/inventory-reports.routes';
import purchasingRoutes     from './modules/purchasing/purchasing.routes';
import posRoutes            from './modules/pos/pos.routes';
import treasuryRoutes       from './modules/treasury/treasury.routes';
import physicalCountRoutes  from './modules/physical-count/physical-count.routes';
import teamRoutes           from './modules/team/team.routes';
import cartaPorteRoutes     from './modules/carta-porte/carta-porte.routes';
import cartaPorteCatalogsRoutes from './modules/carta-porte/carta-porte-catalogs.routes';
import cartaPorteLugaresRoutes from './modules/carta-porte/lugares.routes';
import cartaPorteCatalogosEmpresaRoutes from './modules/carta-porte/catalogos-empresa.routes';
import cartaPorteImportarXmlRoutes from './modules/carta-porte/importar-xml.routes';

export function createApp(): Express {
  const app = express();

  // Middleware: Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  // Middleware: CORS
  app.use(
    cors({
      origin: config.cors.origin,
      credentials: config.cors.credentials,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Middleware: Request logging
  app.use((req: Request, res: Response, next) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.http(
        `${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`
      );
    });

    next();
  });

  // Routes: Health check
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Routes: API version
  app.get(`/api/${config.apiVersion}`, (req: Request, res: Response) => {
    res.json({
      name: config.appName,
      version: '0.1.0',
      apiVersion: config.apiVersion,
      environment: config.nodeEnv,
      status: 'running',
    });
  });

  // Routes: API info (temporary, for testing)
  app.get(`/api/${config.apiVersion}/health`, (req: Request, res: Response) => {
    res.json({
      status: 'OK',
      service: 'Backend API',
      timestamp: new Date().toISOString(),
      apiVersion: config.apiVersion,
    });
  });

  // Module routes
  // TODO: Add more routes as modules are created
  // import customerRoutes from './modules/customers/customers.routes';
  // import productRoutes from './modules/products/products.routes';
  // import invoiceRoutes from './modules/invoices/invoices.routes';
  // import paymentRoutes from './modules/payments/payments.routes';
  // import reportRoutes from './modules/reports/reports.routes';

  app.use(`/api/${config.apiVersion}/auth`, authRoutes);
  // Uploads de CSD + logo (montar ANTES de companiesRoutes para que /:id/csd
  // y /:id/logo se matcheen antes de /:id genérico).
  app.use(`/api/${config.apiVersion}/companies`, companiesUploadsRoutes);
  app.use(`/api/${config.apiVersion}/companies`, companiesRoutes);
  // Logo público (para <img src>): /public/companies/:id/logo
  app.use(`/api/${config.apiVersion}/public/companies`, publicLogoRouter);
  app.use(`/api/${config.apiVersion}/customers`, customersRoutes);
  // OJO: products-import debe ir ANTES de productsRoutes para que /products/import-xml
  // se matchee antes de la ruta /:id de products.
  app.use(`/api/${config.apiVersion}/products`, productsImportRoutes);
  app.use(`/api/${config.apiVersion}/products`, productsRoutes);
  app.use(`/api/${config.apiVersion}/invoices`, invoicesRoutes);
  app.use(`/api/${config.apiVersion}/cfdi`, cfdiRoutes);
  app.use(`/api/${config.apiVersion}/cfdi-parser`, cfdiParserRoutes);
  app.use(`/api/${config.apiVersion}/sat-validator`, satValidatorRoutes);
  app.use(`/api/${config.apiVersion}/reports`, reportsRoutes);
  app.use(`/api/${config.apiVersion}/pac`, pacRoutes);
  app.use(`/api/${config.apiVersion}/catalogs`, catalogsRoutes);
  app.use(`/api/${config.apiVersion}/csf`, csfRoutes);
  // Mailer expone POST /invoices/:id/send-email — se monta en la raíz para
  // que la ruta llegue sin conflicto con el módulo de invoices.
  app.use(`/api/${config.apiVersion}`, mailerRoutes);
  app.use(`/api/${config.apiVersion}/payments`, paymentsRoutes);
  app.use(`/api/${config.apiVersion}/credit-notes`, creditNotesRoutes);
  app.use(`/api/${config.apiVersion}/archive`, archiveRoutes);
  app.use(`/api/${config.apiVersion}/admin/users`,     adminUsersRoutes);
  app.use(`/api/${config.apiVersion}/admin/companies`, adminCompaniesRoutes);
  app.use(`/api/${config.apiVersion}/admin/audit`,     adminAuditRoutes);
  app.use(`/api/${config.apiVersion}/admin/billing`,   adminBillingRoutes);
  app.use(`/api/${config.apiVersion}/admin/prepaid`,   adminPrepaidRoutes);
  app.use(`/api/${config.apiVersion}/manifest`,        manifestRoutes);
  app.use(`/api/${config.apiVersion}/cfdi-import`,     cfdiImportRoutes);
  app.use(`/api/${config.apiVersion}/suppliers`,       suppliersRoutes);
  app.use(`/api/${config.apiVersion}/warehouses`,      warehousesRoutes);
  // OJO: reports antes que inventoryRoutes para que /inventory/reports/* no
  // caiga en rutas genéricas del módulo inventory.
  app.use(`/api/${config.apiVersion}/inventory/reports`, inventoryReportsRoutes);
  app.use(`/api/${config.apiVersion}/inventory`,       inventoryRoutes);
  app.use(`/api/${config.apiVersion}/purchase-orders`, purchasingRoutes);
  app.use(`/api/${config.apiVersion}/pos`,             posRoutes);
  app.use(`/api/${config.apiVersion}/treasury`,        treasuryRoutes);
  app.use(`/api/${config.apiVersion}/physical-counts`, physicalCountRoutes);
  app.use(`/api/${config.apiVersion}/team`,            teamRoutes);
  // Carta Porte 3.1 — sub-recurso de invoices, montado bajo /api/v1
  app.use(`/api/${config.apiVersion}/carta-porte/lugares`, cartaPorteLugaresRoutes);
  app.use(`/api/${config.apiVersion}/carta-porte`,     cartaPorteCatalogosEmpresaRoutes);
  app.use(`/api/${config.apiVersion}/carta-porte/importar-xml`, cartaPorteImportarXmlRoutes);
  app.use(`/api/${config.apiVersion}/carta-porte`,     cartaPorteCatalogsRoutes);
  app.use(`/api/${config.apiVersion}`,                 cartaPorteRoutes);
  // app.use(`/api/${config.apiVersion}/payments`, paymentRoutes);
  // app.use(`/api/${config.apiVersion}/reports`, reportRoutes);

  // Error handling middleware (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
