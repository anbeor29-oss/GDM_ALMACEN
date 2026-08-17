/**
 * alta-en-bloque.service — varios recibos de nómina, varios expedientes.
 *
 * POR QUÉ HACÍA FALTA
 * Uno por uno funciona para corregir un expediente; no para arrancar. Quien
 * llega con la plantilla completa en XML timbrados tiene treinta o cincuenta
 * archivos, y abrirlos de a uno —leer, revisar, guardar, volver— es media
 * mañana. El lector los reconocía como recibos de nómina y ahí se quedaba: no
 * daba de alta a nadie.
 *
 * SIGUE PREGUNTANDO, PERO UNA VEZ
 * La condición original era preguntar antes de crear al trabajador y con qué
 * datos. Eso no cambia: `revisar()` lee todos los archivos y devuelve lo que
 * rescató de cada uno SIN escribir nada. La pantalla lo enseña completo, con
 * los avisos y lo que falta, y sólo entonces `crear()` da de alta a los que
 * quedaron marcados. Se pregunta una vez por el lote en lugar de una vez por
 * archivo, que es lo que hace la diferencia entre usable e inusable.
 *
 * UN MISMO TRABAJADOR EN VARIOS RECIBOS
 * Es lo normal: doce quincenas del mismo año son doce archivos con la misma
 * persona. Se agrupa por CURP —y por RFC cuando no hay CURP— y se conserva el
 * recibo MÁS RECIENTE de cada quien: el salario y el puesto del último recibo
 * son los vigentes, los del primero pueden tener un año de antigüedad.
 *
 * LOS NÚMEROS DE EMPLEADO NO CHOCAN
 * Cuando el XML trae NumEmpleado se respeta —es el que la empresa ya usa—. A
 * quien no lo traiga se le asigna consecutivo desde el último libre, y se
 * comprueba contra los que se están dando de alta en este mismo lote: pedir el
 * "siguiente número" cincuenta veces seguidas sin haber guardado devolvería
 * cincuenta veces el mismo.
 */

import { query } from '../../config/database';
import { ValidationError } from '../../middleware/errorHandler';
import logger from '../../middleware/logger';
import * as empleados from './empleados.service';
import { proponerDesdeXml, PropuestaExpediente } from './importar-xml.service';
import { detect } from '../xml-super-import/xml-super-import.service';

export interface Revisado {
  archivo: string;
  /** 'nuevo' se puede dar de alta · 'existe' ya está · 'error' no se pudo leer */
  estado: 'nuevo' | 'existe' | 'error';
  motivo?: string;
  propuesta?: PropuestaExpediente;
  /** Cuántos recibos del lote son de esta misma persona. */
  recibos?: number;
}

const MAXIMO_ARCHIVOS = 200;

/**
 * Lee todos los XML y arma una propuesta por trabajador. NO escribe nada.
 */
export async function revisar(
  companyId: string,
  archivos: Array<{ nombre: string; xml: string }>
): Promise<{ trabajadores: Revisado[]; resumen: any }> {
  if (!Array.isArray(archivos) || archivos.length === 0) {
    throw new ValidationError('No llegó ningún archivo');
  }
  if (archivos.length > MAXIMO_ARCHIVOS) {
    throw new ValidationError(
      `Son ${archivos.length} archivos y el tope por tanda es ${MAXIMO_ARCHIVOS}. ` +
      'Pártelo en varias: así se puede revisar lo que va entrando.'
    );
  }

  /* Clave de identidad: la CURP manda porque es única por persona; el RFC entra
   * cuando no hay CURP. Sin ninguna de las dos, el archivo no sirve. */
  const porPersona = new Map<string, Revisado>();
  const errores: Revisado[] = [];

  for (const a of archivos) {
    let det: any;
    try {
      det = await detect(a.xml);
    } catch (e: any) {
      errores.push({ archivo: a.nombre, estado: 'error', motivo: `No se pudo leer el XML: ${e.message}` });
      continue;
    }
    if (det.type !== 'CFDI_NOMINA') {
      errores.push({
        archivo: a.nombre, estado: 'error',
        motivo: 'No es un recibo de nómina; se ignora en esta pantalla.',
      });
      continue;
    }

    let p: PropuestaExpediente;
    try {
      p = await proponerDesdeXml(companyId, det);
    } catch (e: any) {
      errores.push({ archivo: a.nombre, estado: 'error', motivo: e.message });
      continue;
    }

    const clave =
      String(p.yaExiste ? det.nomina?.trabajador?.curp || det.receptor?.rfc : p.datos.curp || p.datos.rfc || '')
        .toUpperCase().trim() || a.nombre;

    const previo = porPersona.get(clave);
    const fila: Revisado = {
      archivo: a.nombre,
      estado: p.yaExiste ? 'existe' : 'nuevo',
      propuesta: p,
      recibos: (previo?.recibos || 0) + 1,
    };

    /* Gana el recibo más reciente: el salario y el puesto del último son los
     * vigentes. Se compara por fecha de pago, que es la que trae el complemento. */
    if (previo) {
      const fPrevio = previo.propuesta?.recibo?.fechaPago || '';
      const fNuevo = p.recibo?.fechaPago || '';
      if (fNuevo >= fPrevio) porPersona.set(clave, fila);
      else porPersona.set(clave, { ...previo, recibos: fila.recibos });
    } else {
      porPersona.set(clave, fila);
    }
  }

  const trabajadores = [...porPersona.values(), ...errores];

  /* Los números de empleado que se van a proponer, sin chocar entre ellos. */
  const nuevos = trabajadores.filter((t) => t.estado === 'nuevo' && t.propuesta);
  await asignarNumerosLibres(companyId, nuevos);

  return {
    trabajadores,
    resumen: {
      archivos: archivos.length,
      personas: porPersona.size,
      nuevos: nuevos.length,
      yaExisten: trabajadores.filter((t) => t.estado === 'existe').length,
      errores: errores.length,
    },
  };
}

