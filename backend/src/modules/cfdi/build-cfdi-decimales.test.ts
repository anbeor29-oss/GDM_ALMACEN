/**
 * El CFDI que se manda al PAC tiene que cuadrar CONTRA SI MISMO.
 *
 * Caso real del 25/11/2026: 400 bolsas a 32.219827 para que el total cierre en
 * 14,950.00 exactos. El PAC rechazaba porque invoice_items.unit_price era
 * DECIMAL(15,2): el precio se guardaba como 32.22 y 400 x 32.22 = 12,888.00
 * contra un importe declarado de 12,887.93. Siete centavos, con tolerancia de
 * uno.
 *
 * No necesita base: se le ponen a `query` las filas que devolveria.
 */
jest.mock('../../config/database', () => ({ query: jest.fn() }));

import { query } from '../../config/database';
import { buildCFDIJson } from './build-cfdi-json.service';

const consulta = query as unknown as jest.Mock;

const EMPRESA = {
  rfc: 'GHC1707275Y0',
  business_name: 'Grupo HCGM',
  fiscal_regime: '601',
  postal_code: '64000',
};

const FACTURA = {
  id: 'f-1',
  serie: 'A',
  folio: 7,
  payment_form: '99',
  payment_method: 'PPD',
  currency: 'MXN',
  cfdi_type: 'I',
  cfdi_use: 'G03',
  subtotal: '12887.93',
  tax_transferred: '2062.07',
  tax_retained: '0',
  total: '14950.00',
  discount: '0',
  date_issued: '2026-11-25',
  cust_rfc: 'AABA800101AA1',
  cust_name: 'Cliente de Prueba',
  cust_cp: '64000',
  cust_regime: '612',
};

/** Una linea con el precio de 6 decimales, como queda tras la migracion. */
const LINEA_BUENA = {
  line_number: 1,
  quantity: '400.0000',
  unit_price: '32.219827',
  subtotal: '12887.93',
  tax_amount: '2062.07',
  total: '14950.00',
  description: 'BOLSA NEGRA 50 X 70',
  clave_sat: '24111503',
  unit_code: 'KGM',
  tax_rate: '0.160000',
  ret_iva_rate: '0',
  ret_isr_rate: '0',
  ieps_rate: '0',
};

function montaConsultas(items: any[], factura: any = FACTURA) {
  consulta.mockReset();
  consulta
    .mockResolvedValueOnce({ rows: [factura] })   // factura + receptor
    .mockResolvedValueOnce({ rows: items })       // conceptos
    .mockResolvedValueOnce({ rows: [EMPRESA] });  // emisor
}

describe('decimales del CFDI — el caso de las 400 bolsas', () => {
  it('el precio va con 6 decimales y el importe con los 2 de la moneda', async () => {
    montaConsultas([LINEA_BUENA]);
    const doc = await buildCFDIJson('emp-1', 'f-1');

    expect(doc.Conceptos[0].ValorUnitario).toBe('32.219827');
    expect(doc.Conceptos[0].Importe).toBe('12887.93');
    expect(doc.Conceptos[0].Cantidad).toBe('400.000000');
  });

  it('el total cierra EXACTO en 14,950.00', async () => {
    montaConsultas([LINEA_BUENA]);
    const doc = await buildCFDIJson('emp-1', 'f-1');

    expect(doc.SubTotal).toBe('12887.93');
    expect(doc.Total).toBe('14950.00');
    expect(doc.Impuestos?.TotalImpuestosTrasladados).toBe('2062.07');
  });

  it('cumple la regla del SAT: Importe = Cantidad x ValorUnitario, dentro de un centavo', async () => {
    montaConsultas([LINEA_BUENA]);
    const doc = await buildCFDIJson('emp-1', 'f-1');

    const c = doc.Conceptos[0];
    const calculado = Number(c.Cantidad) * Number(c.ValorUnitario);
    expect(Math.abs(calculado - Number(c.Importe))).toBeLessThanOrEqual(0.01);
  });

  it('y el subtotal es la suma de los conceptos', async () => {
    montaConsultas([LINEA_BUENA, { ...LINEA_BUENA, line_number: 2 }], {
      ...FACTURA,
      subtotal: '25775.86',
      tax_transferred: '4124.14',
      total: '29900.00',
    });
    const doc = await buildCFDIJson('emp-1', 'f-1');

    const suma = doc.Conceptos.reduce((a: number, c: any) => a + Number(c.Importe), 0);
    expect(suma).toBeCloseTo(Number(doc.SubTotal), 2);
    expect(doc.Total).toBe('29900.00');
  });

  it('un precio truncado a 2 decimales YA NO se manda al PAC: se explica', async () => {
    // Exactamente lo que quedaba guardado antes de la migracion.
    montaConsultas([{ ...LINEA_BUENA, unit_price: '32.22' }]);

    // Un solo intento: cada llamada consume las tres respuestas montadas.
    const error = await buildCFDIJson('emp-1', 'f-1').catch((e) => e);
    expect(error.message).toMatch(/no cuadra/i);
    expect(error.message).toMatch(/12888\.00/);        // lo que da la multiplicacion
    expect(error.message).toMatch(/12887\.93/);        // lo que decia el importe guardado
    expect(error.message).toMatch(/vuelve a teclear el precio/i);
  });

  it('un total que no cuadra se detiene aqui, no en el PAC', async () => {
    montaConsultas([LINEA_BUENA], { ...FACTURA, total: '14999.00' });
    await expect(buildCFDIJson('emp-1', 'f-1')).rejects.toThrow(/no cuadra/i);
  });

  it('un subtotal que no cuadra con sus conceptos tambien', async () => {
    montaConsultas([LINEA_BUENA], { ...FACTURA, subtotal: '10000.00', total: '11600.00' });
    await expect(buildCFDIJson('emp-1', 'f-1')).rejects.toThrow(/no coincide con la suma/i);
  });
});

describe('decimales del CFDI — otras formas de la misma cuenta', () => {
  it('cantidad fraccionaria con precio de 6 decimales (gasolina, granel)', async () => {
    // 38.452 litros a 21.457831 = 825.096517... -> 825.10
    const sub = '825.10';
    const iva = '132.02';   // 825.10 x 0.16 = 132.016 -> 132.02
    montaConsultas(
      [{ ...LINEA_BUENA, quantity: '38.4520', unit_price: '21.457831', subtotal: sub }],
      { ...FACTURA, subtotal: sub, tax_transferred: iva, total: '957.12' },
    );
    const doc = await buildCFDIJson('emp-1', 'f-1');

    expect(doc.Conceptos[0].ValorUnitario).toBe('21.457831');
    expect(doc.Conceptos[0].Importe).toBe('825.10');
    expect(doc.Total).toBe('957.12');
  });

  it('un precio de 2 decimales de toda la vida sigue saliendo igual', async () => {
    montaConsultas(
      [{ ...LINEA_BUENA, quantity: '2.0000', unit_price: '150.00', subtotal: '300.00' }],
      { ...FACTURA, subtotal: '300.00', tax_transferred: '48.00', total: '348.00' },
    );
    const doc = await buildCFDIJson('emp-1', 'f-1');

    expect(doc.Conceptos[0].ValorUnitario).toBe('150.000000');
    expect(doc.Conceptos[0].Importe).toBe('300.00');
    expect(doc.Total).toBe('348.00');
  });
});
