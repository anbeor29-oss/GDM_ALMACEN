/**
 * pdf-remesa — la remesa de pago en una hoja, para llevarla al banco.
 *
 * PARA QUÉ SIRVE
 * Quien autoriza firma una hoja, no una pantalla. Y quien captura las
 * transferencias necesita los datos bancarios de cada proveedor juntos, en
 * orden, sin ir abriendo un expediente por renglón.
 *
 * QUÉ LLEVA, Y POR QUÉ ESO
 *   La CLABE junto al importe. Es el par que se teclea en el portal del banco;
 *   separarlos obliga a cruzar la vista entre dos columnas lejanas y ahí es
 *   donde se transfiere el monto de un proveedor a la cuenta de otro.
 *
 *   El total por proveedor Y el total de la remesa. El primero es lo que se
 *   transfiere de una vez cuando son varias facturas del mismo; el segundo es
 *   lo que tiene que salir de la cuenta.
 *
 *   Las vencidas, marcadas. Si la remesa se arma el lunes y se paga el jueves,
 *   saber cuáles ya vencieron cambia el orden en que se ejecutan.
 *
 * QUÉ **NO** LLEVA
 * No es un comprobante fiscal y no lo aparenta: sin folio fiscal, sin sello,
 * sin QR. Es un documento interno de control. Un papel que se parece a un CFDI
 * sin serlo termina archivado como si lo fuera.
 */

import PDFDocument from 'pdfkit';
import { query } from '../../config/database';
import { NotFoundError } from '../../middleware/errorHandler';
import { getCompanyLogo } from '../cfdi/logo-cache';
import * as remesas from './remesas.service';

const PAGE_LEFT = 40;
const PAGE_RIGHT = 555;
const ANCHO = PAGE_RIGHT - PAGE_LEFT;

