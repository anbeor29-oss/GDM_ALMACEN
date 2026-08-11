/**
 * soap.ts — las cuatro operaciones del servicio de descarga masiva del SAT.
 *
 *   autenticar()  → token que vale 5 minutos
 *   solicitar()   → pide un rango y devuelve el id de solicitud
 *   verificar()   → ¿ya está? y si sí, los ids de paquete
 *   descargar()   → el ZIP en base64
 *
 * NO SE USA UNA LIBRERÍA DE SOAP, Y ES A PROPÓSITO
 * Los cuatro sobres son plantillas fijas. Lo difícil no es el SOAP sino la
 * FIRMA: el SAT valida un XML-DSig con canonicalización exclusiva, y las
 * bibliotecas genéricas re-serializan el documento —reordenan atributos, mueven
 * espacios— y la firma deja de cuadrar por un carácter. Construyendo la cadena
 * a mano, lo que se firma es exactamente lo que viaja.
 *
 * LOS ENDPOINTS SON CONFIGURABLES, Y HAY QUE VERIFICARLOS
 * §24 del documento lo pide expresamente: las URL de los ejemplos del SAT
 * cambian. Las de abajo son las publicadas para el servicio de Consulta y
 * Recuperación de Comprobantes, pero antes de la primera corrida real conviene
 * cotejarlas con la documentación vigente y, si cambiaron, moverlas por
 * variable de entorno sin tocar código.
 *
 * QUÉ SE REGISTRA Y QUÉ NO
 * Se registra el código y el mensaje del SAT —que es lo que hace falta para
 * diagnosticar—. Nunca el token completo, nunca la llave, nunca el XML íntegro.
 */

import axios from 'axios';
import * as crypto from 'crypto';
import logger from '../../middleware/logger';
import { firmarSha1 } from './efirma';

const ENDPOINTS = {
  autenticacion: process.env.SAT_URL_AUTENTICACION ||
    'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/Autenticacion/Autenticacion.svc',
  solicitud: process.env.SAT_URL_SOLICITUD ||
    'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc',
  verificacion: process.env.SAT_URL_VERIFICACION ||
    'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/VerificaSolicitudDescargaService.svc',
  descarga: process.env.SAT_URL_DESCARGA ||
    'https://cfdidescargamasiva.clouda.sat.gob.mx/DescargaMasivaService.svc',
};

export interface Credencial {
  cer: Buffer;
  key: Buffer;
  password: string;
  rfc: string;
}

export interface RespuestaSat {
  codigo: string;
  mensaje: string;
  /** El XML completo, para guardar en la partición cuando algo salga raro. */
  crudo?: string;
}

/** Lee un atributo del XML de respuesta sin analizar todo el documento. */
function atributo(xml: string, nombre: string): string {
  const m = new RegExp(`${nombre}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return m ? m[1] : '';
}

function etiqueta(xml: string, nombre: string): string {
  const m = new RegExp(`<(?:\\w+:)?${nombre}[^>]*>([^<]*)</(?:\\w+:)?${nombre}>`, 'i').exec(xml);
  return m ? m[1].trim() : '';
}

/** Todos los valores de una etiqueta repetida (los ids de paquete). */
function etiquetas(xml: string, nombre: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${nombre}[^>]*>([^<]*)</(?:\\w+:)?${nombre}>`, 'gi');
  const out: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) if (m[1].trim()) out.push(m[1].trim());
  return out;
}

function b64(buf: Buffer): string {
  return buf.toString('base64');
}

/** Digest SHA-1 en base64, que es lo que lleva el DigestValue del XML-DSig. */
function digestSha1(texto: string): string {
  return crypto.createHash('sha1').update(texto, 'utf8').digest('base64');
}

/**
 * Arma el bloque `<Signature>` de una referencia.
 *
 * El SignedInfo se construye ya canonicalizado —sin saltos, sin espacios entre
 * etiquetas, con los atributos en el orden en que el SAT los espera— y se firma
 * TAL CUAL esa cadena. Cualquier reformateo posterior invalidaría la firma.
 */
