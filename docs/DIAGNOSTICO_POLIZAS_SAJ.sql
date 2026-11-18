-- ============================================================================
-- DIAGNÓSTICO: ¿qué pólizas hay realmente por mes? (por RFC, parametrizable)
-- ----------------------------------------------------------------------------
-- Para el síntoma «las pólizas de ene-sep 2026 no se suben» / «la balanza anual
-- muestra ENE-SEP en 0». Caso confirmado: ALEJANDRO AYALA BARBA (AABA020418BW2),
-- cuya balanza 2026 trae OCT-NOV-DIC con saldo pero ENE-SEP en 0 → esos meses NO
-- están en la base (el archivo del respaldo SÍ los trae: parsea al 100%).
--
-- Cambia el RFC de abajo según la empresa (p. ej. 'SAJ10120859A').
-- CÓMO CORRERLO: Render -> servicio del BACKEND -> pestaña «Shell» (Web Shell):
--   psql "$DATABASE_URL" -f docs/DIAGNOSTICO_POLIZAS_SAJ.sql
-- (o pega las consultas una por una; cambia el \set si usas -f)
-- ============================================================================

\set rfc 'AABA020418BW2'

-- 0) La empresa (confirma el company_id por su RFC).
SELECT id AS company_id, rfc, razon_social
FROM companies
WHERE UPPER(rfc) = UPPER(:'rfc');

-- 1) Pólizas por AÑO-MES y por ORIGEN. Distingue lo IMPORTADO del respaldo
--    (origen_uuid 'CTLK:%') de lo creado EN VIVO (desde CFDI / manual).
--    Si ene-sep 2026 NO salen aquí -> NO están en la base: hay que importarlas
--    (usa el archivo filtrado «solo ene-sep» para no duplicar oct-nov).
--    Si SÍ salen pero la balanza las muestra en 0 -> falta reconstruir la balanza.
SELECT
  to_char(je.fecha, 'YYYY-MM')                                   AS anio_mes,
  count(*)                                                       AS polizas,
  count(*) FILTER (WHERE je.origen_uuid LIKE 'CTLK:%')          AS del_respaldo,
  count(*) FILTER (WHERE je.origen_uuid NOT LIKE 'CTLK:%'
                      OR je.origen_uuid IS NULL)                 AS en_vivo
FROM journal_entries je
JOIN companies c ON c.id = je.company_id
WHERE UPPER(c.rfc) = UPPER(:'rfc')
GROUP BY 1
ORDER BY 1;

-- 2) ¿Existen los PERIODOS de 2024-2027? Los estados (Estado de resultados,
--    Balance) leen de los PERIODOS/saldos, no de las pólizas directas. Si hay
--    pólizas pero NO periodos -> botón «Reconstruir todos los ejercicios»
--    (pantalla verde de importar) o Balanza -> «Reconstruir año».
SELECT ap.anio, ap.mes, ap.estado, ap.cerrado_at
FROM accounting_periods ap
JOIN companies c ON c.id = ap.company_id
WHERE UPPER(c.rfc) = UPPER(:'rfc') AND ap.anio IN (2024, 2025, 2026, 2027)
ORDER BY ap.anio, ap.mes;

-- 3) (Opcional) Posibles DUPLICADOS por mes: si oct-nov ya existían «en vivo»
--    y además se importó el respaldo COMPLETO, podría haber dos pólizas
--    equivalentes. (El archivo filtrado «solo ene-sep» evita este riesgo.)
SELECT to_char(je.fecha,'YYYY-MM-DD') AS fecha, je.tipo,
       round(sum(jl.cargo),2) AS cargos, count(DISTINCT je.id) AS veces
FROM journal_entries je
JOIN companies c ON c.id = je.company_id
JOIN journal_lines jl ON jl.entry_id = je.id
WHERE UPPER(c.rfc) = UPPER(:'rfc')
  AND je.fecha >= DATE '2026-10-01'
GROUP BY 1, 2
HAVING count(DISTINCT je.id) > 1
ORDER BY 1;
