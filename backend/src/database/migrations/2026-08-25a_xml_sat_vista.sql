-- ============================================================================
-- VISTA DE XML DEL SAT — emitidos y recibidos como los mira contabilidad
--
-- Nace de rediseñar la pantalla en dos submenús (Emitidos / Recibidos) con las
-- columnas del Anexo 20: fecha, folio, cliente/proveedor, RFC, total, estatus y
-- CUENTA CONTABLE. Tres cosas que la tabla `cfdi_recibidos` no tenía y hacen
-- falta para esa vista:
--
--  1) `cuenta_contable` — la columna "CC" del renglón. A qué cuenta del catálogo
--     se asienta esa factura. Se llena a mano (o por regla, más adelante); aquí
--     sólo se guarda.
--
--  2) `fecha_cancelacion` — cuándo se canceló. El metadato del SAT la trae
--     (última columna del CSV); el XML del comprobante NO, porque la cancelación
--     es un hecho posterior a su emisión. Sirve para la pantalla de "mostrar la
--     cancelación" del estatus.
--
--  3) `cfdi_pago_relacion` — qué complemento de pago (tipo P) liquida qué
--     factura. Es lo que decide el icono de "pagado": una PPD cuenta como pagada
--     cuando existe su timbre de pago que la referencia (DoctoRelacionado). Sin
--     este mapa habría que abrir el XML de cada P en cada consulta.
-- ============================================================================

ALTER TABLE cfdi_recibidos
  ADD COLUMN IF NOT EXISTS cuenta_contable    VARCHAR(40),
  ADD COLUMN IF NOT EXISTS fecha_cancelacion  TIMESTAMP;

COMMENT ON COLUMN cfdi_recibidos.cuenta_contable IS
  'Columna CC de la vista de XML del SAT: cuenta del catálogo a la que se asienta.';

-- ─── El mapa pago → factura (para el icono de "pagado") ─────────────────────
CREATE TABLE IF NOT EXISTS cfdi_pago_relacion (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rfc_propietario   VARCHAR(13) NOT NULL,

  -- El complemento de pago (tipo P) y la factura (tipo I) que liquida.
  pago_uuid         VARCHAR(40) NOT NULL,
  factura_uuid      VARCHAR(40) NOT NULL,

  -- Lo que el DoctoRelacionado dice de ese pago, por si luego se cuadra importe.
  parcialidad       INT,
  imp_pagado        NUMERIC(18,2),
  moneda            VARCHAR(3),

  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Un pago puede liquidar varias facturas y una factura recibir varios pagos;
  -- lo único que no se repite es el par exacto.
  UNIQUE (company_id, rfc_propietario, pago_uuid, factura_uuid)
);

CREATE INDEX IF NOT EXISTS ix_cfdi_pago_relacion_factura
  ON cfdi_pago_relacion (company_id, rfc_propietario, factura_uuid);

COMMENT ON TABLE cfdi_pago_relacion IS
  'DoctoRelacionado de los complementos de pago (tipo P): qué timbre de pago '
  'liquida qué factura. Decide el estatus "pagado" de las PPD.';
