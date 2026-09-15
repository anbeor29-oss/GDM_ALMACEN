-- origen_uuid de las pólizas: de VARCHAR(40) a VARCHAR(80).
--
-- Se usa como clave de idempotencia. El CFDI pelón (36) cabía, pero las claves
-- con prefijo se pasan de 40: 'PAGOPUE:'+uuid = 44 (pago de facturas PUE),
-- 'BANCO:'+uuid = 42 y 'TARJETA:'+uuid = 44 (conciliación bancaria). Ensanchar
-- a 80 las acomoda todas sin perder nada (ampliar un varchar no trunca).
-- El índice único (company_id, origen_uuid) no se ve afectado.

ALTER TABLE journal_entries ALTER COLUMN origen_uuid TYPE VARCHAR(80);
