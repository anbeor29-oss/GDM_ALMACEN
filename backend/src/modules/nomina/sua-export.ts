/**
 * sua-export — motor de los archivos de texto que el SUA IMPORTA.
 *
 * NEXO alimenta al SUA: aquí se arman los cuatro archivos de longitud fija que
 * el SUA lee en «Importación de datos», para no recapturar a mano el padrón ni
 * los movimientos.
 *
 *   Aseg.txt  168  alta del trabajador
 *   Afil.txt   80  datos afiliatorios (complementa el alta)
 *   Movt.txt   49  bajas, modificaciones de salario, reingresos
 *   Cred.txt   52  movimientos de crédito INFONAVIT
 *
 * DE DÓNDE SALEN ESTAS POSICIONES
 * No de un manual. Se leyeron de la base del SUA en producción (SUA 3.7.1)
 * cotejando los .txt que ese mismo SUA exporta contra el renglón correspondiente
 * de sus tablas: `Asegura`, `Afiliacion` y `Movtos`. Los créditos cuadraron 21 de
 * 21. Ref: docs/NEXO_A_SUA.md.
 *
 * ORDEN DE ENVÍO
 * Primero las altas, luego los movimientos. Un movimiento de alguien que el SUA
 * todavía no conoce se rechaza, así que el servicio no los junta en un paso.
 *
 * Este archivo NO toca la base: recibe datos y devuelve texto. El puente con la
 * base vive en sua-export.service.ts, igual que en el motor del IDSE.
 */

import { txtIzq, ceros, esp, cer, fechaDDMMAAAA } from './imss-idse';

/* ─────────────────────────  Catálogo de entidades del SUA  ─────────────────── */

/**
 * El catálogo `Estados` de la propia base del SUA: clave IMSS, las dos letras
 * que el CURP usa para la entidad de nacimiento, y el nombre como el SUA lo
 * escribe. Va aquí copiado a propósito: es lo que el SUA valida contra sí mismo,
 * y deducirlo del c_Estado del SAT daría nombres que no son los suyos.
 */
export const ENTIDADES_SUA: Array<{ clave: string; curp: string; nombre: string }> = [
  { clave: '01', curp: 'AS', nombre: 'AGUASCALIENTES' },
  { clave: '02', curp: 'BC', nombre: 'BAJA CALIFORNIA NORTE' },
  { clave: '03', curp: 'BS', nombre: 'BAJA CALIFORNIA SUR' },
  { clave: '04', curp: 'CC', nombre: 'CAMPECHE' },
  { clave: '05', curp: 'CL', nombre: 'COAHUILA' },
  { clave: '06', curp: 'CM', nombre: 'COLIMA' },
  { clave: '07', curp: 'CS', nombre: 'CHIAPAS' },
  { clave: '08', curp: 'CH', nombre: 'CHIHUAHUA' },
  { clave: '09', curp: 'DF', nombre: 'DISTRITO FEDERAL' },
  { clave: '10', curp: 'DG', nombre: 'DURANGO' },
  { clave: '11', curp: 'GT', nombre: 'GUANAJUATO' },
  { clave: '12', curp: 'GR', nombre: 'GUERRERO' },
  { clave: '13', curp: 'HG', nombre: 'HIDALGO' },
  { clave: '14', curp: 'JC', nombre: 'JALISCO' },
  { clave: '15', curp: 'MC', nombre: 'ESTADO DE MEXICO' },
  { clave: '16', curp: 'MN', nombre: 'MICHOACAN' },
  { clave: '17', curp: 'MS', nombre: 'MORELOS' },
  { clave: '18', curp: 'NT', nombre: 'NAYARIT' },
  { clave: '19', curp: 'NL', nombre: 'NUEVO LEON' },
  { clave: '20', curp: 'OC', nombre: 'OAXACA' },
  { clave: '21', curp: 'PL', nombre: 'PUEBLA' },
  { clave: '22', curp: 'QT', nombre: 'QUERETARO' },
  { clave: '23', curp: 'QR', nombre: 'QUINTANA ROO' },
  { clave: '24', curp: 'SP', nombre: 'SAN LUIS POTOSI' },
  { clave: '25', curp: 'SL', nombre: 'SINALOA' },
  { clave: '26', curp: 'SR', nombre: 'SONORA' },
  { clave: '27', curp: 'TC', nombre: 'TABASCO' },
  { clave: '28', curp: 'TS', nombre: 'TAMAULIPAS' },
  { clave: '29', curp: 'TL', nombre: 'TLAXCALA' },
  { clave: '30', curp: 'VZ', nombre: 'VERACRUZ' },
  { clave: '31', curp: 'YN', nombre: 'YUCATAN' },
  { clave: '32', curp: 'ZS', nombre: 'ZACATECAS' },
  { clave: '35', curp: 'NE', nombre: 'EXTRANJEROS' },
];

