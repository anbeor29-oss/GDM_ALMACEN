/**
 * PAC Service
 * Orquesta el timbrado/cancelación usando el provider configurado.
 *
 * ESTADO ACTUAL: Solo el provider MOCK está activo (simulación).
 * Cuando se elija un PAC real, se agrega su provider al registry y se
 * cambia DEFAULT_PROVIDER (o se configura por empresa en BD).
 */

import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import {
  IPACProvider,
  PACCredentials,
  StampResult,
  CancelResult,
  MOTIVOS_CANCELACION,
  MotivoCancelacion,
} from './pac.interface';
import { MockPACProvider } from './providers/mock.provider';
import { SWSapienProvider } from './providers/sw-sapien.provider';
import * as invoicesService from '../invoices/invoices.service';
import * as cfdiService from '../cfdi/cfdi.service';
import { buildCFDIJson } from '../cfdi/build-cfdi-json.service';
import * as billingService from '../billing/billing.service';
import {
  checkInvoiceStock,
  discountInvoiceStock,
  restoreInvoiceStock,
} from '../inventory/inventory.service';

/**
 * REGISTRY de proveedores PAC disponibles.
 * Agregar un PAC real: implementar IPACProvider y registrarlo aquí.
 */
const providers: Record<string, IPACProvider> = {
  MOCK:      new MockPACProvider(),
  SW_SAPIEN: new SWSapienProvider(),
};

/**
 * Provider por defecto — se elige por variable de entorno:
 *   · PAC_PROVIDER=SW_SAPIEN + SW_SAPIEN_TOKEN presentes → usa SW real
 *   · Cualquier otro caso                                 → MOCK (dev/tests)
 *
 * Esto permite tener MOCK en dev y SW_SAPIEN en prod sin recompilar.
 */
const DEFAULT_PROVIDER =
  process.env.PAC_PROVIDER === 'SW_SAPIEN' && process.env.SW_SAPIEN_TOKEN
    ? 'SW_SAPIEN'
    : 'MOCK';

/**
 * Obtener el provider activo para una empresa.
 * En el futuro, esto leerá la configuración de PAC desde la tabla companies.
 */
function getProvider(providerName?: string): IPACProvider {
  const name = providerName || DEFAULT_PROVIDER;
  const provider = providers[name];

  if (!provider) {
    throw new ValidationError(
      `PAC provider '${name}' no está configurado. Disponibles: ${Object.keys(providers).join(', ')}`
    );
  }

  return provider;
}

/**
 * Obtener credenciales del PAC (placeholder).
 * En producción se leerán cifradas desde la tabla companies.
 */
function getCredentials(_companyId: string): PACCredentials {
  return {
    provider: DEFAULT_PROVIDER,
    username: 'mock_user',
    password: 'mock_pass',
    is_test_mode: true,
  };
}

/**
 * TIMBRAR una factura
 * 1. Genera XML CFDI (si no existe)
 * 2. Envía al PAC para timbrado
 * 3. Guarda XML timbrado, UUID, sellos en BD
 * 4. Cambia status a STAMPED
 */
