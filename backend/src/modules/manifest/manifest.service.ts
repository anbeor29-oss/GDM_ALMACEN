/**
 * manifest.service — firma del manifiesto PAC con la e.firma (FIEL).
 *
 * El manifiesto es la autorización expresa del contribuyente a SW SAPIEN
 * (SMARTER WEB / PCCFDI autorizado SAT) para certificar sus CFDI. Aquí se
 * firma ELECTRÓNICAMENTE de verdad:
 *
 *   1. Se recibe la e.firma: .cer + .key (PKCS#8 DER cifrado del SAT) +
 *      contraseña. TODO en memoria — la .key jamás se persiste.
 *   2. Se valida que el certificado:
 *        · pertenece al RFC de la empresa (subject x500UniqueIdentifier)
 *        · está vigente (validTo > hoy)
 *        · corresponde a la .key (la pública derivada de la privada coincide)
 *   3. Se construye el texto del manifiesto (plantilla legal con RFC, razón
 *      social y fecha) y se firma con RSA-SHA256.
 *   4. Se guarda la constancia completa en sw_manifests (texto + firma +
 *      datos del certificado) y se puede descargar en PDF.
 *
 * NOTA sobre el envío a SW: SW gestiona la recepción del manifiesto desde su
 * panel (no expone endpoint público documentado). La constancia generada
 * aquí es el documento firmado que se conserva en el expediente y que se
 * presenta a SW si lo solicita. status queda en SIGNED; el super-admin puede
 * marcar SENT/ACCEPTED manualmente cuando lo tramite.
 */

import * as crypto from 'crypto';
import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

/* ─────────────── Texto del manifiesto ─────────────── */

