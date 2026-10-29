-- Tercer panel de Facturación: E-COMMERCE. Las empresas cuya ÚNICA operación es la
-- tienda en línea (todas sus cuentas activas son del grupo ECOMMERCE, p.ej. «Mi
-- Tienda») pasan de producto NEXO a ECOMMERCE. Las que usan NEXO y además tienen
-- tienda se quedan en NEXO (se cambian a mano en Súper Admin → Editar empresa).
UPDATE companies c
   SET producto = 'ECOMMERCE', updated_at = NOW()
 WHERE COALESCE(c.producto, 'NEXO') = 'NEXO'
   AND EXISTS (SELECT 1 FROM users u WHERE u.company_id = c.id AND u.is_active = TRUE AND u.work_group = 'ECOMMERCE')
   AND NOT EXISTS (SELECT 1 FROM users u WHERE u.company_id = c.id AND u.is_active = TRUE
                     AND COALESCE(u.work_group, '') <> 'ECOMMERCE');
