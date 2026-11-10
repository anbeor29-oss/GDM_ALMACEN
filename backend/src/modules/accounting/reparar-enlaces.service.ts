/**
 * Reparar enlaces del respaldo (opción B del documento de recuperación).
 *
 * EL PROBLEMA QUE RESUELVE
 * Un respaldo de Contalink/CPQ asienta las pólizas TAL CUAL (correctas, cuadradas),
 * pero sólo graba el enlace UUID↔póliza (`journal_entry_cfdi`) cuando el export trae
 * el bloque «CFDI Asociados a la póliza». Cuando ese bloque falta, la póliza queda
 * SIN saber a qué XML corresponde → la pantalla de Asignación (que pregunta factura
 * por factura «¿este UUID ya está en una póliza?») la ve como PENDIENTE, y el motor,
 * al no ver el enlace, la DUPLICARÍA si se le diera «Generar».
 *
 * QUÉ HACE
 * Para cada CFDI (recibido=compra, emitido=venta) que AÚN no tiene póliza por ninguna
 * vía, busca su póliza de respaldo probable y, si la identifica con seguridad, graba
 * el enlace faltante en `journal_entry_cfdi`. Así el histórico queda enlazado, el aviso
 * de «por clasificar» baja a lo que de verdad falte, y el motor deja de poder duplicar.
 *
 * CÓMO EMPAREJA (conservador — ante la duda, NO enlaza)
 *   · Candidata = póliza de RESPALDO (origen CONTPAQI, o origen_uuid 'CTLK:%', o regla
 *     '%migrado%'), del tipo correcto (compra para recibidos, venta para emitidos),
 *     que todavía NO está ligada a ningún CFDI.
 *   · Importe EXACTO (a 1 centavo): el total del CFDI = suma de cargos de la póliza.
 *     Los totales con centavos son muy discriminantes (629.00, 3,131.95…), así que el
 *     empate exacto + UNICIDAD es una llave fuerte.
 *   · Fecha dentro de ±45 días.
 *   · UNICIDAD: sólo se enlaza si queda EXACTAMENTE UNA candidata libre. Si hay 2+ →
 *     ambiguo (se reporta, no se toca). Si hay 0 → sin candidata (de verdad no está
 *     en el respaldo).
 *   · Una candidata ya consumida en esta corrida no se vuelve a usar (1:1).
 *
 * CONFIANZA (igual que la bandeja del agente: ALTA/MEDIA/BAJA)
 *   · ALTA  — la póliza trae RFC de tercero y coincide con el del CFDI.
 *   · MEDIA — la póliza no trae RFC, pero su concepto contiene el FOLIO o el NOMBRE del
 *             tercero del CFDI.
 *   · BAJA  — sólo importe exacto + tipo + fecha, candidata única (sin más evidencia).
 * El usuario elige hasta qué nivel aplicar. Una póliza con RFC que NO coincide se
 * descarta (evidencia en contra), nunca baja a BAJA.
 *
 * SÓLO AÑADE el enlace que faltaba; no modifica importes, cuentas ni cuadre de ninguna
 * póliza. Es idempotente (ON CONFLICT DO NOTHING) y re-ejecutable.
 */
import { query } from '../../config/database';
import { cfdiYaContabilizado } from './cfdi-contabilizado';

export type Confianza = 'ALTA' | 'MEDIA' | 'BAJA';
const NIVEL: Record<Confianza, number> = { BAJA: 1, MEDIA: 2, ALTA: 3 };

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const cents = (n: any) => Math.round((Number(n) || 0) * 100);
const norm = (v: any) => String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const diasEntre = (a: string, b: string) =>
  Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

interface CfdiPend {
  uuid: string; rfc: string; nombre: string; serie: string; folio: string;
  total: number; fecha: string;
}
interface Candidata {
  id: string; fecha: string; concepto: string; total: number;
  rfcs: string[]; conceptoNorm: string;
}
interface Par {
  uuid: string; folio: string; rfc: string; total: number; fecha: string;
  entryId: string; entryFecha: string; confianza: Confianza; motivo: string;
}

