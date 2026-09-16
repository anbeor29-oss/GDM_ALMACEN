/**
 * Estado de resultados (CONTABLE, no NIF) — el que entrega el despacho (estilo
 * CONTPAQi): el ÁRBOL del catálogo de las cuentas de resultados (Ingresos →
 * Ingresos por servicios → Servicios contables…; Gastos → Gastos generales →
 * Sueldos…), con el movimiento de cada cuenta. Dos presentaciones:
 *
 *   MENSUAL → dos columnas: PERIODO (el mes elegido) y ACUMULADO (1-ene al fin
 *             de ese mes).
 *   ANUAL   → doce columnas (ene…dic) y TOTAL, una por mes.
 *
 * A diferencia del «Estado de resultado integral» (NIF B-3), NO reagrupa por
 * rubro normado: respeta la numeración y los nombres del catálogo, que es el
 * documento con el que trabaja —y que firma— el contador. Ingresos suman, gastos
 * (costos, gastos y RIF) restan; Utilidad = Ingresos − Gastos.
 */

import { query } from '../../config/database';
import { balanzaDelPeriodo, nombreMes } from './periodos.service';
import { listarCuentas } from './catalogo.service';
import {
  ExcelJS, C, titulo, dato, encabezado, celda, totales, anchos, aBuffer,
} from '../nomina/estilo-excel';
import { reporteTablaPdf, ColumnaPdf } from '../../utils/reporte-pdf';

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const MESES_LARGO = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES3 = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const LEYENDA =
  'Bajo protesta de decir verdad, manifiesto que la información y cifras contenidas en este estado ' +
  'financiero son veraces, completas y reflejan razonablemente la situación financiera y los resultados ' +
  'de la empresa, asumiendo la responsabilidad legal que de ello derive.';

/** La sección del estado a la que pertenece una cuenta, por su tipo. */
function seccionDe(tipo: string): 'INGRESOS' | 'GASTOS' | null {
  if (tipo === 'INGRESO') return 'INGRESOS';
  if (tipo === 'COSTO' || tipo === 'GASTO' || tipo === 'RIF') return 'GASTOS';
  return null;
}

export interface NodoR {
  codigo: string;
  nombre: string;
  nivel: number;
  /** Un valor por columna, ya con el signo de la sección (ingreso +, gasto +). */
  valores: number[];
  hijos: NodoR[];
}

async function empresaDe(companyId: string) {
  const r = await query<any>('SELECT business_name, rfc FROM companies WHERE id=$1', [companyId]);
  const e = r.rows[0] || {};
  return { business_name: e.business_name || '', rfc: e.rfc || '' };
}

/**
 * Arma las dos secciones (ingresos, gastos) desde el catálogo y los valores
 * propios de cada cuenta (una entrada por columna). Hace rollup a los mayores y
 * poda las ramas en cero.
 */
function armarSecciones(
  cuentas: any[], propioPorId: Map<string, number[]>, ncols: number,
): { ingresos: NodoR[]; gastos: NodoR[] } {
  const porId = new Map<string, any>();
  for (const c of cuentas) {
    if (!seccionDe(c.tipo)) continue;
    porId.set(c.id, {
      id: c.id, parent_id: c.parent_id, codigo: c.codigo, nombre: c.nombre,
      nivel: Number(c.nivel) || 1, tipo: c.tipo,
      propio: propioPorId.get(c.id) || new Array(ncols).fill(0), hijos: [] as any[],
    });
  }
  const raices: any[] = [];
  for (const n of porId.values()) {
    if (n.parent_id && porId.has(n.parent_id)) porId.get(n.parent_id).hijos.push(n);
    else raices.push(n);
  }

  function armar(n: any): NodoR | null {
    const hijos = n.hijos
      .map(armar)
      .filter((x: NodoR | null): x is NodoR => x !== null)
      .sort((a: NodoR, b: NodoR) => String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true }));
    const valores = new Array(ncols).fill(0);
    for (let k = 0; k < ncols; k++) {
      valores[k] = r2(n.propio[k] + hijos.reduce((a: number, h: NodoR) => a + h.valores[k], 0));
    }
    const algo = valores.some((v) => Math.abs(v) >= 0.005) || hijos.length > 0;
    if (!algo) return null;
    return { codigo: n.codigo, nombre: n.nombre, nivel: n.nivel, valores, hijos };
  }

  const seccion = (sec: 'INGRESOS' | 'GASTOS') => raices
    .filter((n) => seccionDe(n.tipo) === sec)
    .map(armar)
    .filter((x: NodoR | null): x is NodoR => x !== null)
    .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true }));

  return { ingresos: seccion('INGRESOS'), gastos: seccion('GASTOS') };
}

