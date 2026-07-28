/**
 * validate-carta-porte — chequeos pre-PAC contra los errores más comunes.
 *
 * Fuente: `sat-error-matrix.json` (106 reglas oficiales del SAT extraídas del
 * Matriz_Errores_CCP_V31.xls). No implementamos las 106 en código: el PAC
 * hace la validación completa. Aquí solo las ~20 que atrapan típicos errores
 * de captura y evitan un round-trip al PAC.
 *
 * Cada regla devuelve `{ codigo, campo, mensaje, severidad }` donde:
 *   · `codigo` = código oficial del SAT (CPNNN) cuando aplica, o `LOCAL_*`
 *     para reglas de sanidad locales (formato de teléfono/placa, etc.).
 *   · `severidad` = 'error' (bloquea el timbrado) | 'warning' (informa).
 *
 * Se ejecuta contra el snapshot en BD (mismo shape que getByInvoiceId).
 * Los chequeos de pertenencia a catálogo (BienesTransp, ClaveUnidad, etc.)
 * consultan las tablas `sat_cp_*` para evitar duplicar los datos en memoria.
 */

import { pool } from '../../config/database';

export interface Violation {
  codigo: string;
  campo: string;
  mensaje: string;
  severidad: 'error' | 'warning';
}

interface CP {
  transp_internac: 'Si' | 'No';
  entrada_salida_merc?: string;
  pais_origen_destino?: string;
  via_entrada_salida?: string;
  total_dist_rec: string | number;
  medio_transporte?: string;
  regimenes_aduaneros?: string[];
  regimen_aduanero?: string;
  ubicaciones: any[];
  mercancias: any[];
  autotransporte: any | null;
  ferroviario?: any | null;
  maritimo?: any | null;
  aereo?: any | null;
  figuras: any[];
}

const RFC_RE = /^([A-ZÑ&]{3,4})(\d{6})([A-Z\d]{3})$/;
const CP_RE = /^\d{5}$/;
const PLACA_RE = /^[A-Z0-9]{5,7}$/;
const OMI_RE = /^(IMO)?\d{7}$/i;

/** RFC genérico del SAT para operaciones con residentes en el extranjero. */
const RFC_EXTRANJERO = 'XEXX010101000';

const NOMBRE_MEDIO: Record<string, string> = {
  '01': 'Autotransporte',
  '02': 'Transporte marítimo',
  '03': 'Transporte aéreo',
  '04': 'Transporte ferroviario',
};

async function catalogHas(table: string, key: string): Promise<boolean> {
  if (!key) return false;
  const r = await pool.query(`SELECT 1 FROM ${table} WHERE clave = $1 LIMIT 1`, [key]);
  return (r.rowCount ?? 0) > 0;
}

