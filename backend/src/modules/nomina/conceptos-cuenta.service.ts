/**
 * Conceptos de nómina y su cuenta — la config de la que sale la póliza de pasivo.
 * La lista es de código (nomina-conceptos.data); aquí se le pega la cuenta que
 * cada empresa asignó y se guarda cuando cambia.
 */
import { query } from '../../config/database';
import { CONCEPTOS_NOMINA, GrupoConcepto } from './nomina-conceptos.data';

/** El catálogo con la cuenta asignada de la empresa pegada a cada concepto. */
export async function conceptosConCuenta(companyId: string) {
  const r = await query<any>(
    `SELECT grupo, clave, cuenta_codigo FROM nomina_concepto_cuenta WHERE company_id=$1`,
    [companyId]);
  const asignadas = new Map<string, string>();
  for (const row of r.rows) asignadas.set(`${row.grupo}|${row.clave}`, row.cuenta_codigo);

  return CONCEPTOS_NOMINA.map((c) => ({
    ...c,
    cuenta: asignadas.get(`${c.grupo}|${c.clave}`) || null,
  }));
}

/** Asigna (o limpia con null) la cuenta de un concepto. */
export async function asignarCuentaConcepto(
  companyId: string, grupo: string, clave: string, cuenta: string | null
): Promise<boolean> {
  // Sólo conceptos que existen en el catálogo de código.
  const existe = CONCEPTOS_NOMINA.some((c) => c.grupo === grupo && c.clave === clave);
  if (!existe) return false;

  await query(
    `INSERT INTO nomina_concepto_cuenta (company_id, grupo, clave, cuenta_codigo, updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (company_id, grupo, clave)
       DO UPDATE SET cuenta_codigo = EXCLUDED.cuenta_codigo, updated_at = NOW()`,
    [companyId, grupo, clave, cuenta ? cuenta.trim().slice(0, 40) || null : null]);
  return true;
}

