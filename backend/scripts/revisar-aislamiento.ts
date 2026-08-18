/**
 * revisar-aislamiento — que ninguna empresa vea lo de otra, y por qué a una no
 * le carga algo.
 *
 * Se corre contra la base que sea, incluida la de producción. NO ESCRIBE NADA:
 * sólo cuenta y compara. Sirve para dos preguntas distintas que se confunden:
 *
 *   1. "¿se están mezclando los RFC?"  → la parte de CRUCES
 *   2. "¿por qué a esta empresa no le carga nada?" → la parte de RADIOGRAFÍA
 *
 * La segunda casi siempre resuelve la primera: lo que parece una mezcla suele
 * ser una empresa sin datos, o un usuario apuntando a la empresa equivocada.
 *
 *   npx ts-node -r dotenv/config scripts/revisar-aislamiento.ts
 *   npx ts-node -r dotenv/config scripts/revisar-aislamiento.ts WERX631016S30
 */
import { pool, query } from '../src/config/database';

const rfcBuscado = (process.argv[2] || '').trim().toUpperCase();

let problemas = 0;
const bien = (q: string) => console.log(`  OK  ${q}`);
const mal  = (q: string, d?: any) => { problemas++; console.log(`  ⚠  ${q}${d ? ` — ${d}` : ''}`); };

