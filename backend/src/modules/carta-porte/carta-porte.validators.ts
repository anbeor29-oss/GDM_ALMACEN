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

/** Documento aduanero de una mercancía concreta (§6.2 del diseño internacional). */
export interface DocAduanera {
  tipoDocumento: string;
  numPedimento?: string;
  identDocAduanero?: string;
  rfcImpo?: string;
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
  docsAduaneros?: DocAduanera[];
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
  numInterior?: string;
  colonia?: string;
  localidad?: string;
  referencia?: string;
  municipio?: string;
  estado?: string;
  pais?: string;
  codigoPostal?: string;
}

/* ─── Modalidades no carreteras ──────────────────────────────────── */

export interface DerechoDePaso { tipoDerechoDePaso: string; kilometrajePagado: number; }

export interface ContenedorFerroviario {
  tipoContenedor: string;
  pesoContenedorVacio: number;
  pesoNetoMercancia: number;
}

export interface CarroFerroviario {
  tipoCarro: string;
  matriculaCarro: string;
  guiaCarro: string;
  toneladasNetasCarro: number;
  contenedores?: ContenedorFerroviario[];
}

export interface Ferroviario {
  tipoDeServicio: string;
  tipoDeTrafico: string;
  nombreAseg?: string;
  numPolizaSeguro?: string;
  derechosDePaso?: DerechoDePaso[];
  carros?: CarroFerroviario[];
}

export interface ContenedorMaritimo {
  matriculaContenedor: string;
  tipoContenedor: string;
  numPrecinto?: string;
  idCcpRelacionado?: string;
  placaVmCcp?: string;
  fechaCertificacionCcp?: string;
}

export interface Maritimo {
  permSct?: string;
  numPermisoSct?: string;
  nombreAseg?: string;
  numPolizaSeguro?: string;
  tipoEmbarcacion?: string;
  matricula: string;
  numeroOmi: string;
  anioEmbarcacion?: number;
  nombreEmbarc?: string;
  nacionalidadEmbarc?: string;
  unidadesArqBruto?: number;
  tipoCarga?: string;
  numCertItc: string;
  eslora?: number;
  manga?: number;
  calado?: number;
  lineaNaviera?: string;
  nombreAgenteNaviero: string;
  numAutorizacionNaviero?: string;
  numViaje?: string;
  numConocimientoEmbarque?: string;
  permisoTempNavegacion?: string;
  contenedores?: ContenedorMaritimo[];
}

export interface Aereo {
  permSct: string;
  numPermisoSct: string;
  matriculaAeronave?: string;
  nombreAseg?: string;
  numPolizaSeguro?: string;
  numeroGuia: string;
  lugarContrato?: string;
  codigoTransportista: string;
  rfcEmbarcador?: string;
  numRegIdTribEmbarc?: string;
  residenciaFiscalEmbarc?: string;
  nombreEmbarcador?: string;
}

/** c_CveTransporte — la modalidad es exclusiva (§7). */
export const MEDIOS = ['01', '02', '03', '04'] as const;
export type MedioTransporte = (typeof MEDIOS)[number];
export const NOMBRE_MEDIO: Record<MedioTransporte, string> = {
  '01': 'Autotransporte',
  '02': 'Transporte marítimo',
  '03': 'Transporte aéreo',
  '04': 'Transporte ferroviario',
};

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
  regimenesAduaneros?: string[];
  medioTransporte: MedioTransporte;
  paisTransportista?: string;
  cruceFronterizo?: string;
  ubicaciones: Ubicacion[];
  mercancias: Mercancia[];
  autotransporte?: Autotransporte;
  ferroviario?: Ferroviario;
  maritimo?: Maritimo;
  aereo?: Aereo;
  figuras: Figura[];
}

