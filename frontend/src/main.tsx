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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
