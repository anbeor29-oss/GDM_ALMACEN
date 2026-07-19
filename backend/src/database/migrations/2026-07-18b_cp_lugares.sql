-- ============================================================================
-- Migración: catálogo de Lugares frecuentes por empresa para Carta Porte 3.1
--
-- Motivación: cada CP requiere capturar 15+ campos por Origen/Destino. Las
-- rutas son repetitivas (mismo almacén de salida, mismos clientes recurrentes)
-- y sin catálogo el usuario re-escribe todo cada vez. Esta tabla almacena
-- plantillas reutilizables por empresa.
--
-- NO guarda IDUbicacion (OR000001/DE000001): ese es específico de cada CP
-- y se genera al agregar al form.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS cp_lugares (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alias               VARCHAR(60) NOT NULL,
  tipo_default        VARCHAR(10),        -- 'Origen' | 'Destino' | NULL (ambos)
  rfc                 VARCHAR(13) NOT NULL,
  nombre              VARCHAR(300),
  num_reg_id_trib     VARCHAR(40),
  residencia_fiscal   VARCHAR(3),
  calle               VARCHAR(200),
  num_exterior        VARCHAR(60),
  num_interior        VARCHAR(60),
  colonia             VARCHAR(120),
  localidad           VARCHAR(120),
  referencia          VARCHAR(500),
  municipio           VARCHAR(120),
  estado              VARCHAR(3) NOT NULL,
  pais                VARCHAR(3) NOT NULL DEFAULT 'MEX',
  codigo_postal       VARCHAR(10) NOT NULL,
  activo              BOOLEAN NOT NULL DEFAULT true,
  usos                INTEGER NOT NULL DEFAULT 0,  -- contador (info: los más usados)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, alias)
);

CREATE INDEX IF NOT EXISTS ix_cp_lugares_company_activo
  ON cp_lugares(company_id, activo);
CREATE INDEX IF NOT EXISTS ix_cp_lugares_rfc
  ON cp_lugares(company_id, rfc);

COMMIT;