const POR_CURP = new Map(ENTIDADES_SUA.map((e) => [e.curp, e]));

/**
 * Entidad de nacimiento leída del CURP (posiciones 12-13). Es el único lugar
 * donde el dato existe con certeza: el domicilio del expediente dice dónde vive
 * hoy, no dónde nació, y el SUA pide lo segundo.
 */
export function entidadDesdeCurp(curp: string | null | undefined): { clave: string; nombre: string } {
  const cve = String(curp ?? '').toUpperCase().slice(11, 13);
  const e = POR_CURP.get(cve);
  return e ? { clave: e.clave, nombre: e.nombre } : { clave: '', nombre: '' };
}

/**
 * Sexo como lo escribe el SUA (M/F) a partir del CURP (posición 11, H/M).
 * Cuidado con la trampa: la `M` del CURP es Mujer y en el SUA es Masculino.
 */
export function sexoDesdeCurp(curp: string | null | undefined): 'M' | 'F' | ' ' {
  const c = String(curp ?? '').toUpperCase().charAt(10);
  if (c === 'H') return 'M';
  if (c === 'M') return 'F';
  return ' ';
}

/* ─────────────────────────  Tipos de descuento INFONAVIT  ─────────────────── */

export const TIPO_DESCUENTO_SUA = { porcentaje: '1', cuota_fija: '2', vsm: '3' } as const;
export type TipoDescuentoNexo = keyof typeof TIPO_DESCUENTO_SUA;

/**
 * El valor del descuento en 8 posiciones. La escala DEPENDE del tipo, que es la
 * única rareza del formato y está verificada contra los 21 créditos de la base
 * real: cuota fija lleva 3 decimales (01424910 = 1,424.91) y el factor VSM lleva
 * 4 (00085100 = 8.5100).
 *
 * El porcentaje se escribe con 4 decimales por analogía con el factor: no hay un
 * solo crédito por porcentaje en esa base para comprobarlo. Quien genere uno
 * recibe un aviso del servicio, para que lo coteje en el SUA antes de confiar.
 */
export function valorDescuentoSua(tipo: TipoDescuentoNexo, valor: number): string {
  const escala = tipo === 'cuota_fija' ? 1000 : 10000;
  return ceros(Math.round((Number(valor) || 0) * escala), 8);
}

/* ─────────────────────────  Parámetros del generador  ─────────────────────── */

/**
 * Lo que el SUA pide y el expediente de NEXO no guarda. Los valores por omisión
 * son los que predominan en la base real del SUA, no inventos: tipo de
 * trabajador 1 (permanente, 1,161 de 1,222 registros), semana completa, salario
 * fijo, UMF 000 y municipio en blanco (607 registros lo tienen así).
 */
export interface ConfigSua {
  tipoTrabajador?: string;   // 1 permanente · 2 eventual · 3 construcción · 4 eventual del campo
  semanaJornada?: string;    // 0 a 6
  tipoSalario?: string;      // 0 fijo · 1 variable · 2 mixto
  umf?: string;              // clínica (3)
  ocupacion?: string;        // 12
  claveUbicacion?: string;   // 17
  claveMunicipio?: string;   // 3 — catálogo Canamu del SUA (A01, Y45…)
  pensionado?: string;       // 0 / 1
  tablaDisminucion?: string; // N / S — créditos
}

