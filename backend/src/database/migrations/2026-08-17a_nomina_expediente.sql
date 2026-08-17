-- ============================================================================
-- NÓMINA — EXPEDIENTE DEL PERSONAL Y PARÁMETROS PATRONALES
--
-- QUÉ SE REVISÓ ANTES DE DECIDIR LA FORMA
-- El sistema de nómina que se integra (NOM_COM_1) guarda la empresa en su
-- propia tabla `empresas`, con RFC, razón social, régimen fiscal, domicilio y
-- el CSD en base64. TODO ESO YA EXISTE EN `companies` DE NEXO, y el CSD además
-- ya se captura y se cifra por el módulo de facturación. Duplicarlo sería
-- pedirle al usuario los mismos datos dos veces y —peor— abrir la puerta a que
-- se timbre con un certificado distinto al de facturación.
--
-- Por eso esta migración NO crea una tabla de empresas de nómina. Le agrega a
-- `companies` únicamente los tres datos que el módulo de nómina necesita y que
-- hoy no existen en ningún lado:
--
--   · registro_patronal        — el registro ante el IMSS. Va en el CFDI de
--                                nómina (nomina12:Emisor/@RegistroPatronal) y
--                                sin él no se puede timbrar un recibo.
--   · prima_riesgo             — la prima del Seguro de Riesgos de Trabajo que
--                                el IMSS determina para cada patrón. Es la
--                                única cuota que NO es un porcentaje fijo de
--                                ley: cambia por empresa y se revisa cada año.
--   · factor de integración    — los días de aguinaldo y el % de prima
--                                vacacional con los que se calcula el SDI.
--                                La LFT fija MÍNIMOS (15 días y 25%); una
--                                empresa puede dar más, y eso sube el SDI y
--                                por lo tanto las cuotas. Se guarda por empresa
--                                porque es una política de la empresa, no una
--                                constante del país.
--
-- POR QUÉ EL EXPEDIENTE ES UNA TABLA NUEVA Y NO SE CUELGA DE `users`
-- Un trabajador de nómina y un usuario del sistema son cosas distintas: el
-- 90% de la plantilla nunca va a entrar al ERP, y quien sí entra (el contador
-- externo, por ejemplo) no siempre está en la nómina. Mezclarlos obligaría a
-- que dar de alta a un obrero creara una credencial de acceso.
--
-- LO QUE NO TRAE ESTA MIGRACIÓN
-- Ni periodos, ni recibos, ni acumulados, ni el motor de cálculo. Esta es la
-- capa que el resto necesita para existir; lo demás depende de decisiones que
-- todavía no están tomadas y no se inventan aquí.
--
-- NO SE IMPORTA UN SOLO DATO del sistema anterior: las tablas nacen vacías.
-- ============================================================================

/* ── 1. Lo que le falta a la empresa para ser patrón ───────────────────── */

ALTER TABLE companies ADD COLUMN IF NOT EXISTS registro_patronal VARCHAR(11);

/* La prima de riesgo se expresa con cinco decimales porque así la publica el
 * IMSS en la determinación anual (p. ej. 0.54355). Redondearla a dos mueve la
 * cuota patronal. El rango del CHECK son los límites del Art. 72 LSS. */
ALTER TABLE companies ADD COLUMN IF NOT EXISTS prima_riesgo NUMERIC(8,5);

/* Factores de integración del SDI (Art. 84 LSS). Se dejan NULL a propósito:
 * un valor por omisión invisible haría que el primer cálculo saliera con la
 * política de otra empresa. La pantalla de Parámetros propone los mínimos de
 * ley y pide confirmarlos. */
ALTER TABLE companies ADD COLUMN IF NOT EXISTS fi_aguinaldo_dias INTEGER;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS fi_prima_vac_pct  NUMERIC(5,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_prima_riesgo_ck'
  ) THEN
    ALTER TABLE companies ADD CONSTRAINT companies_prima_riesgo_ck
      CHECK (prima_riesgo IS NULL OR (prima_riesgo >= 0.5 AND prima_riesgo <= 15));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_fi_aguinaldo_ck'
  ) THEN
    /* 15 días es el mínimo del Art. 87 LFT. Se puede dar más, nunca menos. */
    ALTER TABLE companies ADD CONSTRAINT companies_fi_aguinaldo_ck
      CHECK (fi_aguinaldo_dias IS NULL OR (fi_aguinaldo_dias >= 15 AND fi_aguinaldo_dias <= 365));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_fi_prima_vac_ck'
  ) THEN
    /* 25% es el mínimo del Art. 80 LFT. */
    ALTER TABLE companies ADD CONSTRAINT companies_fi_prima_vac_ck
      CHECK (fi_prima_vac_pct IS NULL OR (fi_prima_vac_pct >= 25 AND fi_prima_vac_pct <= 100));
  END IF;
END $$;

COMMENT ON COLUMN companies.registro_patronal IS
  'Registro patronal ante el IMSS. Va en nomina12:Emisor/@RegistroPatronal.';
COMMENT ON COLUMN companies.prima_riesgo IS
  'Prima del Seguro de Riesgos de Trabajo determinada por el IMSS (Art. 72 LSS).';
