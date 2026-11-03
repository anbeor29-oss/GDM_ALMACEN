-- Ampliación del Checador (etapa 1): parámetros de TOLERANCIA DE SALIDA y TIEMPO
-- EXTRAORDINARIO por TURNO. Todo aditivo y con default, para no tocar los turnos
-- ni los procesos que ya existen. La LÓGICA de detección/cálculo del tiempo extra
-- (comparar checada real vs salida programada + tolerancia, clasificar dobles/
-- triples, parte exenta/gravada) es una etapa POSTERIOR; aquí sólo se guarda la
-- configuración por turno.
--
-- Campos (del .md GDM_NEXO_Ampliacion_Checador_Tiempo_Extra_SBC_IMSS):
--   · tolerancia_salida_min   — minutos después de la salida programada antes de
--     marcar una posible incidencia de tiempo extra (ej. 15). NULL = 0.
--   · calcula_tiempo_extra     — habilita/deshabilita el cálculo de TE del turno.
--   · requiere_autorizacion_te — el TE detectado debe autorizarse antes de nómina.
--   · responsable_autorizacion — quién autoriza (texto por ahora; en la etapa del
--     flujo de autorización pasará a un selector de usuario/supervisor).
--   · redondeo_min             — redondeo de minutos; 0 = NO redondear (por omisión).

ALTER TABLE checador_turnos
  ADD COLUMN IF NOT EXISTS tolerancia_salida_min   INTEGER,
  ADD COLUMN IF NOT EXISTS calcula_tiempo_extra     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS requiere_autorizacion_te BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS responsable_autorizacion TEXT,
  ADD COLUMN IF NOT EXISTS redondeo_min             INTEGER NOT NULL DEFAULT 0;
