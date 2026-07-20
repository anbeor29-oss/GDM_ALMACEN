/**
 * carta-porte-catalogs.routes — búsqueda universal de catálogos SAT del CP 3.1.
 *
 *   GET /carta-porte/catalogs/:name?q=&limit=50
 *
 * Diseño:
 *   · Un solo endpoint para 30+ catálogos → menos ruido en la API
 *   · Whitelist explícita de tablas para evitar inyección de nombres
 *   · Búsqueda por prefijo en clave (case-insensitive) y substring en
 *     descripción (case-insensitive). Índices se pueden añadir si duele.
 *   · Devuelve { clave, descripcion, extras } uniforme
 *
 *   GET /carta-porte/list — facturas de la empresa que ya tienen CP
 */

import { Router, Request, Response } from 'express';
import { authenticateToken } from '../../middleware/authentication';
import { asyncHandler, ValidationError } from '../../middleware/errorHandler';
import { pool } from '../../config/database';
import errorMatrix from './sat-error-matrix.json';

const router = Router();
router.use(authenticateToken);

// nombre-slug del catálogo → tabla + columnas visibles adicionales
const CATALOGS: Record<string, { table: string; extra?: string[]; label?: string }> = {
  'clave-prod-serv':      { table: 'sat_cp_clave_prod_serv',       extra: ['material_peligroso'] },
  'clave-unidad-peso':    { table: 'sat_cp_clave_unidad_peso',     extra: ['nombre'] },
  'config-autotransporte':{ table: 'sat_cp_config_autotransporte', extra: ['numero_ejes','numero_llantas','remolque'] },
  'sub-tipo-rem':         { table: 'sat_cp_sub_tipo_rem' },
  'tipo-permiso':         { table: 'sat_cp_tipo_permiso',          extra: ['clave_transporte'] },
  'tipo-embalaje':        { table: 'sat_cp_tipo_embalaje' },
  'material-peligroso':   { table: 'sat_cp_material_peligroso',    extra: ['clase_o_div','peligro_secundario'] },
  'figura-transporte':    { table: 'sat_cp_figura_transporte' },
  'parte-transporte':     { table: 'sat_cp_parte_transporte' },
  'tipo-estacion':        { table: 'sat_cp_tipo_estacion',         extra: ['clave_transporte'] },
  'cve-transporte':       { table: 'sat_cp_cve_transporte' },
  'documento-aduanero':   { table: 'sat_cp_documento_aduanero' },
  'regimen-aduanero':     { table: 'sat_cp_regimen_aduanero',      extra: ['impoexpo'] },
  'clave-tipo-carga':     { table: 'sat_cp_clave_tipo_carga' },
  'config-maritima':      { table: 'sat_cp_config_maritima' },
  'contenedor-maritimo':  { table: 'sat_cp_contenedor_maritimo' },
  'codigo-transporte-aereo': { table: 'sat_cp_codigo_transporte_aereo', extra: ['nacionalidad','nombre_aerolinea'] },
  'tipo-de-servicio':     { table: 'sat_cp_tipo_de_servicio',      extra: ['contenedor'] },
  'derechos-de-paso':     { table: 'sat_cp_derechos_de_paso' },
  'tipo-carro':           { table: 'sat_cp_tipo_carro' },
  'contenedor':           { table: 'sat_cp_contenedor' },
  'tipo-de-trafico':      { table: 'sat_cp_tipo_de_trafico' },
  'estaciones':           { table: 'sat_cp_estaciones',            extra: ['clave_transporte'] },
  'sector-cofepris':      { table: 'sat_cp_sector_cofepris' },
  'forma-farmaceutica':   { table: 'sat_cp_forma_farmaceutica' },
  'condiciones-especiales':{ table: 'sat_cp_condiciones_especiales' },
};

router.get(
  '/catalogs/:name',
  asyncHandler(async (req: Request, res: Response) => {
    const cat = CATALOGS[req.params.name];
    if (!cat) throw new ValidationError(`Catálogo desconocido: ${req.params.name}`);
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const extras = cat.extra || [];
    const cols = ['clave', 'descripcion', ...extras].join(', ');
    let sql = `SELECT ${cols} FROM ${cat.table}`;
    const params: string[] = [];
    if (q) {
      params.push(q + '%', '%' + q + '%');
      sql += ` WHERE clave ILIKE $1 OR descripcion ILIKE $2`;
    }
    sql += ` ORDER BY clave LIMIT ${limit}`;
    const r = await pool.query(sql, params);
    res.json({ items: r.rows });
  }),
);

/**
 * GET /carta-porte/cp/:codigoPostal → resuelve un CP a su(s) colonia(s),
 * municipio, localidad y estado usando los catálogos SAT ya cargados
 * (sat_cp_colonia + sat_cp_municipio + sat_cp_localidad).
 * Devuelve todas las colonias del CP; el usuario elige.
 */
router.get(
  '/cp/:codigoPostal',
  asyncHandler(async (req: Request, res: Response) => {
    const cp = String(req.params.codigoPostal || '').trim();
    if (!/^\d{5}$/.test(cp)) throw new ValidationError('Código postal debe ser 5 dígitos');

    // Estrategia: en catCFDI y catCartaPorte, cada colonia tiene clave +
    // codigo_postal. El estado y municipio se sacan cruzando la primera
    // colonia con sat_cp_municipio y luego el estado desde el CP catalog
    // general. Aquí devolvemos las colonias y dejamos que el frontend
    // muestre las opciones.
    const r = await pool.query(
      `SELECT clave, descripcion, codigo_postal
         FROM sat_cp_colonia
        WHERE codigo_postal = $1
        ORDER BY descripcion
        LIMIT 100`,
      [cp],
    );
    // El municipio y estado son consistentes entre colonias del mismo CP —
    // los inferimos con las primeras filas del catálogo general de CFDI si
    // están cargadas; por ahora regresamos solo colonias y dejamos que el
    // usuario capture municipio/estado si falta.
    res.json({
      codigoPostal: cp,
      colonias: r.rows,
    });
  }),
);

router.get(
  '/error-matrix',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ count: (errorMatrix as any[]).length, rules: errorMatrix });
  }),
);

router.get(
  '/list',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.companyId) throw new ValidationError('company_id requerido');
    const r = await pool.query(
      `SELECT
         cp.invoice_id             AS "invoiceId",
         i.folio || ' ' || COALESCE(i.serie,'') AS "invoiceNumber",
         i.status                  AS "invoiceStatus",
         (SELECT string_agg(u.calle || ' ' || COALESCE(u.codigo_postal,''), ' → ')
            FROM cp_ubicaciones u
           WHERE u.carta_porte_id = cp.id AND u.tipo_ubicacion='Origen') AS origen,
         (SELECT string_agg(u.calle || ' ' || COALESCE(u.codigo_postal,''), ' → ')
            FROM cp_ubicaciones u
           WHERE u.carta_porte_id = cp.id AND u.tipo_ubicacion='Destino') AS destino,
         (SELECT string_agg(f.nombre_figura, ', ')
            FROM cp_figuras f
           WHERE f.carta_porte_id = cp.id AND f.tipo_figura='01') AS transportista,
         to_char(cp.created_at, 'YYYY-MM-DD') AS fecha
       FROM carta_porte cp
       JOIN invoices i ON i.id = cp.invoice_id
       WHERE i.company_id = $1
       ORDER BY cp.created_at DESC
       LIMIT 200`,
      [req.user.companyId],
    );
    res.json({ items: r.rows });
  }),
);

export default router;
