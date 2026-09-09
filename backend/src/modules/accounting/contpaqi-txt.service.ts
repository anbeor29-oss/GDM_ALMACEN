/**
 * Importadores de TXT de CONTPAQi (ancho fijo, codificación latin1).
 *
 * ── CATÁLOGO (registros `C`) ──
 * Posiciones medidas contra archivos reales (2026-09-09):
 *   código  [3,33)   · nombre [34,136) · padre EXPLÍCITO [136,166) · letra de
 *   naturaleza [167] (A/B/D/F/G/H) · agrupador SAT al final [207).
 * El padre viene en el propio renglón, así que la jerarquía se arma ligando cada
 * cuenta a la que tiene ese código —no por máscara—. Las `RF`/`F` se ignoran.
 *
 * ── PÓLIZAS (`P` + renglones `M`) ──
 *   P: fecha YYYYMMDD [3,11) · tipo [15] (1=Diario/2=Ingreso/3=Egreso) ·
 *      concepto [40,140) · UUID [148,184).
 *   M: cuenta [3,33) · referencia [34,64) · TipoMovto [65] (0=cargo/1=abono) ·
 *      importe [67,88) · concepto [120,226) · UUID [226,262).
 * Cada póliza se crea por `crearPoliza` (mismo cuadre por trigger de BD), mapeando
 * la cuenta por su código (por eso el catálogo se importa PRIMERO).
 */
import { query } from '../../config/database';
import { crearPoliza } from './polizas.service';
import { asignarAgrupadorFaltante } from './catalogo.service';

/* La letra de CONTPAQi codifica tipo + lado natural de la cuenta. */
const LETRA: Record<string, { tipo: string; nat: 'DEUDORA' | 'ACREEDORA' }> = {
  A: { tipo: 'ACTIVO', nat: 'DEUDORA' },
  B: { tipo: 'ACTIVO', nat: 'ACREEDORA' },   // complementaria de activo (deprec/amort acumulada)
  D: { tipo: 'PASIVO', nat: 'ACREEDORA' },
  F: { tipo: 'CAPITAL', nat: 'ACREEDORA' },
  G: { tipo: 'GASTO', nat: 'DEUDORA' },       // costo/gasto/egreso (tipo se afina por agrupador)
  H: { tipo: 'INGRESO', nat: 'ACREEDORA' },
};
const TIPO_POR_DIG: Record<string, string> = {
  '1': 'ACTIVO', '2': 'PASIVO', '3': 'CAPITAL', '4': 'INGRESO', '5': 'COSTO', '6': 'GASTO', '7': 'GASTO', '8': 'ORDEN',
};
const natPorTipo = (t: string) => (['ACTIVO', 'COSTO', 'GASTO'].includes(t) ? 'DEUDORA' : 'ACREEDORA');
const TIPO_POL: Record<string, 'DIARIO' | 'INGRESO' | 'EGRESO'> = { '1': 'DIARIO', '2': 'INGRESO', '3': 'EGRESO' };
const fecha8 = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');

/* ═══════════════════════════════════════════════════════════════════════════
   CATÁLOGO
   ═══════════════════════════════════════════════════════════════════════════ */
export interface CuentaTxt {
  codigo: string; nombre: string; padre: string;
  tipo: string; naturaleza: string; esComplementaria: boolean; agrupador: string | null;
}

export function parsearCatalogoTxt(texto: string): CuentaTxt[] {
  const out: CuentaTxt[] = [];
  for (const raw of texto.split(/\r?\n/)) {
    if (raw[0] !== 'C') continue;
    const codigo = raw.slice(3, 33).trim();
    if (!codigo) continue;
    const nombre = raw.slice(34, 136).trim();
    const padre = raw.slice(136, 166).trim();
    const letra = (raw[167] || '').toUpperCase();
    let agr = raw.slice(207).trim();
    if (!agr || /^0+$/.test(agr)) agr = '';
    const base = LETRA[letra] || { tipo: 'ORDEN', nat: 'DEUDORA' as const };
    const tipo = agr ? (TIPO_POR_DIG[agr[0]] || base.tipo) : base.tipo;
    const naturaleza = base.nat;
    out.push({
      codigo, nombre: nombre || codigo, padre, tipo, naturaleza,
      esComplementaria: naturaleza !== natPorTipo(tipo), agrupador: agr || null,
    });
  }
  return out;
}

