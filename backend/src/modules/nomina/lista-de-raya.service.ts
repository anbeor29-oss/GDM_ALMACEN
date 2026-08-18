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

import * as XLSX from 'xlsx';
import { query } from '../../config/database';
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

  const aoa: any[][] = [];

  /* ── Encabezado, igual que el formato de la casa ── */
  aoa.push(['GDM NEXO · Lista de Raya (Forma Tabular)']);
  aoa.push([]);
  aoa.push(['', '', empresa.business_name || '', '', '', '',
            `Fecha:   ${new Date().toLocaleDateString('es-MX')}`]);
  aoa.push(['', '', `Período:   ${etiquetaDelPeriodo(p)}`, '', '', '',
            `Hora:   ${new Date().toLocaleTimeString('es-MX')}`]);
  aoa.push(['', '', `RFC:   ${empresa.rfc || ''}`]);
  aoa.push(['', '', `Reg. Patronal:   ${empresa.registro_patronal || '(sin capturar)'}`]);
  aoa.push([]);

  /* Banda de grupos. Las flechas son del formato original: marcan de un
   * vistazo dónde termina un bloque y empieza el otro. */
  const banda: any[] = new Array(cols.length).fill('');
  banda[0] = '◀  INGRESOS  ▶';
  banda[iImss] = '◀  DESCUENTOS  ▶';
  banda[iNeto] = '◀  NETO  ▶';
  aoa.push(banda);

  aoa.push(cols);

  /* ── Un renglón por trabajador ── */
  const suma: Record<string, number> = {};
  const acumula = (k: string, v: number) => { suma[k] = (suma[k] || 0) + (Number(v) || 0); };

  pre.renglones.forEach((r, i) => {
    const fila: any[] = [i + 1, r.nombre, n2(r.sueldo)];
    acumula('sueldo', r.sueldo);

    for (const c of percep) {
      const v = r.percepciones
        .filter((x: any) => x.clave === c && !x.esSueldoDelPeriodo)
        .reduce((a: number, x: any) => a + x.importe, 0);
      fila.push(v ? n2(v) : '');
      acumula(`P${c}`, v);
    }

    fila.push(n2(r.totalPercepciones)); acumula('totalPerc', r.totalPercepciones);
    fila.push(n2(r.imss));              acumula('imss', r.imss);
    fila.push(n2(r.isr));               acumula('isr', r.isr);

    const infonavit = r.deducciones
      .filter((x: any) => x.clave === '012')
      .reduce((a: number, x: any) => a + x.importe, 0);
    fila.push(infonavit ? n2(infonavit) : ''); acumula('infonavit', infonavit);

    for (const c of deduc) {
      const v = r.deducciones
        .filter((x: any) => x.clave === c)
        .reduce((a: number, x: any) => a + x.importe, 0);
      fila.push(v ? n2(v) : '');
      acumula(`D${c}`, v);
    }

    fila.push(n2(r.totalDeducciones)); acumula('totalDed', r.totalDeducciones);
    fila.push(n2(r.neto));             acumula('neto', r.neto);
    aoa.push(fila);
  });

  /* ── Totales del período ── */
  const tot: any[] = ['', 'TOTALES DEL PERÍODO', n2(suma.sueldo || 0)];
  for (const c of percep) tot.push(n2(suma[`P${c}`] || 0));
  tot.push(n2(suma.totalPerc || 0), n2(suma.imss || 0), n2(suma.isr || 0), n2(suma.infonavit || 0));
  for (const c of deduc) tot.push(n2(suma[`D${c}`] || 0));
  tot.push(n2(suma.totalDed || 0), n2(suma.neto || 0));
  aoa.push(tot);

  /* El gravado y el exento del periodo, debajo: es lo que el CFDI reporta por
   * separado y contra lo que se cuadra la declaración. */
  aoa.push([]);
  aoa.push(['', `Gravado del período: ${n2(pre.totales.gravado)}`, '',
            `Exento: ${n2(pre.totales.exento)}`, '',
            `Subsidio al empleo: ${n2(pre.totales.subsidio || 0)}`]);

  if (pre.avisos?.length) {
    aoa.push([]);
    for (const a of pre.avisos) aoa.push(['', a]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  /* Las combinaciones del formato original. */
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(cols.length - 1, 5) } },  // título
    { s: { r: 2, c: 2 }, e: { r: 2, c: 5 } },                             // razón social
    { s: { r: 3, c: 2 }, e: { r: 3, c: 5 } },                             // periodo
    { s: { r: 4, c: 2 }, e: { r: 4, c: 5 } },                             // RFC
    { s: { r: 5, c: 2 }, e: { r: 5, c: 5 } },                             // registro patronal
    { s: { r: 7, c: 0 }, e: { r: 7, c: iTotalPerc } },                    // INGRESOS
    { s: { r: 7, c: iImss }, e: { r: 7, c: iTotalDesc } },                // DESCUENTOS
  ];

  /* Anchos: el nombre necesita espacio y los importes no. */
  ws['!cols'] = cols.map((c, i) => {
    if (i === 0) return { wch: 6 };
    if (i === 1) return { wch: 32 };
    return { wch: Math.max(13, Math.min(22, c.length + 2)) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Lista de Raya');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
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
