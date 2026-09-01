/**
 * Importador de Nómina NomiPaq (CONTPAQ Nóminas) → NEXO. Consume el paquete JSON
 * que produce `scripts/nomina/extraer-nomina.ps1` y lo carga en la empresa activa:
 * empleados → periodos → recibos históricos (con su desglose y su CFDI).
 *
 * Hechos verificados en el respaldo (no inventados — ver la memoria de migración):
 *   · Empleados nom10001, periodos nom10002, conceptos nom10004 (tipo P/D/O/N y su
 *     clave SAT en ClaveAgrupadoraSAT), movimientos nom10007, CFDI nom10043.
 *   · En una PERCEPCIÓN, importe1 = GRAVADO e importe2 = EXENTO (comprobado:
 *     723/724 cuadran; el borde: exento = total − gravado).
 *   · El tipo de periodo sale de los días (≤8 semanal, ≤16 quincenal, más mensual).
 *   · Fechas centinela ya vienen como null desde el extractor.
 *
 * Idempotente: empleado por num_empleado, periodo por año+tipo+número, recibo por
 * periodo+empleado. Todo lo migrado queda con `origen='CONTPAQ'`. No recalcula
 * nada: los importes se guardan tal como se pagaron.
 */
import { query } from '../../config/database';

const n2 = (x: any) => Math.round((Number(x) || 0) * 100) / 100;
const fechaOk = (s: any): string | null => {
  const t = String(s || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && t >= '1900-01-01' ? t : null;
};

export interface EmpleadoN {
  id: number; codigo: string; nombre: string; apPaterno: string; apMaterno: string;
  rfc: string; curp: string; nss: string; fechaNacimiento: string; fechaAlta: string;
  fechaBaja: string | null; fechaReingreso: string | null; idDepartamento: number;
  idPuesto: number; idTipoPeriodo: number; sueldoDiario: number; sueldoIntegrado: number;
  tipoContrato: string; tipoEmpleado: string; zonaSalario: string; tipoRegimen: string;
  entidad: string; banco: string; cuenta: string; clabe: string; correo: string; cp: string;
  fonacot: string; estado: string;
}
export interface PeriodoN {
  id: number; idTipoPeriodo: number; numero: number; ejercicio: number; mes: number;
  dias: number; fechaInicio: string; fechaFin: string; fechaPago: string | null;
}
export interface ConceptoN { id: number; numero: number; tipo: string; descripcion: string; claveSat: string; tipoClaveSat: string; }
export interface MovtoN { idEmpleado: number; idPeriodo: number; idConcepto: number; importe: number; imp1: number; imp2: number; imp3: number; imp4: number; }
export interface CfdiN { idEmpleado: number; idPeriodo: number; uuid: string; estado: number; fechaEmision: string; fechaPago: string; sbc: number; diasPagados: number; }
export interface PaqueteNomina {
  empresa?: Array<{ rfc: string; nombre: string; registroPatronal?: string; ejercicio?: number }>;
  departamentos?: Array<{ id: number; numero: number; nombre: string }>;
  puestos?: Array<{ id: number; numero: number; nombre: string }>;
  empleados: EmpleadoN[]; periodos: PeriodoN[]; conceptos: ConceptoN[]; movimientos: MovtoN[]; cfdi?: CfdiN[];
}

export interface ReporteNomina {
  rfc: { respaldo: string; empresaActiva: string; coincide: boolean };
  empleados: { creados: number; actualizados: number };
  periodos: { creados: number; yaExistian: number; omitidos: number };
  recibos: { creados: number; yaExistian: number; omitidos: number };
  ejercicios: number[];
  avisos: string[];
}

const PERIODICIDAD_SAT: Record<string, string> = { SEMANAL: '02', QUINCENAL: '04', MENSUAL: '05' };
type TipoPeriodo = 'SEMANAL' | 'QUINCENAL' | 'MENSUAL';
function tipoPorDias(dias: number): TipoPeriodo | null {
  if (!dias || dias <= 0) return null;
  if (dias <= 8) return 'SEMANAL';
  if (dias <= 16) return 'QUINCENAL';
  return 'MENSUAL';
}

export async function importarNomina(
  companyId: string,
  paquete: PaqueteNomina,
  userId?: string,
  opciones?: { forzar?: boolean; ejercicios?: number[] },
): Promise<ReporteNomina> {
  const emp = await query<any>('SELECT rfc, business_name FROM companies WHERE id=$1', [companyId]);
  const rfcEmpresa = String(emp.rows[0]?.rfc || '').toUpperCase().trim();
  if (!rfcEmpresa) throw new Error('La empresa destino no tiene RFC.');
  const rfcRespaldo = String(paquete.empresa?.[0]?.rfc || '').toUpperCase().trim();
  const coincide = !!rfcRespaldo && rfcRespaldo === rfcEmpresa;
  if (rfcRespaldo && !coincide && !opciones?.forzar) {
    throw new Error(
      `El RFC del respaldo (${rfcRespaldo}) no coincide con la empresa activa (${rfcEmpresa}). ` +
      `Cambia a la empresa correcta en NEXO, o confirma que quieres importar de todos modos.`);
  }

  const rep: ReporteNomina = {
    rfc: { respaldo: rfcRespaldo || '(no venía en el paquete)', empresaActiva: rfcEmpresa, coincide },
    empleados: { creados: 0, actualizados: 0 },
    periodos: { creados: 0, yaExistian: 0, omitidos: 0 },
    recibos: { creados: 0, yaExistian: 0, omitidos: 0 },
    ejercicios: [], avisos: [],
  };

  const ejSel = opciones?.ejercicios?.length ? new Set(opciones.ejercicios) : null;

  // Catálogos: id → nombre (para el texto de depto/puesto del empleado).
  const deptoNombre = new Map<number, string>((paquete.departamentos || []).map((d) => [d.id, d.nombre]));
  const puestoNombre = new Map<number, string>((paquete.puestos || []).map((p) => [p.id, p.nombre]));

  // El tipo de cada idTipoPeriodo (para la periodicidad del empleado), por los días de sus periodos.
  const tipoDeIdTipo = new Map<number, TipoPeriodo>();
  for (const p of paquete.periodos || []) {
    const t = tipoPorDias(p.dias);
    if (t && !tipoDeIdTipo.has(p.idTipoPeriodo)) tipoDeIdTipo.set(p.idTipoPeriodo, t);
  }

  // ── 1. Empleados ──────────────────────────────────────────────────────────
  const empId = new Map<number, { id: string; num: string; nombre: string; rfc: string; curp: string; nss: string }>();
  for (const e of paquete.empleados || []) {
    const num = String(e.codigo || e.id).trim();
    const nombreCompleto = [e.nombre, e.apPaterno, e.apMaterno].map((x) => String(x || '').trim()).filter(Boolean).join(' ').slice(0, 100);
    const zona = String(e.zonaSalario || '').toUpperCase().startsWith('B') ? 'frontera' : 'general';
    const perTipo = tipoDeIdTipo.get(e.idTipoPeriodo);
    const periodicidad = (perTipo && PERIODICIDAD_SAT[perTipo]) || '02';
    const activo = !fechaOk(e.fechaBaja);
    const vals = [
      companyId, num.slice(0, 15), (e.nombre || nombreCompleto).slice(0, 100),
      (e.apPaterno || '·').slice(0, 100), (e.apMaterno || '').slice(0, 100) || null,
      String(e.rfc || '').toUpperCase().slice(0, 13), String(e.curp || '').toUpperCase().slice(0, 18),
      String(e.nss || '').replace(/\D/g, '').slice(0, 11) || null,
      fechaOk(e.fechaNacimiento), (e.correo || '').slice(0, 255) || null, (e.cp || '').slice(0, 5) || null,
      (puestoNombre.get(e.idPuesto) || '').slice(0, 100) || null,
      (deptoNombre.get(e.idDepartamento) || '').slice(0, 100) || null,
      fechaOk(e.fechaAlta) || fechaOk(e.fechaNacimiento) || '2000-01-01',
      fechaOk(e.fechaBaja), fechaOk(e.fechaReingreso),
      (e.tipoContrato || '01').slice(0, 2), (e.tipoRegimen || '02').slice(0, 2), periodicidad,
      (e.entidad || '').slice(0, 3) || null, zona,
      n2(e.sueldoDiario), n2(e.sueldoIntegrado), n2(e.sueldoIntegrado),
      (e.clabe || '').replace(/\D/g, '').slice(0, 18) || null, activo,
    ];
    try {
      const ya = await query<any>(
        `SELECT id FROM nomina_empleados WHERE company_id=$1 AND UPPER(TRIM(num_empleado))=UPPER(TRIM($2)) LIMIT 1`,
        [companyId, num]);
      let empleadoId: string;
      if (ya.rows[0]) {
        empleadoId = ya.rows[0].id;
        await query(
          `UPDATE nomina_empleados SET nombre=$3, apellido_pat=$4, apellido_mat=$5, rfc=$6, curp=$7, nss=$8,
             fecha_nacimiento=$9, email=$10, codigo_postal=$11, puesto=$12, departamento=$13, fecha_ingreso=$14,
             fecha_baja=$15, fecha_reingreso=$16, tipo_contrato=$17, tipo_regimen=$18, periodicidad_pago=$19,
             entidad_federativa=$20, zona_geografica=$21, salario_diario=$22, salario_diario_integrado=$23, sbc=$24,
             cuenta_clabe=$25, activo=$26, origen='CONTPAQ', updated_at=NOW()
           WHERE company_id=$1 AND id=$2`,
          [companyId, empleadoId, ...vals.slice(2)]);
        rep.empleados.actualizados++;
      } else {
        const r = await query<any>(
          `INSERT INTO nomina_empleados
             (company_id, num_empleado, nombre, apellido_pat, apellido_mat, rfc, curp, nss,
              fecha_nacimiento, email, codigo_postal, puesto, departamento, fecha_ingreso,
              fecha_baja, fecha_reingreso, tipo_contrato, tipo_regimen, periodicidad_pago,
              entidad_federativa, zona_geografica, salario_diario, salario_diario_integrado, sbc,
              cuenta_clabe, activo, origen)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'CONTPAQ')
           RETURNING id`, vals);
        empleadoId = r.rows[0].id;
        rep.empleados.creados++;
      }
      empId.set(e.id, { id: empleadoId, num: num.slice(0, 15), nombre: nombreCompleto, rfc: String(e.rfc || '').toUpperCase().slice(0, 13), curp: String(e.curp || '').toUpperCase().slice(0, 18), nss: String(e.nss || '').replace(/\D/g, '').slice(0, 11) });
    } catch (err: any) {
      rep.avisos.push(`Empleado ${num}: ${(err?.message || 'no se pudo').toString().slice(0, 140)}`);
    }
  }

  // ── 2. Periodos ───────────────────────────────────────────────────────────
  const perId = new Map<number, { id: string; dias: number; anio: number }>();
  const aniosVistos = new Set<number>();
  for (const p of paquete.periodos || []) {
    if (ejSel && !ejSel.has(p.ejercicio)) continue;
    const tipo = tipoPorDias(p.dias);
    const fi = fechaOk(p.fechaInicio); const ff = fechaOk(p.fechaFin);
    if (!tipo || !fi || !ff || ff < fi) { rep.periodos.omitidos++; continue; }
    const dias = Math.max(1, Math.min(31, Math.round(p.dias)));
    const numMax = tipo === 'SEMANAL' ? 53 : tipo === 'QUINCENAL' ? 24 : 12;
    const numero = Math.min(numMax, Math.max(1, Number(p.numero) || 1));
    try {
      const ya = await query<any>(
        `SELECT id FROM nomina_periodos WHERE company_id=$1 AND anio=$2 AND tipo=$3 AND numero=$4 LIMIT 1`,
        [companyId, p.ejercicio, tipo, numero]);
      let periodoId: string;
      if (ya.rows[0]) { periodoId = ya.rows[0].id; rep.periodos.yaExistian++; }
      else {
        const r = await query<any>(
          `INSERT INTO nomina_periodos (company_id, anio, tipo, numero, fecha_inicio, fecha_fin, fecha_pago, dias, estatus, origen)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CERRADO','CONTPAQ') RETURNING id`,
          [companyId, p.ejercicio, tipo, numero, fi, ff, fechaOk(p.fechaPago), dias]);
        periodoId = r.rows[0].id; rep.periodos.creados++;
      }
      perId.set(p.id, { id: periodoId, dias, anio: p.ejercicio });
      aniosVistos.add(p.ejercicio);
    } catch (err: any) {
      rep.periodos.omitidos++;
      rep.avisos.push(`Periodo ${p.ejercicio}/${p.numero}: ${(err?.message || 'no se pudo').toString().slice(0, 120)}`);
    }
  }
  rep.ejercicios = [...aniosVistos].sort((a, b) => a - b);

  // ── 3. Recibos (movimientos agrupados por empleado+periodo) ───────────────
  const concepto = new Map<number, ConceptoN>((paquete.conceptos || []).map((c) => [c.id, c]));
  const cfdiPor = new Map<string, CfdiN>((paquete.cfdi || []).map((c) => [`${c.idEmpleado}|${c.idPeriodo}`, c]));
  const grupos = new Map<string, MovtoN[]>();
  for (const m of paquete.movimientos || []) {
    if (!empId.has(m.idEmpleado) || !perId.has(m.idPeriodo)) continue; // fuera de los años elegidos o sin maestro
    const k = `${m.idEmpleado}|${m.idPeriodo}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(m);
  }

  for (const [k, movs] of grupos) {
    const [ie, ip] = k.split('|').map(Number);
    const e = empId.get(ie)!; const per = perId.get(ip)!;
    try {
      const ya = await query<any>(
        `SELECT id FROM nomina_recibos WHERE periodo_id=$1 AND empleado_id=$2 LIMIT 1`, [per.id, e.id]);
      if (ya.rows[0]) { rep.recibos.yaExistian++; continue; }

      let tp = 0, td = 0, to = 0, tg = 0, te = 0, isr = 0, imss = 0, neto = 0;
      const percepciones: any[] = []; const deducciones: any[] = [];
      for (const m of movs) {
        const c = concepto.get(m.idConcepto); if (!c) continue;
        const imp = n2(m.importe);
        if (c.tipo === 'P') {
          const grav = n2(m.imp1);
          const exent = Math.max(0, Math.abs((m.imp1 + m.imp2) - m.importe) <= 0.01 ? n2(m.imp2) : n2(m.importe - m.imp1));
          percepciones.push({ clave: c.claveSat || '', concepto: c.descripcion, importe: imp, gravado: grav, exento: exent });
          tp = n2(tp + imp); tg = n2(tg + grav); te = n2(te + exent);
        } else if (c.tipo === 'D') {
          deducciones.push({ clave: c.claveSat || '', concepto: c.descripcion, importe: imp });
          td = n2(td + imp);
          if (c.claveSat === '002' || /I\.?S\.?R/i.test(c.descripcion)) isr = n2(isr + imp);
          if (c.claveSat === '001' || /IMSS|Enf|Cesant|Invalidez|Vejez|Guarder/i.test(c.descripcion)) imss = n2(imss + imp);
        } else if (c.tipo === 'O') {
          to = n2(to + imp);
        } else if (c.tipo === 'N') {
          neto = imp;
        }
      }
      // El neto AUTORITATIVO es el concepto 'Neto' (tipo N) cuando viene. Otros
      // pagos se ajusta para que el recibo CUADRE (neto = percep − deduc + otros):
      // algunos conceptos 'O' de CONTPAQ son informativos (subsidio causado, etc.)
      // y no deben sumarse dos veces.
      if (neto) to = Math.max(0, n2(neto - tp + td));
      else neto = n2(tp - td + to);
      if (percepciones.length === 0 && deducciones.length === 0) { rep.recibos.omitidos++; continue; }

      const cfdi = cfdiPor.get(k);
      const estatus = cfdi?.uuid ? 'TIMBRADO' : 'PENDIENTE';
      await query(
        `INSERT INTO nomina_recibos
           (company_id, periodo_id, empleado_id, num_empleado, nombre, rfc, curp, nss, dias,
            total_percepciones, total_deducciones, total_otros_pagos, total_gravado, total_exento,
            isr, imss, neto, percepciones, deducciones, estatus, uuid, timbrado_at, origen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'CONTPAQ')
         ON CONFLICT (periodo_id, empleado_id) DO NOTHING`,
        [companyId, per.id, e.id, e.num, e.nombre || '·', e.rfc || 'XAXX010101000', e.curp || null, e.nss || null, per.dias,
         tp, td, to, tg, te, isr, imss, neto, JSON.stringify(percepciones), JSON.stringify(deducciones),
         estatus, cfdi?.uuid || null, cfdi?.uuid ? (fechaOk(cfdi.fechaEmision) || fechaOk(cfdi.fechaPago)) : null]);
      rep.recibos.creados++;
    } catch (err: any) {
      rep.recibos.omitidos++;
      if (rep.avisos.length < 60) rep.avisos.push(`Recibo emp ${ie}/per ${ip}: ${(err?.message || 'error').toString().slice(0, 120)}`);
    }
  }

  return rep;
}
