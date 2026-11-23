/**
 * nomina-emitida-xml.service — Pólizas → Nómina → Emitida cuando la nómina NO salió
 * del módulo de Nómina: la busca en la BÓVEDA de XML (cfdi_recibidos, EMITIDOS tipo
 * N), la agrupa en corridas y la baja a la contabilidad con la MISMA póliza de
 * provisión que la corrida del módulo (ver nomina-emitida-xml.ts).
 *
 * CANDADOS CONTRA EL DOBLE REGISTRO (la nómina es gasto: duplicarla lo infla)
 *   1. Se EXCLUYEN los CFDI que timbró el propio módulo (nomina_recibos.uuid): ésos se
 *      bajan por su corrida, cuya póliza no lleva los UUID en los renglones.
 *   2. «Ya contabilizado» = el predicado ÚNICO cfdiYaContabilizado (origen_uuid,
 *      renglón uuid_cfdi o liga journal_entry_cfdi de un respaldo). Cada CFDI que entra
 *      a una póliza queda LIGADO en journal_entry_cfdi en la MISMA transacción.
 *   3. origen_uuid = NOMXML:<md5 de los UUID incluidos>, único por empresa: un doble
 *      clic simultáneo choca en el índice y no crea dos pólizas.
 *   4. Red de seguridad para respaldos que NO ligaron sus CFDI: si en las fechas de la
 *      corrida ya hay otra póliza con un renglón por el MISMO neto (abono fuera de
 *      caja/bancos) o el MISMO total de percepciones (cargo), la corrida se marca
 *      «posible duplicado» y sale del bloque; se puede forzar una por una, confirmando.
 *
 * NO toca el módulo de Nómina: no crea trabajadores, periodos ni recibos (crear un
 * trabajador exige confirmación explícita — importar-xml.service).
 */
import { createHash } from 'crypto';
import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import { crearPoliza } from '../accounting/polizas.service';
import { cfdiYaContabilizado } from '../accounting/cfdi-contabilizado';
import { conceptosConCuenta } from '../nomina/conceptos-cuenta.service';
import { fechaMx } from '../../utils/fecha-mx';
import {
  parseReciboNominaXml, agruparCorridas, armarPolizaCorrida, etiquetaCorrida, r2,
  type ReciboXml, type CuentaResuelta,
} from './nomina-emitida-xml';

const PREF = 'NOMXML:';
const REGLA = 'nomina_xml_v1';
const TIPO_POLIZA: Record<string, string> = { DIARIO: 'Diario', INGRESO: 'Ingreso', EGRESO: 'Egreso' };

interface ReciboBoveda extends ReciboXml {
  uuid: string; rfc: string; nombre: string; documento: string; contabilizado: boolean;
}

/** Primer y último día del periodo pedido: el mes 1–12, o el año completo con mes 0. */
function rango(anio: number, mes: number): [string, string] {
  if (mes >= 1 && mes <= 12) {
    const mm = String(mes).padStart(2, '0');
    const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    return [`${anio}-${mm}-01`, `${anio}-${mm}-${String(ultimo).padStart(2, '0')}`];
  }
  return [`${anio}-01-01`, `${anio}-12-31`];
}

/**
 * Los recibos de nómina EMITIDOS de la bóveda cuyo periodo DEVENGADO (FechaFinalPago)
 * cae en el periodo pedido —el mismo criterio que las corridas del módulo: el mes es
 * el del periodo que se paga, no el día del pago—. La fecha de emisión sólo acota la
 * búsqueda (un recibo se timbra cerca de su pago: de un mes antes a cuatro después).
 */
