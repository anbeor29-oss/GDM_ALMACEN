/**
 * Importador CONTPAQi → NEXO (reutilizable, para CUALQUIER empresa/RFC).
 *
 * Consume el paquete JSON que produce `scripts/contpaqi/extraer-contpaqi.ps1`
 * (cuentas, pólizas, movimientos, poliza_cfdi, cfdi, saldos) y lo carga en la
 * empresa elegida usando el MOTOR de NEXO: el catálogo, las pólizas (con el
 * trigger de cuadre y la idempotencia por origen_uuid) y los CFDI recibidos.
 *
 * No escribe nada crudo que NEXO no validaría. Idempotente: re-importar el mismo
 * paquete no duplica (las pólizas por su Guid, los CFDI por su UUID, las cuentas
 * por su código).
 *
 * Hechos de CONTPAQi que asume (verificados en la extracción, no inventados):
 *   · MovimientosPoliza.TipoMovto: 0 = Cargo, 1 = Abono.
 *   · TipoPol 1/2/3 = Diario/Ingreso/Egreso (sólo etiqueta).
 *   · Afectable = 1 → cuenta de movimientos (hoja).
 *   · La naturaleza sale del agrupador SAT (NEXO lo conoce); si la cuenta no
 *     trae agrupador, se deriva del primer dígito.
 *   · Cuentas de sistema (código con prefijo '_') NO se migran.
 */
import { query, transaction } from '../../config/database';
import { crearPoliza } from './polizas.service';
import { activarContabilidad } from './catalogo.service';

/* ── El paquete que sube la pantalla (los JSON del extractor) ── */
export interface CuentaCt { codigo: string; nombre: string; agrupador: string | null; afectable: number; ctaMayor: number; baja: number; }
export interface PolizaCt { id: number; ejercicio: number; periodo: number; tipoPol: number; folio: number; fecha: string; concepto: string; guid: string; cargos: number; abonos: number; }
export interface MovimientoCt { idPoliza: number; num: number; cuenta: string; tm: number; importe: number; concepto: string | null; referencia: string | null; }
export interface PolizaCfdiCt { idPoliza: number; uuid: string; }
export interface CfdiCt {
  uuid: string; rfcEmisor: string; nombreEmisor: string; rfcReceptor: string; nombreReceptor: string;
  tipoComprobante: string; serie: string; folio: string; fecEmi: string; total: number; subtotal: number;
  descuento: number; usoCfdi: string; metodoPago: string; formaPago: string; moneda: string;
}
export interface EmpresaCt { rfc: string; nombre: string; idEmpresa?: number; }
export interface PaqueteContpaqi {
  empresa?: EmpresaCt[]; cuentas: CuentaCt[]; polizas: PolizaCt[]; movimientos: MovimientoCt[];
  poliza_cfdi: PolizaCfdiCt[]; cfdi: CfdiCt[]; saldos?: any[];
}

export interface ReporteImport {
  rfc: { respaldo: string; empresaActiva: string; coincide: boolean };
  ejerciciosActivados: number[];
  cuentas: { creadas: number; omitidas: number; sinAgrupador: number };
  polizas: { creadas: number; yaExistian: number; omitidas: number; motivos: Array<{ guid: string; motivo: string }> };
  cfdi: { creados: number; emitidos: number; recibidos: number };
  avisos: string[];
}

const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const TIPO_POR_DIGITO: Record<string, string> = {
  '1': 'ACTIVO', '2': 'PASIVO', '3': 'CAPITAL', '4': 'INGRESO', '5': 'COSTO', '6': 'GASTO', '7': 'GASTO', '8': 'ORDEN',
};
const naturalezaPorTipo = (tipo: string) => (['ACTIVO', 'COSTO', 'GASTO'].includes(tipo) ? 'DEUDORA' : 'ACREEDORA');
const TIPO_POL: Record<number, 'DIARIO' | 'INGRESO' | 'EGRESO'> = { 1: 'DIARIO', 2: 'INGRESO', 3: 'EGRESO' };

/** El padre de un código CONTPAQi (8 díg., ceros a la derecha): el ancestro
 *  existente más cercano al zerear el sufijo. */
