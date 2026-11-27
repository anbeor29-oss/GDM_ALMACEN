/**
 * Pruebas del motor de archivos para el SUA.
 *
 * Los casos de abajo no son salidas copiadas del código: las longitudes y las
 * escalas se midieron contra la base del SUA 3.7.1 en producción y sus propios
 * .txt exportados (los créditos cuadraron 21 de 21). Los datos personales son
 * inventados; lo que se prueba es el formato.
 */
import {
  asegLinea, afilLinea, movtLinea, credLinea, nombreSua,
  sexoDesdeCurp, entidadDesdeCurp, valorDescuentoSua, validarArchivoSua,
  generarAltas, TrabajadorSua,
} from './sua-export';

const trabajador: TrabajadorSua = {
  registroPatronal: 'A0168727103',
  nss: '51018203185',
  rfc: 'PEGJ850315HN1',
  curp: 'PEGJ850315HASRRN08',
  apellidoPaterno: 'PEREZ',
  apellidoMaterno: 'GARCIA',
  nombre: 'JUAN CARLOS',
  fechaAlta: '2026-01-16',
  sbc: 185.91,
  codigoPostal: '20310',
  fechaNacimiento: '1985-03-15',
};

describe('longitudes de renglón', () => {
  it('Aseg.txt mide 168, Afil.txt 80, Movt.txt 49 y Cred.txt 52', () => {
    expect(asegLinea(trabajador)).toHaveLength(168);
    expect(afilLinea(trabajador)).toHaveLength(80);
    expect(movtLinea({ registroPatronal: 'A0168727103', nss: '51018203185', tipo: 'BAJA', fecha: '2026-02-28' }))
      .toHaveLength(49);
    expect(credLinea({
      registroPatronal: 'A0168727103', nss: '51018203185', numCredito: '0122000615',
      tipo: 'INICIO', fecha: '2022-02-04', tipoDescuento: 'cuota_fija', valorDescuento: 1424.91,
    })).toHaveLength(52);
  });
});

describe('Aseg.txt', () => {
  const l = asegLinea(trabajador);

  it('pone registro patronal, NSS, RFC y CURP en su lugar', () => {
    expect(l.slice(0, 11)).toBe('A0168727103');
    expect(l.slice(11, 22)).toBe('51018203185');
    expect(l.slice(22, 35)).toBe('PEGJ850315HN1');
    expect(l.slice(35, 53)).toBe('PEGJ850315HASRRN08');
  });

  it('escribe el nombre como PATERNO$MATERNO$NOMBRES', () => {
    expect(l.slice(53, 103).trimEnd()).toBe('PEREZ$GARCIA$JUAN CARLOS');
  });

  it('manda la fecha de alta en DDMMAAAA y el salario en centavos', () => {
    expect(l.slice(105, 113)).toBe('16012026');
    expect(l.slice(113, 120)).toBe('0018591');   // 185.91
  });

  it('deja el bloque del crédito en blanco cuando no hay crédito', () => {
    expect(l.slice(137, 147)).toBe(' '.repeat(10));  // número de crédito
    expect(l.slice(147, 164)).toBe('0'.repeat(17));  // fecha + tipo + valor
    expect(l.slice(164, 165)).toBe('0');             // pensionado
  });

  it('llena el bloque del crédito cuando lo trae el expediente', () => {
    const conCredito = asegLinea({
      ...trabajador,
      numCredito: '0107028664', tipoDescuento: 'vsm',
      valorDescuento: 8.51, fechaDescuento: '2020-01-01',
    });
    expect(conCredito.slice(137, 147)).toBe('0107028664');
    expect(conCredito.slice(147, 155)).toBe('01012020');
    expect(conCredito.slice(155, 156)).toBe('3');
    expect(conCredito.slice(156, 164)).toBe('00085100');
  });
});

