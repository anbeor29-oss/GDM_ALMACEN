/**
 * «Que los reportes caigan siempre en la misma carpeta».
 *
 * LO QUE UNA PÁGINA WEB NO PUEDE HACER: elegir la carpeta de descargas del
 * navegador. Esa es una preferencia del navegador en cada máquina y ningún
 * sitio la puede cambiar — y está bien que así sea.
 *
 * LO QUE SÍ SE PUEDE: la File System Access API. El usuario escoge una carpeta
 * UNA VEZ, el navegador guarda el permiso, y de ahí en adelante NEXO escribe
 * ahí directo, sin preguntar y sin pasar por la carpeta de descargas. El
 * permiso lo da la persona con el selector del sistema operativo; nosotros sólo
 * guardamos el «asa» (handle) que devuelve.
 *
 * DÓNDE FUNCIONA: navegadores Chromium — Chrome, Edge, Opera, Vivaldi, Brave.
 * Firefox y Safari no la traen. Ahí no pasa nada malo: `guardarEnCarpeta`
 * contesta que no pudo y la descarga sale como siempre.
 *
 * El asa NO cabe en localStorage (no sobrevive a JSON.stringify): va en
 * IndexedDB, que sí guarda objetos estructurados.
 */

/* Tipos mínimos: la API aún no está en las librerías DOM de TypeScript. */
type Permiso = 'granted' | 'denied' | 'prompt';
interface AsaArchivo {
  createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }>;
}
interface AsaCarpeta {
  name: string;
  getFileHandle(nombre: string, opts?: { create?: boolean }): Promise<AsaArchivo>;
  queryPermission(opts: { mode: 'readwrite' }): Promise<Permiso>;
  requestPermission(opts: { mode: 'readwrite' }): Promise<Permiso>;
}
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: 'readwrite'; id?: string; startIn?: string }) => Promise<AsaCarpeta>;
  }
}

const BD = 'nexo-descargas';
const ALMACEN = 'carpetas';
const LLAVE = 'reportes';

/** ¿Este navegador deja elegir carpeta? */
export function navegadorSoportaCarpeta(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function abrirBD(): Promise<IDBDatabase> {
  return new Promise((ok, mal) => {
    const req = indexedDB.open(BD, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(ALMACEN)) req.result.createObjectStore(ALMACEN);
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => mal(req.error);
  });
}

async function leerAsa(): Promise<AsaCarpeta | null> {
  try {
    const db = await abrirBD();
    return await new Promise((ok) => {
      const req = db.transaction(ALMACEN, 'readonly').objectStore(ALMACEN).get(LLAVE);
      req.onsuccess = () => ok((req.result as AsaCarpeta) || null);
      req.onerror = () => ok(null);
    });
  } catch { return null; }
}

async function escribirAsa(asa: AsaCarpeta | null): Promise<void> {
  try {
    const db = await abrirBD();
    const tx = db.transaction(ALMACEN, 'readwrite');
    if (asa) tx.objectStore(ALMACEN).put(asa, LLAVE);
    else tx.objectStore(ALMACEN).delete(LLAVE);
  } catch { /* sin IndexedDB se sigue descargando normal */ }
}

/** El nombre de la carpeta elegida, o null si no hay (o ya no se puede usar). */
export async function nombreCarpeta(): Promise<string | null> {
  const asa = await leerAsa();
  if (!asa) return null;
  try {
    const p = await asa.queryPermission({ mode: 'readwrite' });
    return p === 'denied' ? null : asa.name;
  } catch { return null; }
}

/** Abre el selector del sistema. DEBE llamarse desde un clic del usuario. */
export async function elegirCarpeta(): Promise<string | null> {
  if (!navegadorSoportaCarpeta()) return null;
  try {
    const asa = await window.showDirectoryPicker!({ mode: 'readwrite', id: 'nexo-reportes', startIn: 'documents' });
    await escribirAsa(asa);
    return asa.name;
  } catch {
    return null;   // el usuario canceló: no es un error
  }
}

export async function olvidarCarpeta(): Promise<void> {
  await escribirAsa(null);
}

/** Un nombre que no pise un archivo que ya está: «reporte (2).pdf». */
async function nombreLibre(dir: AsaCarpeta, nombre: string): Promise<string> {
  const punto = nombre.lastIndexOf('.');
  const base = punto > 0 ? nombre.slice(0, punto) : nombre;
  const ext = punto > 0 ? nombre.slice(punto) : '';
  for (let i = 1; i < 50; i++) {
    const intento = i === 1 ? nombre : `${base} (${i})${ext}`;
    try {
      await dir.getFileHandle(intento);   // sin create: si existe, resuelve
    } catch {
      return intento;                      // no existe → libre
    }
  }
  return `${base} (${Date.now()})${ext}`;
}

/**
 * Escribe el archivo en la carpeta elegida. Devuelve el nombre con el que
 * quedó, o `null` si no hay carpeta, el navegador no la soporta o el permiso
 * ya no está — en cuyo caso quien llama debe descargar como siempre.
 *
 * Nunca pisa un archivo existente: le agrega «(2)», como hace el navegador.
 */
export async function guardarEnCarpeta(blob: Blob, nombre: string): Promise<string | null> {
  const asa = await leerAsa();
  if (!asa) return null;
  try {
    let permiso = await asa.queryPermission({ mode: 'readwrite' });
    if (permiso === 'prompt') {
      // Pedirlo requiere un gesto del usuario; una descarga SIEMPRE nace de un
      // clic, así que aquí el gesto existe.
      permiso = await asa.requestPermission({ mode: 'readwrite' });
    }
    if (permiso !== 'granted') return null;

    const final = await nombreLibre(asa, nombre);
    const archivo = await asa.getFileHandle(final, { create: true });
    const w = await archivo.createWritable();
    await w.write(blob);
    await w.close();
    return final;
  } catch {
    return null;   // carpeta borrada, disco lleno, permiso revocado… que baje normal
  }
}
