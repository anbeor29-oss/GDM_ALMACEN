/**
 * lista-69b.service — ¿tenemos operaciones con alguien de la lista del 69-B?
 *
 * QUÉ RESUELVE
 * Un proveedor en la lista DEFINITIVA emite comprobantes que no producen efecto
 * fiscal: lo que se le dedujo se pierde, y quien lo dedujo tiene 30 días para
 * corregir o demostrar que la operación existió de verdad. Enterarse de eso en
 * una auditoría, dos años después, es carísimo. Enterarse el mes en que el SAT
 * lo publica cuesta una llamada.
 *
 * LA LISTA SE CARGA, NO SE ADIVINA
 * El SAT publica el padrón en su portal. Aquí se importa ese archivo tal cual.
 * El sistema NO deduce ni infiere quién está en la lista: un señalamiento del
 * 69-B tiene consecuencias fiscales serias y no puede salir de una suposición.
 *
 * DOS SEÑALES INDEPENDIENTES
 * El módulo de Auditoría ya guarda `validacion_efos`, que es lo que el SAT
 * responde al consultar un CFDI concreto. Esa señal es por comprobante y la da
 * el propio SAT; ésta es por RFC y sale del padrón. Se conservan las dos porque
 * llegan por caminos distintos y una puede detectar lo que la otra no.
 */

import { query, transaction, transactionQuery } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';

export type Situacion = 'PRESUNTO' | 'DESVIRTUADO' | 'DEFINITIVO' | 'SENTENCIA_FAVORABLE';

/**
 * Normaliza la situación tal como viene escrita en la publicación del SAT.
 *
 * El archivo no usa un catálogo fijo: aparece "Definitivo", "DEFINITIVOS",
 * "Sentencia Favorable", con y sin acentos. Se reduce a las cuatro que
 * significan algo distinto, y lo que no se reconoce se rechaza en vez de
 * caer en una por omisión — clasificar mal a un contribuyente en esta lista
 * es peor que no clasificarlo.
 */
export function normalizarSituacion(texto: string): Situacion | null {
  const t = String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().trim();
  if (!t) return null;
  if (t.startsWith('DEFINITIV')) return 'DEFINITIVO';
  if (t.startsWith('PRESUNT')) return 'PRESUNTO';
  if (t.startsWith('DESVIRTUAD')) return 'DESVIRTUADO';
  if (t.includes('SENTENCIA')) return 'SENTENCIA_FAVORABLE';
  return null;
}

/**
 * Fecha de la publicación.
 *
 * Una celda puede traer VARIAS fechas: "26/10/2023 - 26/04/2022 - 14/12/2020",
 * porque al mismo contribuyente lo publicaron más de una vez. La versión
 * anterior exigía que la celda entera fuera una sola fecha, así que en esos
 * casos devolvía null y la fecha se perdía en silencio — justo en los
 * contribuyentes con más historia, que son los que más importan.
 *
 * Se conserva la MÁS RECIENTE: es la que fija la situación actual.
 */
