/**
 * Shared TypeScript Types
 */

// User roles
export type UserRole = 'ADMIN' | 'MANAGER' | 'USER' | 'VIEW_ONLY';

// Request user
export interface RequestUser {
  userId: string;
  email: string;
  role: UserRole;
  companyId?: string;
}

// Auth response
export interface AuthResponse {
  success: boolean;
  user?: {
    id: string;
    email: string;
    name?: string;
    role: UserRole;
    companyId?: string;
    /** Grupo de trabajo: define qué pantallas ve (ADMIN_ALL = todas). */
    workGroup?: string;
    /** True si el backend requiere cambio de contraseña antes de operar. */
    passwordChangeRequired?: boolean;
    /** Si presente, indica que el usuario fue suplantado por este super-admin. */
    impersonatedBy?: { userId: string; email: string };
  };
  token?: string;
  refreshToken?: string;
  message?: string;
}

// User
export interface User {
  id: string;
  email: string;
  password_hash: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  role: UserRole;
  company_id?: string;
  is_active: boolean;
  last_login?: Date;
  failed_login_attempts: number;
  locked_until?: Date;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

// Company
export interface Company {
  id: string;
  rfc: string;
  business_name: string;
  fiscal_regime: string;
  postal_code?: string;
  state?: string;
  email?: string;
  phone?: string;
  logo_url?: string;
  pfx_certificate_url?: string;
  pfx_password_hash?: string;
  bank_account?: string;
  bank_name?: string;
  swift_code?: string;
  website?: string;
  subscription_plan: string;
  subscription_expires?: Date;
  is_active: boolean;
  verified_with_sat: boolean;
  sat_verification_date?: Date;
  next_invoice_folio: number;
  default_invoice_series: string;
  default_payment_terms?: string;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

// Customer
export interface Customer {
  id: string;
  company_id: string;
  rfc: string;
  business_name: string;
  fiscal_regime?: string;
  postal_code?: string;
  state?: string;
  city?: string;
  address?: string;
  email?: string;
  phone?: string;
  contact_person?: string;
  credit_limit: number;
  credit_days: number;
  balance: number;
  last_invoice_date?: Date;
  total_invoiced: number;
  payment_average_days?: number;
  payment_history?: any;
  notes?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

// Product
export interface Product {
  id: string;
  company_id: string;
  sku: string;
  name: string;
  description?: string;
  clave_sat: string;
  unit_code: string;
  unit_name: string;
  base_price?: number;
  tax_type?: string;
  tax_rate?: number;
  is_deductible: boolean;
  is_exempt: boolean;
  applies_ieps: boolean;
  stock_quantity: number;
  stock_minimum: number;
  stock_maximum: number;
  last_cost?: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

// Invoice
export interface Invoice {
  id: string;
  company_id: string;
  customer_id: string;
  folio: number;
  serie: string;
  cfdi_type: 'I' | 'E' | 'T';
  date_issued: Date;
  date_expired?: Date;
  currency: string;
  exchange_rate: number;
  subtotal: number;
  tax_transferred: number;
  tax_retained: number;
  tax_ieps: number;
  total: number;
  discount?: number;
  payment_form?: string;
  payment_method?: string;
  cfdi_use?: string;
  payment_terms?: string;
  notes?: string;
  xml_content?: string;
  xml_url?: string;
  pdf_url?: string;
  status: 'DRAFT' | 'READY' | 'STAMPED' | 'SENT' | 'PAID' | 'PARTIAL_PAYMENT' | 'CANCELLED';
  cfdi_uuid?: string;
  pac_id?: string;
  pac_timestamp?: Date;
  is_stamped: boolean;
  sent_at?: Date;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}

// API Response wrapper
export interface ApiResponse<T = any> {
  success: boolean;
  statusCode: number;
  message?: string;
  data?: T;
  error?: string;
  timestamp: string;
}

// Pagination
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export default {};
