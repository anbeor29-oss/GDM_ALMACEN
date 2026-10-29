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
import { getEmisoraComoPlatform, getPlatformCompany, upsertPlatformCustomer, upsertPlatformProduct } from './issue-invoice.service';
import * as invoicesService from '../invoices/invoices.service';
import * as pacService from '../pac/pac.service';

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
  'GHC1707275Y0', 'AABA020418BW2',
  // FAMC800303RN4 (CARLOS ERNESTO FRANCO) salió de la lista: es el ÚNICO cliente de
  // HCGM con usuario propio, así que SÍ se cobra (cobro por usuario). Las demás
  // empresas del grupo no tienen usuarios → quedan «sin usuarios», no se facturan.
  'LOGJ9010071V0',  // JESSICA LOPEZ GONZALEZ — alta en pruebas
  'IAGD860819MP3',  // DAVID ISLAS GUERRERO   — alta en pruebas
  'VIGE6601128E1',  // EDGAR VILLAGRAN GARCIA — parte de GRUPO HCGM, a pruebas (sin cobro)
];

const iso = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const primerDia = (input?: string) => { const b = input ? new Date(input + 'T00:00:00') : new Date(); return { anio: b.getFullYear(), mes: b.getMonth() }; };

/* ── Calendario de precio por usuario (decidido 2026-10-13) ──────────────────
 *  · Contrataciones de oct–dic 2026 (y previas): PRECIO DE INTRODUCCIÓN = el
 *    precio de lista editable del super admin (hoy $750).
 *  · Contrataciones desde el 01/01/2027: PRECIO PLENO ($1,000).
 *  · El 01/04/2027 TODAS las empresas saltan al PRECIO PLENO (y así queda en 2027).
 * La config (precio_usuario_mxn) sigue siendo el precio de introducción editable;
 * el salto a $1,000 es por calendario. */
const PRECIO_USUARIO_PLENO = 1000;
const FECHA_PRECIO_NUEVO   = new Date(2027, 0, 1);   // 01/01/2027 — nuevas contrataciones a pleno
const FECHA_BRINCO_GLOBAL  = new Date(2027, 3, 1);   // 01/04/2027 — todas a pleno

/** Precio por usuario que aplica a una empresa en un periodo, según el calendario. */
export function precioUsuarioVigente(contratadaEl: Date | null, periodoDate: Date, cfgPrecioIntro: number): number {
  if (periodoDate >= FECHA_BRINCO_GLOBAL) return PRECIO_USUARIO_PLENO;                       // 01/04/2027+: todas
  if (contratadaEl && contratadaEl >= FECHA_PRECIO_NUEVO) return PRECIO_USUARIO_PLENO;        // contrató en 2027
  return cfgPrecioIntro;                                                                      // cohorte de introducción
}

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

/** Config con la marca de si el precio por usuario lo FIJA el despacho (precio propio
 *  negociado) o lo hereda del global. Si lo fija, no se le aplica el brinco por calendario. */
interface ConfigDespacho extends FacturacionConfig { precioFijo: boolean; }

/**
 * Mapa despacho_id → precios efectivos (overrides del despacho sobre el global).
 * Un campo NULL en el despacho hereda el valor global. Se precarga una vez por corrida
 * para no consultar por empresa.
 */
