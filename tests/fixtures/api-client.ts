/**
 * Cliente HTTP autenticado para los tests — evita repetir login y exposes
 * helpers para crear customer/product/invoice y limpiar el sandbox.
 */
import { APIRequestContext, request } from '@playwright/test';
import { API_URL, USERS } from './test-data';

export interface AuthedClient {
  ctx: APIRequestContext;
  token: string;
  companyId: string;
}

export async function login(email = USERS.manager.email, password = USERS.manager.password): Promise<AuthedClient> {
  // Sin baseURL — paths absolutos para evitar la trampa de URL() que
  // descarta "/api/v1" cuando el path empieza con "/".
  const ctx = await request.newContext();
  const r = await ctx.post(`${API_URL}/auth/login`, { data: { email, password } });
  if (!r.ok()) throw new Error(`Login HTTP ${r.status()}: ${await r.text()}`);
  const body = await r.json();
  const token = body?.data?.token;
  const companyId = body?.data?.user?.companyId;
  if (!token) throw new Error('Login no devolvió token');
  return {
    ctx: await request.newContext({
      baseURL: API_URL.endsWith('/') ? API_URL : API_URL + '/',
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    }),
    token,
    companyId,
  };
}

export async function createCustomer(c: AuthedClient, name: string, rfc: string, regimen = '601') {
  const r = await c.ctx.post('customers', {
    data: {
      businessName: name,
      rfc,
      fiscalRegime: regimen,
      postalCode: '64000',
      email: `${rfc.toLowerCase()}@qa.test`,
    },
  });
  if (!r.ok()) throw new Error(`createCustomer ${r.status()}: ${await r.text()}`);
  return (await r.json()).data;
}

export async function createProduct(c: AuthedClient, opts: {
  name: string; claveSat?: string; unitCode?: string;
  basePrice?: number; taxPresetId?: string; taxRate?: number; taxType?: string;
  isExempt?: boolean; appliesIEPS?: boolean;
}) {
  const r = await c.ctx.post('products', {
    data: {
      name: opts.name,
      claveSat: opts.claveSat || '01010101',
      unitCode: opts.unitCode || 'H87',
      basePrice: opts.basePrice ?? 100,
      taxType: opts.taxType || 'IVA',
      taxRate: opts.taxRate ?? 0.16,
      taxPresetId: opts.taxPresetId || 'iva16',
      isExempt: opts.isExempt || false,
      appliesIEPS: opts.appliesIEPS || false,
      currency: 'MXN',
    },
  });
  if (!r.ok()) throw new Error(`createProduct ${r.status()}: ${await r.text()}`);
  return (await r.json()).data;
}

export async function createInvoice(c: AuthedClient, opts: {
  customerId: string;
  items: Array<{ productId: string; quantity: number; unitPrice: number; taxPresetId?: string }>;
  paymentForm?: string; paymentMethod?: string; cfdiUse?: string;
}) {
  const r = await c.ctx.post('invoices', {
    data: {
      customerId: opts.customerId,
      cfdiType: 'I',
      paymentForm: opts.paymentForm || '03',
      paymentMethod: opts.paymentMethod || 'PUE',
      cfdiUse: opts.cfdiUse || 'G03',
      items: opts.items,
    },
  });
  if (!r.ok()) throw new Error(`createInvoice ${r.status()}: ${await r.text()}`);
  return (await r.json()).data;
}

export async function getInvoiceBalance(c: AuthedClient, invoiceId: string) {
  const r = await c.ctx.get(`invoices/${invoiceId}/balance`);
  if (!r.ok()) throw new Error(`balance ${r.status()}`);
  return (await r.json()).data;
}

export async function getDashboardSummary(c: AuthedClient) {
  const r = await c.ctx.get('invoices/dashboard/summary');
  if (!r.ok()) throw new Error(`dashboard ${r.status()}`);
  return (await r.json()).data;
}