const cfgTipoTrabajador = (c: ConfigSua) => (c.tipoTrabajador ?? '1').slice(0, 1);
const cfgSemanaJornada = (c: ConfigSua) => (c.semanaJornada ?? '0').slice(0, 1);
const cfgTipoSalario = (c: ConfigSua) => (c.tipoSalario ?? '0').slice(0, 1);
const cfgPensionado = (c: ConfigSua) => (c.pensionado ?? '0').slice(0, 1);

/* ─────────────────────────  Datos de entrada  ─────────────────────────────── */

export interface TrabajadorSua {
  registroPatronal: string;
  nss: string;
  rfc: string;
  curp: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombre: string;
  fechaAlta: Date | string;
  sbc: number;
  /* Datos afiliatorios (Afil.txt) */
  codigoPostal?: string;
  fechaNacimiento?: Date | string | null;
  /* Crédito INFONAVIT, si trae uno al momento del alta */
  numCredito?: string | null;
  tipoDescuento?: TipoDescuentoNexo | null;
  valorDescuento?: number | null;
  fechaDescuento?: Date | string | null;
}

export type TipoMovtoSua = 'BAJA' | 'MODIFICACION' | 'REINGRESO';

/** Tipos del SUA. El alta (01) no va en Movt.txt: viene en Aseg.txt. */
export const MOVTO_SUA = { BAJA: '02', MODIFICACION: '07', REINGRESO: '08' } as const;

export interface MovimientoSua {
  registroPatronal: string;
  nss: string;
  tipo: TipoMovtoSua;
  fecha: Date | string;
  /** Salario del movimiento. La baja va en ceros: el SUA no lo usa ahí. */
  sbc?: number;
  folioIncapacidad?: string;
}

export type TipoCreditoSua = 'INICIO' | 'SUSPENSION' | 'REINICIO' | 'MODIFICACION_VALOR';

export const CREDITO_SUA = {
  INICIO: '15', SUSPENSION: '16', REINICIO: '17', MODIFICACION_VALOR: '19',
} as const;

export interface CreditoSua {
  registroPatronal: string;
  nss: string;
  numCredito: string;
  tipo: TipoCreditoSua;
  fecha: Date | string;
  tipoDescuento: TipoDescuentoNexo;
  valorDescuento: number;
}

/* ─────────────────────────  Renglones  ────────────────────────────────────── */

/** El SUA guarda el nombre como PATERNO$MATERNO$NOMBRES en un solo campo de 50. */
export function nombreSua(paterno: string, materno: string, nombre: string): string {
  const limpio = (s: unknown) =>
    String(s ?? '').toUpperCase().replace(/\$/g, ' ').replace(/\s+/g, ' ').trim();
  return `${limpio(paterno)}$${limpio(materno)}$${limpio(nombre)}`;
}

/** Aseg.txt — 168 */
export function asegLinea(t: TrabajadorSua, cfg: ConfigSua = {}): string {
  const conCredito = Boolean(t.numCredito && t.tipoDescuento);
  const linea =
    txtIzq(t.registroPatronal, 11) +                                  // 1-11
    txtIzq(t.nss, 11) +                                               // 12-22
    txtIzq(t.rfc, 13) +                                               // 23-35
    txtIzq(t.curp, 18) +                                              // 36-53
    txtIzq(nombreSua(t.apellidoPaterno, t.apellidoMaterno, t.nombre), 50) + // 54-103
    cfgTipoTrabajador(cfg) +                                          // 104
    cfgSemanaJornada(cfg) +                                           // 105
    fechaDDMMAAAA(t.fechaAlta) +                                      // 106-113
    ceros(Math.round((Number(t.sbc) || 0) * 100), 7) +                // 114-120 SBC, 2 dec
    txtIzq(cfg.claveUbicacion, 17) +                                  // 121-137
    (conCredito ? ceros(t.numCredito, 10) : esp(10)) +                // 138-147
    (conCredito && t.fechaDescuento ? fechaDDMMAAAA(t.fechaDescuento) : cer(8)) + // 148-155
    (conCredito ? TIPO_DESCUENTO_SUA[t.tipoDescuento as TipoDescuentoNexo] : '0') + // 156
    (conCredito
      ? valorDescuentoSua(t.tipoDescuento as TipoDescuentoNexo, Number(t.valorDescuento) || 0)
      : cer(8)) +                                                     // 157-164
    cfgPensionado(cfg) +                                              // 165
    txtIzq(cfg.claveMunicipio, 3);                                    // 166-168
  return validar(linea, 168, 'Aseg');
}

