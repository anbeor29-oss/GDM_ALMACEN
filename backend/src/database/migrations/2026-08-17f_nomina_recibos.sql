-- ============================================================================
-- NÓMINA — LOS RECIBOS DEL PERIODO CERRADO
--
-- QUÉ SE GUARDA AQUÍ Y POR QUÉ NO ANTES
-- La prenómina se calcula al vuelo veinte veces mientras se ajustan días y
-- conceptos. Nada de eso se escribe: si escribiera, una corrida interrumpida
-- dejaría medio periodo pagado y medio no. Al CERRAR, en cambio, el resultado
-- deja de ser una vista previa y pasa a ser lo que se le va a pagar a la gente —
-- y eso sí tiene que quedar congelado.
--
-- CONGELADO ES CONGELADO
-- El recibo guarda sus importes y su desglose completo, no una referencia al
-- expediente. Si mañana al trabajador le suben el sueldo, el recibo de la semana
-- pasada tiene que seguir diciendo lo que dijo: recalcularlo con los datos de
-- hoy daría otro número y dejaría sin explicación lo que ya se pagó.
--
-- POR ESO EL DESGLOSE VA EN JSON
-- Percepciones y deducciones se guardan tal cual las devolvió el motor. Podrían
-- ir en tablas hijas, pero no se van a consultar por concepto ni a agregar entre
-- recibos: se leen enteras para armar el CFDI y el recibo impreso. Una tabla
-- hija sería tres joins para reconstruir algo que siempre se lee completo.
--
-- EL XML NACE SIN TIMBRAR
-- Se genera al cerrar y espera en la pantalla de CFDI. Timbrar es un paso
-- aparte, deliberado: es lo que cuesta timbres y lo que ya no se puede deshacer
-- sin una cancelación ante el SAT.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nomina_recibos (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  periodo_id   UUID NOT NULL REFERENCES nomina_periodos(id) ON DELETE CASCADE,
  empleado_id  UUID NOT NULL REFERENCES nomina_empleados(id) ON DELETE RESTRICT,

  /* El nombre y el RFC se CONGELAN en el renglón: si el trabajador corrige su
   * RFC el mes que entra, el recibo timbrado sigue siendo el que se timbró. */
  num_empleado VARCHAR(15) NOT NULL,
  nombre       VARCHAR(300) NOT NULL,
  rfc          VARCHAR(13)  NOT NULL,
  curp         CHAR(18),
  nss          VARCHAR(11),

  dias                INTEGER       NOT NULL,
  total_percepciones  NUMERIC(12,2) NOT NULL,
  total_deducciones   NUMERIC(12,2) NOT NULL,
  total_otros_pagos   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_gravado       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_exento        NUMERIC(12,2) NOT NULL DEFAULT 0,
  isr                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  imss                NUMERIC(12,2) NOT NULL DEFAULT 0,
  neto                NUMERIC(12,2) NOT NULL,

  /* El desglose tal como lo devolvió el motor. */
  percepciones JSONB NOT NULL DEFAULT '[]',
  deducciones  JSONB NOT NULL DEFAULT '[]',

  /* PENDIENTE  generado, esperando revisión
   * TIMBRADO   ya pasó por el PAC
   * CANCELADO  cancelado ante el SAT */
  estatus      VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',
  xml_pretimbre TEXT,
  xml_timbrado  TEXT,
  uuid          VARCHAR(36),
  timbrado_at   TIMESTAMP,

  /* Si se le manda por correo y si ya se mandó. Son dos cosas distintas: la
   * primera es una decisión, la segunda un hecho. */
  enviar_por_correo BOOLEAN NOT NULL DEFAULT false,
  enviado_at   TIMESTAMP,
  correo       VARCHAR(255),

  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT nomina_recibos_estatus_ck
    CHECK (estatus IN ('PENDIENTE','TIMBRADO','CANCELADO')),
  CONSTRAINT nomina_recibos_montos_ck
    CHECK (total_percepciones >= 0 AND total_deducciones >= 0),
  CONSTRAINT nomina_recibos_dias_ck CHECK (dias > 0)
);

/* Un trabajador, un recibo por periodo. Dos recibos del mismo periodo serían
 * dos CFDI por el mismo pago, y el SAT los vería como ingreso duplicado. */
CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_recibos
  ON nomina_recibos (periodo_id, empleado_id);

CREATE INDEX IF NOT EXISTS ix_nomina_recibos_pendientes
  ON nomina_recibos (company_id, estatus, created_at DESC);

COMMENT ON TABLE nomina_recibos IS
  'Los recibos de un periodo CERRADO. Importes congelados: recalcularlos con '
  'los datos de hoy daría otro número y dejaría sin explicación lo ya pagado.';
