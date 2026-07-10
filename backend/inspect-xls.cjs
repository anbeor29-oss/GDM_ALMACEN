const XLSX = require('xlsx');
const wb = XLSX.readFile('D:/Obsidian/ANBEOR/raw/cfdi-v4-catalogos-20260408.xls');
console.log('Hojas (' + wb.SheetNames.length + '):');
wb.SheetNames.forEach((n,i) => console.log(' ['+i+'] ' + n));
for (const target of ['c_ClaveProdServ','c_ClaveUnidad','c_Impuesto','c_TasaOCuota']) {
  if (!wb.SheetNames.includes(target)) { console.log('NO HOJA: '+target); continue; }
  const s = wb.Sheets[target];
  // primera fila con cabeceras como vienen
  const aoa = XLSX.utils.sheet_to_json(s, {header:1, defval:null, blankrows:false});
  console.log('\n=== ' + target + ' (' + aoa.length + ' filas raw) ===');
  for (let i = 0; i < Math.min(4, aoa.length); i++) {
    console.log('  fila ' + i + ':', JSON.stringify(aoa[i]).slice(0, 280));
  }
}
