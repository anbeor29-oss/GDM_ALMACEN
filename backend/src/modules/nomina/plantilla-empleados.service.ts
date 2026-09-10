/**
 * Alta de trabajadores por Excel.
 *
 * Un solo lugar define las COLUMNAS (clave técnica + etiqueta + ejemplo + cómo se
 * parsea), y de ahí salen las DOS cosas: la plantilla que se descarga y el lector
 * que la vuelve a subir. Así el archivo que baja el usuario es exactamente el que
 * el importador entiende, y agregar un campo es una sola línea.
 *
 * Cubre el EXPEDIENTE del trabajador y sus descuentos recurrentes de expediente
 * (INFONAVIT y pensión alimenticia). Los créditos FONACOT y préstamos de la
 * empresa NO van aquí: son créditos con saldo y amortización, y se cargan en la
 * pantalla de Créditos.
 */
import { ExcelJS, C, titulo, dato, encabezado, celda, anchos, aBuffer } from './estilo-excel';
import { crear, TIPOS_CONTRATO, TIPOS_REGIMEN, TIPOS_JORNADA, PERIODICIDADES } from './empleados.service';
import * as creditos from './creditos.service';

type Tipo = 'texto' | 'fecha' | 'numero' | 'bool' | 'codigo';
interface Col { key: string; label: string; ejemplo: string; tipo: Tipo; req?: boolean; nota?: string; }