async function cargarRecibos(companyId: string, anio: number, mes: number) {
  const [ini, fin] = rango(anio, mes);
  /* `propio`: el EMISOR tiene que ser esta empresa (como en importar-xml: sólo lo que
   * esta empresa emitió). Un XML de otro RFC mezclado en la bóveda NO se asienta aquí:
   * se cuenta y se avisa. Si la empresa no tiene RFC capturado no hay contra qué
   * comparar y se acepta (la dirección 'emitidos' ya dice que lo emitió el dueño). */
  const r = await query<any>(
    `SELECT c.uuid, c.serie, c.folio, c.total, c.rfc_receptor, c.nombre_receptor, c.xml,
            TO_CHAR(c.fecha_emision,'YYYY-MM-DD') AS fecha,
            (co.rfc IS NULL OR UPPER(TRIM(COALESCE(c.rfc_emisor,''))) = UPPER(TRIM(co.rfc))) AS propio,
            ${cfdiYaContabilizado('c')} AS contabilizado
       FROM cfdi_recibidos c
       JOIN companies co ON co.id = c.company_id
      WHERE c.company_id=$1 AND c.direccion='emitidos' AND c.tipo_comprobante='N' AND c.xml IS NOT NULL
        AND (c.estado_sat IS NULL OR c.estado_sat <> 'Cancelado')
        AND c.fecha_emision >= ($2::date - INTERVAL '1 month')
        AND c.fecha_emision <  ($3::date + INTERVAL '4 months')
        AND COALESCE(substring(c.xml from 'FechaFinalPago="([0-9]{4}-[0-9]{2}-[0-9]{2})"')::date,
                     c.fecha_emision::date) BETWEEN $2::date AND $3::date
        AND NOT EXISTS (SELECT 1 FROM nomina_recibos nr
                         WHERE nr.company_id = c.company_id AND nr.uuid IS NOT NULL
                           AND UPPER(nr.uuid::text) = UPPER(c.uuid))
      ORDER BY c.fecha_emision, c.serie, c.folio`,
    [companyId, ini, fin]);

  /* La bóveda es única por (empresa, rfc_propietario, uuid), NO por uuid: el mismo CFDI
   * puede estar dos veces (ver pac.service). Se toma UNA vez por UUID, y si CUALQUIER
   * copia ya está contabilizada, el UUID cuenta como contabilizado — así no se alterna
   * entre copias ni se duplica el importe en la póliza. */
  const yaConPoliza = new Set<string>();
  for (const c of r.rows) if (c.contabilizado) yaConPoliza.add(String(c.uuid).toUpperCase());
  const vistos = new Set<string>();

  const recibos: ReciboBoveda[] = [];
  const inconsistentes: Array<{ uuid: string; nombre: string; neto: number; total: number }> = [];
  let sinComplemento = 0, ajenos = 0;
  for (const c of r.rows) {
    const llave = String(c.uuid).toUpperCase();
    if (vistos.has(llave)) continue;
    vistos.add(llave);
    if (!c.propio) { ajenos++; continue; }
    const p = parseReciboNominaXml(String(c.xml));
    if (!p) { sinComplemento++; continue; }
    if (!p.fechaFinalPago) { p.fechaFinalPago = c.fecha; p.fechaPago = p.fechaPago || c.fecha; p.fechaInicialPago = p.fechaInicialPago || c.fecha; }
    const contabilizado = yaConPoliza.has(llave);
    // Candado de integridad: el neto armado con el detalle debe ser el Total del CFDI. Si no,
    // algo del XML no se leyó bien y NO se asienta (se reporta).
    const total = c.total == null ? NaN : Number(c.total);
    if (!contabilizado && Number.isFinite(total) && Math.abs(r2(total) - p.neto) > 0.02) {
      inconsistentes.push({ uuid: c.uuid, nombre: c.nombre_receptor || c.rfc_receptor || '', neto: p.neto, total: r2(total) });
      continue;
    }
    recibos.push({
      ...p,
      uuid: c.uuid,
      rfc: c.rfc_receptor || '',
      nombre: c.nombre_receptor || '',
      documento: [c.serie, c.folio].filter(Boolean).join('-'),
      contabilizado,
    });
  }
  return { recibos, inconsistentes, sinComplemento, ajenos, ini, fin };
}

/** Recibos emitidos tipo N del periodo que se quedaron SIN XML (sólo metadata): no se
 *  pueden desglosar ni contabilizar hasta re-descargar o subir su XML. */
async function contarSinXml(companyId: string, ini: string, fin: string): Promise<number> {
  const r = await query<any>(
    `SELECT COUNT(*)::int AS n FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion='emitidos' AND tipo_comprobante='N' AND xml IS NULL
        AND (estado_sat IS NULL OR estado_sat <> 'Cancelado')
        AND fecha_emision >= $2::date AND fecha_emision < ($3::date + 1)`,
    [companyId, ini, fin]);
  return r.rows[0]?.n || 0;
}

