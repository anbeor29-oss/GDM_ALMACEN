-- ═══════════════════════════════════════════════════════════════════════════
-- Descarga del SAT: programación diaria, ejercicios completos y presupuesto
--
-- ── TRES PROBLEMAS QUE ESTO RESUELVE ──
--
-- 1. NADA CREABA TRABAJOS SOLOS.
--    El cron existía y corría cada 15 minutos, pero sólo AVANZA trabajos que
--    ya existen. Nunca creaba el del día. Así que "descargar a diario" no
--    ocurría: dependía de que alguien entrara a la pantalla y le diera al
--    botón. Los días que nadie entra, no hay CFDI — y esos huecos se descubren
--    meses después, cuando ya no se pueden llenar.
--
-- 2. PEDIR DOS VECES LO MISMO.
--    crearTrabajo no miraba si ya había un trabajo vivo sobre el mismo rango y
--    dirección. Dos clics en "Pedir al SAT" creaban dos trabajos con las
--    mismas particiones, y el SAT recibía la petición duplicada. No es sólo
--    ruido: las solicitudes al SAT están limitadas, y gastarlas dos veces en
--    el mismo rango deja sin cupo a un rango que sí falta.
--
-- 3. "SIN DATOS" Y "RECHAZADA" SE VEÍAN IGUAL.
--    particiones_listas sumaba TERMINADA, SIN_DATOS, DIVIDIDA, RECHAZADA y
--    FALLIDA en un solo número. La pantalla decía "4/5" y no había forma de
--    saber si esas cuatro salieron bien sin comprobantes o si el SAT las
--    rechazó — que es justo lo que hay que saber cuando se está probando una
--    e.firma.
--
-- ── EL PRESUPUESTO DIARIO ──
-- Traer un ejercicio completo de golpe es la forma más rápida de topar los
-- límites del SAT y quedarse sin cupo para el día. Se reparte: un tope de XML
-- y de solicitudes por día, y el motor se detiene al alcanzarlo y sigue
-- mañana. Un histórico tarda unos días en bajar, y está bien: lo que no puede
-- pasar es que el intento de bajarlo deje sin descarga a la operación diaria.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Cómo descarga cada empresa ──
CREATE TABLE IF NOT EXISTS sat_config_descarga (
  company_id        UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,

  -- El motor crea solo el trabajo de cada día.
  diaria_activa     BOOLEAN NOT NULL DEFAULT TRUE,
  -- Qué se pide a diario. Lo que NEXO emite ya está en el sistema, pero se
  -- piden los emitidos igual: sirven para cazar lo que se timbró por fuera.
  diaria_recibidos  BOOLEAN NOT NULL DEFAULT TRUE,
  diaria_emitidos   BOOLEAN NOT NULL DEFAULT TRUE,

  -- Cuántos días atrás se pide cada vez. Tres, no uno: el SAT tarda en
  -- publicar, y un CFDI timbrado el día 30 a las 23:50 no está disponible el
  -- día 1 a las 6 de la mañana. Pedir sólo ayer deja huecos silenciosos.
  dias_atras        SMALLINT NOT NULL DEFAULT 3,

  -- El presupuesto. 2,000 XML por día es el arranque acordado.
  xml_por_dia       INTEGER NOT NULL DEFAULT 2000,
  solicitudes_por_dia SMALLINT NOT NULL DEFAULT 40,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_dias_atras CHECK (dias_atras BETWEEN 1 AND 30),
  CONSTRAINT chk_xml_dia CHECK (xml_por_dia BETWEEN 100 AND 500000),
  CONSTRAINT chk_sol_dia CHECK (solicitudes_por_dia BETWEEN 1 AND 500)
);

-- ── 2. Lo consumido hoy ──
--
-- Una fila por empresa y día. Sin esto el presupuesto no se puede respetar:
-- contar sobre sat_particiones daría el total histórico, no el del día.
CREATE TABLE IF NOT EXISTS sat_consumo_diario (
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fecha        DATE NOT NULL,
  solicitudes  INTEGER NOT NULL DEFAULT 0,
  xml          INTEGER NOT NULL DEFAULT 0,
  paquetes     INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, fecha)
);

-- ── 3. De dónde salió cada trabajo ──
--
-- DIARIO se crea solo; EJERCICIO es el histórico; MANUAL es el botón. Sin esto
-- no se puede saber si la descarga automática está funcionando: todos los
-- trabajos se ven iguales.
ALTER TABLE sat_trabajos
  ADD COLUMN IF NOT EXISTS origen VARCHAR(12) NOT NULL DEFAULT 'MANUAL';
ALTER TABLE sat_trabajos DROP CONSTRAINT IF EXISTS chk_trabajo_origen;
ALTER TABLE sat_trabajos ADD CONSTRAINT chk_trabajo_origen
  CHECK (origen IN ('DIARIO', 'EJERCICIO', 'MANUAL'));

-- El ejercicio al que pertenece, para poder seguir un histórico completo.
ALTER TABLE sat_trabajos ADD COLUMN IF NOT EXISTS ejercicio SMALLINT;

-- ── 4. No pedir dos veces el mismo rango ──
--
-- ⚠️ PRIMERO HAY QUE LIMPIAR LO QUE YA ESTÁ DUPLICADO.
--
-- Crear un índice único sobre una tabla que ya tiene duplicados FALLA, y con
-- ella falla la migración entera y el arranque del servicio. Y duplicados hay:
-- el bug que este índice viene a impedir llevaba tiempo creándolos.
--
-- Se conserva UNO de cada grupo y los demás se cancelan. Se queda el que más
-- avanzado va —más particiones resueltas— y, a igualdad, el más antiguo: es el
-- que probablemente ya tiene solicitudes en vuelo ante el SAT, y cancelarlo
-- tiraría trabajo que el SAT ya hizo.
--
-- No se BORRAN: se marcan CANCELADO con el motivo. Un trabajo que desaparece
-- sin explicación es peor que uno cancelado que se puede leer.
WITH ordenados AS (
  SELECT t.id,
         ROW_NUMBER() OVER (
           PARTITION BY t.company_id, t.rfc, t.fecha_desde, t.fecha_hasta,
                        t.direccion, t.tipo
           ORDER BY (
             SELECT COUNT(*) FROM sat_particiones p
              WHERE p.trabajo_id = t.id
                AND p.estado IN ('TERMINADA','SIN_DATOS','DIVIDIDA')
           ) DESC,
           t.created_at ASC
         ) AS puesto
    FROM sat_trabajos t
   WHERE t.estado IN ('CREADO', 'EN_PROCESO')
)
UPDATE sat_trabajos SET
  estado = 'CANCELADO',
  mensaje = COALESCE(mensaje || ' · ', '')
            || 'Cancelado al migrar: había otro trabajo vivo pidiendo el mismo '
            || 'rango y dirección. Se conservó el más avanzado.'
WHERE id IN (SELECT id FROM ordenados WHERE puesto > 1);

-- Índice parcial: sólo sobre los trabajos VIVOS. Uno terminado no estorba —
-- volver a pedir un rango ya bajado es legítimo si se sospecha que faltó algo.
-- Lo que no puede haber son dos trabajos vivos pidiendo lo mismo.
CREATE UNIQUE INDEX IF NOT EXISTS ux_trabajo_vivo_por_rango
  ON sat_trabajos (company_id, rfc, fecha_desde, fecha_hasta, direccion, tipo)
  WHERE estado IN ('CREADO', 'EN_PROCESO');

CREATE INDEX IF NOT EXISTS ix_trabajos_origen
  ON sat_trabajos (company_id, origen, created_at DESC);
