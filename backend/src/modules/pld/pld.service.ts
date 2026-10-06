/**
 * pld.service — PLD / antilavado (LFPIORPI).
 *
 * Jala lo que NEXO ya tiene (facturas emitidas, clientes, UMA) y lo cruza contra los
 * umbrales del Art. 17 (monto en UMA × UMA vigente) para alertar qué operaciones
 * exigen IDENTIFICACIÓN (expediente) y cuáles exigen AVISO a la UIF (a más tardar el
 * día 17 del mes siguiente, Art. 23). Sólo aplica a empresas que declaran una
 * Actividad Vulnerable. Ver docs/PLD_LFPIORPI_ANALISIS.md.
 *
 * El Aviso se PRESENTA en el Portal del SAT (SPPLD) con e.firma; aquí se detecta,
 * se arma el expediente y (fase siguiente) se generará el XML. No hay API de avisos.
 */
import { query } from '../../config/database';

/* ── Catálogo de Actividades Vulnerables (Art. 17) con umbrales en UMA ──
 * identificacion/aviso: monto en VECES la UMA diaria. 0 = siempre (identificar
 * aunque sea bajo monto). null = no se dispara por monto fijo (caso especial). */
export interface ActividadVulnerable {
  fraccion: string;
  label: string;
  identificacion: number | null;
  aviso: number | null;
  periodicidad: 'operacion' | 'mensual';
  nota?: string;
}

export const ACTIVIDADES: ActividadVulnerable[] = [
  { fraccion: 'I',     label: 'Juegos con apuesta, concursos o sorteos',                   identificacion: 325,  aviso: 645,  periodicidad: 'operacion' },
  { fraccion: 'II',    label: 'Tarjetas y monederos (no financieras)',                      identificacion: 645,  aviso: 645,  periodicidad: 'operacion', nota: 'Tarjetas de crédito/servicios: identif. 805 (gasto mensual), aviso 1,285.' },
  { fraccion: 'III',   label: 'Cheques de viajero (no financieras)',                        identificacion: null, aviso: 645,  periodicidad: 'operacion' },
  { fraccion: 'IV',    label: 'Mutuo, préstamos o créditos (no financieras)',               identificacion: 0,    aviso: 1605, periodicidad: 'operacion' },
  { fraccion: 'V',     label: 'Construcción, desarrollo o intermediación inmobiliaria',     identificacion: 0,    aviso: 8025, periodicidad: 'operacion' },
  { fraccion: 'V Bis', label: 'Recepción de recursos para un desarrollo inmobiliario',      identificacion: 0,    aviso: 8025, periodicidad: 'operacion' },
  { fraccion: 'VI',    label: 'Metales/piedras preciosas, joyas o relojes',                 identificacion: 805,  aviso: 1605, periodicidad: 'operacion' },
  { fraccion: 'VII',   label: 'Subasta o comercialización de obras de arte',               identificacion: 2410, aviso: 4815, periodicidad: 'operacion' },
  { fraccion: 'VIII',  label: 'Comercialización de vehículos (aéreos/marítimos/terrestres)', identificacion: 3210, aviso: 6420, periodicidad: 'operacion' },
  { fraccion: 'IX',    label: 'Blindaje de vehículos o inmuebles',                          identificacion: 2410, aviso: 4815, periodicidad: 'operacion' },
  { fraccion: 'X',     label: 'Traslado o custodia de dinero o valores',                    identificacion: null, aviso: 3210, periodicidad: 'operacion', nota: 'Aviso también siempre que no pueda determinarse el monto.' },
  { fraccion: 'XI',    label: 'Servicios profesionales por cuenta del cliente',             identificacion: 0,    aviso: null, periodicidad: 'operacion', nota: 'Aviso cuando se realice la operación en nombre del cliente (no por monto).' },
  { fraccion: 'XII',   label: 'Fe pública (notarios/corredores)',                           identificacion: null, aviso: null, periodicidad: 'operacion', nota: 'Por acto: inmuebles ≥8,000, fideicomisos ≥4,000, poderes irrevocables y constitución de sociedades: siempre.' },
  { fraccion: 'XIII',  label: 'Donativos (A.C./S.C. sin fines de lucro)',                   identificacion: 1605, aviso: 3210, periodicidad: 'operacion' },
  { fraccion: 'XIV',   label: 'Comercio exterior (agente/agencia aduanal)',                 identificacion: null, aviso: null, periodicidad: 'operacion', nota: 'Aviso en todos los casos; por tipo de bien.' },
  { fraccion: 'XV',    label: 'Arrendamiento de inmuebles',                                 identificacion: 1605, aviso: 3210, periodicidad: 'mensual' },
  { fraccion: 'XVI',   label: 'Intercambio de activos virtuales (cripto)',                  identificacion: null, aviso: 210,  periodicidad: 'operacion' },
];

