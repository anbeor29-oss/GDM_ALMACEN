/**
 * /admin/rendimiento — panel de salud del servicio en Render (solo SUPER_ADMIN).
 *
 * De un vistazo: MEMORIA del proceso Node y del contenedor, y DISCO ocupado por la
 * base de datos (que es lo que de verdad crece y se llena en Render; el disco del
 * web service es efímero). Sólo LEE: no cambia nada. Sirve para decidir cuándo
 * subir de plan o depurar tablas pesadas.
 */
import { Router, Request, Response } from 'express';
import os from 'os';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler } from '../../middleware/errorHandler';
import { query } from '../../config/database';
import { requireSuperAdmin } from './admin.middleware';

const router = Router();
router.use(authenticateToken);
router.use(requireSuperAdmin);

router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const mem = process.memoryUsage();

  // Tamaño de la base y de las tablas más pesadas (incluye índices y TOAST).
  let db: any = { total_bytes: 0, tablas: [] as any[] };
  try {
    const tot = await query<any>(`SELECT pg_database_size(current_database())::bigint AS bytes`);
    const tablas = await query<any>(
      `SELECT c.relname AS tabla,
              pg_total_relation_size(c.oid)::bigint AS bytes,
              COALESCE(c.reltuples, 0)::bigint AS filas_aprox
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = 'public'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT 15`);
    db = {
      total_bytes: Number(tot.rows[0]?.bytes || 0),
      tablas: tablas.rows.map((r: any) => ({
        tabla: r.tabla, bytes: Number(r.bytes), filas_aprox: Number(r.filas_aprox),
      })),
    };
  } catch { /* si no hay permisos de catálogo, el panel igual muestra la memoria */ }

  res.json({
    success: true,
    data: {
      ts: new Date().toISOString(),
      node: {
        rss: mem.rss, heapTotal: mem.heapTotal, heapUsed: mem.heapUsed, external: mem.external,
        uptime_s: Math.round(process.uptime()),
        version: process.version,
      },
      os: {
        totalmem: os.totalmem(), freemem: os.freemem(),
        loadavg: os.loadavg(), cpus: os.cpus().length,
        platform: os.platform(),
      },
      db,
    },
  });
}));

export default router;
