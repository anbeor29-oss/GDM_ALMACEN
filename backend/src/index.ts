/**
 * Application Entry Point
 * Initializes and starts the server
 */

import { config } from './config/environment';
import { initRedis, closeRedis } from './config/redis';
import { checkConnection, closePool } from './config/database';
import createApp from './app';
import logger from './middleware/logger';

async function bootstrap() {
  try {
    logger.info(`Starting ${config.appName}...`);
    logger.info(`Environment: ${config.nodeEnv}`);
    logger.info(`API Version: ${config.apiVersion}`);

    // Check database connection
    logger.info('Checking database connection...');
    const dbConnected = await checkConnection();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }

    // Initialize Redis
    logger.info('Initializing Redis...');
    await initRedis();

    // Pre-cargar índice del catálogo SAT c_ClaveProdServ en memoria
    try {
      const { warmup } = await import('./modules/products/clave-prodserv-index');
      warmup();
    } catch (e: any) {
      logger.warn(`No se pudo precargar c_ClaveProdServ: ${e.message}`);
    }

    // Create Express app
    const app = createApp();

    // Start server
    const server = app.listen(config.appPort, () => {
      logger.info(`✅ Backend running on http://localhost:${config.appPort}`);
      logger.info(`📚 API Docs: http://localhost:${config.appPort}/api/docs`);
      logger.info(`🏥 Health Check: http://localhost:${config.appPort}/health`);
    });

    // Cron de cierre mensual (solo si ENABLE_BILLING_CRON=true)
    try {
      const { registerBillingCron } = await import('./jobs/billing-cron');
      registerBillingCron();
    } catch (e: any) {
      logger.warn(`No se pudo registrar billing-cron: ${e.message}`);
    }

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);

      server.close(async () => {
        try {
          await closeRedis();
          await closePool();
          logger.info('✅ Server shut down successfully');
          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          process.exit(1);
        }
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('⚠️ Forcing shutdown after 10 seconds...');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Unhandled promise rejection
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', {
        promise: String(promise),
        reason: reason instanceof Error ? reason.message : String(reason),
      });
    });

    // Uncaught exception
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', {
        message: error.message,
        stack: error.stack,
      });
      process.exit(1);
    });
  } catch (error) {
    logger.error('Bootstrap failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Run bootstrap
bootstrap();

export default bootstrap;
