/**
 * build-hosting — genera el ZIP del frontend listo para subir al hosting
 * compartido de hcgm.com.mx (cPanel / Hosting México) en la carpeta /erp.
 *
 * Uso:
 *   npm run build:hosting
 *
 * Variables opcionales (defaults pensados para producción):
 *   HOSTING_BASE_PATH   default '/erp/'
 *   HOSTING_API_BASE    default 'https://gdmfac-backend.onrender.com'
 *
 * Salida:
 *   dist-hosting/gdmfac-erp-hosting.zip
 *     └── erp/            ← subir el CONTENIDO de esta carpeta a public_html/erp
 *         ├── index.html
 *         ├── .htaccess   ← SPA fallback + cache de assets
 *         └── assets/…
 *
 * Después de subir, recuerda agregar el origen al CORS del backend en Render:
 *   CORS_ORIGIN=https://hcgm.com.mx,https://gdmfac-frontend.onrender.com
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, cpSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const BASE_PATH = process.env.HOSTING_BASE_PATH || '/erp/';
const API_BASE = process.env.HOSTING_API_BASE || 'https://gdmfac-backend.onrender.com';

console.log('── build:hosting ──────────────────────────────');
console.log(`   base path : ${BASE_PATH}`);
console.log(`   api base  : ${API_BASE}`);

// 1) Build de Vite con las env correctas
console.log('\n[1/4] vite build…');
execSync('npx vite build', {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_BASE_PATH: BASE_PATH,
    VITE_API_BASE: API_BASE,
  },
});

// 2) .htaccess para SPA en subcarpeta (Apache / LiteSpeed de Hosting México)
console.log('[2/4] escribiendo .htaccess…');
const htaccess = `# GDM_FAC ERP — SPA React servida desde ${BASE_PATH}
# Fallback: cualquier ruta que no sea archivo/carpeta real → index.html
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase ${BASE_PATH}
  RewriteRule ^index\\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . ${BASE_PATH}index.html [L]
</IfModule>

# Cache larga para assets con hash en el nombre (Vite los versiona)
<IfModule mod_headers.c>
  <FilesMatch "\\.(js|css|woff2?|png|jpe?g|svg|webp)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "index\\.html$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
`;
writeFileSync(join(root, 'dist', '.htaccess'), htaccess, 'utf-8');

// 3) Estructurar dist-hosting/erp con el contenido del build
console.log('[3/4] armando estructura…');
const outDir = join(root, 'dist-hosting');
const folderName = BASE_PATH.replace(/\//g, '') || 'erp';
const stage = join(outDir, folderName);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, 'dist'), stage, { recursive: true });

// 4) ZIP (PowerShell en Windows, zip en unix)
console.log('[4/4] comprimiendo…');
const zipPath = join(outDir, 'gdmfac-erp-hosting.zip');
if (process.platform === 'win32') {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${stage}' -DestinationPath '${zipPath}' -Force"`,
    { stdio: 'inherit' }
  );
} else {
  execSync(`cd '${outDir}' && zip -rq gdmfac-erp-hosting.zip '${folderName}'`, {
    stdio: 'inherit', shell: '/bin/bash',
  });
}

if (!existsSync(zipPath)) {
  console.error('❌ El ZIP no se generó');
  process.exit(1);
}
const kb = (statSync(zipPath).size / 1024).toFixed(0);
console.log(`\n✅ Listo: ${zipPath} (${kb} KB)`);
console.log(`   Sube la carpeta interna '${folderName}/' a public_html/ del hosting`);
console.log('   y agrega https://hcgm.com.mx al CORS_ORIGIN del backend en Render.');