/* El orden en que salen las columnas (y en que se leen). */
const COLUMNAS: Col[] = [
  { key: 'num_empleado', label: 'No. empleado', ejemplo: '', tipo: 'texto', nota: 'Opcional: si va vacío se numera solo.' },
  { key: 'nombre',       label: 'Nombre(s)',        ejemplo: 'JUAN', tipo: 'texto', req: true },
  { key: 'apellido_pat', label: 'Apellido paterno', ejemplo: 'PEREZ', tipo: 'texto', req: true },
  { key: 'apellido_mat', label: 'Apellido materno', ejemplo: 'LOPEZ', tipo: 'texto' },
  { key: 'rfc',  label: 'RFC',  ejemplo: 'PELJ900101AAA', tipo: 'texto', req: true },
  { key: 'curp', label: 'CURP', ejemplo: 'PELJ900101HDFRPN01', tipo: 'texto', req: true },
  { key: 'nss',  label: 'NSS',  ejemplo: '12345678901', tipo: 'texto' },
  { key: 'fecha_nacimiento', label: 'Fecha de nacimiento', ejemplo: '01/01/1990', tipo: 'fecha' },
  { key: 'email',    label: 'Correo',   ejemplo: 'juan@correo.com', tipo: 'texto' },
  { key: 'telefono', label: 'Teléfono', ejemplo: '4491234567', tipo: 'texto' },
  { key: 'codigo_postal', label: 'Código postal', ejemplo: '20000', tipo: 'texto' },
  { key: 'calle',        label: 'Calle',        ejemplo: 'AV. HIDALGO', tipo: 'texto' },
  { key: 'num_exterior', label: 'No. exterior', ejemplo: '123', tipo: 'texto' },
  { key: 'num_interior', label: 'No. interior', ejemplo: '', tipo: 'texto' },
  { key: 'colonia',      label: 'Colonia',      ejemplo: 'CENTRO', tipo: 'texto' },
  { key: 'municipio',    label: 'Municipio',    ejemplo: 'AGUASCALIENTES', tipo: 'texto' },
  { key: 'estado',       label: 'Estado',       ejemplo: 'AGUASCALIENTES', tipo: 'texto' },
  { key: 'regimen_fiscal', label: 'Régimen fiscal', ejemplo: '605', tipo: 'texto', nota: '605 = Sueldos y salarios.' },
  { key: 'uso_cfdi',       label: 'Uso CFDI',       ejemplo: 'CN01', tipo: 'texto', nota: 'CN01 = Nómina.' },
  { key: 'puesto',       label: 'Puesto',      ejemplo: 'AUXILIAR', tipo: 'texto' },
  { key: 'departamento', label: 'Departamento', ejemplo: 'ADMINISTRACION', tipo: 'texto' },
  { key: 'fecha_ingreso', label: 'Fecha de ingreso', ejemplo: '01/01/2024', tipo: 'fecha', req: true },
  { key: 'tipo_contrato', label: 'Tipo de contrato', ejemplo: '01', tipo: 'codigo', nota: 'Ver hoja «Catálogos».' },
  { key: 'tipo_regimen',  label: 'Tipo de régimen',  ejemplo: '02', tipo: 'codigo', nota: 'Ver hoja «Catálogos».' },
  { key: 'tipo_jornada',  label: 'Tipo de jornada',  ejemplo: '01', tipo: 'codigo', nota: 'Ver hoja «Catálogos».' },
  { key: 'periodicidad_pago', label: 'Periodicidad de pago', ejemplo: '04', tipo: 'codigo', nota: '04 = Quincenal. Ver «Catálogos».' },
  { key: 'tipo_nomina',   label: 'Tipo de nómina',   ejemplo: 'O', tipo: 'texto', nota: 'O = Ordinaria, E = Extraordinaria.' },
  { key: 'zona_geografica', label: 'Zona geográfica', ejemplo: 'general', tipo: 'texto', nota: 'general o frontera_norte.' },
  { key: 'salario_diario', label: 'Salario diario', ejemplo: '350.00', tipo: 'numero', req: true },
  { key: 'salario_diario_integrado', label: 'Salario diario integrado (SDI)', ejemplo: '360.50', tipo: 'numero', nota: 'Si va vacío se calcula.' },
  { key: 'sbc', label: 'Salario base de cotización (SBC)', ejemplo: '', tipo: 'numero', nota: 'Si va vacío se toma el SDI.' },
  { key: 'banco_clave',  label: 'Clave del banco', ejemplo: '072', tipo: 'texto', nota: '3 dígitos (SPEI).' },
  { key: 'cuenta_clabe', label: 'CLABE',           ejemplo: '', tipo: 'texto', nota: '18 dígitos.' },
  // ── Descuentos: INFONAVIT ──
  { key: 'tiene_infonavit', label: '¿Tiene INFONAVIT? (SI/NO)', ejemplo: 'NO', tipo: 'bool' },
  { key: 'infonavit_num_credito', label: 'INFONAVIT · No. de crédito', ejemplo: '', tipo: 'texto' },
  { key: 'infonavit_tipo_descuento', label: 'INFONAVIT · Forma', ejemplo: '', tipo: 'texto', nota: 'porcentaje, cuota_fija o vsm.' },
  { key: 'infonavit_descuento', label: 'INFONAVIT · Valor', ejemplo: '', tipo: 'numero', nota: 'El % (0.20 = 20%), la cuota fija o los VSM.' },
  { key: 'infonavit_seguro_danos', label: 'INFONAVIT · Seguro daños', ejemplo: '', tipo: 'numero' },
  // ── Descuentos: pensión alimenticia ──
  { key: 'tiene_pension_alimenticia', label: '¿Tiene pensión alimenticia? (SI/NO)', ejemplo: 'NO', tipo: 'bool' },
  { key: 'pension_tipo',   label: 'Pensión · Forma',  ejemplo: '', tipo: 'texto', nota: 'porcentaje o cuota_fija.' },
  { key: 'pension_monto',  label: 'Pensión · Valor',  ejemplo: '', tipo: 'numero', nota: 'El % (0.15 = 15%) o la cuota fija.' },
  { key: 'pension_beneficiario', label: 'Pensión · Beneficiario', ejemplo: '', tipo: 'texto' },
  { key: 'pension_num_oficio',   label: 'Pensión · No. de oficio', ejemplo: '', tipo: 'texto' },
];

/* Créditos con saldo y descuento por periodo. NO son campos del expediente: se
 * dan de alta aparte, en `nomina_creditos`, después de crear al trabajador.
 * Se llenan sólo si el trabajador trae ese crédito. */
const COLUMNAS_CREDITO: Col[] = [
  { key: 'fonacot_numero', label: 'FONACOT · No. de crédito', ejemplo: '', tipo: 'texto', nota: 'Si trae FONACOT: su número (obligatorio).' },
  { key: 'fonacot_monto',  label: 'FONACOT · Monto total',    ejemplo: '', tipo: 'numero' },
  { key: 'fonacot_cuota',  label: 'FONACOT · Descuento por periodo', ejemplo: '', tipo: 'numero' },
  { key: 'fonacot_inicio', label: 'FONACOT · Fecha de inicio', ejemplo: '', tipo: 'fecha', nota: 'DD/MM/AAAA.' },
  { key: 'prestamo_concepto', label: 'Préstamo · Concepto',   ejemplo: '', tipo: 'texto', nota: 'Préstamo de la empresa (opcional).' },
  { key: 'prestamo_monto',  label: 'Préstamo · Monto total',  ejemplo: '', tipo: 'numero' },
  { key: 'prestamo_cuota',  label: 'Préstamo · Descuento por periodo', ejemplo: '', tipo: 'numero' },
  { key: 'prestamo_inicio', label: 'Préstamo · Fecha de inicio', ejemplo: '', tipo: 'fecha', nota: 'DD/MM/AAAA.' },
];

