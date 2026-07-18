/**
 * build-carta-porte-xml — genera el nodo <cartaporte31:CartaPorte> para
 * inyectar dentro de <cfdi:Complemento> al armar el CFDI.
 *
 * Referencia: catCartaPorte.xsd + Instructivo de llenado CCP 3.1.
 *
 * Diseño:
 *   · Emite string (no DOM). Mismo estilo que cfdi.service.ts.
 *   · Todas las cadenas pasan por escapeXml.
 *   · IdCCP: identificador único del complemento — 36 chars, prefijo
 *     obligatorio "CCC" seguido de UUID v4 sin guiones (~33 chars). El SAT
 *     admite exactamente 36 caracteres para este atributo.
 *   · Solo se emiten atributos con valor; los opcionales vacíos se omiten
 *     (una cadena vacía no es lo mismo que "atributo no presente").
 *   · Autotransporte es la vía única implementada aquí. Marítimo/aéreo/
 *     ferroviario quedan documentados pero no se emiten hasta que HCGM
 *     confirme el primer caso real (§4 del CartaPorteForm).
 *
 * Este builder NO valida las 110 reglas SAT — eso es Bloque 7.
 * NI firma NI timbra — eso es Bloque 8.
 */

import { randomUUID } from 'crypto';

/* ─── Tipos de entrada (espejo de lo que hidrata getByInvoiceId) ─── */

interface Row {
  transp_internac: 'Si' | 'No';
  entrada_salida_merc?: string;
  pais_origen_destino?: string;
  via_entrada_salida?: string;
  total_dist_rec: string | number;
  registro_istmo?: string;
  ubicacion_polo_origen?: string;
  ubicacion_polo_destino?: string;
  regimen_aduanero?: string;
  ubicaciones: UbicRow[];
  mercancias: MercRow[];
  autotransporte: AutoRow | null;
  figuras: FiguraRow[];
}
interface UbicRow {
  tipo_ubicacion: 'Origen' | 'Destino';
  id_ubicacion: string;
  rfc_remitente_destinatario: string;
  nombre_remitente_destinatario?: string;
  num_reg_id_trib?: string;
  residencia_fiscal?: string;
  fecha_hora_salida_llegada: string;
  tipo_estacion?: string;
  distancia_recorrida?: string | number;
  calle?: string;
  num_exterior?: string;
  num_interior?: string;
  colonia?: string;
  localidad?: string;
  referencia?: string;
  municipio?: string;
  estado: string;
  pais?: string;
  codigo_postal: string;
}
interface MercRow {
  bienes_transp: string;
  descripcion: string;
  cantidad: string | number;
  clave_unidad: string;
  unidad?: string;
  dimensiones?: string;
  material_peligroso?: string;
  cve_material_peligroso?: string;
  embalaje?: string;
  descrip_embalaje?: string;
  peso_en_kg: string | number;
  valor_mercancia?: string | number;
  moneda?: string;
  fraccion_arancelaria?: string;
}
interface AutoRow {
  perm_sct: string;
  num_permiso_sct: string;
  config_vehicular: string;
  peso_bruto_vehicular: string | number;
  placa_vm: string;
  anio_modelo_vm: number;
  asegura_resp_civil: string;
  poliza_resp_civil: string;
  asegura_med_ambiente?: string;
  poliza_med_ambiente?: string;
  asegura_carga?: string;
  poliza_carga?: string;
  prima_seguro?: string | number;
  remolques: { sub_tipo_rem: string; placa: string }[];
}
interface FiguraRow {
  tipo_figura: string;
  rfc_figura: string;
  num_licencia?: string;
  nombre_figura?: string;
  num_reg_id_trib?: string;
  residencia_fiscal_fig?: string;
  parte_transporte?: string;
  calle?: string;
  num_exterior?: string;
  colonia?: string;
  municipio?: string;
  estado?: string;
  pais?: string;
  codigo_postal?: string;
}

/* ─── Helpers ────────────────────────────────────────────────────── */

function escapeXml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Atributo XML opcional: se omite si el valor es nulo/vacío. */
function attr(name: string, v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (!s) return '';
  return ` ${name}="${escapeXml(s)}"`;
}

/** Atributo obligatorio: aparece siempre, aun vacío (para que el XSD explique el faltante). */
function attrReq(name: string, v: unknown): string {
  return ` ${name}="${escapeXml(String(v ?? '').trim())}"`;
}

function num(v: unknown, decimals = 6): string {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(decimals) : '';
}

/**
 * SAT exige ISO 8601 sin milisegundos: YYYY-MM-DDTHH:MM:SS.
 * Postgres devuelve Date objects; su toString nativo no cumple.
 */
