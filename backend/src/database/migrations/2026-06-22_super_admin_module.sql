-- Módulo Super-Admin: gestión de usuarios, empresas, sellos y auditoría.
-- Idempotente: puede correrse N veces sin efectos secundarios.

-- 1) Habilita pgcrypto para cifrar los archivos .key de los CSD
--    (la clave privada del SAT NO debe quedar en claro nunca).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2) Rol SUPER_ADMIN — distinto del ADMIN regular (que es de la empresa).
--    SUPER_ADMIN es el operador de la plataforma SaaS.
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_role;
ALTER TABLE users ADD CONSTRAINT chk_users_role
  CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'USER'));

-- 3) password_change_required — forzar cambio en primer login (one-time pass)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_change_required BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP;

-- 4) Sellos del SAT (CSD) por empresa — almacenamiento cifrado
ALTER TABLE companies ADD COLUMN IF NOT EXISTS csd_no_certificado VARCHAR(40);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS csd_cer_path TEXT;            -- ruta a la copia local del .cer (público)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS csd_key_encrypted BYTEA;      -- .key cifrado con pgcrypto
ALTER TABLE companies ADD COLUMN IF NOT EXISTS csd_key_password_enc BYTEA;   -- password del .key, cifrado
ALTER TABLE companies ADD COLUMN IF NOT EXISTS csd_valid_from TIMESTAMP;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS csd_valid_to   TIMESTAMP;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS csd_uploaded_at TIMESTAMP;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS csd_uploaded_by_user_id UUID REFERENCES users(id);

-- 5) Auditoría — cada acción crítica del Super-Admin se persiste
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ts          TIMESTAMP NOT NULL DEFAULT NOW(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email  VARCHAR(255),
  role        VARCHAR(20),
  action      VARCHAR(64)  NOT NULL,                -- USER_CREATED, CSD_UPLOADED, USER_DISABLED, ...
  target_kind VARCHAR(32),                          -- 'user' | 'company' | 'csd' | ...
  target_id   UUID,
  ip          VARCHAR(64),
  user_agent  VARCHAR(255),
  payload     JSONB                                 -- diff/metadata, sin secretos
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ts            ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id       ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target_id     ON audit_log(target_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action        ON audit_log(action);

COMMENT ON TABLE  audit_log              IS 'Bitácora inmutable de acciones admin — retención 5 años (compliance SAT)';
COMMENT ON COLUMN audit_log.payload      IS 'Diff/metadata, JAMÁS contraseñas, .key o tokens';
COMMENT ON COLUMN companies.csd_key_encrypted IS 'Privada SAT cifrada con pgp_sym_encrypt — clave maestra en CSD_MASTER_KEY env';

-- 6) Idempotencia: si ya existe un SUPER_ADMIN no creamos otro
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE role = 'SUPER_ADMIN') THEN
    INSERT INTO users (email, first_name, last_name, password_hash, role, is_active, password_change_required)
    VALUES (
      'superadmin@plataforma.local',
      'Super', 'Admin',
      -- bcrypt de 'changeme123' — debe cambiarse en primer login
      '$2a$10$hc.hXLnTGhqWQc2bj1frMuXq4ncm7LabTZczXiWiiJjwHLnvC9RqK',
      'SUPER_ADMIN',
      true,
      true
    );
  END IF;
END $$;
