/**
 * mailer.service.ts — envío de correos con adjuntos (PDF + XML de CFDI).
 *
 * Config vía env:
 *   MAIL_HOST     — SMTP host (ej. smtp.hostinger.com, smtp.gmail.com)
 *   MAIL_PORT     — 465 (SSL) | 587 (STARTTLS) | 2525
 *   MAIL_USER     — usuario SMTP
 *   MAIL_PASS     — contraseña / app-password
 *   MAIL_FROM     — remitente por defecto si la empresa no tiene contact_email
 *
 * Cuando la empresa emisora tiene `contact_email` cargado, ese va como "From:"
 * y "Reply-To:" para que el cliente responda directo a la empresa.
 */

import nodemailer, { Transporter } from 'nodemailer';
import { query } from '../../config/database';
import logger from '../../middleware/logger';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import { generateInvoicePDF } from '../cfdi/pdf.service';
import { generateCreditNotePDF } from '../cfdi/pdf-credit-note.service';
import { generatePaymentPDF } from '../cfdi/pdf-payment.service';

/** Tipos de documento que se pueden adjuntar. */
export type MailAttachmentKind =
  | 'invoice_pdf' | 'invoice_xml'
  | 'credit_note_pdf' | 'credit_note_xml'
  | 'payment_pdf' | 'payment_xml';

export interface MailAttachmentSpec {
  kind: MailAttachmentKind;
  /** UUID de BD del documento (invoiceId / creditNoteId / paymentId). */
  id: string;
}

let envTransporter: Transporter | null = null;
const companyTransporterCache = new Map<string, { t: Transporter; user: string; from?: string }>();

/** Descifra la password SMTP guardada con ENCRYPTION_KEY (AES-256-GCM). */
function decryptPass(enc: string): string {
  const crypto = require('crypto') as typeof import('crypto');
  const key = (process.env.ENCRYPTION_KEY || '').slice(0, 32).padEnd(32, '0');
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Cifra la password SMTP para guardar en DB. Exportada para el companies controller. */
export function encryptPass(plain: string): string {
  const crypto = require('crypto') as typeof import('crypto');
  const key = (process.env.ENCRYPTION_KEY || '').slice(0, 32).padEnd(32, '0');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * Devuelve el transportador SMTP a usar para una empresa dada.
 * Preferencia: SMTP configurado en la empresa → SMTP de env como fallback.
 * Cada empresa se cachea en memoria — si cambia la config, invalida cache
 * borrando `companyTransporterCache.delete(companyId)`.
 */
async function getTransporterForCompany(companyId: string): Promise<{ t: Transporter; user: string; from?: string }> {
  const cached = companyTransporterCache.get(companyId);
  if (cached) return cached;

  // 1) SMTP propio de la empresa
  const r = await query<{ mail_host: string; mail_port: number; mail_secure: boolean; mail_user: string; mail_pass_enc: string; mail_from: string }>(
    `SELECT mail_host, mail_port, mail_secure, mail_user, mail_pass_enc, mail_from
       FROM companies WHERE id = $1
        AND mail_host IS NOT NULL AND mail_user IS NOT NULL AND mail_pass_enc IS NOT NULL`,
    [companyId],
  );
  if (r.rows[0]) {
    const row = r.rows[0];
    let pass: string;
    try { pass = decryptPass(row.mail_pass_enc); }
    catch (e: any) {
      logger.warn(`SMTP empresa ${companyId}: falla descifrado (${e.message}). Cayendo a SMTP central.`);
      return getEnvTransporter();
    }
    const t = nodemailer.createTransport({
      host: row.mail_host,
      port: row.mail_port || 587,
      secure: row.mail_secure === true || row.mail_port === 465,
      auth: { user: row.mail_user, pass },
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    });
    const entry = { t, user: row.mail_user, from: row.mail_from || row.mail_user };
    companyTransporterCache.set(companyId, entry);
    logger.info(`SMTP empresa ${companyId} configurado: ${row.mail_host}:${row.mail_port} (${row.mail_user})`);
    return entry;
  }

  // 2) Fallback a SMTP central del env
  return getEnvTransporter();
}

function getEnvTransporter(): { t: Transporter; user: string; from?: string } {
  if (envTransporter) return { t: envTransporter, user: process.env.MAIL_USER || '', from: process.env.MAIL_FROM };

  const host = process.env.MAIL_HOST;
  const port = parseInt(process.env.MAIL_PORT || '587', 10);
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;

  if (!host || !user || !pass) {
    throw new ValidationError(
      'Servicio de correo no configurado. Configúralo en Datos de mi empresa → Servidor de correo (SMTP), ' +
      'o solicita al SUPER_ADMIN que configure MAIL_HOST, MAIL_PORT, MAIL_USER y MAIL_PASS en el servidor.'
    );
  }

  envTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 15_000,
    greetingTimeout:   15_000,
    socketTimeout:     30_000,
  });
  logger.info(`Mailer central configurado: ${host}:${port} (secure=${port === 465})`);
  return { t: envTransporter, user, from: process.env.MAIL_FROM };
}

