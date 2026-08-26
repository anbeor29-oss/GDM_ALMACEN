/**
 * extractor-movimientos — los movimientos de un estado de cuenta, desde texto.
 *
 * Portado del `extractor_movimientos.py` (v1.0.0) y su documentación. Se
 * conservó la lógica que importa —los patrones de fecha, la clasificación de
 * montos, el arrastre del saldo y la inferencia de comisiones de Bancrea— y se
 * cambió lo que no podía sobrevivir al viaje.
 *
 * ── LO QUE CAMBIÓ AL PORTARLO, Y POR QUÉ ──
 *
 * EL ORIGINAL LEE PDF; ÉSTE LEE TEXTO.
 * El script de Python usa `pdfplumber`, que conserva la disposición de la
 * página, y `pytesseract` para lo escaneado. En este servidor no hay ninguno de
 * los dos: el runtime de Render no tiene Python ni Tesseract, y el único lector
 * de PDF disponible —`pdf-parse`— **colapsa los espacios** (está documentado en
 * el extractor de CSF: "CódigoPostal:" en vez de "Código Postal:").
 *
 * En un estado de cuenta eso es fatal: "3,500.00 20,000.00" pegado se vuelve un
 * solo número. Por eso el extractor trabaja sobre TEXTO y se alimenta de varias
 * fuentes —pegar el texto, un CSV del portal del banco, o un PDF cuando su
 * texto sale limpio—. El CSV del banco, cuando existe, es siempre mejor que
 * cualquier PDF: no hay nada que adivinar.
 *
 * LA COMISIÓN INFERIDA SE MARCA.
 * El original INSERTA una comisión de $3.00 cuando la diferencia de saldos es
 * exactamente $3.48. La deducción es correcta —Bancrea a veces omite el
 * renglón— pero en un sistema contable un movimiento que el banco no reportó no
 * puede pasar por uno que sí. Aquí se inserta igual y se marca `inferido`.
 * Inventar un movimiento y no decirlo es peor que dejar el saldo descuadrado.
 *
 * EL SALDO SE ARRASTRA SIEMPRE.
 * El original valida el saldo sólo cuando el banco lo declara. Aquí se calcula
 * el arrastre en todos los renglones y se guarda aparte: es lo único que delata
 * un movimiento que el documento se comió.
 */

/* ══════════════════ TIPOS ══════════════════ */

export interface MovimientoExtraido {
  fecha: string;              // ISO AAAA-MM-DD
  concepto: string;
  referencia: string;
  retiro: number;
  deposito: number;
  /** El que declara el banco. `null` si el renglón no lo trae. */
  saldo: number | null;
  /** El que resulta de arrastrar. Siempre se calcula. */
  saldoCalculado: number;
  advertencia: string;
  inferido: boolean;
  /** El concepto no dijo si entra o sale (columna perdida): a resolver por saldo. */
  duda: boolean;
  orden: number;
  lineaOrigen: string;
}

export interface ResultadoExtraccion {
  banco: string;
  saldoInicial: number | null;
  saldoFinal: number | null;
  movimientos: MovimientoExtraido[];
  totalRetiros: number;
  totalDepositos: number;
  conAdvertencia: number;
  inferidos: number;
  /** Si el saldo final declarado cuadra con el arrastre. */
  cuadra: boolean;
  avisos: string[];
}

/* ══════════════════ UTILIDADES ══════════════════ */

const MESES_ES: Record<string, number> = {
  ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6,
  JUL: 7, AGO: 8, SEP: 9, OCT: 10, NOV: 11, DIC: 12,
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
  JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
  /* Algunos portales exportan en inglés. */
  JAN: 1, APR: 4, AUG: 8, DEC: 12,
};

/** Montos con separador de miles y DOS decimales: 3,500.00 · 20000.00 */
const RX_MONTO = /-?\$?\d{1,3}(?:,\d{3})*\.\d{2}\b|-?\$?\d+\.\d{2}\b/g;

const pesos = (n: number) => Math.round(n * 100) / 100;

