-- =====================================================================
-- ERP CFDI 4.0 - Esquema de Base de Datos
-- PostgreSQL 14+
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================================
-- COMPANIES (Empresas / Multi-tenant)
-- =====================================================================
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rfc VARCHAR(13) NOT NULL UNIQUE,
  business_name VARCHAR(255) NOT NULL,
  -- CSD (Certificado de Sello Digital) para timbrado
  csd_cer_path TEXT,
  csd_key_path TEXT,
  csd_password_encrypted TEXT,
  csd_uploaded_at TIMESTAMP,
  -- Logo de la empresa para los PDF
  logo_path TEXT,
  logo_uploaded_at TIMESTAMP,
  fiscal_regime VARCHAR(10) DEFAULT '601',
  postal_code VARCHAR(5),
  state VARCHAR(50),
  municipality VARCHAR(100),
  city VARCHAR(100),
  neighborhood VARCHAR(100),
  street VARCHAR(255),
  ext_number VARCHAR(20),
  address TEXT,
  email VARCHAR(255),
  phone VARCHAR(20),
  logo_url TEXT,
  pfx_certificate_url TEXT,
  pfx_password_hash TEXT,
  bank_account VARCHAR(50),
  bank_name VARCHAR(100),
  swift_code VARCHAR(20),
  website VARCHAR(255),
  subscription_plan VARCHAR(50) DEFAULT 'FREE',
  subscription_expires TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  verified_with_sat BOOLEAN DEFAULT false,
  sat_verification_date TIMESTAMP,
  next_invoice_folio INTEGER DEFAULT 1,
  default_invoice_series VARCHAR(25) DEFAULT 'FAC',
  default_payment_terms VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

-- =====================================================================
-- USERS (Usuarios)
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone VARCHAR(20),
  role VARCHAR(20) DEFAULT 'USER',
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);

-- =====================================================================
-- USER SESSIONS (Refresh tokens)
-- =====================================================================
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);

-- =====================================================================
-- CUSTOMERS (Clientes)
-- =====================================================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rfc VARCHAR(13) NOT NULL,
  business_name VARCHAR(255) NOT NULL,
  fiscal_regime VARCHAR(10),
  default_cfdi_use VARCHAR(5),
  postal_code VARCHAR(5),
  state VARCHAR(50),
  municipality VARCHAR(100),
  city VARCHAR(100),
  neighborhood VARCHAR(100),
  street VARCHAR(255),
  ext_number VARCHAR(20),
  address TEXT,
  email VARCHAR(255),
  phone VARCHAR(20),
  contact_person VARCHAR(255),
  credit_limit DECIMAL(15,2) DEFAULT 0,
  credit_days INTEGER DEFAULT 0,
  balance DECIMAL(15,2) DEFAULT 0,
  last_invoice_date TIMESTAMP,
  total_invoiced DECIMAL(15,2) DEFAULT 0,
  payment_average_days INTEGER,
  payment_history JSONB,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP,
  UNIQUE(company_id, rfc)
);

CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_rfc ON customers(rfc);

-- =====================================================================
-- PRODUCTS (Productos / Servicios)
-- =====================================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku VARCHAR(50),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  clave_sat VARCHAR(10) NOT NULL,
  unit_code VARCHAR(10) NOT NULL,
  unit_name VARCHAR(500),
  base_price DECIMAL(15,2) DEFAULT 0,
  tax_type VARCHAR(10),
  tax_rate DECIMAL(8,6) DEFAULT 0.160000,
  is_deductible BOOLEAN DEFAULT true,
  is_exempt BOOLEAN DEFAULT false,
  applies_ieps BOOLEAN DEFAULT false,
  stock_quantity DECIMAL(15,2) DEFAULT 0,
  stock_minimum DECIMAL(15,2) DEFAULT 0,
  stock_maximum DECIMAL(15,2) DEFAULT 0,
  last_cost DECIMAL(15,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_products_clave_sat ON products(clave_sat);

-- columna agregada en 2026-06-15 para soportar NoIdentificacion del CFDI
ALTER TABLE products ADD COLUMN IF NOT EXISTS no_identificacion VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_products_no_ident ON products(company_id, no_identificacion);

-- columna agregada en 2026-06-17 para soportar moneda por producto (c_Moneda)
ALTER TABLE products ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'MXN';

-- =====================================================================
-- INVOICES (Facturas)
-- =====================================================================
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  folio INTEGER NOT NULL,
  serie VARCHAR(25) DEFAULT 'FAC',
  cfdi_type VARCHAR(1) DEFAULT 'I',
  date_issued TIMESTAMP DEFAULT NOW(),
  date_expired TIMESTAMP,
  currency VARCHAR(3) DEFAULT 'MXN',
  exchange_rate DECIMAL(15,6) DEFAULT 1,
  subtotal DECIMAL(15,2) DEFAULT 0,
  tax_transferred DECIMAL(15,2) DEFAULT 0,
  tax_retained DECIMAL(15,2) DEFAULT 0,
  tax_ieps DECIMAL(15,2) DEFAULT 0,
  total DECIMAL(15,2) DEFAULT 0,
  discount DECIMAL(15,2) DEFAULT 0,
  payment_form VARCHAR(2),
  payment_method VARCHAR(3),
  cfdi_use VARCHAR(4),
  payment_terms VARCHAR(100),
  notes TEXT,
  xml_content TEXT,
  xml_url TEXT,
  pdf_url TEXT,
  status VARCHAR(20) DEFAULT 'DRAFT',
  cfdi_uuid VARCHAR(36),
  pac_id VARCHAR(50),
  pac_timestamp TIMESTAMP,
  is_stamped BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date_issued);
