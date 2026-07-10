-- ============================================================================
-- Guardar el logo en la BD (columna BYTEA) en lugar de filesystem.
--
-- Motivo: Render Backend Starter NO tiene disco persistente. Cualquier archivo
-- escrito en /opt/render/project/src/backend/uploads/ se pierde en cada deploy.
-- Guardar en BD es persistente sin costo extra y va incluido en los backups.
--
-- Compatibilidad: si `logo_path` sigue teniendo valor (dev local), el endpoint
-- puede leer de ahí. Prod usa `logo_data` directamente.
-- ============================================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_data     BYTEA;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_mimetype VARCHAR(50);

COMMENT ON COLUMN companies.logo_data      IS 'PNG/JPG del logo (max ~1MB). Persistente en Render.';
COMMENT ON COLUMN companies.logo_mimetype  IS 'MIME type del logo (image/png, image/jpeg, image/webp, image/svg+xml).';
