-- ═══════════════════════════════════════════════════════════════════════════
-- Tarjetas de crédito en tesorería
--
-- PARA QUÉ
-- Una tarjeta de crédito NO es una chequera: es un PASIVO. Su estado no cuadra
-- por «saldo inicial + depósitos − retiros» sino por «adeudo del periodo
-- anterior + cargos − pagos = adeudo actual», y se concilia contra la cuenta de
-- PASIVO de la tarjeta (no contra una 102 de banco). Reusamos las mismas tablas
-- (cuentas, estados, movimientos) porque la forma es la misma —un documento
-- cerrado con tres cifras que cuadran— pero el TIPO cambia el lado contable:
--   · CARGO  (compra/interés/comisión) sube el adeudo  → ABONO al pasivo
--   · ABONO  (pago/devolución)         baja el adeudo  → CARGO al pasivo
--
-- CÓMO SE GUARDA EL MOVIMIENTO (convención)
-- En bancos_movimientos, para una cuenta TARJETA_CREDITO:
--   · deposito = CARGO (compra) — lo que AUMENTA el adeudo
--   · retiro   = ABONO (pago)   — lo que DISMINUYE el adeudo
-- Así el arrastre existente (saldo += deposito − retiro) da el adeudo corriente
-- sin tocar el motor; sólo la conciliación invierte el lado al asentar.
-- ═══════════════════════════════════════════════════════════════════════════

/* Tipo de cuenta. Las que ya existen quedan como CHEQUES (el default), que es
 * lo que eran. */
ALTER TABLE bancos_cuentas
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'CHEQUES';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bancos_cuentas_tipo_ck'
  ) THEN
    ALTER TABLE bancos_cuentas
      ADD CONSTRAINT bancos_cuentas_tipo_ck
      CHECK (tipo IN ('CHEQUES', 'TARJETA_CREDITO'));
  END IF;
END $$;

/* Cuenta de gasto por defecto para los CARGOS de tarjeta que no traen CFDI
 * (suscripciones, cargos chicos). Se puede sobreescribir por movimiento. */
ALTER TABLE bancos_cuentas
  ADD COLUMN IF NOT EXISTS cuenta_gastos_id UUID REFERENCES accounting_accounts(id) ON DELETE SET NULL;

/* Cuenta del GASTO FINANCIERO por intereses de tarjeta (los intereses no son una
 * comisión: van a su propia cuenta). El IVA de intereses/comisiones reutiliza la
 * cuenta de IVA de comisiones que ya se configura para bancos. */
ALTER TABLE bancos_config
  ADD COLUMN IF NOT EXISTS cuenta_intereses_id UUID REFERENCES accounting_accounts(id) ON DELETE SET NULL;