const money = (n: any) =>
  `$${Number(n || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

/** DD/MM/AAAA — el mismo formato que el resto del sistema. */
function fecha(v: any): string {
  if (!v) return '—';
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/` +
         `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

const ESTADO: Record<string, string> = {
  DRAFT: 'BORRADOR', AUTHORIZED: 'AUTORIZADA', PAID: 'PAGADA', CANCELLED: 'CANCELADA',
};

export async function generarPdfRemesa(companyId: string, runId: string): Promise<Buffer> {
  const { run, renglones, total } = await remesas.detalleRemesa(companyId, runId);
  if (!run) throw new NotFoundError('Remesa no encontrada');

  const emp = await query<any>(
    `SELECT business_name, rfc FROM companies WHERE id = $1`, [companyId]);
  const empresa = emp.rows[0] || {};
  const logo = await getCompanyLogo(companyId).catch(() => null);

  /* Se agrupa por proveedor: es como se ejecuta —una transferencia por
   * proveedor, no una por factura—. */
  const porProveedor = new Map<string, any[]>();
  for (const r of renglones) {
    const l = porProveedor.get(r.supplier_id) || [];
    l.push(r);
    porProveedor.set(r.supplier_id, l);
  }

  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  const trozos: Buffer[] = [];
  doc.on('data', (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(trozos))));

  /* ── Encabezado ── */
  let y = 40;
  if (logo) {
    try { doc.image(logo, PAGE_LEFT, y, { fit: [70, 70] }); } catch { /* sin logo */ }
  }
  doc.fillColor('#0f766e').font('Helvetica-Bold').fontSize(16)
     .text('REMESA DE PAGO', PAGE_LEFT + 85, y);
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11)
     .text(`#${run.folio}`, PAGE_LEFT + 85, y + 20);
  doc.font('Helvetica').fontSize(9).fillColor('#374151')
     .text(empresa.business_name || '', PAGE_LEFT + 85, y + 36)
     .text(`RFC ${empresa.rfc || ''}`, PAGE_LEFT + 85, y + 48);

  doc.font('Helvetica').fontSize(9).fillColor('#374151');
  doc.text(`Se paga el:  ${fecha(run.payment_date)}`, 380, y + 4, { width: 175, align: 'right' });
  doc.text(`Estado:  ${ESTADO[run.status] || run.status}`, 380, y + 18, { width: 175, align: 'right' });
  doc.text(`Impresa:  ${fecha(new Date())}`, 380, y + 32, { width: 175, align: 'right' });
  if (run.autorizada_por) {
    doc.text(`Autorizó:  ${run.autorizada_por}`, 380, y + 46, { width: 175, align: 'right' });
  }

  y += 78;
  if (run.notes) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6b7280')
       .text(String(run.notes), PAGE_LEFT, y, { width: ANCHO });
    y = doc.y + 6;
  }

  doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).lineWidth(1).strokeColor('#0f766e').stroke();
  y += 12;

  /* ── Un bloque por proveedor ── */
  const COL = {
    factura: PAGE_LEFT,
    orden: PAGE_LEFT + 110,
    vence: PAGE_LEFT + 175,
    subtotal: PAGE_LEFT + 250,
    importe: PAGE_LEFT + 380,
  };

  const salto = (alto: number) => {
    if (y + alto > 720) { doc.addPage(); y = 45; }
  };

  for (const [, lista] of porProveedor) {
    const p = lista[0];
    const suma = lista.reduce((a: number, r: any) => a + Number(r.amount), 0);
    salto(70);

    /* Proveedor y sus datos bancarios, juntos. Es lo que se teclea en el
     * portal del banco, y separarlos es donde se transfiere el importe de uno
     * a la cuenta de otro. */
    doc.rect(PAGE_LEFT, y, ANCHO, 30).fillColor('#f0fdfa').fill();
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10)
       .text(p.supplier_name || 'Sin nombre', PAGE_LEFT + 6, y + 5, { width: 300 });
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280')
       .text(`RFC ${p.supplier_rfc || '—'}`, PAGE_LEFT + 6, y + 18, { width: 300 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f766e')
       .text(money(suma), 400, y + 8, { width: 149, align: 'right' });
    y += 32;

    const clabe = p.bank_clabe || p.bank_account;
    doc.font('Helvetica').fontSize(8).fillColor(clabe ? '#374151' : '#b91c1c');
    doc.text(
      clabe
        ? `${p.bank_name || 'Banco'}  ·  CLABE ${clabe}` +
          (p.bank_account_holder ? `  ·  a nombre de ${p.bank_account_holder}` : '')
        : 'SIN DATOS BANCARIOS EN EL EXPEDIENTE — hay que capturarlos antes de transferir',
      PAGE_LEFT + 6, y, { width: ANCHO - 12 }
    );
    y += 14;

    // Encabezado de las facturas del proveedor
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#6b7280');
    doc.text('FACTURA', COL.factura + 6, y);
    doc.text('ORDEN', COL.orden, y);
    doc.text('VENCE', COL.vence, y);
    doc.text('SUBTOTAL + IVA', COL.subtotal, y, { width: 120 });
    doc.text('IMPORTE', COL.importe, y, { width: 169, align: 'right' });
    y += 11;

    for (const r of lista) {
      salto(16);
      doc.font('Helvetica').fontSize(8.5).fillColor('#111827');
      doc.text(r.invoice_number || 'sin folio', COL.factura + 6, y, { width: 100 });
      doc.text(r.orden_folio ? `#${r.orden_folio}` : '—', COL.orden, y, { width: 60 });
      doc.fillColor(r.vencida ? '#b91c1c' : '#111827');
      doc.text(fecha(r.due_date) + (r.vencida ? ' ⚠' : ''), COL.vence, y, { width: 70 });
      doc.fillColor('#6b7280').fontSize(8);
      doc.text(
        r.subtotal != null ? `${money(r.subtotal)} + ${Number(r.tax_rate || 0)}%` : '—',
        COL.subtotal, y, { width: 120 }
      );
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(8.5);
      doc.text(money(r.amount), COL.importe, y, { width: 169, align: 'right' });
      y += 14;
    }
    y += 8;
  }

  /* ── El total ── */
  salto(50);
  doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).lineWidth(1.5).strokeColor('#0f766e').stroke();
  y += 8;
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827')
     .text(`${porProveedor.size} proveedor(es)  ·  ${renglones.length} factura(s)`, PAGE_LEFT, y);
  doc.fontSize(14).fillColor('#0f766e')
     .text(money(total), 380, y - 3, { width: 175, align: 'right' });
  y += 26;

  const vencidas = renglones.filter((r: any) => r.vencida).length;
  if (vencidas > 0) {
    doc.font('Helvetica').fontSize(8.5).fillColor('#b91c1c')
       .text(`${vencidas} factura(s) ya vencida(s), marcadas con ⚠.`, PAGE_LEFT, y);
    y += 13;
  }
  const sinBanco = renglones.filter((r: any) => !r.bank_clabe && !r.bank_account).length;
  if (sinBanco > 0) {
    doc.font('Helvetica').fontSize(8.5).fillColor('#b91c1c')
       .text(
         `${sinBanco} factura(s) de proveedores SIN datos bancarios: esas no se ` +
         'pueden transferir hasta capturarlos.', PAGE_LEFT, y, { width: ANCHO });
    y = doc.y + 4;
  }

  /* ── Firmas ── */
  salto(70);
  y += 18;
  const anchoFirma = (ANCHO - 40) / 3;
  ['Elaboró', 'Autorizó', 'Pagó'].forEach((rot, i) => {
    const x = PAGE_LEFT + i * (anchoFirma + 20);
    doc.moveTo(x, y + 28).lineTo(x + anchoFirma, y + 28)
       .lineWidth(0.7).strokeColor('#9ca3af').stroke();
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280')
       .text(rot, x, y + 32, { width: anchoFirma, align: 'center' });
  });
  y += 52;

  /* No es un comprobante fiscal y se dice: un papel que se parece a un CFDI
   * sin serlo termina archivado como si lo fuera. */
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#9ca3af')
     .text(
       'Documento interno de control de pagos. NO es un comprobante fiscal: no ' +
       'ampara deducción ni acreditamiento.',
       PAGE_LEFT, y, { width: ANCHO, align: 'center' });

  doc.end();
  return listo;
}
