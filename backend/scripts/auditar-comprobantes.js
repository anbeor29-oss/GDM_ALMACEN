#!/usr/bin/env node
/**
 * auditar-comprobantes.js — compara lo que dice el sistema contra lo que dice
 * el SAT, comprobante por comprobante.
 *
 * POR QUÉ EXISTE
 * Durante las pruebas quedaron registros que el sistema muestra como timbrados o
 * cancelados y que ante el SAT son otra cosa: folios fiscales que nunca
 * existieron, comprobantes cancelados sólo en la base, cancelaciones en curso que
 * nadie sabía que estaban corriendo. Cada uno de ellos confunde el diagnóstico
 * —una nota de crédito "cancelada" que en realidad seguía viva bloqueó una
 * factura durante horas— y ensucia la contabilidad.
 *
 * Este script los encuentra. NO BORRA NADA: sólo lista y explica. La decisión de
 * qué hacer con cada uno es fiscal, no técnica, y depende de si el comprobante
 * existe ante el SAT — que es justo lo que aquí se averigua.
 *
 * Uso:
 *   node scripts/auditar-comprobantes.js                    (todas las empresas)
 *   node scripts/auditar-comprobantes.js GHC1707275Y0       (una empresa)
 *   node scripts/auditar-comprobantes.js GHC1707275Y0 --solo-problemas
 *
 * CUIDADO CON EL RITMO
 * El servicio de consulta del SAT es lento y no le gusta que lo golpeen. Se
 * consulta de uno en uno con una pausa entre peticiones: revisar cien
 * comprobantes toma un par de minutos, y está bien que así sea.
 */
const path = require('path');
const { Pool } = require('pg');

const RFC = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const SOLO_PROBLEMAS = process.argv.includes('--solo-problemas');
const PAUSA_MS = 700;

