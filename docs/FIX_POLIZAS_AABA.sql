-- ============================================================================
-- FIX DEFINITIVO: pólizas ene-sep 2026 no aparecen en la balanza (AABA020418BW2)
-- ----------------------------------------------------------------------------
-- Síntoma: import «183 ya estaban», reconstrucción «3 meses», balanza ene-sep = 0.
-- Dos causas posibles (este script cubre LAS DOS, es seguro y repetible):
--   (1) Pólizas FANTASMA: encabezado sin renglones -> invisibles en la balanza.
--   (2) Periodos ene-sep CERRADOS: alimentarDesdePolizas los SALTA (periodos.service:521).
--
-- CÓMO: Render -> servicio del BACKEND -> pestaña «Shell»:
--   psql "$DATABASE_URL" -f docs/FIX_POLIZAS_AABA.sql
-- (o abre psql "$DATABASE_URL" y pega los bloques)
-- ============================================================================

\set rfc 'AABA020418BW2'

-- ───────────────── DIAGNÓSTICO (manda esta salida para documentar) ──────────
-- Pólizas 2026 por mes: totales, con renglones, SIN renglones (fantasma).
SELECT EXTRACT(MONTH FROM je.fecha)::int AS mes,
       count(*)                                                                         AS polizas,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.entry_id=je.id))     AS con_renglones,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.entry_id=je.id)) AS sin_renglones
FROM journal_entries je JOIN companies c ON c.id=je.company_id
WHERE UPPER(c.rfc)=UPPER(:'rfc') AND EXTRACT(YEAR FROM je.fecha)=2026
GROUP BY 1 ORDER BY 1;

-- Estado de los periodos 2026 (ABIERTO/CERRADO).
SELECT ap.mes, ap.estado
FROM accounting_periods ap JOIN companies c ON c.id=ap.company_id
WHERE UPPER(c.rfc)=UPPER(:'rfc') AND ap.anio=2026 ORDER BY ap.mes;

-- ───────────────── ARREGLO (seguro: solo toca ene-sep 2026 de este RFC) ─────

-- (A) Reabrir ene-sep 2026 si estaban CERRADOS (reconstruir vuelve a cuadrarlos).
UPDATE accounting_periods ap SET estado='ABIERTO', cerrado_at=NULL
FROM companies c
WHERE c.id=ap.company_id AND UPPER(c.rfc)=UPPER(:'rfc')
  AND ap.anio=2026 AND ap.mes BETWEEN 1 AND 9 AND ap.estado='CERRADO';

-- (B) Borrar pólizas CTLK FANTASMA (sin renglones) de ene-sep 2026. El NOT EXISTS
--     garantiza que NUNCA se toca una con renglones. Tras esto, re-importar el .xlsx
--     filtrado las re-crea COMPLETAS (las que sí tienen renglones dirán «ya estaban»).
DELETE FROM journal_entries je USING companies c
WHERE c.id=je.company_id AND UPPER(c.rfc)=UPPER(:'rfc')
  AND je.origen_uuid LIKE 'CTLK:%'
  AND EXTRACT(YEAR FROM je.fecha)=2026 AND EXTRACT(MONTH FROM je.fecha) BETWEEN 1 AND 9
  AND NOT EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.entry_id=je.id);

-- ───────────────── VERIFICACIÓN (después del arreglo) ───────────────────────
SELECT ap.mes, ap.estado FROM accounting_periods ap JOIN companies c ON c.id=ap.company_id
WHERE UPPER(c.rfc)=UPPER(:'rfc') AND ap.anio=2026 AND ap.mes BETWEEN 1 AND 9 ORDER BY ap.mes;

-- DESPUÉS, en la app (empresa ALEJANDRO AYALA BARBA):
--   1) Si (B) borró fantasmas: re-importa libro-diario-AABA-ene-sep-2026.xlsx.
--   2) Pulsa «Reconstruir todos los ejercicios».
--   3) Abre la balanza anual 2026 -> ene-sep ya con saldos.
