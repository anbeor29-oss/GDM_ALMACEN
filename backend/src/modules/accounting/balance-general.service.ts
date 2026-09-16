/**
 * Balance general (CONTABLE, no NIF) — el estado de situación financiera clásico,
 * tal como lo entrega CONTPAQi: el ÁRBOL del catálogo del contribuyente (Activo →
 * Activo a corto plazo → Bancos → Bancos nacionales → Bancomer), con el saldo de
 * cada cuenta acumulado a la fecha de corte, y el rollup a cada cuenta de mayor.
 *
 * ── EN QUÉ SE DISTINGUE DE «Situación financiera» (NIF B-6) ──
 * La situación NIF agrupa por el código agrupador del SAT en rubros normados
 * (efectivo, clientes neto, inventarios…). Este NO: respeta la numeración y los
 * nombres del propio catálogo, porque es el documento con el que trabaja el
 * despacho —el que firma el contador—, no la presentación normada.
 *
 * ── DE DÓNDE SALEN LAS CIFRAS ──
 * Del MISMO sitio que la balanza del periodo (`accounting_period_balances`), así
 * que el balance dice exactamente lo que la balanza. El «Resultado del ejercicio»
 * se calcula de las cuentas de resultados (4–7) y se presenta como un renglón del
 * capital, para que el balance cuadre aunque el ejercicio no se haya cerrado.
 */

import PDFDocument from 'pdfkit';
import { query } from '../../config/database';
import { balanzaDelPeriodo } from './periodos.service';
import { listarCuentas } from './catalogo.service';
import {
  ExcelJS, C, titulo, dato, encabezado, celda, anchos, aBuffer,
} from '../nomina/estilo-excel';

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

export interface NodoBalance {
  codigo: string;
  nombre: string;
  nivel: number;
  /** Saldo acumulado a la fecha de corte, con el signo de su sección (activo en
   *  deudora +, pasivo/capital en acreedora +). Ya trae el rollup de sus hijos. */
  saldo: number;
  hijos: NodoBalance[];
}

export interface BalanceGeneral {
  vacio: boolean;
  anio: number;
  mes: number;
  fechaCorte: string | null;
  empresa: { business_name: string; rfc: string };
  activo: NodoBalance[];
  pasivo: NodoBalance[];
  capital: NodoBalance[];
  totalActivo: number;
  totalPasivo: number;
  totalCapital: number;
  resultadoEjercicio: number;
  totalPasivoCapital: number;
  diferencia: number;
  cuadra: boolean;
}

async function empresaDe(companyId: string) {
  const r = await query<any>('SELECT business_name, rfc FROM companies WHERE id=$1', [companyId]);
  const e = r.rows[0] || {};
  return { business_name: e.business_name || '', rfc: e.rfc || '' };
}

/** El signo con el que una cuenta entra a su sección del balance.
 *  Activo es de naturaleza deudora; pasivo y capital, acreedora. Una cuenta
 *  «complementaria» (depreciación acumulada, p. ej.) entra con signo contrario y
 *  así resta —lo hace el propio saldo, que ya viene por naturaleza—. */
function signo(tipo: string, naturaleza: string): number {
  const acreedora = naturaleza === 'ACREEDORA';
  if (tipo === 'ACTIVO') return acreedora ? -1 : 1;
  // PASIVO, CAPITAL y las de resultados se miden del lado acreedor.
  return acreedora ? 1 : -1;
}

