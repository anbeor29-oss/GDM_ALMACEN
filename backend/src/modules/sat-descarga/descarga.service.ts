/**
 * descarga.service — el motor: pide, espera, recoge, indexa.
 *
 * CÓMO AVANZA
 * El trabajo NO se hace en una llamada. Una descarga de un año son decenas de
 * solicitudes que el SAT procesa en minutos u horas, y el proceso tiene que
 * sobrevivir a reinicios. Por eso todo el estado vive en la base y el motor
 * avanza a pasos: cada corrida hace un poco y deja escrito dónde se quedó.
 *
 * EL ORDEN DE PRIORIDADES NO ES CAPRICHOSO (§8)
 *   1. Descargar paquetes ya listos — vencen a las 72 horas.
 *   2. Verificar solicitudes viejas — para liberar paquetes.
 *   3. Mandar solicitudes nuevas — lo último: crear más trabajo cuando hay
 *      paquetes por vencer es la forma más fácil de perderlos.
 *
 * PARTICIÓN ADAPTATIVA (§5)
 * Se empieza por bloques de 7 días. Cuando el SAT responde 5003 —"pasa del tope
 * de elementos"— el bloque se parte a la mitad y se reintentan las dos mitades.
 * Se corta a los 4 niveles: de 7 días a ~10 horas. Más abajo el problema deja
 * de ser el tamaño y hay que mirarlo a mano, en vez de inundar al SAT con
 * cientos de solicitudes diminutas.
 *
 * NUNCA SE MANDA DOS VECES LA MISMA SOLICITUD
 * Cada partición lleva una huella de sus parámetros. El SAT rechaza duplicados
 * y penaliza al insistente; además, dos solicitudes iguales devolverían los
 * mismos CFDI y el trabajo parecería avanzar el doble de lo que avanza.
 */

import * as crypto from 'crypto';
import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import * as boveda from './boveda';
import * as soap from './soap';
import { extraerXml, ZipSospechoso } from './zip-seguro';
import { validarEfirma } from './efirma';

/** Días del primer corte. El documento sugiere 7 para volumen desconocido. */
const DIAS_INICIALES = 7;
/** Hasta dónde se parte antes de pedir revisión humana. */
const PROFUNDIDAD_MAXIMA = 4;
/** Cuántas particiones y paquetes se atienden por corrida. */
const POR_CORRIDA = { paquetes: 5, verificaciones: 10, solicitudes: 5 };

/* Espera exponencial del documento (§7), con un poco de azar para que dos
 * procesos no consulten al SAT en el mismo instante. */
const ESPERAS_SEG = [30, 60, 120, 300, 900];
function proximaConsulta(intentos: number): Date {
  const base = ESPERAS_SEG[Math.min(intentos, ESPERAS_SEG.length - 1)];
  const jitter = Math.floor(Math.random() * Math.min(30, base * 0.2));
  return new Date(Date.now() + (base + jitter) * 1000);
}

/* ─────────────────────────  CREDENCIALES  ───────────────────────── */

export async function guardarCredencial(
  companyId: string,
  datos: { cer: Buffer; key: Buffer; password: string; borrarAlTerminar?: boolean },
  userId?: string
): Promise<any> {
  /* Se valida ANTES de cifrar y guardar: una e.firma vencida o un CSD subido por
   * error se rechazan aquí, con su motivo, y no en la primera solicitud al SAT
   * —donde el error sería un código 305 sin contexto. */
  const info = validarEfirma(datos.cer, datos.key, datos.password);

  const r = await query<any>(
    `INSERT INTO sat_credenciales
       (company_id, rfc, numero_serie, vigencia_desde, vigencia_hasta,
        cer_cifrado, key_cifrado, password_cifrado, borrar_al_terminar, cargada_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (company_id, rfc) DO UPDATE SET
       numero_serie = EXCLUDED.numero_serie,
       vigencia_desde = EXCLUDED.vigencia_desde,
       vigencia_hasta = EXCLUDED.vigencia_hasta,
       cer_cifrado = EXCLUDED.cer_cifrado,
       key_cifrado = EXCLUDED.key_cifrado,
       password_cifrado = EXCLUDED.password_cifrado,
       borrar_al_terminar = EXCLUDED.borrar_al_terminar,
       estado = 'ACTIVA',
       updated_at = NOW()
     RETURNING id, rfc, numero_serie, vigencia_desde, vigencia_hasta, estado`,
    [companyId, info.rfc, info.numeroSerie, info.vigenciaDesde, info.vigenciaHasta,
     boveda.cifrar(datos.cer), boveda.cifrar(datos.key), boveda.cifrar(datos.password),
     datos.borrarAlTerminar !== false, userId || null]
  );

  /* Se registra el RFC y la vigencia. Jamás la contraseña ni un fragmento de la
   * llave, ni siquiera su longitud. */
  logger.info(`[sat-descarga] e.firma de ${info.rfc} guardada, vence ${info.vigenciaHasta.toISOString().slice(0, 10)}`);
  return { ...r.rows[0], nombre: info.nombre };
}

