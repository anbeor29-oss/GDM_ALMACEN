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
 *   · Las cuatro modalidades emiten su nodo: Autotransporte, TransporteMaritimo,
 *     TransporteAereo y TransporteFerroviario. Son hermanos dentro de
 *     <Mercancias> y se excluyen entre sí — carta_porte.medio_transporte manda,
 *     y el validador rechaza que venga más de uno.
 *   · La operación internacional agrega <RegimenesAduaneros> antes de
 *     <Ubicaciones> y <DocumentacionAduanera> dentro de cada <Mercancia>.
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
  regimenes_aduaneros?: string[];
  medio_transporte?: string;
  ubicaciones: UbicRow[];
  mercancias: MercRow[];
  autotransporte: AutoRow | null;
  ferroviario?: FerroRow | null;
  maritimo?: MaritimoRow | null;
  aereo?: AereoRow | null;
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
interface DocAduaneraRow {
  tipo_documento: string;
  num_pedimento?: string;
  ident_doc_aduanero?: string;
  rfc_impo?: string;
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
  tipo_materia?: string;
  descripcion_materia?: string;
  docs_aduaneros?: DocAduaneraRow[];
}
interface FerroRow {
  tipo_de_servicio: string;
  tipo_de_trafico: string;
  nombre_aseg?: string;
  num_poliza_seguro?: string;
  derechos_de_paso?: { tipo_derecho_de_paso: string; kilometraje_pagado: string | number }[];
  carros?: {
    tipo_carro: string;
    matricula_carro: string;
    guia_carro: string;
    toneladas_netas_carro: string | number;
    contenedores?: {
      tipo_contenedor: string;
      peso_contenedor_vacio: string | number;
      peso_neto_mercancia: string | number;
    }[];
  }[];
}
interface MaritimoRow {
  perm_sct?: string;
  num_permiso_sct?: string;
  nombre_aseg?: string;
  num_poliza_seguro?: string;
  tipo_embarcacion?: string;
  matricula: string;
  numero_omi: string;
  anio_embarcacion?: number;
  nombre_embarc?: string;
  nacionalidad_embarc?: string;
  unidades_arq_bruto?: string | number;
  tipo_carga?: string;
  num_cert_itc: string;
  eslora?: string | number;
  manga?: string | number;
  calado?: string | number;
  linea_naviera?: string;
  nombre_agente_naviero: string;
  num_autorizacion_naviero?: string;
  num_viaje?: string;
  num_conocimiento_embarque?: string;
  permiso_temp_navegacion?: string;
  contenedores?: {
    matricula_contenedor: string;
    tipo_contenedor: string;
    num_precinto?: string;
    id_ccp_relacionado?: string;
    placa_vm_ccp?: string;
    fecha_certificacion_ccp?: string | Date;
  }[];
}
interface AereoRow {
  perm_sct: string;
  num_permiso_sct: string;
  matricula_aeronave?: string;
  nombre_aseg?: string;
  num_poliza_seguro?: string;
  numero_guia: string;
  lugar_contrato?: string;
  codigo_transportista: string;
  rfc_embarcador?: string;
  num_reg_id_trib_embarc?: string;
  residencia_fiscal_embarc?: string;
  nombre_embarcador?: string;
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

/** Fecha sin hora (YYYY-MM-DD) — la certificación del contenedor no lleva hora. */
function fecha(v: unknown): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
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

  /* RegimenesAduaneros — va antes de Ubicaciones y solo en operación
     internacional. Se acepta la colección o el valor único heredado. */
  const regimenes = cp.regimenes_aduaneros?.length
    ? cp.regimenes_aduaneros
    : cp.regimen_aduanero
      ? [cp.regimen_aduanero]
      : [];
  if (regimenes.length) {
    lines.push(`  <cartaporte31:RegimenesAduaneros>`);
    for (const r of regimenes) {
      lines.push(`    <cartaporte31:RegimenAduaneroCCP` + attrReq('RegimenAduanero', r) + `/>`);
    }
    lines.push(`  </cartaporte31:RegimenesAduaneros>`);
  }

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
    const atributos =
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
      attr('TipoMateria', m.tipo_materia) +
      attr('DescripcionMateria', m.descripcion_materia);

    const docs = m.docs_aduaneros ?? [];
    if (!docs.length) {
      lines.push(`    <cartaporte31:Mercancia` + atributos + `/>`);
      continue;
    }
    // Con documentación aduanera la mercancía deja de ser nodo vacío: cada
    // pedimento o permiso cuelga de la mercancía a la que ampara (§6.3).
    lines.push(`    <cartaporte31:Mercancia` + atributos + `>`);
    for (const d of docs) {
      lines.push(
        `      <cartaporte31:DocumentacionAduanera` +
          attrReq('TipoDocumento', d.tipo_documento) +
          attr('NumPedimento', d.num_pedimento) +
          attr('IdentDocAduanero', d.ident_doc_aduanero) +
          attr('RFCImpo', d.rfc_impo) +
          `/>`,
      );
    }
    lines.push(`    </cartaporte31:Mercancia>`);
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

