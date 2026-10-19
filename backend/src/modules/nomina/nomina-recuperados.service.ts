/**
 * CFDI de nómina RECUPERADOS — los timbrados de periodos ANTERIORES que se
 * rescataron del respaldo a la bóveda (`cfdi_recibidos`, tipo 'N'). No son
 * recibos de NEXO (esos viven en `nomina_recibos`): son el histórico timbrado,
 * para consultarlos, descargar su XML (y con él dar de alta un trabajador por el
 * menú de alta) y —de un clic— pasar al trabajador a ACTIVO si ya existe.
 */
import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import * as empleados from './empleados.service';
import { detect } from '../xml-super-import/xml-super-import.service';

/** Años con CFDI de nómina recuperados (para el filtro por ejercicio). */
export async function aniosDisponibles(companyId: string): Promise<number[]> {
  const r = await query<any>(
    `SELECT DISTINCT EXTRACT(YEAR FROM fecha_emision)::int AS anio
       FROM cfdi_recibidos
      WHERE company_id = $1 AND tipo_comprobante = 'N' AND fecha_emision IS NOT NULL
      ORDER BY anio DESC`,
    [companyId]);
  return r.rows.map((x: any) => x.anio);
}

/** Lista los CFDI de nómina del vault con el estado del trabajador (existe/activo).
 *  Filtra por AÑO de emisión cuando se indica (para migraciones por ejercicio). */
export async function listar(companyId: string, anio?: number) {
  const params: any[] = [companyId];
  let filtroAnio = '';
  if (anio) { params.push(anio); filtroAnio = ` AND EXTRACT(YEAR FROM c.fecha_emision) = $${params.length}`; }
  const r = await query<any>(
    `SELECT c.uuid,
            c.rfc_receptor  AS rfc,
            c.nombre_receptor AS nombre,
            c.fecha_emision,
            c.total,
            (emp.id IS NOT NULL)              AS existe,
            COALESCE(emp.activo, false)       AS activo,
            emp.num_empleado
       FROM cfdi_recibidos c
       LEFT JOIN nomina_empleados emp
         ON emp.company_id = c.company_id
        AND UPPER(emp.rfc) = UPPER(c.rfc_receptor)
        AND emp.deleted_at IS NULL
      WHERE c.company_id = $1 AND c.tipo_comprobante = 'N'${filtroAnio}
      ORDER BY c.fecha_emision DESC NULLS LAST, c.nombre_receptor`,
    params);
  return r.rows;
}

/** El XML de un CFDI de nómina recuperado (para descargarlo). */
export async function xmlDeUuid(companyId: string, uuid: string): Promise<{ xml: string; nombre: string }> {
  const r = await query<any>(
    `SELECT xml, nombre_receptor, rfc_receptor FROM cfdi_recibidos
      WHERE company_id = $1 AND uuid = $2 AND tipo_comprobante = 'N'`,
    [companyId, String(uuid).toUpperCase()]);
  const row = r.rows[0];
  if (!row || !row.xml) throw new NotFoundError('No se encontró el XML de ese CFDI de nómina.');
  const base = (row.rfc_receptor || 'nomina').replace(/[^A-Za-z0-9_-]/g, '');
  return { xml: row.xml, nombre: `nomina_${base}_${String(uuid).slice(0, 8)}.xml` };
}

/**
 * Pasa a ACTIVO al trabajador de un CFDI recuperado (por su RFC): si ya existe
 * como empleado, lo reactiva. NO crea empleados nuevos aquí —eso se hace en el
 * alta con el XML descargado, con todos sus datos—; si no existe, lo avisa.
 */