/** Cuántos conceptos de un grupo siguen sin cuenta (para avisar antes de armar la póliza). */
export async function faltantesPorGrupo(companyId: string): Promise<Record<GrupoConcepto, number>> {
  const lista = await conceptosConCuenta(companyId);
  const out = { PERCEPCION: 0, DEDUCCION: 0, NETO: 0, PROVISION: 0 } as Record<GrupoConcepto, number>;
  for (const c of lista) if (!c.cuenta) out[c.grupo]++;
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUTO-ASIGNAR DESDE EL RESPALDO (CPQ / Contalink)
   ───────────────────────────────────────────────────────────────────────────
   «Lo mismo que ventas/compras, pero para nómina»: en vez de pedir que el usuario
   coloque cada uno de los ~34 conceptos, se asignan solos tomando las cuentas que
   YA vienen en el respaldo importado (el catálogo de CPQ/Contalink entra a
   accounting_accounts). Como muchos catálogos de cliente NO usan la numeración del
   SAT, el agrupador falla; por eso se casa por NOMBRE de la cuenta + el lado
   (cargo→gasto, abono→pasivo), y se prefiere la cuenta que el respaldo de verdad USÓ
   en sus pólizas. Los conceptos que NO tengan cuenta parecida (los que no vienen en
   los timbres del cliente) se dejan SIN cuenta —no se inventan—. Sólo rellena vacíos:
   nunca pisa una cuenta ya asignada a mano. Sirve igual para CPQ y para Contalink,
   porque ambos importan al MISMO catálogo y journal. */

/** Palabras con las que se reconoce cada concepto en el NOMBRE de la cuenta del
 *  respaldo. Normalizadas al comparar (sin acentos, mayúsculas). */
const PALABRAS_CONCEPTO: Record<string, string[]> = {
  'PERCEPCION|001': ['SUELDO', 'SALARIO', 'RAYA', 'JORNAL', 'REMUNERAC'],
  'PERCEPCION|019': ['HORA EXTRA', 'TIEMPO EXTRA', 'EXTRAORDINARIA'],
  'PERCEPCION|020': ['DOMINICAL'],
  'PERCEPCION|021': ['PRIMA VACACIONAL', 'VACACIONAL'],
  'PERCEPCION|002': ['AGUINALDO', 'GRATIFICACION ANUAL'],
  'PERCEPCION|003': ['PTU', 'UTILIDADES', 'REPARTO'],
  'PERCEPCION|010': ['PUNTUALID', 'ASISTENCIA'],
  'PERCEPCION|012': ['GRATIFICAC', 'BONO', 'INCENTIVO'],
  'PERCEPCION|015': ['DESPENSA', 'VALE'],
  'PERCEPCION|046': ['COMISION'],
  'PERCEPCION|022': ['ANTIGUEDAD'],
  'PERCEPCION|023': ['FINIQUITO', 'SEPARACION', 'LIQUIDACION'],
  'PERCEPCION|025': ['INDEMNIZAC'],
  'PERCEPCION|049': ['ASIMILAD'],
  'PERCEPCION|050': ['VIATICO'],
  'PERCEPCION|039': ['OTRAS PERCEP', 'OTROS INGRESOS GRAVAD'],
  'PERCEPCION|SUBSIDIO': ['SUBSIDIO'],
  'DEDUCCION|002': ['ISR', 'IMPUESTO SOBRE LA RENTA', 'I.S.R'],
  'DEDUCCION|001': ['IMSS', 'SEGURO SOCIAL'],
  'DEDUCCION|INFONAVIT': ['INFONAVIT'],
  'DEDUCCION|FONACOT': ['FONACOT'],
  'DEDUCCION|007': ['PENSION', 'ALIMENT'],
  'DEDUCCION|006': ['AHORRO', 'CAJA DE AHORRO', 'FONDO DE AHORRO'],
  'DEDUCCION|004': ['OTROS DESCUENTOS', 'OTRAS DEDUC'],
  'NETO|NETO': ['NOMINA POR PAGAR', 'SUELDOS POR PAGAR', 'RAYA POR PAGAR', 'REMUNERAC', 'NETO'],
  'PROVISION|IMSS_PAT_G': ['IMSS', 'CUOTA', 'SEGURO SOCIAL'],
  'PROVISION|IMSS_PAT_P': ['IMSS', 'CUOTA', 'SEGURO SOCIAL'],
  'PROVISION|RCV_G': ['RCV', 'RETIRO', 'CESANTIA', 'SAR'],
  'PROVISION|RCV_P': ['RCV', 'RETIRO', 'CESANTIA', 'SAR'],
  'PROVISION|INFO_G': ['INFONAVIT'],
  'PROVISION|INFO_P': ['INFONAVIT'],
  'PROVISION|ISN_G': ['SOBRE NOMINA', 'ISN', 'IMPUESTO ESTATAL', '3% NOMINA'],
  'PROVISION|ISN_P': ['SOBRE NOMINA', 'ISN', 'IMPUESTO ESTATAL'],
};

const normaliza = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** El tipo de cuenta que corresponde a cada concepto, por su lado contable. */
function tiposEsperados(grupo: string, clave: string, lado: 'cargo' | 'abono'): string[] {
  if (clave === 'SUBSIDIO') return ['ACTIVO'];      // subsidio por aplicar = saldo a favor
  return lado === 'cargo' ? ['GASTO', 'COSTO'] : ['PASIVO'];
}

export interface AsignacionDesdeRespaldo {
  asignadas: number; sinCuenta: number;
  detalle: Array<{ grupo: string; clave: string; nombre: string; cuenta: string | null; nombreCuenta?: string; via?: string }>;
}

export async function autoAsignarDesdeRespaldo(companyId: string): Promise<AsignacionDesdeRespaldo> {
  const conceptos = await conceptosConCuenta(companyId);
  // Cuentas de movimiento del catálogo (que vinieron del respaldo CPQ/CTLK) + si el
  // respaldo las USÓ en alguna póliza (para preferir las reales sobre las vacías).
  const ctas = (await query<any>(
    `SELECT a.codigo, a.nombre, a.tipo, a.codigo_agrupador,
            EXISTS (SELECT 1 FROM journal_lines l WHERE l.account_id = a.id) AS usada
       FROM accounting_accounts a
      WHERE a.company_id=$1 AND a.activa=true AND a.permite_movimientos=true`,
    [companyId])).rows.map((c: any) => ({ ...c, nom: normaliza(c.nombre) }));

  let asignadas = 0, sinCuenta = 0;
  const detalle: AsignacionDesdeRespaldo['detalle'] = [];

  for (const concepto of conceptos as any[]) {
    if (concepto.cuenta) continue;   // sólo rellena vacíos; no pisa lo asignado a mano
    const tiposOk = tiposEsperados(concepto.grupo, concepto.clave, concepto.lado);
    const kws = (PALABRAS_CONCEPTO[`${concepto.grupo}|${concepto.clave}`] || []).map(normaliza);

    let best: any = null, bestScore = 0, bestVia = '';
    for (const c of ctas) {
      if (!tiposOk.includes(c.tipo)) continue;
      const agrupOk = !!c.codigo_agrupador && c.codigo_agrupador === concepto.sugerida;
      const nombreOk = kws.length > 0 && kws.some((k) => c.nom.includes(k));
      if (!agrupOk && !nombreOk) continue;
      let score = 0, via = '';
      if (agrupOk) { score += 10; via = 'agrupador'; }
      if (nombreOk) { score += 5; via = via ? 'agrupador+nombre' : 'nombre'; }
      if (c.usada) score += 2;   // la que el respaldo realmente usó
      if (score > bestScore) { best = c; bestScore = score; bestVia = via; }
    }

    if (best) {
      await asignarCuentaConcepto(companyId, concepto.grupo, concepto.clave, best.codigo);
      asignadas++;
      detalle.push({ grupo: concepto.grupo, clave: concepto.clave, nombre: concepto.nombre, cuenta: best.codigo, nombreCuenta: best.nombre, via: bestVia });
    } else {
      sinCuenta++;
      detalle.push({ grupo: concepto.grupo, clave: concepto.clave, nombre: concepto.nombre, cuenta: null });
    }
  }
  return { asignadas, sinCuenta, detalle };
}
