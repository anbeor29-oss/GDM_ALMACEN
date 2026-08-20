/**
 * Pruebas del acumulador de periodos.
 *
 * ── LO QUE CAMBIA ──
 * Antes los estados leían un archivo recién subido. Ahora leen EL PERIODO, y
 * el periodo se alimenta de varias fuentes. Se comprueba que el saldo quede
 * guardado, que los estados salgan de ahí, y que el cierre sea un candado de
 * verdad y no una sugerencia.
 *
 *   npx ts-node --files -r dotenv/config scripts/probar-periodos.ts
 */

import fs from 'fs';
import path from 'path';
import { pool, query } from '../src/config/database';
import * as periodos from '../src/modules/accounting/periodos.service';
import * as bal from '../src/modules/accounting/balanza-lector.service';
import * as map from '../src/modules/accounting/mapeador-sat.service';
import * as catalogo from '../src/modules/accounting/catalogo.service';
import * as ef from '../src/modules/accounting/estados-financieros.service';

let ok = 0, ko = 0;
const bien = (m: string) => { ok++; console.log(`  ✔ ${m}`); };
const mal = (m: string, x?: any) => {
  ko++; console.log(`  ✘ ${m}${x !== undefined ? `  → ${JSON.stringify(x)}` : ''}`);
};
const titulo = (t: string) => console.log(`\n${t}`);

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const XLSX = process.env.BALANZA_XLSX
  || path.join(HOME, 'Downloads', 'BALANZA_DE_COMPROBACIÓN_PRO1401108F6_31072026_13073225.xlsx');

const ANIO = 2026;