/** Invalidar cache cuando se actualiza SMTP de una empresa. */
export function invalidateSMTPCache(companyId: string): void {
  companyTransporterCache.delete(companyId);
}

/** Legacy — usado por caminos que no tienen companyId a la mano. Usa env. */
function getTransporter(): Transporter {
  return getEnvTransporter().t;
}

/**
 * sendTestMail — envío ligero SIN adjuntos ni validaciones estrictas para
 * probar credenciales SMTP de una empresa. Falla con el error real de
 * nodemailer si las credenciales están mal (útil para debugging).
 */
export async function sendTestMail(companyId: string, to: string): Promise<void> {
  const { t, from } = await getTransporterForCompany(companyId);
  await t.sendMail({
    from: from || process.env.MAIL_FROM || process.env.MAIL_USER!,
    to,
    subject: 'Prueba SMTP · GDM NEXO',
    text: 'Este correo confirma que la configuración SMTP de tu empresa quedó lista para enviar facturas.\n\n— GDM NEXO',
    html: '<p>Este correo confirma que la configuración SMTP de tu empresa quedó lista para enviar facturas.</p><p>— <b>GDM NEXO</b></p>',
  });
}

/**
 * Construye la lista de adjuntos (Buffer + filename) para una lista de specs.
 * XML se lee de la BD; PDF se regenera al vuelo con los servicios existentes.
 *
 * Si un adjunto individual falla (ej. XML aún no timbrado, PDF con error),
 * no se aborta el resto — se recolecta el error y el caller decide qué hacer.
 * Antes cualquier falla parcial cancelaba TODO el correo y el usuario recibía
 * cero adjuntos, sin poder distinguir cuál era el problemático.
 */
