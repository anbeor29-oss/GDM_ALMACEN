const XLSX = require('xlsx');
console.log('leyendo...');
const t0 = Date.now();
const wb = XLSX.readFile(process.env.TEMP + '\\catCFDI.xls', {bookSheets:true});
console.log('Hojas (' + wb.SheetNames.length + '):');
wb.SheetNames.forEach((n,i) => console.log(' ['+i+'] ' + n));
console.log('Tiempo lectura inicial: ' + ((Date.now()-t0)/1000) + 's');