CREATE INDEX IF NOT EXISTS idx_invoices_uuid ON invoices(cfdi_uuid);

-- =====================================================================
-- INVOICE ITEMS (Líneas de factura)
-- =====================================================================
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  line_number INTEGER NOT NULL,
  quantity DECIMAL(15,4) NOT NULL,
  unit_price DECIMAL(15,2) NOT NULL,
  subtotal DECIMAL(15,2) NOT NULL,
  tax_amount DECIMAL(15,2) DEFAULT 0,
  total DECIMAL(15,2) NOT NULL,
  description TEXT,
  clave_sat VARCHAR(10),
  unit_code VARCHAR(10),
  tax_rate DECIMAL(8,6) DEFAULT 0,
  -- Desglose por línea para construir el nodo cfdi:Impuestos del Anexo 20
  tax_preset_id VARCHAR(32),
  ret_iva_rate DECIMAL(8,6) DEFAULT 0,
  ret_isr_rate DECIMAL(8,6) DEFAULT 0,
  ieps_rate    DECIMAL(8,6) DEFAULT 0,
  ret_iva_amount DECIMAL(15,2) DEFAULT 0,
  ret_isr_amount DECIMAL(15,2) DEFAULT 0,
  ieps_amount    DECIMAL(15,2) DEFAULT 0,
  is_exempt      BOOLEAN DEFAULT FALSE
);

-- =====================================================================
-- PAYMENTS (Pagos / Complemento de Pago - base)
-- =====================================================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id),
  payment_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  payment_date TIMESTAMP DEFAULT NOW(),
  payment_form VARCHAR(2),
  currency VARCHAR(3) DEFAULT 'MXN',
  document_status VARCHAR(20) DEFAULT 'DRAFT',
  uuid VARCHAR(36),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

-- =====================================================================
-- SAT CATALOGS (Anexo 20 - claves de producto, unidad, etc.)
-- =====================================================================
CREATE TABLE IF NOT EXISTS sat_catalogs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalog_name VARCHAR(50) NOT NULL,
  catalog_key VARCHAR(40) NOT NULL,
  description TEXT,
  vigence_start TIMESTAMP,
  vigence_end TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(catalog_name, catalog_key)
);

CREATE INDEX IF NOT EXISTS idx_sat_catalogs_name_key ON sat_catalogs(catalog_name, catalog_key);

-- =====================================================================
-- CFDI VALIDATIONS (Validaciones SAT - Semanas 8-10)
-- =====================================================================
CREATE TABLE IF NOT EXISTS cfdi_validations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  validation_type VARCHAR(20) NOT NULL,
  is_valid BOOLEAN DEFAULT false,
  status VARCHAR(50),
  rfc_emisor VARCHAR(13),
  rfc_receptor VARCHAR(13),
  total DECIMAL(15,2),
  uuid VARCHAR(36),
  response_data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(invoice_id, validation_type)
);

CREATE INDEX IF NOT EXISTS idx_cfdi_validations_uuid ON cfdi_validations(uuid);
CREATE INDEX IF NOT EXISTS idx_cfdi_validations_status ON cfdi_validations(status);

-- =====================================================================
-- PAC STAMPS (Historial de timbrado - Semanas 14-16)
-- =====================================================================
CREATE TABLE IF NOT EXISTS pac_stamps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  uuid VARCHAR(36) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  sello_sat TEXT,
  sello_cfd TEXT,
  no_certificado_sat VARCHAR(30),
  fecha_timbrado TIMESTAMP,
  qr_code TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pac_stamps_invoice ON pac_stamps(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pac_stamps_uuid ON pac_stamps(uuid);

-- =====================================================================
-- CUSTOMER_PRODUCTS — qué productos consume cada cliente (memoria)
-- Se actualiza al importar XMLs emitidos donde el receptor coincide
-- con un cliente registrado.
-- =====================================================================
CREATE TABLE IF NOT EXISTS customer_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  first_purchase_date TIMESTAMP,
  last_purchase_date TIMESTAMP,
  times_purchased INTEGER NOT NULL DEFAULT 0,
  total_quantity DECIMAL(15,4) NOT NULL DEFAULT 0,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  last_unit_price DECIMAL(15,2),
  last_invoice_uuid VARCHAR(36),
  last_invoice_folio VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(customer_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_cust_prod_customer ON customer_products(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_prod_product ON customer_products(product_id);
CREATE INDEX IF NOT EXISTS idx_cust_prod_company ON customer_products(company_id);

-- =====================================================================
-- FIN DEL ESQUEMA
-- =====================================================================