async function buildAttachments(
  companyId: string,
  specs: MailAttachmentSpec[]
): Promise<{
  ok: Array<{ filename: string; content: Buffer; contentType: string }>;
  errors: Array<{ kind: MailAttachmentKind; id: string; message: string }>;
}> {
  const out: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  const errors: Array<{ kind: MailAttachmentKind; id: string; message: string }> = [];

  for (const spec of specs) {
    try {
    switch (spec.kind) {
      case 'invoice_pdf': {
        const r = await query<{ serie: string; folio: number }>(
          `SELECT serie, folio FROM invoices WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
          [spec.id, companyId]
        );
        if (r.rows.length === 0) throw new NotFoundError(`Factura ${spec.id} no encontrada`);
        const buf = await generateInvoicePDF({ companyId, invoiceId: spec.id });
        const fname = `Factura-${r.rows[0].serie}-${String(r.rows[0].folio).padStart(6, '0')}.pdf`;
        out.push({ filename: fname, content: buf, contentType: 'application/pdf' });
        break;
      }
      case 'invoice_xml': {
        const r = await query<{ serie: string; folio: number; xml_content: string | null }>(
          `SELECT serie, folio, xml_content FROM invoices WHERE id = $1 AND company_id = $2`,
          [spec.id, companyId]
        );
        if (r.rows.length === 0) throw new NotFoundError(`Factura ${spec.id} no encontrada`);
        const row = r.rows[0];
        if (!row.xml_content) throw new ValidationError('La factura aún no tiene XML timbrado.');
        const fname = `Factura-${row.serie}-${String(row.folio).padStart(6, '0')}.xml`;
        out.push({ filename: fname, content: Buffer.from(row.xml_content, 'utf-8'), contentType: 'application/xml' });
        break;
      }
      case 'credit_note_pdf': {
        const r = await query<{ serie: string; folio: number }>(
          `SELECT serie, folio FROM credit_notes WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
          [spec.id, companyId]
        );
        if (r.rows.length === 0) throw new NotFoundError(`NC ${spec.id} no encontrada`);
        const buf = await generateCreditNotePDF(companyId, spec.id);
        const fname = `NC-${r.rows[0].serie}-${String(r.rows[0].folio).padStart(6, '0')}.pdf`;
        out.push({ filename: fname, content: buf, contentType: 'application/pdf' });
        break;
      }
      case 'credit_note_xml': {
        const r = await query<{ serie: string; folio: number; xml_content: string | null }>(
          `SELECT serie, folio, xml_content FROM credit_notes WHERE id = $1 AND company_id = $2`,
          [spec.id, companyId]
        );
        if (r.rows.length === 0) throw new NotFoundError(`NC ${spec.id} no encontrada`);
        const row = r.rows[0];
        if (!row.xml_content) throw new ValidationError('La NC aún no tiene XML timbrado.');
        const fname = `NC-${row.serie}-${String(row.folio).padStart(6, '0')}.xml`;
        out.push({ filename: fname, content: Buffer.from(row.xml_content, 'utf-8'), contentType: 'application/xml' });
        break;
      }
      case 'payment_pdf': {
        const r = await query<{ serie: string; folio: number }>(
          `SELECT serie, folio FROM payments WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
          [spec.id, companyId]
        );
        if (r.rows.length === 0) throw new NotFoundError(`Pago ${spec.id} no encontrado`);
        const buf = await generatePaymentPDF(companyId, spec.id);
        const fname = `Pago-${r.rows[0].serie || 'P'}-${String(r.rows[0].folio).padStart(6, '0')}.pdf`;
        out.push({ filename: fname, content: buf, contentType: 'application/pdf' });
        break;
      }
      case 'payment_xml': {
        const r = await query<{ serie: string; folio: number; xml_content: string | null }>(
          `SELECT serie, folio, xml_content FROM payments WHERE id = $1 AND company_id = $2`,
          [spec.id, companyId]
        );
        if (r.rows.length === 0) throw new NotFoundError(`Pago ${spec.id} no encontrado`);
        const row = r.rows[0];
        if (!row.xml_content) throw new ValidationError('El complemento de pago aún no tiene XML.');
        const fname = `Pago-${row.serie || 'P'}-${String(row.folio).padStart(6, '0')}.xml`;
        out.push({ filename: fname, content: Buffer.from(row.xml_content, 'utf-8'), contentType: 'application/xml' });
        break;
      }
    }
    } catch (e) {
      const msg = (e as Error).message || 'Error desconocido al armar el adjunto';
      logger.warn(`Adjunto ${spec.kind}:${spec.id} omitido — ${msg}`);
      errors.push({ kind: spec.kind, id: spec.id, message: msg });
    }
  }

  return { ok: out, errors };
}

/**
 * Envía un correo con adjuntos a un destinatario.
 *
 *   from      · Si la empresa tiene contact_email, se usa como remitente y reply-to.
 *   subject   · Prefijo con el nombre de la empresa (ej. "Factura A-001 · ACME")
 *   attachments · Lista de {kind, id} — el mailer resuelve los binarios contra la BD.
 */
export async function sendInvoiceMail(input: {
  companyId: string;
  to: string;
  cc?: string;
  subject: string;
  message: string;
  attachments: MailAttachmentSpec[];
  actingUserEmail?: string;
}): Promise<{
  messageId: string;
  recipients: string[];
  attached: number;
  skipped: Array<{ kind: MailAttachmentKind; id: string; message: string }>;
}> {
  if (!input.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to.trim())) {
    throw new ValidationError('El correo destino no es válido');
  }
  if (input.attachments.length === 0) {
    throw new ValidationError('Selecciona al menos un archivo para enviar');
  }

  // Datos del emisor para "from" y firma del correo.
  const compR = await query<{ business_name: string; contact_email: string | null; rfc: string }>(
    `SELECT business_name, contact_email, rfc FROM companies WHERE id = $1`,
    [input.companyId]
  );
  if (compR.rows.length === 0) throw new NotFoundError('Empresa emisora no encontrada');
  const company = compR.rows[0];

  const fromAddress =
    company.contact_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(company.contact_email)
      ? company.contact_email
      : process.env.MAIL_FROM || process.env.MAIL_USER!;

  const { ok: attachments, errors: skipped } =
    await buildAttachments(input.companyId, input.attachments);

  if (attachments.length === 0) {
    // Ningún adjunto pudo generarse — abortamos y regresamos el diagnóstico
    // para que el usuario entienda por qué (XML no timbrado, PDF corrupto, etc.).
    const detail = skipped.map((s) => `• ${s.kind}: ${s.message}`).join('\n');
    throw new ValidationError(
      `No se pudo generar ninguno de los adjuntos seleccionados.\n${detail}`
    );
  }

  // Transportador: SMTP propio de la empresa si está configurado, si no env.
  const { t: tx, from: smtpFrom } = await getTransporterForCompany(input.companyId);
  const effectiveFrom = smtpFrom || fromAddress;
  const info = await tx.sendMail({
    from: `"${company.business_name}" <${effectiveFrom}>`,
    replyTo: fromAddress,
    to: input.to.trim(),
    cc: input.cc?.trim() || undefined,
    subject: input.subject,
    text: buildPlainText(input.message, company.business_name),
    html: buildHtml(input.message, company.business_name),
    attachments,
  });

  logger.info(
    `Correo enviado: to=${input.to} adjuntos=${attachments.length}/${input.attachments.length} ` +
    `messageId=${info.messageId} por ${input.actingUserEmail || 'sistema'}`
  );
  if (skipped.length > 0) {
    logger.warn(`Adjuntos omitidos (${skipped.length}): ${skipped.map((s) => s.kind).join(', ')}`);
  }

  return {
    messageId: info.messageId,
    recipients: [input.to, ...(input.cc ? [input.cc] : [])],
    attached: attachments.length,
    skipped,
  };
}

function buildPlainText(userMsg: string, companyName: string): string {
  const clean = userMsg.trim() || 'Adjuntamos los documentos fiscales solicitados.';
  return `${clean}\n\n---\n${companyName}\nSistema de facturación CFDI 4.0`;
}

function buildHtml(userMsg: string, companyName: string): string {
  const clean = (userMsg.trim() || 'Adjuntamos los documentos fiscales solicitados.')
    .replace(/</g, '&lt;')
    .replace(/\n/g, '<br>');
  return `
    <div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#0f172a">
      <p>${clean}</p>
      <hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0">
      <p style="color:#64748b;font-size:12px">
        <b>${companyName}</b><br>
        Sistema de facturación CFDI 4.0
      </p>
    </div>`;
}

/**
 * Correo simple sin adjuntos — para notificaciones automáticas del sistema
 * (alertas de prepago, recordatorios de pago). Usa el mismo transporter y
 * los mismos templates HTML/texto que sendInvoiceMail.
 *
 * `companyId` es la empresa REMITENTE (la plataforma): su contact_email se
 * usa como From/Reply-To si existe; si no, cae a MAIL_FROM.
 */
export async function sendPlainMail(input: {
  companyId?: string;
  to: string;
  subject: string;
  message: string;
}): Promise<{ messageId: string }> {
  if (!input.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to.trim())) {
    throw new ValidationError('El correo destino no es válido');
  }

  let fromName = 'Sistema de Facturación';
  let fromAddress = process.env.MAIL_FROM || process.env.MAIL_USER!;
  if (input.companyId) {
    const r = await query<{ business_name: string; contact_email: string | null }>(
      `SELECT business_name, contact_email FROM companies WHERE id = $1`,
      [input.companyId]
    );
    if (r.rows[0]) {
      fromName = r.rows[0].business_name;
      if (r.rows[0].contact_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.rows[0].contact_email)) {
        fromAddress = r.rows[0].contact_email;
      }
    }
  }

  const tx = getTransporter();
  const info = await tx.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    replyTo: fromAddress,
    to: input.to.trim(),
    subject: input.subject,
    text: buildPlainText(input.message, fromName),
    html: buildHtml(input.message, fromName),
  });

  logger.info(`Correo automático enviado: to=${input.to} subject="${input.subject}"`);
  return { messageId: info.messageId };
}

/**
 * Test rápido: envía un correo con el asunto "Prueba SMTP".
 * Útil para validar la configuración desde el SUPER_ADMIN.
 */
export async function testMailConfig(to: string): Promise<{ messageId: string }> {
  const tx = getTransporter();
  const from = process.env.MAIL_FROM || process.env.MAIL_USER!;
  const info = await tx.sendMail({
    from: `"Sistema de Facturación" <${from}>`,
    to,
    subject: 'Prueba de configuración SMTP',
    text: 'Si estás leyendo esto, la configuración SMTP funciona correctamente.',
  });
  return { messageId: info.messageId };
}
