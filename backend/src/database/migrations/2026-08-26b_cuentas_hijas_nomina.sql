-- ═══════════════════════════════════════════════════════════════════════════
-- Subcuentas de movimiento que la póliza de nómina necesita y el catálogo semilla
-- no traía (210 y 213/216 quedaban como cuentas de agrupación, sin hoja donde
-- asentar). Sin ellas, la póliza de finiquito no cuadraba: el abono al neto y a
-- las retenciones caía en "cuenta inexistente".
--
-- Cada hija HEREDA las características del padre (tipo, naturaleza, agrupador,
-- NIF) y ACUMULA a él (cuelga por parent_id, así el saldo sube al padre en la
-- balanza). Al nacer la hija, el padre deja de recibir movimientos.
--
-- Idempotente: sólo crea la que no exista ya (por código, por empresa).
--   210.01  Nómina por pagar                  (padre 210 Provisión de sueldos)
--   213.01  Retenciones de FONACOT            (padre 213 Impuestos y derechos por pagar)
--   213.02  Pensión alimenticia por pagar     (padre 213)
--   216.01  Retención de IMSS                 (padre 216 Impuestos retenidos)
--   216.02  ISR retenido por sueldos          (padre 216)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  spec  RECORD;
  padre RECORD;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('210', '210.01', 'Nómina por pagar'),
    ('213', '213.01', 'Retenciones de FONACOT'),
    ('213', '213.02', 'Pensión alimenticia por pagar'),
    ('216', '216.01', 'Retención de IMSS'),
    ('216', '216.02', 'ISR retenido por sueldos')
  ) AS t(agrup, cod, nom)
  LOOP
    -- El padre (la cuenta más alta con ese agrupador) de cada empresa.
    FOR padre IN
      SELECT DISTINCT ON (company_id) *
        FROM accounting_accounts
       WHERE codigo_agrupador = spec.agrup AND tercero_rfc IS NULL
       ORDER BY company_id, nivel
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM accounting_accounts
         WHERE company_id = padre.company_id AND codigo = spec.cod
      ) THEN
        INSERT INTO accounting_accounts
          (company_id, parent_id, codigo, nombre, codigo_agrupador, tipo, naturaleza,
           es_complementaria, nif_norma, nivel, permite_movimientos, requiere_tercero)
        VALUES
          (padre.company_id, padre.id, spec.cod, spec.nom, padre.codigo_agrupador,
           padre.tipo, padre.naturaleza, padre.es_complementaria, padre.nif_norma,
           COALESCE(padre.nivel, 1) + 1, TRUE, FALSE);
        UPDATE accounting_accounts SET permite_movimientos = FALSE WHERE id = padre.id;
      END IF;
    END LOOP;
  END LOOP;
END $$;
