/**
 * Subcuentas por tercero — el número contable de cada cliente/proveedor.
 *
 * Bajo la cuenta de control (105.01 Clientes nacionales / 105.02 extranjeros;
 * 201.01 Proveedores nacionales / 201.02 extranjeros) se crea una subcuenta por
 * tercero con la máscara 000-00-000: del control `105.01` nace `105-01-001`,
 * `105-01-002`, … El `tercero_rfc` la amarra a su cliente/proveedor: por eso no
 * se duplica y la póliza sabe cuál usar.
 *
 * Nacional o extranjero se decide por el RFC (los extranjeros llevan el genérico
 * `XEXX010101000`). Al nacer la primera subcuenta, el control deja de recibir
 * movimientos: la hoja es el tercero.
 */
import { query } from '../../config/database';

const AGRUP = {
  cliente: { nacional: '105.01', extranjero: '105.02' },
  proveedor: { nacional: '201.01', extranjero: '201.02' },
} as const;

const esExtranjero = (rfc: string) => /^XEXX/i.test(rfc || '');
const agrupadorDe = (tipo: 'cliente' | 'proveedor', rfc: string) =>
  AGRUP[tipo][esExtranjero(rfc) ? 'extranjero' : 'nacional'];

// Normaliza un nombre para comparar: mayúsculas, sin acentos, SIN puntuación
// (comas/puntos) y espacios colapsados. Así «VALENZUELA DELFIN, SA DE CV» empata con
// «VALENZUELA DELFIN SA DE CV».
const norm = (s: string) => (s || '').toUpperCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function anchosDeMascara(m?: string | null): number[] | null {
  if (!m) return null;
  const a = (m.match(/#+/g) || []).map((g) => g.length);
  return a.length >= 2 ? a : null;
}

/**
 * El siguiente código de una subcuenta de tercero bajo su control.
 *
 * CON máscara (y control numérico que cuadra la longitud): rellena el ÚLTIMO
 * segmento como el catálogo del respaldo — control `1-10-25-000` da `1-10-25-001`,
 * `1-10-25-002`… en vez del viejo `1-10-25-000-001` (guion, un segmento de más).
 * Si se llena el segmento (>999 con 3 dígitos) o no hay máscara, cae al `<control>-NNN`.
 * `usados` trae TODOS los códigos de la empresa (para no chocar); el llamador le
 * agrega el nuevo tras usarlo.
 */
function codigoSiguienteTercero(control: any, mascara: string | null, usados: Set<string>): string {
  const code = String(control.codigo);
  const anchos = anchosDeMascara(mascara);
  if (anchos && /^\d+$/.test(code) && anchos.reduce((a, b) => a + b, 0) === code.length) {
    const W = anchos[anchos.length - 1];
    const pref = code.slice(0, code.length - W);
    const maxN = Math.pow(10, W) - 1;
    let n = 0;
    for (const u of usados) {
      if (u.length === code.length && /^\d+$/.test(u) && u.slice(0, pref.length) === pref) {
        n = Math.max(n, Number(u.slice(pref.length)));
      }
    }
    for (n = n + 1; n <= maxN; n++) {
      const cod = pref + String(n).padStart(W, '0');
      if (!usados.has(cod)) return cod;
    }
  }
  // Fallback: <control con guiones>-NNN
  const base = code.replace(/\./g, '-');
  let n = 0;
  for (const u of usados) { const m = /^(.+)-(\d+)$/.exec(u); if (m && m[1] === base) n = Math.max(n, Number(m[2])); }
  let cod: string;
  do { n++; cod = `${base}-${String(n).padStart(3, '0')}`; } while (usados.has(cod));
  return cod;
}

/** ¿El código YA está en el formato de máscara de su control (mismo largo, numérico,
 *  mismo prefijo)? Sin máscara no se fuerza (devuelve true). Sirve para NO renumerar
 *  los que ya están bien y sí los que quedaron con guion (`1-10-25-000-001`). */
function esFormatoMascara(codigo: string, control: any, mascara: string | null): boolean {
  const anchos = anchosDeMascara(mascara);
  const cc = String(control.codigo);
  if (!(anchos && /^\d+$/.test(cc) && anchos.reduce((a, b) => a + b, 0) === cc.length)) return true;
  const W = anchos[anchos.length - 1];
  const pref = cc.slice(0, cc.length - W);
  const c = String(codigo);
  return c.length === cc.length && /^\d+$/.test(c) && c.slice(0, pref.length) === pref;
}

async function mascaraDe(companyId: string): Promise<string | null> {
  const r = await query<any>('SELECT mascara_cuenta FROM companies WHERE id=$1', [companyId]);
  return r.rows[0]?.mascara_cuenta || null;
}
async function codigosUsados(companyId: string): Promise<Set<string>> {
  const r = await query<any>('SELECT codigo FROM accounting_accounts WHERE company_id=$1', [companyId]);
  return new Set<string>(r.rows.map((x: any) => String(x.codigo)));
}

async function cuentaControl(companyId: string, agrupador: string) {
  /* El control verdadero es una cuenta ACUMULATIVA (no de movimiento) del MISMO
   * RUBRO que su agrupador: los clientes 105.xx cuelgan del activo (código que
   * empieza con 1…), los proveedores 201.xx del pasivo (empieza con 2…).
   *
   * El respaldo traía cuentas MAL clasificadas —p.ej. «112-00-003 Uber», que es
   * una hoja del ACTIVO con agrupador 201.01—; tomarla de control amontonaba
   * TODOS los terceros (proveedores y clientes) bajo Uber. Ahora el orden hace
   * ganar a la que ES control y ES del rubro correcto; el conteo de hijos y el
   * nivel sólo desempatan. Sólo si no hay ninguna se cae en lo que haya. */
  const r = await query<any>(
    `SELECT a.*, (SELECT COUNT(*) FROM accounting_accounts h WHERE h.parent_id = a.id) AS hijos
       FROM accounting_accounts a
      WHERE a.company_id=$1 AND a.codigo_agrupador=$2 AND a.tercero_rfc IS NULL
      ORDER BY (a.permite_movimientos = false) DESC,      -- un control acumula, no es hoja
               (LEFT(a.codigo, 1) = LEFT($2, 1)) DESC,     -- mismo rubro: 1xx cliente / 2xx proveedor
               a.codigo ASC,                               -- el mayor «redondo» (…-000) gana sobre …-001
               a.nivel ASC
      LIMIT 1`, [companyId, agrupador]);
  return r.rows[0] || null;
}

export type SubcuentaResuelta = { id: string; codigo: string; creada: boolean } | { error: string };

/** Encuentra (o crea) la subcuenta del tercero bajo su cuenta de control. */
export async function resolverOCrearSubcuentaTercero(
  companyId: string, tipo: 'cliente' | 'proveedor', rfc: string, nombre: string,
  ctx?: { mascara: string | null; usados: Set<string> }
): Promise<SubcuentaResuelta> {
  const rfcU = (rfc || '').toUpperCase().trim();
  if (!rfcU) return { error: 'sin RFC' };

  const agrup = agrupadorDe(tipo, rfcU);
  const control = await cuentaControl(companyId, agrup);
  if (!control) return { error: `falta la cuenta de control (agrupador ${agrup})` };

  const ya = await query<any>(
    `SELECT id, codigo FROM accounting_accounts
      WHERE company_id=$1 AND parent_id=$2 AND tercero_rfc=$3 LIMIT 1`,
    [companyId, control.id, rfcU]);
  if (ya.rows[0]) return { id: ya.rows[0].id, codigo: ya.rows[0].codigo, creada: false };

  // Antes de INVENTAR: si el respaldo ya trajo la cuenta del tercero (una hoja con
  // el mismo agrupador de control y el MISMO nombre, aún sin RFC), se LIGA esa —con
  // su código real del respaldo— en vez de crear un 105-01-00x nuevo (evita el
  // duplicado 11002074-001 que reportó el usuario).
  const nombreNorm = norm(nombre);
  if (nombreNorm) {
    const cand = await query<any>(
      `SELECT id, codigo, nombre FROM accounting_accounts
        WHERE company_id=$1 AND codigo_agrupador=$2 AND tercero_rfc IS NULL
          AND permite_movimientos=true AND id<>$3`,
      [companyId, agrup, control.id]);
    const hit = cand.rows.find((c: any) => norm(c.nombre) === nombreNorm);
    if (hit) {
      await query(
        `UPDATE accounting_accounts SET tercero_rfc=$2, requiere_tercero=false WHERE id=$1`,
        [hit.id, rfcU]);
      return { id: hit.id, codigo: hit.codigo, creada: false };
    }
  }

  // Siguiente número: en formato de la MÁSCARA (1-10-25-001, 1-10-25-002…), como
  // el catálogo del respaldo — no el viejo <control>-NNN (un segmento de más).
  const mascara = ctx?.mascara ?? await mascaraDe(companyId);
  const usados = ctx?.usados ?? await codigosUsados(companyId);
  const codigo = codigoSiguienteTercero(control, mascara, usados);
  usados.add(codigo);

  const ins = await query<any>(
    `INSERT INTO accounting_accounts
       (company_id, parent_id, codigo, nombre, codigo_agrupador, tipo, naturaleza,
        es_complementaria, nif_norma, nivel, permite_movimientos, requiere_tercero, tercero_rfc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,false,$11)
     RETURNING id, codigo`,
    [companyId, control.id, codigo, (nombre || rfcU).slice(0, 250), control.codigo_agrupador,
     control.tipo, control.naturaleza, control.es_complementaria, control.nif_norma,
     (control.nivel || 1) + 1, rfcU]);

  await query(
    `UPDATE accounting_accounts SET permite_movimientos=false WHERE id=$1 AND permite_movimientos=true`,
    [control.id]);

  return { id: ins.rows[0].id, codigo: ins.rows[0].codigo, creada: true };
}

/** Guarda (espeja) el código de la subcuenta en el expediente del tercero. */
async function guardarCuentaEnTercero(
  companyId: string, tipo: 'cliente' | 'proveedor', rfc: string, codigo: string
): Promise<void> {
  const rolCol = tipo === 'cliente' ? 'es_cliente' : 'es_proveedor';
  await query(
    `UPDATE customers SET cuenta_contable=$3
      WHERE company_id=$1 AND UPPER(rfc)=UPPER($2) AND ${rolCol}=true`,
    [companyId, rfc, codigo]);
}

/**
 * Da de alta la subcuenta de cada tercero que aún no la tenga, tomando los RFC
 * de DOS fuentes: los comprobantes (emitidos→clientes por receptor;
 * recibidos→proveedores por emisor) Y el CATÁLOGO de terceros (customers con el
 * rol correspondiente). Así un proveedor capturado a mano —sin factura todavía—
 * también obtiene su número. El código se espeja en customers.cuenta_contable.
 */
export async function generarSubcuentasDeComprobantes(
  companyId: string, direccion: 'emitidos' | 'recibidos'
): Promise<{ creadas: number; existentes: number; errores: Array<{ rfc: string; motivo: string }> }> {
  const esCliente = direccion === 'emitidos';
  const tipo = esCliente ? 'cliente' : 'proveedor';
  const colRfc = esCliente ? 'rfc_receptor' : 'rfc_emisor';
  const colNom = esCliente ? 'nombre_receptor' : 'nombre_emisor';
  const rolCol = esCliente ? 'es_cliente' : 'es_proveedor';

  // Fuente 1: los comprobantes. Fuente 2: el catálogo de terceros.
  const deCfdi = await query<any>(
    `SELECT DISTINCT ON (${colRfc}) ${colRfc} AS rfc, ${colNom} AS nombre
       FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion=$2 AND ${colRfc} IS NOT NULL AND ${colRfc} <> ''
      ORDER BY ${colRfc}, fecha_emision DESC`,
    [companyId, direccion]);
  const deCatalogo = await query<any>(
    `SELECT rfc, business_name AS nombre FROM customers
      WHERE company_id=$1 AND ${rolCol}=true AND rfc IS NOT NULL AND rfc <> ''`,
    [companyId]);

  // Unir por RFC; el nombre del catálogo (más completo/curado) gana si existe.
  const porRfc = new Map<string, string>();
  for (const row of deCfdi.rows) porRfc.set(String(row.rfc).toUpperCase().trim(), row.nombre);
  for (const row of deCatalogo.rows) porRfc.set(String(row.rfc).toUpperCase().trim(), row.nombre);

  // Máscara + códigos usados UNA vez (no por tercero): así la numeración va en el
  // formato del catálogo y no choca entre sí dentro del mismo lote.
  const ctx = { mascara: await mascaraDe(companyId), usados: await codigosUsados(companyId) };

  let creadas = 0, existentes = 0;
  const errores: Array<{ rfc: string; motivo: string }> = [];
  for (const [rfc, nombre] of porRfc) {
    const res = await resolverOCrearSubcuentaTercero(companyId, tipo, rfc, nombre, ctx);
    if ('error' in res) { errores.push({ rfc, motivo: res.error }); continue; }
    await guardarCuentaEnTercero(companyId, tipo, rfc, res.codigo);
    if (res.creada) creadas++; else existentes++;
  }
  return { creadas, existentes, errores };
}

/** Las subcuentas de tercero ya creadas (para revisarlas / capturar su código). */
export async function listarSubcuentasTercero(companyId: string, tipo: 'cliente' | 'proveedor') {
  const agrups = tipo === 'cliente' ? ['105.01', '105.02'] : ['201.01', '201.02'];
  const r = await query<any>(
    `SELECT id, codigo, nombre, tercero_rfc, codigo_agrupador
       FROM accounting_accounts
      WHERE company_id=$1 AND tercero_rfc IS NOT NULL AND codigo_agrupador = ANY($2)
      ORDER BY codigo`, [companyId, agrups]);
  return r.rows;
}

/** Captura/override manual del código de una subcuenta de tercero (respaldos). */
export async function fijarCodigoSubcuenta(
  companyId: string, id: string, nuevoCodigo: string
): Promise<{ codigo: string } | { error: string }> {
  const cod = (nuevoCodigo || '').trim().slice(0, 30);
  if (!cod) return { error: 'el código no puede ir vacío' };
  const dup = await query<any>(
    `SELECT 1 FROM accounting_accounts WHERE company_id=$1 AND codigo=$2 AND id<>$3`, [companyId, cod, id]);
  if (dup.rows[0]) return { error: `ya existe una cuenta con el código ${cod}` };
  const r = await query<any>(
    `UPDATE accounting_accounts SET codigo=$3, updated_at=NOW()
      WHERE id=$1 AND company_id=$2 AND tercero_rfc IS NOT NULL
      RETURNING codigo, tercero_rfc`, [id, companyId, cod]);
  if (!r.rows[0]) return { error: 'no se encontró la subcuenta' };
  // Espeja el nuevo código en el expediente del tercero (si está en el catálogo).
  if (r.rows[0].tercero_rfc) {
    await query(
      `UPDATE customers SET cuenta_contable=$3 WHERE company_id=$1 AND UPPER(rfc)=UPPER($2)`,
      [companyId, r.rows[0].tercero_rfc, r.rows[0].codigo]);
  }
  return { codigo: r.rows[0].codigo };
}

/**
 * Reorganiza los terceros MAL COLOCADOS: cada cuenta con agrupador de tercero
 * (105.xx cliente / 201.xx proveedor) que sea HOJA y NO cuelgue del control
 * correcto —o que cuelgue de él pero con número viejo de guion— se MUEVE/RENUMERA
 * bajo su control en el FORMATO de la máscara (1-10-25-001, 1-10-25-002…),
 * heredando el tipo/naturaleza del control. Sus partidas la siguen (es la misma
 * cuenta, sólo cambia padre y código).
 *
 * Resuelve el desorden del respaldo (24 terceros colgando de «112-…-… Uber»,
 * clientes y proveedores mezclados): tras correrlo, los clientes quedan bajo el
 * control 105.xx y los proveedores bajo el 201.xx, al mismo nivel. Se hace en
 * varias pasadas porque al vaciar un padre mal usado, ése también puede tocar
 * moverse.
 */
export async function reorganizarTerceros(
  companyId: string,
): Promise<{ movidas: number; detalle: Array<{ de: string; a: string; nombre: string }> }> {
  const AGR = ['105.01', '105.02', '201.01', '201.02'];
  let movidas = 0;
  const detalle: Array<{ de: string; a: string; nombre: string }> = [];
  const controlPorAgr = new Map<string, any>();
  const mascara = await mascaraDe(companyId);
  const usados = new Set<string>(
    (await query<any>('SELECT codigo FROM accounting_accounts WHERE company_id=$1', [companyId]))
      .rows.map((r: any) => r.codigo));

  for (let pasada = 0; pasada < 6; pasada++) {
    const cand = await query<any>(
      `SELECT a.id, a.codigo, a.nombre, a.codigo_agrupador, a.parent_id,
              (SELECT COUNT(*) FROM accounting_accounts h WHERE h.parent_id=a.id)::int AS hijos
         FROM accounting_accounts a
        WHERE a.company_id=$1 AND a.codigo_agrupador = ANY($2)`,
      [companyId, AGR]);

    let enPasada = 0;
    for (const c of cand.rows) {
      if (c.hijos > 0) continue;                         // aún es padre: no se mueve todavía
      let control = controlPorAgr.get(c.codigo_agrupador);
      if (control === undefined) {
        control = await cuentaControl(companyId, c.codigo_agrupador);
        controlPorAgr.set(c.codigo_agrupador, control);
      }
      if (!control || control.id === c.id) continue;     // no hay control, o ES el control
      // Ya está bien SÓLO si cuelga del control correcto Y su código está en el
      // formato de la máscara. Si no (mal padre, o número con guion), se renumera.
      if (c.parent_id === control.id && esFormatoMascara(c.codigo, control, mascara)) continue;

      const cod = codigoSiguienteTercero(control, mascara, usados);
      usados.add(cod);

      await query(
        `UPDATE accounting_accounts
            SET parent_id=$2, codigo=$3, tipo=$4, naturaleza=$5, nivel=$6,
                permite_movimientos=true, updated_at=NOW()
          WHERE id=$1`,
        [c.id, control.id, cod, control.tipo, control.naturaleza, (control.nivel || 1) + 1]);
      // El control deja de recibir movimientos: la hoja es el tercero.
      await query(
        `UPDATE accounting_accounts SET permite_movimientos=false WHERE id=$1 AND permite_movimientos=true`,
        [control.id]);

      movidas++; enPasada++;
      if (detalle.length < 300) detalle.push({ de: c.codigo, a: cod, nombre: c.nombre });
    }
    if (enPasada === 0) break;
  }
  return { movidas, detalle };
}

/**
 * Captura en el catálogo de CLIENTES/PROVEEDORES (`customers`) los terceros que
 * conocemos por los CFDI y las subcuentas de tercero — con los datos que se
 * puedan: RFC y nombre. Así el cliente/proveedor aparece en su pantalla (Clientes
 * o Proveedores) sin recapturarlo a mano. No pisa nombres ya curados; sólo marca
 * el rol (es_cliente / es_proveedor) y rellena el nombre si estaba vacío.
 */
export async function capturarTercerosEnCatalogo(
  companyId: string, tipo: 'cliente' | 'proveedor',
): Promise<{ creados: number; actualizados: number; omitidos: number }> {
  const rol = tipo === 'cliente' ? 'es_cliente' : 'es_proveedor';
  const direccion = tipo === 'cliente' ? 'emitidos' : 'recibidos';
  const colRfc = tipo === 'cliente' ? 'rfc_receptor' : 'rfc_emisor';
  const colNom = tipo === 'cliente' ? 'nombre_receptor' : 'nombre_emisor';
  const agrups = tipo === 'cliente' ? ['105.01', '105.02'] : ['201.01', '201.02'];

  const emp = await query<any>('SELECT UPPER(rfc) AS rfc FROM companies WHERE id=$1', [companyId]);
  const rfcEmpresa = String(emp.rows[0]?.rfc || '').trim();

  // Fuente 1: los CFDI (por RFC, el nombre más reciente). Fuente 2: las subcuentas
  // de tercero (nombre curado del respaldo).
  const deCfdi = await query<any>(
    `SELECT DISTINCT ON (UPPER(${colRfc})) UPPER(${colRfc}) AS rfc, ${colNom} AS nombre
       FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion=$2 AND ${colRfc} IS NOT NULL AND ${colRfc} <> ''
      ORDER BY UPPER(${colRfc}), fecha_emision DESC`, [companyId, direccion]);
  const deCtas = await query<any>(
    `SELECT DISTINCT ON (UPPER(tercero_rfc)) UPPER(tercero_rfc) AS rfc, nombre
       FROM accounting_accounts
      WHERE company_id=$1 AND tercero_rfc IS NOT NULL AND codigo_agrupador = ANY($2)
      ORDER BY UPPER(tercero_rfc)`, [companyId, agrups]);

  const porRfc = new Map<string, string>();
  for (const r of deCfdi.rows) porRfc.set(String(r.rfc).trim(), r.nombre);
  for (const r of deCtas.rows) if (r.nombre) porRfc.set(String(r.rfc).trim(), r.nombre);

  let creados = 0, actualizados = 0, omitidos = 0;
  for (const [rfc, nombre] of porRfc) {
    const rfcU = rfc.toUpperCase().trim();
    if (!rfcU || rfcU.length > 13 || rfcU === rfcEmpresa) { omitidos++; continue; }
    const nom = (String(nombre || '').trim() || rfcU).slice(0, 255);
    try {
      const r = await query<any>(
        `INSERT INTO customers (company_id, rfc, business_name, ${rol})
         VALUES ($1,$2,$3,true)
         ON CONFLICT (company_id, rfc) DO UPDATE SET
           ${rol} = true,
           business_name = CASE
             WHEN customers.business_name IS NULL OR customers.business_name = ''
               THEN EXCLUDED.business_name ELSE customers.business_name END,
           updated_at = NOW()
         RETURNING (xmax = 0) AS creado`,
        [companyId, rfcU, nom]);
      if (r.rows[0].creado) creados++; else actualizados++;
    } catch { omitidos++; }
  }
  return { creados, actualizados, omitidos };
}
