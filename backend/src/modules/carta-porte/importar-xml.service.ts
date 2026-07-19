/**
 * importar-xml.service — extrae los catálogos poblables desde un CFDI+CP
 * timbrado (o borrador). Devuelve una vista previa estructurada; el usuario
 * confirma en el frontend y otra llamada aplica los inserts vía los services
 * existentes (upsert idempotente por alias).
 *
 * Robustez: el parser tolera XMLs con o sin prefijo de namespace
 * (cartaporte31:X vs sin prefijo), atributos con distinto casing, y datos
 * faltantes. Nada es fatal salvo un XML no parseable.
 *
 * NO valida contra XSD (eso lo hace el bloque 9). Aquí solo LEE.
 */
import * as xml2js from 'xml2js';

/* ─── Estructura del resultado ─── */

export interface LugarPreview {
  alias: string;
  tipoDefault: 'Origen' | 'Destino';
  rfc: string;
  nombre?: string;
  colonia?: string;
  localidad?: string;
  municipio?: string;
  estado: string;
  pais: string;
  codigoPostal: string;
  calle?: string;
  numExterior?: string;
}
export interface VehiculoPreview {
  alias: string;
  permSct: string;
  numPermisoSct: string;
  configVehicular: string;
  pesoBrutoVehicular: number;
  placaVm: string;
  anioModeloVm: number;
}
export interface AseguradoraPreview {
  alias: string;
  tipo: 'RespCivil' | 'MedAmbiente' | 'Carga';
  nombreAseguradora: string;
  numPoliza: string;
  primaSeguro?: number;
}
export interface OperadorPreview {
  alias: string;
  tipoFigura: string;
  rfc: string;
  numLicencia?: string;
  nombre: string;
  numRegIdTrib?: string;
  residenciaFiscal?: string;
}
export interface ImportPreview {
  invoice?: {
    uuid?: string;
    folio?: string;
    fecha?: string;
    total?: number;
    emisorRfc?: string;
    receptorRfc?: string;
  };
  cartaPorte: {
    idCCP?: string;
    transpInternac?: string;
    totalDistRec?: number;
  };
  lugares:      LugarPreview[];
  vehiculo?:    VehiculoPreview;
  aseguradoras: AseguradoraPreview[];
  operadores:   OperadorPreview[];
}

/* ─── Helpers ─── */

/** xml2js puede devolver la misma clave con o sin prefijo. */
function get(obj: any, ...keys: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
}
function attr(node: any, name: string): string | undefined {
  const a = node?.$;
  if (!a) return undefined;
  return a[name] ?? a[name.toLowerCase()] ?? undefined;
}
function toArr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
function num(v: any): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function truncate(s: string, max: number) { return s.length > max ? s.slice(0, max) : s; }
function aliasSlug(...parts: (string | undefined)[]): string {
  return truncate(parts.filter(Boolean).join(' - '), 60);
}

/* ─── Parser principal ─── */

export async function previewFromXml(xmlContent: string): Promise<ImportPreview> {
  const parser = new xml2js.Parser({ explicitArray: false, tagNameProcessors: [] });
  const root = await parser.parseStringPromise(xmlContent);

  const comprobante = get(root, 'cfdi:Comprobante', 'Comprobante');
  if (!comprobante) throw new Error('El archivo no contiene <cfdi:Comprobante>');

  const emisor = get(comprobante, 'cfdi:Emisor', 'Emisor');
  const receptor = get(comprobante, 'cfdi:Receptor', 'Receptor');
  const complemento = get(comprobante, 'cfdi:Complemento', 'Complemento');

  const cp = get(complemento, 'cartaporte31:CartaPorte', 'CartaPorte');
  if (!cp) throw new Error('El CFDI no incluye complemento Carta Porte 3.1');

  const tfd = get(complemento, 'tfd:TimbreFiscalDigital', 'TimbreFiscalDigital');

  const preview: ImportPreview = {
    invoice: {
      uuid:        attr(tfd, 'UUID'),
      folio:       attr(comprobante, 'Folio'),
      fecha:       attr(comprobante, 'Fecha'),
      total:       num(attr(comprobante, 'Total')),
      emisorRfc:   attr(emisor, 'Rfc'),
      receptorRfc: attr(receptor, 'Rfc'),
    },
    cartaPorte: {
      idCCP:          attr(cp, 'IdCCP'),
      transpInternac: attr(cp, 'TranspInternac'),
      totalDistRec:   num(attr(cp, 'TotalDistRec')),
    },
    lugares:      extractLugares(cp),
    vehiculo:     extractVehiculo(cp),
    aseguradoras: extractAseguradoras(cp),
    operadores:   extractOperadores(cp),
  };
  return preview;
}

