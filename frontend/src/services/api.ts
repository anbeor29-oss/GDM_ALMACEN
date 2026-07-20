/**
 * API Service
 * Centralized API client for all backend calls
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { APIResponse, Invoice, Customer, Product } from '@/types';

// En dev, Vite hace proxy de /api → localhost:3000 (ver vite.config.ts).
// En prod (Render), VITE_API_BASE apunta al servicio backend.
// Fallback a '/api' cuando la env no está definida (comportamiento local histórico).
const API_BASE_URL = import.meta.env.VITE_API_BASE
  ? `${String(import.meta.env.VITE_API_BASE).replace(/\/+$/, '')}/api/v1`
  : '/api/v1';

class APIClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add token to requests
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Handle response errors — normaliza CUALQUIER respuesta de error a un
    // mensaje legible en error.message + error.response.data.message para que
    // los alerts del UI nunca muestren "Unexpected token 'n', 'null' is not
    // valid JSON" ni "Request failed with status code 400" sin contexto.
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('token');
          window.location.href = '/login';
        }
        const r: any = error.response;
        const status = r?.status || 0;
        const friendly = (msg: string): string =>
          (msg || '').trim() || `Error HTTP ${status}` || 'Error desconocido';

        try {
          if (r?.data instanceof Blob) {
            const txt = await r.data.text().catch(() => '');
            let parsed: any = null;
            try { parsed = JSON.parse(txt); } catch { /* no era JSON */ }

            if (parsed && typeof parsed === 'object' && parsed.message) {
              r.data = parsed;
              (error as any).message = friendly(parsed.message);
            } else {
              const msg = friendly(txt);
              r.data = { message: msg };
              (error as any).message = msg;
            }
          } else if (r?.data && typeof r.data === 'object' && r.data.message) {
            (error as any).message = friendly(r.data.message);
          } else if (typeof r?.data === 'string') {
            const msg = friendly(r.data);
            r.data = { message: msg };
            (error as any).message = msg;
          } else if (status) {
            // No hay body usable — al menos ponemos el status
            (error as any).message = `Error HTTP ${status}`;
            if (r) r.data = { message: (error as any).message };
          }
        } catch (e) {
          // El interceptor JAMÁS debe lanzar un error que reemplace al original
          // con un mensaje de "Unexpected token..." al usuario.
          (error as any).message = friendly((error as any).message);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Auth endpoints
   */
  async login(email: string, password: string) {
    const response = await this.client.post<APIResponse<any>>('/auth/login', {
      email,
      password,
    });
    return response.data;
  }

  async logout() {
    return this.client.post('/auth/logout');
  }

  async changePassword(oldPassword: string, newPassword: string) {
    const r = await this.client.post('/auth/change-password', { oldPassword, newPassword });
    return r.data;
  }

  async refreshToken(refreshToken: string) {
    const response = await this.client.post<APIResponse<any>>('/auth/refresh', {
      refreshToken,
    });
    return response.data;
  }

  /**
   * Invoices endpoints
   */
  async getInvoices(page: number = 1, limit: number = 10, filters?: any) {
    const response = await this.client.get<APIResponse<any>>('/invoices', {
      params: { page, limit, ...filters },
    });
    return response.data;
  }

  async getInvoice(invoiceId: string) {
    const response = await this.client.get<APIResponse<Invoice>>(`/invoices/${invoiceId}`);
    return response.data;
  }

  async createInvoice(data: any) {
    const response = await this.client.post<APIResponse<Invoice>>('/invoices', data);
    return response.data;
  }

  async updateInvoice(invoiceId: string, data: any) {
    const response = await this.client.put<APIResponse<Invoice>>(`/invoices/${invoiceId}`, data);
    return response.data;
  }

  async deleteInvoice(invoiceId: string) {
    const response = await this.client.delete(`/invoices/${invoiceId}`);
    return response.data;
  }

  async changeInvoiceStatus(invoiceId: string, status: string) {
    const response = await this.client.put<APIResponse<Invoice>>(
      `/invoices/${invoiceId}/status`,
      { status }
    );
    return response.data;
  }

  /**
   * Customers endpoints
   */
  async getCustomers(page: number = 1, limit: number = 10, opts?: { sortBy?: string; sortOrder?: 'ASC' | 'DESC' }) {
    const response = await this.client.get<APIResponse<any>>('/customers', {
      params: { page, limit, sortBy: opts?.sortBy, sortOrder: opts?.sortOrder },
    });
    return response.data;
  }

  /**
   * Sube un PDF de Constancia de Situación Fiscal y devuelve campos extraídos.
   */
  async extractCSF(pdfFile: File) {
    const fd = new FormData();
    fd.append('pdf', pdfFile);
    const response = await this.client.post<APIResponse<any>>('/csf/extract', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  async getCustomer(customerId: string) {
    const response = await this.client.get<APIResponse<Customer>>(`/customers/${customerId}`);
    return response.data;
  }

  async createCustomer(data: any) {
    const response = await this.client.post<APIResponse<Customer>>('/customers', data);
    return response.data;
  }

  async updateCustomer(customerId: string, data: any) {
    const response = await this.client.put<APIResponse<any>>(
      `/customers/${customerId}`,
      data
    );
    return response.data;
  }

  async deleteCustomer(customerId: string) {
    return this.client.delete(`/customers/${customerId}`);
  }

  async deleteProduct(productId: string) {
    return this.client.delete(`/products/${productId}`);
  }

  /**
   * Warehouses endpoints (módulo ALMACEN §7)
   */
  async getWarehouses(includeInactive = false) {
    const r = await this.client.get<APIResponse<any>>('/warehouses', {
      params: { includeInactive },
    });
    return r.data;
  }

  async createWarehouse(data: { code: string; name: string; address?: string }) {
    const r = await this.client.post<APIResponse<any>>('/warehouses', data);
    return r.data;
  }

  async updateWarehouse(
    id: string,
    data: { name?: string; address?: string; isActive?: boolean; isDefault?: boolean }
  ) {
    const r = await this.client.put<APIResponse<any>>(`/warehouses/${id}`, data);
    return r.data;
  }

  async deleteWarehouse(id: string) {
    return this.client.delete(`/warehouses/${id}`);
  }

  /**
   * Inventory endpoints (módulo ALMACEN §1, §2, §7, §10)
   */
  async getInventoryStock(params?: {
    warehouseId?: string;
    search?: string;
    belowMin?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const r = await this.client.get<APIResponse<any>>('/inventory/stock', { params });
    return r.data;
  }

  async getKardex(params?: {
    productId?: string;
    warehouseId?: string;
    type?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) {
    const r = await this.client.get<APIResponse<any>>('/inventory/kardex', { params });
    return r.data;
  }

  async adjustInventory(data: {
    productId: string;
    warehouseId: string;
    direction?: 'IN' | 'OUT';
    movementType?: 'SHRINKAGE' | 'THEFT' | 'DAMAGED' | 'CUSTOMER_RETURN' | 'SUPPLIER_RETURN';
    quantity: number;
    unitCost?: number;
    reason: string;
  }) {
    const r = await this.client.post<APIResponse<any>>('/inventory/adjust', data);
    return r.data;
  }

  async transferInventory(data: {
    productId: string;
    warehouseFromId: string;
    warehouseToId: string;
    quantity: number;
    reason?: string;
  }) {
    const r = await this.client.post<APIResponse<any>>('/inventory/transfer', data);
    return r.data;
  }

  async setStockLimits(data: {
    productId: string;
    warehouseId: string;
    stockMinimum: number;
    stockMaximum: number;
  }) {
    const r = await this.client.put<APIResponse<any>>('/inventory/stock-limits', data);
    return r.data;
  }

  /**
   * Inventory reports endpoints (§12 + dashboard)
   */
  async getInventoryValue() {
    const r = await this.client.get<APIResponse<any>>('/inventory/reports/value');
    return r.data;
  }

  async getInventoryValueHistory(months = 12, warehouseId?: string) {
    const r = await this.client.get<APIResponse<any>>('/inventory/reports/value-history', {
      params: { months, warehouseId },
    });
    return r.data;
  }

  async takeInventorySnapshot() {
    const r = await this.client.post<APIResponse<any>>('/inventory/reports/snapshot');
    return r.data;
  }

  async getInventoryRotation(order: 'rotation' | 'no-movement' = 'rotation', limit = 100) {
    const r = await this.client.get<APIResponse<any>>('/inventory/reports/rotation', {
      params: { order, limit },
    });
    return r.data;
  }

  async getInventoryCountDue(all = false) {
    const r = await this.client.get<APIResponse<any>>('/inventory/reports/count-due', {
      params: { all },
    });
    return r.data;
  }

  /** Catálogo de reportes exportables (§12). */
  async getReportCatalog() {
    const r = await this.client.get<APIResponse<any>>('/inventory/reports/catalog');
    return r.data;
  }

  /**
   * Descarga un reporte de inventario en Excel o PDF. Usa axios (blob) para
   * que viaje el header de autenticación, y dispara la descarga en el navegador.
   */
  async downloadInventoryReport(
    report: string,
    format: 'xlsx' | 'pdf',
    params?: { from?: string; to?: string; warehouseId?: string }
  ) {
    const r = await this.client.get('/inventory/reports/export', {
      params: { report, format, ...params },
      responseType: 'blob',
    });
    const blob = new Blob([r.data], {
      type: format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report}-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  /**
   * Purchase orders endpoints (§3 ALMACEN — Fase 4)
   */
  async getPurchaseOrders(params?: { status?: string; warehouseId?: string; limit?: number }) {
    const r = await this.client.get<APIResponse<any>>('/purchase-orders', { params });
    return r.data;
  }

  async getPurchaseOrder(id: string) {
    const r = await this.client.get<APIResponse<any>>(`/purchase-orders/${id}`);
    return r.data;
  }

  async runReorderCheck() {
    const r = await this.client.post<APIResponse<any>>('/purchase-orders/reorder-check');
    return r.data;
  }

  async createPurchaseOrder(data: {
    warehouseId: string;
    supplierId?: string;
    neededByDate?: string;
    notes?: string;
    items: Array<{ productId: string; quantity: number }>;
  }) {
    const r = await this.client.post<APIResponse<any>>('/purchase-orders', data);
    return r.data;
  }

  async setPurchaseOrderStatus(id: string, status: string) {
    const r = await this.client.put<APIResponse<any>>(`/purchase-orders/${id}/status`, { status });
    return r.data;
  }

  async receivePurchaseOrder(
    id: string,
    receipts: Array<{ itemId: string; quantity: number; unitCost?: number }>,
    costingMethod?: 'PROMEDIO' | 'ULTIMO' | 'CAPAS'
  ) {
    const r = await this.client.post<APIResponse<any>>(`/purchase-orders/${id}/receive`, {
      receipts,
      costingMethod,
    });
    return r.data;
  }

  /**
   * POS endpoints (Fase 5 ALMACEN)
   */
  async createPosSale(data: {
    warehouseId?: string;
    paymentForm?: string;
    items: Array<{ productId: string; quantity: number; unitPrice?: number }>;
  }) {
    const r = await this.client.post<APIResponse<any>>('/pos/sales', data);
    return r.data;
  }

  async getPosSales(date?: string) {
    const r = await this.client.get<APIResponse<any>>('/pos/sales', { params: { date } });
    return r.data;
  }

  async cancelPosSale(id: string) {
    const r = await this.client.post<APIResponse<any>>(`/pos/sales/${id}/cancel`);
    return r.data;
  }

  async closePosDay(date?: string) {
    const r = await this.client.post<APIResponse<any>>('/pos/close-day', { date });
    return r.data;
  }

  /**
   * Envía por correo los archivos seleccionados (PDF y XML de factura, NCs y pagos).
   * El backend usa el `contact_email` de la empresa emisora como remitente si está
   * configurado; si no, cae al MAIL_FROM del env.
   */
  async sendInvoiceMail(invoiceId: string, body: {
    to: string;
    cc?: string;
    subject: string;
    message: string;
    attachments: Array<{ kind: string; id: string }>;
  }) {
    const r = await this.client.post(`/invoices/${invoiceId}/send-email`, body);
    return r.data;
  }

  /**
   * Products endpoints
   */
  async getProducts(page: number = 1, limit: number = 10, search?: string) {
    const response = await this.client.get<APIResponse<any>>('/products', {
      params: { page, limit, search },
    });
    return response.data;
  }

  async getProduct(productId: string) {
    const response = await this.client.get<APIResponse<Product>>(`/products/${productId}`);
    return response.data;
  }

  async createProduct(data: any) {
    const response = await this.client.post<APIResponse<Product>>('/products', data);
    return response.data;
  }

  async updateProduct(productId: string, data: any) {
    const response = await this.client.put<APIResponse<Product>>(`/products/${productId}`, data);
    return response.data;
  }

  /**
   * CFDI endpoints
   */
  async generateCFDI(invoiceId: string) {
    const response = await this.client.post(`/cfdi/${invoiceId}/generate`);
    return response.data;
  }

  async getCFDIStatus(invoiceId: string) {
    const response = await this.client.get(`/cfdi/${invoiceId}/status`);
    return response.data;
  }

  async getCFDIXML(invoiceId: string) {
    const response = await this.client.get(`/cfdi/${invoiceId}/xml`, {
      responseType: 'blob',
    });
    return response.data;
  }

  async generatePDF(invoiceId: string) {
    // GET evita el body 'null' que axios serializa en POSTs sin data y que
    // express.json() rechaza con "Unexpected token 'n', 'null' is not valid JSON".
    const response = await this.client.get(`/cfdi/${invoiceId}/pdf`, {
      responseType: 'blob',
    });
    return response.data;
  }

  async previewPDF(invoiceId: string) {
    const response = await this.client.get(`/cfdi/${invoiceId}/pdf/preview`, {
      responseType: 'blob',
    });
    return response.data;
  }

  /**
   * SAT Validator endpoints
   */
  async validateWithSAT(invoiceId: string) {
    const response = await this.client.post(`/sat-validator/validate/${invoiceId}`);
    return response.data;
  }

  async getSATValidationStatus(invoiceId: string) {
    const response = await this.client.get(`/sat-validator/status/${invoiceId}`);
    return response.data;
  }

  async getSATValidationStats() {
    const response = await this.client.get('/sat-validator/stats');
    return response.data;
  }

  /**
   * Reports endpoints
   */
  async getCollectionsReport() {
    const response = await this.client.get('/reports/collections');
    return response.data;
  }

  /** Reporte de cobranza detallado — facturas por cliente con saldo > 0.20. */
  async getReceivablesReport(customerId?: string) {
    const response = await this.client.get('/reports/receivables', {
      params: customerId ? { customerId } : {},
    });
    return response.data;
  }

  /** PDF del reporte de cobranza (misma URL, filtro opcional por cliente). */
  receivablesPDFUrl(customerId?: string): string {
    const base = `${this.client.defaults.baseURL}/reports/receivables/pdf`;
    return customerId ? `${base}?customerId=${customerId}` : base;
  }

  async getSalesReport(dateFrom?: string, dateTo?: string) {
    const response = await this.client.get('/reports/sales', {
      params: { dateFrom, dateTo },
    });
    return response.data;
  }

  async getTaxReport(dateFrom?: string, dateTo?: string) {
    const response = await this.client.get('/reports/tax', {
      params: { dateFrom, dateTo },
    });
    return response.data;
  }

  async getStatusReport() {
    const response = await this.client.get('/reports/status');
    return response.data;
  }

  async getDashboardMetrics() {
    const response = await this.client.get('/reports/dashboard');
    return response.data;
  }

  /**
   * PAC endpoints (timbrado - MODO MOCK)
   */
  async stampInvoice(invoiceId: string) {
    const response = await this.client.post(`/pac/stamp/${invoiceId}`);
    return response.data;
  }

  async cancelInvoice(
    invoiceId: string,
    motivo: string,
    folioSustitucion?: string,
    forceLocal?: boolean
  ) {
    const response = await this.client.post(`/pac/cancel/${invoiceId}`, {
      motivo,
      folioSustitucion,
      forceLocal,
    });
    return response.data;
  }

  async cancelPayment(paymentId: string, motivo?: string) {
    const response = await this.client.post(`/payments/${paymentId}/cancel`, { motivo });
    return response.data;
  }

  async cancelCreditNote(creditNoteId: string, motivo?: string) {
    const response = await this.client.post(`/credit-notes/${creditNoteId}/cancel`, { motivo });
    return response.data;
  }

  async getPACAccountStatus() {
    const response = await this.client.get('/pac/account-status');
    return response.data;
  }

  async getPACProviders() {
    const response = await this.client.get('/pac/providers');
    return response.data;
  }

  /**
   * Catálogos SAT (regimenFiscal | usoCfdi | estado | formaPago | ...)
   */
  async getCatalog(name: string) {
    const response = await this.client.get(`/catalogs/${name}`);
    return response.data;
  }

  /** Próximo SKU automático "P-N" */
  async getNextProductSku() {
    const r = await this.client.get(`/products/next-sku`);
    return r.data;
  }

  /** Búsqueda SAT para autocompletar combos (type=prodserv|unidad) */
  async searchSAT(type: 'prodserv' | 'unidad', q: string, limit = 20) {
    const r = await this.client.get(`/products/sat-search`, { params: { type, q, limit } });
    return r.data;
  }

  /** Sube uno o varios XMLs de CFDI para alimentar el catálogo de productos */
  async importProductsFromXML(files: File[]) {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    const r = await this.client.post(`/products/import-xml`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return r.data;
  }

  /** Memoria cliente↔productos (qué productos compra cada cliente) */
  async getCustomerProducts(customerId: string) {
    const r = await this.client.get(`/customers/${customerId}/products`);
    return r.data;
  }

  /**
   * Empresa emisora — leer y actualizar datos del emisor
   */
  async getCompany(id: string) {
    const response = await this.client.get(`/companies/${id}`);
    return response.data;
  }

  async updateCompany(id: string, data: any) {
    const response = await this.client.put(`/companies/${id}`, data);
    return response.data;
  }

  /** Sube logo de la empresa (multipart) */
  async uploadCompanyLogo(id: string, file: File) {
    const fd = new FormData();
    fd.append('logo', file);
    const r = await this.client.post(`/companies/${id}/logo`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return r.data;
  }

  /** Sube CSD (.cer + .key + contraseña) para timbrar */
  async uploadCompanyCSD(id: string, cer: File, key: File, password: string) {
    const fd = new FormData();
    fd.append('cer', cer);
    fd.append('key', key);
    fd.append('password', password);
    const r = await this.client.post(`/companies/${id}/csd`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return r.data;
  }

  /** Estatus de subidas (qué tiene el emisor cargado) */
  async getCompanyUploadStatus(id: string) {
    const r = await this.client.get(`/companies/${id}/csd-status`);
    return r.data;
  }

  /**
   * URL pública del logo — para usar directo en `<img src>`.
   * Usa el mismo baseURL configurado en el cliente axios, así funciona:
   *   · Dev: proxy Vite → localhost:3000
   *   · Prod: apunta al backend en Render (VITE_API_BASE)
   */
  companyLogoUrl(id: string) {
    const base = this.client.defaults.baseURL || '/api/v1';
    return `${base}/public/companies/${id}/logo?t=${Date.now()}`;
  }

  /* ───────────── Complemento de Pago ───────────── */

  async createPayment(data: {
    invoiceId: string;
    paymentAmount: number;
    paymentDate?: string;
    paymentForm: string;
    paymentMethod?: string;
    currency?: string;
    notes?: string;
  }) {
    const r = await this.client.post('/payments', data);
    return r.data;
  }

  async listPayments() {
    const r = await this.client.get('/payments');
    return r.data;
  }

  async getInvoicePayments(invoiceId: string) {
    const r = await this.client.get(`/payments/by-invoice/${invoiceId}`);
    return r.data;
  }

  async paymentPDF(paymentId: string, inline = false) {
    const r = await this.client.get(`/payments/${paymentId}/pdf${inline ? '?inline=1' : ''}`, {
      responseType: 'blob',
    });
    return r.data;
  }

  async paymentXML(paymentId: string) {
    const r = await this.client.get(`/payments/${paymentId}/xml`, { responseType: 'blob' });
    return r.data;
  }

  async creditNotePDF(noteId: string, inline = false) {
    const r = await this.client.get(`/credit-notes/${noteId}/pdf${inline ? '?inline=1' : ''}`, {
      responseType: 'blob',
    });
    return r.data;
  }

  async creditNoteXML(noteId: string) {
    const r = await this.client.get(`/credit-notes/${noteId}/xml`, { responseType: 'blob' });
    return r.data;
  }

  /* ───────────── Notas de Crédito ───────────── */

  async getCreditNoteMotivos() {
    const r = await this.client.get('/credit-notes/motivos');
    return r.data;
  }

  async listCreditNotes() {
    const r = await this.client.get('/credit-notes');
    return r.data;
  }

  async createCreditNote(data: {
    customerId: string;
    invoiceId: string;
    tipoRelacion?: string;
    motivo?: string;
    amount?: number;
    discountPercent?: number;
    iva?: number;
    currency?: string;
    applyToInvoice?: boolean;
  }) {
    const r = await this.client.post('/credit-notes', data);
    return r.data;
  }

  async getInvoiceBalance(invoiceId: string) {
    const r = await this.client.get(`/invoices/${invoiceId}/balance`);
    return r.data;
  }

  async getDashboardSummary() {
    const r = await this.client.get('/invoices/dashboard/summary');
    return r.data;
  }

  /** Consumo de timbres del mes en curso vs cap del plan (iguala = 100). */
  async getMonthlyUsage() {
    const r = await this.client.get('/archive/usage/current-month');
    return r.data;
  }

  /** Solo ADMIN — descarga paquete fiscal de una compañía específica. */
  async adminDownloadPackage(opts: {
    companyId: string;
    from?: string; to?: string;
    format?: 'xml' | 'both';
    limit?: number;
  }) {
    const params = new URLSearchParams({
      companyId: opts.companyId,
      format: opts.format || 'xml',
      limit:  String(opts.limit || 100),
      ...(opts.from ? { from: opts.from } : {}),
      ...(opts.to   ? { to:   opts.to   } : {}),
    });
    const r = await this.client.get(`/archive/admin/invoices.zip?${params.toString()}`, {
      responseType: 'blob',
    });
    return r.data;
  }

  /** Listado de compañías — solo ADMIN. Si el backend aún no lo expone, lo pedimos por SQL helper. */
  async listCompanies() {
    const r = await this.client.get('/companies').catch(() => null);
    return r?.data || { data: { companies: [] } };
  }

  /* ───────────── SUPER ADMIN ───────────── */
  async adminListUsers(params: { search?: string; companyId?: string; limit?: number } = {}) {
    const r = await this.client.get('/admin/users', { params });
    return r.data;
  }
  async adminCreateUser(data: { email: string; firstName: string; lastName: string; role: string; companyId?: string; workGroup?: string }) {
    const r = await this.client.post('/admin/users', data);
    return r.data;
  }
  async adminUpdateUser(id: string, data: any) {
    const r = await this.client.put(`/admin/users/${id}`, data);
    return r.data;
  }
  async adminResetPassword(id: string) {
    const r = await this.client.post(`/admin/users/${id}/reset-password`, {});
    return r.data;
  }
  async adminDisableUser(id: string) {
    const r = await this.client.post(`/admin/users/${id}/disable`, {});
    return r.data;
  }
  async adminEnableUser(id: string) {
    const r = await this.client.post(`/admin/users/${id}/enable`, {});
    return r.data;
  }
  async adminImpersonate(id: string) {
    const r = await this.client.post(`/admin/users/${id}/impersonate`, {});
    return r.data;
  }

  /* ───────────── CFDI Import (XML wizard) ───────────── */
  async cfdiPreview(xmlBase64: string) {
    const r = await this.client.post('/cfdi-import/preview', { xmlBase64 });
    return r.data;
  }
  async cfdiCommit(payload: any) {
    const r = await this.client.post('/cfdi-import/commit', payload);
    return r.data;
  }
  async cfdiImportHistory() {
    const r = await this.client.get('/cfdi-import/history?limit=50');
    return r.data;
  }

  /* ───────────── Proveedores ───────────── */
  async updateSupplierCredit(id: string, data: {
    creditDays?: number;
    creditLine?: number;
    paymentConditions?: string;
    supplierRating?: number;
    deliveryDaysAvg?: number;
  }) {
    const r = await this.client.put<APIResponse<any>>(`/suppliers/${id}/credit`, data);
    return r.data;
  }

  /* ───────────── Tesorería (Fase 6 ALMACEN) ───────────── */
  async getTreasuryPayments(params?: { status?: string; supplierId?: string; from?: string; to?: string }) {
    const r = await this.client.get<APIResponse<any>>('/treasury/payments', { params });
    return r.data;
  }
  async getTreasurySummary() {
    const r = await this.client.get<APIResponse<any>>('/treasury/summary');
    return r.data;
  }
  async createTreasuryPayment(data: { supplierId: string; amount: number; dueDate: string; notes?: string }) {
    const r = await this.client.post<APIResponse<any>>('/treasury/payments', data);
    return r.data;
  }
  async payTreasuryPayment(id: string, data?: { paidAt?: string; notes?: string }) {
    const r = await this.client.post<APIResponse<any>>(`/treasury/payments/${id}/pay`, data || {});
    return r.data;
  }
  async rescheduleTreasuryPayment(id: string, dueDate: string) {
    const r = await this.client.put<APIResponse<any>>(`/treasury/payments/${id}/reschedule`, { dueDate });
    return r.data;
  }
  async cancelTreasuryPayment(id: string, motivo?: string) {
    const r = await this.client.post<APIResponse<any>>(`/treasury/payments/${id}/cancel`, { motivo });
    return r.data;
  }

  /* ───────────── Equipo / capacidades (Fase 8 ALMACEN §8) ───────────── */
  async getTeamCapabilities() {
    const r = await this.client.get<APIResponse<any>>('/team/capabilities');
    return r.data;
  }
  async getTeamUsers() {
    const r = await this.client.get<APIResponse<any>>('/team/users');
    return r.data;
  }
  async setUserCapabilities(userId: string, capabilities: string[]) {
    const r = await this.client.put<APIResponse<any>>(`/team/users/${userId}/capabilities`, { capabilities });
    return r.data;
  }
  async createTeamUser(data: { email: string; password: string; firstName: string; lastName?: string; role: string; workGroup: string; }) {
    const r = await this.client.post<APIResponse<any>>('/team/users', data);
    return r.data;
  }
  async updateTeamUser(userId: string, data: any) {
    const r = await this.client.patch<APIResponse<any>>(`/team/users/${userId}`, data);
    return r.data;
  }
  async deleteTeamUser(userId: string) {
    const r = await this.client.delete<APIResponse<any>>(`/team/users/${userId}`);
    return r.data;
  }

  /* ───────────── Inventario físico (Fase 6 ALMACEN §11) ───────────── */
  async getPhysicalCounts() {
    const r = await this.client.get<APIResponse<any>>('/physical-counts');
    return r.data;
  }
  async getPhysicalCount(id: string) {
    const r = await this.client.get<APIResponse<any>>(`/physical-counts/${id}`);
    return r.data;
  }
  async openPhysicalCount(data: { warehouseId: string; category?: string; notes?: string }) {
    const r = await this.client.post<APIResponse<any>>('/physical-counts', data);
    return r.data;
  }
  async capturePhysicalCount(id: string, items: Array<{ itemId: string; countedQty: number }>) {
    const r = await this.client.put<APIResponse<any>>(`/physical-counts/${id}/capture`, { items });
    return r.data;
  }
  async closePhysicalCount(id: string) {
    const r = await this.client.post<APIResponse<any>>(`/physical-counts/${id}/close`);
    return r.data;
  }
  async cancelPhysicalCount(id: string) {
    const r = await this.client.post<APIResponse<any>>(`/physical-counts/${id}/cancel`);
    return r.data;
  }

  /* ───────────── Proveedores (read-only) ───────────── */
  async listSuppliers(params: { search?: string; limit?: number } = {}) {
    const r = await this.client.get('/suppliers', { params });
    return r.data;
  }
  async getSupplier(id: string) {
    const r = await this.client.get(`/suppliers/${id}`);
    return r.data;
  }
  async getSupplierBanks() {
    const r = await this.client.get('/suppliers/banks');
    return r.data;
  }
  async createSupplier(data: any) {
    const r = await this.client.post('/suppliers', data);
    return r.data;
  }
  async updateSupplier(id: string, data: any) {
    const r = await this.client.put(`/suppliers/${id}`, data);
    return r.data;
  }

  async adminListCompanies(params: { search?: string } = {}) {
    const r = await this.client.get('/admin/companies', { params });
    return r.data;
  }
  async adminCreateCompany(data: { rfc: string; businessName: string; fiscalRegime: string;
                                   postalCode?: string; billingPlan?: string; capTimbres?: number;
                                   monthlyFee?: number; extraStampFee?: number;
                                   stampPackageCode?: string }) {
    const r = await this.client.post('/admin/companies', data);
    return r.data;
  }
  async adminUpdateCompany(id: string, data: any) {
    const r = await this.client.put(`/admin/companies/${id}`, data);
    return r.data;
  }
  async adminUploadCSD(id: string, data: { noCertificado: string; cerBase64: string;
                                            keyBase64: string; keyPassword: string;
                                            validFrom?: string; validTo?: string }) {
    const r = await this.client.post(`/admin/companies/${id}/csd`, data);
    return r.data;
  }
  async adminDeleteCSD(id: string) {
    const r = await this.client.delete(`/admin/companies/${id}/csd`);
    return r.data;
  }
  /**
   * Preview server-side de lo que se borraría (no ejecuta). Requiere el RFC
   * exacto — el backend valida y devuelve un 400 si no coincide.
   */
  async adminFullDeleteCompanyDryRun(id: string, confirmRfc: string) {
    const r = await this.client.delete(`/admin/companies/${id}/full-delete`, {
      data: { confirmRfc, dryRun: true },
    });
    return r.data;
  }
  /**
   * Borrado TOTAL — requiere confirmRfc + confirmText="ELIMINAR" en el body.
   * Doble validación server-side. No hay rollback.
   */
  async adminFullDeleteCompany(id: string, body: { confirmRfc: string; confirmText: string }) {
    const r = await this.client.delete(`/admin/companies/${id}/full-delete`, { data: body });
    return r.data;
  }

  /* ────── Facturación y consumo (SUPER_ADMIN) ────── */

  async adminBillingCurrentMonth() {
    const r = await this.client.get('/admin/billing/current-month');
    return r.data;
  }
  async adminBillingHistory(year: number) {
    const r = await this.client.get('/admin/billing/history', { params: { year } });
    return r.data;
  }
  async adminBillingCompanyHistory(companyId: string) {
    const r = await this.client.get(`/admin/billing/company/${companyId}/history`);
    return r.data;
  }
  async adminBillingCloseMonth(period?: string) {
    const r = await this.client.post('/admin/billing/close-month', period ? { period } : {});
    return r.data;
  }
  async adminBillingMarkPaid(invoicingId: string) {
    const r = await this.client.patch(`/admin/billing/${invoicingId}/mark-paid`);
    return r.data;
  }
  async adminBillingIssueInvoice(invoicingId: string) {
    const r = await this.client.post(`/admin/billing/${invoicingId}/issue-invoice`);
    return r.data;
  }

  /* ────── Prepago FLEX (SUPER_ADMIN) ────── */

  async adminPrepaidBalances() {
    const r = await this.client.get('/admin/prepaid/balances');
    return r.data;
  }
  async adminPrepaidPurchases(companyId: string) {
    const r = await this.client.get(`/admin/prepaid/${companyId}/purchases`);
    return r.data;
  }
  async adminPrepaidRecharge(companyId: string, body: {
    stampsBought: number;
    unitPriceMxn?: number;
    paymentMethod?: string;
    paymentReference?: string;
    notes?: string;
  }) {
    const r = await this.client.post(`/admin/prepaid/${companyId}/recharge`, body);
    return r.data;
  }
  async adminPrepaidSetThreshold(companyId: string, threshold: number) {
    const r = await this.client.patch(`/admin/prepaid/${companyId}/threshold`, { threshold });
    return r.data;
  }

  /* ────── Manifiesto PAC (firma con e.firma) ────── */

  async getManifestStatus() {
    const r = await this.client.get('/manifest');
    return r.data;
  }
  async getManifestText() {
    const r = await this.client.get('/manifest/text');
    return r.data;
  }
  async signManifest(body: { cerB64: string; keyB64: string; password: string }) {
    const r = await this.client.post('/manifest/sign', body);
    return r.data;
  }
  async manifestPdf() {
    const r = await this.client.get('/manifest/pdf', { responseType: 'blob' });
    return r.data as Blob;
  }
  async adminCompanyUsage(id: string) {
    const r = await this.client.get(`/admin/companies/${id}/usage`);
    return r.data;
  }
  async adminAuditLog(params: { userId?: string; action?: string; limit?: number } = {}) {
    const r = await this.client.get('/admin/audit', { params });
    return r.data;
  }

  /* ─── Carta Porte 3.1 ─── */
  async searchCartaPorteCatalog(name: string, q: string, limit = 50) {
    const res = await this.client.get<{ items: Array<{ clave: string; descripcion: string; [k: string]: any }> }>(
      `/carta-porte/catalogs/${name}`,
      { params: { q, limit } },
    );
    return res.data;
  }
  /* ─── Carta Porte: Resolver CP → colonias ─── */
  async resolveCP(cp: string) {
    const res = await this.client.get<{ codigoPostal: string; colonias: Array<{ clave: string; descripcion: string; codigo_postal: string }> }>(`/carta-porte/cp/${cp}`);
    return res.data;
  }

  /* ─── Carta Porte: Lugares frecuentes ─── */
  async listCPLugares(q?: string, tipo?: string) {
    const res = await this.client.get<{ items: any[] }>('/carta-porte/lugares', { params: { q, tipo } });
    return res.data.items || [];
  }
  async createCPLugar(data: any) {
    const res = await this.client.post<any>('/carta-porte/lugares', data);
    return res.data;
  }
  async updateCPLugar(id: string, data: any) {
    const res = await this.client.patch<any>(`/carta-porte/lugares/${id}`, data);
    return res.data;
  }
  async deleteCPLugar(id: string) {
    const res = await this.client.delete<{ removed: number }>(`/carta-porte/lugares/${id}`);
    return res.data;
  }

  /* ─── CP: Importador XML ─── */
  async cpImportPreview(xml: string) {
    const r = await this.client.post<any>('/carta-porte/importar-xml/preview', { xml });
    return r.data;
  }
  async cpImportApply(payload: any) {
    const r = await this.client.post<any>('/carta-porte/importar-xml/apply', payload);
    return r.data;
  }

  /* ─── CP: Vehículos ─── */
  async listCPVehiculos(q?: string) {
    const r = await this.client.get<{ items: any[] }>('/carta-porte/vehiculos', { params: { q } });
    return r.data.items || [];
  }
  async createCPVehiculo(data: any) { return (await this.client.post<any>('/carta-porte/vehiculos', data)).data; }
  async updateCPVehiculo(id: string, data: any) { return (await this.client.patch<any>(`/carta-porte/vehiculos/${id}`, data)).data; }
  async deleteCPVehiculo(id: string) { return (await this.client.delete<any>(`/carta-porte/vehiculos/${id}`)).data; }

  /* ─── CP: Aseguradoras ─── */
  async listCPAseguradoras(q?: string, tipo?: string) {
    const r = await this.client.get<{ items: any[] }>('/carta-porte/aseguradoras', { params: { q, tipo } });
    return r.data.items || [];
  }
  async createCPAseguradora(data: any) { return (await this.client.post<any>('/carta-porte/aseguradoras', data)).data; }
  async updateCPAseguradora(id: string, data: any) { return (await this.client.patch<any>(`/carta-porte/aseguradoras/${id}`, data)).data; }
  async deleteCPAseguradora(id: string) { return (await this.client.delete<any>(`/carta-porte/aseguradoras/${id}`)).data; }

  /* ─── CP: Operadores ─── */
  async listCPOperadores(q?: string, tipo?: string) {
    const r = await this.client.get<{ items: any[] }>('/carta-porte/operadores', { params: { q, tipo } });
    return r.data.items || [];
  }
  async createCPOperador(data: any) { return (await this.client.post<any>('/carta-porte/operadores', data)).data; }
  async updateCPOperador(id: string, data: any) { return (await this.client.patch<any>(`/carta-porte/operadores/${id}`, data)).data; }
  async deleteCPOperador(id: string) { return (await this.client.delete<any>(`/carta-porte/operadores/${id}`)).data; }

  async listCartaPorte() {
    const res = await this.client.get<{ items: any[] }>(`/carta-porte/list`);
    return res.data;
  }
  async getCartaPorte(invoiceId: string) {
    const res = await this.client.get<{ cartaPorte: any }>(`/invoices/${invoiceId}/carta-porte`);
    return res.data.cartaPorte;
  }
  async saveCartaPorte(invoiceId: string, data: any) {
    const res = await this.client.put<{ id: number }>(`/invoices/${invoiceId}/carta-porte`, data);
    return res.data;
  }
  async deleteCartaPorte(invoiceId: string) {
    const res = await this.client.delete<{ removed: number }>(`/invoices/${invoiceId}/carta-porte`);
    return res.data;
  }

  /**
   * Utility methods
   */
  async downloadFile(blob: Blob, filename: string) {
    // Aseguramos un tipo MIME válido — algunos navegadores ignoran download
    // si el Blob viene sin type (lo tratan como "navigate" en el mismo tab).
    const fixed = blob.type
      ? blob
      : new Blob([blob], {
          type: filename.endsWith('.xml')
            ? 'application/xml'
            : filename.endsWith('.pdf')
              ? 'application/pdf'
              : 'application/octet-stream',
        });
    const url = window.URL.createObjectURL(fixed);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Liberamos el ObjectURL tras un breve delay para no abortar la descarga
    setTimeout(() => window.URL.revokeObjectURL(url), 4000);
  }
}

export const api = new APIClient();
export default api;