export async function stampInvoice(companyId: string, invoiceId: string): Promise<StampResult> {
  const invoice = await invoicesService.getInvoiceById(companyId, invoiceId);

  // Validar que la factura esté lista para timbrar
  if (invoice.status === 'STAMPED' || invoice.is_stamped) {
    throw new ValidationError('La factura ya está timbrada');
  }
  if (invoice.status === 'CANCELLED') {
    throw new ValidationError('No se puede timbrar una factura cancelada');
  }

  // Validar que la empresa tenga CSD cargado (.cer + .key + contraseña)
  // Aunque estemos en modo MOCK, simulamos la regla: sin CSD no se puede sellar.
  const csd = await query<{ csd_cer_path: string | null; csd_key_path: string | null; csd_password_encrypted: string | null }>(
    `SELECT csd_cer_path, csd_key_path, csd_password_encrypted FROM companies WHERE id = $1`,
    [companyId]
  );
  const c = csd.rows[0];
  if (!c || !c.csd_cer_path || !c.csd_key_path || !c.csd_password_encrypted) {
    throw new ValidationError(
      'Antes de timbrar carga el CSD (Certificado de Sello Digital) del emisor: ' +
      'archivo .cer, archivo .key y la contraseña. Hazlo desde Sidebar → Emisor.'
    );
  }

  // Guardrail de facturación: para plan PKG_FLEX bloquea si el prepago está
  // en 0 (Decisión #9 — bloqueo total). Otros planes no bloquean; los
  // extras se cobran al cierre del mes.
  await billingService.assertCanStamp(companyId);

  // FASE 3 ALMACEN (§9, decisión D3): validación de existencias ANTES de
  // gastar el timbre. Solo bloquea si la empresa lo configuró así
  // (inventory_block_no_stock=true); el default es alertar sin bloquear.
  const blockR = await query<{ inventory_block_no_stock: boolean }>(
    `SELECT inventory_block_no_stock FROM companies WHERE id = $1`, [companyId]
  );
  if (blockR.rows[0]?.inventory_block_no_stock) {
    const shortages = await transaction((client) =>
      checkInvoiceStock(client, companyId, invoiceId)
    );
    if (shortages.length > 0) {
      const detail = shortages
        .map((s) => `${s.sku} ${s.name}: pedido ${s.requested}, disponible ${s.available}`)
        .join(' · ');
      throw new ValidationError(
        `Existencia insuficiente para timbrar (la empresa bloquea venta sin stock): ${detail}. ` +
        `Recibe mercancía o ajusta el inventario antes de facturar.`
      );
    }
  }

  // Elegir provider y ruta.
  //   · Si el provider soporta stampFromJson (SW Sapien), preferimos JSON:
  //     no manejamos la .key en el backend — SW la trae del vault + sella + timbra.
  //   · Fallback a la ruta XML clásica (MOCK y providers legacy).
  const provider = getProvider();
  const credentials = getCredentials(companyId);
  let result: StampResult;

  if (typeof provider.stampFromJson === 'function') {
    const payload = await buildCFDIJson(companyId, invoiceId);

    // SW sandbox SOLO acepta RFC EKU9003173C9 (su CSD de prueba).
    // Si el emisor no coincide, SW rechaza con 401/CFDI40140 sin timbrar.
    const isSwSandbox =
      provider.name === 'SW_SAPIEN' &&
      (process.env.SW_SAPIEN_ENV || 'sandbox') !== 'production';
    if (isSwSandbox && payload.Emisor.Rfc !== 'EKU9003173C9') {
      throw new ValidationError(
        `SW Sapien sandbox solo acepta el RFC de prueba EKU9003173C9. ` +
        `Esta empresa emite con ${payload.Emisor.Rfc}. ` +
        `Para timbrado real cambia SW_SAPIEN_ENV=production en el backend y sube tu CSD al vault SW.`
      );
    }

    logger.info(
      `Timbrando factura ${invoiceId} vía ${provider.name} (JSON): ` +
      `${payload.Serie || ''}${payload.Folio || ''} → ${payload.Receptor.Rfc}`
    );
    result = await provider.stampFromJson(payload, credentials);
  } else {
    let xmlContent = invoice.xml_content;
    if (!xmlContent) {
      xmlContent = await cfdiService.generateCFDIXML({ companyId, invoiceId });
    }
    result = await provider.stamp(xmlContent, credentials);
  }

  if (!result.success) {
    logger.error(`Timbrado fallido para factura ${invoiceId}`, { errors: result.errors });
    throw new ValidationError(`Timbrado fallido: ${result.errors.join('; ')}`);
  }

  // Guardar resultado en transacción
  await transaction(async (client) => {
    await transactionQuery(
      client,
      `UPDATE invoices
       SET xml_content = $1,
           cfdi_uuid = $2,
           is_stamped = true,
           status = 'STAMPED',
           pac_timestamp = $3,
           pac_id = $4,
           updated_at = NOW()
       WHERE id = $5 AND company_id = $6`,
      [
        result.xml_stamped,
        result.uuid,
        result.fecha_timbrado,
        provider.name,
        invoiceId,
        companyId,
      ]
    );

    // Registrar timbrado en historial
    await transactionQuery(
      client,
      `INSERT INTO pac_stamps
       (company_id, invoice_id, uuid, provider, sello_sat, sello_cfd,
        no_certificado_sat, fecha_timbrado, qr_code, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        companyId,
        invoiceId,
        result.uuid,
        provider.name,
        result.sello_sat,
        result.sello_cfd,
        result.no_certificado_sat,
        result.fecha_timbrado,
        result.qr_code,
      ]
    );

    // Registrar consumo en stamp_usage + decrementar prepago si es FLEX.
    // Va DENTRO de la TX para que un fallo aquí revierta el UPDATE de invoices
    // (evita quedar con el CFDI marcado STAMPED pero sin contabilizar el timbre).
    await billingService.recordStampUsed(client, {
      companyId,
      invoiceId,
      stampUuid: result.uuid,
    });

    // FASE 3 ALMACEN (§9): descontar inventario en la MISMA TX del timbrado
    // (regla de oro #10 — nunca CFDI timbrado sin su salida de stock).
    // Modo alerta: si falta existencia se descuenta lo disponible y el
    // faltante queda anotado en el kardex.
    const inv = await discountInvoiceStock(client, {
      companyId,
      invoiceId,
      docRef: `${invoice.serie || ''}-${invoice.folio}`,
      userEmail: 'stamp@system',
    });
    if (inv.warnings.length > 0) {
      logger.warn(
        `[inventario] Factura ${invoice.serie}-${invoice.folio} timbrada con faltantes: ${inv.warnings.join(' | ')}`
      );
    }
  });

  // Alertas de prepago (low/zero) — fire-and-forget FUERA de la TX: el
  // timbrado no debe fallar ni retrasarse por un problema de SMTP. El cron
  // horario actúa como red de seguridad si este trigger no llega a enviar.
  import('../billing/billing-alerts.service')
    .then((m) => m.checkPrepaidAlerts(companyId))
    .catch((e) => logger.warn(`Alerta prepago post-timbrado falló: ${e.message}`));

  logger.info(`Factura ${invoice.serie}-${invoice.folio} timbrada. UUID: ${result.uuid}`);

  return result;
}

/**
 * CANCELAR una factura timbrada
 */
export async function cancelInvoice(
  companyId: string,
  invoiceId: string,
  motivo: MotivoCancelacion,
  folioSustitucion?: string,
  /**
   * Si viene true, se salta el PAC y solo se marca CANCELLED en la BD.
   * Útil cuando SW rebota con 404 en sandbox (bug de vault) pero el CFDI
   * existe y el usuario necesita destrabar el flujo. En producción esto
   * dejaria el CFDI vivo en el SAT pero cancelado en el ERP — usar solo
   * para pruebas o casos que requieran intervencion manual con el PAC.
   */
  forceLocal: boolean = false
): Promise<CancelResult> {
  const invoice = await invoicesService.getInvoiceById(companyId, invoiceId);

  if (!invoice.is_stamped || !invoice.cfdi_uuid) {
    throw new ValidationError('Solo se pueden cancelar facturas timbradas');
  }
  // Si ya está cancelada localmente pero el CFDI sigue vivo en el PAC
  // (por bypass forceLocal), permitimos re-enviar la cancelación al PAC
  // sin volver a validar dependientes (ya se validaron la primera vez).
  const isResendToPAC =
    invoice.status === 'CANCELLED' && invoice.pac_id === 'SW_SAPIEN' && !forceLocal;
  if (invoice.status === 'CANCELLED' && !isResendToPAC) {
    throw new ValidationError('La factura ya está cancelada');
  }

  // Regla SAT: no se puede cancelar una factura padre si tiene CFDIs
  // dependientes vigentes (NC o complementos de pago). Primero se cancelan
  // los dependientes desde el modal de Historia, luego la factura.
  // (Skip en resend: los dependientes ya se procesaron.)
  if (!isResendToPAC) {
  const depsR = await query<{ ncs: number; pays: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM credit_notes
         WHERE invoice_id = $1 AND deleted_at IS NULL AND status != 'CANCELLED') AS ncs,
       (SELECT COUNT(*)::int FROM payments
         WHERE invoice_id = $1 AND deleted_at IS NULL AND document_status != 'CANCELLED') AS pays`,
    [invoiceId]
  );
  const { ncs, pays } = depsR.rows[0];
  if (ncs > 0 || pays > 0) {
    const partes: string[] = [];
    if (pays > 0) partes.push(`${pays} complemento(s) de pago`);
    if (ncs > 0)  partes.push(`${ncs} nota(s) de crédito`);
    throw new ValidationError(
      `La factura tiene ${partes.join(' y ')} vigente(s). ` +
      `Cancela primero esos comprobantes desde el ícono de Historia.`
    );
  }
  } // fin if (!isResendToPAC) — bloque de validación de dependientes

  if (!MOTIVOS_CANCELACION[motivo]) {
    throw new ValidationError(
      `Motivo inválido. Válidos: ${Object.keys(MOTIVOS_CANCELACION).join(', ')}`
    );
  }
  // Motivo 01 requiere folio de sustitución
  if (motivo === '01' && !folioSustitucion) {
    throw new ValidationError('El motivo 01 requiere el folio fiscal de sustitución');
  }

  // RFC emisor REAL de la empresa. Antes venía hardcodeado como
  // 'ABC010101ABC' (placeholder) y por eso SW respondia 404: buscaba
  // ese RFC inexistente en su vault.
  const compR = await query<{ rfc: string }>(
    `SELECT rfc FROM companies WHERE id = $1`,
    [companyId]
  );
  const rfcEmisor = compR.rows[0]?.rfc;
  if (!rfcEmisor) {
    throw new ValidationError('La empresa emisora no tiene RFC configurado');
  }

  // Si la factura fue timbrada con MOCK (pac_id='MOCK'), o el usuario
  // fuerza cancelación local (forceLocal=true después de 404 de sandbox),
  // solo marcamos en BD sin llamar al PAC.
  const provider = getProvider();
  const skipPac =
    forceLocal || (invoice.pac_id === 'MOCK' && provider.name !== 'MOCK');
  if (skipPac) {
    await transaction(async (client) => {
      await transactionQuery(
        client,
        `UPDATE invoices SET status = 'CANCELLED', updated_at = NOW()
          WHERE id = $1 AND company_id = $2`,
        [invoiceId, companyId]
      );
      // FASE 3 ALMACEN (§9): devolver al inventario lo que la venta descontó
      const restored = await restoreInvoiceStock(client, {
        companyId, invoiceId,
        docRef: `${invoice.serie || ''}-${invoice.folio}`,
        userEmail: 'cancel@system',
      });
      if (restored > 0) {
        logger.info(`[inventario] Cancelación devolvió ${restored} producto(s) al stock`);
      }
    });
    logger.info(
      `Factura ${invoice.serie}-${invoice.folio} cancelada localmente ` +
      `(${forceLocal ? 'force=true' : 'pac_id=MOCK'}). PAC no invocado.`
    );
    return {
      success: true,
      uuid: invoice.cfdi_uuid,
      status: 'CANCELLED' as const,
      fecha_cancelacion: new Date().toISOString(),
      errors: [],
    };
  }

  const credentials = getCredentials(companyId);
  const result = await provider.cancel(invoice.cfdi_uuid, rfcEmisor, motivo, credentials);

  if (!result.success) {
    throw new ValidationError(`Cancelación fallida: ${result.errors.join('; ')}`);
  }

  // Solo actualizamos la BD si aún no está cancelada. En modo resend
  // ya está CANCELLED y solo queríamos notificar al PAC.
  if (!isResendToPAC) {
    await transaction(async (client) => {
      await transactionQuery(
        client,
        `UPDATE invoices SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1 AND company_id = $2`,
        [invoiceId, companyId]
      );
      // FASE 3 ALMACEN (§9): devolver al inventario lo que la venta descontó
      // (el guard interno evita doble devolución en reintentos)
      const restored = await restoreInvoiceStock(client, {
        companyId, invoiceId,
        docRef: `${invoice.serie || ''}-${invoice.folio}`,
        userEmail: 'cancel@system',
      });
      if (restored > 0) {
        logger.info(`[inventario] Cancelación devolvió ${restored} producto(s) al stock`);
      }
    });
  }

  logger.info(
    `Factura ${invoice.serie}-${invoice.folio} cancelada${isResendToPAC ? ' (resend al PAC)' : ''}. ` +
    `Motivo: ${motivo}`
  );

  return result;
}

/**
 * Estado de cuenta del PAC (timbres disponibles)
 */
export async function getAccountStatus(companyId: string) {
  const provider = getProvider();
  const credentials = getCredentials(companyId);
  return provider.getAccountStatus(credentials);
}

/**
 * Probar conexión con el PAC
 */
export async function testConnection(companyId: string): Promise<boolean> {
  const provider = getProvider();
  const credentials = getCredentials(companyId);
  return provider.testConnection(credentials);
}

/**
 * Listar providers disponibles
 */
export function listProviders(): { active: string; available: string[] } {
  return {
    active: DEFAULT_PROVIDER,
    available: Object.keys(providers),
  };
}

export default {
  stampInvoice,
  cancelInvoice,
  getAccountStatus,
  testConnection,
  listProviders,
};
