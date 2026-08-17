/**
 * parametros.service — lo que le falta a la empresa para ser patrón.
 *
 * POR QUÉ ESTO NO ES UNA PANTALLA DE "EMPRESA"
 * El sistema de nómina que se integra traía su propio alta de empresa: RFC,
 * razón social, régimen, domicilio y el CSD. En NEXO todo eso ya existe y ya se
 * captura una vez, en Datos de mi empresa. Volver a pedirlo aquí no sólo sería
 * teclear dos veces: dejaría dos verdades sobre el mismo RFC y abriría la
 * puerta a timbrar la nómina con un certificado distinto al de la facturación.
 *
 * Así que esta pantalla pide EXACTAMENTE tres cosas y ninguna más:
 *
 *   1. Registro patronal — lo asigna el IMSS y va en cada recibo.
 *   2. Prima de riesgo   — la determina el IMSS para esta empresa en concreto
 *                          y se revisa cada febrero. Es la única cuota que no
 *                          es un porcentaje fijo de ley.
 *   3. Factor de integración — días de aguinaldo y % de prima vacacional con
 *                          los que se calcula el SDI. La ley fija mínimos; lo
 *                          que la empresa da de más también integra.
 *
 * LOS MÍNIMOS SE PROPONEN, NO SE ASUMEN
 * `sugeridos` devuelve 15 días y 25% porque son los mínimos del Art. 87 y del
 * Art. 80 de la LFT. La pantalla los propone y el usuario confirma. Guardarlos
 * solos haría que el primer cálculo de una empresa que da 30 días de aguinaldo
 * saliera mal sin que nadie lo notara.
 */

import { query } from '../../config/database';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler';

/** Mínimos de ley — se proponen en la pantalla, no se guardan por su cuenta. */
export const MINIMOS_DE_LEY = {
  aguinaldoDias: 15,   // Art. 87 LFT
  primaVacPct: 25,     // Art. 80 LFT
};

export interface ParametrosPatronales {
  registro_patronal: string | null;
  prima_riesgo: number | null;
  fi_aguinaldo_dias: number | null;
  fi_prima_vac_pct: number | null;
}

export async function obtener(companyId: string) {
  const r = await query<any>(
    `SELECT rfc, business_name, fiscal_regime, postal_code,
            registro_patronal, prima_riesgo, fi_aguinaldo_dias, fi_prima_vac_pct,
            (csd_cer_path IS NOT NULL AND csd_key_path IS NOT NULL) AS tiene_csd
       FROM companies
      WHERE id = $1 AND deleted_at IS NULL`,
    [companyId]
  );
  if (r.rows.length === 0) throw new NotFoundError('La empresa no existe');
  const c = r.rows[0];

  return {
    /* Datos de sólo lectura: viven en Datos de mi empresa y se muestran aquí
     * para que se vea de qué empresa se está hablando, no para editarlos. */
    empresa: {
      rfc: c.rfc,
      razonSocial: c.business_name,
      regimenFiscal: c.fiscal_regime,
      codigoPostal: c.postal_code,
      tieneCsd: !!c.tiene_csd,
    },
    parametros: {
      registro_patronal: c.registro_patronal,
      prima_riesgo: c.prima_riesgo === null ? null : Number(c.prima_riesgo),
      fi_aguinaldo_dias: c.fi_aguinaldo_dias === null ? null : Number(c.fi_aguinaldo_dias),
      fi_prima_vac_pct: c.fi_prima_vac_pct === null ? null : Number(c.fi_prima_vac_pct),
    } as ParametrosPatronales,
    sugeridos: MINIMOS_DE_LEY,
    /* Qué impide todavía correr una nómina. La pantalla lo enseña completo en
     * vez de fallar campo por campo al primer intento de cálculo. */
    faltantes: faltantes(c),
  };
}