export async function activarTrabajador(companyId: string, uuid: string): Promise<{ estado: 'activado' | 'ya_activo' | 'no_existe'; rfc: string; nombre: string }> {
  const c = await query<any>(
    `SELECT rfc_receptor AS rfc, nombre_receptor AS nombre FROM cfdi_recibidos
      WHERE company_id = $1 AND uuid = $2 AND tipo_comprobante = 'N'`,
    [companyId, String(uuid).toUpperCase()]);
  const cfdi = c.rows[0];
  if (!cfdi || !cfdi.rfc) throw new ValidationError('Ese CFDI no trae RFC del trabajador.');

  const e = await query<any>(
    `SELECT id, activo FROM nomina_empleados
      WHERE company_id = $1 AND UPPER(rfc) = UPPER($2) AND deleted_at IS NULL
      ORDER BY activo DESC LIMIT 1`,
    [companyId, cfdi.rfc]);
  const emp = e.rows[0];
  if (!emp) return { estado: 'no_existe', rfc: cfdi.rfc, nombre: cfdi.nombre };
  if (emp.activo) return { estado: 'ya_activo', rfc: cfdi.rfc, nombre: cfdi.nombre };

  await query(`UPDATE nomina_empleados SET activo = true, updated_at = NOW() WHERE id = $1`, [emp.id]);
  return { estado: 'activado', rfc: cfdi.rfc, nombre: cfdi.nombre };
}

/**
 * «Completar datos»: lee el XML del CFDI de nómina recuperado y rellena los campos
 * VACÍOS del expediente del trabajador (NSS, CURP, puesto, departamento, fecha de
 * ingreso, salarios, banco, etc.) sin pisar lo ya capturado. Es el «lector de XML
 * que actualiza/completa los datos del empleado al migrarlo de otra plataforma».
 * Si el trabajador aún no existe, se avisa (se da de alta desde el lector en bloque).
 */
export async function completarDesdeUuid(
  companyId: string, uuid: string,
): Promise<{ estado: 'completado' | 'sin_cambios' | 'no_existe'; rfc: string; nombre: string; num_empleado?: string; campos: string[] }> {
  const row = (await query<any>(
    `SELECT xml, rfc_receptor, nombre_receptor FROM cfdi_recibidos
      WHERE company_id = $1 AND uuid = $2 AND tipo_comprobante = 'N'`,
    [companyId, String(uuid).toUpperCase()])).rows[0];
  if (!row || !row.xml) throw new NotFoundError('No se encontró el XML de ese CFDI de nómina.');

  const det: any = await detect(row.xml);
  if (det?.type !== 'CFDI_NOMINA' || !det.nomina) throw new ValidationError('Ese XML no trae complemento de nómina.');

  const t = det.nomina.trabajador || {};
  const rfc = String(det.receptor?.rfc || row.rfc_receptor || '').toUpperCase().trim();
  const curp = String(t.curp || '').toUpperCase().trim();

  const emp = await empleados.buscarPorIdentidad(companyId, { rfc, curp });
  if (!emp) return { estado: 'no_existe', rfc, nombre: row.nombre_receptor, campos: [] };

  // Los dos sueldos: el menor es el diario, el mayor el integrado (el factor de
  // integración nunca baja de 1); con uno solo, sirve para ambos.
  const sueldos = [t.salarioBaseCotApor, t.salarioDiarioIntegrado]
    .filter((v) => v !== undefined && v !== null && Number.isFinite(Number(v))).map(Number);
  const salDiario = sueldos.length ? Math.min(...sueldos) : undefined;
  const salInteg = sueldos.length ? Math.max(...sueldos) : undefined;

  const datos: any = {
    nss: t.numSeguridadSocial ? String(t.numSeguridadSocial).replace(/[\s-]/g, '') : undefined,
    curp: curp || undefined,
    puesto: t.puesto, departamento: t.departamento,
    fecha_ingreso: t.fechaInicioRelLaboral,
    tipo_contrato: t.tipoContrato, tipo_regimen: t.tipoRegimen, tipo_jornada: t.tipoJornada,
    periodicidad_pago: t.periodicidadPago, entidad_federativa: t.claveEntFed,
    banco_clave: t.banco,
    cuenta_clabe: t.cuentaBancaria ? String(t.cuentaBancaria).replace(/\s/g, '') : undefined,
    codigo_postal: det.receptor?.domicilioFiscal,
    salario_diario: salDiario, salario_diario_integrado: salInteg,
  };

  const campos = await empleados.completarCamposVacios(companyId, emp.id, datos);
  return {
    estado: campos.length ? 'completado' : 'sin_cambios',
    rfc, nombre: emp.nombre_completo, num_empleado: emp.num_empleado, campos,
  };
}
