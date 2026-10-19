/**
 * Importadores de Contalink (CTLK) — catálogo y libro diario en Excel (.xls/.xlsx).
 *
 * El cliente exporta de Contalink dos archivos de Excel:
 *
 * ── CATÁLOGO ──  Hoja con encabezado: «Num cuenta | Nombre | Cuenta Padre | Agrupador SAT».
 *   Máscara `1-00-00-000`. El padre viene EXPLÍCITO, así que la jerarquía se arma
 *   ligando cada cuenta a la que tiene ese código (igual que el importador de CPQ).
 *   La naturaleza (D/A) se deduce del dígito del agrupador SAT (1/5/6 = deudora;
 *   2/3/4 = acreedora). Se conservan los números de cuenta de Contalink TAL CUAL.
 *
 * ── LIBRO DIARIO (pólizas) ──  Reporte por bloques, una póliza por bloque:
 *     «Tipo de póliza | <Compra/Venta/Cobro/Pago/Diario/Nota de Crédito/Cierre>»
 *     «Fecha | <serial Excel>» · «Descripción | <consecutivo>»
 *     «Folio | Cuenta Contable | | Debe | Haber»  (encabezado)
 *      renglones: « | <NumCta> <Nombre> | | <debe> | <haber>»
 *     «Totales …» · «Notas Adicionales | <concepto>»
 *     «CFDI Asociados a la póliza» → «Fecha | Documento | UUID | RFC | Tipo» + filas.
 *   Cada bloque se asienta con `crearPoliza` (mismo cuadre por trigger de BD); la
 *   cuenta se mapea por código (por eso el catálogo se importa PRIMERO). Como
 *   Contalink no trae UUID de póliza, la idempotencia es por un hash del contenido
 *   (`origen_uuid = 'CTLK:'+hash`): reimportar NO duplica. Los CFDI asociados se
 *   guardan en `journal_entry_cfdi` (todos, sin pérdida); si la póliza trae uno solo,
 *   además se sella en los renglones.
 */
import * as XLSX from 'xlsx';
import crypto from 'crypto';
import { query } from '../../config/database';
import { crearPoliza } from './polizas.service';
import { asignarAgrupadorFaltante } from './catalogo.service';
import { asegurarCuentaTemporal } from './contpaqi-import.service';

/* Tipo + naturaleza natural por el primer dígito del agrupador SAT. */
const TIPO_POR_DIG: Record<string, string> = {
  '1': 'ACTIVO', '2': 'PASIVO', '3': 'CAPITAL', '4': 'INGRESO', '5': 'COSTO', '6': 'GASTO', '7': 'GASTO', '8': 'ORDEN',
};
const natPorTipo = (t: string): 'DEUDORA' | 'ACREEDORA' => (['ACTIVO', 'COSTO', 'GASTO'].includes(t) ? 'DEUDORA' : 'ACREEDORA');

const norm = (v: any) => String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
// Código de cuenta al INICIO del texto «<código> <nombre>». Mask-agnóstico: cada
// cliente de Contalink numera distinto (1-00-00-000, 1-000-000, 10-100-0001…), así
// que se toma cualquier código que empiece con dígito y lleve dígitos/guiones/puntos,
// seguido de un espacio y el nombre. El importador valida el código contra el catálogo.
const acctRe = /^(\d[\d.\-]*)\s+(\S.*)$/;