/** Filtro SQL de pólizas de RESPALDO (documento), con exclusiones por dirección. */
function filtroRespaldo(direccion: 'recibidos' | 'emitidos'): string {
  const excluirTipoContrario = direccion === 'recibidos'
    ? `AND COALESCE(e.regla,'') NOT LIKE '%venta%'`
    : `AND COALESCE(e.regla,'') NOT LIKE '%compra%'`;
  return `
    (e.origen='CONTPAQI' OR e.origen_uuid LIKE 'CTLK:%' OR COALESCE(e.regla,'') LIKE '%migrado%')
    AND COALESCE(e.regla,'') NOT LIKE 'cierre%'
    AND COALESCE(e.regla,'') NOT LIKE '%cobro%'
    AND COALESCE(e.regla,'') NOT LIKE '%pago%'
    ${excluirTipoContrario}`;
}

/** CFDIs del tipo/dirección que AÚN no tienen póliza por ninguna vía. */
async function cfdisSinEnlace(companyId: string, direccion: 'recibidos' | 'emitidos', anio?: number): Promise<CfdiPend[]> {
  const rfcCol = direccion === 'recibidos' ? 'c.rfc_emisor' : 'c.rfc_receptor';
  const nomCol = direccion === 'recibidos' ? 'c.nombre_emisor' : 'c.nombre_receptor';
  const r = await query<any>(
    `SELECT c.uuid, ${rfcCol} AS rfc, ${nomCol} AS nombre, c.serie, c.folio,
            c.total::float AS total, c.fecha_emision::date AS fecha
       FROM cfdi_recibidos c
      WHERE c.company_id=$1 AND c.direccion=$2 AND c.tipo_comprobante='I'
        AND (c.estado_sat IS NULL OR c.estado_sat <> 'Cancelado')
        AND c.total IS NOT NULL AND c.total > 0
        ${anio ? 'AND EXTRACT(YEAR FROM c.fecha_emision)=$3' : ''}
        AND NOT ${cfdiYaContabilizado('c')}
      ORDER BY c.fecha_emision`,
    anio ? [companyId, direccion, anio] : [companyId, direccion]);
  return r.rows.map((x: any) => ({
    uuid: x.uuid, rfc: norm(x.rfc), nombre: x.nombre || '', serie: x.serie || '', folio: x.folio || '',
    total: r2(x.total), fecha: String(x.fecha).slice(0, 10),
  }));
}

/** Pólizas de respaldo (del tipo) libres de enlace, con su total y RFC si lo traen. */
async function candidatasLibres(companyId: string, direccion: 'recibidos' | 'emitidos', anio?: number): Promise<Candidata[]> {
  const r = await query<any>(
    `SELECT e.id, e.fecha::date AS fecha, COALESCE(e.concepto,'') AS concepto,
            COALESCE(SUM(l.cargo),0)::float AS total,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT l.party_rfc), NULL) AS rfcs
       FROM journal_entries e
       JOIN journal_lines l ON l.entry_id=e.id
      WHERE e.company_id=$1
        AND ${filtroRespaldo(direccion)}
        ${anio ? 'AND EXTRACT(YEAR FROM e.fecha)=$2' : ''}
        AND NOT EXISTS (SELECT 1 FROM journal_entry_cfdi j WHERE j.entry_id=e.id)
        AND NOT EXISTS (SELECT 1 FROM journal_lines l2 WHERE l2.entry_id=e.id AND l2.uuid_cfdi IS NOT NULL)
      GROUP BY e.id, e.fecha, e.concepto
      HAVING COALESCE(SUM(l.cargo),0) > 0`,
    anio ? [companyId, anio] : [companyId]);
  return r.rows.map((x: any) => ({
    id: x.id, fecha: String(x.fecha).slice(0, 10), concepto: x.concepto, total: r2(x.total),
    rfcs: (x.rfcs || []).map((s: string) => norm(s)).filter(Boolean),
    conceptoNorm: norm(x.concepto),
  }));
}

