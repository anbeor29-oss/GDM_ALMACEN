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

import { query } from '../../config/database';
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

/** Fecha de la publicación: viene como dd/mm/aaaa o aaaa-mm-dd según el corte. */
function fecha(v: string): string | null {
  const s = String(v || '').trim();
  if (!s) return null;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  return null;
}

/** Parte una línea de CSV respetando las comillas: los nombres traen comas. */
function columnas(linea: string): string[] {
  const out: string[] = [];
  let actual = '';
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (entreComillas && linea[i + 1] === '"') { actual += '"'; i++; }
      else entreComillas = !entreComillas;
    } else if ((c === ',' || c === ';') && !entreComillas) {
      out.push(actual); actual = '';
    } else actual += c;
  }
  out.push(actual);
  return out.map((x) => x.trim());
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
  const lineas = String(csv || '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lineas.length < 2) {
    throw new ValidationError('El archivo viene vacío o no trae encabezados.');
  }

  /* El SAT antepone renglones de título antes del encabezado real. Se busca la
   * primera línea que contenga una columna llamada RFC. */
  let iEncabezado = lineas.findIndex((l) =>
    columnas(l).some((c) => /^rfc$/i.test(c.replace(/\s+/g, ''))));
  if (iEncabezado < 0) {
    throw new ValidationError(
      'No se encontró una columna llamada RFC. ¿Es el archivo que publica el SAT?'
    );
  }

  const enc = columnas(lineas[iEncabezado]).map((c) =>
    c.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim());

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
  const iOfPres    = buscar('NUMERO Y FECHA DE OFICIO GLOBAL DE PRESUNCION', 'OFICIO GLOBAL DE PRESUNCION', 'PRESUNCION');
  const iOfDef     = buscar('NUMERO Y FECHA DE OFICIO GLOBAL DE DEFINITIVOS', 'OFICIO GLOBAL DE DEFINITIVOS', 'DEFINITIVOS');
  const iDof       = buscar('PUBLICACION DOF PRESUNTOS', 'PUBLICACION DOF', 'DOF');

  if (iRfc < 0 || iSituacion < 0) {
    throw new ValidationError(
      'El archivo no trae las columnas de RFC y situación del contribuyente.'
    );
  }

  let nuevos = 0, actualizados = 0, ignorados = 0, renglones = 0;

  for (const linea of lineas.slice(iEncabezado + 1)) {
    const c = columnas(linea);
    const rfc = String(c[iRfc] || '').toUpperCase().replace(/\s+/g, '');
    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) { ignorados++; continue; }

    const situacion = normalizarSituacion(c[iSituacion]);
    if (!situacion) { ignorados++; continue; }

    renglones++;
    const r = await query<{ nuevo: boolean }>(
      `INSERT INTO sat_69b
         (rfc, nombre, situacion, oficio_presuncion, oficio_definitivo, publicacion_dof, actualizado_at)
       VALUES ($1,$2,$3,$4,$5,$6, NOW())
       ON CONFLICT (rfc) DO UPDATE SET
         nombre            = COALESCE(EXCLUDED.nombre, sat_69b.nombre),
         situacion         = EXCLUDED.situacion,
         oficio_presuncion = COALESCE(EXCLUDED.oficio_presuncion, sat_69b.oficio_presuncion),
         oficio_definitivo = COALESCE(EXCLUDED.oficio_definitivo, sat_69b.oficio_definitivo),
         publicacion_dof   = COALESCE(EXCLUDED.publicacion_dof, sat_69b.publicacion_dof),
         actualizado_at    = NOW()
       RETURNING (xmax = 0) AS nuevo`,
      [rfc,
       iNombre >= 0 ? (c[iNombre] || null) : null,
       situacion,
       iOfPres >= 0 ? (c[iOfPres] || null) : null,
       iOfDef  >= 0 ? (c[iOfDef]  || null) : null,
       iDof    >= 0 ? fecha(c[iDof]) : null]
    );
    if (r.rows[0]?.nuevo) nuevos++; else actualizados++;
  }

  await query(
    `INSERT INTO sat_69b_cargas (archivo, renglones, nuevos, actualizados, cargado_por)
     VALUES ($1,$2,$3,$4,$5)`,
    [archivo.slice(0, 300), renglones, nuevos, actualizados, userId || null]
  );

  logger.info(`[69-B] carga "${archivo}": ${renglones} renglones (${nuevos} nuevos, ${ignorados} ignorados)`);
  return { renglones, nuevos, actualizados, ignorados };
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
