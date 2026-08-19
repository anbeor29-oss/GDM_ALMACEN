-- ═══════════════════════════════════════════════════════════════════════════
-- El uniforme con costo se descuenta en el siguiente periodo
--
-- CÓMO ERA
-- `costo` existía "para poder descontarlo si se pierde", con la nota de que no
-- se descontaba solo. En la práctica eso significaba capturar la deducción a
-- mano, acordarse de hacerlo, y acordarse de NO volver a hacerlo el periodo
-- siguiente. Lo segundo es lo que falla: se descuenta dos veces y el trabajador
-- lo reclama.
--
-- CÓMO ES AHORA
-- Costo mayor a cero → se descuenta UNA vez, en el primer periodo que cierre
-- después de la fecha desde la que aplica. Costo cero o vacío → no hay
-- descuento, que es el caso normal: el uniforme lo pone la empresa.
--
-- POR QUÉ SE GUARDA EN QUÉ PERIODO SE DESCONTÓ
-- Porque es lo único que impide cobrarlo dos veces. Un marcador booleano
-- ("ya se descontó") no dice dónde, y cuando alguien reclama no hay forma de
-- enseñarle el recibo. Con el periodo se sabe, y si ese periodo se reabre el
-- descuento vuelve a quedar pendiente solo.
--
-- La clave del SAT es 017 "Adquisición de artículos que produce la empresa o
-- establecimiento" (Anexo 20, c_TipoDeduccion). No es la de daños (016): esa
-- es para lo que se rompe, no para lo que se le vende al trabajador.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE nomina_entregas
  /* Desde cuándo se puede descontar. Por omisión, el día de la entrega: lo
   * normal es que se cobre en el periodo siguiente al que se entregó. Se deja
   * capturable para el caso en que se pactó empezar a cobrarlo más adelante. */
  ADD COLUMN IF NOT EXISTS descontar_desde DATE,

  /* En qué periodo se cobró. NULL = todavía no. */
  ADD COLUMN IF NOT EXISTS descontado_periodo_id UUID
    REFERENCES nomina_periodos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS descontado_at TIMESTAMPTZ;

/* Las entregas que faltan por cobrar, que es lo que consulta la prenómina en
 * cada cálculo. El índice parcial deja fuera todo lo ya cobrado y lo que no
 * cuesta nada —que es la mayoría— y así se mantiene chico. */
CREATE INDEX IF NOT EXISTS nomina_entregas_por_cobrar_ix
  ON nomina_entregas (empleado_id, descontar_desde)
  WHERE descontado_periodo_id IS NULL AND costo > 0;

/* Lo que ya existe conserva su comportamiento: sin fecha desde la cual
 * descontar, no se cobra. Ponerles la fecha de entrega generaría de golpe un
 * descuento retroactivo por cada uniforme entregado hasta hoy. */
COMMENT ON COLUMN nomina_entregas.descontar_desde IS
  'Desde cuándo se puede cobrar. NULL = no se cobra (comportamiento anterior).';