function fecha(v: string): string | null {
  const s = String(v || '').trim();
  if (!s) return null;

  const encontradas: string[] = [];
  const re = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})|(\d{4})-(\d{1,2})-(\d{1,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const iso = m[3]
      ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
      : `${m[4]}-${m[5].padStart(2, '0')}-${m[6].padStart(2, '0')}`;
    /* Una fecha con mes 13 o día 40 es basura del archivo, no una fecha: se
     * descarta en vez de dejar que Postgres reviente la carga entera. */
    const d = new Date(`${iso}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso) {
      encontradas.push(iso);
    }
  }
  if (encontradas.length === 0) return null;
  encontradas.sort();
  return encontradas[encontradas.length - 1];
}

/**
 * Parte el CSV COMPLETO en renglones y columnas.
 *
 * POR QUÉ NO SE PUEDE PARTIR POR SALTOS DE LÍNEA PRIMERO
 * El archivo del SAT trae razones sociales y textos de oficio con saltos de
 * linea DENTRO de las comillas. Partir por saltos de linea y luego por comas
 * que hacía antes— corta esos renglones a la mitad: el pedazo de arriba pierde
 * columnas y el de abajo aparece como un renglón nuevo cuyo "RFC" es un trozo
 * de frase. En la publicación real eso salía como un RFC llamado "en el
 * expediente".
 *
 * Aquí se recorre el texto UNA vez, carácter por carácter, y el salto de línea
 * sólo termina el renglón cuando NO estamos dentro de comillas. Es la misma
 * regla del RFC 4180, que es la que el SAT respeta.
 */
function renglones(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let actual = '';
  let entreComillas = false;

  const cerrarCampo = () => { fila.push(actual.trim()); actual = ''; };
  const cerrarFila = () => {
    cerrarCampo();
    /* Renglones completamente vacíos —los que deja un 

 final— no cuentan. */
    if (fila.some((c) => c !== '')) filas.push(fila);
    fila = [];
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') {
      if (entreComillas && texto[i + 1] === '"') { actual += '"'; i++; }
      else entreComillas = !entreComillas;
    } else if ((c === ',' || c === ';') && !entreComillas) {
      cerrarCampo();
    } else if ((c === '\n' || c === '\r') && !entreComillas) {
      /* CRLF cuenta como UN solo fin de renglon. */
      if (c === '\r' && texto[i + 1] === '\n') i++;
      cerrarFila();
    } else {
      actual += c;
    }
  }
  if (actual !== '' || fila.length > 0) cerrarFila();
  return filas;
}

/**
 * Importa el archivo del SAT.
 *
 * Las columnas se localizan POR NOMBRE de encabezado, no por posición: el SAT
 * ha cambiado el orden y ha agregado columnas entre publicaciones, y un
 * importador atado a la posición carga los datos corridos sin avisar —el nombre
 * de un contribuyente terminaría guardado como su situación.
 */
export async function importarLista(
  csv: string,
  archivo: string,
  userId?: string
): Promise<{ renglones: number; nuevos: number; actualizados: number; ignorados: number }> {
  const filas = renglones(String(csv || ''));
  if (filas.length < 2) {
    throw new ValidationError('El archivo viene vacio o no trae encabezados.');
  }

  /* El SAT antepone renglones de titulo antes del encabezado real (en la
   * publicacion de mayo de 2026 son dos). Se busca el primero que traiga una
   * columna llamada RFC, en vez de saltar un numero fijo de lineas: ese numero
   * ha cambiado entre publicaciones. */
  const iEncabezado = filas.findIndex((f) =>
    f.some((c) => /^rfc$/i.test(c.replace(/\s+/g, ''))));
  if (iEncabezado < 0) {
    throw new ValidationError(
      'No se encontro una columna llamada RFC. Es el archivo que publica el SAT?'
    );
  }

  const enc = filas[iEncabezado].map((c) =>
    c.normalize('NFD').replace(/[̀-ͯ]/g, '')
     .toUpperCase().replace(/\s+/g, ' ').trim());

  const buscar = (...nombres: string[]) => {
    for (const n of nombres) {
      const i = enc.findIndex((c) => c === n || c.startsWith(n));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iRfc       = buscar('RFC');
  const iNombre    = buscar('NOMBRE DEL CONTRIBUYENTE', 'NOMBRE', 'RAZON SOCIAL');
  const iSituacion = buscar('SITUACION DEL CONTRIBUYENTE', 'SITUACION', 'SUPUESTO');
  const iOfPres    = buscar('NUMERO Y FECHA DE OFICIO GLOBAL DE PRESUNCION SAT',
                            'NUMERO Y FECHA DE OFICIO GLOBAL DE PRESUNCION');
  const iOfDef     = buscar('NUMERO Y FECHA DE OFICIO GLOBAL DE DEFINITIVOS SAT',
                            'NUMERO Y FECHA DE OFICIO GLOBAL DE DEFINITIVOS');
  const iOfSent    = buscar('NUMERO Y FECHA DE OFICIO GLOBAL DE SENTENCIA FAVORABLE');

  /* UNA FECHA DE DOF POR ETAPA, y se usa la que corresponde a la situacion.
   *
   * Antes se guardaba siempre la de "presuntos". A un contribuyente DEFINITIVO
   * la pantalla le ensenaba entonces la fecha en que fue presunto -a veces anos
   * antes-, que es precisamente la que no importa: lo que hay que saber es
   * desde cuando sus comprobantes no producen efecto fiscal. */
  const iDofPres = buscar('PUBLICACION DOF PRESUNTOS');
  const iDofDesv = buscar('PUBLICACION DOF DESVIRTUADOS');
  const iDofDef  = buscar('PUBLICACION DOF DEFINITIVOS');
  const iDofSent = buscar('PUBLICACION DOF SENTENCIA FAVORABLE');

  if (iRfc < 0 || iSituacion < 0) {
    throw new ValidationError(
      'El archivo no trae las columnas de RFC y situacion del contribuyente.'
    );
  }

  const col = (f: string[], i: number) => (i >= 0 ? (f[i] || '').trim() || null : null);

  /* Se arma todo en memoria y se escribe en UNA transaccion, por lotes.
   *
   * La version anterior hacia un INSERT por renglon: 14,540 viajes a la base
   * para un solo archivo, y sin transaccion. Si reventaba a la mitad -que es
   * exactamente lo que paso con el archivo real- la lista quedaba a medias, con
   * unos contribuyentes al corte nuevo y otros al viejo, y nada que lo dijera. */
  type Fila = [string, string | null, string, string | null, string | null, string | null, string | null];
  const listos: Fila[] = [];
  const vistos = new Set<string>();
  let ignorados = 0;
  let repetidosEnArchivo = 0;

  for (const f of filas.slice(iEncabezado + 1)) {
    const rfc = String(f[iRfc] || '').toUpperCase().replace(/\s+/g, '');
    /* La Ñ es parte del alfabeto de los RFC —"PEÑA…" existe— y dejarla fuera
     * descartaría contribuyentes reales de la lista sin decir nada. */
    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) { ignorados++; continue; }

    const situacion = normalizarSituacion(col(f, iSituacion) || '');
    if (!situacion) { ignorados++; continue; }

    if (vistos.has(rfc)) repetidosEnArchivo++;
    vistos.add(rfc);

    const dof =
      situacion === 'DEFINITIVO'          ? fecha(col(f, iDofDef)  || '') :
      situacion === 'DESVIRTUADO'         ? fecha(col(f, iDofDesv) || '') :
      situacion === 'SENTENCIA_FAVORABLE' ? fecha(col(f, iDofSent) || '') :
                                            fecha(col(f, iDofPres) || '');

    listos.push([
      rfc,
      col(f, iNombre),
      situacion,
      col(f, iOfPres),
      col(f, iOfDef),
      col(f, iOfSent),
      /* Si la etapa no trae fecha, se cae a la de presuntos, que siempre esta:
       * vale mas una fecha vieja que ninguna. */
      dof || fecha(col(f, iDofPres) || ''),
    ]);
  }

  if (listos.length === 0) {
    throw new ValidationError(
      'El archivo no trajo ningun renglon con RFC y situacion validos. ' +
      'Es el listado completo del 69-B?'
    );
  }

  /* El propio archivo trae RFC repetidos, y con ON CONFLICT eso truena al
   * insertar por lotes ("cannot affect row a second time"). Gana el ULTIMO: la
   * publicacion los lista en orden y el ultimo es el estado mas avanzado. */
  const porRfc = new Map<string, Fila>();
  for (const f of listos) porRfc.set(f[0], f);
  const unicos = [...porRfc.values()];

  let nuevos = 0;
  let actualizados = 0;

  await transaction(async (client) => {
    const LOTE = 500;
    for (let i = 0; i < unicos.length; i += LOTE) {
      const parte = unicos.slice(i, i + LOTE);
      const marcas = parte.map((_, k) => {
        const b = k * 7;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::date, NOW())`;
      });
      const r = await transactionQuery<{ nuevo: boolean }>(
        client,
        `INSERT INTO sat_69b
           (rfc, nombre, situacion, oficio_presuncion, oficio_definitivo,
            oficio_sentencia, publicacion_dof, actualizado_at)
         VALUES ${marcas.join(',')}
         ON CONFLICT (rfc) DO UPDATE SET
           nombre            = COALESCE(EXCLUDED.nombre, sat_69b.nombre),
           situacion         = EXCLUDED.situacion,
           oficio_presuncion = COALESCE(EXCLUDED.oficio_presuncion, sat_69b.oficio_presuncion),
           oficio_definitivo = COALESCE(EXCLUDED.oficio_definitivo, sat_69b.oficio_definitivo),
           oficio_sentencia  = COALESCE(EXCLUDED.oficio_sentencia,  sat_69b.oficio_sentencia),
           publicacion_dof   = COALESCE(EXCLUDED.publicacion_dof,   sat_69b.publicacion_dof),
           actualizado_at    = NOW()
         RETURNING (xmax = 0) AS nuevo`,
        parte.flat()
      );
      for (const x of r.rows) { if (x.nuevo) nuevos++; else actualizados++; }
    }
  });

  const renglonesCargados = unicos.length;
  if (repetidosEnArchivo > 0) {
    logger.warn(
      `[69-B] el archivo traia ${repetidosEnArchivo} RFC repetidos; se conservo el ultimo de cada uno`
    );
  }

  await query(
    `INSERT INTO sat_69b_cargas (archivo, renglones, nuevos, actualizados, cargado_por)
     VALUES ($1,$2,$3,$4,$5)`,
    [archivo.slice(0, 300), renglonesCargados, nuevos, actualizados, userId || null]
  );

  logger.info(`[69-B] carga "${archivo}": ${renglonesCargados} renglones (${nuevos} nuevos, ${ignorados} ignorados)`);
  return { renglones: renglonesCargados, nuevos, actualizados, ignorados };
}

