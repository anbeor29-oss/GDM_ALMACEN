import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * SMOKE de performance — carga mínima para detectar caídas obvias y latencia base.
 * NO es una prueba de carga real (eso requiere plan y ventana acordada).
 *
 * ⚠️  Correr SOLO contra un ambiente NO productivo y CON autorización. Lanzar carga
 *     contra la app en producción de Render puede degradar el servicio a clientes
 *     reales y consumir cuota. Ver la nota de seguridad del README.
 *
 * Uso:  API_BASE=https://<backend-no-prod> k6 run k6/smoke.js
 */
const API_BASE = __ENV.API_BASE || 'http://localhost:3000';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],    // < 1% de errores
    http_req_duration: ['p(95)<800'],  // p95 < 800 ms en /health
  },
};

export default function () {
  const res = http.get(`${API_BASE}/health`);
  check(res, {
    'status 200': (r) => r.status === 200,
    'dice OK': (r) => r.json('status') === 'OK',
  });
  sleep(1);
}
