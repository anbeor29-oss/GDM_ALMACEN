/**
 * Cargador de face-api.js para el checador facial (kiosco y enrolamiento).
 *
 * Se carga desde CDN (no como dependencia del bundle) y extrae el DESCRIPTOR de
 * 128 flotantes EN EL NAVEGADOR/DISPOSITIVO; al backend nunca va la foto, solo el
 * descriptor —que es lo que el servidor ya sabe enrolar e identificar (1:N)—.
 *
 * Usa la fork mantenida @vladmandic/face-api, que corre en navegadores modernos
 * (Chrome de Android, Safari de iOS) con el modelo ligero TinyFaceDetector.
 */
const FACEAPI_JS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js';
const MODELOS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';

let cargando: Promise<any> | null = null;

export function cargarFaceApi(): Promise<any> {
  if (cargando) return cargando;
  cargando = new Promise((resolve, reject) => {
    const ya = (window as any).faceapi;
    const listo = async (faceapi: any) => {
      try {
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODELOS);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODELOS);
        await faceapi.nets.faceRecognitionNet.loadFromUri(MODELOS);
        resolve(faceapi);
      } catch (e) { reject(e); }
    };
    if (ya) { listo(ya); return; }
    const s = document.createElement('script');
    s.src = FACEAPI_JS;
    s.async = true;
    s.onload = () => listo((window as any).faceapi);
    s.onerror = () => { cargando = null; reject(new Error('No se pudo cargar face-api.js (revisa la conexión).')); };
    document.head.appendChild(s);
  });
  return cargando;
}

/** Extrae el descriptor (128 flotantes) del rostro en el video, o null si no hay. */
export async function descriptorDeVideo(video: HTMLVideoElement): Promise<{ descriptor: number[]; box: any } | null> {
  const faceapi = await cargarFaceApi();
  const det = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!det?.descriptor) return null;
  return { descriptor: Array.from(det.descriptor as Float32Array), box: det.detection?.box };
}
