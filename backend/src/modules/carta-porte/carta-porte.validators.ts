/**
 * carta-porte.validators — validación estructural del payload de CP 3.1.
 *
 * Solo garantías mínimas para persistir. Las 110 reglas oficiales del SAT
 * viven en el Bloque 7 (validador pre-PAC).
 */

import { ValidationError } from '../../middleware/errorHandler';

const RFC_RE = /^([A-ZÑ&]{3,4})(\d{6})([A-Z\d]{3})$/i;
const CP_RE = /^\d{5}$/;

function req<T>(v: T | undefined | null, field: string): T {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    throw new ValidationError(`Campo requerido: ${field}`);
  }
  return v;
}

function str(v: unknown, field: string, max = 300): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new ValidationError(`${field} debe ser string`);
  if (v.length > max) throw new ValidationError(`${field} excede ${max} caracteres`);
  return v;
}

function num(v: unknown, field: string, opts: { min?: number; max?: number } = {}): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new ValidationError(`${field} debe ser número`);
  if (opts.min !== undefined && n < opts.min) throw new ValidationError(`${field} < ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new ValidationError(`${field} > ${opts.max}`);
  return n;
}

function enumOf<T extends string>(v: unknown, field: string, values: readonly T[]): T | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (!values.includes(v as T)) {
    throw new ValidationError(`${field} debe ser uno de: ${values.join(', ')}`);
  }
  return v as T;
}

export interface Ubicacion {
  tipoUbicacion: 'Origen' | 'Destino';
  idUbicacion: string;
  rfcRemitenteDestinatario: string;
  nombreRemitenteDestinatario?: string;
  numRegIdTrib?: string;
  residenciaFiscal?: string;
  numEstacion?: string;
  nombreEstacion?: string;
  navegacionTrafico?: string;
  fechaHoraSalidaLlegada: string;
  tipoEstacion?: string;
  distanciaRecorrida?: number;
  calle?: string;
  numExterior?: string;
  numInterior?: string;
  colonia?: string;
  localidad?: string;
  referencia?: string;
  municipio?: string;
  estado: string;
  pais?: string;
  codigoPostal: string;
}

export interface Mercancia {
  bienesTransp: string;
  descripcion: string;
  cantidad: number;
  claveUnidad: string;
  unidad?: string;
  dimensiones?: string;
  materialPeligroso?: 'Si' | 'No';
  cveMaterialPeligroso?: string;
  embalaje?: string;
  descripEmbalaje?: string;
  pesoEnKg: number;
  valorMercancia?: number;
  moneda?: string;
  fraccionArancelaria?: string;
  uuidComercioExt?: string;
  tipoMateria?: string;
  descripcionMateria?: string;
}

export interface Remolque { subTipoRem: string; placa: string; }

export interface Autotransporte {
  permSct: string;
  numPermisoSct: string;
  configVehicular: string;
  pesoBrutoVehicular: number;
  placaVm: string;
  anioModeloVm: number;
  aseguraRespCivil: string;
  polizaRespCivil: string;
  aseguraMedAmbiente?: string;
  polizaMedAmbiente?: string;
  aseguraCarga?: string;
  polizaCarga?: string;
  primaSeguro?: number;
  remolques?: Remolque[];
}

export interface Figura {
  tipoFigura: string;
  rfcFigura: string;
  numLicencia?: string;
  nombreFigura?: string;
  numRegIdTrib?: string;
  residenciaFiscalFig?: string;
  parteTransporte?: string;
  calle?: string;
  numExterior?: string;
  colonia?: string;
  municipio?: string;
  estado?: string;
  pais?: string;
  codigoPostal?: string;
}

export interface CartaPorteInput {
  transpInternac: 'Si' | 'No';
  entradaSalidaMerc?: 'Entrada' | 'Salida';
  paisOrigenDestino?: string;
  viaEntradaSalida?: string;
  totalDistRec: number;
  registroIstmo?: 'Si' | 'No';
  ubicacionPoloOrigen?: string;
  ubicacionPoloDestino?: string;
  regimenAduanero?: string;
  ubicaciones: Ubicacion[];
  mercancias: Mercancia[];
  autotransporte?: Autotransporte;
  figuras: Figura[];
}

function parseUbicacion(u: any, i: number): Ubicacion {
  const p = `ubicaciones[${i}]`;
  const tipo = enumOf(u?.tipoUbicacion, `${p}.tipoUbicacion`, ['Origen', 'Destino'] as const);
  const rfc = req(str(u?.rfcRemitenteDestinatario, `${p}.rfcRemitenteDestinatario`, 13), `${p}.rfcRemitenteDestinatario`);
  if (!RFC_RE.test(rfc)) throw new ValidationError(`${p}.rfcRemitenteDestinatario inválido`);
  const cp = req(str(u?.codigoPostal, `${p}.codigoPostal`, 10), `${p}.codigoPostal`);
  if (!CP_RE.test(cp)) throw new ValidationError(`${p}.codigoPostal inválido`);
  return {
    tipoUbicacion: req(tipo, `${p}.tipoUbicacion`),
    idUbicacion: req(str(u?.idUbicacion, `${p}.idUbicacion`, 10), `${p}.idUbicacion`),
    rfcRemitenteDestinatario: rfc,
    nombreRemitenteDestinatario: str(u?.nombreRemitenteDestinatario, `${p}.nombreRemitenteDestinatario`, 300),
    numRegIdTrib: str(u?.numRegIdTrib, `${p}.numRegIdTrib`, 40),
    residenciaFiscal: str(u?.residenciaFiscal, `${p}.residenciaFiscal`, 3),
    numEstacion: str(u?.numEstacion, `${p}.numEstacion`, 6),
    nombreEstacion: str(u?.nombreEstacion, `${p}.nombreEstacion`, 120),
    navegacionTrafico: str(u?.navegacionTrafico, `${p}.navegacionTrafico`, 20),
    fechaHoraSalidaLlegada: req(str(u?.fechaHoraSalidaLlegada, `${p}.fechaHoraSalidaLlegada`, 40), `${p}.fechaHoraSalidaLlegada`),
    tipoEstacion: str(u?.tipoEstacion, `${p}.tipoEstacion`, 4),
    distanciaRecorrida: num(u?.distanciaRecorrida, `${p}.distanciaRecorrida`, { min: 0 }),
    calle: str(u?.calle, `${p}.calle`, 200),
    numExterior: str(u?.numExterior, `${p}.numExterior`, 60),
    numInterior: str(u?.numInterior, `${p}.numInterior`, 60),
    colonia: str(u?.colonia, `${p}.colonia`, 4),
    localidad: str(u?.localidad, `${p}.localidad`, 4),
    referencia: str(u?.referencia, `${p}.referencia`, 500),
    municipio: str(u?.municipio, `${p}.municipio`, 4),
    estado: req(str(u?.estado, `${p}.estado`, 3), `${p}.estado`),
    pais: str(u?.pais, `${p}.pais`, 3) ?? 'MEX',
    codigoPostal: cp,
  };
}

function parseMercancia(m: any, i: number): Mercancia {
  const p = `mercancias[${i}]`;
  return {
    bienesTransp: req(str(m?.bienesTransp, `${p}.bienesTransp`, 8), `${p}.bienesTransp`),
    descripcion: req(str(m?.descripcion, `${p}.descripcion`, 4000), `${p}.descripcion`),
    cantidad: req(num(m?.cantidad, `${p}.cantidad`, { min: 0 }), `${p}.cantidad`),
    claveUnidad: req(str(m?.claveUnidad, `${p}.claveUnidad`, 3), `${p}.claveUnidad`),
    unidad: str(m?.unidad, `${p}.unidad`, 50),
    dimensiones: str(m?.dimensiones, `${p}.dimensiones`, 50),
    materialPeligroso: enumOf(m?.materialPeligroso, `${p}.materialPeligroso`, ['Si', 'No'] as const),
    cveMaterialPeligroso: str(m?.cveMaterialPeligroso, `${p}.cveMaterialPeligroso`, 4),
    embalaje: str(m?.embalaje, `${p}.embalaje`, 4),
    descripEmbalaje: str(m?.descripEmbalaje, `${p}.descripEmbalaje`, 4000),
    pesoEnKg: req(num(m?.pesoEnKg, `${p}.pesoEnKg`, { min: 0 }), `${p}.pesoEnKg`),
    valorMercancia: num(m?.valorMercancia, `${p}.valorMercancia`, { min: 0 }),
    moneda: str(m?.moneda, `${p}.moneda`, 3),
    fraccionArancelaria: str(m?.fraccionArancelaria, `${p}.fraccionArancelaria`, 10),
    uuidComercioExt: str(m?.uuidComercioExt, `${p}.uuidComercioExt`, 36),
    tipoMateria: str(m?.tipoMateria, `${p}.tipoMateria`, 4),
    descripcionMateria: str(m?.descripcionMateria, `${p}.descripcionMateria`, 4000),
  };
}

function parseAutotransporte(a: any): Autotransporte {
  const p = 'autotransporte';
  const remolques: Remolque[] = Array.isArray(a?.remolques) ? a.remolques.map((r: any, i: number) => ({
    subTipoRem: req(str(r?.subTipoRem, `${p}.remolques[${i}].subTipoRem`, 6), `${p}.remolques[${i}].subTipoRem`),
    placa: req(str(r?.placa, `${p}.remolques[${i}].placa`, 10), `${p}.remolques[${i}].placa`),
  })) : [];
  if (remolques.length > 2) throw new ValidationError('Máximo 2 remolques');
  return {
    permSct: req(str(a?.permSct, `${p}.permSct`, 6), `${p}.permSct`),
    numPermisoSct: req(str(a?.numPermisoSct, `${p}.numPermisoSct`, 50), `${p}.numPermisoSct`),
    configVehicular: req(str(a?.configVehicular, `${p}.configVehicular`, 4), `${p}.configVehicular`),
    pesoBrutoVehicular: req(num(a?.pesoBrutoVehicular, `${p}.pesoBrutoVehicular`, { min: 0 }), `${p}.pesoBrutoVehicular`),
    placaVm: req(str(a?.placaVm, `${p}.placaVm`, 10), `${p}.placaVm`),
    anioModeloVm: req(num(a?.anioModeloVm, `${p}.anioModeloVm`, { min: 1900, max: 2100 }), `${p}.anioModeloVm`),
    aseguraRespCivil: req(str(a?.aseguraRespCivil, `${p}.aseguraRespCivil`, 150), `${p}.aseguraRespCivil`),
    polizaRespCivil: req(str(a?.polizaRespCivil, `${p}.polizaRespCivil`, 50), `${p}.polizaRespCivil`),
    aseguraMedAmbiente: str(a?.aseguraMedAmbiente, `${p}.aseguraMedAmbiente`, 150),
    polizaMedAmbiente: str(a?.polizaMedAmbiente, `${p}.polizaMedAmbiente`, 50),
    aseguraCarga: str(a?.aseguraCarga, `${p}.aseguraCarga`, 150),
    polizaCarga: str(a?.polizaCarga, `${p}.polizaCarga`, 50),
    primaSeguro: num(a?.primaSeguro, `${p}.primaSeguro`, { min: 0 }),
    remolques,
  };
}

function parseFigura(f: any, i: number): Figura {
  const p = `figuras[${i}]`;
  const rfc = req(str(f?.rfcFigura, `${p}.rfcFigura`, 13), `${p}.rfcFigura`);
  if (!RFC_RE.test(rfc)) throw new ValidationError(`${p}.rfcFigura inválido`);
  return {
    tipoFigura: req(str(f?.tipoFigura, `${p}.tipoFigura`, 2), `${p}.tipoFigura`),
    rfcFigura: rfc,
    numLicencia: str(f?.numLicencia, `${p}.numLicencia`, 16),
    nombreFigura: str(f?.nombreFigura, `${p}.nombreFigura`, 300),
    numRegIdTrib: str(f?.numRegIdTrib, `${p}.numRegIdTrib`, 40),
    residenciaFiscalFig: str(f?.residenciaFiscalFig, `${p}.residenciaFiscalFig`, 3),
    parteTransporte: str(f?.parteTransporte, `${p}.parteTransporte`, 4),
    calle: str(f?.calle, `${p}.calle`, 200),
    numExterior: str(f?.numExterior, `${p}.numExterior`, 60),
    colonia: str(f?.colonia, `${p}.colonia`, 4),
    municipio: str(f?.municipio, `${p}.municipio`, 4),
    estado: str(f?.estado, `${p}.estado`, 3),
    pais: str(f?.pais, `${p}.pais`, 3),
    codigoPostal: str(f?.codigoPostal, `${p}.codigoPostal`, 10),
  };
}

export function parseCartaPorte(body: any): CartaPorteInput {
  if (!body || typeof body !== 'object') throw new ValidationError('Payload vacío');
  const transp = enumOf(body.transpInternac, 'transpInternac', ['Si', 'No'] as const);
  if (!transp) throw new ValidationError('transpInternac requerido');
  const ubi = Array.isArray(body.ubicaciones) ? body.ubicaciones.map(parseUbicacion) : [];
  const mer = Array.isArray(body.mercancias) ? body.mercancias.map(parseMercancia) : [];
  const fig = Array.isArray(body.figuras) ? body.figuras.map(parseFigura) : [];
  if (!ubi.some((u: Ubicacion) => u.tipoUbicacion === 'Origen') || !ubi.some((u: Ubicacion) => u.tipoUbicacion === 'Destino')) {
    throw new ValidationError('Se requiere al menos 1 Origen y 1 Destino');
  }
  if (mer.length === 0) throw new ValidationError('Se requiere al menos 1 mercancía');
  if (fig.length === 0) throw new ValidationError('Se requiere al menos 1 figura de transporte');

  const out: CartaPorteInput = {
    transpInternac: transp,
    entradaSalidaMerc: enumOf(body.entradaSalidaMerc, 'entradaSalidaMerc', ['Entrada', 'Salida'] as const),
    paisOrigenDestino: str(body.paisOrigenDestino, 'paisOrigenDestino', 3),
    viaEntradaSalida: str(body.viaEntradaSalida, 'viaEntradaSalida', 4),
    totalDistRec: req(num(body.totalDistRec, 'totalDistRec', { min: 0 }), 'totalDistRec'),
    registroIstmo: enumOf(body.registroIstmo, 'registroIstmo', ['Si', 'No'] as const),
    ubicacionPoloOrigen: str(body.ubicacionPoloOrigen, 'ubicacionPoloOrigen', 4),
    ubicacionPoloDestino: str(body.ubicacionPoloDestino, 'ubicacionPoloDestino', 4),
    regimenAduanero: str(body.regimenAduanero, 'regimenAduanero', 4),
    ubicaciones: ubi,
    mercancias: mer,
    autotransporte: body.autotransporte ? parseAutotransporte(body.autotransporte) : undefined,
    figuras: fig,
  };
  if (out.transpInternac === 'Si' && (!out.entradaSalidaMerc || !out.paisOrigenDestino || !out.viaEntradaSalida)) {
    throw new ValidationError('Transporte internacional requiere entradaSalidaMerc, país y vía');
  }
  return out;
}
