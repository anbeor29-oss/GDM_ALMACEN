import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.tsx'
import { comprobarVersion } from './utils/version-guard'
import './index.css'

/* Se comprueba al arrancar y SIN esperar: si la aplicación se quedara detenida
 * hasta que responda `version.json`, un servidor lento dejaría la pantalla en
 * blanco por algo que es sólo mantenimiento. Cuando detecta versión nueva
 * recarga, y esa recarga interrumpe el arranque de todos modos. */
comprobarVersion();

/* EL SERVICE WORKER SE REGISTRA CON LA BASE DE LA APP, NO DESDE LA RAÍZ.
 *
 * Estaba en index.html como `register('/sw.js')`, una ruta absoluta al dominio.
 * En desarrollo funciona —la app vive en `/`— pero el build del hosting la
 * publica bajo `/erp/`, donde el archivo está en `/erp/sw.js`: la petición a
 * `/sw.js` devolvía 404 y el registro fallaba en silencio, porque el `.catch`
 * se tragaba el error sin decir nada.
 *
 * Consecuencia: en hcgm.com.mx/erp el service worker NUNCA llegó a instalarse,
 * y con él se perdía justo lo que existe para evitar —servir bundles viejos
 * después de un despliegue—, que es el síntoma que ya había costado días de
 * diagnóstico («no veo los cambios»).
 *
 * `import.meta.env.BASE_URL` vale `/` en dev y `/erp/` en el hosting, y una
 * ruta relativa no sirve: desde una ruta profunda de la SPA resolvería contra
 * ella. El ámbito del worker queda en esa misma carpeta, que es lo correcto.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const url = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(url).catch((e) => {
      // Se avisa en consola: callar el error es lo que lo mantuvo roto.
      console.warn(`[sw] no se pudo registrar ${url}:`, e?.message || e);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
