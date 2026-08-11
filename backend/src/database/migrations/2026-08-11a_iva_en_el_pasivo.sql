-- ============================================================================
-- EL IVA DEL PASIVO — se calcula y se guarda desglosado
--
-- Hasta ahora la deuda con el proveedor guardaba un solo número: el total. Si
-- nadie lo capturaba, el sistema usaba el costo de la mercancía, que NO trae
-- impuestos — y se programaba un pago 16% más chico que el que el proveedor
-- iba a cobrar. La pantalla lo advertía, pero un aviso no es un cálculo.
--
-- Ahora se captura el subtotal, se elige la tasa y el total sale solo.
--
-- POR QUÉ SE GUARDAN LAS TRES CIFRAS Y NO SÓLO EL TOTAL
-- El total es lo que se transfiere, pero el IVA de las compras es acreditable:
-- llega el día en que haya que reportar cuánto se pagó de impuesto en el mes, y
-- reconstruirlo dividiendo totales entre 1.16 es adivinar — falla en cuanto una
-- factura viene al 8% de frontera o al 0% de alimentos y medicinas.
--
-- Nulos en lo viejo: las deudas ya registradas conservan su total y no se
-- inventa un desglose que nadie capturó.
-- ============================================================================

ALTER TABLE supplier_payments_schedule
  ADD COLUMN IF NOT EXISTS subtotal  NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS tax_rate  NUMERIC(5,2);

COMMENT ON COLUMN supplier_payments_schedule.subtotal IS
  'Importe de la factura antes de impuestos. NULL en las deudas anteriores a '
  'este desglose y en las capturadas como total directo.';

COMMENT ON COLUMN supplier_payments_schedule.tax_rate IS
  'Tasa de IVA aplicada: 16, 8 (región fronteriza) o 0 (tasa cero). '
  'amount = subtotal * (1 + tax_rate/100).';

/* La restricción va sobre las TRES tasas que existen en México y nada más.
 *
 * Dejar el campo libre invitaría a capturar 15 o 1.6 y a que el pago programado
 * saliera mal sin que nada lo detecte. Si algún día cambia la ley, se cambia
 * aquí y en TASAS_IVA del servicio — dos lugares, ambos explícitos. */
ALTER TABLE supplier_payments_schedule
  DROP CONSTRAINT IF EXISTS chk_supplier_payment_tasa_iva;
ALTER TABLE supplier_payments_schedule
  ADD CONSTRAINT chk_supplier_payment_tasa_iva
  CHECK (tax_rate IS NULL OR tax_rate IN (0, 8, 16));
