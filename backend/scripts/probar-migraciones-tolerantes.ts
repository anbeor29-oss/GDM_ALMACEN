/**
 * Comprueba que las dos migraciones sobreviven a los datos que YA existen.
 *
 * ── POR QUÉ ESTA PRUEBA ──
 * Las dos fallaron en Render y pasaron en local, y la diferencia no era el
 * código: era que la base de Render tiene datos y la local casi no. Una
 * migración que sólo se prueba contra una base limpia no está probada.
 *
 * Aquí se reproducen a propósito las dos condiciones que rompen —trabajos
 * duplicados vivos y terceros sin rol— y se corre el SQL de la migración
 * encima.
 *
 *   npx ts-node --files -r dotenv/config scripts/probar-migraciones-tolerantes.ts
 */

import fs from 'fs';
import path from 'path';
import { pool, query } from '../src/config/database';

let ok = 0, ko = 0;
const bien = (m: string) => { ok++; console.log(`  ✔ ${m}`); };
const mal = (m: string, x?: any) => {
  ko++; console.log(`  ✘ ${m}${x !== undefined ? `  → ${JSON.stringify(x)}` : ''}`);
};
const titulo = (t: string) => console.log(`\n${t}`);

const MIG = path.join(__dirname, '..', 'src', 'database', 'migrations');
const leer = (f: string) => fs.readFileSync(path.join(MIG, f), 'utf8');

/** El trozo de una migración entre dos marcas, para correrlo aislado. */
function trozo(sql: string, desde: string, hasta?: string): string {
  const i = sql.indexOf(desde);
  if (i < 0) throw new Error(`No se encontró "${desde}" en la migración.`);
  const j = hasta ? sql.indexOf(hasta, i) : -1;
  return j > 0 ? sql.slice(i, j) : sql.slice(i);
}

