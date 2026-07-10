/**
 * Frontend Types
 */

// Auth
export interface User {
  userId: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'USER' | 'VIEW_ONLY';
  companyId?: string;
  /** True si el backend requiere que el usuario cambie su contraseña antes de operar. */
  passwordChangeRequired?: boolean;
  /** Si está presente, el usuario actual está siendo suplantado por este super-admin. */
  impersonatedBy?: { userId: string; email: string };
}

export interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
}

// Company
export interface Company {
  id: string;
  rfc: string;
  business_name: string;
  email?: string;
  phone?: string;
  next_invoice_folio: number;
  default_invoice_series: string;
}

// Customer
export interface Customer {
  id: string;
  company_id: string;
  rfc: string;
  business_name: string;
  email?: string;
  phone?: string;
  credit_limit: number;
  balance: number;
  last_invoice_date?: string;
  total_invoiced: number;
}

// Product
export interface Product {
  id: string;
  company_id: string;
  sku: string;
  name: string;
  clave_sat: string;
  unit_code: string;
  base_price?: number;
  tax_rate?: number;
  is_active: boolean;
}

// Invoice
export interface Invoice {
  id: string;
  company_id: string;
  customer_id: string;
  folio: number;
  serie: string;
  cfdi_type: 'I' | 'E' | 'T';
  date_issued: string;
  subtotal: number;
  tax_transferred: number;
  total: number;
  status: 'DRAFT' | 'READY' | 'STAMPED' | 'SENT' | 'PAID' | 'RECEIVED' | 'CANCELLED';
  cfdi_uuid?: string;
  xml_content?: string;
  pdf_url?: string;
  is_stamped?: boolean;
  customer_name?: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string;
  line_number: number;
  quantity: number;
  unit_price: number;
  subtotal: number;
  tax_amount: number;
  total: number;
  description: string;
}

// CFDI
export interface CFDIStatus {
  invoiceId: string;
  cfdiGenerated: boolean;
  cfdiUUID?: string;
  isStamped: boolean;
  canStamp: boolean;
}

// Validation
export interface ValidationResult {
  valid: boolean;
  status: string;
  errors: string[];
  warnings: string[];
}

// API Response
export interface APIResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

// Pagination
export interface PaginationParams {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}
