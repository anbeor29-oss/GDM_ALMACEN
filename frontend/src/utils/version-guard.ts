/**
 * version-guard — evita que el navegador siga sirviendo una versión vieja.
 *
 * EL PROBLEMA
 * Vite le pone un hash al nombre de cada bundle, así que `index-DKbUpILY.js`
 * puede cachearse para siempre sin riesgo. El que NO puede cachearse es
 * `index.html`, porque es quien dice cuál bundle cargar. Si el navegador se
 * queda con un `index.html` viejo, sigue pidiendo el bundle viejo —que además
 * existe, porque los despliegues no borran los anteriores— y el usuario ve el
 * sistema de la semana pasada sin ninguna señal de que algo va mal. La única
 * salida era Ctrl+Shift+R, y sólo si a alguien se le ocurría.
 *
 * CÓMO SE RESUELVE
 * En cada compilación se escribe `version.json` con un identificador, y el
 * mismo identificador se incrusta en el código. Al arrancar la aplicación se
 * pide ese archivo **sin caché** y se comparan:
 *
 *   · Coinciden          → todo al día, no se hace nada.
 *   · No coinciden       → hay versión nueva: se limpian las cachés y se
 *                          recarga UNA vez.
 *   · No se puede leer   → sin red o sin el archivo; se sigue como si nada.
 *                          Dejar a alguien sin sistema por no poder comprobar
 *                          la versión sería peor que la versión vieja.
 *
 * SE HACE AL ENTRAR, NO CADA RATO
 * Recargar a media captura le borraría el trabajo a quien está llenando una
 * factura. Al abrir la aplicación no hay nada escrito que perder, y es el
 * momento en que la comprobación resuelve el caso real: llegas por la mañana y
 * el sistema ya trae lo de ayer.
 *
 * EL CANDADO CONTRA EL BUCLE
 * Si el servidor sirviera un `version.json` nuevo con un `index.html` viejo
 * —despliegue a medias, CDN desincronizado—, la recarga volvería a encontrar
 * el desfase y recargaría otra vez, para siempre. `sessionStorage` recuerda que
 * ya se recargó por este motivo; a la segunda no insiste y deja pasar.
 */

/** Identificador de esta compilación. Lo inyecta Vite (ver vite.config.ts). */
const BUILD_ID: string = (import.meta as any).env?.VITE_BUILD_ID || 'dev';

const MARCA = 'gdmfac:recarga-por-version';

export async function comprobarVersion(): Promise<void> {
  // En desarrollo el hot reload ya se encarga; comprobar aquí sólo estorbaría.
  if (BUILD_ID === 'dev' || (import.meta as any).env?.DEV) return;

  try {
    /* `BASE_URL` importa: en hcgm.com.mx la aplicación vive en /erp/, y pedir
     * `/version.json` traería un 404 del sitio principal —o peor, su página de
     * error con estado 200, que al parsearse no sería JSON—. */
    const base = (import.meta as any).env?.BASE_URL || '/';
    const url = `${base.replace(/\/+$/, '')}/version.json?t=${Date.now()}`;

    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return;
    const data = await r.json();
    const servidor = String(data?.buildId || '');
    if (!servidor || servidor === BUILD_ID) return;

    if (sessionStorage.getItem(MARCA) === servidor) {
      // Ya se recargó por esta misma versión y el desfase sigue: es del
      // servidor, no del navegador. Insistir dejaría la pantalla en blanco.
      console.warn(
        `[version] el servidor anuncia ${servidor} pero el código cargado es ${BUILD_ID}. ` +
        'Ya se recargó una vez; puede ser un despliegue a medias.'
      );
      return;
    }
    sessionStorage.setItem(MARCA, servidor);

    /* Se borran las cachés de la Cache API antes de recargar. Sin esto, un
     * service worker registrado en el pasado podría volver a servir el
     * index.html viejo y la recarga no cambiaría nada. */
    if ('caches' in window) {
      const nombres = await caches.keys();
      await Promise.all(nombres.map((n) => caches.delete(n)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }

    console.info(`[version] versión nueva (${servidor}), recargando…`);
    window.location.reload();
  } catch {
    /* Silencio a propósito: sin red, con el archivo ausente o con un JSON
     * malformado, la aplicación tiene que arrancar igual. */
  }
}

export { BUILD_ID };
