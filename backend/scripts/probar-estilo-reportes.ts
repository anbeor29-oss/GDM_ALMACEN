/**
 * probar-estilo-reportes — que los reportes salgan con los colores del formato.
 *
 * POR QUÉ ESTA PRUEBA EXISTE
 * Porque el error que se cometió antes fue silencioso: SheetJS en su versión
 * libre acepta los estilos, no marca error y los TIRA al guardar. La hoja salía
 * bien en datos y en blanco y negro, y sólo se notaba abriéndola.
 *
 * Así que no basta con generar el archivo: hay que volver a LEERLO y comprobar
 * que el color, la tipografía y el formato de número llegaron. Se compara
 * contra los valores sacados del formato original —"FORMATO A USAR PARA
 * PRENOMINA.xlsx"— y no contra colores parecidos.
 *
 *   npx ts-node -r dotenv/config scripts/probar-estilo-reportes.ts
 *
 * Deja la base como la encontró.
 */
import ExcelJS from 'exceljs';
import { pool, query } from '../src/config/database';
import * as cierre from '../src/modules/nomina/cierre.service';
import * as reportes from '../src/modules/nomina/reportes.service';
import { generarListaDeRaya } from '../src/modules/nomina/lista-de-raya.service';
import { C, FORMATO_PESOS, FUENTE } from '../src/modules/nomina/estilo-excel';

let ok = 0, fallos = 0;
const bien = (q: string) => { ok++; console.log(`  OK  ${q}`); };
const mal  = (q: string, d?: any) => { fallos++; console.log(`  MAL ${q}${d ? ` -- ${d}` : ''}`); };

const NUMS = ['ZE01', 'ZE02'];
const ANIO = 2026;

const fondo = (c: ExcelJS.Cell) => (c.fill as any)?.fgColor?.argb;
const tinta = (c: ExcelJS.Cell) => (c.font as any)?.color?.argb;

async function abrir(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  return wb.worksheets[0];
}

/** Busca una celda por su texto, en toda la hoja. */
function buscar(ws: ExcelJS.Worksheet, texto: RegExp): ExcelJS.Cell | null {
  let hallada: ExcelJS.Cell | null = null;
  ws.eachRow((row) => {
    row.eachCell((c) => {
      if (!hallada && texto.test(String(c.value ?? ''))) hallada = c;
    });
  });
  return hallada;
}

async function limpiar(companyId: string) {
  await query(`DELETE FROM nomina_recibos WHERE company_id=$1 AND num_empleado = ANY($2::text[])`,
    [companyId, NUMS]);
  await query(`DELETE FROM nomina_empleados WHERE company_id=$1 AND num_empleado = ANY($2::text[])`,
    [companyId, NUMS]);
  await query(
    `DELETE FROM nomina_periodos
      WHERE company_id=$1 AND anio=$2 AND tipo='QUINCENAL' AND numero = 21`,
    [companyId, ANIO]);
}

