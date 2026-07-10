-- ============================================================================
-- RESET A ESTADO DE CAPACITACIÓN (pre-producción)
--
-- Deja la BD con:
--   · 1 empresa demo   ("EMPRESA DEMO CAPACITACION")
--   · 1 SUPER_ADMIN    (operador plataforma)
--   · 1 ADMIN          (dueño de la empresa demo — capacitación)
--   · 1 USER           (usuario común — capacitación)
--   · Catálogos SAT completos (52 K claves ClaveProdServ + regímenes + usos)
--   · Presets de impuestos y c_TasaOCuota intactos
--   · CERO facturas, CERO clientes, CERO productos, CERO XMLs
--
-- Idempotente: puede correrse N veces. NO tocar en producción sin backup previo.
-- ============================================================================

BEGIN;

-- 1) Purge de operativos (order matters por FKs)
TRUNCATE TABLE
    audit_log,
    xml_imports,
    pac_stamps,
    invoice_items,
    payments,
    credit_notes,
    invoices,
    customer_products,
    products,
    customers
  RESTART IDENTITY CASCADE;

-- 2) Contadores de folio a 1 por empresa (solo el que realmente existe)
--    NC y payments manejan su propio contador via MAX(folio)+1 en el service.
UPDATE companies SET next_invoice_folio = 1;

-- 3) Purge de usuarios EXCEPTO SUPER_ADMIN + los 2 de capacitación que crearemos
DELETE FROM users
 WHERE email NOT IN ('superadmin@plataforma.local');

-- 4) Purge de empresas y dejar una sola de capacitación
DELETE FROM companies
 WHERE business_name NOT LIKE 'EMPRESA DEMO CAPACITACION%';

INSERT INTO companies (id, business_name, rfc, fiscal_regime, postal_code,
                       billing_plan, cap_timbres, monthly_fee)
VALUES ('11111111-1111-1111-1111-111111111111',
        'EMPRESA DEMO CAPACITACION SA DE CV', 'EDC240101ABC', '601', '64000',
        'iguala', 100, 399.00)
ON CONFLICT (rfc) DO UPDATE
   SET business_name = EXCLUDED.business_name;

-- 5) ADMIN de capacitación (dueño de la empresa demo)
INSERT INTO users (email, first_name, last_name, password_hash, role,
                   company_id, is_active, password_change_required)
VALUES ('admin.demo@gdmfac.mx', 'Administrador', 'Demo',
        -- bcrypt('Cap4citAcion!'): usuario forzará cambio al primer login
        '$2a$12$uS3mZIu8YqdXIwYBIZaxn.9zaiNanW/dEyoKcmmLnobur9RKmDPX6',
        'ADMIN', '11111111-1111-1111-1111-111111111111', TRUE, TRUE)
ON CONFLICT (email) DO UPDATE
   SET is_active = TRUE, role = 'ADMIN',
       company_id = EXCLUDED.company_id,
       password_change_required = TRUE;

-- 6) USER común (para el flujo de facturación diario)
INSERT INTO users (email, first_name, last_name, password_hash, role,
                   company_id, is_active, password_change_required)
VALUES ('usuario.demo@gdmfac.mx', 'Usuario', 'Demo',
        '$2a$12$uS3mZIu8YqdXIwYBIZaxn.9zaiNanW/dEyoKcmmLnobur9RKmDPX6',
        'USER', '11111111-1111-1111-1111-111111111111', TRUE, TRUE)
ON CONFLICT (email) DO UPDATE
   SET is_active = TRUE, role = 'USER',
       company_id = EXCLUDED.company_id,
       password_change_required = TRUE;

-- 7) Verificación
DO $$
DECLARE
    n_users INT;   n_comp INT;   n_inv INT;
BEGIN
    SELECT count(*) INTO n_users FROM users WHERE is_active;
    SELECT count(*) INTO n_comp  FROM companies;
    SELECT count(*) INTO n_inv   FROM invoices;
    RAISE NOTICE 'Reset OK — usuarios=% empresas=% facturas=%', n_users, n_comp, n_inv;
    IF n_users <> 3 OR n_comp <> 1 OR n_inv <> 0 THEN
        RAISE EXCEPTION 'Reset falló: se esperaban 3 usuarios, 1 empresa, 0 facturas';
    END IF;
END $$;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- CREDENCIALES DE CAPACITACIÓN (comunicar al cliente por canal seguro):
--   superadmin@plataforma.local  → ChangeM3!Now
--   admin.demo@gdmfac.mx         → Cap4citAcion!   (forzará cambio)
--   usuario.demo@gdmfac.mx       → Cap4citAcion!   (forzará cambio)
-- ────────────────────────────────────────────────────────────────────────────
