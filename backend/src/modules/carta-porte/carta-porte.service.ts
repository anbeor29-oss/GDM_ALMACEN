/**
 * carta-porte.service — persistencia del Complemento Carta Porte 3.1.
 *
 *   · Todo lo que muta va en una sola transacción para respetar los invariantes
 *     del complemento (ubicaciones, mercancías, autotransporte, figuras).
 *   · Validaciones de negocio (§7 README_TC) viven en carta-porte.validators.ts.
 *   · La generación del XML y el timbrado son Bloques posteriores (6-8).
 */

import { pool } from '../../config/database';
import { tomarEdicion } from '../../utils/edicion';
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
  const [ubi, mer, aut, fig, reg, fer, mar, aer] = await Promise.all([
    pool.query('SELECT * FROM cp_ubicaciones WHERE carta_porte_id = $1 ORDER BY id', [id]),
    pool.query('SELECT * FROM cp_mercancias WHERE carta_porte_id = $1 ORDER BY id', [id]),
    pool.query('SELECT * FROM cp_autotransporte WHERE carta_porte_id = $1', [id]),
    pool.query('SELECT * FROM cp_figuras WHERE carta_porte_id = $1 ORDER BY id', [id]),
    pool.query('SELECT regimen_aduanero FROM cp_regimenes_aduaneros WHERE carta_porte_id = $1 ORDER BY orden, id', [id]),
    pool.query('SELECT * FROM cp_ferroviario WHERE carta_porte_id = $1', [id]),
    pool.query('SELECT * FROM cp_maritimo WHERE carta_porte_id = $1', [id]),
    pool.query('SELECT * FROM cp_aereo WHERE carta_porte_id = $1', [id]),
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

  // Documentación aduanera: cuelga de cada mercancía (§6.3), así que se trae
  // en una sola consulta y se reparte, en vez de una por mercancía.
  const mercancias = mer.rows;
  if (mercancias.length) {
    const docs = await pool.query(
      'SELECT * FROM cp_mercancia_doc_aduanera WHERE mercancia_id = ANY($1::int[]) ORDER BY id',
      [mercancias.map((m) => m.id)],
    );
    const porMercancia = new Map<number, any[]>();
    for (const d of docs.rows) {
      const lista = porMercancia.get(d.mercancia_id) ?? [];
      lista.push(d);
      porMercancia.set(d.mercancia_id, lista);
    }
    for (const m of mercancias) m.docs_aduaneros = porMercancia.get(m.id) ?? [];
  }

  // Ferroviario: derechos de paso y carros, con los contenedores de cada carro.
  let ferroviario: any = fer.rows[0] || null;
  if (ferroviario) {
    const [dp, carros] = await Promise.all([
      pool.query('SELECT * FROM cp_ferroviario_derechos_paso WHERE ferroviario_id = $1 ORDER BY id', [ferroviario.id]),
      pool.query('SELECT * FROM cp_ferroviario_carros WHERE ferroviario_id = $1 ORDER BY orden, id', [ferroviario.id]),
    ]);
    let contenedores: any[] = [];
    if (carros.rows.length) {
      const c = await pool.query(
        'SELECT * FROM cp_ferroviario_contenedores WHERE carro_id = ANY($1::int[]) ORDER BY id',
        [carros.rows.map((r) => r.id)],
      );
      contenedores = c.rows;
    }
    ferroviario = {
      ...ferroviario,
      derechos_de_paso: dp.rows,
      carros: carros.rows.map((r) => ({
        ...r,
        contenedores: contenedores.filter((k) => k.carro_id === r.id),
      })),
    };
  }

  let maritimo: any = mar.rows[0] || null;
  if (maritimo) {
    const c = await pool.query(
      'SELECT * FROM cp_maritimo_contenedores WHERE maritimo_id = $1 ORDER BY id',
      [maritimo.id],
    );
    maritimo = { ...maritimo, contenedores: c.rows };
  }

  return {
    ...cp.rows[0],
    regimenes_aduaneros: reg.rows.map((r) => r.regimen_aduanero),
    ubicaciones: ubi.rows,
    mercancias,
    autotransporte: autotransporte ? { ...autotransporte, remolques } : null,
    ferroviario,
    maritimo,
    aereo: aer.rows[0] || null,
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
  /* Número de edición que traía el formulario. Ver más abajo por qué se lleva
   * sobre la FACTURA y no sobre la Carta Porte. */
  edicionEsperada?: number | string | null,
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

    /* El contador vive en la FACTURA, no en carta_porte.
     *
     * Guardar aquí es un reemplazo total: se borra la Carta Porte anterior y se
     * inserta una nueva, así que el renglón cambia de id en cada guardado y no
     * hay nada estable a lo que colgarle un contador. La factura sí es estable,
     * y además es el documento del que la Carta Porte forma parte: si dos
     * personas capturan el traslado de la misma factura, están editando el
     * mismo documento aunque los datos vivan en otras tablas. */
    await tomarEdicion(c, 'invoices', invoiceId, edicionEsperada);

    // Reemplazo total: si ya había una CP, se borra en cascada y se crea de nuevo.
    await c.query('DELETE FROM carta_porte WHERE invoice_id = $1', [invoiceId]);

    const cp = await c.query(
      `INSERT INTO carta_porte (
         invoice_id, version, transp_internac, entrada_salida_merc,
         pais_origen_destino, via_entrada_salida, total_dist_rec,
         registro_istmo, ubicacion_polo_origen, ubicacion_polo_destino,
         regimen_aduanero, medio_transporte, pais_transportista, cruce_fronterizo
       ) VALUES ($1,'3.1',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
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
        input.medioTransporte,
        input.paisTransportista ?? null,
        input.cruceFronterizo ?? null,
      ],
    );
    const cpId = cp.rows[0].id;

    for (const [i, r] of (input.regimenesAduaneros ?? []).entries()) {
      await c.query(
        `INSERT INTO cp_regimenes_aduaneros (carta_porte_id, regimen_aduanero, orden)
         VALUES ($1,$2,$3) ON CONFLICT (carta_porte_id, regimen_aduanero) DO NOTHING`,
        [cpId, r, i],
      );
    }

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
      const merc = await c.query(
        `INSERT INTO cp_mercancias (
           carta_porte_id, bienes_transp, descripcion, cantidad, clave_unidad,
           unidad, dimensiones, material_peligroso, cve_material_peligroso,
           embalaje, descrip_embalaje, peso_en_kg, valor_mercancia, moneda,
           fraccion_arancelaria, uuid_comercio_ext, tipo_materia, descripcion_materia
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING id`,
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
      for (const d of m.docsAduaneros ?? []) {
        await c.query(
          `INSERT INTO cp_mercancia_doc_aduanera (
             mercancia_id, tipo_documento, num_pedimento, ident_doc_aduanero, rfc_impo
           ) VALUES ($1,$2,$3,$4,$5)`,
          [
            merc.rows[0].id, d.tipoDocumento,
            d.numPedimento ?? null, d.identDocAduanero ?? null, d.rfcImpo ?? null,
          ],
        );
      }
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

    if (input.ferroviario) {
      const f = input.ferroviario;
      const fer = await c.query(
        `INSERT INTO cp_ferroviario (
           carta_porte_id, tipo_de_servicio, tipo_de_trafico, nombre_aseg, num_poliza_seguro
         ) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [cpId, f.tipoDeServicio, f.tipoDeTrafico, f.nombreAseg ?? null, f.numPolizaSeguro ?? null],
      );
      const ferId = fer.rows[0].id;

      for (const d of f.derechosDePaso ?? []) {
        await c.query(
          `INSERT INTO cp_ferroviario_derechos_paso (ferroviario_id, tipo_derecho_de_paso, kilometraje_pagado)
           VALUES ($1,$2,$3)`,
          [ferId, d.tipoDerechoDePaso, d.kilometrajePagado],
        );
      }

      for (const [i, carro] of (f.carros ?? []).entries()) {
        const car = await c.query(
          `INSERT INTO cp_ferroviario_carros (
             ferroviario_id, tipo_carro, matricula_carro, guia_carro, toneladas_netas_carro, orden
           ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [ferId, carro.tipoCarro, carro.matriculaCarro, carro.guiaCarro, carro.toneladasNetasCarro, i],
        );
        for (const k of carro.contenedores ?? []) {
          await c.query(
            `INSERT INTO cp_ferroviario_contenedores (
               carro_id, tipo_contenedor, peso_contenedor_vacio, peso_neto_mercancia
             ) VALUES ($1,$2,$3,$4)`,
            [car.rows[0].id, k.tipoContenedor, k.pesoContenedorVacio, k.pesoNetoMercancia],
          );
        }
      }
    }

    if (input.maritimo) {
      const m = input.maritimo;
      const mar = await c.query(
        `INSERT INTO cp_maritimo (
           carta_porte_id, perm_sct, num_permiso_sct, nombre_aseg, num_poliza_seguro,
           tipo_embarcacion, matricula, numero_omi, anio_embarcacion, nombre_embarc,
           nacionalidad_embarc, unidades_arq_bruto, tipo_carga, num_cert_itc,
           eslora, manga, calado, linea_naviera, nombre_agente_naviero,
           num_autorizacion_naviero, num_viaje, num_conocimiento_embarque,
           permiso_temp_navegacion
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         RETURNING id`,
        [
          cpId, m.permSct ?? null, m.numPermisoSct ?? null,
          m.nombreAseg ?? null, m.numPolizaSeguro ?? null,
          m.tipoEmbarcacion ?? null, m.matricula, m.numeroOmi,
          m.anioEmbarcacion ?? null, m.nombreEmbarc ?? null,
          m.nacionalidadEmbarc ?? null, m.unidadesArqBruto ?? null,
          m.tipoCarga ?? null, m.numCertItc,
          m.eslora ?? null, m.manga ?? null, m.calado ?? null,
          m.lineaNaviera ?? null, m.nombreAgenteNaviero,
          m.numAutorizacionNaviero ?? null, m.numViaje ?? null,
          m.numConocimientoEmbarque ?? null, m.permisoTempNavegacion ?? null,
        ],
      );
      for (const k of m.contenedores ?? []) {
        await c.query(
          `INSERT INTO cp_maritimo_contenedores (
             maritimo_id, matricula_contenedor, tipo_contenedor, num_precinto,
             id_ccp_relacionado, placa_vm_ccp, fecha_certificacion_ccp
           ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            mar.rows[0].id, k.matriculaContenedor, k.tipoContenedor,
            k.numPrecinto ?? null, k.idCcpRelacionado ?? null,
            k.placaVmCcp ?? null, k.fechaCertificacionCcp ?? null,
          ],
        );
      }
    }

    if (input.aereo) {
      const a = input.aereo;
      await c.query(
        `INSERT INTO cp_aereo (
           carta_porte_id, perm_sct, num_permiso_sct, matricula_aeronave,
           nombre_aseg, num_poliza_seguro, numero_guia, lugar_contrato,
           codigo_transportista, rfc_embarcador, num_reg_id_trib_embarc,
           residencia_fiscal_embarc, nombre_embarcador
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          cpId, a.permSct, a.numPermisoSct, a.matriculaAeronave ?? null,
          a.nombreAseg ?? null, a.numPolizaSeguro ?? null,
          a.numeroGuia, a.lugarContrato ?? null, a.codigoTransportista,
          a.rfcEmbarcador ?? null, a.numRegIdTribEmbarc ?? null,
          a.residenciaFiscalEmbarc ?? null, a.nombreEmbarcador ?? null,
        ],
      );
    }

    for (const f of input.figuras) {
      await c.query(
        `INSERT INTO cp_figuras (
           carta_porte_id, tipo_figura, rfc_figura, num_licencia,
           nombre_figura, num_reg_id_trib, residencia_fiscal_fig,
           parte_transporte, calle, num_exterior, num_interior, colonia,
           localidad, referencia, municipio, estado, pais, codigo_postal
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          cpId, f.tipoFigura, f.rfcFigura, f.numLicencia ?? null,
          f.nombreFigura ?? null, f.numRegIdTrib ?? null,
          f.residenciaFiscalFig ?? null, f.parteTransporte ?? null,
          f.calle ?? null, f.numExterior ?? null, f.numInterior ?? null,
          f.colonia ?? null, f.localidad ?? null, f.referencia ?? null,
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
