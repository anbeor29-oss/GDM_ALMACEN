-- ================================================================
-- ERP CFDI 4.0 MEXICO - ESQUEMA DE BASE DE DATOS
-- ================================================================
-- Este archivo contiene el esquema completo para PostgreSQL 15+
--
-- Ejecución:
-- psql -U postgres -d cfdi_erp < DATABASE.sql
--
-- ================================================================

-- Crear base de datos si no existe
CREATE DATABASE IF NOT EXISTS cfdi_erp
  ENCODING = 'UTF8'
  LC_COLLATE = 'es_MX.UTF-8'
  LC_CTYPE = 'es_MX.UTF-8';

-- Conectarse a la base de datos
\c cfdi_erp;

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "hstore";

-- ================================================================
-- 1. TABLAS DE CONFIGURACION Y USUARIOS
-- ================================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone VARCHAR(20),
  role VARCHAR(50) NOT NULL CHECK (role IN ('ADMIN', 'MANAGER', 'USER', 'VIEW_ONLY')),
  company_id UUID,
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  failed_login_attempts INT DEFAULT 0,
  locked_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, resource, action)
);

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rfc VARCHAR(13) UNIQUE NOT NULL,
  business_name VARCHAR(255) NOT NULL,
  fiscal_regime VARCHAR(50) NOT NULL,
  postal_code VARCHAR(5),
  state VARCHAR(2),
  email VARCHAR(255),
  phone VARCHAR(20),
  logo_url VARCHAR(512),
  pfx_certificate_url VARCHAR(512),
  pfx_password_hash VARCHAR(255),
  bank_account VARCHAR(50),
  bank_name VARCHAR(100),
  swift_code VARCHAR(20),
  website VARCHAR(255),
  subscription_plan VARCHAR(50) DEFAULT 'STARTER', -- STARTER, PROFESSIONAL, ENTERPRISE
  subscription_expires TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,

  -- Verificaciones SAT
  verified_with_sat BOOLEAN DEFAULT false,
  sat_verification_date TIMESTAMP,

  -- Configuración de facturación
  next_invoice_folio INT DEFAULT 1,
  default_invoice_series VARCHAR(10) DEFAULT 'F',
  default_payment_terms VARCHAR(100),

  CONSTRAINT valid_rfc CHECK (rfc ~ '^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$')
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token VARCHAR(500) UNIQUE NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ================================================================
-- 2. TABLAS DE CATALOGOS SAT
-- ================================================================

CREATE TABLE IF NOT EXISTS sat_catalogs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalog_name VARCHAR(100) NOT NULL,
  catalog_key VARCHAR(50) NOT NULL,
  description VARCHAR(500),
  parent_code VARCHAR(50),
  vigence_start TIMESTAMP,
  vigence_end TIMESTAMP,
  attributes JSONB,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(50) DEFAULT 'SAT',

  UNIQUE(catalog_name, catalog_key),
  INDEX idx_catalog_search (catalog_name, catalog_key, vigence_end)
);

-- Preload de catálogos más importantes
-- Nota: Los datos reales se cargarán desde scripts de migración

-- ================================================================
-- 3. TABLAS DE CLIENTES
-- ================================================================

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rfc VARCHAR(13) NOT NULL,
  business_name VARCHAR(255) NOT NULL,
  fiscal_regime VARCHAR(50),
  postal_code VARCHAR(5),
  state VARCHAR(2),
  city VARCHAR(100),
  address VARCHAR(500),
  email VARCHAR(255),
  phone VARCHAR(20),
  contact_person VARCHAR(150),
  credit_limit DECIMAL(15, 2) DEFAULT 0,
  credit_days INT DEFAULT 0,
  balance DECIMAL(15, 2) DEFAULT 0 GENERATED ALWAYS AS (0) STORED,
  last_invoice_date TIMESTAMP,
  total_invoiced DECIMAL(15, 2) DEFAULT 0,
  payment_average_days INT,
  payment_history JSONB,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,

  UNIQUE(company_id, rfc),
  CONSTRAINT valid_rfc_customer CHECK (rfc ~ '^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$|^XAXX010101000$'),
  INDEX idx_customer_company (company_id),
  INDEX idx_customer_rfc (rfc)
);

