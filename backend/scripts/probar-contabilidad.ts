/**
 * Pruebas del núcleo contable — catálogo, NIF y código agrupador.
 *
 * Lo que se comprueba no es "que corra", sino las cosas que descuadran una
 * contabilidad sin que ninguna póliza esté mal capturada:
 *   · una cuenta complementaria con la naturaleza equivocada,
 *   · un padre que además recibe movimientos,
 *   · un agrupador inventado que nadie revisa hasta el día del envío,
 *   · las dos columnas de código colapsadas en una.
 *
 * Correr:  npx ts-node --files -r dotenv/config scripts/probar-contabilidad.ts
 */

import { pool, query } from '../src/config/database';
import * as catalogo from '../src/modules/accounting/catalogo.service';
import { construirCatalogoSat } from '../src/modules/accounting/catalogo-sat.data';
import { NIF_NORMAS } from '../src/modules/accounting/nif-normas.data';

let ok = 0;
let ko = 0;
const bien = (m: string) => { ok++; console.log(`  ✔ ${m}`); };
const mal = (m: string, extra?: any) => {
  ko++;
  console.log(`  ✘ ${m}${extra !== undefined ? `  → ${JSON.stringify(extra)}` : ''}`);
};
const titulo = (t: string) => console.log(`\n${t}`);

