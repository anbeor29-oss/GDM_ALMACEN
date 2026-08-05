-- ============================================================================
-- PRUEBA GRATIS DE 10 TIMBRES · EMPRESAS EXENTAS · COBRO PREPAGO PRORRATEADO
--
-- Tres cosas que van juntas porque describen un solo recorrido comercial:
-- el prospecto prueba con 10 timbres, se convence, contrata a mitad de mes y
-- paga la parte proporcional antes de que se le libere el servicio.
--
--   1) Paquete PKG_TRIAL — 10 timbres, UNA SOLA VEZ, sin costo.
--   2) `billing_exempt` — las empresas de la casa no entran al cierre mensual.
--   3) `plan_charges` — el cobro prepago con su prorrateo y su estado de pago.
-- ============================================================================

BEGIN;

-- ── 1) El paquete de prueba ────────────────────────────────────────────────
--
-- Va en el catálogo y no como una bandera aparte, para que todo lo que ya sabe
-- leer `stamp_packages` —el snapshot de facturación, el cierre mensual, la
-- pantalla del SUPER_ADMIN— lo entienda sin cambios.
--
-- `monthly_stamps = 0` A PROPÓSITO: los 10 timbres NO son una dotación
-- mensual. Si se pusieran aquí, el cierre de mes los repondría solo y la
-- prueba sería infinita. El saldo real vive en `companies.trial_stamps_left`,
-- que nadie repone.
INSERT INTO stamp_packages (code, name, monthly_stamps, monthly_fee_mxn, extra_stamp_mxn, is_active)
VALUES ('PKG_TRIAL', 'Prueba — 10 timbres sin costo', 0, 0.00, 0.00, TRUE)
ON CONFLICT (code) DO UPDATE
   SET name = EXCLUDED.name,
       monthly_stamps = EXCLUDED.monthly_stamps,
       monthly_fee_mxn = EXCLUDED.monthly_fee_mxn,
       extra_stamp_mxn = EXCLUDED.extra_stamp_mxn,
       is_active = TRUE;

ALTER TABLE companies
  /* Timbres de cortesía que le quedan. NULL = nunca estuvo en prueba; 0 = ya
   * los gastó. Se distinguen porque "nunca probó" y "ya se le acabaron" llevan
   * a acciones opuestas: a uno se le ofrece la prueba, al otro se le cobra. */
  ADD COLUMN IF NOT EXISTS trial_stamps_left INT,
  ADD COLUMN IF NOT EXISTS trial_started_at  TIMESTAMPTZ,
  /* Queda para siempre aunque después contrate: es lo que impide dar la
   * cortesía dos veces a la misma empresa cambiándole el paquete y volviendo. */
  ADD COLUMN IF NOT EXISTS trial_granted_at  TIMESTAMPTZ;

-- ── 2) Empresas exentas del cierre mensual ─────────────────────────────────
--
-- Las empresas de la casa usan el sistema pero no se cobran a sí mismas. Es
-- una BANDERA y no una lista de RFC en el código: el día que se dé de alta
-- otra empresa propia, se marca desde la pantalla y no hay que tocar el
-- código ni redesplegar.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS billing_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS billing_exempt_reason VARCHAR(200);

UPDATE companies
   SET billing_exempt = TRUE,
       billing_exempt_reason = COALESCE(billing_exempt_reason, 'Empresa propia de GRUPO HCGM')
 WHERE UPPER(rfc) IN ('GHC1707275Y0', 'SAJ10120859A');

-- ── 3) El cobro prepago ────────────────────────────────────────────────────
--
-- Es PREPAGO: primero se cobra, después se libera. Por eso el cargo tiene
-- estado propio y no basta con la fila del cierre mensual — entre que se
-- manda el aviso y entra el dinero hay días en los que el servicio sigue
-- detenido, y eso tiene que poder consultarse.
CREATE TABLE IF NOT EXISTS plan_charges (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  package_code  VARCHAR(16) NOT NULL REFERENCES stamp_packages(code),

  /* Mes que se está cobrando, siempre día 1. El periodo real puede empezar a
   * media mes; para eso están las dos fechas de abajo. */
  billing_period DATE NOT NULL,
  starts_on      DATE NOT NULL,
  ends_on        DATE NOT NULL,

  /* El prorrateo, guardado y no recalculado.
   *
   * Se conserva cómo se calculó —días cobrados sobre días del mes— porque el
   * cliente va a preguntar por qué pagó $206 y no $399, y la respuesta tiene
   * que salir del sistema, no de rehacer la cuenta a mano meses después. */
  days_charged   INT NOT NULL,
  days_in_month  INT NOT NULL,
  full_stamps    INT NOT NULL,
  full_price_mxn NUMERIC(10,2) NOT NULL,
  stamps_granted INT NOT NULL,
  amount_mxn     NUMERIC(10,2) NOT NULL,

  /* PENDING  → aviso mandado, servicio detenido
   * PAID     → pagado; los timbres ya se abonaron y el servicio corre
   * CANCELLED→ no se concretó */
  status        VARCHAR(12) NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING', 'PAID', 'CANCELLED')),

  notified_at   TIMESTAMPTZ,
  paid_at       TIMESTAMPTZ,
  payment_note  VARCHAR(300),
  /* CFDI que se le emitió a ESTE cliente al cobrarle. Se timbra AL PAGAR, no
   * al mandar el aviso: una factura emitida por un cobro que no entró queda
   * vigente ante el SAT y hay que cancelarla. */
  invoice_id    UUID REFERENCES invoices(id) ON DELETE SET NULL,

  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_charges_company ON plan_charges(company_id, billing_period DESC);
/* Los pendientes son la lista de trabajo diaria de quien cobra. */
CREATE INDEX IF NOT EXISTS idx_plan_charges_pendientes
  ON plan_charges(status, created_at) WHERE status = 'PENDING';

/* Un solo cargo vivo por empresa y mes. Sin esto, dos clics en "contratar"
 * generan dos avisos por el mismo periodo y el cliente recibe dos importes
 * distintos el mismo día. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_charges_uno_por_periodo
  ON plan_charges(company_id, billing_period)
  WHERE status IN ('PENDING', 'PAID');

COMMENT ON TABLE plan_charges IS
  'Cobro prepago de un paquete. El servicio se libera cuando status pasa a PAID.';
COMMENT ON COLUMN companies.trial_stamps_left IS
  'Timbres de cortesía restantes. NULL = nunca estuvo en prueba; 0 = agotados.';
COMMENT ON COLUMN companies.billing_exempt IS
  'No entra al cierre mensual. Para las empresas propias de GRUPO HCGM.';

COMMIT;
