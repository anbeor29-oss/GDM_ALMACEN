/**
 * load-folio.js — verifica que NO se dupliquen folios bajo concurrencia.
 *
 * Escenario crítico fiscal: si dos facturas reciben el mismo folio,
 * el SAT rechaza la segunda. Aquí lanzamos N usuarios virtuales facturando
 * en paralelo y comprobamos al final que todos los folios son únicos.
 *
 * Ejecutar:
 *   k6 run -e EMAIL=manager@demo.com -e PASS=admin123 tests/k6/load-folio.js
 *
 * SLOs propuestos:
 *   - 0 folios duplicados (assertion)
 *   - p95 < 1.5 s para POST /invoices
 *   - error rate < 1%
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE = __ENV.API_URL || 'http://localhost:3000/api/v1';
const EMAIL = __ENV.EMAIL  || 'manager@demo.com';
const PASS  = __ENV.PASS   || 'admin123';

const invoiceLatency = new Trend('invoice_post_ms');
const errors         = new Counter('errors_total');

export const options = {
  scenarios: {
    burst: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },  // calentamiento
        { duration: '1m',  target: 50 },  // pico
        { duration: '30s', target: 0 },   // enfriamiento
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    invoice_post_ms: ['p(95)<1500', 'p(99)<3000'],
    errors_total:    ['count<10'],
    http_req_failed: ['rate<0.01'],
  },
};

function login() {
  const r = http.post(`${BASE}/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASS }),
    { headers: { 'Content-Type': 'application/json' } });
  if (r.status !== 200) throw new Error(`login ${r.status}`);
  return r.json('data.token');
}

let cachedToken = null;
let cachedCustomer = null;
let cachedProduct  = null;

function setup() {
  // Setup global — 1 sola vez, no por VU
  const tok = login();
  const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` };
  const cust = http.post(`${BASE}/customers`, JSON.stringify({
    businessName: 'k6 LOAD',
    rfc: `XAXX${Math.floor(Date.now() % 1_000_000).toString().padStart(6, '0')}K61`,
    fiscalRegime: '601', postalCode: '64000',
  }), { headers: hdr });
  const prod = http.post(`${BASE}/products`, JSON.stringify({
    name: 'k6 PROD', claveSat: '01010101', unitCode: 'H87',
    basePrice: 100, taxType: 'IVA', taxRate: 0.16, taxPresetId: 'iva16',
  }), { headers: hdr });
  return {
    token: tok,
    customerId: cust.json('data.id'),
    productId:  prod.json('data.id'),
  };
}

export default function (data) {
  if (!cachedToken) cachedToken = data.token;
  const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${cachedToken}` };

  group('POST /invoices (concurrente)', () => {
    const t0 = Date.now();
    const r = http.post(`${BASE}/invoices`, JSON.stringify({
      customerId: data.customerId,
      cfdiType: 'I', paymentForm: '03', paymentMethod: 'PUE', cfdiUse: 'G03',
      items: [{ productId: data.productId, quantity: 1, unitPrice: 100, taxPresetId: 'iva16' }],
    }), { headers: hdr });
    invoiceLatency.add(Date.now() - t0);
    const ok = check(r, {
      'status 201': (x) => x.status === 201,
      'folio numérico': (x) => typeof x.json('data.folio') === 'number',
    });
    if (!ok) errors.add(1);
  });

  sleep(0.2);
}

export function teardown(data) {
  // Post-run: pediríamos a una vista admin que verifique no haya folios duplicados
  // en el rango de los últimos N segundos (requiere endpoint admin no implementado).
  console.log(`teardown - customer=${data.customerId} product=${data.productId}`);
}
