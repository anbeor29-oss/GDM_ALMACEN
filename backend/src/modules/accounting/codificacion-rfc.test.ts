/**
 * Motor de codificación por RFC — la jerarquía de sugerencias y su confianza.
 * Sin base de datos: se arma un contexto en memoria.
 */
import { sugerir, cuentaEfectiva, normDesc, type ContextoCodificacion } from './codificacion-rfc.service';

const RFC = 'AAA010101AAA';

function ctx(over: Partial<ContextoCodificacion> = {}): ContextoCodificacion {
  return {
    patrones: new Map(), reglas: new Map(), producto: new Map(), unica: null,
    cuentas: new Map([
      ['601-01', { nombre: 'Papelería', tipo: 'GASTO', movible: true }],
      ['601-02', { nombre: 'Mantenimiento', tipo: 'GASTO', movible: true }],
      ['115-01', { nombre: 'Inventario', tipo: 'ACTIVO', movible: true }],
      ['601', { nombre: 'Gastos generales', tipo: 'GASTO', movible: false }],
    ]),
    ...over,
  };
}
const pat = (nivel: string, rfc: string, clave: string, dist: Array<[string, number, string, string]>, desc = '') => {
  const n = dist.reduce((a, d) => a + d[1], 0);
  const sorted = dist.slice().sort((a, b) => b[1] - a[1]);
  return [`${nivel}|${rfc}|${clave}|${desc}`, {
    nivel, rfc, clave, descripcion: desc, cuenta_top: sorted[0][0], muestras: n, consistencia: sorted[0][1] / n,
    distribucion: sorted.map(([cuenta, k, primera, ultima]) => ({ cuenta, n: k, primera, ultima })), ejemplos: [],
  }] as [string, any];
};

