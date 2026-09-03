/**
 * Activos fijos y su depreciación en automático (LISR 33-35 · NIF C-6/C-8).
 *
 * De dónde salen: cada partida de una compra que cae en una cuenta de activo
 * fijo (15x) o diferido/intangible (17x) ES un activo. Su MOI es el cargo neto
 * (sin IVA) y la fecha es la del CFDI. `detectarDesdeCompras` los propone; el
 * usuario los registra (confirma tasa y cuentas). Nada se asienta sin su clic.
 *
 * Cómo se deprecia: línea recta. Mensual = MOI × tasaAnual / 12, tope MOI −
 * residual. `generarDepreciacionDelMes` arma UNA póliza del mes (cargo al gasto
 * 701/702, abono a la acumulada complementaria 171/183) y deja constancia por
 * activo en `activo_fijo_depreciacion`. Idempotente por mes (origen_uuid).
 */
import { query, transaction } from '../../config/database';
import { conceptosDeXml } from './ventas-cuentas.service';
import { mapaProductoCuentaCompra } from './compras-cuentas.service';
import { reglaDeCuentaActivo, agrupadorDeCodigo, ReglaDepreciacion } from './depreciacion.data';

const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const finDeMes = (anio: number, mes: number) => new Date(anio, mes, 0).toISOString().slice(0, 10);
const iniDeMes = (anio: number, mes: number) => `${anio}-${String(mes).padStart(2, '0')}-01`;
const primerDiaDelMesDe = (isoFecha: string) => `${String(isoFecha).slice(0, 7)}-01`;
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** (año, mes) del primer parámetro ≤ (anio, mes) del período objetivo. */
function mesInicioAlcanzado(mesInicioIso: string, anio: number, mes: number): boolean {
  const y = Number(String(mesInicioIso).slice(0, 4));
  const m = Number(String(mesInicioIso).slice(5, 7));
  return y < anio || (y === anio && m <= mes);
}

// ── Cuentas: cache por código y creación al vuelo de la acumulada ────────────

type Cta = { id: string; codigo: string; nombre: string; permite_movimientos: boolean };

async function cuentaMovPorCodigo(companyId: string, codigo: string): Promise<Cta | null> {
  const r = await query<any>(
    `SELECT id, codigo, nombre, permite_movimientos FROM accounting_accounts
      WHERE company_id=$1 AND codigo=$2 AND activa=true LIMIT 1`, [companyId, codigo]);
  return r.rows[0] || null;
}

/**
 * La subcuenta de depreciación/amortización acumulada por rubro (171.0x / 183.0x).
 * El Anexo 24 sólo trae el mayor (171/183); su desglose por rubro es catálogo
 * propio que mapea al mismo agrupador. Se crea bajo su mayor si aún no existe;
 * el trigger de la base deja al mayor sin movimientos al colgarle la primera hija.
 */
async function resolverOCrearAcumulada(
  companyId: string, codigo: string, nombre: string
): Promise<Cta | { error: string }> {
  const ya = await cuentaMovPorCodigo(companyId, codigo);
  if (ya) return ya;

  const mayorCodigo = agrupadorDeCodigo(codigo); // '171.03' → '171'
  const m = await query<any>(
    `SELECT id, codigo, nombre, tipo, naturaleza, codigo_agrupador, nif_norma, nivel
       FROM accounting_accounts WHERE company_id=$1 AND codigo=$2 LIMIT 1`, [companyId, mayorCodigo]);
  const mayor = m.rows[0];
  if (!mayor) return { error: `falta la cuenta mayor ${mayorCodigo} (depreciación acumulada) en el catálogo` };

  const ins = await query<any>(
    `INSERT INTO accounting_accounts
       (company_id, parent_id, codigo, nombre, codigo_agrupador, tipo, naturaleza,
        es_complementaria, nif_norma, nivel, permite_movimientos, requiere_tercero)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,true,false)
     ON CONFLICT (company_id, codigo) DO UPDATE SET updated_at=NOW()
     RETURNING id, codigo, nombre, permite_movimientos`,
    [companyId, mayor.id, codigo, (nombre || 'Depreciación acumulada').slice(0, 250),
     mayor.codigo_agrupador || mayorCodigo, mayor.tipo, mayor.naturaleza, mayor.nif_norma,
     (mayor.nivel || 1) + 1]);
  return ins.rows[0];
}