/** ¿Existe la tabla? Las bases de los dos productos no traen las mismas. */
async function existe(tabla: string): Promise<boolean> {
  const r = await query<any>(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1`, [tabla]
  );
  return r.rows.length > 0;
}

async function main() {
  console.log('\n═══ EMPRESAS Y LO QUE TIENE CADA UNA ═══\n');

  const cias = await query<any>(
    `SELECT id, rfc, business_name, deleted_at IS NOT NULL AS borrada
       FROM companies ORDER BY created_at`
  );

  const tablas = [
    ['invoices', 'facturas'], ['payments', 'compl. pago'], ['credit_notes', 'notas cr.'],
    ['customers', 'clientes'], ['products', 'productos'], ['users', 'usuarios'],
    ['nomina_empleados', 'trabajadores'],
  ];
  const vivas: Array<[string, string]> = [];
  for (const [t, etiqueta] of tablas) if (await existe(t)) vivas.push([t, etiqueta]);

  const cab = 'RFC'.padEnd(15) + vivas.map(([, e]) => e.padStart(13)).join('');
  console.log('  ' + cab);
  console.log('  ' + '─'.repeat(cab.length));

  for (const c of cias.rows) {
    const celdas: string[] = [];
    for (const [t] of vivas) {
      const r = await query<any>(`SELECT COUNT(*)::int n FROM ${t} WHERE company_id = $1`, [c.id]);
      celdas.push(String(r.rows[0].n).padStart(13));
    }
    console.log(`  ${(c.rfc + (c.borrada ? ' (borrada)' : '')).padEnd(15)}${celdas.join('')}`);
  }

  /* ── CRUCES ──
   * Una fila hija que apunta a un padre de OTRA empresa. Es la forma en que se
   * mezclarían dos RFC de verdad: no por el listado —que filtra— sino porque el
   * dato quedó mal ligado desde que se creó. */
  console.log('\n═══ CRUCES ENTRE EMPRESAS ═══\n');

  const cruces: Array<[string, string]> = [];

  if (await existe('payment_invoices')) {
    cruces.push(['un complemento de pago ligado a la factura de otra empresa', `
      SELECT COUNT(*)::int n FROM payments p
        JOIN payment_invoices pi ON pi.payment_id = p.id
        JOIN invoices i ON i.id = pi.invoice_id
       WHERE p.company_id <> i.company_id`]);
  }
  cruces.push(['un complemento apuntando a una factura de otra empresa (columna directa)', `
      SELECT COUNT(*)::int n FROM payments p
        JOIN invoices i ON i.id = p.invoice_id
       WHERE p.company_id <> i.company_id`]);
  cruces.push(['un complemento con cliente de otra empresa', `
      SELECT COUNT(*)::int n FROM payments p
        JOIN customers c ON c.id = p.customer_id
       WHERE p.company_id <> c.company_id`]);
  cruces.push(['una factura con cliente de otra empresa', `
      SELECT COUNT(*)::int n FROM invoices i
        JOIN customers c ON c.id = i.customer_id
       WHERE i.company_id <> c.company_id`]);
  if (await existe('credit_notes')) {
    cruces.push(['una nota de crédito sobre factura de otra empresa', `
      SELECT COUNT(*)::int n FROM credit_notes cn
        JOIN invoices i ON i.id = cn.invoice_id
       WHERE cn.company_id <> i.company_id`]);
  }

  for (const [que, sql] of cruces) {
    try {
      const r = await query<any>(sql);
      r.rows[0].n === 0 ? bien(`sin ${que}`) : mal(`HAY ${que}`, `${r.rows[0].n} fila(s)`);
    } catch (e: any) {
      console.log(`  ··  no se pudo revisar "${que}": ${e.message.split('\n')[0]}`);
    }
  }

  /* Filas sin dueño: no cruzan RFC, pero no las ve NADIE. Es la otra cara de
   * "no se carga". */
  console.log('\n═══ FILAS SIN EMPRESA ═══\n');
  for (const [t] of vivas) {
    /* El SUPER_ADMIN es operador de la plataforma, no de una empresa: que no
     * tenga company_id es su diseño, no un huérfano. Contarlo como problema
     * llenaba el reporte de falsas alarmas y le quitaba valor a las de verdad. */
    const salvedad = t === 'users' ? ` AND role <> 'SUPER_ADMIN'` : '';
    const r = await query<any>(
      `SELECT COUNT(*)::int n FROM ${t} WHERE company_id IS NULL${salvedad}`
    );
    r.rows[0].n === 0
      ? bien(`${t}: todas tienen empresa${salvedad ? ' (sin contar al SUPER_ADMIN)' : ''}`)
      : mal(`${t}: ${r.rows[0].n} fila(s) sin company_id — no las ve ninguna empresa`);
  }

  /* ── RADIOGRAFÍA DE UN RFC ── */
  if (rfcBuscado) {
    console.log(`\n═══ RADIOGRAFÍA DE ${rfcBuscado} ═══\n`);
    const c = cias.rows.find((x: any) => String(x.rfc).toUpperCase() === rfcBuscado);
    if (!c) {
      mal(`ese RFC no existe en esta base`);
      console.log(`      Los que hay: ${cias.rows.map((x: any) => x.rfc).join(', ')}`);
    } else {
      console.log(`  id: ${c.id}`);
      console.log(`  razón social: ${c.business_name}${c.borrada ? '  ⚠ MARCADA COMO BORRADA' : ''}`);

      const pag = await query<any>(
        `SELECT COUNT(*)::int total,
                COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int borrados,
                COUNT(*) FILTER (WHERE document_status = 'CANCELLED')::int cancelados
           FROM payments WHERE company_id = $1`, [c.id]
      );
      const p = pag.rows[0];
      console.log(`\n  complementos de pago: ${p.total} en total`);
      console.log(`      · ${p.borrados} con deleted_at (la pantalla NO los muestra)`);
      console.log(`      · ${p.cancelados} cancelados (sí se muestran, tachados)`);
      const visibles = p.total - p.borrados;
      visibles === 0
        ? mal('la pantalla de Complementos de Pago sale VACÍA porque no hay ninguno visible')
        : bien(`${visibles} deberían verse en la pantalla`);

      const fac = await query<any>(
        `SELECT COUNT(*)::int n,
                COUNT(*) FILTER (WHERE status IN ('STAMPED','PARTIAL_PAYMENT'))::int cobrables
           FROM invoices WHERE company_id = $1 AND deleted_at IS NULL`, [c.id]
      );
      console.log(`\n  facturas: ${fac.rows[0].n} (${fac.rows[0].cobrables} timbradas o con pago parcial)`);
      if (fac.rows[0].cobrables === 0 && visibles === 0) {
        console.log('      Sin facturas timbradas no hay nada que pagar: la pantalla vacía es correcta.');
      }

      if (await existe('users')) {
        const u = await query<any>(
          `SELECT email, role, work_group FROM users
            WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at`, [c.id]
        );
        console.log(`\n  usuarios de esta empresa: ${u.rows.length}`);
        for (const x of u.rows) {
          console.log(`      ${String(x.email).padEnd(30)} ${String(x.role).padEnd(13)} grupo ${x.work_group || '—'}`);
        }
        /* El grupo de trabajo decide qué menús ve. Si nadie tiene un grupo con
         * facturación, la pantalla ni siquiera aparece — y eso se confunde con
         * "no carga". */
        const conFacturacion = u.rows.filter(
          (x: any) => ['ADMIN_ALL', 'VENTAS', 'ADMINISTRACION'].includes(String(x.work_group))
        );
        conFacturacion.length === 0 && u.rows.length > 0
          ? mal('ningún usuario tiene grupo con acceso a facturación: el menú no les aparece')
          : bien('hay usuarios con grupo que ve facturación');
      }
    }
  } else {
    console.log('\n  (para la radiografía de un RFC: agrégalo al final del comando)');
  }

  console.log(
    problemas === 0
      ? '\n✔ Sin cruces entre empresas.\n'
      : `\n${problemas} cosa(s) que revisar.\n`
  );
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
