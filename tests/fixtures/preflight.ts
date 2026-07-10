/**
 * CLI: `npm run preflight` — útil en local antes de correr suites pesadas.
 * Imprime el reporte y termina con exit code 1 si algo está caído.
 */
import { runPreflight } from './pg-resilience';

(async () => {
  try {
    const r = await runPreflight();
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
})();
