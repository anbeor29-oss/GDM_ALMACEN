-- ═══════════════════════════════════════════════════════════════════════════
-- Un tercero puede tener VARIOS roles a la vez
--
-- PARA QUÉ
-- Un banco es activo y pasivo al mismo tiempo: mi dinero depositado en él, y
-- el crédito que él me dio. Un cliente puede venderme algo y volverse
-- proveedor. Un proveedor puede quedar a deber y volverse deudor diverso.
--
-- No es un caso raro: en la balanza real que se analizó, 'AFIRME' aparece en
-- 102 Bancos Y en 205 Acreedores diversos. Son el mismo banco.
--
-- ── LO QUE HABÍA ──
--   CHECK (party_type IN ('CUSTOMER','SUPPLIER'))   ← un solo rol
--   UNIQUE (company_id, rfc)                        ← un solo registro por RFC
--
-- Las dos juntas hacen IMPOSIBLE representarlo: no se puede marcar como los
-- dos, y tampoco crear dos registros. El import de CFDI ya choca contra esto
-- —"El RFC ya está registrado como SUPPLIER"— y no había forma de salir.
--
-- ── LO QUE NO SE HACE, Y ES DELIBERADO ──
-- NO se quita el UNIQUE del RFC. Duplicar al tercero sería la salida fácil y
-- es la peor: dos expedientes del mismo banco que se editan por separado,
-- dos veces el mismo saldo en la lista, y ninguna forma de saber cuál es el
-- bueno. Un tercero, un registro, varios roles.
--
-- ── Y UNA ADVERTENCIA CONTABLE ──
-- Que sea un solo tercero NO significa que sus saldos se netean. Lo que AFIRME
-- me debe va en el activo y lo que yo le debo va en el pasivo, cada uno en su
-- cuenta, sin restarse. Compensar activo contra pasivo está prohibido salvo
-- derecho legal de compensación (NIF A-7 y C-19), y hacerlo esconde a la vez
-- la liquidez y la deuda.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Los roles, como banderas independientes ──
ALTER TABLE customers ADD COLUMN IF NOT EXISTS es_cliente   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS es_proveedor BOOLEAN NOT NULL DEFAULT FALSE;
-- Deudor/acreedor diverso: el tercero que no vende ni compra, pero debe o le
-- deben. El préstamo del banco vive aquí.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS es_acreedor  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS es_deudor    BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Se llenan desde lo que ya había ──
UPDATE customers SET es_cliente   = TRUE WHERE party_type = 'CUSTOMER' AND NOT es_cliente;
UPDATE customers SET es_proveedor = TRUE WHERE party_type = 'SUPPLIER' AND NOT es_proveedor;

-- ── 3. party_type admite BOTH, y pasa a ser columna DERIVADA ──
--
-- Se conserva porque hay código que la lee, y porque el paso 1 de deprecar es
-- dejar de ESCRIBIRLA, no borrarla de golpe. La verdad ahora son las banderas.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_party_type;
ALTER TABLE customers ADD CONSTRAINT chk_party_type
  CHECK (party_type IN ('CUSTOMER', 'SUPPLIER', 'BOTH', 'OTHER'));

-- ── 4. Un tercero tiene que ser ALGO ──
--
-- ⚠️ NOT VALID, y es deliberado.
--
-- El relleno de arriba cubre a quien traía party_type 'CUSTOMER' o 'SUPPLIER'.
-- Pero la columna admitía NULL —un CHECK no rechaza NULL, sólo FALSE— así que
-- puede haber filas viejas sin ningún party_type. Ésas se quedarían sin rol, y
-- un CHECK normal recorre TODA la tabla al crearse: la migración fallaría y con
-- ella el arranque del servicio.
--
-- Con NOT VALID la regla se aplica a todo lo que se inserte o modifique desde
-- ahora, y las filas viejas quedan señaladas en vez de tumbar el despliegue.
--
-- La alternativa era adivinar: marcar como cliente a todo el que no tuviera
-- rol. Un proveedor mal marcado se cuela en la lista de clientes y nadie lo
-- nota — es exactamente el tipo de dato inventado que después se defiende solo.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS chk_tercero_con_rol;
ALTER TABLE customers ADD CONSTRAINT chk_tercero_con_rol
  CHECK (es_cliente OR es_proveedor OR es_acreedor OR es_deudor) NOT VALID;

-- Se deja constancia de cuántas quedaron sin rol, para poder resolverlas.
DO $aviso$
DECLARE
  n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM customers
   WHERE NOT (es_cliente OR es_proveedor OR es_acreedor OR es_deudor);
  IF n > 0 THEN
    RAISE NOTICE '[migracion] % tercero(s) quedaron sin rol: tenian party_type nulo. '
                 'Se pueden ver con: SELECT id, rfc, business_name FROM customers '
                 'WHERE NOT (es_cliente OR es_proveedor OR es_acreedor OR es_deudor);', n;
  END IF;
END
$aviso$;

-- ── 5. party_type se mantiene sola ──
--
-- Va en la base y no en TypeScript porque a `customers` le escriben el POS, el
-- import de CFDI, el preregistro de proveedores y la pantalla de clientes. Una
-- regla repetida en cuatro lugares es una regla que en el quinto se olvida.
CREATE OR REPLACE FUNCTION sincronizar_party_type()
RETURNS TRIGGER AS $$
BEGIN
  NEW.party_type :=
    CASE
      WHEN NEW.es_cliente AND NEW.es_proveedor THEN 'BOTH'
      WHEN NEW.es_cliente                      THEN 'CUSTOMER'
      WHEN NEW.es_proveedor                    THEN 'SUPPLIER'
      ELSE 'OTHER'          -- sólo acreedor o deudor diverso
    END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sincronizar_party_type ON customers;
CREATE TRIGGER trg_sincronizar_party_type
  BEFORE INSERT OR UPDATE OF es_cliente, es_proveedor, es_acreedor, es_deudor
  ON customers
  FOR EACH ROW EXECUTE FUNCTION sincronizar_party_type();

-- Se corre una vez sobre lo existente para dejar party_type consistente.
--
-- Filtrado a los que YA tienen algun rol, y no es un detalle: NOT VALID exime
-- del escaneo inicial, pero NO de los UPDATE posteriores. Sin el WHERE, este
-- mismo UPDATE tocaria las filas sin rol y las estrellaria contra el CHECK que
-- se acaba de crear — tumbando la migracion por el arreglo que la iba a salvar.
UPDATE customers SET es_cliente = es_cliente
 WHERE es_cliente OR es_proveedor OR es_acreedor OR es_deudor;

-- ── 6. Índices por rol ──
-- Parciales: la lista de proveedores no tiene por qué recorrer a los clientes.
CREATE INDEX IF NOT EXISTS ix_customers_es_cliente
  ON customers(company_id) WHERE es_cliente AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_customers_es_proveedor
  ON customers(company_id) WHERE es_proveedor AND deleted_at IS NULL;