async function main() {
  console.log('\n═══ MIGRACIONES CONTRA DATOS QUE YA EXISTEN ═══');

  const emp = await query<any>(`SELECT id FROM companies ORDER BY created_at LIMIT 1`);
  const companyId = emp.rows[0].id;

  /* ══════════════════════════════════════════════════════════════════════
     1. El índice único sobre trabajos duplicados
     ══════════════════════════════════════════════════════════════════════ */
  titulo('1. ★ Índice único sobre trabajos que YA están duplicados');

  await query(`DROP INDEX IF EXISTS ux_trabajo_vivo_por_rango`);
  await query(`DELETE FROM sat_trabajos WHERE company_id=$1 AND rfc='ZZDUP01011ZZ'`, [companyId]);

  /* Exactamente lo de la pantalla: dos trabajos vivos del mismo rango. */
  const meter = async (creado: string) => {
    const r = await query<any>(
      `INSERT INTO sat_trabajos
         (company_id, rfc, fecha_desde, fecha_hasta, direccion, tipo, estado, created_at)
       VALUES ($1,'ZZDUP01011ZZ','2026-08-01','2026-08-19','recibidos','CFDI','EN_PROCESO',$2)
       RETURNING id`, [companyId, creado]);
    return r.rows[0].id;
  };
  const viejo = await meter('2026-08-19 10:00:00');
  const nuevo = await meter('2026-08-19 18:00:00');

  /* Al viejo se le pone una partición resuelta: es el que debe sobrevivir. */
  await query(
    `INSERT INTO sat_particiones (trabajo_id, desde, hasta, profundidad, huella, estado)
     VALUES ($1, '2026-08-01', '2026-08-19', 0, 'zz-dup-1', 'SIN_DATOS')`, [viejo]);

  const antes = await query<any>(
    `SELECT COUNT(*)::int n FROM sat_trabajos
      WHERE company_id=$1 AND rfc='ZZDUP01011ZZ' AND estado IN ('CREADO','EN_PROCESO')`,
    [companyId]);
  antes.rows[0].n === 2
    ? bien('se reprodujo el caso: dos trabajos vivos sobre el mismo rango')
    : mal('no se pudo reproducir', antes.rows[0].n);

  /* El índice a secas debe FALLAR: es lo que pasó en Render. */
  try {
    await query(
      `CREATE UNIQUE INDEX ux_zz_prueba ON sat_trabajos
         (company_id, rfc, fecha_desde, fecha_hasta, direccion, tipo)
       WHERE estado IN ('CREADO','EN_PROCESO')`);
    await query(`DROP INDEX IF EXISTS ux_zz_prueba`);
    mal('★ el índice se creó sobre duplicados: la prueba no reproduce el fallo');
  } catch {
    bien('★ el índice a secas FALLA sobre los duplicados — es el error del despliegue');
  }

  /* Ahora, el trozo real de la migración corregida. */
  const sqlF = leer('2026-08-20f_descarga_programada.sql');
  const bloque = trozo(sqlF, 'WITH ordenados AS', 'CREATE INDEX IF NOT EXISTS ix_trabajos_origen');
  try {
    await query(bloque);
    bien('★★ con la limpieza previa, la migración corre sin error');
  } catch (e: any) {
    mal('★★ la migración corregida sigue fallando', e.message);
  }

  const tras = await query<any>(
    `SELECT id, estado, mensaje FROM sat_trabajos
      WHERE company_id=$1 AND rfc='ZZDUP01011ZZ' ORDER BY created_at`, [companyId]);
  const sobreviviente = tras.rows.filter((t: any) => t.estado === 'EN_PROCESO');
  sobreviviente.length === 1
    ? bien('queda exactamente UN trabajo vivo')
    : mal('quedaron varios vivos, o ninguno', tras.rows.map((t: any) => t.estado));

  sobreviviente[0]?.id === viejo
    ? bien('★ y el que sobrevive es el que ya tenía trabajo hecho con el SAT, no el último')
    : mal('★ canceló el que tenía avance: se tiró trabajo que el SAT ya hizo');

  const cancelado = tras.rows.find((t: any) => t.estado === 'CANCELADO');
  cancelado && /otro trabajo vivo/.test(cancelado.mensaje || '')
    ? bien('★ el cancelado dice POR QUÉ: no desaparece sin explicación')
    : mal('se canceló sin dejar motivo', cancelado?.mensaje);

  /* Y el índice ya impide el siguiente duplicado. */
  try {
    await meter('2026-08-20 09:00:00');
    mal('el índice no quedó activo: aceptó otro duplicado');
  } catch {
    bien('y de aquí en adelante el índice impide el duplicado');
  }

  await query(`DELETE FROM sat_particiones WHERE trabajo_id IN
    (SELECT id FROM sat_trabajos WHERE rfc='ZZDUP01011ZZ')`);
  await query(`DELETE FROM sat_trabajos WHERE rfc='ZZDUP01011ZZ'`);

  /* ══════════════════════════════════════════════════════════════════════
     2. El CHECK de rol contra terceros sin party_type
     ══════════════════════════════════════════════════════════════════════ */
  titulo('2. ★ CHECK de rol con terceros que no tienen party_type');

  await query(`ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_tercero_con_rol`);
  await query(`DELETE FROM customers WHERE rfc='ZZSINROL01Z'`);

  /* Una fila como las viejas: sin party_type y sin rol. */
  await query(
    `INSERT INTO customers (company_id, rfc, business_name, party_type,
                            es_cliente, es_proveedor, es_acreedor, es_deudor)
     VALUES ($1,'ZZSINROL01Z','TERCERO VIEJO SIN TIPO', NULL, FALSE,FALSE,FALSE,FALSE)`,
    [companyId]);
  bien('se reprodujo el caso: un tercero sin party_type y sin ningún rol');

  /* El CHECK normal debe FALLAR. */
  try {
    await query(
      `ALTER TABLE customers ADD CONSTRAINT chk_zz_prueba
         CHECK (es_cliente OR es_proveedor OR es_acreedor OR es_deudor)`);
    await query(`ALTER TABLE customers DROP CONSTRAINT chk_zz_prueba`);
    mal('★ el CHECK normal se creó: la prueba no reproduce el fallo');
  } catch {
    bien('★ el CHECK normal FALLA al recorrer la tabla — es el otro error posible');
  }

  /* El de la migración corregida, NOT VALID. */
  const sqlC = leer('2026-08-20c_tercero_varios_roles.sql');
  const bloqueC = trozo(sqlC,
    'ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_tercero_con_rol;',
    '-- ── 5. party_type se mantiene sola ──');
  try {
    await query(bloqueC);
    bien('★★ con NOT VALID, la migración corre sin tumbar el despliegue');
  } catch (e: any) {
    mal('★★ sigue fallando', e.message);
  }

  /* Y aun así protege lo NUEVO. */
  try {
    await query(
      `INSERT INTO customers (company_id, rfc, business_name, es_cliente, es_proveedor)
       VALUES ($1,'ZZSINROL02Z','NUEVO SIN ROL', FALSE, FALSE)`, [companyId]);
    mal('★★ NOT VALID dejó entrar un tercero nuevo sin rol');
    await query(`DELETE FROM customers WHERE rfc='ZZSINROL02Z'`);
  } catch {
    bien('★★ pero un tercero NUEVO sin rol sigue rechazándose: la regla vale hacia adelante');
  }

  /* ── La trampa que casi se cuela ── */
  titulo('3. ★ El UPDATE de sincronización no puede tocar las filas sin rol');

  try {
    await query(`UPDATE customers SET es_cliente = es_cliente WHERE rfc='ZZSINROL01Z'`);
    mal('★★ el UPDATE sin filtrar pasó: la prueba no demuestra el riesgo');
  } catch {
    bien('★★ un UPDATE sobre una fila sin rol SÍ choca contra el CHECK NOT VALID');
  }

  const filtrado = leer('2026-08-20c_tercero_varios_roles.sql');
  /es_cliente = es_cliente\s*\n\s*WHERE es_cliente OR es_proveedor/.test(filtrado)
    ? bien('★ por eso la migración lo filtra: sin el WHERE, el arreglo tumbaba la migración')
    : mal('★ el UPDATE de la migración NO está filtrado: volvería a fallar en Render');

  /* Limpieza */
  await query(`DELETE FROM customers WHERE rfc IN ('ZZSINROL01Z','ZZSINROL02Z')`);

  console.log(`\n═══ ${ok} bien, ${ko} mal ═══\n`);
  await pool.end();
  process.exit(ko ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\n✘ reventó:', e);
  await pool.end();
  process.exit(1);
});
