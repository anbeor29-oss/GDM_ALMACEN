/**
 * Cargador de face-api.js para el checador facial (kiosco y enrolamiento).
 *
 * Extrae el DESCRIPTOR de 128 flotantes EN EL NAVEGADOR/DISPOSITIVO; al backend
 * nunca va la foto, solo el descriptor —que es lo que el servidor ya sabe enrolar
 * e identificar (1:N)—. Usa la fork @vladmandic/face-api con el detector ligero
 * TinyFaceDetector.
 *
 * CARGA DESDE EL MISMO ORIGEN (self-host) — 2026-09-28. Antes la librería (~1.3 MB)
 * y los 3 modelos (~7 MB, el de reconocimiento pesa 6.4 MB) se bajaban de un CDN
 * (jsdelivr). En celulares modestos con datos móviles esa descarga se atoraba y el
 * kiosco «no abría» hasta reiniciar el equipo. Ahora se sirven de la propia app
 * (Render), que el navegador cachea tras la primera vez; el CDN queda solo como
 * RESPALDO por si el archivo local faltara. Los .bin viven en frontend/public/models
 * y la librería en frontend/public/vendor.
 */
const LOCAL_JS = `${import.meta.env.BASE_URL}vendor/face-api.js`;
const LOCAL_MODELS = `${import.meta.env.BASE_URL}models`;
const CDN_JS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js';
const CDN_MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

let cargando: Promise<any> | null = null;

/** Inyecta el <script> de face-api. Resuelve solo si `window.faceapi` quedó
 *  disponible: si el servidor devolvió el index.html del SPA (404 disfrazado de
 *  200), el onload dispara pero faceapi sigue indefinido → se rechaza para poder
 *  caer al CDN. */
function cargarScript(src: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const ya = (window as any).faceapi;
    if (ya) { resolve(ya); return; }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      const f = (window as any).faceapi;
      if (f) resolve(f); else reject(new Error('face-api.js no expuso faceapi'));
    };
    s.onerror = () => reject(new Error('no se pudo bajar face-api.js'));
    document.head.appendChild(s);
  });
}

async function cargarModelos(faceapi: any, base: string) {
  await faceapi.nets.tinyFaceDetector.loadFromUri(base);
  await faceapi.nets.faceLandmark68Net.loadFromUri(base);
  await faceapi.nets.faceRecognitionNet.loadFromUri(base);
}

export function cargarFaceApi(): Promise<any> {
  if (cargando) return cargando;
  cargando = (async () => {
    // 1) Librería: primero del MISMO ORIGEN; si falta, del CDN.
    let faceapi: any;
    try { faceapi = await cargarScript(LOCAL_JS); }
    catch { faceapi = await cargarScript(CDN_JS); }
    if (!faceapi) throw new Error('No se pudo cargar face-api.js (revisa la conexión).');
    // 2) Modelos: mismo origen primero, CDN de respaldo.
    try { await cargarModelos(faceapi, LOCAL_MODELS); }
    catch { await cargarModelos(faceapi, CDN_MODELS); }
    return faceapi;
  })();
  // Si la carga falla del todo, se limpia para permitir un reintento posterior.
  cargando.catch(() => { cargando = null; });
  return cargando;
}

/** Extrae el descriptor (128 flotantes) del rostro en el video, o null si no hay.
 *  inputSize 224 (antes 320): la mitad de cómputo por cuadro, para que el celular
 *  no se sature manteniendo la cámara y la inferencia continua. */
export async function descriptorDeVideo(video: HTMLVideoElement): Promise<{ descriptor: number[]; box: any } | null> {
  const faceapi = await cargarFaceApi();
  const det = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!det?.descriptor) return null;
  return { descriptor: Array.from(det.descriptor as Float32Array), box: det.detection?.box };
}