function parseUbicacion(u: any, i: number): Ubicacion {
  const p = `ubicaciones[${i}]`;
  const tipo = enumOf(u?.tipoUbicacion, `${p}.tipoUbicacion`, ['Origen', 'Destino'] as const);
  const pais = str(u?.pais, `${p}.pais`, 3) ?? 'MEX';
  const esMexicano = pais === 'MEX';

  // §5.2: fuera de México no aplican ni el RFC ni el código postal de 5
  // dígitos. Un domicilio de Laredo se identifica con XEXX010101000 más el
  // Tax ID, y su ZIP puede traer guion ("78045-1234") o letras (Canadá).
  const rfc = req(str(u?.rfcRemitenteDestinatario, `${p}.rfcRemitenteDestinatario`, 13), `${p}.rfcRemitenteDestinatario`);
  if (esMexicano && !RFC_RE.test(rfc)) {
    throw new ValidationError(`${p}.rfcRemitenteDestinatario inválido`);
  }
  const cp = req(str(u?.codigoPostal, `${p}.codigoPostal`, 12), `${p}.codigoPostal`);
  if (esMexicano && !CP_RE.test(cp)) {
    throw new ValidationError(`${p}.codigoPostal inválido (5 dígitos para domicilio en México)`);
  }

  // Colonia/municipio/localidad son claves cortas del catálogo SAT solo en
  // México; fuera se captura el nombre libre del condado o distrito.
  const anchoGeo = esMexicano ? 60 : 120;

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
    colonia: str(u?.colonia, `${p}.colonia`, anchoGeo),
    localidad: str(u?.localidad, `${p}.localidad`, anchoGeo),
    referencia: str(u?.referencia, `${p}.referencia`, 500),
    municipio: str(u?.municipio, `${p}.municipio`, anchoGeo),
    estado: req(str(u?.estado, `${p}.estado`, 3), `${p}.estado`),
    pais,
    codigoPostal: cp,
  };
}

/**
 * §6.2: el SAT pide pedimento cuando el documento ES pedimento, y un
 * identificador libre cuando es cualquier otra cosa. Pedir pedimento a toda
 * operación internacional es un error de captura frecuente y caro.
 */
function parseDocAduanera(d: any, p: string): DocAduanera {
  const tipo = req(str(d?.tipoDocumento, `${p}.tipoDocumento`, 2), `${p}.tipoDocumento`);
  const numPedimento = str(d?.numPedimento, `${p}.numPedimento`, 21);
  const ident = str(d?.identDocAduanero, `${p}.identDocAduanero`, 36);

  if (tipo === '01') {
    if (!numPedimento) throw new ValidationError(`${p}.numPedimento requerido cuando el documento es Pedimento`);
    if (ident) throw new ValidationError(`${p}: un pedimento no lleva identDocAduanero`);
  } else {
    if (!ident) throw new ValidationError(`${p}.identDocAduanero requerido cuando el documento no es Pedimento`);
    if (numPedimento) throw new ValidationError(`${p}: solo el tipo Pedimento lleva numPedimento`);
  }

  const rfcImpo = str(d?.rfcImpo, `${p}.rfcImpo`, 13);
  if (rfcImpo && !RFC_RE.test(rfcImpo)) throw new ValidationError(`${p}.rfcImpo inválido`);

  return { tipoDocumento: tipo, numPedimento, identDocAduanero: ident, rfcImpo };
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
    docsAduaneros: Array.isArray(m?.docsAduaneros)
      ? m.docsAduaneros.map((d: any, j: number) => parseDocAduanera(d, `${p}.docsAduaneros[${j}]`))
      : [],
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
  const pais = str(f?.pais, `${p}.pais`, 3);
  const esExtranjera = !!pais && pais !== 'MEX';

  const rfc = req(str(f?.rfcFigura, `${p}.rfcFigura`, 13), `${p}.rfcFigura`);
  if (!esExtranjera && !RFC_RE.test(rfc)) throw new ValidationError(`${p}.rfcFigura inválido`);

  const numRegIdTrib = str(f?.numRegIdTrib, `${p}.numRegIdTrib`, 40);
  const residencia = str(f?.residenciaFiscalFig, `${p}.residenciaFiscalFig`, 3);
  // §12: a un operador de EUA no se le puede exigir RFC mexicano; se le pide
  // su residencia fiscal y su Tax ID.
  if (esExtranjera && (!numRegIdTrib || !residencia)) {
    throw new ValidationError(
      `${p}: una figura extranjera requiere residenciaFiscalFig y numRegIdTrib`,
    );
  }

  return {
    tipoFigura: req(str(f?.tipoFigura, `${p}.tipoFigura`, 2), `${p}.tipoFigura`),
    rfcFigura: rfc,
    numLicencia: str(f?.numLicencia, `${p}.numLicencia`, 16),
    nombreFigura: str(f?.nombreFigura, `${p}.nombreFigura`, 300),
    numRegIdTrib,
    residenciaFiscalFig: residencia,
    parteTransporte: str(f?.parteTransporte, `${p}.parteTransporte`, 4),
    calle: str(f?.calle, `${p}.calle`, 200),
    numExterior: str(f?.numExterior, `${p}.numExterior`, 60),
    numInterior: str(f?.numInterior, `${p}.numInterior`, 60),
    colonia: str(f?.colonia, `${p}.colonia`, 60),
    localidad: str(f?.localidad, `${p}.localidad`, 60),
    referencia: str(f?.referencia, `${p}.referencia`, 500),
    municipio: str(f?.municipio, `${p}.municipio`, 60),
    estado: str(f?.estado, `${p}.estado`, 3),
    pais,
    codigoPostal: str(f?.codigoPostal, `${p}.codigoPostal`, 12),
  };
}