-- ================================================================
-- 4. TABLAS DE PRODUCTOS
-- ================================================================

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  clave_sat VARCHAR(8) NOT NULL,
  unit_code VARCHAR(3) NOT NULL,
  unit_name VARCHAR(100),
  base_price DECIMAL(15, 2),
  tax_type VARCHAR(50),
  tax_rate DECIMAL(5, 4),
  is_deductible BOOLEAN DEFAULT true,
  is_exempt BOOLEAN DEFAULT false,
  applies_ieps BOOLEAN DEFAULT false,
  stock_quantity INT DEFAULT 0,
  stock_minimum INT DEFAULT 0,
  stock_maximum INT DEFAULT 0,
  last_cost DECIMAL(15, 2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,

  UNIQUE(company_id, sku),
  INDEX idx_product_company (company_id),
  INDEX idx_product_clave_sat (clave_sat)
);

-- ================================================================
-- 5. TABLAS DE FACTURAS
-- ================================================================

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  folio INT NOT NULL,
  serie VARCHAR(10),
  cfdi_type VARCHAR(1) NOT NULL DEFAULT 'I', -- I, E, T
  date_issued TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_expired TIMESTAMP,
  currency VARCHAR(3) DEFAULT 'MXN',
  exchange_rate DECIMAL(15, 6) DEFAULT 1,
  subtotal DECIMAL(15, 2),
  tax_transferred DECIMAL(15, 2) DEFAULT 0,
  tax_retained DECIMAL(15, 2) DEFAULT 0,
  tax_ieps DECIMAL(15, 2) DEFAULT 0,
  total DECIMAL(15, 2),
  discount DECIMAL(15, 2) DEFAULT 0,
  payment_form VARCHAR(50),
  payment_method VARCHAR(50),
  cfdi_use VARCHAR(50),
  payment_terms VARCHAR(255),
  notes TEXT,
  xml_content LONGTEXT,
  xml_url VARCHAR(512),
  pdf_url VARCHAR(512),
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  -- status options: DRAFT, READY, STAMPED, SENT, PAID, PARTIAL_PAYMENT, CANCELLED
  cfdi_uuid VARCHAR(36),
  pac_id VARCHAR(100),
  pac_timestamp TIMESTAMP,
  is_stamped BOOLEAN DEFAULT false,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,

  UNIQUE(company_id, folio, serie),
  CONSTRAINT valid_cfdi_type CHECK (cfdi_type IN ('I', 'E', 'T')),
  INDEX idx_invoice_company (company_id),
  INDEX idx_invoice_customer (customer_id),
  INDEX idx_invoice_status (status),
  INDEX idx_invoice_date (date_issued),
  INDEX idx_invoice_uuid (cfdi_uuid)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  line_number INT,
  quantity DECIMAL(15, 6),
  unit_price DECIMAL(15, 2),
  subtotal DECIMAL(15, 2),
  tax_amount DECIMAL(15, 2) DEFAULT 0,
  total DECIMAL(15, 2),
  description TEXT,
  clave_sat VARCHAR(8),
  unit_code VARCHAR(3),
  tax_rate DECIMAL(5, 4),
  discount DECIMAL(15, 2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_invoice_items (invoice_id)
);

-- ================================================================
-- 6. TABLAS DE PAGOS Y COMPLEMENTOS
-- ================================================================

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  payment_amount DECIMAL(15, 2) NOT NULL,
  payment_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payment_method VARCHAR(50),
  payment_form VARCHAR(50),
  reference_number VARCHAR(100),
  bank_account VARCHAR(50),
  document_status VARCHAR(50) DEFAULT 'PENDING',
  -- PENDING, STAMPED, VOID
  cfdi_complement_xml LONGTEXT,
  cfdi_complement_url VARCHAR(512),
  cfdi_uuid VARCHAR(36),
  balance_remaining DECIMAL(15, 2),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,

  INDEX idx_payment_invoice (invoice_id),
  INDEX idx_payment_date (payment_date),
  INDEX idx_payment_status (document_status)
);

CREATE TABLE IF NOT EXISTS payment_supplements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,
  xml_content LONGTEXT,
  xml_url VARCHAR(512),
  pdf_url VARCHAR(512),
  cfdi_uuid VARCHAR(36),
  is_stamped BOOLEAN DEFAULT false,
  pac_id VARCHAR(100),
  pac_timestamp TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_supplement_invoice (invoice_id),
  INDEX idx_supplement_payment (payment_id)
);