describe('Afil.txt', () => {
  const l = afilLinea(trabajador);

  it('saca el CP y la fecha de nacimiento del expediente', () => {
    expect(l.slice(22, 27)).toBe('20310');
    expect(l.slice(27, 35)).toBe('15031985');
  });

  it('deduce la entidad de nacimiento del CURP', () => {
    expect(l.slice(35, 60)).toBe('AGUASCALIENTES'.padEnd(25, ' '));
    expect(l.slice(60, 62)).toBe('01');
  });

  it('deduce el sexo del CURP y respeta los valores por omisión', () => {
    expect(l.slice(62, 65)).toBe('000');  // UMF
    expect(l.slice(77, 78)).toBe('M');    // sexo
    expect(l.slice(78, 79)).toBe('0');    // tipo de salario: fijo
  });
});

describe('Movt.txt', () => {
  it('la baja va con tipo 02 y salario en ceros', () => {
    const l = movtLinea({
      registroPatronal: 'A0168727103', nss: '51018203185',
      tipo: 'BAJA', fecha: '2026-04-29', sbc: 185.91,
    });
    expect(l.slice(22, 24)).toBe('02');
    expect(l.slice(24, 32)).toBe('29042026');
    expect(l.slice(32, 40)).toBe(' '.repeat(8));
    expect(l.slice(40, 49)).toBe('0'.repeat(9));
  });

  it('la modificación de salario va con tipo 07 y el salario en centavos', () => {
    const l = movtLinea({
      registroPatronal: 'A0168727103', nss: '51018203185',
      tipo: 'MODIFICACION', fecha: '2026-01-01', sbc: 217.67,
    });
    expect(l.slice(22, 24)).toBe('07');
    expect(l.slice(40, 49)).toBe('000021767');
  });

  it('el reingreso va con tipo 08', () => {
    const l = movtLinea({
      registroPatronal: 'A0168727103', nss: '51018203185',
      tipo: 'REINGRESO', fecha: '2026-03-01', sbc: 292.54,
    });
    expect(l.slice(22, 24)).toBe('08');
    expect(l.slice(40, 49)).toBe('000029254');
  });
});

describe('Cred.txt', () => {
  const base = {
    registroPatronal: 'A0168727103', nss: '51018203185', numCredito: '0122000615',
    fecha: '2022-02-04',
  } as const;

  it('la cuota fija lleva 3 decimales implícitos', () => {
    // Verificado contra la base: 1,424.91 se escribe 01424910.
    const l = credLinea({ ...base, tipo: 'INICIO', tipoDescuento: 'cuota_fija', valorDescuento: 1424.91 });
    expect(l.slice(22, 32)).toBe('0122000615');
    expect(l.slice(32, 34)).toBe('15');
    expect(l.slice(34, 42)).toBe('04022022');
    expect(l.slice(42, 43)).toBe('2');
    expect(l.slice(43, 51)).toBe('01424910');
    expect(l.slice(51, 52)).toBe('N');
  });

  it('el factor VSM lleva 4 decimales implícitos', () => {
    // Verificado contra la base: 8.51 se escribe 00085100.
    const l = credLinea({ ...base, tipo: 'SUSPENSION', tipoDescuento: 'vsm', valorDescuento: 8.51 });
    expect(l.slice(32, 34)).toBe('16');
    expect(l.slice(42, 43)).toBe('3');
    expect(l.slice(43, 51)).toBe('00085100');
  });

  it('distingue reinicio de modificación del valor', () => {
    const r = credLinea({ ...base, tipo: 'REINICIO', tipoDescuento: 'vsm', valorDescuento: 19.21 });
    const m = credLinea({ ...base, tipo: 'MODIFICACION_VALOR', tipoDescuento: 'cuota_fija', valorDescuento: 2050.7 });
    expect(r.slice(32, 34)).toBe('17');
    expect(r.slice(43, 51)).toBe('00192100');
    expect(m.slice(32, 34)).toBe('19');
    expect(m.slice(43, 51)).toBe('02050700');
  });
});

