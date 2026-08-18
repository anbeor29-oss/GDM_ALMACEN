/**
 * fecha-de-nacimiento — sacarla del RFC o de la CURP.
 *
 * LOS DOS LA TRAEN, EN EL MISMO LUGAR
 * Tanto el RFC de persona física como la CURP llevan la fecha de nacimiento en
 * las posiciones 5 a 10, como AAMMDD:
 *
 *     C A D H 8 6 1 2 1 8 U X 9      RFC  → 86 12 18
 *     C A D H 8 6 1 2 1 8 H A S M Z C 0 5   CURP → 86 12 18
 *              └┬┘└┬┘└┬┘
 *              año mes día
 *
 * Es un dato que ya está capturado dos veces en el expediente y que además NO
 * CAMBIA: pedirlo a mano una tercera vez es invitar a que alguien teclee otra
 * cosa. Se deriva y se ofrece; si la persona lo corrige, su captura manda.
 *
 * EL SIGLO: DE DÓNDE SALE EL 19 O EL 20
 * Dos dígitos no dicen si es 1986 o 2086. La regla es el año en curso: un año
 * de dos dígitos que ya pasó pertenece a este siglo, uno que todavía no llega
 * pertenece al anterior. En 2026 eso significa 00-26 → 20xx y 27-99 → 19xx.
 *
 * Puesto al revés se ve mejor: alguien nacido en "08" tiene 18 años y está
 * trabajando; si se leyera 1908 tendría 118. Y alguien nacido en "86" tiene 40;
 * si se leyera 2086 no habría nacido. La regla acierta en los dos casos y se
 * mueve sola con el calendario, sin una fecha de corte escrita a mano que haya
 * que recordar cambiar.
 *
 * LA CURP MANDA SOBRE EL RFC
 * Los dos codifican lo mismo, pero el RFC de una persona con homonimia puede
 * haberse ajustado; la CURP la asigna RENAPO a partir del acta de nacimiento.
 * Cuando hay las dos y no coinciden, se avisa en vez de elegir en silencio.
 */

const RE_RFC_FISICA = /^[A-ZÑ&]{4}(\d{6})[A-Z0-9]{3}$/;
const RE_CURP = /^[A-Z]{4}(\d{6})[HM][A-Z]{5}[A-Z0-9][0-9]$/;

/** AAMMDD → AAAA-MM-DD, o null si esos seis dígitos no son una fecha. */
export function deSeisDigitos(aammdd: string, hoy = new Date()): string | null {
  if (!/^\d{6}$/.test(String(aammdd || ''))) return null;

  const aa = Number(aammdd.slice(0, 2));
  const mm = Number(aammdd.slice(2, 4));
  const dd = Number(aammdd.slice(4, 6));

  const dosDigitosDeHoy = hoy.getFullYear() % 100;
  const siglo = aa <= dosDigitosDeHoy ? 2000 : 1900;
  const anio = siglo + aa;

  const iso = `${anio}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

  /* Comprobación de ida y vuelta: JavaScript no rechaza el 31 de febrero, lo
   * desborda a marzo. Si la fecha reconstruida no es la que se armó, esos seis
   * dígitos no eran una fecha. */
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;

  return iso;
}

export function deRfc(rfc: string, hoy = new Date()): string | null {
  const m = RE_RFC_FISICA.exec(String(rfc || '').toUpperCase().trim());
  return m ? deSeisDigitos(m[1], hoy) : null;
}

export function deCurp(curp: string, hoy = new Date()): string | null {
  const m = RE_CURP.exec(String(curp || '').toUpperCase().trim());
  return m ? deSeisDigitos(m[1], hoy) : null;
}

export interface FechaDerivada {
  fecha: string | null;
  /** De dónde salió, para poder decirlo en pantalla. */
  de: 'curp' | 'rfc' | null;
  /** true cuando el RFC y la CURP no dicen lo mismo. */
  discrepan: boolean;
}

/**
 * La fecha de nacimiento a partir de lo que haya. La CURP tiene preferencia.
 */
export function derivar(
  ident: { rfc?: string | null; curp?: string | null },
  hoy = new Date()
): FechaDerivada {
  const porCurp = ident.curp ? deCurp(ident.curp, hoy) : null;
  const porRfc = ident.rfc ? deRfc(ident.rfc, hoy) : null;

  if (porCurp && porRfc && porCurp !== porRfc) {
    return { fecha: porCurp, de: 'curp', discrepan: true };
  }
  if (porCurp) return { fecha: porCurp, de: 'curp', discrepan: false };
  if (porRfc) return { fecha: porRfc, de: 'rfc', discrepan: false };
  return { fecha: null, de: null, discrepan: false };
}

/** Años cumplidos a una fecha dada. */
export function edad(nacimiento: string, hoy = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nacimiento || '')) return null;
  const n = new Date(`${nacimiento}T00:00:00Z`);
  if (Number.isNaN(n.getTime())) return null;
  let a = hoy.getUTCFullYear() - n.getUTCFullYear();
  const mes = hoy.getUTCMonth() - n.getUTCMonth();
  if (mes < 0 || (mes === 0 && hoy.getUTCDate() < n.getUTCDate())) a--;
  return a;
}

/**
 * Avisa cuando la edad derivada no cuadra con un trabajador.
 *
 * No bloquea: puede haber un RFC atípico. Pero una edad de 8 o de 105 años casi
 * siempre significa que el siglo salió mal o que el RFC viene con un dedazo, y
 * eso conviene verlo al importar y no cuando el IMSS rechace el aviso.
 */
export function avisoDeEdad(nacimiento: string | null, hoy = new Date()): string | null {
  if (!nacimiento) return null;
  const a = edad(nacimiento, hoy);
  if (a === null) return null;
  /* 15 años es la edad mínima para trabajar (Art. 22 LFT). */
  if (a < 15) {
    return `La fecha de nacimiento derivada (${nacimiento}) da ${a} años, por debajo de la ` +
           'edad mínima para trabajar. Revisa el RFC y la CURP.';
  }
  if (a > 100) {
    return `La fecha de nacimiento derivada (${nacimiento}) da ${a} años. Revisa el RFC y la CURP.`;
  }
  return null;
}
