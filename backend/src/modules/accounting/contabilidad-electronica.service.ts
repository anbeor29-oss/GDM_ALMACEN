/**
 * Contabilidad Electrónica del SAT (Anexo 24 de la RMF, v1.3).
 *
 * Genera los XML que se envían por el Buzón Tributario:
 *   · Catálogo de cuentas — las cuentas con su código agrupador del Anexo 24.
 *   · Balanza de comprobación — saldos y movimientos del mes.
 *
 * Son XML PLANOS validados contra el XSD: NO llevan sello dentro. El FIEL
 * (e.firma) se usa al ENVIARLOS por el buzón, no se incrusta en el archivo.
 * Sólo se incluyen las cuentas que tienen `codigo_agrupador` (el SAT lo exige).
 */
import { query } from '../../config/database';
import { balanzaDelPeriodo } from './periodos.service';

const esc = (s: any) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dd = (n: number) => String(n).padStart(2, '0');
const natur = (n: string) => (n === 'DEUDORA' ? 'D' : 'A');
const mnt = (n: any) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

async function empresa(companyId: string) {
  const r = await query<{ rfc: string; business_name: string }>(
    `SELECT rfc, business_name FROM companies WHERE id=$1`, [companyId]);
  if (!r.rows.length) throw new Error('Empresa no encontrada.');
  return r.rows[0];
}

/** Catálogo de cuentas (CatalogoCuentas_1_3). Mes/Anio = el periodo al que aplica. */
export async function catalogoXml(companyId: string, anio: number, mes: number): Promise<{ xml: string; nombre: string }> {
  const emp = await empresa(companyId);
  const r = await query<any>(
    `SELECT c.codigo, c.nombre, c.codigo_agrupador, c.nivel, c.naturaleza,
            p.codigo AS padre_codigo
       FROM accounting_accounts c
       LEFT JOIN accounting_accounts p ON p.id = c.parent_id
      WHERE c.company_id=$1 AND c.codigo_agrupador IS NOT NULL AND c.activa
      ORDER BY c.codigo`, [companyId]);
  if (!r.rows.length) throw new Error('No hay cuentas con código agrupador del SAT en el catálogo.');

  const ctas = r.rows.map((c) =>
    `  <catalogocuentas:Ctas CodAgrup="${esc(c.codigo_agrupador)}" NumCta="${esc(c.codigo)}" ` +
    `Desc="${esc(c.nombre)}"${c.padre_codigo ? ` SubCtaDe="${esc(c.padre_codigo)}"` : ''} ` +
    `Nivel="${c.nivel}" Natur="${natur(c.naturaleza)}"/>`).join('\n');

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<catalogocuentas:Catalogo xmlns:catalogocuentas="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/CatalogoCuentas/CatalogoCuentas_1_3.xsd" ` +
    `Version="1.3" RFC="${esc(emp.rfc)}" Mes="${dd(mes)}" Anio="${anio}">\n${ctas}\n</catalogocuentas:Catalogo>\n`;
  return { xml, nombre: `${emp.rfc}${anio}${dd(mes)}CT.xml` };
}

/** Balanza de comprobación (BalanzaComprobacion_1_3). tipoEnvio: N normal, C complementaria. */
export async function balanzaXml(
  companyId: string, anio: number, mes: number, tipoEnvio: 'N' | 'C' = 'N',
): Promise<{ xml: string; nombre: string }> {
  const emp = await empresa(companyId);
  const bal = await balanzaDelPeriodo(companyId, anio, mes);
  if (!bal || !bal.filas.length) {
    throw new Error('No hay balanza para ese periodo. Actualízala desde pólizas primero.');
  }
  const ctas = bal.filas
    .filter((f: any) => f.codigo_agrupador)
    .map((f: any) =>
      `  <BCE:Ctas NumCta="${esc(f.codigo)}" SaldoIni="${mnt(f.saldo_inicial)}" ` +
      `Debe="${mnt(f.cargos)}" Haber="${mnt(f.abonos)}" SaldoFin="${mnt(f.saldo_final)}"/>`).join('\n');

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<BCE:Balanza xmlns:BCE="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion http://www.sat.gob.mx/esquemas/ContabilidadE/1_3/BalanzaComprobacion/BalanzaComprobacion_1_3.xsd" ` +
    `Version="1.3" RFC="${esc(emp.rfc)}" Mes="${dd(mes)}" Anio="${anio}" TipoEnvio="${tipoEnvio}">\n${ctas}\n</BCE:Balanza>\n`;
  return { xml, nombre: `${emp.rfc}${anio}${dd(mes)}B${tipoEnvio}.xml` };
}

export default { catalogoXml, balanzaXml };