// ── Cálculo de la depreciación de un activo ──────────────────────────────────

export interface CalculoDepreciacion {
  base: number;            // MOI − residual
  depMensual: number;      // MOI × tasa / 12
  depAnual: number;        // MOI × tasa
  mesesVida: number;       // base / depMensual (redondeado hacia arriba)
}

export function calcularDepreciacion(moi: number, residual: number, tasaAnual: number): CalculoDepreciacion {
  const base = round2(Math.max(0, (Number(moi) || 0) - (Number(residual) || 0)));
  const depAnual = round2((Number(moi) || 0) * (Number(tasaAnual) || 0));
  const depMensual = round2(depAnual / 12);
  const mesesVida = depMensual > 0 ? Math.ceil(base / depMensual) : 0;
  return { base, depMensual, depAnual, mesesVida };
}

// ── Detección desde las compras (los recibidos con XML) ──────────────────────

export interface ActivoDetectado {
  descripcion: string;
  categoria: string;
  etiqueta: string;
  cuenta_activo: string;
  cuenta_gasto: string;
  cuenta_dep_acum: string;
  moi: number;
  tasa_anual: number;
  depreciable: boolean;
  intangible: boolean;
  fecha_adquisicion: string;
  origen_uuid: string;
  origen_folio: string;
  clave_prod_serv: string;
  proveedor_rfc: string;
  proveedor_nombre: string;
  fundamento: string;
}

/**
 * Propone activos fijos a partir de los recibidos CON XML del rango: parte cada
 * factura por producto (como la póliza de compra), y por cada producto cuya
 * cuenta asignada sea de activo fijo, arma un candidato. Excluye los ya
 * registrados (mismo CFDI + cuenta). No asienta nada: sólo propone.
 */
export async function detectarDesdeCompras(
  companyId: string, anio: number, mes: number, opts: { desde?: string; hasta?: string } = {}
): Promise<ActivoDetectado[]> {
  const desde = opts.desde || iniDeMes(anio, mes);
  const hasta = opts.hasta || finDeMes(anio, mes);
  const mapaProd = await mapaProductoCuentaCompra(companyId);
  const r = await query<any>(
    `SELECT c.uuid, c.serie, c.folio, TO_CHAR(c.fecha_emision,'YYYY-MM-DD') AS fecha,
            c.nombre_emisor, c.rfc_emisor, c.xml
       FROM cfdi_recibidos c
      WHERE c.company_id=$1 AND c.direccion='recibidos'
        AND (c.tipo_comprobante='I' OR c.tipo_comprobante IS NULL)
        AND (c.estado_sat IS NULL OR c.estado_sat <> 'Cancelado')
        AND c.xml IS NOT NULL
        AND c.fecha_emision::date BETWEEN $2 AND $3
      ORDER BY c.fecha_emision`,
    [companyId, desde, hasta]);

  // Los ya registrados (CFDI + cuenta) para no proponerlos de nuevo.
  const yaReg = await query<any>(
    `SELECT origen_uuid, cuenta_activo FROM activos_fijos WHERE company_id=$1 AND origen_uuid IS NOT NULL`,
    [companyId]);
  const registrado = new Set<string>(yaReg.rows.map((x: any) => `${x.origen_uuid}|${x.cuenta_activo}`));

  const out: ActivoDetectado[] = [];
  for (const c of r.rows) {
    // Un activo por (CFDI, cuenta de activo): se suman los conceptos que caen en la misma cuenta.
    const porCuenta = new Map<string, { monto: number; desc: string; clave: string }>();
    for (const cn of conceptosDeXml(String(c.xml))) {
      const cod = mapaProd.get(cn.clave);
      if (!cod || !reglaDeCuentaActivo(cod)) continue;
      const e = porCuenta.get(cod) || { monto: 0, desc: cn.descripcion || '', clave: cn.clave };
      e.monto = round2(e.monto + cn.importe - cn.descuento);
      if (!e.desc) e.desc = cn.descripcion || '';
      porCuenta.set(cod, e);
    }
    for (const [cod, e] of porCuenta) {
      if (registrado.has(`${c.uuid}|${cod}`)) continue;
      const regla = reglaDeCuentaActivo(cod) as ReglaDepreciacion;
      out.push({
        descripcion: (e.desc || regla.etiqueta).slice(0, 250),
        categoria: regla.categoria, etiqueta: regla.etiqueta,
        cuenta_activo: cod, cuenta_gasto: regla.gasto, cuenta_dep_acum: regla.depAcum,
        moi: e.monto, tasa_anual: regla.tasaAnual, depreciable: regla.depreciable, intangible: regla.intangible,
        fecha_adquisicion: String(c.fecha).slice(0, 10),
        origen_uuid: c.uuid, origen_folio: [c.serie, c.folio].filter(Boolean).join('-') || '',
        clave_prod_serv: e.clave, proveedor_rfc: c.rfc_emisor || '', proveedor_nombre: c.nombre_emisor || '',
        fundamento: regla.fundamento,
      });
    }
  }
  return out;
}