async function main() {
  const c = await query<any>(
    `SELECT id FROM companies WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`
  );
  const companyId = c.rows[0].id;
  await limpiar(companyId);

  for (const [num, nom, rfc, curp, diario] of [
    ['ZE01', 'ELENA', 'ELEN900909KL0', 'ELEN900909MDFSSS10', 800],
    ['ZE02', 'FELIX', 'FELI901010MN1', 'FELI901010HDFMSM11', 315.04],
  ] as any[]) {
    await query(
      `INSERT INTO nomina_empleados
         (company_id, num_empleado, nombre, apellido_pat, rfc, curp, nss,
          fecha_ingreso, tipo_contrato, tipo_regimen, tipo_jornada,
          periodicidad_pago, tipo_nomina, zona_geografica, regimen_fiscal, uso_cfdi,
          salario_diario, salario_diario_integrado, estado, entidad_federativa, activo)
       VALUES ($1,$2,$3,'PRUEBA',$4,$5,'12345678907','2022-03-01','01','02','01','04','O',
               'general','605','CN01',$6,$6*1.05,'JAL','JAL',true)`,
      [companyId, num, nom, rfc, curp, diario]
    );
  }

  const p = await query<any>(
    `INSERT INTO nomina_periodos
       (company_id, anio, tipo, numero, fecha_inicio, fecha_fin, fecha_pago, dias, estatus)
     VALUES ($1,$2,'QUINCENAL',21,'2026-11-01','2026-11-15','2026-11-15',15,'ABIERTO')
     RETURNING id`,
    [companyId, ANIO]
  );
  const periodoId = p.rows[0].id;
  bien('dos trabajadores y una quincena de prueba');

  /* ── 1. La Lista de Raya: el formato de origen ── */
  const lr = await generarListaDeRaya(companyId, periodoId, []);
  const wsLr = await abrir(lr.buffer);

  fondo(wsLr.getCell('A1')) === C.tituloFondo && wsLr.getCell('A1').font?.bold
    ? bien(`Lista de Raya: el título conserva su fondo ${C.tituloFondo}`)
    : mal('el título perdió el estilo', fondo(wsLr.getCell('A1')));

  wsLr.getCell('A1').font?.name === FUENTE && wsLr.getCell('A1').font?.size === 14
    ? bien(`Lista de Raya: ${FUENTE} 14, como el formato`)
    : mal('la tipografía del título no es la del formato',
          `${wsLr.getCell('A1').font?.name} ${wsLr.getCell('A1').font?.size}`);

  const bandaIng = wsLr.getCell(8, 1);
  fondo(bandaIng) === C.ingresos
    ? bien('Lista de Raya: la banda de INGRESOS va en su azul')
    : mal('la banda de ingresos perdió el color', fondo(bandaIng));

  const encId = wsLr.getCell(9, 1);
  fondo(encId) === C.identidad && tinta(encId) === C.blanco
    ? bien('Lista de Raya: los encabezados van en fondo oscuro y letra blanca')
    : mal('el encabezado no quedó como el formato', `${fondo(encId)} / ${tinta(encId)}`);

  wsLr.getCell(10, 3).numFmt === FORMATO_PESOS
    ? bien(`Lista de Raya: los importes con formato de pesos "${FORMATO_PESOS}"`)
    : mal('los importes salieron sin formato de pesos', wsLr.getCell(10, 3).numFmt);

  /* ── 2. Los reportes, con LOS MISMOS colores ── */
  await cierre.cerrarPeriodo(companyId, periodoId, []);
  bien('la quincena cerrada: los reportes ya la ven');

  const f = { anio: ANIO, tipo: 'QUINCENAL' as const, desde: 21, hasta: 21 };

  for (const que of ['prenomina', 'cfdi', 'isr', 'imss'] as const) {
    const x = await reportes.generarExcel(companyId, que, f);
    const ws = await abrir(x.buffer);

    /* El mismo título, el mismo azul: es lo que hace que las cinco hojas se
     * lean como una sola familia cuando se imprimen juntas. */
    const titOk = fondo(ws.getCell('A1')) === C.tituloFondo &&
                  ws.getCell('A1').font?.name === FUENTE &&
                  ws.getCell('A1').font?.size === 14;
    titOk
      ? bien(`${que}: el título usa la misma paleta que la Lista de Raya`)
      : mal(`${que}: el título salió con otro estilo`, fondo(ws.getCell('A1')));

    const enc = ws.getCell(8, 1);
    fondo(enc) === C.identidad && tinta(enc) === C.blanco
      ? bien(`${que}: los encabezados con el fondo de identidad`)
      : mal(`${que}: encabezado sin color`, `${fondo(enc)} / ${tinta(enc)}`);

    /* Un importe cualquiera del cuerpo debe traer los dos decimales. */
    let conPesos = 0;
    ws.eachRow((row, n) => {
      if (n < 9) return;
      row.eachCell((cel) => { if (cel.numFmt === FORMATO_PESOS) conPesos++; });
    });
    conPesos > 0
      ? bien(`${que}: ${conPesos} celdas con pesos a dos decimales`)
      : mal(`${que}: ningún importe trae el formato de pesos`);

    if (que === 'imss') {
      /* El desglose de la patronal: es lo que se pidió para provisionar. */
      buscar(ws, /CUOTA PATRONAL/)
        ? bien('imss: el Excel trae el bloque de la cuota patronal')
        : mal('al Excel del IMSS le falta la cuota patronal');

      buscar(ws, /TOTAL A PROVISIONAR/)
        ? bien('imss: trae el total a provisionar')
        : mal('falta el total a provisionar');

      buscar(ws, /Cesantía y vejez/)
        ? bien('imss: el desglose llega hasta cesantía y vejez')
        : mal('el desglose por rama está incompleto');

      buscar(ws, /ESTIMACIÓN/)
        ? bien('imss: dice que es una estimación y que el SUA manda')
        : mal('no advierte que es una estimación');
    }
  }

  await limpiar(companyId);
  console.log(`\n${ok} bien, ${fallos} mal`);
  await pool.end();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
