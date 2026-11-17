/**
 * razon-social.util.ts — normaliza nombres de clientes/proveedores para COMPARARLOS.
 *
 * `normBasico`  → MAYÚSCULAS, sin acentos, sin puntuación, espacios colapsados.
 * `normRazon`   → además quita la FORMA LEGAL al FINAL (SA de CV, S de RL de CV,
 *                 SAPI de CV, SC, SAS, AC…). Sólo al final → nunca toca un «DE»/«CV»
 *                 en medio del nombre real. Así «DISTRIBUIDORA DE LUBRICANTES SA DE CV»
 *                 y «DISTRIBUIDORA DE LUBRICANTES» caen al MISMO texto.
 *
 * Se usa para (1) detectar cuentas de un mismo tercero escritas con/ sin forma legal
 * y fusionarlas, y (2) sugerir la cuenta del tercero por nombre en Ventas/Compras.
 * El mismo criterio está replicado en el front (`normRazon` en DocsContabilizar.tsx).
 */
export function normBasico(nombre?: string | null): string {
  const s = String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return s.replace(/[.,]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

const FORMA_LEGAL = /\s+(SOCIEDAD ANONIMA|SA DE CV|S DE RL DE CV|SAPI DE CV|SAPI|SAS|SA|S DE RL|SRL|SC|SCL|AC|DE CV|CV)$/;

export function normRazon(nombre?: string | null): string {
  let s = normBasico(nombre);
  let prev = '';
  // Puede venir en bloques («SA DE CV» = «DE CV» + «SA»); se quita en bucle, con
  // guarda de longitud para no dejar el nombre vacío.
  while (s !== prev && s.length > 2) { prev = s; s = s.replace(FORMA_LEGAL, '').trim(); }
  return s;
}

/** true si el nombre NO trae forma legal (el «limpio», que se prefiere como canónico). */
export function sinFormaLegal(nombre?: string | null): boolean {
  return normBasico(nombre) === normRazon(nombre);
}
