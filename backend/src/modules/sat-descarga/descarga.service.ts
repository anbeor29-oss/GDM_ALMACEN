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
import * as programacion from './programacion.service';
import * as boveda from './boveda';
import * as soap from './soap';
import { extraerXml, ZipSospechoso } from './zip-seguro';
import { validarEfirma } from './efirma';

/**
 * Tamaño del primer corte, según lo largo que sea el periodo pedido.
 *
 * El documento sugiere 7 días para volumen desconocido, y para un mes está
 * bien. Pero pedir un año en bloques de 7 días son 52 solicitudes, y el SAT
 * limita cuántas admite por día: quien pide un año se queda a medias sin saber
 * por qué.
 *
 * Como el motor YA parte a la mitad cuando el SAT responde 5003, empezar con
 * bloques grandes cuesta —a lo sumo— una ida y vuelta extra por bloque que se
 * pase del tope, y ahorra decenas de solicitudes cuando el volumen es bajo. La
 * partición adaptativa existe justamente para no tener que adivinar esto.
 */
function diasDelPrimerCorte(dias: number): number {
  if (dias > 180) return 30;
  if (dias > 31) return 15;
  return 7;
}
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

/**
 * Reinicia el monitor: borra trabajos (cascada → particiones → paquetes) y el
 * consumo del día. NO toca la e.firma ni la configuración. Para volver a probar
 * en limpio. Devuelve cuántos trabajos se borraron.
 */