/** Lo que la pantalla puede saber: nunca los archivos. */
export async function credencialDeEmpresa(companyId: string): Promise<any | null> {
  const r = await query<any>(
    `SELECT id, rfc, numero_serie, vigencia_desde, vigencia_hasta, estado,
            borrar_al_terminar, created_at,
            (vigencia_hasta < NOW()) AS vencida
       FROM sat_credenciales
      WHERE company_id = $1 AND estado <> 'BORRADA'
      ORDER BY created_at DESC LIMIT 1`,
    [companyId]
  );
  return r.rows[0] || null;
}

export async function borrarCredencial(companyId: string): Promise<void> {
  await query(
    `UPDATE sat_credenciales
        SET estado = 'BORRADA', cer_cifrado = '', key_cifrado = '', password_cifrado = '',
            updated_at = NOW()
      WHERE company_id = $1 AND estado <> 'BORRADA'`,
    [companyId]
  );
  logger.info(`[sat-descarga] e.firma borrada de la empresa ${companyId}`);
}

async function credencialUsable(companyId: string): Promise<soap.Credencial> {
  const r = await query<any>(
    `SELECT rfc, cer_cifrado, key_cifrado, password_cifrado, vigencia_hasta
       FROM sat_credenciales
      WHERE company_id = $1 AND estado = 'ACTIVA'
      ORDER BY created_at DESC LIMIT 1`,
    [companyId]
  );
  const c = r.rows[0];
  if (!c || !c.cer_cifrado) {
    throw new ValidationError(
      'Esta empresa no tiene e.firma cargada. La descarga masiva la exige: es el ' +
      'único modo en que el SAT acepta que alguien pida sus comprobantes.'
    );
  }
  if (new Date(c.vigencia_hasta) < new Date()) {
    await query(`UPDATE sat_credenciales SET estado = 'VENCIDA' WHERE company_id = $1`, [companyId]);
    throw new ValidationError(
      `La e.firma venció el ${new Date(c.vigencia_hasta).toLocaleDateString('es-MX')}. ` +
      'Renuévala en el portal del SAT y vuelve a cargarla.'
    );
  }
  return {
    rfc: c.rfc,
    cer: boveda.descifrar(c.cer_cifrado),
    key: boveda.descifrar(c.key_cifrado),
    password: boveda.descifrarTexto(c.password_cifrado),
  };
}

/* ─────────────────────────  TRABAJOS Y PARTICIONES  ───────────────────────── */

function huella(rfc: string, desde: Date, hasta: Date, d: any): string {
  const partes = [
    rfc, desde.toISOString(), hasta.toISOString(), d.direccion, d.tipo,
    d.filtros?.rfcEmisor || '', d.filtros?.rfcReceptor || '',
    d.filtros?.tipoComprobante || '', d.filtros?.estadoComprobante || '',
  ].join('|');
  return crypto.createHash('sha256').update(partes).digest('hex').slice(0, 64);
}

