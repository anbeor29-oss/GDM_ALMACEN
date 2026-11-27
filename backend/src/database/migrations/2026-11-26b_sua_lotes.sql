-- ============================================================================
-- BITÁCORA DE LOTES DEL SUA — qué se le mandó al SUA y cómo le fue.
--
-- POR QUÉ HACE FALTA
-- El generador de archivos del SUA no sabía qué ya se había importado, así que
-- nada impedía mandar las mismas altas dos veces. El SUA las rechaza con «Ya
-- existe», pero el rechazo llega después y hay que ir a leerlo: más barato es
-- que NEXO recuerde lo que mandó.
--
-- NO ES LA BITÁCORA DEL IDSE
-- Se parece a nomina_idse_lotes y a propósito NO la reusa: el IDSE devuelve un
-- acuse en PDF del portal y el SUA no devuelve nada —deja sus rechazos en los
-- ErrImp*.txt de su propia carpeta—. Por eso aquí el cierre del lote es un
-- RESULTADO que alguien captura (importado o con errores) y, si hubo errores, el
-- texto de ese ErrImp pegado tal cual. Mezclar los dos en una tabla habría
-- obligado a dejar columnas muertas en cada renglón.
--
-- LA FOTO, NO LA REFERENCIA
-- Cada renglón guarda el dato COMO SE MANDÓ (NSS, fecha, importe). Si el
-- expediente cambia después, la bitácora sigue diciendo lo que se envió ese día,
-- que es lo único que sirve para cotejar contra el SUA.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nomina_sua_lotes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  /* ALTAS (Aseg+Afil), MOVIMIENTOS (Movt) o CREDITOS (Cred). */
  paso              VARCHAR(12) NOT NULL,
  /* Los archivos que se descargaron, separados por coma: "Aseg.txt, Afil.txt". */
  archivos          VARCHAR(120),
  num_renglones     INTEGER NOT NULL DEFAULT 0,
  registro_patronal VARCHAR(15),

  /* PENDIENTE hasta que alguien diga cómo le fue en el SUA. */
  resultado         VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE',
  /* El ErrImp*.txt del SUA, pegado como lo escribió él. */
  errores_txt       TEXT,
  resultado_at      TIMESTAMP,
  notas             TEXT,

  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT nomina_sua_lotes_paso_ck
    CHECK (paso IN ('ALTAS','MOVIMIENTOS','CREDITOS')),
  CONSTRAINT nomina_sua_lotes_resultado_ck
    CHECK (resultado IN ('PENDIENTE','IMPORTADO','CON_ERRORES'))
);

CREATE INDEX IF NOT EXISTS idx_sua_lotes_empresa
  ON nomina_sua_lotes (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS nomina_sua_lote_renglones (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lote_id         UUID NOT NULL REFERENCES nomina_sua_lotes(id) ON DELETE CASCADE,
  empleado_id     UUID REFERENCES nomina_empleados(id) ON DELETE SET NULL,

  nombre_completo VARCHAR(250),
  nss             VARCHAR(11),
  num_empleado    VARCHAR(30),

  /* ALTA · BAJA · MODIFICACION · REINGRESO · CREDITO_INICIO ·
   * CREDITO_SUSPENSION · CREDITO_REINICIO · CREDITO_VALOR */
  tipo            VARCHAR(20) NOT NULL,
  fecha           DATE NOT NULL,
  /* Salario del movimiento, o valor del descuento si es de crédito. */
  importe         NUMERIC(12,4),
  num_credito     VARCHAR(10),
  orden           SMALLINT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_sua_lote_reng_lote
  ON nomina_sua_lote_renglones (lote_id);

/* Para la pregunta que se hace en cada pantalla: ¿a este trabajador ya le mandé
 * esto? Va por empleado porque es como se consulta, no por lote. */
CREATE INDEX IF NOT EXISTS idx_sua_lote_reng_empleado
  ON nomina_sua_lote_renglones (empleado_id, tipo, fecha);

COMMENT ON TABLE nomina_sua_lotes IS
  'Bitácora de archivos generados para importar al SUA, con el resultado de la importación.';
COMMENT ON COLUMN nomina_sua_lotes.errores_txt IS
  'El ErrImp*.txt que deja el SUA cuando rechaza renglones, pegado tal cual.';