export async function reiniciarDescarga(companyId: string): Promise<{ trabajos: number }> {
  const c = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM sat_trabajos WHERE company_id = $1`, [companyId]
  );
  const trabajos = Number(c.rows[0]?.n || 0);
  // ON DELETE CASCADE se encarga de sat_particiones y sat_paquetes.
  await query(`DELETE FROM sat_trabajos WHERE company_id = $1`, [companyId]);
  await query(`DELETE FROM sat_consumo_diario WHERE company_id = $1`, [companyId]);
  logger.info(`[sat-descarga] monitor reiniciado (empresa ${companyId}): ${trabajos} trabajo(s) borrados`);
  return { trabajos };
}

/**
 * Vuelve a armar las solicitudes atoradas (RECHAZADA / FALLIDA) para que el motor
 * las pida otra vez. Se usa después de corregir la causa del rechazo —p. ej. el
 * filtro de cancelados—: sin esto habría que borrar TODO y empezar de cero,
 * perdiendo lo que ya está en vuelo y el cupo del día ya gastado.
 *
 * Sólo toca lo atorado: lo que va bien o ya trajo datos se queda como está.
 */
export async function reintentarAtoradas(companyId: string): Promise<{ particiones: number }> {
  const r = await query(
    `UPDATE sat_particiones pa
        SET estado = 'PENDIENTE', intentos = 0, id_solicitud_sat = NULL,
            codigo_sat = NULL, mensaje_sat = NULL, proxima_consulta_at = NOW(),
            updated_at = NOW()
       FROM sat_trabajos t
      WHERE pa.trabajo_id = t.id
        AND t.company_id = $1
        AND pa.estado IN ('RECHAZADA', 'FALLIDA')`,
    [companyId]
  );
  const particiones = r.rowCount || 0;
  await actualizarTotales(companyId);
  logger.info(`[sat-descarga] reintentar atoradas (empresa ${companyId}): ${particiones} solicitud(es) re-armadas`);
  return { particiones };
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

/**
 * Diagnóstico de SOLO LECTURA: prueba la e.firma y le pregunta al SAT, solicitud
 * por solicitud en vuelo, qué está pasando. No cambia nada en la base.
 *
 * Es la prueba "aparte" para saber dónde se atora: si la e.firma autentica, y
 * qué contesta el SAT en la verificación —EN_PROCESO (todavía prepara), TERMINADA
 * (ya hay paquetes: entonces el problema es la descarga) o un error con su
 * motivo—. Sirve para no adivinar si es el código o el SAT.
 */
export async function diagnostico(companyId: string): Promise<any> {
  let cred: soap.Credencial;
  try {
    cred = await credencialUsable(companyId);
  } catch (e) {
    return { efirma: { ok: false, mensaje: (e as Error).message }, autenticacion: null, solicitudes: [] };
  }
  const efirma = { ok: true, rfc: cred.rfc };

  let token: soap.Token;
  try {
    token = await soap.autenticar(cred);
  } catch (e) {
    return { efirma, autenticacion: { ok: false, mensaje: (e as Error).message }, solicitudes: [] };
  }

  /* PRUEBA REAL: manda solicitudes de recibidos CFDI de un rango chico con
   * DISTINTOS valores de EstadoComprobante y devuelve qué contesta el SAT a cada
   * uno. Así se ve —sin adivinar— que "Vigente" es aceptada (5000) y que un valor
   * que incluya cancelados provoca el 301. No guarda nada; cuesta una solicitud
   * por valor probado. Los valores van como PALABRA (así los espera el SOAP). */
  const pruebas: any[] = [];
  const hasta = new Date();
  const desde = new Date(Date.now() - 3 * 86_400_000);
  for (const estadoComprobante of ['Vigente', 'Cancelado']) {
    try {
      const s = await soap.solicitar(cred, token, {
        desde, hasta, direccion: 'recibidos', tipo: 'CFDI', estadoComprobante,
      });
      pruebas.push({ estadoComprobante, atributos: s.atributos, codigo: s.codigo, mensaje: s.mensaje });
    } catch (e) {
      pruebas.push({ estadoComprobante, error: (e as Error).message });
    }
  }

  const enCurso = await query<any>(
    `SELECT pa.id_solicitud_sat,
            TO_CHAR(pa.desde, 'YYYY-MM-DD') AS desde, TO_CHAR(pa.hasta, 'YYYY-MM-DD') AS hasta,
            t.direccion
       FROM sat_particiones pa
       JOIN sat_trabajos t ON t.id = pa.trabajo_id
      WHERE t.company_id = $1
        AND pa.estado IN ('SOLICITADA', 'EN_PROCESO')
        AND pa.id_solicitud_sat IS NOT NULL
      ORDER BY pa.created_at
      LIMIT 8`,
    [companyId],
  );

  const solicitudes: any[] = [];
  for (const pa of enCurso.rows) {
    try {
      const v = await soap.verificar(cred, token, pa.id_solicitud_sat);
      solicitudes.push({
        idSolicitud: pa.id_solicitud_sat,
        direccion: pa.direccion, periodo: `${pa.desde} → ${pa.hasta}`,
        estado: v.estadoSolicitud, codigo: v.codigo, mensaje: v.mensaje,
        codigoSolicitud: v.codigoSolicitud, cfdis: v.numeroCfdis, paquetes: v.paquetes.length,
      });
    } catch (e) {
      solicitudes.push({ idSolicitud: pa.id_solicitud_sat, error: (e as Error).message });
    }
  }

  return { efirma, autenticacion: { ok: true }, pruebas, enVuelo: enCurso.rows.length, solicitudes };
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
  userId?: string,
  meta: { origen?: 'DIARIO' | 'EJERCICIO' | 'MANUAL'; ejercicio?: number } = {}
): Promise<any> {
  const desde = new Date(d.desde + 'T00:00:00');
  const hasta = new Date(d.hasta + 'T23:59:59');
  if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) {
    throw new ValidationError('Las fechas no son válidas.');
  }
  if (hasta < desde) throw new ValidationError('La fecha final es anterior a la inicial.');

  /* El SAT rechaza solicitudes de más de 6 años de antigüedad ("La solicitud de
   * XML no puede contener información mayor a 6 años"). Se recorta el inicio a ese
   * tope; si TODO el rango es más viejo, se rechaza aquí con un mensaje claro en
   * vez de gastar la solicitud y recibir el error del SAT. */
  const limite6 = new Date();
  limite6.setFullYear(limite6.getFullYear() - 6);
  limite6.setDate(limite6.getDate() + 7);          // margen por el redondeo del SAT
  if (hasta < limite6) {
    throw new ValidationError(
      `El SAT no entrega comprobantes de más de 6 años de antigüedad. Ese rango ya ` +
      `quedó fuera; lo más viejo que se puede pedir es ${limite6.toISOString().slice(0, 10)}.`);
  }
  let desdeStr = d.desde;
  if (desde < limite6) { desde.setTime(limite6.getTime()); desdeStr = desde.toISOString().slice(0, 10); }

  const cred = await credencialUsable(companyId);   // valida antes de crear nada
  const tipo = d.tipo === 'Metadata' ? 'Metadata' : 'CFDI';

  /* ── No pedir dos veces lo mismo ──
   * Dos clics en "Pedir al SAT" creaban dos trabajos con las mismas
   * particiones, y el SAT recibia la peticion duplicada. No es solo ruido: las
   * solicitudes estan limitadas, y gastarlas dos veces en el mismo rango deja
   * sin cupo a un rango que si falta.
   *
   * Se busca TRASLAPE y no coincidencia exacta: pedir 18->20 cuando ya hay un
   * trabajo vivo de 17->19 es pedir dos veces los mismos dias.
   *
   * En la base hay ademas un indice unico sobre trabajos vivos: esta
   * comprobacion existe para dar un mensaje entendible antes de que salte. */
  const vivo = await query<any>(
    `SELECT id, fecha_desde::date, fecha_hasta::date FROM sat_trabajos
      WHERE company_id=$1 AND direccion=$2 AND tipo=$3
        AND estado IN ('CREADO','EN_PROCESO')
        AND fecha_desde <= $5::date AND fecha_hasta >= $4::date
      LIMIT 1`,
    [companyId, d.direccion, tipo, desdeStr, d.hasta]
  );
  if (vivo.rows.length) {
    const v = vivo.rows[0];
    throw new ValidationError(
      `Ya hay una descarga en curso de ${d.direccion} que cubre esos dias ` +
      `(${new Date(v.fecha_desde).toISOString().slice(0, 10)} a ` +
      `${new Date(v.fecha_hasta).toISOString().slice(0, 10)}). Espera a que ` +
      `termine: pedir el mismo rango otra vez gasta cupo de solicitudes del dia.`
    );
  }

  return transaction(async (client) => {
    const t = await transactionQuery<any>(
      client,
      `INSERT INTO sat_trabajos
         (company_id, rfc, fecha_desde, fecha_hasta, direccion, tipo, filtros,
          creado_por, origen, ejercicio)
       VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [companyId, cred.rfc, desdeStr, d.hasta, d.direccion, tipo,
       d.filtros ? JSON.stringify(d.filtros) : null, userId || null,
       meta.origen || 'MANUAL', meta.ejercicio ?? null]
    );
    const trabajo = t.rows[0];

    /* Emitidos y recibidos van en trabajos distintos, y CFDI y metadatos
     * también: el SAT los cuenta por separado y mezclarlos en una solicitud es
     * la forma más rápida de topar el límite. */
    const diasTotales = Math.ceil((hasta.getTime() - desde.getTime()) / 86_400_000);
    const bloque = diasDelPrimerCorte(diasTotales);

    let cursor = new Date(desde);
    let n = 0;
    while (cursor <= hasta) {
      const fin = new Date(cursor);
      fin.setDate(fin.getDate() + bloque);
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
    logger.info(
      `[sat-descarga] trabajo ${trabajo.id} (${d.direccion}) creado: ` +
      `${n} partición(es) de ${bloque} días sobre ${diasTotales} días`
    );
    return { ...trabajo, particiones_total: n, dias_por_bloque: bloque };
  });
}

