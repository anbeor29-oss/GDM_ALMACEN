/**
 * envio-recibos.service — manda el recibo de nómina TIMBRADO al trabajador.
 *
 * POR QUÉ EXISTE
 * El recibo se marcaba para correo («enviar_por_correo») y ahí se quedaba:
 * `enviado_at` no lo escribía nadie porque no había envío. La decisión estaba
 * tomada y el correo nunca salía. Esto es la otra mitad.
 *
 * MARCAR Y MANDAR SIGUEN SIENDO DOS ACTOS
 * Se marca antes de timbrar, para revisar a quién se le va; se manda después,
 * cuando el CFDI ya existe. Aquí sólo se manda lo TIMBRADO: un pre-timbre no
 * ampara ningún pago y mandarlo invita al trabajador a guardarlo como si sí.
 *
 * EL CORREO DEL TRABAJADOR
 * El recibo guarda una FOTO del correo al momento del cierre. Si el expediente
 * se completó después, esa foto está vacía mientras el expediente ya tiene el
 * dato: por eso se resuelve `recibo.correo` → `empleado.email` y se puede
 * capturar aquí mismo, que es donde se descubre que falta.
 */
import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import { sendInvoiceMail, explicarErrorSmtp } from '../mailer/mailer.service';
import { revisarDireccion } from '../mailer/direccion-correo';
import { fechaMx } from '../../utils/fecha-mx';

const CORREO_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface FilaEnvio {
  id: string;
  num_empleado: string;
  nombre: string;
  rfc: string;
  neto: number;
  uuid: string | null;
  correo: string | null;
  correo_expediente: string | null;
  enviar_por_correo: boolean;
  enviado_at: string | null;
  enviado_error: string | null;
  periodo_label: string;
}

/** Etiqueta legible del periodo, para el asunto y el cuerpo del correo. */
function etiquetaPeriodo(p: {
  tipo?: string; numero?: number; anio?: number; concepto?: string;
  fecha_inicio?: string; fecha_fin?: string;
}): string {
  if (p.tipo === 'ESPECIAL' && p.concepto) return `${p.concepto} ${p.anio || ''}`.trim();
  const rango = p.fecha_inicio && p.fecha_fin
    ? ` (${fechaMx(p.fecha_inicio)} al ${fechaMx(p.fecha_fin)})`
    : '';
  return `periodo ${p.numero ?? ''}/${p.anio ?? ''}${rango}`;
}

/**
 * Los recibos de un periodo con lo que hace falta para decidir el envío:
 * si están timbrados, a qué correo irían y si ya se mandaron.
 */
export async function listaDeEnvio(companyId: string, periodoId?: string): Promise<FilaEnvio[]> {
  const cond = ['r.company_id = $1', 'r.uuid IS NOT NULL'];
  const args: any[] = [companyId];
  if (periodoId) { args.push(periodoId); cond.push(`r.periodo_id = $${args.length}`); }

  const r = await query<any>(
    `SELECT r.id, r.num_empleado, r.nombre, r.rfc, r.neto, r.uuid,
            r.correo, e.email AS correo_expediente,
            r.enviar_por_correo, r.enviado_error,
            TO_CHAR(r.enviado_at, 'YYYY-MM-DD HH24:MI') AS enviado_at,
            p.tipo, p.numero, p.anio, p.concepto,
            TO_CHAR(p.fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,
            TO_CHAR(p.fecha_fin,'YYYY-MM-DD')    AS fecha_fin
       FROM nomina_recibos r
       JOIN nomina_periodos p ON p.id = r.periodo_id
       LEFT JOIN nomina_empleados e ON e.id = r.empleado_id
      WHERE ${cond.join(' AND ')}
      ORDER BY p.anio DESC, p.numero DESC, r.num_empleado`,
    args
  );
  return r.rows.map((x: any) => ({
    id: x.id, num_empleado: x.num_empleado, nombre: x.nombre, rfc: x.rfc,
    neto: Number(x.neto || 0), uuid: x.uuid,
    correo: x.correo || null, correo_expediente: x.correo_expediente || null,
    enviar_por_correo: x.enviar_por_correo === true,
    enviado_at: x.enviado_at || null, enviado_error: x.enviado_error || null,
    periodo_label: etiquetaPeriodo(x),
  }));
}

