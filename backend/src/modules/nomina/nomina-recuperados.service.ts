/**
 * CFDI de nómina RECUPERADOS — los timbrados de periodos ANTERIORES que se
 * rescataron del respaldo a la bóveda (`cfdi_recibidos`, tipo 'N'). No son
 * recibos de NEXO (esos viven en `nomina_recibos`): son el histórico timbrado,
 * para consultarlos, descargar su XML (y con él dar de alta un trabajador por el
 * menú de alta) y —de un clic— pasar al trabajador a ACTIVO si ya existe.
 */
import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';

/** Lista los CFDI de nómina del vault con el estado del trabajador (existe/activo). */
export async function listar(companyId: string) {
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
      WHERE c.company_id = $1 AND c.tipo_comprobante = 'N'
      ORDER BY c.fecha_emision DESC NULLS LAST, c.nombre_receptor`,
    [companyId]);
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
