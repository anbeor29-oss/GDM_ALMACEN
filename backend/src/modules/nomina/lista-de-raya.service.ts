/**
 * lista-de-raya.service — la prenómina en el formato de la casa.
 *
 * ES EL FORMATO DEL SISTEMA ANTERIOR, CONSERVADO
 * "Lista de Raya (Forma Tabular)": encabezado con la empresa, el periodo y el
 * registro patronal; tres bandas —INGRESOS, DESCUENTOS, NETO—; un renglón por
 * trabajador y una fila de totales. Se conserva porque es contra lo que la
 * gente ya sabe cuadrar, y cambiarlo obligaría a reaprender la lectura de una
 * hoja que se revisa cada semana.
 *
 * LAS COLUMNAS SON DINÁMICAS, Y ESO ES LO IMPORTANTE
 * Después del sueldo base va UNA COLUMNA POR CADA CONCEPTO que aparezca en el
 * periodo —"P004 · REEMBOLSO GASTOS MÉDICOS", "D020 · FALTAS Y RETARDOS"— y no
 * una columna genérica de "otros". Así se ve de un vistazo a quién le tocó qué,
 * que es justo lo que no se puede hacer en la pantalla sin abrir cada celda.
 * Un periodo sin bonos no arrastra columnas vacías; uno con seis conceptos trae
 * seis.
 *
 * EL IMSS, EL ISR Y EL INFONAVIT VAN APARTE
 * Aunque son deducciones, tienen columna propia y fija: son las tres que
 * siempre se revisan y siempre están. Meterlas entre los conceptos variables
 * las movería de lugar cada semana.
 */

import { query } from '../../config/database';
import {
  ExcelJS, C, FUENTE, titulo, dato, banda, encabezado, celda, totales, anchos, aBuffer,
} from './estilo-excel';
import { calcular, CapturaPorTrabajador } from './prenomina.service';
import { PERCEPCIONES, DEDUCCIONES } from './motor';

const n2 = (v: any) => Math.round((Number(v) || 0) * 100) / 100;

const NOMBRE_PERCEPCION = new Map(PERCEPCIONES.map((p) => [p.clave, p.nombre]));
const NOMBRE_DEDUCCION  = new Map(DEDUCCIONES.map((d) => [d.clave, d.nombre]));

/** "P004 · REEMBOLSO GASTOS MÉDICOS" — como en el formato de la casa. */
function encabezadoDe(lado: 'P' | 'D', clave: string): string {
  const nombre = lado === 'P'
    ? NOMBRE_PERCEPCION.get(clave)
    : NOMBRE_DEDUCCION.get(clave);
  return `${lado}${clave} · ${(nombre || 'CONCEPTO').toUpperCase()}`;
}

/** Las tres deducciones con columna propia; no entran a las variables. */
const FIJAS_DEDUCCION = new Set(['001', '002', '012']);   // IMSS, ISR, INFONAVIT

