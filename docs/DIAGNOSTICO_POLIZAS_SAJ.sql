-- ============================================================================
-- DIAGNÓSTICO: ¿qué pólizas hay realmente por mes? (RFC saj10120859a)
-- ----------------------------------------------------------------------------
-- Para el síntoma «las pólizas de ene-sep 2026 no se suben». El archivo del
-- respaldo (libro-diario.xls) ya se verificó: parsea al 100 % (240 pólizas,
-- Dic-2025 -> Nov-2026, ene-sep completas). Si ene-sep NO aparecen en la app,
-- esta consulta dice si FALTAN en la base o sólo faltaba reconstruir la balanza.
--
-- CÓMO CORRERLO: Render -> servicio del BACKEND -> pestaña «Shell» (Web Shell):
--   psql "$DATABASE_URL" -f docs/DIAGNOSTICO_POLIZAS_SAJ.sql
-- (o pega las consultas una por una en: psql "$DATABASE_URL")
-- ============================================================================

-- 0) La empresa (confirma el company_id por su RFC).
SELECT id AS company_id, rfc, razon_social
FROM companies
WHERE UPPER(rfc) = 'SAJ10120859A';

-- 1) Pólizas por AÑO-MES y por ORIGEN. Distingue lo IMPORTADO del respaldo
--    (origen_uuid 'CTLK:%') de lo creado EN VIVO (desde CFDI / manual).
--    Si ene-sep 2026 salen aquí, SÍ están en la base (el problema es de
--    visibilidad -> reconstruir balanza). Si NO salen, el import no entró.
SELECT
  to_char(je.fecha, 'YYYY-MM')                                   AS anio_mes,
  count(*)                                                       AS polizas,
  count(*) FILTER (WHERE je.origen_uuid LIKE 'CTLK:%')          AS del_respaldo,
  count(*) FILTER (WHERE je.origen_uuid NOT LIKE 'CTLK:%'
                      OR je.origen_uuid IS NULL)                 AS en_vivo
FROM journal_entries je
JOIN companies c ON c.id = je.company_id
WHERE UPPER(c.rfc) = 'SAJ10120859A'
GROUP BY 1
ORDER BY 1;

-- 2) ¿Existen los PERIODOS de 2024-2027? Los estados (Estado de resultados,
--    Balance) leen de los PERIODOS/saldos, no de las pólizas directas. Si hay
--    pólizas pero NO periodos -> botón «Reconstruir todos los ejercicios»
--    (pantalla verde de importar) o Balanza -> «Reconstruir año».
SELECT ap.anio, ap.mes, ap.estado, ap.cerrado_at
FROM accounting_periods ap
JOIN companies c ON c.id = ap.company_id
WHERE UPPER(c.rfc) = 'SAJ10120859A' AND ap.anio IN (2024, 2025, 2026, 2027)
ORDER BY ap.anio, ap.mes;

-- 3) (Opcional) Posibles DUPLICADOS por mes: si Oct-Nov ya existían «en vivo»
--    y además se importó el respaldo, podría haber dos pólizas equivalentes.
--    Agrupa por fecha+tipo+total de cargos para detectar repetidas.
SELECT to_char(je.fecha,'YYYY-MM-DD') AS fecha, je.tipo,
       round(sum(jl.cargo),2) AS cargos, count(DISTINCT je.id) AS veces
FROM journal_entries je
JOIN companies c ON c.id = je.company_id
JOIN journal_lines jl ON jl.entry_id = je.id
WHERE UPPER(c.rfc) = 'SAJ10120859A'
  AND je.fecha >= DATE '2026-10-01'
GROUP BY 1, 2
HAVING count(DISTINCT je.id) > 1
ORDER BY 1;