/**
 * Captura o corrige el correo de un trabajador DESDE la pantalla de recibos.
 *
 * Escribe en los dos lados a propósito: en el recibo, para que este envío salga;
 * y en el expediente, para que el del mes que entra ya no falte. Corregirlo sólo
 * en el recibo es volver a capturarlo cada periodo.
 */
export async function setCorreoTrabajador(companyId: string, reciboId: string, correo: string) {
  const c = String(correo || '').trim().toLowerCase();
  if (c && !CORREO_OK.test(c)) throw new ValidationError('Ese correo no es válido.');
  /* Se revisa AL CAPTURAR, que es cuando la persona lo tiene enfrente y puede
   * corregirlo. Descubrirlo hasta el envío significa un recibo que no salió y
   * un rebote. `hotmail.ocm` pasa la sintaxis sin problema: el dedazo sólo se
   * ve preguntándole al DNS si ese dominio existe. */
  if (c) {
    const rev = await revisarDireccion(c);
    if (!rev.ok) throw new ValidationError(rev.motivo || 'Ese correo no es válido.');
  }
  const r = await query<{ empleado_id: string }>(
    `UPDATE nomina_recibos SET correo = $3 WHERE id = $1 AND company_id = $2 RETURNING empleado_id`,
    [reciboId, companyId, c || null]);
  if (!r.rows.length) throw new NotFoundError('Ese recibo no existe en esta empresa.');
  if (r.rows[0].empleado_id) {
    await query(`UPDATE nomina_empleados SET email = $3 WHERE id = $1 AND company_id = $2`,
      [r.rows[0].empleado_id, companyId, c || null]);
  }
  return { correo: c || null };
}

export interface ResultadoEnvio {
  enviados: number;
  fallidos: number;
  omitidos: number;
  detalle: Array<{
    id: string; num_empleado: string; nombre: string; correo?: string;
    estado: 'ENVIADO' | 'FALLO' | 'OMITIDO'; mensaje?: string;
  }>;
}

/**
 * Manda los recibos indicados (o todos los MARCADOS del periodo) con su PDF y su
 * XML timbrado. Un fallo no detiene a los demás: cada trabajador es un correo
 * aparte y que el buzón de uno rebote no es razón para no mandarle al resto.
 */