const sumaCols = (nodos: NodoR[], ncols: number): number[] => {
  const t = new Array(ncols).fill(0);
  for (const n of nodos) for (let k = 0; k < ncols; k++) t[k] = r2(t[k] + n.valores[k]);
  return t;
};

/* ═══════════════════════════════════════════════════════════════════════════
   MENSUAL — PERIODO (mes) + ACUMULADO (1-ene al fin del mes)
   ═══════════════════════════════════════════════════════════════════════════ */

export interface EstadoResultadosMensual {
  vacio: boolean;
  anio: number; mes: number;
  fechaCorte: string | null;
  empresa: { business_name: string; rfc: string };
  ingresos: NodoR[]; gastos: NodoR[];
  totalIngresos: number[]; totalGastos: number[]; utilidad: number[];
}

export async function estadoResultadosMensual(companyId: string, anio: number, mes: number): Promise<EstadoResultadosMensual> {
  const cuentas = await listarCuentas(companyId, { soloActivas: false });
  const empresa = await empresaDe(companyId);

  const base: EstadoResultadosMensual = {
    vacio: true, anio, mes, fechaCorte: null, empresa,
    ingresos: [], gastos: [], totalIngresos: [0, 0], totalGastos: [0, 0], utilidad: [0, 0],
  };

  // Del catálogo, sólo las de resultados: código → id + sección.
  const idPorCod = new Map<string, string>();
  const secPorCod = new Map<string, 'INGRESOS' | 'GASTOS'>();
  for (const c of cuentas) {
    const sec = seccionDe(c.tipo);
    if (sec) { idPorCod.set(String(c.codigo), c.id); secPorCod.set(String(c.codigo), sec); }
  }

  /* PERIODO (movimiento del mes) y ACUMULADO (Σ del movimiento de ene…mes). El
   * acumulado se suma del MOVIMIENTO —no del saldo final— para que arranque en
   * cero cada enero también en las cuentas de RIF (703), que el arrastre de saldos
   * no pone en cero, y para que cuadre exactamente con el reporte anual. */
  const acum = new Map<string, number>();  // id → crédito acumulado ene…mes
  const periodo = new Map<string, number>(); // id → crédito del mes
  let fechaCorte: string | null = null;
  let hayAlgo = false;
  for (let m = 1; m <= mes; m++) {
    const bal = await balanzaDelPeriodo(companyId, anio, m);
    if (!bal) continue;
    if (m === mes) fechaCorte = bal.fechaFin ? String(bal.fechaFin).slice(0, 10) : null;
    for (const f of bal.filas) {
      const id = idPorCod.get(String(f.codigo));
      if (!id) continue;
      hayAlgo = true;
      const cred = (Number(f.abonos) || 0) - (Number(f.cargos) || 0);
      acum.set(id, r2((acum.get(id) || 0) + cred));
      if (m === mes) periodo.set(id, r2(cred));
    }
  }
  if (!hayAlgo) return base;

  // Valor propio por cuenta [periodo, acumulado], ya con el signo de la sección.
  const propio = new Map<string, number[]>();
  for (const [cod, id] of idPorCod) {
    const sec = secPorCod.get(cod)!;
    const s = sec === 'INGRESOS' ? 1 : -1;
    const per = periodo.get(id) || 0;
    const ac = acum.get(id) || 0;
    if (Math.abs(per) < 0.005 && Math.abs(ac) < 0.005) continue;
    propio.set(id, [r2(per * s), r2(ac * s)]);
  }

  const { ingresos, gastos } = armarSecciones(cuentas, propio, 2);
  const totalIngresos = sumaCols(ingresos, 2);
  const totalGastos = sumaCols(gastos, 2);
  const utilidad = [r2(totalIngresos[0] - totalGastos[0]), r2(totalIngresos[1] - totalGastos[1])];

  return {
    vacio: false, anio, mes, fechaCorte,
    empresa, ingresos, gastos, totalIngresos, totalGastos, utilidad,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANUAL — doce columnas (ene…dic) + total
   ═══════════════════════════════════════════════════════════════════════════ */

export interface EstadoResultadosAnual {
  vacio: boolean;
  anio: number;
  empresa: { business_name: string; rfc: string };
  ingresos: NodoR[]; gastos: NodoR[];   // valores = 12 meses
  totalIngresos: number[]; totalGastos: number[]; utilidad: number[]; // 12 meses
}

export async function estadoResultadosAnual(companyId: string, anio: number): Promise<EstadoResultadosAnual> {
  const [empresa, cuentas] = await Promise.all([
    empresaDe(companyId),
    listarCuentas(companyId, { soloActivas: false }),
  ]);

  const porCuentaCod = new Map<string, string>(); // codigo → id (para pegar valores)
  const seccionPorCod = new Map<string, 'INGRESOS' | 'GASTOS'>();
  for (const c of cuentas) {
    const sec = seccionDe(c.tipo);
    if (sec) { porCuentaCod.set(String(c.codigo), c.id); seccionPorCod.set(String(c.codigo), sec); }
  }

  // meses[12] por cuenta (id), con el signo de la sección.
  const propio = new Map<string, number[]>();
  let hayAlgo = false;
  for (let m = 1; m <= 12; m++) {
    const bal = await balanzaDelPeriodo(companyId, anio, m);
    if (!bal) continue;
    for (const f of bal.filas) {
      const cod = String(f.codigo);
      const sec = seccionPorCod.get(cod);
      const id = porCuentaCod.get(cod);
      if (!sec || !id) continue;
      hayAlgo = true;
      const cred = (Number(f.abonos) || 0) - (Number(f.cargos) || 0);
      const val = sec === 'INGRESOS' ? cred : -cred;
      let arr = propio.get(id);
      if (!arr) { arr = new Array(12).fill(0); propio.set(id, arr); }
      arr[m - 1] = r2(val);
    }
  }

  if (!hayAlgo) {
    return { vacio: true, anio, empresa, ingresos: [], gastos: [],
      totalIngresos: new Array(12).fill(0), totalGastos: new Array(12).fill(0), utilidad: new Array(12).fill(0) };
  }

  const { ingresos, gastos } = armarSecciones(cuentas, propio, 12);
  const totalIngresos = sumaCols(ingresos, 12);
  const totalGastos = sumaCols(gastos, 12);
  const utilidad = totalIngresos.map((v, i) => r2(v - totalGastos[i]));

  return { vacio: false, anio, empresa, ingresos, gastos, totalIngresos, totalGastos, utilidad };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PRESENTACIÓN — aplanar el árbol a renglones con sangría
   ═══════════════════════════════════════════════════════════════════════════ */

interface RenglonR { codigo: string; nombre: string; nivel: number; valores: number[]; }
function aplanar(nodos: NodoR[], out: RenglonR[] = []): RenglonR[] {
  for (const n of nodos) {
    out.push({ codigo: n.codigo, nombre: n.nombre, nivel: n.nivel, valores: n.valores });
    if (n.hijos.length) aplanar(n.hijos, out);
  }
  return out;
}

const fechaLarga = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  return `1 de enero de ${d.getFullYear()} al ${d.getDate()} de ${MESES_LARGO[d.getMonth() + 1]} de ${d.getFullYear()}`;
};
const fechaGen = () => new Date().toLocaleString('es-MX');
const stamp = () => {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

/* ═══════════════════════════════════════════════════════════════════════════
   EXCEL
   ═══════════════════════════════════════════════════════════════════════════ */

export async function estadoResultadosMensualExcel(companyId: string, anio: number, mes: number) {
  const d = await estadoResultadosMensual(companyId, anio, mes);
  if (d.vacio) throw new Error(`No hay saldos para el estado de resultados de ${nombreMes(mes)} ${anio}.`);

  const wb = new ExcelJS.Workbook(); wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet('Estado de resultados');
  const cols = ['CÓDIGO', 'CONCEPTO', 'PERIODO', 'ACUMULADO'];
  titulo(ws, 'Estado de resultados', cols.length);
  dato(ws, 3, 1, `Empresa:   ${d.empresa.business_name}`, true);
  dato(ws, 3, 4, `RFC:   ${d.empresa.rfc}`);
  dato(ws, 4, 1, `Del ${fechaLarga(d.fechaCorte)}`);
  dato(ws, 4, 4, `Generado:   ${fechaGen()}`);
  encabezado(ws, 6, cols.map((t) => ({ texto: t, color: C.identidad })));

  let fila = 7;
  const bloque = (etiqueta: string, total: number[], nodos: NodoR[]) => {
    celda(ws, fila, 2, etiqueta, { negrita: true });
    celda(ws, fila, 3, Number(total[0]), { negrita: true });
    celda(ws, fila, 4, Number(total[1]), { negrita: true });
    fila++;
    for (const r of aplanar(nodos)) {
      const sangria = '   '.repeat(Math.max(0, r.nivel - 1));
      celda(ws, fila, 1, r.codigo ? String(r.codigo) : '');
      celda(ws, fila, 2, `${sangria}${r.nombre}`, { negrita: r.nivel <= 2 });
      celda(ws, fila, 3, Number(r.valores[0]), { negrita: r.nivel <= 2 });
      celda(ws, fila, 4, Number(r.valores[1]), { negrita: r.nivel <= 2 });
      fila++;
    }
  };
  bloque('INGRESOS', d.totalIngresos, d.ingresos);
  bloque('GASTOS', d.totalGastos, d.gastos);
  totales(ws, fila, [{ valor: '' }, { valor: 'UTILIDAD (PÉRDIDA) DEL EJERCICIO', centrado: false },
    { valor: Number(d.utilidad[0]) }, { valor: Number(d.utilidad[1]) }]);

  anchos(ws, [16, 48, 18, 18]);
  return { buffer: await aBuffer(wb), nombre: `Estado_resultados_${anio}-${String(mes).padStart(2, '0')}_${stamp()}.xlsx` };
}

export async function estadoResultadosAnualExcel(companyId: string, anio: number) {
  const d = await estadoResultadosAnual(companyId, anio);
  if (d.vacio) throw new Error(`No hay saldos para el estado de resultados anual de ${anio}.`);

  const wb = new ExcelJS.Workbook(); wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet('Estado de resultados anual', { views: [{ state: 'frozen', xSplit: 2, ySplit: 6 }] });
  const cols = ['CÓDIGO', 'CONCEPTO', ...MES3, 'TOTAL'];
  titulo(ws, 'Estado de resultados — anual (por mes)', cols.length);
  dato(ws, 3, 1, `Empresa:   ${d.empresa.business_name}`, true);
  dato(ws, 3, 6, `RFC:   ${d.empresa.rfc}`);
  dato(ws, 4, 1, `Ejercicio:   ${anio} (enero a diciembre)`);
  dato(ws, 4, 6, `Generado:   ${fechaGen()}`);
  encabezado(ws, 6, cols.map((t) => ({ texto: t, color: C.identidad })));

  let fila = 7;
  const total12 = (v: number[]) => r2(v.reduce((a, x) => a + x, 0));
  const bloque = (etiqueta: string, tot: number[], nodos: NodoR[]) => {
    celda(ws, fila, 2, etiqueta, { negrita: true });
    tot.forEach((v, i) => celda(ws, fila, 3 + i, Number(v), { negrita: true }));
    celda(ws, fila, 15, Number(total12(tot)), { negrita: true });
    fila++;
    for (const r of aplanar(nodos)) {
      const sangria = '   '.repeat(Math.max(0, r.nivel - 1));
      celda(ws, fila, 1, r.codigo ? String(r.codigo) : '');
      celda(ws, fila, 2, `${sangria}${r.nombre}`, { negrita: r.nivel <= 2 });
      r.valores.forEach((v, i) => celda(ws, fila, 3 + i, Number(v), { negrita: r.nivel <= 2 }));
      celda(ws, fila, 15, Number(total12(r.valores)), { negrita: r.nivel <= 2 });
      fila++;
    }
  };
  bloque('INGRESOS', d.totalIngresos, d.ingresos);
  bloque('GASTOS', d.totalGastos, d.gastos);
  totales(ws, fila, [{ valor: '' }, { valor: 'UTILIDAD (PÉRDIDA)', centrado: false },
    ...d.utilidad.map((v) => ({ valor: Number(v) })), { valor: Number(total12(d.utilidad)) }]);

  anchos(ws, [14, 40, ...new Array(12).fill(13), 15]);
  return { buffer: await aBuffer(wb), nombre: `Estado_resultados_anual_${anio}_${stamp()}.xlsx` };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PDF
   ═══════════════════════════════════════════════════════════════════════════ */

/** Aplana las dos secciones a las filas del PDF, con el total en la cabecera de
 *  cada sección y la utilidad al final. `claves` son las llaves de columna. */
function filasPdf(
  d: { ingresos: NodoR[]; gastos: NodoR[]; totalIngresos: number[]; totalGastos: number[]; utilidad: number[] },
  claves: string[],
): Array<Record<string, any>> {
  const filas: Array<Record<string, any>> = [];
  const fila = (nombre: string, valores: number[], nivel: number, bold: boolean, fondo?: string) => {
    const f: Record<string, any> = { concepto: '   '.repeat(Math.max(0, nivel - 1)) + nombre };
    claves.forEach((k, i) => { f[k] = valores[i] ?? 0; });
    if (bold) f._bold = true;
    if (fondo) f._fondo = fondo;
    return f;
  };
  const seccion = (etiqueta: string, total: number[], nodos: NodoR[]) => {
    filas.push(fila(etiqueta, total, 1, true, '#EEF2F9'));
    for (const r of aplanar(nodos)) filas.push(fila(r.nombre, r.valores, r.nivel + 1, r.nivel <= 2));
  };
  seccion('INGRESOS', d.totalIngresos, d.ingresos);
  seccion('GASTOS', d.totalGastos, d.gastos);
  filas.push(fila('UTILIDAD (PÉRDIDA) DEL EJERCICIO', d.utilidad, 1, true, '#DCE6F5'));
  return filas;
}

export async function estadoResultadosMensualPdf(companyId: string, anio: number, mes: number) {
  const d = await estadoResultadosMensual(companyId, anio, mes);
  if (d.vacio) throw new Error(`No hay saldos para el estado de resultados de ${nombreMes(mes)} ${anio}.`);

  const columnas: ColumnaPdf[] = [
    { titulo: 'Concepto', clave: 'concepto', ancho: 46, align: 'left' },
    { titulo: 'Periodo', clave: 'periodo', ancho: 18, pesos: true },
    { titulo: 'Acumulado', clave: 'acumulado', ancho: 18, pesos: true },
  ];
  const filas = filasPdf(d, ['periodo', 'acumulado']);
  const buffer = await reporteTablaPdf({
    titulo: `Estado de resultados del ${fechaLarga(d.fechaCorte)}`,
    empresa: d.empresa.business_name, rfc: d.empresa.rfc,
    subtitulos: ['Tipo Moneda: MXN'],
    orientacion: 'portrait',
    columnas, filas,
    nota: LEYENDA,
    firmas: ['Representante Legal', 'Contador Público'],
  });
  return { buffer, nombre: `Estado_resultados_${anio}-${String(mes).padStart(2, '0')}_${stamp()}.pdf` };
}

export async function estadoResultadosAnualPdf(companyId: string, anio: number) {
  const d = await estadoResultadosAnual(companyId, anio);
  if (d.vacio) throw new Error(`No hay saldos para el estado de resultados anual de ${anio}.`);

  const claves = MES3.map((m) => m.toLowerCase());
  // Doce columnas de pesos en horizontal caben justas: se le da poco ancho al
  // concepto (los nombres largos se recortan; el Excel los trae completos) y el
  // suficiente a cada mes para que no se corten los importes de 6 cifras.
  const columnas: ColumnaPdf[] = [
    { titulo: 'Concepto', clave: 'concepto', ancho: 15, align: 'left' },
    ...MES3.map((m, i) => ({ titulo: m, clave: claves[i], ancho: 6, pesos: true } as ColumnaPdf)),
    { titulo: 'TOTAL', clave: 'total', ancho: 7, pesos: true },
  ];
  // Filas con las 12 columnas + total.
  const total12 = (v: number[]) => r2(v.reduce((a, x) => a + x, 0));
  const conTotal = (d2: any) => {
    const filas = filasPdf(d2, claves);
    // Recalcular el total de cada fila desde sus 12 meses.
    for (const f of filas) f.total = total12(claves.map((k) => Number(f[k]) || 0));
    return filas;
  };
  const buffer = await reporteTablaPdf({
    titulo: `Estado de resultados — ejercicio ${anio} (por mes)`,
    empresa: d.empresa.business_name, rfc: d.empresa.rfc,
    subtitulos: ['Tipo Moneda: MXN'],
    orientacion: 'landscape',
    columnas, filas: conTotal(d),
    nota: LEYENDA,
    firmas: ['Representante Legal', 'Contador Público'],
  });
  return { buffer, nombre: `Estado_resultados_anual_${anio}_${stamp()}.pdf` };
}

export default {
  estadoResultadosMensual, estadoResultadosAnual,
  estadoResultadosMensualExcel, estadoResultadosAnualExcel,
  estadoResultadosMensualPdf, estadoResultadosAnualPdf,
};