function codigoPadre(codigo: string, existentes: Set<string>): string | null {
  const n = codigo.length;
  for (let k = 1; k < n; k++) {
    const cand = codigo.slice(0, n - k) + '0'.repeat(k);
    if (cand !== codigo && existentes.has(cand)) return cand;
  }
  return null;
}

/** 'YYYYMMDD' (como lo guarda CONTPAQi) → 'YYYY-MM-DD', o null. */
function fechaCt(s: string): string | null {
  const t = String(s || '').trim();
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  return null;
}

export async function importarContpaqi(
  companyId: string, paquete: PaqueteContpaqi, userId?: string, opciones?: { forzar?: boolean }
): Promise<ReporteImport> {
  const emp = await query<any>('SELECT rfc FROM companies WHERE id=$1', [companyId]);
  const rfcEmpresa = String(emp.rows[0]?.rfc || '').toUpperCase().trim();
  if (!rfcEmpresa) throw new Error('La empresa destino no tiene RFC.');

  /* PRIMER PASO: validar el RFC. El respaldo trae el RFC de su empresa
   * (Parametros.RFC); si no es el de la empresa ACTIVA, se detiene para no
   * mezclar la contabilidad de un contribuyente con la de otro. Se puede forzar
   * a propósito (misma empresa con RFC recapturado, cambio de RFC, etc.). */
  const rfcRespaldo = String(paquete.empresa?.[0]?.rfc || '').toUpperCase().trim();
  const coincide = !!rfcRespaldo && rfcRespaldo === rfcEmpresa;
  if (rfcRespaldo && !coincide && !opciones?.forzar) {
    throw new Error(
      `El RFC del respaldo (${rfcRespaldo}) no coincide con el de la empresa activa (${rfcEmpresa}). ` +
      `Cambia a la empresa correcta en NEXO, o confirma que quieres importar de todos modos.`);
  }

  const rep: ReporteImport = {
    rfc: { respaldo: rfcRespaldo || '(no venía en el paquete)', empresaActiva: rfcEmpresa, coincide },
    ejerciciosActivados: [],
    cuentas: { creadas: 0, omitidas: 0, sinAgrupador: 0 },
    polizas: { creadas: 0, yaExistian: 0, omitidas: 0, motivos: [] },
    cfdi: { creados: 0, emitidos: 0, recibidos: 0 },
    avisos: [],
  };

  // 1. Activar los ejercicios que tocan las pólizas (crea los 12 periodos c/u; NO siembra catálogo).
  const ejercicios = Array.from(new Set((paquete.polizas || []).map((p) => p.ejercicio))).filter(Boolean).sort();
  for (const anio of ejercicios) {
    try { await activarContabilidad(companyId, { anio, sembrarCatalogo: false } as any); rep.ejerciciosActivados.push(anio); }
    catch (e: any) { rep.avisos.push(`Ejercicio ${anio}: ${e?.message || 'no se pudo activar'}`); }
  }

  await importarCuentas(companyId, paquete.cuentas || [], rep);
  await importarPolizas(companyId, paquete, userId, rep);
  await importarCfdis(companyId, paquete.cfdi || [], rfcEmpresa, rep);

  return rep;
}

