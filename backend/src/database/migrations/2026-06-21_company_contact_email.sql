-- ============================================================================
-- Agrega email de contacto a la empresa emisora (para envío de facturas
-- por correo desde el sistema al cliente).
-- ============================================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);

COMMENT ON COLUMN companies.contact_email IS
  'Correo del emisor — se usa como "From" al enviar facturas por email al cliente. Si es NULL, usa MAIL_FROM del env.';
