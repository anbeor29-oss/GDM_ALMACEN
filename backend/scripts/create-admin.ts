/**
 * Script: Create Admin User
 * Usage: npm run create:admin
 */

import { config } from '../src/config/environment';
import { query, closePool } from '../src/config/database';
import * as authService from '../src/modules/auth/auth.service';
import logger from '../src/middleware/logger';

async function createAdmin() {
  try {
    logger.info('Creating admin user...');

    // Create admin user
    const admin = await authService.createUser({
      email: 'admin@example.com',
      password: 'AdminPassword123!',
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
    });

    logger.info('✅ Admin user created successfully');
    logger.info(`Email: ${admin.email}`);
    logger.info(`Role: ${admin.role}`);
    logger.info('');
    logger.info('You can now login with:');
    logger.info('Email: admin@example.com');
    logger.info('Password: AdminPassword123!');
    logger.info('');
    logger.warn('⚠️  Change the password after first login!');

    await closePool();
    process.exit(0);
  } catch (error) {
    logger.error('Error creating admin user', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    await closePool();
    process.exit(1);
  }
}

createAdmin();