  /* TransporteMaritimo — hermano de Autotransporte, nunca simultáneo. */
  if (cp.maritimo) {
    const m = cp.maritimo;
    lines.push(
      `    <cartaporte31:TransporteMaritimo` +
        attr('PermSCT', m.perm_sct) +
        attr('NumPermisoSCT', m.num_permiso_sct) +
        attr('NombreAseg', m.nombre_aseg) +
        attr('NumPolizaSeguro', m.num_poliza_seguro) +
        attr('TipoEmbarcacion', m.tipo_embarcacion) +
        attrReq('Matricula', m.matricula) +
        attrReq('NumeroOMI', m.numero_omi) +
        attr('AnioEmbarcacion', m.anio_embarcacion) +
        attr('NombreEmbarc', m.nombre_embarc) +
        attr('NacionalidadEmbarc', m.nacionalidad_embarc) +
        attr('UnidadesDeArqBruto', m.unidades_arq_bruto != null ? num(m.unidades_arq_bruto, 2) : '') +
        attr('TipoCarga', m.tipo_carga) +
        attrReq('NumCertITC', m.num_cert_itc) +
        attr('Eslora', m.eslora != null ? num(m.eslora, 2) : '') +
        attr('Manga', m.manga != null ? num(m.manga, 2) : '') +
        attr('Calado', m.calado != null ? num(m.calado, 2) : '') +
        attr('LineaNaviera', m.linea_naviera) +
        attrReq('NombreAgenteNaviero', m.nombre_agente_naviero) +
        attr('NumAutorizacionNaviero', m.num_autorizacion_naviero) +
        attr('NumViaje', m.num_viaje) +
        attr('NumConocEmbarc', m.num_conocimiento_embarque) +
        attr('PermisoTempNavegacion', m.permiso_temp_navegacion) +
        `>`,
    );
    for (const k of m.contenedores ?? []) {
      lines.push(
        `      <cartaporte31:Contenedor` +
          attrReq('MatriculaContenedor', k.matricula_contenedor) +
          attrReq('TipoContenedor', k.tipo_contenedor) +
          attr('NumPrecinto', k.num_precinto) +
          attr('IdCCPRelacionado', k.id_ccp_relacionado) +
          attr('PlacaVMCCP', k.placa_vm_ccp) +
          attr('FechaCertificacionCCP', fecha(k.fecha_certificacion_ccp)) +
          `/>`,
      );
    }
    lines.push(`    </cartaporte31:TransporteMaritimo>`);
  }

  /* TransporteAereo — nodo hoja, sin hijos. */
  if (cp.aereo) {
    const a = cp.aereo;
    lines.push(
      `    <cartaporte31:TransporteAereo` +
        attrReq('PermSCT', a.perm_sct) +
        attrReq('NumPermisoSCT', a.num_permiso_sct) +
        attr('MatriculaAeronave', a.matricula_aeronave) +
        attr('NombreAseg', a.nombre_aseg) +
        attr('NumPolizaSeguro', a.num_poliza_seguro) +
        attrReq('NumeroGuia', a.numero_guia) +
        attr('LugarContrato', a.lugar_contrato) +
        attrReq('CodigoTransportista', a.codigo_transportista) +
        attr('RFCEmbarcador', a.rfc_embarcador) +
        attr('NumRegIdTribEmbarc', a.num_reg_id_trib_embarc) +
        attr('ResidenciaFiscalEmbarc', a.residencia_fiscal_embarc) +
        attr('NombreEmbarcador', a.nombre_embarcador) +
        `/>`,
    );
  }

  /* TransporteFerroviario — el contenedor cuelga del carro, no del nodo. */
  if (cp.ferroviario) {
    const f = cp.ferroviario;
    lines.push(
      `    <cartaporte31:TransporteFerroviario` +
        attrReq('TipoDeServicio', f.tipo_de_servicio) +
        attrReq('TipoDeTrafico', f.tipo_de_trafico) +
        attr('NombreAseg', f.nombre_aseg) +
        attr('NumPolizaSeguro', f.num_poliza_seguro) +
        `>`,
    );
    for (const d of f.derechos_de_paso ?? []) {
      lines.push(
        `      <cartaporte31:DerechosDePaso` +
          attrReq('TipoDerechoDePaso', d.tipo_derecho_de_paso) +
          attrReq('KilometrajePagado', num(d.kilometraje_pagado, 2)) +
          `/>`,
      );
    }
    for (const carro of f.carros ?? []) {
      const cont = carro.contenedores ?? [];
      lines.push(
        `      <cartaporte31:Carro` +
          attrReq('TipoCarro', carro.tipo_carro) +
          attrReq('MatriculaCarro', carro.matricula_carro) +
          attrReq('GuiaCarro', carro.guia_carro) +
          attrReq('ToneladasNetasCarro', num(carro.toneladas_netas_carro, 2)) +
          (cont.length ? `>` : `/>`),
      );
      if (cont.length) {
        for (const k of cont) {
          lines.push(
            `        <cartaporte31:Contenedor` +
              attrReq('TipoContenedor', k.tipo_contenedor) +
              attrReq('PesoContenedorVacio', num(k.peso_contenedor_vacio, 2)) +
              attrReq('PesoNetoMercancia', num(k.peso_neto_mercancia, 2)) +
              `/>`,
          );
        }
        lines.push(`      </cartaporte31:Carro>`);
      }
    }
    lines.push(`    </cartaporte31:TransporteFerroviario>`);
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
