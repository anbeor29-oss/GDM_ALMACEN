/**
 * Lector de balanzas de comprobación externas — Excel y PDF.
 *
 * ── PARA QUÉ ──
 * Los saldos iniciales de la contabilidad salen de la balanza del sistema
 * anterior. Sin ellos no se puede arrancar: una contabilidad que empieza en
 * ceros no es una contabilidad, es una lista de movimientos del mes.
 *
 * ── TRES COSAS QUE SE APRENDIERON DEL ARCHIVO REAL ──
 *
 * 1. LA FÓRMULA DEPENDE DE LA NATURALEZA.
 *    En una cuenta deudora:   saldo_inicial + debe − haber = saldo_final
 *    En una acreedora:        saldo_inicial − debe + haber = saldo_final
 *    Aplicar una sola a todas hace que ~30% de los renglones parezcan mal
 *    capturados cuando están perfectos. (Pasó en el análisis del archivo.)
 *
 * 2. UNA CUENTA ES HOJA SI NADIE CUELGA DE ELLA — NO POR SU CÓDIGO.
 *    El archivo real trae '5-05-10-000 REFACCIONES Y ACCESORIOS' terminado en
 *    -000, que parece cuenta sumaria, y es hoja: no tiene un solo hijo.
 *    Con la heurística del sufijo se caen $7,517,589.43 de costos y la balanza
 *    parece descuadrada por siete millones en vez de por veinte pesos.
 *
 *    Es exactamente el mismo principio que en bancos: la estructura manda
 *    sobre lo que el dato aparenta.
 *
 * 3. LAS SUMARIAS NO SE SUMAN.
 *    El archivo trae los dos niveles mezclados. Sumar todo cuenta dos veces:
 *    $6.7M en vez de $2.3M. Sólo las hojas llevan saldo propio.
 *
 * ── EL PDF ──
 * Sale sin un solo separador: '-382.000.000.00-382.00' son cuatro importes.
 * Se pueden separar porque TODOS traen exactamente dos decimales; es la misma
 * regla que salvó al extractor de estados de cuenta.
 *
 * Y los nombres largos se parten en varias líneas, así que un renglón lógico
 * puede ocupar tres físicas. Se acumula hasta encontrar los cuatro importes.
 */

import ExcelJS from 'exceljs';

export type NaturalezaBal = 'D' | 'A';

export interface FilaBalanza {
  cuenta: string;
  naturaleza: NaturalezaBal;
  nombre: string;
  saldoInicial: number;
  debe: number;
  haber: number;
  saldoFinal: number;
  /** Nadie cuelga de ella: lleva saldo propio. Se calcula al analizar. */
  hoja?: boolean;
  nivel?: number;
  padre?: string | null;
}

export interface EncabezadoBalanza {
  razonSocial?: string;
  rfc?: string;
  moneda?: string;
  periodo?: string;
  fechaCorte?: string;
}

export interface LecturaBalanza {
  encabezado: EncabezadoBalanza;
  filas: FilaBalanza[];
  origen: 'EXCEL' | 'PDF';
  avisosLectura: string[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   NÚMEROS
   ═══════════════════════════════════════════════════════════════════════════ */

/** '1,167,152.36' → 1167152.36 · '(1,234.00)' → -1234 */
export function aNumero(txt: any): number {
  if (typeof txt === 'number') return txt;
  if (txt === null || txt === undefined) return 0;
  let s = String(txt).trim();
  if (!s) return 0;
  /* El paréntesis contable también es negativo. */
  const negParen = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, '').replace(/[$\s]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return negParen ? -Math.abs(n) : n;
}

/**
 * Los importes de un texto donde vienen pegados.
 *
 * Se apoya en que TODOS llevan dos decimales exactos: sin esa regla,
 * '-382.000.000.00-382.00' no se puede partir de ninguna forma confiable.
 */
export function importesPegados(texto: string): number[] {
  return textosDeImportes(texto).map((t) => aNumero(t));
}

/** Los importes tal como salieron del texto, sin convertir. */
export function textosDeImportes(texto: string): string[] {
  const out: string[] = [];
  const rx = /-?[\d,]+\.\d{2}/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(texto)) !== null) out.push(m[0]);
  return out;
}