/* ── 1. Catálogo ───────────────────────────────────────────────────────────── */
async function importarCuentas(companyId: string, cuentas: CuentaCt[], rep: ReporteImport) {
  // Las de sistema ('_ORDEN', '_UTILIDAD'…) no se migran.
  const utiles = cuentas.filter((c) => c.codigo && !c.codigo.startsWith('_'));
  const codigos = new Set(utiles.map((c) => c.codigo));

  // Agrupadores válidos en NEXO (para no violar el FK) con su naturaleza/complementaria.
  const agrs = await query<any>('SELECT codigo, naturaleza FROM sat_codigos_agrupadores');
  const natDeAgr = new Map<string, string>(agrs.rows.map((a: any) => [a.codigo, a.naturaleza]));

  // Se insertan en orden de código: así el padre ya existe cuando llega el hijo.
  const ordenadas = [...utiles].sort((a, b) => a.codigo.localeCompare(b.codigo));
  const idPorCodigo = new Map<string, { id: string; nivel: number }>();

  for (const c of ordenadas) {
    const tipo = TIPO_POR_DIGITO[c.codigo[0]] || 'ORDEN';
    const agrupadorValido = c.agrupador && natDeAgr.has(c.agrupador) ? c.agrupador : null;
    if (!agrupadorValido && c.afectable === 1) rep.cuentas.sinAgrupador++;
    const naturaleza = agrupadorValido ? natDeAgr.get(agrupadorValido)! : naturalezaPorTipo(tipo);
    const esComplementaria = agrupadorValido != null && naturaleza !== naturalezaPorTipo(tipo);

    const padreCod = codigoPadre(c.codigo, codigos);
    const padre = padreCod ? idPorCodigo.get(padreCod) : undefined;
    const nivel = padre ? padre.nivel + 1 : 1;

    try {
      const r = await query<any>(
        `INSERT INTO accounting_accounts
           (company_id, parent_id, codigo, nombre, codigo_agrupador, tipo, naturaleza,
            es_complementaria, nivel, permite_movimientos, requiere_tercero, moneda, activa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,'MXN',true)
         ON CONFLICT (company_id, codigo) DO UPDATE
           SET nombre = EXCLUDED.nombre,
               codigo_agrupador = COALESCE(EXCLUDED.codigo_agrupador, accounting_accounts.codigo_agrupador),
               updated_at = NOW()
         RETURNING id, (xmax = 0) AS creada`,
        [companyId, padre?.id || null, c.codigo, (c.nombre || c.codigo).slice(0, 250),
         agrupadorValido, tipo, naturaleza, esComplementaria, nivel, c.afectable === 1]);
      idPorCodigo.set(c.codigo, { id: r.rows[0].id, nivel });
      if (r.rows[0].creada) rep.cuentas.creadas++; else rep.cuentas.omitidas++;
    } catch (e: any) {
      rep.avisos.push(`Cuenta ${c.codigo}: ${e?.message || 'no se pudo'}`.slice(0, 160));
    }
  }
}

