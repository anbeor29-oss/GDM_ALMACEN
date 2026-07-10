/**
 * Datos de prueba seedeados — el script `seed-test-data.sh` los garantiza
 * en la BD antes de correr la suite. Mantén esto sincronizado con SQL.
 */
export const USERS = {
  manager: { email: 'manager@demo.com', password: 'admin123' },
  admin:   { email: 'admin@demo.com',   password: 'admin123' },
  invalid: { email: 'noexiste@x.com',   password: 'wrong' },
};

export const API_URL = process.env.API_URL || 'http://localhost:3000/api/v1';
export const FE_URL  = process.env.FE_URL  || 'http://localhost:5173';

/** Régimenes fiscales SAT cubiertos en la matriz pairwise */
export const REGIMENES = {
  PM_GENERAL: '601',  // PM Ley General
  HONORARIOS: '612',  // PF Honorarios
  ARRENDA:    '606',  // PF Arrendamiento
  RESICO:     '626',  // PF RESICO
  SUELDOS:    '605',  // PF Sueldos
};

/** Presets de impuesto válidos (matriz cliente×impuesto) */
export const TAX_PRESETS = [
  'iva16', 'iva8', 'iva0', 'ivaex',
  'hon_pf_pm', 'resico_pf_pm', 'arr_pf_pm',
  'auto_carga', 'desperdicios',
  'ieps_tasa', 'ieps_cuota',
] as const;

/** Cantidades: valores frontera (mín, válido, máx, sobre-máx) */
export const QTY_BOUNDARIES = {
  zero:        0,           // inválido: rechazado
  minValid:    0.001,       // límite inferior
  one:         1,
  threeDec:    5.075,       // 3 decimales (formato es-MX)
  maxValid:    999999.999,  // límite superior
  overMax:     1000000,     // clamp esperado a maxValid
  negative:   -10,          // clamp esperado a 0
};

/** Precios: valores frontera */
export const PRICE_BOUNDARIES = {
  zero:    0,        // inválido
  minPos:  0.01,
  normal:  1000,
  large:   999999.99,
  overflow: 1e12,    // protección anti-overflow
};

/** Porcentajes de NC para test pairwise */
export const NC_PERCENT_CASES = [0.01, 5, 50, 99.99, 100];

/** Régimen × Preset pairwise (10 combinaciones cubren la matriz) */
export const PAIRWISE_REGIMEN_PRESET = [
  { regimen: '601', preset: 'iva16'        },
  { regimen: '601', preset: 'iva0'         },
  { regimen: '601', preset: 'ivaex'        },
  { regimen: '601', preset: 'ieps_tasa'    },
  { regimen: '612', preset: 'hon_pf_pm'    },
  { regimen: '626', preset: 'resico_pf_pm' },
  { regimen: '606', preset: 'arr_pf_pm'    },
  { regimen: '601', preset: 'auto_carga'   },
  { regimen: '601', preset: 'desperdicios' },
  { regimen: '601', preset: 'iva8'         },
];
