/**
 * Siembra las referencias contables: NIF y código agrupador del SAT.
 *
 * Es global —no por empresa— porque las NIF y el Anexo 24 son del país. Se
 * corre una vez por instalación, y otra vez cuando cambie el Anexo.
 *
 * 📍 En el Web Shell de Render:
 *      cd /opt/render/project/src/backend && npm run contabilidad:sembrar
 */
import { pool } from '../src/config/database';
import { sembrarReferencias, faltantesDelAnexo24 } from '../src/modules/accounting/catalogo.service';

(async () => {
  const r = await sembrarReferencias();
  console.log(`\n  NIF sembradas:        ${r.nifSembradas}`);
  console.log(`  Códigos del Anexo 24: ${r.satSembrados}` +
              ` (${r.satNivel1} mayores, ${r.satNivel2} subcuentas)`);
  console.log(`\n  Faltan ~${r.nivel2Pendiente} subcuentas de ` +
              `${r.cuentasConNivel2Incompleto} cuentas mayores.`);
  console.log('  El resumen del Anexo 24 no las detalla nombre por nombre, y no');
  console.log('  se inventaron. Para completarlas hace falta el archivo oficial.\n');
  for (const f of faltantesDelAnexo24().slice(0, 8)) {
    console.log(`    ${f.codigo.padEnd(5)} ${f.nombre.slice(0, 44).padEnd(46)} faltan ${f.subcuentasFaltantes}`);
  }
  console.log(`    … y ${Math.max(0, faltantesDelAnexo24().length - 8)} cuentas más\n`);
  await pool.end();
})();
