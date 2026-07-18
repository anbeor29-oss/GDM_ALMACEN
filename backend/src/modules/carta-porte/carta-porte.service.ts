/**
 * carta-porte.service — persistencia del Complemento Carta Porte 3.1.
 *
 *   · Todo lo que muta va en una sola transacción para respetar los invariantes
 *     del complemento (ubicaciones, mercancías, autotransporte, figuras).
 *   · Validaciones de negocio (§7 README_TC) viven en carta-porte.validators.ts.
 *   · La generación del XML y el timbrado son Bloques posteriores (6-8).
 */

import { pool } from '../../config/database';
import type { PoolClient } from 'pg';
import type { CartaPorteInput } from './carta-porte.validators';

async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export async function getByInvoiceId(invoiceId: string) {
  const cp = await pool.query(
    'SELECT * FROM carta_porte WHERE invoice_id = $1',
    [invoiceId],
  );
  if (!cp.rowCount) return null;
  const id = cp.rows[0].id;
  const [ubi, mer, aut, fig] = await Promise.all([
    pool.query('SELECT * FROM cp_ubicaciones WHERE carta_porte_id = $1 ORDER BY id', [id]),
    pool.query('SELECT * FROM cp_mercancias WHERE carta_porte_id = $1 ORDER BY id', [id]),
    pool.query('SELECT * FROM cp_autotransporte WHERE carta_porte_id = $1', [id]),
    pool.query('SELECT * FROM cp_figuras WHERE carta_porte_id = $1 ORDER BY id', [id]),
  ]);
  const autotransporte = aut.rows[0] || null;
  let remolques: any[] = [];
  if (autotransporte) {
    const r = await pool.query(
      'SELECT * FROM cp_remolques WHERE autotransporte_id = $1 ORDER BY id',
      [autotransporte.id],
    );
    remolques = r.rows;
  }
  return {
    ...cp.rows[0],
    ubicaciones: ubi.rows,
    mercancias: mer.rows,
    autotransporte: autotransporte ? { ...autotransporte, remolques } : null,
    figuras: fig.rows,
  };
}

/**
 * upsert — crea la Carta Porte de una factura o la reemplaza si ya existía en
 * DRAFT. La factura debe pertenecer a la empresa del usuario y estar DRAFT.
 */
