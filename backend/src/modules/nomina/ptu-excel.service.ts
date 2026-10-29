/**
 * ptu-excel.service — el reparto de PTU a Excel, con el mismo estilo que la prenómina.
 *
 * Una fila por trabajador con derecho (y los sin derecho al final, en gris lógico):
 * días, salario, lo que le toca por días y por salario, el PTU total, su exención y
 * gravado, el ISR retenido y el neto a cobrar. Una fila de totales al cierre.
 */
import * as XLSX from 'xlsx';
import { query } from '../../config/database';
import { obtener } from './ptu.service';
import { fechaMx, fechaHoraMx } from '../../utils/fecha-mx';

const n2 = (v: any) => Math.round((Number(v) || 0) * 100) / 100;

export async function generarExcel(companyId: string, periodoId: string): Promise<{ buffer: Buffer; nombre: string }> {
  const d = await obtener(companyId, periodoId);
  const p = d.periodo;
  const emp = await query<any>('SELECT business_name, rfc FROM companies WHERE id=$1', [companyId]);
  const empresa = emp.rows[0]?.business_name || '';

  // Con derecho primero, luego los excluidos.
  const filas = [...d.filas].sort((a, b) => Number(b.con_derecho) - Number(a.con_derecho));
  const datos = filas.map((r, i) => ({
    '#': i + 1,
    'Núm.': r.num_empleado,
    'Trabajador': r.nombre,
    'Puesto': r.puesto || '',
    'Con derecho': r.con_derecho ? 'Sí' : (r.menos_60 ? 'No (<60 días)' : 'No'),
    'Días trabajados': n2(r.dias),
    'Salario diario': n2(r.salario_diario),
    'Salario devengado': n2(r.salario_devengado),
    'PTU por días (50%)': n2(r.ptu_dias),
    'PTU por salario (50%)': n2(r.ptu_salario),
    'PTU total': n2(r.ptu),
    'Exento': n2(r.exento),
    'Gravado': n2(r.gravado),
    'ISR retenido': n2(r.isr),
    'Neto a cobrar': n2(r.neto),
  }));
  const t = d.totales;
  datos.push({
    '#': '' as any, 'Núm.': '', 'Trabajador': `TOTAL — ${t.con_derecho} con derecho`, 'Puesto': '',
    'Con derecho': '', 'Días trabajados': n2(t.dias), 'Salario diario': '' as any, 'Salario devengado': n2(t.salario_devengado),
    'PTU por días (50%)': '' as any, 'PTU por salario (50%)': '' as any, 'PTU total': n2(t.ptu),
    'Exento': n2(t.exento), 'Gravado': n2(t.gravado), 'ISR retenido': n2(t.isr), 'Neto a cobrar': n2(t.neto),
  });

  const hoja = XLSX.utils.json_to_sheet(datos);
  hoja['!cols'] = [
    { wch: 4 }, { wch: 8 }, { wch: 34 }, { wch: 18 }, { wch: 13 }, { wch: 14 }, { wch: 13 },
    { wch: 16 }, { wch: 16 }, { wch: 17 }, { wch: 13 }, { wch: 11 }, { wch: 11 }, { wch: 13 }, { wch: 14 },
  ];

  const cabecera: any[][] = [
    ['Reparto de utilidades (PTU)'],
    [empresa],
    [`${p.concepto || ''} · del ${fechaMx(p.fecha_inicio)} al ${fechaMx(p.fecha_fin)}`],
    [`Cantidad a repartir: ${n2(d.cantidadRepartir).toLocaleString('es-MX', { minimumFractionDigits: 2 })}  ·  Exención: 15 × UMA (${n2(d.exencion_tope)})  ·  ISR del ${d.anio_pago}`],
    [`Reparto: 50% por días trabajados + 50% por salarios devengados (Art. 123 LFT)`],
    [`Generado el ${fechaHoraMx()}`],
  ];
  for (const a of d.avisos) cabecera.push([`AVISO: ${a}`]);
  cabecera.push([]);

  XLSX.utils.sheet_add_aoa(hoja, cabecera, { origin: 'A1' });
  XLSX.utils.sheet_add_json(hoja, datos, { origin: `A${cabecera.length + 1}` });

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'PTU');
  const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const nombre = `ptu-${p.anio}-${String(p.numero).padStart(2, '0')}.xlsx`;
  return { buffer, nombre };
}
