/**
 * Tasas MÁXIMAS de depreciación y amortización — LISR arts. 33, 34 y 35.
 *
 * Son los PORCENTAJES MÁXIMOS autorizados (el contribuyente puede usar menos).
 * Se aplican en LÍNEA RECTA sobre el MOI (monto original de la inversión), que es
 * el costo neto —sin IVA— de la partida de compra que cayó en la cuenta de activo.
 *
 * La regla se elige por el AGRUPADOR de la cuenta de activo (los 3 dígitos antes
 * del punto: 154.01 → 154). Cada rubro apunta a su cuenta de GASTO (701.x
 * depreciación / 702.x amortización, que ya vienen en el catálogo) y a su
 * ACUMULADA complementaria (subcuenta bajo 171 tangibles / 183 intangibles, que
 * se crea al vuelo). Terrenos, obras en proceso y crédito mercantil NO se
 * deprecian: se registran, pero no generan póliza.
 *
 * OJO: son máximos de referencia. Se guardan por activo y se pueden ajustar; no
 * se "corrige" el catálogo del SAT ni se inventan cuentas nuevas del Anexo 24
 * (las acumuladas por rubro son subcuentas propias que mapean al agrupador 171/183).
 */

export interface ReglaDepreciacion {
  categoria: string;    // slug estable
  etiqueta: string;     // nombre legible del rubro
  tasaAnual: number;    // 0..1 — máximo LISR
  depreciable: boolean; // false = no genera depreciación (terrenos, obra en proceso, crédito mercantil)
  intangible: boolean;  // true → amortización (702/183); false → depreciación (701/171)
  gasto: string;        // código de la cuenta de gasto (701.0x / 702.0x)
  depAcum: string;      // código de la acumulada complementaria (171.0x / 183.0x)
  depAcumNombre: string;// nombre de la acumulada (para crearla si falta)
  fundamento: string;   // artículo/fracción LISR
}