/** Serial de Excel (sistema 1900) → 'YYYY-MM-DD'. */
function fechaDeSerial(n: number): string {
  const ms = Math.round((Math.floor(n) - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CATÁLOGO
   ═══════════════════════════════════════════════════════════════════════════ */
export interface CuentaCtlk {
  codigo: string; nombre: string; padre: string; agrupador: string | null;
  tipo: string; naturaleza: 'DEUDORA' | 'ACREEDORA';
}

export function parsearCatalogoXls(buffer: Buffer): CuentaCtlk[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // raw:false → texto formateado: conserva el agrupador exacto ("102.01", no 102.1).
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false });
  const out: CuentaCtlk[] = [];
  for (const r of rows) {
    const codigo = String(r?.[0] ?? '').trim();
    if (!codigo) continue;
    if (norm(codigo).startsWith('num cuenta')) continue;          // encabezado
    if (!/^\d/.test(codigo)) continue;                            // solo cuentas reales
    const nombre = String(r?.[1] ?? '').trim() || codigo;
    const padre = String(r?.[2] ?? '').trim();
    let agr = String(r?.[3] ?? '').trim();
    if (!agr || /^0+$/.test(agr)) agr = '';
    const dig = (agr || codigo)[0];
    const tipo = TIPO_POR_DIG[dig] || 'ORDEN';
    out.push({ codigo, nombre, padre, agrupador: agr || null, tipo, naturaleza: natPorTipo(tipo) });
  }
  return out;
}

export async function importarCatalogoXls(companyId: string, buffer: Buffer) {
  const cuentas = parsearCatalogoXls(buffer);
  if (!cuentas.length) {
    throw new Error('No se encontraron cuentas. ¿Es el catálogo de Contalink (Num cuenta · Nombre · Cuenta Padre · Agrupador SAT)?');
  }

  const porCodigo = new Map(cuentas.map((c) => [c.codigo, c]));
  const conHijos = new Set(cuentas.map((c) => c.padre).filter(Boolean));
  const esHoja = (cod: string) => !conHijos.has(cod);

  // Padres antes que hijos: ordenar por profundidad de la cadena de padres.
  const prof = (c: CuentaCtlk): number => {
    let d = 0; let cur: CuentaCtlk | undefined = c; let g = 0;
    while (cur && porCodigo.has(cur.padre) && g++ < 60) { d++; cur = porCodigo.get(cur.padre); }
    return d;
  };
  const ordenadas = [...cuentas].sort((a, b) => prof(a) - prof(b) || a.codigo.localeCompare(b.codigo));

  const agrs = await query<any>(`SELECT codigo FROM sat_codigos_agrupadores`);
  const agrValidos = new Set<string>(agrs.rows.map((r: any) => r.codigo));
  const existentes = await query<any>(`SELECT id, codigo, nivel FROM accounting_accounts WHERE company_id=$1`, [companyId]);
  const idPorCodigo = new Map<string, { id: string; nivel: number }>(
    existentes.rows.map((r: any) => [r.codigo, { id: r.id, nivel: r.nivel }]));

  const rep = { total: cuentas.length, creadas: 0, yaExistian: 0, sinAgrupador: 0, errores: [] as string[] };
  for (const c of ordenadas) {
    try {
      // Agrupador válido en el Anexo 24: exacto, el zero-pad del decimal, o su padre.
      let agrupador: string | null = null;
      if (c.agrupador) {
        const padDec = c.agrupador.includes('.')
          ? `${c.agrupador.split('.')[0]}.${c.agrupador.split('.')[1].padStart(2, '0')}` : c.agrupador;
        agrupador = agrValidos.has(c.agrupador) ? c.agrupador
          : agrValidos.has(padDec) ? padDec
          : agrValidos.has(c.agrupador.split('.')[0]) ? c.agrupador.split('.')[0] : null;
      }
      if (!agrupador && esHoja(c.codigo)) rep.sinAgrupador++;
      const padre = porCodigo.has(c.padre) ? idPorCodigo.get(c.padre) : undefined;
      const nivel = padre ? padre.nivel + 1 : 1;
      const r = await query<any>(
        `INSERT INTO accounting_accounts
           (company_id, parent_id, codigo, nombre, codigo_agrupador, tipo, naturaleza,
            es_complementaria, nivel, permite_movimientos, requiere_tercero, moneda, activa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,false,'MXN',true)
         ON CONFLICT (company_id, codigo) DO UPDATE
           SET nombre=EXCLUDED.nombre,
               codigo_agrupador=COALESCE(EXCLUDED.codigo_agrupador, accounting_accounts.codigo_agrupador),
               parent_id=EXCLUDED.parent_id, nivel=EXCLUDED.nivel, updated_at=NOW()
         RETURNING id, (xmax=0) AS creada`,
        [companyId, padre?.id || null, c.codigo, c.nombre.slice(0, 250), agrupador,
         c.tipo, c.naturaleza, nivel, esHoja(c.codigo)]);
      idPorCodigo.set(c.codigo, { id: r.rows[0].id, nivel });
      if (r.rows[0].creada) rep.creadas++; else rep.yaExistian++;
      await query(`DELETE FROM accounting_cuentas_excluidas WHERE company_id=$1 AND codigo=$2`, [companyId, c.codigo]).catch(() => {});
    } catch (e: any) {
      rep.errores.push(`${c.codigo}: ${(e?.message || 'no se pudo crear').toString().slice(0, 120)}`);
    }
  }
  try { await asignarAgrupadorFaltante(companyId); } catch { /* no crítico */ }
  return rep;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LIBRO DIARIO (pólizas)
   ═══════════════════════════════════════════════════════════════════════════ */
export interface MovCtlk { cuenta: string; nombre: string; cargo: number; abono: number; }
export interface CfdiCtlk { fecha: string; documento: string; uuid: string; rfc: string; tipo: string; }
export interface PolizaCtlk {
  tipoRaw: string; tipo: 'INGRESO' | 'EGRESO' | 'DIARIO'; fecha: string; consecutivo: string;
  concepto: string; movimientos: MovCtlk[]; cfdis: CfdiCtlk[];
}

function tipoNexo(tipoRaw: string): 'INGRESO' | 'EGRESO' | 'DIARIO' {
  const par = /\(([^)]*)\)/.exec(tipoRaw)?.[1] || '';
  if (/ingreso/i.test(par)) return 'INGRESO';
  if (/egreso/i.test(par)) return 'EGRESO';
  return 'DIARIO';   // "Diario ( Manual )" y "Póliza de Cierre"
}

function reglaDeTipo(tipoRaw: string): string {
  const t = norm(tipoRaw);
  if (t.includes('venta')) return 'ventas_migrado';
  if (t.includes('compra')) return 'compras_migrado';
  if (t.includes('cobro')) return 'cobro_migrado';
  if (t.includes('pago')) return 'pago_migrado';
  if (t.includes('nota de credito')) return 'nc_migrado';
  if (t.includes('cierre')) return 'cierre_migrado';
  return 'migrado';
}

export function parsearPolizasXls(buffer: Buffer): PolizaCtlk[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true });
  const out: PolizaCtlk[] = [];
  let cur: PolizaCtlk | null = null;
  let inCfdi = false;
  const N = rows.length;
  let r = 0;
  while (r < N) {
    const row = rows[r] || [];
    const c0 = norm(row[0]);
    const v1 = row[1];
    const c1 = norm(v1);

    if (c0 === 'tipo de poliza') {
      cur = { tipoRaw: String(v1 ?? '').trim(), tipo: tipoNexo(String(v1 ?? '')), fecha: '', consecutivo: '', concepto: '', movimientos: [], cfdis: [] };
      out.push(cur);
      inCfdi = false;
      r++; continue;
    }
    if (cur && c0 === 'fecha' && !inCfdi && typeof v1 === 'number') {
      cur.fecha = fechaDeSerial(v1);
      r++; continue;
    }
    if (cur && c0 === 'descripcion' && !inCfdi) {
      cur.consecutivo = String(v1 ?? '').trim();
      r++; continue;
    }
    if (c0 === 'notas adicionales' && cur) {
      cur.concepto = String(v1 ?? '').trim();
      r++; continue;
    }
    if (c0.startsWith('cfdi asociados')) { inCfdi = true; r++; continue; }
    // Encabezado de la tabla de CFDI → consumir sus filas.
    if (c0 === 'fecha' && c1 === 'documento') {
      let rr = r + 1;
      while (rr < N) {
        const fr = rows[rr] || [];
        const f0 = norm(fr[0]);
        if (f0 === 'tipo de poliza') break;
        const uuid = String(fr[2] ?? '').trim();
        const vacia = !fr[0] && !fr[1] && !fr[2] && !fr[3] && !fr[4];
        if (vacia) { rr++; continue; }
        if (uuid && /-/.test(uuid)) {
          const fser = fr[0];
          cur?.cfdis.push({
            fecha: typeof fser === 'number' ? fechaDeSerial(fser) : String(fser ?? '').trim(),
            documento: String(fr[1] ?? '').trim(), uuid: uuid.toUpperCase(),
            rfc: String(fr[3] ?? '').trim().toUpperCase(), tipo: String(fr[4] ?? '').trim(),
          });
        }
        rr++;
      }
      r = rr; continue;
    }
    // Renglón de movimiento.
    if (cur && !inCfdi && typeof v1 === 'string') {
      const m = acctRe.exec(v1.trim());
      if (m && norm(v1) !== 'totales') {
        const cargo = Number(row[3]) || 0;
        const abono = Number(row[4]) || 0;
        cur.movimientos.push({ cuenta: m[1], nombre: m[2].trim(), cargo, abono });
      }
    }
    r++;
  }
  return out;
}