/** Resuelve de una vez las cuentas asignadas a los conceptos (de movimiento y activas). */
async function cuentasDe(companyId: string, catalogo: Array<{ cuenta: string | null }>) {
  const codigos = Array.from(new Set(catalogo.map((c) => c.cuenta).filter(Boolean))) as string[];
  const m = new Map<string, CuentaResuelta>();
  if (codigos.length) {
    const r = await query<any>(
      `SELECT id, codigo, nombre FROM accounting_accounts
        WHERE company_id=$1 AND codigo = ANY($2::text[]) AND activa=true AND permite_movimientos=true`,
      [companyId, codigos]);
    for (const a of r.rows) m.set(a.codigo, { id: a.id, codigo: a.codigo, nombre: a.nombre });
  }
  return (codigo: string) => m.get(codigo) || null;
}

/** Fechas que cubre la corrida (periodo y pago), para la red de seguridad. */
function ventana(r: ReciboXml): [string, string] {
  const fechas = [r.fechaInicialPago, r.fechaFinalPago, r.fechaPago].filter(Boolean).sort();
  return [fechas[0], fechas[fechas.length - 1]];
}

/**
 * Red de seguridad (candado 4): ¿ya hay OTRA póliza en las fechas de la corrida (hasta 7
 * días después) con un renglón por el MISMO neto abonado fuera de caja/bancos —la
 * provisión de «nómina por pagar»— o por el MISMO total de percepciones cargado? El
 * abono del neto a BANCOS es el PAGO de la nómina, no su provisión: ése no cuenta.
 */
async function posibleDuplicado(
  companyId: string, desde: string, hasta: string, netos: number[], percepciones: number[],
): Promise<{ tipo: string; folio: number; fecha: string } | null> {
  const ns = Array.from(new Set(netos.map(r2).filter((x) => x > 0)));
  const ps = Array.from(new Set(percepciones.map(r2).filter((x) => x > 0)));
  if (!ns.length && !ps.length) return null;
  const r = await query<any>(
    `SELECT e.tipo, e.folio, TO_CHAR(e.fecha,'YYYY-MM-DD') AS fecha
       FROM journal_entries e
       JOIN journal_lines l ON l.entry_id = e.id
       LEFT JOIN accounting_accounts a ON a.id = l.account_id
      WHERE e.company_id=$1 AND e.fecha BETWEEN $2::date AND ($3::date + 7)
        AND e.estado <> 'REVERSADA'
        AND COALESCE(e.origen,'') <> 'BANCO' AND COALESCE(e.regla,'') <> $4
        AND ( (l.abono = ANY($5::numeric[]) AND COALESCE(a.codigo_agrupador,'') !~ '^10[12]')
           OR  l.cargo = ANY($6::numeric[]) )
      ORDER BY e.fecha, e.folio
      LIMIT 1`,
    [companyId, desde, hasta, REGLA, ns, ps]);
  return r.rows[0] || null;
}

/**
 * GET — la nómina emitida de la bóveda del periodo, en corridas, con su estado contable
 * y la póliza que se asentaría (para revisarla antes de bajarla).
 */
export async function corridasBoveda(companyId: string, anio: number, mes: number) {
  const { recibos, inconsistentes, sinComplemento, ajenos, ini, fin } = await cargarRecibos(companyId, anio, mes);
  const catalogo = await conceptosConCuenta(companyId);
  const resolver = await cuentasDe(companyId, catalogo);

  const corridas: any[] = [];
  for (const g of agruparCorridas(recibos)) {
    const r0 = g.recibos[0];
    const pend = g.recibos.filter((x) => !x.contabilizado);
    const todo = armarPolizaCorrida(g.recibos, catalogo, resolver);
    const arm = pend.length ? armarPolizaCorrida(pend, catalogo, resolver) : null;
    let dup: Awaited<ReturnType<typeof posibleDuplicado>> = null;
    if (arm && arm.cuadra) {
      const [desde, hasta] = ventana(r0);
      dup = await posibleDuplicado(companyId, desde, hasta,
        [todo.totales.neto, arm.totales.neto], [todo.totales.percepciones, arm.totales.percepciones]);
    }
    corridas.push({
      clave: g.clave,
      etiqueta: etiquetaCorrida(r0),
      tipoNomina: r0.tipoNomina,
      fechaInicialPago: r0.fechaInicialPago,
      fechaFinalPago: r0.fechaFinalPago,
      fechaPago: r0.fechaPago,
      recibos: g.recibos.length,
      pendientes: pend.length,
      percepciones: todo.totales.percepciones,
      otrosPagos: todo.totales.otrosPagos,
      deducciones: todo.totales.deducciones,
      neto: todo.totales.neto,
      faltantes: arm?.faltantes || [],
      sinConceptoPropio: todo.sinConceptoPropio,
      cuadra: arm ? arm.cuadra : true,
      // La póliza que se asentaría con lo PENDIENTE (sin ids internos).
      lineas: (arm?.lineas || []).map((l) => ({
        codigo: l.codigo, nombre: l.nombre, concepto: l.concepto, cargo: l.cargo || 0, abono: l.abono || 0,
      })),
      posibleDuplicado: dup,
      contabilizable: !!arm && arm.cuadra && !dup,
    });
  }

  return {
    anio, mes, corridas, inconsistentes, sinComplemento, ajenos,
    sinXml: await contarSinXml(companyId, ini, fin),
  };
}

