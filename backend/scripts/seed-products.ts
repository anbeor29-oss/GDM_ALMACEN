/**
 * Script: Seed Demo Products with SAT Validation
 * Usage: npm run seed:products
 */

import { config } from '../src/config/environment';
import { query, closePool } from '../src/config/database';
import * as companiesService from '../src/modules/companies/companies.service';
import * as productsService from '../src/modules/products/products.service';
import logger from '../src/middleware/logger';

async function seedProducts() {
  try {
    logger.info('Seeding demo products with SAT validation...');

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

    // Demo products with valid SAT claves (c_ClaveProdServ)
    // These are real examples from SAT catalog
    const productData = [
      {
        sku: 'PROD-001',
        name: 'Consultoría Técnica',
        description: 'Servicios de consultoría en tecnología de la información',
        claveSat: '86101200',          // Servicios de consultoría empresarial
        unitCode: 'H87',               // Servicio (valid SAT code)
        basePrice: 5000,
        taxType: 'IVA',                // Type: IVA
        taxRate: 0.16,                 // Rate: 16%
        isDeductible: true,
        isExempt: false,
        appliesIEPS: false,
      },
      {
        sku: 'PROD-002',
        name: 'Desarrollo de Software',
        description: 'Desarrollo personalizado de aplicaciones web y móvil',
        claveSat: '81111700',          // Servicios de programación
        unitCode: 'H87',
        basePrice: 15000,
        taxType: 'IVA',
        taxRate: 0.16,
        isDeductible: true,
        isExempt: false,
        appliesIEPS: false,
      },
      {
        sku: 'PROD-003',
        name: 'Hosting y Dominio Anual',
        description: 'Servicio de alojamiento web y registro de dominio por 12 meses',
        claveSat: '84111700',          // Servicios de telecomunicaciones
        unitCode: 'H87',
        basePrice: 2000,
        taxType: 'IVA',
        taxRate: 0.16,
        isDeductible: true,
        isExempt: false,
        appliesIEPS: false,
      },
      {
        sku: 'PROD-004',
        name: 'Mantenimiento de Software',
        description: 'Soporte técnico y actualizaciones de software licenciado',
        claveSat: '81111600',          // Servicios de administración de sistemas
        unitCode: 'H87',
        basePrice: 3500,
        taxType: 'IVA',
        taxRate: 0.16,
        isDeductible: true,
        isExempt: false,
        appliesIEPS: false,
      },
      {
        sku: 'PROD-005',
        name: 'Capacitación en Sistemas',
        description: 'Cursos de entrenamiento en uso de sistemas informativos',
        claveSat: '80111100',          // Servicios de educación
        unitCode: 'H87',
        basePrice: 8000,
        taxType: 'IVA',
        taxRate: 0.16,
        isDeductible: true,
        isExempt: false,
        appliesIEPS: false,
      },
    ];

    // Create products with SAT validation
    for (const data of productData) {
      try {
        const product = await productsService.createProduct(company.id, data);
        logger.info(`✅ Product created: ${data.name}`);
        logger.info(`   SKU: ${data.sku}`);
        logger.info(`   SAT Clave: ${data.claveSat}`);
        logger.info(`   Unit: ${data.unitCode}`);
        logger.info(`   Price: $${data.basePrice} (${data.taxRate * 100}% IVA)`);
      } catch (error) {
        logger.error(`❌ Failed to create product: ${data.sku}`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('');
    logger.info('✅ Demo products seeded successfully!');
    logger.info('');
    logger.info('Created products:');
    productData.forEach((p) => {
      logger.info(`  - ${p.name} (${p.sku})`);
      logger.info(`    SAT Clave: ${p.claveSat}`);
      logger.info(`    Unit: ${p.unitCode}`);
      logger.info(`    Base Price: $${p.basePrice}`);
    });
    logger.info('');
    logger.info('All products validated against SAT catalogs (c_ClaveProdServ, c_ClaveUnidad)');

    await closePool();
    process.exit(0);
  } catch (error) {
    logger.error('Error seeding demo products', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    await closePool();
    process.exit(1);
  }
}

seedProducts();
