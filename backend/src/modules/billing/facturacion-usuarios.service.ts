/**
 * facturacion-usuarios.service — cobro POR USUARIO (modelo nuevo).
 *
 *   Renta del mes = precio_usuario × usuarios facturables (sin checador)
 *                 + (timbres del mes por arriba de los incluidos) × timbre_extra
 *
 * Prepago: la lista se genera el día 30; a quien entró después del día 1 se le
 * prorratea el primer mes (por días). El conteo de timbres sale de `stamp_usage`
 * (lo que NEXO timbró vía SW). Config editable por el super admin (sube por INPC).
 */
import { query } from '../../config/database';
import { NotFoundError, ConflictError, ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

export interface FacturacionConfig {
  precioUsuario: number;
  timbresIncluidos: number;        // base (1 usuario)
  timbreExtra: number;             // base (1 usuario)
  timbresPorUsuario: number;       // +incluidos por cada usuario adicional
  timbreExtraPorUsuario: number;   // +$ del timbre extra por cada usuario adicional
}

/**
 * RFC de AMBIENTES DE PRUEBA / dueño / demo: NO se cobran (se muestran aparte con
 * $0). Son temporales hasta que se eliminen. (Distinto del par de «no bloqueo» de
 * login; aquí es sólo facturación.)
 */
export const RFCS_SIN_COBRO = [
  'GHC1707275Y0', 'AABA020418BW2', 'FAMC800303RN4',
  'LOGJ9010071V0',  // JESSICA LOPEZ GONZALEZ — alta en pruebas
  'IAGD860819MP3',  // DAVID ISLAS GUERRERO   — alta en pruebas
];

const iso = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const primerDia = (input?: string) => { const b = input ? new Date(input + 'T00:00:00') : new Date(); return { anio: b.getFullYear(), mes: b.getMonth() }; };

/* ── Config ── */
export async function getConfig(): Promise<FacturacionConfig> {
  const r = await query<any>(`SELECT precio_usuario_mxn, timbres_incluidos, timbre_extra_mxn, timbres_por_usuario, timbre_extra_por_usuario FROM facturacion_config WHERE id = 1`);
  const row = r.rows[0] || {};
  return {
    precioUsuario: Number(row.precio_usuario_mxn ?? 750),
    timbresIncluidos: Number(row.timbres_incluidos ?? 1000),
    timbreExtra: Number(row.timbre_extra_mxn ?? 1.30),
    timbresPorUsuario: Number(row.timbres_por_usuario ?? 500),
    timbreExtraPorUsuario: Number(row.timbre_extra_por_usuario ?? 0.20),
  };
}

export async function setConfig(d: Partial<FacturacionConfig>): Promise<FacturacionConfig> {
  const cur = await getConfig();
  const precio = d.precioUsuario ?? cur.precioUsuario;
  const incl = d.timbresIncluidos ?? cur.timbresIncluidos;
  const extra = d.timbreExtra ?? cur.timbreExtra;
  const inclPU = d.timbresPorUsuario ?? cur.timbresPorUsuario;
  const extraPU = d.timbreExtraPorUsuario ?? cur.timbreExtraPorUsuario;
  if ([precio, incl, extra, inclPU, extraPU].some((v) => v < 0)) throw new ValidationError('Los valores no pueden ser negativos.');
  await query(
    `INSERT INTO facturacion_config (id, precio_usuario_mxn, timbres_incluidos, timbre_extra_mxn, timbres_por_usuario, timbre_extra_por_usuario, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE SET precio_usuario_mxn = $1, timbres_incluidos = $2, timbre_extra_mxn = $3, timbres_por_usuario = $4, timbre_extra_por_usuario = $5, updated_at = NOW()`,
    [precio, incl, extra, inclPU, extraPU]);
  return { precioUsuario: precio, timbresIncluidos: incl, timbreExtra: extra, timbresPorUsuario: inclPU, timbreExtraPorUsuario: extraPU };
}

/** Usuarios facturables de una empresa: activos, NO checador, NO super admin. */
async function usuariosFacturables(companyId: string): Promise<number> {
  const r = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM users
      WHERE company_id = $1 AND is_active = TRUE AND deleted_at IS NULL
        AND role <> 'SUPER_ADMIN' AND COALESCE(work_group, '') <> 'CHECADOR'`,
    [companyId]);
  return Number(r.rows[0]?.n) || 0;
}

/**
 * Genera (o refresca) la lista de facturación del periodo. Idempotente: las
 * filas ya PAGADO/SUSPENDIDO no se tocan; las PENDIENTE se recalculan (por si
 * cambió el número de usuarios o los timbres).
 */
export async function generarLista(periodoInput?: string, userId?: string) {
  const { anio, mes } = primerDia(periodoInput);
  const periodo = iso(new Date(anio, mes, 1));
  const diasMes = new Date(anio, mes + 1, 0).getDate();
  const cfg = await getConfig();

  const empresas = await query<any>(
    `SELECT c.id, c.rfc, c.business_name, c.created_at, c.prueba_inicio,
            (SELECT MIN(sc.signed_at) FROM service_contracts sc WHERE sc.company_id = c.id) AS signed_at
       FROM companies c
      WHERE c.deleted_at IS NULL AND c.is_active = TRUE
        AND COALESCE(c.billing_exempt, FALSE) = FALSE
        AND COALESCE(c.stamp_package_code, '') <> 'PKG_TRIAL'
        -- Ambientes de prueba / dueño / demo: no se cobran.
        AND UPPER(c.rfc) <> ALL($1::text[])
        -- Las altas de PRUEBA (72 h) NO se cobran hasta que FIRMAN el contrato.
        AND NOT (c.prueba_inicio IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM service_contracts sc WHERE sc.company_id = c.id))`,
    [RFCS_SIN_COBRO]);

  let creadas = 0;
  for (const e of empresas.rows) {
    const ex = await query<{ status: string }>(`SELECT status FROM facturacion_mensual WHERE company_id = $1 AND periodo = $2`, [e.id, periodo]);
    if (ex.rows[0] && ex.rows[0].status !== 'PENDIENTE') continue;   // pagado/suspendido: no tocar

    const usuarios = await usuariosFacturables(e.id);

    // Prorrateo: desde que la empresa es FACTURABLE dentro de este mes. Para un
    // alta de prueba se cobra DESDE LA FIRMA (no los días gratis); para las demás,
    // desde su fecha de alta. Sólo prorratea si ese inicio cae después del día 1.
    const inicioCobro = (e.prueba_inicio && e.signed_at) ? new Date(e.signed_at) : new Date(e.created_at);
    let diasCobrados = diasMes, prorrateado = false;
    if (inicioCobro.getFullYear() === anio && inicioCobro.getMonth() === mes && inicioCobro.getDate() > 1) {
      diasCobrados = diasMes - inicioCobro.getDate() + 1;   // el día que se vuelve facturable se cobra
      prorrateado = true;
    }
    const renta = r2(cfg.precioUsuario * usuarios * (diasCobrados / diasMes));

    // Timbres del periodo (los de SW: stamp_usage tiene billing_period = 1.º de mes).
    const tR = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM stamp_usage WHERE company_id = $1 AND billing_period = $2`, [e.id, periodo]);
    const timbresUsados = Number(tR.rows[0]?.n) || 0;
    // Escalonado: los incluidos y el precio del timbre extra crecen con los usuarios.
    const nivel = Math.max(0, usuarios - 1);
    const incluidos = cfg.timbresIncluidos + cfg.timbresPorUsuario * nivel;
    const precioExtra = r2(cfg.timbreExtra + cfg.timbreExtraPorUsuario * nivel);
    const timbresExtra = Math.max(0, timbresUsados - incluidos);
    const extra = r2(timbresExtra * precioExtra);
    const total = r2(renta + extra);

    await query(
      `INSERT INTO facturacion_mensual
         (company_id, periodo, usuarios, dias_cobrados, dias_mes, prorrateado,
          precio_usuario_mxn, renta_mxn, timbres_usados, timbres_incluidos,
          timbres_extra, timbre_extra_mxn, extra_mxn, total_mxn, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PENDIENTE')
       ON CONFLICT (company_id, periodo) DO UPDATE SET
         usuarios=EXCLUDED.usuarios, dias_cobrados=EXCLUDED.dias_cobrados, dias_mes=EXCLUDED.dias_mes,
         prorrateado=EXCLUDED.prorrateado, precio_usuario_mxn=EXCLUDED.precio_usuario_mxn, renta_mxn=EXCLUDED.renta_mxn,
         timbres_usados=EXCLUDED.timbres_usados, timbres_incluidos=EXCLUDED.timbres_incluidos,
         timbres_extra=EXCLUDED.timbres_extra, timbre_extra_mxn=EXCLUDED.timbre_extra_mxn,
         extra_mxn=EXCLUDED.extra_mxn, total_mxn=EXCLUDED.total_mxn
       WHERE facturacion_mensual.status = 'PENDIENTE'`,
      [e.id, periodo, usuarios, diasCobrados, diasMes, prorrateado, cfg.precioUsuario, renta,
       timbresUsados, incluidos, timbresExtra, precioExtra, extra, total]);
    creadas++;
  }
  logger.info(`[facturacion] lista ${periodo}: ${creadas} empresas por ${userId || 'sistema'}`);
  return getLista(periodo);
}