const { consultarEstatusSat } = require(
  path.join(__dirname, '..', 'dist', 'modules', 'pac', 'sat-status.service')
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Los tres tipos de comprobante, con sus tablas y sus nombres de columna. */
const FUENTES = [
  {
    tipo: 'Factura',
    sql: `SELECT i.id, i.serie, i.folio, i.cfdi_uuid, i.total, i.xml_content,
                 i.status AS estado_local, c.rfc AS rfc_emisor, cu.rfc AS rfc_receptor
            FROM invoices i
            JOIN companies c ON c.id = i.company_id
            LEFT JOIN customers cu ON cu.id = i.customer_id
           WHERE i.deleted_at IS NULL AND i.cfdi_uuid IS NOT NULL`,
    cancelado: (e) => e === 'CANCELLED',
  },
  {
    tipo: 'Complemento de pago',
    sql: `SELECT p.id, p.serie, p.folio, p.uuid AS cfdi_uuid, 0 AS total, p.xml_content,
                 p.document_status AS estado_local, c.rfc AS rfc_emisor, cu.rfc AS rfc_receptor
            FROM payments p
            JOIN companies c ON c.id = p.company_id
            LEFT JOIN customers cu ON cu.id = p.customer_id
           WHERE p.deleted_at IS NULL AND p.uuid IS NOT NULL`,
    cancelado: (e) => e === 'CANCELLED',
  },
  {
    tipo: 'Nota de crédito',
    sql: `SELECT n.id, n.serie, n.folio, n.uuid AS cfdi_uuid, n.total, n.xml_content,
                 n.status AS estado_local, c.rfc AS rfc_emisor, cu.rfc AS rfc_receptor
            FROM credit_notes n
            JOIN companies c ON c.id = n.company_id
            LEFT JOIN customers cu ON cu.id = n.customer_id
           WHERE n.deleted_at IS NULL AND n.uuid IS NOT NULL`,
    cancelado: (e) => e === 'CANCELLED',
  },
];

/**
 * Decide si lo que dice el sistema y lo que dice el SAT son compatibles.
 *
 * Un comprobante de PAGO se consulta con total 0.00, que es lo que lleva un
 * CFDI tipo P. Si se mandara el monto del pago, el SAT respondería "no
 * encontrado" y se reportaría como fantasma uno que sí existe.
 */
function comparar(tipo, estadoLocal, sat, cancelado) {
  if (!sat.encontrado) {
    if (sat.error) {
      return { nivel: 'duda', mensaje: `no se pudo consultar (${sat.error})` };
    }
    return {
      nivel: 'fantasma',
      mensaje:
        'el SAT NO CONOCE este folio fiscal. Se registró como timbrado sin que el ' +
        'comprobante llegara al SAT — típico de las pruebas en modo simulación.',
    };
  }
  const satCancelado = sat.estado === 'Cancelado';
  if (cancelado && !satCancelado) {
    const enProceso = sat.estatusCancelacion === 'En proceso';
    return {
      nivel: enProceso ? 'duda' : 'desfasado',
      mensaje: enProceso
        ? 'aquí figura CANCELADO y el SAT tiene la cancelación EN PROCESO. Sólo hay que esperar.'
        : 'aquí figura CANCELADO pero ante el SAT sigue VIGENTE. Mientras siga así, ' +
          'bloquea la cancelación de los comprobantes que lo relacionan.',
    };
  }
  if (!cancelado && satCancelado) {
    return {
      nivel: 'desfasado',
      mensaje: 'el SAT lo tiene CANCELADO y aquí sigue activo. Los saldos del cliente están mal.',
    };
  }
  return { nivel: 'ok', mensaje: sat.resumen };
}

const ICONO = { ok: '  ok  ', fantasma: 'FANTASMA', desfasado: 'DESFASADO', duda: ' duda ' };

(async () => {
  const cli = await pool.connect();
  const resumen = { ok: 0, fantasma: 0, desfasado: 0, duda: 0 };
  const paraRevisar = [];

  try {
    for (const f of FUENTES) {
      let sql = f.sql;
      const params = [];
      if (RFC) { params.push(RFC.toUpperCase()); sql += ` AND c.rfc = $${params.length}`; }
      sql += ' ORDER BY 2, 3';

      const r = await cli.query(sql, params);
      if (!r.rows.length) continue;

      console.log(`\n═══ ${f.tipo} — ${r.rows.length} con folio fiscal`);

      for (const fila of r.rows) {
        const sello = /Sello="([^"]+)"/.exec(String(fila.xml_content || ''))?.[1] || '';
        const sat = await consultarEstatusSat({
          rfcEmisor: fila.rfc_emisor,
          rfcReceptor: fila.rfc_receptor,
          total: Number(fila.total || 0),
          uuid: fila.cfdi_uuid,
          sello,
        });
        const v = comparar(f.tipo, fila.estado_local, sat, f.cancelado(fila.estado_local));
        resumen[v.nivel]++;

        if (v.nivel !== 'ok' || !SOLO_PROBLEMAS) {
          const etiqueta = `${fila.serie || ''}-${String(fila.folio).padStart(6, '0')}`;
          console.log(`  [${ICONO[v.nivel]}] ${etiqueta}  ${fila.cfdi_uuid}`);
          console.log(`             ${v.mensaje}`);
        }
        if (v.nivel !== 'ok') {
          paraRevisar.push({ tipo: f.tipo, id: fila.id, uuid: fila.cfdi_uuid, nivel: v.nivel });
        }
        await dormir(PAUSA_MS);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  Coinciden con el SAT : ${resumen.ok}`);
    console.log(`  FANTASMA             : ${resumen.fantasma}  (el SAT no los conoce)`);
    console.log(`  DESFASADO            : ${resumen.desfasado}  (estado distinto al del SAT)`);
    console.log(`  Sin certeza          : ${resumen.duda}  (consulta fallida o en proceso)`);
    console.log('═══════════════════════════════════════════════════════════');

    if (paraRevisar.length) {
      console.log('\nQUÉ HACER CON CADA UNO — decisión tuya, no del script:');
      console.log('');
      console.log('  FANTASMA   El comprobante no existe ante el SAT. Borrarlo de la base');
      console.log('             es defendible: no ampara ningún hecho fiscal y su presencia');
      console.log('             falsea saldos. Antes de borrar, saca respaldo.');
      console.log('');
      console.log('  DESFASADO  NO borrar. Hay que alinear el estado: si el SAT lo tiene');
      console.log('             vigente, cancelarlo de verdad; si lo tiene cancelado,');
      console.log('             reflejarlo aquí. Borrarlo perdería un comprobante real.');
      console.log('');
      console.log('  Sin certeza  Volver a correr esto más tarde. El servicio del SAT se cae,');
      console.log('             y una cancelación en proceso se resuelve sola.');
      console.log('');
      console.log('Identificadores, por si hay que actuar sobre ellos:');
      for (const p of paraRevisar) {
        console.log(`  ${p.nivel.padEnd(10)} ${p.tipo.padEnd(22)} id=${p.id}  uuid=${p.uuid}`);
      }
    }
  } catch (e) {
    console.error(`\nFalló la auditoría: ${e.message}`);
    process.exitCode = 1;
  } finally {
    cli.release();
    await pool.end();
  }
})();
