/**
 * Pruebas del calendario de nómina.
 *
 * Aquí es donde este tipo de código falla: años bisiestos, febrero, la semana
 * 53 y el periodo que cruza el año nuevo. Todos los casos de abajo son fechas
 * reales verificables en un calendario, no salidas copiadas del código.
 */
import { calendario, MAXIMO_POR_TIPO, CLAVE_SAT } from './calendario';

describe('calendario mensual', () => {
  it('da 12 periodos con los días reales de cada mes', () => {
    const c = calendario('MENSUAL', 2026);
    expect(c).toHaveLength(12);
    expect(c[0]).toEqual({ numero: 1, fecha_inicio: '2026-01-01', fecha_fin: '2026-01-31', dias: 31 });
    // 2026 no es bisiesto: febrero tiene 28.
    expect(c[1]).toEqual({ numero: 2, fecha_inicio: '2026-02-01', fecha_fin: '2026-02-28', dias: 28 });
    expect(c[11]).toEqual({ numero: 12, fecha_inicio: '2026-12-01', fecha_fin: '2026-12-31', dias: 31 });
  });

  it('reconoce el año bisiesto', () => {
    // 2028 sí es bisiesto.
    expect(calendario('MENSUAL', 2028)[1].dias).toBe(29);
    // 2100 NO lo es, aunque sea múltiplo de 4 (regla del siglo).
    expect(calendario('MENSUAL', 2100)[1].dias).toBe(28);
  });
});

describe('calendario quincenal', () => {
  it('da 24 periodos: del 1 al 15 y del 16 al fin de mes', () => {
    const c = calendario('QUINCENAL', 2026);
    expect(c).toHaveLength(24);
    expect(c[0]).toEqual({ numero: 1, fecha_inicio: '2026-01-01', fecha_fin: '2026-01-15', dias: 15 });
    expect(c[1]).toEqual({ numero: 2, fecha_inicio: '2026-01-16', fecha_fin: '2026-01-31', dias: 16 });
  });

  it('la segunda quincena de febrero NO tiene 15 días', () => {
    const feb = calendario('QUINCENAL', 2026)[3];
    expect(feb.numero).toBe(4);
    expect(feb.fecha_fin).toBe('2026-02-28');
    expect(feb.dias).toBe(13);
    // En bisiesto, un día más.
    expect(calendario('QUINCENAL', 2028)[3].dias).toBe(14);
  });

  it('la numeración llega hasta 24 en diciembre', () => {
    const c = calendario('QUINCENAL', 2026);
    expect(c[23]).toEqual({ numero: 24, fecha_inicio: '2026-12-16', fecha_fin: '2026-12-31', dias: 16 });
  });
});

describe('calendario semanal', () => {
  it('parte de la fecha que da la empresa, en bloques de siete días', () => {
    const c = calendario('SEMANAL', 2026, '2026-01-05'); // lunes
    expect(c[0]).toEqual({ numero: 1, fecha_inicio: '2026-01-05', fecha_fin: '2026-01-11', dias: 7 });
    expect(c[1].fecha_inicio).toBe('2026-01-12');
  });

  it('la última semana puede terminar en enero del año siguiente', () => {
    const c = calendario('SEMANAL', 2026, '2026-01-05');
    const ultima = c[c.length - 1];
    // Debe INICIAR dentro del año; que termine en enero es correcto y esperado.
    expect(ultima.fecha_inicio.startsWith('2026-12')).toBe(true);
    expect(ultima.fecha_fin.startsWith('2027-01')).toBe(true);
  });

  it('admite hasta 53 semanas — truncar en 52 dejaría una sin poder pagarse', () => {
    // Arrancando el 1 de enero de 2026 caben 53 inicios dentro del año.
    const c = calendario('SEMANAL', 2026, '2026-01-01');
    expect(c.length).toBeGreaterThanOrEqual(52);
    expect(c.length).toBeLessThanOrEqual(MAXIMO_POR_TIPO.SEMANAL);
    expect(c[c.length - 1].numero).toBe(c.length);
  });

  it('exige la fecha de arranque en vez de suponer el lunes', () => {
    expect(() => calendario('SEMANAL', 2026)).toThrow(/fecha en que arranca/);
  });

  it('rechaza una fecha de arranque posterior al año', () => {
    expect(() => calendario('SEMANAL', 2026, '2027-03-01')).toThrow(/después del 31 de diciembre/);
  });

  it('rechaza una fecha mal escrita en vez de interpretarla', () => {
    expect(() => calendario('SEMANAL', 2026, '05/01/2026')).toThrow(/AAAA-MM-DD/);
    expect(() => calendario('SEMANAL', 2026, '2026-02-30')).toThrow(/no existe/);
  });
});

describe('reglas generales', () => {
  it('los topes por tipo son 53, 24 y 12', () => {
    expect(MAXIMO_POR_TIPO).toEqual({ SEMANAL: 53, QUINCENAL: 24, MENSUAL: 12 });
  });

  it('cada tipo trae su clave del c_PeriodicidadPago', () => {
    expect(CLAVE_SAT.SEMANAL).toBe('02');
    expect(CLAVE_SAT.QUINCENAL).toBe('04');
    expect(CLAVE_SAT.MENSUAL).toBe('05');
  });

  it('los periodos no se traslapan ni dejan huecos (quincenal y mensual)', () => {
    for (const tipo of ['QUINCENAL', 'MENSUAL'] as const) {
      const c = calendario(tipo, 2026);
      for (let i = 0; i < c.length - 1; i++) {
        const fin = new Date(`${c[i].fecha_fin}T00:00:00Z`);
        const sig = new Date(`${c[i + 1].fecha_inicio}T00:00:00Z`);
        expect(Math.round((sig.getTime() - fin.getTime()) / 86400000)).toBe(1);
      }
      expect(c[0].fecha_inicio).toBe('2026-01-01');
      expect(c[c.length - 1].fecha_fin).toBe('2026-12-31');
    }
  });

  it('los días declarados coinciden con las fechas', () => {
    for (const tipo of ['QUINCENAL', 'MENSUAL'] as const) {
      for (const p of calendario(tipo, 2028)) {
        const ini = new Date(`${p.fecha_inicio}T00:00:00Z`).getTime();
        const fin = new Date(`${p.fecha_fin}T00:00:00Z`).getTime();
        expect(Math.round((fin - ini) / 86400000) + 1).toBe(p.dias);
      }
    }
  });

  it('un año fuera de rango no se calcula', () => {
    expect(() => calendario('MENSUAL', 1800)).toThrow(/no es válido/);
  });
});