// ── Alta / edición / baja ────────────────────────────────────────────────────

export interface DatosActivo {
  descripcion: string;
  categoria?: string;
  cuenta_activo: string;
  cuenta_gasto?: string | null;
  cuenta_dep_acum?: string | null;
  moi: number;
  valor_residual?: number;
  fecha_adquisicion: string;
  mes_inicio?: string | null;
  tasa_anual: number;
  origen_uuid?: string | null;
  origen_folio?: string | null;
  clave_prod_serv?: string | null;
  proveedor_rfc?: string | null;
  proveedor_nombre?: string | null;
  notas?: string | null;
}

/** Registra un activo. Si no se dan cuenta_gasto/dep_acum, se toman de la regla. */
export async function registrarActivo(companyId: string, d: DatosActivo, userId?: string) {
  const regla = reglaDeCuentaActivo(d.cuenta_activo);
  const gasto = d.cuenta_gasto ?? regla?.gasto ?? null;
  const depAcum = d.cuenta_dep_acum ?? regla?.depAcum ?? null;
  const mesInicio = d.mes_inicio ? primerDiaDelMesDe(d.mes_inicio) : primerDiaDelMesDe(d.fecha_adquisicion);
  const vals = [
    companyId, (d.descripcion || '').slice(0, 500), d.categoria || regla?.categoria || 'otros',
    d.cuenta_activo, gasto, depAcum, round2(d.moi), round2(d.valor_residual || 0),
    String(d.fecha_adquisicion).slice(0, 10), mesInicio, Number(d.tasa_anual) || 0,
    d.origen_uuid || null, d.origen_folio || null, d.clave_prod_serv || null,
    d.proveedor_rfc || null, (d.proveedor_nombre || '').slice(0, 250) || null, d.notas || null, userId || null,
  ];
  const cols = `company_id, descripcion, categoria, cuenta_activo, cuenta_gasto, cuenta_dep_acum,
        moi, valor_residual, fecha_adquisicion, mes_inicio, tasa_anual,
        origen_uuid, origen_folio, clave_prod_serv, proveedor_rfc, proveedor_nombre, notas, created_by`;
  // Con CFDI: no registrar dos veces el mismo renglón (CFDI + cuenta). Alta manual: inserta sin más.
  const r = await query<any>(
    `INSERT INTO activos_fijos (${cols}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ${d.origen_uuid ? 'ON CONFLICT (company_id, origen_uuid, cuenta_activo) WHERE origen_uuid IS NOT NULL DO UPDATE SET updated_at=NOW()' : ''}
     RETURNING id`, vals);
  return { id: r.rows[0]?.id };
}

/** Registra en bloque una lista de candidatos de `detectarDesdeCompras`. */
export async function registrarDetectados(
  companyId: string, activos: DatosActivo[], userId?: string
): Promise<{ registrados: number }> {
  let n = 0;
  for (const a of activos) { await registrarActivo(companyId, a, userId); n++; }
  return { registrados: n };
}

