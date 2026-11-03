/**
 * sbc-bimestral.service — Salario variable / SBC bimestral (etapa 4 del `.md`).
 *
 * Determina el componente VARIABLE del salario base de cotización: recupera las
 * percepciones efectivamente pagadas en el BIMESTRE inmediato anterior (de los
 * CFDI de nómina timbrados, la fuente de verdad), clasifica cada concepto como
 * INTEGRABLE o EXCLUIDO con la tabla configurable `nomina_sbc_integracion`
 * (criterio LSS Art. 27 que el usuario valida), suma los integrables, los divide
 * entre los días de salario DEVENGADO del bimestre (los efectivamente pagados) y
 * obtiene el promedio diario variable. El SBC propuesto = componente fijo
 * (SDI actual) + promedio variable, topado a 25 UMA (Art. 28).
 *
 * NO envía nada al IMSS: deja el cálculo listo para REVISIÓN y, si se autoriza, se
 * genera el movimiento de MODIFICACIÓN con el motor IDSE que ya existe. Los límites
 * finos (ahorro/despensa/alimentación) y el formato IDSE se validan aparte.
 */
import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import * as ejercicios from './ejercicios.service';

const attr = (s: string, n: string) => { const m = new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`).exec(s); return m ? m[1] : ''; };
const num = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n: any) => Math.round((Number(n) || 0) * 10000) / 10000;

/** La clasificación integra SÍ/NO por c_TipoPercepcion. */
export async function listarIntegracion() {
  const r = await query<any>(`SELECT clave, nombre, integra, nota, confirmado FROM nomina_sbc_integracion ORDER BY clave`);
  return r.rows;
}
export async function guardarIntegracion(clave: string, integra: boolean, confirmado?: boolean) {
  if (!clave) throw new ValidationError('Falta la clave del concepto.');
  await query(
    `INSERT INTO nomina_sbc_integracion (clave, nombre, integra, confirmado)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (clave) DO UPDATE SET integra=EXCLUDED.integra,
       confirmado=COALESCE($4, nomina_sbc_integracion.confirmado), updated_at=NOW()`,
    [clave, clave, !!integra, confirmado ?? null]);
  return listarIntegracion();
}
async function mapaIntegra(): Promise<Map<string, boolean>> {
  const r = await query<any>(`SELECT clave, integra FROM nomina_sbc_integracion`);
  return new Map(r.rows.map((x: any) => [String(x.clave), !!x.integra]));
}

/** Suma, por TipoPercepcion, el importe de un CFDI de nómina. */
function percepcionesPorTipo(xml: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of xml.match(/<(?:\w+:)?Percepcion\b[^>]*>/g) || []) {
    const t = attr(p, 'TipoPercepcion');
    if (!t) continue;
    const imp = num(attr(p, 'ImporteGravado')) + num(attr(p, 'ImporteExento'));
    m.set(t, (m.get(t) || 0) + imp);
  }
  return m;
}

/** Rango de fechas del bimestre (1=Ene-Feb … 6=Nov-Dic). */
function rangoBimestre(anio: number, bim: number) {
  const mesIni = (bim - 1) * 2 + 1;
  const mesFin = bim * 2;
  const ini = `${anio}-${String(mesIni).padStart(2, '0')}-01`;
  const fin = new Date(Date.UTC(anio, mesFin, 0)).toISOString().slice(0, 10);
  // El nuevo SBC aplica desde el 1º del bimestre siguiente; se presenta en los
  // primeros días hábiles de ese mes (aquí, día 5 como referencia a afinar).
  const aplicaAnio = mesFin === 12 ? anio + 1 : anio;
  const aplicaMes = mesFin === 12 ? 1 : mesFin + 1;
  const fechaAplicacion = `${aplicaAnio}-${String(aplicaMes).padStart(2, '0')}-01`;
  const fechaLimite = `${aplicaAnio}-${String(aplicaMes).padStart(2, '0')}-05`;
  return { ini, fin, fechaAplicacion, fechaLimite };
}

/**
 * Calcula el SBC bimestral de TODOS los trabajadores con percepciones variables
 * integrables en el bimestre, lo guarda (idempotente) y lo devuelve.
 */
export async function calcular(companyId: string, anio: number, bimestre: number) {
  if (!Number.isInteger(bimestre) || bimestre < 1 || bimestre > 6) throw new ValidationError('Bimestre inválido (1 a 6).');
  const { ini, fin, fechaAplicacion, fechaLimite } = rangoBimestre(anio, bimestre);
  const integra = await mapaIntegra();
  const ej = await ejercicios.cargar(anio).catch(() => null);
  const topeSbc = ej ? Number(ej.umaDiaria) * 25 : 0;

  // CFDI de nómina EMITIDOS del bimestre → percepciones integrables + días por trabajador.
  const r = await query<any>(
    `SELECT uuid, xml FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion='emitidos' AND tipo_comprobante='N' AND xml IS NOT NULL
        AND fecha_emision::date BETWEEN $2::date AND $3::date
        AND (estado_sat IS NULL OR estado_sat <> 'Cancelado')`, [companyId, ini, fin]);

  type Acum = { rfc: string; integrable: number; dias: number; conceptos: Set<string> };
  const porRfc = new Map<string, Acum>();
  for (const c of r.rows) {
    const xml = String(c.xml);
    // Trabajador (cfdi:Receptor con Rfc).
    let rfc = '';
    for (const rec of xml.match(/<(?:\w+:)?Receptor\b[^>]*>/g) || []) { const x = attr(rec, 'Rfc'); if (x) { rfc = x.toUpperCase(); break; } }
    if (!rfc) continue;
    const nomNode = (/<(?:\w+:)?Nomina\b[^>]*>/.exec(xml) || [''])[0];
    const dias = num(attr(nomNode, 'NumDiasPagados'));
    if (!porRfc.has(rfc)) porRfc.set(rfc, { rfc, integrable: 0, dias: 0, conceptos: new Set() });
    const a = porRfc.get(rfc)!;
    a.dias += dias;
    for (const [tipo, imp] of percepcionesPorTipo(xml)) {
      if (integra.get(tipo)) { a.integrable += imp; a.conceptos.add(tipo); }
    }
  }

  // Empleados (para el SDI fijo actual, NSS, nombre). Match por RFC.
  const emps = await query<any>(
    `SELECT rfc, nss, salario_diario, salario_diario_integrado,
            TRIM(nombre || ' ' || apellido_pat || ' ' || COALESCE(apellido_mat,'')) AS nombre
       FROM nomina_empleados WHERE company_id=$1 AND deleted_at IS NULL`, [companyId]);
  const empDe = new Map<string, any>(emps.rows.map((e: any) => [String(e.rfc || '').toUpperCase(), e]));

  const filas: any[] = [];
  for (const a of porRfc.values()) {
    if (a.integrable <= 0) continue;                 // sin variable integrable → no hay modificación
    const e = empDe.get(a.rfc);
    const promedio = a.dias > 0 ? r4(a.integrable / a.dias) : 0;
    const sdiFijo = r4(Number(e?.salario_diario_integrado) || 0);
    const sbcAnterior = sdiFijo;
    let sbcPropuesto = r4(sdiFijo + promedio);
    if (topeSbc > 0 && sbcPropuesto > topeSbc) sbcPropuesto = r4(topeSbc);
    filas.push({
      empleado_id: e?.id || null, rfc: a.rfc, nss: e?.nss || '', nombre: e?.nombre || a.rfc,
      dias: a.dias, conceptos: Array.from(a.conceptos).sort(),
      variableIntegrable: r2(a.integrable), promedioVariable: promedio,
      sdiFijo, sbcAnterior, sbcPropuesto, diferencia: r4(sbcPropuesto - sbcAnterior),
      fechaAplicacion, fechaLimite, enExpediente: !!e,
    });

    if (e?.id) {
      await query(
        `INSERT INTO nomina_sbc_calculo
           (company_id, empleado_id, anio, bimestre, dias_devengados, variable_integrable, promedio_variable,
            sdi_fijo, sbc_anterior, sbc_propuesto, fecha_aplicacion, fecha_limite, estatus, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'POR_REVISAR',NOW())
         ON CONFLICT (company_id, empleado_id, anio, bimestre) DO UPDATE SET
           dias_devengados=EXCLUDED.dias_devengados, variable_integrable=EXCLUDED.variable_integrable,
           promedio_variable=EXCLUDED.promedio_variable, sdi_fijo=EXCLUDED.sdi_fijo, sbc_anterior=EXCLUDED.sbc_anterior,
           sbc_propuesto=EXCLUDED.sbc_propuesto, fecha_aplicacion=EXCLUDED.fecha_aplicacion,
           fecha_limite=EXCLUDED.fecha_limite, updated_at=NOW()`,
        [companyId, e.id, anio, bimestre, a.dias, r2(a.integrable), promedio, sdiFijo, sbcAnterior, sbcPropuesto, fechaAplicacion, fechaLimite]);
    }
  }
  filas.sort((x, y) => String(x.nombre).localeCompare(String(y.nombre), 'es'));

  return {
    anio, bimestre, rango: { ini, fin }, fechaAplicacion, fechaLimite,
    filas,
    totales: {
      trabajadores: filas.length,
      conCambio: filas.filter((f) => Math.abs(f.diferencia) >= 0.01).length,
      sinExpediente: filas.filter((f) => !f.enExpediente).length,
    },
    aviso: ej ? '' : `No hay parámetros de nómina (UMA) para ${anio}: el tope de 25 UMA no se aplicó. Captúralos en Nómina → Parámetros.`,
  };
}
