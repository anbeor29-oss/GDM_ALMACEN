#!/usr/bin/env node
/**
 * verificar-series-banxico.js — comprueba que cada moneda apunta a la serie
 * correcta ANTES de confiar en la actualización automática.
 *
 * Por qué existe
 * -------------
 * Una serie equivocada no falla: devuelve un número perfectamente válido que
 * es el tipo de cambio de otra cosa. La factura se timbra, el SAT la acepta,
 * y el error aparece meses después en una auditoría.
 *
 * Este script pregunta a Banxico el TÍTULO de cada serie configurada y lo
 * imprime junto al último valor, para que se pueda leer con los ojos y
 * confirmar que dice lo que debe decir.
 *
 * Uso:
 *   BANXICO_TOKEN=xxx DATABASE_URL=postgres://... node scripts/verificar-series-banxico.js
 *
 * Si una serie no corresponde, se corrige sin tocar código:
 *   UPDATE exchange_rate_sources SET serie='LA_CORRECTA' WHERE moneda='EUR';
 */
const { Client } = require('pg');

const BASE = 'https://www.banxico.org.mx/SieAPIRest/service/v1/series';

/** Lo que cada serie DEBE decir en su título para ser la correcta. */
const ESPERADO = {
  USD: ['dólar', 'dolar', 'e.u.a', 'eua'],
  EUR: ['euro'],
  GBP: ['libra', 'esterlina'],
};

async function pedir(url, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch(url, {
      headers: { 'Bmx-Token': token, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 401 ? ' — token inválido o vencido' : ''}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// El rango va escapado a propósito: escrito con marcas combinantes literales,
// cualquier editor que reguarde el archivo en otra codificación lo rompe en
// silencio y la comparación deja de quitar acentos.
const sinAcentos = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(new RegExp('[\u0300-\u036f]','g'), '');

async function main() {
  const token = process.env.BANXICO_TOKEN;
  if (!token) {
    console.error('Falta BANXICO_TOKEN.');
    console.error('Se obtiene gratis en: https://www.banxico.org.mx/SieAPIRest/service/v1/token');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('Falta DATABASE_URL'); process.exit(1); }

  const db = new Client({
    connectionString: url,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await db.connect();

  const { rows } = await db.query(
    `SELECT moneda, proveedor, serie, nota FROM exchange_rate_sources
      WHERE activo AND proveedor = 'BANXICO' ORDER BY moneda`,
  );
  await db.end();

  if (!rows.length) {
    console.log('No hay monedas configuradas con Banxico.');
    return;
  }

  console.log('\nVerificando las series configuradas contra Banxico\n');
  let sospechosas = 0;

  for (const r of rows) {
    console.log('─'.repeat(72));
    console.log(`${r.moneda}  →  serie ${r.serie}`);
    try {
      // Metadatos: nos da el título oficial de la serie.
      const meta = await pedir(`${BASE}/${encodeURIComponent(r.serie)}`, token);
      const s = meta?.bmx?.series?.[0];
      const titulo = s?.titulo || '(sin título)';
      console.log(`  título   : ${titulo}`);

      // Último valor, para ver que además trae datos.
      const dato = await pedir(`${BASE}/${encodeURIComponent(r.serie)}/datos/oportuno`, token);
      const d = dato?.bmx?.series?.[0]?.datos?.[0];
      console.log(`  último   : ${d ? `${d.dato} (${d.fecha})` : 'sin dato oportuno'}`);

      const t = sinAcentos(titulo);
      const pistas = ESPERADO[r.moneda] || [];
      const coincide = pistas.some((p) => t.includes(sinAcentos(p)));
      if (coincide) {
        console.log(`  veredicto: ✓ el título corresponde a ${r.moneda}`);
      } else {
        sospechosas++;
        console.log(`  veredicto: ✗ REVISAR — el título no menciona ${pistas.join(' ni ')}`);
        console.log(`             Esta serie puede no ser la de ${r.moneda}.`);
      }
    } catch (e) {
      sospechosas++;
      console.log(`  ERROR    : ${e.message}`);
    }
  }

  console.log('─'.repeat(72));
  if (sospechosas) {
    console.log(`\n${sospechosas} serie(s) por revisar. Para corregir:`);
    console.log(`  UPDATE exchange_rate_sources SET serie='LA_CORRECTA' WHERE moneda='XXX';`);
    console.log(`Mientras tanto, esas monedas se capturan a mano y la facturación sigue.\n`);
    process.exit(2);
  }
  console.log('\nTodas las series corresponden. La actualización automática es confiable.\n');
}

main().catch((e) => { console.error('falló:', e.message); process.exit(1); });