export async function crearTrabajo(
  companyId: string,
  d: {
    desde: string; hasta: string;
    direccion: 'recibidos' | 'emitidos';
    tipo?: 'CFDI' | 'Metadata';
    filtros?: any;
  },
  userId?: string
): Promise<any> {
  const desde = new Date(d.desde + 'T00:00:00');
  const hasta = new Date(d.hasta + 'T23:59:59');
  if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) {
    throw new ValidationError('Las fechas no son válidas.');
  }
  if (hasta < desde) throw new ValidationError('La fecha final es anterior a la inicial.');

  const cred = await credencialUsable(companyId);   // valida antes de crear nada
  const tipo = d.tipo === 'Metadata' ? 'Metadata' : 'CFDI';

  return transaction(async (client) => {
    const t = await transactionQuery<any>(
      client,
      `INSERT INTO sat_trabajos
         (company_id, rfc, fecha_desde, fecha_hasta, direccion, tipo, filtros, creado_por)
       VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8)
       RETURNING *`,
      [companyId, cred.rfc, d.desde, d.hasta, d.direccion, tipo,
       d.filtros ? JSON.stringify(d.filtros) : null, userId || null]
    );
    const trabajo = t.rows[0];

    /* Bloques de 7 días. Emitidos y recibidos van en trabajos distintos, y CFDI
     * y metadatos también: el SAT los cuenta por separado y mezclarlos en una
     * solicitud es la forma más rápida de topar el límite. */
    let cursor = new Date(desde);
    let n = 0;
    while (cursor <= hasta) {
      const fin = new Date(cursor);
      fin.setDate(fin.getDate() + DIAS_INICIALES);
      fin.setSeconds(fin.getSeconds() - 1);
      const finReal = fin > hasta ? hasta : fin;

      await transactionQuery(
        client,
        `INSERT INTO sat_particiones (trabajo_id, desde, hasta, profundidad, huella)
         VALUES ($1,$2,$3,0,$4)
         ON CONFLICT (trabajo_id, huella) DO NOTHING`,
        [trabajo.id, cursor, finReal,
         huella(cred.rfc, cursor, finReal, { ...d, tipo })]
      );
      n++;
      cursor = new Date(finReal.getTime() + 1000);
    }

    await transactionQuery(
      client,
      `UPDATE sat_trabajos SET particiones_total = $1, estado = 'EN_PROCESO', iniciado_at = NOW()
        WHERE id = $2`,
      [n, trabajo.id]
    );
    logger.info(`[sat-descarga] trabajo ${trabajo.id} creado: ${n} partición(es) de ${DIAS_INICIALES} días`);
    return { ...trabajo, particiones_total: n };
  });
}

/**
 * Un paso del motor. Devuelve qué hizo, para que la pantalla lo muestre.
 *
 * Se llama desde el cron y también desde el botón "Avanzar ahora": la misma
 * función, porque tener dos caminos para lo mismo garantiza que uno de los dos
 * se quede atrás.
 */
