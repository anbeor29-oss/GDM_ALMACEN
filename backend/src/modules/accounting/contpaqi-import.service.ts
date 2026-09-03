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
import { alimentarDesdePolizas } from './periodos.service';
import { generarSubcuentasDeComprobantes } from './catalogo-terceros.service';

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
  cuentas: { creadas: number; omitidas: number; sinAgrupador: number; agrupadorRellenado: number };
  polizas: {
    creadas: number; yaExistian: number; omitidas: number;
    conTemporal: Array<{ guid: string; folio: string; motivo: string }>;
    motivos: Array<{ guid: string; motivo: string }>;
  };
  cfdi: { creados: number; emitidos: number; recibidos: number };
  balanzaPeriodos: number;
  avisos: string[];
}

const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const TIPO_POR_DIGITO: Record<string, string> = {
  '1': 'ACTIVO', '2': 'PASIVO', '3': 'CAPITAL', '4': 'INGRESO', '5': 'COSTO', '6': 'GASTO', '7': 'GASTO', '8': 'ORDEN',
};
const naturalezaPorTipo = (tipo: string) => (['ACTIVO', 'COSTO', 'GASTO'].includes(tipo) ? 'DEUDORA' : 'ACREEDORA');
const TIPO_POL: Record<number, 'DIARIO' | 'INGRESO' | 'EGRESO'> = { 1: 'DIARIO', 2: 'INGRESO', 3: 'EGRESO' };

/**
 * Acomoda la póliza migrada en la clasificación de NEXO (ventas / compras /
 * cobros-pagos / nómina / manual) para que caiga en su filtro como las que
 * genera NEXO — así el respaldo importado no queda todo en «otras». Es SÓLO para
 * presentar: no cambia el asiento. Decide por el concepto y, si no basta, por el
 * AGRUPADOR SAT de las cuentas que toca (estándar, no por el número de cuenta que
 * varía entre empresas) y por el tipo de póliza. La `categoria()` del frontend
 * lee este prefijo de `regla`.
 */
