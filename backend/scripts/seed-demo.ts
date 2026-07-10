/**
 * Script: Seed Demo Data
 * Usage: npm run seed:demo
 */

import { config } from '../src/config/environment';
import { query, closePool } from '../src/config/database';
import * as authService from '../src/modules/auth/auth.service';
import * as companiesService from '../src/modules/companies/companies.service';
import logger from '../src/middleware/logger';

async function seedDemo() {
  try {
    logger.info('Seeding demo data...');

    // Create admin user
    logger.info('Creating admin user...');
    const admin = await authService.createUser({
      email: 'admin@demo.com',
      password: 'DemoPassword123!',
      firstName: 'Admin',
      lastName: 'Demo',
      role: 'ADMIN',
    });
    logger.info(`✅ Admin created: ${admin.email}`);

    // Create demo company
    logger.info('Creating demo company...');
    const company = await companiesService.createCompany({
      rfc: 'ABC010101ABC',
      businessName: 'ACME Corporation',
      fiscalRegime: '601',
      postalCode: '28020',
      state: '09',
      email: 'info@acme.com',
      phone: '5551234567',
    });
    logger.info(`✅ Company created: ${company.rfc}`);

    // Create manager user for the company
    logger.info('Creating manager user...');
    const manager = await authService.createUser({
      email: 'manager@demo.com',
      password: 'ManagerPassword123!',
      firstName: 'Manager',
      lastName: 'Demo',
      role: 'MANAGER',
      companyId: company.id,
    });
    logger.info(`✅ Manager created: ${manager.email}`);

    // Create regular user for the company
    logger.info('Creating regular user...');
    const user = await authService.createUser({
      email: 'user@demo.com',
      password: 'UserPassword123!',
      firstName: 'Regular',
      lastName: 'User',
      role: 'USER',
      companyId: company.id,
    });
    logger.info(`✅ User created: ${user.email}`);

    logger.info('');
    logger.info('✅ Demo data seeded successfully!');
    logger.info('');
    logger.info('Test accounts:');
    logger.info('');
    logger.info('Admin:');
    logger.info('  Email: admin@demo.com');
    logger.info('  Password: DemoPassword123!');
    logger.info('');
    logger.info('Manager:');
    logger.info('  Email: manager@demo.com');
    logger.info('  Password: ManagerPassword123!');
    logger.info('  Company: ACME Corporation (ABC010101ABC)');
    logger.info('');
    logger.info('User:');
    logger.info('  Email: user@demo.com');
    logger.info('  Password: UserPassword123!');
    logger.info('  Company: ACME Corporation (ABC010101ABC)');
    logger.info('');

    await closePool();
    process.exit(0);
  } catch (error) {
    logger.error('Error seeding demo data', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    await closePool();
    process.exit(1);
  }
}

seedDemo();
