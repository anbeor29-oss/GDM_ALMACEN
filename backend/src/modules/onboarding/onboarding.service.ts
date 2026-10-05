/**
 * onboarding.service — alta pública de PRUEBA (72 h) y su estado.
 *
 * El prospecto se da de alta solo (self-service) en la pantalla pública: se crea
 * la empresa en MODO PRUEBA (`companies.prueba_inicio = NOW()`) + su usuario ADMIN,
 * y entra de inmediato pero RESTRINGIDO (sin timbrar real) por 72 h. Al vencer, se
 * bloquea salvo que firme el contrato con e.firma; al firmar se libera todo.
 *
 * NUNCA se bloquean los RFC "ocultos" del dueño (pruebas + operación), ni las
 * empresas que ya operan o ya firmaron: su estado es siempre ACTIVA.
 */
import * as crypto from 'crypto';
import { query, transaction } from '../../config/database';
import { ValidationError, ConflictError } from '../../middleware/errorHandler';
import { hashPassword, validateRFC } from '../auth/auth.service';

/** Contraseña temporal legible (sin caracteres ambiguos). Se resetea al entrar. */
function contrasenaTemporal(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[crypto.randomInt(0, chars.length)];
  return `Nx-${s}`;
}

/** RFC con acceso "oculto" (nunca se bloquean): operación y pruebas del dueño. */
export const RFCS_SIN_BLOQUEO = [
  'GHC1707275Y0', 'AABA020418BW2',
  'LOGJ9010071V0',  // JESSICA LOPEZ GONZALEZ — alta en pruebas
  'IAGD860819MP3',  // DAVID ISLAS GUERRERO   — alta en pruebas
];
/** Duración de la prueba. */
export const HORAS_PRUEBA = 72;

export type EstadoPrueba = 'ACTIVA' | 'PRUEBA_ACTIVA' | 'PRUEBA_VENCIDA';
export interface EstadoOnboarding {
  estado: EstadoPrueba;
  firmado: boolean;
  pruebaInicio: string | null;
  horasRestantes: number | null;   // sólo en PRUEBA_ACTIVA
}

/**
 * Estado de onboarding de una empresa:
 *  · ACTIVA         → acceso completo (RFC exento / ya opera / ya firmó / no es prueba).
 *  · PRUEBA_ACTIVA  → dentro de las 72 h; restringido (sin timbrar real).
 *  · PRUEBA_VENCIDA → pasaron las 72 h sin firmar; sólo puede firmar el contrato.
 */
export async function estadoOnboarding(companyId: string): Promise<EstadoOnboarding> {
  const c = await query<any>(`SELECT rfc, prueba_inicio FROM companies WHERE id = $1`, [companyId]);
  const row = c.rows[0];
  const libre = (pruebaInicio: string | null, firmado = false): EstadoOnboarding =>
    ({ estado: 'ACTIVA', firmado, pruebaInicio, horasRestantes: null });
  if (!row) return libre(null);

  const rfc = String(row.rfc || '').toUpperCase().trim();
  // Exentos: RFC oculto o sin reloj de prueba → acceso completo.
  if (RFCS_SIN_BLOQUEO.includes(rfc) || !row.prueba_inicio) return libre(row.prueba_inicio);

  // ¿Ya firmó el contrato con e.firma? Sólo la FIRMA libera una empresa de prueba
  // (su "operación" durante la prueba es exploración, no la exenta).
  const firmado = (await query(`SELECT 1 FROM service_contracts WHERE company_id = $1 LIMIT 1`, [companyId])).rows.length > 0;
  if (firmado) return libre(row.prueba_inicio, true);

  const finMs = new Date(row.prueba_inicio).getTime() + HORAS_PRUEBA * 3600_000;
  const restanteMs = finMs - Date.now();
  if (restanteMs > 0) {
    return { estado: 'PRUEBA_ACTIVA', firmado: false, pruebaInicio: row.prueba_inicio, horasRestantes: Math.ceil(restanteMs / 3600_000) };
  }
  return { estado: 'PRUEBA_VENCIDA', firmado: false, pruebaInicio: row.prueba_inicio, horasRestantes: 0 };
}

/** ¿La empresa está restringida (prueba activa o vencida)? Para gating de timbrado, etc. */
export async function estaEnPrueba(companyId: string): Promise<boolean> {
  const e = await estadoOnboarding(companyId);
  return e.estado !== 'ACTIVA';
}

/** Lanza si la empresa está en prueba: durante la prueba NO se timbra real. */
export async function assertPuedeTimbrar(companyId: string): Promise<void> {
  if (await estaEnPrueba(companyId)) {
    throw new ValidationError('En modo prueba no se puede timbrar. Firma el contrato con tu e.firma para activar el timbrado real.');
  }
}

/**
 * Alta pública de PRUEBA: crea la empresa (modo prueba) + su ADMIN con una
 * CONTRASEÑA TEMPORAL que DEBE resetear al entrar (password_change_required). NO
 * auto-entra: devuelve el correo + la contraseña temporal para que inicie sesión.
 * Un RFC por alta; si ya existe, se rechaza. El reloj de 72 h arranca cuando
 * resetea la contraseña y entra (ver reiniciarRelojPruebaSiAplica).
 */
