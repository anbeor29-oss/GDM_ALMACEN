/**
 * Diagnóstico de CONTABILIZACIÓN de CFDI — cuadre / organización de los XML.
 *
 * De SOLO LECTURA (no escribe, no crea subcuentas ni pólizas): por periodo cruza
 * los CFDI (emitidos y recibidos tipo I, vigentes) contra el journal por su UUID y
 * clasifica los que AÚN no tienen póliza en cubetas accionables:
 *   · contabilizados — ya tienen póliza.
 *   · listos         — tienen XML y todos sus productos ya tienen cuenta → sólo falta «Generar».
 *   · sinCuenta      — algún producto no tiene su 401 / 115-601 → «Auto-asignar» primero.
 *   · sinXml         — recibido que bajó como METADATO (sin XML): no hay conceptos que contabilizar.
 *   · otros          — sin conceptos u otra rareza.
 * Devuelve también las CLAVES de producto sin cuenta (para saber qué asignar) y un
 * conteo de pólizas descuadradas (defensivo: el trigger de la BD las evita).
 */
import { query } from '../../config/database';
import { mapaProductoCuenta, conceptosDeXml } from './ventas-cuentas.service';
import { mapaProductoCuentaCompra } from './compras-cuentas.service';

const iniDeMes = (a: number, m: number) => (m >= 1 && m <= 12) ? `${a}-${String(m).padStart(2, '0')}-01` : `${a}-01-01`;
const finDeMes = (a: number, m: number) => (m >= 1 && m <= 12) ? new Date(a, m, 0).toISOString().slice(0, 10) : `${a}-12-31`;

const TOPE_CLASIFICA = 3000;   // cuántos pendientes se abren para clasificar por XML

async function diagnosticarDireccion(
  companyId: string, direccion: 'emitidos' | 'recibidos', desde: string, hasta: string,
  mapaProd: Map<string, string>,
) {
  const cont = await query<any>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM journal_entries e WHERE e.company_id=c.company_id AND e.origen_uuid=c.uuid))::int AS contabilizados
       FROM cfdi_recibidos c
      WHERE c.company_id=$1 AND c.direccion=$2 AND c.tipo_comprobante='I'
        AND (c.estado_sat IS NULL OR c.estado_sat <> 'Cancelado')
        AND c.fecha_emision::date BETWEEN $3 AND $4`,
    [companyId, direccion, desde, hasta]);
  const total = cont.rows[0]?.total || 0;
  const contabilizados = cont.rows[0]?.contabilizados || 0;

  const pend = await query<any>(
    `SELECT c.uuid, c.serie, c.folio, c.xml
       FROM cfdi_recibidos c
      WHERE c.company_id=$1 AND c.direccion=$2 AND c.tipo_comprobante='I'
        AND (c.estado_sat IS NULL OR c.estado_sat <> 'Cancelado')
        AND c.fecha_emision::date BETWEEN $3 AND $4
        AND NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.company_id=c.company_id AND e.origen_uuid=c.uuid)
      ORDER BY c.fecha_emision
      LIMIT ${TOPE_CLASIFICA}`,
    [companyId, direccion, desde, hasta]);

  let listos = 0, sinCuenta = 0, sinXml = 0, otros = 0;
  const clavesSinCuenta = new Set<string>();
  const muestra: Array<{ direccion: string; folio: string; uuid: string; cubeta: string; motivo: string }> = [];

  for (const c of pend.rows) {
    let cubeta = '', motivo = '';
    if (!c.xml) {
      sinXml++; cubeta = 'sinXml';
      motivo = direccion === 'recibidos' ? 'sin XML (bajó como metadato)' : 'sin XML';
    } else {
      const conceptos = conceptosDeXml(String(c.xml));
      if (conceptos.length === 0) { otros++; cubeta = 'otros'; motivo = 'la factura no trae conceptos'; }
      else {
        let falta: string | null = null;
        for (const cn of conceptos) { if (!mapaProd.get(cn.clave)) { falta = cn.clave; break; } }
        if (falta) { sinCuenta++; cubeta = 'sinCuenta'; clavesSinCuenta.add(falta); motivo = `producto ${falta} sin cuenta asignada`; }
        else { listos++; cubeta = 'listos'; motivo = 'listo para generar'; }
      }
    }
    if (muestra.length < 60) {
      muestra.push({ direccion, folio: [c.serie, c.folio].filter(Boolean).join('-') || String(c.uuid).slice(0, 8), uuid: c.uuid, cubeta, motivo });
    }
  }

  const pendientesTotal = total - contabilizados;
  return {
    total, contabilizados, listos, sinCuenta, sinXml, otros,
    clavesSinCuenta: Array.from(clavesSinCuenta),
    // Si hubiera MÁS pendientes que el tope, se avisa (no se clasificaron todos).
    noClasificados: Math.max(0, pendientesTotal - pend.rows.length),
    muestra,
  };
}

export async function diagnosticarContabilizacion(companyId: string, anio: number, mes: number) {
  const desde = iniDeMes(anio, mes), hasta = finDeMes(anio, mes);
  const [mapaV, mapaC] = await Promise.all([mapaProductoCuenta(companyId), mapaProductoCuentaCompra(companyId)]);
  const [emitidos, recibidos] = await Promise.all([
    diagnosticarDireccion(companyId, 'emitidos', desde, hasta, mapaV),
    diagnosticarDireccion(companyId, 'recibidos', desde, hasta, mapaC),
  ]);

  // Pólizas descuadradas del periodo (defensivo: el trigger DEFERRABLE las evita).
  const desc = await query<any>(
    `SELECT count(*)::int AS n FROM (
        SELECT l.entry_id
          FROM journal_lines l
          JOIN journal_entries e ON e.id = l.entry_id
         WHERE e.company_id=$1 AND e.fecha BETWEEN $2 AND $3
         GROUP BY l.entry_id
        HAVING ABS(COALESCE(SUM(l.cargo),0) - COALESCE(SUM(l.abono),0)) > 0.02
     ) q`,
    [companyId, desde, hasta]);

  return {
    anio, mes,
    emitidos, recibidos,
    descuadradas: desc.rows[0]?.n || 0,
    muestra: [...emitidos.muestra, ...recibidos.muestra].slice(0, 100),
  };
}
