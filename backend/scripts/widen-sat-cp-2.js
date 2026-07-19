const { Client } = require('pg');
(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const r = await c.query(
    "SELECT table_name, column_name FROM information_schema.columns " +
    "WHERE table_name LIKE 'sat_cp_%' AND data_type='character varying' " +
    "AND character_maximum_length < 500 AND column_name <> 'clave'"
  );
  let n = 0;
  for (const x of r.rows) {
    const isDesc = /descripcion|nombre|nota|aerolinea|tecnico|peligro|referencia/.test(x.column_name);
    const target = isDesc ? 'TEXT' : 'VARCHAR(500)';
    await c.query('ALTER TABLE ' + x.table_name + ' ALTER COLUMN ' + x.column_name + ' TYPE ' + target);
    console.log('  ' + x.table_name + '.' + x.column_name + ' -> ' + target);
    n++;
  }
  console.log('widened', n, 'more columns');
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