/** Empareja una dirección en memoria, con unicidad y consumo 1:1. */
function emparejar(cfdis: CfdiPend[], cands: Candidata[]) {
  // Índice por centavos exactos (y vecinos ±1 por redondeo).
  const porCent = new Map<number, Candidata[]>();
  for (const c of cands) {
    const k = cents(c.total);
    (porCent.get(k) || porCent.set(k, []).get(k)!).push(c);
  }
  const consumidas = new Set<string>();
  const pares: Par[] = [];
  const emparejado = new Set<string>();
  let ambiguos = 0, sinCandidata = 0;

  const candidatasDe = (f: CfdiPend): Candidata[] => {
    const k = cents(f.total);
    const pool = [...(porCent.get(k) || []), ...(porCent.get(k - 1) || []), ...(porCent.get(k + 1) || [])];
    return pool.filter((c) => !consumidas.has(c.id) && diasEntre(c.fecha, f.fecha) <= 45);
  };
  const tieneSenalNombre = (c: Candidata, f: CfdiPend): boolean => {
    if (f.folio && String(f.folio).length >= 3 && c.conceptoNorm.includes(norm(f.folio))) return true;
    const tok = norm(f.nombre).split(/[^A-Z0-9]+/).filter((t) => t.length >= 4);
    return tok.some((t) => c.conceptoNorm.includes(t));
  };

  // Tres pasadas, de mayor a menor confianza; cada una re-evalúa contra lo que quede.
  const pasada = (conf: Confianza, ok: (c: Candidata, f: CfdiPend) => boolean) => {
    for (const f of cfdis) {
      if (emparejado.has(f.uuid)) continue;
      const cand = candidatasDe(f);
      const conRfc = cand.filter((c) => c.rfcs.length > 0);
      // Si alguna candidata trae un RFC que NO coincide, es evidencia en contra:
      // sólo se consideran las que coinciden (ALTA) — nunca cae a MEDIA/BAJA con conflicto.
      const base = conf === 'ALTA'
        ? conRfc.filter((c) => c.rfcs.includes(f.rfc))
        : cand.filter((c) => c.rfcs.length === 0);   // MEDIA/BAJA: sólo pólizas sin RFC
      const elegibles = base.filter((c) => ok(c, f));
      if (elegibles.length === 1) {
        const c = elegibles[0];
        consumidas.add(c.id); emparejado.add(f.uuid);
        pares.push({
          uuid: f.uuid, folio: [f.serie, f.folio].filter(Boolean).join('-') || f.uuid.slice(0, 8),
          rfc: f.rfc, total: f.total, fecha: f.fecha, entryId: c.id, entryFecha: c.fecha,
          confianza: conf,
          motivo: conf === 'ALTA' ? 'importe exacto + RFC del respaldo coincide'
            : conf === 'MEDIA' ? 'importe exacto único + nombre/folio en el concepto'
              : 'importe exacto único (tipo y fecha)',
        });
      }
    }
  };

  pasada('ALTA', () => true);
  pasada('MEDIA', (c, f) => tieneSenalNombre(c, f));
  pasada('BAJA', () => true);

  // Clasifica los que quedaron sin emparejar (para el reporte).
  for (const f of cfdis) {
    if (emparejado.has(f.uuid)) continue;
    const k = cents(f.total);
    const hay = [...(porCent.get(k) || []), ...(porCent.get(k - 1) || []), ...(porCent.get(k + 1) || [])]
      .filter((c) => diasEntre(c.fecha, f.fecha) <= 45);
    if (hay.length >= 1) ambiguos++; else sinCandidata++;
  }
  return { pares, ambiguos, sinCandidata };
}

export interface ReporteReparacion {
  revisados: number;
  porConfianza: { ALTA: number; MEDIA: number; BAJA: number };
  ambiguos: number;
  sinCandidata: number;
  aplicados: number;
  aplicar: boolean;
  confianzaAplicada: Confianza | null;
  muestra: Array<{ direccion: string } & Par>;
}

/**
 * Corre el emparejamiento en ambas direcciones. Si `aplicar`, graba los enlaces de
 * confianza >= `confianza` en `journal_entry_cfdi`. Si no, es un simulacro (dry-run).
 */