export async function validateCartaPorte(cp: CP): Promise<Violation[]> {
  const v: Violation[] = [];
  const push = (codigo: string, campo: string, mensaje: string, severidad: Violation['severidad'] = 'error') =>
    v.push({ codigo, campo, mensaje, severidad });

  /* ─── Estructura mínima ─── */
  const origenes = cp.ubicaciones.filter(u => u.tipo_ubicacion === 'Origen');
  const destinos = cp.ubicaciones.filter(u => u.tipo_ubicacion === 'Destino');
  if (!origenes.length) push('LOCAL_UBI_ORIGEN', 'Ubicaciones', 'Debe haber al menos 1 ubicación de tipo Origen');
  if (!destinos.length) push('LOCAL_UBI_DESTINO', 'Ubicaciones', 'Debe haber al menos 1 ubicación de tipo Destino');
  if (!cp.mercancias.length) push('LOCAL_MERC', 'Mercancias', 'Debe haber al menos 1 mercancía');
  if (!cp.figuras.length) push('LOCAL_FIG', 'FiguraTransporte', 'Debe haber al menos 1 figura de transporte');

  /* ─── Encabezado ─── */
  if (Number(cp.total_dist_rec) <= 0) {
    push('CP112', 'TotalDistRec', 'TotalDistRec debe ser mayor a cero');
  }
  if (cp.transp_internac === 'Si') {
    if (!cp.entrada_salida_merc) push('CP113', 'EntradaSalidaMerc', 'Requerido cuando TranspInternac=Sí');
    if (!cp.pais_origen_destino) push('CP114', 'PaisOrigenDestino', 'Requerido cuando TranspInternac=Sí');
    if (!cp.via_entrada_salida)  push('CP115', 'ViaEntradaSalida', 'Requerido cuando TranspInternac=Sí');
  }

  /* ─── Ubicaciones ─── */
  cp.ubicaciones.forEach((u, i) => {
    const p = `Ubicacion[${i}]`;
    const pais = u.pais || 'MEX';
    const esMexicano = pais === 'MEX';

    if (esMexicano) {
      if (!RFC_RE.test(u.rfc_remitente_destinatario || '')) {
        push('CP131', `${p}.RFCRemitenteDestinatario`, 'Formato de RFC inválido');
      }
      if (!CP_RE.test(u.codigo_postal || '')) {
        push('CP147', `${p}.Domicilio.CodigoPostal`, 'CP debe ser 5 dígitos');
      }
    } else {
      // §5.2/§5.3: un domicilio extranjero no se valida contra el catálogo
      // mexicano. Lo que sí exige el SAT es el RFC genérico más el registro
      // tributario del país de residencia.
      if ((u.rfc_remitente_destinatario || '').toUpperCase() !== RFC_EXTRANJERO) {
        push('CP132', `${p}.RFCRemitenteDestinatario`,
          `Domicilio en ${pais}: el RFC debe ser el genérico ${RFC_EXTRANJERO}`);
      }
      if (!u.num_reg_id_trib) {
        push('CP133', `${p}.NumRegIdTrib`,
          `Domicilio en ${pais}: falta el registro tributario (Tax ID / EIN)`);
      }
      if (!u.residencia_fiscal) {
        push('CP134', `${p}.ResidenciaFiscal`, `Domicilio en ${pais}: falta la residencia fiscal`);
      }
      if (!u.codigo_postal) {
        push('CP147', `${p}.Domicilio.CodigoPostal`, 'Falta el código postal');
      }
    }

    if (u.tipo_ubicacion === 'Destino' && Number(u.distancia_recorrida || 0) <= 0) {
      push('CP143', `${p}.DistanciaRecorrida`, 'Distancia recorrida > 0 en Destino');
    }
  });
  // Fecha origen < fecha destino más lejano
  const primerOrigen = origenes[0];
  const ultimoDestino = destinos[destinos.length - 1];
  if (primerOrigen && ultimoDestino) {
    const fo = new Date(primerOrigen.fecha_hora_salida_llegada).getTime();
    const fd = new Date(ultimoDestino.fecha_hora_salida_llegada).getTime();
    if (Number.isFinite(fo) && Number.isFinite(fd) && fo >= fd) {
      push('CP140', 'FechaHoraSalidaLlegada', 'Fecha del primer Origen debe ser anterior al último Destino');
    }
  }

  /* ─── Mercancías (con catálogos) ─── */
  let pesoTotal = 0;
  for (let i = 0; i < cp.mercancias.length; i++) {
    const m = cp.mercancias[i];
    const p = `Mercancia[${i}]`;
    pesoTotal += Number(m.peso_en_kg || 0);
    if (Number(m.cantidad || 0) <= 0) push('CP159', `${p}.Cantidad`, 'Cantidad > 0');
    if (Number(m.peso_en_kg || 0) <= 0) push('CP160', `${p}.PesoEnKg`, 'PesoEnKg > 0');
    if (!(await catalogHas('sat_cp_clave_prod_serv', m.bienes_transp))) {
      push('CP155', `${p}.BienesTransp`, `Clave "${m.bienes_transp}" no existe en c_ClaveProdServCP`);
    }
    if (!(await catalogHas('sat_cp_clave_unidad_peso', m.clave_unidad))) {
      push('CP158', `${p}.ClaveUnidad`, `Clave "${m.clave_unidad}" no existe en c_ClaveUnidadPeso`);
    }
    if (m.material_peligroso === 'Si') {
      if (!m.cve_material_peligroso) push('CP162', `${p}.CveMaterialPeligroso`, 'Requerido cuando MaterialPeligroso=Sí');
      if (!m.embalaje) push('CP163', `${p}.Embalaje`, 'Requerido cuando MaterialPeligroso=Sí');
    }
  }
  if (pesoTotal <= 0) push('CP150', 'Mercancias.PesoBrutoTotal', 'Suma de PesoEnKg debe ser > 0');

  /* ─── Capa internacional (§15.3) ─── */
  const regimenes = cp.regimenes_aduaneros?.length
    ? cp.regimenes_aduaneros
    : cp.regimen_aduanero ? [cp.regimen_aduanero] : [];

  if (cp.transp_internac === 'Si') {
    if (!regimenes.length) {
      push('CP116', 'RegimenAduaneroCCP', 'Requerido cuando TranspInternac=Sí');
    }
    if (cp.pais_origen_destino === 'MEX') {
      push('CP117', 'PaisOrigenDestino',
        'Debe ser el país extranjero de la operación, no México');
    }
    // §4.5: exportar con un régimen de importación (o al revés) es rechazo
    // seguro del PAC. impoexpo del catálogo dice para qué sirve cada uno.
    for (const r of regimenes) {
      const row = await pool.query(
        'SELECT impoexpo FROM sat_cp_regimen_aduanero WHERE clave = $1', [r],
      );
      if (!row.rowCount) {
        push('CP118', 'RegimenAduaneroCCP', `Régimen "${r}" no existe en c_RegimenAduaneroCCP`);
        continue;
      }
      const sentidos = String(row.rows[0].impoexpo || '').split(',').map(s => s.trim());
      if (cp.entrada_salida_merc && sentidos.length && !sentidos.includes(cp.entrada_salida_merc)) {
        push('CP119', 'RegimenAduaneroCCP',
          `El régimen "${r}" es para ${sentidos.join('/')}, y la operación es de ${cp.entrada_salida_merc}`);
      }
    }
    // Sin documentación aduanera el SAT no puede amarrar la mercancía a su
    // pedimento o permiso.
    const sinDocs = cp.mercancias.filter(m => !(m.docs_aduaneros || []).length);
    if (sinDocs.length === cp.mercancias.length && cp.mercancias.length) {
      push('CP180', 'Mercancias.DocumentacionAduanera',
        'Ninguna mercancía trae documentación aduanera en una operación internacional',
        'warning');
    }
  }

  for (let i = 0; i < cp.mercancias.length; i++) {
    for (const [j, d] of (cp.mercancias[i].docs_aduaneros || []).entries()) {
      const p = `Mercancia[${i}].DocumentacionAduanera[${j}]`;
      if (!(await catalogHas('sat_cp_documento_aduanero', d.tipo_documento))) {
        push('CP181', `${p}.TipoDocumento`,
          `Tipo "${d.tipo_documento}" no existe en c_DocumentoAduanero`);
      }
      if (d.tipo_documento === '01' && !d.num_pedimento) {
        push('CP182', `${p}.NumPedimento`, 'Requerido cuando el documento es Pedimento');
      }
      if (d.tipo_documento !== '01' && !d.ident_doc_aduanero) {
        push('CP183', `${p}.IdentDocAduanero`, 'Requerido cuando el documento no es Pedimento');
      }
    }
  }

  /* ─── Capa modal (§15.4) ─── */
  const medio = cp.medio_transporte || '01';
  const bloques: Record<string, any> = {
    '01': cp.autotransporte,
    '02': cp.maritimo,
    '03': cp.aereo,
    '04': cp.ferroviario,
  };
  if (!bloques[medio]) {
    push('LOCAL_MODAL', 'Mercancias', `Falta el bloque de ${NOMBRE_MEDIO[medio] ?? medio}`);
  }
  const sobrantes = Object.keys(bloques).filter(k => k !== medio && bloques[k]);
  if (sobrantes.length) {
    push('LOCAL_MODAL_DUP', 'Mercancias',
      `El medio es ${NOMBRE_MEDIO[medio]} pero también hay bloque de ` +
      sobrantes.map(k => NOMBRE_MEDIO[k]).join(' y '));
  }
  if (cp.transp_internac === 'Si' && cp.via_entrada_salida && cp.via_entrada_salida !== medio) {
    push('CP120', 'ViaEntradaSalida',
      `La vía declarada (${NOMBRE_MEDIO[cp.via_entrada_salida] ?? cp.via_entrada_salida}) ` +
      `no coincide con el medio capturado (${NOMBRE_MEDIO[medio]})`);
  }

  /* ─── Autotransporte ─── */
  const a = medio === '01' ? cp.autotransporte : null;
  if (a) {
    if (!(await catalogHas('sat_cp_tipo_permiso', a.perm_sct))) {
      push('CP170', 'Autotransporte.PermSCT', `Permiso "${a.perm_sct}" no existe en c_TipoPermiso`);
    }
    if (!(await catalogHas('sat_cp_config_autotransporte', a.config_vehicular))) {
      push('CP171', 'Autotransporte.ConfigVehicular', `Config "${a.config_vehicular}" no existe en c_ConfigAutotransporte`);
    }
    if (!PLACA_RE.test((a.placa_vm || '').toUpperCase())) {
      push('CP173', 'Autotransporte.PlacaVM', 'Placa debe ser 5-7 caracteres alfanuméricos');
    }
    const anio = Number(a.anio_modelo_vm);
    const anioMax = new Date().getFullYear() + 2;
    if (!Number.isFinite(anio) || anio < 1900 || anio > anioMax) {
      push('CP174', 'Autotransporte.AnioModeloVM', `Año modelo debe estar entre 1900 y ${anioMax}`);
    }
    for (let i = 0; i < (a.remolques || []).length; i++) {
      const r = a.remolques[i];
      if (!(await catalogHas('sat_cp_sub_tipo_rem', r.sub_tipo_rem))) {
        push('CP175', `Remolque[${i}].SubTipoRem`, `Subtipo "${r.sub_tipo_rem}" no existe en c_SubTipoRem`);
      }
      if (!PLACA_RE.test((r.placa || '').toUpperCase())) {
        push('CP176', `Remolque[${i}].Placa`, 'Placa remolque inválida');
      }
    }
  }

  /* ─── Ferroviario (§9) ─── */
  const fer = medio === '04' ? cp.ferroviario : null;
  if (fer) {
    if (!(await catalogHas('sat_cp_tipo_de_servicio', fer.tipo_de_servicio))) {
      push('CP200', 'TransporteFerroviario.TipoDeServicio',
        `Servicio "${fer.tipo_de_servicio}" no existe en c_TipoDeServicio`);
    }
    if (!(await catalogHas('sat_cp_tipo_de_trafico', fer.tipo_de_trafico))) {
      push('CP201', 'TransporteFerroviario.TipoDeTrafico',
        `Tráfico "${fer.tipo_de_trafico}" no existe en c_TipoDeTrafico`);
    }
    const carros = fer.carros || [];
    if (!carros.length) {
      push('CP202', 'TransporteFerroviario.Carro', 'Debe haber al menos un carro ferroviario');
    }
    for (let i = 0; i < carros.length; i++) {
      const c = carros[i];
      const p = `Carro[${i}]`;
      if (!(await catalogHas('sat_cp_tipo_carro', c.tipo_carro))) {
        push('CP203', `${p}.TipoCarro`, `Tipo "${c.tipo_carro}" no existe en c_TipoCarro`);
      }
      if (Number(c.toneladas_netas_carro || 0) <= 0) {
        push('CP204', `${p}.ToneladasNetasCarro`, 'Toneladas netas > 0');
      }
      for (const [j, k] of (c.contenedores || []).entries()) {
        if (!(await catalogHas('sat_cp_contenedor', k.tipo_contenedor))) {
          push('CP205', `${p}.Contenedor[${j}].TipoContenedor`,
            `Tipo "${k.tipo_contenedor}" no existe en c_Contenedor`);
        }
      }
    }
    for (const [i, d] of (fer.derechos_de_paso || []).entries()) {
      if (!(await catalogHas('sat_cp_derechos_de_paso', d.tipo_derecho_de_paso))) {
        push('CP206', `DerechosDePaso[${i}].TipoDerechoDePaso`,
          `Derecho "${d.tipo_derecho_de_paso}" no existe en c_DerechosDePaso`);
      }
      if (Number(d.kilometraje_pagado || 0) <= 0) {
        push('CP207', `DerechosDePaso[${i}].KilometrajePagado`, 'Kilometraje pagado > 0');
      }
    }
  }

  /* ─── Marítimo (§10) ─── */
  const mar = medio === '02' ? cp.maritimo : null;
  if (mar) {
    if (!OMI_RE.test(String(mar.numero_omi || ''))) {
      push('CP210', 'TransporteMaritimo.NumeroOMI',
        'El número OMI son 7 dígitos, con o sin prefijo IMO (ej. IMO1234567)');
    }
    if (mar.tipo_embarcacion && !(await catalogHas('sat_cp_config_maritima', mar.tipo_embarcacion))) {
      push('CP211', 'TransporteMaritimo.TipoEmbarcacion',
        `Tipo "${mar.tipo_embarcacion}" no existe en c_ConfigMaritima`);
    }
    if (mar.tipo_carga && !(await catalogHas('sat_cp_clave_tipo_carga', mar.tipo_carga))) {
      push('CP212', 'TransporteMaritimo.TipoCarga',
        `Carga "${mar.tipo_carga}" no existe en c_ClaveTipoCarga`);
    }
    if (!mar.nombre_agente_naviero) {
      push('CP213', 'TransporteMaritimo.NombreAgenteNaviero', 'Requerido');
    }
    if (!mar.num_cert_itc) {
      push('CP214', 'TransporteMaritimo.NumCertITC', 'Requerido');
    }
    for (const [i, k] of (mar.contenedores || []).entries()) {
      if (!(await catalogHas('sat_cp_contenedor_maritimo', k.tipo_contenedor))) {
        push('CP215', `TransporteMaritimo.Contenedor[${i}].TipoContenedor`,
          `Tipo "${k.tipo_contenedor}" no existe en c_ContenedorMaritimo`);
      }
    }
  }

  /* ─── Aéreo (§11) ─── */
  const aer = medio === '03' ? cp.aereo : null;
  if (aer) {
    if (!(await catalogHas('sat_cp_codigo_transporte_aereo', aer.codigo_transportista))) {
      push('CP220', 'TransporteAereo.CodigoTransportista',
        `Código "${aer.codigo_transportista}" no existe en c_CodigoTransporteAereo`);
    }
    if (!(await catalogHas('sat_cp_tipo_permiso', aer.perm_sct))) {
      push('CP221', 'TransporteAereo.PermSCT',
        `Permiso "${aer.perm_sct}" no existe en c_TipoPermiso`);
    }
    if (!aer.numero_guia) {
      push('CP222', 'TransporteAereo.NumeroGuia', 'La guía aérea es requerida');
    }
    // §11.3: si el embarque se parte en dos vuelos va documentación separada.
    if (aer.rfc_embarcador && aer.residencia_fiscal_embarc
        && aer.residencia_fiscal_embarc !== 'MEX' && !aer.num_reg_id_trib_embarc) {
      push('CP223', 'TransporteAereo.NumRegIdTribEmbarc',
        'Embarcador extranjero: falta su registro tributario');
    }
  }

  /* ─── Figuras ─── */
  cp.figuras.forEach((f, i) => {
    const p = `TiposFigura[${i}]`;
    const esExtranjera = !!f.pais && f.pais !== 'MEX';

    if (esExtranjera) {
      // §12: a un operador extranjero no se le exige RFC mexicano.
      if (!f.residencia_fiscal_fig) {
        push('CP191', `${p}.ResidenciaFiscalFigura`, 'Figura extranjera: falta la residencia fiscal');
      }
      if (!f.num_reg_id_trib) {
        push('CP192', `${p}.NumRegIdTribFigura`, 'Figura extranjera: falta el registro tributario');
      }
    } else if (!RFC_RE.test((f.rfc_figura || '').toUpperCase())) {
      push('CP190', `${p}.RFCFigura`, 'RFC de figura inválido');
    }

    // La licencia del operador solo aplica al autotransporte: un maquinista o
    // un piloto no traen licencia de conducir de la SICT.
    if (f.tipo_figura === '01' && medio === '01' && !f.num_licencia) {
      push('CP196', `${p}.NumLicencia`, 'NumLicencia requerido para tipo Operador (01)');
    }
  });

  return v;
}