export async function avanzar(companyId: string, trabajoId?: string): Promise<any> {
  const cred = await credencialUsable(companyId);
  const token = await soap.autenticar(cred);
  const hecho = { descargados: 0, verificados: 0, solicitados: 0, divididos: 0, errores: [] as string[] };

  const filtroTrabajo = trabajoId ? 'AND t.id = $2' : '';
  const params: any[] = trabajoId ? [companyId, trabajoId] : [companyId];

  // ── 1. Paquetes listos: vencen a las 72 h, van primero ────────────────
  const paquetes = await query<any>(
    `SELECT p.id, p.id_paquete_sat, p.particion_id, t.company_id, t.id AS trabajo_id, t.direccion
       FROM sat_paquetes p
       JOIN sat_particiones pa ON pa.id = p.particion_id
       JOIN sat_trabajos t ON t.id = pa.trabajo_id
      WHERE t.company_id = $1 ${filtroTrabajo}
        AND p.estado IN ('PENDIENTE', 'DESCARGANDO')
        AND p.intentos < 8
      ORDER BY p.created_at ASC
      LIMIT ${POR_CORRIDA.paquetes}`,
    params
  );
  for (const p of paquetes.rows) {
    try {
      await descargarPaquete(cred, token, p);
      hecho.descargados++;
    } catch (e) {
      hecho.errores.push(`paquete ${p.id_paquete_sat}: ${(e as Error).message}`);
    }
  }

  // ── 2. Solicitudes en curso ───────────────────────────────────────────
  const enCurso = await query<any>(
    `SELECT pa.*, t.company_id
       FROM sat_particiones pa
       JOIN sat_trabajos t ON t.id = pa.trabajo_id
      WHERE t.company_id = $1 ${filtroTrabajo}
        AND pa.estado IN ('SOLICITADA', 'EN_PROCESO')
        AND (pa.proxima_consulta_at IS NULL OR pa.proxima_consulta_at <= NOW())
      ORDER BY pa.proxima_consulta_at ASC NULLS FIRST
      LIMIT ${POR_CORRIDA.verificaciones}`,
    params
  );
  for (const pa of enCurso.rows) {
    try {
      await verificarParticion(cred, token, pa);
      hecho.verificados++;
    } catch (e) {
      hecho.errores.push(`verificación ${pa.id_solicitud_sat}: ${(e as Error).message}`);
    }
  }

  // ── 3. Solicitudes nuevas, al final ───────────────────────────────────
  const pendientes = await query<any>(
    `SELECT pa.*, t.direccion, t.tipo, t.filtros, t.company_id
       FROM sat_particiones pa
       JOIN sat_trabajos t ON t.id = pa.trabajo_id
      WHERE t.company_id = $1 ${filtroTrabajo}
        AND pa.estado = 'PENDIENTE'
        AND (pa.proxima_consulta_at IS NULL OR pa.proxima_consulta_at <= NOW())
      ORDER BY pa.desde ASC
      LIMIT ${POR_CORRIDA.solicitudes}`,
    params
  );
  for (const pa of pendientes.rows) {
    try {
      const r = await solicitarParticion(cred, token, pa);
      if (r === 'dividida') hecho.divididos++; else hecho.solicitados++;
    } catch (e) {
      hecho.errores.push(`solicitud ${pa.id}: ${(e as Error).message}`);
    }
  }

  await actualizarTotales(companyId, trabajoId);
  return hecho;
}

async function solicitarParticion(
  cred: soap.Credencial, token: soap.Token, pa: any
): Promise<'solicitada' | 'dividida' | 'sin_datos' | 'fallida'> {
  const filtros = pa.filtros || {};
  const r = await soap.solicitar(cred, token, {
    desde: new Date(pa.desde),
    hasta: new Date(pa.hasta),
    direccion: pa.direccion,
    tipo: pa.tipo,
    ...filtros,
  });

  const guardar = (estado: string, extra: Record<string, any> = {}) => query(
    `UPDATE sat_particiones
        SET estado = $1, codigo_sat = $2, mensaje_sat = $3,
            id_solicitud_sat = COALESCE($4, id_solicitud_sat),
            intentos = intentos + 1,
            proxima_consulta_at = $5,
            updated_at = NOW()
      WHERE id = $6`,
    [estado, r.codigo, r.mensaje?.slice(0, 500) || null,
     extra.idSolicitud || null, extra.proxima || null, pa.id]
  );

  switch (r.codigo) {
    case '5000':                                        // aceptada
      await guardar('SOLICITADA', { idSolicitud: r.idSolicitud, proxima: proximaConsulta(0) });
      return 'solicitada';

    case '5005':                                        // ya había una igual viva
      /* No es un error: el SAT dice "esa solicitud ya existe". Se engancha a la
       * que ya está en vuelo en vez de insistir, que es lo que pide §7. */
      await guardar('SOLICITADA', { idSolicitud: r.idSolicitud, proxima: proximaConsulta(1) });
      return 'solicitada';

    case '5004':                                        // sin información
      await guardar('SIN_DATOS');
      return 'sin_datos';

    case '5003':                                        // pasa del tope: partir
      return (await dividir(pa)) ? 'dividida' : 'fallida';

    default:
      if (r.codigo === '5002') {
        /* "Se agotó el límite de solicitudes" — no se reintenta en un rato. */
        await guardar('PENDIENTE', { proxima: new Date(Date.now() + 60 * 60_000) });
        return 'fallida';
      }
      await guardar(pa.intentos >= 7 ? 'FALLIDA' : 'PENDIENTE', { proxima: proximaConsulta(pa.intentos + 1) });
      return 'fallida';
  }
}

