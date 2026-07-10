-- Anexo 20: desglose de impuestos por línea de factura
-- Aplicar una sola vez con: psql ... -f este_archivo.sql

ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS tax_preset_id  VARCHAR(32);
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ret_iva_rate   DECIMAL(8,6) DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ret_isr_rate   DECIMAL(8,6) DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ieps_rate      DECIMAL(8,6) DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ret_iva_amount DECIMAL(15,2) DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ret_isr_amount DECIMAL(15,2) DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS ieps_amount    DECIMAL(15,2) DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS is_exempt      BOOLEAN DEFAULT FALSE;

-- Para que el total de retenciones de la factura quede separado por IVA / ISR
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_retained_iva DECIMAL(15,2) DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_retained_isr DECIMAL(15,2) DEFAULT 0;
