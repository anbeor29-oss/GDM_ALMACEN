/**
 * MOTOR INTELIGENTE DE CODIFICACIÓN POR RFC
 * (spec: E:\Banco\GDM_NEXO_Motor_Inteligente_Codificacion_RFC.md — Prioridades 3 y 4)
 *
 * Aprende de la HISTORIA contable de la empresa (pólizas importadas de CPQ/CTLK o
 * generadas en NEXO, ligadas a sus XML) qué cuenta usa para cada proveedor y
 * concepto, y con eso SUGIERE la cuenta de las facturas nuevas, factura por factura.
 *
 * Reglas que no se rompen (spec §19):
 *   · Sólo LEE pólizas. Nunca las modifica, ni las importadas ni las generadas.
 *   · Memoria AISLADA por empresa (company_id = RFC dueño). No se mezclan RFC.
 *   · No inventa: un concepto que no se puede atribuir a una cuenta se cuenta como
 *     «ambiguo» y NO alimenta la memoria.
 *   · La confianza sale de muestras reales (n y consistencia); no hay % ficticio.
 *   · Una sugerencia NO es regla: la regla nace PROPUESTA y sólo el usuario la aprueba.
 *     El motor de pólizas sólo usa reglas APROBADAS y decisiones del usuario.
 *   · Las reglas no se borran: cambiar la cuenta crea una VERSIÓN nueva (la anterior
 *     queda SUSTITUIDA) y todo queda en cod_auditoria.
 *
 * v1: dirección COMPRAS (115/601). El modelo de datos ya trae `direccion` para ventas.
 */
import { query, transaction, transactionQuery } from '../../config/database';
import { conceptosDeXml } from './ventas-cuentas.service';
import { mapaProductoCuentaCompra } from './compras-cuentas.service';

type Direccion = 'compras';
export type Nivel = 'ALTO' | 'MEDIO' | 'BAJO' | 'SIN_EVIDENCIA';
const RANGO: Record<Nivel, number> = { ALTO: 3, MEDIO: 2, BAJO: 1, SIN_EVIDENCIA: 0 };

const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const iniDeMes = (a: number, m: number) => (m >= 1 && m <= 12) ? `${a}-${String(m).padStart(2, '0')}-01` : `${a}-01-01`;
const finDeMes = (a: number, m: number) => (m >= 1 && m <= 12) ? new Date(a, m, 0).toISOString().slice(0, 10) : `${a}-12-31`;

/** Claves SAT genéricas: no dicen qué se compró, así que ahí manda la descripción. */
const CLAVES_GENERICAS = new Set(['01010101', '']);