/** Parte la partición en dos mitades. Devuelve false si ya no se puede partir. */
async function dividir(pa: any): Promise<boolean> {
  if (pa.profundidad >= PROFUNDIDAD_MAXIMA) {
    await query(
      `UPDATE sat_particiones
          SET estado = 'FALLIDA',
              mensaje_sat = 'El rango ya se partió cuatro veces y el SAT sigue diciendo que excede el tope. Revísalo a mano: probablemente convenga filtrar por tipo de comprobante.'
        WHERE id = $1`,
      [pa.id]
    );
    return false;
  }

  const desde = new Date(pa.desde);
  const hasta = new Date(pa.hasta);
  const medio = new Date((desde.getTime() + hasta.getTime()) / 2);

  const trabajo = await query<any>(
    `SELECT t.rfc, t.direccion, t.tipo, t.filtros FROM sat_trabajos t WHERE t.id = $1`,
    [pa.trabajo_id]
  );
  const t = trabajo.rows[0];

  await transaction(async (client) => {
    for (const [a, b] of [[desde, medio], [new Date(medio.getTime() + 1000), hasta]]) {
      await transactionQuery(
        client,
        `INSERT INTO sat_particiones (trabajo_id, desde, hasta, profundidad, huella)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (trabajo_id, huella) DO NOTHING`,
        [pa.trabajo_id, a, b, pa.profundidad + 1,
         huella(t.rfc, a, b, { direccion: t.direccion, tipo: t.tipo, filtros: t.filtros })]
      );
    }
    await transactionQuery(
      client,
      `UPDATE sat_particiones SET estado = 'DIVIDIDA', codigo_sat = '5003',
              mensaje_sat = 'El rango excedía el tope del SAT: se partió a la mitad.',
              updated_at = NOW()
        WHERE id = $1`,
      [pa.id]
    );
    await transactionQuery(
      client,
      `UPDATE sat_trabajos SET particiones_total = particiones_total + 1 WHERE id = $1`,
      [pa.trabajo_id]
    );
  });

  logger.info(`[sat-descarga] partición ${pa.id} dividida (nivel ${pa.profundidad + 1})`);
  return true;
}

