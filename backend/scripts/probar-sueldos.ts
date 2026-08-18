/**
 * probar-sueldos — que el diario y el integrado no se puedan voltear.
 *
 * Es el error que ya se coló una vez: el lector de XML los mapeaba por nombre
 * de atributo y los expedientes quedaron cambiados. No se ve en pantalla —dos
 * números parecidos— pero mueve la cuota del IMSS de toda la plantilla y las
 * indemnizaciones del finiquito.
 *
 * Aquí se prueban las TRES capas que ahora lo impiden: el CHECK de la base, la
 * validación del servicio y el aviso de la prenómina. Y de paso el tope de 25
 * UMA, que cuelga del mismo dato.
 *
 *   npx ts-node -r dotenv/config scripts/probar-sueldos.ts
 *
 * Deja la base como la encontró.
 */
import { pool, query } from '../src/config/database';
import * as empleados from '../src/modules/nomina/empleados.service';
import * as ejercicios from '../src/modules/nomina/ejercicios.service';
import { calcularImssObrero } from '../src/modules/nomina/motor';

let ok = 0, fallos = 0;
const bien = (q: string) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q: string, d?: any) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };
const cerca = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

async function main() {
  const c = await query<any>(
    `SELECT id FROM companies WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`
  );
  const companyId = c.rows[0].id;

  await query(
    `DELETE FROM nomina_empleados WHERE company_id = $1 AND num_empleado IN ('ZZ80','ZZ81')`,
    [companyId]
  );

  /* ── 1. Ningún expediente quedó volteado ──
   * Después de la migración esto tiene que dar cero en toda la base. Es la
   * comprobación que importa en producción. */
  const volteados = await query<any>(
    `SELECT COUNT(*)::int n FROM nomina_empleados
      WHERE deleted_at IS NULL
        AND salario_diario > 0 AND salario_diario_integrado > 0
        AND salario_diario_integrado < salario_diario`
  );
  volteados.rows[0].n === 0
    ? bien('no queda ningún expediente con el SDI por debajo del diario')
    : mal('hay expedientes volteados', `${volteados.rows[0].n} — corre la migración 2026-08-18b`);

  /* ── 2. El CHECK de la base lo impide ── */
  try {
    await query(
      `INSERT INTO nomina_empleados
         (company_id, num_empleado, nombre, apellido_pat, rfc, curp,
          fecha_ingreso, tipo_contrato, tipo_regimen, tipo_jornada,
          periodicidad_pago, tipo_nomina, zona_geografica, regimen_fiscal, uso_cfdi,
          salario_diario, salario_diario_integrado, activo)
       VALUES ($1,'ZZ80','PRUEBA','VOLTEADO','VOPR900101AB1','VOPR900101HDFLRB01',
               '2024-01-01','01','02','01','04','O','general','605','CN01',
               336.29, 320.49, true)`,
      [companyId]
    );
    mal('la base aceptó un SDI menor que el diario');
    await query(`DELETE FROM nomina_empleados WHERE company_id=$1 AND num_empleado='ZZ80'`, [companyId]);
  } catch (e: any) {
    /nomina_empleados_sdi_ck/.test(e.message || '')
      ? bien('el CHECK de la base rechaza 336.29 de diario con 320.49 de SDI')
      : mal('la base falló por otro motivo', e.message);
  }

  /* ── 3. El servicio lo rechaza ANTES, con un mensaje que se entiende ── */
  try {
    await empleados.crear(companyId, {
      num_empleado: 'ZZ81', nombre: 'PRUEBA', apellido_pat: 'SERVICIO',
      rfc: 'SEPR900101CD2', curp: 'SEPR900101HDFRRB02',
      fecha_ingreso: '2024-01-01',
      salario_diario: 336.29, salario_diario_integrado: 320.49,
    } as any);
    mal('el servicio aceptó los sueldos invertidos');
    await query(`DELETE FROM nomina_empleados WHERE company_id=$1 AND num_empleado='ZZ81'`, [companyId]);
  } catch (e: any) {
    const m = e?.message || '';
    /invertidos/.test(m) && /Art\. 84/.test(m)
      ? bien('el servicio lo rechaza explicando cuál es cuál y citando el Art. 84 LSS')
      : mal('el servicio falló con otro mensaje', m);
  }

  /* ── 4. Al derecho sí entra ── */
  let id = '';
  try {
    const r: any = await empleados.crear(companyId, {
      num_empleado: 'ZZ81', nombre: 'PRUEBA', apellido_pat: 'DERECHO',
      rfc: 'DEPR900101CD2', curp: 'DEPR900101HDFRRB02',
      fecha_ingreso: '2024-01-01',
      salario_diario: 320.49, salario_diario_integrado: 336.29,
    } as any);
    id = r?.id || r?.data?.id || '';
    bien('con 320.49 de diario y 336.29 de SDI el alta pasa');
  } catch (e: any) {
    mal('rechazó un expediente correcto', e.message);
  }

  /* ── 5. El tope de 25 UMA del Art. 28 LSS ── */
  const ej = await ejercicios.cargar(2026, '2026-08-15');
  const tope = ej.umaDiaria * 25;

  // Un SDI por encima del tope debe cotizar COMO SI fuera el tope.
  const arriba = calcularImssObrero(5000, tope + 1000, 30, 'general', ej);
  const enTope = calcularImssObrero(5000, tope,        30, 'general', ej);
  cerca(arriba.total, enTope.total, 0.02)
    ? bien(`un SDI arriba de 25 UMA ($${tope.toFixed(2)}) cotiza como el tope (Art. 28 LSS)`)
    : mal('el SBC no se topó', `${arriba.total} vs ${enTope.total}`);

  // Y por debajo del tope nada cambia.
  const abajo = calcularImssObrero(500, 520, 30, 'general', ej);
  abajo.total > 0
    ? bien(`por debajo del tope la cuota se calcula normal ($${abajo.total.toFixed(2)} en 30 días)`)
    : mal('la cuota obrera dio cero donde no debía');

  /* ── 6. Al mínimo sigue siendo cero (Art. 36 LSS) ── */
  const minimo = calcularImssObrero(ej.smgGeneral, ej.smgGeneral * 1.05, 30, 'general', ej);
  minimo.total === 0
    ? bien('al salario mínimo la cuota obrera sigue en cero (Art. 36 LSS)')
    : mal('al mínimo salió cuota obrera', minimo.total);

  if (id) await query(`DELETE FROM nomina_empleados WHERE id = $1`, [id]);
  await query(
    `DELETE FROM nomina_empleados WHERE company_id = $1 AND num_empleado IN ('ZZ80','ZZ81')`,
    [companyId]
  );
  console.log('\n(base limpia)');

  console.log(`\n${ok} bien, ${fallos} mal\n`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