describe('sugerir', () => {
  it('sin historia ni configuración → SIN_EVIDENCIA', () => {
    const s = sugerir(ctx(), RFC, '44121600', 'Plumas');
    expect(s.nivel).toBe('SIN_EVIDENCIA');
    expect(s.cuenta).toBeNull();
  });

  it('regla aprobada → ALTO', () => {
    const c = ctx({ reglas: new Map([[`${RFC}|44121600`, { id: 'r1', estado: 'APROBADA', cuenta_codigo: '601-01', version: 1 }]]) });
    const s = sugerir(c, RFC, '44121600', 'Plumas');
    expect(s.nivel).toBe('ALTO');
    expect(s.cuenta).toBe('601-01');
  });

  it('regla PROPUESTA no cuenta como aprobada', () => {
    const c = ctx({ reglas: new Map([[`${RFC}|44121600`, { id: 'r1', estado: 'PROPUESTA', cuenta_codigo: '601-01', version: 1 }]]) });
    expect(sugerir(c, RFC, '44121600', 'Plumas').nivel).toBe('SIN_EVIDENCIA');
  });

  it('patrón consistente proveedor+producto (n≥3, ≥90%) → MEDIO', () => {
    const c = ctx({ patrones: new Map([pat('RFC_CLAVE', RFC, '44121600', [['601-01', 5, '2025-01-01', '2026-01-01']])]) });
    const s = sugerir(c, RFC, '44121600', 'Plumas');
    expect(s.nivel).toBe('MEDIO');
    expect(s.cuenta).toBe('601-01');
    expect(s.muestras).toBe(5);
  });

  it('una sola coincidencia no basta → BAJO', () => {
    const c = ctx({ patrones: new Map([pat('RFC_CLAVE', RFC, '44121600', [['601-01', 1, '2025-01-01', '2025-01-01']])]) });
    expect(sugerir(c, RFC, '44121600', 'Plumas').nivel).toBe('BAJO');
  });

  it('contradicción (cuentas mezcladas) → BAJO, no elige a ciegas', () => {
    const c = ctx({ patrones: new Map([pat('RFC_CLAVE', RFC, '44121600', [
      ['601-01', 3, '2025-01-01', '2026-03-01'], ['601-02', 3, '2025-02-01', '2026-02-01']])]) });
    const s = sugerir(c, RFC, '44121600', 'Plumas');
    expect(s.nivel).toBe('BAJO');
    expect(s.motivo).toMatch(/contradicción/);
    expect(s.alternativas.length).toBe(2);
  });

  it('cambio de política: la cuenta reciente reemplazó a la vieja', () => {
    const c = ctx({ patrones: new Map([pat('RFC_CLAVE', RFC, '44121600', [
      ['601-01', 6, '2024-01-01', '2025-06-30'], ['601-02', 3, '2025-07-01', '2026-01-01']])]) });
    const s = sugerir(c, RFC, '44121600', 'Plumas');
    expect(s.cuenta).toBe('601-02');
    expect(s.motivo).toMatch(/cambio de cuenta/);
  });

  it('proveedor con varias cuentas: el RFC solo no decide → BAJO', () => {
    const c = ctx({ patrones: new Map([pat('RFC', RFC, '', [['601-01', 5, '2025-01-01', '2026-01-01'], ['115-01', 4, '2025-01-01', '2026-01-01']])]) });
    expect(sugerir(c, RFC, '99999999', 'Otra cosa').nivel).toBe('BAJO');
  });

  it('clave genérica usa proveedor + descripción', () => {
    const desc = normDesc('Servicio de mantenimiento');
    const c = ctx({ patrones: new Map([pat('RFC_DESC', RFC, '01010101', [['601-02', 4, '2025-01-01', '2026-01-01']], desc)]) });
    const s = sugerir(c, RFC, '01010101', 'SERVICIO DE MANTENIMIENTO');
    expect(s.cuenta).toBe('601-02');
    expect(s.base).toBe('RFC_DESC');
  });

  it('cuenta histórica fuera del catálogo vigente → incidencia de mapeo y BAJO', () => {
    const c = ctx({ patrones: new Map([pat('RFC_CLAVE', RFC, '44121600', [['999-99', 5, '2025-01-01', '2026-01-01']])]) });
    const s = sugerir(c, RFC, '44121600', 'Plumas');
    expect(s.nivel).toBe('BAJO');
    expect(s.incidencia).toMatch(/no existe/);
  });

  it('cuenta de mayor (no admite movimientos) → incidencia', () => {
    const c = ctx({ producto: new Map([['44121600', '601']]) });
    expect(sugerir(c, RFC, '44121600', 'Plumas').incidencia).toMatch(/no admite/);
  });
});

describe('cuentaEfectiva (lo que usa el motor de pólizas)', () => {
  const base = ctx({
    reglas: new Map([[`${RFC}|44121600`, { id: 'r1', estado: 'APROBADA', cuenta_codigo: '601-01' }]]),
    producto: new Map([['44121600', '115-01']]),
  });
  it('decisión del usuario manda', () => {
    expect(cuentaEfectiva(base, '601-02', RFC, '44121600')).toMatchObject({ cuenta: '601-02', fuente: 'DECISION' });
  });
  it('regla aprobada antes que la asignación por producto', () => {
    expect(cuentaEfectiva(base, undefined, RFC, '44121600')).toMatchObject({ cuenta: '601-01', fuente: 'REGLA' });
  });
  it('otro proveedor cae a la asignación por producto', () => {
    expect(cuentaEfectiva(base, undefined, 'BBB010101BBB', '44121600')).toMatchObject({ cuenta: '115-01', fuente: 'PRODUCTO' });
  });
  it('«una sola cuenta» va antes que reglas y producto, pero no antes que la decisión', () => {
    const c = { ...base, unica: '601-02' };
    expect(cuentaEfectiva(c, undefined, RFC, '44121600').fuente).toBe('CUENTA_UNICA');
    expect(cuentaEfectiva(c, '115-01', RFC, '44121600').fuente).toBe('DECISION');
  });
  it('regla suspendida no se aplica', () => {
    const c = ctx({ reglas: new Map([[`${RFC}|44121600`, { id: 'r1', estado: 'SUSPENDIDA', cuenta_codigo: '601-01' }]]) });
    expect(cuentaEfectiva(c, undefined, RFC, '44121600').cuenta).toBeNull();
  });
});
