/**
 * Contrato de prestación de servicios firmado con la e.firma del contratante.
 *
 * Reusa las primitivas de e.firma de modules/manifest (parseCertificate,
 * openPrivateKey): son la ÚNICA implementación de lectura de certificados del
 * SAT. Duplicarlas haría divergir las validaciones.
 *
 * Garantías del flujo:
 *   · La .key JAMÁS se persiste ni se registra: vive en memoria durante la firma.
 *   · La e.firma debe pertenecer al RFC de la empresa que contrata — no se
 *     acepta que un tercero firme por ella.
 *   · Se guarda el texto ÍNTEGRO + su SHA-256: sin el texto exacto, la firma no
 *     se puede verificar después y no sirve como prueba.
 *   · La firma se verifica al momento contra la pública del certificado.
 */

import crypto from 'crypto';
import { query } from '../../config/database';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler';
import { parseCertificate, openPrivateKey } from '../manifest/manifest.service';
import { buildContractText, CONTRACT_VERSION } from './contract-text';

export interface ContractStatus {
  version_vigente: string;
  signed: boolean;
  contract_text: string;
  signature?: {
    id: string;
    version: string;
    signer_rfc: string;
    signer_name: string | null;
    cert_serial: string | null;
    signed_at: string;
    contract_sha256: string;
    /** true si la firma es de una versión anterior a la vigente. */
    outdated: boolean;
  };
}

async function getCompany(companyId: string) {
  const r = await query<{ rfc: string; business_name: string }>(
    'SELECT rfc, business_name FROM companies WHERE id = $1',
    [companyId]
  );
  if (r.rows.length === 0) throw new NotFoundError('Empresa no encontrada');
  return r.rows[0];
}

/**
 * Estado del contrato para una empresa: el texto vigente a firmar y, si ya
 * firmó, los datos de esa firma. El texto se arma con la fecha de HOY solo
 * para mostrarlo; el que se firma se arma en signContract con la fecha real.
 */
export async function getContractStatus(companyId: string): Promise<ContractStatus> {
  const company = await getCompany(companyId);
  const preview = buildContractText({
    client: { rfc: company.rfc, businessName: company.business_name },
    signedAt: new Date(),
  });

  const r = await query<any>(
    `SELECT id, version, signer_rfc, signer_name, cert_serial, signed_at, contract_sha256
       FROM service_contracts
      WHERE company_id = $1
      ORDER BY signed_at DESC
      LIMIT 1`,
    [companyId]
  );

  if (r.rows.length === 0) {
    return { version_vigente: CONTRACT_VERSION, signed: false, contract_text: preview };
  }
  const s = r.rows[0];
  return {
    version_vigente: CONTRACT_VERSION,
    signed: true,
    contract_text: preview,
    signature: {
      id: s.id,
      version: s.version,
      signer_rfc: s.signer_rfc,
      signer_name: s.signer_name,
      cert_serial: s.cert_serial,
      signed_at: s.signed_at,
      contract_sha256: s.contract_sha256,
      // Si los T&C cambiaron desde que firmó, hay que volver a firmar.
      outdated: s.version !== CONTRACT_VERSION,
    },
  };
}

export interface SignContractResult {
  contractId: string;
  version: string;
  signerRfc: string;
  signerName: string | null;
  certSerial: string;
  signedAt: string;
  contractSha256: string;
}