COMMENT ON COLUMN companies.fi_aguinaldo_dias IS
  'Días de aguinaldo con que se integra el SDI. Mínimo legal 15 (Art. 87 LFT).';
COMMENT ON COLUMN companies.fi_prima_vac_pct IS
  'Prima vacacional %. Mínimo legal 25 (Art. 80 LFT).';


/* ── 2. Catálogo de puestos ────────────────────────────────────────────── */

/* Es de la empresa y no global: "Ayudante A" no significa lo mismo en un taller
 * que en una comercializadora, y el catálogo global del sistema anterior hacía
 * que una empresa viera los puestos inventados por otra. */
CREATE TABLE IF NOT EXISTS nomina_puestos (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nombre      VARCHAR(100) NOT NULL,
  /* c_RiesgoPuesto del Anexo 20: 1 Clase I … 5 Clase V. Va en el CFDI. */
  riesgo_puesto CHAR(1),
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT nomina_puestos_riesgo_ck
    CHECK (riesgo_puesto IS NULL OR riesgo_puesto IN ('1','2','3','4','5'))
);

/* Sin distinguir mayúsculas ni espacios: "Chofer" y "CHOFER " son el mismo
 * puesto y tenerlos dos veces parte los reportes por departamento. */
CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_puestos_nombre
  ON nomina_puestos (company_id, UPPER(TRIM(nombre)));


/* ── 3. Expediente del trabajador ──────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS nomina_empleados (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  /* ── Identificación ── */
  num_empleado VARCHAR(15) NOT NULL,
  nombre       VARCHAR(100) NOT NULL,
  apellido_pat VARCHAR(100) NOT NULL,
  apellido_mat VARCHAR(100),

  /* RFC de persona física: 4 letras + 6 dígitos + 3 de homoclave. El CFDI se
   * rechaza si no cumple, así que se valida aquí y no sólo en la pantalla. */
  rfc  VARCHAR(13) NOT NULL,
  curp CHAR(18) NOT NULL,
  /* NSS: 11 dígitos. Se permite NULL porque hay altas donde el IMSS todavía no
   * lo ha asignado; sin él no se puede timbrar y el sistema lo advierte. */
  nss  VARCHAR(11),

  fecha_nacimiento DATE,
  email            VARCHAR(255),
  telefono         VARCHAR(20),
  /* Foto como data URI. Igual que en el sistema anterior: son unas decenas de
   * KB por trabajador y evita depender de un almacén de archivos externo en un
   * servidor efímero. */
  foto             TEXT,

  /* ── Domicilio fiscal del trabajador ── */
  /* El CP del trabajador es obligatorio en el CFDI 4.0
   * (cfdi:Receptor/@DomicilioFiscalReceptor) y tiene que coincidir con el que
   * el SAT tiene registrado, o el timbrado se cae con CFDI40147. */
  codigo_postal VARCHAR(5),
  calle         VARCHAR(255),
  num_exterior  VARCHAR(20),
  num_interior  VARCHAR(20),
  colonia       VARCHAR(150),
  municipio     VARCHAR(150),
  estado        VARCHAR(100),

  /* ── Datos fiscales del receptor ── */
  regimen_fiscal VARCHAR(3)  NOT NULL DEFAULT '605',  -- 605 Sueldos y salarios
  uso_cfdi       VARCHAR(5)  NOT NULL DEFAULT 'CN01', -- CN01 Nómina

  /* ── Relación laboral ── */
  puesto_id      UUID REFERENCES nomina_puestos(id) ON DELETE SET NULL,
  /* Se conserva el texto además del catálogo: al importar de un XML llega el
   * puesto escrito y todavía no hay a qué apuntar. */
  puesto         VARCHAR(100),
  departamento   VARCHAR(100),
  fecha_ingreso  DATE NOT NULL,
  fecha_baja     DATE,
  fecha_reingreso DATE,
  /* c_TipoContrato del Anexo 20 (01 indeterminado, 02 por obra, …). */
  tipo_contrato  VARCHAR(2) NOT NULL DEFAULT '01',
  /* c_TipoRegimen (02 sueldos, 09 asimilados honorarios, …). */
  tipo_regimen   VARCHAR(2) NOT NULL DEFAULT '02',
  /* c_TipoJornada (01 diurna, 02 nocturna, 03 mixta, …). */
  tipo_jornada   VARCHAR(2),
  /* c_PeriodicidadPago: 02 semanal, 04 quincenal, 05 mensual, 99 otra. */
  periodicidad_pago VARCHAR(2) NOT NULL DEFAULT '04',
  /* O ordinaria / E extraordinaria (finiquitos, PTU, aguinaldo aparte). */
  tipo_nomina    CHAR(1) NOT NULL DEFAULT 'O',
  /* c_Estado — donde se presta el servicio. Determina el Impuesto Sobre
   * Nómina estatal, que no es el mismo en todo el país. */
  entidad_federativa VARCHAR(3),
  /* Zona salarial: cambia el salario mínimo aplicable y con él la exención. */
  zona_geografica VARCHAR(20) NOT NULL DEFAULT 'general',

  /* ── Salario ── */
  salario_diario            NUMERIC(12,2) NOT NULL DEFAULT 0,
  /* SDI = salario diario × factor de integración. Se guarda calculado y no se
   * deriva al vuelo porque el IMSS lo congela al momento del aviso: recalcular
   * hoy un recibo de hace tres meses con el SDI de hoy da otra cuota. */
  salario_diario_integrado  NUMERIC(12,2) NOT NULL DEFAULT 0,
  /* Salario base de cotización topado a 25 UMA (Art. 28 LSS). */
  sbc                       NUMERIC(12,2),
  /* Banco y cuenta para la dispersión. La CLABE son 18 dígitos. */
  banco_clave  VARCHAR(3),
  cuenta_clabe VARCHAR(18),

  /* ── INFONAVIT ── */
  tiene_infonavit           BOOLEAN NOT NULL DEFAULT false,
  infonavit_num_credito     VARCHAR(20),
  /* porcentaje | cuota_fija | vsm — las tres formas del Art. 29 Fr. III LFINF */
  infonavit_tipo_descuento  VARCHAR(12),
  infonavit_descuento       NUMERIC(12,4),
  infonavit_seguro_danos    NUMERIC(12,2) NOT NULL DEFAULT 0,

  /* ── Pensión alimenticia (Art. 110 Fr. V LFT — orden judicial) ── */
  tiene_pension_alimenticia BOOLEAN NOT NULL DEFAULT false,
  pension_tipo              VARCHAR(12),
  pension_monto             NUMERIC(12,4),
  pension_beneficiario      VARCHAR(255),
  pension_num_oficio        VARCHAR(60),

  activo     BOOLEAN NOT NULL DEFAULT true,
  /* Control de edición concurrente, igual que invoices/customers/products. */
  edicion    INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,

  CONSTRAINT nomina_empleados_rfc_ck
    CHECK (rfc ~ '^[A-ZÑ&]{4}[0-9]{6}[A-Z0-9]{3}$'),
  CONSTRAINT nomina_empleados_curp_ck
    CHECK (curp ~ '^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[A-Z0-9][0-9]$'),
  CONSTRAINT nomina_empleados_nss_ck
    CHECK (nss IS NULL OR nss ~ '^[0-9]{11}$'),
  CONSTRAINT nomina_empleados_clabe_ck
    CHECK (cuenta_clabe IS NULL OR cuenta_clabe ~ '^[0-9]{18}$'),
  CONSTRAINT nomina_empleados_cp_ck
    CHECK (codigo_postal IS NULL OR codigo_postal ~ '^[0-9]{5}$'),
  CONSTRAINT nomina_empleados_tipo_nomina_ck
    CHECK (tipo_nomina IN ('O','E')),
  CONSTRAINT nomina_empleados_zona_ck
    CHECK (zona_geografica IN ('general','frontera_norte')),
  CONSTRAINT nomina_empleados_infonavit_ck
    CHECK (infonavit_tipo_descuento IS NULL
           OR infonavit_tipo_descuento IN ('porcentaje','cuota_fija','vsm')),
  CONSTRAINT nomina_empleados_pension_ck
    CHECK (pension_tipo IS NULL
           OR pension_tipo IN ('porcentaje','cuota_fija')),
  /* Una baja no puede ser anterior al ingreso. */
  CONSTRAINT nomina_empleados_fechas_ck
    CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_ingreso),
  CONSTRAINT nomina_empleados_salario_ck
    CHECK (salario_diario >= 0 AND salario_diario_integrado >= 0)
);

