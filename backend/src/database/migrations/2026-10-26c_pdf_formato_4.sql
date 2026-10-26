-- Se reducen los formatos de impresión a 4 (esmeralda, carbon, farsystems, gncys).
-- Los retirados (clasico, cielo) se migran a 'esmeralda' y el default pasa a 'esmeralda'.
-- (El código conserva 'clasico' como respaldo interno por si quedara algún valor viejo.)
UPDATE companies SET pdf_formato = 'esmeralda' WHERE pdf_formato IN ('clasico', 'cielo');
ALTER TABLE companies ALTER COLUMN pdf_formato SET DEFAULT 'esmeralda';
