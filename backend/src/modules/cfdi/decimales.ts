/**
 * Reglas de decimales del CFDI — una sola regla para toda la factura.
 *
 * EL PROBLEMA QUE RESUELVE
 * El Anexo 20 permite capturar el PRECIO UNITARIO con hasta 6 decimales, pero
 * los IMPORTES (importe del concepto, bases, impuestos, subtotal y total) van
 * con los decimales que soporta la MONEDA — 2 en pesos. Eso es justo lo que
 * deja cerrar un total "redondo": 400 × 32.219827 = 12,887.9308, que declarado
 * como 12,887.93 + 16% da exactamente 14,950.00.
 *
 * El SAT valida que Importe = Cantidad × ValorUnitario con una tolerancia de
 * UNA unidad en la última posición decimal declarada. Por eso el importe tiene
 * que ir a 2 decimales: a 6 decimales la tolerancia se encoge a 0.000001 y
 * cualquier arrastre del redondeo tumba el timbre.
 *
 * POR QUÉ UN MÓDULO APARTE
 * Pantalla, base de datos y XML tienen que redondear IGUAL. Si el servicio que
 * guarda la factura redondea de una forma y el que arma el XML de otra, el
 * importe guardado y el declarado se separan por un centavo y el PAC rechaza
 * —con un mensaje que no dice nada de esto—. Aquí vive la única regla.
 */

/**
 * Decimales que soporta la moneda (columna "Decimales" del catálogo c_Moneda).
 *
 * OJO: sólo se listan las monedas que el sistema factura hoy, todas de 2
 * decimales. Si algún día se factura en una moneda de 0 decimales (JPY, CLP)
 * hay que agregarla AQUÍ consultando c_Moneda del SAT, no adivinando: declarar
 * de más o de menos es rechazo del PAC.
 */
const DECIMALES_POR_MONEDA: Record<string, number> = {
  MXN: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
};

export function decimalesDeMoneda(moneda: string | null | undefined): number {
  const m = (moneda || 'MXN').toUpperCase().trim();
  const d = DECIMALES_POR_MONEDA[m];
  // Ante una moneda desconocida, 2: es lo que usa la inmensa mayoría de
  // c_Moneda y es el supuesto menos arriesgado mientras no se registre.
  return d === undefined ? 2 : d;
}

/**
 * Redondea a `dec` decimales, medio hacia arriba, limpiando el ruido binario.
 *
 * `Math.round(1.005 * 100) / 100` da 1.00, no 1.01: en binario 1.005 es
 * 1.00499999999999989. Escalamos primero y recortamos a 12 cifras
 * significativas (100.49999999999999 → 100.5) antes de redondear, que es
 * donde vive el ruido. Arriba de 1e12 no se toca: ahí recortar sí perdería
 * dígitos buenos, y un importe de ese tamaño no cabe en las columnas.
 */
export function redondea(n: number | string | null | undefined, dec = 2): number {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  const f = Math.pow(10, dec);
  const escalado = v * f;
  const limpio = Math.abs(escalado) < 1e12 ? Number(escalado.toPrecision(12)) : escalado;
  return Math.round(limpio) / f;
}

/** Texto con decimales fijos para el XML ("12887.93", "32.219827"). */
export function conDecimales(n: number | string | null | undefined, dec = 2): string {
  return redondea(n, dec).toFixed(dec);
}

/**
 * ¿`declarado` cae dentro de lo que el SAT tolera para `calculado`?
 *
 * La tolerancia es UNA unidad de la última posición decimal declarada: a 2
 * decimales, un centavo. Se compara con un margen mínimo extra (1e-9) para no
 * tropezar con el propio binario al restar.
 */
export function dentroDeTolerancia(calculado: number, declarado: number, dec = 2): boolean {
  const tolerancia = Math.pow(10, -dec);
  return Math.abs(calculado - declarado) <= tolerancia + 1e-9;
}
