/**
 * Script: Seed Demo Customers
 * Usage: npm run seed:customers
 */

import { config } from '../src/config/environment';
import { query, closePool } from '../src/config/database';
import * as companiesService from '../src/modules/companies/companies.service';
import * as customersService from '../src/modules/customers/customers.service';
import logger from '../src/middleware/logger';

async function seedCustomers() {
  try {
    logger.info('Seeding demo customers...');

    // Get or create ACME company
    let company;
    try {
      company = await companiesService.getCompanyByRFC('ABC010101ABC');
    } catch {
      logger.warn('ACME company not found, creating...');
      company = await companiesService.createCompany({
        rfc: 'ABC010101ABC',
        businessName: 'ACME Corporation',
        fiscalRegime: '601',
        postalCode: '28020',
        state: '09',
        email: 'info@acme.com',
        phone: '5551234567',
      });
    }

    logger.info(`Using company: ${company.business_name}`);

    // Create demo customers
    const customerData = [
      {
        rfc: 'XYZ010101XYZ',
        businessName: 'Tech Solutions Inc',
        fiscalRegime: '601',
        postalCode: '64000',
        state: '19',
        city: 'Monterrey',
        address: 'Av. Tecnológico 123, Suite 100',
        email: 'contact@techsolutions.com',
        phone: '8181234567',
        contactPerson: 'Juan García',
        creditLimit: 50000,
        creditDays: 30,
      },
      {
        rfc: 'ABC123123ABC',
        businessName: 'Global Services Ltd',
        fiscalRegime: '605',
        postalCode: '06500',
        state: '09',
        city: 'Mexico City',
        address: 'Paseo de la Reforma 222',
        email: 'sales@globalservices.com',
        phone: '5559876543',
        contactPerson: 'María López',
        creditLimit: 75000,
        creditDays: 45,
      },
      {
        rfc: 'DEF456456DEF',
        businessName: 'Logistics Network SA',
        fiscalRegime: '601',
        postalCode: '70000',
        state: '30',
        city: 'Veracruz',
        address: 'Boulevard Ruiz Cortines 456',
        email: 'logistics@network.com',
        phone: '2292345678',
        contactPerson: 'Carlos Rodríguez',
        creditLimit: 100000,
        creditDays: 60,
      },
      {
        rfc: 'GHI789789GHI',
        businessName: 'Manufacturing Corp',
        fiscalRegime: '601',
        postalCode: '44100',
        state: '14',
        city: 'Guadalajara',
        address: 'Industrial Zone A, Suite 500',
        email: 'info@manufacturing.com',
        phone: '3338765432',
        contactPerson: 'Pedro Sánchez',
        creditLimit: 150000,
        creditDays: 90,
      },
      {
        rfc: 'JKL012012JKL',
        businessName: 'Commerce Solutions',
        fiscalRegime: '605',
        postalCode: '83000',
        state: '25',
        city: 'Hermosillo',
        address: 'Commercial Blvd 789',
        email: 'shop@commercesolutions.com',
        phone: '6623456789',
        contactPerson: 'Rosa Martínez',
        creditLimit: 60000,
        creditDays: 30,
      },
    ];

    // Create customers
    for (const data of customerData) {
      try {
        const customer = await customersService.createCustomer(company.id, data);
        logger.info(`✅ Customer created: ${data.businessName} (${data.rfc})`);
      } catch (error) {
        logger.warn(`⚠️  Customer already exists: ${data.rfc}`);
      }
    }

    logger.info('');
    logger.info('✅ Demo customers seeded successfully!');
    logger.info('');
    logger.info('Created customers:');
    customerData.forEach((c) => {
      logger.info(`  - ${c.businessName} (${c.rfc})`);
      logger.info(`    Credit: $${c.creditLimit} / ${c.creditDays} days`);
    });
    logger.info('');

    await closePool();
    process.exit(0);
  } catch (error) {
    logger.error('Error seeding demo customers', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    await closePool();
    process.exit(1);
  }
}

seedCustomers();
