/**
 * Pruebas del mapeador — acomodar un catálogo ajeno sobre la base del SAT.
 *
 * Lo que se comprueba es una sola idea, mirada desde varios ángulos:
 * el nombre de una cuenta HOJA dice quién es el tercero, no qué es la cuenta.
 * Quien dice qué es, es su cuenta padre.
 *
 * El caso que lo demuestra está en el archivo real: 'AFIRME' aparece dos veces,
 * bajo BANCOS y bajo ACREEDORES DIVERSOS. Un mapeo por nombre manda el pasivo
 * al activo — y la balanza sigue cuadrando, sólo que del lado que no era.
 *
 *   npx ts-node --files -r dotenv/config scripts/probar-mapeo-sat.ts
 */

import fs from 'fs';
import path from 'path';
import { pool } from '../src/config/database';
import * as bal from '../src/modules/accounting/balanza-lector.service';
import * as map from '../src/modules/accounting/mapeador-sat.service';

let ok = 0, ko = 0;
const bien = (m: string) => { ok++; console.log(`  ✔ ${m}`); };
const mal = (m: string, x?: any) => {
  ko++; console.log(`  ✘ ${m}${x !== undefined ? `  → ${JSON.stringify(x)}` : ''}`);
};
const titulo = (t: string) => console.log(`\n${t}`);

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const XLSX = process.env.BALANZA_XLSX
  || path.join(HOME, 'Downloads', 'BALANZA_DE_COMPROBACIÓN_PRO1401108F6_31072026_13073225.xlsx');

/** Arma filas de balanza a mano, para probar sin depender del archivo. */
function f(cuenta: string, nombre: string, nat: 'D' | 'A' = 'D'): bal.FilaBalanza {
  return { cuenta, nombre, naturaleza: nat, saldoInicial: 0, debe: 0, haber: 0, saldoFinal: 0 };
}

