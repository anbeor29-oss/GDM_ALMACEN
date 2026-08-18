/**
 * pdf-recibo.service — el recibo de nómina en papel.
 *
 * DE DÓNDE SALEN LOS DATOS
 * Del XML, no de la base. El XML es lo que se le mandó al SAT y lo que el
 * trabajador puede verificar; si el papel se armara con las columnas de la
 * tabla, cualquier corrección posterior al expediente cambiaría el recibo sin
 * cambiar el comprobante, y los dos dejarían de decir lo mismo. Ya nos pasó con
 * los complementos de pago: el XML declaraba tres facturas y el PDF imprimía
 * una.
 *
 * SIRVE ANTES Y DESPUÉS DE TIMBRAR
 * Con el pre-timbre sale el mismo recibo, sin el bloque del timbre y con un
 * sello de agua que lo dice. Así se revisa en papel antes de gastar un timbre,
 * que es justo el paso que el sistema separa a propósito.
 *
 * EL FORMATO
 * Es el de la casa: emisor arriba, bloque del trabajador, las tablas de
 * percepciones, deducciones y otros pagos, la leyenda de recibí con el importe
 * en letra, y el pie con los sellos y la cadena original. Una sola hoja para un
 * recibo normal.
 */

import PDFDocument from 'pdfkit';
import { query } from '../../config/database';
import { NotFoundError } from '../../middleware/errorHandler';
import { fmtMoney, montoEnLetra } from '../cfdi/pdf-helpers';

type Doc = PDFKit.PDFDocument;

/* Márgenes y anchos: una carta con 28 pt de margen deja 556 pt útiles. */
const M = 28;
const ANCHO = 595.28 - M * 2;

/** Saca un atributo de un nodo del XML sin montar un parser completo. */
function attr(xml: string, nodo: string, nombre: string): string {
  const n = new RegExp(`<${nodo}\\b[^>]*>`, 'i').exec(xml);
  if (!n) return '';
  const a = new RegExp(`\\b${nombre}="([^"]*)"`, 'i').exec(n[0]);
  return a ? desescapar(a[1]) : '';
}

