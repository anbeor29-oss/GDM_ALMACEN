-- Máscara de despliegue del código de cuenta, POR EMPRESA.
-- El código guardado NO cambia (sigue siendo p.ej. 21030026); la máscara sólo
-- dice cómo se MUESTRA en catálogo, pólizas, balanza y demás pantallas de cuentas.
-- La define el usuario (ej. '##-##-##-##' o '#-##-##-###'); NULL = sin máscara.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS mascara_cuenta VARCHAR(40);
