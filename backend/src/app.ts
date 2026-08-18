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
import teamRoutes from './modules/team/team.routes';
import contractsRoutes, { publicLegalRouter } from './modules/contracts/contracts.routes';
import activityLog from './middleware/activity-log';
import adminUsersRoutes     from './modules/admin/admin-users.routes';
import adminCompaniesRoutes from './modules/admin/admin-companies.routes';
import adminAuditRoutes     from './modules/admin/admin-audit.routes';
import adminBillingRoutes   from './modules/admin/admin-billing.routes';
import adminPrepaidRoutes   from './modules/admin/admin-prepaid.routes';
import adminPromocionRoutes from './modules/admin/admin-promocion.routes';
import manifestRoutes       from './modules/manifest/manifest.routes';
import posRoutes            from './modules/pos/pos.routes';
import cfdiImportRoutes     from './modules/cfdi-import/cfdi-import.routes';
import suppliersRoutes      from './modules/suppliers/suppliers.routes';
import cartaPorteRoutes     from './modules/carta-porte/carta-porte.routes';
import cartaPorteCatalogsRoutes from './modules/carta-porte/carta-porte-catalogs.routes';
import cartaPorteLugaresRoutes from './modules/carta-porte/lugares.routes';
import cartaPorteCatalogosEmpresaRoutes from './modules/carta-porte/catalogos-empresa.routes';
import cartaPorteImportarXmlRoutes from './modules/carta-porte/importar-xml.routes';
import cartaPorteMercanciasRoutes from './modules/carta-porte/mercancias.routes';
import exchangeRateRoutes    from './modules/exchange-rates/exchange-rate.routes';
import fxDifferenceRoutes    from './modules/exchange-rates/fx-difference.routes';
// ─── Portados desde GDM Almacén (fusión ERP, fase 0) ──────────────
import warehousesRoutes      from './modules/warehouses/warehouses.routes';
import inventoryRoutes       from './modules/inventory/inventory.routes';
import inventoryReportsRoutes from './modules/inventory/inventory-reports.routes';
import purchasingRoutes      from './modules/purchasing/purchasing.routes';
import treasuryRoutes        from './modules/treasury/treasury.routes';
import auditoriaRoutes       from './modules/auditoria/auditoria.routes';
import presenciaRoutes       from './modules/presencia/presencia.routes';
import mensajesRoutes        from './modules/mensajes/mensajes.routes';
import satDescargaRoutes     from './modules/sat-descarga/descarga.routes';
import physicalCountRoutes   from './modules/physical-count/physical-count.routes';
import xmlSuperImportRoutes from './modules/xml-super-import/xml-super-import.routes';
import nominaRoutes          from './modules/nomina/nomina.routes';

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
  /* /health dice QUÉ VERSIÓN está viva, no sólo que responde.
   *
   * Sin esto no había forma de saber si el backend traía un cambio o no. Se
   * perdieron días diagnosticando "no veo los cambios" cuando el frontend nuevo
   * hablaba con un backend viejo: la pantalla se veía actualizada y el endpoint
   * devolvía 404, y las dos cosas eran ciertas.
   *
   * Render expone el commit desplegado en RENDER_GIT_COMMIT. En local no
   * existe, así que se dice "local" — que también es información. */
  const versionViva = {
    commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || 'local',
    rama: process.env.RENDER_GIT_BRANCH || '(local)',
    arrancado: new Date().toISOString(),
  };

  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      ...versionViva,
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

  // Bitácora de actividad (cláusula SEXTA del contrato). Va ANTES de las rutas
  // aunque necesite req.user: registra dentro de res.on('finish'), que corre
  // cuando el authenticateToken de cada router ya pobló req.user.
  app.use(`/api/${config.apiVersion}`, activityLog);

  // Documentos legales públicos (SIN auth) — DEBE ir ANTES de mailerRoutes,
  // que se monta en /api/v1 (wildcard) con authenticateToken y bloquearía
  // cualquier request posterior al no encontrar Bearer token.
  app.use(`/api/${config.apiVersion}/legal`, publicLegalRouter);

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
  app.use(`/api/${config.apiVersion}/team`, teamRoutes);
  app.use(`/api/${config.apiVersion}/contract`, contractsRoutes);
  app.use(`/api/${config.apiVersion}/admin/users`,     adminUsersRoutes);
  app.use(`/api/${config.apiVersion}/admin/companies`, adminCompaniesRoutes);
  app.use(`/api/${config.apiVersion}/admin/audit`,     adminAuditRoutes);
  app.use(`/api/${config.apiVersion}/admin/billing`,   adminBillingRoutes);
  app.use(`/api/${config.apiVersion}/admin/prepaid`,   adminPrepaidRoutes);
  app.use(`/api/${config.apiVersion}/admin/promocion`, adminPromocionRoutes);
  app.use(`/api/${config.apiVersion}/manifest`,        manifestRoutes);
  app.use(`/api/${config.apiVersion}/pos`,             posRoutes);
  app.use(`/api/${config.apiVersion}/cfdi-import`,     cfdiImportRoutes);
  app.use(`/api/${config.apiVersion}/suppliers`,       suppliersRoutes);
  // ─── Carta Porte 3.1 + Super Lector XML ────────────────────────────
  app.use(`/api/${config.apiVersion}/carta-porte/lugares`, cartaPorteLugaresRoutes);
  app.use(`/api/${config.apiVersion}/carta-porte`,     cartaPorteCatalogosEmpresaRoutes);
  app.use(`/api/${config.apiVersion}/carta-porte/importar-xml`, cartaPorteImportarXmlRoutes);
  app.use(`/api/${config.apiVersion}/carta-porte/mercancias`, cartaPorteMercanciasRoutes);
  app.use(`/api/${config.apiVersion}/xml-super-import`, xmlSuperImportRoutes);
  app.use(`/api/${config.apiVersion}/carta-porte`,     cartaPorteCatalogsRoutes);
  app.use(`/api/${config.apiVersion}`,                 cartaPorteRoutes);
  // ─── Tipos de cambio (Banxico) ─────────────────────────────────────
  app.use(`/api/${config.apiVersion}/exchange-rates`,  exchangeRateRoutes);
  app.use(`/api/${config.apiVersion}/fx-difference`,   fxDifferenceRoutes);
  // ─── Inventarios, compras y tesorería (fusión ERP) ─────────────────
  app.use(`/api/${config.apiVersion}/warehouses`,      warehousesRoutes);
  // reports ANTES que inventoryRoutes: si no, /inventory/reports/* cae en
  // una ruta genérica del módulo inventory y nunca llega al reporte.
  app.use(`/api/${config.apiVersion}/inventory/reports`, inventoryReportsRoutes);
  app.use(`/api/${config.apiVersion}/inventory`,       inventoryRoutes);
  app.use(`/api/${config.apiVersion}/purchase-orders`, purchasingRoutes);
  app.use(`/api/${config.apiVersion}/treasury`,        treasuryRoutes);
  app.use(`/api/${config.apiVersion}/auditoria`,       auditoriaRoutes);
  app.use(`/api/${config.apiVersion}/presencia`,       presenciaRoutes);
  app.use(`/api/${config.apiVersion}/mensajes`,        mensajesRoutes);
  app.use(`/api/${config.apiVersion}/sat-descarga`,    satDescargaRoutes);
  app.use(`/api/${config.apiVersion}/physical-counts`, physicalCountRoutes);
  app.use(`/api/${config.apiVersion}/nomina`,          nominaRoutes);
  // app.use(`/api/${config.apiVersion}/payments`, paymentRoutes);
  // app.use(`/api/${config.apiVersion}/reports`, reportRoutes);

  // Error handling middleware (must be last)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