/** Todos los nodos de un tipo, con sus atributos ya en objeto. */
function nodos(xml: string, nodo: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const re = new RegExp(`<${nodo}\\b([^>]*)\\/?>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const o: Record<string, string> = {};
    const ra = /([A-Za-z0-9_]+)="([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = ra.exec(m[1]))) o[a[1]] = desescapar(a[2]);
    out.push(o);
  }
  return out;
}

function desescapar(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function texto(xml: string, nodo: string): string {
  const m = new RegExp(`<${nodo}[^>]*>([\\s\\S]*?)<\\/${nodo}>`, 'i').exec(xml);
  return m ? m[1].trim() : '';
}

const n2 = (v: any) => Number(v || 0);

/** Etiqueta gris, valor negro, en una sola línea. */
function par(doc: Doc, x: number, y: number, etiqueta: string, valor: string, ancho = 180) {
  doc.fontSize(6.5).fillColor('#6b7280').text(etiqueta.toUpperCase(), x, y, { width: ancho });
  doc.fontSize(8).fillColor('#111827').text(valor || '—', x, y + 8, { width: ancho, ellipsis: true });
}

/**
 * Una tabla de conceptos. Devuelve la Y donde terminó, para encadenar la
 * siguiente sin dejar huecos ni encimarlas.
 */
function tabla(
  doc: Doc, y: number, titulo: string,
  filas: Array<{ clave: string; concepto: string; gravado?: number; exento?: number; importe: number }>,
  opciones: { conGravado?: boolean; color?: string } = {}
): number {
  const conGravado = opciones.conGravado !== false;
  const color = opciones.color || '#374151';

  doc.rect(M, y, ANCHO, 13).fill('#f3f4f6');
  doc.fontSize(7.5).fillColor(color).text(titulo, M + 4, y + 3.5);
  y += 13;

  /* Columnas: clave, concepto, y a la derecha los importes. */
  const cx = { clave: M + 4, concepto: M + 42, grav: M + 300, exen: M + 388, tot: M + 470 };
  doc.fontSize(6.5).fillColor('#6b7280');
  doc.text('CLAVE', cx.clave, y + 2);
  doc.text('CONCEPTO', cx.concepto, y + 2);
  if (conGravado) {
    doc.text('GRAVADO', cx.grav, y + 2, { width: 80, align: 'right' });
    doc.text('EXENTO', cx.exen, y + 2, { width: 74, align: 'right' });
  }
  doc.text('TOTAL', cx.tot, y + 2, { width: 82, align: 'right' });
  y += 11;
  doc.moveTo(M, y).lineTo(M + ANCHO, y).lineWidth(0.5).strokeColor('#d1d5db').stroke();
  y += 2;

  let sg = 0, se = 0, st = 0;
  for (const f of filas) {
    doc.fontSize(7.5).fillColor('#111827');
    doc.text(f.clave, cx.clave, y);
    doc.text(f.concepto, cx.concepto, y, { width: 250, ellipsis: true });
    if (conGravado) {
      doc.text(fmtMoney(f.gravado || 0), cx.grav, y, { width: 80, align: 'right' });
      doc.text(fmtMoney(f.exento || 0), cx.exen, y, { width: 74, align: 'right' });
    }
    doc.text(fmtMoney(f.importe), cx.tot, y, { width: 82, align: 'right' });
    sg += n2(f.gravado); se += n2(f.exento); st += n2(f.importe);
    y += 10;
  }

  if (filas.length === 0) {
    doc.fontSize(7.5).fillColor('#9ca3af').text('Sin conceptos', cx.concepto, y);
    y += 10;
  }

  doc.moveTo(M, y).lineTo(M + ANCHO, y).lineWidth(0.5).strokeColor('#d1d5db').stroke();
  y += 2;
  doc.fontSize(7.5).fillColor('#111827').font('Helvetica-Bold');
  doc.text(`TOTAL ${titulo}`, cx.concepto, y, { width: 250 });
  if (conGravado) {
    doc.text(fmtMoney(sg), cx.grav, y, { width: 80, align: 'right' });
    doc.text(fmtMoney(se), cx.exen, y, { width: 74, align: 'right' });
  }
  doc.text(fmtMoney(st), cx.tot, y, { width: 82, align: 'right' });
  doc.font('Helvetica');
  return y + 14;
}

export async function generarReciboPDF(
  companyId: string,
  reciboId: string
): Promise<{ buffer: Buffer; nombre: string; timbrado: boolean }> {
  const r = await query<any>(
    `SELECT r.*, p.tipo, p.numero AS periodo_numero, p.anio, p.concepto,
            TO_CHAR(p.fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,
            TO_CHAR(p.fecha_fin,'YYYY-MM-DD')    AS fecha_fin,
            TO_CHAR(p.fecha_pago,'YYYY-MM-DD')   AS fecha_pago,
            /* El salario diario del contrato NO va en el complemento 1.2 —sólo
             * el integrado—, así que se trae del expediente para poder
             * imprimirlo. Todo lo demás sale del XML. */
            e.salario_diario, e.puesto, e.departamento
       FROM nomina_recibos r
       JOIN nomina_periodos p  ON p.id = r.periodo_id
       LEFT JOIN nomina_empleados e ON e.id = r.empleado_id
      WHERE r.id = $1 AND r.company_id = $2`,
    [reciboId, companyId]
  );
  const rec = r.rows[0];
  if (!rec) throw new NotFoundError('No encontré ese recibo');

  /* El timbrado manda sobre el pre-timbre: es el que tiene el UUID y los sellos.
   * Si no hay timbrado todavía, se imprime el pre-timbre con su sello de agua. */
  const xml: string = rec.xml_timbrado || rec.xml_pretimbre || '';
  const timbrado = !!rec.xml_timbrado && !!rec.uuid;
  if (!xml) throw new NotFoundError('Ese recibo no tiene XML: vuelve a cerrar el periodo.');

  const emp = await query<any>(
    `SELECT business_name, rfc, fiscal_regime, postal_code, registro_patronal,
            street, ext_number, neighborhood, municipality, city, state
       FROM companies WHERE id = $1`,
    [companyId]
  );
  const e = emp.rows[0] || {};

  /* ── Lo que dice el XML ── */
  const emisorRfc   = attr(xml, 'cfdi:Emisor', 'Rfc') || e.rfc;
  const emisorNom   = attr(xml, 'cfdi:Emisor', 'Nombre') || e.business_name;
  const emisorReg   = attr(xml, 'cfdi:Emisor', 'RegimenFiscal') || e.fiscal_regime;
  const receptorRfc = attr(xml, 'cfdi:Receptor', 'Rfc') || rec.rfc;
  const receptorNom = attr(xml, 'cfdi:Receptor', 'Nombre') || rec.nombre;
  const serieFolio  = `${attr(xml, 'cfdi:Comprobante', 'Serie')}${attr(xml, 'cfdi:Comprobante', 'Folio')}`;
  const fechaComp   = attr(xml, 'cfdi:Comprobante', 'Fecha');
  const lugarExp    = attr(xml, 'cfdi:Comprobante', 'LugarExpedicion');
  const metodoPago  = attr(xml, 'cfdi:Comprobante', 'MetodoPago') || 'PUE';
  const subTotal    = n2(attr(xml, 'cfdi:Comprobante', 'SubTotal'));
  const descuento   = n2(attr(xml, 'cfdi:Comprobante', 'Descuento'));
  const total       = n2(attr(xml, 'cfdi:Comprobante', 'Total'));

  const nom  = nodos(xml, 'nomina12:Nomina')[0] || {};
  const recp = nodos(xml, 'nomina12:Receptor')[0] || {};
  const emin = nodos(xml, 'nomina12:Emisor')[0] || {};

  const percepciones = nodos(xml, 'nomina12:Percepcion').map((p) => ({
    clave: p.Clave || p.TipoPercepcion || '',
    concepto: p.Concepto || '',
    gravado: n2(p.ImporteGravado), exento: n2(p.ImporteExento),
    importe: n2(p.ImporteGravado) + n2(p.ImporteExento),
  }));
  const deducciones = nodos(xml, 'nomina12:Deduccion').map((d) => ({
    clave: d.Clave || d.TipoDeduccion || '',
    concepto: d.Concepto || '',
    importe: n2(d.Importe),
  }));
  const otrosPagos = nodos(xml, 'nomina12:OtroPago').map((o) => ({
    clave: o.Clave || o.TipoOtroPago || '',
    concepto: o.Concepto || '',
    gravado: 0, exento: n2(o.Importe),
    importe: n2(o.Importe),
  }));

  /* ── El papel ── */
  const doc = new PDFDocument({ size: 'LETTER', margin: M, bufferPages: true });
  const trozos: Buffer[] = [];
  doc.on('data', (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(trozos))));

  let y = M;

  /* Encabezado: emisor a la izquierda, comprobante a la derecha. */
  doc.rect(M, y, ANCHO, 58).fillOpacity(1).fill('#f9fafb');
  doc.fontSize(10).fillColor('#111827').font('Helvetica-Bold')
     .text(emisorNom || '', M + 6, y + 6, { width: 330, ellipsis: true });
  doc.font('Helvetica').fontSize(7).fillColor('#374151');
  doc.text(`RFC: ${emisorRfc}    ·    Registro patronal: ${emin.RegistroPatronal || e.registro_patronal || '—'}`,
           M + 6, y + 20, { width: 330 });
  const domicilio = [
    [e.street, e.ext_number].filter(Boolean).join(' '),
    e.neighborhood, e.municipality || e.city, e.state,
    e.postal_code ? `C.P. ${e.postal_code}` : '',
  ].filter(Boolean).join(', ');
  doc.fontSize(6.5).fillColor('#6b7280')
     .text(domicilio, M + 6, y + 30, { width: 330, ellipsis: true });
  doc.text(`Régimen fiscal: ${emisorReg}`, M + 6, y + 40, { width: 330 });

  doc.fontSize(11).fillColor('#111827').font('Helvetica-Bold')
     .text('RECIBO DE NÓMINA', M + 350, y + 6, { width: 200, align: 'right' });
  doc.font('Helvetica').fontSize(7.5).fillColor('#374151');
  /* El pre-timbre no lleva folio todavía: se identifica por el periodo, que es
     como lo busca quien lo tiene en la mano. */
  doc.text(
    serieFolio
      ? `Comprobante: ${serieFolio}`
      : `Recibo ${rec.num_empleado} · ${rec.tipo} #${rec.periodo_numero}/${rec.anio}`,
    M + 350, y + 22, { width: 200, align: 'right' }
  );
  doc.text(`Fecha de expedición: ${String(fechaComp).replace('T', ' ')}`, M + 350, y + 32,
           { width: 200, align: 'right' });
  doc.text(`Lugar: ${lugarExp}    Método: ${metodoPago}`, M + 350, y + 42,
           { width: 200, align: 'right' });
  y += 64;

  /* Bloque del trabajador. */
  doc.rect(M, y, ANCHO, 66).lineWidth(0.7).strokeColor('#d1d5db').stroke();
  const c1 = M + 6, c2 = M + 148, c3 = M + 290, c4 = M + 432;
  par(doc, c1, y + 5, 'Trabajador', receptorNom, 140);
  par(doc, c3, y + 5, 'RFC', receptorRfc, 130);
  par(doc, c4, y + 5, 'CURP', recp.Curp || rec.curp, 118);
  par(doc, c1, y + 25, 'Núm. de empleado', recp.NumEmpleado || rec.num_empleado, 140);
  par(doc, c2, y + 25, 'NSS', recp.NumSeguridadSocial || rec.nss, 138);
  par(doc, c3, y + 25, 'Fecha de ingreso', recp.FechaInicioRelLaboral, 130);
  par(doc, c4, y + 25, 'Antigüedad', recp.Antigüedad || recp.Antiguedad || '—', 118);
  par(doc, c1, y + 45, 'Puesto', recp.Puesto || rec.puesto || '—', 140);
  par(doc, c2, y + 45, 'Departamento', recp.Departamento || rec.departamento || '—', 138);
  par(doc, c3, y + 45, 'Salario diario',
      n2(rec.salario_diario) > 0 ? fmtMoney(rec.salario_diario) : '—', 60);
  par(doc, c3 + 70, y + 45, 'SDI', fmtMoney(recp.SalarioDiarioIntegrado || 0), 60);
  par(doc, c4, y + 45, 'Riesgo / jornada',
      `${recp.RiesgoPuesto || '—'} · ${recp.TipoJornada || '—'}`, 118);
  y += 72;

  /* Bloque del periodo. */
  doc.rect(M, y, ANCHO, 24).fill('#eef2ff');
  doc.fontSize(7.5).fillColor('#3730a3').font('Helvetica-Bold')
     .text(
       `PERIODO ${rec.tipo} #${rec.periodo_numero} de ${rec.anio}` +
       (rec.concepto ? ` · ${rec.concepto}` : ''),
       M + 6, y + 5, { width: 340 }
     );
  doc.font('Helvetica').fillColor('#4338ca').fontSize(7)
     .text(
       `Del ${nom.FechaInicialPago || rec.fecha_inicio} al ${nom.FechaFinalPago || rec.fecha_fin}` +
       `    ·    Pago: ${nom.FechaPago || rec.fecha_pago}` +
       `    ·    Días pagados: ${nom.NumDiasPagados || rec.dias}`,
       M + 6, y + 14, { width: 400 }
     );
  doc.fontSize(7).fillColor('#3730a3')
     .text(`Periodicidad ${recp.PeriodicidadPago || ''}`, M + 420, y + 9,
           { width: 130, align: 'right' });
  y += 30;

  y = tabla(doc, y, 'PERCEPCIONES', percepciones);
  if (otrosPagos.length) y = tabla(doc, y, 'OTROS PAGOS', otrosPagos);
  y = tabla(doc, y, 'DEDUCCIONES', deducciones, { conGravado: false, color: '#991b1b' });

  /* Totales. */
  doc.rect(M + 300, y, ANCHO - 300, 46).fill('#f9fafb');
  const filaTot = (etq: string, val: number, i: number, negrita = false) => {
    doc.fontSize(negrita ? 9 : 7.5)
       .font(negrita ? 'Helvetica-Bold' : 'Helvetica')
       .fillColor(negrita ? '#111827' : '#374151');
    doc.text(etq, M + 306, y + 5 + i * 12, { width: 140 });
    doc.text(fmtMoney(val), M + 450, y + 5 + i * 12, { width: 100, align: 'right' });
    doc.font('Helvetica');
  };
  filaTot('Total de percepciones', subTotal, 0);
  filaTot('Total de deducciones', descuento, 1);
  filaTot('NETO A PAGAR', total, 2, true);
  y += 52;

  /* Leyenda de recibí, con el importe en letra. */
  doc.fontSize(7).fillColor('#374151').text(
    `RECIBÍ DE ${String(emisorNom || '').toUpperCase()} LA CANTIDAD DE ${montoEnLetra(total, 'MXN')}, ` +
    'MISMA QUE CUBRE LAS PERCEPCIONES QUE ME CORRESPONDEN EN EL PERIODO INDICADO, NO EXISTIENDO ' +
    'NINGÚN ADEUDO POR PARTE DE LA EMPRESA PARA EL SUSCRITO, PUES ESTOY TOTALMENTE PAGADO DE MIS ' +
    'SALARIOS Y PRESTACIONES DEVENGADAS HASTA LA FECHA.',
    /* Sin justificar a propósito: con el texto todo en mayúsculas, el
       justificado de pdfkit estira las palabras hasta pegarlas y el párrafo se
       vuelve un bloque ilegible. */
    M, y, { width: ANCHO - 170, align: 'left', lineGap: 1 }
  );
  doc.moveTo(M + ANCHO - 150, y + 34).lineTo(M + ANCHO, y + 34)
     .lineWidth(0.7).strokeColor('#9ca3af').stroke();
  doc.fontSize(6.5).fillColor('#6b7280')
     .text('FIRMA DEL TRABAJADOR', M + ANCHO - 150, y + 37, { width: 150, align: 'center' });
  y += 52;

  /* ── El timbre, o el aviso de que no lo hay ── */
  if (timbrado) {
    const tfd = nodos(xml, 'tfd:TimbreFiscalDigital')[0] || {};
    doc.rect(M, y, ANCHO, 12).fill('#f3f4f6');
    doc.fontSize(7).fillColor('#374151').font('Helvetica-Bold')
       .text('TIMBRE FISCAL DIGITAL', M + 4, y + 3);
    doc.font('Helvetica');
    y += 15;
    doc.fontSize(6).fillColor('#374151');
    doc.text(`Folio fiscal (UUID): ${tfd.UUID || rec.uuid}`, M, y, { width: ANCHO });
    y += 8;
    doc.text(`Fecha de timbrado: ${tfd.FechaTimbrado || ''}    ·    ` +
             `Certificado del SAT: ${tfd.NoCertificadoSAT || ''}    ·    ` +
             `RFC del PAC: ${tfd.RfcProvCertif || ''}`, M, y, { width: ANCHO });
    y += 10;
    for (const [etq, val] of [
      ['SELLO DIGITAL DEL CFDI', tfd.SelloCFD || attr(xml, 'cfdi:Comprobante', 'Sello')],
      ['SELLO DEL SAT', tfd.SelloSAT || ''],
      ['CADENA ORIGINAL DEL COMPLEMENTO DE CERTIFICACIÓN', texto(xml, 'cadenaOriginal') || ''],
    ] as Array<[string, string]>) {
      if (!val) continue;
      doc.fontSize(5.5).fillColor('#6b7280').text(etq, M, y);
      y += 7;
      doc.fontSize(5).fillColor('#374151')
         .text(val, M, y, { width: ANCHO, align: 'justify' });
      y = doc.y + 3;
    }
    doc.fontSize(6).fillColor('#6b7280').text(
      'Este documento es una representación impresa de un CFDI versión 4.0 con complemento de nómina 1.2.',
      M, y + 2, { width: ANCHO, align: 'center'
    });
  } else {
    /* Sin timbre, y que se vea. Un recibo sin sello que parezca timbrado es
     * peor que no tener recibo: alguien lo entregaría creyendo que ya está. */
    doc.rect(M, y, ANCHO, 30).fill('#fffbeb');
    doc.fontSize(8).fillColor('#92400e').font('Helvetica-Bold')
       .text('SIN TIMBRAR — VISTA PREVIA', M, y + 6, { width: ANCHO, align: 'center' });
    doc.font('Helvetica').fontSize(6.5).fillColor('#92400e').text(
      'Este recibo todavía no se ha enviado al PAC: no tiene folio fiscal ni sellos, y NO ampara ' +
      'ningún pago ante el SAT. Sirve para revisarlo antes de timbrar.',
      M + 20, y + 18, { width: ANCHO - 40, align: 'center' }
    );

    doc.save();
    doc.rotate(-32, { origin: [300, 420] });
    doc.fontSize(58).fillColor('#f59e0b').fillOpacity(0.07)
       .text('SIN TIMBRAR', 60, 390, { width: 520, align: 'center' });
    doc.restore();
    doc.fillOpacity(1);
  }

  doc.end();
  const buffer = await listo;

  const nombre =
    `recibo-${rec.num_empleado}-${rec.tipo.toLowerCase()}` +
    `${String(rec.periodo_numero).padStart(2, '0')}-${rec.anio}` +
    `${timbrado ? '' : '-sin-timbrar'}.pdf`;

  return { buffer, nombre, timbrado };
}
