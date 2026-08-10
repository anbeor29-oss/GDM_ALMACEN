-- ============================================================================
-- GRUPO DE TRABAJO "PUNTO_VENTA" — el cajero de mostrador
--
-- POR QUÉ NO ALCANZA CON EL GRUPO VENTAS
-- VENTAS ya existía, pero alcanza facturas, notas de crédito, clientes, Carta
-- Porte y el lector de XML. Para quien únicamente cobra en mostrador es
-- demasiado: un cajero con acceso a la facturación puede timbrar por error, y
-- en un turno con varias personas nadie sabría quién fue.
--
-- PUNTO_VENTA ve el Dashboard y la caja. Nada más.
--
-- POR QUÉ HACE FALTA UNA MIGRACIÓN
-- `users.work_group` y `user_companies.work_group` tienen un CHECK que enumera
-- los grupos válidos. Agregar la opción sólo en el frontend dejaría que la
-- pantalla la ofreciera y que la base la rechazara al guardar: el ADMIN vería
-- un error de restricción sin relación aparente con lo que estaba haciendo.
--
-- La restricción se REEMPLAZA en lugar de quitarse. Sin ella, un typo en el
-- código guardaría 'PUNTO_VENTAS' o 'POS' y ese usuario se quedaría sin ver
-- absolutamente nada, porque ningún grupo desconocido tiene módulos asignados.
-- ============================================================================

DO $$
DECLARE
  grupos CONSTANT text[] := ARRAY['ADMIN_ALL','VENTAS','ALMACEN','COMPRAS','TESORERIA','PUNTO_VENTA'];
  t record;
  c record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES ('users'), ('user_companies')) AS v(tabla)
  LOOP
    /* `user_companies` es de la migración multi-empresa y puede no existir en
     * una base que todavía no la corrió. Se comprueba antes de tocarla. */
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name = t.tabla AND column_name = 'work_group'
    ) THEN
      /* Se quitan TODAS las restricciones que mencionen work_group, en vez de
       * adivinar su nombre.
       *
       * La original se llama `chk_user_work_group` —en singular— y un DROP
       * escrito como `chk_users_work_group` no la encuentra: la migración
       * "corre bien", agrega la nueva restricción y deja la vieja en pie
       * rechazando el grupo nuevo. Pasó al probar esto, y el síntoma habría
       * sido un error de restricción al dar de alta un cajero, sin relación
       * aparente con la migración. */
      FOR c IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = t.tabla::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%work_group%'
      LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t.tabla, c.conname);
      END LOOP;
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT chk_%s_work_group CHECK (work_group IS NULL OR work_group = ANY(%L))',
        t.tabla, t.tabla, grupos
      );
      RAISE NOTICE 'work_group de % admite ahora PUNTO_VENTA', t.tabla;
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN users.work_group IS
  'Grupo de trabajo: ADMIN_ALL, VENTAS, ALMACEN, COMPRAS, TESORERIA o '
  'PUNTO_VENTA (cajero de mostrador, sólo el POS).';
