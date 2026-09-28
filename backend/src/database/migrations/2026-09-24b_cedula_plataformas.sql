-- ============================================================================
-- CÉDULA PLATAFORMAS DIGITALES (625) — captura de ingresos por ACTIVIDAD y mes
--
-- El ISR/IVA de plataformas se calcula por ACTIVIDAD, cada una con su tasa de
-- retención (Art. 113-A LISR): transporte de pasajeros/entrega 2.1 %, hospedaje
-- 4 %, enajenación de bienes y prestación de servicios 1 %. La plataforma retiene
-- esos montos y también el 50 % del IVA (8 % de 16 %).
--
-- La clasificación por actividad NO se infiere de un CFDI normal: sale de los CFDI
-- de RETENCIÓN de la plataforma (que hoy NO se ingestan como tipo I) o se CAPTURA
-- a mano. Esta tabla guarda el ingreso cobrado por actividad y mes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cedula_plataformas (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  anio        INTEGER NOT NULL,
  mes         INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  -- PASAJE_ENTREGA | HOSPEDAJE | ENAJENACION
  actividad   VARCHAR(16) NOT NULL CHECK (actividad IN ('PASAJE_ENTREGA','HOSPEDAJE','ENAJENACION')),
  ingreso     NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, anio, mes, actividad)
);
