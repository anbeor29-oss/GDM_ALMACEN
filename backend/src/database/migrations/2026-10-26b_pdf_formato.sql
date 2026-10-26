-- Formato (tema de color) de la representación impresa del CFDI, elegible por el
-- usuario en «Datos de mi empresa». Aplica a FACTURA, TIMBRE DE PAGO (complemento)
-- y NOTA DE CRÉDITO. Default 'clasico' (el azul de siempre). Es puro vanity: el
-- layout sigue siendo un CFDI válido; sólo cambian los colores/acentos.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS pdf_formato VARCHAR(16) NOT NULL DEFAULT 'clasico';
