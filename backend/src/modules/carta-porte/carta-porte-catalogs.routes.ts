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

/**
 * Comparación sin acentos ni mayúsculas.
 *
 * Medio catálogo del SAT trae acentos — Lázaro Cárdenas, Ciudad Juárez,
 * Mérida — y nadie los teclea al buscar. Con ILIKE, "lazaro" no encontraba
 * "Lázaro Cárdenas".
 *
 * Se usa translate() y no la extensión unaccent porque CREATE EXTENSION puede
 * no estar permitido en el Postgres administrado de Render; translate() es
 * SQL estándar y funciona en cualquier instancia.
 */
const ACENTOS = 'áéíóúÁÉÍÓÚàèìòùÀÈÌÒÙäëïöüÄËÏÖÜâêîôûÂÊÎÔÛñÑçÇ';
const LLANOS  = 'aeiouAEIOUaeiouAEIOUaeiouAEIOUaeiouAEIOUnNcC';
const sinAcentos = (expr: string) => `translate(lower(${expr}), '${ACENTOS}', '${LLANOS}')`;

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
  'num-autorizacion-naviero': { table: 'sat_cp_num_autorizacion_naviero' },
  'tipo-materia':         { table: 'sat_cp_tipo_materia' },
  'registro-istmo':       { table: 'sat_cp_registro_istmo' },
  // Internacional
  'pais':                 { table: 'sat_cp_pais' },
  'estado':               { table: 'sat_cp_estado',               extra: ['pais'] },
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
    const where: string[] = [];

    if (q) {
      params.push(q + '%', '%' + q + '%');
      where.push(
        `(clave ILIKE $${params.length - 1} OR ` +
        `${sinAcentos('descripcion')} LIKE ${sinAcentos('$' + params.length)})`,
      );
    }
    // Los estados solo tienen sentido dentro de un país: sin este filtro el
    // combo de un domicilio en Texas ofrecería los 32 estados mexicanos.
    if (extras.includes('pais') && req.query.pais) {
      params.push(String(req.query.pais));
      where.push(`pais = $${params.length}`);
    }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;

    sql += ` ORDER BY descripcion LIMIT ${limit}`;
    const r = await pool.query(sql, params);
    res.json({ items: r.rows });
  }),
);

/**
 * GET /carta-porte/cruces-fronterizos — ayuda de captura para operaciones
 * México–EUA. No es catálogo del SAT: el XML sigue viajando con las claves
 * oficiales de vía, país y régimen.
 */
router.get(
  '/cruces-fronterizos',
  asyncHandler(async (_req: Request, res: Response) => {
    const r = await pool.query(
      `SELECT clave, nombre_mx AS "nombreMx", estado_mx AS "estadoMx",
              nombre_us AS "nombreUs", estado_us AS "estadoUs"
         FROM cp_cruce_fronterizo
        WHERE activo
        ORDER BY nombre_mx`,
    );
    res.json({ items: r.rows });
  }),
);

/**
 * GET /carta-porte/puntos-entrada-salida?medio=01&q=
 *
 * Por dónde entra o sale la mercancía del país, según cómo viaje:
 *
 *   01 Autotransporte → cruce carretero (catálogo propio)
 *   04 Ferroviario    → el mismo cruce carretero; el tren cruza por Nuevo
 *                       Laredo o Piedras Negras igual que el camión
 *   02 Marítimo       → puerto     (sat_cp_estaciones, 123)
 *   03 Aéreo          → aeropuerto (sat_cp_estaciones, 2 346)
 *
 * Devuelve siempre { clave, descripcion } para que el combo del formulario
 * no tenga que saber de dónde salió cada lista.
 */
