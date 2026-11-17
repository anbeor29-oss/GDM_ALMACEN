/**
 * import-jobs.ts — registro EN MEMORIA de trabajos de importación largos (Contalink).
 *
 * POR QUÉ EXISTE
 * Un import del libro diario puede tardar minutos (miles de pólizas → decenas de
 * miles de consultas). Resolverlo dentro de UNA petición HTTP tiene dos problemas
 * graves que ya nos mordieron:
 *   1. El proxy/entorno corta la conexión «inactiva» → el navegador ve «Network Error».
 *   2. Cualquier intento de mantener viva la conexión escribiendo al socket puede, si
 *      la conexión ya se cerró, emitir un evento `'error'` del stream SIN listener →
 *      `uncaughtException` → `process.exit(1)` (el handler global del server) →
 *      **se cae TODO el backend**, no sólo el import (muere hasta «cambiar de empresa»).
 *
 * SOLUCIÓN: el POST del archivo arranca el trabajo EN SEGUNDO PLANO y responde al
 * instante con un `jobId`. El trabajo corre aparte, guarda su avance aquí, y el
 * frontend consulta el avance con un GET chico. Así:
 *   · El POST responde en milisegundos → nada que cortar, ningún socket que reviente.
 *   · El trabajo atrapa TODO error (`.catch`) → nunca escapa un throw → nunca tumba
 *     el proceso.
 *   · Si el proceso se reinicia a media corrida, el job se pierde, el front recibe
 *     404 y el usuario re-sube el archivo: el import es IDEMPOTENTE, continúa solo.
 *
 * En Render (plan starter) hay UNA instancia, así que el Map en memoria basta: el
 * GET de avance cae en el mismo proceso. (Con varias instancias habría que mover
 * esto a la BD; hoy no aplica.)
 */
import { randomUUID } from 'crypto';

export type EstadoJob = 'corriendo' | 'listo' | 'error';

export interface ImportJob {
  id: string;
  companyId: string;      // candado: un usuario sólo ve el job de SU empresa
  estado: EstadoJob;
  procesadas: number;
  total: number;
  rep?: any;              // el reporte final del import (lo que la pantalla verde pinta)
  mensaje?: string;       // el mensaje humano que antes armaba la ruta
  error?: string;
  creado: number;
}

const jobs = new Map<string, ImportJob>();
const TTL_MS = 15 * 60 * 1000;   // los jobs terminados se purgan a los 15 min

function purgar() {
  const ahora = Date.now();
  for (const [id, j] of jobs) {
    if (j.estado !== 'corriendo' && ahora - j.creado > TTL_MS) jobs.delete(id);
  }
}

export function crearImportJob(companyId: string): ImportJob {
  purgar();
  const job: ImportJob = {
    id: randomUUID(), companyId, estado: 'corriendo', procesadas: 0, total: 0, creado: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

/** El job SÓLO si pertenece a esa empresa (aislamiento). */
export function getImportJob(id: string, companyId: string): ImportJob | undefined {
  const j = jobs.get(id);
  return j && j.companyId === companyId ? j : undefined;
}

/**
 * Corre el trabajo en segundo plano y DEVUELVE YA (no espera). El resultado y el
 * avance quedan en `job`. NUNCA deja escapar un error: un throw sin atrapar aquí
 * mataría el proceso por el handler global `uncaughtException`.
 */
export function correrImportEnFondo(
  job: ImportJob,
  trabajo: () => Promise<{ rep: any; mensaje: string }>
): void {
  // `setImmediate`: el parseo del Excel es SÍNCRONO (ocurre antes del primer `await`),
  // así que si arrancáramos el trabajo aquí mismo bloquearíamos el `res.json(jobId)`.
  // Diferido al check phase, la respuesta ya se envió y el event loop queda libre para
  // atender otras peticiones (p. ej. «cambiar de empresa») mientras parsea.
  setImmediate(() => {
    // Nota: NO se usa `await` arriba — el llamador ya respondió el HTTP con el jobId.
    trabajo()
      .then(({ rep, mensaje }) => {
        job.rep = rep; job.mensaje = mensaje;
        if (typeof rep?.total === 'number') job.total = rep.total;
        job.procesadas = job.total;
        job.estado = 'listo';
      })
      .catch((e: any) => {
        job.error = (e?.message || 'La importación falló.').toString();
        job.estado = 'error';
      });
  });
}