/** Lee la lista de un periodo (con totales). */
export async function getLista(periodoInput?: string) {
  const { anio, mes } = primerDia(periodoInput);
  const periodo = iso(new Date(anio, mes, 1));
  const r = await query<any>(
    `SELECT f.id, f.periodo, f.usuarios, f.dias_cobrados, f.dias_mes, f.prorrateado,
            f.precio_usuario_mxn, f.renta_mxn, f.timbres_usados, f.timbres_incluidos,
            f.timbres_extra, f.timbre_extra_mxn, f.extra_mxn, f.total_mxn, f.status,
            TO_CHAR(f.pagado_at,'YYYY-MM-DD') AS pagado_at,
            c.rfc, c.business_name, c.servicio_suspendido
       FROM facturacion_mensual f JOIN companies c ON c.id = f.company_id
      WHERE f.periodo = $1
      ORDER BY c.business_name`, [periodo]);
  const filas = r.rows;
  const suma = (k: string) => filas.reduce((a, x) => a + Number(x[k] || 0), 0);
  return {
    periodo,
    filas,
    totales: {
      empresas: filas.length,
      usuarios: suma('usuarios'),
      renta: r2(suma('renta_mxn')),
      extra: r2(suma('extra_mxn')),
      total: r2(suma('total_mxn')),
      porCobrar: r2(filas.filter((x: any) => x.status === 'PENDIENTE').reduce((a: number, x: any) => a + Number(x.total_mxn || 0), 0)),
    },
  };
}