router.get(
  '/puntos-entrada-salida',
  asyncHandler(async (req: Request, res: Response) => {
    const medio = String(req.query.medio || '01');
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit) || 300, 500);

    if (medio === '01' || medio === '04') {
      const params: string[] = [];
      let sql = `SELECT clave, nombre_mx || ' – ' || nombre_us AS descripcion,
                        estado_mx AS "estadoMx", estado_us AS "estadoUs"
                   FROM cp_cruce_fronterizo WHERE activo`;
      if (q) {
        params.push('%' + q + '%');
        sql += ` AND (${sinAcentos('nombre_mx')} LIKE ${sinAcentos('$1')}
                   OR ${sinAcentos('nombre_us')} LIKE ${sinAcentos('$1')})`;
      }
      sql += ` ORDER BY nombre_mx LIMIT ${limit}`;
      const r = await pool.query(sql, params);
      res.json({ tipo: 'cruce', items: r.rows });
      return;
    }

    if (medio !== '02' && medio !== '03') {
      throw new ValidationError(`Medio de transporte desconocido: ${medio}`);
    }

    const params: string[] = [medio];
    let sql = `SELECT clave, descripcion FROM sat_cp_estaciones WHERE clave_transporte = $1`;
    if (q) {
      params.push(q + '%', '%' + q + '%');
      sql += ` AND (clave ILIKE $2 OR ${sinAcentos('descripcion')} LIKE ${sinAcentos('$3')})`;
    }
    sql += ` ORDER BY descripcion LIMIT ${limit}`;
    const r = await pool.query(sql, params);
    res.json({ tipo: medio === '02' ? 'puerto' : 'aeropuerto', items: r.rows });
  }),
);

/**
 * GET /carta-porte/estaciones?medio=02&q= — estaciones para el nodo Ubicación.
 *
 * Distinto de /puntos-entrada-salida: esto llena NumEstacion y NombreEstacion
 * de CADA ubicación (el puerto de origen y el de destino son diferentes),
 * mientras que el punto de entrada/salida es uno solo para toda la operación.
 * Solo aplica a marítimo, aéreo y ferroviario — un camión no sale de una
 * estación.
 */
router.get(
  '/estaciones',
  asyncHandler(async (req: Request, res: Response) => {
    const medio = String(req.query.medio || '');
    if (!['02', '03', '04'].includes(medio)) {
      throw new ValidationError('Las estaciones solo aplican a marítimo, aéreo y ferroviario');
    }
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const params: string[] = [medio];
    let sql = `SELECT clave, descripcion FROM sat_cp_estaciones WHERE clave_transporte = $1`;
    if (q) {
      params.push(q + '%', '%' + q + '%');
      sql += ` AND (clave ILIKE $2 OR ${sinAcentos('descripcion')} LIKE ${sinAcentos('$3')})`;
    }
    sql += ` ORDER BY descripcion LIMIT ${limit}`;
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

    // Estado inferido por rango de CP (Anexo 20 SAT — mapeo oficial 2 primeros
    // dígitos del CP → clave de estado). Se usa para pre-cargar municipios y
    // localidades del estado para autocompletar el formulario de ubicación.
    const CP_TO_ESTADO: Record<string, string> = {
      '01': 'CDMX','02': 'CDMX','03': 'CDMX','04': 'CDMX','05': 'CDMX','06': 'CDMX','07': 'CDMX','08': 'CDMX','09': 'CDMX','10': 'CDMX','11': 'CDMX','12': 'CDMX','13': 'CDMX','14': 'CDMX','15': 'CDMX','16': 'CDMX','17': 'CDMX',
      '20': 'AGU',
      '21': 'PUE','22': 'PUE','23': 'PUE','24': 'PUE',
      '25': 'COA','26': 'COA','27': 'COA',
      '28': 'COL',
      '29': 'CHP','30': 'CHP',
      '31': 'CAM',
      '32': 'DUR','33': 'DUR','34': 'DUR','35': 'DUR',
      '36': 'GUA','37': 'GUA','38': 'GUA',
      '39': 'GRO','40': 'GRO','41': 'GRO',
      '42': 'HID','43': 'HID',
      '44': 'JAL','45': 'JAL','46': 'JAL','47': 'JAL','48': 'JAL','49': 'JAL',
      '50': 'MEX','51': 'MEX','52': 'MEX','53': 'MEX','54': 'MEX','55': 'MEX','56': 'MEX','57': 'MEX',
      '58': 'MIC','59': 'MIC','60': 'MIC','61': 'MIC',
      '62': 'MOR',
      '63': 'NAY',
      '64': 'NLE','65': 'NLE','66': 'NLE','67': 'NLE',
      '68': 'OAX','69': 'OAX','70': 'OAX','71': 'OAX',
      '72': 'PUE','73': 'PUE','74': 'PUE','75': 'PUE',
      '76': 'QUE',
      '77': 'ROO',
      '78': 'SLP','79': 'SLP',
      '80': 'SIN','81': 'SIN','82': 'SIN',
      '83': 'SON','84': 'SON','85': 'SON',
      '86': 'TAB',
      '87': 'TAM','88': 'TAM','89': 'TAM',
      '90': 'TLA',
      '91': 'VER','92': 'VER','93': 'VER','94': 'VER','95': 'VER','96': 'VER',
      '97': 'YUC',
      '98': 'ZAC','99': 'ZAC',
    };
    const estadoClave = CP_TO_ESTADO[cp.slice(0, 2)] || null;
    let municipios: any[] = [];
    let localidades: any[] = [];
    let estadoDescripcion: string | null = null;
    if (estadoClave) {
      const [mResp, lResp, eResp] = await Promise.all([
        pool.query(`SELECT clave, descripcion FROM sat_cp_municipio WHERE estado=$1 ORDER BY descripcion LIMIT 300`, [estadoClave]),
        pool.query(`SELECT clave, descripcion FROM sat_cp_localidad WHERE estado=$1 ORDER BY descripcion LIMIT 300`, [estadoClave]),
        pool.query(`SELECT description FROM sat_catalogs WHERE catalog_name='c_Estado' AND catalog_key=$1 LIMIT 1`, [estadoClave]),
      ]);
      municipios = mResp.rows;
      localidades = lResp.rows;
      estadoDescripcion = eResp.rows[0]?.description || null;
    }

    res.json({
      codigoPostal: cp,
      colonias: r.rows,
      estado: estadoClave,
      estadoDescripcion,
      municipios,
      localidades,
    });
  }),
);