export function actividadDe(fraccion?: string | null): ActividadVulnerable | null {
  if (!fraccion) return null;
  return ACTIVIDADES.find((a) => a.fraccion === fraccion) || null;
}

/* ── UMA vigente (la toma de nomina_ejercicios; cae a 113.14 si no hay) ── */
export async function umaDiaria(): Promise<number> {
  const r = await query<any>(`SELECT uma_diaria::float AS uma FROM nomina_ejercicios ORDER BY anio DESC LIMIT 1`);
  const uma = Number(r.rows[0]?.uma);
  return Number.isFinite(uma) && uma > 0 ? uma : 113.14;
}

/* ── Config por empresa ── */
export interface PldConfig {
  activo: boolean;
  fraccion: string | null;
  representante_nombre: string | null;
  representante_rfc: string | null;
  padron_folio: string | null;
  padron_alta: string | null;
}

export async function getConfig(companyId: string): Promise<PldConfig> {
  const r = await query<any>(
    `SELECT activo, fraccion, representante_nombre, representante_rfc, padron_folio,
            TO_CHAR(padron_alta,'YYYY-MM-DD') AS padron_alta
       FROM pld_config WHERE company_id = $1`, [companyId]);
  return r.rows[0] || { activo: false, fraccion: null, representante_nombre: null, representante_rfc: null, padron_folio: null, padron_alta: null };
}

export async function setConfig(companyId: string, d: Partial<PldConfig>): Promise<PldConfig> {
  await query(
    `INSERT INTO pld_config (company_id, activo, fraccion, representante_nombre, representante_rfc, padron_folio, padron_alta, updated_at)
     VALUES ($1, COALESCE($2,FALSE), $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (company_id) DO UPDATE SET
       activo = COALESCE($2, pld_config.activo),
       fraccion = $3,
       representante_nombre = $4,
       representante_rfc = $5,
       padron_folio = $6,
       padron_alta = $7,
       updated_at = NOW()`,
    [companyId, d.activo ?? null, d.fraccion || null, d.representante_nombre || null,
     d.representante_rfc || null, d.padron_folio || null, d.padron_alta || null]);
  return getConfig(companyId);
}

/* ── Fechas ── */
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Próximo corte de Aviso: día 17 del mes siguiente al periodo con operaciones. */
function proximoDia17(): string {
  const now = new Date();
  // Las operaciones del mes anterior se avisan a más tardar el 17 de ESTE mes;
  // si ya pasó el 17, el siguiente corte es el 17 del mes que viene.
  let y = now.getFullYear(), m = now.getMonth();
  if (now.getDate() > 17) { m += 1; if (m > 11) { m = 0; y += 1; } }
  return iso(new Date(y, m, 17));
}

/* ── Tablero: detección sobre las facturas emitidas ──
 * Cruza las facturas timbradas de los últimos 6 meses contra los umbrales de la
 * fracción activa y agrupa: operaciones que exigen Aviso, las que sólo exigen
 * identificación, clientes que rebasan el umbral por ACUMULACIÓN de 6 meses, y los
 * expedientes pendientes. */