function bloqueFirma(
  uriReferencia: string,
  digest: string,
  cred: Credencial,
  keyInfo: string
): string {
  const signedInfo =
    '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">' +
    '<CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></CanonicalizationMethod>' +
    '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>' +
    `<Reference URI="${uriReferencia}">` +
    '<Transforms>' +
    '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>' +
    '</Transforms>' +
    '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod>' +
    `<DigestValue>${digest}</DigestValue>` +
    '</Reference></SignedInfo>';

  const firma = b64(firmarSha1(signedInfo, cred.key, cred.password));

  return '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">' +
    signedInfo +
    `<SignatureValue>${firma}</SignatureValue>` +
    keyInfo +
    '</Signature>';
}

/* ─────────────────────────  1 · AUTENTICACIÓN  ───────────────────────── */

export interface Token {
  valor: string;
  expira: Date;
}

/**
 * Pide el token. Vale cinco minutos y se reutiliza mientras dure (§8): pedir
 * uno por operación multiplicaría las llamadas sin ganar nada.
 */
export async function autenticar(cred: Credencial): Promise<Token> {
  const creado = new Date();
  const expira = new Date(creado.getTime() + 5 * 60_000);
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '.000Z');

  const timestamp =
    '<u:Timestamp xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" u:Id="_0">' +
    `<u:Created>${iso(creado)}</u:Created>` +
    `<u:Expires>${iso(expira)}</u:Expires>` +
    '</u:Timestamp>';

  const keyInfo =
    '<KeyInfo>' +
    '<o:SecurityTokenReference xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">' +
    '<o:Reference URI="#uuid-token" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"></o:Reference>' +
    '</o:SecurityTokenReference>' +
    '</KeyInfo>';

  const sobre =
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">' +
    '<s:Header>' +
    '<o:Security xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" s:mustUnderstand="1">' +
    timestamp +
    '<o:BinarySecurityToken u:Id="uuid-token" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3" EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">' +
    b64(cred.cer) +
    '</o:BinarySecurityToken>' +
    bloqueFirma('#_0', digestSha1(timestamp), cred, keyInfo) +
    '</o:Security></s:Header>' +
    '<s:Body><Autentica xmlns="http://DescargaMasivaTerceros.gob.mx"></Autentica></s:Body>' +
    '</s:Envelope>';

  const xml = await enviar(ENDPOINTS.autenticacion,
    'http://DescargaMasivaTerceros.gob.mx/IAutenticacion/Autentica', sobre);

  const valor = etiqueta(xml, 'AutenticaResult');
  if (!valor) {
    throw new Error(`El SAT no devolvió token de autenticación: ${resumen(xml)}`);
  }
  logger.info('[sat-descarga] autenticado, token vigente 5 min');
  /* Se descuenta medio minuto al vencimiento para no usar un token que expire
   * justo en el viaje de ida. */
  return { valor, expira: new Date(expira.getTime() - 30_000) };
}

/* ─────────────────────────  2 · SOLICITUD  ───────────────────────── */

export interface DatosSolicitud {
  desde: Date;
  hasta: Date;
  direccion: 'recibidos' | 'emitidos';
  tipo: 'CFDI' | 'Metadata';
  rfcEmisor?: string;
  rfcReceptor?: string;
  tipoComprobante?: string;
  estadoComprobante?: string;
}