/**
 * Las lecturas POSIBLES de un importe al que se le pudo pegar el final del
 * nombre de la cuenta.
 *
 * ── EL CASO ──
 * 'RESULTADO EJERCICIOS ANTERIORES 2024' seguido de '1,653,827.35' sale del PDF
 * como '20241,653,827.35'. Leído tal cual son veinte mil millones.
 *
 * ── POR QUÉ DEVUELVE VARIAS Y NO UNA ──
 * El primer grupo de un número con separadores va de 1 a 3 dígitos. '20241'
 * trae cinco, así que sobran — pero el formato NO dice cuántos:
 *
 *     2024 + 1,653,827.35        ← la correcta
 *     202  + 41,653,827.35
 *     20   + 241,653,827.35
 *
 * Las tres están bien formadas. Recortar a tres dígitos "porque suele ser así"
 * es adivinar, y adivinar aquí devuelve un saldo equivocado con toda la
 * apariencia de estar bien.
 *
 * Se devuelven las candidatas y decide quien SÍ tiene con qué: el renglón trae
 * cuatro cifras con una relación conocida entre ellas.
 */
export function lecturasPosibles(bruto: string): number[] {
  const neg = bruto.startsWith('-');
  const cuerpo = neg ? bruto.slice(1) : bruto;
  const punto = cuerpo.lastIndexOf('.');
  const entero = cuerpo.slice(0, punto);
  const dec = cuerpo.slice(punto);
  const tal = aNumero(bruto);

  if (!entero.includes(',')) return [tal];
  const grupos = entero.split(',');
  /* Si un grupo interior no es de 3, el formato no es el esperado: no se toca. */
  for (let i = 1; i < grupos.length; i++) if (grupos[i].length !== 3) return [tal];
  if (grupos[0].length <= 3) return [tal];

  const out = [tal];
  for (let cuantos = 3; cuantos >= 1; cuantos--) {
    const cabeza = grupos[0].slice(-cuantos);
    if (cabeza.length > 1 && cabeza[0] === '0') continue;   // 0241 no es un número
    out.push(aNumero((neg ? '-' : '') + [cabeza, ...grupos.slice(1)].join(',') + dec));
  }
  return out;
}

/* El código de cuenta, con la forma que trae el archivo real: 1-10-20-009.
 * Se admite cualquier agrupación de segmentos separados por guion, porque
 * cada sistema contable usa la suya.
 *
 * ── LA LETRA DE NATURALEZA VA PEGADA AL NOMBRE ──
 * En el PDF el renglón sale '1-10-00-000DCIRCULANTE7,338,428.86…': la D de
 * deudora y la C de CIRCULANTE sin nada en medio.
 *
 * El primer intento llevaba (?![A-Z]) para no confundir la naturaleza con la
 * inicial de una palabra — y rechazaba TODOS los renglones, porque el nombre
 * siempre empieza con mayúscula justo después.
 *
 * ── Y (?![\d.,]) NO ES ADORNO ──
 * La línea de importes de un registro partido —'209.000.000.00209.00'— parece
 * empezar con un código de cuenta. Eso no sólo inventa cuentas fantasma:
 * aborta el registro real que venía acumulándose, y su saldo desaparece sin
 * una sola queja.
 *
 * Los TRES caracteres prohibidos hacen falta, y el dígito es el menos obvio:
 * con sólo (?![.,]) el motor rechaza '209' —le sigue un punto— pero RETROCEDE
 * a '20', y ahí le sigue un '9' que pasaba la prueba. El backtracking encuentra
 * el prefijo corto que se cuela.
 *
 * Un código de cuenta jamás va seguido de dígito, coma ni punto decimal. */
const RX_CUENTA_INICIO = /^\s*(\d[\d-]*\d)(?![\d.,])\s*([DA])?/;

/* ═══════════════════════════════════════════════════════════════════════════
   EXCEL
   ═══════════════════════════════════════════════════════════════════════════ */

const ENCABEZADOS = {
  cuenta:     /n[uú]m|no\.?\s*cuenta|cuenta/i,
  naturaleza: /naturaleza/i,
  nombre:     /^cuenta$|nombre|descripci/i,
  inicial:    /saldo\s*inicial|saldo\s*anterior/i,
  debe:       /^debe$|cargos?/i,
  haber:      /^haber$|abonos?/i,
  final:      /saldo\s*final|saldo\s*actual/i,
};