/**
 * Un paso del motor. Devuelve qué hizo, para que la pantalla lo muestre.
 *
 * Se llama desde el cron y también desde el botón "Avanzar ahora": la misma
 * función, porque tener dos caminos para lo mismo garantiza que uno de los dos
 * se quede atrás.
 */
export async function avanzar(companyId: string, trabajoId?: string, factor = 1): Promise<any> {
  const cred = await credencialUsable(companyId);
  const token = await soap.autenticar(cred);
  /* Cuánto se atiende por corrida. De noche el cron manda `factor` alto para
   * aprovechar que el SAT está menos saturado (10PM–7AM); a mano y de día, 1. */
  const f = Math.max(1, Math.floor(factor));
  const cupo = {
    paquetes: POR_CORRIDA.paquetes * f,
    verificaciones: POR_CORRIDA.verificaciones * f,
    solicitudes: POR_CORRIDA.solicitudes * f,
  };
  const hecho = {
    descargados: 0, verificados: 0, solicitados: 0, divididos: 0,
    errores: [] as string[],
    presupuesto: null as any,
    frenadoPorPresupuesto: false,
  };

  /* El presupuesto del dia. Frena las solicitudes NUEVAS, no lo que ya esta en
   * vuelo: un paquete que el SAT ya preparo caduca a las 72 horas, y dejarlo
   * caducar obliga a volver a pedirlo — gastando el cupo de mañana en algo que
   * hoy ya estaba listo. */
  const presupuesto = await programacion.presupuestoDeHoy(companyId);

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
      LIMIT ${cupo.paquetes}`,
    params
  );
  for (const p of paquetes.rows) {
    try {
      const antes = await xmlDelPaquete(p.id);
      await descargarPaquete(cred, token, p);
      const despues = await xmlDelPaquete(p.id);
      hecho.descargados++;
      await programacion.consumir(companyId,
        { paquetes: 1, xml: Math.max(0, despues - antes) });
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
      LIMIT ${cupo.verificaciones}`,
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

  // ── 3. Solicitudes nuevas, al final y dentro del presupuesto ──────────
  if (presupuesto.agotado) {
    hecho.frenadoPorPresupuesto = true;
    hecho.presupuesto = await programacion.presupuestoDeHoy(companyId);
    await actualizarTotales(companyId, trabajoId);
    return hecho;
  }

  /* Se piden como maximo las que quepan en lo que queda del cupo. */
  const cupoSolicitudes = Math.min(cupo.solicitudes, presupuesto.quedanSolicitudes);
  const pendientes = await query<any>(
    `SELECT pa.*, t.direccion, t.tipo, t.filtros, t.company_id
       FROM sat_particiones pa
       JOIN sat_trabajos t ON t.id = pa.trabajo_id
      WHERE t.company_id = $1 ${filtroTrabajo}
        AND pa.estado = 'PENDIENTE'
        AND (pa.proxima_consulta_at IS NULL OR pa.proxima_consulta_at <= NOW())
      ORDER BY pa.desde ASC
      LIMIT ${cupoSolicitudes}`,
    params
  );
  for (const pa of pendientes.rows) {
    try {
      const r = await solicitarParticion(cred, token, pa);
      if (r === 'dividida') {
        hecho.divididos++;
      } else {
        hecho.solicitados++;
        /* Dividir no gasta solicitud: no se le pidio nada al SAT, se partio el
         * rango. Contarlo inflaria el consumo y frenaria la descarga antes de
         * tiempo. */
        await programacion.consumir(companyId, { solicitudes: 1 });
      }
    } catch (e) {
      hecho.errores.push(`solicitud ${pa.id}: ${(e as Error).message}`);
    }
  }

  await actualizarTotales(companyId, trabajoId);
  hecho.presupuesto = await programacion.presupuestoDeHoy(companyId);
  return hecho;
}

