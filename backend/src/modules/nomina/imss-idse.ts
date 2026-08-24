/**
 * imss-idse — motor de archivos de longitud fija (168 posiciones) para IDSE:
 * ALTA/REINGRESO, BAJA y MODIFICACIÓN DE SALARIO.
 *
 * Reconstruido desde las POSICIONES de la guía del IMSS (no de la concatenación
 * del VBA, que incrustaba constantes donde la guía define campos variables —
 * guía, clave del trabajador, CURP, causa de baja). Las constantes ambiguas
 * (número de guía, tipo de trabajador/salario, jornada) son PARÁMETROS, no texto
 * mágico. Ref: GDM_NEXO_MOTOR_IMSS_IDSE_SUA.md §5–§8.
 *
 * TODO registro se valida a 168 caracteres exactos antes de entrar al archivo.
 */

/* ─────────────────────────  Relleno / transformación (§4)  ───────────────── */

const may = (s: unknown) => String(s ?? '').toUpperCase();

/** Texto alineado a la izquierda, relleno con espacios a la derecha, cortado a n. */
export function txtIzq(v: unknown, n: number): string {
  return may(v).slice(0, n).padEnd(n, ' ');
}
/** Texto alineado a la derecha, relleno con espacios a la izquierda, cortado a n. */
export function txtDer(v: unknown, n: number): string {
  return may(v).slice(0, n).padStart(n, ' ');
}
/** Sólo dígitos, alineado a la derecha con ceros a la izquierda, a n posiciones. */
export function ceros(v: unknown, n: number): string {
  return String(v ?? '').replace(/\D/g, '').slice(-n).padStart(n, '0');
}
/** n espacios. */
export const esp = (n: number) => ' '.repeat(n);
/** n ceros. */
export const cer = (n: number) => '0'.repeat(n);

/** Fecha → DDMMAAAA (8). Acepta Date, "AAAA-MM-DD" o "DD/MM/AAAA" sin corrimiento por zona horaria. */
export function fechaDDMMAAAA(f: Date | string): string {
  let dd: string, mm: string, aa: string;
  if (typeof f === 'string') {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(f);
    const mx = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(f);
    if (iso) { [, aa, mm, dd] = iso; }
    else if (mx) { [, dd, mm, aa] = mx; }
    else { const d = new Date(f); dd = String(d.getUTCDate()).padStart(2, '0'); mm = String(d.getUTCMonth() + 1).padStart(2, '0'); aa = String(d.getUTCFullYear()); }
  } else {
    dd = String(f.getUTCDate()).padStart(2, '0'); mm = String(f.getUTCMonth() + 1).padStart(2, '0'); aa = String(f.getUTCFullYear());
  }
  return dd + mm + aa;
}
/** SBC (pesos.centavos) → 6 dígitos en CENTAVOS con ceros a la izquierda. */
export function sbc6(sbc: number): string {
  return ceros(Math.round((Number(sbc) || 0) * 100), 6);
}

/* ─────────────────────────  Tipos  ─────────────────────────────────────────── */

export type TipoIdse = 'ALTA' | 'BAJA' | 'MODIFICACION';

export interface MovimientoIdse {
  registroPatronal: string;   // 11 (registro 10 + dígito verificador)
  nss: string;                // 11 (NSS 10 + dígito verificador)
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombre: string;
  fecha: Date | string;       // fecha del movimiento
  sbc?: number;               // salario base de cotización (ALTA / MODIFICACION)
  umf?: string;               // clínica / UMF (3) — ALTA
  claveTrabajador?: string;   // 10
  curp?: string;              // 18
  causaBaja?: string;         // 1 — BAJA (ver CAUSAS_BAJA)
}

/** Constantes que el VBA dejaba incrustadas; aquí son configurables. */
export interface ConfigIdse {
  guia?: string;              // número de guía (5). Default '01400'.
  tipoTrabajador?: string;    // 1. Default '1'.
  tipoSalario?: string;       // 1 (1=fijo, 2=variable, 3=mixto). Default '2'.
  jornada?: string;           // semana/jornada reducida (1). Default '0'.
}

