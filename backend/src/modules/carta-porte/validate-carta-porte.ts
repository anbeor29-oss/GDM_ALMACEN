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
  ubicaciones: any[];
  mercancias: any[];
  autotransporte: any | null;
  figuras: any[];
}

const RFC_RE = /^([A-ZÑ&]{3,4})(\d{6})([A-Z\d]{3})$/;
const CP_RE = /^\d{5}$/;
const PLACA_RE = /^[A-Z0-9]{5,7}$/;

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
    if (!RFC_RE.test(u.rfc_remitente_destinatario || '')) {
      push('CP131', `${p}.RFCRemitenteDestinatario`, 'Formato de RFC inválido');
    }
    if (!CP_RE.test(u.codigo_postal || '')) {
      push('CP147', `${p}.Domicilio.CodigoPostal`, 'CP debe ser 5 dígitos');
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

  /* ─── Autotransporte ─── */
  const a = cp.autotransporte;
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

  /* ─── Figuras ─── */
  cp.figuras.forEach((f, i) => {
    const p = `TiposFigura[${i}]`;
    if (!RFC_RE.test((f.rfc_figura || '').toUpperCase())) {
      push('CP190', `${p}.RFCFigura`, 'RFC de figura inválido');
    }
    // Operador (01) requiere NumLicencia
    if (f.tipo_figura === '01' && !f.num_licencia) {
      push('CP196', `${p}.NumLicencia`, 'NumLicencia requerido para tipo Operador (01)');
    }
  });

  return v;
}