export function buildManifestText(opts: {
  rfc: string;
  businessName: string;
  date: Date;
}): string {
  const fecha = opts.date.toLocaleDateString('es-MX', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  return (
`MANIFIESTO DE AUTORIZACIÓN AL PROVEEDOR DE CERTIFICACIÓN DE CFDI

${opts.businessName}, con RFC ${opts.rfc}, por medio del presente manifiesto
otorgo mi autorización expresa a SW SAPIEN (SMARTER WEB SAS DE CV), en su
carácter de Proveedor de Certificación de Comprobantes Fiscales Digitales
por Internet (PCCFDI) autorizado por el Servicio de Administración
Tributaria (SAT), para certificar (timbrar) los Comprobantes Fiscales
Digitales por Internet (CFDI) que emita a través de la plataforma de
facturación de GDM HIGH CONSULTING MÉXICO.

Asimismo, manifiesto que:
1. Los datos fiscales proporcionados a la plataforma son verídicos y
   corresponden a mi situación fiscal actual ante el SAT.
2. El Certificado de Sello Digital (CSD) cargado a la plataforma es de mi
   propiedad y me responsabilizo del uso que se le dé dentro de la misma.
3. Autorizo el resguardo cifrado de mi CSD para el único fin de sellar los
   CFDI que yo emita.
4. Conozco y acepto que la cancelación de CFDI se rige por las reglas del
   SAT vigentes (aceptación del receptor cuando aplique).

Este manifiesto se firma electrónicamente con la e.firma (FIEL) del
contribuyente, con la misma validez jurídica que la firma autógrafa, de
conformidad con los artículos 17-D y 19-A del Código Fiscal de la
Federación.

Fecha de firma: ${fecha}
RFC del firmante: ${opts.rfc}`
  );
}

/* ─────────────── Utilidades de certificado ─────────────── */

interface CertInfo {
  rfc: string | null;
  name: string | null;
  serial: string;
  validFrom: Date;
  validTo: Date;
  x509: crypto.X509Certificate;
}

/**
 * Parsea el .cer (DER) del SAT y extrae RFC, nombre, serial y vigencia.
 * El RFC viaja en el subject como x500UniqueIdentifier (a veces con CURP:
 * "RFC / CURP"). El serial del SAT viene hex-encodeado por pares ASCII.
 */
function parseCertificate(cerDer: Buffer): CertInfo {
  let x509: crypto.X509Certificate;
  try {
    x509 = new crypto.X509Certificate(cerDer);
  } catch {
    throw new ValidationError(
      'El archivo .cer no es un certificado válido (¿subiste el archivo correcto?)'
    );
  }

  // subject multilínea "key=value"
  const subject = x509.subject || '';
  const get = (key: string): string | null => {
    const m = subject.match(new RegExp(`(?:^|\\n)${key}=([^\\n]+)`));
    return m ? m[1].trim() : null;
  };

  // RFC: x500UniqueIdentifier="XXXX010101XXX / CURP..." (el RFC es el 1er token)
  const uid = get('x500UniqueIdentifier') || get('UID') || '';
  const rfc = uid ? uid.split('/')[0].trim().toUpperCase() : null;
  const name = get('CN');

  // Serial SAT: los bytes hex son los ASCII de los dígitos ("3330..." → "30...")
  const rawSerial = x509.serialNumber || '';
  let serial = rawSerial;
  try {
    const ascii = Buffer.from(rawSerial, 'hex').toString('latin1');
    if (/^[0-9A-Za-z]+$/.test(ascii)) serial = ascii;
  } catch { /* dejamos el hex crudo */ }

  return {
    rfc,
    name,
    serial,
    validFrom: new Date(x509.validFrom),
    validTo: new Date(x509.validTo),
    x509,
  };
}

/**
 * Abre la .key del SAT (PKCS#8 DER cifrado) con su contraseña.
 * Node soporta EncryptedPrivateKeyInfo DER nativo con passphrase.
 */
function openPrivateKey(keyDer: Buffer, password: string): crypto.KeyObject {
  try {
    return crypto.createPrivateKey({
      key: keyDer,
      format: 'der',
      type: 'pkcs8',
      passphrase: password,
    });
  } catch {
    throw new ValidationError(
      'No se pudo abrir la .key — verifica que la contraseña de la e.firma sea correcta ' +
      'y que el archivo sea la clave privada (.key) del SAT.'
    );
  }
}

/* ─────────────── Firma del manifiesto ─────────────── */

export interface SignResult {
  manifestId: string;
  signerRfc: string;
  signerName: string | null;
  certSerial: string;
  signedAt: string;
}

export async function signManifest(opts: {
  companyId: string;
  userId?: string;
  cerB64: string;
  keyB64: string;
  password: string;
}): Promise<SignResult> {
  const compR = await query<{ rfc: string; business_name: string }>(
    `SELECT rfc, business_name FROM companies WHERE id = $1`,
    [opts.companyId]
  );
  if (compR.rows.length === 0) throw new NotFoundError('Empresa no encontrada');
  const company = compR.rows[0];

  if (!opts.cerB64 || !opts.keyB64 || !opts.password) {
    throw new ValidationError('Se requieren el .cer, la .key y la contraseña de la e.firma');
  }

  const cerDer = Buffer.from(opts.cerB64, 'base64');
  const keyDer = Buffer.from(opts.keyB64, 'base64');

  // 1) Certificado: RFC correcto + vigente
  const cert = parseCertificate(cerDer);
  if (!cert.rfc) {
    throw new ValidationError(
      'El certificado no contiene RFC en el subject — ¿es una e.firma del SAT?'
    );
  }
  if (cert.rfc !== company.rfc.toUpperCase().trim()) {
    throw new ValidationError(
      `La e.firma pertenece al RFC ${cert.rfc}, pero la empresa está registrada ` +
      `con ${company.rfc}. El manifiesto debe firmarse con la FIEL del propio contribuyente.`
    );
  }
  const now = new Date();
  if (cert.validTo < now) {
    throw new ValidationError(
      `La e.firma venció el ${cert.validTo.toISOString().slice(0, 10)} — renueva tu FIEL ante el SAT.`
    );
  }

  // 2) La .key abre y corresponde al .cer
  const privateKey = openPrivateKey(keyDer, opts.password);
  const pubFromPriv = crypto.createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' });
  const pubFromCert = cert.x509.publicKey
    .export({ format: 'der', type: 'spki' });
  if (!pubFromPriv.equals(pubFromCert)) {
    throw new ValidationError(
      'La .key no corresponde al .cer proporcionado — verifica que ambos archivos ' +
      'sean del mismo juego de e.firma.'
    );
  }

  // 3) Construir texto y firmar RSA-SHA256
  const manifestText = buildManifestText({
    rfc: company.rfc,
    businessName: company.business_name,
    date: now,
  });
  const signature = crypto.sign('sha256', Buffer.from(manifestText, 'utf-8'), privateKey);

  // 4) Verificación inmediata (sanity check contra la pública del cert)
  const ok = crypto.verify(
    'sha256',
    Buffer.from(manifestText, 'utf-8'),
    cert.x509.publicKey,
    signature
  );
  if (!ok) {
    throw new ValidationError('La verificación de la firma falló — intenta de nuevo.');
  }

  // 5) Persistir constancia (la .key NO se guarda)
  const ins = await query<{ id: string; signed_at: string }>(
    `INSERT INTO sw_manifests
       (company_id, manifest_text, signer_rfc, signer_name, cert_serial,
        cert_valid_from, cert_valid_to, signature_b64, signed_by_user)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, signed_at`,
    [
      opts.companyId, manifestText, cert.rfc, cert.name, cert.serial,
      cert.validFrom, cert.validTo, signature.toString('base64'),
      opts.userId || null,
    ]
  );

  logger.info(
    `Manifiesto firmado: empresa=${company.rfc} cert=${cert.serial} ` +
    `manifest=${ins.rows[0].id}`
  );

  return {
    manifestId: ins.rows[0].id,
    signerRfc: cert.rfc,
    signerName: cert.name,
    certSerial: cert.serial,
    signedAt: ins.rows[0].signed_at,
  };
}

/* ─────────────── Consulta y constancia PDF ─────────────── */

export async function getLatestManifest(companyId: string) {
  const r = await query<any>(
    `SELECT m.id, m.signer_rfc, m.signer_name, m.cert_serial,
            m.cert_valid_from, m.cert_valid_to, m.signed_at, m.status,
            u.email AS signed_by_email
       FROM sw_manifests m
       LEFT JOIN users u ON u.id = m.signed_by_user
      WHERE m.company_id = $1
      ORDER BY m.signed_at DESC
      LIMIT 1`,
    [companyId]
  );
  return r.rows[0] || null;
}

export async function getManifestPdf(companyId: string): Promise<Buffer> {
  const r = await query<any>(
    `SELECT m.*, c.rfc AS company_rfc, c.business_name
       FROM sw_manifests m
       JOIN companies c ON c.id = m.company_id
      WHERE m.company_id = $1
      ORDER BY m.signed_at DESC
      LIMIT 1`,
    [companyId]
  );
  const m = r.rows[0];
  if (!m) throw new NotFoundError('Esta empresa aún no ha firmado el manifiesto');

  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ size: 'letter', margin: 56 });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));

  doc.font('Helvetica-Bold').fontSize(15).fillColor('#1e3a8a')
    .text('CONSTANCIA DE MANIFIESTO FIRMADO', { align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor('#64748b')
    .text('Firmado electrónicamente con e.firma (FIEL) — Art. 17-D y 19-A CFF', { align: 'center' });
  doc.moveDown(1.2);

  // Texto íntegro del manifiesto
  doc.font('Helvetica').fontSize(9.5).fillColor('#0f172a')
    .text(m.manifest_text, { align: 'justify', lineGap: 1.5 });
  doc.moveDown(1.2);

  // Datos de la firma
  const kv = (label: string, value: string) => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#334155')
      .text(label + ': ', { continued: true })
      .font('Helvetica').fillColor('#0f172a')
      .text(value);
  };
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e3a8a')
    .text('DATOS DE LA FIRMA ELECTRÓNICA');
  doc.moveDown(0.3);
  kv('Firmante', `${m.signer_name || '—'} (${m.signer_rfc})`);
  kv('No. de serie del certificado', m.cert_serial || '—');
  kv('Vigencia del certificado',
     `${new Date(m.cert_valid_from).toISOString().slice(0, 10)} al ${new Date(m.cert_valid_to).toISOString().slice(0, 10)}`);
  kv('Fecha y hora de firma', new Date(m.signed_at).toLocaleString('es-MX'));
  kv('Algoritmo', 'RSA-SHA256');
  doc.moveDown(0.5);

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#334155')
    .text('Firma digital (base64):');
  doc.font('Courier').fontSize(6).fillColor('#475569')
    .text(m.signature_b64, { lineGap: 0.5 });

  doc.moveDown(1);
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#94a3b8')
    .text(
      'La validez de esta firma puede verificarse aplicando RSA-SHA256 sobre el texto ' +
      'íntegro del manifiesto con el certificado del firmante. Documento generado por la ' +
      'plataforma de facturación GDM HIGH CONSULTING MÉXICO.',
      { align: 'center' }
    );

  doc.end();
  await new Promise<void>((res) => doc.on('end', () => res()));
  return Buffer.concat(chunks);
}