/** Afil.txt — 80 */
export function afilLinea(t: TrabajadorSua, cfg: ConfigSua = {}): string {
  const ent = entidadDesdeCurp(t.curp);
  const linea =
    txtIzq(t.registroPatronal, 11) +                                  // 1-11
    txtIzq(t.nss, 11) +                                               // 12-22
    ceros(t.codigoPostal, 5) +                                        // 23-27
    (t.fechaNacimiento ? fechaDDMMAAAA(t.fechaNacimiento) : cer(8)) + // 28-35
    txtIzq(ent.nombre, 25) +                                          // 36-60
    (ent.clave || '  ') +                                             // 61-62
    ceros(cfg.umf ?? '000', 3) +                                      // 63-65
    txtIzq(cfg.ocupacion, 12) +                                       // 66-77
    sexoDesdeCurp(t.curp) +                                           // 78
    cfgTipoSalario(cfg) +                                             // 79
    ' ';                                                              // 80 jornada/horas
  return validar(linea, 80, 'Afil');
}

/** Movt.txt — 49 */
export function movtLinea(m: MovimientoSua, _cfg: ConfigSua = {}): string {
  /* La baja no lleva salario: en la base real todas tienen SAL_MOVT en ceros. */
  const sbc = m.tipo === 'BAJA' ? 0 : Number(m.sbc) || 0;
  const linea =
    txtIzq(m.registroPatronal, 11) +                                  // 1-11
    txtIzq(m.nss, 11) +                                               // 12-22
    MOVTO_SUA[m.tipo] +                                               // 23-24
    fechaDDMMAAAA(m.fecha) +                                          // 25-32
    txtIzq(m.folioIncapacidad, 8) +                                   // 33-40
    ceros(Math.round(sbc * 100), 9);                                  // 41-49
  return validar(linea, 49, 'Movt');
}

/** Cred.txt — 52 */
export function credLinea(c: CreditoSua, cfg: ConfigSua = {}): string {
  const linea =
    txtIzq(c.registroPatronal, 11) +                                  // 1-11
    txtIzq(c.nss, 11) +                                               // 12-22
    ceros(c.numCredito, 10) +                                         // 23-32
    CREDITO_SUA[c.tipo] +                                             // 33-34
    fechaDDMMAAAA(c.fecha) +                                          // 35-42
    TIPO_DESCUENTO_SUA[c.tipoDescuento] +                             // 43
    valorDescuentoSua(c.tipoDescuento, c.valorDescuento) +            // 44-51
    (cfg.tablaDisminucion ?? 'N').slice(0, 1);                        // 52
  return validar(linea, 52, 'Cred');
}

/* ─────────────────────────  Ensamblado  ───────────────────────────────────── */

function validar(linea: string, largo: number, archivo: string): string {
  if (linea.length !== largo) {
    throw new Error(
      `Renglón de ${archivo}.txt con longitud ${linea.length}, se esperaban ${largo}. No se genera el archivo.`,
    );
  }
  return linea;
}

/** El SUA lee archivos de renglones fijos terminados en CRLF. */
const armar = (lineas: string[]) => lineas.join('\r\n') + '\r\n';

export interface ArchivoSua {
  nombre: string;    // Aseg.txt, Afil.txt, Movt.txt, Cred.txt
  contenido: string;
  renglones: number;
}