const CAMPOS_EDITABLES = [
  'descripcion', 'categoria', 'cuenta_activo', 'cuenta_gasto', 'cuenta_dep_acum',
  'moi', 'valor_residual', 'fecha_adquisicion', 'mes_inicio', 'tasa_anual', 'estado', 'fecha_baja', 'notas',
] as const;

export async function actualizarActivo(companyId: string, id: string, d: Record<string, any>) {
  const sets: string[] = []; const vals: any[] = [companyId, id]; let i = 3;
  for (const k of CAMPOS_EDITABLES) {
    if (d[k] === undefined) continue;
    let v = d[k];
    if (k === 'mes_inicio' && v) v = primerDiaDelMesDe(v);
    if (k === 'moi' || k === 'valor_residual') v = round2(v);
    sets.push(`${k}=$${i++}`); vals.push(v);
  }
  if (!sets.length) return { actualizado: false };
  await query(
    `UPDATE activos_fijos SET ${sets.join(', ')}, updated_at=NOW() WHERE company_id=$1 AND id=$2`, vals);
  return { actualizado: true };
}

/** Borra un activo SÓLO si no tiene depreciación ya asentada (para no dejar pólizas huérfanas). */
export async function borrarActivo(companyId: string, id: string): Promise<{ ok: boolean; motivo?: string }> {
  const dep = await query<any>(
    `SELECT COUNT(*)::int AS n FROM activo_fijo_depreciacion WHERE company_id=$1 AND activo_id=$2 AND entry_id IS NOT NULL`,
    [companyId, id]);
  if (Number(dep.rows[0]?.n) > 0) {
    return { ok: false, motivo: 'ya tiene depreciación asentada; primero reversa/borra esas pólizas' };
  }
  const r = await query<any>(`DELETE FROM activos_fijos WHERE company_id=$1 AND id=$2 RETURNING id`, [companyId, id]);
  return { ok: !!r.rows[0] };
}

// ── La cédula (lo que ve la pantalla) ────────────────────────────────────────

/** Todos los activos con su depreciación mensual/anual, la acumulada ASENTADA y su valor en libros. */
export async function listarActivos(companyId: string) {
  const r = await query<any>(
    `SELECT a.*, TO_CHAR(a.fecha_adquisicion,'YYYY-MM-DD') AS fecha_adquisicion,
            TO_CHAR(a.mes_inicio,'YYYY-MM-DD') AS mes_inicio,
            COALESCE(d.asentada,0)::float8 AS acumulada, COALESCE(d.meses,0)::int AS meses_asentados
       FROM activos_fijos a
       LEFT JOIN (
         SELECT activo_id, SUM(monto) AS asentada, COUNT(*) AS meses
           FROM activo_fijo_depreciacion GROUP BY activo_id
       ) d ON d.activo_id = a.id
      WHERE a.company_id=$1
      ORDER BY a.fecha_adquisicion DESC, a.created_at DESC`, [companyId]);

  return r.rows.map((a: any) => {
    const calc = calcularDepreciacion(Number(a.moi), Number(a.valor_residual), Number(a.tasa_anual));
    const acumulada = round2(a.acumulada);
    const regla = reglaDeCuentaActivo(a.cuenta_activo);
    return {
      ...a,
      moi: Number(a.moi), valor_residual: Number(a.valor_residual), tasa_anual: Number(a.tasa_anual),
      dep_mensual: calc.depMensual, dep_anual: calc.depAnual, meses_vida: calc.mesesVida,
      acumulada, pendiente: round2(calc.base - acumulada), valor_en_libros: round2(Number(a.moi) - acumulada),
      totalmente_depreciado: calc.base > 0 && acumulada >= calc.base - 0.01,
      // Para separar la vista: intangibles/diferidos se AMORTIZAN (702/183); el resto se DEPRECIA.
      intangible: !!regla?.intangible,
    };
  });
}

