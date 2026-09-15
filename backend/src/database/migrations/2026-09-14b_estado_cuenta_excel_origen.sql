-- Estado de cuenta cargado por EXCEL (plantilla).
-- El origen del estado de cuenta ahora puede ser 'EXCEL', además de PDF/TEXTO/CSV.
-- Se recrea el CHECK para incluirlo. VARCHAR(10) ya alcanza para 'EXCEL'.

ALTER TABLE bancos_estados_cuenta DROP CONSTRAINT IF EXISTS bancos_estados_origen_ck;
ALTER TABLE bancos_estados_cuenta
  ADD CONSTRAINT bancos_estados_origen_ck CHECK (origen IN ('PDF','TEXTO','CSV','EXCEL'));