export const CAUSAS_BAJA: Record<string, string> = {
  '1': 'Término de contrato', '2': 'Separación voluntaria', '3': 'Abandono de empleo',
  '4': 'Defunción', '5': 'Clausura', '6': 'Otras', '7': 'Ausentismo',
  '8': 'Rescisión de contrato', '9': 'Jubilación', 'A': 'Pensión',
};

/* Movimientos IDSE (posiciones 132-133 del registro). */
const MOV = { ALTA: '08', BAJA: '02', MODIFICACION: '07' } as const;

/* ─────────────────────────  Encabezado común (1-103)  ─────────────────────── */

function encabezado(m: MovimientoIdse): string {
  return (
    txtIzq(m.registroPatronal, 11) +   // 1-11  registro patronal + DV
    txtIzq(m.nss, 11) +                 // 12-22 NSS + DV
    txtIzq(m.apellidoPaterno, 27) +    // 23-49
    txtIzq(m.apellidoMaterno, 27) +    // 50-76
    txtIzq(m.nombre, 27)               // 77-103
  );
}

/* ─────────────────────────  ALTA / REINGRESO (§5)  ─────────────────────────── */

export function altaIdse(m: MovimientoIdse, cfg: ConfigIdse = {}): string {
  const linea =
    encabezado(m) +                                    // 1-103
    sbc6(m.sbc || 0) +                                 // 104-109 SBC
    cer(6) +                                           // 110-115 filler
    (cfg.tipoTrabajador ?? '1').slice(0, 1) +          // 116 tipo de trabajador
    (cfg.tipoSalario ?? '2').slice(0, 1) +             // 117 tipo de salario
    (cfg.jornada ?? '0').slice(0, 1) +                 // 118 semana/jornada reducida
    fechaDDMMAAAA(m.fecha) +                           // 119-126 fecha
    txtIzq(m.umf, 3) +                                 // 127-129 UMF
    esp(2) +                                           // 130-131 filler
    MOV.ALTA +                                         // 132-133 movimiento (08)
    ceros(cfg.guia ?? '01400', 5) +                    // 134-138 guía
    txtIzq(m.claveTrabajador, 10) +                    // 139-148 clave trabajador
    esp(1) +                                           // 149 filler
    txtDer(m.curp, 18) +                               // 150-167 CURP (der. como en el VBA)
    '9';                                               // 168 identificador
  return validar(linea, 'ALTA');
}

/* ─────────────────────────  BAJA (§6)  ─────────────────────────────────────── */

export function bajaIdse(m: MovimientoIdse, cfg: ConfigIdse = {}): string {
  const linea =
    encabezado(m) +                                    // 1-103
    cer(15) +                                          // 104-118 filler
    fechaDDMMAAAA(m.fecha) +                           // 119-126 fecha
    esp(5) +                                           // 127-131 filler
    MOV.BAJA +                                         // 132-133 movimiento (02)
    ceros(cfg.guia ?? '01400', 5) +                    // 134-138 guía
    txtIzq(m.claveTrabajador, 10) +                    // 139-148 clave trabajador
    (m.causaBaja || ' ').slice(0, 1) +                 // 149 causa de baja
    esp(18) +                                          // 150-167 filler
    '9';                                               // 168 identificador
  return validar(linea, 'BAJA');
}

/* ─────────────────────────  MODIFICACIÓN DE SALARIO (§7)  ──────────────────── */

export function modSalarioIdse(m: MovimientoIdse, cfg: ConfigIdse = {}): string {
  const linea =
    encabezado(m) +                                    // 1-103
    sbc6(m.sbc || 0) +                                 // 104-109 SBC
    cer(9) +                                           // 110-118 filler
    fechaDDMMAAAA(m.fecha) +                           // 119-126 fecha
    esp(5) +                                           // 127-131 filler
    MOV.MODIFICACION +                                 // 132-133 movimiento (07)
    ceros(cfg.guia ?? '01400', 5) +                    // 134-138 guía
    txtIzq(m.claveTrabajador, 10) +                    // 139-148 clave trabajador
    esp(1) +                                           // 149 filler
    txtDer(m.curp, 18) +                               // 150-167 CURP
    '9';                                               // 168 identificador
  return validar(linea, 'MODIFICACION');
}

