/**
 * Catálogo de bancos de México con su clave de 3 dígitos según CNBV/ABM.
 *
 *  Esta clave es la que forma los tres primeros dígitos de la CLABE
 *  interbancaria. Lista de las instituciones de banca múltiple y los
 *  participantes SPEI más usados por una empresa para recibir depósitos.
 *  (Fuente: catálogo de participantes SPEI de Banxico / claves ABM.)
 */

export interface BankMx {
  code: string;   // clave de 3 dígitos
  name: string;   // nombre comercial
}

export const BANKS_MX: BankMx[] = [
  { code: '002', name: 'BANAMEX (Citibanamex)' },
  { code: '006', name: 'BANCOMEXT' },
  { code: '009', name: 'BANOBRAS' },
  { code: '012', name: 'BBVA MÉXICO' },
  { code: '014', name: 'SANTANDER' },
  { code: '019', name: 'BANJERCITO' },
  { code: '021', name: 'HSBC' },
  { code: '030', name: 'BAJÍO' },
  { code: '036', name: 'INBURSA' },
  { code: '042', name: 'MIFEL' },
  { code: '044', name: 'SCOTIABANK' },
  { code: '058', name: 'BANREGIO' },
  { code: '059', name: 'INVEX' },
  { code: '060', name: 'BANSI' },
  { code: '062', name: 'AFIRME' },
  { code: '072', name: 'BANORTE' },
  { code: '106', name: 'BANK OF AMERICA' },
  { code: '108', name: 'MUFG' },
  { code: '110', name: 'JP MORGAN' },
  { code: '112', name: 'BMONEX' },
  { code: '113', name: 'VE POR MÁS' },
  { code: '116', name: 'ING' },
  { code: '124', name: 'DEUTSCHE BANK' },
  { code: '127', name: 'AZTECA' },
  { code: '128', name: 'AUTOFIN' },
  { code: '129', name: 'BARCLAYS' },
  { code: '130', name: 'COMPARTAMOS' },
  { code: '132', name: 'MULTIVA BANCO' },
  { code: '133', name: 'ACTINVER' },
  { code: '135', name: 'NAFIN' },
  { code: '136', name: 'INTERCAM BANCO' },
  { code: '137', name: 'BANCOPPEL' },
  { code: '138', name: 'ABC CAPITAL' },
  { code: '140', name: 'CONSUBANCO' },
  { code: '141', name: 'VOLKSWAGEN BANK' },
  { code: '143', name: 'CIBANCO' },
  { code: '145', name: 'BANCO BASE (BBASE)' },
  { code: '147', name: 'BANKAOOL' },
  { code: '148', name: 'PAGATODO' },
  { code: '150', name: 'INMOBILIARIO MEXICANO' },
  { code: '151', name: 'DONDÉ BANCO' },
  { code: '152', name: 'BANCREA' },
  { code: '154', name: 'BANCO FINTERRA' },
  { code: '155', name: 'ICBC' },
  { code: '156', name: 'SABADELL' },
  { code: '157', name: 'SHINHAN' },
  { code: '158', name: 'MIZUHO BANK' },
  { code: '159', name: 'BANK OF CHINA' },
  { code: '160', name: 'BANCO S3' },
  { code: '166', name: 'BANCO DEL BIENESTAR' },
  { code: '168', name: 'HIPOTECARIA FEDERAL' },
  { code: '600', name: 'MONEX (casa de bolsa)' },
  { code: '601', name: 'GBM' },
  { code: '602', name: 'MASARI' },
  { code: '605', name: 'VALUÉ' },
  { code: '608', name: 'VECTOR' },
  { code: '616', name: 'FINAMEX' },
  { code: '617', name: 'VALMEX' },
  { code: '620', name: 'PROFUTURO' },
  { code: '630', name: 'INTERCAM CASA DE BOLSA' },
  { code: '631', name: 'CI CASA DE BOLSA' },
  { code: '634', name: 'FINCOMÚN' },
  { code: '646', name: 'STP (Sistema de Transferencias y Pagos)' },
  { code: '652', name: 'CREDICLUB (ASEA)' },
  { code: '653', name: 'KUSPIT' },
  { code: '656', name: 'UNAGRA' },
  { code: '659', name: 'ASP INTEGRA OPCIONES' },
  { code: '670', name: 'LIBERTAD' },
  { code: '677', name: 'CAJA POP MEXICANA' },
  { code: '684', name: 'TRANSFER (OPERADORA DE PAGOS MÓVILES)' },
  { code: '706', name: 'ARCUS' },
  { code: '710', name: 'NVIO' },
  { code: '722', name: 'MERCADO PAGO W' },
  { code: '723', name: 'CUENCA' },
  { code: '728', name: 'SPIN BY OXXO' },
];

/** Nombre del banco dado su clave de 3 dígitos (o null). */
export function bankNameByCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return BANKS_MX.find((b) => b.code === code)?.name || null;
}