function textoCelda(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray((v as any).richText)) {
      return (v as any).richText.map((t: any) => t.text).join('');
    }
    if ((v as any).result !== undefined) return String((v as any).result);
    if ((v as any).text !== undefined) return String((v as any).text);
  }
  return String(v);
}

export async function leerBalanzaExcel(buffer: Buffer): Promise<LecturaBalanza> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El archivo de Excel no trae ninguna hoja.');

  const avisos: string[] = [];
  const encabezado: EncabezadoBalanza = {};

  /* ── Encontrar la fila de encabezados ──
   * No se asume que sea la 4: cada sistema mete un número distinto de
   * renglones de membrete arriba, y clavarlo es garantizar que el próximo
   * archivo se lea corrido por dos filas sin avisar. */
  let filaEnc = 0;
  const col: Record<string, number> = {};

  for (let i = 1; i <= Math.min(25, ws.rowCount); i++) {
    const r = ws.getRow(i);
    const encontrados: Record<string, number> = {};
    for (let c = 1; c <= Math.min(30, ws.columnCount); c++) {
      const t = textoCelda(r.getCell(c).value).trim();
      if (!t) continue;
      if (!encontrados.cuenta && /no\.?\s*cuenta|n[uú]m\.?\s*cuenta/i.test(t)) encontrados.cuenta = c;
      else if (!encontrados.naturaleza && ENCABEZADOS.naturaleza.test(t)) encontrados.naturaleza = c;
      else if (!encontrados.nombre && /^cuenta$|nombre|descripci/i.test(t)) encontrados.nombre = c;
      else if (!encontrados.inicial && ENCABEZADOS.inicial.test(t)) encontrados.inicial = c;
      else if (!encontrados.debe && ENCABEZADOS.debe.test(t)) encontrados.debe = c;
      else if (!encontrados.haber && ENCABEZADOS.haber.test(t)) encontrados.haber = c;
      else if (!encontrados.final && ENCABEZADOS.final.test(t)) encontrados.final = c;
    }
    if (encontrados.cuenta && encontrados.inicial && encontrados.debe
        && encontrados.haber && encontrados.final) {
      filaEnc = i;
      Object.assign(col, encontrados);
      break;
    }
  }

  if (!filaEnc) {
    throw new Error(
      'No se encontraron las columnas de la balanza. Se buscan: No. Cuenta, ' +
      'Saldo Inicial, Debe, Haber y Saldo Final en alguna de las primeras 25 filas.',
    );
  }

  /* ── El membrete: lo que esté arriba de los encabezados ── */
  for (let i = 1; i < filaEnc; i++) {
    const r = ws.getRow(i);
    for (let c = 1; c <= Math.min(12, ws.columnCount); c++) {
      const t = textoCelda(r.getCell(c).value).trim();
      if (!t) continue;
      if (/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(t)) encabezado.rfc = t.toUpperCase();
      else if (/tipo\s*(de\s*)?moneda/i.test(t)) {
        const m = t.match(/([A-Z]{3})\s*$/); if (m) encabezado.moneda = m[1];
      } else if (/^\d{2}-\d{2}-\d{4}\s*-\s*\d{2}-\d{2}-\d{4}$/.test(t)) {
        encabezado.periodo = t;
      } else if (!encabezado.razonSocial && t.length > 3
                 && !/balanza|fecha|moneda|periodo/i.test(t)) {
        encabezado.razonSocial = t;
      }
    }
  }
  /* La moneda puede venir en su propia celda, aparte de la etiqueta. */
  if (!encabezado.moneda) {
    for (let i = 1; i < filaEnc; i++) {
      const r = ws.getRow(i);
      for (let c = 1; c <= Math.min(12, ws.columnCount); c++) {
        const t = textoCelda(r.getCell(c).value).trim();
        if (/^(MXN|USD|EUR)$/i.test(t)) { encabezado.moneda = t.toUpperCase(); break; }
      }
      if (encabezado.moneda) break;
    }
  }

  /* ── Los renglones ── */
  const filas: FilaBalanza[] = [];
  for (let i = filaEnc + 1; i <= ws.rowCount; i++) {
    const r = ws.getRow(i);
    const cuenta = textoCelda(r.getCell(col.cuenta).value).trim();
    if (!cuenta) continue;
    /* Un renglón de totales al pie no es una cuenta. */
    if (/^total|^suma/i.test(cuenta)) continue;
    if (!/\d/.test(cuenta)) continue;

    const natRaw = col.naturaleza
      ? textoCelda(r.getCell(col.naturaleza).value).trim().toUpperCase() : '';
    let naturaleza: NaturalezaBal;
    if (natRaw.startsWith('D')) naturaleza = 'D';
    else if (natRaw.startsWith('A') || natRaw.startsWith('C')) naturaleza = 'A';
    else {
      /* Sin naturaleza declarada se deduce del primer dígito, que en casi todo
       * catálogo mexicano marca el tipo. Se avisa: es una suposición. */
      naturaleza = ['2', '3', '4'].includes(cuenta[0]) ? 'A' : 'D';
      if (filas.length === 0) {
        avisos.push(
          'El archivo no trae columna de Naturaleza. Se dedujo del primer dígito ' +
          'del código (1,5,6 deudora · 2,3,4 acreedora). Revísalo: si el catálogo ' +
          'no usa esa convención, los saldos saldrán con el signo cambiado.',
        );
      }
    }

    filas.push({
      cuenta,
      naturaleza,
      nombre: col.nombre ? textoCelda(r.getCell(col.nombre).value).trim() : '',
      saldoInicial: aNumero(r.getCell(col.inicial).value),
      debe:         aNumero(r.getCell(col.debe).value),
      haber:        aNumero(r.getCell(col.haber).value),
      saldoFinal:   aNumero(r.getCell(col.final).value),
    });
  }

  if (!filas.length) throw new Error('El archivo no trae ningún renglón de cuenta.');

  return { encabezado, filas, origen: 'EXCEL', avisosLectura: avisos };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PDF
   ═══════════════════════════════════════════════════════════════════════════ */

