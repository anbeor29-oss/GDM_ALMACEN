/**
 * Script: Seed CFDI and PDF Generation
 * Usage: npm run seed:cfdi
 *
 * Generates CFDI XMLs and PDFs for demo invoices
 */

import { config } from '../src/config/environment';
import { query, closePool } from '../src/config/database';
import * as cfdiService from '../src/modules/cfdi/cfdi.service';
import * as pdfService from '../src/modules/cfdi/pdf.service';
import logger from '../src/middleware/logger';

async function seedCFDI() {
  try {
    logger.info('Seeding CFDI XMLs and PDFs for demo invoices...');

    // Get all demo invoices
    const { rows: invoices } = await query(
      `SELECT id, folio, serie, company_id
       FROM invoices
       WHERE status = 'DRAFT'
       AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 3`
    );

    if (invoices.length === 0) {
      logger.warn('No DRAFT invoices found');
      await closePool();
      process.exit(0);
    }

    logger.info(`Found ${invoices.length} invoices to process`);

    // Process each invoice
    for (const invoice of invoices) {
      try {
        logger.info(`\nProcessing invoice: ${invoice.serie}-${invoice.folio}`);

        // 1. Generate CFDI XML
        logger.info('  → Generating CFDI XML...');
        const xml = await cfdiService.generateCFDIXML({
          companyId: invoice.company_id,
          invoiceId: invoice.id,
        });

        // 2. Validate XML
        const validation = cfdiService.validateCFDIXML(xml);
        if (!validation.valid) {
          logger.error(`  ✗ XML Validation failed: ${validation.errors.join(', ')}`);
          continue;
        }
        logger.info(`  ✅ XML generated (${xml.length} bytes)`);

        // 3. Get CFDI UUID
        const uuid = await cfdiService.getCFDIUUID(invoice.company_id, invoice.id);
        logger.info(`  ✅ CFDI UUID: ${uuid}`);

        // 4. Generate PDF
        logger.info('  → Generating PDF...');
        const pdfBuffer = await pdfService.generateInvoicePDF({
          companyId: invoice.company_id,
          invoiceId: invoice.id,
        });
        logger.info(`  ✅ PDF generated (${pdfBuffer.length} bytes)`);

        // 5. Mark as generated
        await cfdiService.markCFDIGenerated(invoice.company_id, invoice.id);
        logger.info(`  ✅ Marked as CFDI generated`);
      } catch (error) {
        logger.error('Failed to process invoice', {
          invoiceId: invoice.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('');
    logger.info('✅ CFDI and PDF generation completed!');
    logger.info('');
    logger.info('Features demonstrated:');
    logger.info('  ✓ CFDI 4.0 XML generation');
    logger.info('  ✓ SAT Annexo 20 compliance');
    logger.info('  ✓ UUID generation');
    logger.info('  ✓ XML validation');
    logger.info('  ✓ PDF invoice generation');
    logger.info('  ✓ Multi-item support');
    logger.info('');
    logger.info('Next steps:');
    logger.info('  1. Review generated XMLs against SAT specification');
    logger.info('  2. Integrate with PAC for digital signature');
    logger.info('  3. Send signed XMLs to SAT for stamping (timbrado)');

    await closePool();
    process.exit(0);
  } catch (error) {
    logger.error('Error seeding CFDI', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    await closePool();
    process.exit(1);
  }
}

seedCFDI();
