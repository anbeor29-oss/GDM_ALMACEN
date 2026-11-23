/**
 * nomina-emitida-xml — lógica PURA (sin base de datos) para contabilizar la nómina
 * EMITIDA que vive en la BÓVEDA de XML cuando NO salió del módulo de Nómina (se
 * timbró en otro sistema y llegó por la descarga del SAT o por un respaldo).
 *
 * Está aparte del servicio para probarla sin levantar la base (mismo patrón que
 * calendario.ts / nombre-mexicano.ts).
 *
 * La póliza es la MISMA que la de la corrida del módulo de Nómina
 * (nomina-poliza.service → armarPolizaPeriodo), con las MISMAS cuentas
 * (Contabilidad → Asignación de cuentas → Nómina):
 *   Percepciones            → CARGO al gasto de su concepto (601.xx)
 *   Otros pagos (subsidio)  → CARGO a «Subsidio al empleo por aplicar» (110.01)
 *   Deducciones             → ABONO al pasivo de su concepto (216.xx / 205 / 213…)
 *   Neto                    → ABONO a «Neto por pagar» (210.01)
 * Siempre cuadra: por construcción del CFDI, neto = percepciones + otros pagos −
 * deducciones, y aquí el neto se calcula con ese mismo detalle.
 *
 * EL CONCEPTO SE RECONOCE POR SU CLAVE DEL SAT, NO POR LA DEL SISTEMA QUE TIMBRÓ
 * El catálogo de conceptos de NEXO está indexado por el c_TipoPercepcion /
 * c_TipoDeduccion (nomina-conceptos.data) y el propio NEXO timbra con
 * TipoDeduccion = esa clave (cierre.service). La `Clave` del XML es interna de cada
 * sistema y no se usa.
 */
import { fechaMx } from '../../utils/fecha-mx';

export type GrupoXml = 'PERCEPCION' | 'DEDUCCION';

export interface ConceptoXml {
  grupo: GrupoXml;
  /** c_TipoPercepcion / c_TipoDeduccion tal como viene en el XML. */
  tipo: string;
  /** Texto del concepto en el XML (el que escribió el sistema que timbró). */
  concepto: string;
  importe: number;
}

export interface ReciboXml {
  /** O = ordinaria, E = extraordinaria. */
  tipoNomina: string;
  /** AAAA-MM-DD */
  fechaPago: string;
  fechaInicialPago: string;
  fechaFinalPago: string;
  conceptos: ConceptoXml[];
  otrosPagos: number;
  percepciones: number;
  deducciones: number;
  neto: number;
}