/** La cédula mes a mes (proyectada) de un activo: cuánto se deprecia cada mes hasta agotar la base. */
export async function cedulaMensual(companyId: string, id: string) {
  const r = await query<any>(
    `SELECT *, TO_CHAR(mes_inicio,'YYYY-MM-DD') AS mes_inicio FROM activos_fijos WHERE company_id=$1 AND id=$2`,
    [companyId, id]);
  const a = r.rows[0];
  if (!a) return null;
  const asent = await query<any>(
    `SELECT anio, mes, monto FROM activo_fijo_depreciacion WHERE company_id=$1 AND activo_id=$2`, [companyId, id]);
  const asentados = new Map<string, number>(asent.rows.map((x: any) => [`${x.anio}-${x.mes}`, Number(x.monto)]));

  const calc = calcularDepreciacion(Number(a.moi), Number(a.valor_residual), Number(a.tasa_anual));
  const renglones: Array<{ anio: number; mes: number; monto: number; acumulada: number; en_libros: number; asentada: boolean }> = [];
  if (a.estado !== 'BAJA' && calc.depMensual > 0) {
    let y = Number(String(a.mes_inicio).slice(0, 4));
    let m = Number(String(a.mes_inicio).slice(5, 7));
    let acumulada = 0;
    for (let k = 0; k < 600 && acumulada < calc.base - 0.005; k++) {
      const monto = round2(Math.min(calc.depMensual, calc.base - acumulada));
      acumulada = round2(acumulada + monto);
      renglones.push({
        anio: y, mes: m, monto, acumulada,
        en_libros: round2(Number(a.moi) - acumulada),
        asentada: asentados.has(`${y}-${m}`),
      });
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  return {
    activo: { ...a, moi: Number(a.moi), valor_residual: Number(a.valor_residual), tasa_anual: Number(a.tasa_anual) },
    calculo: calc, renglones,
  };
}

// ── La póliza de depreciación del mes ────────────────────────────────────────

/**
 * Arma UNA póliza con la depreciación de TODOS los activos que toca depreciar el
 * mes: cargo al gasto (701/702) y abono a la acumulada (171/183), agrupado por
 * cuenta. Deja constancia por activo en `activo_fijo_depreciacion`. Idempotente:
 * un mes = una póliza (origen_uuid DEPRE-AAAA-MM). Para regenerar, se borra la
 * póliza (la constancia se va con ella) y se vuelve a generar.
 */
export async function generarDepreciacionDelMes(
  companyId: string, anio: number, mes: number, userId?: string
): Promise<{ creada: boolean; yaExiste?: boolean; folio?: number; activos?: number; total?: number;
            omitidos: Array<{ activo: string; motivo: string }> }> {
  const origenUuid = `DEPRE-${anio}-${String(mes).padStart(2, '0')}`;
  const omitidos: Array<{ activo: string; motivo: string }> = [];

  const existe = await query<any>(
    `SELECT folio FROM journal_entries WHERE company_id=$1 AND origen_uuid=$2 LIMIT 1`, [companyId, origenUuid]);
  if (existe.rows[0]) return { creada: false, yaExiste: true, folio: existe.rows[0].folio, omitidos };

  // Activos vivos, depreciables, que ya arrancaron y aún no se depreciaron ESE mes.
  const r = await query<any>(
    `SELECT a.*, COALESCE(d.asentada,0)::float8 AS acumulada,
            TO_CHAR(a.mes_inicio,'YYYY-MM-DD') AS mes_inicio
       FROM activos_fijos a
       LEFT JOIN (SELECT activo_id, SUM(monto) AS asentada FROM activo_fijo_depreciacion GROUP BY activo_id) d
         ON d.activo_id=a.id
      WHERE a.company_id=$1 AND a.estado='ACTIVO' AND a.tasa_anual > 0
        AND NOT EXISTS (SELECT 1 FROM activo_fijo_depreciacion x
                         WHERE x.activo_id=a.id AND x.anio=$2 AND x.mes=$3)
      ORDER BY a.cuenta_activo`, [companyId, anio, mes]);

  // Resuelve (o crea) las cuentas por código, cacheando.
  const cache = new Map<string, Cta>();
  const resolverGasto = async (cod: string): Promise<Cta | null> => {
    if (!cod) return null;
    if (cache.has(cod)) return cache.get(cod)!;
    const c = await cuentaMovPorCodigo(companyId, cod);
    if (c && c.permite_movimientos) { cache.set(cod, c); return c; }
    return null;
  };

  type Grupo = { gasto: Cta; depAcum: Cta; monto: number };
  const grupos = new Map<string, Grupo>();
  const constancia: Array<{ activo_id: string; monto: number }> = [];
  let total = 0;

  for (const a of r.rows) {
    const nombre = `${a.cuenta_activo} · ${(a.descripcion || '').slice(0, 40)}`;
    if (!mesInicioAlcanzado(a.mes_inicio, anio, mes)) { continue; } // aún no arranca; sin ruido
    const calc = calcularDepreciacion(Number(a.moi), Number(a.valor_residual), Number(a.tasa_anual));
    const monto = round2(Math.min(calc.depMensual, calc.base - round2(a.acumulada)));
    if (monto <= 0) continue; // ya está totalmente depreciado

    const gasto = await resolverGasto(a.cuenta_gasto);
    if (!gasto) { omitidos.push({ activo: nombre, motivo: `falta la cuenta de gasto ${a.cuenta_gasto || '(sin asignar)'}` }); continue; }
    const dep = await resolverOCrearAcumulada(companyId, a.cuenta_dep_acum, `Depreciación acumulada`);
    if ('error' in dep) { omitidos.push({ activo: nombre, motivo: dep.error }); continue; }

    const clave = `${gasto.codigo}|${dep.codigo}`;
    const g = grupos.get(clave) || { gasto, depAcum: dep, monto: 0 };
    g.monto = round2(g.monto + monto); grupos.set(clave, g);
    constancia.push({ activo_id: a.id, monto });
    total = round2(total + monto);
  }

  if (grupos.size === 0) return { creada: false, activos: 0, total: 0, omitidos };

  const fecha = finDeMes(anio, mes);
  const concepto = `Depreciación de ${MESES[mes]} ${anio} · ${constancia.length} activo(s)`;

  const res = await transaction(async (client) => {
    const f = await client.query(
      `SELECT COALESCE(MAX(folio),0)+1 AS n FROM journal_entries
        WHERE company_id=$1 AND EXTRACT(YEAR FROM fecha)=EXTRACT(YEAR FROM $2::date)`, [companyId, fecha]);
    const folio = Number(f.rows[0].n);
    const e = await client.query(
      `INSERT INTO journal_entries
         (company_id, tipo, folio, fecha, concepto, estado, origen, origen_uuid, regla, created_by)
       VALUES ($1,'DIARIO',$2,$3,$4,'ASENTADA','DEPRECIACION',$5,'depreciacion_v1',$6)
       RETURNING id, folio`,
      [companyId, folio, fecha, concepto, origenUuid, userId || null]);
    const entryId = e.rows[0].id;

    let orden = 1;
    for (const g of grupos.values()) {
      await client.query(
        `INSERT INTO journal_lines (entry_id, orden, account_id, cargo, abono, concepto)
         VALUES ($1,$2,$3,$4,0,$5)`,
        [entryId, orden++, g.gasto.id, g.monto, `Depreciación ${MESES[mes]} ${anio}`]);
      await client.query(
        `INSERT INTO journal_lines (entry_id, orden, account_id, cargo, abono, concepto)
         VALUES ($1,$2,$3,0,$4,$5)`,
        [entryId, orden++, g.depAcum.id, g.monto, `Depreciación acumulada ${MESES[mes]} ${anio}`]);
    }
    for (const c of constancia) {
      await client.query(
        `INSERT INTO activo_fijo_depreciacion (company_id, activo_id, anio, mes, monto, entry_id)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (activo_id, anio, mes) DO NOTHING`,
        [companyId, c.activo_id, anio, mes, c.monto, entryId]);
    }
    return { folio: e.rows[0].folio };
  });

  return { creada: true, folio: res.folio, activos: constancia.length, total, omitidos };
}