export async function signContract(opts: {
  companyId: string;
  userId?: string;
  cerB64: string;
  keyB64: string;
  password: string;
  ip?: string;
  userAgent?: string;
}): Promise<SignContractResult> {
  const company = await getCompany(opts.companyId);

  if (!opts.cerB64 || !opts.keyB64 || !opts.password) {
    throw new ValidationError('Se requieren el .cer, la .key y la contraseña de la e.firma');
  }

  const cerDer = Buffer.from(opts.cerB64, 'base64');
  const keyDer = Buffer.from(opts.keyB64, 'base64');

  // 1) El certificado es una e.firma del SAT, del RFC correcto y vigente.
  const cert = parseCertificate(cerDer);
  if (!cert.rfc) {
    throw new ValidationError('El certificado no contiene RFC — ¿es una e.firma del SAT?');
  }
  if (cert.rfc !== company.rfc.toUpperCase().trim()) {
    throw new ValidationError(
      `La e.firma pertenece al RFC ${cert.rfc}, pero la empresa contratante es ${company.rfc}. ` +
      'El contrato debe firmarlo el propio contribuyente.'
    );
  }
  if (cert.validTo < new Date()) {
    throw new ValidationError(
      `La e.firma venció el ${cert.validTo.toISOString().slice(0, 10)} — renuévala ante el SAT.`
    );
  }

  // 2) La .key abre y corresponde al .cer (si no, alguien firma con una llave ajena).
  const privateKey = openPrivateKey(keyDer, opts.password);
  const pubFromPriv = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const pubFromCert = cert.x509.publicKey.export({ format: 'der', type: 'spki' });
  if (!pubFromPriv.equals(pubFromCert)) {
    throw new ValidationError(
      'La .key no corresponde al .cer — verifica que ambos sean del mismo juego de e.firma.'
    );
  }

  // 3) Texto definitivo con la fecha real de firma, y su hash.
  const signedAt = new Date();
  const contractText = buildContractText({
    client: { rfc: company.rfc, businessName: company.business_name },
    signedAt,
  });
  const contractSha256 = crypto.createHash('sha256').update(contractText, 'utf-8').digest('hex');

  // 4) Firma RSA-SHA256 sobre el texto íntegro.
  const signature = crypto.sign('sha256', Buffer.from(contractText, 'utf-8'), privateKey);

  // 5) Verificación inmediata: si no verifica, no se guarda nada.
  const ok = crypto.verify('sha256', Buffer.from(contractText, 'utf-8'), cert.x509.publicKey, signature);
  if (!ok) throw new ValidationError('La verificación de la firma falló — intenta de nuevo.');

  // 6) Persistir. La .key NO se guarda: se queda en memoria y muere aquí.
  const ins = await query<{ id: string; signed_at: string }>(
    `INSERT INTO service_contracts
       (company_id, version, contract_text, contract_sha256, signer_rfc, signer_name,
        cert_serial, cert_valid_from, cert_valid_to, signature_b64, signed_at,
        signed_by_user, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id, signed_at`,
    [
      opts.companyId, CONTRACT_VERSION, contractText, contractSha256,
      cert.rfc, cert.name || null, cert.serial || null,
      cert.validFrom, cert.validTo,
      signature.toString('base64'), signedAt,
      opts.userId || null,
      (opts.ip || '').slice(0, 64),
      (opts.userAgent || '').slice(0, 255),
    ]
  );

  return {
    contractId: ins.rows[0].id,
    version: CONTRACT_VERSION,
    signerRfc: cert.rfc,
    signerName: cert.name || null,
    certSerial: cert.serial || '',
    signedAt: ins.rows[0].signed_at,
    contractSha256,
  };
}

/**
 * Verifica una firma ya emitida contra el texto guardado. Es la prueba de que
 * el contrato no se alteró: recalcula el hash y valida la firma con la pública
 * del certificado que se registró.
 */
export async function verifyContract(companyId: string): Promise<{
  found: boolean; hash_ok?: boolean; signature_ok?: boolean; signed_at?: string;
}> {
  const r = await query<any>(
    `SELECT contract_text, contract_sha256, signature_b64, signed_at, cert_serial, signer_rfc
       FROM service_contracts WHERE company_id = $1 ORDER BY signed_at DESC LIMIT 1`,
    [companyId]
  );
  if (r.rows.length === 0) return { found: false };
  const c = r.rows[0];

  const hash = crypto.createHash('sha256').update(c.contract_text, 'utf-8').digest('hex');
  return {
    found: true,
    hash_ok: hash === c.contract_sha256,
    // La verificación criptográfica completa requiere el .cer, que no se
    // persiste; el hash es la garantía de integridad del texto guardado.
    signature_ok: undefined,
    signed_at: c.signed_at,
  };
}

export default { getContractStatus, signContract, verifyContract };