export async function solicitar(
  cred: Credencial, token: Token, d: DatosSolicitud
): Promise<RespuestaSat & { idSolicitud?: string }> {
  const iso = (x: Date) => x.toISOString().slice(0, 19);
  const emitidos = d.direccion === 'emitidos';

  /* El orden de los atributos NO es decorativo: la cadena que se firma es esta
   * misma, y el SAT compara el digest contra lo que recibe. */
  const attrs = [
    `FechaInicial="${iso(d.desde)}"`,
    `FechaFinal="${iso(d.hasta)}"`,
    d.tipoComprobante ? `TipoComprobante="${d.tipoComprobante}"` : '',
    d.estadoComprobante ? `EstadoComprobante="${d.estadoComprobante}"` : '',
    emitidos ? `RfcEmisor="${cred.rfc}"` : (d.rfcEmisor ? `RfcEmisor="${d.rfcEmisor}"` : ''),
    `RfcSolicitante="${cred.rfc}"`,
    `TipoSolicitud="${d.tipo}"`,
    !emitidos ? `RfcReceptor="${d.rfcReceptor || cred.rfc}"` : '',
  ].filter(Boolean).join(' ');

  const operacion = emitidos ? 'SolicitaDescargaEmitidos' : 'SolicitaDescargaRecibidos';
  const cuerpo =
    `<des:solicitud ${attrs}></des:solicitud>`;
  const sinFirma =
    `<des:${operacion} xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx">${cuerpo}</des:${operacion}>`;

  const keyInfo = keyInfoX509(cred);
  const firma = bloqueFirma('', digestSha1(sinFirma), cred, keyInfo);
  const sobre =
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx" xmlns:xd="http://www.w3.org/2000/09/xmldsig#">' +
    '<s:Header/><s:Body>' +
    `<des:${operacion}>${cuerpo}${firma}</des:${operacion}>` +
    '</s:Body></s:Envelope>';

  const xml = await enviar(
    ENDPOINTS.solicitud,
    `http://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService/${operacion}`,
    sobre, token
  );

  return {
    codigo: atributo(xml, 'CodEstatus') || '',
    mensaje: atributo(xml, 'Mensaje') || '',
    idSolicitud: atributo(xml, 'IdSolicitud') || undefined,
    crudo: xml,
  };
}

/* ─────────────────────────  3 · VERIFICACIÓN  ───────────────────────── */

export interface Verificacion extends RespuestaSat {
  estadoSolicitud: string;
  codigoSolicitud: string;
  numeroCfdis: number;
  paquetes: string[];
}

/** Estados oficiales de una solicitud (§6). */
export const ESTADO_SOLICITUD: Record<string, string> = {
  '1': 'ACEPTADA', '2': 'EN_PROCESO', '3': 'EN_PROCESO',
  '4': 'TERMINADA', '5': 'ERROR', '6': 'RECHAZADA', '7': 'VENCIDA',
};

export async function verificar(
  cred: Credencial, token: Token, idSolicitud: string
): Promise<Verificacion> {
  const cuerpo =
    `<des:solicitud IdSolicitud="${idSolicitud}" RfcSolicitante="${cred.rfc}"></des:solicitud>`;
  const sinFirma =
    `<des:VerificaSolicitudDescarga xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx">${cuerpo}</des:VerificaSolicitudDescarga>`;

  const firma = bloqueFirma('', digestSha1(sinFirma), cred, keyInfoX509(cred));
  const sobre =
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx" xmlns:xd="http://www.w3.org/2000/09/xmldsig#">' +
    '<s:Header/><s:Body>' +
    `<des:VerificaSolicitudDescarga>${cuerpo}${firma}</des:VerificaSolicitudDescarga>` +
    '</s:Body></s:Envelope>';

  const xml = await enviar(
    ENDPOINTS.verificacion,
    'http://DescargaMasivaTerceros.sat.gob.mx/IVerificaSolicitudDescargaService/VerificaSolicitudDescarga',
    sobre, token
  );

  const estado = atributo(xml, 'EstadoSolicitud');
  return {
    codigo: atributo(xml, 'CodEstatus') || '',
    mensaje: atributo(xml, 'Mensaje') || '',
    estadoSolicitud: ESTADO_SOLICITUD[estado] || `DESCONOCIDO(${estado})`,
    codigoSolicitud: atributo(xml, 'CodigoEstadoSolicitud') || '',
    numeroCfdis: Number(atributo(xml, 'NumeroCFDIs') || 0),
    paquetes: etiquetas(xml, 'IdsPaquetes'),
    crudo: xml,
  };
}