/**
 * Reparte números de empleado sin repetir.
 *
 * Los que ya traen NumEmpleado del XML se respetan y además se apartan, para
 * que un consecutivo no caiga encima de ellos. Los demás se numeran desde el
 * último libre de la empresa.
 */
async function asignarNumerosLibres(companyId: string, filas: Revisado[]) {
  const r = await query<{ num: string }>(
    `SELECT num_empleado AS num FROM nomina_empleados
      WHERE company_id = $1 AND deleted_at IS NULL`,
    [companyId]
  );
  const ocupados = new Set(r.rows.map((x) => String(x.num).trim().toUpperCase()));

  /* Los del XML, primero: son los que mandan. */
  for (const f of filas) {
    const n = String(f.propuesta?.datos?.num_empleado || '').trim().toUpperCase();
    if (n && f.propuesta?.origen?.num_empleado === 'xml') ocupados.add(n);
  }

  let siguiente = 0;
  for (const n of ocupados) {
    const soloDigitos = n.replace(/\D/g, '');
    if (soloDigitos) siguiente = Math.max(siguiente, Number(soloDigitos));
  }

  for (const f of filas) {
    const p = f.propuesta!;
    const traeDelXml = p.origen?.num_empleado === 'xml' && String(p.datos.num_empleado || '').trim();
    if (traeDelXml) continue;
    do {
      siguiente++;
    } while (ocupados.has(String(siguiente).padStart(3, '0')));
    const asignado = String(siguiente).padStart(3, '0');
    ocupados.add(asignado);
    p.datos.num_empleado = asignado;
    p.origen.num_empleado = 'deducido';
  }
}

export interface ResultadoAlta {
  archivo: string;
  rfc?: string;
  nombre?: string;
  ok: boolean;
  id?: string;
  num_empleado?: string;
  motivo?: string;
}

/**
 * Da de alta los expedientes CONFIRMADOS.
 *
 * Recibe los expedientes que quedaron en la pantalla, no los XML: si se
 * volvieran a leer aquí, las correcciones que la persona hizo —el nombre mal
 * partido, el salario diario— se perderían y se guardaría lo que el importador
 * había adivinado.
 *
 * Cada alta va por su cuenta: que uno falle por un RFC repetido no debe tumbar
 * a los otros cuarenta y nueve. Se reporta uno por uno.
 */
export async function crear(
  companyId: string,
  expedientes: Array<{ archivo?: string; datos: any }>
): Promise<{ altas: ResultadoAlta[]; creados: number; fallidos: number }> {
  if (!Array.isArray(expedientes) || expedientes.length === 0) {
    throw new ValidationError('No llegó ningún expediente para dar de alta');
  }
  if (expedientes.length > MAXIMO_ARCHIVOS) {
    throw new ValidationError(`El tope por tanda es ${MAXIMO_ARCHIVOS} trabajadores.`);
  }

  const altas: ResultadoAlta[] = [];
  for (const e of expedientes) {
    const d = e?.datos || {};
    const etiqueta = {
      archivo: e?.archivo || '',
      rfc: d.rfc,
      nombre: [d.nombre, d.apellido_pat, d.apellido_mat].filter(Boolean).join(' '),
    };
    try {
      const creado = await empleados.crear(companyId, d);
      altas.push({ ...etiqueta, ok: true, id: creado.id, num_empleado: creado.num_empleado });
    } catch (err: any) {
      altas.push({ ...etiqueta, ok: false, motivo: err?.message || 'No se pudo dar de alta' });
    }
  }

  const creados = altas.filter((a) => a.ok).length;
  logger.info(`[nómina] alta en bloque: ${creados} de ${altas.length} expedientes`);
  return { altas, creados, fallidos: altas.length - creados };
}
