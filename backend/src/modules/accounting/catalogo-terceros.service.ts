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

async function cuentaControl(companyId: string, agrupador: string) {
  const r = await query<any>(
    `SELECT * FROM accounting_accounts
      WHERE company_id=$1 AND codigo_agrupador=$2 AND tercero_rfc IS NULL
      ORDER BY nivel LIMIT 1`, [companyId, agrupador]);
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

/**
 * Recorre los comprobantes de una dirección y da de alta la subcuenta de cada
 * tercero que aún no la tenga. Emitidos → clientes (por receptor); recibidos →
 * proveedores (por emisor).
 */
export async function generarSubcuentasDeComprobantes(
  companyId: string, direccion: 'emitidos' | 'recibidos'
): Promise<{ creadas: number; existentes: number; errores: Array<{ rfc: string; motivo: string }> }> {
  const esCliente = direccion === 'emitidos';
  const colRfc = esCliente ? 'rfc_receptor' : 'rfc_emisor';
  const colNom = esCliente ? 'nombre_receptor' : 'nombre_emisor';

  const r = await query<any>(
    `SELECT DISTINCT ON (${colRfc}) ${colRfc} AS rfc, ${colNom} AS nombre
       FROM cfdi_recibidos
      WHERE company_id=$1 AND direccion=$2 AND ${colRfc} IS NOT NULL AND ${colRfc} <> ''
      ORDER BY ${colRfc}, fecha_emision DESC`,
    [companyId, direccion]);

  let creadas = 0, existentes = 0;
  const errores: Array<{ rfc: string; motivo: string }> = [];
  for (const row of r.rows) {
    const res = await resolverOCrearSubcuentaTercero(
      companyId, esCliente ? 'cliente' : 'proveedor', row.rfc, row.nombre);
    if ('error' in res) errores.push({ rfc: row.rfc, motivo: res.error });
    else if (res.creada) creadas++;
    else existentes++;
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
      RETURNING codigo`, [id, companyId, cod]);
  if (!r.rows[0]) return { error: 'no se encontró la subcuenta' };
  return { codigo: r.rows[0].codigo };
}