async function main() {
  console.log('\n═══ CONTABILIDAD · núcleo ═══');

  /* ── 1. Los datos, antes de tocar la base ── */
  titulo('1. El catálogo armado en memoria');

  const cat = construirCatalogoSat();
  const n1 = cat.filter((c) => c.nivel === 1);
  const n2 = cat.filter((c) => c.nivel === 2);

  cat.length > 500
    ? bien(`${cat.length} códigos (${n1.length} mayores, ${n2.length} subcuentas)`)
    : mal('el catálogo salió corto', cat.length);

  const codigos = cat.map((c) => c.codigo);
  new Set(codigos).size === codigos.length
    ? bien('no hay códigos repetidos')
    : mal('hay códigos repetidos', codigos.length - new Set(codigos).size);

  /* Los cuatro grupos de gasto completos: 4 × 84 */
  const gastos = cat.filter((c) => /^60[1-4]\./.test(c.codigo));
  gastos.length === 336
    ? bien('601 a 604 traen sus 84 conceptos cada uno (336)')
    : mal('faltan conceptos de gasto', gastos.length);

  const ing401 = cat.filter((c) => /^401\./.test(c.codigo));
  ing401.length === 37
    ? bien('401 trae sus 37 subcuentas de ingreso')
    : mal('401 incompleto', ing401.length);

  /* ── Toda subcuenta tiene un padre que existe ── */
  const huerfanas = n2.filter((c) => !codigos.includes(c.padre!));
  huerfanas.length === 0
    ? bien('ninguna subcuenta cuelga de un padre inexistente')
    : mal('subcuentas huérfanas', huerfanas.map((c) => c.codigo).slice(0, 5));

  /* ── 2. Cuentas complementarias ──
   * Es lo que más se equivoca: '171 Depreciación acumulada' es ACTIVO con
   * saldo ACREEDOR. Un catálogo que asume "activo ⇒ deudora" no la puede
   * representar, y ahí es donde el balance deja de cuadrar. */
  titulo('2. Cuentas complementarias (las que RESTAN de su rubro)');

  for (const c of ['108', '116', '171', '172', '183']) {
    const x = cat.find((k) => k.codigo === c);
    x && x.tipo === 'ACTIVO' && x.naturaleza === 'ACREEDORA' && x.complementaria
      ? bien(`${c} ${x.nombre.slice(0, 40)} — ACTIVO con saldo ACREEDOR`)
      : mal(`${c} mal clasificada`, x && { tipo: x.tipo, nat: x.naturaleza, comp: x.complementaria });
  }

  /* Y las contra-cuentas que NO son de activo: la regla es "naturaleza
   * contraria a la de su tipo", no "activo con saldo acreedor". */
  const c402 = cat.find((k) => k.codigo === '402');
  c402?.tipo === 'INGRESO' && c402.naturaleza === 'DEUDORA' && c402.complementaria
    ? bien('★ 402 Devoluciones sobre ventas: ingreso con saldo DEUDOR, complementaria')
    : mal('402 no quedó como contra-ingreso', c402);

  const c503 = cat.find((k) => k.codigo === '503');
  c503?.tipo === 'COSTO' && c503.naturaleza === 'ACREEDORA' && c503.complementaria
    ? bien('★ 503 Devoluciones sobre compras: costo con saldo ACREEDOR, complementaria')
    : mal('503 no quedó como contra-costo', c503);

  const deprec = cat.find((k) => k.codigo === '101');
  deprec?.naturaleza === 'DEUDORA' && !deprec.complementaria
    ? bien('★ y 101 Caja sigue siendo DEUDORA normal: no se marcó todo por igual')
    : mal('101 quedó mal', deprec);

  /* ── 3. Cuentas de orden ── */
  titulo('3. Cuentas de orden (fuera de los estados financieros)');

  const o1 = cat.find((c) => c.codigo === '810.01');
  const o2 = cat.find((c) => c.codigo === '810.02');
  o1?.naturaleza === 'DEUDORA' && o2?.naturaleza === 'ACREEDORA'
    ? bien('★ 810.01 y su contra 810.02 tienen naturaleza opuesta: el par se anula')
    : mal('el par de orden no se anula', { o1: o1?.naturaleza, o2: o2?.naturaleza });

  cat.filter((c) => c.tipo === 'ORDEN').every((c) => /^8/.test(c.codigo))
    ? bien('todas las cuentas de orden están en la serie 800')
    : mal('hay cuentas de orden fuera del 800');

  /* ── 4. Las NIF ── */
  titulo('4. Clasificación NIF');

  const claves = new Set(NIF_NORMAS.map((n) => n.clave));
  const nifRotas = cat.filter((c) => c.nif && !claves.has(c.nif));
  nifRotas.length === 0
    ? bien(`las ${NIF_NORMAS.length} normas cubren todas las referencias del catálogo`)
    : mal('cuentas apuntan a una NIF inexistente', nifRotas.map((c) => `${c.codigo}→${c.nif}`).slice(0, 5));

  const esperado: Array<[string, string]> = [
    ['115', 'C-4'],   // Inventarios
    ['171', 'C-6'],   // Propiedades, planta y equipo
    ['105', 'C-3'],   // Cuentas por cobrar
    ['401', 'D-1'],   // Ingresos por contratos con clientes
    ['601.01', 'D-3'], // Beneficios a los empleados
    ['601.26', 'D-3'], // Cuotas al IMSS
    ['211', 'D-3'],
    ['185', 'D-4'],   // Impuestos a la utilidad
  ];
  for (const [cod, nif] of esperado) {
    const x = cat.find((c) => c.codigo === cod);
    x?.nif === nif
      ? bien(`${cod} → NIF ${nif}`)
      : mal(`${cod} debería ser NIF ${nif}`, x?.nif);
  }

  /* ── 5. Siembra en la base ── */
  titulo('5. Siembra de referencias');

  const r = await catalogo.sembrarReferencias();
  r.satSembrados === cat.length
    ? bien(`${r.satSembrados} códigos sembrados`)
    : mal('la siembra no cuadra con el catálogo', r.satSembrados);

  /* Idempotente: correrla dos veces no duplica ni truena. */
  const r2 = await catalogo.sembrarReferencias();
  r2.satSembrados === r.satSembrados
    ? bien('★ sembrar dos veces no duplica nada')
    : mal('la segunda siembra cambió el conteo', r2.satSembrados);

  const enBase = await query<any>(`SELECT COUNT(*)::int n FROM sat_codigos_agrupadores`);
  enBase.rows[0].n === cat.length
    ? bien(`la base tiene los ${enBase.rows[0].n} códigos`)
    : mal('la base no coincide', enBase.rows[0].n);

  r.nivel2Pendiente > 0
    ? bien(`★ y reporta ~${r.nivel2Pendiente} subcuentas que NO se inventaron`)
    : mal('no está reportando lo que falta');

  /* ── 6. Activación de una empresa ── */
  titulo('6. Activar contabilidad en una empresa');

  const emp = await query<any>(`SELECT id, business_name FROM companies ORDER BY created_at LIMIT 1`);
  if (!emp.rows.length) { mal('no hay empresas en la base'); return; }
  const companyId = emp.rows[0].id;
  console.log(`  (empresa: ${emp.rows[0].business_name})`);

  await query(`DELETE FROM accounting_account_equivalences WHERE company_id=$1`, [companyId]);
  await query(`DELETE FROM accounting_accounts WHERE company_id=$1`, [companyId]);
  await query(`DELETE FROM accounting_periods WHERE company_id=$1`, [companyId]);
  await query(`DELETE FROM accounting_fiscal_years WHERE company_id=$1`, [companyId]);

  const act = await catalogo.activarContabilidad(companyId, { anio: 2026 });

  act.periodos === 12
    ? bien('★ se crean los DOCE periodos de golpe, no conforme se necesiten')
    : mal('no se crearon 12 periodos', act.periodos);

  act.cuentas > 400
    ? bien(`catálogo semilla: ${act.cuentas} cuentas`)
    : mal('el catálogo semilla salió corto', act.cuentas);

  /* ── Las fechas del ejercicio ──
   * Un ejercicio que termina ANTES de empezar pasa inadvertido hasta que algo
   * busca el periodo de una fecha y no encuentra ninguno. */
  const fy = await query<any>(
    `SELECT fecha_inicio, fecha_fin FROM accounting_fiscal_years
      WHERE company_id=$1 AND anio=2026`, [companyId]);
  const f = fy.rows[0];
  const iso = (d: any) => new Date(d).toISOString().slice(0, 10);
  iso(f.fecha_inicio) === '2026-01-01' && iso(f.fecha_fin) === '2026-12-31'
    ? bien('el ejercicio 2026 va del 01/01/2026 al 31/12/2026')
    : mal('las fechas del ejercicio están mal', { i: iso(f.fecha_inicio), f: iso(f.fecha_fin) });

  /* Y el caso que nadie prueba: ejercicio irregular que no arranca en enero. */
  const otra = await query<any>(
    `SELECT id FROM companies ORDER BY created_at OFFSET 1 LIMIT 1`);
  if (otra.rows.length) {
    const c2 = otra.rows[0].id;
    await query(`DELETE FROM accounting_periods WHERE company_id=$1`, [c2]);
    await query(`DELETE FROM accounting_accounts WHERE company_id=$1`, [c2]);
    await query(`DELETE FROM accounting_fiscal_years WHERE company_id=$1`, [c2]);
    await catalogo.activarContabilidad(c2, {
      anio: 2026, mesInicioEjercicio: 7, sembrarCatalogo: false });
    const fy2 = await query<any>(
      `SELECT fecha_inicio, fecha_fin FROM accounting_fiscal_years
        WHERE company_id=$1 AND anio=2026`, [c2]);
    iso(fy2.rows[0].fecha_inicio) === '2026-07-01' && iso(fy2.rows[0].fecha_fin) === '2027-06-30'
      ? bien('★ un ejercicio que arranca en julio cierra el 30/06 del año siguiente')
      : mal('el ejercicio irregular salió mal',
            { i: iso(fy2.rows[0].fecha_inicio), f: iso(fy2.rows[0].fecha_fin) });
    await query(`DELETE FROM accounting_periods WHERE company_id=$1`, [c2]);
    await query(`DELETE FROM accounting_fiscal_years WHERE company_id=$1`, [c2]);
  }

  /* ── 7. LAS DOS COLUMNAS ──
   * El corazón de la decisión: hoy valen lo mismo, y aun así son dos. */
  titulo('7. codigo y codigo_agrupador son DOS columnas');

  const dos = await query<any>(
    `SELECT COUNT(*)::int n FROM accounting_accounts
      WHERE company_id=$1 AND codigo = codigo_agrupador`, [companyId]);
  dos.rows[0].n > 400
    ? bien(`${dos.rows[0].n} cuentas nacen con los dos códigos iguales`)
    : mal('los códigos no se sembraron iguales', dos.rows[0].n);

  /* Y lo que importa: re-numerar la cuenta propia NO toca el agrupador. */
  const bancoCta = await query<any>(
    `SELECT id, codigo, codigo_agrupador FROM accounting_accounts
      WHERE company_id=$1 AND codigo='102.01'`, [companyId]);
  await query(`UPDATE accounting_accounts SET codigo='1102-001' WHERE id=$1`,
    [bancoCta.rows[0].id]);
  const tras = await query<any>(
    `SELECT codigo, codigo_agrupador FROM accounting_accounts WHERE id=$1`,
    [bancoCta.rows[0].id]);
  tras.rows[0].codigo === '1102-001' && tras.rows[0].codigo_agrupador === '102.01'
    ? bien('★ re-numerar a "1102-001" deja el agrupador en 102.01 — el empate es posible')
    : mal('re-numerar arrastró el agrupador', tras.rows[0]);
  await query(`UPDATE accounting_accounts SET codigo='102.01' WHERE id=$1`,
    [bancoCta.rows[0].id]);

  /* ── 8. El padre no recibe movimientos ── */
  titulo('8. Una cuenta con hijos no admite movimientos');

  const padres = await query<any>(
    `SELECT c.codigo FROM accounting_accounts c
      WHERE c.company_id=$1 AND c.permite_movimientos
        AND EXISTS (SELECT 1 FROM accounting_accounts h WHERE h.parent_id=c.id)`,
    [companyId]);
  padres.rows.length === 0
    ? bien('ningún padre quedó admitiendo movimientos')
    : mal('hay padres con movimientos', padres.rows.map((x: any) => x.codigo).slice(0, 5));

  /* Y el trigger lo apaga solo al colgarle un hijo a una hoja. */
  const hoja = await query<any>(
    `SELECT id, codigo FROM accounting_accounts
      WHERE company_id=$1 AND codigo='102.02'`, [companyId]);
  await catalogo.crearCuenta(companyId, {
    codigo: '102.02.001', nombre: 'ZZ prueba subcuenta', parentId: hoja.rows[0].id,
  });
  const trasHijo = await query<any>(
    `SELECT permite_movimientos FROM accounting_accounts WHERE id=$1`, [hoja.rows[0].id]);
  trasHijo.rows[0].permite_movimientos === false
    ? bien('★ al colgarle una subcuenta, 102.02 deja de admitir movimientos sola')
    : mal('el trigger no apagó el padre');

  /* ── 9. Herencia y validaciones del alta ── */
  titulo('9. Alta de cuentas');

  const hija = await query<any>(
    `SELECT tipo, naturaleza, nif_norma FROM accounting_accounts
      WHERE company_id=$1 AND codigo='102.02.001'`, [companyId]);
  hija.rows[0].tipo === 'ACTIVO' && hija.rows[0].naturaleza === 'DEUDORA'
    ? bien('la subcuenta hereda tipo y naturaleza del padre')
    : mal('no heredó del padre', hija.rows[0]);

  try {
    await catalogo.crearCuenta(companyId, {
      codigo: '999-XYZ', nombre: 'ZZ no cuelga', parentId: hoja.rows[0].id,
    });
    mal('aceptó una subcuenta que no cuelga del código del padre');
  } catch (e: any) {
    /102\.02/.test(e.message)
      ? bien('★ rechaza "999-XYZ" bajo 102.02, y dice de qué padre debía colgar')
      : mal('rechazó sin decir el padre', e.message);
  }

  try {
    await catalogo.crearCuenta(companyId, {
      codigo: 'ZZ-1', nombre: 'ZZ agrupador falso',
      tipo: 'ACTIVO', naturaleza: 'DEUDORA', codigoAgrupador: '999.99',
    });
    mal('aceptó un código agrupador que no existe en el Anexo 24');
  } catch (e: any) {
    /999\.99/.test(e.message)
      ? bien('★ un agrupador inventado se rechaza AL CAPTURAR, no el día del envío')
      : mal('rechazó sin nombrar el agrupador', e.message);
  }

  try {
    await catalogo.crearCuenta(companyId, {
      codigo: '101', nombre: 'ZZ duplicada', tipo: 'ACTIVO', naturaleza: 'DEUDORA',
    });
    mal('aceptó un código duplicado');
  } catch (e: any) {
    /101/.test(e.message) ? bien('rechaza el código duplicado') : mal('mensaje confuso', e.message);
  }

  /* ── 10. Equivalencias con otros catálogos ── */
  titulo('10. Empate con otros catálogos');

  const cliente = await query<any>(
    `SELECT id FROM accounting_accounts WHERE company_id=$1 AND codigo='105.01'`, [companyId]);
  const cid = cliente.rows[0].id;

  await catalogo.fijarEquivalencia(companyId, cid, 'despacho', '1200-001', 'Clientes');
  await catalogo.fijarEquivalencia(companyId, cid, 'edosfinancieros', 'G2-01');

  const eqs = await catalogo.equivalenciasDeCuenta(companyId, cid);
  eqs.length === 2
    ? bien('★ una cuenta puede tener equivalencia en VARIOS catálogos a la vez')
    : mal('no admitió varios catálogos', eqs.length);

  /* El mismo catálogo dos veces actualiza, no duplica: dos equivalencias en el
   * mismo catálogo serían ambigüedad pura al exportar. */
  await catalogo.fijarEquivalencia(companyId, cid, 'despacho', '1200-999');
  const eqs2 = await catalogo.equivalenciasDeCuenta(companyId, cid);
  eqs2.length === 2 && eqs2.find((e: any) => e.catalogo === 'DESPACHO')?.codigo_externo === '1200-999'
    ? bien('★ re-mapear el mismo catálogo actualiza, no duplica')
    : mal('duplicó la equivalencia', eqs2.length);

  const cats = await catalogo.listarCatalogosExternos(companyId);
  cats.length === 2
    ? bien(`lista los catálogos externos: ${cats.map((c: any) => c.catalogo).join(', ')}`)
    : mal('no listó los catálogos', cats);

  /* ── 11. Baja ── */
  titulo('11. Desactivar, nunca borrar');

  try {
    await catalogo.desactivarCuenta(companyId, hoja.rows[0].id);
    mal('desactivó una cuenta con subcuentas activas');
  } catch (e: any) {
    /subcuenta/i.test(e.message)
      ? bien('no se desactiva una cuenta que tiene subcuentas activas')
      : mal('mensaje confuso', e.message);
  }

  const sub = await query<any>(
    `SELECT id FROM accounting_accounts WHERE company_id=$1 AND codigo='102.02.001'`,
    [companyId]);
  const baja = await catalogo.desactivarCuenta(companyId, sub.rows[0].id);
  baja.activa === false
    ? bien('la baja desactiva y la fila sigue ahí: sus pólizas la seguirán usando')
    : mal('la baja no funcionó');

  /* ── 12. Revisión del catálogo ── */
  titulo('12. Revisión del catálogo');

  const rev = await catalogo.revisarCatalogo(companyId);
  rev.total > 400
    ? bien(`revisa ${rev.total} cuentas, ${rev.movimiento} de movimiento`)
    : mal('la revisión no encontró el catálogo', rev.total);

  rev.errores === 0
    ? bien('★ el catálogo semilla no tiene errores de estructura')
    : mal('el catálogo semilla trae errores', rev.avisos.filter((a: any) => a.nivel === 'ERROR'));

  /* Y que SÍ detecte el problema cuando existe: se fuerza un padre con
   * movimientos saltándose el trigger. */
  await query(
    `UPDATE accounting_accounts SET permite_movimientos=TRUE
      WHERE company_id=$1 AND codigo='102'`, [companyId]);
  const rev2 = await catalogo.revisarCatalogo(companyId);
  rev2.errores > 0 && rev2.avisos.some((a: any) => /102/.test((a.cuentas || []).join(' ')))
    ? bien('★ detecta un padre que admite movimientos, y dice cuál es')
    : mal('no detectó el padre con movimientos', rev2.errores);

  /* Se deshace el desperfecto: una prueba que ensucia la base de desarrollo
   * hace que la siguiente persona vea un error del producto que no existe.
   * (Pasó: la pantalla reportaba "102 Bancos" como error de catálogo.) */
  await query(
    `UPDATE accounting_accounts SET permite_movimientos=FALSE
      WHERE company_id=$1 AND codigo='102'`, [companyId]);
  const rev3 = await catalogo.revisarCatalogo(companyId);
  rev3.errores === 0
    ? bien('★ y la prueba deja la base como la encontró')
    : mal('la prueba dejó errores atrás', rev3.errores);

  /* ── Limpieza ── */
  await query(`DELETE FROM accounting_accounts WHERE company_id=$1 AND nombre LIKE 'ZZ %'`,
    [companyId]);

  console.log(`\n═══ ${ok} bien, ${ko} mal ═══\n`);
  await pool.end();
  process.exit(ko ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\n✘ reventó:', e);
  await pool.end();
  process.exit(1);
});
