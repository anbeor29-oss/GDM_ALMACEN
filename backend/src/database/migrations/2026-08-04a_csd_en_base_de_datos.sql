-- ============================================================================
-- CSD EN LA BASE DE DATOS, NO EN EL DISCO
--
-- POR QUÉ
-- Los certificados de sello digital se guardaban como ARCHIVOS: csd_cer_path y
-- csd_key_path apuntaban a rutas del sistema de archivos. En Render el disco es
-- EFÍMERO: cada despliegue lo borra. La fila de la empresa conservaba la ruta,
-- el archivo ya no existía, y el sistema caía en silencio a la bóveda del PAC —
-- que devolvía CA305 "Certificado Inválido".
--
-- Eso significa que, tal como está, CADA ACTUALIZACIÓN deja a todas las empresas
-- sin poder timbrar hasta que alguien recargue su CSD a mano. Para operar en
-- general no se sostiene.
--
-- El contenido pasa a vivir aquí, cifrado, igual que ya vivía la contraseña.
--
-- POR QUÉ TEXT Y NO BYTEA
-- Se guarda el base64 del DER en TEXT, no los bytes crudos, por dos razones: es
-- lo que la API del PAC pide literalmente (b64Cer, b64Key), así que no hay
-- conversión al leer; y el cifrado de utils/csd-crypto ya trabaja sobre cadenas,
-- de modo que se reutiliza tal cual en vez de escribir una segunda variante para
-- binario — que es como se llega a dos formatos que no se entienden entre sí.
--
-- LAS RUTAS NO SE BORRAN TODAVÍA
-- csd_cer_path y csd_key_path se conservan a propósito. Mientras haya empresas
-- cuyo certificado siga en disco y no se haya migrado, el código las necesita
-- como respaldo. Quitarlas aquí obligaría a migrar todo de golpe, y una empresa
-- que se quedara fuera perdería la capacidad de timbrar sin aviso.
-- ============================================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS csd_cer_data TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS csd_key_data TEXT;

COMMENT ON COLUMN companies.csd_cer_data IS
  'Certificado .cer en base64 del DER, cifrado con utils/csd-crypto (AES-256-GCM).';
COMMENT ON COLUMN companies.csd_key_data IS
  'Llave .key en base64 del DER, cifrada con utils/csd-crypto (AES-256-GCM). '
  'Sólo se descifra en memoria al sellar o cancelar; nunca se devuelve por API.';

-- Para saber de un vistazo qué empresas siguen dependiendo del disco.
CREATE INDEX IF NOT EXISTS idx_companies_csd_en_disco
  ON companies (id)
  WHERE csd_cer_path IS NOT NULL AND csd_cer_data IS NULL;