export async function enviarRecibos(
  companyId: string,
  opts: { ids?: string[]; periodoId?: string; reenviar?: boolean; textoAdicional?: string },
): Promise<ResultadoEnvio> {
  const ids = Array.isArray(opts.ids) ? opts.ids.filter(Boolean) : [];
  if (!ids.length && !opts.periodoId) {
    throw new ValidationError('Indica los recibos a enviar o el periodo completo.');
  }

  const cond = ['r.company_id = $1', 'r.uuid IS NOT NULL'];
  const args: any[] = [companyId];
  if (ids.length) { args.push(ids); cond.push(`r.id = ANY($${args.length}::uuid[])`); }
  else {
    args.push(opts.periodoId); cond.push(`r.periodo_id = $${args.length}`);
    cond.push('r.enviar_por_correo = TRUE');   // el periodo completo = sólo lo MARCADO
  }

  const r = await query<any>(
    `SELECT r.id, r.num_empleado, r.nombre, r.correo, r.enviado_at, r.empleado_id,
            e.email AS correo_expediente,
            p.tipo, p.numero, p.anio, p.concepto,
            TO_CHAR(p.fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,
            TO_CHAR(p.fecha_fin,'YYYY-MM-DD')    AS fecha_fin,
            TO_CHAR(p.fecha_pago,'YYYY-MM-DD')   AS fecha_pago
       FROM nomina_recibos r
       JOIN nomina_periodos p ON p.id = r.periodo_id
       LEFT JOIN nomina_empleados e ON e.id = r.empleado_id
      WHERE ${cond.join(' AND ')}
      ORDER BY r.num_empleado`,
    args
  );
  if (!r.rows.length) {
    throw new ValidationError(
      'No hay recibos TIMBRADOS que mandar. Sólo se manda lo timbrado: un pre-timbre no ampara el pago.'
    );
  }

  const emp = await query<{ business_name: string }>(
    `SELECT business_name FROM companies WHERE id = $1`, [companyId]);
  const empresa = emp.rows[0]?.business_name || 'tu empresa';

  const out: ResultadoEnvio = { enviados: 0, fallidos: 0, omitidos: 0, detalle: [] };

  for (const rec of r.rows) {
    const base = { id: rec.id, num_empleado: rec.num_empleado, nombre: rec.nombre };

    if (rec.enviado_at && !opts.reenviar) {
      out.omitidos++;
      out.detalle.push({ ...base, estado: 'OMITIDO', mensaje: 'Ya se le había mandado; marca «reenviar» para repetirlo.' });
      continue;
    }

    // El recibo guarda la foto del correo al cierre; si está vacía, vale la del
    // expediente —que pudo capturarse después— y se deja asentada en el recibo.
    const correo = String(rec.correo || rec.correo_expediente || '').trim().toLowerCase();
    if (!correo || !CORREO_OK.test(correo)) {
      out.omitidos++;
      out.detalle.push({ ...base, estado: 'OMITIDO', mensaje: 'Sin correo en el expediente.' });
      continue;
    }

    /* Antes de gastar el envío: si el dominio no existe, no hay a dónde
     * entregar. Se marca como FALLO con el motivo en claro —y con la corrección
     * si el dominio se parece a uno conocido— en vez de dejar que el servidor
     * conteste un 550 de cuatro renglones que nadie descifra. */
    const rev = await revisarDireccion(correo);
    if (!rev.ok) {
      const msg = rev.motivo || 'El correo no es válido.';
      await query(`UPDATE nomina_recibos SET enviado_error = $2 WHERE id = $1`, [rec.id, msg]);
      out.fallidos++;
      out.detalle.push({ ...base, correo, estado: 'FALLO', mensaje: msg });
      logger.warn(`[nomina] recibo ${rec.num_empleado}: ${correo} no se intentó - ${msg}`);
      continue;
    }

    const etiqueta = etiquetaPeriodo(rec);
    const saludo = `Hola ${rec.nombre}:`;
    const cuerpo =
      `Adjuntamos tu recibo de nómina del ${etiqueta}` +
      (rec.fecha_pago ? `, pagado el ${fechaMx(rec.fecha_pago)}` : '') + '.';
    const nota =
      'Van el PDF para leerlo y el XML timbrado, que es el comprobante fiscal ante el SAT. Guarda los dos.';

    try {
      await sendInvoiceMail({
        companyId,
        to: correo,
        subject: `Recibo de nómina · ${etiqueta} — ${empresa}`,
        message: [saludo, cuerpo, nota].join('\n\n'),
        attachments: [
          { kind: 'nomina_pdf', id: rec.id },
          { kind: 'nomina_xml', id: rec.id },
        ],
        textoAdicional: opts.textoAdicional,
        // Un recibo de nómina no se le cobra a nadie: el bloque de depósito no pinta aquí.
        incluirDeposito: false,
      });
      await query(
        `UPDATE nomina_recibos SET enviado_at = NOW(), correo = $2, enviado_error = NULL WHERE id = $1`,
        [rec.id, correo]);
      out.enviados++;
      out.detalle.push({ ...base, correo, estado: 'ENVIADO' });
    } catch (e: any) {
      /* Traducido, no crudo: el 550 de un servidor viene en inglés y en cuatro
       * renglones de jerga. Quien manda la nómina necesita saber QUÉ ARREGLAR. */
      const msg = explicarErrorSmtp(e) || e?.message || 'No se pudo enviar.';
      // Se guarda el porqué: sin esto, el siguiente intento repite el error a ciegas.
      await query(`UPDATE nomina_recibos SET enviado_error = $2 WHERE id = $1`, [rec.id, msg]);
      out.fallidos++;
      out.detalle.push({ ...base, correo, estado: 'FALLO', mensaje: msg });
      logger.warn(`[nomina] recibo ${rec.num_empleado} a ${correo} fallo - ${msg}`);
    }
  }

  logger.info(
    `[nomina] envio de recibos: ${out.enviados} enviados, ${out.fallidos} fallidos, ` +
    `${out.omitidos} omitidos (${empresa})`);
  return out;
}