async function main() {
  console.log('\n═══ PERIODOS CONTABLES ═══');

  const emp = await query<any>(`SELECT id, business_name FROM companies ORDER BY created_at LIMIT 1`);
  const companyId = emp.rows[0].id;

  /* Se parte de un ejercicio limpio. */
  await query(`DELETE FROM accounting_period_sources WHERE company_id=$1`, [companyId]);
  await query(`UPDATE accounting_periods SET estado='ABIERTO' WHERE company_id=$1`, [companyId]);
  await query(`DELETE FROM accounting_period_balances WHERE company_id=$1`, [companyId]);

  /* ── 1. Un mes vacío es un mes vacío, no una empresa en ceros ── */
  titulo('1. ★ Un mes sin cargar NO devuelve estados en ceros');

  const vacio = await periodos.contextoDelPeriodo(companyId, ANIO, 3);
  vacio === null
    ? bien('★ el periodo sin saldos devuelve null, no un contexto vacío')
    : mal('★ devolvió un contexto: los estados saldrían en ceros, como una empresa quieta');

  const estVacio = await periodos.estadoDelPeriodo(companyId, ANIO, 3);
  !estVacio.tieneDatos && estVacio.estado === 'ABIERTO'
    ? bien('y el estado del periodo lo reporta: abierto, sin datos')
    : mal('el estado del periodo miente', estVacio);

  /* ── 2. Alimentar desde una balanza ── */
  if (!fs.existsSync(XLSX)) {
    console.log('\n  (la balanza de ejemplo no está aquí — se salta el resto)');
    console.log(`\n═══ ${ok} bien, ${ko} mal ═══\n`);
    await pool.end();
    process.exit(ko ? 1 : 0);
  }

  titulo('2. Alimentar julio con una balanza externa');

  const ex = await bal.leerBalanzaExcel(fs.readFileSync(XLSX));
  const mapeo = map.proponerMapeo(ex.filas, { agrupadoresValidos: await map.agrupadoresValidos() });

  const carga = await periodos.alimentarDesdeBalanza(
    companyId, ANIO, 7, ex.filas, mapeo, { archivo: 'balanza-julio.xlsx' });

  carga.cuentas > 300
    ? bien(`${carga.cuentas} cuentas cargadas (${carga.cuentasNuevas} nuevas en el catálogo)`)
    : mal('cargó muy pocas cuentas', carga.cuentas);

  carga.cuadra
    ? bien(`y cuadra: cargos y abonos en ${carga.totalCargos.toFixed(2)}`)
    : mal('la carga no cuadra', { c: carga.totalCargos, a: carga.totalAbonos });

  const est = await periodos.estadoDelPeriodo(companyId, ANIO, 7);
  est.tieneDatos && est.fuentes.length === 1 && est.fuentes[0].fuente === 'BALANZA_EXTERNA'
    ? bien(`★ y queda registrado de dónde salió: ${est.fuentes[0].archivo}`)
    : mal('no se registró la procedencia', est.fuentes);

  /* ── 3. Los estados salen del periodo, sin volver a subir nada ── */
  titulo('3. ★ Los estados leen el PERIODO, no un archivo');

  const ctx = await periodos.contextoDelPeriodo(companyId, ANIO, 7);
  if (!ctx) { mal('el periodo no devolvió contexto tras cargarlo'); }
  else {
    const juego = ef.juegoCompleto(ctx, undefined, 31);
    const analisis = bal.analizarBalanza(ex);

    Math.abs(juego.situacionFinanciera.activoTotal - analisis.activo) < 0.02
      ? bien(`★★ el activo desde el periodo (${juego.situacionFinanciera.activoTotal.toFixed(2)}) ` +
             `es el mismo que desde el archivo`)
      : mal('★★ el saldo se deformó al guardarse',
            { periodo: juego.situacionFinanciera.activoTotal, archivo: analisis.activo });

    Math.abs(juego.resultadoIntegral.ingresosNetos - 12097259.18) < 1
      ? bien(`ingresos netos ${juego.resultadoIntegral.ingresosNetos.toFixed(2)}`)
      : mal('los ingresos se deformaron', juego.resultadoIntegral.ingresosNetos);

    /* Sin mes anterior, el flujo NO se inventa. */
    !juego.flujoEfectivo.disponible && /dos periodos|periodo anterior/i.test(juego.flujoEfectivo.motivo || '')
      ? bien('★ el flujo de efectivo no se calcula con un solo mes, y dice por qué')
      : mal('★ armó un flujo de efectivo sin periodo anterior', juego.flujoEfectivo.disponible);
  }

  /* ── 4. Recargar reemplaza, no acumula ── */
  titulo('4. ★ Volver a cargar el mes REEMPLAZA');

  const recarga = await periodos.alimentarDesdeBalanza(
    companyId, ANIO, 7, ex.filas, mapeo, { archivo: 'balanza-julio-v2.xlsx' });
  const est2 = await periodos.estadoDelPeriodo(companyId, ANIO, 7);

  Math.abs(est2.totalCargos - carga.totalCargos) < 0.02
    ? bien(`★★ tras recargar, los cargos siguen en ${est2.totalCargos.toFixed(2)} — no se duplicaron`)
    : mal('★★ la segunda carga se sumó a la primera: el mes vale el doble',
          { antes: carga.totalCargos, despues: est2.totalCargos });

  est2.fuentes.length === 1
    ? bien('y queda una sola fuente registrada, la última')
    : mal('se acumularon fuentes', est2.fuentes.length);

  recarga.cuentasNuevas === 0
    ? bien('las cuentas ya existían: no se volvieron a crear')
    : mal('creó cuentas duplicadas', recarga.cuentasNuevas);

  /* ── 5. El cierre ── */
  titulo('5. El cierre es un candado');

  /* No se cierra un mes con meses anteriores abiertos que tengan datos. */
  await periodos.alimentarDesdeBalanza(companyId, ANIO, 6, ex.filas, mapeo, {});
  try {
    await periodos.cerrarPeriodo(companyId, ANIO, 7);
    mal('cerró julio con junio abierto y cargado');
  } catch (e: any) {
    /Junio/.test(e.message)
      ? bien('★ no cierra julio con junio abierto, y dice cuál falta')
      : mal('rechazó sin decir qué mes', e.message);
  }

  await periodos.cerrarPeriodo(companyId, ANIO, 6);
  const cerrado = await periodos.cerrarPeriodo(companyId, ANIO, 7);
  cerrado.estado === 'CERRADO'
    ? bien('julio cierra una vez cerrado junio')
    : mal('no cerró', cerrado.estado);

  /* Y cerrado, no admite cifras. */
  try {
    await periodos.alimentarDesdeBalanza(companyId, ANIO, 7, ex.filas, mapeo, {});
    mal('★ un mes cerrado aceptó nuevos saldos');
  } catch (e: any) {
    /cerrado/i.test(e.message)
      ? bien('★★ un mes cerrado NO admite saldos nuevos')
      : mal('falló con otro mensaje', e.message);
  }

  /* Ni por la puerta de atrás: el trigger de la base. */
  const p7 = await query<any>(
    `SELECT id FROM accounting_periods WHERE company_id=$1 AND anio=$2 AND mes=7`, [companyId, ANIO]);
  const unaCuenta = await query<any>(
    `SELECT account_id FROM accounting_period_balances WHERE periodo_id=$1 LIMIT 1`, [p7.rows[0].id]);
  try {
    await query(
      `UPDATE accounting_period_balances SET saldo_final = 999999
        WHERE periodo_id=$1 AND account_id=$2`, [p7.rows[0].id, unaCuenta.rows[0].account_id]);
    mal('★★ se pudo modificar un saldo de un mes cerrado por SQL directo');
  } catch {
    bien('★★ ni con un UPDATE directo: el candado está en la base, no en el servicio');
  }

  /* ── 6. Reabrir, en orden ── */
  titulo('6. Reabrir, del más reciente al más antiguo');

  try {
    await periodos.reabrirPeriodo(companyId, ANIO, 6);
    mal('reabrió junio con julio cerrado');
  } catch (e: any) {
    /Julio/.test(e.message)
      ? bien('★ no reabre junio con julio cerrado: julio se apoya en su saldo final')
      : mal('rechazó sin explicar', e.message);
  }

  await periodos.reabrirPeriodo(companyId, ANIO, 7);
  const j = await periodos.estadoDelPeriodo(companyId, ANIO, 7);
  j.estado === 'ABIERTO'
    ? bien('julio se reabre, y ahora sí junio también podría')
    : mal('no reabrió julio');

  /* ── 7. El año completo ── */
  titulo('7. Los doce meses, y los huecos');

  await periodos.reabrirPeriodo(companyId, ANIO, 6);
  await periodos.alimentarDesdeBalanza(companyId, ANIO, 9, ex.filas, mapeo, {});

  const anio = await periodos.anioCompleto(companyId, ANIO);
  anio.meses.length === 12
    ? bien('devuelve los doce meses, tengan datos o no')
    : mal('no devolvió doce', anio.meses.length);

  anio.conDatos === 3
    ? bien(`${anio.conDatos} meses con saldos: junio, julio y septiembre`)
    : mal('el conteo de meses con datos falla', anio.conDatos);

  anio.huecos.length === 1 && anio.huecos[0] === 'Agosto'
    ? bien(`★★ el hueco es SOLO Agosto: enero a mayo no son huecos, son antes de empezar`)
    : mal('★★ no detectó el mes faltante en medio', anio.huecos);

  /* Limpieza */
  await query(`DELETE FROM accounting_period_balances WHERE company_id=$1`, [companyId]);
  await query(`DELETE FROM accounting_period_sources WHERE company_id=$1`, [companyId]);

  console.log(`\n═══ ${ok} bien, ${ko} mal ═══\n`);
  await pool.end();
  process.exit(ko ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\n✘ reventó:', e);
  await pool.end();
  process.exit(1);
});
