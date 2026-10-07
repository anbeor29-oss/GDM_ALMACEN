/**
 * pld-aviso — BORRADOR del Aviso (LFPIORPI) en XML.
 *
 * QUÉ ES (y qué NO)
 * La **Ley (Art. 24)** y las **Reglas** marcan el CONTENIDO del Aviso: (I) datos del
 * sujeto obligado, (II) datos del Cliente/Usuario y, en su caso, del Beneficiario
 * Controlador + su actividad u ocupación, y (III) descripción de la operación (fecha,
 * monto, moneda, instrumento monetario, origen/destino…). Esto arma un XML con ese
 * contenido, estructurado según el **esquema general de avisos del SPPLD**.
 *
 * El **XSD/formato OFICIAL y los catálogos de claves** (clave_actividad, forma de
 * operación, instrumento monetario) los publica la **UIF en el DOF por actividad**, y
 * la **clave del sujeto obligado** la asigna el **padrón**. Por eso esto es un
 * **borrador para VALIDAR/ajustar en el Portal del SAT (SPPLD)**, no un archivo
 * portal-ready. Los datos salen de NEXO: config PLD + facturas del mes + expediente.
 */
import { query } from '../../config/database';
import { getConfig, umaDiaria, actividadDe } from './pld.service';

const esc = (s: any) =>
  String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
const fecha = (s: any) => String(s || '').slice(0, 10);

/** Fracción Art.17 → clave de actividad (REFERENCIAL; confirmar contra el formato oficial del DOF). */
const CLAVE_ACTIVIDAD: Record<string, string> = {
  I: 'JYS', II: 'TAR', III: 'CHV', IV: 'PSF', V: 'INM', 'V Bis': 'INM', VI: 'MPJ', VII: 'ART',
  VIII: 'VEH', IX: 'BLI', X: 'TCV', XI: 'SPR', XII: 'FP', XIII: 'DON', XIV: 'CEX', XV: 'ARR', XVI: 'AV',
};

export interface AvisoXml { xml: string; nombre: string; operaciones: number; sinExpediente: number; }

