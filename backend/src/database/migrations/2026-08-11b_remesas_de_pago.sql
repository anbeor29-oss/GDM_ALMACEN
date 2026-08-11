-- ============================================================================
-- REMESAS DE PAGO — la lista que se arma el viernes y se paga el lunes
--
-- Tesorería ya sabía QUÉ se debe y CUÁNDO vence. Lo que faltaba es la decisión
-- intermedia: de todo lo que se debe, esto es lo que se paga el lunes. Esa
-- decisión se toma el viernes, se autoriza, se imprime y se ejecuta — y hasta
-- hoy vivía en una hoja de cálculo aparte, o en la cabeza de quien paga.
--
-- POR QUÉ NO BASTABA CON MOVER LA FECHA DE VENCIMIENTO
-- `due_date` es cuándo se vence la factura: un dato del proveedor, pactado con
-- sus días de crédito. La fecha en que decidimos pagarla es NUESTRA y suele ser
-- distinta — una factura que vence el miércoles se paga en la corrida del lunes
-- porque es cuando se firman transferencias. Meter las dos en la misma columna
-- borraría el vencimiento real y con él la posibilidad de saber qué se pagó
-- tarde.
--
-- POR QUÉ UNA TABLA Y NO UNA ETIQUETA CON LA FECHA
-- La remesa es un documento: tiene folio, se autoriza, se imprime, se paga
-- completa y alguien responde por ella. Un simple campo "fecha de pago" en cada
-- renglón no puede llevar quién la autorizó ni impedir que se le agreguen
-- facturas después de firmada.
-- ============================================================================

CREATE TABLE IF NOT EXISTS payment_runs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  folio            INT  NOT NULL,
  payment_date     DATE NOT NULL,              -- el lunes en que se transfiere
  status           VARCHAR(12) NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT',      -- se está armando (viernes)
                                     'AUTHORIZED', -- firmada, ya no se toca
                                     'PAID',       -- transferida
                                     'CANCELLED')),
  notes            TEXT,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_email VARCHAR(255),
  authorized_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  authorized_at    TIMESTAMP,
  paid_at          TIMESTAMP,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (company_id, folio)
);

CREATE INDEX IF NOT EXISTS idx_payment_runs_fecha
  ON payment_runs (company_id, payment_date DESC);

COMMENT ON TABLE payment_runs IS
  'Corrida de pagos: el grupo de facturas que se transfiere en una fecha. '
  'Se arma un día y se ejecuta otro.';

-- ----------------------------------------------------------------------------
-- El renglón de deuda apunta a la remesa en la que se va a pagar.
--
-- ON DELETE SET NULL: si una remesa se borra, las facturas NO desaparecen —
-- vuelven a quedar disponibles para la siguiente corrida. Perder la deuda
-- porque se canceló la lista sería el peor error posible en este módulo.
-- ----------------------------------------------------------------------------
ALTER TABLE supplier_payments_schedule
  ADD COLUMN IF NOT EXISTS payment_run_id UUID REFERENCES payment_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_payments_remesa
  ON supplier_payments_schedule (payment_run_id)
  WHERE payment_run_id IS NOT NULL;

COMMENT ON COLUMN supplier_payments_schedule.payment_run_id IS
  'Remesa en la que se va a pagar esta factura. NULL = todavía no se programa. '
  'Una factura sólo puede estar en una remesa a la vez.';
