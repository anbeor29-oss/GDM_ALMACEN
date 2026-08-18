/*
 * El salario diario y el integrado, en su lugar — y que no se vuelvan a voltear.
 *
 * QUÉ PASÓ
 * El lector de XML de nómina mapeaba por NOMBRE de atributo: SalarioBaseCotApor
 * iba a salario_diario y SalarioDiarioIntegrado al integrado. Está mal por
 * definición —el SBC *es* el integrado, Art. 27 LSS—, así que los expedientes
 * cargados antes del arreglo quedaron con los dos campos cambiados. En la
 * pantalla se ve como un trabajador con diario de $336.29 y SDI de $320.49,
 * cuando la realidad es al revés.
 *
 * POR QUÉ SE PUEDE ENDEREZAR SIN PREGUNTAR
 * El salario diario integrado es el diario MÁS aguinaldo y prima vacacional
 * (Art. 84 LSS). El factor de integración nunca baja de 1, así que el integrado
 * nunca puede ser menor que el diario. Cuando lo es, no hay ambigüedad: están
 * volteados. Se ordenan —el menor al diario, el mayor al integrado— y ya.
 *
 * QUÉ CAMBIA EN LOS NÚMEROS
 * Todo lo que cuelga del SDI: la cuota obrera del IMSS (Art. 36 y 106 LSS), el
 * descuento de INFONAVIT por porcentaje y las indemnizaciones del finiquito
 * (Art. 89 LFT). Con los campos volteados el IMSS se calculaba sobre un SDI
 * demasiado bajo —se retenía de menos— y el sueldo del periodo salía inflado,
 * porque el sueldo se paga con el diario.
 *
 * EL CANDADO
 * Después de enderezar se pone un CHECK. Sin él, la próxima captura a mano
 * vuelve a meter el error y nadie se entera hasta que el IMSS lo cobre. El
 * orden importa: primero se corrigen las filas, luego se restringe — al revés
 * el ALTER truena contra los datos que ya están.
 */

/* Los recibos YA TIMBRADOS no se tocan: llevan el importe con el que se pagó y
 * con el que se declaró. Corregir el expediente es hacia adelante. */

UPDATE nomina_empleados
   SET salario_diario            = salario_diario_integrado,
       salario_diario_integrado  = salario_diario,
       updated_at                = NOW()
 WHERE salario_diario_integrado > 0
   AND salario_diario > 0
   AND salario_diario_integrado < salario_diario;

/* Si el SDI venía en cero o nulo se deja el diario: es lo que ya hacía el
 * cálculo en memoria, y así el CHECK no rechaza expedientes a medio capturar
 * que todavía son válidos —el aviso de la prenómina ya los señala—. */
UPDATE nomina_empleados
   SET salario_diario_integrado = salario_diario,
       updated_at               = NOW()
 WHERE salario_diario > 0
   AND (salario_diario_integrado IS NULL OR salario_diario_integrado = 0);

ALTER TABLE nomina_empleados
  DROP CONSTRAINT IF EXISTS nomina_empleados_sdi_ck;

ALTER TABLE nomina_empleados
  ADD CONSTRAINT nomina_empleados_sdi_ck
  CHECK (
    salario_diario_integrado = 0
    OR salario_diario = 0
    OR salario_diario_integrado >= salario_diario
  );

COMMENT ON CONSTRAINT nomina_empleados_sdi_ck ON nomina_empleados IS
  'El integrado nunca puede ser menor que el diario: el factor de integración '
  'del Art. 84 LSS no baja de 1. Si pasa, están capturados al revés.';