function parseFerroviario(x: any): Ferroviario {
  const p = 'ferroviario';
  const derechosDePaso: DerechoDePaso[] = Array.isArray(x?.derechosDePaso)
    ? x.derechosDePaso.map((d: any, i: number) => ({
        tipoDerechoDePaso: req(str(d?.tipoDerechoDePaso, `${p}.derechosDePaso[${i}].tipoDerechoDePaso`, 6), `${p}.derechosDePaso[${i}].tipoDerechoDePaso`),
        kilometrajePagado: req(num(d?.kilometrajePagado, `${p}.derechosDePaso[${i}].kilometrajePagado`, { min: 0 }), `${p}.derechosDePaso[${i}].kilometrajePagado`),
      }))
    : [];

  const carros: CarroFerroviario[] = Array.isArray(x?.carros)
    ? x.carros.map((c: any, i: number) => {
        const cp = `${p}.carros[${i}]`;
        return {
          tipoCarro: req(str(c?.tipoCarro, `${cp}.tipoCarro`, 4), `${cp}.tipoCarro`),
          matriculaCarro: req(str(c?.matriculaCarro, `${cp}.matriculaCarro`, 10), `${cp}.matriculaCarro`),
          guiaCarro: req(str(c?.guiaCarro, `${cp}.guiaCarro`, 36), `${cp}.guiaCarro`),
          toneladasNetasCarro: req(num(c?.toneladasNetasCarro, `${cp}.toneladasNetasCarro`, { min: 0 }), `${cp}.toneladasNetasCarro`),
          contenedores: Array.isArray(c?.contenedores)
            ? c.contenedores.map((k: any, j: number) => ({
                tipoContenedor: req(str(k?.tipoContenedor, `${cp}.contenedores[${j}].tipoContenedor`, 4), `${cp}.contenedores[${j}].tipoContenedor`),
                pesoContenedorVacio: req(num(k?.pesoContenedorVacio, `${cp}.contenedores[${j}].pesoContenedorVacio`, { min: 0 }), `${cp}.contenedores[${j}].pesoContenedorVacio`),
                pesoNetoMercancia: req(num(k?.pesoNetoMercancia, `${cp}.contenedores[${j}].pesoNetoMercancia`, { min: 0 }), `${cp}.contenedores[${j}].pesoNetoMercancia`),
              }))
            : [],
        };
      })
    : [];

  // Que traiga al menos un carro lo exige el validador pre-PAC; aquí se deja
  // guardar el borrador con la cabecera ferroviaria y los carros pendientes.

  return {
    tipoDeServicio: req(str(x?.tipoDeServicio, `${p}.tipoDeServicio`, 4), `${p}.tipoDeServicio`),
    tipoDeTrafico: req(str(x?.tipoDeTrafico, `${p}.tipoDeTrafico`, 4), `${p}.tipoDeTrafico`),
    nombreAseg: str(x?.nombreAseg, `${p}.nombreAseg`, 150),
    numPolizaSeguro: str(x?.numPolizaSeguro, `${p}.numPolizaSeguro`, 30),
    derechosDePaso,
    carros,
  };
}

