#!/usr/bin/env node
/**
 * copy-assets.js — copia binarios (JSON, .gz, .cer de prueba) de src/ a dist/
 *
 * tsc solo copia archivos .ts a dist. Los assets binarios necesarios en runtime
 * (como el catálogo SAT c_ClaveProdServ.json.gz de 523 KB) hay que copiarlos
 * manualmente después del build.
 *
 * Se ejecuta en el build (Render y local).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function copyRecursive(from, to) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      count += copyRecursive(src, dst);
    } else {
      fs.copyFileSync(src, dst);
      count++;
    }
  }
  return count;
}

const jobs = [
  { from: path.join(ROOT, 'src', 'data'),         to: path.join(ROOT, 'dist', 'data') },
  { from: path.join(ROOT, 'src', 'database'),     to: path.join(ROOT, 'dist', 'database') },
];

let total = 0;
for (const j of jobs) {
  const n = copyRecursive(j.from, j.to);
  if (n > 0) {
    console.log(`[copy-assets] ${path.relative(ROOT, j.from)} → ${path.relative(ROOT, j.to)} (${n} archivos)`);
    total += n;
  }
}
console.log(`[copy-assets] Total: ${total} archivos copiados.`);