export async function textoDeBalanzaPdf(buffer: Buffer): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default as any;
  const d = await pdfParse(buffer);
  return d.text as string;
}

/**
 * El PDF, donde el texto sale sin separadores y los nombres se parten.
 *
 * ── EL ALGORITMO ──
 * Un renglón lógico empieza cuando una línea arranca con código + naturaleza, y
 * termina cuando se han juntado CUATRO importes. Entre medias puede haber
 * líneas que sólo traen el resto de un nombre largo.
 *
 * Cerrar el renglón en el salto de línea —que es lo natural— parte en dos a
 * 'NOE ALFREDO SALAS MARTIN DEL / CAMPO', y su saldo se pierde.
 */
export function leerBalanzaTexto(texto: string): LecturaBalanza {
  const lineas = texto.split(/\r?\n/);
  const filas: FilaBalanza[] = [];
  const avisos: string[] = [];
  const encabezado: EncabezadoBalanza = {};

  /* Membrete: se lee de las primeras líneas. */
  for (const l of lineas.slice(0, 20)) {
    const t = l.trim();
    if (!t) continue;
    if (/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(t)) encabezado.rfc = t;
    else if (/^(MXN|USD|EUR)$/.test(t)) encabezado.moneda = t;
    else if (/^\d{2}-\d{2}-\d{4}\s*-\s*\d{2}-\d{2}-\d{4}$/.test(t)) encabezado.periodo = t;
    else if (!encabezado.razonSocial && t.length > 3
             && !/balanza|fecha|moneda|periodo|tipo/i.test(t)) encabezado.razonSocial = t;
  }

  let pend: { cuenta: string; nat: NaturalezaBal; texto: string } | null = null;

  const cerrar = () => {
    if (!pend) return;
    const imp = importesPegados(pend.texto);
    if (imp.length < 4) {
      avisos.push(
        `La cuenta ${pend.cuenta} quedó con ${imp.length} importe(s) de 4. ` +
        `No se carga a medias: revisa ese renglón en el documento.`,
      );
      pend = null;
      return;
    }
    /* Los CUATRO ÚLTIMOS. Un nombre puede traer dígitos —'CI BANCO 25018',
     * 'BANBAJIO 840201'— y tomarlos por la izquierda mete el número de sucursal
     * como si fuera el saldo inicial. */
    const brutos = textosDeImportes(pend.texto).slice(-4);
    let [si, d, h, sf] = imp.slice(-4);

    /* ── Desempate por la propia aritmética del renglón ──
     * Sólo al PRIMER importe se le puede haber pegado el final del nombre: es
     * el único que va precedido de texto. Si admite varias lecturas, la buena
     * es la que hace cuadrar el renglón —inicial ± movimientos = final—, que es
     * una relación que el documento ya trae y no una preferencia nuestra.
     *
     * Si ninguna cuadra, o cuadra más de una, NO se elige: se avisa. Un saldo
     * adivinado entra a la contabilidad con toda la cara de estar bien. */
    const candidatas = lecturasPosibles(brutos[0]);
    if (candidatas.length > 1) {
      const cuadra = (v: number) => Math.abs(
        (pend!.nat === 'D' ? v + d - h : v - d + h) - sf) <= 0.02;
      const buenas = candidatas.filter(cuadra);
      if (buenas.length === 1) {
        si = buenas[0];
      } else {
        avisos.push(
          `La cuenta ${pend.cuenta} trae el saldo inicial pegado al nombre en el ` +
          `PDF ("${brutos[0]}") y ` +
          (buenas.length === 0
            ? 'ninguna lectura hace cuadrar el renglón'
            : `${buenas.length} lecturas lo hacen cuadrar`) +
          `. No se adivina: revisa esa cuenta contra el Excel o el documento.`,
        );
      }
    }

    /* El nombre es lo que queda al quitar los importes del final. */
    let nombre = pend.texto;
    const rxTodos = /-?[\d,]+\.\d{2}/g;
    const pos: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = rxTodos.exec(pend.texto)) !== null) pos.push(m.index);
    if (pos.length >= 4) nombre = pend.texto.slice(0, pos[pos.length - 4]);

    filas.push({
      cuenta: pend.cuenta,
      naturaleza: pend.nat,
      nombre: nombre.replace(/\s+/g, ' ').trim(),
      saldoInicial: si, debe: d, haber: h, saldoFinal: sf,
    });
    pend = null;
  };

  for (const linea of lineas) {
    const l = linea.trim();
    if (!l) continue;
    /* Encabezados repetidos en cada página: no son datos. */
    if (/^no\.?\s*cuenta/i.test(l.replace(/\s+/g, ' '))) continue;
    if (/^(BALANZA DE COMPROBACI|Fecha de impresi|Tipo\s*Moneda|Periodo|P[áa]gina)/i.test(l)) continue;

    const m = l.match(RX_CUENTA_INICIO);
    if (m) {
      cerrar();                       // el anterior ya no puede crecer
      let nat: NaturalezaBal;
      if (m[2]) {
        nat = m[2] as NaturalezaBal;
      } else {
        /* Sin columna de naturaleza se deduce del primer dígito. Se avisa una
         * sola vez: es una suposición, y si el catálogo no usa esa convención
         * todos los saldos salen con el signo cambiado. */
        nat = ['2', '3', '4'].includes(m[1][0]) ? 'A' : 'D';
        if (!avisos.some((a) => a.startsWith('El PDF no trae'))) {
          avisos.push(
            'El PDF no trae la letra de naturaleza. Se dedujo del primer dígito ' +
            'del código (1,5,6 deudora · 2,3,4 acreedora). Revísalo.',
          );
        }
      }
      pend = { cuenta: m[1], nat, texto: l.slice(m[0].length) };
    } else if (pend) {
      pend.texto += ' ' + l;          // resto de un nombre largo, o los importes
    }

    /* En cuanto junte sus cuatro importes, se cierra: así una línea suelta que
     * viniera después no se le pega por error. */
    if (pend && importesPegados(pend.texto).length >= 4) cerrar();
  }
  cerrar();

  if (!filas.length) {
    throw new Error(
      'No se reconoció ninguna cuenta en el PDF. Si es un PDF escaneado no hay ' +
      'texto que leer: usa el Excel, o el archivo de texto del sistema anterior.',
    );
  }

  return { encabezado, filas, origen: 'PDF', avisosLectura: avisos };
}

