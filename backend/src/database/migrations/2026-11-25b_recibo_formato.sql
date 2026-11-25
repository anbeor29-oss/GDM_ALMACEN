-- =====================================================================
-- Segundo formato del recibo de nómina, elegible por empresa
-- =====================================================================
-- 'clasico'   = el de siempre (percepciones y deducciones corridas).
-- 'detallado' = dos tablas lado a lado con el agrupador del SAT, caja de
--               totales con el NETO destacado, firma del trabajador y
--               recuadro de certificación junto al QR.
--
-- Por omisión 'clasico': ninguna empresa cambia de formato por desplegar.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS recibo_formato VARCHAR(16) NOT NULL DEFAULT 'clasico';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'companies' AND constraint_name = 'companies_recibo_formato_check'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_recibo_formato_check
        CHECK (recibo_formato IN ('clasico','detallado'));
  END IF;
END $$;
