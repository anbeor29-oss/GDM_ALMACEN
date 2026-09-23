-- ============================================================================
-- USUARIOS — MÓDULOS EXTRA por usuario (una persona con varias funciones)
--
-- El `work_group` define UN conjunto de módulos. Pero hay empresas donde una
-- misma persona hace varias funciones principales (p.ej. Ventas + Nómina). Este
-- arreglo guarda módulos ADICIONALES que se UNEN a los del grupo. Es ADITIVO:
-- sólo agrega acceso, nunca lo quita.
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS extra_modules TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN users.extra_modules IS
  'Módulos EXTRA (además de los del work_group) que puede ver este usuario. Aditivo.';
