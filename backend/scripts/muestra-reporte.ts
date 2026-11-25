/**
 * muestra-reporte — genera un reporte tabular de ejemplo, con datos inventados
 * y SIN tocar la base.
 *
 * Sirve para revisar de un vistazo lo que comparten TODOS los reportes de
 * Contabilidad, Nómina, Tesorería y e-commerce: el encabezado de la casa, el
 * corte de páginas, la fila de totales, las firmas y el pie de GDM NEXO. Si se
 * toca utils/reporte-pdf, esto enseña el resultado sin tener que armar una
 * balanza real.
 *
 *   npx ts-node scripts/muestra-reporte.ts [archivo-destino.pdf]
 */

import './_entorno-postizo';   // PRIMERO: ver el comentario de ese archivo

import fs from 'fs';
import path from 'path';
import { reporteTablaPdf } from '../src/utils/reporte-pdf';

async function main() {
  const destino = process.argv[2] || path.resolve(__dirname, '..', 'muestras-formatos', 'reporte.pdf');
  fs.mkdirSync(path.dirname(destino), { recursive: true });

  // 40 renglones: suficiente para que corte en dos páginas y se vea el pie en
  // las dos, que es donde fallaría si los márgenes no se anularan.
  const filas = Array.from({ length: 40 }, (_, i) => ({
    cuenta: `1-10-${String(i + 1).padStart(3, '0')}`,
    nombre: `Cuenta de prueba número ${i + 1}`,
    cargos: (i + 1) * 1234.5,
    abonos: (i + 1) * 1000,
    saldo: (i + 1) * 234.5,
  }));

  const buf = await reporteTablaPdf({
    titulo: 'Balanza de comprobación',
    empresa: 'EMPRESA DE DEMOSTRACIÓN SA DE CV',
    rfc: 'EKU9003173C9',
    subtitulos: ['Nivel 4 · Todas las cuentas'],
    rango: { desde: '2026-01-01', hasta: '2026-11-30' },
    columnas: [
      { titulo: 'Cuenta', clave: 'cuenta', ancho: 14 },
      { titulo: 'Nombre', clave: 'nombre', ancho: 40 },
      { titulo: 'Cargos', clave: 'cargos', ancho: 15, pesos: true },
      { titulo: 'Abonos', clave: 'abonos', ancho: 15, pesos: true },
      { titulo: 'Saldo',  clave: 'saldo',  ancho: 16, pesos: true },
    ],
    filas,
    totales: {
      cuenta: 'TOTAL',
      cargos: filas.reduce((a, f) => a + f.cargos, 0),
      abonos: filas.reduce((a, f) => a + f.abonos, 0),
      saldo:  filas.reduce((a, f) => a + f.saldo, 0),
    },
    firmas: ['Representante Legal', 'Contador Público'],
  });

  fs.writeFileSync(destino, buf);
  console.log(`  ${destino}  (${(buf.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
