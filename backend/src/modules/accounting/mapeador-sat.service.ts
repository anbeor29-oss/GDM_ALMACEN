/**
 * Acomoda un catálogo ajeno sobre la base del SAT.
 *
 * ── EL PROBLEMA ──
 * Cada despacho numera como quiere. Una balanza llega con '1-10-20-009 AFIRME'
 * y hay que saber que eso es un banco, es decir el agrupador 102.01 del
 * Anexo 24. El SAT es la espina dorsal; lo demás se acomoda encima.
 *
 * ── POR QUÉ EL NOMBRE DE LA CUENTA NO ALCANZA ──
 * En una balanza real de 343 cuentas, 175 se llaman como el cliente
 * ('NOE ALFREDO SALAS MARTIN DEL CAMPO') y 83 como el proveedor. Ningún
 * diccionario de sinónimos va a reconocer eso, y no hace falta: lo que dice
 * qué son es de quién cuelgan.
 *
 * Y hay algo peor que "no reconocer": reconocer mal. En ese mismo archivo
 * 'AFIRME' aparece DOS VECES —bajo BANCOS, donde es el 102.01, y bajo
 * ACREEDORES DIVERSOS, donde es un préstamo bancario—. Un mapeo por nombre
 * manda el pasivo al activo y descuadra el balance sin que nada se queje.
 *
 * Por eso el orden es: se identifica la cuenta SUMARIA por su nombre, y las
 * hojas HEREDAN de ella. El padre carga el significado; la hoja carga el
 * tercero.
 *
 * ── Y POR QUÉ ESTO PROPONE EN VEZ DE APLICAR ──
 * Un mapeo equivocado no se ve: la balanza sigue cuadrando, sólo que el saldo
 * quedó en el renglón que no era. Se devuelve una propuesta con su grado de
 * confianza y su razón, y lo dudoso lo confirma una persona.
 */

import type { FilaBalanza } from './balanza-lector.service';
import { marcarHojas } from './balanza-lector.service';
import { query } from '../../config/database';

export type TipoSat =
  | 'ACTIVO' | 'PASIVO' | 'CAPITAL' | 'INGRESO'
  | 'COSTO' | 'GASTO' | 'RIF' | 'ORDEN';

export type Confianza = 'ALTA' | 'MEDIA' | 'BAJA' | 'CONFLICTO' | 'NINGUNA';