/* El número de empleado es único DENTRO de la empresa, no en toda la
 * plataforma: dos empresas distintas tienen cada una su empleado 001. El
 * sistema anterior lo tenía global porque atendía a una sola empresa. */
CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_empleados_num
  ON nomina_empleados (company_id, UPPER(TRIM(num_empleado)))
  WHERE deleted_at IS NULL;

/* El RFC también: repetirlo dentro de la misma empresa significa que alguien
 * quedó dado de alta dos veces, y eso duplica el CFDI anual del trabajador.
 * Entre empresas sí puede repetirse — hay quien trabaja en dos. */
CREATE UNIQUE INDEX IF NOT EXISTS uq_nomina_empleados_rfc
  ON nomina_empleados (company_id, rfc)
  WHERE deleted_at IS NULL;

/* El listado por omisión: la plantilla activa, en orden alfabético. */
CREATE INDEX IF NOT EXISTS ix_nomina_empleados_activos
  ON nomina_empleados (company_id, activo, apellido_pat, apellido_mat, nombre)
  WHERE deleted_at IS NULL;

/* La búsqueda por CURP la usa el importador de XML para no duplicar altas. */
CREATE INDEX IF NOT EXISTS ix_nomina_empleados_curp
  ON nomina_empleados (company_id, curp)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE nomina_empleados IS
  'Expediente del personal. Un trabajador NO es un usuario del sistema: la '
  'mayoría de la plantilla nunca entra al ERP.';
