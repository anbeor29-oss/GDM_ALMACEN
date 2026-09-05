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
// Nombre con las PALABRAS ordenadas: empata «ADRIANA DELGADO FIGUEROA» (como viene
// en el CFDI) con «DELGADO FIGUEROA ADRIANA» (como suele venir en CONTPAQi). Sin
// esto, el mismo tercero con el orden cambiado se ligaba mal y nacía un duplicado.
const normSorted = (s: string) => norm(s).split(' ').filter(Boolean).sort().join(' ');

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
  const total = anchos ? anchos.reduce((a, b) => a + b, 0) : 0;
  // Prefijo del MAYOR en puro dígito. Le quitamos separadores y cualquier sufijo
  // «-NNN» heredado del formato viejo, y tomamos los primeros `total` dígitos: así
  // el control valga 1-10-25-000, 11025000 o incluso el mal formado 11025001-076,
  // SIEMPRE sale el mismo prefijo (11025) y el hueco es 1-10-25-0XX —nunca el
  // segmento de más 1-10-25-001-0XX que reportó el usuario—.
  const soloDig = code.replace(/\D/g, '');
  if (anchos && total > 0 && soloDig.length >= total) {
    const W = anchos[anchos.length - 1];
    const pref = soloDig.slice(0, total - W);          // «11025»
    const maxN = Math.pow(10, W) - 1;
    let n = 0;
    for (const u of usados) {
      // Sólo cuentan los que YA están en formato de máscara (largo exacto, puro
      // dígito, mismo prefijo); los mal formados no corren la numeración.
      if (u.length === total && /^\d+$/.test(u) && u.slice(0, pref.length) === pref) {
        n = Math.max(n, Number(u.slice(pref.length)));
      }
    }
    for (n = n + 1; n <= maxN; n++) {
      const cod = pref + String(n).padStart(W, '0');
      if (!usados.has(cod)) return cod;
    }
  }
  // Fallback SÓLO sin máscara numérica utilizable: <control con guiones>-NNN.
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

async function cuentaControl(companyId: string, agrupador: string, mascara?: string | null) {
  /* El control verdadero es el MAYOR «redondo» del rubro: el que termina en ceros
   * en el último segmento de la máscara (1-10-25-000 para clientes, 2-10-10-000
   * para proveedores). Esa preferencia va PRIMERO —arriba de acumulativa y de
   * rubro— porque el respaldo a veces deja el mayor como afectable y convierte por
   * error a un tercero (1-10-25-001) en «control» al colgarle subcuentas; sin este
   * orden ganaba 1-10-25-001 y numeraba 1-10-25-001-001. Luego: acumulativa (no
   * hoja), mismo rubro (1xx cliente / 2xx proveedor) y código ASC como desempate. */
  const anchos = anchosDeMascara(mascara ?? null);
  const W = anchos ? anchos[anchos.length - 1] : 0;
  const params: any[] = [companyId, agrupador];
  let redondo = 'FALSE';
  if (W > 0) {
    params.push('0'.repeat(W));
    redondo = `(a.codigo ~ '^[0-9]+$' AND RIGHT(a.codigo, ${W}) = $3)`;
  }
  const r = await query<any>(
    `SELECT a.*, (SELECT COUNT(*) FROM accounting_accounts h WHERE h.parent_id = a.id) AS hijos
       FROM accounting_accounts a
      WHERE a.company_id=$1 AND a.codigo_agrupador=$2 AND a.tercero_rfc IS NULL
      ORDER BY (${redondo}) DESC,                          -- el mayor «redondo» (…-000) primero
               (a.permite_movimientos = false) DESC,       -- un control acumula, no es hoja
               (LEFT(a.codigo, 1) = LEFT($2, 1)) DESC,      -- mismo rubro: 1xx cliente / 2xx proveedor
               a.codigo ASC,
               a.nivel ASC
      LIMIT 1`, params);
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

  const mascara = ctx ? ctx.mascara : await mascaraDe(companyId);
  const agrup = agrupadorDe(tipo, rfcU);
  const control = await cuentaControl(companyId, agrup, mascara);
  if (!control) return { error: `falta la cuenta de control (agrupador ${agrup})` };

  const ya = await query<any>(
    `SELECT id, codigo FROM accounting_accounts
      WHERE company_id=$1 AND parent_id=$2 AND tercero_rfc=$3 LIMIT 1`,
    [companyId, control.id, rfcU]);
  if (ya.rows[0]) return { id: ya.rows[0].id, codigo: ya.rows[0].codigo, creada: false };

  // Antes de INVENTAR: si el respaldo ya trajo la cuenta del tercero, se LIGA esa
  // —con su código real del respaldo— en vez de crear un 105-01-00x nuevo. Es la
  // base del catálogo que el usuario pidió respetar: si el cliente ya está en el
  // catálogo importado, se usa ESE número, no uno alfabético nuevo (evita las
  // duplicidades ADRIANA 1-10-25-065 vs 1-10-25-001-076 que reportó).
  //
  // Se busca una hoja SIN RFC con el mismo nombre entre las candidatas del rubro:
  // no sólo las del agrupador exacto (105.01) —que muchas cuentas del respaldo NO
  // traen— sino también las que cuelgan bajo el MAYOR del control (mismo prefijo
  // 1-10-25…), que es donde el respaldo dejó a los clientes.
  const nombreNorm = norm(nombre);
  if (nombreNorm) {
    const anchos = anchosDeMascara(mascara);
    const totalM = anchos ? anchos.reduce((a, b) => a + b, 0) : 0;
    const digCtrl = String(control.codigo).replace(/\D/g, '');
    const prefMayor = (anchos && totalM > 0 && digCtrl.length >= totalM)
      ? digCtrl.slice(0, totalM - anchos[anchos.length - 1]) : null;   // «11025»
    const cand = await query<any>(
      `SELECT id, codigo, nombre FROM accounting_accounts
        WHERE company_id=$1 AND tercero_rfc IS NULL AND permite_movimientos=true AND id<>$3
          AND (codigo_agrupador=$2 OR ($4 <> '' AND codigo LIKE $4))`,
      [companyId, agrup, control.id, prefMayor ? prefMayor + '%' : '']);
    // Primero por nombre EXACTO (ya normalizado); si no, por nombre con las palabras
    // ordenadas (mismo tercero con apellidos y nombre en distinto orden).
    const nombreSorted = normSorted(nombre);
    const hit = cand.rows.find((c: any) => norm(c.nombre) === nombreNorm)
             || cand.rows.find((c: any) => normSorted(c.nombre) === nombreSorted);
    if (hit) {
      await query(
        `UPDATE accounting_accounts SET tercero_rfc=$2, requiere_tercero=false,
           codigo_agrupador=COALESCE(codigo_agrupador,$3) WHERE id=$1`,
        [hit.id, rfcU, agrup]);
      return { id: hit.id, codigo: hit.codigo, creada: false };
    }
  }

  // Siguiente número: en formato de la MÁSCARA (1-10-25-001, 1-10-25-002…), como
  // el catálogo del respaldo — no el viejo <control>-NNN (un segmento de más).
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
        control = await cuentaControl(companyId, c.codigo_agrupador, mascara);
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
