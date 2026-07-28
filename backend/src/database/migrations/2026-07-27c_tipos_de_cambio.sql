-- ============================================================================
-- Migración: servicio central de tipos de cambio
-- Fecha: 2026-07-27
-- Base: TIPOS_CAMBIO_BANXICO.MD (HCGM Advisors v1.0)
-- ============================================================================
-- Monedas soportadas: MXN, USD, EUR, GBP.
--
-- Qué tipo de cambio se guarda
-- ----------------------------
-- El del DOF. El Art. 20 del CFF pide, para efectos fiscales, el tipo de
-- cambio que el DOF publicó el día hábil ANTERIOR a la operación — que es el
-- FIX que Banxico determinó ese día hábil anterior. Por eso cada renglón
-- guarda dos fechas:
--
--   fecha               → el día al que APLICA el tipo de cambio (el de la factura)
--   fecha_determinacion → el día hábil en que Banxico lo calculó
--
-- Un viernes se determina el FIX que aplica el lunes siguiente; con las dos
-- fechas guardadas, una auditoría puede rehacer el cálculo sin adivinar.
--
-- Lo facturado contra lo pagado
-- -----------------------------
-- Se factura por 1 000 USD un lunes a 17.50 → 17 500 pesos facturados.
-- Cobran 15 días después y el dólar está a 18.00 → entran 18 000 pesos.
-- Llegaron los mismos 1 000 USD, pero 500 pesos más. Esos 500 son utilidad
-- cambiaria y tienen que quedar registrados por separado, no diluidos.
--
-- Por eso el tipo de cambio se congela en DOS momentos distintos:
--   invoices.exchange_rate  → el del día que se timbró (no se toca nunca más)
--   payments.exchange_rate  → el del día que entró el dinero
-- y la diferencia se calcula contra esos dos, no contra el TC de hoy.
-- ============================================================================

BEGIN;

-- ─── 1. Histórico de tipos de cambio ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS exchange_rates (
  id                    BIGSERIAL PRIMARY KEY,
  fecha                 DATE           NOT NULL,
  moneda                VARCHAR(5)     NOT NULL,
  valor                 NUMERIC(18,6)  NOT NULL CHECK (valor > 0),
  fuente                VARCHAR(50)    NOT NULL,   -- BANXICO_DOF | BANXICO_FIX | ECB | MANUAL
  fecha_determinacion   DATE,
  hora_actualizacion    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  usuario_actualizacion VARCHAR(120),
  activo                BOOLEAN        NOT NULL DEFAULT TRUE,
  UNIQUE (fecha, moneda)
);
CREATE INDEX IF NOT EXISTS ix_exchange_rates_moneda_fecha
  ON exchange_rates(moneda, fecha DESC);

COMMENT ON COLUMN exchange_rates.fecha IS
  'Día al que APLICA el tipo de cambio (fecha de la factura)';
COMMENT ON COLUMN exchange_rates.fecha_determinacion IS
  'Día hábil en que Banxico determinó el FIX; el DOF lo publica para el día siguiente';