export function aNumero(texto: string): number {
  const limpio = String(texto).replace(/[$,\s]/g, '').trim();
  const n = Number(limpio);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Separa importes pegados. `pdf-parse` colapsa los espacios y deja
 * "3,500.0020,000.00". Como TODO importe termina en centavos (.dd), el corte es
 * determinista: se mete un espacio después de cada .dd SÓLO cuando lo que sigue
 * es otro importe (un dígito, dígitos/comas y .dd). Así no se parte un tipo de
 * cambio de cuatro decimales ni una referencia. No inventa cifras: sólo separa
 * lo que ya estaba ahí.
 */
export function separarImportesPegados(texto: string): string {
  let out = texto;
  /* Fechas pegadas: BBVA pone la de operación y la de liquidación juntas
   * ("01/JUL01/JUL"). Se separa metiendo un espacio después de "/MMM" cuando
   * sigue un dígito. Sólo afecta fechas (nada más tiene "/MMM"). */
  out = out.replace(/([/-][A-Za-z]{3})(?=\d)/g, '$1 ');
  /* Fecha numérica de año COMPLETO pegada al texto que sigue (VePorMás:
   * "06-07-2026FT26187…"). Se exige año de 4 dígitos para no tocar la sección de
   * "detalle de comisiones" de BanBajío, que repite con año de 2 dígitos. */
  out = out.replace(/(\d{1,2}[-/]\d{1,2}[-/]\d{4})(?=[A-Za-z])/g, '$1 ');
  /* Importes pegados: cada uno termina en centavos, corte determinista. */
  for (let k = 0; k < 4; k++) {
    const n = out.replace(/(\.\d{2})(?=\d[\d,]*\.\d{2})/g, '$1 ');
    if (n === out) break;
    out = n;
  }
  return out;
}

/**
 * Normaliza a ISO. Acepta 6-JUL-26, 06/07/2026, 6 JULIO 2026, 2026-07-06.
 *
 * El año de dos dígitos se resuelve a 2000+YY: un estado de cuenta de 1926 no
 * existe, y uno de 2126 tampoco.
 */
export function aFechaIso(texto: string, anioSugerido?: number): string {
  const t = String(texto).toUpperCase().trim();

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  m = /^(\d{1,2})[-/\s]([A-Z]{3,10})[-/\s](\d{2,4})$/.exec(t);
  if (m) {
    const mes = MESES_ES[m[2]];
    if (!mes) return '';
    let a = Number(m[3]);
    if (a < 100) a += 2000;
    return `${a}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }

  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(t);
  if (m) {
    let a = Number(m[3]);
    if (a < 100) a += 2000;
    return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }

  /* Sin año: "6-JUL". Se completa con el del periodo que se está cargando. */
  m = /^(\d{1,2})[-/\s]([A-Z]{3,10})$/.exec(t);
  if (m && anioSugerido) {
    const mes = MESES_ES[m[2]];
    if (mes) return `${anioSugerido}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }

  return '';
}

/** La fecha que aparezca primero en una línea, en cualquiera de los formatos. */
function fechaDeLinea(linea: string, anio?: number): string {
  const patrones = [
    /\b(\d{1,2}[-/][A-Za-z]{3,10}[-/]\d{2,4})\b/, // 6-JUL-26
    /\b(\d{4}-\d{1,2}-\d{1,2})\b/,                 // 2026-07-06
    /\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/,         // 06-07-2026
    /\b(\d{1,2}\s+[A-Za-z]{3,10}\s+\d{2,4})\b/,    // 1 JULIO 2026
    /\b(\d{1,2}[-/][A-Za-z]{3,10})\b/,             // 6-JUL
    /\b(\d{1,2}\s+[A-Za-z]{3,10})\b/,              // 1 JUL (BanBajío) — el mes lo valida aFechaIso
  ];
  for (const rx of patrones) {
    const m = rx.exec(linea);
    if (m) {
      const iso = aFechaIso(m[1], anio);
      if (iso) return iso;
    }
  }
  return '';
}

/** Los conceptos que el documento nombra, en orden de especificidad. */
const CONCEPTOS = [
  'TRANSFERENCIA SPEI ENVIADA',
  'TRANSFERENCIA SPEI RECIBIDA',
  'COMISION TRANSFERENCIA SPEI',
  'TRANSFERENCIA - ENVIO',
  'TRANSFERENCIA RECIBIDA',
  'TRANSFERENCIA ENVIADA',
  'SPEI ENVIADA',
  'SPEI RECIBIDA',
  'SPEI ENVIADO',
  'SPEI RECIBIDO',
  'IVA DE COMISION',
  'PAGO DE SERVICIOS',
  'DEPOSITO EN EFECTIVO',
  'RETIRO EN EFECTIVO',
  'COMISION',
  'DEPOSITO',
  'RETIRO',
  'ABONO',
  'CARGO',
];

function conceptoDe(texto: string): string {
  const t = texto.toUpperCase();
  for (const c of CONCEPTOS) if (t.includes(c)) return c;
  return 'MOVIMIENTO BANCARIO';
}

/** Palabras que delatan de qué lado va un importe cuando viene solo. */
const ENTRA = ['RECIBIDA', 'RECIBIDO', 'DEPOSITO', 'DEPÓSITO', 'ABONO', 'INGRESO', 'DEVOLUCION', 'REEMBOLSO'];

/* Conceptos que el documento NO desambigua: en BBVA "PAGO CUENTA DE TERCERO" se
 * usa para lo que te pagan (abono) Y para lo que pagas (cargo) —el sentido lo
 * daba la columna CARGOS/ABONOS, que el PDF pegado perdió—. Se marcan como duda
 * para que el usuario los revise; NO se inventa el lado. */
const AMBIGUOS = ['CUENTA DE TERCERO'];
const SALE  = ['ENVIADA', 'ENVIADO', 'RETIRO', 'COMISION', 'IVA', 'CARGO', 'PAGO', 'DOMICILIA', 'COMPRA'];

/**
 * Reparte los importes de una línea en retiro / depósito / saldo.
 *
 * ── LA HEURÍSTICA, Y DÓNDE SE EQUIVOCA ──
 * Con tres o más importes, los últimos tres son retiro, depósito y saldo — es
 * el orden de columnas de todos los estados de cuenta que se han visto.
 *
 * Con dos, hay ambigüedad real: puede ser (movimiento, saldo) o (retiro,
 * depósito). Se resuelve por el CONCEPTO, que es más confiable que comparar
 * magnitudes: el original suponía que el saldo siempre es diez veces mayor que
 * el movimiento, y eso falla justo cuando la cuenta está por vaciarse.
 *
 * Con uno, sólo el concepto decide. Y si el concepto no dice nada, se marca:
 * adivinar el lado de un importe es adivinar el signo del saldo.
 */
export function repartirImportes(
  importes: number[],
  concepto: string,
  orden: OrdenColumnas = 'retiro-deposito',
  dosSaldos = false
): { retiro: number; deposito: number; saldo: number | null; duda: boolean } {
  const t = concepto.toUpperCase();
  let entra = ENTRA.some((k) => t.includes(k));
  let sale  = SALE.some((k) => t.includes(k));
  /* Un concepto ambiguo (el sentido lo daba una columna que se perdió) no se
   * adivina: se deja como duda para que el usuario lo revise. */
  if (AMBIGUOS.some((k) => t.includes(k))) { entra = false; sale = false; }

  if (importes.length === 0) return { retiro: 0, deposito: 0, saldo: null, duda: false };

  /* ── BBVA y otros con DOS columnas de saldo (operación y liquidación) ──
   * El renglón es: [cargo|abono] · saldo operación · saldo liquidación. Un
   * movimiento llena SÓLO cargo o abono, así que el importe del movimiento es el
   * que va ANTES de los dos saldos, y el saldo real es el último (liquidación).
   * Tomar los "últimos tres como retiro/depósito/saldo" —lo genérico— leería un
   * saldo como depósito. El lado (entra/sale) lo dice el concepto. */
  if (dosSaldos) {
    const abs = importes.map(Math.abs);
    let mov = 0, saldo: number | null = null;
    /* [movimiento · saldo OPERACIÓN · saldo LIQUIDACIÓN]. Se valida contra el de
     * OPERACIÓN (el penúltimo): es el que refleja el saldo en el orden del
     * documento; el de liquidación puede ser de otro día y descuadraría el
     * arrastre. */
    if (abs.length >= 3)      { mov = abs[abs.length - 3]; saldo = abs[abs.length - 2]; }
    else if (abs.length === 2) { mov = abs[0]; saldo = abs[1]; }
    else                       { mov = abs[0]; saldo = null; }
    if (entra) return { retiro: 0, deposito: mov, saldo, duda: false };
    if (sale)  return { retiro: mov, deposito: 0, saldo, duda: false };
    return { retiro: mov, deposito: 0, saldo, duda: true };
  }

  if (importes.length === 1) {
    const v = Math.abs(importes[0]);
    if (entra) return { retiro: 0, deposito: v, saldo: null, duda: false };
    if (sale)  return { retiro: v, deposito: 0, saldo: null, duda: false };
    return { retiro: v, deposito: 0, saldo: null, duda: true };
  }

  if (importes.length === 2) {
    const [a, b] = importes.map(Math.abs);
    if (entra) return { retiro: 0, deposito: a, saldo: b, duda: false };
    if (sale)  return { retiro: a, deposito: 0, saldo: b, duda: false };
    return { retiro: a, deposito: 0, saldo: b, duda: true };
  }

  const [a, b, s] = importes.slice(-3).map(Math.abs);
  return orden === 'deposito-retiro'
    ? { retiro: b, deposito: a, saldo: s, duda: false }
    : { retiro: a, deposito: b, saldo: s, duda: false };
}

/* ══════════════════ EL EXTRACTOR ══════════════════ */

/* El importe puede estar a sesenta espacios del rótulo: los estados de cuenta
 * alinean por columnas, no por proximidad. Por eso no hay tope de caracteres —
 * sólo la restricción de no salirse del renglón (`[^
\d]`), que es lo que
 * impide agarrar un número de la línea siguiente. */
/* El importe puede estar a sesenta espacios del rótulo: los estados de cuenta
 * alinean por columnas, no por proximidad. Por eso no hay tope de caracteres —
 * sólo la restricción de no salirse del renglón, que es lo que impide agarrar
 * un número de la línea siguiente.
 *
 * El tope de 40 que traía el original dejaba fuera justo los estados bien
 * alineados, que son la mayoría. */
/* Se permite texto entre SALDO y INICIAL/FINAL porque BBVA lo escribe como
 * "Saldo de Liquidación Inicial18,386.71" / "Saldo Final (+)20,000.00". El
 * `[^\d\n]` de en medio no cruza números ni renglones, así que no se va a otro. */
const RX_SALDO_INICIAL =
  /SALDO[^\d\n]{0,30}?(?:INICIAL|ANTERIOR)[^\n\d]*(-?[\d,]+\.\d{2})/i;
const RX_SALDO_FINAL =
  /SALDO[^\d\n]{0,30}?(?:FINAL|ACTUAL|AL\s*CORTE)[^\n\d]*(-?[\d,]+\.\d{2})/i;

/**
 * ── LO QUE NO ES UN MOVIMIENTO AUNQUE LO PAREZCA ──
 *
 * Cuando el estado de cuenta pasa de una hoja a dos, entre los movimientos se
 * cuelan encabezados repetidos, pies de página, "PÁGINA 2 DE 3", "VIENE DE LA
 * PÁGINA ANTERIOR" y el número de cuenta otra vez.
 *
 * Esas líneas no traen fecha, así que se pegaban al movimiento ANTERIOR como si
 * fueran su referencia. Y ahí estaba el daño: si el pie traía un número con
 * decimales, entraba a la lista de importes del movimiento — y como los importes
 * se leen de los ÚLTIMOS tres, los del pie ganaban sobre los verdaderos. El
 * movimiento pegado al salto de hoja salía con las cifras de otro renglón.
 *
 * Por eso el patrón busca en CUALQUIER parte de la línea, no sólo al principio.
 */
const RX_RUIDO = new RegExp(
  [
    /* BBVA repite el encabezado "OPERLIQ COD. DESCRIPCIÓN…CARGOS ABONOS…" en cada
     * hoja; si se cuela como continuación, su "ABONOS/CARGOS" voltea el lado del
     * movimiento pegado al salto de página. Por eso "OPER…" también es ruido. */
    '^(FECHA\\s*SALDO|FECHA|OPER\\s*LIQ|OPERLIQ|OPER|CONCEPTO|DESCRIPCI|REFERENCIA|RETIROS?|CARGOS?|DEPOSITOS?|ABONOS?|SALDOS?)',
    'P[ÁA]GINA\\s*\\d+',
    '\\d+\\s*DE\\s*\\d+\\s*$',
    'VIENE\\s+DE\\s+LA\\s+P[ÁA]GINA',
    'CONTIN[ÚU]A\\s+EN',
    'SUMA\\s+Y\\s+SIGUE',
    'ESTADO\\s+DE\\s+CUENTA',
    'R\\.?F\\.?C\\.?\\s*DEL?\\s*(CLIENTE|BANCO)',
    '^-{3,}',
  ].join('|'),
  'i'
);

/**
 * ── EL ORDEN DE LAS COLUMNAS SE LEE, NO SE SUPONE ──
 *
 * Bancrea pone RETIROS antes de DEPOSITOS. Otros bancos ponen DEPOSITOS antes
 * de RETIROS. Suponer un orden invierte los importes de la mitad de los bancos
 * —el retiro entra como depósito— y el saldo sale con el signo cambiado.
 *
 * La única fuente confiable es el ENCABEZADO del documento, que lo dice. Si no
 * hay encabezado se conserva el orden de Bancrea, que es el que se documentó, y
 * se avisa: es una suposición, y las suposiciones se dicen.
 */
export type OrdenColumnas = 'retiro-deposito' | 'deposito-retiro';

export function ordenDeColumnas(texto: string): { orden: OrdenColumnas; leido: boolean } {
  for (const linea of texto.split(/\r?\n/)) {
    const t = linea.toUpperCase();
    if (!/SALDO/.test(t)) continue;
    const iRetiro = Math.max(t.indexOf('RETIRO'), t.indexOf('CARGO'));
    const iDepos  = Math.max(t.indexOf('DEPOSITO'), t.indexOf('ABONO'), t.indexOf('DEPÓSITO'));
    if (iRetiro >= 0 && iDepos >= 0) {
      return { orden: iRetiro < iDepos ? 'retiro-deposito' : 'deposito-retiro', leido: true };
    }
  }
  return { orden: 'retiro-deposito', leido: false };
}

/**
 * El banco EMISOR, no una contraparte. El nombre corto de un banco ("BBVA",
 * "Banorte", "Bajío") aparece en los renglones como beneficiario/ordenante de un
 * SPEI, así que detectar por él confunde a casi todos. Se detecta por marcas del
 * EMISOR —su RFC (único) o su nombre en forma legal ("BBVA MEXICO, S.A.")—, y de
 * preferencia en el ENCABEZADO, que es donde el emisor se identifica.
 */
function detectarBanco(texto: string): string {
  /* Sólo el ENCABEZADO: ahí el emisor se identifica (RFC, nombre legal). Las
   * contrapartes —el otro banco de un SPEI— van en los renglones, más abajo, y
   * son las que confundían la detección. */
  const t = texto.toUpperCase().slice(0, 3500);
  if (/BBA130722BR7|MULTIPLE,?\s*BANCREA|SOYBANCREA/.test(t))            return 'Bancrea';
  if (/BBA830831LJ2|MAESTRA\s*PYME|BBVA\s*M[ÉE]XICO,?\s*S/.test(t))      return 'BBVA';
  if (/BRM940216|BANREGIO\s*GRUPO|BANCO\s*REGIONAL/.test(t))             return 'BanRegio';
  if (/BANCO\s*DEL\s*BAJ[ÍI]O|CONECTA\s*BANBAJIO|BB\.COM\.MX/.test(t))   return 'BanBajío';
  if (/CUENTA\s*NU\b|¡HOLA,|NU\s*M[ÉE]XICO/.test(t))                     return 'Nu';
  if (/CUST\s*ID|ESTADO\s*DE\s*SALDOS\s*Y\s*MOVIMIENTOS/.test(t))        return 'MercadoPago';
  if (/BVM951002|VE\s*POR\s*M[ÁA]S/.test(t))                            return 'VePorMás';
  if (/CITIBANAMEX|BANCO\s*NACIONAL\s*DE\s*M[ÉE]XICO|BNM840515/.test(t)) return 'Banamex';
  if (/BANCA\s*AFIRME|AFI9\d{5}/.test(t))                               return 'Afirme';
  if (/BNO951005|MERCANTIL\s*DEL\s*NORTE/.test(t))                       return 'Banorte';
  if (/BANCO\s*SANTANDER|BSM9\d/.test(t))                                return 'Santander';
  if (/SCOTIABANK\s*INVERLAT/.test(t))                                  return 'Scotiabank';
  if (/HSBC\s*M[ÉE]XICO/.test(t))                                       return 'HSBC';
  return 'Genérico';
}

export function extraerMovimientos(
  texto: string,
  opciones: { anio?: number; mes?: number } = {}
): ResultadoExtraccion {
  const avisos: string[] = [];

  /* Si el PDF trajo los importes pegados (pdf-parse colapsa espacios), se
   * separan por sus centavos ANTES de nada. Es determinista y no inventa cifras. */
  const separado = separarImportesPegados(texto);
  if (separado !== texto) {
    avisos.push(
      'Los importes venían pegados en el PDF; se separaron por sus centavos ' +
      '(cada importe termina en .dd). Revisa que los saldos cuadren.'
    );
    texto = separado;
  }

  const banco = detectarBanco(texto);

  const mIni = RX_SALDO_INICIAL.exec(texto);
  const mFin = RX_SALDO_FINAL.exec(texto);
  const saldoInicial = mIni ? aNumero(mIni[1]) : null;
  const saldoFinal   = mFin ? aNumero(mFin[1]) : null;

  if (saldoInicial === null) {
    avisos.push(
      'El documento no declara SALDO INICIAL. Sin él no hay contra qué cuadrar: ' +
      'el arrastre empieza en cero y todos los saldos van a salir desfasados.'
    );
  }

  const { orden, leido: ordenLeido } = ordenDeColumnas(texto);
  if (!ordenLeido && banco !== 'BBVA') {
    avisos.push(
      'El documento no trae un encabezado de columnas legible, así que se supuso ' +
      'RETIROS antes de DEPÓSITOS (el orden de Bancrea). Si tu banco los pone al ' +
      'revés, los importes van a salir invertidos: revísalos.'
    );
  }

  /* ── Cada movimiento con sus renglones de continuación ──
   *
   * Una transferencia SPEI ocupa tres o cuatro líneas: la del importe, y las de
   * beneficiario, concepto y clave de rastreo. Sin juntarlas se pierde la
   * referencia —que es con lo que se aclara un pago ante el banco—.
   *
   * PERO LOS IMPORTES SALEN SÓLO DE LA PRIMERA LÍNEA.
   *
   * Ésa es la que trae las columnas. Las de continuación traen texto, y a veces
   * números: un concepto que dice "PAGO FACTURA 1,234.00", o un pie de página
   * que se coló. Leyendo los importes del bloque entero, esos números entraban a
   * la lista y —como se toman los ÚLTIMOS tres— GANABAN sobre los verdaderos.
   *
   * Es exactamente lo que fallaba al pasar de una hoja a dos: el movimiento
   * pegado al salto salía con las cifras de otro renglón.
   */
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  interface Bloque { principal: string; continuacion: string[] }
  const bloques: Bloque[] = [];

  for (const linea of lineas) {
    if (RX_RUIDO.test(linea)) continue;
    if (fechaDeLinea(linea, opciones.anio)) bloques.push({ principal: linea, continuacion: [] });
    else if (bloques.length) bloques[bloques.length - 1].continuacion.push(linea);
  }

  const movimientos: MovimientoExtraido[] = [];
  let orden_ = 0;

  for (const b of bloques) {
    const fecha = fechaDeLinea(b.principal, opciones.anio);
    if (!fecha) continue;

    /* Los renglones de saldo del resumen no son movimientos. */
    if (/SALDO\s*(INICIAL|ANTERIOR|FINAL|ACTUAL)/i.test(b.principal) &&
        !/TRANSFEREN|COMISION|DEPOSITO|RETIRO/i.test(b.principal)) continue;

    const importes = (b.principal.match(RX_MONTO) || []).map(aNumero);
    if (importes.length === 0) continue;

    const completo = [b.principal, ...b.continuacion].join(' ');
    /* El concepto y el LADO (entra/sale) se leen de la línea PRINCIPAL, no del
     * texto completo: las continuaciones traen la referencia y —cuando el bloque
     * cruza un salto de página— el encabezado repetido con "CARGOS/ABONOS", que
     * voltearía el lado del movimiento. En la principal está "SPEI ENVIADO/
     * RECIBIDO" o "CUENTA DE TERCERO", que es lo que decide. BBVA trae dos
     * columnas de saldo: el reparto lo sabe (dosSaldos) para no leer un saldo
     * como depósito. */
    const concepto = conceptoDe(b.principal);
    const r = repartirImportes(importes, b.principal, orden, banco === 'BBVA');
    if (r.retiro === 0 && r.deposito === 0) continue;

    movimientos.push({
      fecha,
      concepto,
      referencia: completo.slice(0, 500),
      retiro: pesos(r.retiro),
      deposito: pesos(r.deposito),
      saldo: r.saldo === null ? null : pesos(r.saldo),
      saldoCalculado: 0,
      advertencia: r.duda
        ? 'No se pudo saber si entra o sale: el concepto no lo dice. Se tomó como retiro.'
        : '',
      inferido: false,
      duda: r.duda,
      orden: orden_++,
      lineaOrigen: b.principal.slice(0, 1000),
    });
  }

  /* ── BBVA: resolver los ambiguos con los saldos como puntos de control ──
   *
   * "PAGO CUENTA DE TERCERO" no dice si entra o sale. Pero entre dos saldos
   * declarados, la diferencia MENOS los movimientos de lado conocido es lo que
   * deben sumar los ambiguos. Si hay una ÚNICA combinación de signos que da esa
   * cifra, se resuelve; si no, se deja marcado. No se inventa el lado: se deduce
   * de lo que el propio banco declaró. */
  if (movimientos.some((m) => m.duda) && movimientos.some((m) => m.saldo !== null)) {
    let prev = saldoInicial ?? 0;
    let i = 0;
    while (i < movimientos.length) {
      let j = i;
      while (j < movimientos.length && movimientos[j].saldo === null) j++;
      if (j >= movimientos.length) break;                    // sin más puntos de control
      const seg = movimientos.slice(i, j + 1);
      const objetivo = pesos(movimientos[j].saldo! - prev);
      let claros = 0;
      const amb: MovimientoExtraido[] = [];
      for (const m of seg) {
        if (m.duda) amb.push(m);
        else claros = pesos(claros - m.retiro + m.deposito);
      }
      const faltante = pesos(objetivo - claros);
      if (amb.length >= 1 && amb.length <= 14) {
        const mag = amb.map((m) => m.retiro || m.deposito);
        let sol: number[] | null = null, cuantas = 0;
        for (let mask = 0; mask < (1 << amb.length); mask++) {
          let s = 0; const sg: number[] = [];
          for (let b = 0; b < amb.length; b++) {
            const v = (mask >> b) & 1 ? 1 : -1; sg.push(v); s = pesos(s + v * mag[b]);
          }
          if (Math.abs(s - faltante) < 0.02) { sol = sg; cuantas++; }
        }
        if (cuantas === 1 && sol) {
          amb.forEach((m, k) => {
            const v = m.retiro || m.deposito;
            if (sol![k] > 0) { m.deposito = v; m.retiro = 0; } else { m.retiro = v; m.deposito = 0; }
            m.duda = false; m.advertencia = '';
          });
        }
      }
      prev = movimientos[j].saldo!;
      i = j + 1;
    }
  }

  /* ── El arrastre del saldo, y lo que delata ── */
  let corriendo = saldoInicial ?? 0;
  for (const m of movimientos) {
    corriendo = pesos(corriendo - m.retiro + m.deposito);
    m.saldoCalculado = corriendo;
    if (m.saldo !== null && Math.abs(m.saldo - corriendo) > 0.02 && !m.advertencia) {
      m.advertencia =
        `El banco declara ${m.saldo.toFixed(2)} y el arrastre da ${corriendo.toFixed(2)}: ` +
        'falta o sobra un movimiento antes de éste.';
    }
  }

  /* ── La comisión que Bancrea omite ──
   *
   * Cada SPEI enviada genera $3.00 de comisión y $0.48 de IVA. El PDF a veces
   * trae sólo el IVA. Cuando el hueco entre el saldo declarado y el arrastrado
   * es exactamente $3.00, se inserta la comisión — MARCADA. */
  let inferidos = 0;
  if (banco === 'Bancrea') {
    for (let i = 0; i < movimientos.length; i++) {
      const m = movimientos[i];
      if (m.saldo === null) continue;
      const hueco = pesos(m.saldoCalculado - m.saldo);
      if (Math.abs(hueco - 3.0) > 0.02) continue;
      if (/COMISION/.test(m.concepto)) continue;

      movimientos.splice(i, 0, {
        fecha: m.fecha,
        concepto: 'COMISION TRANSFERENCIA SPEI',
        referencia: 'Deducida por la diferencia de saldos — no venía en el documento',
        retiro: 3.0,
        deposito: 0,
        saldo: null,
        saldoCalculado: 0,
        advertencia: 'Movimiento INFERIDO: el banco no lo reportó, se dedujo del saldo.',
        inferido: true,
        duda: false,
        orden: 0,
        lineaOrigen: '',
      });
      inferidos++;
      i++;
    }

    if (inferidos > 0) {
      /* Se rehace el arrastre con las comisiones dentro, y se renumera. */
      corriendo = saldoInicial ?? 0;
      movimientos.forEach((m, i) => {
        m.orden = i;
        corriendo = pesos(corriendo - m.retiro + m.deposito);
        m.saldoCalculado = corriendo;
        if (!m.inferido && m.saldo !== null && Math.abs(m.saldo - corriendo) > 0.02) {
          m.advertencia =
            `El banco declara ${m.saldo.toFixed(2)} y el arrastre da ${corriendo.toFixed(2)}.`;
        } else if (!m.inferido && m.saldo !== null) {
          m.advertencia = '';
        }
      });
      avisos.push(
        `Se dedujeron ${inferidos} comisión(es) que el documento no traía, por la ` +
        'diferencia de saldos. Van marcadas: NO las reportó el banco.'
      );
    }
  }

  const totalRetiros   = pesos(movimientos.reduce((a, m) => a + m.retiro, 0));
  const totalDepositos = pesos(movimientos.reduce((a, m) => a + m.deposito, 0));
  const finalCalculado = pesos((saldoInicial ?? 0) - totalRetiros + totalDepositos);

  /* Si el resumen no trae SALDO FINAL, se usa el ÚLTIMO saldo que el banco puso
   * en un renglón: BanBajío y otros lo traen por movimiento, no en un resumen.
   * Verificar el arrastre contra ese último saldo declarado sí dice algo —si un
   * movimiento saliera mal, el arrastre se separaría de él—. */
  let finalDeclarado = saldoFinal;
  if (finalDeclarado === null) {
    for (let k = movimientos.length - 1; k >= 0; k--) {
      if (movimientos[k].saldo !== null) { finalDeclarado = movimientos[k].saldo; break; }
    }
  }

  const cuadra = finalDeclarado !== null && Math.abs(finalDeclarado - finalCalculado) <= 0.02;
  if (finalDeclarado !== null && !cuadra) {
    avisos.push(
      `NO CUADRA: el saldo final declarado es ${finalDeclarado.toFixed(2)} y los ` +
      `movimientos extraídos dan ${finalCalculado.toFixed(2)}. La diferencia es ` +
      `${pesos(finalDeclarado - finalCalculado).toFixed(2)} — falta o sobra algo.`
    );
  }
  if (finalDeclarado === null) {
    avisos.push('El documento no declara SALDO FINAL: no hay contra qué verificar lo extraído.');
  }
  if (movimientos.length === 0) {
    avisos.push(
      'No se reconoció ningún movimiento. Si el estado de cuenta es un PDF escaneado, ' +
      'este servidor no puede leerlo: pega el texto o sube el CSV que da el portal del banco.'
    );
  }

  return {
    banco,
    saldoInicial,
    saldoFinal: finalDeclarado,
    movimientos,
    totalRetiros,
    totalDepositos,
    conAdvertencia: movimientos.filter((m) => m.advertencia).length,
    inferidos,
    cuadra,
    avisos,
  };
}

/**
 * El texto de un PDF, cuando se puede.
 *
 * `pdf-parse` colapsa los espacios en muchos PDF —está documentado en el
 * extractor de CSF— y en un estado de cuenta eso pega los importes entre sí:
 * "3,500.00 20,000.00" se vuelve un solo número y el movimiento sale con el
 * importe equivocado. Por eso se revisa el texto ANTES de devolverlo, y si
 * viene pegado se dice, en vez de entregar cifras inventadas.
 */
export async function textoDePdf(buffer: Buffer): Promise<{ texto: string; utilizable: boolean; motivo?: string }> {
  let texto = '';
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const r = await pdfParse(buffer);
    texto = r.text || '';
  } catch (e: any) {
    return {
      texto: '', utilizable: false,
      motivo: `No se pudo leer el PDF (${e.message}). Si está escaneado, este ` +
              'servidor no tiene OCR: pega el texto o sube el CSV del banco.',
    };
  }

  if (!texto.trim()) {
    return {
      texto: '', utilizable: false,
      motivo: 'El PDF no trae texto: está escaneado. Este servidor no tiene OCR — ' +
              'pega el texto del portal o sube el CSV.',
    };
  }

  /* Los importes pegados ("3,500.0020,000.00") YA NO se rechazan: se separan por
   * sus centavos en la extracción (separarImportesPegados), que es determinista.
   * Aquí sólo se entrega el texto; el rechazo se reserva para lo que de verdad no
   * se puede leer (un PDF escaneado, arriba). */
  return { texto, utilizable: true };
}