/* agrupador de la cuenta de activo → regla. */
const REGLAS: Record<string, ReglaDepreciacion> = {
  '151': { categoria: 'terrenos', etiqueta: 'Terrenos', tasaAnual: 0, depreciable: false, intangible: false, gasto: '', depAcum: '', depAcumNombre: '', fundamento: 'No se deprecia (LISR 34; el terreno no pierde valor por uso)' },
  '152': { categoria: 'edificios', etiqueta: 'Edificios y construcciones', tasaAnual: 0.05, depreciable: true, intangible: false, gasto: '701.01', depAcum: '171.01', depAcumNombre: 'Depreciación acumulada de edificios', fundamento: 'LISR 34-I-b) 5%' },
  '153': { categoria: 'maquinaria', etiqueta: 'Maquinaria y equipo', tasaAnual: 0.10, depreciable: true, intangible: false, gasto: '701.02', depAcum: '171.02', depAcumNombre: 'Depreciación acumulada de maquinaria y equipo', fundamento: 'LISR 35-XIV 10% (los demás)' },
  '154': { categoria: 'vehiculos', etiqueta: 'Automóviles, camiones y equipo de transporte', tasaAnual: 0.25, depreciable: true, intangible: false, gasto: '701.03', depAcum: '171.03', depAcumNombre: 'Depreciación acumulada de vehículos', fundamento: 'LISR 34-VI 25%' },
  '155': { categoria: 'mobiliario', etiqueta: 'Mobiliario y equipo de oficina', tasaAnual: 0.10, depreciable: true, intangible: false, gasto: '701.04', depAcum: '171.04', depAcumNombre: 'Depreciación acumulada de mobiliario y equipo de oficina', fundamento: 'LISR 34-III 10%' },
  '156': { categoria: 'computo', etiqueta: 'Equipo de cómputo', tasaAnual: 0.30, depreciable: true, intangible: false, gasto: '701.05', depAcum: '171.05', depAcumNombre: 'Depreciación acumulada de equipo de cómputo', fundamento: 'LISR 34-VII 30%' },
  '157': { categoria: 'comunicacion', etiqueta: 'Equipo de comunicación', tasaAnual: 0.10, depreciable: true, intangible: false, gasto: '701.06', depAcum: '171.06', depAcumNombre: 'Depreciación acumulada de equipo de comunicación', fundamento: 'LISR 35-XIV 10%' },
  '158': { categoria: 'biologicos', etiqueta: 'Activos biológicos, vegetales y semovientes', tasaAnual: 0.25, depreciable: true, intangible: false, gasto: '701.07', depAcum: '171.07', depAcumNombre: 'Depreciación acumulada de activos biológicos', fundamento: 'LISR 35 (según actividad; ajústese)' },
  '159': { categoria: 'obra-en-proceso', etiqueta: 'Obras en proceso de activos fijos', tasaAnual: 0, depreciable: false, intangible: false, gasto: '', depAcum: '', depAcumNombre: '', fundamento: 'No se deprecia hasta que el activo entra en uso (NIF C-6)' },
  '160': { categoria: 'otros', etiqueta: 'Otros activos fijos', tasaAnual: 0.10, depreciable: true, intangible: false, gasto: '701.08', depAcum: '171.08', depAcumNombre: 'Depreciación acumulada de otros activos fijos', fundamento: 'LISR 35-XIV 10%' },
  '161': { categoria: 'ferrocarriles', etiqueta: 'Ferrocarriles', tasaAnual: 0.06, depreciable: true, intangible: false, gasto: '701.09', depAcum: '171.09', depAcumNombre: 'Depreciación acumulada de ferrocarriles', fundamento: 'LISR 34-II 6%' },
  '162': { categoria: 'embarcaciones', etiqueta: 'Embarcaciones', tasaAnual: 0.06, depreciable: true, intangible: false, gasto: '701.10', depAcum: '171.10', depAcumNombre: 'Depreciación acumulada de embarcaciones', fundamento: 'LISR 34-IV 6%' },
  '163': { categoria: 'aviones', etiqueta: 'Aviones', tasaAnual: 0.10, depreciable: true, intangible: false, gasto: '701.11', depAcum: '171.11', depAcumNombre: 'Depreciación acumulada de aviones', fundamento: 'LISR 34-V 10%' },
  '164': { categoria: 'troqueles', etiqueta: 'Troqueles, moldes, matrices y herramental', tasaAnual: 0.35, depreciable: true, intangible: false, gasto: '701.02', depAcum: '171.02', depAcumNombre: 'Depreciación acumulada de maquinaria y equipo', fundamento: 'LISR 34-VIII 35%' },
  '165': { categoria: 'comunicacion', etiqueta: 'Equipo de comunicaciones telefónicas', tasaAnual: 0.10, depreciable: true, intangible: false, gasto: '701.06', depAcum: '171.06', depAcumNombre: 'Depreciación acumulada de equipo de comunicación', fundamento: 'LISR 34-IX (según tipo; 10% general)' },
  '166': { categoria: 'comunicacion', etiqueta: 'Equipo de comunicación satelital', tasaAnual: 0.08, depreciable: true, intangible: false, gasto: '701.06', depAcum: '171.06', depAcumNombre: 'Depreciación acumulada de equipo de comunicación', fundamento: 'LISR 34-X 8%' },
  '167': { categoria: 'adaptaciones-discapacidad', etiqueta: 'Adaptaciones para personas con capacidades diferentes', tasaAnual: 1.0, depreciable: true, intangible: false, gasto: '701.08', depAcum: '171.08', depAcumNombre: 'Depreciación acumulada de otros activos fijos', fundamento: 'LISR 34-XIII 100%' },
  '168': { categoria: 'energia-renovable', etiqueta: 'Maquinaria de energía renovable o cogeneración eficiente', tasaAnual: 1.0, depreciable: true, intangible: false, gasto: '701.02', depAcum: '171.02', depAcumNombre: 'Depreciación acumulada de maquinaria y equipo', fundamento: 'LISR 34-XIII 100% (con requisitos de operación)' },
  '169': { categoria: 'maquinaria', etiqueta: 'Otra maquinaria y equipo', tasaAnual: 0.10, depreciable: true, intangible: false, gasto: '701.02', depAcum: '171.02', depAcumNombre: 'Depreciación acumulada de maquinaria y equipo', fundamento: 'LISR 35-XIV 10%' },
  '170': { categoria: 'adaptaciones', etiqueta: 'Adaptaciones y mejoras', tasaAnual: 0.05, depreciable: true, intangible: false, gasto: '701.01', depAcum: '171.01', depAcumNombre: 'Depreciación acumulada de edificios', fundamento: 'LISR 34-I 5% (o vida del contrato)' },

  // ── Diferidos / intangibles: se AMORTIZAN (702.x / 183.x) ──
  '173': { categoria: 'diferidos', etiqueta: 'Gastos diferidos', tasaAnual: 0.15, depreciable: true, intangible: true, gasto: '702.01', depAcum: '183.01', depAcumNombre: 'Amortización acumulada de gastos diferidos', fundamento: 'LISR 33-III 15%' },
  '174': { categoria: 'preoperativos', etiqueta: 'Gastos pre operativos', tasaAnual: 0.10, depreciable: true, intangible: true, gasto: '702.02', depAcum: '183.02', depAcumNombre: 'Amortización acumulada de gastos pre operativos', fundamento: 'LISR 33-II 10%' },
  '175': { categoria: 'regalias', etiqueta: 'Regalías, asistencia técnica y otros gastos diferidos', tasaAnual: 0.15, depreciable: true, intangible: true, gasto: '702.03', depAcum: '183.03', depAcumNombre: 'Amortización acumulada de regalías y asistencia técnica', fundamento: 'LISR 33-III 15%' },
  '176': { categoria: 'intangibles', etiqueta: 'Activos intangibles (software, licencias)', tasaAnual: 0.15, depreciable: true, intangible: true, gasto: '702.04', depAcum: '183.04', depAcumNombre: 'Amortización acumulada de activos intangibles', fundamento: 'LISR 33-III 15% (intangible de vida definida)' },
  '177': { categoria: 'organizacion', etiqueta: 'Gastos de organización', tasaAnual: 0.05, depreciable: true, intangible: true, gasto: '702.05', depAcum: '183.05', depAcumNombre: 'Amortización acumulada de gastos de organización', fundamento: 'LISR 33-I 5%' },
  '178': { categoria: 'investigacion', etiqueta: 'Investigación y desarrollo de mercado', tasaAnual: 0.15, depreciable: true, intangible: true, gasto: '702.06', depAcum: '183.06', depAcumNombre: 'Amortización acumulada de investigación y desarrollo', fundamento: 'LISR 33-III 15%' },
  '179': { categoria: 'marcas-patentes', etiqueta: 'Marcas y patentes', tasaAnual: 0.05, depreciable: true, intangible: true, gasto: '702.07', depAcum: '183.07', depAcumNombre: 'Amortización acumulada de marcas y patentes', fundamento: 'LISR 33-I 5% (o vida legal del derecho)' },
  '180': { categoria: 'credito-mercantil', etiqueta: 'Crédito mercantil', tasaAnual: 0, depreciable: false, intangible: true, gasto: '', depAcum: '', depAcumNombre: '', fundamento: 'No se amortiza; se prueba deterioro (NIF C-8 / LISR no deducible)' },
  '181': { categoria: 'instalacion', etiqueta: 'Gastos de instalación', tasaAnual: 0.05, depreciable: true, intangible: true, gasto: '702.09', depAcum: '183.09', depAcumNombre: 'Amortización acumulada de gastos de instalación', fundamento: 'LISR 33-I 5%' },
  '182': { categoria: 'otros-diferidos', etiqueta: 'Otros activos diferidos', tasaAnual: 0.05, depreciable: true, intangible: true, gasto: '702.10', depAcum: '183.10', depAcumNombre: 'Amortización acumulada de otros activos diferidos', fundamento: 'LISR 33-I 5%' },
};

/** El agrupador (3 dígitos) de un código de cuenta: '154.01' → '154', '154' → '154'. */
export function agrupadorDeCodigo(codigo: string): string {
  return String(codigo || '').trim().split('.')[0].replace(/\D/g, '').slice(0, 3);
}

/** La regla de depreciación de una cuenta de activo, o null si no es activo fijo. */
export function reglaDeCuentaActivo(codigo: string): ReglaDepreciacion | null {
  return REGLAS[agrupadorDeCodigo(codigo)] || null;
}

/** ¿El código es una cuenta de activo fijo/diferido susceptible de registrarse? */
export function esCuentaDeActivoFijo(codigo: string): boolean {
  return reglaDeCuentaActivo(codigo) != null;
}

export { REGLAS };