/**
 * Resumen CONSOLIDADO del periodo para el super admin: TODAS las empresas activas,
 * agrupadas en «prueba» (sin cobro) y «reales» (cobro por usuario), con su consumo
 * de timbres. Es de sólo lectura (no genera cargos); trae el cargo del periodo si
 * ya se generó (para pagar/suspender). Modelo puro $precio/usuario — sin paquetes.
 */
export async function resumenConsolidado(periodoInput?: string) {
  const { anio, mes } = primerDia(periodoInput);
  const periodo = iso(new Date(anio, mes, 1));
  const cfg = await getConfig();

  const empresas = await query<any>(
    `SELECT c.id, c.rfc, c.business_name, c.billing_exempt, c.prueba_inicio, c.servicio_suspendido,
            (SELECT COUNT(*) FROM service_contracts sc WHERE sc.company_id = c.id) > 0 AS firmado,
            fm.id AS cargo_id, fm.status AS cargo_status
       FROM companies c
       LEFT JOIN facturacion_mensual fm ON fm.company_id = c.id AND fm.periodo = $1
      WHERE c.deleted_at IS NULL AND c.is_active = TRUE
      ORDER BY c.business_name`, [periodo]);

  const prueba: any[] = [], reales: any[] = [];
  for (const e of empresas.rows) {
    const usuarios = await usuariosFacturables(e.id);
    const tR = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM stamp_usage WHERE company_id = $1 AND billing_period = $2`, [e.id, periodo]);
    const timbresUsados = Number(tR.rows[0]?.n) || 0;
    const nivel = Math.max(0, usuarios - 1);
    const incluidos = cfg.timbresIncluidos + cfg.timbresPorUsuario * nivel;
    const precioExtra = r2(cfg.timbreExtra + cfg.timbreExtraPorUsuario * nivel);
    const timbresExtra = Math.max(0, timbresUsados - incluidos);
    const rfc = String(e.rfc || '').toUpperCase();

    let motivo = '';
    if (RFCS_SIN_COBRO.includes(rfc)) motivo = 'Ambiente de prueba';
    else if (e.billing_exempt === true) motivo = 'Exenta';
    else if (e.prueba_inicio && !e.firmado) motivo = 'Prueba 72 h';
    const esPrueba = motivo !== '';

    const renta = esPrueba ? 0 : r2(cfg.precioUsuario * usuarios);
    const extra = esPrueba ? 0 : r2(timbresExtra * precioExtra);
    const fila = {
      company_id: e.id, rfc: e.rfc, business_name: e.business_name,
      usuarios, timbres_usados: timbresUsados, timbres_incluidos: incluidos, timbres_extra: timbresExtra,
      renta_mxn: renta, extra_mxn: extra, total_mxn: r2(renta + extra),
      esPrueba, motivo,
      cargo_id: e.cargo_id || null,
      status: e.cargo_status || (esPrueba ? 'SIN_COBRO' : 'SIN_GENERAR'),
      servicio_suspendido: e.servicio_suspendido === true,
    };
    (esPrueba ? prueba : reales).push(fila);
  }

  const suma = (arr: any[], k: string) => r2(arr.reduce((a, x) => a + Number(x[k] || 0), 0));
  const timbresTotal = [...reales, ...prueba].reduce((a, x) => a + x.timbres_usados, 0);
  return {
    periodo, prueba, reales,
    totales: {
      empresasReales: reales.length,
      usuariosReales: reales.reduce((a, x) => a + x.usuarios, 0),
      renta: suma(reales, 'renta_mxn'),
      extra: suma(reales, 'extra_mxn'),
      total: suma(reales, 'total_mxn'),
      timbresUsados: timbresTotal,
    },
  };
}

/** Marca un cargo como PAGADO (prepago recibido) y reactiva el servicio. */
export async function marcarPagado(id: string, facturaId?: string) {
  const r = await query<{ company_id: string }>(
    `UPDATE facturacion_mensual SET status='PAGADO', pagado_at=NOW(), factura_id=COALESCE($2, factura_id)
      WHERE id=$1 AND status <> 'PAGADO' RETURNING company_id`, [id, facturaId || null]);
  if (!r.rows.length) throw new NotFoundError('Cargo no encontrado o ya pagado.');
  await query(`UPDATE companies SET servicio_suspendido = FALSE, updated_at = NOW() WHERE id = $1`, [r.rows[0].company_id]);
  return { pagado: true };
}

/** Suspende el servicio de la empresa por falta de pago (corte del día 5). */
export async function suspender(id: string) {
  const r = await query<{ company_id: string; status: string }>(`SELECT company_id, status FROM facturacion_mensual WHERE id = $1`, [id]);
  if (!r.rows.length) throw new NotFoundError('Cargo no encontrado.');
  if (r.rows[0].status === 'PAGADO') throw new ConflictError('Ese cargo ya está pagado; no se suspende.');
  await query(`UPDATE facturacion_mensual SET status='SUSPENDIDO', suspendido_at=NOW() WHERE id=$1`, [id]);
  await query(`UPDATE companies SET servicio_suspendido = TRUE, updated_at = NOW() WHERE id = $1`, [r.rows[0].company_id]);
  return { suspendido: true };
}

/** Levanta la suspensión (vuelve a PENDIENTE). */
export async function reactivar(id: string) {
  const r = await query<{ company_id: string }>(
    `UPDATE facturacion_mensual SET status='PENDIENTE', suspendido_at=NULL WHERE id=$1 AND status='SUSPENDIDO' RETURNING company_id`, [id]);
  if (!r.rows.length) throw new NotFoundError('Ese cargo no estaba suspendido.');
  await query(`UPDATE companies SET servicio_suspendido = FALSE, updated_at = NOW() WHERE id = $1`, [r.rows[0].company_id]);
  return { reactivado: true };
}
