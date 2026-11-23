/**
 * Pruebas de la nómina EMITIDA desde la bóveda de XML (lógica pura, sin base).
 *
 * El recibo de prueba cuadra a mano: percepciones 6,000 + 1,000 = 7,000; otros pagos
 * (subsidio entregado) 500; deducciones 800 + 150.50 + 200 + 100 = 1,250.50;
 * neto = 7,000 + 500 − 1,250.50 = 6,249.50 = el Total del CFDI.
 */
import {
  parseReciboNominaXml, claveCatalogo, armarPolizaCorrida, agruparCorridas, etiquetaCorrida,
  CONCEPTO_RESPALDO, type ReciboXml,
} from './nomina-emitida-xml';
import { CONCEPTOS_NOMINA } from '../nomina/nomina-conceptos.data';

const xmlRecibo = (o: { fechaPago?: string; ini?: string; fin?: string; tipo?: string } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:nomina12="http://www.sat.gob.mx/nomina12" Version="4.0" Fecha="2026-07-15T10:00:00" SubTotal="7500.00" Descuento="1250.50" Total="6249.50" TipoDeComprobante="N" Exportacion="01" MetodoPago="PUE" LugarExpedicion="64000" Moneda="MXN">
  <cfdi:Emisor Rfc="EKU9003173C9" Nombre="ESCUELA KEMPER URGATE" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="XOJI740919U48" Nombre="INGRID XODAR JIMENEZ" DomicilioFiscalReceptor="88965" RegimenFiscalReceptor="605" UsoCFDI="CN01"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111505" Cantidad="1" ClaveUnidad="ACT" Descripcion="Pago de nómina" ValorUnitario="7500.00" Importe="7500.00" Descuento="1250.50" ObjetoImp="01"/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <nomina12:Nomina Version="1.2" TipoNomina="${o.tipo ?? 'O'}" FechaPago="${o.fechaPago ?? '2026-07-15'}" FechaInicialPago="${o.ini ?? '2026-07-01'}" FechaFinalPago="${o.fin ?? '2026-07-15'}" NumDiasPagados="15.000" TotalPercepciones="7000.00" TotalDeducciones="1250.50" TotalOtrosPagos="500.00">
      <nomina12:Emisor RegistroPatronal="B5510768108"/>
      <nomina12:Receptor Curp="XOJI740919MJCDMN08" NumSeguridadSocial="000000" TipoContrato="01" TipoRegimen="02" NumEmpleado="1" PeriodicidadPago="04" ClaveEntFed="JAL"/>
      <nomina12:Percepciones TotalSueldos="7000.00" TotalGravado="6500.00" TotalExento="500.00">
        <nomina12:Percepcion TipoPercepcion="001" Clave="P001" Concepto="Sueldo" ImporteGravado="6000.00" ImporteExento="0.00"/>
        <nomina12:Percepcion TipoPercepcion="019" Clave="P019" Concepto="Horas extra" ImporteGravado="500.00" ImporteExento="500.00">
          <nomina12:HorasExtra Dias="1" TipoHoras="Dobles" HorasExtra="4" ImportePagado="1000.00"/>
        </nomina12:Percepcion>
      </nomina12:Percepciones>
      <nomina12:Deducciones TotalOtrasDeducciones="450.50" TotalImpuestosRetenidos="800.00">
        <nomina12:Deduccion TipoDeduccion="002" Clave="D002" Concepto="ISR" Importe="800.00"/>
        <nomina12:Deduccion TipoDeduccion="001" Clave="D001" Concepto="IMSS" Importe="150.50"/>
        <nomina12:Deduccion TipoDeduccion="011" Clave="D011" Concepto="FONACOT" Importe="200.00"/>
        <nomina12:Deduccion TipoDeduccion="018" Clave="D018" Concepto="Caja &amp; fondo de ahorro" Importe="100.00"/>
      </nomina12:Deducciones>
      <nomina12:OtrosPagos>
        <nomina12:OtroPago TipoOtroPago="002" Clave="OP002" Concepto="Subsidio para el empleo" Importe="500.00">
          <nomina12:SubsidioAlEmpleo SubsidioCausado="500.00"/>
        </nomina12:OtroPago>
      </nomina12:OtrosPagos>
    </nomina12:Nomina>
  </cfdi:Complemento>
</cfdi:Comprobante>`;

// El catálogo REAL de NEXO, con la cuenta sugerida asignada a cada concepto.
const catalogo = CONCEPTOS_NOMINA.map((c) => ({ grupo: c.grupo, clave: c.clave, nombre: c.nombre, cuenta: c.sugerida as string | null }));
const resolver = (codigo: string) => ({ id: `id-${codigo}`, codigo, nombre: `Cuenta ${codigo}` });
const recibo = (o?: Parameters<typeof xmlRecibo>[0]) => parseReciboNominaXml(xmlRecibo(o)) as ReciboXml;

describe('parseReciboNominaXml', () => {
  it('lee el detalle por concepto, las fechas y cuadra con el Total', () => {
    const r = recibo();
    expect(r.tipoNomina).toBe('O');
    expect(r.fechaPago).toBe('2026-07-15');
    expect(r.fechaInicialPago).toBe('2026-07-01');
    expect(r.fechaFinalPago).toBe('2026-07-15');
    expect(r.percepciones).toBe(7000);
    expect(r.deducciones).toBe(1250.5);
    expect(r.otrosPagos).toBe(500);
    expect(r.neto).toBe(6249.5);
    // 2 percepciones + 4 deducciones; los nodos contenedor y HorasExtra no cuentan.
    expect(r.conceptos.map((c) => `${c.grupo}|${c.tipo}|${c.importe}`)).toEqual([
      'PERCEPCION|001|6000', 'PERCEPCION|019|1000',
      'DEDUCCION|002|800', 'DEDUCCION|001|150.5', 'DEDUCCION|011|200', 'DEDUCCION|018|100',
    ]);
    expect(r.conceptos[5].concepto).toBe('Caja & fondo de ahorro');
  });

  it('sin FechaPago usa la FechaFinalPago', () => {
    expect(recibo({ fechaPago: '' }).fechaPago).toBe('2026-07-15');
  });

  it('un CFDI que no es de nómina devuelve null', () => {
    const ingreso = '<cfdi:Comprobante TipoDeComprobante="I" Total="116.00"><cfdi:Conceptos>' +
      '<cfdi:Concepto Importe="100.00"/></cfdi:Conceptos></cfdi:Comprobante>';
    expect(parseReciboNominaXml(ingreso)).toBeNull();
  });
});

describe('claveCatalogo', () => {
  const claves = new Set(catalogo.map((c) => `${c.grupo}|${c.clave}`));

  it('el catálogo trae los conceptos de los que depende el mapeo', () => {
    for (const k of ['PERCEPCION|SUBSIDIO', 'NETO|NETO', 'DEDUCCION|FONACOT', 'DEDUCCION|INFONAVIT',
      `PERCEPCION|${CONCEPTO_RESPALDO.PERCEPCION}`, `DEDUCCION|${CONCEPTO_RESPALDO.DEDUCCION}`]) {
      expect(claves.has(k)).toBe(true);
    }
  });

  it('código del SAT con concepto propio, alias y cajón', () => {
    expect(claveCatalogo('PERCEPCION', '001', claves)).toEqual({ clave: '001', propio: true });
    expect(claveCatalogo('DEDUCCION', '011', claves)).toEqual({ clave: 'FONACOT', propio: true });
    expect(claveCatalogo('DEDUCCION', '009', claves)).toEqual({ clave: 'INFONAVIT', propio: true });
    expect(claveCatalogo('DEDUCCION', '018', claves)).toEqual({ clave: '004', propio: false });
    expect(claveCatalogo('PERCEPCION', '005', claves)).toEqual({ clave: '039', propio: false });
  });
});

describe('armarPolizaCorrida', () => {
  it('arma la provisión por concepto y CUADRA', () => {
    const a = armarPolizaCorrida([recibo()], catalogo, resolver);
    expect(a.faltantes).toEqual([]);
    expect(a.cuadra).toBe(true);
    expect(a.sumaCargo).toBe(7500);
    expect(a.sumaAbono).toBe(7500);
    expect(a.lineas.map((l) => `${l.codigo}|${l.cargo ?? 0}|${l.abono ?? 0}`)).toEqual([
      '601.01|6000|0',      // 001 sueldo
      '601.01|1000|0',      // 019 horas extra
      '110.01|500|0',       // subsidio entregado
      '216.01|0|150.5',     // 001 IMSS
      '216.02|0|800',       // 002 ISR
      '216.99|0|100',       // 018 → cajón «Otros descuentos» (004)
      '213.01|0|200',       // 011 → FONACOT
      '210.01|0|6249.5',    // neto por pagar
    ]);
    // Lo que cayó al cajón se dice y se rotula en su renglón.
    expect(a.sinConceptoPropio).toEqual([
      { grupo: 'DEDUCCION', tipo: '018', concepto: 'Caja & fondo de ahorro', destino: '004' },
    ]);
    expect(a.lineas[5].concepto).toContain('018 Caja & fondo de ahorro');
  });

  it('suma varios recibos de la corrida y sigue cuadrando', () => {
    const a = armarPolizaCorrida([recibo(), recibo()], catalogo, resolver);
    expect(a.cuadra).toBe(true);
    expect(a.sumaCargo).toBe(15000);
    expect(a.totales).toEqual({ percepciones: 14000, otrosPagos: 1000, deducciones: 2501, neto: 12499 });
  });

  it('un concepto sin cuenta se reporta y NO se arma la póliza', () => {
    const sinIsr = catalogo.map((c) => (c.grupo === 'DEDUCCION' && c.clave === '002' ? { ...c, cuenta: null } : c));
    const a = armarPolizaCorrida([recibo()], sinIsr, resolver);
    expect(a.cuadra).toBe(false);
    expect(a.faltantes.map((f) => f.clave)).toEqual(['002']);
  });

  it('una cuenta asignada que no existe en el catálogo contable también es faltante', () => {
    const a = armarPolizaCorrida([recibo()], catalogo, (c) => (c === '210.01' ? null : resolver(c)));
    expect(a.cuadra).toBe(false);
    expect(a.faltantes[0].concepto).toContain('210.01');
  });
});

describe('corridas', () => {
  it('agrupa por tipo, periodo y fecha de pago; ordena por periodo', () => {
    const g = agruparCorridas([
      recibo({ ini: '2026-07-16', fin: '2026-07-31', fechaPago: '2026-07-31' }),
      recibo(),
      recibo(),
    ]);
    expect(g.map((x) => [x.recibos[0].fechaFinalPago, x.recibos.length])).toEqual([
      ['2026-07-15', 2], ['2026-07-31', 1],
    ]);
  });

  it('la etiqueta va en DD/MM/AAAA', () => {
    expect(etiquetaCorrida(recibo())).toBe('Nómina ordinaria 01/07/2026–15/07/2026');
    expect(etiquetaCorrida(recibo({ tipo: 'E', ini: '2026-12-15', fin: '2026-12-15' })))
      .toBe('Nómina extraordinaria 15/12/2026');
  });
});