-- ================================================================
-- 7. TABLAS DE AUDITORÍA Y LOGS
-- ================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  -- CREATE, UPDATE, DELETE, VIEW, DOWNLOAD, EXPORT, STAMP, CANCEL
  table_name VARCHAR(100),
  record_id VARCHAR(100),
  old_values JSONB,
  new_values JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(50) DEFAULT 'SUCCESS',

  INDEX idx_audit_user (user_id),
  INDEX idx_audit_company (company_id),
  INDEX idx_audit_timestamp (timestamp),
  INDEX idx_audit_action (action),
  INDEX idx_audit_table (table_name)
);

CREATE TABLE IF NOT EXISTS stamping_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  pac_name VARCHAR(100),
  request_xml_hash VARCHAR(64),
  response_cfdi_uuid VARCHAR(36),
  response_timestamp TIMESTAMP,
  pac_response_code VARCHAR(20),
  pac_response_message TEXT,
  status VARCHAR(50) NOT NULL,
  -- SUCCESS, FAILED, PENDING, ERROR
  retry_count INT DEFAULT 0,
  next_retry_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_stamping_invoice (invoice_id),
  INDEX idx_stamping_status (status),
  INDEX idx_stamping_uuid (response_cfdi_uuid)
);

CREATE TABLE IF NOT EXISTS cancellation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  cfdi_uuid VARCHAR(36) NOT NULL,
  request_timestamp TIMESTAMP,
  response_timestamp TIMESTAMP,
  pac_id VARCHAR(100),
  pac_response_code VARCHAR(20),
  pac_response_message TEXT,
  status VARCHAR(50) NOT NULL,
  -- PENDING, SUCCESS, FAILED
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_cancellation_invoice (invoice_id),
  INDEX idx_cancellation_uuid (cfdi_uuid),
  INDEX idx_cancellation_status (status)
);

-- ================================================================
-- 8. TABLAS AUXILIARES
-- ================================================================

CREATE TABLE IF NOT EXISTS email_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  recipient_email VARCHAR(255) NOT NULL,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  subject VARCHAR(255),
  body TEXT,
  attachment_url VARCHAR(512),
  status VARCHAR(50) DEFAULT 'PENDING',
  -- PENDING, SENT, FAILED
  sent_at TIMESTAMP,
  error_message TEXT,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_email_status (status),
  INDEX idx_email_company (company_id)
);

CREATE TABLE IF NOT EXISTS pdf_generation_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID UNIQUE REFERENCES invoices(id) ON DELETE CASCADE,
  pdf_url VARCHAR(512),
  hash VARCHAR(64),
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sync_type VARCHAR(100) NOT NULL,
  -- 'SAT_CATALOGS', 'CUSTOMER_DATA', 'BACKUP', etc
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  status VARCHAR(50) NOT NULL,
  total_records INT,
  processed_records INT,
  error_message TEXT,

  INDEX idx_sync_type (sync_type),
  INDEX idx_sync_status (status)
);

-- ================================================================
-- 9. VISTAS ÚTILES PARA REPORTING
-- ================================================================

CREATE VIEW v_customer_balance AS
  SELECT
    c.id,
    c.company_id,
    c.rfc,
    c.business_name,
    COALESCE(SUM(CASE
      WHEN i.status IN ('SENT', 'PARTIAL_PAYMENT')
      THEN i.total - COALESCE((
        SELECT SUM(p.payment_amount)
        FROM payments p
        WHERE p.invoice_id = i.id AND p.document_status = 'STAMPED'
      ), 0)
      ELSE 0
    END), 0) AS pending_balance,
    COUNT(DISTINCT CASE WHEN i.status IN ('SENT', 'PARTIAL_PAYMENT') THEN i.id END) AS pending_invoices,
    MAX(i.date_issued) AS last_invoice_date
  FROM customers c
  LEFT JOIN invoices i ON c.id = i.customer_id
  WHERE c.deleted_at IS NULL AND i.deleted_at IS NULL
  GROUP BY c.id, c.company_id, c.rfc, c.business_name;

