import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // Base path del deploy:
  //   · Render (raíz):            sin env → '/'
  //   · Hosting México (/erp):    VITE_BASE_PATH=/erp/ (script build:hosting)
  // App.tsx pasa import.meta.env.BASE_URL como basename del Router para que
  // las rutas SPA funcionen igual en ambos.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
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