/** Cuantos XML lleva extraidos un paquete. Para medir lo que trajo la bajada. */
async function xmlDelPaquete(paqueteId: string): Promise<number> {
  const r = await query<any>(
    `SELECT COALESCE(xml_extraidos, 0)::int n FROM sat_paquetes WHERE id = $1`,
    [paqueteId]);
  return r.rows[0]?.n ?? 0;
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

  let extraidos = 0, nuevos = 0;
  for (const a of archivos) {
    try {
      if (/\.xml$/i.test(a.nombre)) {
        extraidos++;                                   // el XML VINO en el paquete
        if (await indexarCfdi(p.company_id, cred.rfc, p.direccion, a.contenido, p.id)) nuevos++;
      } else if (/\.txt$/i.test(a.nombre)) {
        /* Metadatos: un CSV con el UUID y el estatus. Es la ÚNICA vía para los
         * comprobantes cancelados, que el SAT no deja bajar como XML. No es XML,
         * así que cuenta como novedad pero no como 'extraído'. */
        nuevos += await indexarMetadata(p.company_id, cred.rfc, p.direccion, a.contenido, p.id);
      }
    } catch (e) {
      logger.warn(`[sat-descarga] ${a.nombre}: ${(e as Error).message}`);
    }
  }

  /* 'xml_extraidos' cuenta lo que TRAJO el paquete, no sólo lo nuevo. Antes se
   * guardaba 'nuevos', y como los EMITIDOS ya están en el sistema (los timbramos
   * o ya se bajaron), 'nuevos' era 0 y la pantalla mostraba «13 paquetes, 0 XML»
   * aunque el XML sí bajó. Mostrar lo extraído dice la verdad; el log conserva
   * cuántos eran realmente nuevos. */
  await query(
    `UPDATE sat_paquetes
        SET estado = 'EXTRAIDO', sha256 = $1, bytes = $2, xml_extraidos = $3,
            descargado_at = NOW(), mensaje = NULL
      WHERE id = $4`,
    [sha, r.zip.length, extraidos, p.id]
  );
  await query(
    `UPDATE sat_trabajos SET xml_total = xml_total + $1 WHERE id = $2`,
    [extraidos, p.trabajo_id]
  );
  logger.info(`[sat-descarga] paquete ${p.id_paquete_sat}: ${extraidos} XML extraído(s) (${nuevos} nuevo(s)) de ${archivos.length} archivo(s)`);
}