export async function leerBalanzaPdf(buffer: Buffer): Promise<LecturaBalanza> {
  return leerBalanzaTexto(await textoDeBalanzaPdf(buffer));
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANÁLISIS — lo que hay que saber ANTES de cargar nada
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AvisoBalanza {
  nivel: 'ERROR' | 'AVISO';
  mensaje: string;
  detalle?: string[];
}

export interface AnalisisBalanza {
  totalFilas: number;
  hojas: number;
  sumarias: number;
  sumaDebe: number;
  sumaHaber: number;
  diferenciaMovimientos: number;
  porTipo: Array<{ tipo: string; cuentas: number; saldoFinal: number }>;
  activo: number;
  pasivoCapitalResultado: number;
  diferenciaEcuacion: number;
  cuadra: boolean;
  avisos: AvisoBalanza[];
}

/** El saldo final que DEBERÍA tener el renglón, según su naturaleza. */
export function saldoFinalEsperado(f: FilaBalanza): number {
  return f.naturaleza === 'D'
    ? f.saldoInicial + f.debe - f.haber
    : f.saldoInicial - f.debe + f.haber;
}

/**
 * Marca cuáles filas son hoja, de forma ESTRUCTURAL.
 *
 * Una cuenta es hoja si ninguna otra del archivo cuelga de ella. No se mira el
 * sufijo del código: '5-05-10-000' termina en -000 y es hoja, y descartarla
 * tira siete millones y medio de costos.
 */
export function marcarHojas(filas: FilaBalanza[]): FilaBalanza[] {
  /* Se ordena por código para que el prefijo funcione: un código es padre de
   * otro si el otro empieza con él seguido de un separador. */
  const codigos = filas.map((f) => f.cuenta);

  const esPadreDe = (padre: string, hijo: string): boolean => {
    if (padre === hijo) return false;
    /* '1-10-20-000' es padre de '1-10-20-009': se compara ignorando los
     * segmentos en cero del final del padre. */
    const p = padre.split('-');
    const h = hijo.split('-');
    if (h.length < p.length) return false;
    let ultimoSignificativo = p.length - 1;
    while (ultimoSignificativo >= 0 && /^0+$/.test(p[ultimoSignificativo])) ultimoSignificativo--;
    if (ultimoSignificativo < 0) return false;
    for (let i = 0; i <= ultimoSignificativo; i++) if (p[i] !== h[i]) return false;
    /* El hijo tiene que traer algo distinto de cero después. */
    for (let i = ultimoSignificativo + 1; i < h.length; i++) {
      if (!/^0+$/.test(h[i])) return true;
    }
    return false;
  };

  for (const f of filas) {
    f.hoja = !codigos.some((c) => esPadreDe(f.cuenta, c));
    const segs = f.cuenta.split('-');
    let nivel = 0;
    for (const s of segs) { if (/^0+$/.test(s)) break; nivel++; }
    f.nivel = Math.max(1, nivel);
    /* El padre es la cuenta más larga del archivo que sea padre de ésta. */
    let mejor: string | null = null;
    for (const c of codigos) {
      if (esPadreDe(c, f.cuenta) && (!mejor || c.length > mejor.length)) mejor = c;
    }
    f.padre = mejor;
  }
  return filas;
}

const TIPO_POR_DIGITO: Record<string, string> = {
  '1': 'ACTIVO', '2': 'PASIVO', '3': 'CAPITAL',
  '4': 'INGRESOS', '5': 'COSTOS', '6': 'GASTOS',
  '7': 'OTROS', '8': 'ORDEN',
};

export function analizarBalanza(lectura: LecturaBalanza): AnalisisBalanza {
  const filas = marcarHojas(lectura.filas);
  const hojas = filas.filter((f) => f.hoja);
  const avisos: AvisoBalanza[] = lectura.avisosLectura.map((m) => ({ nivel: 'AVISO' as const, mensaje: m }));

  /* ── 1. Cada renglón consigo mismo ── */
  const descuadrados = filas.filter(
    (f) => Math.abs(saldoFinalEsperado(f) - f.saldoFinal) > 0.02,
  );
  if (descuadrados.length) {
    avisos.push({
      nivel: 'ERROR',
      mensaje:
        `${descuadrados.length} renglón(es) no cuadran consigo mismos: el saldo ` +
        `final no es el inicial más sus movimientos.`,
      detalle: descuadrados.slice(0, 10).map(
        (f) => `${f.cuenta} ${f.nombre.slice(0, 28)} — dice ${f.saldoFinal.toFixed(2)}, ` +
               `sale ${saldoFinalEsperado(f).toFixed(2)}`,
      ),
    });
  }

  /* ── 2. Las sumarias contra sus hijas ── */
  const porCodigo = new Map(filas.map((f) => [f.cuenta, f]));
  const malSumadas: string[] = [];
  for (const f of filas) {
    if (f.hoja) continue;
    const hijas = filas.filter((h) => h.padre === f.cuenta);
    if (!hijas.length) continue;
    const suma = hijas.reduce((a, h) => a + h.saldoFinal, 0);
    if (Math.abs(suma - f.saldoFinal) > 0.02) {
      malSumadas.push(
        `${f.cuenta} ${f.nombre.slice(0, 26)} — dice ${f.saldoFinal.toFixed(2)}, ` +
        `sus ${hijas.length} subcuentas suman ${suma.toFixed(2)}`,
      );
    }
  }
  if (malSumadas.length) {
    avisos.push({
      nivel: 'AVISO',
      mensaje:
        `${malSumadas.length} cuenta(s) sumarias no coinciden con la suma de sus ` +
        `subcuentas. Puede faltar un nivel en el archivo exportado.`,
      detalle: malSumadas.slice(0, 8),
    });
  }

  /* ── 3. Los movimientos del periodo ──
   * Σ Debe tiene que ser igual a Σ Haber. Es la comprobación que le da nombre
   * a la balanza, y sólo vale sobre hojas: las sumarias repiten a sus hijas. */
  const sumaDebe = hojas.reduce((a, f) => a + f.debe, 0);
  const sumaHaber = hojas.reduce((a, f) => a + f.haber, 0);
  const difMov = sumaDebe - sumaHaber;
  if (Math.abs(difMov) > 0.02) {
    avisos.push({
      nivel: 'ERROR',
      mensaje:
        `Los movimientos no cuadran: Debe ${sumaDebe.toFixed(2)} contra Haber ` +
        `${sumaHaber.toFixed(2)}, diferencia ${difMov.toFixed(2)}. ` +
        `Una balanza que no cuadra no puede ser el saldo inicial de nada.`,
    });
  }

  /* ── 4. La ecuación contable ── */
  const porTipoMap = new Map<string, { cuentas: number; saldoFinal: number }>();
  for (const f of hojas) {
    const t = TIPO_POR_DIGITO[f.cuenta[0]] || 'OTROS';
    const e = porTipoMap.get(t) || { cuentas: 0, saldoFinal: 0 };
    e.cuentas++; e.saldoFinal += f.saldoFinal;
    porTipoMap.set(t, e);
  }
  const g = (t: string) => porTipoMap.get(t)?.saldoFinal ?? 0;
  const resultado = g('INGRESOS') - g('COSTOS') - g('GASTOS');
  const activo = g('ACTIVO');
  const pcr = g('PASIVO') + g('CAPITAL') + resultado;
  const difEc = activo - pcr;

  if (Math.abs(difEc) > 1) {
    avisos.push({
      nivel: Math.abs(difEc) > 100 ? 'ERROR' : 'AVISO',
      mensaje:
        `La ecuación contable no cierra por ${difEc.toFixed(2)}: activo ` +
        `${activo.toFixed(2)} contra pasivo + capital + resultado ${pcr.toFixed(2)}.` +
        (Math.abs(difEc) <= 100
          ? ' Es una diferencia chica, probablemente de redondeo, pero se arrastra.'
          : ''),
    });
  }

  const sinNombre = filas.filter((f) => !f.nombre.trim()).length;
  if (sinNombre) {
    avisos.push({
      nivel: 'AVISO',
      mensaje: `${sinNombre} cuenta(s) sin nombre. Se cargarán con su código como nombre.`,
    });
  }

  return {
    totalFilas: filas.length,
    hojas: hojas.length,
    sumarias: filas.length - hojas.length,
    sumaDebe, sumaHaber,
    diferenciaMovimientos: difMov,
    porTipo: [...porTipoMap.entries()].map(([tipo, v]) => ({ tipo, ...v })),
    activo,
    pasivoCapitalResultado: pcr,
    diferenciaEcuacion: difEc,
    cuadra: Math.abs(difMov) <= 0.02 && descuadrados.length === 0,
    avisos,
  };
}

export default {
  leerBalanzaExcel, leerBalanzaPdf, leerBalanzaTexto, textoDeBalanzaPdf,
  analizarBalanza, marcarHojas, saldoFinalEsperado, aNumero, importesPegados,
};
