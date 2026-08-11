-- ============================================================================
-- CADA ALMACÉN, SU PUNTO DE VENTA — la caja asignada al cajero
--
-- Al dar de alta un almacén se crea también su cajero. Ese usuario tiene que
-- vender DESDE ESE ALMACÉN y no desde el que la empresa tenga por omisión: si
-- el cajero de la Bodega Norte descuenta del almacén central, las dos
-- existencias quedan mal y nadie lo nota hasta el inventario físico.
--
-- POR QUÉ UNA COLUMNA Y NO UNA TABLA PUENTE
-- Un cajero atiende UNA caja. Una tabla usuario↔almacenes permitiría varias y
-- obligaría a resolver cuál usar en cada venta — una decisión que nadie quiere
-- tomar a media cobranza. Si algún día un supervisor debe cubrir dos cajas, se
-- le cambia el almacén asignado, o se le da el grupo VENTAS, que ya elige.
--
-- NULL = sin caja fija. Es el caso de ADMIN, VENTAS y cualquiera que hoy vende
-- eligiendo el almacén en la pantalla; no cambia nada para ellos.
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

/* ON DELETE SET NULL y no CASCADE: si se borra un almacén, el cajero NO debe
 * desaparecer con él. Perder el usuario borraría también su rastro en la
 * bitácora de ventas, que es justo lo que hay que conservar. */

CREATE INDEX IF NOT EXISTS idx_users_warehouse
  ON users(warehouse_id) WHERE warehouse_id IS NOT NULL;

COMMENT ON COLUMN users.warehouse_id IS
  'Caja asignada: el almacén desde el que vende este usuario en el POS. '
  'NULL = elige almacén en la pantalla (ADMIN, VENTAS).';