function iso(v: unknown): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 19);
}

/**
 * IdCCP — 36 caracteres. El SAT exige exactamente el patrón:
 *   CCC + 5 hex + '-' + 4 hex + '-' + 4 hex + '-' + 4 hex + '-' + 12 hex
 * (3 + 8 + 4·(1+4) + 12 - 4 = 36). Es decir "CCC" seguido de un UUID v4
 * conservando los guiones pero recortando 3 chars del primer segmento.
 */
export function generateIdCCP(): string {
  const uuid = randomUUID(); // xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36)
  // Recortamos 3 hex del primer segmento (queda de 8→5) para hacerle lugar
  // al prefijo CCC manteniendo total de 36 chars.
  return ('CCC' + uuid.slice(3)).toUpperCase();
}

/* ─── Builder principal ──────────────────────────────────────────── */

export interface BuildOptions {
  idCCP?: string; // si se omite, se genera uno nuevo
}

export function buildCartaPorteXml(cp: Row, opts: BuildOptions = {}): string {
  const idCCP = opts.idCCP || generateIdCCP();
  const lines: string[] = [];

  lines.push(
    `<cartaporte31:CartaPorte` +
      attrReq('Version', '3.1') +
      attrReq('IdCCP', idCCP) +
      attrReq('TranspInternac', cp.transp_internac) +
      attr('EntradaSalidaMerc', cp.entrada_salida_merc) +
      attr('PaisOrigenDestino', cp.pais_origen_destino) +
      attr('ViaEntradaSalida', cp.via_entrada_salida) +
      attrReq('TotalDistRec', num(cp.total_dist_rec)) +
      attr('RegistroISTMO', cp.registro_istmo) +
      attr('UbicacionPoloOrigen', cp.ubicacion_polo_origen) +
      attr('UbicacionPoloDestino', cp.ubicacion_polo_destino) +
      `>`,
  );

  /* Ubicaciones */
  lines.push(`  <cartaporte31:Ubicaciones>`);
  for (const u of cp.ubicaciones) {
    lines.push(
      `    <cartaporte31:Ubicacion` +
        attrReq('TipoUbicacion', u.tipo_ubicacion) +
        attrReq('IDUbicacion', u.id_ubicacion) +
        attrReq('RFCRemitenteDestinatario', u.rfc_remitente_destinatario) +
        attr('NombreRemitenteDestinatario', u.nombre_remitente_destinatario) +
        attr('NumRegIdTrib', u.num_reg_id_trib) +
        attr('ResidenciaFiscal', u.residencia_fiscal) +
        attrReq('FechaHoraSalidaLlegada', iso(u.fecha_hora_salida_llegada)) +
        attr('TipoEstacion', u.tipo_estacion) +
        (u.tipo_ubicacion === 'Destino' ? attr('DistanciaRecorrida', num(u.distancia_recorrida)) : '') +
        `>`,
    );
    lines.push(
      `      <cartaporte31:Domicilio` +
        attr('Calle', u.calle) +
        attr('NumeroExterior', u.num_exterior) +
        attr('NumeroInterior', u.num_interior) +
        attr('Colonia', u.colonia) +
        attr('Localidad', u.localidad) +
        attr('Referencia', u.referencia) +
        attr('Municipio', u.municipio) +
        attrReq('Estado', u.estado) +
        attrReq('Pais', u.pais || 'MEX') +
        attrReq('CodigoPostal', u.codigo_postal) +
        `/>`,
    );
    lines.push(`    </cartaporte31:Ubicacion>`);
  }
  lines.push(`  </cartaporte31:Ubicaciones>`);

  /* Mercancias — total agregado */
  const totalMerc = cp.mercancias.length;
  const pesoBruto = cp.mercancias.reduce((a, m) => a + Number(m.peso_en_kg || 0), 0);
  lines.push(
    `  <cartaporte31:Mercancias` +
      attrReq('PesoBrutoTotal', pesoBruto.toFixed(3)) +
      attrReq('UnidadPeso', 'KGM') +
      attrReq('NumTotalMercancias', String(totalMerc)) +
      `>`,
  );
  for (const m of cp.mercancias) {
    lines.push(
      `    <cartaporte31:Mercancia` +
        attrReq('BienesTransp', m.bienes_transp) +
        attrReq('Descripcion', m.descripcion) +
        attrReq('Cantidad', num(m.cantidad, 3)) +
        attrReq('ClaveUnidad', m.clave_unidad) +
        attr('Unidad', m.unidad) +
        attr('Dimensiones', m.dimensiones) +
        attr('MaterialPeligroso', m.material_peligroso) +
        attr('CveMaterialPeligroso', m.cve_material_peligroso) +
        attr('Embalaje', m.embalaje) +
        attr('DescripEmbalaje', m.descrip_embalaje) +
        attrReq('PesoEnKg', num(m.peso_en_kg, 3)) +
        attr('ValorMercancia', m.valor_mercancia != null ? num(m.valor_mercancia, 2) : '') +
        attr('Moneda', m.moneda) +
        attr('FraccionArancelaria', m.fraccion_arancelaria) +
        `/>`,
    );
  }

  /* Autotransporte */
  if (cp.autotransporte) {
    const a = cp.autotransporte;
    lines.push(
      `    <cartaporte31:Autotransporte` +
        attrReq('PermSCT', a.perm_sct) +
        attrReq('NumPermisoSCT', a.num_permiso_sct) +
        `>`,
    );
    lines.push(
      `      <cartaporte31:IdentificacionVehicular` +
        attrReq('ConfigVehicular', a.config_vehicular) +
        attrReq('PesoBrutoVehicular', num(a.peso_bruto_vehicular, 3)) +
        attrReq('PlacaVM', a.placa_vm) +
        attrReq('AnioModeloVM', String(a.anio_modelo_vm)) +
        `/>`,
    );
    lines.push(
      `      <cartaporte31:Seguros` +
        attrReq('AseguraRespCivil', a.asegura_resp_civil) +
        attrReq('PolizaRespCivil', a.poliza_resp_civil) +
        attr('AseguraMedAmbiente', a.asegura_med_ambiente) +
        attr('PolizaMedAmbiente', a.poliza_med_ambiente) +
        attr('AseguraCarga', a.asegura_carga) +
        attr('PolizaCarga', a.poliza_carga) +
        attr('PrimaSeguro', a.prima_seguro != null ? num(a.prima_seguro, 2) : '') +
        `/>`,
    );
    if (a.remolques.length) {
      lines.push(`      <cartaporte31:Remolques>`);
      for (const r of a.remolques) {
        lines.push(
          `        <cartaporte31:Remolque` +
            attrReq('SubTipoRem', r.sub_tipo_rem) +
            attrReq('Placa', r.placa) +
            `/>`,
        );
      }
      lines.push(`      </cartaporte31:Remolques>`);
    }
    lines.push(`    </cartaporte31:Autotransporte>`);
  }

  lines.push(`  </cartaporte31:Mercancias>`);

  /* FiguraTransporte */
  lines.push(`  <cartaporte31:FiguraTransporte>`);
  for (const f of cp.figuras) {
    lines.push(
      `    <cartaporte31:TiposFigura` +
        attrReq('TipoFigura', f.tipo_figura) +
        attr('RFCFigura', f.rfc_figura) +
        attr('NumLicencia', f.num_licencia) +
        attr('NombreFigura', f.nombre_figura) +
        attr('NumRegIdTribFigura', f.num_reg_id_trib) +
        attr('ResidenciaFiscalFigura', f.residencia_fiscal_fig) +
        `>`,
    );
    if (f.parte_transporte) {
      lines.push(
        `      <cartaporte31:PartesTransporte` +
          attrReq('ParteTransporte', f.parte_transporte) +
          `/>`,
      );
    }
    // El domicilio de la figura solo se emite si viene lleno (operador
    // mexicano típico no lo necesita; propietario/arrendatario extranjero sí).
    if (f.calle || f.codigo_postal) {
      lines.push(
        `      <cartaporte31:Domicilio` +
          attr('Calle', f.calle) +
          attr('NumeroExterior', f.num_exterior) +
          attr('Colonia', f.colonia) +
          attr('Municipio', f.municipio) +
          attr('Estado', f.estado) +
          attr('Pais', f.pais) +
          attr('CodigoPostal', f.codigo_postal) +
          `/>`,
      );
    }
    lines.push(`    </cartaporte31:TiposFigura>`);
  }
  lines.push(`  </cartaporte31:FiguraTransporte>`);

  lines.push(`</cartaporte31:CartaPorte>`);

  return lines.join('\n');
}

/**
 * Devuelve los atributos que deben añadirse al nodo <cfdi:Comprobante>
 * cuando incluye un complemento Carta Porte:
 *   xmlns:cartaporte31 + schemaLocation extendido
 */
export const CARTA_PORTE_NAMESPACE = 'http://www.sat.gob.mx/CartaPorte31';
export const CARTA_PORTE_XSD =
  'http://www.sat.gob.mx/sitio_internet/cfd/CartaPorte/CartaPorte31.xsd';
