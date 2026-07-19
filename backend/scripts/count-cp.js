const { Client } = require('pg');
const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
c.connect()
  .then(() => c.query(
    "SELECT 'clave_prod_serv' t, COUNT(*)::int n FROM sat_cp_clave_prod_serv " +
    "UNION ALL SELECT 'material_peligroso',   COUNT(*)::int FROM sat_cp_material_peligroso " +
    "UNION ALL SELECT 'config_autotransporte',COUNT(*)::int FROM sat_cp_config_autotransporte " +
    "UNION ALL SELECT 'colonia',              COUNT(*)::int FROM sat_cp_colonia " +
    "UNION ALL SELECT 'municipio',            COUNT(*)::int FROM sat_cp_municipio " +
    "UNION ALL SELECT 'figura_transporte',    COUNT(*)::int FROM sat_cp_figura_transporte " +
    "UNION ALL SELECT 'tipo_permiso',         COUNT(*)::int FROM sat_cp_tipo_permiso " +
    "UNION ALL SELECT 'clave_unidad_peso',    COUNT(*)::int FROM sat_cp_clave_unidad_peso " +
    "UNION ALL SELECT 'sub_tipo_rem',         COUNT(*)::int FROM sat_cp_sub_tipo_rem " +
    "ORDER BY 1"
  ))
  .then(r => { console.table(r.rows); return c.end(); })
  .catch(e => { console.error(e.message); process.exit(1); });