export async function balanceGeneral(companyId: string, anio: number, mes: number): Promise<BalanceGeneral> {
  const [empresa, bal, cuentas] = await Promise.all([
    empresaDe(companyId),
    balanzaDelPeriodo(companyId, anio, mes),
    listarCuentas(companyId, { soloActivas: false }),
  ]);

  const vacioBase: BalanceGeneral = {
    vacio: true, anio, mes, fechaCorte: null, empresa,
    activo: [], pasivo: [], capital: [],
    totalActivo: 0, totalPasivo: 0, totalCapital: 0, resultadoEjercicio: 0,
    totalPasivoCapital: 0, diferencia: 0, cuadra: true,
  };
  if (!bal || !bal.filas.length) return vacioBase;

  // Saldo final por código, tal como lo trae la balanza (magnitud por naturaleza).
  const saldoPorCodigo = new Map<string, number>();
  for (const f of bal.filas) saldoPorCodigo.set(String(f.codigo), Number(f.saldo_final) || 0);

  // El catálogo como árbol (por parent_id), con el saldo propio de cada cuenta ya
  // firmado según su sección.
  const porId = new Map<string, any>();
  for (const c of cuentas) {
    porId.set(c.id, {
      id: c.id, parent_id: c.parent_id, codigo: c.codigo, nombre: c.nombre,
      nivel: Number(c.nivel) || 1, tipo: c.tipo, naturaleza: c.naturaleza,
      propio: 0, hijos: [] as any[],
    });
  }
  for (const n of porId.values()) {
    const sf = saldoPorCodigo.get(String(n.codigo));
    if (sf !== undefined) n.propio = sf * signo(n.tipo, n.naturaleza);
  }
  const raices: any[] = [];
  for (const n of porId.values()) {
    if (n.parent_id && porId.has(n.parent_id)) porId.get(n.parent_id).hijos.push(n);
    else raices.push(n);
  }

  // Rollup + poda: un nodo se queda si tiene saldo propio o algún hijo que se quede.
  // Devuelve el NodoBalance ya podado, o null si toda su rama está en cero.
  function armar(n: any): NodoBalance | null {
    const hijos = n.hijos
      .map(armar)
      .filter((x: NodoBalance | null): x is NodoBalance => x !== null)
      .sort((a: NodoBalance, b: NodoBalance) =>
        String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true }));
    const total = r2(n.propio + hijos.reduce((a: number, h: NodoBalance) => a + h.saldo, 0));
    if (!hijos.length && Math.abs(total) < 0.005) return null;
    return { codigo: n.codigo, nombre: n.nombre, nivel: n.nivel, saldo: total, hijos };
  }

  const seccion = (tipo: string) => raices
    .filter((n) => n.tipo === tipo)
    .map(armar)
    .filter((x: NodoBalance | null): x is NodoBalance => x !== null)
    .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true }));

  const activo = seccion('ACTIVO');
  const pasivo = seccion('PASIVO');
  const capital = seccion('CAPITAL');

  // Resultado del ejercicio: neto de las cuentas de resultados (4–7), del lado
  // acreedor (ingreso suma, gasto resta). Se presenta como un renglón del capital.
  let resultadoEjercicio = 0;
  for (const n of porId.values()) {
    if (['INGRESO', 'COSTO', 'GASTO', 'RIF'].includes(n.tipo)) {
      resultadoEjercicio += n.propio; // propio ya viene firmado del lado acreedor
    }
  }
  resultadoEjercicio = r2(resultadoEjercicio);
  if (Math.abs(resultadoEjercicio) >= 0.005) {
    capital.push({
      codigo: '', nombre: 'Resultado del ejercicio', nivel: 1,
      saldo: resultadoEjercicio, hijos: [],
    });
  }

  const totalActivo = r2(activo.reduce((a, n) => a + n.saldo, 0));
  const totalPasivo = r2(pasivo.reduce((a, n) => a + n.saldo, 0));
  const totalCapital = r2(capital.reduce((a, n) => a + n.saldo, 0));
  const totalPasivoCapital = r2(totalPasivo + totalCapital);
  const diferencia = r2(totalActivo - totalPasivoCapital);

  return {
    vacio: false, anio, mes,
    fechaCorte: bal.fechaFin ? String(bal.fechaFin).slice(0, 10) : null,
    empresa,
    activo, pasivo, capital,
    totalActivo, totalPasivo, totalCapital, resultadoEjercicio,
    totalPasivoCapital, diferencia,
    cuadra: Math.abs(diferencia) <= 1,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PRESENTACIÓN — aplanar el árbol a renglones con sangría
   ═══════════════════════════════════════════════════════════════════════════ */

interface RenglonPlano { codigo: string; nombre: string; nivel: number; saldo: number; hoja: boolean; }

function aplanar(nodos: NodoBalance[], out: RenglonPlano[] = []): RenglonPlano[] {
  for (const n of nodos) {
    out.push({ codigo: n.codigo, nombre: n.nombre, nivel: n.nivel, saldo: n.saldo, hoja: !n.hijos.length });
    if (n.hijos.length) aplanar(n.hijos, out);
  }
  return out;
}

const fechaLarga = (iso: string | null) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const fechaGen = () => new Date().toLocaleString('es-MX');
const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

/* ═══════════════════════════════════════════════════════════════════════════
   EXCEL — dos bloques lado a lado (Activo | Pasivo + Capital), como el modelo
   ═══════════════════════════════════════════════════════════════════════════ */

export async function balanceGeneralExcel(companyId: string, anio: number, mes: number) {
  const d = await balanceGeneral(companyId, anio, mes);
  if (d.vacio) throw new Error(`No hay saldos para el balance de ${String(mes).padStart(2, '0')}/${anio}.`);

  const wb = new ExcelJS.Workbook(); wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet('Balance general');

  titulo(ws, 'Balance general', 6);
  dato(ws, 3, 1, `Empresa:   ${d.empresa.business_name}`, true);
  dato(ws, 3, 5, `RFC:   ${d.empresa.rfc}`);
  dato(ws, 4, 1, `Al ${fechaLarga(d.fechaCorte)}`);
  dato(ws, 4, 5, `Generado:   ${fechaGen()}`);
  encabezado(ws, 6, [
    { texto: 'ACTIVO', color: C.identidad }, { texto: '', color: C.identidad }, { texto: 'IMPORTE', color: C.identidad },
    { texto: 'PASIVO Y CAPITAL', color: C.identidad }, { texto: '', color: C.identidad }, { texto: 'IMPORTE', color: C.identidad },
  ]);

  // Escribe un bloque (lista de renglones) en un grupo de 3 columnas y devuelve la
  // fila siguiente. col0 = código, col0+1 = nombre con sangría, col0+2 = importe.
  const escribirBloque = (filas: RenglonPlano[], total: { etiqueta: string; valor: number },
    filaIni: number, col0: number): number => {
    let fila = filaIni;
    for (const f of filas) {
      const sangria = '   '.repeat(Math.max(0, f.nivel - 1));
      celda(ws, fila, col0, f.codigo ? String(f.codigo) : '');
      celda(ws, fila, col0 + 1, `${sangria}${f.nombre}`, { negrita: f.nivel <= 2 });
      celda(ws, fila, col0 + 2, Number(f.saldo), { negrita: f.nivel <= 2 });
      fila++;
    }
    celda(ws, fila, col0 + 1, total.etiqueta, { negrita: true });
    celda(ws, fila, col0 + 2, Number(total.valor), { negrita: true });
    return fila + 1;
  };

  const izq = aplanar(d.activo);
  const der = aplanar([...d.pasivo, ...d.capital]);
  const finIzq = escribirBloque(izq, { etiqueta: 'SUMA DEL ACTIVO', valor: d.totalActivo }, 7, 1);
  const finDer = escribirBloque(der, { etiqueta: 'SUMA PASIVO + CAPITAL', valor: d.totalPasivoCapital }, 7, 4);

  const filaCuadre = Math.max(finIzq, finDer) + 1;
  celda(ws, filaCuadre, 1,
    d.cuadra ? 'El balance cuadra.' : `No cuadra por ${d.diferencia}.`, { negrita: true });

  anchos(ws, [16, 40, 16, 16, 40, 16]);
  return {
    buffer: await aBuffer(wb),
    nombre: `Balance_general_${anio}-${String(mes).padStart(2, '0')}_${stamp()}.xlsx`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PDF — dos columnas (Activo | Pasivo + Capital) con encabezado y firmas
   ═══════════════════════════════════════════════════════════════════════════ */

const AZUL_OSCURO = '#162840';
const AZUL = '#1E3D6E';
const GRIS = '#666666';
const LINEA = '#E5E7EB';
const fmtMoney = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: any) => fmtMoney.format(Number(n) || 0);

interface FilaPdf { codigo: string; nombre: string; nivel: number; saldo: number | null; bold: boolean; }

function filasPdf(nodos: NodoBalance[], total: { etiqueta: string; valor: number }): FilaPdf[] {
  const out: FilaPdf[] = aplanar(nodos).map((f) => ({
    codigo: f.codigo, nombre: f.nombre, nivel: f.nivel, saldo: f.saldo, bold: f.nivel <= 2,
  }));
  out.push({ codigo: '', nombre: total.etiqueta, nivel: 1, saldo: total.valor, bold: true });
  return out;
}

export async function balanceGeneralPdf(companyId: string, anio: number, mes: number) {
  const d = await balanceGeneral(companyId, anio, mes);
  if (d.vacio) throw new Error(`No hay saldos para el balance de ${String(mes).padStart(2, '0')}/${anio}.`);

  const M = 40;
  const doc = new PDFDocument({ size: 'LETTER', layout: 'portrait', margin: M, bufferPages: true });
  const trozos: Buffer[] = [];
  doc.on('data', (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(trozos))));

  const contentW = doc.page.width - M * 2;
  const gap = 18;
  const colW = (contentW - gap) / 2;
  const leftX = M;
  const rightX = M + colW + gap;
  const bottom = doc.page.height - M - 60; // deja lugar para las firmas

  // Encabezado de la casa.
  let y = M;
  doc.font('Helvetica-Bold').fontSize(14).fillColor(AZUL_OSCURO)
    .text(d.empresa.business_name || 'Empresa', M, y, { width: contentW, align: 'center' });
  y += 19;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(AZUL)
    .text(`Balance general al ${fechaLarga(d.fechaCorte)}`, M, y, { width: contentW, align: 'center' });
  y += 15;
  doc.font('Helvetica').fontSize(8).fillColor(GRIS)
    .text([d.empresa.rfc ? `RFC: ${d.empresa.rfc}` : '', `Generado: ${fechaGen()}`].filter(Boolean).join('     ·     '),
      M, y, { width: contentW, align: 'center' });
  y += 16;

  // Cabeceras de columna.
  const cabecera = (yy: number): number => {
    doc.rect(leftX, yy, colW, 15).fill(AZUL_OSCURO);
    doc.rect(rightX, yy, colW, 15).fill(AZUL_OSCURO);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    doc.text('ACTIVO', leftX + 4, yy + 4, { width: colW - 8 });
    doc.text('PASIVO Y CAPITAL', rightX + 4, yy + 4, { width: colW - 8 });
    return yy + 15;
  };
  y = cabecera(y);
  const yTablaIni = y;

  const rowH = 13;
  const izq = filasPdf(d.activo, { etiqueta: 'SUMA DEL ACTIVO', valor: d.totalActivo });
  const der = filasPdf([...d.pasivo, ...d.capital], { etiqueta: 'SUMA PASIVO + CAPITAL', valor: d.totalPasivoCapital });

  const dibujarFila = (f: FilaPdf, x: number, yy: number) => {
    doc.font(f.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#111827');
    const sangria = 3 + Math.max(0, f.nivel - 1) * 10;
    const impTxt = f.saldo === null ? '' : money(f.saldo);
    const anchoImp = 66;
    doc.text(f.nombre, x + sangria, yy + 3, { width: colW - sangria - anchoImp - 4, ellipsis: true });
    doc.text(impTxt, x + colW - anchoImp - 3, yy + 3, { width: anchoImp, align: 'right' });
  };

  const maxLen = Math.max(izq.length, der.length);
  for (let i = 0; i < maxLen; i++) {
    if (y + rowH > bottom) {
      doc.addPage(); y = M; y = cabecera(y);
    }
    if (izq[i]) dibujarFila(izq[i], leftX, y);
    if (der[i]) dibujarFila(der[i], rightX, y);
    y += rowH;
    doc.moveTo(leftX, y).lineTo(leftX + colW, y).strokeColor(LINEA).lineWidth(0.3).stroke();
    doc.moveTo(rightX, y).lineTo(rightX + colW, y).strokeColor(LINEA).lineWidth(0.3).stroke();
  }
  // Línea divisoria entre columnas.
  doc.moveTo(rightX - gap / 2, yTablaIni).lineTo(rightX - gap / 2, y).strokeColor(LINEA).lineWidth(0.5).stroke();

  // Cuadre.
  y += 8;
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(d.cuadra ? '#047857' : '#b91c1c')
    .text(d.cuadra
      ? `El balance cuadra: activo ${money(d.totalActivo)} = pasivo más capital.`
      : `El balance no cuadra por ${money(d.diferencia)}.`, M, y, { width: contentW });

  // Firmas.
  const yFirmas = Math.min(doc.page.height - M - 28, Math.max(y + 40, doc.page.height - M - 60));
  const anchoFirma = (contentW - 60) / 2;
  doc.moveTo(M + 20, yFirmas).lineTo(M + 20 + anchoFirma, yFirmas).strokeColor('#111827').lineWidth(0.5).stroke();
  doc.moveTo(rightX + 10, yFirmas).lineTo(rightX + 10 + anchoFirma, yFirmas).strokeColor('#111827').lineWidth(0.5).stroke();
  doc.font('Helvetica').fontSize(8).fillColor('#111827');
  doc.text('Representante Legal', M + 20, yFirmas + 4, { width: anchoFirma, align: 'center' });
  doc.text('Contador Público', rightX + 10, yFirmas + 4, { width: anchoFirma, align: 'center' });

  doc.end();
  return {
    buffer: await listo,
    nombre: `Balance_general_${anio}-${String(mes).padStart(2, '0')}_${stamp()}.pdf`,
  };
}

export default { balanceGeneral, balanceGeneralExcel, balanceGeneralPdf };