function parseMaritimo(x: any): Maritimo {
  const p = 'maritimo';
  const omi = req(str(x?.numeroOmi, `${p}.numeroOmi`, 10), `${p}.numeroOmi`);
  // El número OMI son 7 dígitos; se acepta con o sin el prefijo "IMO".
  if (!/^(IMO)?\d{7}$/i.test(omi)) {
    throw new ValidationError(`${p}.numeroOmi debe ser 7 dígitos, con o sin prefijo IMO (ej. IMO1234567)`);
  }

  const contenedores: ContenedorMaritimo[] = Array.isArray(x?.contenedores)
    ? x.contenedores.map((c: any, i: number) => {
        const cp = `${p}.contenedores[${i}]`;
        return {
          matriculaContenedor: req(str(c?.matriculaContenedor, `${cp}.matriculaContenedor`, 10), `${cp}.matriculaContenedor`),
          tipoContenedor: req(str(c?.tipoContenedor, `${cp}.tipoContenedor`, 6), `${cp}.tipoContenedor`),
          numPrecinto: str(c?.numPrecinto, `${cp}.numPrecinto`, 20),
          idCcpRelacionado: str(c?.idCcpRelacionado, `${cp}.idCcpRelacionado`, 36),
          placaVmCcp: str(c?.placaVmCcp, `${cp}.placaVmCcp`, 7),
          fechaCertificacionCcp: str(c?.fechaCertificacionCcp, `${cp}.fechaCertificacionCcp`, 10),
        };
      })
    : [];

  return {
    permSct: str(x?.permSct, `${p}.permSct`, 6),
    numPermisoSct: str(x?.numPermisoSct, `${p}.numPermisoSct`, 50),
    nombreAseg: str(x?.nombreAseg, `${p}.nombreAseg`, 150),
    numPolizaSeguro: str(x?.numPolizaSeguro, `${p}.numPolizaSeguro`, 30),
    tipoEmbarcacion: str(x?.tipoEmbarcacion, `${p}.tipoEmbarcacion`, 4),
    matricula: req(str(x?.matricula, `${p}.matricula`, 10), `${p}.matricula`),
    numeroOmi: omi,
    anioEmbarcacion: num(x?.anioEmbarcacion, `${p}.anioEmbarcacion`, { min: 1900, max: 2100 }),
    nombreEmbarc: str(x?.nombreEmbarc, `${p}.nombreEmbarc`, 50),
    nacionalidadEmbarc: str(x?.nacionalidadEmbarc, `${p}.nacionalidadEmbarc`, 3),
    unidadesArqBruto: num(x?.unidadesArqBruto, `${p}.unidadesArqBruto`, { min: 0 }),
    tipoCarga: str(x?.tipoCarga, `${p}.tipoCarga`, 4),
    numCertItc: req(str(x?.numCertItc, `${p}.numCertItc`, 20), `${p}.numCertItc`),
    eslora: num(x?.eslora, `${p}.eslora`, { min: 0 }),
    manga: num(x?.manga, `${p}.manga`, { min: 0 }),
    calado: num(x?.calado, `${p}.calado`, { min: 0 }),
    lineaNaviera: str(x?.lineaNaviera, `${p}.lineaNaviera`, 100),
    nombreAgenteNaviero: req(str(x?.nombreAgenteNaviero, `${p}.nombreAgenteNaviero`, 300), `${p}.nombreAgenteNaviero`),
    numAutorizacionNaviero: str(x?.numAutorizacionNaviero, `${p}.numAutorizacionNaviero`, 10),
    numViaje: str(x?.numViaje, `${p}.numViaje`, 10),
    numConocimientoEmbarque: str(x?.numConocimientoEmbarque, `${p}.numConocimientoEmbarque`, 20),
    permisoTempNavegacion: str(x?.permisoTempNavegacion, `${p}.permisoTempNavegacion`, 10),
    contenedores,
  };
}