function clasificarRegla(concepto: string, tipoPol: number, agrupadores: string[]): string {
  const c = (concepto || '').toLowerCase();
  if (/n[oó]mina|sueldos?|raya|finiquito|aguinaldo|asimilad/.test(c)) return 'nomina_migrado';
  if (/\bcobro|cobranza|dep[oó]sito de cliente/.test(c)) return 'cobro_migrado';
  if (/\bpago\b/.test(c)) return 'pago_migrado';
  if (/venta|factura de venta/.test(c)) return 'ventas_migrado';
  if (/compra|adquisici/.test(c)) return 'compras_migrado';

  const agr = agrupadores.filter(Boolean).map(String);
  const toca = (pref: string) => agr.some((x) => x.startsWith(pref));
  const banco = toca('102') || toca('101');   // bancos / caja
  if (banco && toca('105')) return 'cobro_migrado';   // banco + clientes
  if (banco && toca('201')) return 'pago_migrado';    // banco + proveedores
  if (toca('40')) return 'ventas_migrado';            // ingresos (401/402)
  if (toca('50') || toca('60') || toca('115')) return 'compras_migrado'; // costo / gasto / inventario
  if (tipoPol === 2) return 'cobro_migrado';          // Ingreso
  if (tipoPol === 3) return 'pago_migrado';           // Egreso
  return 'manual';                                     // Diario sin señal
}

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
  companyId: string, paquete: PaqueteContpaqi, userId?: string,
  opciones?: { forzar?: boolean; ejercicios?: number[] }
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
    balanzaPeriodos: 0,
    cuentas: { creadas: 0, omitidas: 0, sinAgrupador: 0, agrupadorRellenado: 0 },
    polizas: { creadas: 0, yaExistian: 0, omitidas: 0, conTemporal: [], motivos: [] },
    cfdi: { creados: 0, emitidos: 0, recibidos: 0 },
    avisos: [],
  };

  // Si el usuario eligió ejercicios (años) desde NEXO, sólo esos se importan;
  // el catálogo de cuentas entra completo (no depende del ejercicio).
  const ejerciciosSel = opciones?.ejercicios?.length ? new Set(opciones.ejercicios) : null;
  const polizasSel = ejerciciosSel
    ? (paquete.polizas || []).filter((p) => ejerciciosSel.has(p.ejercicio))
    : (paquete.polizas || []);
  const paqueteSel: PaqueteContpaqi = { ...paquete, polizas: polizasSel };

  // 1. Activar los ejercicios que tocan las pólizas (crea los 12 periodos c/u; NO siembra catálogo).
  const ejercicios = Array.from(new Set(polizasSel.map((p) => p.ejercicio))).filter(Boolean).sort();
  for (const anio of ejercicios) {
    try { await activarContabilidad(companyId, { anio, sembrarCatalogo: false } as any); rep.ejerciciosActivados.push(anio); }
    catch (e: any) { rep.avisos.push(`Ejercicio ${anio}: ${e?.message || 'no se pudo activar'}`); }
  }

  await importarCuentas(companyId, paquete.cuentas || [], rep);
  await importarPolizas(companyId, paqueteSel, userId, rep);
  await importarCfdis(companyId, paquete.cfdi || [], rfcEmpresa, rep);

  // Auto-generar las subcuentas de cada cliente/proveedor, para que aparezcan solas
  // en «asignar cuenta» (con su cuenta REAL del respaldo si el nombre empata, en vez
  // de una 105-01-00x inventada — ver resolverOCrearSubcuentaTercero).
  try { await generarSubcuentasDeComprobantes(companyId, 'emitidos'); } catch { /* sin clientes */ }
  try { await generarSubcuentasDeComprobantes(companyId, 'recibidos'); } catch { /* sin proveedores */ }

  // QUINTO: actualizar la balanza de TODOS los periodos del respaldo, en orden
  // (año↑, ene→dic) porque el saldo inicial de cada mes es el saldo final del
  // anterior. Así, al entrar a la balanza por año, ya están todos al día sin dar
  // «Actualizar desde pólizas» mes por mes. Los meses cerrados o vacíos se saltan.
  for (const anio of ejercicios) {
    for (let mes = 1; mes <= 12; mes++) {
      try {
        const r = await alimentarDesdePolizas(companyId, anio, mes, { userId });
        if (r.cuentas > 0) rep.balanzaPeriodos++;
      } catch { /* periodo cerrado o sin activar: se ignora */ }
    }
  }

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
  const agrupadorPorCodigo = new Map<string, string | null>();

  for (const c of ordenadas) {
    const tipo = TIPO_POR_DIGITO[c.codigo[0]] || 'ORDEN';
    const padreCod = codigoPadre(c.codigo, codigos);

    // Agrupador propio si es válido; si no, se HEREDA del mayor. En CONTPAQi la
    // subcuenta comparte el agrupador de su cuenta mayor, y las que se crearon en
    // automático por otro sistema suelen venir sin él: se rellena (y se reporta)
    // en vez de dejar la cuenta sin código agrupador del SAT.
    const propio = c.agrupador && natDeAgr.has(c.agrupador) ? c.agrupador : null;
    const heredado = !propio && padreCod ? (agrupadorPorCodigo.get(padreCod) || null) : null;
    const agrupadorValido = propio || heredado;
    if (heredado) rep.cuentas.agrupadorRellenado++;
    if (!agrupadorValido && c.afectable === 1) rep.cuentas.sinAgrupador++;
    agrupadorPorCodigo.set(c.codigo, agrupadorValido);

    const naturaleza = agrupadorValido ? natDeAgr.get(agrupadorValido)! : naturalezaPorTipo(tipo);
    const esComplementaria = agrupadorValido != null && naturaleza !== naturalezaPorTipo(tipo);

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
    'SELECT codigo, id, permite_movimientos, codigo_agrupador FROM accounting_accounts WHERE company_id=$1', [companyId]);
  const idCta = new Map<string, { id: string; mov: boolean }>(
    ctas.rows.map((c: any) => [c.codigo, { id: c.id, mov: c.permite_movimientos }]));
  const agrDe = new Map<string, string>(
    ctas.rows.filter((c: any) => c.codigo_agrupador).map((c: any) => [c.codigo, c.codigo_agrupador]));

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

  // La cuenta temporal se crea la PRIMERA vez que hace falta (no antes).
  let tempId: string | null = null;
  const cuentaTemporal = async (): Promise<string> => {
    if (!tempId) tempId = await asegurarCuentaTemporal(companyId);
    return tempId;
  };

  for (const p of paquete.polizas || []) {
    if (importados.has(p.guid)) {
      rep.polizas.yaExistian++;
      // Reclasifica las que se importaron ANTES de esta mejora (regla 'contpaqi_v1'),
      // para que también caigan en su filtro. Sólo toca esas; no reasienta nada.
      const agrsE = (movsPorPol.get(p.id) || []).map((m) => agrDe.get(m.cuenta)).filter(Boolean) as string[];
      await query(
        `UPDATE journal_entries SET regla=$3
          WHERE company_id=$1 AND origen='CONTPAQI' AND origen_uuid=$2 AND regla='contpaqi_v1'`,
        [companyId, p.guid, clasificarRegla(p.concepto, p.tipoPol, agrsE)]);
      continue;
    }
    const folioTxt = `${p.ejercicio}/${p.periodo}/${p.folio}`;
    const movs = (movsPorPol.get(p.id) || []).sort((a, b) => a.num - b.num);
    if (movs.length < 2) { rep.polizas.omitidas++; if (movs.length) rep.polizas.motivos.push({ guid: p.guid, motivo: `sólo ${movs.length} movimiento(s)` }); continue; }

    const fecha = fechaCt(p.fecha);
    if (!fecha) { rep.polizas.omitidas++; rep.polizas.motivos.push({ guid: p.guid, motivo: `fecha inválida (${p.fecha})` }); continue; }

    const uuids = uuidsPorPol.get(p.id) || [];
    const uuidLinea = uuids.length === 1 ? uuids[0] : null; // línea a línea sólo si es un único CFDI
    const lineas: any[] = [];
    const cuentasFaltantes = new Set<string>();
    for (const m of movs) {
      const cta = idCta.get(m.cuenta);
      let accountId: string;
      if (cta && cta.mov) { accountId = cta.id; }
      else { accountId = await cuentaTemporal(); cuentasFaltantes.add(m.cuenta); } // cuenta faltante → temporal, no se pierde
      lineas.push({
        account_id: accountId,
        cargo: m.tm === 0 ? round2(m.importe) : 0,
        abono: m.tm === 1 ? round2(m.importe) : 0,
        concepto: ((cuentasFaltantes.has(m.cuenta) ? `[${m.cuenta}] ` : '') + (m.concepto || '')).slice(0, 200) || null,
        uuid_cfdi: uuidLinea,
      });
    }

    // Si NO cuadra (descuadre de origen), una partida de ajuste a la cuenta temporal
    // para que entre completa; se reporta para revisarla.
    const sc = round2(lineas.reduce((a, l) => a + (l.cargo || 0), 0));
    const sa = round2(lineas.reduce((a, l) => a + (l.abono || 0), 0));
    let motivoTemp = cuentasFaltantes.size ? `cuenta ${[...cuentasFaltantes].join(', ')} → temporal` : '';
    if (sc !== sa) {
      const dif = round2(sc - sa);
      lineas.push({ account_id: await cuentaTemporal(), cargo: dif < 0 ? -dif : 0, abono: dif > 0 ? dif : 0, concepto: 'Ajuste de cuadre (migración)', uuid_cfdi: null });
      motivoTemp = (motivoTemp ? motivoTemp + '; ' : '') + `descuadre ${dif} ajustado`;
    }

    try {
      const agrupadores = movs.map((m) => agrDe.get(m.cuenta)).filter(Boolean) as string[];
      await crearPoliza(companyId, {
        tipo: TIPO_POL[p.tipoPol] || 'DIARIO',
        fecha,
        concepto: `${(p.concepto || '').toString().slice(0, 180)}${uuids.length > 1 ? ` · ${uuids.length} CFDI` : ''}`.trim() || 'Póliza CONTPAQi',
        origen: 'CONTPAQI', origen_uuid: p.guid, regla: clasificarRegla(p.concepto, p.tipoPol, agrupadores),
        lineas,
      }, userId);
      rep.polizas.creadas++;
      if (motivoTemp) rep.polizas.conTemporal.push({ guid: p.guid, folio: folioTxt, motivo: motivoTemp });
    } catch (e: any) {
      rep.polizas.omitidas++;
      rep.polizas.motivos.push({ guid: p.guid, motivo: (e?.message || 'error').toString().slice(0, 140) });
    }
  }
  // Sólo se guardan los primeros, para no inflar el reporte.
  if (rep.polizas.motivos.length > 50) rep.polizas.motivos = rep.polizas.motivos.slice(0, 50);
  if (rep.polizas.conTemporal.length > 200) rep.polizas.conTemporal = rep.polizas.conTemporal.slice(0, 200);
}

/** La cuenta temporal de migración (suspense): las partidas que no tienen cuenta
 *  o el descuadre de una póliza caen aquí para no perder nada; se reasignan luego. */
async function asegurarCuentaTemporal(companyId: string): Promise<string> {
  const cod = 'MIG-TEMPORAL';
  const ya = await query<any>('SELECT id FROM accounting_accounts WHERE company_id=$1 AND codigo=$2', [companyId, cod]);
  if (ya.rows[0]) return ya.rows[0].id;
  const r = await query<any>(
    `INSERT INTO accounting_accounts
       (company_id, codigo, nombre, tipo, naturaleza, nivel, permite_movimientos, requiere_tercero, moneda, activa)
     VALUES ($1,$2,$3,'ACTIVO','DEUDORA',1,true,false,'MXN',true)
     ON CONFLICT (company_id, codigo) DO UPDATE SET updated_at=NOW()
     RETURNING id`,
    [companyId, cod, 'CUENTA TEMPORAL DE MIGRACIÓN (reasignar)']);
  return r.rows[0].id;
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
