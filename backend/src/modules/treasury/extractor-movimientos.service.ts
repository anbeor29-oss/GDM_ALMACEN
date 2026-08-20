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
    /\b(\d{1,2}[-/][A-Za-z]{3,10}[-/]\d{2,4})\b/,
    /\b(\d{4}-\d{1,2}-\d{1,2})\b/,
    /\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/,
    /\b(\d{1,2}[-/][A-Za-z]{3,10})\b/,
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
const ENTRA = ['RECIBIDA', 'DEPOSITO', 'ABONO', 'INGRESO', 'DEVOLUCION'];
const SALE  = ['ENVIADA', 'RETIRO', 'COMISION', 'IVA', 'CARGO', 'PAGO'];

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
  concepto: string
): { retiro: number; deposito: number; saldo: number | null; duda: boolean } {
  const t = concepto.toUpperCase();
  const entra = ENTRA.some((k) => t.includes(k));
  const sale  = SALE.some((k) => t.includes(k));

  if (importes.length === 0) return { retiro: 0, deposito: 0, saldo: null, duda: false };

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

  const [r, d, s] = importes.slice(-3).map(Math.abs);
  return { retiro: r, deposito: d, saldo: s, duda: false };
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
const RX_SALDO_INICIAL =
  /SALDO\s*(?:INICIAL|ANTERIOR)[^\n\d]*(-?[\d,]+\.\d{2})/i;
const RX_SALDO_FINAL =
  /SALDO\s*(?:FINAL|ACTUAL|AL\s*CORTE)[^\n\d]*(-?[\d,]+\.\d{2})/i;

/** Encabezados y pies que no son movimientos aunque traigan fecha y montos. */
const RX_RUIDO = /^(FECHA|CONCEPTO|REFERENCIA|RETIROS?|DEPOSITOS?|SALDOS?|PAGINA|P[ÁA]GINA|---)/i;

function detectarBanco(texto: string): string {
  const t = texto.toUpperCase();
  if (/BANCREA|BBA130722BR7/.test(t)) return 'Bancrea';
  if (/\bBBVA\b|BANCOMER/.test(t))    return 'BBVA';
  if (/SANTANDER/.test(t))            return 'Santander';
  if (/BANORTE/.test(t))              return 'Banorte';
  if (/\bHSBC\b/.test(t))             return 'HSBC';
  if (/SCOTIABANK/.test(t))           return 'Scotiabank';
  if (/BANBAJIO|BAJ[ÍI]O/.test(t))    return 'BanBajío';
  return 'Genérico';
}

export function extraerMovimientos(
  texto: string,
  opciones: { anio?: number; mes?: number } = {}
): ResultadoExtraccion {
  const avisos: string[] = [];
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

  /* ── Se junta cada movimiento con sus renglones de continuación ──
   *
   * Una transferencia SPEI ocupa tres o cuatro líneas: la del importe y las de
   * beneficiario, concepto y clave de rastreo. Sin juntarlas, la referencia se
   * pierde y —peor— una línea de continuación con un número se leería como un
   * movimiento nuevo. */
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bloques: string[] = [];
  for (const linea of lineas) {
    if (RX_RUIDO.test(linea)) continue;
    const tieneFecha = !!fechaDeLinea(linea, opciones.anio);
    if (tieneFecha) bloques.push(linea);
    else if (bloques.length) bloques[bloques.length - 1] += ' ' + linea;
  }

  const movimientos: MovimientoExtraido[] = [];
  let orden = 0;

  for (const bloque of bloques) {
    const fecha = fechaDeLinea(bloque, opciones.anio);
    if (!fecha) continue;

    /* Los renglones de saldo inicial/final del resumen no son movimientos. */
    if (/SALDO\s*(INICIAL|ANTERIOR|FINAL|ACTUAL)/i.test(bloque) &&
        !/TRANSFEREN|COMISION|DEPOSITO|RETIRO/i.test(bloque)) continue;

    const importes = (bloque.match(RX_MONTO) || []).map(aNumero);
    if (importes.length === 0) continue;

    const concepto = conceptoDe(bloque);
    const { retiro, deposito, saldo, duda } = repartirImportes(importes, concepto);
    if (retiro === 0 && deposito === 0) continue;

    movimientos.push({
      fecha,
      concepto,
      referencia: bloque.slice(0, 500),
      retiro: pesos(retiro),
      deposito: pesos(deposito),
      saldo: saldo === null ? null : pesos(saldo),
      saldoCalculado: 0,
      advertencia: duda
        ? 'No se pudo saber si entra o sale: el concepto no lo dice. Se tomó como retiro.'
        : '',
      inferido: false,
      orden: orden++,
      lineaOrigen: bloque.slice(0, 1000),
    });
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

  const cuadra = saldoFinal !== null && Math.abs(saldoFinal - finalCalculado) <= 0.02;
  if (saldoFinal !== null && !cuadra) {
    avisos.push(
      `NO CUADRA: el documento declara un saldo final de ${saldoFinal.toFixed(2)} y los ` +
      `movimientos extraídos dan ${finalCalculado.toFixed(2)}. La diferencia es ` +
      `${pesos(saldoFinal - finalCalculado).toFixed(2)} — falta o sobra algo.`
    );
  }
  if (saldoFinal === null) {
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
    saldoFinal,
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

  /* Dos importes pegados sin espacio: la señal de que se colapsó el texto. */
  const pegados = /\d\.\d{2}\d{1,3},\d{3}\.\d{2}/.test(texto) ||
                  /\d\.\d{2}\d+\.\d{2}/.test(texto);
  if (pegados) {
    return {
      texto, utilizable: false,
      motivo: 'El PDF se leyó, pero los importes llegaron pegados entre sí y no se ' +
              'pueden separar sin inventar cifras. Sube el CSV del portal del banco, ' +
              'o pega el texto del estado de cuenta.',
    };
  }

  return { texto, utilizable: true };
}