/* ── 2. Pólizas ────────────────────────────────────────────────────────────── */
async function importarPolizas(companyId: string, paquete: PaqueteContpaqi, userId: string | undefined, rep: ReporteImport) {
  // Códigos → id (ya migrados) para armar las partidas.
  const ctas = await query<any>(
    'SELECT codigo, id, permite_movimientos FROM accounting_accounts WHERE company_id=$1', [companyId]);
  const idCta = new Map<string, { id: string; mov: boolean }>(
    ctas.rows.map((c: any) => [c.codigo, { id: c.id, mov: c.permite_movimientos }]));

  // Movimientos y UUIDs agrupados por póliza.
  const movsPorPol = new Map<number, MovimientoCt[]>();
  for (const m of paquete.movimientos || []) {
    if (!movsPorPol.has(m.idPoliza)) movsPorPol.set(m.idPoliza, []);
    movsPorPol.get(m.idPoliza)!.push(m);
  }
  const uuidsPorPol = new Map<number, string[]>();
  for (const pc of paquete.poliza_cfdi || []) {
    if (!uuidsPorPol.has(pc.idPoliza)) uuidsPorPol.set(pc.idPoliza, []);
    uuidsPorPol.get(pc.idPoliza)!.push(pc.uuid);
  }

  // Idempotencia: los Guid ya importados.
  const ya = await query<any>(
    `SELECT origen_uuid FROM journal_entries WHERE company_id=$1 AND origen='CONTPAQI' AND origen_uuid IS NOT NULL`,
    [companyId]);
  const importados = new Set<string>(ya.rows.map((r: any) => r.origen_uuid));

  for (const p of paquete.polizas || []) {
    if (importados.has(p.guid)) { rep.polizas.yaExistian++; continue; }
    const movs = (movsPorPol.get(p.id) || []).sort((a, b) => a.num - b.num);
    if (movs.length < 2) { rep.polizas.omitidas++; if (movs.length) rep.polizas.motivos.push({ guid: p.guid, motivo: `sólo ${movs.length} movimiento(s)` }); continue; }

    const uuids = uuidsPorPol.get(p.id) || [];
    const uuidLinea = uuids.length === 1 ? uuids[0] : null; // línea a línea sólo si es un único CFDI
    const lineas: any[] = [];
    let faltaCuenta: string | null = null;
    for (const m of movs) {
      const cta = idCta.get(m.cuenta);
      if (!cta || !cta.mov) { faltaCuenta = m.cuenta; break; }
      lineas.push({
        account_id: cta.id,
        cargo: m.tm === 0 ? round2(m.importe) : 0,
        abono: m.tm === 1 ? round2(m.importe) : 0,
        concepto: (m.concepto || '').toString().slice(0, 200) || null,
        uuid_cfdi: uuidLinea,
      });
    }
    if (faltaCuenta) { rep.polizas.omitidas++; rep.polizas.motivos.push({ guid: p.guid, motivo: `cuenta ${faltaCuenta} no migrada` }); continue; }

    const fecha = fechaCt(p.fecha);
    if (!fecha) { rep.polizas.omitidas++; rep.polizas.motivos.push({ guid: p.guid, motivo: `fecha inválida (${p.fecha})` }); continue; }

    try {
      await crearPoliza(companyId, {
        tipo: TIPO_POL[p.tipoPol] || 'DIARIO',
        fecha,
        concepto: `${(p.concepto || '').toString().slice(0, 180)}${uuids.length > 1 ? ` · ${uuids.length} CFDI` : ''}`.trim() || 'Póliza CONTPAQi',
        origen: 'CONTPAQI', origen_uuid: p.guid, regla: 'contpaqi_v1',
        lineas,
      }, userId);
      rep.polizas.creadas++;
    } catch (e: any) {
      rep.polizas.omitidas++;
      rep.polizas.motivos.push({ guid: p.guid, motivo: (e?.message || 'error').toString().slice(0, 140) });
    }
  }
  // Sólo se guardan los primeros motivos, para no inflar el reporte.
  if (rep.polizas.motivos.length > 50) rep.polizas.motivos = rep.polizas.motivos.slice(0, 50);
}

/* ── 3. CFDI recibidos/emitidos ────────────────────────────────────────────── */
async function importarCfdis(companyId: string, cfdi: CfdiCt[], rfcEmpresa: string, rep: ReporteImport) {
  for (const c of cfdi) {
    if (!c.uuid) continue;
    const emisor = String(c.rfcEmisor || '').toUpperCase().trim();
    const direccion = emisor === rfcEmpresa ? 'emitidos' : 'recibidos';
    if (direccion === 'emitidos') rep.cfdi.emitidos++; else rep.cfdi.recibidos++;
    try {
      const r = await query<any>(
        `INSERT INTO cfdi_recibidos
           (company_id, rfc_propietario, uuid, direccion, tipo_comprobante, serie, folio, fecha_emision,
            rfc_emisor, nombre_emisor, rfc_receptor, nombre_receptor, subtotal, descuento, total,
            moneda, forma_pago, metodo_pago, uso_cfdi)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (company_id, rfc_propietario, uuid) DO NOTHING
         RETURNING id`,
        [companyId, rfcEmpresa, c.uuid, direccion, (c.tipoComprobante || '').slice(0, 2) || null,
         (c.serie || '').slice(0, 30) || null, (c.folio || '').slice(0, 40) || null, fechaCt(c.fecEmi),
         (c.rfcEmisor || '').slice(0, 13) || null, (c.nombreEmisor || '').slice(0, 300) || null,
         (c.rfcReceptor || '').slice(0, 13) || null, (c.nombreReceptor || '').slice(0, 300) || null,
         round2(c.subtotal), round2(c.descuento), round2(c.total),
         (c.moneda || '').slice(0, 3) || null, (c.formaPago || '').slice(0, 3) || null,
         (c.metodoPago || '').slice(0, 3) || null, (c.usoCfdi || '').slice(0, 5) || null]);
      if (r.rows[0]) rep.cfdi.creados++;
    } catch { /* un CFDI que no entra no frena la migración */ }
  }
}
