/**
 * calendario — las fechas de los periodos de nómina.
 *
 * Vive aparte del servicio porque es aritmética pura: así se puede probar
 * contra los años bisiestos y las semanas 53 sin levantar Postgres, que es
 * justo donde este tipo de código falla.
 *
 * TODO SE MANEJA COMO TEXTO AAAA-MM-DD Y EN UTC
 * Un `new Date()` local en un servidor en otro huso corre las fechas un día, y
 * una nómina que empieza un día antes cambia los días pagados de toda la
 * plantilla.
 */

import { ValidationError } from '../../middleware/errorHandler';

export type TipoPeriodo = 'SEMANAL' | 'QUINCENAL' | 'MENSUAL';

export const MAXIMO_POR_TIPO: Record<TipoPeriodo, number> = {
  SEMANAL: 53, QUINCENAL: 24, MENSUAL: 12,
};

/** Periodicidad del CFDI (c_PeriodicidadPago) que corresponde a cada tipo. */
export const CLAVE_SAT: Record<TipoPeriodo, string> = {
  SEMANAL: '02', QUINCENAL: '04', MENSUAL: '05',
};

/* ── Fechas sin husos ──────────────────────────────────────────────────────
 *
 * Todo se maneja como texto AAAA-MM-DD y con aritmética UTC. Un `new Date()`
 * local en un servidor en otro huso corre las fechas un día, y una nómina que
 * empieza un día antes cambia los días pagados de toda la plantilla. */

export function aFecha(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) {
    throw new ValidationError(`La fecha "${s}" debe venir como AAAA-MM-DD`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`La fecha "${s}" no existe`);

  /* Comprobación de ida y vuelta.
   *
   * JavaScript NO rechaza un 30 de febrero: lo desborda al 2 de marzo sin
   * decir nada. Un arranque de nómina capturado con un día inexistente se
   * habría corrido dos días, y con él el corte de toda la plantilla. Si la
   * fecha reconstruida no es la que entró, es que no existía. */
  if (aTexto(d) !== s) throw new ValidationError(`La fecha "${s}" no existe en el calendario`);
  return d;
}

export function aTexto(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sumarDias(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** Diferencia en días, ambos extremos incluidos. */
function diasEntre(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function ultimoDiaDelMes(anio: number, mes1a12: number): number {
  return new Date(Date.UTC(anio, mes1a12, 0)).getUTCDate();
}

/* ═══════════════════ GENERACIÓN DEL CALENDARIO ═══════════════════ */

export interface PeriodoCalculado {
  numero: number;
  fecha_inicio: string;
  fecha_fin: string;
  dias: number;
}

/**
 * Arma el calendario del año, sin tocar la base.
 *
 * Se expone aparte para poder mostrarlo antes de guardarlo —y para poder
 * probarlo sin Postgres.
 */
export function calendario(
  tipo: TipoPeriodo,
  anio: number,
  fechaArranque?: string
): PeriodoCalculado[] {
  const a = Number(anio);
  if (!Number.isInteger(a) || a < 2000 || a > 2100) {
    throw new ValidationError('El año del calendario no es válido');
  }

  if (tipo === 'SEMANAL') {
    if (!fechaArranque) {
      throw new ValidationError(
        'El calendario semanal necesita la fecha en que arranca la primera semana: ' +
        'cada empresa cierra su semana en un día distinto y no se puede suponer.'
      );
    }
    const base = aFecha(fechaArranque);
    /* El corte es que el periodo INICIE dentro del año. La última semana puede
     * terminar en enero del siguiente, y así debe ser: se paga con el ejercicio
     * en que empezó. */
    const finDeAnio = aFecha(`${a}-12-31`);
    const out: PeriodoCalculado[] = [];
    for (let n = 0; n < MAXIMO_POR_TIPO.SEMANAL; n++) {
      const ini = sumarDias(base, n * 7);
      if (ini > finDeAnio) break;
      const fin = sumarDias(ini, 6);
      out.push({ numero: n + 1, fecha_inicio: aTexto(ini), fecha_fin: aTexto(fin), dias: 7 });
    }
    if (out.length === 0) {
      throw new ValidationError(
        `La fecha de arranque ${fechaArranque} cae después del 31 de diciembre de ${a}.`
      );
    }
    return out;
  }

  if (tipo === 'QUINCENAL') {
    const out: PeriodoCalculado[] = [];
    for (let mes = 1; mes <= 12; mes++) {
      const ultimo = ultimoDiaDelMes(a, mes);
      const mm = String(mes).padStart(2, '0');
      const primera = {
        numero: (mes - 1) * 2 + 1,
        fecha_inicio: `${a}-${mm}-01`,
        fecha_fin: `${a}-${mm}-15`,
        dias: 15,
      };
      const segunda = {
        numero: (mes - 1) * 2 + 2,
        fecha_inicio: `${a}-${mm}-16`,
        fecha_fin: `${a}-${mm}-${String(ultimo).padStart(2, '0')}`,
        /* Febrero da 13 o 14. Es el dato real del periodo. */
        dias: ultimo - 15,
      };
      out.push(primera, segunda);
    }
    return out;
  }

  const out: PeriodoCalculado[] = [];
  for (let mes = 1; mes <= 12; mes++) {
    const ultimo = ultimoDiaDelMes(a, mes);
    const mm = String(mes).padStart(2, '0');
    out.push({
      numero: mes,
      fecha_inicio: `${a}-${mm}-01`,
      fecha_fin: `${a}-${mm}-${String(ultimo).padStart(2, '0')}`,
      dias: ultimo,
    });
  }
  return out;
}