async function verificarParticion(cred: soap.Credencial, token: soap.Token, pa: any): Promise<void> {
  const v = await soap.verificar(cred, token, pa.id_solicitud_sat);

  if (v.estadoSolicitud === 'TERMINADA') {
    await transaction(async (client) => {
      for (const idPaquete of v.paquetes) {
        await transactionQuery(
          client,
          `INSERT INTO sat_paquetes (particion_id, id_paquete_sat, vence_at)
           VALUES ($1, $2, NOW() + INTERVAL '72 hours')
           ON CONFLICT (particion_id, id_paquete_sat) DO NOTHING`,
          [pa.id, idPaquete]
        );
      }
      await transactionQuery(
        client,
        `UPDATE sat_particiones
            SET estado = 'TERMINADA', cfdi_contados = $1, codigo_sat = $2,
                mensaje_sat = $3, updated_at = NOW()
          WHERE id = $4`,
        [v.numeroCfdis, v.codigo, v.mensaje?.slice(0, 500) || null, pa.id]
      );
      await transactionQuery(
        client,
        `UPDATE sat_trabajos SET paquetes_total = paquetes_total + $1 WHERE id = $2`,
        [v.paquetes.length, pa.trabajo_id]
      );
    });
    logger.info(`[sat-descarga] solicitud ${pa.id_solicitud_sat}: ${v.numeroCfdis} CFDI en ${v.paquetes.length} paquete(s)`);
    return;
  }

  if (v.estadoSolicitud === 'VENCIDA') {
    /* Los paquetes vencen a las 72 h. Se vuelve a poner PENDIENTE con una huella
     * nueva —el rango es el mismo pero la solicitud vieja ya no sirve— para que
     * el trabajo no se quede a medias sin que nadie lo note. */
    await query(
      `UPDATE sat_particiones
          SET estado = 'PENDIENTE', id_solicitud_sat = NULL,
              mensaje_sat = 'La solicitud venció antes de que se recogieran sus paquetes. Se volverá a pedir.',
              proxima_consulta_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [pa.id]
    );
    return;
  }

  if (['ERROR', 'RECHAZADA'].includes(v.estadoSolicitud)) {
    await query(
      `UPDATE sat_particiones
          SET estado = 'RECHAZADA', codigo_sat = $1, mensaje_sat = $2, updated_at = NOW()
        WHERE id = $3`,
      [v.codigoSolicitud, v.mensaje?.slice(0, 500) || 'El SAT rechazó la solicitud.', pa.id]
    );
    return;
  }

  // Aceptada o en proceso: se vuelve a preguntar más tarde.
  await query(
    `UPDATE sat_particiones
        SET estado = 'EN_PROCESO', intentos = intentos + 1,
            proxima_consulta_at = $1, updated_at = NOW()
      WHERE id = $2`,
    [proximaConsulta(pa.intentos + 1), pa.id]
  );
}

async function descargarPaquete(cred: soap.Credencial, token: soap.Token, p: any): Promise<void> {
  await query(`UPDATE sat_paquetes SET estado = 'DESCARGANDO', intentos = intentos + 1 WHERE id = $1`, [p.id]);

  const r = await soap.descargar(cred, token, p.id_paquete_sat);
  if (!r.zip?.length) {
    await query(
      `UPDATE sat_paquetes SET estado = 'PENDIENTE', mensaje = $1 WHERE id = $2`,
      [`El SAT no devolvió contenido (${r.codigo} ${r.mensaje})`.slice(0, 300), p.id]
    );
    return;
  }

  const sha = crypto.createHash('sha256').update(r.zip).digest('hex');
  let archivos;
  try {
    archivos = extraerXml(r.zip);
  } catch (e) {
    /* Un paquete que no se puede abrir NO se reintenta en bucle: se marca y se
     * dice por qué. Reintentar un ZIP corrupto sólo gasta cuota. */
    await query(
      `UPDATE sat_paquetes SET estado = 'FALLIDO', sha256 = $1, bytes = $2, mensaje = $3 WHERE id = $4`,
      [sha, r.zip.length,
       (e instanceof ZipSospechoso ? e.message : `No se pudo abrir el paquete: ${(e as Error).message}`).slice(0, 300),
       p.id]
    );
    return;
  }

  let guardados = 0;
  for (const a of archivos) {
    if (!/\.xml$/i.test(a.nombre)) continue;      // los .txt son metadatos: otro camino
    try {
      if (await indexarCfdi(p.company_id, cred.rfc, p.direccion, a.contenido, p.id)) guardados++;
    } catch (e) {
      logger.warn(`[sat-descarga] ${a.nombre}: ${(e as Error).message}`);
    }
  }

  await query(
    `UPDATE sat_paquetes
        SET estado = 'EXTRAIDO', sha256 = $1, bytes = $2, xml_extraidos = $3,
            descargado_at = NOW(), mensaje = NULL
      WHERE id = $4`,
    [sha, r.zip.length, guardados, p.id]
  );
  await query(
    `UPDATE sat_trabajos SET xml_total = xml_total + $1 WHERE id = $2`,
    [guardados, p.trabajo_id]
  );
  logger.info(`[sat-descarga] paquete ${p.id_paquete_sat}: ${guardados} CFDI indexados de ${archivos.length} archivo(s)`);
}

/* ─────────────────────────  INDEXADO  ───────────────────────── */

const attr = (xml: string, nombre: string): string | null => {
  const m = new RegExp(`\\b${nombre}\\s*=\\s*"([^"]*)"`).exec(xml);
  return m ? m[1] : null;
};

const num = (v: string | null): number | null => (v == null || v === '' ? null : Number(v));

/**
 * Guarda un CFDI. Devuelve false si ya estaba.
 *
 * Se lee con expresiones y no con un analizador de XML completo: de los 40
 * campos de un CFDI aquí interesan doce, y cargar cada comprobante entero a un
 * árbol para leer doce atributos multiplica por diez la memoria en un paquete
 * de mil facturas. El XML íntegro se guarda tal cual por si algún día hace
 * falta lo demás.
 */
