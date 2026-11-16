/**
 * Validación del CÓDIGO de una cuenta contable — compartida por el importador de
 * Contalink (rechaza basura al entrar) y por la limpieza del catálogo (detecta la
 * basura que YA entró).
 *
 * Un CÓDIGO válido es SÓLO numérico: dígitos y separadores «-»/«.», sin letras. Así
 * se rechazan los folios/fechas que Contalink a veces mete en la columna del código
 * (p. ej. «2026-05-C-44», «2026-05-D-7»): la «C»/«D» del tipo de póliza los delata.
 * El usuario NO maneja cuentas alfanuméricas.
 */
export function esCodigoCuentaValido(cod: string): boolean {
  const c = String(cod || '').trim();
  if (!/^\d[\d.\-]*\d$|^\d$/.test(c)) return false;   // sólo dígitos y - . ; empieza y termina en dígito
  if (/[a-zA-Z]/.test(c)) return false;               // nada de letras
  // Rechaza lo que parece una FECHA (AAAA-MM-DD / AAAA-MM): año 19xx/20xx + mes 01-12.
  if (/^(19|20)\d{2}[-.](0?[1-9]|1[0-2])([-.]\d{1,2})?$/.test(c)) return false;
  return true;
}
