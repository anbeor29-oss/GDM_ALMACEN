-- ============================================================================
-- 2026-11-24 — Correo del grupo + cobranza del súper admin.
--
-- 1) CORREO. El bloque «Datos para tu pago (transferencia o depósito)» dejaba
--    de ser incondicional: se manda SÓLO si la empresa lo enciende. Es dato que
--    a un cliente de años le sobra en cada correo y que a uno nuevo le falta.
--    Junto a él, un TEXTO ADICIONAL propio de la empresa que se antepone a la
--    firma — la factura y el recibo de nómina ya traen su cuerpo por omisión;
--    esto es el párrafo de la casa, escrito una vez.
--
-- 2) NÓMINA. El recibo se marcaba para correo y ahí se quedaba: `enviado_at`
--    no lo escribía nadie. Al habilitar el envío real hace falta guardar por qué
--    falló uno, o el siguiente intento lo manda dos veces sin saberlo.
--
-- 3) COBRANZA DEL SÚPER ADMIN. El check «ya cobré, factúrame» vivía en la
--    memoria del navegador: se perdía al recargar y no distinguía un mes de
--    otro. Pasa al cargo del periodo — así se conserva dentro del mes y queda
--    LIMPIO solo al cambiar de mes, porque el mes nuevo es otro renglón.
--    Con él se guardan el consecutivo del CFDI emitido, el cobro y el
--    complemento de pago.
-- ============================================================================

/* ── 1) Correo ─────────────────────────────────────────────────────────── */
ALTER TABLE companies ADD COLUMN IF NOT EXISTS mail_texto_adicional  TEXT;
-- FALSE a propósito: hoy el bloque de depósito sale en TODAS las facturas. A
-- partir de aquí sale sólo donde se encienda.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS mail_incluir_deposito BOOLEAN NOT NULL DEFAULT FALSE;

/* ── 2) Nómina ─────────────────────────────────────────────────────────── */
ALTER TABLE nomina_recibos ADD COLUMN IF NOT EXISTS enviado_error TEXT;

/* ── 3) Cobranza ───────────────────────────────────────────────────────── */
-- El check de control. Por (empresa, periodo): se limpia solo al cambiar de mes.
ALTER TABLE facturacion_mensual ADD COLUMN IF NOT EXISTS listo_para_facturar BOOLEAN NOT NULL DEFAULT FALSE;
-- El consecutivo del CFDI emitido (serie-folio) y su UUID, a la vista en la lista.
ALTER TABLE facturacion_mensual ADD COLUMN IF NOT EXISTS factura_folio VARCHAR(40);
ALTER TABLE facturacion_mensual ADD COLUMN IF NOT EXISTS factura_uuid  VARCHAR(60);
ALTER TABLE facturacion_mensual ADD COLUMN IF NOT EXISTS emisora_id    UUID REFERENCES companies(id);
-- El cobro: cuánto, cuándo y con qué forma de pago del Anexo 20.
ALTER TABLE facturacion_mensual ADD COLUMN IF NOT EXISTS cobrado_mxn   NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE facturacion_mensual ADD COLUMN IF NOT EXISTS pago_forma    VARCHAR(4);
ALTER TABLE facturacion_mensual ADD COLUMN IF NOT EXISTS pago_fecha    DATE;
ALTER TABLE facturacion_mensual ADD COLUMN IF NOT EXISTS pago_nota     TEXT;
-- El complemento de pago (CFDI tipo P) que ampara ese cobro.
ALTER TABLE facturacion_mensual ADD COLUMN IF NOT EXISTS rep_id    UUID;
ALTER TABLE facturacion_mensual ADD COLUMN IF NOT EXISTS rep_folio VARCHAR(40);
ALTER TABLE facturacion_mensual ADD COLUMN IF NOT EXISTS rep_uuid  VARCHAR(60);

-- Los cargos ya pagados antes de esta migración traen su importe como cobrado:
-- si no, el acumulado del periodo nacería en cero y parecería que nadie pagó.
UPDATE facturacion_mensual
   SET cobrado_mxn = total_mxn
 WHERE status = 'PAGADO' AND cobrado_mxn = 0 AND total_mxn > 0;
