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
               (SELECT COUNT(*) FROM accounting_accounts h WHERE h.parent_id = a.id) DESC,
               a.nivel ASC
      LIMIT 1`, [companyId, agrupador]);
  return r.rows[0] || null;
}

export type SubcuentaResuelta = { id: string; codigo: string; creada: boolean } | { error: string };

/** Encuentra (o crea) la subcuenta del tercero bajo su cuenta de control. */
export async function resolverOCrearSubcuentaTercero(
  companyId: string, tipo: 'cliente' | 'proveedor', rfc: string, nombre: string
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

  // Siguiente número: el mayor sufijo de las subcuentas + 1.
  const hijos = await query<any>(
    `SELECT codigo FROM accounting_accounts WHERE company_id=$1 AND parent_id=$2`,
    [companyId, control.id]);
  let max = 0;
  for (const h of hijos.rows) {
    const m = /(\d+)\s*$/.exec(String(h.codigo));
    if (m) max = Math.max(max, Number(m[1]));
  }
  const base = String(control.codigo).replace(/\./g, '-');           // 105.01 → 105-01
  const codigo = `${base}-${String(max + 1).padStart(3, '0')}`;      // 105-01-001

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

  let creadas = 0, existentes = 0;
  const errores: Array<{ rfc: string; motivo: string }> = [];
  for (const [rfc, nombre] of porRfc) {
    const res = await resolverOCrearSubcuentaTercero(companyId, tipo, rfc, nombre);
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
 * correcto se MUEVE bajo su control y se RENUMERA (`<control>-NNN`), heredando el
 * tipo/naturaleza del control. Sus partidas la siguen (es la misma cuenta, sólo
 * cambia padre y código).
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
  const contador = new Map<string, number>();          // control.id → último sufijo usado
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
      if (c.parent_id === control.id) continue;          // ya está bien colocada

      const base = String(control.codigo).replace(/\./g, '-');
      let n = contador.get(control.id);
      if (n === undefined) {
        const hijos = await query<any>(
          `SELECT codigo FROM accounting_accounts WHERE company_id=$1 AND parent_id=$2`, [companyId, control.id]);
        n = 0;
        for (const h of hijos.rows) { const m = /-(\d+)\s*$/.exec(String(h.codigo)); if (m) n = Math.max(n, Number(m[1])); }
      }
      let cod: string;
      do { n++; cod = `${base}-${String(n).padStart(3, '0')}`; } while (usados.has(cod));
      contador.set(control.id, n);
      usados.add(cod);

      await query(
        `UPDATE accounting_accounts
            SET parent_id=$2, codigo=$3, tipo=$4, naturaleza=$5, nivel=$6, updated_at=NOW()
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