/* ─────────────────────────  Cifra de control (§8)  ─────────────────────────── */

export function cifraControlIdse(totalMovimientos: number, cfg: ConfigIdse = {}): string {
  const linea =
    '*'.repeat(13) +                                   // 1-13
    esp(43) +                                          // 14-56 filler
    ceros(totalMovimientos, 6) +                       // 57-62 total de registros
    esp(71) +                                          // 63-133 filler
    ceros(cfg.guia ?? '01400', 5) +                    // 134-138 guía
    esp(29) +                                          // 139-167 filler
    '9';                                               // 168 identificador
  return validar(linea, 'CIFRA_CONTROL');
}

/* ─────────────────────────  Ensamblado + validación  ──────────────────────── */

function validar(linea: string, etiqueta: string): string {
  if (linea.length !== 168) {
    throw new Error(`Registro IDSE ${etiqueta} con longitud ${linea.length}, se esperaban 168. No se genera el archivo.`);
  }
  return linea;
}

const CONSTRUCTOR: Record<TipoIdse, (m: MovimientoIdse, cfg: ConfigIdse) => string> = {
  ALTA: altaIdse, BAJA: bajaIdse, MODIFICACION: modSalarioIdse,
};

/**
 * Genera el archivo IDSE completo (movimientos + cifra de control) como una
 * sola cadena con saltos CRLF (lo que espera el IDSE). Valida cada registro a
 * 168; si alguno falla, no devuelve archivo.
 */
export function generarArchivoIdse(
  tipo: TipoIdse, movimientos: MovimientoIdse[], cfg: ConfigIdse = {}
): { contenido: string; registros: number } {
  if (!movimientos.length) throw new Error('No hay movimientos que generar.');
  const construir = CONSTRUCTOR[tipo];
  if (!construir) throw new Error(`Tipo de movimiento IDSE inválido: ${tipo}`);

  const lineas = movimientos.map((m) => construir(m, cfg));
  lineas.push(cifraControlIdse(lineas.length, cfg));
  // El IDSE espera líneas de longitud fija terminadas en CRLF.
  return { contenido: lineas.join('\r\n') + '\r\n', registros: movimientos.length };
}

/* ─────────────────────────  Validador de archivos IDSE  ───────────────────── */

export interface ProblemaLinea {
  linea: number;              // 1-indexado, como lo cuenta un editor de texto
  nivel: 'error' | 'aviso';
  texto: string;
}

export interface ResultadoValidacion {
  ok: boolean;                // no hay errores (avisos no cuentan)
  totalLineas: number;
  movimientos: number;
  altas: number;
  bajas: number;
  modificaciones: number;
  conCifraControl: boolean;
  problemas: ProblemaLinea[];
}

/** Lee un rango de la guía (posiciones 1-indexadas, inclusivas). */
const pos = (linea: string, desde: number, hasta: number) => linea.slice(desde - 1, hasta);

/** ¿DDMMAAAA es una fecha real? */
function fechaValida(v: string): boolean {
  if (!/^\d{8}$/.test(v)) return false;
  const dd = +v.slice(0, 2), mm = +v.slice(2, 4), aa = +v.slice(4, 8);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || aa < 1990 || aa > 2100) return false;
  const d = new Date(aa, mm - 1, dd);
  return d.getFullYear() === aa && d.getMonth() === mm - 1 && d.getDate() === dd;
}

const CODIGO_A_TIPO: Record<string, TipoIdse> = { '08': 'ALTA', '02': 'BAJA', '07': 'MODIFICACION' };

