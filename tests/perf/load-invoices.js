/**
 * k6 load test — 10 clientes concurrentes generando facturas.
 * Ejecutar con:
 *   k6 run --env BASE_URL=http://localhost:3000 tests/perf/load-invoices.js
 *
 * Objetivo: validar SLA con carga esperada real (10 clientes × ~30 fac/día ≈ 0.04 tx/s).
 * Ejercitamos 100 × ese target = 4 tx/s durante 5 min para tener margen.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const loginTime  = new Trend('login_ms');
const listTime   = new Trend('list_invoices_ms');
const createTime = new Trend('create_invoice_ms');
const pdfTime    = new Trend('pdf_ms');
const errorRate  = new Rate('errors');

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: 4, timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 0, timeUnit: '1s',
      startTime: '5m',
      stages: [
        { duration: '30s', target: 20 },   // 5× la carga esperada
        { duration: '2m',  target: 20 },
        { duration: '30s', target: 0 },
      ],
      preAllocatedVUs: 30, maxVUs: 80,
    },
  },
  thresholds: {
    'login_ms':          ['p(95)<800'],
    'list_invoices_ms':  ['p(95)<600'],
    'create_invoice_ms': ['p(95)<1200'],
    'pdf_ms':            ['p(95)<1500'],
    'errors':            ['rate<0.01'],
    'http_req_failed':   ['rate<0.01'],
  },
};

function jsonHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export default function () {
  // Login
  const t0 = Date.now();
  const loginR = http.post(`${BASE}/api/v1/auth/login`,
    JSON.stringify({ email: 'admin.demo@gdmfac.mx', password: 'Cap4citAcion!' }),
    { headers: { 'Content-Type': 'application/json' }});
  loginTime.add(Date.now() - t0);
  const loginOK = check(loginR, { 'login 200': (r) => r.status === 200 });
  if (!loginOK) { errorRate.add(1); return; }
  const token = loginR.json('data.token');

  // Listar
  const tL = Date.now();
  const listR = http.get(`${BASE}/api/v1/invoices?limit=25`, { headers: jsonHeaders(token) });
  listTime.add(Date.now() - tL);
  check(listR, { 'list 200': (r) => r.status === 200 });

  // Crear factura
  const custR = http.get(`${BASE}/api/v1/customers?limit=1`, { headers: jsonHeaders(token) });
  const prodR = http.get(`${BASE}/api/v1/products?limit=1`,  { headers: jsonHeaders(token) });
  const cust = custR.json('data.customers.0.id');
  const prod = prodR.json('data.products.0.id');
  if (!cust || !prod) { errorRate.add(1); return; }

  const tC = Date.now();
  const cR = http.post(`${BASE}/api/v1/invoices`, JSON.stringify({
    customerId: cust, cfdiType: 'I', paymentForm: '03', paymentMethod: 'PUE', cfdiUse: 'G03',
    items: [{ productId: prod, quantity: 1, unitPrice: 100, taxPresetId: 'iva16' }],
  }), { headers: jsonHeaders(token) });
  createTime.add(Date.now() - tC);
  const created = check(cR, { 'create 200/201': (r) => r.status < 300 });
  if (!created) { errorRate.add(1); return; }
  const invId = cR.json('data.id');

  // PDF
  const tP = Date.now();
  const pdfR = http.get(`${BASE}/api/v1/cfdi/${invId}/pdf`, { headers: jsonHeaders(token) });
  pdfTime.add(Date.now() - tP);
  check(pdfR, { 'pdf 200': (r) => r.status === 200 });

  sleep(0.5);
}