const attr = (s: string, n: string) => {
  const m = new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`).exec(s);
  return m ? m[1] : '';
};
const num = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
export const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const fecha10 = (s: string) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '');
const desentidad = (s: string) => s
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Lee el complemento de nómina 1.2 CON SU DETALLE por concepto (regex, sin parser
 * DOM, como el resto de la bóveda). Suma TODOS los nodos Percepcion / Deduccion /
 * OtroPago del documento, así un CFDI con más de un complemento queda completo.
 * Las fechas salen del primer nodo Nomina. Devuelve null si no es de nómina.
 */
export function parseReciboNominaXml(xml: string): ReciboXml | null {
  const nom = (/<(?:\w+:)?Nomina\b[^>]*>/.exec(xml) || [''])[0];
  if (!nom) return null;

  const conceptos: ConceptoXml[] = [];
  // `Percepcion\b` NO empata con `Percepciones` (ni `Deduccion\b` con `Deducciones`).
  for (const p of xml.match(/<(?:\w+:)?Percepcion\b[^>]*>/g) || []) {
    const importe = r2(num(attr(p, 'ImporteGravado')) + num(attr(p, 'ImporteExento')));
    if (importe > 0) {
      conceptos.push({ grupo: 'PERCEPCION', tipo: attr(p, 'TipoPercepcion'), concepto: desentidad(attr(p, 'Concepto')), importe });
    }
  }
  for (const d of xml.match(/<(?:\w+:)?Deduccion\b[^>]*>/g) || []) {
    const importe = r2(num(attr(d, 'Importe')));
    if (importe > 0) {
      conceptos.push({ grupo: 'DEDUCCION', tipo: attr(d, 'TipoDeduccion'), concepto: desentidad(attr(d, 'Concepto')), importe });
    }
  }
  // Otros pagos: lo ENTREGADO (Importe). El subsidio causado que se aplicó contra el
  // ISR no se paga y no mueve el neto.
  let otros = 0;
  for (const o of xml.match(/<(?:\w+:)?OtroPago\b[^>]*>/g) || []) otros += num(attr(o, 'Importe'));

  const percepciones = r2(conceptos.filter((c) => c.grupo === 'PERCEPCION').reduce((a, c) => a + c.importe, 0));
  const deducciones = r2(conceptos.filter((c) => c.grupo === 'DEDUCCION').reduce((a, c) => a + c.importe, 0));
  const otrosPagos = r2(otros);
  const ffp = fecha10(attr(nom, 'FechaFinalPago'));
  const fp = fecha10(attr(nom, 'FechaPago'));
  const fechaFinalPago = ffp || fp;
  return {
    tipoNomina: attr(nom, 'TipoNomina') || 'O',
    fechaPago: fp || fechaFinalPago,
    fechaInicialPago: fecha10(attr(nom, 'FechaInicialPago')) || fechaFinalPago,
    fechaFinalPago,
    conceptos,
    otrosPagos,
    percepciones,
    deducciones,
    neto: r2(percepciones + otrosPagos - deducciones),
  };
}

/* ═══════════════ Del código del SAT al concepto del catálogo de NEXO ═══════════════ */

/** Códigos del SAT que en el catálogo de NEXO viven con clave PROPIA. Fundamento en el
 *  propio código: FONACOT = 011 (creditos.service, prenomina, motor.DEDUCCIONES);
 *  INFONAVIT = 009 (revision-nomina). */
const ALIAS: Record<string, string> = {
  'DEDUCCION|011': 'FONACOT',
  'DEDUCCION|009': 'INFONAVIT',
};

/** El concepto «cajón» del catálogo para lo que NO tiene concepto propio: así un XML
 *  externo nunca se queda atorado por un código que el usuario no puede asignar. */
export const CONCEPTO_RESPALDO: Record<GrupoXml, string> = { PERCEPCION: '039', DEDUCCION: '004' };

/** A qué concepto del catálogo va un código del XML. `propio` = false cuando cae al cajón. */
export function claveCatalogo(grupo: GrupoXml, tipo: string, claves: Set<string>): { clave: string; propio: boolean } {
  const k = `${grupo}|${tipo}`;
  if (claves.has(k)) return { clave: tipo, propio: true };
  const alias = ALIAS[k];
  if (alias && claves.has(`${grupo}|${alias}`)) return { clave: alias, propio: true };
  return { clave: CONCEPTO_RESPALDO[grupo], propio: false };
}

/* ═══════════════ Corridas reconstruidas ═══════════════ */

/** Una corrida = mismo tipo de nómina, mismo periodo pagado y misma fecha de pago. */
export const claveCorrida = (r: Pick<ReciboXml, 'tipoNomina' | 'fechaInicialPago' | 'fechaFinalPago' | 'fechaPago'>) =>
  `${r.tipoNomina}|${r.fechaInicialPago}|${r.fechaFinalPago}|${r.fechaPago}`;

export function agruparCorridas<T extends ReciboXml>(recibos: T[]): Array<{ clave: string; recibos: T[] }> {
  const m = new Map<string, T[]>();
  for (const r of recibos) {
    const k = claveCorrida(r);
    const arr = m.get(k);
    if (arr) arr.push(r); else m.set(k, [r]);
  }
  return Array.from(m.entries())
    .map(([clave, rs]) => ({ clave, recibos: rs }))
    .sort((a, b) => a.recibos[0].fechaFinalPago.localeCompare(b.recibos[0].fechaFinalPago)
      || a.clave.localeCompare(b.clave));
}

/** «Nómina ordinaria 01/07/2026–15/07/2026» (fechas visibles en DD/MM/AAAA). */
export function etiquetaCorrida(r: Pick<ReciboXml, 'tipoNomina' | 'fechaInicialPago' | 'fechaFinalPago'>): string {
  const tipo = r.tipoNomina === 'E' ? 'extraordinaria' : 'ordinaria';
  const ini = fechaMx(r.fechaInicialPago), fin = fechaMx(r.fechaFinalPago);
  return `Nómina ${tipo} ${ini && ini !== fin ? `${ini}–${fin}` : fin}`;
}

/* ═══════════════ La póliza de la corrida ═══════════════ */

export interface ConceptoCatalogo { grupo: string; clave: string; nombre: string; cuenta: string | null }
export interface CuentaResuelta { id: string; codigo: string; nombre: string }
export interface LineaArmada {
  account_id: string; codigo: string; nombre: string;
  cargo?: number; abono?: number; concepto: string;
}

/**
 * Arma (sin escribir) la póliza AGREGADA de los recibos de una corrida: un renglón por
 * concepto del catálogo, igual que la corrida del módulo. Lo que no tenga cuenta se
 * reporta como faltante en vez de armar una póliza incompleta.
 */
export function armarPolizaCorrida(
  recibos: ReciboXml[],
  catalogo: ConceptoCatalogo[],
  resolver: (codigo: string) => CuentaResuelta | null,
) {
  const claves = new Set(catalogo.map((c) => `${c.grupo}|${c.clave}`));
  const porClave = new Map(catalogo.map((c) => [`${c.grupo}|${c.clave}`, c]));

  const perc = new Map<string, number>();
  const ded = new Map<string, number>();
  // Lo que cayó al cajón, para decirlo (y rotularlo en el renglón).
  const sinPropio = new Map<string, { grupo: GrupoXml; tipo: string; concepto: string; destino: string }>();
  let otros = 0, neto = 0;
  for (const r of recibos) {
    for (const c of r.conceptos) {
      const { clave, propio } = claveCatalogo(c.grupo, c.tipo, claves);
      const m = c.grupo === 'PERCEPCION' ? perc : ded;
      m.set(clave, r2((m.get(clave) || 0) + c.importe));
      if (!propio) {
        sinPropio.set(`${c.grupo}|${c.tipo}`, { grupo: c.grupo, tipo: c.tipo, concepto: c.concepto, destino: clave });
      }
    }
    otros = r2(otros + r.otrosPagos);
    neto = r2(neto + r.neto);
  }

  const lineas: LineaArmada[] = [];
  const faltantes: Array<{ grupo: string; clave: string; concepto: string; importe: number }> = [];
  const rotulo = (grupo: string, clave: string, base: string) => {
    const incl = Array.from(sinPropio.values()).filter((s) => s.grupo === grupo && s.destino === clave);
    return incl.length
      ? `${base} (incluye ${incl.map((s) => `${s.tipo} ${s.concepto}`.trim()).join(', ')})`.slice(0, 200)
      : base;
  };
  const linea = (grupo: string, clave: string, lado: 'cargo' | 'abono', importe: number) => {
    if (importe <= 0) return;
    const cfg = porClave.get(`${grupo}|${clave}`);
    const nombre = cfg?.nombre || clave;
    if (!cfg?.cuenta) { faltantes.push({ grupo, clave, concepto: nombre, importe }); return; }
    const cta = resolver(cfg.cuenta);
    if (!cta) {
      faltantes.push({ grupo, clave, concepto: `${nombre} (cuenta ${cfg.cuenta} inexistente o sin movimientos)`, importe });
      return;
    }
    const base = { account_id: cta.id, codigo: cta.codigo, nombre: cta.nombre, concepto: rotulo(grupo, clave, nombre) };
    lineas.push(lado === 'cargo' ? { ...base, cargo: importe } : { ...base, abono: importe });
  };

  const orden = (m: Map<string, number>) => Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [clave, imp] of orden(perc)) linea('PERCEPCION', clave, 'cargo', r2(imp));
  linea('PERCEPCION', 'SUBSIDIO', 'cargo', otros);
  for (const [clave, imp] of orden(ded)) linea('DEDUCCION', clave, 'abono', r2(imp));
  linea('NETO', 'NETO', 'abono', neto);

  const sumaCargo = r2(lineas.reduce((a, l) => a + (l.cargo || 0), 0));
  const sumaAbono = r2(lineas.reduce((a, l) => a + (l.abono || 0), 0));
  return {
    lineas,
    faltantes,
    sinConceptoPropio: Array.from(sinPropio.values()),
    sumaCargo,
    sumaAbono,
    cuadra: faltantes.length === 0 && lineas.length > 0 && Math.abs(sumaCargo - sumaAbono) <= 0.02,
    totales: {
      percepciones: r2(Array.from(perc.values()).reduce((a, x) => a + x, 0)),
      otrosPagos: otros,
      deducciones: r2(Array.from(ded.values()).reduce((a, x) => a + x, 0)),
      neto,
    },
  };
}
