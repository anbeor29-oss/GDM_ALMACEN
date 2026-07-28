-- ============================================================================
-- Fusión ERP — reconciliar las DOS implementaciones de Punto de Venta
-- Fecha: 2026-07-28
-- ============================================================================
-- GDM_FAC y GDM Almacén nacieron del mismo código el 1 de julio y cada uno
-- construyó su propio POS sobre el mismo nombre de tabla. Al unirlos chocan:
--
--   Almacén  (2026-07-10_zz_pos_sales.sql)
--     warehouse_id, sold_at, global_invoice_id, user_id/user_email,
--     status OPEN | INVOICED_INDIVIDUAL | IN_GLOBAL | CANCELLED
--     → sabe de inventario y de la factura global del día
--
--   Facturación (2026-07-11_pos_and_groups.sql)
--     customer_name, amount_tendered, change_given, card_ref, sold_by,
--     created_at, status COMPLETED
--     → sabe de caja: cuánto pagó el cliente y cuánto se le devolvió
--
-- Gana el de Almacén como base, porque el sentido de la fusión es que la
-- venta descuente existencias y entre a la factura global; eso no se puede
-- reconstruir después. Se le suman las columnas de caja, que sí son un
-- agregado limpio.
--
-- Se comprobó que pos_sales y pos_sale_items están VACÍAS en las dos bases
-- (local y producción) antes de escribir esto. Por eso la tabla con la forma
-- vieja se puede reemplazar sin migrar datos ni perder nada. Si en el futuro
-- alguien corre esto sobre una base CON ventas, la migración se detiene sola
-- en lugar de borrarlas.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  tiene_sold_at    BOOLEAN;
  tiene_warehouse  BOOLEAN;
  ventas           BIGINT;
BEGIN
  IF to_regclass('pos_sales') IS NULL THEN
    RAISE NOTICE '[fusion-pos] pos_sales no existe todavía — nada que reconciliar';
    RETURN;
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='pos_sales' AND column_name='sold_at'),
         EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='pos_sales' AND column_name='warehouse_id')
    INTO tiene_sold_at, tiene_warehouse;

  -- Ya tiene la forma de Almacén: solo faltan las columnas de caja.
  IF tiene_sold_at AND tiene_warehouse THEN
    RAISE NOTICE '[fusion-pos] pos_sales ya tiene la forma unificada';
  ELSE
    EXECUTE 'SELECT count(*) FROM pos_sales' INTO ventas;
    IF ventas > 0 THEN
      RAISE EXCEPTION
        '[fusion-pos] pos_sales tiene % venta(s) con el esquema viejo. '
        'Reemplazarla las borraría. Migra esos datos a mano antes de continuar.', ventas;
    END IF;

    RAISE NOTICE '[fusion-pos] reemplazando pos_sales vacía por el esquema unificado';
    DROP TABLE IF EXISTS pos_sale_items CASCADE;
    DROP TABLE IF EXISTS pos_sales      CASCADE;

    CREATE TABLE pos_sales (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id        UUID NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
      warehouse_id      UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      folio             INT  NOT NULL,
      status            VARCHAR(24) NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN','INVOICED_INDIVIDUAL','IN_GLOBAL','CANCELLED')),
      payment_form      VARCHAR(2) NOT NULL DEFAULT '01',
      subtotal          NUMERIC(15,2) NOT NULL DEFAULT 0,
      tax               NUMERIC(15,2) NOT NULL DEFAULT 0,
      total             NUMERIC(15,2) NOT NULL DEFAULT 0,
      invoice_id        UUID REFERENCES invoices(id) ON DELETE SET NULL,
      global_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
      sold_at           TIMESTAMP NOT NULL DEFAULT NOW(),
      cancelled_at      TIMESTAMP,
      user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
      user_email        VARCHAR(255),
      created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, folio)
    );

    CREATE TABLE pos_sale_items (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      pos_sale_id  UUID NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
      product_id   UUID NOT NULL REFERENCES products(id)  ON DELETE RESTRICT,
      quantity     NUMERIC(15,6) NOT NULL CHECK (quantity > 0),
      unit_price   NUMERIC(15,2) NOT NULL,
      subtotal     NUMERIC(15,2) NOT NULL DEFAULT 0,
      tax          NUMERIC(15,2) NOT NULL DEFAULT 0,
      total        NUMERIC(15,2) NOT NULL DEFAULT 0,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX ix_pos_sale_items_sale ON pos_sale_items(pos_sale_id);
  END IF;
END $$;

-- Manejo de caja, que venía del POS de facturación y sí vale la pena conservar:
-- sin esto no se puede cuadrar el cajón al cierre del día.
ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS customer_name   VARCHAR(255) DEFAULT 'Público en general';
ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS amount_tendered NUMERIC(15,2);
ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS change_given    NUMERIC(15,2) DEFAULT 0;
ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS card_ref        VARCHAR(40);

COMMENT ON COLUMN pos_sales.amount_tendered IS
  'Con cuánto pagó el cliente. Junto con change_given permite cuadrar el cajón.';

CREATE INDEX IF NOT EXISTS idx_pos_sales_company_day ON pos_sales(company_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_sales_status      ON pos_sales(company_id, status);

COMMIT;