export async function importarCatalogoTxt(companyId: string, buffer: Buffer) {
  const cuentas = parsearCatalogoTxt(buffer.toString('latin1'));
  if (!cuentas.length) {
    throw new Error('No se encontraron cuentas (registros «C») en el archivo. ¿Es el catálogo de CONTPAQi en TXT?');
  }

  const porCodigo = new Map(cuentas.map((c) => [c.codigo, c]));
  const conHijos = new Set(cuentas.map((c) => c.padre).filter(Boolean));
  const esHoja = (cod: string) => !conHijos.has(cod);

  // Crear padres antes que hijos: se ordena por profundidad de la cadena de padres.
  const prof = (c: CuentaTxt): number => {
    let d = 0; let cur: CuentaTxt | undefined = c; let g = 0;
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
      // Agrupador válido en el Anexo 24: exacto, o su padre (603.50 → 603) si el detalle no está.
      const agrupador = !c.agrupador ? null
        : agrValidos.has(c.agrupador) ? c.agrupador
        : agrValidos.has(c.agrupador.split('.')[0]) ? c.agrupador.split('.')[0] : null;
      if (!agrupador && esHoja(c.codigo)) rep.sinAgrupador++;
      const padre = porCodigo.has(c.padre) ? idPorCodigo.get(c.padre) : undefined;
      const nivel = padre ? padre.nivel + 1 : 1;
      const r = await query<any>(
        `INSERT INTO accounting_accounts
           (company_id, parent_id, codigo, nombre, codigo_agrupador, tipo, naturaleza,
            es_complementaria, nivel, permite_movimientos, requiere_tercero, moneda, activa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,'MXN',true)
         ON CONFLICT (company_id, codigo) DO UPDATE
           SET nombre=EXCLUDED.nombre,
               codigo_agrupador=COALESCE(EXCLUDED.codigo_agrupador, accounting_accounts.codigo_agrupador),
               parent_id=EXCLUDED.parent_id, nivel=EXCLUDED.nivel, updated_at=NOW()
         RETURNING id, (xmax=0) AS creada`,
        [companyId, padre?.id || null, c.codigo, c.nombre.slice(0, 250), agrupador,
         c.tipo, c.naturaleza, c.esComplementaria, nivel, esHoja(c.codigo)]);
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
   PÓLIZAS
   ═══════════════════════════════════════════════════════════════════════════ */
export interface MovTxt { cuenta: string; ref: string; tipoMovto: string; importe: number; concepto: string; uuid: string; }
export interface PolizaTxt { fecha: string; tipo: 'DIARIO' | 'INGRESO' | 'EGRESO'; concepto: string; uuid: string; movimientos: MovTxt[]; }

export function parsearPolizasTxt(texto: string): PolizaTxt[] {
  const out: PolizaTxt[] = [];
  let cur: PolizaTxt | null = null;
  for (const raw of texto.split(/\r?\n/)) {
    if (raw[0] === 'P') {
      cur = {
        fecha: fecha8(raw.slice(3, 11).trim()),
        tipo: TIPO_POL[raw[15]] || 'DIARIO',
        concepto: raw.slice(40, 140).trim(),
        uuid: raw.slice(148, 184).trim(),
        movimientos: [],
      };
      out.push(cur);
    } else if (raw[0] === 'M' && cur) {
      const cuenta = raw.slice(3, 33).trim();
      if (!cuenta) continue;
      cur.movimientos.push({
        cuenta, ref: raw.slice(34, 64).trim(), tipoMovto: raw[65],
        importe: Number(raw.slice(67, 88).trim()) || 0,
        concepto: raw.slice(120, 226).trim(), uuid: raw.slice(226, 262).trim(),
      });
    }
  }
  return out;
}

function reglaMigrada(concepto: string): string {
  const c = (concepto || '').toLowerCase();
  if (/n[oó]mina|sueldos?|raya|finiquito|aguinaldo/.test(c)) return 'nomina_migrado';
  if (/cobro|cobranza/.test(c)) return 'cobro_migrado';
  if (/\bpago/.test(c)) return 'pago_migrado';
  if (/venta|factura/.test(c)) return 'ventas_migrado';
  if (/compra/.test(c)) return 'compras_migrado';
  return 'migrado';
}

export async function importarPolizasTxt(companyId: string, buffer: Buffer, userId?: string) {
  const polizas = parsearPolizasTxt(buffer.toString('latin1'));
  if (!polizas.length) {
    throw new Error('No se encontraron pólizas (registros «P») en el archivo. ¿Es el TXT de pólizas de CONTPAQi?');
  }

  const ctas = await query<any>(`SELECT id, codigo FROM accounting_accounts WHERE company_id=$1`, [companyId]);
  const idPorCodigo = new Map<string, string>(ctas.rows.map((r: any) => [r.codigo, r.id]));

  const rep = { total: polizas.length, creadas: 0, yaExistian: 0, omitidas: [] as Array<{ folio: string; motivo: string }> };
  for (const [i, p] of polizas.entries()) {
    const etq = (`${p.fecha} · ${p.concepto}`).trim().slice(0, 48) || `#${i + 1}`;
    try {
      if (!p.fecha) { rep.omitidas.push({ folio: etq, motivo: 'sin fecha válida' }); continue; }
      // Idempotencia por el UUID de la póliza (si trae): reimportar no duplica.
      if (p.uuid) {
        const ya = await query<any>(`SELECT 1 FROM journal_entries WHERE company_id=$1 AND origen_uuid=$2 LIMIT 1`, [companyId, p.uuid]);
        if (ya.rows.length) { rep.yaExistian++; continue; }
      }
      const lineas: any[] = [];
      let faltante = '';
      for (const m of p.movimientos) {
        if (!m.importe) continue;   // renglones en 0 no aportan y no cambian el cuadre
        const id = idPorCodigo.get(m.cuenta);
        if (!id) { faltante = m.cuenta; break; }
        lineas.push({
          account_id: id,
          cargo: m.tipoMovto === '0' ? m.importe : 0,
          abono: m.tipoMovto === '1' ? m.importe : 0,
          concepto: m.concepto || undefined,
          uuid_cfdi: m.uuid || undefined,
        });
      }
      if (faltante) { rep.omitidas.push({ folio: etq, motivo: `la cuenta ${faltante} no está en el catálogo — importa el catálogo primero` }); continue; }
      if (lineas.length < 2) { rep.omitidas.push({ folio: etq, motivo: 'menos de 2 renglones con importe' }); continue; }
      await crearPoliza(companyId, {
        tipo: p.tipo, fecha: p.fecha, concepto: p.concepto || 'Póliza CONTPAQi',
        origen: 'MANUAL', origen_uuid: p.uuid || undefined, regla: reglaMigrada(p.concepto), lineas,
      } as any, userId);
      rep.creadas++;
    } catch (e: any) {
      rep.omitidas.push({ folio: etq, motivo: (e?.message || 'error').toString().slice(0, 140) });
    }
  }
  return rep;
}
