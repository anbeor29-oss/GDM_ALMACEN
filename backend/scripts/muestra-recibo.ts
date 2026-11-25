/**
 * muestra-recibo — genera el RECIBO DE NÓMINA en formato «detallado» con datos
 * inventados y SIN tocar la base.
 *
 * Mismo motivo que muestra-formatos: un recibo se revisa mirándolo, y la única
 * alternativa era cerrar un periodo de prueba y timbrarlo.
 *
 *   npx ts-node scripts/muestra-recibo.ts [archivo-destino.pdf]
 */

import './_entorno-postizo';   // PRIMERO: ver el comentario de ese archivo

import fs from 'fs';
import path from 'path';
import { renderReciboDetallado } from '../src/modules/nomina/pdf-recibo-detallado';

const SELLO =
  'cmH2E09J9BSrVlAkJquZSD2XhRfD1IIoTjM+RYWAVxMFGCE0O+QF4Sm+v9qN0yjiX3uf6rODcRIcpwHsh3QYP2XVxQ4/XzKjkwqdz' +
  '5k5oo41318xt439xWseCHhC7IEJcJkDqDKXxanIeCIh9zDyzAkN9livY58K6+Vxex6Jh2lAqmazKdM2f29VaI+QXKFFsM041pQjgDz' +
  'njL/rnQfsHYRZLxx84ICZgTfMgqA4SQaITquz1qWpS4g2eI2ws5GeUYiri4Jk69YjKoVEMUvdqX/PDgpQBpo/hGHQ20sL3n5mzK5TS==';

async function main() {
  const destino = process.argv[2] || path.resolve(__dirname, '..', 'muestras-formatos', 'recibo-detallado.pdf');
  fs.mkdirSync(path.dirname(destino), { recursive: true });

  const buf = await renderReciboDetallado({
    emisorNom: 'EMPRESA DE DEMOSTRACIÓN SA DE CV',
    emisorRfc: 'EKU9003173C9',
    emisorReg: '601',
    registroPatronal: 'B5510768108',
    receptorNom: 'Blanca Estela Sánchez Guevara',
    receptorRfc: 'SAGB721004PS2',
    serieFolio: 'N-3075',
    fechaComp: '2026-11-15T17:33:11',
    lugarExp: '64000',
    metodoPago: 'PUE',
    subTotal: 18_500,
    descuento: 4_312.4,
    total: 14_187.6,
    percepciones: [
      { tipo: '001', clave: '001', concepto: 'Sueldos, salarios, rayas y jornales', gravado: 15_000, exento: 0, importe: 15_000 },
      { tipo: '029', clave: '014', concepto: 'Vales de despensa', gravado: 1_200, exento: 1_800, importe: 3_000 },
      { tipo: '049', clave: '021', concepto: 'Participación de los trabajadores en las utilidades', gravado: 0, exento: 500, importe: 500 },
    ],
    deducciones: [
      { tipo: '002', clave: '002', concepto: 'ISR', importe: 2_412.4 },
      { tipo: '001', clave: '001', concepto: 'Seguridad social', importe: 900 },
      { tipo: '004', clave: '004', concepto: 'Otros (crédito INFONAVIT)', importe: 1_000 },
    ],
    otrosPagos: [
      { tipo: '002', clave: '002', concepto: 'Subsidio para el empleo', gravado: 0, exento: 0, importe: 0 },
    ],
    nom: { NumDiasPagados: '15', FechaPago: '2026-11-15' },
    recp: {
      NumEmpleado: '0476', Curp: 'SAGB721004MDFNVL02', NumSeguridadSocial: '12345678901',
      TipoContrato: '01', TipoRegimen: '02', Departamento: 'Administración',
    },
    rec: {
      num_empleado: '0476', periodo_numero: 22, anio: 2026,
      fecha_inicio: '2026-11-01', fecha_fin: '2026-11-15', fecha_pago: '2026-11-15',
      curp: 'SAGB721004MDFNVL02', nss: '12345678901', departamento: 'Administración',
    },
    timbrado: true,
    uuid: '24E9E07B-28FF-4BDA-A35F-A6CED9235130',
    fechaTimbrado: '2026-11-15T17:33:22',
    noCertificado: '00001000000725815569',
    noCertificadoSat: '00001000000709182898',
    rfcProvCertif: 'SFE1512038N1',
    selloCfd: SELLO,
    selloSat: SELLO,
    logo: null,
  });

  fs.writeFileSync(destino, buf);
  console.log(`  ${destino}  (${(buf.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
