-- Fix: el nivel de confianza 'SIN_EVIDENCIA' tiene 13 letras y las columnas eran
-- VARCHAR(12) → «value too long for type character varying(12)» al guardar la
-- codificación de una factura sin historia. Se amplían a 20.
ALTER TABLE cfdi_concepto_cuenta ALTER COLUMN confianza TYPE VARCHAR(20);
ALTER TABLE cod_auditoria        ALTER COLUMN confianza TYPE VARCHAR(20);