/* Todas las columnas de la plantilla, en orden (expediente + créditos). */
const TODAS: Col[] = [...COLUMNAS, ...COLUMNAS_CREDITO];

const norm = (s: any) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/* Fecha DD/MM/AAAA (o lo que Excel entregue como Date) → ISO AAAA-MM-DD. */
function aFechaIso(v: any): string | undefined {
  if (v == null || v === '') return undefined;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (m) { const a = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return undefined;
}
const aBool = (v: any) => /^(si|sí|s|true|1|x)$/i.test(String(v ?? '').trim());
const aNum = (v: any) => { const n = Number(String(v ?? '').replace(/[,$\s]/g, '')); return Number.isFinite(n) ? n : undefined; };

/* ── PLANTILLA ─────────────────────────────────────────────────────────────── */
export async function plantillaEmpleadosExcel(): Promise<{ buffer: Buffer; nombre: string }> {
  const wb = new ExcelJS.Workbook(); wb.creator = 'GDM NEXO';
  const ws = wb.addWorksheet('Trabajadores', { views: [{ state: 'frozen', ySplit: 6, xSplit: 3 }] });
  titulo(ws, 'Alta de trabajadores', TODAS.length);
  dato(ws, 3, 1, 'Llena UNA FILA por trabajador. Las columnas marcadas con * son obligatorias. Fechas en DD/MM/AAAA.', true);
  dato(ws, 4, 1, 'Los campos con código (contrato, régimen, jornada, periodicidad) vienen en la hoja «Catálogos». FONACOT y préstamos: sólo si el trabajador los trae.');
  encabezado(ws, 6, TODAS.map((c) => ({ texto: c.req ? `${c.label} *` : c.label, color: C.identidad })));
  // Fila 7: ejemplo. Fila 8: notas breves por columna (en gris) para que no estorben.
  TODAS.forEach((c, i) => celda(ws, 7, i + 1, c.ejemplo));
  TODAS.forEach((c, i) => { if (c.nota) celda(ws, 8, i + 1, c.nota, { tinta: 'gris' }); });
  anchos(ws, TODAS.map((c) => Math.min(34, Math.max(12, c.label.length + 2))));

  // Hoja de catálogos de los campos con código.
  const cat = wb.addWorksheet('Catálogos');
  titulo(cat, 'Catálogos (copia el CÓDIGO en la columna correspondiente)', 4);
  let fila = 3;
  const bloque = (nombre: string, mapa: Record<string, string>) => {
    celda(cat, fila, 1, nombre, { negrita: true }); fila++;
    encabezado(cat, fila, [{ texto: 'Código', color: C.identidad }, { texto: 'Descripción', color: C.identidad }]); fila++;
    for (const [k, v] of Object.entries(mapa)) { celda(cat, fila, 1, k); celda(cat, fila, 2, v); fila++; }
    fila++;
  };
  bloque('Tipo de contrato', TIPOS_CONTRATO);
  bloque('Tipo de régimen', TIPOS_REGIMEN);
  bloque('Tipo de jornada', TIPOS_JORNADA);
  bloque('Periodicidad de pago', PERIODICIDADES);
  anchos(cat, [12, 60]);

  return { buffer: await aBuffer(wb), nombre: 'Plantilla_alta_trabajadores.xlsx' };
}

/* ── IMPORTADOR ────────────────────────────────────────────────────────────── */
export async function importarEmpleadosExcel(
  companyId: string, buffer: Buffer,
): Promise<{ total: number; creados: number; creditos: number; errores: Array<{ fila: number; trabajador: string; motivo: string }> }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.getWorksheet('Trabajadores') || wb.worksheets[0];
  if (!ws) throw new Error('El archivo no tiene la hoja «Trabajadores».');

  // Localizar la fila de encabezados (la que trae «Nombre(s)») y mapear label→columna.
  const sinStar = (s: any) => norm(s).replace(/\s*\*$/, '');   // «Nombre(s) *» → «nombre(s)»
  let filaEnc = 0;
  for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
    const vals = (ws.getRow(r).values as any[]).map(sinStar);
    if (vals.some((v) => v === norm('Nombre(s)'))) { filaEnc = r; break; }
  }
  if (!filaEnc) throw new Error('No se encontró el renglón de encabezados (con «Nombre(s)»). ¿Es la plantilla de alta de trabajadores?');

  const encRow = ws.getRow(filaEnc).values as any[];
  const colDe = new Map<string, number>();
  for (const c of TODAS) {
    const objetivo = norm(c.label);
    for (let i = 1; i < encRow.length; i++) {
      const h = norm(encRow[i]).replace(/\s*\*$/, '');
      if (h === objetivo) { colDe.set(c.key, i); break; }
    }
  }

  const errores: Array<{ fila: number; trabajador: string; motivo: string }> = [];
  let creados = 0, total = 0, creditosCreados = 0;

  for (let r = filaEnc + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r).values as any[];
    const raw = (key: string) => { const ci = colDe.get(key); return ci ? row[ci] : undefined; };
    // ¿Fila con datos? (algo en nombre o RFC). Se saltan la de ejemplo y las notas.
    const nombre = String(raw('nombre') ?? '').trim();
    const rfc = String(raw('rfc') ?? '').trim().toUpperCase();
    if (!nombre && !rfc) continue;
    if (/^JUAN$/i.test(nombre) && /^PELJ900101AAA$/i.test(rfc)) continue; // fila de ejemplo
    total++;

    const etq = `${nombre} ${String(raw('apellido_pat') ?? '')}`.trim() || rfc || `fila ${r}`;
    try {
      const d: any = {};
      for (const c of COLUMNAS) {
        const v = raw(c.key);
        if (v == null || v === '') continue;
        if (c.tipo === 'fecha') d[c.key] = aFechaIso(v);
        else if (c.tipo === 'numero') d[c.key] = aNum(v);
        else if (c.tipo === 'bool') d[c.key] = aBool(v);
        else d[c.key] = String(v).trim();
      }
      if (!d.nombre || !d.apellido_pat || !d.rfc || !d.curp) { errores.push({ fila: r, trabajador: etq, motivo: 'faltan datos obligatorios (nombre, apellido paterno, RFC, CURP)' }); continue; }
      if (!d.fecha_ingreso) { errores.push({ fila: r, trabajador: etq, motivo: 'falta la fecha de ingreso (DD/MM/AAAA)' }); continue; }
      if (!(Number(d.salario_diario) > 0)) { errores.push({ fila: r, trabajador: etq, motivo: 'el salario diario debe ser mayor a 0' }); continue; }
      const emp: any = await crear(companyId, d);
      creados++;

      /* Créditos (FONACOT / préstamo): el trabajador ya quedó creado; si el crédito
       * falla, se avisa pero NO se deshace el alta. */
      const crearCredito = async (origen: 'FONACOT' | 'PRESTAMO', numero: any, concepto: any, monto: any, cuota: any, inicio: any) => {
        const m = aNum(monto), q = aNum(cuota), fi = aFechaIso(inicio);
        const algo = (numero && String(numero).trim()) || m || q || fi;
        if (!algo) return;   // no trae ese crédito
        try {
          await creditos.crear(companyId, {
            empleado_id: emp.id, origen, numero: numero ? String(numero).trim() : undefined,
            concepto: concepto ? String(concepto).trim() : undefined,
            monto_original: m, descuento_por_periodo: q, fecha_inicio: fi,
          } as any);
          creditosCreados++;
        } catch (e: any) {
          errores.push({ fila: r, trabajador: etq, motivo: `${origen}: ${(e?.message || 'no se pudo dar de alta el crédito').toString().slice(0, 120)}` });
        }
      };
      await crearCredito('FONACOT', raw('fonacot_numero'), null, raw('fonacot_monto'), raw('fonacot_cuota'), raw('fonacot_inicio'));
      await crearCredito('PRESTAMO', null, raw('prestamo_concepto'), raw('prestamo_monto'), raw('prestamo_cuota'), raw('prestamo_inicio'));
    } catch (e: any) {
      errores.push({ fila: r, trabajador: etq, motivo: (e?.message || 'no se pudo crear').toString().slice(0, 160) });
    }
  }
  return { total, creados, creditos: creditosCreados, errores };
}
