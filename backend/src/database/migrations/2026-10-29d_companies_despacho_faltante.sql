-- Las empresas dadas de alta DESPUÉS de sembrar los despachos (onboarding, IVA,
-- e-commerce: p.ej. CESSMART, Mi Tienda) quedaron sin despacho_id y en Facturación
-- salían en un segundo grupo «GRUPO HCGM» (agrupadas por emisora). Se asignan al
-- despacho cuya emisora predeterminada es la que les cobra; si no hay, a GRUPO HCGM.
UPDATE companies c
   SET despacho_id = COALESCE(
         (SELECT d.id FROM despachos_contables d
           WHERE d.deleted_at IS NULL AND d.activo = TRUE
             AND d.emisora_predeterminada_id = COALESCE(c.empresa_cobro_id,
                   (SELECT p.id FROM companies p WHERE p.emisor_predeterminado = TRUE AND p.deleted_at IS NULL LIMIT 1))
           ORDER BY d.created_at LIMIT 1),
         (SELECT d.id FROM despachos_contables d
           WHERE lower(d.nombre) = 'grupo hcgm' AND d.deleted_at IS NULL ORDER BY d.created_at LIMIT 1)),
       updated_at = NOW()
 WHERE c.deleted_at IS NULL AND c.despacho_id IS NULL
   AND COALESCE(c.es_emisor_cobro, FALSE) = FALSE;
