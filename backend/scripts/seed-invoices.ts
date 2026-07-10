/**
 * Script: Seed Demo Invoices
 * Usage: npm run seed:invoices
 */

import { config } from '../src/config/environment';
import { query, closePool } from '../src/config/database';
import * as companiesService from '../src/modules/companies/companies.service';
import * as customersService from '../src/modules/customers/customers.service';
import * as productsService from '../src/modules/products/products.service';
import * as invoicesService from '../src/modules/invoices/invoices.service';
import logger from '../src/middleware/logger';

async function seedInvoices() {
  try {
    logger.info('Seeding demo invoices with automatic calculations...');

    // Get company
    let company;
    try {
      company = await companiesService.getCompanyByRFC('ABC010101ABC');
    } catch {
      logger.warn('ACME company not found, skipping invoices');
      await closePool();
      process.exit(0);
    }

    // Get first customer
    const { customers } = await customersService.listCustomers(company.id, { limit: 1, offset: 0 });
    if (customers.length === 0) {
      logger.warn('No customers found, skipping invoices');
      await closePool();
      process.exit(0);
    }
    const customer = customers[0];

    // Get products
    const { products } = await productsService.listProducts(company.id, { limit: 5, offset: 0 });
    if (products.length === 0) {
      logger.warn('No products found, skipping invoices');
      await closePool();
      process.exit(0);
    }

    logger.info(`Creating invoices for customer: ${customer.business_name}`);
    logger.info(`Using products: ${products.map((p: any) => p.name).join(', ')}`);

    // Create 3 demo invoices
    const invoiceData = [
      {
        date: new Date('2026-06-01'),
        items: [
          { productId: products[0].id, quantity: 2 },
          { productId: products[1].id, quantity: 1 },
        ],
      },
      {
        date: new Date('2026-06-10'),
        items: [
          { productId: products[2].id, quantity: 3 },
        ],
      },
      {
        date: new Date('2026-06-20'),
        items: [
          { productId: products[3].id, quantity: 1 },
          { productId: products[4].id, quantity: 2 },
        ],
      },
    ];

    for (const invoiceReq of invoiceData) {
      try {
        const invoice = await invoicesService.createInvoice(company.id, {
          customerId: customer.id,
          cfdiType: 'I',
          paymentForm: '01',
          paymentMethod: 'PUE',
          cfdiUse: 'G01',
          items: invoiceReq.items,
          paymentTerms: '30 días',
          notes: 'Factura de demostración',
        });

        logger.info(`✅ Invoice created: ${invoice.serie}-${invoice.folio}`);
        logger.info(`   Subtotal: $${invoice.subtotal}`);
        logger.info(`   Tax: $${invoice.tax_transferred}`);
        logger.info(`   Total: $${invoice.total}`);
      } catch (error) {
        logger.error('Failed to create invoice', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('');
    logger.info('✅ Demo invoices created successfully!');
    logger.info('');
    logger.info('Features demonstrated:');
    logger.info('  ✓ Automatic folio assignment');
    logger.info('  ✓ Automatic subtotal calculation');
    logger.info('  ✓ Automatic tax calculation');
    logger.info('  ✓ Automatic total calculation');
    logger.info('  ✓ Line item integration');
    logger.info('  ✓ Product pricing');
    logger.info('  ✓ Customer association');
    logger.info('  ✓ Multi-item invoices');

    await closePool();
    process.exit(0);
  } catch (error) {
    logger.error('Error seeding demo invoices', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    await closePool();
    process.exit(1);
  }
}

seedInvoices();