async function mapaPreciosDespacho(base: FacturacionConfig): Promise<Map<string, ConfigDespacho>> {
  const r = await query<any>(
    `SELECT id, precio_usuario_mxn, timbres_incluidos, timbre_extra_mxn, timbres_por_usuario, timbre_extra_por_usuario
       FROM despachos_contables WHERE deleted_at IS NULL`).catch(() => ({ rows: [] as any[] }));
  const m = new Map<string, ConfigDespacho>();
  for (const d of r.rows) {
    m.set(d.id, {
      precioUsuario:         d.precio_usuario_mxn       != null ? Number(d.precio_usuario_mxn)       : base.precioUsuario,
      timbresIncluidos:      d.timbres_incluidos        != null ? Number(d.timbres_incluidos)        : base.timbresIncluidos,
      timbreExtra:           d.timbre_extra_mxn         != null ? Number(d.timbre_extra_mxn)         : base.timbreExtra,
      timbresPorUsuario:     d.timbres_por_usuario      != null ? Number(d.timbres_por_usuario)      : base.timbresPorUsuario,
      timbreExtraPorUsuario: d.timbre_extra_por_usuario != null ? Number(d.timbre_extra_por_usuario) : base.timbreExtraPorUsuario,
      precioFijo:            d.precio_usuario_mxn != null,
    });
  }
  return m;
}
/** Precios de una empresa según su despacho (o el global si no tiene). */
function configDeEmpresa(mapa: Map<string, ConfigDespacho>, despachoId: string | null, base: FacturacionConfig): ConfigDespacho {
  return (despachoId && mapa.get(despachoId)) || { ...base, precioFijo: false };
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
  const mapaDesp = await mapaPreciosDespacho(cfg);

  const empresas = await query<any>(
    `SELECT c.id, c.rfc, c.business_name, c.created_at, c.prueba_inicio, c.despacho_id,
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
    // Precios del despacho de la empresa (o el global). Si el despacho fija un precio
    // propio (negociado) ése manda; si lo hereda, aplica el brinco por calendario.
    const cfgE = configDeEmpresa(mapaDesp, e.despacho_id, cfg);
    const precioU = cfgE.precioFijo ? cfgE.precioUsuario : precioUsuarioVigente(inicioCobro, new Date(anio, mes, 1), cfgE.precioUsuario);
    const renta = r2(precioU * usuarios * (diasCobrados / diasMes));

    // Timbres del periodo (los de SW: stamp_usage tiene billing_period = 1.º de mes).
    const tR = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM stamp_usage WHERE company_id = $1 AND billing_period = $2`, [e.id, periodo]);
    const timbresUsados = Number(tR.rows[0]?.n) || 0;
    // Escalonado: los incluidos y el precio del timbre extra crecen con los usuarios.
    const nivel = Math.max(0, usuarios - 1);
    const incluidos = cfgE.timbresIncluidos + cfgE.timbresPorUsuario * nivel;
    const precioExtra = r2(cfgE.timbreExtra + cfgE.timbreExtraPorUsuario * nivel);
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
      [e.id, periodo, usuarios, diasCobrados, diasMes, prorrateado, precioU, renta,
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
  const mapaDesp = await mapaPreciosDespacho(cfg);

  const empresas = await query<any>(
    `SELECT c.id, c.rfc, c.business_name, c.billing_exempt, c.prueba_inicio, c.servicio_suspendido,
            c.created_at, c.empresa_cobro_id, COALESCE(c.emisor_predeterminado,false) AS emisor_predeterminado,
            COALESCE(c.es_emisor_cobro,false) AS es_emisor_cobro,
            c.despacho_id,
            (SELECT d.nombre FROM despachos_contables d WHERE d.id = c.despacho_id AND d.deleted_at IS NULL) AS despacho_nombre,
            COALESCE(c.producto,'NEXO') AS producto,
            (SELECT MIN(sc.signed_at) FROM service_contracts sc WHERE sc.company_id = c.id) AS signed_at,
            (SELECT COUNT(*) FROM service_contracts sc WHERE sc.company_id = c.id) > 0 AS firmado,
            fm.id AS cargo_id, fm.status AS cargo_status, fm.factura_id AS cargo_factura_id, fm.total_mxn AS cargo_total
       FROM companies c
       LEFT JOIN facturacion_mensual fm ON fm.company_id = c.id AND fm.periodo = $1
      WHERE c.deleted_at IS NULL AND c.is_active = TRUE
      ORDER BY c.business_name`, [periodo]);

  const prueba: any[] = [], reales: any[] = [];
  for (const e of empresas.rows) {
    const rfc = String(e.rfc || '').toUpperCase();
    // Las EMISORAS de cobro (GHC/SAJ) NO se listan como clientes: son quien factura,
    // no a quién se factura. Sólo son el encabezado del despacho en el árbol.
    if (e.es_emisor_cobro === true) continue;

    const cfgE = configDeEmpresa(mapaDesp, e.despacho_id, cfg);
    const usuarios = await usuariosFacturables(e.id);
    const tR = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM stamp_usage WHERE company_id = $1 AND billing_period = $2`, [e.id, periodo]);
    const timbresUsados = Number(tR.rows[0]?.n) || 0;
    const nivel = Math.max(0, usuarios - 1);
    const incluidos = cfgE.timbresIncluidos + cfgE.timbresPorUsuario * nivel;
    const precioExtra = r2(cfgE.timbreExtra + cfgE.timbreExtraPorUsuario * nivel);
    const timbresExtra = Math.max(0, timbresUsados - incluidos);

    // «Ambiente de prueba» = SÓLO altas nuevas en su prueba de 72 h (solicitudes de
    // IVA/NEXO). Las SIN_COBRO/exentas NO son prueba: van a «Usuarios reales» como
    // EXENTAS ($0), para que la sección de prueba quede sólo con lo realmente nuevo.
    const esPrueba = !!(e.prueba_inicio && !e.firmado);
    let exenta = false, motivo = '';
    if (esPrueba) motivo = 'Prueba 72 h';
    else if (RFCS_SIN_COBRO.includes(rfc)) { exenta = true; motivo = 'Sin cobro'; }
    else if (e.billing_exempt === true) { exenta = true; motivo = 'Exenta'; }

    // Precio por usuario: el del despacho si lo fija, si no el del calendario.
    const inicioCobro = (e.prueba_inicio && e.signed_at) ? new Date(e.signed_at) : new Date(e.created_at);
    const precioU = cfgE.precioFijo ? cfgE.precioUsuario : precioUsuarioVigente(inicioCobro, new Date(anio, mes, 1), cfgE.precioUsuario);
    const sinCobro = esPrueba || exenta;
    const renta = sinCobro ? 0 : r2(precioU * usuarios);
    const extra = sinCobro ? 0 : r2(timbresExtra * precioExtra);
    const fila = {
      company_id: e.id, rfc: e.rfc, business_name: e.business_name,
      empresa_cobro_id: e.empresa_cobro_id || null, emisor_predeterminado: e.emisor_predeterminado === true,
      despacho_id: e.despacho_id || null, despacho_nombre: e.despacho_nombre || null,
      usuarios, timbres_usados: timbresUsados, timbres_incluidos: incluidos, timbres_extra: timbresExtra,
      renta_mxn: renta, extra_mxn: extra, total_mxn: r2(renta + extra),
      esPrueba, exenta, motivo, producto: e.producto || 'NEXO',
      cargo_id: e.cargo_id || null,
      facturado: !!e.cargo_factura_id, cargo_total: e.cargo_total != null ? Number(e.cargo_total) : null,
      status: e.cargo_status || (sinCobro ? 'SIN_COBRO' : 'SIN_GENERAR'),
      servicio_suspendido: e.servicio_suspendido === true,
    };
    (esPrueba ? prueba : reales).push(fila);
  }

  const suma = (arr: any[], k: string) => r2(arr.reduce((a, x) => a + Number(x[k] || 0), 0));
  const timbresTotal = [...reales, ...prueba].reduce((a, x) => a + x.timbres_usados, 0);
  // Emisora predeterminada (p.ej. GRUPO HCGM): bajo ella se agrupan en el árbol las
  // empresas que no tengan «quién factura» capturado.
  const predet = empresas.rows.find((e: any) => e.emisor_predeterminado === true);
  const emisoraPredeterminada = predet ? { id: predet.id, business_name: predet.business_name, rfc: predet.rfc } : null;
  return {
    periodo, prueba, reales, emisoraPredeterminada,
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

/**
 * EMITE el CFDI del cargo mensual (servicio por usuario) desde la emisora ELEGIDA
 * (GHC o SAJ). Reúsa los helpers de emisión de la plataforma (cliente/producto +
 * timbrado real por el PAC). Guarda el `factura_id` en el cargo; no lo marca pagado
 * (el pago se registra aparte). Idempotente: si el cargo ya tiene factura, no re-emite.
 */
export async function emitirFacturaMensual(cargoId: string, emisoraId?: string, descripcion?: string): Promise<{ folio: string; uuid?: string; emisora: string }> {
  const r = await query<any>(
    `SELECT fm.id, fm.company_id, fm.periodo, fm.total_mxn, fm.timbres_extra, fm.factura_id, fm.status,
            TO_CHAR(fm.periodo,'YYYY-MM') AS periodo_label,
            c.rfc AS client_rfc, c.business_name AS client_name, c.fiscal_regime AS client_regime,
            c.postal_code AS client_cp, c.contact_email AS client_email
       FROM facturacion_mensual fm JOIN companies c ON c.id = fm.company_id
      WHERE fm.id = $1`, [cargoId]);
  const fm = r.rows[0];
  if (!fm) throw new NotFoundError('Cargo mensual no encontrado.');
  if (fm.factura_id) throw new ConflictError('Ese cargo ya tiene una factura emitida.');
  if (Number(fm.total_mxn) <= 0) throw new ValidationError('El total es 0: no hay nada que facturar.');
  if (!fm.client_cp || !fm.client_regime) {
    throw new ValidationError(`Al cliente ${fm.client_rfc} le falta CP o régimen fiscal — complétalos antes de facturar.`);
  }

  // Emisora elegida (o la predeterminada / única).
  const platform = emisoraId ? await getEmisoraComoPlatform(emisoraId) : await getPlatformCompany();
  if (!platform) throw new ValidationError('La emisora elegida no existe o no está marcada como emisora de cobro.');
  if (platform.id === fm.company_id) throw new ValidationError('La emisora no se factura a sí misma.');

  const customerId = await upsertPlatformCustomer(platform.id, {
    rfc: fm.client_rfc, business_name: fm.client_name,
    fiscal_regime: fm.client_regime, postal_code: fm.client_cp, contact_email: fm.client_email,
  });
  const productId = await upsertPlatformProduct(platform.id);
  const desc = descripcion || `Servicio de facturación electrónica ${fm.periodo_label} (cobro por usuario)` +
    (Number(fm.timbres_extra) > 0 ? ` — incluye ${fm.timbres_extra} timbres extra` : '');
  const invoice = await invoicesService.createInvoice(platform.id, {
    customerId, cfdiType: 'I', paymentForm: '99', paymentMethod: 'PPD', cfdiUse: 'G03',
    items: [{ productId, quantity: 1, unitPrice: Number(fm.total_mxn), taxPresetId: 'iva16', description: desc } as any],
  });
  const stamp = await pacService.stampInvoice(platform.id, invoice.id);
  const folio = `${invoice.serie || 'FAC'}-${String(invoice.folio).padStart(6, '0')}`;

  await query(`UPDATE facturacion_mensual SET factura_id = $2 WHERE id = $1`, [cargoId, invoice.id]);
  logger.info(`[facturacion] CFDI de cobro emitido: ${folio} (${stamp.uuid}) desde ${platform.rfc} → ${fm.client_rfc} [${fm.periodo_label}]`);
  return { folio, uuid: stamp.uuid, emisora: platform.business_name };
}

/**
 * COBRO del servicio IVA (IVA.HTML): no es por usuario, es un monto (anualidad o
 * paquete de créditos). Crea —o ajusta, si aún no se facturó— el cargo del periodo
 * con ese monto y lo emite desde la emisora ELEGIDA. Base sin IVA: el CFDI suma el 16 %.
 */
export async function cobrarIva(companyId: string, monto: number, emisoraId: string, concepto?: string) {
  if (!(monto > 0)) throw new ValidationError('Captura el monto a cobrar (sin IVA).');
  if (!emisoraId) throw new ValidationError('Elige la emisora.');
  const hoy = new Date();
  const periodo = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const diasMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  const ex = await query<any>(`SELECT id, factura_id FROM facturacion_mensual WHERE company_id = $1 AND periodo = $2`, [companyId, periodo]);
  if (ex.rows[0]?.factura_id) throw new ConflictError('Este cliente ya tiene una factura emitida en el periodo.');
  let cargoId: string;
  if (ex.rows.length) {
    cargoId = ex.rows[0].id;
    await query(`UPDATE facturacion_mensual SET renta_mxn = $2, total_mxn = $2, extra_mxn = 0, status = 'PENDIENTE' WHERE id = $1`, [cargoId, r2(monto)]);
  } else {
    const r = await query<{ id: string }>(
      `INSERT INTO facturacion_mensual
         (company_id, periodo, usuarios, dias_cobrados, dias_mes, prorrateado, precio_usuario_mxn, renta_mxn,
          timbres_usados, timbres_incluidos, timbres_extra, timbre_extra_mxn, extra_mxn, total_mxn)
       VALUES ($1,$2,0,$3,$3,false,0,$4,0,0,0,0,0,$4) RETURNING id`, [companyId, periodo, diasMes, r2(monto)]);
    cargoId = r.rows[0].id;
  }
  const desc = (concepto && concepto.trim()) || 'Servicio de consulta y cálculo de IVA mensual (IVA GDM)';
  const data = await emitirFacturaMensual(cargoId, emisoraId, desc);
  return { ...data, cargoId };
}