export interface PropuestaCuenta {
  cuenta: string;
  nombre: string;
  naturaleza: 'D' | 'A';
  hoja: boolean;
  padre: string | null;
  tipoPorCodigo: TipoSat | null;
  tipoPorNombre: TipoSat | null;
  agrupador: string | null;
  agrupadorNombre?: string;
  confianza: Confianza;
  razon: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. EL PRIMER DÍGITO Y EL TIPO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * La convención casi universal en México: 1 activo, 2 pasivo, 3 capital,
 * 4 ingresos, 5 costos, 6 gastos, 7 resultado integral, 8 orden.
 *
 * Casi. Hay catálogos que meten los gastos en 5 y el costo en 6, o que usan
 * 7 para otros gastos. Por eso es un parámetro y no una constante — y por eso
 * el desacuerdo entre el dígito y el nombre se REPORTA en vez de resolverse
 * en silencio.
 */
export const CONVENCION_MX: Record<string, TipoSat> = {
  '1': 'ACTIVO', '2': 'PASIVO', '3': 'CAPITAL', '4': 'INGRESO',
  '5': 'COSTO', '6': 'GASTO', '7': 'RIF', '8': 'ORDEN',
};

function tipoPorCodigo(codigo: string, conv: Record<string, TipoSat>): TipoSat | null {
  const d = codigo.trim()[0];
  return conv[d] ?? null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. NOMBRES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Normaliza para comparar: sin acentos, sin puntuación, en mayúsculas.
 *
 * Los archivos reales traen 'Retenci n ISR' —la ó se perdió al exportar— y
 * 'GTOS. NO DEDUCIBLES'. Comparar en crudo falla en los dos casos.
 */
export function normalizar(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Sinonimo {
  /** Se prueba contra el nombre normalizado. */
  patron: RegExp;
  agrupador: string;
  tipo: TipoSat;
  /** Agrupador que se le da a las cuentas que cuelgan de ésta. */
  hijos?: string;
}

/**
 * El vocabulario de un catálogo mexicano.
 *
 * Se prueba EN ORDEN: lo más específico primero. 'IMPUESTOS ACREDITABLES POR
 * PAGAR' tiene que ganarle a 'IMPUESTOS ACREDITABLES', o el 119 termina en
 * el 118 y el IVA se acredita un mes antes de tiempo.
 */
const SINONIMOS: Sinonimo[] = [
  /* ── ACTIVO ── */
  { patron: /\bCAJA\b|EFECTIVO/,                       agrupador: '101', hijos: '101.01', tipo: 'ACTIVO' },
  { patron: /\bBANCOS?\b/,                             agrupador: '102', hijos: '102.01', tipo: 'ACTIVO' },
  { patron: /INVERSION(ES)?|FONDOS? DE INVERSION/,     agrupador: '103', hijos: '103.01', tipo: 'ACTIVO' },
  { patron: /\bCLIENTES?\b|CUENTAS POR COBRAR CLIENTE/, agrupador: '105', hijos: '105.01', tipo: 'ACTIVO' },
  { patron: /DEUDORES? DIVERSOS?/,                     agrupador: '107', tipo: 'ACTIVO' },
  { patron: /DOCUMENTOS? POR COBRAR|CUENTAS? POR COBRAR/, agrupador: '106', tipo: 'ACTIVO' },
  { patron: /ESTIMACION.*INCOBRABLE|CUENTAS INCOBRABLES/, agrupador: '108', tipo: 'ACTIVO' },
  { patron: /PAGOS? ANTICIPADOS?|GASTOS? ANTICIPADOS?/, agrupador: '109', tipo: 'ACTIVO' },
  { patron: /SUBSIDIO AL EMPLEO/,                      agrupador: '110', tipo: 'ACTIVO' },
  { patron: /IMPUESTOS? A FAVOR|SALDO A FAVOR/,        agrupador: '113', tipo: 'ACTIVO' },
  { patron: /PAGOS? PROVISIONALES?/,                   agrupador: '114', tipo: 'ACTIVO' },
  { patron: /INVENTARIO|ALMACEN|MERCANCIAS?/,          agrupador: '115', tipo: 'ACTIVO' },
  /* 119 ANTES que 118: 'acreditables POR PAGAR' contiene 'acreditables'. */
  { patron: /ACREDITABLES? POR PAGAR|PENDIENTES? DE ACREDITAR|IVA PENDIENTE/,
                                                       agrupador: '119', tipo: 'ACTIVO' },
  { patron: /IMPUESTOS? ACREDITABLES?|IVA ACREDITABLE/, agrupador: '118', tipo: 'ACTIVO' },
  { patron: /ANTICIPO.*PROVEEDOR/,                     agrupador: '120', tipo: 'ACTIVO' },
  { patron: /\bTERRENOS?\b/,                           agrupador: '151', tipo: 'ACTIVO' },
  { patron: /EDIFICIOS?|CONSTRUCCIONES?/,              agrupador: '152', tipo: 'ACTIVO' },
  { patron: /MAQUINARIA/,                              agrupador: '153', tipo: 'ACTIVO' },
  { patron: /AUTOMOVILES?|VEHICULOS?|CAMIONES?|TRANSPORTE/, agrupador: '154', tipo: 'ACTIVO' },
  { patron: /MOBILIARIO|MUEBLES/,                      agrupador: '155', tipo: 'ACTIVO' },
  { patron: /EQUIPO DE COMPUTO|COMPUTADORAS?/,         agrupador: '156', tipo: 'ACTIVO' },
  { patron: /EQUIPO DE COMUNICACION/,                  agrupador: '157', tipo: 'ACTIVO' },
  { patron: /DEPRECIACION ACUMULADA/,                  agrupador: '171', tipo: 'ACTIVO' },
  { patron: /AMORTIZACION ACUMULADA/,                  agrupador: '183', tipo: 'ACTIVO' },
  { patron: /DEPOSITOS? EN GARANTIA/,                  agrupador: '184', hijos: '184.01', tipo: 'ACTIVO' },
  { patron: /IMPUESTOS? DIFERIDOS?/,                   agrupador: '185', tipo: 'ACTIVO' },
  { patron: /MARCAS Y PATENTES|PATENTES/,              agrupador: '179', tipo: 'ACTIVO' },
  { patron: /GASTOS? DE INSTALACION/,                  agrupador: '181', tipo: 'ACTIVO' },
  { patron: /INTANGIBLES?/,                            agrupador: '176', tipo: 'ACTIVO' },

  /* ── PASIVO ── */
  { patron: /\bPROVEEDORES?\b/,                        agrupador: '201', hijos: '201.01', tipo: 'PASIVO' },
  { patron: /ACREEDORES? DIVERSOS?/,                   agrupador: '205', hijos: '205.05', tipo: 'PASIVO' },
  { patron: /ANTICIPOS? DE CLIENTES?/,                 agrupador: '206', tipo: 'PASIVO' },
  { patron: /DOCUMENTOS? POR PAGAR|CUENTAS? POR PAGAR/, agrupador: '202', tipo: 'PASIVO' },
  { patron: /IVA TRASLADADO COBRADO|TRASLADADOS? COBRADOS?/, agrupador: '208', tipo: 'PASIVO' },
  { patron: /TRASLADADOS? NO COBRADOS?|IVA POR TRASLADAR/, agrupador: '209', tipo: 'PASIVO' },
  { patron: /IMPUESTOS? TRASLADADOS?/,                 agrupador: '207', tipo: 'PASIVO' },
  { patron: /PROVISION.*SUELDOS?|SUELDOS? POR PAGAR|NOMINA POR PAGAR/,
                                                       agrupador: '210', tipo: 'PASIVO' },
  { patron: /IMSS|INFONAVIT|\bSAR\b|SEGURIDAD SOCIAL/, agrupador: '211', tipo: 'PASIVO' },
  { patron: /IMPUESTO.*NOMINA/,                        agrupador: '212', tipo: 'PASIVO' },
  { patron: /IMPUESTOS? RETENIDOS?|RETENCION(ES)?\b/,  agrupador: '216', hijos: '216.01', tipo: 'PASIVO' },
  { patron: /CONTRIBUCIONES? POR PAGAR|IMPUESTOS? POR PAGAR|DERECHOS? POR PAGAR/,
                                                       agrupador: '213', tipo: 'PASIVO' },
  { patron: /\bPTU\b.*PAGAR/,                          agrupador: '215', tipo: 'PASIVO' },
  { patron: /DIVIDENDOS? POR PAGAR/,                   agrupador: '214', tipo: 'PASIVO' },

  /* ── CAPITAL ── */
  { patron: /CAPITAL SOCIAL/,                          agrupador: '301', tipo: 'CAPITAL' },
  { patron: /RESERVA LEGAL/,                           agrupador: '303', tipo: 'CAPITAL' },
  { patron: /RESULTADO.*EJERCICIOS? ANTERIOR|UTILIDADES? ACUMULADAS?|PERDIDAS? ACUMULADAS?/,
                                                       agrupador: '304', hijos: '304.01', tipo: 'CAPITAL' },
  { patron: /RESULTADO DEL? EJERCICIO|UTILIDAD DEL? EJERCICIO/,
                                                       agrupador: '305', tipo: 'CAPITAL' },
  { patron: /\bPATRIMONIO\b/,                          agrupador: '302', tipo: 'CAPITAL' },
  { patron: /CAPITAL CONTABLE/,                        agrupador: '301', tipo: 'CAPITAL' },

  /* ── INGRESOS ── */
  { patron: /DEVOLUCIONES?|DESCUENTOS?.*VENTAS?|BONIFICACIONES?/, agrupador: '402', tipo: 'INGRESO' },
  { patron: /bVENTAS?b.*16|VENTAS?.*TASA GENERAL|VENTAS? GRAVADAS?/,
                                                       agrupador: '401', hijos: '401.01', tipo: 'INGRESO' },
  { patron: /bVENTAS?b.*0\s*%|TASA 0/,                   agrupador: '401', hijos: '401.03', tipo: 'INGRESO' },
  { patron: /EXPORTACION/,                             agrupador: '401', hijos: '401.22', tipo: 'INGRESO' },
  { patron: /ARRENDAMIENTO/,                           agrupador: '401', hijos: '401.19', tipo: 'INGRESO' },
  { patron: /OTROS? INGRESOS?/,                        agrupador: '403', tipo: 'INGRESO' },

  /* ── COSTOS ── */
  { patron: /DEVOLUCIONES?.*COMPRAS?/,                 agrupador: '503', tipo: 'COSTO' },
  { patron: /COSTO DE VENTAS?|COSTO DE LO VENDIDO/,    agrupador: '501', hijos: '501.01', tipo: 'COSTO' },
  { patron: /\bCOMPRAS?\b/,                            agrupador: '502', tipo: 'COSTO' },
  { patron: /GASTOS? INDIRECTOS?|INDIRECTOS? DE FABRICACION/, agrupador: '504', tipo: 'COSTO' },
  { patron: /MANO DE OBRA/,                            agrupador: '605', tipo: 'GASTO' },

  /* ── El comodín de ventas va AQUÍ, no arriba ──
   * '\bVENTAS?\b' también aparece en 'COSTO DE VENTA'. Puesto antes del
   * bloque de costos se lleva el 501 al 401: el costo se vuelve ingreso, y
   * con él todas sus subcuentas por herencia. */
  { patron: /\bVENTAS?\b|\bINGRESOS?\b/,               agrupador: '401', hijos: '401.01', tipo: 'INGRESO' },

  /* ── GASTOS ── */
  { patron: /GASTOS? NO DEDUCIBLES?|GTOS.*NO DEDUCIBLES?/, agrupador: '601', hijos: '601.83', tipo: 'GASTO' },
  { patron: /GASTOS? DE VENTAS?/,                      agrupador: '602', hijos: '602.84', tipo: 'GASTO' },
  { patron: /GASTOS? DE ADMINISTRACION/,               agrupador: '603', hijos: '603.84', tipo: 'GASTO' },
  { patron: /GASTOS? DE FABRICACION/,                  agrupador: '604', hijos: '604.84', tipo: 'GASTO' },
  { patron: /\bISR\b/,                                 agrupador: '611', tipo: 'GASTO' },
  { patron: /GASTOS? GENERALES?|GASTOS? DE OPERACION/, agrupador: '601', hijos: '601.84', tipo: 'GASTO' },

  /* ── RESULTADO INTEGRAL DE FINANCIAMIENTO ── */
  { patron: /DEPRECIACION/,                            agrupador: '701', tipo: 'RIF' },
  { patron: /AMORTIZACION/,                            agrupador: '702', tipo: 'RIF' },
  { patron: /GASTOS? FINANCIEROS?|PRODUCTOS? FINANCIEROS?|INTERESES|COMISION(ES)? BANCARIAS?|CAMBIARI/,
                                                       agrupador: '703', tipo: 'RIF' },
  { patron: /OTROS? GASTOS?|OTROS? PRODUCTOS?/,        agrupador: '704', tipo: 'RIF' },
];

/**
 * Los conceptos de gasto del 601-604, que sí se reconocen por nombre.
 *
 * Aquí el nombre SÍ vale: 'UNIFORMES' es 601.77 y 'ENERGIA ELECTRICA' es
 * 601.52 en cualquier catálogo. Es el único bloque donde las hojas se
 * identifican solas, porque no llevan nombres de personas.
 */
const CONCEPTOS_GASTO: Array<[RegExp, string]> = [
  [/SUELDOS?|SALARIOS?/, '.01'], [/COMPENSACION/, '.02'], [/TIEMPO.*EXTRA|HORAS? EXTRA/, '.03'],
  [/PREMIO.*ASISTENCIA/, '.04'], [/PREMIO.*PUNTUALIDAD/, '.05'], [/VACACIONES/, '.06'],
  [/PRIMA VACACIONAL/, '.07'], [/PRIMA DOMINICAL/, '.08'], [/DIAS? FESTIVOS?/, '.09'],
  [/GRATIFICACION/, '.10'], [/PRIMA.*ANTIGUEDAD/, '.11'], [/AGUINALDO/, '.12'],
  [/INDEMNIZACION/, '.13'], [/DESTAJO/, '.14'], [/DESPENSA/, '.15'],
  [/TRANSPORTE/, '.16'], [/SERVICIO MEDICO|MEDICO/, '.17'], [/FUNERARIO/, '.18'],
  [/FONDO DE AHORRO/, '.19'], [/CUOTAS? SINDICAL/, '.20'], [/\bPTU\b/, '.21'],
  [/ESTIMULO/, '.22'], [/PREVISION SOCIAL/, '.23'], [/JUBILACION/, '.24'],
  [/CUOTAS? AL IMSS|IMSS/, '.26'], [/INFONAVIT/, '.27'], [/\bSAR\b/, '.28'],
  [/IMPUESTO.*NOMINA/, '.29'], [/ASIMILADOS?/, '.31'],
  [/SERVICIOS? ADMINISTRATIVOS?/, '.32'],
  [/HONORARIOS?|SERVICIOS? PROFESIONALES?/, '.34'],
  [/ARRENDAMIENTO|RENTA/, '.45'], [/COMBUSTIBLES?|GASOLINA|LUBRICANTES?/, '.48'],
  [/VIATICOS?|GASTOS? DE VIAJE/, '.49'], [/TELEFONO|INTERNET/, '.50'],
  [/\bAGUA\b/, '.51'], [/ENERGIA ELECTRICA|\bLUZ\b/, '.52'],
  [/VIGILANCIA|SEGURIDAD/, '.53'], [/LIMPIEZA/, '.54'],
  [/PAPELERIA|ARTICULOS? DE OFICINA/, '.55'], [/MANTENIMIENTO|CONSERVACION/, '.56'],
  [/SEGUROS?|FIANZAS?/, '.57'], [/RECARGOS?/, '.59'], [/CUOTAS? Y SUSCRIPCIONES?|SUSCRIPCION/, '.60'],
  [/PUBLICIDAD|PROPAGANDA/, '.61'], [/CAPACITACION/, '.62'], [/DONATIVOS?/, '.63'],
  [/FLETES?|ACARREOS?/, '.72'], [/COMISIONES? SOBRE VENTAS?/, '.74'],
  [/COMISIONES?.*TARJETA/, '.75'], [/UNIFORMES?/, '.77'], [/PREDIAL/, '.78'],
  [/NO DEDUCIBLES?/, '.83'],
];

/**
 * Tipos que pueden discrepar sin que sea un error.
 *
 * Los intereses son ingreso para un catálogo y resultado integral de
 * financiamiento para el SAT; los gastos financieros viven dentro de gastos
 * pero agrupan en 703. Marcar eso como conflicto llena la revisión de ruido y
 * entierra los desacuerdos que sí importan.
 */
const COMPATIBLES: Array<[TipoSat, TipoSat]> = [
  ['GASTO', 'RIF'], ['INGRESO', 'RIF'], ['COSTO', 'GASTO'], ['COSTO', 'RIF'],
];
function compatibles(a: TipoSat, b: TipoSat): boolean {
  return COMPATIBLES.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

function porNombre(nombre: string): Sinonimo | null {
  const n = normalizar(nombre);
  if (!n) return null;
  for (const s of SINONIMOS) if (s.patron.test(n)) return s;
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. LA PROPUESTA
   ═══════════════════════════════════════════════════════════════════════════ */

export interface OpcionesMapeo {
  convencion?: Record<string, TipoSat>;
  /** Códigos SAT que existen en la base, para no proponer uno inexistente. */
  agrupadoresValidos?: Set<string>;
}

/**
 * Propone a qué código agrupador corresponde cada cuenta del catálogo ajeno.
 *
 * ── EL ORDEN IMPORTA ──
 * 1. Se resuelven las SUMARIAS por su nombre. Son las que traen vocabulario
 *    contable ('BANCOS', 'PROVEEDORES', 'COSTO DE VENTA').
 * 2. Las hojas HEREDAN de su sumaria. 'AFIRME' bajo BANCOS es 102.01; el mismo
 *    'AFIRME' bajo ACREEDORES DIVERSOS es un pasivo, y por herencia queda
 *    donde debe. Al revés —resolviendo hojas por nombre— el pasivo se iría al
 *    activo y el balance descuadraría sin una sola queja.
 * 3. Sólo en los grupos de gasto la hoja manda: 'UNIFORMES' es 601.77 en
 *    cualquier catálogo, y ahí los nombres sí son conceptos y no personas.
 */
export function proponerMapeo(
  filasCrudas: FilaBalanza[],
  opciones: OpcionesMapeo = {},
): PropuestaCuenta[] {
  const conv = opciones.convencion ?? CONVENCION_MX;
  const validos = opciones.agrupadoresValidos;
  const filas = marcarHojas([...filasCrudas]);
  const porCuenta = new Map(filas.map((f) => [f.cuenta, f]));

  /* Un agrupador propuesto que no exista en la base sería un mapeo roto que
   * sólo se descubre al guardar. Se degrada a su cuenta mayor. */
  const valido = (c: string | null): string | null => {
    if (!c) return null;
    if (!validos || validos.has(c)) return c;
    const mayor = c.split('.')[0];
    return validos.has(mayor) ? mayor : null;
  };

  const resueltas = new Map<string, { agrupador: string; hijos?: string; tipo: TipoSat }>();
  const salida: PropuestaCuenta[] = [];

  /* ── Pasada 1: las sumarias, por su nombre ──
   * Se registra sólo si el nombre NO contradice al código. Una sumaria mal
   * resuelta contamina a TODAS sus hojas por herencia: 'COSTO DE VENTA' leído
   * como 401 manda siete millones de costos al renglón de ingresos. */
  for (const f of filas) {
    if (f.hoja) continue;
    const s = porNombre(f.nombre);
    if (!s) continue;
    const tCod = tipoPorCodigo(f.cuenta, conv);
    if (tCod && s.tipo !== tCod && !compatibles(tCod, s.tipo)) continue;
    resueltas.set(f.cuenta, { agrupador: s.agrupador, hijos: s.hijos, tipo: s.tipo });
  }

  /* ── Pasada 2: cada cuenta ── */
  for (const f of filas) {
    const tCod = tipoPorCodigo(f.cuenta, conv);
    const propio = porNombre(f.nombre);
    const tNom = propio?.tipo ?? null;

    let agrupador: string | null = null;
    let confianza: Confianza = 'NINGUNA';
    let razon = '';

    /* El ancestro resuelto más cercano. */
    let ancestro: { agrupador: string; hijos?: string; tipo: TipoSat } | undefined;
    let cursor: string | null | undefined = f.padre;
    let nombreAncestro = '';
    while (cursor) {
      if (resueltas.has(cursor)) {
        ancestro = resueltas.get(cursor);
        nombreAncestro = porCuenta.get(cursor)?.nombre ?? cursor;
        break;
      }
      cursor = porCuenta.get(cursor)?.padre ?? null;
    }

    /* ── Desacuerdo entre el código y el nombre ──
     * Se reporta, no se resuelve. Puede ser una cuenta mal numerada en el
     * origen, o una convención distinta a la supuesta; las dos cosas las tiene
     * que ver una persona. */
    if (!f.hoja && propio && tCod && tNom && tCod !== tNom && !compatibles(tCod, tNom)) {
      salida.push({
        cuenta: f.cuenta, nombre: f.nombre, naturaleza: f.naturaleza,
        hoja: !!f.hoja, padre: f.padre ?? null,
        tipoPorCodigo: tCod, tipoPorNombre: tNom,
        agrupador: null, confianza: 'CONFLICTO',
        razon:
          `El código dice ${tCod} (empieza con ${f.cuenta[0]}) y el nombre dice ` +
          `${tNom}. Uno de los dos está mal, y elegir por nuestra cuenta movería ` +
          `el saldo de lado del balance.`,
      });
      continue;
    }

    /* ── Refinar un gasto por su concepto ──
     * Es la ÚNICA familia donde el nombre de la hoja es un concepto contable
     * y no una persona: 'UNIFORMES' es 601.77 en cualquier catálogo. */
    const refinarGasto = (base: string): string | null => {
      if (!['601', '602', '603', '604'].includes(base)) return null;
      const n = normalizar(f.nombre);
      for (const [rx, suf] of CONCEPTOS_GASTO) if (rx.test(n)) return valido(base + suf);
      return null;
    };

    if (f.hoja) {
      /* ── HOJA: manda el padre ──
       * Aquí es donde se gana o se pierde el mapeo. En el archivo real, 175
       * hojas se llaman como el cliente y 83 como el proveedor: 'BANCO DEL
       * BAJIO S.A.' es un PROVEEDOR, y leerlo por su nombre lo manda al 102
       * —un activo— cuando es un pasivo.
       *
       * El nombre de una hoja identifica al TERCERO. El del padre identifica
       * la CUENTA. Sólo el segundo sirve para mapear. */
      if (ancestro) {
        const refinado = refinarGasto(ancestro.agrupador);
        agrupador = refinado ?? valido(ancestro.hijos ?? ancestro.agrupador);
        confianza = refinado ? 'ALTA' : 'MEDIA';
        razon = refinado
          ? `Concepto de gasto reconocido dentro de "${nombreAncestro}".`
          : `Hereda de "${nombreAncestro}" (${ancestro.agrupador}). El nombre de ` +
            `una hoja dice QUIÉN es el tercero; el del padre dice QUÉ es la cuenta.`;
      } else if (propio && (!tCod || propio.tipo === tCod || compatibles(tCod, propio.tipo))) {
        /* Sin padre resuelto, el nombre propio es lo unico que hay. */
        agrupador = valido(propio.hijos ?? propio.agrupador);
        confianza = 'MEDIA';
        razon = `Sin cuenta padre reconocida; se uso su propio nombre "${f.nombre}".`;
      } else if (propio && tCod) {
        /* ── Hoja HUERFANA cuyo nombre contradice a su codigo ──
         * Con cuenta padre, que el nombre discrepe es lo NORMAL: dice quien es
         * el tercero, y un proveedor puede llamarse como un banco.
         *
         * Sin padre, el nombre es lo unico que hay — y si contradice al codigo,
         * uno de los dos esta mal. Eso ya no es ruido: es justo el caso que
         * nadie va a revisar si se entierra como "confianza baja". */
        confianza = 'CONFLICTO';
        razon =
          `El codigo dice ${tCod} (empieza con ${f.cuenta[0]}) y el nombre dice ` +
          `${propio.tipo}. No cuelga de ninguna cuenta reconocida, asi que no hay ` +
          `contexto que desempate: elegir por nuestra cuenta moveria el saldo de ` +
          `lado del balance.`;
      } else if (tCod) {
        confianza = 'BAJA';
        razon =
          `Sólo se sabe que es ${tCod}, por el primer dígito. Su cuenta padre no ` +
          `se reconoció, y el nombre de una hoja es el del tercero, no el de la cuenta.`;
      } else {
        confianza = 'NINGUNA';
        razon = 'No se pudo determinar ni el tipo de cuenta.';
      }
    } else {
      /* ── SUMARIA: manda su nombre, que sí es vocabulario contable ── */
      if (propio) {
        agrupador = valido(propio.agrupador);
        confianza = 'ALTA';
        razon = `El nombre "${f.nombre}" corresponde al agrupador ${agrupador}.`;
      } else if (ancestro) {
        agrupador = valido(ancestro.hijos ?? ancestro.agrupador);
        confianza = 'MEDIA';
        razon = `Hereda de "${nombreAncestro}" (${ancestro.agrupador}).`;
      } else if (tCod) {
        confianza = 'BAJA';
        razon =
          `Sólo se pudo determinar que es ${tCod}, por el primer dígito. Es una ` +
          `cuenta de agrupación; sus subcuentas pueden mapear igual.`;
      } else {
        confianza = 'NINGUNA';
        razon = 'No se pudo determinar ni el tipo de cuenta.';
      }
    }

    salida.push({
      cuenta: f.cuenta, nombre: f.nombre, naturaleza: f.naturaleza,
      hoja: !!f.hoja, padre: f.padre ?? null,
      tipoPorCodigo: tCod, tipoPorNombre: tNom,
      agrupador, confianza, razon,
    });
  }

  return salida;
}

/** Le pone nombre a cada agrupador propuesto, para poder revisarlo en pantalla. */
export async function conNombresDelSat(props: PropuestaCuenta[]): Promise<PropuestaCuenta[]> {
  const codigos = [...new Set(props.map((p) => p.agrupador).filter(Boolean))] as string[];
  if (!codigos.length) return props;
  const r = await query<any>(
    `SELECT codigo, nombre FROM sat_codigos_agrupadores WHERE codigo = ANY($1)`,
    [codigos],
  );
  const n = new Map(r.rows.map((x: any) => [x.codigo, x.nombre]));
  return props.map((p) => ({
    ...p, agrupadorNombre: p.agrupador ? n.get(p.agrupador) : undefined,
  }));
}

export async function agrupadoresValidos(): Promise<Set<string>> {
  const r = await query<any>(`SELECT codigo FROM sat_codigos_agrupadores`);
  return new Set(r.rows.map((x: any) => x.codigo));
}

/** El resumen que se lee antes de aceptar nada. */
export function resumenMapeo(props: PropuestaCuenta[]) {
  const por = (c: Confianza) => props.filter((p) => p.confianza === c);
  return {
    total: props.length,
    alta: por('ALTA').length,
    media: por('MEDIA').length,
    baja: por('BAJA').length,
    conflicto: por('CONFLICTO').length,
    ninguna: por('NINGUNA').length,
    /* Lo que hay que mirar a mano. */
    porRevisar: [...por('CONFLICTO'), ...por('NINGUNA'), ...por('BAJA')],
    mapeadas: props.filter((p) => p.agrupador).length,
  };
}

export default {
  proponerMapeo, conNombresDelSat, agrupadoresValidos, resumenMapeo,
  normalizar, CONVENCION_MX,
};