export async function repararEnlacesRespaldo(
  companyId: string,
  opts: { anio?: number; aplicar?: boolean; confianza?: Confianza } = {},
): Promise<ReporteReparacion> {
  const { anio, aplicar = false, confianza = 'ALTA' } = opts;
  const dirs: Array<'recibidos' | 'emitidos'> = ['recibidos', 'emitidos'];
  const todos: Array<{ direccion: string } & Par> = [];
  let revisados = 0;
  const porConf = { ALTA: 0, MEDIA: 0, BAJA: 0 };
  let ambiguos = 0, sinCandidata = 0;

  for (const dir of dirs) {
    const [cfdis, cands] = await Promise.all([
      cfdisSinEnlace(companyId, dir, anio),
      candidatasLibres(companyId, dir, anio),
    ]);
    revisados += cfdis.length;
    const { pares, ambiguos: amb, sinCandidata: sinc } = emparejar(cfdis, cands);
    ambiguos += amb; sinCandidata += sinc;
    for (const p of pares) { porConf[p.confianza]++; todos.push({ direccion: dir, ...p }); }
  }

  let aplicados = 0;
  if (aplicar) {
    const umbral = NIVEL[confianza];
    for (const p of todos) {
      if (NIVEL[p.confianza] < umbral) continue;
      const res = await query<any>(
        `INSERT INTO journal_entry_cfdi (entry_id, company_id, uuid, rfc, tipo_comprobante, documento)
         VALUES ($1,$2,$3,$4,'I',$5)
         ON CONFLICT (entry_id, uuid) DO NOTHING
         RETURNING entry_id`,
        [p.entryId, companyId, p.uuid.slice(0, 40), p.rfc?.slice(0, 13) || null, (p.folio || '').slice(0, 60)]);
      if (res.rowCount) aplicados++;
    }
  }

  // Muestra: prioriza mayor confianza para que el usuario vea primero lo más sólido.
  const muestra = [...todos].sort((a, b) => NIVEL[b.confianza] - NIVEL[a.confianza]).slice(0, 80);
  return {
    revisados, porConfianza: porConf, ambiguos, sinCandidata, aplicados,
    aplicar, confianzaAplicada: aplicar ? confianza : null, muestra,
  };
}

/** Diagnóstico de SÓLO LECTURA: por año, XML recibidos/emitidos, cuántos ya enlazados
 *  a una póliza, y cuántas pólizas de respaldo hay. Para ver cuánto es «ya está, sólo
 *  falta enlazar» vs «de verdad no está en el respaldo». */
export async function diagnosticoEnlaces(companyId: string, anio?: number) {
  const xml = await query<any>(
    `SELECT EXTRACT(YEAR FROM c.fecha_emision)::int AS anio, c.direccion,
            count(*)::int AS total,
            count(*) FILTER (WHERE ${cfdiYaContabilizado('c')})::int AS enlazados
       FROM cfdi_recibidos c
      WHERE c.company_id=$1 AND c.tipo_comprobante='I'
        AND (c.estado_sat IS NULL OR c.estado_sat <> 'Cancelado')
        AND c.fecha_emision IS NOT NULL
        ${anio ? 'AND EXTRACT(YEAR FROM c.fecha_emision)=$2' : ''}
      GROUP BY 1,2`,
    anio ? [companyId, anio] : [companyId]);

  const pol = await query<any>(
    `SELECT EXTRACT(YEAR FROM e.fecha)::int AS anio, count(*)::int AS polizas
       FROM journal_entries e
      WHERE e.company_id=$1
        AND (e.origen='CONTPAQI' OR e.origen_uuid LIKE 'CTLK:%' OR COALESCE(e.regla,'') LIKE '%migrado%')
        ${anio ? 'AND EXTRACT(YEAR FROM e.fecha)=$2' : ''}
      GROUP BY 1`,
    anio ? [companyId, anio] : [companyId]);

  const porAnio = new Map<number, any>();
  const fila = (a: number) => porAnio.get(a) || porAnio.set(a, {
    anio: a, recibidos: { total: 0, enlazados: 0 }, emitidos: { total: 0, enlazados: 0 }, polizasRespaldo: 0,
  }).get(a);
  for (const x of xml.rows) {
    const f = fila(x.anio);
    if (x.direccion === 'recibidos') f.recibidos = { total: x.total, enlazados: x.enlazados };
    else if (x.direccion === 'emitidos') f.emitidos = { total: x.total, enlazados: x.enlazados };
  }
  for (const p of pol.rows) fila(p.anio).polizasRespaldo = p.polizas;
  return { porAnio: [...porAnio.values()].sort((a, b) => a.anio - b.anio) };
}
