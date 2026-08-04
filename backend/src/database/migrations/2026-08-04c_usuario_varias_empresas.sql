-- ============================================================================
-- UN USUARIO PUEDE PERTENECER A VARIAS EMPRESAS
--
-- POR QUÉ
-- `users.company_id` es una columna, así que un correo pertenecía a UNA empresa
-- y punto. Quien administraba dos RFC necesitaba dos accesos con correos
-- distintos, y cambiar de empresa significaba cerrar sesión y volver a entrar
-- con la otra cuenta.
--
-- Esta tabla asocia usuarios con empresas. La empresa activa deja de ser un
-- atributo del usuario para volverse una ELECCIÓN de la sesión.
--
-- EL GRUPO DE TRABAJO VIVE AQUÍ, NO EN users
-- Y no es un detalle: la misma persona puede ser de Ventas en una empresa y de
-- Tesorería en otra. Si el grupo siguiera en `users`, asignarle una segunda
-- empresa le daría en ella permisos que no le corresponden — y nadie se daría
-- cuenta hasta que hiciera algo que no debía.
--
-- `users.company_id` NO SE BORRA
-- Se conserva como empresa por omisión: la que se elige sola cuando el usuario
-- tiene una sola, y la que usan los tokens ya emitidos hasta que caduquen.
-- Quitarla obligaría a cambiar de golpe la autenticación, que es el peor lugar
-- para un cambio grande — un error ahí deja a todos fuera, o deja entrar a quien
-- no debe.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_companies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  /* Permisos DE ESA PERSONA EN ESA EMPRESA. NULL = hereda users.work_group,
   * para no obligar a llenarlo al migrar. */
  work_group  VARCHAR(20),

  /* La que se abre al entrar cuando hay varias. Sólo una por usuario; el índice
   * de abajo lo garantiza. */
  is_default  BOOLEAN NOT NULL DEFAULT false,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_user_companies_user    ON user_companies(user_id);
CREATE INDEX IF NOT EXISTS idx_user_companies_company ON user_companies(company_id);

/* Una sola empresa por omisión por usuario. Es un índice parcial y no un CHECK
 * porque la regla es "a lo más una fila con true", que sólo se puede expresar
 * así en Postgres. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_companies_una_default
  ON user_companies(user_id) WHERE is_default;

COMMENT ON TABLE user_companies IS
  'Empresas a las que tiene acceso un usuario. La empresa activa es una elección '
  'de la sesión, no un atributo del usuario.';
COMMENT ON COLUMN user_companies.work_group IS
  'Grupo de trabajo EN ESA EMPRESA. La misma persona puede ser de Ventas en una '
  'y de Tesorería en otra. NULL hereda users.work_group.';

-- ── Migración de lo que ya existe ────────────────────────────────────────────
-- Cada usuario con empresa asignada obtiene su fila, marcada como la de
-- omisión. Nadie pierde acceso ni cambia de comportamiento: con una sola
-- empresa asociada, la pantalla de selección se salta sola.
INSERT INTO user_companies (user_id, company_id, work_group, is_default)
SELECT u.id, u.company_id, u.work_group, true
  FROM users u
 WHERE u.company_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM user_companies uc
      WHERE uc.user_id = u.id AND uc.company_id = u.company_id
   );