/**
 * POST — baja a la contabilidad UNA corrida (`clave`) o todas las pendientes del
 * periodo. Una póliza por corrida con los recibos que aún no tienen póliza; los
 * omitidos regresan con su motivo (nada se asienta incompleto).
 */
export async function generarPolizasBoveda(
  companyId: string, anio: number, mes: number,
  opts: { clave?: string; forzar?: boolean } = {}, userId?: string,
) {
  const { recibos } = await cargarRecibos(companyId, anio, mes);
  const catalogo = await conceptosConCuenta(companyId);
  const resolver = await cuentasDe(companyId, catalogo);

  let grupos = agruparCorridas(recibos);
  if (opts.clave) {
    grupos = grupos.filter((g) => g.clave === opts.clave);
    if (!grupos.length) throw new ValidationError('No encontré esa corrida de nómina en la bóveda para el periodo elegido.');
  }

  let creadas = 0;
  const folios: number[] = [];
  const omitidas: Array<{ corrida: string; motivo: string; duplicado?: boolean }> = [];

  for (const g of grupos) {
    const pend = g.recibos.filter((x) => !x.contabilizado);
    if (!pend.length) continue;
    const r0 = g.recibos[0];
    const corrida = etiquetaCorrida(r0);
    const arm = armarPolizaCorrida(pend, catalogo, resolver);

    if (arm.faltantes.length) {
      omitidas.push({
        corrida,
        motivo: `faltan cuentas (Asignación de cuentas → Nómina): ${arm.faltantes.map((f) => f.concepto).join(', ')}`.slice(0, 300),
      });
      continue;
    }
    if (!arm.cuadra) {
      omitidas.push({ corrida, motivo: `no cuadra: cargo ${arm.sumaCargo} vs abono ${arm.sumaAbono}` });
      continue;
    }
    if (!opts.forzar) {
      const todo = armarPolizaCorrida(g.recibos, catalogo, resolver);
      const [desde, hasta] = ventana(r0);
      const dup = await posibleDuplicado(companyId, desde, hasta,
        [todo.totales.neto, arm.totales.neto], [todo.totales.percepciones, arm.totales.percepciones]);
      if (dup) {
        omitidas.push({
          corrida, duplicado: true,
          motivo: `posible duplicado: ya hay una póliza de ${TIPO_POLIZA[dup.tipo] || dup.tipo} ${dup.folio} del ${fechaMx(dup.fecha)} con el mismo importe`,
        });
        continue;
      }
    }

    const uuids = pend.map((x) => x.uuid).sort();
    try {
      const pol = await crearPoliza(companyId, {
        tipo: 'DIARIO',
        // Igual que la corrida del módulo: la póliza lleva la fecha de PAGO.
        fecha: r0.fechaPago || r0.fechaFinalPago,
        concepto: `${corrida} — provisión de nómina desde XML (${pend.length} recibo(s))`.slice(0, 200),
        origen: 'NOMINA',
        origen_uuid: PREF + createHash('md5').update(uuids.join('|')).digest('hex'),
        regla: REGLA,
        lineas: arm.lineas,
        cfdis: pend.map((x) => ({ uuid: x.uuid, rfc: x.rfc || null, tipo: 'N', documento: x.documento || null })),
      }, userId);
      creadas++;
      folios.push(pol.folio);
    } catch (e: any) {
      if (e?.code === '23505') omitidas.push({ corrida, motivo: 'ya tenía póliza' });
      else omitidas.push({ corrida, motivo: String(e?.message || 'no se pudo contabilizar').slice(0, 160) });
    }
  }
  return { creadas, folios, omitidas };
}