/* ─────────────────────────  INDEXADO  ───────────────────────── */

const attr = (xml: string, nombre: string): string | null => {
  const m = new RegExp(`\\b${nombre}\\s*=\\s*"([^"]*)"`).exec(xml);
  return m ? m[1] : null;
};

const num = (v: string | null): number | null => (v == null || v === '' ? null : Number(v));

/**
 * Guarda un CFDI. Devuelve false si ya estaba (con su XML).
 *
 * CFDI y Metadata de emitidos son trabajos DISTINTOS que terminan en cualquier
 * orden. Si el Metadata gana la carrera, crea la fila con estado_sat pero SIN
 * XML; cuando luego llega el CFDI, en vez de descartarlo (el viejo DO NOTHING lo
 * perdía y el emitido quedaba sin representación) RELLENA el XML y sus campos,
 * dejando intactos estado_sat/fecha_cancelacion que sólo el Metadata trae.
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
     ON CONFLICT (company_id, rfc_propietario, uuid) DO UPDATE SET
       xml = EXCLUDED.xml, xml_sha256 = EXCLUDED.xml_sha256,
       tipo_comprobante = EXCLUDED.tipo_comprobante, serie = EXCLUDED.serie, folio = EXCLUDED.folio,
       fecha_emision = EXCLUDED.fecha_emision, fecha_timbrado = EXCLUDED.fecha_timbrado,
       rfc_emisor = EXCLUDED.rfc_emisor, nombre_emisor = EXCLUDED.nombre_emisor,
       rfc_receptor = EXCLUDED.rfc_receptor, nombre_receptor = EXCLUDED.nombre_receptor,
       subtotal = EXCLUDED.subtotal, descuento = EXCLUDED.descuento, total = EXCLUDED.total,
       moneda = EXCLUDED.moneda, tipo_cambio = EXCLUDED.tipo_cambio,
       forma_pago = EXCLUDED.forma_pago, metodo_pago = EXCLUDED.metodo_pago,
       uso_cfdi = EXCLUDED.uso_cfdi, paquete_id = EXCLUDED.paquete_id
     WHERE cfdi_recibidos.xml IS NULL
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

  /* Si es complemento de pago (tipo P), mapear qué facturas liquida. De ahí sale
   * el icono de "pagado": una PPD cuenta como pagada cuando existe su timbre de
   * pago que la referencia. Se hace siempre (idempotente por el ON CONFLICT), no
   * sólo al insertar, para rellenar también los P que ya se habían bajado antes
   * de existir esta tabla. */
  if (attr(comprobante, 'TipoDeComprobante') === 'P') {
    for (const d of xml.match(/<(?:\w+:)?DoctoRelacionado\b[^>]*>/g) || []) {
      const idDoc = attr(d, 'IdDocumento');
      if (!idDoc) continue;
      await query(
        `INSERT INTO cfdi_pago_relacion
           (company_id, rfc_propietario, pago_uuid, factura_uuid, parcialidad, imp_pagado, moneda)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (company_id, rfc_propietario, pago_uuid, factura_uuid) DO NOTHING`,
        [companyId, rfcPropietario, uuid.toUpperCase(), idDoc.toUpperCase(),
         num(attr(d, 'NumParcialidad')), num(attr(d, 'ImpPagado')), attr(d, 'MonedaDR')]
      );
    }
  }

  return (r.rowCount || 0) > 0;
}