/**
 * Altas: el archivo del padrón y, si se quiere, el de datos afiliatorios. Van
 * juntos porque es un solo paso del SUA y separarlos invita a importar uno y
 * olvidar el otro.
 */
export function generarAltas(
  trabajadores: TrabajadorSua[], cfg: ConfigSua = {}, conAfiliatorios = true,
): ArchivoSua[] {
  if (!trabajadores.length) throw new Error('No hay altas que generar.');
  const archivos: ArchivoSua[] = [{
    nombre: 'Aseg.txt',
    contenido: armar(trabajadores.map((t) => asegLinea(t, cfg))),
    renglones: trabajadores.length,
  }];
  if (conAfiliatorios) {
    archivos.push({
      nombre: 'Afil.txt',
      contenido: armar(trabajadores.map((t) => afilLinea(t, cfg))),
      renglones: trabajadores.length,
    });
  }
  return archivos;
}

export function generarMovimientos(movimientos: MovimientoSua[], cfg: ConfigSua = {}): ArchivoSua {
  if (!movimientos.length) throw new Error('No hay movimientos que generar.');
  return {
    nombre: 'Movt.txt',
    contenido: armar(movimientos.map((m) => movtLinea(m, cfg))),
    renglones: movimientos.length,
  };
}

export function generarCreditos(creditos: CreditoSua[], cfg: ConfigSua = {}): ArchivoSua {
  if (!creditos.length) throw new Error('No hay movimientos de crédito que generar.');
  return {
    nombre: 'Cred.txt',
    contenido: armar(creditos.map((c) => credLinea(c, cfg))),
    renglones: creditos.length,
  };
}

/* ─────────────────────────  Revisión de un archivo hecho  ─────────────────── */

export interface ProblemaSua { renglon: number; nivel: 'error' | 'aviso'; texto: string }

const LARGOS: Record<string, number> = { Aseg: 168, Afil: 80, Movt: 49, Cred: 52 };

/**
 * Revisa un archivo del SUA antes de importarlo. Lee las MISMAS posiciones con
 * las que se construye, así que valida contra el formato y no contra una copia
 * de las reglas. Devuelve todos los problemas de una vez: el SUA aborta la
 * importación y conviene corregir todo junto.
 */
export function validarArchivoSua(
  archivo: 'Aseg' | 'Afil' | 'Movt' | 'Cred', contenido: string,
): { ok: boolean; renglones: number; problemas: ProblemaSua[] } {
  const largo = LARGOS[archivo];
  const lineas = contenido.split(/\r\n|\r|\n/);
  while (lineas.length && lineas[lineas.length - 1].trim() === '') lineas.pop();

  const problemas: ProblemaSua[] = [];
  lineas.forEach((l, i) => {
    const renglon = i + 1;
    const err = (texto: string) => problemas.push({ renglon, nivel: 'error', texto });
    if (l.length !== largo) err(`Longitud ${l.length}: ${archivo}.txt mide exactamente ${largo}.`);
    if (!l.slice(0, 11).trim()) err('Falta el registro patronal (posiciones 1-11).');
    const nss = l.slice(11, 22);
    if (!/^\d{11}$/.test(nss)) err(`NSS inválido "${nss}" (posiciones 12-22): once dígitos.`);
    if (archivo === 'Movt') {
      const tipo = l.slice(22, 24);
      if (!['02', '07', '08', '11', '12'].includes(tipo)) {
        err(`Tipo de movimiento "${tipo}" fuera de lo que el SUA espera en Movt.txt.`);
      }
    }
    if (archivo === 'Cred') {
      const tipo = l.slice(32, 34);
      if (!Object.values(CREDITO_SUA).includes(tipo as any)) {
        err(`Tipo de movimiento de crédito "${tipo}" desconocido (posiciones 33-34).`);
      }
      if (!/^\d{10}$/.test(l.slice(22, 32))) err('Número de crédito inválido (posiciones 23-32).');
    }
  });

  return { ok: !problemas.some((p) => p.nivel === 'error'), renglones: lineas.length, problemas };
}
