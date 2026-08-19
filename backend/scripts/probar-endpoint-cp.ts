/**
 * probar-endpoint-cp — que el ENDPOINT devuelva lo que la pantalla espera.
 *
 * POR QUÉ HACÍA FALTA
 * El catálogo estaba bien y la consulta directa a la tabla devolvía las cuatro
 * colonias del CP 20900. Aun así el combo salía vacío, y tardamos varias
 * vueltas en ver por qué: el endpoint responde el objeto DIRECTO —{ colonias,
 * estado, … }— mientras el resto de la API responde { success, data }, y la
 * pantalla lo leía como si llevara envoltorio. `undefined.colonias` se ve
 * exactamente igual que "no hay colonias".
 *
 * Probar la tabla no bastaba: había que probar la FORMA de la respuesta, que
 * es lo que consume la pantalla.
 *
 *   npx ts-node -r dotenv/config scripts/probar-endpoint-cp.ts
 *
 * Pega contra el backend que ya está corriendo. No escribe nada.
 */
import { pool, query } from '../src/config/database';
import jwt from 'jsonwebtoken';

/* Contra el backend que YA está corriendo, no contra uno de mentiras: lo que
 * importa es la respuesta que recibe el navegador. Se le puede pasar otra URL
 * para probar producción:
 *   npx ts-node -r dotenv/config scripts/probar-endpoint-cp.ts https://…  */
const BASE = (process.argv[2] || `http://localhost:${process.env.APP_PORT || 3001}`)
  .replace(/\/+$/, '');

let ok = 0, fallos = 0;
const bien = (q: string) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q: string, d?: any) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };

async function main() {
  const u = await query<any>(
    `SELECT u.id, u.email, u.role, u.company_id
       FROM users u
      WHERE u.company_id IS NOT NULL AND u.deleted_at IS NULL
      ORDER BY u.created_at LIMIT 1`
  );
  if (u.rows.length === 0) {
    console.log('No hay usuarios de empresa en esta base.');
    await pool.end();
    return;
  }
  const usuario = u.rows[0];

  const token = jwt.sign(
    { userId: usuario.id, email: usuario.email, role: usuario.role, companyId: usuario.company_id },
    process.env.JWT_SECRET || 'dev-secret',
    { expiresIn: '5m' }
  );

  const r = await fetch(`${BASE}/api/v1/carta-porte/cp/20900`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const res = { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  console.log(`
  ${BASE}  ·  como ${usuario.email}
`);

  res.status === 200
    ? bien(`el endpoint responde 200 como ${usuario.email}`)
    : mal(`el endpoint respondió ${res.status}`, JSON.stringify(res.body).slice(0, 160));

  const cuerpo = res.body || {};

  /* La forma, que es lo que consume la pantalla. */
  Array.isArray(cuerpo.colonias)
    ? bien('la respuesta trae `colonias` en la RAÍZ, sin envoltorio { data }')
    : mal('la respuesta no trae colonias en la raíz', Object.keys(cuerpo).join(', '));

  cuerpo.data === undefined
    ? bien('y NO trae `data` — leerlo con .data devolvía undefined')
    : mal('ahora sí trae envoltorio: la pantalla hay que revisarla');

  (cuerpo.colonias?.length || 0) > 0
    ? bien(`${cuerpo.colonias.length} colonias del CP 20900 — ` +
           cuerpo.colonias.slice(0, 2).map((c: any) => c.descripcion).join(', '))
    : mal('el endpoint devolvió cero colonias para el 20900');

  cuerpo.colonias?.[0]?.descripcion && !/^\d{5}$/.test(cuerpo.colonias[0].descripcion)
    ? bien('cada colonia trae su NOMBRE en `descripcion`, no el código postal')
    : mal('la descripción no es un nombre', JSON.stringify(cuerpo.colonias?.[0]));

  cuerpo.estado
    ? bien(`el estado sale del CP: ${cuerpo.estado}` +
           (cuerpo.estadoDescripcion ? ` (${cuerpo.estadoDescripcion})` : ''))
    : mal('no resolvió el estado');

  (cuerpo.municipios?.length || 0) > 0
    ? bien(`${cuerpo.municipios.length} municipios para el combo`)
    : mal('no trae municipios');

  console.log(`\n${ok} bien, ${fallos} mal\n`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