/**
 * Indexa un archivo de METADATOS del SAT (el .txt del paquete). Es un CSV
 * separado por '~' con encabezado; cada renglón trae el UUID, las partes, la
 * fecha, el monto y el ESTATUS (1 vigente, 0 cancelado).
 *
 * Es la única forma de recuperar los cancelados: el SAT no entrega su XML, sólo
 * su metadato. Se guardan en la misma tabla, sin XML y con estado_sat marcado;
 * si el comprobante ya estaba (lo trajimos vigente y luego lo cancelaron), se
 * actualiza su estado. Devuelve cuántos renglones tocó.
 *
 * Orden de columnas del SAT: Uuid ~ RfcEmisor ~ NombreEmisor ~ RfcReceptor ~
 * NombreReceptor ~ RfcPac ~ FechaEmision ~ FechaCertificacion ~ Monto ~
 * EfectoComprobante ~ Estatus ~ FechaCancelacion.
 */
export async function indexarMetadata(
  companyId: string, rfcPropietario: string, direccion: string,
  contenido: string, paqueteId?: string
): Promise<number> {
  const lineas = contenido.split(/\r\n|\r|\n/).filter((l) => l.trim());
  if (lineas.length <= 1) return 0;
  if (!lineas[0].toLowerCase().includes('uuid')) return 0;   // no es el metadato esperado

  let tocados = 0;
  for (let i = 1; i < lineas.length; i++) {
    const col = lineas[i].split('~');
    const uuid = (col[0] || '').trim();
    if (!uuid) continue;
    const estatus = (col[10] || '').trim();
    const estado = estatus === '0' ? 'Cancelado' : estatus === '1' ? 'Vigente' : (estatus || null);
    const fechaCancel = (col[11] || '').trim() || null;   // sólo viene si está cancelado
    /* EfectoComprobante del metadato = el tipo (I/E/P/N/T). Es la única forma de
     * saber el tipo de un recibido, que no trae XML. Para uno que ya está por
     * CFDI no se pisa (el XML manda). */
    const efecto = (col[9] || '').trim().charAt(0).toUpperCase() || null;
    await query(
      `INSERT INTO cfdi_recibidos
         (company_id, rfc_propietario, uuid, direccion, tipo_comprobante, rfc_emisor,
          nombre_emisor, rfc_receptor, nombre_receptor, fecha_emision, total, estado_sat,
          fecha_cancelacion, paquete_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (company_id, rfc_propietario, uuid)
         DO UPDATE SET estado_sat = EXCLUDED.estado_sat,
                       fecha_cancelacion = COALESCE(EXCLUDED.fecha_cancelacion, cfdi_recibidos.fecha_cancelacion),
                       tipo_comprobante  = COALESCE(cfdi_recibidos.tipo_comprobante, EXCLUDED.tipo_comprobante)`,
      [companyId, rfcPropietario, uuid.toUpperCase(), direccion, efecto,
       (col[1] || '').trim() || null, (col[2] || '').trim() || null,
       (col[3] || '').trim() || null, (col[4] || '').trim() || null,
       (col[6] || '').trim() || null, num((col[8] || '').trim()), estado,
       fechaCancel, paqueteId || null]
    );
    tocados++;
  }
  return tocados;
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
              WHERE p.trabajo_id = t.id)::int AS paquetes,
            /* ── POR QUÉ NO AVANZA ──
             *
             * Un trabajo "en proceso" con 0 de 3 solicitudes puede ser dos
             * cosas muy distintas: que nadie lo haya empujado todavía, o que el
             * SAT lo esté rechazando. La pantalla las mostraba igual, y sin
             * forma de distinguirlas la única salida era esperar.
             *
             * mensaje_sat ya se guardaba en cada partición desde el primer
             * día; simplemente no salía de la base. */
            (SELECT p.mensaje_sat FROM sat_particiones p
              WHERE p.trabajo_id = t.id AND p.mensaje_sat IS NOT NULL
              ORDER BY p.updated_at DESC NULLS LAST LIMIT 1) AS ultimo_mensaje,
            (SELECT MAX(p.intentos) FROM sat_particiones p
              WHERE p.trabajo_id = t.id)::int AS intentos,
            /* Cuándo se volverá a intentar. Sin esto, "en proceso" no dice si
             * el motor va a hacer algo en cinco minutos o si está detenido. */
            (SELECT MIN(p.proxima_consulta_at) FROM sat_particiones p
              WHERE p.trabajo_id = t.id
                AND p.estado IN ('PENDIENTE','SOLICITADA','EN_PROCESO')) AS proximo_intento
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
    `SELECT p.id, p.desde, p.hasta, p.estado, p.codigo_sat, p.mensaje_sat,
            p.cfdi_contados, p.intentos, p.profundidad, p.id_solicitud_sat,
            p.proxima_consulta_at
       FROM sat_particiones p WHERE p.trabajo_id = $1 ORDER BY p.desde`,
    [trabajoId]
  );

  /* El detalle de cada paquete es lo que distingue "no hubo datos" de "el
   * paquete está y no se ha bajado" de "el SAT no devolvió contenido". Sin
   * esto, una partición TERMINADA con 0 XML no se puede explicar desde la
   * pantalla y la única salida es adivinar. */
  const paquetes = await query<any>(
    `SELECT q.id, q.particion_id, q.id_paquete_sat, q.estado, q.xml_extraidos,
            q.bytes, q.intentos, q.mensaje, q.descargado_at, q.vence_at
       FROM sat_paquetes q
       JOIN sat_particiones p ON p.id = q.particion_id
      WHERE p.trabajo_id = $1
      ORDER BY q.created_at`,
    [trabajoId]
  );
  const porParticion = new Map<string, any[]>();
  for (const q of paquetes.rows) {
    const arr = porParticion.get(q.particion_id) || [];
    arr.push(q);
    porParticion.set(q.particion_id, arr);
  }

  return {
    trabajo: t.rows[0],
    particiones: particiones.rows.map((p) => ({ ...p, paquetes: porParticion.get(p.id) || [] })),
  };
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

