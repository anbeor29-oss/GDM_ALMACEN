-- ============================================================================
-- Permitir pólizas de origen 'CONTPAQI' (migración de respaldos de CONTPAQi).
-- El journal ya distingue el origen; sólo faltaba admitir este. Idempotente:
-- se localiza el CHECK de `origen` por su definición y se reemplaza.
-- ============================================================================
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'journal_entries'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%origen%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE journal_entries DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE journal_entries
    ADD CONSTRAINT journal_entries_origen_check
    CHECK (origen IN ('MANUAL','CFDI','NOMINA','DEPRECIACION','APERTURA','BANCO','CONTPAQI'));
END $$;