export async function upsert(
  companyId: string,
  invoiceId: string,
  input: CartaPorteInput,
) {
  return inTx(async (c) => {
    const inv = await c.query(
      'SELECT id, status FROM invoices WHERE id = $1 AND company_id = $2',
      [invoiceId, companyId],
    );
    if (!inv.rowCount) throw new Error('Factura no encontrada');
    if (inv.rows[0].status !== 'DRAFT') {
      throw new Error('Solo se puede modificar Carta Porte en facturas DRAFT');
    }

    // Reemplazo total: si ya había una CP, se borra en cascada y se crea de nuevo.
    await c.query('DELETE FROM carta_porte WHERE invoice_id = $1', [invoiceId]);

    const cp = await c.query(
      `INSERT INTO carta_porte (
         invoice_id, version, transp_internac, entrada_salida_merc,
         pais_origen_destino, via_entrada_salida, total_dist_rec,
         registro_istmo, ubicacion_polo_origen, ubicacion_polo_destino,
         regimen_aduanero
       ) VALUES ($1,'3.1',$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        invoiceId,
        input.transpInternac,
        input.entradaSalidaMerc ?? null,
        input.paisOrigenDestino ?? null,
        input.viaEntradaSalida ?? null,
        input.totalDistRec,
        input.registroIstmo ?? null,
        input.ubicacionPoloOrigen ?? null,
        input.ubicacionPoloDestino ?? null,
        input.regimenAduanero ?? null,
      ],
    );
    const cpId = cp.rows[0].id;

    for (const u of input.ubicaciones) {
      await c.query(
        `INSERT INTO cp_ubicaciones (
           carta_porte_id, tipo_ubicacion, id_ubicacion,
           rfc_remitente_destinatario, nombre_remitente_destinatario,
           num_reg_id_trib, residencia_fiscal,
           num_estacion, nombre_estacion, navegacion_trafico,
           fecha_hora_salida_llegada, tipo_estacion, distancia_recorrida,
           calle, num_exterior, num_interior, colonia, localidad,
           referencia, municipio, estado, pais, codigo_postal
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [
          cpId, u.tipoUbicacion, u.idUbicacion,
          u.rfcRemitenteDestinatario, u.nombreRemitenteDestinatario ?? null,
          u.numRegIdTrib ?? null, u.residenciaFiscal ?? null,
          u.numEstacion ?? null, u.nombreEstacion ?? null, u.navegacionTrafico ?? null,
          u.fechaHoraSalidaLlegada, u.tipoEstacion ?? null, u.distanciaRecorrida ?? null,
          u.calle ?? null, u.numExterior ?? null, u.numInterior ?? null,
          u.colonia ?? null, u.localidad ?? null, u.referencia ?? null,
          u.municipio ?? null, u.estado, u.pais ?? 'MEX', u.codigoPostal,
        ],
      );
    }

    for (const m of input.mercancias) {
      await c.query(
        `INSERT INTO cp_mercancias (
           carta_porte_id, bienes_transp, descripcion, cantidad, clave_unidad,
           unidad, dimensiones, material_peligroso, cve_material_peligroso,
           embalaje, descrip_embalaje, peso_en_kg, valor_mercancia, moneda,
           fraccion_arancelaria, uuid_comercio_ext, tipo_materia, descripcion_materia
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          cpId, m.bienesTransp, m.descripcion, m.cantidad, m.claveUnidad,
          m.unidad ?? null, m.dimensiones ?? null,
          m.materialPeligroso ?? null, m.cveMaterialPeligroso ?? null,
          m.embalaje ?? null, m.descripEmbalaje ?? null,
          m.pesoEnKg, m.valorMercancia ?? null, m.moneda ?? null,
          m.fraccionArancelaria ?? null, m.uuidComercioExt ?? null,
          m.tipoMateria ?? null, m.descripcionMateria ?? null,
        ],
      );
    }

    if (input.autotransporte) {
      const a = input.autotransporte;
      const at = await c.query(
        `INSERT INTO cp_autotransporte (
           carta_porte_id, perm_sct, num_permiso_sct, config_vehicular,
           peso_bruto_vehicular, placa_vm, anio_modelo_vm,
           asegura_resp_civil, poliza_resp_civil,
           asegura_med_ambiente, poliza_med_ambiente,
           asegura_carga, poliza_carga, prima_seguro
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [
          cpId, a.permSct, a.numPermisoSct, a.configVehicular,
          a.pesoBrutoVehicular, a.placaVm, a.anioModeloVm,
          a.aseguraRespCivil, a.polizaRespCivil,
          a.aseguraMedAmbiente ?? null, a.polizaMedAmbiente ?? null,
          a.aseguraCarga ?? null, a.polizaCarga ?? null, a.primaSeguro ?? null,
        ],
      );
      const atId = at.rows[0].id;
      for (const r of a.remolques ?? []) {
        await c.query(
          'INSERT INTO cp_remolques (autotransporte_id, sub_tipo_rem, placa) VALUES ($1,$2,$3)',
          [atId, r.subTipoRem, r.placa],
        );
      }
    }

    for (const f of input.figuras) {
      await c.query(
        `INSERT INTO cp_figuras (
           carta_porte_id, tipo_figura, rfc_figura, num_licencia,
           nombre_figura, num_reg_id_trib, residencia_fiscal_fig,
           parte_transporte, calle, num_exterior, colonia, municipio,
           estado, pais, codigo_postal
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          cpId, f.tipoFigura, f.rfcFigura, f.numLicencia ?? null,
          f.nombreFigura ?? null, f.numRegIdTrib ?? null,
          f.residenciaFiscalFig ?? null, f.parteTransporte ?? null,
          f.calle ?? null, f.numExterior ?? null, f.colonia ?? null,
          f.municipio ?? null, f.estado ?? null, f.pais ?? null,
          f.codigoPostal ?? null,
        ],
      );
    }

    return { id: cpId };
  });
}

export async function remove(companyId: string, invoiceId: string) {
  const r = await pool.query(
    `DELETE FROM carta_porte cp USING invoices i
     WHERE cp.invoice_id = i.id AND i.company_id = $1 AND cp.invoice_id = $2 AND i.status='DRAFT'`,
    [companyId, invoiceId],
  );
  return { removed: r.rowCount ?? 0 };
}