export async function registrarPrueba(d: {
  rfc?: string; razonSocial?: string; cp?: string; regimen?: string;
  correo?: string; nombre?: string; telefono?: string;
}): Promise<{ companyId: string; correo: string; passwordTemporal: string }> {
  const rfc = String(d.rfc || '').toUpperCase().trim();
  const razon = String(d.razonSocial || '').trim();
  const cp = String(d.cp || '').trim();
  const correo = String(d.correo || '').toLowerCase().trim();
  if (!validateRFC(rfc)) throw new ValidationError('El RFC no tiene un formato válido.');
  if (razon.length < 3) throw new ValidationError('Captura la razón social / nombre.');
  if (!/^\d{5}$/.test(cp)) throw new ValidationError('El código postal debe tener 5 dígitos.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new ValidationError('El correo no es válido.');

  if ((await query(`SELECT 1 FROM companies WHERE UPPER(rfc) = $1`, [rfc])).rows.length) {
    throw new ConflictError('Ya existe una empresa con ese RFC. Si ya tienes cuenta, inicia sesión.');
  }
  if ((await query(`SELECT 1 FROM users WHERE email = $1`, [correo])).rows.length) {
    throw new ConflictError('Ese correo ya tiene una cuenta. Inicia sesión o usa otro correo.');
  }

  const passwordTemporal = contrasenaTemporal();
  const [firstName, ...resto] = String(d.nombre || 'Administrador').trim().split(/\s+/);
  const companyId = await transaction(async (client) => {
    const comp = await client.query(
      `INSERT INTO companies
         (rfc, business_name, fiscal_regime, postal_code, email, phone,
          is_active, verified_with_sat, next_invoice_folio, default_invoice_series, subscription_plan, prueba_inicio)
       VALUES ($1,$2,$3,$4,$5,$6, true, false, 1, 'F', 'STARTER', NOW())
       RETURNING id`,
      [rfc, razon, d.regimen || '601', cp, correo, d.telefono || null]);
    const id = comp.rows[0].id;
    const hash = await hashPassword(passwordTemporal);
    await client.query(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, phone, role, company_id, is_active, failed_login_attempts, password_change_required)
       VALUES ($1,$2,$3,$4,$5,'ADMIN',$6, true, 0, TRUE)`,
      [correo, hash, firstName, resto.join(' ') || null, d.telefono || null, id]);
    return id as string;
  });

  return { companyId, correo, passwordTemporal };
}

/** Registra una solicitud de "demostración en línea" (la ve el súper admin). */
export async function solicitarDemo(companyId: string, d: { contacto?: string; correo?: string; telefono?: string; mensaje?: string }) {
  const c = await query<any>(`SELECT rfc FROM companies WHERE id = $1`, [companyId]);
  await query(
    `INSERT INTO demo_requests (company_id, rfc, contacto, correo, telefono, mensaje)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [companyId, c.rows[0]?.rfc || null, d.contacto || null, d.correo || null, d.telefono || null, d.mensaje || null]);
  return { ok: true };
}

/** Bandeja de solicitudes de demo (súper admin). */
export async function listarDemos(soloPendientes = false) {
  const r = await query<any>(
    `SELECT d.id, d.rfc, c.business_name, d.contacto, d.correo, d.telefono, d.mensaje, d.estado,
            TO_CHAR(d.created_at,'YYYY-MM-DD HH24:MI') AS creado
       FROM demo_requests d LEFT JOIN companies c ON c.id = d.company_id
      ${soloPendientes ? `WHERE d.estado = 'PENDIENTE'` : ''}
      ORDER BY d.created_at DESC LIMIT 200`);
  return r.rows;
}

/** Marca una solicitud como atendida. */
export async function atenderDemo(id: string) {
  await query(`UPDATE demo_requests SET estado = 'ATENDIDA' WHERE id = $1`, [id]);
  return { ok: true };
}

/** Bandeja de empresas que FIRMARON (pendientes de facturar + pasar a producción). */
export async function listarFirmas(soloPendientes = false) {
  const r = await query<any>(
    `SELECT f.id, f.rfc, f.business_name, f.estado,
            TO_CHAR(f.signed_at,'YYYY-MM-DD HH24:MI') AS firmado,
            c.email, c.timbrado_ambiente
       FROM onboarding_firmas f LEFT JOIN companies c ON c.id = f.company_id
      ${soloPendientes ? `WHERE f.estado = 'PENDIENTE'` : ''}
      ORDER BY f.created_at DESC LIMIT 200`);
  return r.rows;
}

/** Marca una firma como atendida (ya se facturó y pasó a producción). */
export async function atenderFirma(id: string) {
  await query(`UPDATE onboarding_firmas SET estado = 'ATENDIDA' WHERE id = $1`, [id]);
  return { ok: true };
}
