/**
 * probar-catalogo-cp — que un código postal resuelva su domicilio.
 *
 * Es la comprobación que faltaba cuando se sembraron los catálogos: nadie
 * verificó que un CP real devolviera sus colonias, y el cruce de columnas
 * sobrevivió meses. Afecta al expediente del trabajador, a los Lugares de
 * Carta Porte, al importador de XML y al PDF de facturas — todo lo que
 * resuelve un domicilio.
 *
 *   npx ts-node -r dotenv/config scripts/probar-catalogo-cp.ts
 *
 * No escribe nada.
 */
import { pool, query } from '../src/config/database';

let ok = 0, fallos = 0;
const bien = (q: string) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q: string, d?: any) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };

async function main() {
  /* ── Primero: ¿hay catálogo? ──
   *
   * Hay DOS fallas distintas que se ven IGUAL desde la pantalla —el combo sale
   * vacío— y piden remedios opuestos:
   *
   *   · la tabla VACÍA     → el seed de catálogos nunca corrió en esta base
   *   · la tabla CRUZADA   → el seed corrió pero con las columnas al revés, y
   *                          falta la migración 2026-08-18e
   *
   * Distinguirlas aquí evita perseguir la equivocada, que es lo que costó la
   * última vuelta: se buscó el cruce donde el problema era que no había datos. */
  const cuantas = await query<any>(`SELECT COUNT(*)::int n FROM sat_cp_colonia`);
  const total = cuantas.rows[0].n;
  console.log(`\nsat_cp_colonia: ${total.toLocaleString('es-MX')} filas\n`);

  if (total === 0) {
    mal('la tabla de colonias está VACÍA — el seed nunca corrió en esta base');
    console.log(
      '\n  No es un problema de columnas cruzadas: no hay nada que cruzar.\n' +
      '  Siembra los catálogos y vuelve a correr esta prueba:\n\n' +
      '      npm run cp:seed\n'
    );
    await pool.end();
    process.exit(1);
  }

  /* CPs de estados distintos, para que no pase una carga parcial. */
  const casos: Array<[string, string]> = [
    ['20900', 'Aguascalientes'],
    ['44100', 'Jalisco'],
    ['06600', 'Ciudad de México'],
    ['64000', 'Nuevo León'],
  ];

  for (const [cp, donde] of casos) {
    const r = await query<any>(
      `SELECT descripcion FROM sat_cp_colonia WHERE codigo_postal = $1 ORDER BY descripcion LIMIT 4`,
      [cp]
    );
    r.rows.length > 0
      ? bien(`CP ${cp} (${donde}): ${r.rows.length}+ colonias — ` +
             r.rows.slice(0, 2).map((x: any) => x.descripcion).join(', '))
      : mal(`CP ${cp} (${donde}) no devuelve ninguna colonia`);
  }

  /* La columna del CP tiene que traer CPs, no nombres. Es la comprobación que
   * caza el cruce aunque los datos "se vean" bien de lejos. */
  const sucias = await query<any>(
    `SELECT COUNT(*)::int n FROM sat_cp_colonia
      WHERE codigo_postal IS NOT NULL AND codigo_postal !~ '^[0-9]{5}$'`
  );
  sucias.rows[0].n === 0
    ? bien('la columna codigo_postal sólo trae códigos de cinco dígitos')
    : mal('hay nombres en la columna del código postal', `${sucias.rows[0].n} filas`);

  const nombres = await query<any>(
    `SELECT COUNT(*)::int n FROM sat_cp_colonia
      WHERE descripcion ~ '^[0-9]{5}$'`
  );
  nombres.rows[0].n === 0
    ? bien('la columna descripcion no trae códigos postales disfrazados de nombre')
    : mal('hay códigos postales en la columna del nombre', `${nombres.rows[0].n} filas`);

  /* Municipios por estado: Aguascalientes tiene 11, Oaxaca 570. Si un estado
   * reporta uno solo, las columnas están cruzadas. */
  for (const [clave, esperados, nombre] of [
    ['AGU', 5, 'Aguascalientes'],
    ['OAX', 100, 'Oaxaca'],
    ['JAL', 50, 'Jalisco'],
  ] as Array<[string, number, string]>) {
    const m = await query<any>(
      `SELECT COUNT(*)::int n FROM sat_cp_municipio WHERE estado = $1`, [clave]
    );
    m.rows[0].n >= esperados
      ? bien(`${nombre} (${clave}): ${m.rows[0].n} municipios`)
      : mal(`${nombre} (${clave}) reporta ${m.rows[0].n} municipios, se esperaban ${esperados}+`);
  }

  const munSucios = await query<any>(
    `SELECT COUNT(*)::int n FROM sat_cp_municipio WHERE estado !~ '^[A-Z]{2,4}$'`
  );
  munSucios.rows[0].n === 0
    ? bien('la columna estado de municipios sólo trae claves de estado')
    : mal('hay nombres de municipio en la columna del estado', `${munSucios.rows[0].n} filas`);

  /* Y el camino completo, como lo usa la pantalla. */
  const completo = await query<any>(
    `SELECT c.descripcion AS colonia, m.descripcion AS municipio
       FROM sat_cp_colonia c
       CROSS JOIN LATERAL (
         SELECT descripcion FROM sat_cp_municipio WHERE estado = 'AGU' LIMIT 1
       ) m
      WHERE c.codigo_postal = '20900' LIMIT 1`
  );
  completo.rows.length > 0 && completo.rows[0].colonia && completo.rows[0].municipio
    ? bien(`el camino completo resuelve: colonia "${completo.rows[0].colonia}", ` +
           `municipio "${completo.rows[0].municipio}"`)
    : mal('el camino completo no resuelve un domicilio');

  if (fallos > 0) {
    console.log(
      '\n  Hay catálogo, pero con las columnas cruzadas: el código postal vive\n' +
      '  en la columna del nombre y al revés. Lo corrige la migración\n' +
      '  2026-08-18e — si no se ha aplicado, córrela:\n\n' +
      '      npm run migrate:up\n'
    );
  }

  console.log(`\n${ok} bien, ${fallos} mal\n`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