async function main() {
  console.log('\n═══ MAPEO SOBRE LA BASE DEL SAT ═══');
  const validos = await map.agrupadoresValidos();
  const mapear = (filas: bal.FilaBalanza[]) =>
    map.proponerMapeo(filas, { agrupadoresValidos: validos });
  const de = (ps: map.PropuestaCuenta[], c: string) => ps.find((p) => p.cuenta === c)!;

  /* ── 1. EL CASO QUE DEFINE EL DISEÑO ── */
  titulo('1. ★ El mismo nombre en dos lugares distintos');

  const dosVeces = mapear([
    f('1-10-20-000', 'BANCOS'),
    f('1-10-20-009', 'AFIRME'),
    f('2-10-30-000', 'ACREEDORES DIVERSOS', 'A'),
    f('2-10-30-003', 'AFIRME', 'A'),
  ]);

  const activo = de(dosVeces, '1-10-20-009');
  const pasivo = de(dosVeces, '2-10-30-003');

  activo.agrupador === '102.01'
    ? bien(`AFIRME bajo BANCOS → ${activo.agrupador} (activo)`)
    : mal('AFIRME bajo BANCOS no quedó en 102.01', activo.agrupador);

  pasivo.agrupador?.startsWith('205')
    ? bien(`★★ el MISMO "AFIRME" bajo ACREEDORES → ${pasivo.agrupador} (pasivo)`)
    : mal('★★ el AFIRME del pasivo se fue al activo — el balance descuadra sin quejarse',
          pasivo.agrupador);

  /* ── 2. Un proveedor que se llama como un banco ── */
  titulo('2. El nombre de la hoja es del TERCERO, no de la cuenta');

  const prov = mapear([
    f('2-10-10-000', 'PROVEEDORES', 'A'),
    f('2-10-10-003', 'BANCO DEL BAJIO S.A., INSTITUCION DE BANCA MULTIPLE', 'A'),
    f('1-10-25-000', 'CLIENTES'),
    f('1-10-25-005', 'NOE ALFREDO SALAS MARTIN DEL CAMPO'),
    f('1-10-25-004', 'VENTA AL PUBLICO EN GENERAL'),
  ]);

  de(prov, '2-10-10-003').agrupador === '201.01'
    ? bien('★ "BANCO DEL BAJIO" como PROVEEDOR → 201.01, no 102')
    : mal('un proveedor llamado como banco se fue al activo', de(prov, '2-10-10-003').agrupador);

  de(prov, '1-10-25-005').agrupador === '105.01'
    ? bien('un cliente con nombre de persona → 105.01, por herencia')
    : mal('el cliente no heredó', de(prov, '1-10-25-005').agrupador);

  de(prov, '1-10-25-004').agrupador === '105.01'
    ? bien('★ "VENTA AL PUBLICO EN GENERAL" sigue siendo CLIENTE: la palabra "venta" no manda')
    : mal('la palabra "venta" en un cliente lo mandó a ingresos',
          de(prov, '1-10-25-004').agrupador);

  /* ── 3. El orden de los sinónimos ── */
  titulo('3. "COSTO DE VENTA" no es una venta');

  const costo = mapear([
    f('5-05-00-000', 'COSTO DE VENTA'),
    f('5-05-10-000', 'REFACCIONES Y ACCESORIOS'),
    f('4-10-10-000', 'VENTAS A TASA DEL 16%', 'A'),
  ]);

  de(costo, '5-05-00-000').agrupador === '501'
    ? bien('★ COSTO DE VENTA → 501, no 401: el comodín de ventas va después de costos')
    : mal('★ el costo de ventas se fue a ingresos, y con él sus subcuentas',
          de(costo, '5-05-00-000').agrupador);

  de(costo, '5-05-10-000').agrupador?.startsWith('501')
    ? bien(`y su hoja lo sigue: ${de(costo, '5-05-10-000').agrupador}`)
    : mal('la hoja del costo quedó en otro lado', de(costo, '5-05-10-000').agrupador);

  de(costo, '4-10-10-000').agrupador === '401.01'
    ? bien('VENTAS A TASA DEL 16% sí es 401.01 (aquí es hoja)')
    : mal('la venta real no mapeó', de(costo, '4-10-10-000').agrupador);

  /* ── 4. Padre más específico ── */
  titulo('4. El padre es el más específico, no el primero que aparece');

  const jer = mapear([
    f('1-10-00-000', 'CIRCULANTE'),
    f('1-10-20-000', 'BANCOS'),
    f('1-10-20-009', 'AFIRME'),
  ]);
  de(jer, '1-10-20-009').padre === '1-10-20-000'
    ? bien('★ AFIRME cuelga de BANCOS, no de CIRCULANTE (los dos códigos miden igual)')
    : mal('escogió el padre equivocado', de(jer, '1-10-20-009').padre);

  /* ── 5. Desacuerdo entre código y nombre ── */
  titulo('5. Cuando el código y el nombre no se ponen de acuerdo');

  const conf = mapear([f('2-50-00-000', 'CLIENTES', 'A')]);
  conf[0].confianza === 'CONFLICTO' && conf[0].agrupador === null
    ? bien('★ "CLIENTES" con código de pasivo: se reporta y NO se elige por nuestra cuenta')
    : mal('resolvió solo un desacuerdo que debía escalar', conf[0]);

  /* Y lo que NO debe ser conflicto: intereses son ingreso para un catálogo y
   * resultado integral de financiamiento para el SAT. */
  const inter = mapear([f('4-10-30-000', 'INTERESES', 'A')]);
  inter[0].confianza !== 'CONFLICTO'
    ? bien(`★ "INTERESES" con código de ingreso NO es conflicto → ${inter[0].agrupador}`)
    : mal('marcó como conflicto una discrepancia normal', inter[0]);

  /* ── 6. Los gastos sí se reconocen por nombre ── */
  titulo('6. En los gastos la hoja SÍ es un concepto, no una persona');

  const gastos = mapear([
    f('6-10-10-000', 'GASTOS GENERALES'),
    f('6-10-10-001', 'UNIFORMES'),
    f('6-10-10-002', 'ENERGIA ELECTRICA'),
    f('6-10-10-003', 'HONORARIOS'),
    f('6-10-10-004', 'CAFETERIA'),
  ]);
  const esp: Array<[string, string]> = [
    ['6-10-10-001', '601.77'], ['6-10-10-002', '601.52'], ['6-10-10-003', '601.34'],
  ];
  for (const [c, e] of esp) {
    de(gastos, c).agrupador === e
      ? bien(`${de(gastos, c).nombre} → ${e}`)
      : mal(`${c} debía ser ${e}`, de(gastos, c).agrupador);
  }
  de(gastos, '6-10-10-004').agrupador?.startsWith('601')
    ? bien(`"CAFETERIA" no es un concepto del Anexo 24 y cae en ${de(gastos, '6-10-10-004').agrupador}`)
    : mal('el gasto sin concepto conocido se perdió');

  /* ── 7. No se propone un agrupador que no existe ── */
  titulo('7. Nunca se propone un código que la base no tiene');

  const todas = mapear([
    f('2-10-30-000', 'ACREEDORES DIVERSOS', 'A'),
    f('2-10-30-001', 'BANBAJIO', 'A'),
  ]);
  const propuesto = de(todas, '2-10-30-001').agrupador!;
  validos.has(propuesto)
    ? bien(`★ propuso ${propuesto}, que sí existe (205.05 no está sembrado y se degradó a su mayor)`)
    : mal('propuso un agrupador inexistente', propuesto);

  /* ── 8. El archivo real ── */
  if (!fs.existsSync(XLSX)) {
    console.log('\n  (el archivo de ejemplo no está aquí — se salta)');
    console.log(`\n═══ ${ok} bien, ${ko} mal ═══\n`);
    await pool.end();
    process.exit(ko ? 1 : 0);
  }

  titulo('8. La balanza real, de punta a punta');

  const ex = await bal.leerBalanzaExcel(fs.readFileSync(XLSX));
  const props = mapear(ex.filas);
  const r = map.resumenMapeo(props);

  console.log(`     ${r.total} cuentas · alta ${r.alta} · media ${r.media} · ` +
              `baja ${r.baja} · conflicto ${r.conflicto}`);

  r.mapeadas / r.total > 0.95
    ? bien(`★ ${r.mapeadas} de ${r.total} cuentas acomodadas sobre el catálogo del SAT`)
    : mal('quedaron demasiadas sin mapear', r.mapeadas);

  r.conflicto === 0
    ? bien('sin desacuerdos entre código y nombre')
    : mal(`${r.conflicto} desacuerdos`, props.filter((p) => p.confianza === 'CONFLICTO')
        .map((p) => `${p.cuenta} ${p.nombre}`).slice(0, 5));

  /* Las que no mapean deben ser encabezados puros, no cuentas con saldo. */
  const sinMapear = props.filter((p) => !p.agrupador);
  sinMapear.every((p) => !p.hoja)
    ? bien(`★ las ${sinMapear.length} sin mapear son encabezados sin saldo propio: ` +
           sinMapear.map((p) => p.nombre).join(', '))
    : mal('hay cuentas de DETALLE sin mapear',
          sinMapear.filter((p) => p.hoja).map((p) => `${p.cuenta} ${p.nombre}`).slice(0, 5));

  /* Ninguna cuenta debe cruzar de lado del balance. */
  const cruzadas = props.filter((p) => {
    if (!p.agrupador || !p.tipoPorCodigo) return false;
    const d = p.agrupador[0];
    const esperado = ({ '1': 'ACTIVO', '2': 'PASIVO', '3': 'CAPITAL', '4': 'INGRESO',
      '5': 'COSTO', '6': 'GASTO', '7': 'RIF', '8': 'ORDEN' } as any)[d];
    if (!esperado) return false;
    const compat = (a: string, b: string) =>
      a === b || [['GASTO', 'RIF'], ['INGRESO', 'RIF'], ['COSTO', 'GASTO'], ['COSTO', 'RIF']]
        .some(([x, y]) => (a === x && b === y) || (a === y && b === x));
    return !compat(p.tipoPorCodigo, esperado);
  });
  cruzadas.length === 0
    ? bien('★★ ninguna cuenta cambió de lado del balance al mapearse')
    : mal('★★ hay cuentas que cruzaron de lado',
          cruzadas.map((p) => `${p.cuenta} ${p.nombre} (${p.tipoPorCodigo}→${p.agrupador})`).slice(0, 6));

  console.log(`\n═══ ${ok} bien, ${ko} mal ═══\n`);
  await pool.end();
  process.exit(ko ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\n✘ reventó:', e);
  await pool.end();
  process.exit(1);
});
