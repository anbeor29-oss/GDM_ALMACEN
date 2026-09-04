-- Cuentas que el usuario BORRÓ a mano en el catálogo.
--
-- Problema: al importar el resto del respaldo, el catálogo se re-inserta con
-- ON CONFLICT y las cuentas que el usuario había eliminado VOLVÍAN a aparecer.
-- Esta lápida (tombstone) las recuerda: el import salta cualquier código que
-- esté aquí. Si el usuario vuelve a crear ese código a propósito, se quita de
-- la lista (lo hace crearCuenta).

CREATE TABLE IF NOT EXISTS accounting_cuentas_excluidas (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  codigo     TEXT NOT NULL,
  motivo     TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, codigo)
);

COMMENT ON TABLE accounting_cuentas_excluidas IS
  'Cuentas borradas a mano: el import del respaldo NO las vuelve a crear.';
