/**
 * prenomina-excel.service — la prenómina a Excel.
 *
 * POR QUÉ EXCEL Y NO PDF
 * La prenómina no se archiva, se REVISA: se ordena por departamento, se filtra
 * a quien tiene faltas, se compara contra la semana pasada. Un PDF sirve para
 * lo contrario —congelar algo que ya no se toca— y eso es el recibo, no la
 * prenómina. Así se venía trabajando en el sistema anterior y así se conserva.
 *
 * LAS MISMAS COLUMNAS QUE LA PANTALLA
 * Sale exactamente lo que se ve en la rejilla, en el mismo orden. Si el Excel
 * trajera columnas distintas, cuadrar uno contra otro se volvería un trabajo en
 * sí mismo — y el Excel se usa precisamente para cuadrar.
 *
 * DOS HOJAS
 *   · Prenómina — el renglón por trabajador, con su total.
 *   · Conceptos — cada percepción y deducción por separado, con su gravado y su
 *     exento. Es la hoja que se usa cuando un número no cuadra y hay que ver de
 *     dónde salió; en la primera no cabe sin volverla ilegible.
 */

import * as XLSX from 'xlsx';
import { calcular, CapturaPorTrabajador } from './prenomina.service';

/** Redondeo a dos decimales para que Excel no herede el ruido del binario. */
const n2 = (v: any) => Math.round((Number(v) || 0) * 100) / 100;

export async function generarExcel(
  companyId: string,
  periodoId: string,
  captura: CapturaPorTrabajador[] = []
): Promise<{ buffer: Buffer; nombre: string }> {
  const pre = await calcular(companyId, periodoId, { captura });
  const p = pre.periodo;

  /* ── Hoja 1: la rejilla ── */
  const filas = pre.renglones.map((r, i) => ({
    '#': i + 1,
    'Núm.': r.num_empleado,
    'Trabajador': r.nombre,
    'Puesto': r.puesto || '',
    'Departamento': r.departamento || '',
    'Días': r.dias,
    'Ingresos': n2(r.sueldo),
    'Otros ingresos': n2(r.otrosIngresos),
    'Total percepciones': n2(r.totalPercepciones),
    'Gravado': n2(r.gravado),
    'Exento': n2(r.exento),
    'IMSS': n2(r.imss),
    'ISR': n2(r.isr),
    'Préstamos': n2(r.prestamos),
    'Otras deducciones': n2(r.otrasDeducciones),
    'Total deducciones': n2(r.totalDeducciones),
    'Neto a cobrar': n2(r.neto),
    /* Lo que impide timbrarle va en el Excel también: es donde se reparte el
     * trabajo de completar expedientes antes del cierre. */
    'Falta para timbrar': r.faltantes.join(', '),
  }));

  const t = pre.totales;
  filas.push({
    '#': '' as any,
    'Núm.': '',
    'Trabajador': `TOTAL — ${t.trabajadores} trabajador(es)`,
    'Puesto': '', 'Departamento': '', 'Días': '' as any,
    'Ingresos': n2(t.sueldo),
    'Otros ingresos': n2(t.otrosIngresos),
    'Total percepciones': n2(t.totalPercepciones),
    'Gravado': n2(t.gravado),
    'Exento': n2(t.exento),
    'IMSS': n2(t.imss),
    'ISR': n2(t.isr),
    'Préstamos': n2(t.prestamos),
    'Otras deducciones': n2(t.otrasDeducciones),
    'Total deducciones': n2(t.totalDeducciones),
    'Neto a cobrar': n2(t.neto),
    'Falta para timbrar': t.sinPoderTimbrar ? `${t.sinPoderTimbrar} sin poder timbrar` : '',
  });

  const hoja1 = XLSX.utils.json_to_sheet(filas);
  /* Anchos a mano: por omisión todas las columnas salen igual de angostas y los
   * nombres quedan cortados, que es justo lo que se lee. */
  hoja1['!cols'] = [
    { wch: 4 }, { wch: 8 }, { wch: 34 }, { wch: 18 }, { wch: 16 }, { wch: 6 },
    { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 12 },
    { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 14 },
    { wch: 30 },
  ];

  /* ── Hoja 2: el desglose ── */
  const conceptos: any[] = [];
  for (const r of pre.renglones) {
    for (const c of r.percepciones) {
      conceptos.push({
        'Núm.': r.num_empleado, 'Trabajador': r.nombre,
        'Tipo': 'Percepción', 'Clave': c.clave, 'Concepto': c.concepto,
        'Gravado': n2(c.gravado), 'Exento': n2(c.exento), 'Importe': n2(c.importe),
      });
    }
    for (const d of r.deducciones) {
      conceptos.push({
        'Núm.': r.num_empleado, 'Trabajador': r.nombre,
        'Tipo': 'Deducción', 'Clave': d.clave, 'Concepto': d.concepto,
        'Gravado': '', 'Exento': '', 'Importe': n2(d.importe),
      });
    }
  }
  const hoja2 = XLSX.utils.json_to_sheet(conceptos);
  hoja2['!cols'] = [
    { wch: 8 }, { wch: 34 }, { wch: 12 }, { wch: 8 }, { wch: 38 },
    { wch: 12 }, { wch: 12 }, { wch: 12 },
  ];

  /* ── Encabezado del archivo ── */
  const cabecera = [
    ['Prenómina'],
    [`${p.tipo} #${p.numero}${p.concepto ? ` · ${p.concepto}` : ''}`],
    [`Del ${p.fecha_inicio} al ${p.fecha_fin} · ${p.dias} días`],
    [`Ejercicio ${pre.ejercicio.anio} · UMA ${pre.ejercicio.umaDiaria} · SMG ${pre.ejercicio.smgGeneral}`],
    [`Generado el ${new Date().toLocaleString('es-MX')}`],
  ];
  /* Los avisos van DENTRO del archivo y no sólo en la pantalla: el Excel se
   * manda por correo y se revisa lejos de aquí, y "las tarifas no están
   * confirmadas" tiene que viajar con los números. */
  for (const a of pre.avisos) cabecera.push([`AVISO: ${a}`]);
  cabecera.push([]);

  XLSX.utils.sheet_add_aoa(hoja1, cabecera, { origin: 'A1' });
  /* Se reescriben los datos debajo del encabezado. */
  XLSX.utils.sheet_add_json(hoja1, filas, { origin: `A${cabecera.length + 1}` });

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja1, 'Prenómina');
  XLSX.utils.book_append_sheet(libro, hoja2, 'Conceptos');

  const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const nombre = `prenomina-${p.tipo.toLowerCase()}-${p.anio}-${String(p.numero).padStart(2, '0')}.xlsx`;
  return { buffer, nombre };
}
