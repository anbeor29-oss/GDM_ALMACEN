-- ============================================================================
-- LA EXENCIÓN DE FACTURACIÓN QUEDA CERRADA A DOS RFC
--
-- POR QUÉ
-- `billing_exempt` la introduje como bandera editable desde la pantalla, con
-- el argumento de que así se podría marcar otra empresa del grupo sin
-- redesplegar. Visto de nuevo, esa comodidad es el problema: una empresa
-- exenta NO SE FACTURA, y dejar eso a un clic significa que un error de fila
-- —o alguien con acceso de SUPER_ADMIN -- puede dejar de cobrarle a un cliente
-- de pago sin que nada lo delate. El cierre mensual simplemente la salta, en
-- silencio, mes tras mes.
--
-- La exención es una decisión del dueño del negocio, no una casilla de una
-- pantalla de administración. Ahora exige tocar el código: eso deja rastro en
-- el historial, pasa por revisión y obliga a decirlo en voz alta.
--
-- QUÉ HACE
--   1. Quita la exención de cualquier empresa que no sea una de las dos.
--   2. Se asegura de que las dos la tengan.
--   3. Prohíbe a nivel de BASE que exista una tercera. No es un chequeo de la
--      aplicación: un UPDATE directo desde una consola también se estrella.
--
-- PARA AGREGAR UNA TERCERA
-- Se edita esta restricción en una migración nueva. Es a propósito que duela
-- un poco: es lo que convierte "se me fue el clic" en "lo decidimos".
-- ============================================================================

BEGIN;

/* Por si alguien alcanzó a marcar otra antes de este candado. */
UPDATE companies
   SET billing_exempt = FALSE,
       billing_exempt_reason = NULL
 WHERE billing_exempt = TRUE
   AND UPPER(rfc) NOT IN ('GHC1707275Y0', 'SAJ10120859A');

UPDATE companies
   SET billing_exempt = TRUE,
       billing_exempt_reason = COALESCE(billing_exempt_reason, 'Empresa propia de GRUPO HCGM')
 WHERE UPPER(rfc) IN ('GHC1707275Y0', 'SAJ10120859A')
   AND billing_exempt = FALSE;

/* El candado. Se puede escribir como CHECK porque `rfc` vive en la MISMA fila
 * que la bandera — no hace falta consultar otra tabla. */
ALTER TABLE companies DROP CONSTRAINT IF EXISTS chk_billing_exempt_solo_hcgm;
ALTER TABLE companies ADD CONSTRAINT chk_billing_exempt_solo_hcgm
  CHECK (
    billing_exempt = FALSE
    OR UPPER(rfc) IN ('GHC1707275Y0', 'SAJ10120859A')
  );

COMMENT ON COLUMN companies.billing_exempt IS
  'No entra al cierre mensual. Reservado a las dos empresas propias de GRUPO '
  'HCGM; la restricción chk_billing_exempt_solo_hcgm impide cualquier otra. '
  'Agregar una tercera exige una migración nueva, a propósito.';

COMMIT;