export async function importarPolizasXls(companyId: string, buffer: Buffer, userId?: string) {
  const polizas = parsearPolizasXls(buffer);
  if (!polizas.length) {
    throw new Error('No se encontraron pólizas. ¿Es el libro diario (impreso de pólizas) de Contalink en Excel?');
  }

  const ctas = await query<any>(`SELECT id, codigo FROM accounting_accounts WHERE company_id=$1`, [companyId]);
  const idPorCodigo = new Map<string, string>(ctas.rows.map((r: any) => [r.codigo, r.id]));

  const rep = {
    total: polizas.length, creadas: 0, yaExistian: 0, cfdiLigados: 0,
    omitidas: [] as Array<{ folio: string; motivo: string }>,
    // Pólizas que NO cuadraban de origen: su diferencia se mandó a la cuenta de
    // cuadre (MIG-TEMPORAL) para no perderlas; hay que revisarlas y corregirlas.
    conCuadre: [] as Array<{ folio: string; diferencia: number }>,
  };

  for (const [i, p] of polizas.entries()) {
    const etq = (`${p.tipoRaw} ${p.fecha} #${p.consecutivo}`).trim().slice(0, 60) || `#${i + 1}`;
    try {
      if (!p.fecha) { rep.omitidas.push({ folio: etq, motivo: 'sin fecha válida' }); continue; }

      // Idempotencia por hash del contenido (Contalink no trae UUID de póliza).
      const firma = [p.fecha, p.tipoRaw, p.consecutivo, p.concepto,
        p.movimientos.map((m) => `${m.cuenta}:${m.cargo}:${m.abono}`).join(';')].join('|');
      const origenUuid = 'CTLK:' + crypto.createHash('sha256').update(firma).digest('hex').slice(0, 35);
      const ya = await query<any>(`SELECT 1 FROM journal_entries WHERE company_id=$1 AND origen_uuid=$2 LIMIT 1`, [companyId, origenUuid]);
      if (ya.rows.length) { rep.yaExistian++; continue; }

      const unicoCfdi = p.cfdis.length === 1 ? p.cfdis[0] : null;
      const lineas: any[] = [];
      let faltante = '';
      for (const m of p.movimientos) {
        // Se conserva el importe en SU columna con SU signo (NEXO ya acepta negativos):
        // un ajuste con cargo −500 de Contalink queda como cargo −500, fiel al origen.
        // Solo si un renglón trae valor en LAS DOS columnas (raro) se netea a una.
        let cargo = round2(m.cargo || 0), abono = round2(m.abono || 0);
        if (cargo !== 0 && abono !== 0) { cargo = round2(cargo - abono); abono = 0; }
        if (cargo === 0 && abono === 0) continue;   // renglones en 0 no cambian el cuadre
        const id = idPorCodigo.get(m.cuenta);
        if (!id) { faltante = m.cuenta; break; }
        lineas.push({
          account_id: id, cargo, abono,
          concepto: p.concepto || undefined,
          uuid_cfdi: unicoCfdi?.uuid || undefined,
          party_rfc: unicoCfdi?.rfc || undefined,
        });
      }
      if (faltante) { rep.omitidas.push({ folio: etq, motivo: `la cuenta ${faltante} no está en el catálogo — importa el catálogo de CTLK primero` }); continue; }
      if (lineas.length < 2) { rep.omitidas.push({ folio: etq, motivo: 'menos de 2 renglones con importe' }); continue; }

      // Si NO cuadra (descuadre del origen), se manda la diferencia a la CUENTA DE
      // CUADRE (MIG-TEMPORAL) para que la póliza entre completa, sin perder nada;
      // se reporta para corregirla a mano en Pólizas.
      const sc = round2(lineas.reduce((a, l) => a + (l.cargo || 0), 0));
      const sa = round2(lineas.reduce((a, l) => a + (l.abono || 0), 0));
      const dif = round2(sc - sa);
      if (dif !== 0) {
        lineas.push({
          account_id: await asegurarCuentaTemporal(companyId),
          cargo: dif < 0 ? -dif : 0, abono: dif > 0 ? dif : 0,
          concepto: 'Ajuste de cuadre (migración CTLK)',
        });
      }

      const pol = await crearPoliza(companyId, {
        tipo: p.tipo, fecha: p.fecha, concepto: p.concepto || p.tipoRaw || 'Póliza CTLK',
        origen: 'MANUAL', origen_uuid: origenUuid, regla: reglaDeTipo(p.tipoRaw), lineas,
      } as any, userId);
      rep.creadas++;
      if (dif !== 0) rep.conCuadre.push({ folio: etq, diferencia: dif });

      // Guardar TODOS los CFDI asociados (sin pérdida), idempotente por (entry, uuid).
      for (const cf of p.cfdis) {
        if (!cf.uuid) continue;
        await query(
          `INSERT INTO journal_entry_cfdi (entry_id, company_id, uuid, rfc, tipo_comprobante, documento)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (entry_id, uuid) DO NOTHING`,
          [pol.id, companyId, cf.uuid.slice(0, 40), cf.rfc?.slice(0, 13) || null, cf.tipo?.slice(0, 8) || null, cf.documento?.slice(0, 60) || null]
        ).then(() => { rep.cfdiLigados++; }).catch(() => {});
      }
    } catch (e: any) {
      rep.omitidas.push({ folio: etq, motivo: (e?.message || 'error').toString().slice(0, 140) });
    }
  }
  return rep;
}