/**
 * GET /carta-porte/cp-internacional/:pais/:codigo → el estado de un domicilio
 * extranjero, deducido de su código postal.
 *
 * ES EL HERMANO DEL RESOLVEDOR MEXICANO, PERO RESPONDE MENOS
 * El de arriba devuelve colonias, municipio y estado porque el SAT publica ese
 * catálogo. Del extranjero sólo se puede resolver el ESTADO, y así se dice: la
 * ciudad se captura a mano. Devolverla vacía en silencio la haría parecer un
 * campo olvidado.
 *
 * Responde 200 aunque no encuentre nada. Un ZIP militar, un país sin tabla o un
 * código canadiense que empieza con X no son errores de quien captura: son
 * casos en los que el sistema no sabe, y decirlo es la respuesta correcta.
 */
router.get(
  '/cp-internacional/:pais/:codigo',
  asyncHandler(async (req: Request, res: Response) => {
    const pais = String(req.params.pais || '').trim().toUpperCase().slice(0, 3);
    /* Se quitan espacios y guiones: 'K1A 0B1' y 'K1A-0B1' son el mismo código,
     * y cada quien lo teclea como venga en la factura. */
    const codigo = String(req.params.codigo || '').trim().toUpperCase().replace(/[\s-]/g, '');
    if (!pais || !codigo) throw new ValidationError('Falta el país o el código postal');

    if (pais === 'MEX') {
      throw new ValidationError(
        'Para México usa /carta-porte/cp/:codigoPostal, que además resuelve colonias',
      );
    }

    const r = await pool.query(
      `SELECT z.estado, e.descripcion
         FROM sat_cp_zip_estado z
         LEFT JOIN sat_cp_estado e ON e.clave = z.estado AND e.pais = z.pais
        WHERE z.pais = $1
          AND LEFT($2, LENGTH(z.prefijo_desde)) BETWEEN z.prefijo_desde AND z.prefijo_hasta
        LIMIT 1`,
      [pais, codigo],
    );

    const fila = r.rows[0];
    res.json({
      pais,
      codigoPostal: codigo,
      estado: fila?.estado || null,
      estadoDescripcion: fila?.descripcion || null,
      /* La ciudad NUNCA sale de aquí: haría falta la tabla completa de códigos
       * postales, decenas de miles de renglones que además cambian cada mes. */
      ciudad: null,
      mensaje: fila
        ? `${fila.descripcion || fila.estado} — la ciudad se captura a mano`
        : 'No se pudo deducir el estado de ese código postal: elígelo de la lista',
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