function faltantes(c: any): string[] {
  const f: string[] = [];
  if (!c.registro_patronal) f.push('registro patronal ante el IMSS');
  if (c.prima_riesgo === null) f.push('prima de riesgo de trabajo');
  if (c.fi_aguinaldo_dias === null) f.push('días de aguinaldo para integrar el SDI');
  if (c.fi_prima_vac_pct === null) f.push('prima vacacional para integrar el SDI');
  if (!c.tiene_csd) f.push('certificado de sello digital (se carga en Datos de mi empresa)');
  return f;
}

/**
 * El registro patronal del IMSS son 11 posiciones alfanuméricas. Se valida la
 * forma, no el dígito verificador: el algoritmo del IMSS no es público y una
 * validación inventada rechazaría registros buenos.
 */
const RE_REGISTRO_PATRONAL = /^[A-Z0-9]{11}$/;

export async function actualizar(companyId: string, d: Partial<ParametrosPatronales>) {
  const sets: string[] = [];
  const args: any[] = [companyId];

  if (d.registro_patronal !== undefined) {
    const v = String(d.registro_patronal ?? '').toUpperCase().replace(/[\s-]/g, '').trim();
    if (v && !RE_REGISTRO_PATRONAL.test(v)) {
      throw new ValidationError(
        'El registro patronal son 11 posiciones (letras y números), como aparece ' +
        'en la tarjeta de identificación patronal del IMSS.'
      );
    }
    args.push(v || null);
    sets.push(`registro_patronal = $${args.length}`);
  }

  if (d.prima_riesgo !== undefined) {
    if (d.prima_riesgo === null || d.prima_riesgo === ('' as any)) {
      args.push(null);
    } else {
      const n = Number(d.prima_riesgo);
      if (!Number.isFinite(n)) throw new ValidationError('La prima de riesgo debe ser un número');
      /* Los límites del Art. 72 LSS: 0.5% mínimo, 15% máximo. Fuera de ahí no
       * es una prima, es un dedo pegado en el teclado. */
      if (n < 0.5 || n > 15) {
        throw new ValidationError(
          `La prima de riesgo ${n} está fuera del rango legal (0.5 % a 15 %, Art. 72 LSS). ` +
          'Se captura como porcentaje: 0.54355, no 0.0054355.'
        );
      }
      args.push(n);
    }
    sets.push(`prima_riesgo = $${args.length}`);
  }

  if (d.fi_aguinaldo_dias !== undefined) {
    const n = Number(d.fi_aguinaldo_dias);
    if (!Number.isInteger(n)) throw new ValidationError('Los días de aguinaldo deben ser un número entero');
    if (n < MINIMOS_DE_LEY.aguinaldoDias) {
      throw new ValidationError(
        `El aguinaldo no puede ser menor a ${MINIMOS_DE_LEY.aguinaldoDias} días (Art. 87 LFT). ` +
        'Se puede dar más, nunca menos.'
      );
    }
    if (n > 365) throw new ValidationError('Los días de aguinaldo no pueden pasar de 365');
    args.push(n);
    sets.push(`fi_aguinaldo_dias = $${args.length}`);
  }

  if (d.fi_prima_vac_pct !== undefined) {
    const n = Number(d.fi_prima_vac_pct);
    if (!Number.isFinite(n)) throw new ValidationError('La prima vacacional debe ser un número');
    if (n < MINIMOS_DE_LEY.primaVacPct) {
      throw new ValidationError(
        `La prima vacacional no puede ser menor al ${MINIMOS_DE_LEY.primaVacPct} % (Art. 80 LFT).`
      );
    }
    if (n > 100) throw new ValidationError('La prima vacacional no puede pasar del 100 %');
    args.push(n);
    sets.push(`fi_prima_vac_pct = $${args.length}`);
  }

  if (sets.length === 0) throw new ValidationError('No hay nada que actualizar');

  const r = await query(
    `UPDATE companies SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL`,
    args
  );
  if (r.rowCount === 0) throw new NotFoundError('La empresa no existe');

  return obtener(companyId);
}