function extractLugares(cp: any): LugarPreview[] {
  const ubicacionesNode = get(cp, 'cartaporte31:Ubicaciones', 'Ubicaciones');
  if (!ubicacionesNode) return [];
  const ubicaciones = toArr(get(ubicacionesNode, 'cartaporte31:Ubicacion', 'Ubicacion'));
  return ubicaciones.map((u: any) => {
    const dom = get(u, 'cartaporte31:Domicilio', 'Domicilio');
    const tipo = attr(u, 'TipoUbicacion') as 'Origen' | 'Destino';
    const rfc = String(attr(u, 'RFCRemitenteDestinatario') || '').toUpperCase();
    const nombre = attr(u, 'NombreRemitenteDestinatario');
    const cp5 = attr(dom, 'CodigoPostal') || '';
    return {
      alias: aliasSlug(nombre || rfc, `CP ${cp5}`),
      tipoDefault: tipo,
      rfc,
      nombre,
      colonia:      attr(dom, 'Colonia'),
      localidad:    attr(dom, 'Localidad'),
      municipio:    attr(dom, 'Municipio'),
      estado:       attr(dom, 'Estado') || '',
      pais:         attr(dom, 'Pais') || 'MEX',
      codigoPostal: cp5,
      calle:        attr(dom, 'Calle'),
      numExterior:  attr(dom, 'NumeroExterior'),
    };
  });
}

function extractVehiculo(cp: any): VehiculoPreview | undefined {
  const merc = get(cp, 'cartaporte31:Mercancias', 'Mercancias');
  const auto = get(merc, 'cartaporte31:Autotransporte', 'Autotransporte');
  if (!auto) return undefined;
  const idv = get(auto, 'cartaporte31:IdentificacionVehicular', 'IdentificacionVehicular');
  const placa = String(attr(idv, 'PlacaVM') || '').toUpperCase();
  const config = attr(idv, 'ConfigVehicular') || '';
  return {
    alias: aliasSlug(config, placa),
    permSct:              attr(auto, 'PermSCT') || '',
    numPermisoSct:        attr(auto, 'NumPermisoSCT') || '',
    configVehicular:      config,
    pesoBrutoVehicular:   num(attr(idv, 'PesoBrutoVehicular')) ?? 0,
    placaVm:              placa,
    anioModeloVm:         num(attr(idv, 'AnioModeloVM')) ?? new Date().getFullYear(),
  };
}

function extractAseguradoras(cp: any): AseguradoraPreview[] {
  const merc = get(cp, 'cartaporte31:Mercancias', 'Mercancias');
  const auto = get(merc, 'cartaporte31:Autotransporte', 'Autotransporte');
  const seg = get(auto, 'cartaporte31:Seguros', 'Seguros');
  if (!seg) return [];
  const out: AseguradoraPreview[] = [];
  const rc  = attr(seg, 'AseguraRespCivil');
  const rcP = attr(seg, 'PolizaRespCivil');
  const ma  = attr(seg, 'AseguraMedAmbiente');
  const maP = attr(seg, 'PolizaMedAmbiente');
  const ca  = attr(seg, 'AseguraCarga');
  const caP = attr(seg, 'PolizaCarga');
  const prima = num(attr(seg, 'PrimaSeguro'));
  if (rc && rcP) out.push({ alias: aliasSlug(rc, rcP), tipo: 'RespCivil',   nombreAseguradora: rc, numPoliza: rcP });
  if (ma && maP) out.push({ alias: aliasSlug(ma, maP), tipo: 'MedAmbiente', nombreAseguradora: ma, numPoliza: maP });
  if (ca && caP) out.push({ alias: aliasSlug(ca, caP), tipo: 'Carga',       nombreAseguradora: ca, numPoliza: caP, primaSeguro: prima });
  return out;
}

function extractOperadores(cp: any): OperadorPreview[] {
  const figNode = get(cp, 'cartaporte31:FiguraTransporte', 'FiguraTransporte');
  if (!figNode) return [];
  const tipos = toArr(get(figNode, 'cartaporte31:TiposFigura', 'TiposFigura'));
  return tipos.map((f: any) => {
    const rfc = String(attr(f, 'RFCFigura') || '').toUpperCase();
    const nombre = attr(f, 'NombreFigura') || rfc;
    return {
      alias: aliasSlug(nombre),
      tipoFigura:        attr(f, 'TipoFigura') || '01',
      rfc,
      numLicencia:       attr(f, 'NumLicencia'),
      nombre,
      numRegIdTrib:      attr(f, 'NumRegIdTribFigura'),
      residenciaFiscal:  attr(f, 'ResidenciaFiscalFigura'),
    };
  });
}