export async function indexarCfdi(
  companyId: string, rfcPropietario: string, direccion: string,
  xml: string, paqueteId?: string
): Promise<boolean> {
  const timbre = /<(?:\w+:)?TimbreFiscalDigital\b[^>]*>/.exec(xml)?.[0] || '';
  const uuid = attr(timbre, 'UUID');
  if (!uuid) return false;                   // sin folio fiscal no hay qué indexar

  const comprobante = /<(?:\w+:)?Comprobante\b[^>]*>/.exec(xml)?.[0] || '';
  const emisor = /<(?:\w+:)?Emisor\b[^>]*>/.exec(xml)?.[0] || '';
  const receptor = /<(?:\w+:)?Receptor\b[^>]*>/.exec(xml)?.[0] || '';

  const r = await query<any>(
    `INSERT INTO cfdi_recibidos
       (company_id, rfc_propietario, uuid, direccion, tipo_comprobante, serie, folio,
        fecha_emision, fecha_timbrado, rfc_emisor, nombre_emisor, rfc_receptor,
        nombre_receptor, subtotal, descuento, total, moneda, tipo_cambio,
        forma_pago, metodo_pago, uso_cfdi, xml, xml_sha256, paquete_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     ON CONFLICT (company_id, rfc_propietario, uuid) DO NOTHING
     RETURNING id`,
    [companyId, rfcPropietario, uuid.toUpperCase(), direccion,
     attr(comprobante, 'TipoDeComprobante'), attr(comprobante, 'Serie'), attr(comprobante, 'Folio'),
     attr(comprobante, 'Fecha'), attr(timbre, 'FechaTimbrado'),
     attr(emisor, 'Rfc') || attr(emisor, 'rfc'), attr(emisor, 'Nombre') || attr(emisor, 'nombre'),
     attr(receptor, 'Rfc') || attr(receptor, 'rfc'), attr(receptor, 'Nombre') || attr(receptor, 'nombre'),
     num(attr(comprobante, 'SubTotal')), num(attr(comprobante, 'Descuento')),
     num(attr(comprobante, 'Total')), attr(comprobante, 'Moneda'),
     num(attr(comprobante, 'TipoCambio')), attr(comprobante, 'FormaPago'),
     attr(comprobante, 'MetodoPago'), attr(receptor, 'UsoCFDI'),
     xml, crypto.createHash('sha256').update(xml).digest('hex'), paqueteId || null]
  );
  return (r.rowCount || 0) > 0;
}

/* ─────────────────────────  CONSULTAS DE PANTALLA  ───────────────────────── */

async function actualizarTotales(companyId: string, trabajoId?: string): Promise<void> {
  await query(
    `UPDATE sat_trabajos t SET
       particiones_listas = (
         SELECT COUNT(*) FROM sat_particiones p
          WHERE p.trabajo_id = t.id
            AND p.estado IN ('TERMINADA','SIN_DATOS','DIVIDIDA','RECHAZADA','FALLIDA')),
       estado = CASE
         WHEN EXISTS (SELECT 1 FROM sat_particiones p
                       WHERE p.trabajo_id = t.id
                         AND p.estado IN ('PENDIENTE','SOLICITADA','EN_PROCESO'))
           THEN 'EN_PROCESO'
         WHEN EXISTS (SELECT 1 FROM sat_paquetes q
                        JOIN sat_particiones p ON p.id = q.particion_id
                       WHERE p.trabajo_id = t.id AND q.estado IN ('PENDIENTE','DESCARGANDO'))
           THEN 'EN_PROCESO'
         WHEN EXISTS (SELECT 1 FROM sat_particiones p
                       WHERE p.trabajo_id = t.id AND p.estado IN ('RECHAZADA','FALLIDA'))
           THEN 'CON_ERRORES'
         ELSE 'TERMINADO' END,
       terminado_at = CASE WHEN t.terminado_at IS NULL AND NOT EXISTS (
           SELECT 1 FROM sat_particiones p
            WHERE p.trabajo_id = t.id AND p.estado IN ('PENDIENTE','SOLICITADA','EN_PROCESO'))
         THEN NOW() ELSE t.terminado_at END
     WHERE t.company_id = $1 AND t.estado NOT IN ('CANCELADO')
       ${trabajoId ? 'AND t.id = $2' : ''}`,
    trabajoId ? [companyId, trabajoId] : [companyId]
  );
}

