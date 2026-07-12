-- ================================================================
-- SEGURIDAD — Fase 8 (§8): Capacidades finas por usuario
--
-- El sistema es role-based (SUPER_ADMIN/ADMIN/MANAGER/USER). Esta tabla
-- AÑADE capacidades específicas a un usuario por encima de su rol, sin
-- romper el modelo: ADMIN/MANAGER conservan acceso total operativo; un
-- USER (cajero, encargado de almacén, capturista) recibe SOLO las
-- capacidades que su ADMIN le otorgue.
-- ================================================================
-- Idempotente y autosuficiente en BD virgen (regla 26).

CREATE TABLE IF NOT EXISTS user_capabilities (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability   VARCHAR(40) NOT NULL,
  granted_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at   TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, capability)
);

CREATE INDEX IF NOT EXISTS idx_user_capabilities_user ON user_capabilities(user_id);

COMMENT ON TABLE user_capabilities IS
  'Capacidades finas (§8) otorgadas a un usuario por encima de su rol. Vacío = solo lo que da el rol.';
COMMENT ON COLUMN user_capabilities.capability IS
  'inventory:view/adjust · warehouse:transfer · purchasing:capture/approve · physical:count/authorize · pos:sell · treasury:pay · reports:view';