export async function tablero(companyId: string) {
  const cfg = await getConfig(companyId);
  const act = actividadDe(cfg.fraccion);
  if (!cfg.activo || !act) {
    return { activo: false, fraccion: cfg.fraccion, config: cfg };
  }

  const uma = await umaDiaria();
  const umbralIdent = act.identificacion != null ? Math.round(act.identificacion * uma * 100) / 100 : null;
  const umbralAviso = act.aviso != null ? Math.round(act.aviso * uma * 100) / 100 : null;

  const desde = new Date(); desde.setMonth(desde.getMonth() - 6);
  const desdeIso = iso(desde);

  // Facturas timbradas y vigentes (ingresos) de los últimos 6 meses, con su cliente.
  const r = await query<any>(
    `SELECT i.id, i.folio, i.serie, i.total::float AS total,
            TO_CHAR(i.date_issued,'YYYY-MM-DD') AS fecha,
            c.id AS customer_id, c.rfc, c.business_name AS nombre
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
      WHERE i.company_id = $1
        AND i.is_stamped = TRUE AND COALESCE(i.is_active, TRUE) = TRUE
        AND UPPER(COALESCE(i.status,'')) <> 'CANCELLED'
        AND i.cfdi_type = 'I'
        AND i.date_issued >= $2
        AND i.total > 0
      ORDER BY i.date_issued DESC`,
    [companyId, desdeIso]);
  const facturas: any[] = r.rows;

  const operacionesAviso: any[] = [];
  const operacionesIdentificacion: any[] = [];
  const porCliente = new Map<string, { rfc: string; nombre: string; customer_id: string; total: number; n: number }>();

  for (const f of facturas) {
    // Acumulado por cliente (regla de 6 meses).
    const k = f.customer_id || f.rfc;
    const acc = porCliente.get(k) || { rfc: f.rfc, nombre: f.nombre, customer_id: f.customer_id, total: 0, n: 0 };
    acc.total += Number(f.total); acc.n += 1;
    porCliente.set(k, acc);

    // Clasificación por operación individual.
    if (umbralAviso != null && Number(f.total) >= umbralAviso) operacionesAviso.push(f);
    else if (umbralIdent != null && Number(f.total) >= umbralIdent) operacionesIdentificacion.push(f);
    else if (umbralIdent === 0) operacionesIdentificacion.push(f);   // identificación siempre
  }

  // Clientes que rebasan el umbral de Aviso por ACUMULACIÓN (aunque ninguna op. sola lo haya hecho).
  const clientesAcumulado = [...porCliente.values()]
    .filter((c) => umbralAviso != null && c.total >= umbralAviso)
    .map((c) => ({ ...c, total: Math.round(c.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);

  // Expedientes: qué clientes marcados ya tienen expediente completo.
  const rfcsMarcados = new Set<string>();
  for (const f of operacionesAviso) rfcsMarcados.add(f.rfc);
  for (const f of operacionesIdentificacion) rfcsMarcados.add(f.rfc);
  for (const c of clientesAcumulado) rfcsMarcados.add(c.rfc);

  let expedientePendiente: any[] = [];
  if (rfcsMarcados.size) {
    const exp = await query<any>(
      `SELECT rfc, completo FROM pld_expediente WHERE company_id = $1`, [companyId]);
    const completoPorRfc = new Map<string, boolean>(exp.rows.map((e: any) => [String(e.rfc).toUpperCase(), !!e.completo]));
    expedientePendiente = [...rfcsMarcados]
      .filter((rfc) => !completoPorRfc.get(String(rfc).toUpperCase()))
      .map((rfc) => {
        const f = facturas.find((x) => x.rfc === rfc);
        return { rfc, nombre: f?.nombre || '' };
      });
  }

  return {
    activo: true,
    fraccion: act.fraccion,
    actividad: act.label,
    nota: act.nota || null,
    periodicidad: act.periodicidad,
    uma,
    umbralIdentificacionUma: act.identificacion,
    umbralAvisoUma: act.aviso,
    umbralIdentificacion: umbralIdent,
    umbralAviso: umbralAviso,
    periodo: { desde: desdeIso, hasta: iso(new Date()) },
    proximoCorte: proximoDia17(),
    totales: {
      operacionesAviso: operacionesAviso.length,
      operacionesIdentificacion: operacionesIdentificacion.length,
      clientesAcumulado: clientesAcumulado.length,
      expedientePendiente: expedientePendiente.length,
    },
    operacionesAviso,
    operacionesIdentificacion,
    clientesAcumulado,
    expedientePendiente,
    representante: { nombre: cfg.representante_nombre, rfc: cfg.representante_rfc },
  };
}

/* ── Expediente de cliente ── */
export async function listarExpedientes(companyId: string) {
  const r = await query<any>(
    `SELECT e.id, e.rfc, e.nombre, e.tipo_persona, e.completo, e.beneficiario_controlador,
            TO_CHAR(e.actualizado_at,'YYYY-MM-DD HH24:MI') AS actualizado
       FROM pld_expediente e WHERE e.company_id = $1 ORDER BY e.nombre`, [companyId]);
  return r.rows;
}

export async function guardarExpediente(companyId: string, d: any) {
  const rfc = String(d.rfc || '').toUpperCase().trim();
  if (!rfc) throw new Error('Falta el RFC del cliente.');
  await query(
    `INSERT INTO pld_expediente (company_id, customer_id, rfc, nombre, tipo_persona, completo, beneficiario_controlador, datos, actualizado_at)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,FALSE),$7,$8,NOW())
     ON CONFLICT (company_id, rfc) DO UPDATE SET
       customer_id = COALESCE(EXCLUDED.customer_id, pld_expediente.customer_id),
       nombre = EXCLUDED.nombre,
       tipo_persona = EXCLUDED.tipo_persona,
       completo = EXCLUDED.completo,
       beneficiario_controlador = EXCLUDED.beneficiario_controlador,
       datos = EXCLUDED.datos,
       actualizado_at = NOW()`,
    [companyId, d.customer_id || null, rfc, d.nombre || null, d.tipo_persona || null,
     d.completo === true, d.beneficiario_controlador || null, d.datos ? JSON.stringify(d.datos) : null]);
  return listarExpedientes(companyId);
}