export async function generarAvisoXml(companyId: string, anio: number, mes: number): Promise<AvisoXml> {
  const a = Number(anio), m = Number(mes);
  if (!Number.isInteger(a) || !Number.isInteger(m) || m < 1 || m > 12) throw new Error('Periodo inválido.');

  const cfg = await getConfig(companyId);
  const act = actividadDe(cfg.fraccion);
  if (!cfg.activo || !act) throw new Error('La empresa no tiene una Actividad Vulnerable activa.');

  const uma = await umaDiaria();
  const umbralAviso = act.aviso != null ? act.aviso * uma : null;   // null = no se dispara por monto (ver nota de la fracción)

  const desde = `${a}-${String(m).padStart(2, '0')}-01`;
  const hasta = new Date(a, m, 0).toISOString().slice(0, 10);

  const emp = (await query<any>('SELECT rfc, business_name FROM companies WHERE id=$1', [companyId])).rows[0] || {};

  // Operaciones (facturas timbradas vigentes) del mes que rebasan el umbral de Aviso.
  const r = await query<any>(
    `SELECT i.id, i.folio, i.serie, i.total::float AS total,
            TO_CHAR(i.date_issued,'YYYY-MM-DD') AS fecha, c.rfc, c.business_name AS nombre
       FROM invoices i JOIN customers c ON c.id = i.customer_id
      WHERE i.company_id=$1 AND i.is_stamped=TRUE AND COALESCE(i.is_active,TRUE)=TRUE
        AND UPPER(COALESCE(i.status,''))<>'CANCELLED' AND i.cfdi_type='I'
        AND i.date_issued::date BETWEEN $2 AND $3 AND i.total>0
      ORDER BY i.date_issued`, [companyId, desde, hasta]);
  const ops = r.rows.filter((f: any) => (umbralAviso == null ? true : Number(f.total) >= umbralAviso));

  const exps = (await query<any>('SELECT rfc, nombre, tipo_persona, datos FROM pld_expediente WHERE company_id=$1', [companyId])).rows;
  const expPorRfc = new Map<string, any>(exps.map((e: any) => [String(e.rfc).toUpperCase(), e]));

  const mesRep = `${a}${String(m).padStart(2, '0')}`;
  const claveAct = CLAVE_ACTIVIDAD[cfg.fraccion || ''] || cfg.fraccion || '';

  const avisos = ops.map((f: any, idx: number) => {
    const e = expPorRfc.get(String(f.rfc).toUpperCase());
    const ref = `${mesRep}-${String(idx + 1).padStart(4, '0')}`;
    return `    <aviso>
      <referencia_aviso>${esc(ref)}</referencia_aviso>
      <prioridad>1</prioridad>
      <persona_aviso>
${personaXml(f, e)}
      </persona_aviso>
      <detalle_operaciones>
        <datos_operacion>
          <fecha_operacion>${esc(fecha(f.fecha))}</fecha_operacion>
          <tipo_operacion>${esc(act.label)}</tipo_operacion>
          <descripcion>Operacion amparada por CFDI ${esc([f.serie, f.folio].filter(Boolean).join('-'))}</descripcion>
          <datos_liquidacion>
            <fecha_pago>${esc(fecha(f.fecha))}</fecha_pago>
            <instrumento_monetario><!-- del CFDI (forma de pago): completar --></instrumento_monetario>
            <moneda>MXN</moneda>
            <monto_operacion>${Number(f.total).toFixed(2)}</monto_operacion>
          </datos_liquidacion>
        </datos_operacion>
      </detalle_operaciones>
    </aviso>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- BORRADOR de Aviso LFPIORPI generado por GDM NEXO, con el CONTENIDO que marca el
     Art. 24 de la Ley y las Reglas, estructurado segun el esquema general del SPPLD.
     El XSD/formato OFICIAL y los catalogos de claves (clave_actividad, instrumento
     monetario) los publica la UIF en el DOF por actividad; la clave del sujeto obligado
     la da el PADRON. VALIDAR y ajustar en el Portal del SAT (SPPLD) antes de presentar. -->
<archivo>
  <informe>
    <mes_reportado>${mesRep}</mes_reportado>
    <sujeto_obligado>
      <clave_sujeto_obligado>${esc(cfg.padron_folio || emp.rfc || '')}</clave_sujeto_obligado>
      <rfc>${esc(emp.rfc || '')}</rfc>
      <denominacion>${esc(emp.business_name || '')}</denominacion>
      <clave_actividad>${esc(claveAct)}</clave_actividad>
    </sujeto_obligado>
${avisos.join('\n') || '    <!-- Sin operaciones que rebasen el umbral de Aviso en el periodo. -->'}
  </informe>
</archivo>`;

  return {
    xml,
    nombre: `Aviso_PLD_${(emp.rfc || 'RFC')}_${mesRep}.xml`,
    operaciones: ops.length,
    sinExpediente: ops.filter((f: any) => !expPorRfc.get(String(f.rfc).toUpperCase())).length,
  };
}

/** Bloque <persona_aviso> con los datos del expediente (física o moral + beneficiario). */
function personaXml(f: any, e: any): string {
  const d = (e?.datos) || {};
  const tipo = String(e?.tipo_persona || 'FISICA').toUpperCase();
  const dom = `          <domicilio>
            <calle>${esc(d.calle || '')}</calle>
            <colonia>${esc(d.colonia || '')}</colonia>
            <codigo_postal>${esc(d.cp || '')}</codigo_postal>
            <municipio>${esc(d.municipio || '')}</municipio>
            <estado>${esc(d.estado || '')}</estado>
            <pais>${esc(d.pais || 'Mexico')}</pais>
          </domicilio>`;
  if (tipo === 'MORAL') {
    const bens = (Array.isArray(d.beneficiarios) ? d.beneficiarios : [])
      .filter((b: any) => String(b?.nombre || '').trim())
      .map((b: any) => `          <beneficiario_controlador>
            <nombre>${esc(b.nombre || '')}</nombre>
            <rfc>${esc(b.rfc || '')}</rfc>
            <curp>${esc(b.curp || '')}</curp>
            <nacionalidad>${esc(b.nacionalidad || '')}</nacionalidad>
          </beneficiario_controlador>`).join('\n');
    return `        <persona_moral>
          <denominacion>${esc(e?.nombre || f.nombre || '')}</denominacion>
          <rfc>${esc(f.rfc || '')}</rfc>
          <fecha_constitucion>${esc(fecha(d.fechaConstitucion))}</fecha_constitucion>
          <nacionalidad>${esc(d.nacionalidad || '')}</nacionalidad>
          <giro>${esc(d.giro || '')}</giro>
${dom}${bens ? '\n' + bens : '\n          <!-- Falta capturar el Beneficiario Controlador en el expediente -->'}
        </persona_moral>`;
  }
  return `        <persona_fisica>
          <nombre>${esc(e?.nombre || f.nombre || '')}</nombre>
          <rfc>${esc(f.rfc || '')}</rfc>
          <curp>${esc(d.curp || '')}</curp>
          <fecha_nacimiento>${esc(fecha(d.fechaNacimiento))}</fecha_nacimiento>
          <nacionalidad>${esc(d.nacionalidad || '')}</nacionalidad>
          <actividad_ocupacion>${esc(d.ocupacion || '')}</actividad_ocupacion>
${dom}
        </persona_fisica>`;
}