-- ─── 2. Fuentes configurables ──────────────────────────────────────────────
-- Las series de Banxico van en tabla y no en el código: si Banxico renumera
-- una serie, se corrige con un UPDATE y no con un deploy. La columna `nota`
-- deja escrito qué es cada una para quien la revise dentro de tres años.
CREATE TABLE IF NOT EXISTS exchange_rate_sources (
  moneda      VARCHAR(5) PRIMARY KEY,
  proveedor   VARCHAR(30)  NOT NULL,           -- BANXICO | ECB | MANUAL
  serie       VARCHAR(30),                     -- id de serie SIE de Banxico
  nota        TEXT,
  activo      BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO exchange_rate_sources (moneda, proveedor, serie, nota) VALUES
  ('USD', 'BANXICO', 'SF43718',
   'FIX — pesos por dólar EUA para solventar obligaciones en moneda extranjera. El DOF lo publica para el día hábil siguiente.'),
  ('EUR', 'BANXICO', 'SF46410',
   'Euro — pesos por euro. Verificar la serie contra el catálogo SIE de Banxico antes de confiar en el automático.'),
  ('GBP', 'BANXICO', 'SF46407',
   'Libra esterlina — pesos por libra. Si Banxico no la publica, el servicio cae a captura manual.')
ON CONFLICT (moneda) DO NOTHING;

-- MXN nunca se consulta: vale 1 por definición y así lo pide el SAT.

-- ─── 3. Bitácora de consultas ──────────────────────────────────────────────
-- El MD pide poder ver qué pasó cada día y consultar errores. Sin esto, un
-- tipo de cambio viejo pasa inadvertido hasta que el PAC rechaza.
CREATE TABLE IF NOT EXISTS exchange_rate_log (
  id          BIGSERIAL PRIMARY KEY,
  ejecutado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moneda      VARCHAR(5),
  resultado   VARCHAR(20) NOT NULL,   -- OK | SIN_DATO | ERROR | OMITIDO
  detalle     TEXT,
  valor       NUMERIC(18,6),
  origen      VARCHAR(20) NOT NULL DEFAULT 'CRON'  -- CRON | MANUAL | API
);
CREATE INDEX IF NOT EXISTS ix_exchange_rate_log_fecha
  ON exchange_rate_log(ejecutado_en DESC);

-- ─── 4. Congelar el equivalente en pesos de la factura ─────────────────────
-- invoices ya tenía currency y exchange_rate. Falta la fecha del TC usado y
-- el total en pesos ya calculado: recalcularlo después con el TC de hoy
-- daría un número distinto cada vez que se abre la factura.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exchange_rate_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_mxn    NUMERIC(15,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal_mxn NUMERIC(15,2);

COMMENT ON COLUMN invoices.total_mxn IS
  'Total convertido a pesos con el TC del día de emisión. Se congela al timbrar.';

-- Backfill de lo ya emitido: en MXN el TC es 1 y el total ya está en pesos.
UPDATE invoices
   SET total_mxn    = COALESCE(total_mxn, total),
       subtotal_mxn = COALESCE(subtotal_mxn, subtotal)
 WHERE COALESCE(currency, 'MXN') = 'MXN'
   AND total_mxn IS NULL;

-- Lo emitido en moneda extranjera que ya traía TC capturado.
UPDATE invoices
   SET total_mxn    = ROUND(total    * exchange_rate, 2),
       subtotal_mxn = ROUND(subtotal * exchange_rate, 2)
 WHERE COALESCE(currency, 'MXN') <> 'MXN'
   AND exchange_rate IS NOT NULL AND exchange_rate > 0
   AND total_mxn IS NULL;

-- ─── 5. Tipo de cambio del pago ────────────────────────────────────────────
-- Éste era el hueco: payments tenía currency pero no exchange_rate, así que
-- no había con qué comparar lo cobrado contra lo facturado.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS exchange_rate      NUMERIC(18,6);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS exchange_rate_date DATE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_amount_mxn NUMERIC(15,2);

COMMENT ON COLUMN payments.exchange_rate IS
  'TC del día en que entró el dinero. Distinto del de la factura: la diferencia es la utilidad o pérdida cambiaria.';

UPDATE payments
   SET exchange_rate      = COALESCE(exchange_rate, 1),
       payment_amount_mxn = COALESCE(payment_amount_mxn, payment_amount)
 WHERE COALESCE(currency, 'MXN') = 'MXN'
   AND exchange_rate IS NULL;

-- ─── 6. Diferencia cambiaria ───────────────────────────────────────────────
-- Un pago parcial no arrastra toda la factura: se compara SOLO la porción
-- cobrada, valuada a los dos tipos de cambio.
--
--   1 000 USD facturados a 17.50 → esa porción "vale" 17 500
--   1 000 USD cobrados   a 18.00 → entraron          18 000
--   diferencia = +500 (utilidad cambiaria)
CREATE OR REPLACE VIEW v_diferencia_cambiaria AS
SELECT
  p.id                        AS payment_id,
  p.company_id,
  p.invoice_id,
  i.serie,
  i.folio,
  c.business_name             AS cliente,
  i.currency                  AS moneda,
  i.exchange_rate             AS tc_factura,
  i.exchange_rate_date        AS fecha_tc_factura,
  p.exchange_rate             AS tc_pago,
  p.exchange_rate_date        AS fecha_tc_pago,
  p.payment_date,
  p.payment_amount            AS cobrado_moneda,
  ROUND(p.payment_amount * i.exchange_rate, 2) AS equivalente_al_facturar,
  ROUND(p.payment_amount * p.exchange_rate, 2) AS equivalente_al_cobrar,
  ROUND(p.payment_amount * (p.exchange_rate - i.exchange_rate), 2) AS diferencia_mxn,
  CASE
    WHEN p.exchange_rate > i.exchange_rate THEN 'UTILIDAD'
    WHEN p.exchange_rate < i.exchange_rate THEN 'PERDIDA'
    ELSE 'SIN_EFECTO'
  END                         AS efecto
FROM payments p
JOIN invoices  i ON i.id = p.invoice_id
LEFT JOIN customers c ON c.id = i.customer_id
WHERE p.deleted_at IS NULL
  AND COALESCE(i.currency, 'MXN') <> 'MXN'
  AND i.exchange_rate IS NOT NULL
  AND p.exchange_rate IS NOT NULL;

COMMIT;
