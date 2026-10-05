-- ============================================================================
-- Respaldo del ZIP de DECLARACIONES por empresa y ejercicio.
--
-- Antes, cada vez que se abría la cuadrícula de declaraciones se volvía a bajar
-- el año de SatGo (consume cuota) y, al recargar la página, se perdía todo. Ahora
-- el ZIP del año se GUARDA una vez: se conserva comprimido (ocupa poco) y la
-- cuadrícula se arma leyendo de aquí, SIN volver a llamar a SatGo. Sólo se vuelve
-- a bajar —y se SUSTITUYE el ZIP— cuando el usuario da clic en un año concreto.
-- ============================================================================

CREATE TABLE IF NOT EXISTS satgo_declaraciones_zip (
  company_id     UUID     NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ejercicio      SMALLINT NOT NULL,
  rfc            VARCHAR(13) NOT NULL,
  zip            BYTEA    NOT NULL,          -- el paquete comprimido tal cual lo dio SatGo
  bytes          INTEGER  NOT NULL DEFAULT 0,
  descargado_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, ejercicio)
);
