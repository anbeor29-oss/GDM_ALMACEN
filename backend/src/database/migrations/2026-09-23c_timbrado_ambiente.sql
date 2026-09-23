-- ============================================================================
-- TIMBRADO — AMBIENTE POR EMPRESA (pruebas vs producción/en vivo)
--
-- Antes el ambiente del PAC (SW Sapien) era una variable GLOBAL del despliegue
-- (SW_SAPIEN_ENV). Ahora cada empresa elige su ambiente: PRUEBAS (sandbox, por
-- defecto) o PRODUCCION (timbrado REAL ante el SAT). El motor rutea la URL y el
-- token según el ambiente de la empresa que emite. Así el mismo despliegue tiene
-- unas empresas en vivo y otras en pruebas (p. ej. un cliente nuevo hasta que
-- carga su CSD real).
--
-- POR DEFECTO PRUEBAS: nadie emite CFDI real hasta que el Súper Admin lo active
-- a propósito (y con el CSD real cargado en el vault de producción del PAC).
-- ============================================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS timbrado_ambiente VARCHAR(12) NOT NULL DEFAULT 'PRUEBAS';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_name = 'companies' AND constraint_name = 'companies_timbrado_ambiente_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_timbrado_ambiente_check
        CHECK (timbrado_ambiente IN ('PRUEBAS','PRODUCCION'));
  END IF;
END $$;