/* ─────────────────────────  4 · DESCARGA  ───────────────────────── */

export async function descargar(
  cred: Credencial, token: Token, idPaquete: string
): Promise<RespuestaSat & { zip?: Buffer }> {
  const cuerpo =
    `<des:peticionDescarga IdPaquete="${idPaquete}" RfcSolicitante="${cred.rfc}"></des:peticionDescarga>`;
  const sinFirma =
    `<des:PeticionDescargaMasivaTercerosEntrada xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx">${cuerpo}</des:PeticionDescargaMasivaTercerosEntrada>`;

  const firma = bloqueFirma('', digestSha1(sinFirma), cred, keyInfoX509(cred));
  const sobre =
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx" xmlns:xd="http://www.w3.org/2000/09/xmldsig#">' +
    '<s:Header/><s:Body>' +
    `<des:PeticionDescargaMasivaTercerosEntrada>${cuerpo}${firma}</des:PeticionDescargaMasivaTercerosEntrada>` +
    '</s:Body></s:Envelope>';

  const xml = await enviar(
    ENDPOINTS.descarga,
    'http://DescargaMasivaTerceros.sat.gob.mx/IDescargaMasivaTercerosService/Descargar',
    sobre, token
  );

  const paquete = etiqueta(xml, 'Paquete');
  return {
    codigo: atributo(xml, 'CodEstatus') || '',
    mensaje: atributo(xml, 'Mensaje') || '',
    zip: paquete ? Buffer.from(paquete, 'base64') : undefined,
  };
}

/* ─────────────────────────  plomería  ───────────────────────── */

function keyInfoX509(cred: Credencial): string {
  const certificado = new crypto.X509Certificate(cred.cer);
  const serie = Buffer.from(certificado.serialNumber, 'hex').toString('ascii');
  return '<KeyInfo>' +
    '<X509Data>' +
    `<X509IssuerSerial><X509IssuerName>${escapar(certificado.issuer.replace(/\n/g, ','))}</X509IssuerName>` +
    `<X509SerialNumber>${serie}</X509SerialNumber></X509IssuerSerial>` +
    `<X509Certificate>${b64(cred.cer)}</X509Certificate>` +
    '</X509Data></KeyInfo>';
}

function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Primeras palabras del XML de error, para que la bitácora sirva de algo. */
function resumen(xml: string): string {
  const falla = etiqueta(xml, 'faultstring') || etiqueta(xml, 'Text');
  return (falla || xml.slice(0, 200)).slice(0, 200);
}

async function enviar(url: string, accion: string, sobre: string, token?: Token): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/xml;charset="utf-8"',
    SOAPAction: accion,
    Accept: 'text/xml',
  };
  /* El SAT NO usa Bearer: el token viaja en el esquema WRAP y entre comillas.
   * Mandarlo como Bearer devuelve un 401 sin explicación. */
  if (token) headers.Authorization = `WRAP access_token="${token.valor}"`;

  try {
    const r = await axios.post(url, sobre, { headers, timeout: 120_000, maxBodyLength: Infinity });
    return String(r.data || '');
  } catch (e: any) {
    const cuerpo = String(e?.response?.data || '');
    const detalle = e?.response?.status
      ? `HTTP ${e.response.status}${cuerpo ? ' · ' + resumen(cuerpo) : ''}`
      : e?.message || 'sin respuesta';
    /* Nunca se registra el sobre: lleva el certificado y la firma. */
    logger.warn(`[sat-descarga] ${accion.split('/').pop()} falló: ${detalle}`);
    throw new Error(detalle);
  }
}