/** Descripción normalizada: mayúsculas, sin acentos ni números, espacios simples. */
export function normDesc(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. APRENDER — recorrer la historia y construir los patrones
   ═══════════════════════════════════════════════════════════════════════════ */

/** ¿Este renglón de una póliza de compra es el GASTO/COSTO/ACTIVO (lo que se compró)?
 *  Fuera: IVA, impuestos, bancos/caja, clientes/deudores, anticipos, proveedores. */
function esRenglonDeCompra(l: any): boolean {
  if (!(Number(l.cargo) > 0)) return false;
  const nombre = String(l.nombre || '').toUpperCase();
  if (/\bI\.?V\.?A\b|IMPUEST|\bISR\b|RETEN/.test(nombre)) return false;
  if (l.tipo === 'GASTO' || l.tipo === 'COSTO') return true;
  if (l.tipo !== 'ACTIVO') return false;
  const agr = String(l.codigo_agrupador || '');
  if (agr) {
    const g = Number(agr.split('.')[0]);
    // 115-116 inventarios/estimación · 151-174 activo fijo · 173-178 diferidos (gastos de instalación, etc.)
    return (g >= 115 && g <= 116) || (g >= 151 && g <= 178);
  }
  return !/BANCO|CAJA|CLIENTE|DEUDOR|ANTICIPO|PROVEED|DEPOSITO|INVERSION/.test(nombre);
}

interface Observacion {
  rfc: string; nombre: string; clave: string; desc: string; cuenta: string;
  fecha: string; entry_id: string | null; uuid: string; fuente: 'historia' | 'nexo' | 'decision';
}

/**
 * Reconstruye la memoria (cod_patrones) de compras desde la historia de la empresa
 * y PROPONE reglas donde el patrón es fuerte. Idempotente: se puede correr las
 * veces que sea; los patrones se recalculan, las reglas del usuario no se tocan.
 */
export async function aprender(companyId: string, userId?: string) {
  const t0 = Date.now();
  // a) Pares (CFDI recibido, póliza) por las TRES vías de liga (las mismas del candado
  //    del motor): origen_uuid, partida con uuid_cfdi (no banco) y journal_entry_cfdi.
  const links = (await query<any>(
    `WITH cf AS (
       SELECT c.uuid FROM cfdi_recibidos c
        WHERE c.company_id=$1 AND c.direccion='recibidos'
          AND (c.tipo_comprobante='I' OR c.tipo_comprobante IS NULL)
          AND c.xml IS NOT NULL AND (c.estado_sat IS NULL OR c.estado_sat <> 'Cancelado'))
     SELECT DISTINCT x.uuid, x.entry_id FROM (
       SELECT cf.uuid, e.id AS entry_id FROM cf
         JOIN journal_entries e ON e.company_id=$1 AND e.origen_uuid=cf.uuid
       UNION ALL
       SELECT cf.uuid, l.entry_id FROM cf
         JOIN journal_lines l ON l.uuid_cfdi=cf.uuid
         JOIN journal_entries e ON e.id=l.entry_id AND e.company_id=$1 AND e.origen <> 'BANCO'
       UNION ALL
       SELECT cf.uuid, j.entry_id FROM cf
         JOIN journal_entry_cfdi j ON j.company_id=$1 AND j.uuid=cf.uuid
     ) x`, [companyId])).rows as Array<{ uuid: string; entry_id: string }>;

  // ¿Cuántos CFDI liga cada póliza? Una póliza de resumen (varios CFDI) sólo se puede
  // atribuir por las partidas que traen el UUID; si no lo traen, es ambigua.
  const cfdisPorEntry = new Map<string, number>();
  for (const l of links) cfdisPorEntry.set(l.entry_id, (cfdisPorEntry.get(l.entry_id) || 0) + 1);
  const entriesPorUuid = new Map<string, string[]>();
  for (const l of links) {
    const a = entriesPorUuid.get(l.uuid) || []; a.push(l.entry_id); entriesPorUuid.set(l.uuid, a);
  }

  const obs: Observacion[] = [];
  let conceptosAmbiguos = 0, facturasSinRenglon = 0;
  const uuids = [...entriesPorUuid.keys()];
  const LOTE = 400;
  for (let i = 0; i < uuids.length; i += LOTE) {
    const lote = uuids.slice(i, i + LOTE);
    const cfs = (await query<any>(
      `SELECT uuid, rfc_emisor, nombre_emisor, xml, TO_CHAR(fecha_emision,'YYYY-MM-DD') AS fecha
         FROM cfdi_recibidos WHERE company_id=$1 AND direccion='recibidos' AND uuid = ANY($2::text[])`,
      [companyId, lote])).rows;
    const entryIds = [...new Set(lote.flatMap((u) => entriesPorUuid.get(u) || []))];
    const lineas = entryIds.length ? (await query<any>(
      `SELECT l.entry_id, l.cargo::float AS cargo, l.uuid_cfdi, a.codigo, a.nombre, a.tipo, a.codigo_agrupador,
              TO_CHAR(e.fecha,'YYYY-MM-DD') AS fecha, e.regla
         FROM journal_lines l
         JOIN journal_entries e ON e.id=l.entry_id
         JOIN accounting_accounts a ON a.id=l.account_id
        WHERE l.entry_id = ANY($1::uuid[]) AND l.cargo > 0`, [entryIds])).rows : [];
    const porEntry = new Map<string, any[]>();
    for (const l of lineas) { const a = porEntry.get(l.entry_id) || []; a.push(l); porEntry.set(l.entry_id, a); }

    for (const c of cfs) {
      const conceptos = conceptosDeXml(String(c.xml)).map((x, idx) => ({ ...x, idx, neto: round2(x.importe - x.descuento) }));
      if (!conceptos.length) continue;
      // Renglones de compra de TODAS sus pólizas (normalmente una).
      const renglones: Array<{ cuenta: string; monto: number; entry_id: string; fecha: string; fuente: 'historia' | 'nexo' }> = [];
      for (const eid of entriesPorUuid.get(c.uuid) || []) {
        const multi = (cfdisPorEntry.get(eid) || 1) > 1;
        for (const l of porEntry.get(eid) || []) {
          if (!esRenglonDeCompra(l)) continue;
          if (multi && l.uuid_cfdi !== c.uuid) continue;   // póliza de resumen: sólo lo etiquetado
          renglones.push({
            cuenta: l.codigo, monto: round2(l.cargo), entry_id: eid, fecha: l.fecha,
            fuente: /^compras_cfdi/.test(l.regla || '') ? 'nexo' : 'historia',
          });
        }
      }
      if (!renglones.length) { facturasSinRenglon++; continue; }

      const base = { rfc: String(c.rfc_emisor || '').toUpperCase(), nombre: c.nombre_emisor || '', uuid: c.uuid };
      const distintas = [...new Set(renglones.map((r) => r.cuenta))];
      if (distintas.length === 1) {
        // Toda la compra fue a UNA cuenta → cada concepto aprende esa cuenta.
        const r = renglones[0];
        for (const cn of conceptos) obs.push({ ...base, clave: cn.clave, desc: normDesc(cn.descripcion), cuenta: r.cuenta, fecha: r.fecha || c.fecha, entry_id: r.entry_id, fuente: r.fuente });
        continue;
      }
      // Varias cuentas: se atribuye cada concepto al renglón con su MISMO importe (±0.05).
      // Si no empata, no se adivina: queda ambiguo y no se aprende.
      const libres = renglones.map((r) => ({ ...r, usado: false }));
      for (const cn of conceptos) {
        const hit = libres.find((r) => !r.usado && Math.abs(r.monto - cn.neto) <= 0.05);
        if (!hit) { conceptosAmbiguos++; continue; }
        hit.usado = true;
        obs.push({ ...base, clave: cn.clave, desc: normDesc(cn.descripcion), cuenta: hit.cuenta, fecha: hit.fecha || c.fecha, entry_id: hit.entry_id, fuente: hit.fuente });
      }
    }
  }

  // b) Decisiones del usuario en facturas que AÚN no tienen póliza (cuando la tengan,
  //    la póliza ya cuenta como evidencia; así no se cuenta doble).
  const dec = (await query<any>(
    `SELECT d.uuid, d.clave, d.descripcion, d.cuenta_codigo, TO_CHAR(c.fecha_emision,'YYYY-MM-DD') AS fecha,
            c.rfc_emisor, c.nombre_emisor
       FROM cfdi_concepto_cuenta d
       JOIN cfdi_recibidos c ON c.company_id=d.company_id AND c.uuid=d.uuid AND c.direccion='recibidos'
      WHERE d.company_id=$1`, [companyId])).rows;
  for (const d of dec) {
    if (entriesPorUuid.has(d.uuid)) continue;
    obs.push({ rfc: String(d.rfc_emisor || '').toUpperCase(), nombre: d.nombre_emisor || '', uuid: d.uuid,
      clave: d.clave || '', desc: normDesc(d.descripcion || ''), cuenta: d.cuenta_codigo, fecha: d.fecha, entry_id: null, fuente: 'decision' });
  }

  // c) Agregar por nivel.
  interface Acc { nivel: string; rfc: string; nombre: string; clave: string; desc: string; dist: Map<string, { n: number; primera: string; ultima: string }>; ej: Observacion[]; n: number; }
  const grupos = new Map<string, Acc>();
  const sumar = (nivel: string, rfc: string, clave: string, desc: string, o: Observacion) => {
    const k = `${nivel}|${rfc}|${clave}|${desc}`;
    let g = grupos.get(k);
    if (!g) { g = { nivel, rfc, nombre: o.nombre, clave, desc, dist: new Map(), ej: [], n: 0 }; grupos.set(k, g); }
    g.n++;
    const d = g.dist.get(o.cuenta) || { n: 0, primera: o.fecha, ultima: o.fecha };
    d.n++;
    if (o.fecha && o.fecha < d.primera) d.primera = o.fecha;
    if (o.fecha && o.fecha > d.ultima) d.ultima = o.fecha;
    g.dist.set(o.cuenta, d);
    g.ej.push(o);
  };
  for (const o of obs) {
    if (o.rfc) {
      sumar('RFC', o.rfc, '', '', o);
      if (!CLAVES_GENERICAS.has(o.clave)) sumar('RFC_CLAVE', o.rfc, o.clave, '', o);
      else if (o.desc) sumar('RFC_DESC', o.rfc, o.clave, o.desc, o);
    }
    if (!CLAVES_GENERICAS.has(o.clave)) sumar('CLAVE', '', o.clave, '', o);
  }

  const filas = [...grupos.values()].map((g) => {
    const dist = [...g.dist.entries()].map(([cuenta, d]) => ({ cuenta, ...d })).sort((a, b) => b.n - a.n);
    const fechas = dist.flatMap((d) => [d.primera, d.ultima]).filter(Boolean).sort();
    // Ejemplos: los más recientes, uno por póliza, cuidando que salga cada cuenta.
    const ej = g.ej.slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    const vistos = new Set<string>(); const ejemplos: any[] = [];
    for (const cta of dist.map((d) => d.cuenta)) {
      for (const o of ej) {
        if (o.cuenta !== cta) continue;
        const k = o.entry_id || o.uuid; if (vistos.has(k)) continue;
        vistos.add(k); ejemplos.push({ entry_id: o.entry_id, uuid: o.uuid, fecha: o.fecha, cuenta: o.cuenta, fuente: o.fuente });
        if (ejemplos.filter((e) => e.cuenta === cta).length >= 3) break;
      }
      if (ejemplos.length >= 8) break;
    }
    return {
      nivel: g.nivel, rfc: g.rfc, nombre: (g.nombre || '').slice(0, 300), clave: g.clave, descripcion: g.desc,
      cuenta_top: dist[0]?.cuenta || null, muestras: g.n,
      consistencia: g.n ? Math.round((dist[0].n / g.n) * 10000) / 10000 : 0,
      distribucion: dist, ejemplos, primera: fechas[0] || null, ultima: fechas[fechas.length - 1] || null,
    };
  });

  // d) Guardar (reemplaza la memoria de compras de la empresa, en una transacción).
  await transaction(async (client) => {
    await transactionQuery(client, `DELETE FROM cod_patrones WHERE company_id=$1 AND direccion='compras'`, [companyId]);
    for (let i = 0; i < filas.length; i += 500) {
      await transactionQuery(client,
        `INSERT INTO cod_patrones (company_id, direccion, nivel, rfc, nombre, clave, descripcion, cuenta_top,
                                  muestras, consistencia, distribucion, ejemplos, primera, ultima)
         SELECT $1, 'compras', x.nivel, x.rfc, x.nombre, x.clave, x.descripcion, x.cuenta_top,
                x.muestras, x.consistencia, x.distribucion, x.ejemplos, x.primera, x.ultima
           FROM jsonb_to_recordset($2::jsonb) AS x(
             nivel text, rfc text, nombre text, clave text, descripcion text, cuenta_top text,
             muestras int, consistencia numeric, distribucion jsonb, ejemplos jsonb, primera date, ultima date)`,
        [companyId, JSON.stringify(filas.slice(i, i + 500))]);
    }
  });

  // e) Proponer reglas donde el patrón por proveedor+producto es fuerte (n≥3, ≥90%),
  //    la cuenta existe en el catálogo vigente y no hay regla viva para esa llave.
  //    Refrescar la evidencia de las PROPUESTAS que ya existían.
  const cuentas = await catalogoVigente(companyId);
  const vivas = await reglasVivas(companyId);
  let propuestas = 0, refrescadas = 0;
  const contradicciones: any[] = [];
  for (const f of filas) {
    if (f.nivel !== 'RFC_CLAVE' || !f.cuenta_top) continue;
    const viva = vivas.get(`${f.rfc}|${f.clave}`);
    const fuerte = f.muestras >= 3 && f.consistencia >= 0.9;
    const ctaOk = cuentas.get(f.cuenta_top)?.movible;
    if (viva) {
      if (viva.estado === 'PROPUESTA' && viva.origen === 'HISTORIA') {
        await query(
          `UPDATE cod_reglas SET muestras=$2, consistencia=$3, primera=$4, ultima=$5, evidencia=$6::jsonb,
                  cuenta_codigo=CASE WHEN $7 THEN $8 ELSE cuenta_codigo END, updated_at=NOW()
            WHERE id=$1`,
          [viva.id, f.muestras, f.consistencia, f.primera, f.ultima, JSON.stringify(f.ejemplos), !!(fuerte && ctaOk), f.cuenta_top]);
        refrescadas++;
      } else if (viva.estado === 'APROBADA' && viva.cuenta_codigo !== f.cuenta_top && f.muestras >= 2) {
        // No se toca la regla aprobada: se AVISA (spec §5.6 / §19.6 no ocultar contradicciones).
        contradicciones.push({ regla_id: viva.id, rfc: f.rfc, nombre: f.nombre, clave: f.clave,
          aprobada: viva.cuenta_codigo, historia: f.cuenta_top, muestras: f.muestras, consistencia: f.consistencia });
      }
      continue;
    }
    if (!fuerte || !ctaOk) continue;
    await query(
      `INSERT INTO cod_reglas (company_id, direccion, rfc, nombre, clave, cuenta_codigo, estado, origen,
                               muestras, consistencia, primera, ultima, evidencia, created_by)
       VALUES ($1,'compras',$2,$3,$4,$5,'PROPUESTA','HISTORIA',$6,$7,$8,$9,$10::jsonb,$11)
       ON CONFLICT DO NOTHING`,
      [companyId, f.rfc, f.nombre, f.clave, f.cuenta_top, f.muestras, f.consistencia, f.primera, f.ultima,
       JSON.stringify(f.ejemplos), userId || null]);
    propuestas++;
  }

  const porNivel: Record<string, number> = {};
  for (const f of filas) porNivel[f.nivel] = (porNivel[f.nivel] || 0) + 1;
  const resultado = {
    facturasConPoliza: entriesPorUuid.size,
    facturasSinRenglonDeCompra: facturasSinRenglon,
    conceptosAprendidos: obs.length,
    conceptosAmbiguos,
    decisionesUsuario: dec.filter((d) => !entriesPorUuid.has(d.uuid)).length,
    patrones: porNivel,
    proveedores: porNivel.RFC || 0,
    reglasPropuestasNuevas: propuestas,
    reglasPropuestasRefrescadas: refrescadas,
    contradiccionesConReglasAprobadas: contradicciones,
    segundos: Math.round((Date.now() - t0) / 100) / 10,
  };
  await auditar(companyId, { accion: 'APRENDER', detalle: resultado }, userId);
  return resultado;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. CONTEXTO — lo que el agente y el motor consultan (cargado una vez)
   ═══════════════════════════════════════════════════════════════════════════ */

async function catalogoVigente(companyId: string) {
  const r = await query<any>(
    `SELECT codigo, nombre, tipo, permite_movimientos, activa FROM accounting_accounts WHERE company_id=$1`, [companyId]);
  return new Map<string, { nombre: string; tipo: string; movible: boolean }>(
    r.rows.map((x: any) => [x.codigo, { nombre: x.nombre, tipo: x.tipo, movible: !!x.permite_movimientos && x.activa !== false }]));
}

async function reglasVivas(companyId: string) {
  const r = await query<any>(
    `SELECT id, rfc, clave, cuenta_codigo, estado, origen, version, muestras, consistencia
       FROM cod_reglas WHERE company_id=$1 AND direccion='compras'
        AND estado IN ('PROPUESTA','APROBADA','SUSPENDIDA')`, [companyId]);
  return new Map<string, any>(r.rows.map((x: any) => [`${x.rfc}|${x.clave}`, x]));
}

export interface ContextoCodificacion {
  patrones: Map<string, any>;
  reglas: Map<string, any>;
  producto: Map<string, string>;
  unica: string | null;
  cuentas: Map<string, { nombre: string; tipo: string; movible: boolean }>;
}

export async function cargarContexto(companyId: string): Promise<ContextoCodificacion> {
  const [pat, reglas, producto, cuentas, unica] = await Promise.all([
    query<any>(`SELECT nivel, rfc, clave, descripcion, nombre, cuenta_top, muestras, consistencia::float AS consistencia,
                       distribucion, ejemplos, TO_CHAR(primera,'YYYY-MM-DD') AS primera, TO_CHAR(ultima,'YYYY-MM-DD') AS ultima
                  FROM cod_patrones WHERE company_id=$1 AND direccion='compras'`, [companyId]),
    reglasVivas(companyId),
    mapaProductoCuentaCompra(companyId),
    catalogoVigente(companyId),
    query<any>(`SELECT a.codigo FROM accounting_cuentas_fijas f JOIN accounting_accounts a ON a.id=f.account_id
                 WHERE f.company_id=$1 AND f.agrupador='COMPRA_CUENTA_UNICA' LIMIT 1`, [companyId]).catch(() => ({ rows: [] as any[] })),
  ]);
  const patrones = new Map<string, any>();
  for (const p of pat.rows) patrones.set(`${p.nivel}|${p.rfc}|${p.clave}|${p.descripcion}`, p);
  return { patrones, reglas, producto, unica: unica.rows[0]?.codigo || null, cuentas };
}

/** La cuenta que el MOTOR usará para un concepto, en este orden:
 *  decisión del usuario en esa factura › «una sola cuenta» › regla APROBADA
 *  (proveedor+producto, luego proveedor completo) › asignación por producto. */
export function cuentaEfectiva(
  ctx: ContextoCodificacion, decision: string | undefined, rfc: string, clave: string,
): { cuenta: string | null; fuente: string; regla_id?: string } {
  if (decision) return { cuenta: decision, fuente: 'DECISION' };
  if (ctx.unica) return { cuenta: ctx.unica, fuente: 'CUENTA_UNICA' };
  const r = ctx.reglas.get(`${rfc}|${clave}`) || ctx.reglas.get(`${rfc}|`);
  if (r && r.estado === 'APROBADA') return { cuenta: r.cuenta_codigo, fuente: 'REGLA', regla_id: r.id };
  const p = ctx.producto.get(clave);
  if (p) return { cuenta: p, fuente: 'PRODUCTO' };
  return { cuenta: null, fuente: 'NINGUNA' };
}

export interface Sugerencia {
  cuenta: string | null; nombreCuenta?: string; nivel: Nivel; motivo: string; base: string;
  muestras: number; consistencia: number | null; regla_id?: string;
  alternativas: Array<{ cuenta: string; nombre?: string; n: number; ultima?: string }>;
  ejemplos: any[]; incidencia?: string;
}

/** Nivel por evidencia real: cuántas veces y qué tan consistente. */
function nivelPorEvidencia(n: number, cons: number, especifico: boolean): Nivel {
  if (n >= 3 && cons >= 0.9) return 'MEDIO';
  if (especifico && n >= 2 && cons >= 0.75) return 'MEDIO';
  return 'BAJO';
}

/**
 * La sugerencia del agente para UN concepto (jerarquía spec §5.2):
 *   1 regla aprobada › 2 proveedor+producto › 3 proveedor+descripción (clave genérica)
 *   › 4 producto en cualquier proveedor › 5 proveedor (cualquier producto)
 *   › 6 configuración por producto › sin evidencia.
 */
export function sugerir(ctx: ContextoCodificacion, rfc: string, clave: string, descripcion: string): Sugerencia {
  const conNombre = (alt: any[]) => alt.map((d) => ({ cuenta: d.cuenta, nombre: ctx.cuentas.get(d.cuenta)?.nombre, n: d.n, ultima: d.ultima }));
  const validar = (s: Sugerencia): Sugerencia => {
    if (!s.cuenta) return s;
    const c = ctx.cuentas.get(s.cuenta);
    s.nombreCuenta = c?.nombre;
    if (!c) { s.incidencia = `la cuenta ${s.cuenta} no existe en el catálogo vigente (incidencia de mapeo)`; s.nivel = 'BAJO'; }
    else if (!c.movible) { s.incidencia = `la cuenta ${s.cuenta} no admite movimientos o está inactiva`; s.nivel = 'BAJO'; }
    return s;
  };

  // 1) Regla aprobada.
  for (const k of [`${rfc}|${clave}`, `${rfc}|`]) {
    const r = ctx.reglas.get(k);
    if (r && r.estado === 'APROBADA') {
      const p = ctx.patrones.get(`RFC_CLAVE|${rfc}|${clave}|`);
      const contradice = p && p.cuenta_top && p.cuenta_top !== r.cuenta_codigo;
      return validar({
        cuenta: r.cuenta_codigo, nivel: contradice ? 'MEDIO' : 'ALTO', regla_id: r.id,
        base: k.endsWith('|') ? 'REGLA_PROVEEDOR' : 'REGLA',
        motivo: (k.endsWith('|') ? 'Regla aprobada para todo el proveedor' : 'Regla aprobada (proveedor + producto)')
          + ` · v${r.version}` + (contradice ? ` — OJO: la historia reciente usa ${p.cuenta_top}` : ''),
        muestras: Number(r.muestras) || 0, consistencia: r.consistencia == null ? null : Number(r.consistencia),
        alternativas: p ? conNombre(p.distribucion) : [], ejemplos: p?.ejemplos || [],
      });
    }
  }

  // 2-5) Patrones de la historia, del más específico al más general.
  const generica = CLAVES_GENERICAS.has(clave);
  const desc = normDesc(descripcion);
  const niveles: Array<[string, string, string]> = [
    ['RFC_CLAVE', `RFC_CLAVE|${rfc}|${clave}|`, 'el mismo proveedor y el mismo producto'],
    ['RFC_DESC', `RFC_DESC|${rfc}|${clave}|${desc}`, 'el mismo proveedor y la misma descripción'],
    ['CLAVE', `CLAVE||${clave}|`, 'el mismo producto con otros proveedores'],
    ['RFC', `RFC|${rfc}||`, 'el mismo proveedor (otros productos)'],
  ];
  for (const [nivel, key, texto] of niveles) {
    if (nivel === 'RFC_CLAVE' && generica) continue;
    if (nivel === 'RFC_DESC' && !generica) continue;
    if (nivel === 'CLAVE' && generica) continue;
    const p = ctx.patrones.get(key);
    if (!p || !p.cuenta_top) continue;
    const dist: any[] = p.distribucion || [];
    const especifico = nivel === 'RFC_CLAVE' || nivel === 'RFC_DESC';
    let cuenta = p.cuenta_top as string;
    let nivelConf = nivelPorEvidencia(p.muestras, p.consistencia, especifico);
    let motivo = `${dist[0]?.n || 0} de ${p.muestras} conceptos de ${texto} fueron a esta cuenta`;

    if (dist.length > 1) {
      // ¿Cambio de política? La cuenta más RECIENTE empezó después de que las demás se dejaron de usar.
      const reciente = dist.slice().sort((a, b) => (b.ultima || '').localeCompare(a.ultima || ''))[0];
      const otrasTerminaron = dist.filter((d) => d.cuenta !== reciente.cuenta).every((d) => (d.ultima || '') < (reciente.primera || ''));
      if (reciente.cuenta !== cuenta && otrasTerminaron && reciente.n >= 2) {
        cuenta = reciente.cuenta;
        nivelConf = especifico ? 'MEDIO' : 'BAJO';
        motivo = `cambio de cuenta desde ${reciente.primera}: las últimas ${reciente.n} operaciones usan ${reciente.cuenta}`;
      } else if (p.consistencia < 0.75) {
        motivo = `contradicción: ${texto} se contabilizó en ${dist.length} cuentas distintas — revisa el contexto antes de elegir`;
        nivelConf = 'BAJO';
      }
    }
    // Proveedor que usa varias cuentas: no basta el RFC (spec §5.1) — distinguir por producto.
    if (nivel === 'RFC' && dist.length > 1) nivelConf = 'BAJO';

    return validar({
      cuenta, nivel: nivelConf, base: nivel, motivo,
      muestras: p.muestras, consistencia: p.consistencia,
      alternativas: conNombre(dist), ejemplos: p.ejemplos || [],
    });
  }

  // 6) Configuración por producto (Asignación por ClaveProdServ).
  const prod = ctx.producto.get(clave);
  if (prod) {
    return validar({
      cuenta: prod, nivel: 'MEDIO', base: 'PRODUCTO', motivo: 'Asignación por producto (configuración de la empresa)',
      muestras: 0, consistencia: null, alternativas: [], ejemplos: [],
    });
  }
  return { cuenta: null, nivel: 'SIN_EVIDENCIA', base: 'NINGUNA', motivo: 'Sin historia ni regla para este proveedor/producto: codifícalo y el motor aprende', muestras: 0, consistencia: null, alternativas: [], ejemplos: [] };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. BANDEJA — Compras 115/601 factura por factura
   ═══════════════════════════════════════════════════════════════════════════ */

export async function bandeja(companyId: string, anio: number, mes: number) {
  const r = await query<any>(
    `SELECT c.id, c.uuid, c.serie, c.folio, TO_CHAR(c.fecha_emision,'YYYY-MM-DD') AS fecha,
            c.rfc_emisor, c.nombre_emisor, c.total::float AS total, c.moneda, c.metodo_pago, c.forma_pago,
            c.uso_cfdi, c.xml,
            (SELECT e.id FROM journal_entries e WHERE e.company_id=c.company_id AND e.origen_uuid=c.uuid LIMIT 1) AS poliza_motor,
            COALESCE(
              (SELECT e.id FROM journal_entries e WHERE e.company_id=c.company_id AND e.origen_uuid=c.uuid LIMIT 1),
              (SELECT jl.entry_id FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
                WHERE je.company_id=c.company_id AND jl.uuid_cfdi=c.uuid AND je.origen <> 'BANCO' LIMIT 1),
              (SELECT j.entry_id FROM journal_entry_cfdi j WHERE j.company_id=c.company_id AND j.uuid=c.uuid LIMIT 1)
            ) AS poliza_id
       FROM cfdi_recibidos c
      WHERE c.company_id=$1 AND c.direccion='recibidos'
        AND (c.tipo_comprobante='I' OR c.tipo_comprobante IS NULL)
        AND (c.estado_sat IS NULL OR c.estado_sat <> 'Cancelado')
        AND c.fecha_emision::date BETWEEN $2 AND $3
      ORDER BY c.fecha_emision, c.folio
      LIMIT 3000`, [companyId, iniDeMes(anio, mes), finDeMes(anio, mes)]);

  const ctx = await cargarContexto(companyId);
  const uuids = r.rows.map((x: any) => x.uuid);
  const decs = uuids.length ? (await query<any>(
    `SELECT uuid, idx, cuenta_codigo, fuente FROM cfdi_concepto_cuenta WHERE company_id=$1 AND uuid = ANY($2::text[])`,
    [companyId, uuids])).rows : [];
  const decMap = new Map<string, any>(decs.map((d: any) => [`${d.uuid}#${d.idx}`, d]));

  const facturas = r.rows.map((c: any) => {
    const rfc = String(c.rfc_emisor || '').toUpperCase();
    const base = {
      id: c.id, uuid: c.uuid, folio: [c.serie, c.folio].filter(Boolean).join('-') || String(c.uuid).slice(0, 8),
      fecha: c.fecha, rfc, nombre: c.nombre_emisor || '', total: round2(c.total), moneda: c.moneda || 'MXN',
      metodoPago: c.metodo_pago, formaPago: c.forma_pago, usoCfdi: c.uso_cfdi, polizaId: c.poliza_id || null,
      polizaDelMotor: !!c.poliza_motor,
    };
    if (!c.xml) return { ...base, estado: 'SIN_XML', conceptos: [], nConceptos: 0, confianza: 'SIN_EVIDENCIA' as Nivel, cuentaSugerida: null };
    const conceptos = conceptosDeXml(String(c.xml)).map((cn, idx) => {
      const d = decMap.get(`${c.uuid}#${idx}`);
      const ef = cuentaEfectiva(ctx, d?.cuenta_codigo, rfc, cn.clave);
      const sug = sugerir(ctx, rfc, cn.clave, cn.descripcion);
      return {
        idx, clave: cn.clave, descripcion: cn.descripcion, importe: round2(cn.importe - cn.descuento),
        cuenta: ef.cuenta, nombreCuenta: ef.cuenta ? ctx.cuentas.get(ef.cuenta)?.nombre : undefined,
        fuente: ef.fuente, decisionFuente: d?.fuente || null, sugerencia: sug,
      };
    });
    const todasConCuenta = conceptos.length > 0 && conceptos.every((x) => x.cuenta);
    const estado = c.poliza_id ? 'CONTABILIZADA' : todasConCuenta ? 'CODIFICADA' : 'PENDIENTE';
    // Confianza de la FACTURA = la más baja de sus conceptos (una sola duda la manda a revisión).
    const confianza = conceptos.reduce<Nivel>((min, x) => RANGO[x.sugerencia.nivel] < RANGO[min] ? x.sugerencia.nivel : min, 'ALTO');
    const sugeridas = [...new Set(conceptos.map((x) => x.sugerencia.cuenta).filter(Boolean))];
    return {
      ...base, estado, conceptos, nConceptos: conceptos.length,
      confianza: conceptos.length ? confianza : 'SIN_EVIDENCIA',
      cuentaSugerida: sugeridas.length === 1 ? sugeridas[0] : sugeridas.length > 1 ? `${sugeridas.length} cuentas` : null,
    };
  });

  const cuenta = (f: (x: any) => boolean) => facturas.filter(f).length;
  return {
    facturas,
    resumen: {
      total: facturas.length,
      contabilizadas: cuenta((f) => f.estado === 'CONTABILIZADA'),
      codificadas: cuenta((f) => f.estado === 'CODIFICADA'),
      pendientes: cuenta((f) => f.estado === 'PENDIENTE'),
      sinXml: cuenta((f) => f.estado === 'SIN_XML'),
      importePendiente: round2(facturas.filter((f) => f.estado === 'PENDIENTE').reduce((a, f) => a + f.total, 0)),
      pendientesPorConfianza: {
        ALTO: cuenta((f) => f.estado === 'PENDIENTE' && f.confianza === 'ALTO'),
        MEDIO: cuenta((f) => f.estado === 'PENDIENTE' && f.confianza === 'MEDIO'),
        BAJO: cuenta((f) => f.estado === 'PENDIENTE' && f.confianza === 'BAJO'),
        SIN_EVIDENCIA: cuenta((f) => f.estado === 'PENDIENTE' && f.confianza === 'SIN_EVIDENCIA'),
      },
      memoriaVacia: ctx.patrones.size === 0,
      modoCuentaUnica: ctx.unica,
    },
  };
}

/** Lo que falta por codificar en el periodo (para la validación previa a estados financieros). */
export async function pendientesDeCodificar(companyId: string, anio: number, mes: number) {
  const b = await bandeja(companyId, anio, mes);
  return {
    pendientes: b.resumen.pendientes, importe: b.resumen.importePendiente, sinXml: b.resumen.sinXml,
    items: b.facturas.filter((f: any) => f.estado === 'PENDIENTE').slice(0, 50)
      .map((f: any) => ({ uuid: f.uuid, folio: f.folio, fecha: f.fecha, rfc: f.rfc, nombre: f.nombre, total: f.total, confianza: f.confianza })),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. DECISIONES — codificar una factura, aceptar sugerencias, gobernar reglas
   ═══════════════════════════════════════════════════════════════════════════ */

async function facturaRecibida(companyId: string, uuid: string) {
  const c = (await query<any>(
    `SELECT c.uuid, c.rfc_emisor, c.nombre_emisor, c.xml,
            EXISTS (SELECT 1 FROM journal_entries e WHERE e.company_id=c.company_id AND e.origen_uuid=c.uuid)
            OR EXISTS (SELECT 1 FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
                        WHERE je.company_id=c.company_id AND jl.uuid_cfdi=c.uuid AND je.origen <> 'BANCO')
            OR EXISTS (SELECT 1 FROM journal_entry_cfdi j WHERE j.company_id=c.company_id AND j.uuid=c.uuid) AS contabilizada
       FROM cfdi_recibidos c
      WHERE c.company_id=$1 AND c.direccion='recibidos' AND c.uuid=$2 LIMIT 1`, [companyId, uuid])).rows[0];
  return c || null;
}

/**
 * Guarda la codificación de UNA factura, concepto por concepto. No se recodifica una
 * factura ya contabilizada (spec §19.9: no cambiar silenciosamente pólizas generadas):
 * para eso, «Descontabilizar mes» y volver a generar.
 */
export async function codificarFactura(
  companyId: string, uuid: string, conceptos: Array<{ idx: number; cuenta: string | null }>,
  opts: { guardarRegla?: boolean; motivo?: string; fuente?: 'USUARIO' | 'SUGERENCIA' } = {}, userId?: string,
) {
  const c = await facturaRecibida(companyId, uuid);
  if (!c) throw new Error('No se encontró la factura recibida.');
  if (c.contabilizada) throw new Error('La factura ya tiene póliza. Para recodificarla, descontabiliza el mes y vuelve a generar.');
  if (!c.xml) throw new Error('La factura no tiene XML (sólo metadato): no hay conceptos que codificar.');
  const xs = conceptosDeXml(String(c.xml));
  const ctx = await cargarContexto(companyId);
  const rfc = String(c.rfc_emisor || '').toUpperCase();

  let guardados = 0, borrados = 0; const reglas: string[] = [];
  for (const k of conceptos) {
    const cn = xs[Number(k.idx)];
    if (!cn) continue;
    const cuenta = (k.cuenta || '').trim();
    if (!cuenta) {
      const d = await query(`DELETE FROM cfdi_concepto_cuenta WHERE company_id=$1 AND uuid=$2 AND idx=$3`, [companyId, uuid, k.idx]);
      borrados += d.rowCount || 0; continue;
    }
    const cta = ctx.cuentas.get(cuenta);
    if (!cta) throw new Error(`La cuenta ${cuenta} no existe en el catálogo.`);
    if (!cta.movible) throw new Error(`La cuenta ${cuenta} no admite movimientos (es de mayor o está inactiva).`);
    const sug = sugerir(ctx, rfc, cn.clave, cn.descripcion);
    await query(
      `INSERT INTO cfdi_concepto_cuenta (company_id, uuid, idx, clave, descripcion, importe, cuenta_codigo, fuente, regla_id, confianza, decidido_por, decidido_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       ON CONFLICT (company_id, uuid, idx) DO UPDATE SET
         cuenta_codigo=EXCLUDED.cuenta_codigo, fuente=EXCLUDED.fuente, regla_id=EXCLUDED.regla_id,
         confianza=EXCLUDED.confianza, decidido_por=EXCLUDED.decidido_por, decidido_at=NOW()`,
      [companyId, uuid, k.idx, cn.clave, (cn.descripcion || '').slice(0, 300), round2(cn.importe - cn.descuento), cuenta,
       opts.fuente || 'USUARIO', sug.cuenta === cuenta ? sug.regla_id || null : null, sug.nivel, userId || null]);
    guardados++;
    await auditar(companyId, {
      accion: opts.fuente === 'SUGERENCIA' ? 'ACEPTAR_SUGERENCIA' : 'CODIFICAR', uuid, regla_id: sug.regla_id,
      cuenta_sugerida: sug.cuenta, cuenta_final: cuenta, confianza: sug.nivel,
      motivo: opts.motivo || (sug.cuenta && sug.cuenta !== cuenta ? 'el usuario eligió otra cuenta' : null),
      detalle: { idx: k.idx, clave: cn.clave, rfc },
    }, userId);
    if (opts.guardarRegla && cn.clave && rfc) {
      const id = await aprobarReglaDirecta(companyId, rfc, c.nombre_emisor, cn.clave, cuenta, userId, 'Guardada desde la codificación de la factura ' + uuid);
      if (id) reglas.push(id);
    }
  }
  return { guardados, borrados, reglas: [...new Set(reglas)].length };
}

/** Acepta las sugerencias de las facturas PENDIENTES del periodo con confianza ≥ mínimo. */
export async function aceptarSugerencias(companyId: string, anio: number, mes: number, minimo: Nivel, userId?: string) {
  if (!['ALTO', 'MEDIO'].includes(minimo)) throw new Error('Sólo se aceptan en bloque las sugerencias de confianza ALTA o MEDIA.');
  const b = await bandeja(companyId, anio, mes);
  let facturas = 0, conceptos = 0;
  for (const f of b.facturas as any[]) {
    if (f.estado !== 'PENDIENTE') continue;
    const aceptar = f.conceptos.filter((x: any) => !x.cuenta && x.sugerencia.cuenta && !x.sugerencia.incidencia
      && RANGO[x.sugerencia.nivel as Nivel] >= RANGO[minimo]);
    if (!aceptar.length) continue;
    await codificarFactura(companyId, f.uuid, aceptar.map((x: any) => ({ idx: x.idx, cuenta: x.sugerencia.cuenta })),
      { fuente: 'SUGERENCIA', motivo: `aceptada en bloque (confianza ≥ ${minimo})` }, userId);
    facturas++; conceptos += aceptar.length;
  }
  return { facturas, conceptos };
}

/** Crea (o versiona) una regla APROBADA directamente — el usuario la está decidiendo. */
async function aprobarReglaDirecta(
  companyId: string, rfc: string, nombre: string | null, clave: string, cuenta: string, userId?: string, motivo?: string,
): Promise<string | null> {
  return transaction(async (client) => {
    const viva = (await transactionQuery<any>(client,
      `SELECT * FROM cod_reglas WHERE company_id=$1 AND direccion='compras' AND rfc=$2 AND clave=$3
          AND estado IN ('PROPUESTA','APROBADA','SUSPENDIDA') FOR UPDATE`, [companyId, rfc, clave])).rows[0];
    if (viva && viva.estado === 'APROBADA' && viva.cuenta_codigo === cuenta) return viva.id;
    if (viva && viva.cuenta_codigo === cuenta) {
      await transactionQuery(client,
        `UPDATE cod_reglas SET estado='APROBADA', aprobado_por=$2, aprobado_at=NOW(), motivo=COALESCE($3,motivo), updated_at=NOW() WHERE id=$1`,
        [viva.id, userId || null, motivo || null]);
      await auditarCli(client, companyId, { accion: 'REGLA_APROBAR', regla_id: viva.id, cuenta_final: cuenta, motivo }, userId);
      return viva.id;
    }
    if (viva) {
      await transactionQuery(client, `UPDATE cod_reglas SET estado='SUSTITUIDA', updated_at=NOW() WHERE id=$1`, [viva.id]);
    }
    const n = (await transactionQuery<any>(client,
      `INSERT INTO cod_reglas (company_id, direccion, rfc, nombre, clave, cuenta_codigo, estado, origen, version,
                               sustituye_id, motivo, aprobado_por, aprobado_at, created_by,
                               muestras, consistencia, primera, ultima, evidencia)
       VALUES ($1,'compras',$2,$3,$4,$5,'APROBADA','USUARIO',$6,$7,$8,$9,NOW(),$9,
               COALESCE($10,0),$11,$12,$13,COALESCE($14,'[]'::jsonb))
       RETURNING id`,
      [companyId, rfc, nombre, clave, cuenta, viva ? Number(viva.version) + 1 : 1, viva?.id || null, motivo || null,
       userId || null, viva?.muestras ?? null, viva?.consistencia ?? null, viva?.primera ?? null, viva?.ultima ?? null,
       viva ? JSON.stringify(viva.evidencia || []) : null])).rows[0];
    await auditarCli(client, companyId, {
      accion: viva ? 'REGLA_VERSION' : 'REGLA_CREAR', regla_id: n.id, cuenta_sugerida: viva?.cuenta_codigo, cuenta_final: cuenta, motivo,
      detalle: { rfc, clave, sustituye: viva?.id || null },
    }, userId);
    return n.id;
  });
}

export async function crearRegla(companyId: string, b: { rfc: string; nombre?: string; clave?: string; cuenta: string; motivo?: string }, userId?: string) {
  const rfc = String(b.rfc || '').toUpperCase().trim();
  if (!rfc) throw new Error('Falta el RFC del proveedor.');
  const cuentas = await catalogoVigente(companyId);
  const cta = cuentas.get(String(b.cuenta || '').trim());
  if (!cta || !cta.movible) throw new Error('La cuenta no existe o no admite movimientos.');
  return aprobarReglaDirecta(companyId, rfc, b.nombre || null, String(b.clave || '').trim(), String(b.cuenta).trim(), userId, b.motivo || 'Creada a mano');
}

/** Cambia el ESTADO de una regla (aprobar / rechazar / suspender / reactivar), o su cuenta (nueva versión). */
export async function gobernarRegla(
  companyId: string, id: string, b: { estado?: string; cuenta?: string; motivo?: string }, userId?: string,
) {
  const r = (await query<any>(`SELECT * FROM cod_reglas WHERE company_id=$1 AND id=$2`, [companyId, id])).rows[0];
  if (!r) throw new Error('Regla no encontrada.');
  if (b.cuenta && b.cuenta !== r.cuenta_codigo) {
    const cuentas = await catalogoVigente(companyId);
    const cta = cuentas.get(b.cuenta.trim());
    if (!cta || !cta.movible) throw new Error('La cuenta no existe o no admite movimientos.');
    return { id: await aprobarReglaDirecta(companyId, r.rfc, r.nombre, r.clave, b.cuenta.trim(), userId, b.motivo || 'Cuenta cambiada por el usuario') };
  }
  const estado = String(b.estado || '').toUpperCase();
  if (!['APROBADA', 'RECHAZADA', 'SUSPENDIDA'].includes(estado)) throw new Error('Estado inválido.');
  if (r.estado === 'SUSTITUIDA' || r.estado === 'RECHAZADA') {
    if (estado !== 'APROBADA') throw new Error('Esa regla ya no está viva.');
    // Reactivar una histórica = nueva versión aprobada con su cuenta.
    return { id: await aprobarReglaDirecta(companyId, r.rfc, r.nombre, r.clave, r.cuenta_codigo, userId, b.motivo || 'Reactivada') };
  }
  await query(
    `UPDATE cod_reglas SET estado=$3, motivo=COALESCE($4,motivo), updated_at=NOW(),
            aprobado_por=CASE WHEN $3='APROBADA' THEN $5::uuid ELSE aprobado_por END,
            aprobado_at=CASE WHEN $3='APROBADA' THEN NOW() ELSE aprobado_at END
      WHERE company_id=$1 AND id=$2`, [companyId, id, estado, b.motivo || null, userId || null]);
  await auditar(companyId, { accion: `REGLA_${estado}`, regla_id: id, cuenta_final: r.cuenta_codigo, motivo: b.motivo }, userId);
  return { id };
}

/** Aprueba en bloque las reglas PROPUESTAS con evidencia fuerte (n ≥ minMuestras, consistencia ≥ minCons). */
export async function aprobarPropuestas(companyId: string, ids: string[] | null, userId?: string) {
  const r = await query<any>(
    `UPDATE cod_reglas SET estado='APROBADA', aprobado_por=$3, aprobado_at=NOW(), updated_at=NOW()
      WHERE company_id=$1 AND estado='PROPUESTA' AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
      RETURNING id, cuenta_codigo`, [companyId, ids && ids.length ? ids : null, userId || null]);
  for (const x of r.rows) await auditar(companyId, { accion: 'REGLA_APROBAR', regla_id: x.id, cuenta_final: x.cuenta_codigo, motivo: 'aprobada en bloque' }, userId);
  return { aprobadas: r.rowCount || 0 };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. CONSULTAS — memoria, reglas, evidencia, resumen de la historia
   ═══════════════════════════════════════════════════════════════════════════ */

export async function listarReglas(companyId: string, estado?: string) {
  const r = await query<any>(
    `SELECT r.id, r.rfc, r.nombre, r.clave, r.cuenta_codigo, a.nombre AS cuenta_nombre, r.estado, r.origen,
            r.muestras, r.consistencia::float AS consistencia, TO_CHAR(r.primera,'YYYY-MM-DD') AS primera,
            TO_CHAR(r.ultima,'YYYY-MM-DD') AS ultima, r.version, r.motivo, r.evidencia,
            TO_CHAR(r.aprobado_at,'YYYY-MM-DD HH24:MI') AS aprobado_at, u.email AS aprobado_por,
            TO_CHAR(r.created_at,'YYYY-MM-DD HH24:MI') AS creada
       FROM cod_reglas r
       LEFT JOIN accounting_accounts a ON a.company_id=r.company_id AND a.codigo=r.cuenta_codigo
       LEFT JOIN users u ON u.id=r.aprobado_por
      WHERE r.company_id=$1 AND r.direccion='compras' AND ($2::text IS NULL OR r.estado=$2)
      ORDER BY CASE r.estado WHEN 'PROPUESTA' THEN 0 WHEN 'APROBADA' THEN 1 WHEN 'SUSPENDIDA' THEN 2 ELSE 3 END,
               r.muestras DESC, r.nombre
      LIMIT 2000`, [companyId, estado || null]);
  return r.rows;
}

/** La memoria agrupada por proveedor (nivel RFC) con su detalle por producto. */
export async function memoria(companyId: string, q?: string) {
  const filtro = (q || '').trim().toUpperCase();
  const prov = (await query<any>(
    `SELECT rfc, nombre, cuenta_top, muestras, consistencia::float AS consistencia, distribucion,
            TO_CHAR(primera,'YYYY-MM-DD') AS primera, TO_CHAR(ultima,'YYYY-MM-DD') AS ultima
       FROM cod_patrones
      WHERE company_id=$1 AND direccion='compras' AND nivel='RFC'
        AND ($2 = '' OR rfc LIKE '%'||$2||'%' OR UPPER(nombre) LIKE '%'||$2||'%')
      ORDER BY muestras DESC LIMIT 500`, [companyId, filtro])).rows;
  const rfcs = prov.map((p: any) => p.rfc);
  const det = rfcs.length ? (await query<any>(
    `SELECT rfc, nivel, clave, descripcion, cuenta_top, muestras, consistencia::float AS consistencia, distribucion, ejemplos,
            TO_CHAR(primera,'YYYY-MM-DD') AS primera, TO_CHAR(ultima,'YYYY-MM-DD') AS ultima
       FROM cod_patrones WHERE company_id=$1 AND direccion='compras' AND nivel IN ('RFC_CLAVE','RFC_DESC')
        AND rfc = ANY($2::text[]) ORDER BY muestras DESC`, [companyId, rfcs])).rows : [];
  const reglas = await reglasVivas(companyId);
  const cuentas = await catalogoVigente(companyId);
  return prov.map((p: any) => {
    const productos = det.filter((d: any) => d.rfc === p.rfc).map((d: any) => ({
      ...d, cuentaNombre: cuentas.get(d.cuenta_top)?.nombre, regla: reglas.get(`${p.rfc}|${d.clave}`) || null,
    }));
    const cuentasDistintas = (p.distribucion || []).length;
    // Contradicción REAL: dentro de un mismo producto se usaron cuentas distintas (no
    // basta con que el proveedor tenga varias cuentas: puede vender cosas distintas).
    const contradicciones = productos.filter((d: any) => (d.distribucion || []).length > 1 && d.consistencia < 0.9).length;
    return {
      ...p, cuentaNombre: cuentas.get(p.cuenta_top)?.nombre, cuentasDistintas, contradicciones,
      explicadoPorProducto: cuentasDistintas > 1 && contradicciones === 0,
      reglaProveedor: reglas.get(`${p.rfc}|`) || null, productos,
    };
  });
}

/** Evidencia consultable de una sugerencia: las pólizas y XML que la sostienen. */
export async function evidencia(companyId: string, rfc: string, clave: string) {
  const pats = (await query<any>(
    `SELECT nivel, clave, descripcion, cuenta_top, muestras, consistencia::float AS consistencia, distribucion, ejemplos
       FROM cod_patrones WHERE company_id=$1 AND direccion='compras'
        AND ((nivel IN ('RFC_CLAVE','RFC_DESC') AND rfc=$2 AND clave=$3) OR (nivel='RFC' AND rfc=$2) OR (nivel='CLAVE' AND clave=$3))`,
    [companyId, (rfc || '').toUpperCase(), clave || ''])).rows;
  const ids = [...new Set(pats.flatMap((p: any) => (p.ejemplos || []).map((e: any) => e.entry_id)).filter(Boolean))];
  const ents = ids.length ? (await query<any>(
    `SELECT e.id, e.folio, e.tipo, TO_CHAR(e.fecha,'YYYY-MM-DD') AS fecha, e.concepto, e.origen, e.regla
       FROM journal_entries e WHERE e.company_id=$1 AND e.id = ANY($2::uuid[])`, [companyId, ids])).rows : [];
  const porId = new Map<string, any>(ents.map((e: any) => [e.id, e]));
  const orden: Record<string, number> = { RFC_CLAVE: 0, RFC_DESC: 1, CLAVE: 2, RFC: 3 };
  return pats.sort((a: any, b: any) => orden[a.nivel] - orden[b.nivel]).map((p: any) => ({
    ...p, ejemplos: (p.ejemplos || []).map((e: any) => ({ ...e, poliza: e.entry_id ? porId.get(e.entry_id) || null : null })),
  }));
}

/** Pantalla de recuperación y aprendizaje (spec §15): qué tanto de la historia se entiende. */
export async function resumen(companyId: string) {
  const [pol, xml, pat, reg, aud] = await Promise.all([
    query<any>(
      `SELECT COUNT(*)::int AS polizas,
              COUNT(*) FILTER (WHERE e.origen='CONTPAQI' OR e.origen_uuid LIKE 'CTLK:%'
                                OR e.regla LIKE '%migrado' OR e.regla='contpaqi_v1')::int AS importadas,
              COUNT(*) FILTER (WHERE e.origen='CFDI')::int AS motor,
              TO_CHAR(MIN(e.fecha),'YYYY-MM-DD') AS desde, TO_CHAR(MAX(e.fecha),'YYYY-MM-DD') AS hasta,
              (SELECT COUNT(*)::int FROM journal_lines l JOIN journal_entries x ON x.id=l.entry_id WHERE x.company_id=$1) AS partidas
         FROM journal_entries e WHERE e.company_id=$1`, [companyId]),
    query<any>(
      `SELECT COUNT(*)::int AS recibidos,
              COUNT(*) FILTER (WHERE c.xml IS NOT NULL)::int AS con_xml,
              COUNT(*) FILTER (WHERE
                 EXISTS (SELECT 1 FROM journal_entries e WHERE e.company_id=c.company_id AND e.origen_uuid=c.uuid)
                 OR EXISTS (SELECT 1 FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
                             WHERE je.company_id=c.company_id AND jl.uuid_cfdi=c.uuid AND je.origen <> 'BANCO')
                 OR EXISTS (SELECT 1 FROM journal_entry_cfdi j WHERE j.company_id=c.company_id AND j.uuid=c.uuid))::int AS con_poliza
         FROM cfdi_recibidos c
        WHERE c.company_id=$1 AND c.direccion='recibidos'
          AND (c.tipo_comprobante='I' OR c.tipo_comprobante IS NULL)
          AND (c.estado_sat IS NULL OR c.estado_sat <> 'Cancelado')`, [companyId]),
    query<any>(
      `SELECT nivel, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE jsonb_array_length(distribucion) > 1 AND consistencia < 0.9)::int AS contradicciones,
              TO_CHAR(MAX(created_at),'YYYY-MM-DD HH24:MI') AS aprendido
         FROM cod_patrones WHERE company_id=$1 AND direccion='compras' GROUP BY nivel`, [companyId]),
    query<any>(`SELECT estado, COUNT(*)::int AS n FROM cod_reglas WHERE company_id=$1 AND direccion='compras' GROUP BY estado`, [companyId]),
    query<any>(
      `SELECT a.accion, a.uuid, a.cuenta_sugerida, a.cuenta_final, a.confianza, a.motivo,
              TO_CHAR(a.created_at,'YYYY-MM-DD HH24:MI') AS fecha, u.email AS usuario
         FROM cod_auditoria a LEFT JOIN users u ON u.id=a.user_id
        WHERE a.company_id=$1 ORDER BY a.created_at DESC LIMIT 30`, [companyId]),
  ]);
  const patrones: Record<string, any> = {};
  for (const p of pat.rows) patrones[p.nivel] = p;
  const reglas: Record<string, number> = {};
  for (const r of reg.rows) reglas[r.estado] = r.n;
  const x = xml.rows[0];
  return {
    historia: pol.rows[0],
    xml: { ...x, sin_poliza: x.recibidos - x.con_poliza, pctRelacionado: x.recibidos ? Math.round((x.con_poliza / x.recibidos) * 1000) / 10 : null },
    patrones, reglas, ultimoAprendizaje: Object.values(patrones).map((p: any) => p.aprendido).sort().pop() || null,
    auditoria: aud.rows,
  };
}

/* ── Auditoría ─────────────────────────────────────────────────────────────── */
interface EvAud { accion: string; uuid?: string | null; regla_id?: string | null; cuenta_sugerida?: string | null; cuenta_final?: string | null; confianza?: string | null; motivo?: string | null; detalle?: any }
async function auditar(companyId: string, a: EvAud, userId?: string) {
  await query(
    `INSERT INTO cod_auditoria (company_id, accion, uuid, regla_id, cuenta_sugerida, cuenta_final, confianza, motivo, detalle, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
    [companyId, a.accion, a.uuid || null, a.regla_id || null, a.cuenta_sugerida || null, a.cuenta_final || null,
     a.confianza || null, a.motivo || null, a.detalle ? JSON.stringify(a.detalle) : null, userId || null]).catch(() => undefined);
}
async function auditarCli(client: any, companyId: string, a: EvAud, userId?: string) {
  await transactionQuery(client,
    `INSERT INTO cod_auditoria (company_id, accion, uuid, regla_id, cuenta_sugerida, cuenta_final, confianza, motivo, detalle, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
    [companyId, a.accion, a.uuid || null, a.regla_id || null, a.cuenta_sugerida || null, a.cuenta_final || null,
     a.confianza || null, a.motivo || null, a.detalle ? JSON.stringify(a.detalle) : null, userId || null]);
}

export type { Direccion };