/**
 * Rellena `cfdi_pago_relacion` a partir de los complementos de pago (tipo P) que
 * ya estaban guardados. Al indexar un P nuevo el mapeo se hace solo, pero los P
 * que se bajaron ANTES de existir esta tabla se quedaron sin mapear —y con ellos
 * el "pagado" de sus facturas—. Sólo mira los P que aún no tienen relación, así
 * que a la segunda pasada no hace nada.
 */
export async function reconstruirRelacionPagos(companyId: string): Promise<number> {
  const ps = await query<any>(
    `SELECT rfc_propietario, uuid, xml
       FROM cfdi_recibidos c
      WHERE company_id = $1 AND tipo_comprobante = 'P' AND xml IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM cfdi_pago_relacion r
                         WHERE r.company_id = $1 AND r.pago_uuid = c.uuid)`,
    [companyId]);
  let n = 0;
  for (const p of ps.rows) {
    for (const d of (String(p.xml).match(/<(?:\w+:)?DoctoRelacionado\b[^>]*>/g) || [])) {
      const idDoc = attr(d, 'IdDocumento');
      if (!idDoc) continue;
      await query(
        `INSERT INTO cfdi_pago_relacion
           (company_id, rfc_propietario, pago_uuid, factura_uuid, parcialidad, imp_pagado, moneda)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (company_id, rfc_propietario, pago_uuid, factura_uuid) DO NOTHING`,
        [companyId, p.rfc_propietario, String(p.uuid).toUpperCase(), idDoc.toUpperCase(),
         num(attr(d, 'NumParcialidad')), num(attr(d, 'ImpPagado')), attr(d, 'MonedaDR')]);
      n++;
    }
  }
  return n;
}

/**
 * La vista de XML del SAT en dos submenús (Emitidos / Recibidos). Devuelve los
 * renglones como los pide la pantalla del Anexo 20:
 *  - ordenados por fecha de MENOR a mayor,
 *  - con la CONTRAPARTE ya resuelta (cliente en emitidos = receptor; proveedor
 *    en recibidos = emisor), para que el frontend no dependa de la dirección,
 *  - con el flag `pagado` calculado (PUE, o PPD con su complemento de pago), que
 *    decide el icono de la cartera,
 *  - con `tiene_xml`, que separa lo que tiene representación (emitidos, con XML)
 *    de lo que es sólo metadato (recibidos → ficha, punto rojo).
 * Se excluyen los complementos de pago (tipo P): no son facturas, se ven al dar
 * clic en la cartera de la factura que liquidan.
 */