function parseAereo(x: any): Aereo {
  const p = 'aereo';
  const embarcadorExtranjero =
    !!x?.residenciaFiscalEmbarc && x.residenciaFiscalEmbarc !== 'MEX';
  const rfcEmb = str(x?.rfcEmbarcador, `${p}.rfcEmbarcador`, 13);
  if (rfcEmb && !embarcadorExtranjero && !RFC_RE.test(rfcEmb)) {
    throw new ValidationError(`${p}.rfcEmbarcador inválido`);
  }
  return {
    permSct: req(str(x?.permSct, `${p}.permSct`, 6), `${p}.permSct`),
    numPermisoSct: req(str(x?.numPermisoSct, `${p}.numPermisoSct`, 50), `${p}.numPermisoSct`),
    matriculaAeronave: str(x?.matriculaAeronave, `${p}.matriculaAeronave`, 10),
    nombreAseg: str(x?.nombreAseg, `${p}.nombreAseg`, 150),
    numPolizaSeguro: str(x?.numPolizaSeguro, `${p}.numPolizaSeguro`, 30),
    numeroGuia: req(str(x?.numeroGuia, `${p}.numeroGuia`, 23), `${p}.numeroGuia`),
    lugarContrato: str(x?.lugarContrato, `${p}.lugarContrato`, 150),
    codigoTransportista: req(str(x?.codigoTransportista, `${p}.codigoTransportista`, 6), `${p}.codigoTransportista`),
    rfcEmbarcador: rfcEmb,
    numRegIdTribEmbarc: str(x?.numRegIdTribEmbarc, `${p}.numRegIdTribEmbarc`, 40),
    residenciaFiscalEmbarc: str(x?.residenciaFiscalEmbarc, `${p}.residenciaFiscalEmbarc`, 3),
    nombreEmbarcador: str(x?.nombreEmbarcador, `${p}.nombreEmbarcador`, 300),
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

  // §7: la modalidad es exclusiva. Si no viene, es autotransporte — que es
  // lo que se venía capturando antes de existir el selector.
  const medio = (enumOf(body.medioTransporte, 'medioTransporte', MEDIOS) ?? '01') as MedioTransporte;

  const modales = {
    '01': body.autotransporte,
    '02': body.maritimo,
    '03': body.aereo,
    '04': body.ferroviario,
  } as const;
  const sobrantes = (Object.keys(modales) as MedioTransporte[])
    .filter((k) => k !== medio && modales[k]);
  if (sobrantes.length) {
    throw new ValidationError(
      `El medio de transporte es ${NOMBRE_MEDIO[medio]}; sobra el bloque de ` +
        sobrantes.map((k) => NOMBRE_MEDIO[k]).join(' y ') +
        '. Una carta porte lleva un solo medio.',
    );
  }
  // Que falte el bloque modal NO se bloquea aquí: este validador solo cuida
  // que el borrador se pueda guardar, y el usuario captura por partes. La
  // exigencia de que exista vive en el validador pre-PAC, que corre antes de
  // timbrar (ver validate-carta-porte.ts, capa modal).

  // Régimen aduanero como colección (§4.5), aceptando el campo viejo de un
  // solo valor para no romper las cartas porte ya capturadas.
  const regimenes: string[] = Array.isArray(body.regimenesAduaneros)
    ? body.regimenesAduaneros
        .map((r: any, i: number) => req(str(r, `regimenesAduaneros[${i}]`, 4), `regimenesAduaneros[${i}]`))
    : [];
  const regimenUnico = str(body.regimenAduanero, 'regimenAduanero', 4);
  if (regimenUnico && !regimenes.includes(regimenUnico)) regimenes.push(regimenUnico);
  if (new Set(regimenes).size !== regimenes.length) {
    throw new ValidationError('Hay un régimen aduanero repetido');
  }

  const out: CartaPorteInput = {
    transpInternac: transp,
    entradaSalidaMerc: enumOf(body.entradaSalidaMerc, 'entradaSalidaMerc', ['Entrada', 'Salida'] as const),
    paisOrigenDestino: str(body.paisOrigenDestino, 'paisOrigenDestino', 3),
    viaEntradaSalida: str(body.viaEntradaSalida, 'viaEntradaSalida', 4),
    totalDistRec: req(num(body.totalDistRec, 'totalDistRec', { min: 0 }), 'totalDistRec'),
    registroIstmo: enumOf(body.registroIstmo, 'registroIstmo', ['Si', 'No'] as const),
    ubicacionPoloOrigen: str(body.ubicacionPoloOrigen, 'ubicacionPoloOrigen', 4),
    ubicacionPoloDestino: str(body.ubicacionPoloDestino, 'ubicacionPoloDestino', 4),
    regimenAduanero: regimenes[0],
    regimenesAduaneros: regimenes,
    medioTransporte: medio,
    paisTransportista: str(body.paisTransportista, 'paisTransportista', 3),
    cruceFronterizo: str(body.cruceFronterizo, 'cruceFronterizo', 10),
    ubicaciones: ubi,
    mercancias: mer,
    autotransporte: medio === '01' && body.autotransporte ? parseAutotransporte(body.autotransporte) : undefined,
    maritimo:       medio === '02' && body.maritimo       ? parseMaritimo(body.maritimo)             : undefined,
    aereo:          medio === '03' && body.aereo          ? parseAereo(body.aereo)                   : undefined,
    ferroviario:    medio === '04' && body.ferroviario    ? parseFerroviario(body.ferroviario)       : undefined,
    figuras: fig,
  };

  if (out.transpInternac === 'Si') {
    if (!out.entradaSalidaMerc || !out.paisOrigenDestino || !out.viaEntradaSalida) {
      throw new ValidationError('Transporte internacional requiere entradaSalidaMerc, país y vía');
    }
    if (!regimenes.length) {
      throw new ValidationError('Transporte internacional requiere al menos un régimen aduanero');
    }
    if (out.paisOrigenDestino === 'MEX') {
      throw new ValidationError(
        'PaisOrigenDestino es el país extranjero de la operación, no México',
      );
    }
    // §4.4: la vía declarada y el bloque modal capturado tienen que ser el
    // mismo transporte, o el PAC rechaza el comprobante.
    if (out.viaEntradaSalida !== medio) {
      throw new ValidationError(
        `La vía de entrada/salida (${NOMBRE_MEDIO[out.viaEntradaSalida as MedioTransporte] ?? out.viaEntradaSalida}) ` +
          `no coincide con el medio capturado (${NOMBRE_MEDIO[medio]})`,
      );
    }
  }

  return out;
}