/**
 * El cruce: nuestros terceros que están en la lista.
 *
 * Se buscan clientes Y proveedores. Un cliente en la lista importa menos —el
 * riesgo del 69-B es sobre lo que uno DEDUCE— pero se muestra igual: enterarse
 * de con quién se está operando no sobra, y ocultarlo obligaría a consultarlo
 * en otro lado.
 */
export async function cruzar(companyId: string): Promise<any> {
  const coincidencias = await query<any>(
    `SELECT c.id, c.rfc, c.business_name, c.party_type,
            l.nombre AS nombre_en_lista, l.situacion,
            l.oficio_definitivo, l.publicacion_dof, l.actualizado_at,
            /* Con cuánto se ha operado: sin esto, saber que un proveedor está
             * en la lista no dice si el problema son mil pesos o un millón. */
            (SELECT COUNT(*)::int FROM invoices i
              WHERE i.customer_id = c.id AND i.deleted_at IS NULL
                AND i.status IN ('STAMPED','PAID'))              AS facturas_emitidas,
            (SELECT COALESCE(SUM(i.total),0) FROM invoices i
              WHERE i.customer_id = c.id AND i.deleted_at IS NULL
                AND i.status IN ('STAMPED','PAID'))              AS importe_emitido,
            (SELECT COUNT(*)::int FROM cfdi_recibidos r
              WHERE r.company_id = $1 AND r.rfc_emisor = c.rfc)  AS cfdi_recibidos,
            (SELECT COALESCE(SUM(r.total),0) FROM cfdi_recibidos r
              WHERE r.company_id = $1 AND r.rfc_emisor = c.rfc)  AS importe_recibido
       FROM customers c
       JOIN sat_69b l ON l.rfc = UPPER(c.rfc)
      WHERE c.company_id = $1 AND c.deleted_at IS NULL
      ORDER BY CASE l.situacion
                 WHEN 'DEFINITIVO' THEN 1
                 WHEN 'PRESUNTO' THEN 2
                 ELSE 3 END,
               c.business_name`,
    [companyId]
  );

  const lista = await query<any>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE situacion = 'DEFINITIVO')::int AS definitivos,
            MAX(actualizado_at) AS ultima_carga
       FROM sat_69b`
  );

  const carga = await query<any>(
    `SELECT archivo, renglones, created_at FROM sat_69b_cargas
      ORDER BY created_at DESC LIMIT 1`
  );

  return {
    coincidencias: coincidencias.rows,
    lista: lista.rows[0],
    ultimaCarga: carga.rows[0] || null,
  };
}
