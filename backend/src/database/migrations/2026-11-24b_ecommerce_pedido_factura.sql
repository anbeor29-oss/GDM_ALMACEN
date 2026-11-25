-- Comercio Electrónico — por qué una factura de pedido web se quedó en BORRADOR.
--
-- `facturarPedido` crea el CFDI y lo intenta timbrar. Si el timbrado falla
-- (empresa en PRUEBAS, CSD sin cargar, contraseña que no abre la .key, PAC
-- caído), la factura queda en DRAFT ligada al pedido y el motivo sólo iba al
-- log del servidor: el merchant veía «(borrador)» y ningún porqué, y además el
-- inquilino de sólo-ecommerce no puede abrir la pantalla de Facturas.
--
-- Aquí se guarda el motivo para enseñarlo en el renglón del pedido.
ALTER TABLE ec_order ADD COLUMN IF NOT EXISTS factura_error TEXT;