CREATE VIEW v_aged_receivables AS
  SELECT
    i.id,
    i.company_id,
    c.rfc,
    c.business_name,
    i.folio,
    i.serie,
    i.total,
    (i.total - COALESCE((
      SELECT SUM(p.payment_amount)
      FROM payments p
      WHERE p.invoice_id = i.id AND p.document_status = 'STAMPED'
    ), 0)) AS balance_outstanding,
    i.date_issued,
    CURRENT_DATE - CAST(i.date_issued AS DATE) AS days_outstanding,
    CASE
      WHEN CURRENT_DATE - CAST(i.date_issued AS DATE) <= 30 THEN '0-30 days'
      WHEN CURRENT_DATE - CAST(i.date_issued AS DATE) <= 60 THEN '31-60 days'
      WHEN CURRENT_DATE - CAST(i.date_issued AS DATE) <= 90 THEN '61-90 days'
      ELSE '90+ days'
    END AS aging_bucket
  FROM invoices i
  JOIN customers c ON i.customer_id = c.id
  WHERE i.status IN ('SENT', 'PARTIAL_PAYMENT')
    AND i.deleted_at IS NULL
  ORDER BY i.date_issued ASC;

CREATE VIEW v_monthly_revenue AS
  SELECT
    company_id,
    DATE_TRUNC('month', date_issued) AS month,
    COUNT(*) AS invoice_count,
    SUM(total) AS total_revenue,
    AVG(total) AS avg_invoice_value
  FROM invoices
  WHERE status IN ('STAMPED', 'SENT', 'PAID', 'PARTIAL_PAYMENT')
    AND deleted_at IS NULL
  GROUP BY company_id, DATE_TRUNC('month', date_issued);

-- ================================================================
-- 10. INDICES ADICIONALES PARA PERFORMANCE
-- ================================================================

CREATE INDEX idx_invoices_company_date ON invoices(company_id, date_issued DESC);
CREATE INDEX idx_invoices_customer_date ON invoices(customer_id, date_issued DESC);
CREATE INDEX idx_customers_company_active ON customers(company_id, is_active);
CREATE INDEX idx_products_company_active ON products(company_id, is_active);
CREATE INDEX idx_payments_invoice_date ON payments(invoice_id, payment_date DESC);
CREATE INDEX idx_audit_company_timestamp ON audit_logs(company_id, timestamp DESC);

-- ================================================================
-- 11. TRIGGERS PARA AUTOMATIZACION
-- ================================================================

-- Actualizar timestamp updated_at
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_users_update BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trigger_companies_update BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trigger_customers_update BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trigger_products_update BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trigger_invoices_update BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trigger_payments_update BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ================================================================
-- 12. PERMISOS Y ROLES (Opcional, según tu DB)
-- ================================================================

-- Crear rol de aplicación
CREATE ROLE app_user WITH LOGIN PASSWORD 'change_me_in_production';
GRANT CONNECT ON DATABASE cfdi_erp TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ================================================================
-- 13. DATOS INICIALES
-- ================================================================

-- Insertar catálogos SAT iniciales (ejemplo c_RegimenFiscal)
INSERT INTO sat_catalogs (catalog_name, catalog_key, description, vigence_start, vigence_end)
VALUES
  ('c_RegimenFiscal', '601', 'General de Ley Personas Morales', CURRENT_TIMESTAMP, NULL),
  ('c_RegimenFiscal', '605', 'Personas Físicas con Actividades Empresariales y Profesionales', CURRENT_TIMESTAMP, NULL),
  ('c_RegimenFiscal', '610', 'Personas Físicas con Actividades Empresariales y Profesionales Actividad Agrícola, Ganadería, Silvicultura y Pesca', CURRENT_TIMESTAMP, NULL),
  ('c_RegimenFiscal', '614', 'Personas Físicas sin Actividades Empresariales y Profesionales', CURRENT_TIMESTAMP, NULL),
  ('c_RegimenFiscal', '616', 'Sociedades Cooperativas y sus Asociados que sean Miembros de la Sociedad Cooperativa', CURRENT_TIMESTAMP, NULL)
ON CONFLICT (catalog_name, catalog_key) DO NOTHING;

-- ================================================================
-- FIN DEL SCRIPT
-- ================================================================

-- Comentario: Después de ejecutar este script:
-- 1. Ejecutar: npm run seed:catalogs (cargar todos los catálogos del SAT)
-- 2. Crear usuario admin: npm run create:admin
-- 3. Crear empresa de prueba: npm run seed:demo-data

GRANT ALL PRIVILEGES ON DATABASE cfdi_erp TO app_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

