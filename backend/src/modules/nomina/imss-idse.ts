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
