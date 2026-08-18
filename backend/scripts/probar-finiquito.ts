/**
 * probar-finiquito — la cuenta de quien se va, contra aritmética hecha aparte.
 *
 * Liquidar mal es de los errores más caros que puede cometer una nómina: se
 * paga de más y no se recupera, o se paga de menos y termina en la Junta. Por
 * eso cada concepto se compara contra el cálculo escrito a mano aquí, con su
 * artículo, y no contra lo que devolvió el código.
 *
 *   npx ts-node -r dotenv/config scripts/probar-finiquito.ts
 *
 * Deja la base como la encontró.
 */
import { pool, query } from '../src/config/database';
import * as finiquito from '../src/modules/nomina/finiquito.service';
import { calcularInfonavit } from '../src/modules/nomina/motor';
import * as ejercicios from '../src/modules/nomina/ejercicios.service';

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
    `DELETE FROM nomina_empleados WHERE company_id = $1 AND num_empleado = 'ZZ90'`, [companyId]);
  await query(
    `INSERT INTO nomina_puestos (company_id, nombre) VALUES ($1, 'PRUEBA FINIQUITO')
     ON CONFLICT DO NOTHING`, [companyId]);
  const puestoId = (await query<any>(
    `SELECT id FROM nomina_puestos WHERE company_id=$1 AND nombre='PRUEBA FINIQUITO'`, [companyId]
  )).rows[0].id;

  /* Caso escogido para que las cuentas se puedan hacer de cabeza:
   *   ingresó el 1 de enero de 2020, sale el 31 de diciembre de 2026
   *   → exactamente 2,556 días = 7.0027 años
   *   salario diario 400, integrado 420 */
  const emp = await query<any>(
    `INSERT INTO nomina_empleados
       (company_id, num_empleado, nombre, apellido_pat, rfc, curp, nss,
        fecha_ingreso, puesto_id, tipo_contrato, tipo_regimen, tipo_jornada,
        periodicidad_pago, tipo_nomina, zona_geografica, regimen_fiscal, uso_cfdi,
        salario_diario, salario_diario_integrado, estado, entidad_federativa, activo)
     VALUES ($1,'ZZ90','ANA','TORRES','TOAN800101QW1','TOAN800101MDFRNN05','12345678903',
             '2020-01-01',$2,'01','02','01','04','O','general','605','CN01',
             400, 420,'JAL','JAL',true)
     RETURNING id`, [companyId, puestoId]
  );
  const id = emp.rows[0].id;

  const r = await finiquito.calcular(companyId, id, '2026-12-31');

  console.log(`\n  ANA TORRES · ingreso 2020-01-01 · baja 2026-12-31`);
  console.log(`  antigüedad: ${r.antiguedad.dias} días (${r.antiguedad.anos} años) — ${r.antiguedad.texto}`);
  console.log(`  diario $400 · integrado $420\n`);

  /* Del 2020-01-01 al 2026-12-31 hay 2,556 días: SEIS aniversarios cumplidos
   * (el séptimo cae el 2027-01-01) más 364 días corridos desde el 2026-01-01. */
  const anos = 6 + 364 / 365;   // 6.9973

  /* ── FINIQUITO ── */
  const c1 = r.finiquito.conceptos;
  const aguinaldo = c1.find((x) => x.concepto.includes('Aguinaldo'))!;
  const vac       = c1.find((x) => x.concepto.includes('Vacaciones'))!;
  const prima     = c1.find((x) => x.concepto.includes('Prima vacacional'))!;

  // Aguinaldo: del 1-ene al 31-dic de 2026 son 364 días corridos.
  //   15/365 x 364 x 400
  const espAguinaldo = (15 / 365) * 364 * 400;
  cerca(aguinaldo.importe, espAguinaldo)
    ? bien(`aguinaldo proporcional $${aguinaldo.importe.toFixed(2)} (Art. 87: 15/365 x 364 x 400)`)
    : mal('aguinaldo', `${aguinaldo.importe} vs ${espAguinaldo.toFixed(2)}`);

  // Vacaciones: con SEIS aniversarios cumplidos, el Art. 76 reformado da 22
  //   días. Su aniversario más reciente es el 2026-01-01, y del 1-ene al 31-dic
  //   corrieron 364 días: 22/365 x 364.
  const espVacDias = (22 / 365) * 364;
  cerca(vac.importe, espVacDias * 400, 0.5)
    ? bien(`vacaciones $${vac.importe.toFixed(2)} — 22 días por 6 aniversarios (Art. 76 reformado)`)
    : mal('vacaciones', `${vac.importe} vs ${(espVacDias * 400).toFixed(2)}`);

  cerca(prima.importe, vac.importe * 0.25, 0.5)
    ? bien(`prima vacacional = 25% de las vacaciones (Art. 80)`)
    : mal('prima vacacional', `${prima.importe} vs ${(vac.importe * 0.25).toFixed(2)}`);

  /* ── LIQUIDACIÓN ── */
  const c2 = r.liquidacion.conceptos;
  const tresMeses = c2.find((x) => x.concepto.includes('constitucional'))!;
  const veinte    = c2.find((x) => x.concepto.includes('Veinte'))!;
  const antig     = c2.find((x) => x.concepto.includes('antigüedad'))!;

  cerca(tresMeses.importe, 420 * 90)
    ? bien(`indemnización 90 x $420 integrado = $${tresMeses.importe.toFixed(2)} (Art. 48 + 89)`)
    : mal('indemnización de 3 meses', `${tresMeses.importe} vs ${420 * 90}`);

  tresMeses.base === 420
    ? bien('la indemnización usa el INTEGRADO, no el diario (Art. 89)')
    : mal('la indemnización se calculó con el salario equivocado', tresMeses.base);

  cerca(veinte.importe, 420 * 20 * anos, 1)
    ? bien(`20 días por año: ${veinte.dias} días x $420 (Art. 50 Fr. II)`)
    : mal('20 días por año', `${veinte.importe} vs ${(420 * 20 * anos).toFixed(2)}`);

  /* Prima de antigüedad: el tope de dos mínimos es 315.04 x 2 = 630.08.
   * El diario de ANA (400) está POR DEBAJO, así que NO se topa. */
  cerca(antig.base, 400)
    ? bien('con diario $400 la prima de antigüedad no se topa (dos mínimos = $630.08)')
    : mal('la base de la prima de antigüedad está mal', antig.base);
  cerca(antig.importe, 400 * 12 * anos, 1)
    ? bien(`prima de antigüedad: ${antig.dias} días x $400 (Art. 162)`)
    : mal('prima de antigüedad', `${antig.importe} vs ${(400 * 12 * anos).toFixed(2)}`);

  /* El tope SÍ debe morder con un sueldo alto. Es el error más caro al
   * liquidar: sin tope, a un sueldo de $2,000 se le pagarían $168,000 de prima
   * de antigüedad en vez de $52,927. */
  /* Los dos suben juntos: desde la migración 2026-08-18b el CHECK impide dejar
   * el integrado por debajo del diario, que es exactamente lo que queremos que
   * impida. Subir sólo uno truena, y bien que truene. */
  await query(
    `UPDATE nomina_empleados SET salario_diario = 2000, salario_diario_integrado = 2100
      WHERE id = $1`, [id]
  );
  const alto = await finiquito.calcular(companyId, id, '2026-12-31');
  const antigAlto = alto.liquidacion.conceptos.find((x) => x.concepto.includes('antigüedad'))!;
  cerca(antigAlto.base, 630.08)
    ? bien('con diario $2,000 la prima SÍ se topa a dos mínimos ($630.08) — Art. 162 Fr. II')
    : mal('el tope de dos mínimos no se aplicó', antigAlto.base);

  console.log(`\n  finiquito     $${r.finiquito.total.toFixed(2)}`);
  console.log(`  liquidación   $${r.liquidacion.total.toFixed(2)}`);
  console.log(`  los dos       $${r.totalConIndemnizacion.toFixed(2)}\n`);

  cerca(r.totalConIndemnizacion, r.finiquito.total + r.liquidacion.total)
    ? bien('el total con indemnización es la suma de los dos')
    : mal('el total no suma');

  /* ── El INFONAVIT en VSM ── */
  const ej = await ejercicios.cargar(2026, '2026-08-15');
  const inf = calcularInfonavit(
    { tiene: true, tipo: 'vsm', valor: 2 }, 420, 30.4, 'general', ej
  );
  // 2 VSM con UMI de 100.81 => 201.62 al mes. Con el salario mínimo habrían
  // sido 630.08: más del triple.
  cerca(inf.credito, 100.81 * 2, 0.05)
    ? bien(`INFONAVIT 2 VSM = $${inf.credito.toFixed(2)} con la UMI (con el mínimo daba $630.08)`)
    : mal('el crédito en VSM no usa la UMI', inf.credito);

  const sinUmi = { ...ej, umiDiaria: null };
  try {
    calcularInfonavit({ tiene: true, tipo: 'vsm', valor: 2 }, 420, 30.4, 'general', sinUmi as any);
    mal('sin UMI cargada calculó de todos modos');
  } catch (err: any) {
    /UMI/.test(err.message)
      ? bien('sin UMI cargada se detiene en vez de usar el salario mínimo')
      : mal('falló por otro motivo', err.message);
  }

  await query(`DELETE FROM nomina_empleados WHERE id = $1`, [id]);
  await query(`DELETE FROM nomina_puestos WHERE id = $1`, [puestoId]);
  console.log('\n(base limpia)');

  console.log(`\n${ok} bien, ${fallos} mal\n`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
