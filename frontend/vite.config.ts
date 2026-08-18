import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

/* Identificador de ESTA compilación. Se incrusta en el código y se escribe en
 * `version.json`; al arrancar, la aplicación compara los dos y se recarga sola
 * si el servidor anuncia otro. Ver src/utils/version-guard.ts. */
const BUILD_ID = Date.now().toString(36);

/* El COMMIT con el que se compiló esta pantalla.
 *
 * Es distinto de BUILD_ID —que sólo dice "cuándo"— y sirve para lo que BUILD_ID
 * no puede: compararse contra el commit que reporta el backend en /health. Si
 * no coinciden, uno de los dos servicios se quedó atrás, y eso explica una
 * pantalla nueva que recibe 404. Render lo expone al construir; en local no
 * existe y se dice "dev". */
const COMMIT = (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || 'dev';

/** Deja `version.json` junto al index.html en cada build. */
function pluginVersion() {
  return {
    name: 'gdmnexo-version',
    generateBundle() {
      (this as any).emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId: BUILD_ID, builtAt: new Date().toISOString() }),
      });
    },
  };
}

export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(BUILD_ID),
    'import.meta.env.VITE_COMMIT': JSON.stringify(COMMIT),
  },
  // Base path del deploy:
  //   · Render (raíz):            sin env → '/'
  //   · Hosting México (/erp):    VITE_BASE_PATH=/erp/ (script build:hosting)
  // App.tsx pasa import.meta.env.BASE_URL como basename del Router para que
  // las rutas SPA funcionen igual en ambos.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), pluginVersion()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
      '@pages': fileURLToPath(new URL('./src/pages', import.meta.url)),
      '@hooks': fileURLToPath(new URL('./src/hooks', import.meta.url)),
      '@utils': fileURLToPath(new URL('./src/utils', import.meta.url)),
      '@types': fileURLToPath(new URL('./src/types', import.meta.url)),
      '@services': fileURLToPath(new URL('./src/services', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // El cliente ahora envía /api/v1/... directamente, así que el proxy
      // solo cambia origen. Cuando el frontend corre en Render, no pasa por
      // este proxy y VITE_API_BASE apunta directo al backend.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
