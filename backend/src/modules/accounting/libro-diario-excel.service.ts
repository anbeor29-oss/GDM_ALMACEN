/**
 * Export del LIBRO DIARIO a Excel, por rango de fechas (pedido del usuario).
 * Un renglón por MOVIMIENTO (póliza · cuenta · cargo · abono) para filtrar/sumar
 * en Excel, con fila de totales al final.
 */
import ExcelJS from 'exceljs';
import { query } from '../../config/database';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function exportarLibroDiarioExcel(
  companyId: string, desde: string, hasta: string,
): Promise<Buffer> {
  if (!FECHA.test(desde) || !FECHA.test(hasta)) {
    throw new Error('Indica la fecha inicial y final como AAAA-MM-DD.');
  }
  const r = await query<any>(
    `SELECT e.folio, TO_CHAR(e.fecha,'YYYY-MM-DD') AS fecha, e.tipo,
            e.concepto AS poliza_concepto, a.codigo, a.nombre,
            l.concepto AS detalle, l.cargo::float AS cargo, l.abono::float AS abono
       FROM journal_entries e
       JOIN journal_lines l ON l.entry_id = e.id
       JOIN accounting_accounts a ON a.id = l.account_id
      WHERE e.company_id=$1 AND e.fecha BETWEEN $2 AND $3
      ORDER BY e.fecha, e.folio, l.orden`,
    [companyId, desde, hasta]);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Libro diario');
  ws.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Folio', key: 'folio', width: 8 },
    { header: 'Tipo', key: 'tipo', width: 10 },
    { header: 'Concepto', key: 'poliza_concepto', width: 42 },
    { header: 'Cuenta', key: 'codigo', width: 16 },
    { header: 'Nombre de la cuenta', key: 'nombre', width: 32 },
    { header: 'Detalle', key: 'detalle', width: 30 },
    { header: 'Cargo', key: 'cargo', width: 15 },
    { header: 'Abono', key: 'abono', width: 15 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  let totCargo = 0, totAbono = 0;
  for (const row of r.rows) {
    const cargo = Number(row.cargo) || 0, abono = Number(row.abono) || 0;
    totCargo += cargo; totAbono += abono;
    ws.addRow({
      fecha: row.fecha, folio: row.folio, tipo: row.tipo,
      poliza_concepto: row.poliza_concepto, codigo: row.codigo, nombre: row.nombre,
      detalle: row.detalle, cargo: cargo || null, abono: abono || null,
    });
  }
  const tot = ws.addRow({ nombre: 'TOTALES', cargo: Math.round(totCargo * 100) / 100, abono: Math.round(totAbono * 100) / 100 });
  tot.font = { bold: true };
  ws.getColumn('cargo').numFmt = '#,##0.00';
  ws.getColumn('abono').numFmt = '#,##0.00';

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