/**
 * Revisa un archivo IDSE ya hecho (el que generó este módulo, o uno de otro
 * sistema que se quiera cotejar antes de subirlo). Lee las MISMAS posiciones con
 * las que se construye, así que valida contra la guía y no contra una copia de
 * las reglas que se despegaría con el tiempo.
 *
 * Devuelve TODOS los problemas —no se detiene en el primero—, que es lo que
 * sirve: el IMSS rechaza el lote entero y uno quiere corregirlo de una vez.
 */
export function validarArchivoIdse(contenido: string): ResultadoValidacion {
  const lineas = contenido.split(/\r\n|\r|\n/);
  while (lineas.length && lineas[lineas.length - 1].trim() === '') lineas.pop();

  const problemas: ProblemaLinea[] = [];
  let movimientos = 0, altas = 0, bajas = 0, modificaciones = 0;
  let conCifraControl = false, totalDeclarado: number | null = null;

  lineas.forEach((linea, i) => {
    const n = i + 1;
    const err = (texto: string) => problemas.push({ linea: n, nivel: 'error', texto });
    const avi = (texto: string) => problemas.push({ linea: n, nivel: 'aviso', texto });

    if (linea.length !== 168) {
      err(`Longitud ${linea.length}: toda línea del IDSE debe medir exactamente 168 caracteres.`);
      // aun así se intenta leer lo que se pueda para dar más pistas.
    }

    // ── Cifra de control ──
    if (linea.startsWith('*'.repeat(13))) {
      conCifraControl = true;
      const total = pos(linea, 57, 62);
      if (!/^\d{6}$/.test(total)) err('Cifra de control: el total (posiciones 57-62) no son 6 dígitos.');
      else totalDeclarado = Number(total);
      if (pos(linea, 168, 168) !== '9') avi('Cifra de control: el identificador final (168) debería ser "9".');
      return;
    }

    // ── Movimiento ──
    const codigo = pos(linea, 132, 133);
    const tipo = CODIGO_A_TIPO[codigo];
    if (!tipo) {
      err(`Código de movimiento "${codigo}" desconocido (posiciones 132-133). Se espera 08 alta, 02 baja o 07 modificación.`);
      return;
    }
    movimientos++;
    if (tipo === 'ALTA') altas++; else if (tipo === 'BAJA') bajas++; else modificaciones++;

    if (!pos(linea, 1, 11).trim()) err('Falta el registro patronal (posiciones 1-11).');
    if (!pos(linea, 12, 22).trim()) err('Falta el NSS (posiciones 12-22): el IMSS lo exige.');
    if (!pos(linea, 23, 49).trim()) avi('Sin apellido paterno (posiciones 23-49).');

    const fecha = pos(linea, 119, 126);
    if (!fechaValida(fecha)) err(`Fecha del movimiento inválida "${fecha}" (posiciones 119-126, formato DDMMAAAA).`);

    if (tipo === 'ALTA' || tipo === 'MODIFICACION') {
      const sbc = pos(linea, 104, 109);
      if (!/^\d{6}$/.test(sbc)) err(`Salario base (posiciones 104-109) inválido "${sbc}": deben ser 6 dígitos en centavos.`);
      else if (Number(sbc) === 0) avi('El salario base es 0.00 — revísalo.');
    }
    if (tipo === 'BAJA') {
      const causa = pos(linea, 149, 149);
      if (!CAUSAS_BAJA[causa]) err(`Causa de baja "${causa}" desconocida (posición 149).`);
    }

    if (pos(linea, 168, 168) !== '9') avi('El identificador final (posición 168) debería ser "9".');
  });

  if (!conCifraControl) {
    problemas.push({ linea: lineas.length, nivel: 'error', texto: 'Falta la cifra de control (la última línea con 13 asteriscos y el total).' });
  } else if (totalDeclarado !== null && totalDeclarado !== movimientos) {
    problemas.push({ linea: lineas.length, nivel: 'error', texto: `La cifra de control declara ${totalDeclarado} movimiento(s) pero el archivo tiene ${movimientos}.` });
  }

  return {
    ok: !problemas.some((p) => p.nivel === 'error'),
    totalLineas: lineas.length,
    movimientos, altas, bajas, modificaciones,
    conCifraControl, problemas,
  };
}