export async function generarListaDeRaya(
  companyId: string,
  periodoId: string,
  captura: CapturaPorTrabajador[] = []
): Promise<{ buffer: Buffer; nombre: string }> {
  const pre = await calcular(companyId, periodoId, { captura });
  const p = pre.periodo;

  const emp = await query<any>(
    `SELECT business_name, rfc, registro_patronal FROM companies WHERE id = $1`,
    [companyId]
  );
  const empresa = emp.rows[0] || {};

  /* ── Qué conceptos aparecieron ──
   * Se recorren TODOS los renglones antes de dibujar nada: la columna existe si
   * alguien la usó, aunque sea uno de cien. */
  const clavesPercepcion = new Set<string>();
  const clavesDeduccion  = new Set<string>();
  for (const r of pre.renglones) {
    for (const x of r.percepciones) {
      if (!(x as any).esSueldoDelPeriodo) clavesPercepcion.add(x.clave);
    }
    for (const x of r.deducciones) {
      if (!FIJAS_DEDUCCION.has(x.clave)) clavesDeduccion.add(x.clave);
    }
  }
  const percep = [...clavesPercepcion].sort();
  const deduc  = [...clavesDeduccion].sort();

  /* ── El encabezado de columnas ── */
  const cols: string[] = [
    '#', 'NOMBRE', 'SUELDO\nBASE',
    ...percep.map((c) => encabezadoDe('P', c)),
    'TOTAL\nPERCEPCIONES',
    'IMSS\nOBRERO', 'ISR\n(ISPT)', 'INFONAVIT',
    ...deduc.map((c) => encabezadoDe('D', c)),
    'TOTAL\nDESCUENTOS', 'NETO\nA RECIBIR',
  ];

  /* La banda de grupos: dónde empieza y termina cada una. */
  const iTotalPerc = 3 + percep.length;              // TOTAL PERCEPCIONES
  const iImss      = iTotalPerc + 1;
  const iTotalDesc = iImss + 3 + deduc.length;
  const iNeto      = iTotalDesc + 1;

  /* ── La hoja, con los colores del formato de la casa ──
   *
   * Se arma con ExcelJS y no con SheetJS porque la versión libre de SheetJS
   * IGNORA los estilos al guardar: la hoja salía correcta en datos y en blanco
   * y negro. Los colores no son adorno aquí — separan de un vistazo ingresos,
   * descuentos y neto en una tabla de veinte columnas. */
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet('Lista de Raya', {
    views: [{ state: 'frozen', ySplit: 9, xSplit: 2 }],
  });

  titulo(ws, 'GDM NEXO · Lista de Raya (Forma Tabular)', cols.length);

  dato(ws, 3, 3, empresa.business_name || '', true);
  dato(ws, 3, 7, `Fecha:   ${new Date().toLocaleDateString('es-MX')}`);
  dato(ws, 4, 3, `Período:   ${etiquetaDelPeriodo(p)}`);
  dato(ws, 4, 7, `Hora:   ${new Date().toLocaleTimeString('es-MX')}`);
  dato(ws, 5, 3, `RFC:   ${empresa.rfc || ''}`);
  dato(ws, 6, 3, `Reg. Patronal:   ${empresa.registro_patronal || '(sin capturar)'}`);

  /* Las tres bandas, en la fila 8. */
  banda(ws, 8, 1, iTotalPerc + 1, '◀  INGRESOS  ▶', C.ingresos);
  banda(ws, 8, iImss + 1, iTotalDesc + 1, '◀  DESCUENTOS  ▶', C.descuentos);
  banda(ws, 8, iNeto + 1, iNeto + 1, '◀  NETO  ▶', C.neto);

  /* Cada encabezado con el color de su bloque. */
  encabezado(ws, 9, cols.map((texto, i) => {
    if (i <= 1) return { texto, color: C.identidad };
    if (i === iTotalPerc) return { texto, color: C.totalIngresos };
    if (i < iTotalPerc) return { texto, color: C.ingresos };
    if (i === iTotalDesc) return { texto, color: C.totalDescuentos };
    if (i === iNeto) return { texto, color: C.neto };
    return { texto, color: C.descuentos };
  }));

  /* ── Un renglón por trabajador ── */
  const suma: Record<string, number> = {};
  const acumula = (k: string, v: number) => { suma[k] = (suma[k] || 0) + (Number(v) || 0); };

  let fila = 10;
  pre.renglones.forEach((r, i) => {
    let col = 1;
    celda(ws, fila, col++, i + 1, { tinta: 'gris', centrado: true, pesos: false });
    celda(ws, fila, col++, r.nombre);
    celda(ws, fila, col++, n2(r.sueldo));
    acumula('sueldo', r.sueldo);

    for (const c of percep) {
      const v = r.percepciones
        .filter((x: any) => x.clave === c && !x.esSueldoDelPeriodo)
        .reduce((a: number, x: any) => a + x.importe, 0);
      celda(ws, fila, col++, v ? n2(v) : '');
      acumula(`P${c}`, v);
    }

    celda(ws, fila, col++, n2(r.totalPercepciones), { negrita: true });
    acumula('totalPerc', r.totalPercepciones);

    celda(ws, fila, col++, n2(r.imss), { tinta: 'rojo' }); acumula('imss', r.imss);
    celda(ws, fila, col++, n2(r.isr),  { tinta: 'rojo' }); acumula('isr', r.isr);

    const infonavit = r.deducciones
      .filter((x: any) => x.clave === '012')
      .reduce((a: number, x: any) => a + x.importe, 0);
    celda(ws, fila, col++, infonavit ? n2(infonavit) : '', { tinta: 'rojo' });
    acumula('infonavit', infonavit);

    for (const c of deduc) {
      const v = r.deducciones
        .filter((x: any) => x.clave === c)
        .reduce((a: number, x: any) => a + x.importe, 0);
      celda(ws, fila, col++, v ? n2(v) : '', { tinta: 'rojo' });
      acumula(`D${c}`, v);
    }

    celda(ws, fila, col++, n2(r.totalDeducciones), { tinta: 'rojo', negrita: true });
    acumula('totalDed', r.totalDeducciones);
    celda(ws, fila, col++, n2(r.neto), { tinta: 'verde', negrita: true });
    acumula('neto', r.neto);
    fila++;
  });

  /* ── Totales del período ── */
  const pie: Array<{ valor: any; fondo?: string; tinta?: any; centrado?: boolean }> = [
    { valor: '' },
    { valor: 'TOTALES DEL PERÍODO', centrado: true },
    { valor: n2(suma.sueldo || 0), fondo: C.totalAzul },
  ];
  for (const c of percep) pie.push({ valor: n2(suma[`P${c}`] || 0), fondo: C.totalAzul });
  pie.push({ valor: n2(suma.totalPerc || 0), fondo: C.totalAzul });
  pie.push({ valor: n2(suma.imss || 0),      fondo: C.totalRojo, tinta: 'rojo' });
  pie.push({ valor: n2(suma.isr || 0),       fondo: C.totalRojo, tinta: 'rojo' });
  pie.push({ valor: n2(suma.infonavit || 0), fondo: C.totalRojo, tinta: 'rojo' });
  for (const c of deduc) pie.push({ valor: n2(suma[`D${c}`] || 0), fondo: C.totalRojo, tinta: 'rojo' });
  pie.push({ valor: n2(suma.totalDed || 0),  fondo: C.totalRojo, tinta: 'rojo' });
  pie.push({ valor: n2(suma.neto || 0),      fondo: C.totalVerde, tinta: 'verde' });
  totales(ws, fila, pie);
  fila += 2;

  /* El gravado y el exento del periodo: lo que el CFDI reporta por separado. */
  dato(ws, fila, 2,
    `Gravado del período: ${n2(pre.totales.gravado).toLocaleString('es-MX')}   ·   ` +
    `Exento: ${n2(pre.totales.exento).toLocaleString('es-MX')}   ·   ` +
    `Subsidio al empleo: ${n2(pre.totales.subsidio || 0).toLocaleString('es-MX')}`);
  fila += 2;

  if (pre.avisos?.length) {
    for (const a of pre.avisos) { dato(ws, fila, 2, a); fila++; }
  }

  anchos(ws, cols.map((c, i) => (i === 0 ? 6 : i === 1 ? 32 : Math.max(13, Math.min(22, c.length + 2)))));

  const buffer = await aBuffer(wb);
  const nombre =
    `lista-de-raya-${p.tipo.toLowerCase()}-${String(p.numero).padStart(2, '0')}-${p.anio}.xlsx`;
  return { buffer, nombre };
}

/** "Quincena 16 · 16 Ago 2026 al 31 Ago 2026 · Año 2026" */
function etiquetaDelPeriodo(p: any): string {
  const nombre: Record<string, string> = {
    SEMANAL: 'Semana', QUINCENAL: 'Quincena', MENSUAL: 'Mes', ESPECIAL: 'Especial',
  };
  const dia = (f: string) => {
    const [a, m, d] = String(f).split('-');
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${Number(d)} ${meses[Number(m) - 1]} ${a}`;
  };
  return `${nombre[p.tipo] || p.tipo} ${p.numero}` +
    (p.concepto ? ` · ${p.concepto}` : '') +
    ` · ${dia(p.fecha_inicio)} al ${dia(p.fecha_fin)} · Año ${p.anio}`;
}