export async function listarTrabajos(companyId: string): Promise<any[]> {
  const r = await query<any>(
    `SELECT t.*,
            (SELECT COUNT(*) FROM sat_particiones p WHERE p.trabajo_id = t.id)::int AS particiones,
            (SELECT COUNT(*) FROM sat_paquetes q
               JOIN sat_particiones p ON p.id = q.particion_id
              WHERE p.trabajo_id = t.id)::int AS paquetes
       FROM sat_trabajos t
      WHERE t.company_id = $1
      ORDER BY t.created_at DESC LIMIT 50`,
    [companyId]
  );
  return r.rows;
}

export async function detalleTrabajo(companyId: string, trabajoId: string): Promise<any> {
  const t = await query<any>(
    `SELECT * FROM sat_trabajos WHERE id = $1 AND company_id = $2`, [trabajoId, companyId]);
  if (t.rows.length === 0) throw new NotFoundError('Trabajo no encontrado');

  const particiones = await query<any>(
    `SELECT p.*, (SELECT COUNT(*) FROM sat_paquetes q WHERE q.particion_id = p.id)::int AS paquetes
       FROM sat_particiones p WHERE p.trabajo_id = $1 ORDER BY p.desde`,
    [trabajoId]
  );
  return { trabajo: t.rows[0], particiones: particiones.rows };
}

/** Los comprobantes ya indexados — la pantalla de XML recibidos. */
export async function listarComprobantes(
  companyId: string,
  f: { anio?: number; mes?: number; direccion?: string; rfc?: string; buscar?: string } = {}
): Promise<any[]> {
  const params: any[] = [companyId];
  const where = ['company_id = $1'];

  if (f.direccion) { params.push(f.direccion); where.push(`direccion = $${params.length}`); }
  if (f.anio) {
    params.push(f.anio);
    where.push(`EXTRACT(YEAR FROM fecha_emision) = $${params.length}`);
    if (f.mes) { params.push(f.mes); where.push(`EXTRACT(MONTH FROM fecha_emision) = $${params.length}`); }
  }
  if (f.rfc) { params.push(f.rfc.toUpperCase()); where.push(`rfc_emisor = $${params.length}`); }
  if (f.buscar) {
    params.push('%' + f.buscar.toLowerCase() + '%');
    where.push(`(LOWER(nombre_emisor) LIKE $${params.length} OR LOWER(uuid) LIKE $${params.length})`);
  }

  const r = await query<any>(
    `SELECT id, uuid, direccion, tipo_comprobante, serie, folio, fecha_emision,
            rfc_emisor, nombre_emisor, rfc_receptor, nombre_receptor,
            subtotal, total, moneda, forma_pago, metodo_pago, estado_sat
       FROM cfdi_recibidos
      WHERE ${where.join(' AND ')}
      ORDER BY fecha_emision DESC NULLS LAST
      LIMIT 500`,
    params
  );
  return r.rows;
}

export async function resumenComprobantes(companyId: string, anio?: number, mes?: number): Promise<any> {
  const params: any[] = [companyId];
  let filtro = '';
  if (anio) {
    params.push(anio);
    filtro += ` AND EXTRACT(YEAR FROM fecha_emision) = $${params.length}`;
    if (mes) { params.push(mes); filtro += ` AND EXTRACT(MONTH FROM fecha_emision) = $${params.length}`; }
  }
  const r = await query<any>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE direccion = 'recibidos')::int AS recibidos,
            COUNT(*) FILTER (WHERE direccion = 'emitidos')::int  AS emitidos,
            COALESCE(SUM(total) FILTER (WHERE direccion = 'recibidos'), 0) AS importe_recibidos,
            COUNT(DISTINCT rfc_emisor)::int AS emisores
       FROM cfdi_recibidos WHERE company_id = $1 ${filtro}`,
    params
  );
  return r.rows[0];
}