export async function listarComprobantesVista(
  companyId: string,
  f: { direccion: string; anio?: number; mes?: number; buscar?: string } = { direccion: 'emitidos' }
): Promise<any[]> {
  /* Los complementos de pago viven del lado emitidos: antes de listarlos, mapear
   * los que aún no lo estén para que el icono de "pagado" salga bien. Idempotente. */
  if (f.direccion === 'emitidos') await reconstruirRelacionPagos(companyId);

  const params: any[] = [companyId, f.direccion];
  const where = ['c.company_id = $1', 'c.direccion = $2', `COALESCE(c.tipo_comprobante,'') <> 'P'`];

  if (f.anio) {
    params.push(f.anio);
    where.push(`EXTRACT(YEAR FROM c.fecha_emision) = $${params.length}`);
    if (f.mes) { params.push(f.mes); where.push(`EXTRACT(MONTH FROM c.fecha_emision) = $${params.length}`); }
  }
  if (f.buscar) {
    params.push('%' + f.buscar.toLowerCase() + '%');
    const p = `$${params.length}`;
    where.push(`(LOWER(c.nombre_emisor) LIKE ${p} OR LOWER(c.nombre_receptor) LIKE ${p}
                 OR LOWER(c.uuid) LIKE ${p} OR LOWER(COALESCE(c.folio,'')) LIKE ${p})`);
  }

  const r = await query<any>(
    `SELECT c.id, c.uuid, c.direccion, c.tipo_comprobante, c.serie, c.folio,
            c.fecha_emision, c.total, c.moneda, c.metodo_pago, c.estado_sat,
            c.fecha_cancelacion, c.cuenta_contable,
            (c.xml IS NOT NULL) AS tiene_xml,
            CASE WHEN c.direccion = 'emitidos' THEN c.nombre_receptor ELSE c.nombre_emisor END AS contraparte_nombre,
            CASE WHEN c.direccion = 'emitidos' THEN c.rfc_receptor    ELSE c.rfc_emisor    END AS contraparte_rfc,
            CASE
              /* Sólo las facturas (tipo I) se marcan como pagadas; una nota de
               * crédito o un traslado no "se pagan". */
              WHEN COALESCE(c.tipo_comprobante, 'I') <> 'I' THEN false
              WHEN c.metodo_pago = 'PUE' THEN true
              WHEN EXISTS (SELECT 1 FROM cfdi_pago_relacion pr
                            WHERE pr.company_id = c.company_id
                              AND pr.rfc_propietario = c.rfc_propietario
                              AND pr.factura_uuid = c.uuid) THEN true
              ELSE false
            END AS pagado
       FROM cfdi_recibidos c
      WHERE ${where.join(' AND ')}
      ORDER BY c.fecha_emision ASC NULLS LAST, c.folio ASC
      LIMIT 1000`,
    params
  );
  return r.rows;
}

/**
 * El detalle de un comprobante para la pantalla del sistema:
 *  - emitidos: el XML completo (para armar la representación del Anexo 20) + los
 *    timbres de pago que lo liquidan;
 *  - recibidos: la ficha de metadatos (lo único que el SAT entrega de ellos).
 * Nunca devuelve nada de otra empresa.
 */
export async function detalleComprobante(companyId: string, id: string): Promise<any> {
  const r = await query<any>(
    `SELECT * FROM cfdi_recibidos WHERE id = $1 AND company_id = $2`, [id, companyId]);
  const c = r.rows[0];
  if (!c) return null;

  /* Los timbres de pago que referencian esta factura (para el clic en cartera). */
  const pagos = await query<any>(
    `SELECT p.uuid, p.serie, p.folio, p.fecha_emision, p.total, p.xml,
            rel.parcialidad, rel.imp_pagado, rel.moneda
       FROM cfdi_pago_relacion rel
       JOIN cfdi_recibidos p
         ON p.company_id = rel.company_id
        AND p.rfc_propietario = rel.rfc_propietario
        AND p.uuid = rel.pago_uuid
      WHERE rel.company_id = $1 AND rel.factura_uuid = $2
      ORDER BY p.fecha_emision ASC`,
    [companyId, c.uuid]);

  return { comprobante: c, pagos: pagos.rows };
}

/** Asigna (o limpia) la cuenta contable —la columna CC— de un comprobante. */
export async function asignarCuentaContable(
  companyId: string, id: string, cuenta: string | null
): Promise<boolean> {
  const r = await query(
    `UPDATE cfdi_recibidos SET cuenta_contable = $3 WHERE id = $1 AND company_id = $2`,
    [id, companyId, cuenta ? cuenta.trim().slice(0, 40) : null]);
  return (r.rowCount || 0) > 0;
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