describe('derivaciones del CURP', () => {
  it('la M del CURP es Mujer y en el SUA se escribe F', () => {
    expect(sexoDesdeCurp('PEGJ850315MASRRN08')).toBe('F');
    expect(sexoDesdeCurp('PEGJ850315HASRRN08')).toBe('M');
    expect(sexoDesdeCurp('')).toBe(' ');
  });

  it('traduce la entidad del CURP a la clave del IMSS', () => {
    expect(entidadDesdeCurp('PEGJ850315HASRRN08')).toEqual({ clave: '01', nombre: 'AGUASCALIENTES' });
    expect(entidadDesdeCurp('PEGJ850315HNLRRN08')).toEqual({ clave: '19', nombre: 'NUEVO LEON' });
    expect(entidadDesdeCurp('PEGJ850315HDFRRN08')).toEqual({ clave: '09', nombre: 'DISTRITO FEDERAL' });
    // Un CURP que no trae entidad conocida no inventa una.
    expect(entidadDesdeCurp('PEGJ850315HXXRRN08')).toEqual({ clave: '', nombre: '' });
  });
});

describe('nombre y valores', () => {
  it('no deja que un $ del nombre rompa el campo', () => {
    expect(nombreSua('O$BRIEN', '', 'ANA')).toBe('O BRIEN$$ANA');
  });

  it('el valor del descuento redondea a la escala de su tipo', () => {
    // La cuota fija llega al milésimo; lo que sobra se redondea, no se trunca.
    expect(valorDescuentoSua('cuota_fija', 1424.91)).toBe('01424910');
    expect(valorDescuentoSua('cuota_fija', 1424.9148)).toBe('01424915');
    // El factor llega al diezmilésimo.
    expect(valorDescuentoSua('vsm', 8.5104)).toBe('00085104');
    expect(valorDescuentoSua('vsm', 8.51048)).toBe('00085105');
    expect(valorDescuentoSua('cuota_fija', 0)).toBe('00000000');
  });
});

describe('archivos y revisión', () => {
  it('las altas generan Aseg y Afil, con CRLF', () => {
    const archivos = generarAltas([trabajador, { ...trabajador, nss: '51058205082' }]);
    expect(archivos.map((a) => a.nombre)).toEqual(['Aseg.txt', 'Afil.txt']);
    expect(archivos[0].renglones).toBe(2);
    expect(archivos[0].contenido.endsWith('\r\n')).toBe(true);
    expect(archivos[0].contenido.split('\r\n').filter(Boolean)).toHaveLength(2);
  });

  it('puede dejar fuera los datos afiliatorios', () => {
    expect(generarAltas([trabajador], {}, false).map((a) => a.nombre)).toEqual(['Aseg.txt']);
  });

  it('no genera un archivo vacío', () => {
    expect(() => generarAltas([])).toThrow(/No hay altas/);
  });

  it('la revisión caza longitudes y NSS malos', () => {
    const bueno = generarAltas([trabajador], {}, false)[0].contenido;
    expect(validarArchivoSua('Aseg', bueno).ok).toBe(true);

    const malo = 'A0168727103ABCDEFGHIJK' + ' '.repeat(50);
    const r = validarArchivoSua('Aseg', malo);
    expect(r.ok).toBe(false);
    expect(r.problemas.some((p) => /NSS inválido/.test(p.texto))).toBe(true);
    expect(r.problemas.some((p) => /Longitud/.test(p.texto))).toBe(true);
  });

  it('la revisión rechaza un tipo de movimiento que el SUA no espera en Movt.txt', () => {
    const linea = 'A0168727103' + '51018203185' + '01' + '16012026' + ' '.repeat(8) + '0'.repeat(9);
    const r = validarArchivoSua('Movt', linea);
    expect(r.ok).toBe(false);
    expect(r.problemas[0].texto).toMatch(/Tipo de movimiento "01"/);
  });
});
