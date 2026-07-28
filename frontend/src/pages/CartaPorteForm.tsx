/**
 * CartaPorteForm — captura del Complemento Carta Porte 3.1 para una factura.
 *
 * Ruta: /invoices/:invoiceId/carta-porte
 * Ancho: max-w-[1200px] (decisión de 2026-07-17).
 *
 * Estructura de UI:
 *   1. Encabezado — internacional, distancia, medio de transporte (multimodal)
 *   2. Ubicaciones — mínimo 1 Origen + 1 Destino, cada una con domicilio y fecha
 *   3. Mercancías — bienes transportados con búsqueda de catálogo
 *   4. Medio de transporte — sección condicional según el medio elegido
 *      · Autotransporte: config vehicular, placa, seguros, remolques
 *      · Marítimo: embarcación, agente naviero, viaje, contenedores
 *      · Aéreo: aeronave, guía aérea, transportista, embarcador
 *      · Ferroviario: servicio, tráfico, derechos de paso, carros y contenedores
 *      El medio es exclusivo: solo viaja al SAT el bloque elegido.
 *   5. Figuras de transporte — mínimo 1 operador
 *
 * Cuando el traslado es internacional aparece además el bloque de comercio
 * exterior (entrada/salida, país, regímenes aduaneros, cruce fronterizo) y
 * cada mercancía puede llevar su documentación aduanera.
 *
 * Nota: este form es el primer entregable del CP. Las 110 reglas del SAT
 * (Matriz de Errores) se validan en el Bloque 7 antes del timbrado.
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Route as RouteIcon, Plus, Trash2, Save, ArrowLeft, MapPin, Package2, Truck, UserCog, Ship, Plane, Train, Search, BookMarked } from 'lucide-react';
import api from '@/services/api';
import { CatalogPicker, type CatalogItem } from '@/components/CatalogPicker';
import { LugarPicker } from '@/components/LugarPicker';

type Medio = 'auto' | 'maritimo' | 'aereo' | 'ferroviario';

/** c_CveTransporte — lo que entiende el SAT. La UI usa nombres legibles. */
const CLAVE_MEDIO: Record<Medio, string> = {
  auto: '01', maritimo: '02', aereo: '03', ferroviario: '04',
};
const MEDIO_DESDE_CLAVE: Record<string, Medio> = {
  '01': 'auto', '02': 'maritimo', '03': 'aereo', '04': 'ferroviario',
};

/** Cómo se llama el punto por donde la mercancía cruza, según el medio. */
const PUNTO_LABEL: Record<string, string> = {
  cruce: 'Cruce fronterizo',
  puerto: 'Puerto de entrada/salida',
  aeropuerto: 'Aeropuerto de entrada/salida',
};

/** El nodo Ubicación lleva estación solo fuera del autotransporte. */
const USA_ESTACION = (m: Medio) => m !== 'auto';

const ESTACION_LABEL: Record<Medio, string> = {
  auto: '', maritimo: 'Puerto', aereo: 'Aeropuerto', ferroviario: 'Estación ferroviaria',
};

interface UbicacionRow {
  tipoUbicacion: 'Origen' | 'Destino';
  idUbicacion: string;
  rfcRemitenteDestinatario: string;
  nombreRemitenteDestinatario: string;
  fechaHoraSalidaLlegada: string;
  distanciaRecorrida?: string;
  calle: string;
  numExterior: string;
  numInterior: string;
  colonia: string;
  localidad: string;
  referencia: string;
  municipio: string;
  estado: string;
  pais: string;
  codigoPostal: string;
  // Estación: solo marítimo, aéreo y ferroviario. El puerto de origen y el de
  // destino son distintos, por eso va aquí y no en el encabezado.
  tipoEstacion?: string;
  numEstacion?: string;
  nombreEstacion?: string;
  guardarEnCatalogo?: boolean;   // ← el usuario marca para guardar como plantilla
  aliasCatalogo?: string;         // ← alias opcional; si vacío se autogenera
}
/** Un pedimento o permiso que ampara una mercancía concreta. */
interface DocAduaneraRow {
  tipoDocumento: string;
  numPedimento: string;
  identDocAduanero: string;
  rfcImpo: string;
}
interface MercanciaRow {
  bienesTransp: string;
  descripcion: string;
  cantidad: string;
  claveUnidad: string;
  pesoEnKg: string;
  materialPeligroso: 'Si' | 'No';
  cveMaterialPeligroso: string;
  embalaje: string;
  valorMercancia: string;
  moneda: string;
  fraccionArancelaria?: string;
  tipoMateria?: string;
  docsAduaneros?: DocAduaneraRow[];
}
interface RemolqueRow { subTipoRem: string; placa: string; }
interface FiguraRow {
  tipoFigura: string;
  rfcFigura: string;
  numLicencia: string;
  nombreFigura: string;
  pais?: string;
  residenciaFiscalFig?: string;
  numRegIdTrib?: string;
}

/* ─── Modalidades no carreteras ────────────────────────────────────── */

interface ContenedorFerroRow { tipoContenedor: string; pesoContenedorVacio: string; pesoNetoMercancia: string; }
interface CarroRow {
  tipoCarro: string; matriculaCarro: string; guiaCarro: string;
  toneladasNetasCarro: string; contenedores: ContenedorFerroRow[];
}
interface DerechoPasoRow { tipoDerechoDePaso: string; kilometrajePagado: string; }
interface ContenedorMarRow {
  matriculaContenedor: string; tipoContenedor: string; numPrecinto: string;
  idCcpRelacionado: string; placaVmCcp: string; fechaCertificacionCcp: string;
}

const FERRO_VACIO = {
  tipoDeServicio: '', tipoDeTrafico: '', nombreAseg: '', numPolizaSeguro: '',
};
const MARITIMO_VACIO = {
  permSct: '', numPermisoSct: '', nombreAseg: '', numPolizaSeguro: '',
  tipoEmbarcacion: '', matricula: '', numeroOmi: '', anioEmbarcacion: '',
  nombreEmbarc: '', nacionalidadEmbarc: '', unidadesArqBruto: '', tipoCarga: '',
  numCertItc: '', eslora: '', manga: '', calado: '', lineaNaviera: '',
  nombreAgenteNaviero: '', numAutorizacionNaviero: '', numViaje: '',
  numConocimientoEmbarque: '', permisoTempNavegacion: '',
};
const AEREO_VACIO = {
  permSct: '', numPermisoSct: '', matriculaAeronave: '', nombreAseg: '',
  numPolizaSeguro: '', numeroGuia: '', lugarContrato: '', codigoTransportista: '',
  rfcEmbarcador: '', numRegIdTribEmbarc: '', residenciaFiscalEmbarc: '', nombreEmbarcador: '',
};

/**
 * Auto-generación de IDUbicacion del SAT: `OR` + 6 dígitos para Origen,
 * `DE` + 6 dígitos para Destino, únicos dentro de la misma Carta Porte.
 * Cuenta cuántas ubicaciones del mismo tipo ya existen y usa el siguiente.
 */
function nextIdUbicacion(tipo: 'Origen' | 'Destino', existentes: UbicacionRow[]): string {
  const prefijo = tipo === 'Origen' ? 'OR' : 'DE';
  const usadas = existentes
    .filter(u => u.tipoUbicacion === tipo)
    .map(u => Number(String(u.idUbicacion || '').replace(prefijo, '')))
    .filter(n => Number.isFinite(n));
  const next = (usadas.length ? Math.max(...usadas) : 0) + 1;
  return prefijo + String(next).padStart(6, '0');
}

function blankUbicacion(tipo: 'Origen' | 'Destino', existentes: UbicacionRow[] = []): UbicacionRow {
  return {
    tipoUbicacion: tipo,
    idUbicacion: nextIdUbicacion(tipo, existentes),
    rfcRemitenteDestinatario: '',
    nombreRemitenteDestinatario: '',
    fechaHoraSalidaLlegada: '',
    distanciaRecorrida: tipo === 'Destino' ? '' : undefined,
    calle: '',
    numExterior: '',
    numInterior: '',
    colonia: '',
    localidad: '',
    referencia: '',
    municipio: '',
    estado: '',
    pais: 'MEX',
    codigoPostal: '',
    tipoEstacion: '',
    numEstacion: '',
    nombreEstacion: '',
    guardarEnCatalogo: false,
    aliasCatalogo: '',
  };
}

/** Aplica un lugar del catálogo a la ubicación, respetando su tipo. */
function ubicacionDesdeLugar(l: any, tipo: 'Origen' | 'Destino', existentes: UbicacionRow[]): UbicacionRow {
  return {
    tipoUbicacion: tipo,
    idUbicacion: nextIdUbicacion(tipo, existentes),
    rfcRemitenteDestinatario: l.rfc || '',
    nombreRemitenteDestinatario: l.nombre || '',
    fechaHoraSalidaLlegada: '',
    distanciaRecorrida: tipo === 'Destino' ? '' : undefined,
    calle: l.calle || '',
    numExterior: l.num_exterior || '',
    numInterior: l.num_interior || '',
    colonia: l.colonia || '',
    localidad: l.localidad || '',
    referencia: l.referencia || '',
    municipio: l.municipio || '',
    estado: l.estado || '',
    pais: l.pais || 'MEX',
    codigoPostal: l.codigo_postal || '',
    guardarEnCatalogo: false,     // ya está en el catálogo
    aliasCatalogo: l.alias,
  };
}
const blankMercancia = (): MercanciaRow => ({
  bienesTransp: '', descripcion: '', cantidad: '', claveUnidad: '',
  pesoEnKg: '', materialPeligroso: 'No', cveMaterialPeligroso: '', embalaje: '',
  valorMercancia: '', moneda: 'MXN',
});
const blankFigura = (): FiguraRow => ({ tipoFigura: '01', rfcFigura: '', numLicencia: '', nombreFigura: '' });

export function CartaPorteFormPage() {
  const { invoiceId = '' } = useParams();
  const navigate = useNavigate();

  // ─── Encabezado ─────────────────────────────────────────────────────
  const [transpInternac, setTranspInternac] = useState<'Si' | 'No'>('No');
  const [totalDistRec, setTotalDistRec] = useState('');
  const [medio, setMedio] = useState<Medio>('auto');
  const [entradaSalidaMerc, setEntradaSalidaMerc] = useState<'Entrada' | 'Salida' | ''>('');
  const [paisOrigenDestino, setPaisOrigenDestino] = useState('');
  const [regimenes, setRegimenes] = useState<string[]>([]);
  const [cruceFronterizo, setCruceFronterizo] = useState('');
  // Nombre legible del punto elegido. Solo para mostrar: al SAT viaja la clave.
  const [puntoNombre, setPuntoNombre] = useState('');
  // Punto de entrada/salida: cruce carretero, puerto o aeropuerto según el medio.
  const [puntos, setPuntos] = useState<{ tipo: string; items: any[] }>({ tipo: 'cruce', items: [] });

  // ─── Ubicaciones / mercancías / figuras ────────────────────────────
  const [ubicaciones, setUbicaciones] = useState<UbicacionRow[]>(() => {
    const or = blankUbicacion('Origen', []);
    return [or, blankUbicacion('Destino', [or])];
  });
  // Picker de lugares frecuentes: {ubicIndex, tipo} para saber a qué fila se aplica
  const [lugarPicker, setLugarPicker] = useState<{ index: number; tipo: 'Origen' | 'Destino' } | null>(null);
  const [mercPicker, setMercPicker] = useState<number | null>(null);
  const [autoPickerOpen, setAutoPickerOpen] = useState(false);
  // A qué bloque le va a llenar la póliza el picker. El catálogo de
  // aseguradoras es el mismo para las cuatro modalidades; lo que cambia es
  // dónde aterriza el dato.
  const [asegPickerOpen, setAsegPickerOpen] = useState<null | Medio>(null);
  const [figPicker, setFigPicker] = useState<number | null>(null);
  const [mercancias, setMercancias] = useState<MercanciaRow[]>([blankMercancia()]);
  const [figuras, setFiguras] = useState<FiguraRow[]>([blankFigura()]);

  // ─── Autotransporte (aplica si medio='auto') ───────────────────────
  const [auto, setAuto] = useState({
    permSct: '', numPermisoSct: '', configVehicular: '',
    pesoBrutoVehicular: '', placaVm: '', anioModeloVm: String(new Date().getFullYear()),
    aseguraRespCivil: '', polizaRespCivil: '',
  });
  const [remolques, setRemolques] = useState<RemolqueRow[]>([]);

  // ─── Modalidades no carreteras ─────────────────────────────────────
  const [ferro, setFerro] = useState({ ...FERRO_VACIO });
  const [derechosPaso, setDerechosPaso] = useState<DerechoPasoRow[]>([]);
  const [carros, setCarros] = useState<CarroRow[]>([]);
  const [maritimo, setMaritimo] = useState({ ...MARITIMO_VACIO });
  const [contMaritimos, setContMaritimos] = useState<ContenedorMarRow[]>([]);
  const [aereo, setAereo] = useState({ ...AEREO_VACIO });

  // ─── Picker state (uno global, se abre según el trigger actual) ────
  const [picker, setPicker] = useState<{ name: string; title: string; onSelect: (i: CatalogItem) => void; showExtras?: string[] } | null>(null);

  // ─── Cargar factura + CP existente ─────────────────────────────────
  const { data: invoice } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => api.getInvoice(invoiceId),
    enabled: !!invoiceId,
  });
  const { data: existing } = useQuery({
    queryKey: ['carta-porte', invoiceId],
    queryFn: () => api.getCartaPorte(invoiceId),
    enabled: !!invoiceId,
  });
  useEffect(() => {
    if (!existing) return;
    setTranspInternac(existing.transp_internac || 'No');
    setTotalDistRec(String(existing.total_dist_rec || ''));
    setEntradaSalidaMerc(existing.entrada_salida_merc || '');
    setPaisOrigenDestino(existing.pais_origen_destino || '');
    setMedio(MEDIO_DESDE_CLAVE[existing.medio_transporte] || 'auto');
    setRegimenes(existing.regimenes_aduaneros || (existing.regimen_aduanero ? [existing.regimen_aduanero] : []));
    setCruceFronterizo(existing.cruce_fronterizo || '');
    if (existing.ubicaciones?.length) {
      setUbicaciones(existing.ubicaciones.map((u: any) => ({
        tipoUbicacion: u.tipo_ubicacion, idUbicacion: u.id_ubicacion,
        rfcRemitenteDestinatario: u.rfc_remitente_destinatario,
        nombreRemitenteDestinatario: u.nombre_remitente_destinatario || '',
        fechaHoraSalidaLlegada: u.fecha_hora_salida_llegada?.slice(0, 16) || '',
        distanciaRecorrida: u.distancia_recorrida != null ? String(u.distancia_recorrida) : '',
        calle: u.calle || '', numExterior: u.num_exterior || '',
        numInterior: u.num_interior || '',
        colonia: u.colonia || '',
        localidad: u.localidad || '',
        referencia: u.referencia || '',
        municipio: u.municipio || '',
        estado: u.estado,
        pais: u.pais || 'MEX',
        codigoPostal: u.codigo_postal,
        tipoEstacion: u.tipo_estacion || '',
        numEstacion: u.num_estacion || '',
        nombreEstacion: u.nombre_estacion || '',
      })));
    }
    if (existing.mercancias?.length) {
      setMercancias(existing.mercancias.map((m: any) => ({
        bienesTransp: m.bienes_transp, descripcion: m.descripcion,
        cantidad: String(m.cantidad), claveUnidad: m.clave_unidad,
        pesoEnKg: String(m.peso_en_kg), materialPeligroso: m.material_peligroso || 'No',
        cveMaterialPeligroso: m.cve_material_peligroso || '', embalaje: m.embalaje || '',
        valorMercancia: m.valor_mercancia != null ? String(m.valor_mercancia) : '',
        moneda: m.moneda || 'MXN',
        fraccionArancelaria: m.fraccion_arancelaria || '',
        tipoMateria: m.tipo_materia || '',
        docsAduaneros: (m.docs_aduaneros || []).map((d: any) => ({
          tipoDocumento: d.tipo_documento,
          numPedimento: d.num_pedimento || '',
          identDocAduanero: d.ident_doc_aduanero || '',
          rfcImpo: d.rfc_impo || '',
        })),
      })));
    }
    if (existing.autotransporte) {
      const a = existing.autotransporte;
      setAuto({
        permSct: a.perm_sct, numPermisoSct: a.num_permiso_sct,
        configVehicular: a.config_vehicular, pesoBrutoVehicular: String(a.peso_bruto_vehicular),
        placaVm: a.placa_vm, anioModeloVm: String(a.anio_modelo_vm),
        aseguraRespCivil: a.asegura_resp_civil, polizaRespCivil: a.poliza_resp_civil,
      });
      setRemolques((a.remolques || []).map((r: any) => ({ subTipoRem: r.sub_tipo_rem, placa: r.placa })));
    }
    if (existing.ferroviario) {
      const f = existing.ferroviario;
      setFerro({
        tipoDeServicio: f.tipo_de_servicio || '', tipoDeTrafico: f.tipo_de_trafico || '',
        nombreAseg: f.nombre_aseg || '', numPolizaSeguro: f.num_poliza_seguro || '',
      });
      setDerechosPaso((f.derechos_de_paso || []).map((d: any) => ({
        tipoDerechoDePaso: d.tipo_derecho_de_paso,
        kilometrajePagado: String(d.kilometraje_pagado ?? ''),
      })));
      setCarros((f.carros || []).map((c: any) => ({
        tipoCarro: c.tipo_carro, matriculaCarro: c.matricula_carro,
        guiaCarro: c.guia_carro, toneladasNetasCarro: String(c.toneladas_netas_carro ?? ''),
        contenedores: (c.contenedores || []).map((k: any) => ({
          tipoContenedor: k.tipo_contenedor,
          pesoContenedorVacio: String(k.peso_contenedor_vacio ?? ''),
          pesoNetoMercancia: String(k.peso_neto_mercancia ?? ''),
        })),
      })));
    }
    if (existing.maritimo) {
      const m = existing.maritimo;
      setMaritimo({
        permSct: m.perm_sct || '', numPermisoSct: m.num_permiso_sct || '',
        nombreAseg: m.nombre_aseg || '', numPolizaSeguro: m.num_poliza_seguro || '',
        tipoEmbarcacion: m.tipo_embarcacion || '', matricula: m.matricula || '',
        numeroOmi: m.numero_omi || '', anioEmbarcacion: String(m.anio_embarcacion ?? ''),
        nombreEmbarc: m.nombre_embarc || '', nacionalidadEmbarc: m.nacionalidad_embarc || '',
        unidadesArqBruto: String(m.unidades_arq_bruto ?? ''), tipoCarga: m.tipo_carga || '',
        numCertItc: m.num_cert_itc || '', eslora: String(m.eslora ?? ''),
        manga: String(m.manga ?? ''), calado: String(m.calado ?? ''),
        lineaNaviera: m.linea_naviera || '', nombreAgenteNaviero: m.nombre_agente_naviero || '',
        numAutorizacionNaviero: m.num_autorizacion_naviero || '', numViaje: m.num_viaje || '',
        numConocimientoEmbarque: m.num_conocimiento_embarque || '',
        permisoTempNavegacion: m.permiso_temp_navegacion || '',
      });
      setContMaritimos((m.contenedores || []).map((k: any) => ({
        matriculaContenedor: k.matricula_contenedor, tipoContenedor: k.tipo_contenedor,
        numPrecinto: k.num_precinto || '', idCcpRelacionado: k.id_ccp_relacionado || '',
        placaVmCcp: k.placa_vm_ccp || '',
        fechaCertificacionCcp: k.fecha_certificacion_ccp?.slice(0, 10) || '',
      })));
    }
    if (existing.aereo) {
      const a = existing.aereo;
      setAereo({
        permSct: a.perm_sct || '', numPermisoSct: a.num_permiso_sct || '',
        matriculaAeronave: a.matricula_aeronave || '', nombreAseg: a.nombre_aseg || '',
        numPolizaSeguro: a.num_poliza_seguro || '', numeroGuia: a.numero_guia || '',
        lugarContrato: a.lugar_contrato || '', codigoTransportista: a.codigo_transportista || '',
        rfcEmbarcador: a.rfc_embarcador || '', numRegIdTribEmbarc: a.num_reg_id_trib_embarc || '',
        residenciaFiscalEmbarc: a.residencia_fiscal_embarc || '',
        nombreEmbarcador: a.nombre_embarcador || '',
      });
    }
    if (existing.figuras?.length) {
      setFiguras(existing.figuras.map((f: any) => ({
        tipoFigura: f.tipo_figura, rfcFigura: f.rfc_figura,
        numLicencia: f.num_licencia || '', nombreFigura: f.nombre_figura || '',
        pais: f.pais || '', residenciaFiscalFig: f.residencia_fiscal_fig || '',
        numRegIdTrib: f.num_reg_id_trib || '',
      })));
    }
  }, [existing]);

  // El punto de entrada/salida cambia con el medio: el barco sale por un
  // puerto, el avión por un aeropuerto, y el tren cruza por donde el camión.
  // Se recarga al cambiar de modalidad y se limpia la selección anterior,
  // que ya no pertenece al catálogo vigente.
  useEffect(() => {
    if (transpInternac !== 'Si') return;
    let vigente = true;
    api.getCPPuntosEntradaSalida(CLAVE_MEDIO[medio])
      .then((r: any) => { if (vigente) setPuntos({ tipo: r.tipo, items: r.items || [] }); })
      .catch(() => { if (vigente) setPuntos({ tipo: 'cruce', items: [] }); });
    return () => { vigente = false; };
  }, [transpInternac, medio]);

  // Al cambiar de medio la selección anterior deja de pertenecer al catálogo
  // vigente: un puerto no es un cruce carretero.
  const medioPrevio = useRef(medio);
  useEffect(() => {
    if (medioPrevio.current === medio) return;
    medioPrevio.current = medio;
    setCruceFronterizo('');
    setPuntoNombre('');
  }, [medio]);

  // Al abrir una CP guardada solo tenemos la clave; se resuelve el nombre para
  // que el campo no muestre un código suelto.
  useEffect(() => {
    if (!cruceFronterizo || puntoNombre || medio === 'auto' || medio === 'ferroviario') return;
    let vigente = true;
    api.searchCPEstaciones(CLAVE_MEDIO[medio], cruceFronterizo, 1)
      .then((r: any) => {
        const hit = (r.items || []).find((x: any) => x.clave === cruceFronterizo);
        if (vigente && hit) setPuntoNombre(hit.descripcion);
      })
      .catch(() => { /* se queda mostrando la clave */ });
    return () => { vigente = false; };
  }, [cruceFronterizo, puntoNombre, medio]);

  // ─── Guardar ───────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: async () => {
      const payload: any = {
        transpInternac,
        totalDistRec: Number(totalDistRec),
        ubicaciones: ubicaciones.map(u => ({
          tipoUbicacion: u.tipoUbicacion,
          idUbicacion: u.idUbicacion,
          rfcRemitenteDestinatario: u.rfcRemitenteDestinatario.toUpperCase(),
          nombreRemitenteDestinatario: u.nombreRemitenteDestinatario || undefined,
          fechaHoraSalidaLlegada: u.fechaHoraSalidaLlegada ? new Date(u.fechaHoraSalidaLlegada).toISOString() : '',
          distanciaRecorrida: u.distanciaRecorrida ? Number(u.distanciaRecorrida) : undefined,
          calle: u.calle || undefined,
          numExterior: u.numExterior || undefined,
          numInterior: u.numInterior || undefined,
          colonia: u.colonia || undefined,
          localidad: u.localidad || undefined,
          referencia: u.referencia || undefined,
          municipio: u.municipio || undefined,
          estado: u.estado,
          pais: u.pais || 'MEX',
          codigoPostal: u.codigoPostal,
          // La estación solo tiene sentido fuera del autotransporte; si el
          // usuario cambió de medio después de capturarla, no se envía.
          tipoEstacion:   USA_ESTACION(medio) ? u.tipoEstacion   || undefined : undefined,
          numEstacion:    USA_ESTACION(medio) ? u.numEstacion    || undefined : undefined,
          nombreEstacion: USA_ESTACION(medio) ? u.nombreEstacion || undefined : undefined,
        })),
        mercancias: mercancias.map(m => ({
          bienesTransp: m.bienesTransp,
          descripcion: m.descripcion,
          cantidad: Number(m.cantidad),
          claveUnidad: m.claveUnidad,
          pesoEnKg: Number(m.pesoEnKg),
          materialPeligroso: m.materialPeligroso,
          cveMaterialPeligroso: m.cveMaterialPeligroso || undefined,
          embalaje: m.embalaje || undefined,
          valorMercancia: m.valorMercancia ? Number(m.valorMercancia) : undefined,
          moneda: m.moneda || undefined,
          fraccionArancelaria: m.fraccionArancelaria || undefined,
          tipoMateria: m.tipoMateria || undefined,
          docsAduaneros: (m.docsAduaneros || [])
            .filter(d => d.tipoDocumento)
            .map(d => ({
              tipoDocumento: d.tipoDocumento,
              // El SAT quiere pedimento o identificador, nunca los dos.
              numPedimento: d.tipoDocumento === '01' ? d.numPedimento || undefined : undefined,
              identDocAduanero: d.tipoDocumento !== '01' ? d.identDocAduanero || undefined : undefined,
              rfcImpo: d.rfcImpo ? d.rfcImpo.toUpperCase() : undefined,
            })),
        })),
        figuras: figuras.map(f => ({
          tipoFigura: f.tipoFigura,
          rfcFigura: f.rfcFigura.toUpperCase(),
          numLicencia: f.numLicencia || undefined,
          nombreFigura: f.nombreFigura || undefined,
          pais: f.pais || undefined,
          residenciaFiscalFig: f.residenciaFiscalFig || undefined,
          numRegIdTrib: f.numRegIdTrib || undefined,
        })),
      };
      payload.medioTransporte = CLAVE_MEDIO[medio];

      if (transpInternac === 'Si') {
        payload.entradaSalidaMerc = entradaSalidaMerc || undefined;
        payload.paisOrigenDestino = paisOrigenDestino || undefined;
        // La vía es el medio elegido: declarar una y capturar otra es rechazo
        // seguro del PAC, así que no se pregunta dos veces lo mismo.
        payload.viaEntradaSalida = CLAVE_MEDIO[medio];
        payload.regimenesAduaneros = regimenes;
        payload.cruceFronterizo = cruceFronterizo || undefined;
      }

      // Solo viaja el bloque del medio elegido — el backend rechaza dos.
      if (medio === 'auto') {
        payload.autotransporte = {
          permSct: auto.permSct,
          numPermisoSct: auto.numPermisoSct,
          configVehicular: auto.configVehicular,
          pesoBrutoVehicular: Number(auto.pesoBrutoVehicular),
          placaVm: auto.placaVm.toUpperCase(),
          anioModeloVm: Number(auto.anioModeloVm),
          aseguraRespCivil: auto.aseguraRespCivil,
          polizaRespCivil: auto.polizaRespCivil,
          remolques: remolques.map(r => ({ subTipoRem: r.subTipoRem, placa: r.placa.toUpperCase() })),
        };
      } else if (medio === 'ferroviario') {
        payload.ferroviario = {
          ...ferro,
          derechosDePaso: derechosPaso.map(d => ({
            tipoDerechoDePaso: d.tipoDerechoDePaso,
            kilometrajePagado: Number(d.kilometrajePagado),
          })),
          carros: carros.map(c => ({
            tipoCarro: c.tipoCarro,
            matriculaCarro: c.matriculaCarro.toUpperCase(),
            guiaCarro: c.guiaCarro,
            toneladasNetasCarro: Number(c.toneladasNetasCarro),
            contenedores: c.contenedores.map(k => ({
              tipoContenedor: k.tipoContenedor,
              pesoContenedorVacio: Number(k.pesoContenedorVacio),
              pesoNetoMercancia: Number(k.pesoNetoMercancia),
            })),
          })),
        };
      } else if (medio === 'maritimo') {
        payload.maritimo = {
          ...maritimo,
          matricula: maritimo.matricula.toUpperCase(),
          numeroOmi: maritimo.numeroOmi.toUpperCase(),
          anioEmbarcacion: maritimo.anioEmbarcacion ? Number(maritimo.anioEmbarcacion) : undefined,
          unidadesArqBruto: maritimo.unidadesArqBruto ? Number(maritimo.unidadesArqBruto) : undefined,
          eslora: maritimo.eslora ? Number(maritimo.eslora) : undefined,
          manga: maritimo.manga ? Number(maritimo.manga) : undefined,
          calado: maritimo.calado ? Number(maritimo.calado) : undefined,
          contenedores: contMaritimos.map(k => ({
            ...k,
            matriculaContenedor: k.matriculaContenedor.toUpperCase(),
            placaVmCcp: k.placaVmCcp ? k.placaVmCcp.toUpperCase() : undefined,
            numPrecinto: k.numPrecinto || undefined,
            idCcpRelacionado: k.idCcpRelacionado || undefined,
            fechaCertificacionCcp: k.fechaCertificacionCcp || undefined,
          })),
        };
      } else if (medio === 'aereo') {
        payload.aereo = {
          ...aereo,
          rfcEmbarcador: aereo.rfcEmbarcador ? aereo.rfcEmbarcador.toUpperCase() : undefined,
        };
      }
      const result = await api.saveCartaPorte(invoiceId, payload);

      // Persistir ubicaciones marcadas como "guardar en catálogo".
      // Se hace después del save principal para que un error aquí NO deje
      // la CP a medio guardar. Cada upsert es idempotente por alias.
      for (const u of ubicaciones) {
        if (!u.guardarEnCatalogo) continue;
        const alias = u.aliasCatalogo?.trim() ||
          `${u.tipoUbicacion} ${u.nombreRemitenteDestinatario || u.rfcRemitenteDestinatario} ${u.codigoPostal}`.slice(0, 60);
        try {
          await api.createCPLugar({
            alias,
            tipoDefault: u.tipoUbicacion,
            rfc: u.rfcRemitenteDestinatario,
            nombre: u.nombreRemitenteDestinatario,
            calle: u.calle,
            numExterior: u.numExterior,
            estado: u.estado,
            codigoPostal: u.codigoPostal,
          });
        } catch (e) {
          // No bloqueamos el flujo por un fallo de plantilla — se logea.
          console.warn(`No se pudo guardar plantilla "${alias}":`, e);
        }
      }
      return result;
    },
    onSuccess: () => navigate('/carta-porte'),
  });

  const openPicker = (name: string, title: string, onSelect: (i: CatalogItem) => void, showExtras?: string[]) =>
    setPicker({ name, title, onSelect: (i) => { onSelect(i); setPicker(null); }, showExtras });

  return (
    <div className="mx-auto max-w-[1200px] p-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-100 rounded"><ArrowLeft size={20} /></button>
          <div className="p-2 bg-sky-100 rounded-lg"><RouteIcon size={24} className="text-sky-700" /></div>
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Carta Porte 3.1</h1>
            <p className="text-xs text-slate-500">Factura {(invoice as any)?.folio || invoiceId.slice(0, 8)}</p>
          </div>
        </div>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium"
        >
          <Save size={16} /> {save.isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      {save.error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {(save.error as any).response?.data?.error || (save.error as any).message}
        </div>
      )}

      {/* 1. Encabezado */}
      <Section title="1. Datos generales" icon={<RouteIcon size={16} />}>
        <div className="grid grid-cols-4 gap-4">
          <Field label="Transporte internacional">
            <select value={transpInternac} onChange={e => setTranspInternac(e.target.value as any)} className="input">
              <option value="No">No</option><option value="Si">Sí</option>
            </select>
          </Field>
          <Field label="Distancia total (km)">
            <input type="number" step="0.001" value={totalDistRec} onChange={e => setTotalDistRec(e.target.value)} className="input" />
          </Field>
          <Field label="Medio de transporte">
            <select value={medio} onChange={e => setMedio(e.target.value as Medio)} className="input">
              <option value="auto">Autotransporte federal</option>
              <option value="maritimo">Marítimo</option>
              <option value="aereo">Aéreo</option>
              <option value="ferroviario">Ferroviario</option>
            </select>
          </Field>
          <div />
        </div>

        {transpInternac === 'Si' && (
          <div className="mt-4 pt-4 border-t border-slate-200">
            <p className="text-sm font-medium text-slate-700 mb-3">Comercio exterior</p>
            <div className="grid grid-cols-4 gap-4">
              <Field label="Entrada / Salida">
                <select value={entradaSalidaMerc} onChange={e => setEntradaSalidaMerc(e.target.value as any)} className="input">
                  <option value="">Elegir…</option><option>Entrada</option><option>Salida</option>
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  México → extranjero es <b>Salida</b>; extranjero → México es <b>Entrada</b>.
                </p>
              </Field>
              <Field label="País origen/destino">
                <PickerButton value={paisOrigenDestino} placeholder="Buscar país…"
                  onClick={() => openPicker('pais', 'País extranjero de la operación', it => setPaisOrigenDestino(it.clave))} />
                <p className="mt-1 text-[11px] text-slate-500">
                  Es el país <b>extranjero</b>, no México.
                </p>
              </Field>
              <Field label="Vía de entrada/salida">
                <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded text-sm text-slate-700">
                  {medioLabel(medio)}
                  <span className="ml-2 text-[11px] font-mono text-red-600">{CLAVE_MEDIO[medio]}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Se toma del medio de transporte.</p>
              </Field>
              <Field label={PUNTO_LABEL[puntos.tipo] ?? 'Punto de entrada/salida'}>
                {puntos.tipo === 'cruce' ? (
                  <select value={cruceFronterizo} onChange={e => setCruceFronterizo(e.target.value)} className="input">
                    <option value="">Sin especificar</option>
                    {puntos.items.map((p: any) => (
                      <option key={p.clave} value={p.clave}>{p.descripcion}</option>
                    ))}
                  </select>
                ) : (
                  // Con 2 346 aeropuertos un desplegable es inservible: se busca.
                  <EstacionPicker
                    medio={CLAVE_MEDIO[medio]}
                    clave={cruceFronterizo}
                    nombre={puntoNombre}
                    onSelect={(clave, nombre) => { setCruceFronterizo(clave); setPuntoNombre(nombre); }}
                  />
                )}
                <p className="mt-1 text-[11px] text-slate-500">
                  {puntos.tipo === 'cruce'
                    ? 'Ayuda de captura, no viaja al SAT.'
                    : `Catálogo SAT de ${puntos.tipo === 'puerto' ? 'puertos' : 'aeropuertos'}.`}
                </p>
              </Field>
            </div>

            {/* Regímenes aduaneros: colección, no un solo valor */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-slate-700">
                  Régimen aduanero
                  {entradaSalidaMerc && (
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      filtrado para {entradaSalidaMerc.toLowerCase()}
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => openPicker(
                    'regimen-aduanero',
                    `Régimen aduanero${entradaSalidaMerc ? ` · ${entradaSalidaMerc}` : ''}`,
                    it => setRegimenes(r => r.includes(it.clave) ? r : [...r, it.clave]),
                    ['impoexpo'],
                  )}
                  className="btn-add"
                ><Plus size={14} /> Régimen</button>
              </div>
              {regimenes.length === 0 ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  Una operación internacional necesita al menos un régimen aduanero.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {regimenes.map(r => (
                    <span key={r} className="inline-flex items-center gap-2 px-2.5 py-1 bg-sky-50 border border-sky-200 rounded text-sm">
                      <span className="font-mono text-sky-800">{r}</span>
                      <button type="button" onClick={() => setRegimenes(x => x.filter(y => y !== r))}
                              className="text-slate-400 hover:text-red-600"><Trash2 size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-1 text-[11px] text-slate-500">
                Elegir un régimen de exportación en una entrada (o al revés) hace que el PAC rechace el comprobante.
              </p>
            </div>
          </div>
        )}
      </Section>

      {/* 2. Ubicaciones */}
      <Section title="2. Ubicaciones" icon={<MapPin size={16} />}
               action={<button onClick={() => setUbicaciones([...ubicaciones, blankUbicacion('Destino', ubicaciones)])} className="btn-add"><Plus size={14} /> Destino</button>}>
        <div className="space-y-3">
          {ubicaciones.map((u, i) => (
            <div key={i} className="border border-slate-200 rounded p-3 relative">
              {/* Barra de plantillas: cargar de catálogo o marcar para guardar */}
              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => setLugarPicker({ index: i, tipo: u.tipoUbicacion })}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded border border-emerald-200"
                >
                  <BookMarked size={12} /> Cargar plantilla
                </button>
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 ml-auto">
                  <input
                    type="checkbox"
                    checked={!!u.guardarEnCatalogo}
                    onChange={e => updateUbi(i, { guardarEnCatalogo: e.target.checked })}
                    className="rounded"
                  />
                  Guardar en Lugares frecuentes
                </label>
                {u.guardarEnCatalogo && (
                  <input
                    value={u.aliasCatalogo || ''}
                    onChange={e => updateUbi(i, { aliasCatalogo: e.target.value })}
                    placeholder="alias (auto si vacío)"
                    className="text-xs px-2 py-1 border border-slate-300 rounded"
                    style={{ maxWidth: 200 }}
                  />
                )}
              </div>
              <div className="grid grid-cols-6 gap-3">
                <Field label="Tipo">
                  <select value={u.tipoUbicacion} onChange={e => updateUbi(i, { tipoUbicacion: e.target.value as any })} className="input">
                    <option>Origen</option><option>Destino</option>
                  </select>
                </Field>
                <Field label="ID (OR001…/DE001…)">
                  <input value={u.idUbicacion} onChange={e => updateUbi(i, { idUbicacion: e.target.value })} className="input" />
                </Field>
                <Field label="RFC">
                  <input value={u.rfcRemitenteDestinatario} onChange={e => updateUbi(i, { rfcRemitenteDestinatario: e.target.value })} className="input font-mono" />
                </Field>
                <Field label="Nombre" span={2}>
                  <input value={u.nombreRemitenteDestinatario} onChange={e => updateUbi(i, { nombreRemitenteDestinatario: e.target.value })} className="input" />
                </Field>
                <Field label="Fecha y hora salida-llegada" span={2}>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={(u.fechaHoraSalidaLlegada || '').slice(0, 10)}
                      onChange={e => {
                        const time = (u.fechaHoraSalidaLlegada || '').slice(11, 16) || '08:00';
                        updateUbi(i, { fechaHoraSalidaLlegada: e.target.value ? `${e.target.value}T${time}` : '' });
                      }}
                      className="input flex-1"
                    />
                    <input
                      type="time"
                      value={(u.fechaHoraSalidaLlegada || '').slice(11, 16)}
                      onChange={e => {
                        const date = (u.fechaHoraSalidaLlegada || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
                        updateUbi(i, { fechaHoraSalidaLlegada: e.target.value ? `${date}T${e.target.value}` : date });
                      }}
                      className="input w-28"
                      step={60}
                    />
                  </div>
                </Field>
                <Field label="Calle" span={2}>
                  <input value={u.calle} onChange={e => updateUbi(i, { calle: e.target.value })} className="input" />
                </Field>
                <Field label="No. exterior">
                  <input value={u.numExterior} onChange={e => updateUbi(i, { numExterior: e.target.value })} className="input" />
                </Field>
                <Field label="No. interior">
                  <input value={u.numInterior} onChange={e => updateUbi(i, { numInterior: e.target.value })} className="input" />
                </Field>
                <CPGeoBlock
                  ubi={u}
                  onChange={(patch) => updateUbi(i, patch)}
                />
                <Field label="País (3)">
                  <input value={u.pais} onChange={e => updateUbi(i, { pais: e.target.value.toUpperCase() })} maxLength={3} className="input font-mono" />
                </Field>
                <Field label="Referencia" span={4}>
                  <input value={u.referencia} onChange={e => updateUbi(i, { referencia: e.target.value })} maxLength={500} className="input" placeholder="Entre calles, entrada, etc." />
                </Field>
                {/* Estación: el barco zarpa de un puerto y el avión de un
                    aeropuerto, cada ubicación del suyo. Un camión no. */}
                {USA_ESTACION(medio) && (
                  <>
                    <Field label="Tipo de estación">
                      <PickerButton value={u.tipoEstacion || ''} placeholder="Buscar…"
                        onClick={() => openPicker('tipo-estacion', 'Tipo de estación', it => updateUbi(i, { tipoEstacion: it.clave }), ['clave_transporte'])} />
                    </Field>
                    <Field label={ESTACION_LABEL[medio]} span={3}>
                      <EstacionPicker
                        medio={CLAVE_MEDIO[medio]}
                        clave={u.numEstacion || ''}
                        nombre={u.nombreEstacion || ''}
                        onSelect={(clave, nombre) => updateUbi(i, { numEstacion: clave, nombreEstacion: nombre })}
                      />
                    </Field>
                  </>
                )}
                {u.tipoUbicacion === 'Destino' && (
                  <Field label="Distancia (km)">
                    <input type="number" step="0.001" value={u.distanciaRecorrida ?? ''} onChange={e => updateUbi(i, { distanciaRecorrida: e.target.value })} className="input" />
                  </Field>
                )}
              </div>
              {ubicaciones.length > 2 && (
                <button onClick={() => setUbicaciones(ubicaciones.filter((_, j) => j !== i))} className="absolute top-2 right-2 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* 3. Mercancías */}
      <Section title="3. Mercancías" icon={<Package2 size={16} />}
               action={<button onClick={() => setMercancias([...mercancias, blankMercancia()])} className="btn-add"><Plus size={14} /> Mercancía</button>}>
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setMercPicker(mercancias.length - 1)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-rose-50 text-rose-700 rounded border border-rose-200 hover:bg-rose-100"
          >
            <BookMarked size={12} /> Cargar plantilla de mercancía (última fila)
          </button>
        </div>
        <div className="space-y-3">
          {mercancias.map((m, i) => (
            <div key={i} className="border border-slate-200 rounded p-3 relative">
              <div className="grid grid-cols-6 gap-3">
                <Field label="Clave prod/serv CP" span={2}>
                  <PickerButton value={m.bienesTransp} placeholder="Buscar…"
                    onClick={() => openPicker('clave-prod-serv', 'Clave de producto/servicio (CP)', it => updateMer(i, { bienesTransp: it.clave, descripcion: m.descripcion || it.descripcion, materialPeligroso: it.material_peligroso === '1' ? 'Si' : 'No' }))} />
                </Field>
                <Field label="Descripción" span={4}>
                  <input value={m.descripcion} onChange={e => updateMer(i, { descripcion: e.target.value })} className="input" />
                </Field>
                <Field label="Cantidad">
                  <input type="number" step="0.001" value={m.cantidad} onChange={e => updateMer(i, { cantidad: e.target.value })} className="input" />
                </Field>
                <Field label="Clave unidad">
                  <PickerButton value={m.claveUnidad} placeholder="Buscar…"
                    onClick={() => openPicker('clave-unidad-peso', 'Clave de unidad de peso', it => updateMer(i, { claveUnidad: it.clave }), ['nombre'])} />
                </Field>
                <Field label="Peso (kg)">
                  <input type="number" step="0.001" value={m.pesoEnKg} onChange={e => updateMer(i, { pesoEnKg: e.target.value })} className="input" />
                </Field>
                <Field label="Material peligroso">
                  <select value={m.materialPeligroso} onChange={e => updateMer(i, { materialPeligroso: e.target.value as any })} className="input">
                    <option>No</option><option>Si</option>
                  </select>
                </Field>
                <Field label="Valor mercancía">
                  <input type="number" step="0.01" value={m.valorMercancia} onChange={e => updateMer(i, { valorMercancia: e.target.value })} className="input" />
                </Field>
                <Field label="Moneda">
                  <input value={m.moneda} onChange={e => updateMer(i, { moneda: e.target.value.toUpperCase() })} maxLength={3} className="input font-mono" />
                </Field>
                {m.materialPeligroso === 'Si' && (
                  <>
                    <Field label="Cve material peligroso">
                      <PickerButton value={m.cveMaterialPeligroso} placeholder="Buscar…"
                        onClick={() => openPicker('material-peligroso', 'Material peligroso', it => updateMer(i, { cveMaterialPeligroso: it.clave }), ['clase_o_div'])} />
                    </Field>
                    <Field label="Embalaje">
                      <PickerButton value={m.embalaje} placeholder="Buscar…"
                        onClick={() => openPicker('tipo-embalaje', 'Tipo de embalaje', it => updateMer(i, { embalaje: it.clave }))} />
                    </Field>
                  </>
                )}
                {transpInternac === 'Si' && (
                  <>
                    <Field label="Fracción arancelaria">
                      <input value={m.fraccionArancelaria || ''} onChange={e => updateMer(i, { fraccionArancelaria: e.target.value })} maxLength={10} className="input font-mono" />
                    </Field>
                    <Field label="Tipo de materia">
                      <PickerButton value={m.tipoMateria || ''} placeholder="Buscar…"
                        onClick={() => openPicker('tipo-materia', 'Tipo de materia', it => updateMer(i, { tipoMateria: it.clave }))} />
                    </Field>
                  </>
                )}
              </div>

              {/* Documentación aduanera de ESTA mercancía. Va por mercancía y no
                  por carta porte: un mismo embarque puede llevar unas con
                  pedimento y otras nacionales. */}
              {transpInternac === 'Si' && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-slate-600">Documentación aduanera de esta mercancía</p>
                    <button type="button" onClick={() => updateMer(i, {
                      docsAduaneros: [...(m.docsAduaneros || []), { tipoDocumento: '', numPedimento: '', identDocAduanero: '', rfcImpo: '' }],
                    })} className="btn-add"><Plus size={12} /> Documento</button>
                  </div>
                  {(m.docsAduaneros || []).map((d, di) => {
                    const setDoc = (patch: Partial<DocAduaneraRow>) => updateMer(i, {
                      docsAduaneros: (m.docsAduaneros || []).map((x, xj) => xj === di ? { ...x, ...patch } : x),
                    });
                    const esPedimento = d.tipoDocumento === '01';
                    return (
                      <div key={di} className="grid grid-cols-6 gap-3 mb-2 items-start">
                        <Field label="Tipo de documento" span={2}>
                          <PickerButton value={d.tipoDocumento} placeholder="Buscar…"
                            onClick={() => openPicker('documento-aduanero', 'Tipo de documento aduanero', it => setDoc({ tipoDocumento: it.clave }))} />
                        </Field>
                        {esPedimento ? (
                          <Field label="Número de pedimento" span={2}>
                            <input value={d.numPedimento} onChange={e => setDoc({ numPedimento: e.target.value })} maxLength={21} className="input font-mono" />
                          </Field>
                        ) : (
                          <Field label="Identificador del documento" span={2}>
                            <input value={d.identDocAduanero} onChange={e => setDoc({ identDocAduanero: e.target.value })} maxLength={36} className="input font-mono"
                                   disabled={!d.tipoDocumento} placeholder={d.tipoDocumento ? '' : 'Elige primero el tipo'} />
                          </Field>
                        )}
                        <Field label="RFC importador">
                          <input value={d.rfcImpo} onChange={e => setDoc({ rfcImpo: e.target.value.toUpperCase() })} maxLength={13} className="input font-mono" />
                        </Field>
                        <div className="flex items-end h-full pb-2">
                          <button onClick={() => updateMer(i, {
                            docsAduaneros: (m.docsAduaneros || []).filter((_, xj) => xj !== di),
                          })} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    );
                  })}
                  {!(m.docsAduaneros || []).length && (
                    <p className="text-[11px] text-slate-500">
                      Solo si esta mercancía viene amparada por un pedimento o permiso. No toda mercancía de una operación internacional lo necesita.
                    </p>
                  )}
                </div>
              )}

              {mercancias.length > 1 && (
                <button onClick={() => setMercancias(mercancias.filter((_, j) => j !== i))} className="absolute top-2 right-2 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* 4. Medio de transporte */}
      <Section title={`4. Medio de transporte · ${medioLabel(medio)}`} icon={medioIcon(medio)}>
        {medio === 'auto' ? (
          <div className="space-y-3">
            <div>
              <button
                type="button"
                onClick={() => setAutoPickerOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-amber-50 text-amber-800 rounded border border-amber-200 hover:bg-amber-100"
              >
                <BookMarked size={12} /> Cargar plantilla de vehículo
              </button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <Field label="Tipo de permiso SCT">
                <PickerButton value={auto.permSct} placeholder="Buscar…"
                  onClick={() => openPicker('tipo-permiso', 'Tipo de permiso SCT', it => setAuto({ ...auto, permSct: it.clave }))} />
              </Field>
              <Field label="Número de permiso">
                <input value={auto.numPermisoSct} onChange={e => setAuto({ ...auto, numPermisoSct: e.target.value })} className="input" />
              </Field>
              <Field label="Config. vehicular">
                <PickerButton value={auto.configVehicular} placeholder="Buscar…"
                  onClick={() => openPicker('config-autotransporte', 'Configuración del vehículo', it => setAuto({ ...auto, configVehicular: it.clave }), ['numero_ejes', 'numero_llantas'])} />
              </Field>
              <Field label="Peso bruto (kg)">
                <input type="number" step="0.001" value={auto.pesoBrutoVehicular} onChange={e => setAuto({ ...auto, pesoBrutoVehicular: e.target.value })} className="input" />
              </Field>
              <Field label="Placa VM">
                <input value={auto.placaVm} onChange={e => setAuto({ ...auto, placaVm: e.target.value.toUpperCase() })} maxLength={7} className="input font-mono" />
              </Field>
              <Field label="Año modelo">
                <input type="number" value={auto.anioModeloVm} onChange={e => setAuto({ ...auto, anioModeloVm: e.target.value })} className="input" />
              </Field>
            </div>
            {/* Aseguradora Resp. Civil — plantilla independiente */}
            <div className="pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-slate-700">Aseguradora Responsabilidad Civil</p>
                <button
                  type="button"
                  onClick={() => setAsegPickerOpen('auto')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-sky-50 text-sky-700 rounded border border-sky-200 hover:bg-sky-100"
                >
                  <BookMarked size={12} /> Cargar plantilla de aseguradora
                </button>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <Field label="Aseguradora resp. civil" span={2}>
                  <input value={auto.aseguraRespCivil} onChange={e => setAuto({ ...auto, aseguraRespCivil: e.target.value })} className="input" />
                </Field>
                <Field label="No. Póliza resp. civil" span={2}>
                  <input value={auto.polizaRespCivil} onChange={e => setAuto({ ...auto, polizaRespCivil: e.target.value })} className="input font-mono" />
                </Field>
              </div>
            </div>
            {/* Remolques */}
            <div className="pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-slate-700">Remolques (máx. 2)</p>
                {remolques.length < 2 && (
                  <button onClick={() => setRemolques([...remolques, { subTipoRem: '', placa: '' }])} className="btn-add"><Plus size={14} /> Remolque</button>
                )}
              </div>
              {remolques.map((r, i) => (
                <div key={i} className="grid grid-cols-6 gap-3 mb-2">
                  <Field label="Subtipo remolque" span={2}>
                    <PickerButton value={r.subTipoRem} placeholder="Buscar…"
                      onClick={() => openPicker('sub-tipo-rem', 'Subtipo de remolque', it => setRemolques(remolques.map((x, j) => j === i ? { ...x, subTipoRem: it.clave } : x)))} />
                  </Field>
                  <Field label="Placa">
                    <input value={r.placa} onChange={e => setRemolques(remolques.map((x, j) => j === i ? { ...x, placa: e.target.value.toUpperCase() } : x))} maxLength={7} className="input font-mono" />
                  </Field>
                  <div className="col-span-3 flex items-end">
                    <button onClick={() => setRemolques(remolques.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600 pb-2"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : medio === 'maritimo' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-3">
              <Field label="Tipo de permiso SCT">
                <PickerButton value={maritimo.permSct} placeholder="Buscar…"
                  onClick={() => openPicker('tipo-permiso', 'Tipo de permiso SCT', it => setMaritimo({ ...maritimo, permSct: it.clave }))} />
              </Field>
              <Field label="Número de permiso">
                <input value={maritimo.numPermisoSct} onChange={e => setMaritimo({ ...maritimo, numPermisoSct: e.target.value })} className="input" />
              </Field>
              <Field label="Tipo de embarcación">
                <PickerButton value={maritimo.tipoEmbarcacion} placeholder="Buscar…"
                  onClick={() => openPicker('config-maritima', 'Tipo de embarcación', it => setMaritimo({ ...maritimo, tipoEmbarcacion: it.clave }))} />
              </Field>
              <Field label="Tipo de carga">
                <PickerButton value={maritimo.tipoCarga} placeholder="Buscar…"
                  onClick={() => openPicker('clave-tipo-carga', 'Tipo de carga', it => setMaritimo({ ...maritimo, tipoCarga: it.clave }))} />
              </Field>
            </div>

            <div className="pt-3 border-t border-slate-200">
              <p className="text-sm font-medium text-slate-700 mb-2">Embarcación</p>
              <div className="grid grid-cols-4 gap-3">
                <Field label="Nombre">
                  <input value={maritimo.nombreEmbarc} onChange={e => setMaritimo({ ...maritimo, nombreEmbarc: e.target.value })} maxLength={50} className="input" />
                </Field>
                <Field label="Matrícula">
                  <input value={maritimo.matricula} onChange={e => setMaritimo({ ...maritimo, matricula: e.target.value.toUpperCase() })} maxLength={10} className="input font-mono" />
                </Field>
                <Field label="Número OMI">
                  <input value={maritimo.numeroOmi} onChange={e => setMaritimo({ ...maritimo, numeroOmi: e.target.value.toUpperCase() })} maxLength={10} placeholder="IMO1234567" className="input font-mono" />
                  <p className="mt-1 text-[11px] text-slate-500">7 dígitos, con o sin el prefijo IMO.</p>
                </Field>
                <Field label="Nacionalidad">
                  <PickerButton value={maritimo.nacionalidadEmbarc} placeholder="País…"
                    onClick={() => openPicker('pais', 'Nacionalidad de la embarcación', it => setMaritimo({ ...maritimo, nacionalidadEmbarc: it.clave }))} />
                </Field>
                <Field label="Año">
                  <input type="number" value={maritimo.anioEmbarcacion} onChange={e => setMaritimo({ ...maritimo, anioEmbarcacion: e.target.value })} className="input" />
                </Field>
                <Field label="Arqueo bruto">
                  <input type="number" step="0.01" value={maritimo.unidadesArqBruto} onChange={e => setMaritimo({ ...maritimo, unidadesArqBruto: e.target.value })} className="input" />
                </Field>
                <Field label="Certificado ITC">
                  <input value={maritimo.numCertItc} onChange={e => setMaritimo({ ...maritimo, numCertItc: e.target.value })} maxLength={20} className="input font-mono" />
                </Field>
                <div />
                <Field label="Eslora (m)">
                  <input type="number" step="0.01" value={maritimo.eslora} onChange={e => setMaritimo({ ...maritimo, eslora: e.target.value })} className="input" />
                </Field>
                <Field label="Manga (m)">
                  <input type="number" step="0.01" value={maritimo.manga} onChange={e => setMaritimo({ ...maritimo, manga: e.target.value })} className="input" />
                </Field>
                <Field label="Calado (m)">
                  <input type="number" step="0.01" value={maritimo.calado} onChange={e => setMaritimo({ ...maritimo, calado: e.target.value })} className="input" />
                </Field>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200">
              <p className="text-sm font-medium text-slate-700 mb-2">Naviera y viaje</p>
              <div className="grid grid-cols-4 gap-3">
                <Field label="Línea naviera">
                  <input value={maritimo.lineaNaviera} onChange={e => setMaritimo({ ...maritimo, lineaNaviera: e.target.value })} className="input" />
                </Field>
                <Field label="Agente naviero" span={2}>
                  <input value={maritimo.nombreAgenteNaviero} onChange={e => setMaritimo({ ...maritimo, nombreAgenteNaviero: e.target.value })} className="input" />
                </Field>
                <Field label="No. autorización naviero">
                  <PickerButton value={maritimo.numAutorizacionNaviero} placeholder="Buscar…"
                    onClick={() => openPicker('num-autorizacion-naviero', 'Número de autorización del naviero', it => setMaritimo({ ...maritimo, numAutorizacionNaviero: it.clave }))} />
                </Field>
                <Field label="Número de viaje">
                  <input value={maritimo.numViaje} onChange={e => setMaritimo({ ...maritimo, numViaje: e.target.value })} maxLength={10} className="input font-mono" />
                </Field>
                <Field label="Conocimiento de embarque" span={2}>
                  <input value={maritimo.numConocimientoEmbarque} onChange={e => setMaritimo({ ...maritimo, numConocimientoEmbarque: e.target.value })} maxLength={20} className="input font-mono" />
                </Field>
                <Field label="Permiso temp. navegación">
                  <input value={maritimo.permisoTempNavegacion} onChange={e => setMaritimo({ ...maritimo, permisoTempNavegacion: e.target.value })} maxLength={10} className="input font-mono" />
                </Field>
                <Field label="Aseguradora" span={2}>
                  <div className="flex gap-1.5">
                    <input value={maritimo.nombreAseg} onChange={e => setMaritimo({ ...maritimo, nombreAseg: e.target.value })} className="input flex-1" />
                    <button
                      type="button"
                      title="Cargar plantilla de aseguradora"
                      onClick={() => setAsegPickerOpen('maritimo')}
                      className="shrink-0 px-2 bg-sky-50 text-sky-700 rounded border border-sky-200 hover:bg-sky-100"
                    ><BookMarked size={14} /></button>
                  </div>
                </Field>
                <Field label="No. póliza" span={2}>
                  <input value={maritimo.numPolizaSeguro} onChange={e => setMaritimo({ ...maritimo, numPolizaSeguro: e.target.value })} className="input font-mono" />
                </Field>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-slate-700">Contenedores</p>
                <button type="button" onClick={() => setContMaritimos([...contMaritimos, {
                  matriculaContenedor: '', tipoContenedor: '', numPrecinto: '',
                  idCcpRelacionado: '', placaVmCcp: '', fechaCertificacionCcp: '',
                }])} className="btn-add"><Plus size={14} /> Contenedor</button>
              </div>
              {contMaritimos.map((k, i) => (
                <div key={i} className="grid grid-cols-6 gap-3 mb-2 items-start">
                  <Field label="Matrícula">
                    <input value={k.matriculaContenedor} onChange={e => setContMaritimos(contMaritimos.map((x, j) => j === i ? { ...x, matriculaContenedor: e.target.value.toUpperCase() } : x))} maxLength={10} className="input font-mono" />
                  </Field>
                  <Field label="Tipo">
                    <PickerButton value={k.tipoContenedor} placeholder="Buscar…"
                      onClick={() => openPicker('contenedor-maritimo', 'Tipo de contenedor marítimo', it => setContMaritimos(contMaritimos.map((x, j) => j === i ? { ...x, tipoContenedor: it.clave } : x)))} />
                  </Field>
                  <Field label="Precinto">
                    <input value={k.numPrecinto} onChange={e => setContMaritimos(contMaritimos.map((x, j) => j === i ? { ...x, numPrecinto: e.target.value } : x))} maxLength={20} className="input font-mono" />
                  </Field>
                  <Field label="Placa que lo recoge">
                    <input value={k.placaVmCcp} onChange={e => setContMaritimos(contMaritimos.map((x, j) => j === i ? { ...x, placaVmCcp: e.target.value.toUpperCase() } : x))} maxLength={7} className="input font-mono" />
                  </Field>
                  <Field label="Fecha certificación">
                    <input type="date" value={k.fechaCertificacionCcp} onChange={e => setContMaritimos(contMaritimos.map((x, j) => j === i ? { ...x, fechaCertificacionCcp: e.target.value } : x))} className="input" />
                  </Field>
                  <div className="flex items-end h-full pb-2">
                    <button onClick={() => setContMaritimos(contMaritimos.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : medio === 'aereo' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-3">
              <Field label="Tipo de permiso SCT">
                <PickerButton value={aereo.permSct} placeholder="Buscar…"
                  onClick={() => openPicker('tipo-permiso', 'Tipo de permiso SCT', it => setAereo({ ...aereo, permSct: it.clave }))} />
              </Field>
              <Field label="Número de permiso">
                <input value={aereo.numPermisoSct} onChange={e => setAereo({ ...aereo, numPermisoSct: e.target.value })} className="input" />
              </Field>
              <Field label="Matrícula de aeronave">
                <input value={aereo.matriculaAeronave} onChange={e => setAereo({ ...aereo, matriculaAeronave: e.target.value.toUpperCase() })} maxLength={10} className="input font-mono" />
              </Field>
              <Field label="Código del transportista">
                <PickerButton value={aereo.codigoTransportista} placeholder="Buscar aerolínea…"
                  onClick={() => openPicker('codigo-transporte-aereo', 'Código del transportista aéreo', it => setAereo({ ...aereo, codigoTransportista: it.clave }), ['nombre_aerolinea', 'nacionalidad'])} />
              </Field>
              <Field label="Número de guía aérea" span={2}>
                <input value={aereo.numeroGuia} onChange={e => setAereo({ ...aereo, numeroGuia: e.target.value })} maxLength={23} className="input font-mono" />
                <p className="mt-1 text-[11px] text-slate-500">
                  Si el embarque se parte en dos vuelos, cada vuelo lleva su propia guía y su propia carta porte.
                </p>
              </Field>
              <Field label="Lugar del contrato" span={2}>
                <input value={aereo.lugarContrato} onChange={e => setAereo({ ...aereo, lugarContrato: e.target.value })} className="input" />
              </Field>
            </div>

            <div className="pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-slate-700">Seguro</p>
                <button
                  type="button"
                  onClick={() => setAsegPickerOpen('aereo')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-sky-50 text-sky-700 rounded border border-sky-200 hover:bg-sky-100"
                >
                  <BookMarked size={12} /> Cargar plantilla de aseguradora
                </button>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <Field label="Aseguradora" span={2}>
                  <input value={aereo.nombreAseg} onChange={e => setAereo({ ...aereo, nombreAseg: e.target.value })} className="input" />
                </Field>
                <Field label="No. póliza" span={2}>
                  <input value={aereo.numPolizaSeguro} onChange={e => setAereo({ ...aereo, numPolizaSeguro: e.target.value })} className="input font-mono" />
                </Field>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200">
              <p className="text-sm font-medium text-slate-700 mb-2">Embarcador</p>
              <div className="grid grid-cols-4 gap-3">
                <Field label="Nombre" span={2}>
                  <input value={aereo.nombreEmbarcador} onChange={e => setAereo({ ...aereo, nombreEmbarcador: e.target.value })} className="input" />
                </Field>
                <Field label="RFC">
                  <input value={aereo.rfcEmbarcador} onChange={e => setAereo({ ...aereo, rfcEmbarcador: e.target.value.toUpperCase() })} maxLength={13} className="input font-mono" />
                </Field>
                <Field label="Residencia fiscal">
                  <PickerButton value={aereo.residenciaFiscalEmbarc} placeholder="País…"
                    onClick={() => openPicker('pais', 'Residencia fiscal del embarcador', it => setAereo({ ...aereo, residenciaFiscalEmbarc: it.clave }))} />
                </Field>
                {aereo.residenciaFiscalEmbarc && aereo.residenciaFiscalEmbarc !== 'MEX' && (
                  <Field label="Registro tributario (Tax ID)" span={2}>
                    <input value={aereo.numRegIdTribEmbarc} onChange={e => setAereo({ ...aereo, numRegIdTribEmbarc: e.target.value })} maxLength={40} className="input font-mono" />
                  </Field>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-3">
              <Field label="Tipo de servicio">
                <PickerButton value={ferro.tipoDeServicio} placeholder="Buscar…"
                  onClick={() => openPicker('tipo-de-servicio', 'Tipo de servicio ferroviario', it => setFerro({ ...ferro, tipoDeServicio: it.clave }))} />
              </Field>
              <Field label="Tipo de tráfico">
                <PickerButton value={ferro.tipoDeTrafico} placeholder="Buscar…"
                  onClick={() => openPicker('tipo-de-trafico', 'Tipo de tráfico ferroviario', it => setFerro({ ...ferro, tipoDeTrafico: it.clave }))} />
              </Field>
              <Field label="Aseguradora">
                <div className="flex gap-1.5">
                  <input value={ferro.nombreAseg} onChange={e => setFerro({ ...ferro, nombreAseg: e.target.value })} className="input flex-1" />
                  <button
                    type="button"
                    title="Cargar plantilla de aseguradora"
                    onClick={() => setAsegPickerOpen('ferroviario')}
                    className="shrink-0 px-2 bg-sky-50 text-sky-700 rounded border border-sky-200 hover:bg-sky-100"
                  ><BookMarked size={14} /></button>
                </div>
              </Field>
              <Field label="No. póliza">
                <input value={ferro.numPolizaSeguro} onChange={e => setFerro({ ...ferro, numPolizaSeguro: e.target.value })} className="input font-mono" />
              </Field>
            </div>

            <div className="pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-slate-700">Derechos de paso</p>
                <button type="button" onClick={() => setDerechosPaso([...derechosPaso, { tipoDerechoDePaso: '', kilometrajePagado: '' }])} className="btn-add"><Plus size={14} /> Derecho de paso</button>
              </div>
              {derechosPaso.map((d, i) => (
                <div key={i} className="grid grid-cols-6 gap-3 mb-2 items-start">
                  <Field label="Tipo" span={2}>
                    <PickerButton value={d.tipoDerechoDePaso} placeholder="Buscar…"
                      onClick={() => openPicker('derechos-de-paso', 'Tipo de derecho de paso', it => setDerechosPaso(derechosPaso.map((x, j) => j === i ? { ...x, tipoDerechoDePaso: it.clave } : x)))} />
                  </Field>
                  <Field label="Kilometraje pagado">
                    <input type="number" step="0.01" value={d.kilometrajePagado} onChange={e => setDerechosPaso(derechosPaso.map((x, j) => j === i ? { ...x, kilometrajePagado: e.target.value } : x))} className="input" />
                  </Field>
                  <div className="col-span-3 flex items-end h-full pb-2">
                    <button onClick={() => setDerechosPaso(derechosPaso.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-slate-700">Carros ferroviarios</p>
                <button type="button" onClick={() => setCarros([...carros, {
                  tipoCarro: '', matriculaCarro: '', guiaCarro: '', toneladasNetasCarro: '', contenedores: [],
                }])} className="btn-add"><Plus size={14} /> Carro</button>
              </div>
              {carros.length === 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  El transporte ferroviario necesita al menos un carro para poder timbrar.
                </p>
              )}
              {carros.map((c, i) => (
                <div key={i} className="border border-slate-200 rounded p-3 mb-2 relative">
                  <div className="grid grid-cols-4 gap-3">
                    <Field label="Tipo de carro">
                      <PickerButton value={c.tipoCarro} placeholder="Buscar…"
                        onClick={() => openPicker('tipo-carro', 'Tipo de carro', it => setCarros(carros.map((x, j) => j === i ? { ...x, tipoCarro: it.clave } : x)))} />
                    </Field>
                    <Field label="Matrícula">
                      <input value={c.matriculaCarro} onChange={e => setCarros(carros.map((x, j) => j === i ? { ...x, matriculaCarro: e.target.value.toUpperCase() } : x))} maxLength={10} className="input font-mono" />
                    </Field>
                    <Field label="Guía del carro">
                      <input value={c.guiaCarro} onChange={e => setCarros(carros.map((x, j) => j === i ? { ...x, guiaCarro: e.target.value } : x))} maxLength={36} className="input font-mono" />
                    </Field>
                    <Field label="Toneladas netas">
                      <input type="number" step="0.01" value={c.toneladasNetasCarro} onChange={e => setCarros(carros.map((x, j) => j === i ? { ...x, toneladasNetasCarro: e.target.value } : x))} className="input" />
                    </Field>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-medium text-slate-600">Contenedores de este carro</p>
                      <button type="button" onClick={() => setCarros(carros.map((x, j) => j === i
                        ? { ...x, contenedores: [...x.contenedores, { tipoContenedor: '', pesoContenedorVacio: '', pesoNetoMercancia: '' }] }
                        : x))} className="btn-add"><Plus size={12} /> Contenedor</button>
                    </div>
                    {c.contenedores.map((k, ki) => (
                      <div key={ki} className="grid grid-cols-6 gap-3 mb-2 items-start">
                        <Field label="Tipo" span={2}>
                          <PickerButton value={k.tipoContenedor} placeholder="Buscar…"
                            onClick={() => openPicker('contenedor', 'Tipo de contenedor ferroviario', it => setCarros(carros.map((x, j) => j === i
                              ? { ...x, contenedores: x.contenedores.map((y, yj) => yj === ki ? { ...y, tipoContenedor: it.clave } : y) }
                              : x)))} />
                        </Field>
                        <Field label="Peso vacío (t)">
                          <input type="number" step="0.01" value={k.pesoContenedorVacio} onChange={e => setCarros(carros.map((x, j) => j === i
                            ? { ...x, contenedores: x.contenedores.map((y, yj) => yj === ki ? { ...y, pesoContenedorVacio: e.target.value } : y) }
                            : x))} className="input" />
                        </Field>
                        <Field label="Peso neto mercancía (t)">
                          <input type="number" step="0.01" value={k.pesoNetoMercancia} onChange={e => setCarros(carros.map((x, j) => j === i
                            ? { ...x, contenedores: x.contenedores.map((y, yj) => yj === ki ? { ...y, pesoNetoMercancia: e.target.value } : y) }
                            : x))} className="input" />
                        </Field>
                        <div className="col-span-2 flex items-end h-full pb-2">
                          <button onClick={() => setCarros(carros.map((x, j) => j === i
                            ? { ...x, contenedores: x.contenedores.filter((_, yj) => yj !== ki) }
                            : x))} className="text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button onClick={() => setCarros(carros.filter((_, j) => j !== i))}
                          className="absolute top-2 right-2 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* 5. Figuras */}
      <Section title="5. Figuras de transporte" icon={<UserCog size={16} />}
               action={<button onClick={() => setFiguras([...figuras, blankFigura()])} className="btn-add"><Plus size={14} /> Figura</button>}>
        <div className="space-y-3">
          {figuras.map((f, i) => (
            <div key={i} className="border border-slate-200 rounded p-3 relative">
              <div className="mb-2">
                <button
                  type="button"
                  onClick={() => setFigPicker(i)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-sky-50 text-sky-700 rounded border border-sky-200 hover:bg-sky-100"
                >
                  <BookMarked size={12} /> Cargar plantilla de operador/figura
                </button>
              </div>
              <div className="grid grid-cols-6 gap-3">
                <Field label="Tipo figura">
                  <PickerButton value={f.tipoFigura} placeholder="01=Operador"
                    onClick={() => openPicker('figura-transporte', 'Tipo de figura', it => setFiguras(figuras.map((x, j) => j === i ? { ...x, tipoFigura: it.clave } : x)))} />
                </Field>
                <Field label="RFC">
                  <input value={f.rfcFigura} onChange={e => setFiguras(figuras.map((x, j) => j === i ? { ...x, rfcFigura: e.target.value.toUpperCase() } : x))} className="input font-mono" />
                </Field>
                <Field label="No. licencia">
                  <input value={f.numLicencia} onChange={e => setFiguras(figuras.map((x, j) => j === i ? { ...x, numLicencia: e.target.value } : x))} className="input" />
                </Field>
                <Field label="Nombre" span={3}>
                  <input value={f.nombreFigura} onChange={e => setFiguras(figuras.map((x, j) => j === i ? { ...x, nombreFigura: e.target.value } : x))} className="input" />
                </Field>
              </div>
              {figuras.length > 1 && (
                <button onClick={() => setFiguras(figuras.filter((_, j) => j !== i))} className="absolute top-2 right-2 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
              )}
            </div>
          ))}
        </div>
      </Section>

      {picker && <CatalogPicker {...picker} open={true} onClose={() => setPicker(null)} />}
      {lugarPicker && (
        <LugarPicker
          open={true}
          tipo={lugarPicker.tipo}
          onClose={() => setLugarPicker(null)}
          onSelect={(l) => {
            // Reemplaza la ubicación en el índice con los datos del lugar.
            const otras = ubicaciones.filter((_, j) => j !== lugarPicker.index);
            const nueva = ubicacionDesdeLugar(l, lugarPicker.tipo, otras);
            setUbicaciones(ubicaciones.map((u, j) => j === lugarPicker.index ? {
              ...nueva,
              // Conservamos fecha y distancia si el usuario ya las escribió
              fechaHoraSalidaLlegada: u.fechaHoraSalidaLlegada || '',
              distanciaRecorrida: u.distanciaRecorrida ?? nueva.distanciaRecorrida,
            } : u));
            setLugarPicker(null);
          }}
        />
      )}
      {mercPicker !== null && (
        <TemplatePicker
          title="Mercancías guardadas"
          color="rose"
          fetchFn={(q) => api.listMercanciasCatalog({ search: q || undefined }).then(r => r.items)}
          renderItem={(m) => (
            <div>
              <p className="text-sm font-medium">{m.descripcion}</p>
              <p className="text-xs text-slate-500 font-mono">SAT {m.clave_sat} · {m.clave_unidad || '—'} · {m.peso_unitario_kg ? `${Number(m.peso_unitario_kg).toFixed(2)} kg/u` : ''}</p>
              {m.cliente_nombre && <p className="text-[10px] text-slate-400">Cliente típico: {m.cliente_nombre}</p>}
              <p className="text-[10px] text-slate-400">{m.veces_transportada} viajes</p>
            </div>
          )}
          onClose={() => setMercPicker(null)}
          onSelect={(m) => {
            const idx = mercPicker;
            setMercancias(mercancias.map((x, j) => j === idx ? {
              ...x,
              bienesTransp: m.clave_sat,
              descripcion: m.descripcion,
              claveUnidad: m.clave_unidad || x.claveUnidad,
              pesoEnKg: m.peso_unitario_kg ? String(m.peso_unitario_kg) : x.pesoEnKg,
              valorMercancia: m.valor_unitario ? String(m.valor_unitario) : x.valorMercancia,
              moneda: m.moneda || x.moneda,
            } : x));
            setMercPicker(null);
          }}
        />
      )}
      {autoPickerOpen && (
        <TemplatePicker
          title="Vehículos guardados"
          color="amber"
          fetchFn={(q) => api.listCPVehiculos(q || undefined)}
          renderItem={(v) => (
            <div>
              <p className="text-sm font-medium">{v.alias}</p>
              <p className="text-xs text-slate-500 font-mono">Placa {v.placa_vm} · {v.config_vehicular} · {v.anio_modelo_vm}</p>
              <p className="text-[10px] text-slate-400">Peso bruto {v.peso_bruto_vehicular} t · Permiso {v.perm_sct}</p>
            </div>
          )}
          onClose={() => setAutoPickerOpen(false)}
          onSelect={(v) => {
            setAuto({
              permSct: v.perm_sct || '',
              numPermisoSct: v.num_permiso_sct || '',
              configVehicular: v.config_vehicular || '',
              pesoBrutoVehicular: v.peso_bruto_vehicular ? String(v.peso_bruto_vehicular) : '',
              placaVm: v.placa_vm || '',
              anioModeloVm: v.anio_modelo_vm ? String(v.anio_modelo_vm) : String(new Date().getFullYear()),
              aseguraRespCivil: v.asegura_resp_civil_nombre || auto.aseguraRespCivil,
              polizaRespCivil: v.poliza_resp_civil || auto.polizaRespCivil,
            });
            setAutoPickerOpen(false);
          }}
        />
      )}
      {asegPickerOpen && (
        <TemplatePicker
          title={asegPickerOpen === 'auto'
            ? 'Aseguradoras de Responsabilidad Civil'
            : `Aseguradoras · ${medioLabel(asegPickerOpen)}`}
          color="sky"
          // Autotransporte pide expresamente la de responsabilidad civil; las
          // otras modalidades llevan una sola póliza genérica, así que se
          // muestran todas para no esconderle al usuario la que sí tiene.
          fetchFn={(q) => api.listCPAseguradoras(
            q || undefined,
            asegPickerOpen === 'auto' ? 'RespCivil' : undefined,
          )}
          renderItem={(a: any) => (
            <div>
              <p className="text-sm font-medium">{a.nombre_aseguradora}</p>
              <p className="text-xs text-slate-500 font-mono">Póliza {a.num_poliza}</p>
              <p className="text-[10px] text-slate-400">Tipo {a.tipo} · {a.alias || ''}</p>
            </div>
          )}
          onClose={() => setAsegPickerOpen(null)}
          onSelect={(a: any) => {
            const nombre = a.nombre_aseguradora || '';
            const poliza = a.num_poliza || '';
            // Cada modalidad guarda la póliza en sus propios campos.
            if (asegPickerOpen === 'auto') {
              setAuto(s => ({ ...s, aseguraRespCivil: nombre, polizaRespCivil: poliza }));
            } else if (asegPickerOpen === 'maritimo') {
              setMaritimo(s => ({ ...s, nombreAseg: nombre, numPolizaSeguro: poliza }));
            } else if (asegPickerOpen === 'aereo') {
              setAereo(s => ({ ...s, nombreAseg: nombre, numPolizaSeguro: poliza }));
            } else {
              setFerro(s => ({ ...s, nombreAseg: nombre, numPolizaSeguro: poliza }));
            }
            setAsegPickerOpen(null);
          }}
        />
      )}
      {figPicker !== null && (
        <TemplatePicker
          title="Operadores / Figuras de transporte"
          color="sky"
          fetchFn={(q) => api.listCPOperadores(q || undefined)}
          renderItem={(o) => (
            <div>
              <p className="text-sm font-medium">{o.nombre || o.alias}</p>
              <p className="text-xs text-slate-500 font-mono">RFC {o.rfc || '—'} · Lic {o.num_licencia || '—'}</p>
              <p className="text-[10px] text-slate-400">Tipo {o.tipo_figura}</p>
            </div>
          )}
          onClose={() => setFigPicker(null)}
          onSelect={(o) => {
            const idx = figPicker;
            setFiguras(figuras.map((x, j) => j === idx ? {
              tipoFigura: o.tipo_figura || '01',
              rfcFigura: o.rfc || '',
              numLicencia: o.num_licencia || '',
              nombreFigura: o.nombre || '',
            } : x));
            setFigPicker(null);
          }}
        />
      )}
    </div>
  );

  function updateUbi(i: number, patch: Partial<UbicacionRow>) {
    setUbicaciones(ubicaciones.map((u, j) => j === i ? { ...u, ...patch } : u));
  }
  function updateMer(i: number, patch: Partial<MercanciaRow>) {
    setMercancias(mercancias.map((m, j) => j === i ? { ...m, ...patch } : m));
  }
}

/* ─── Template picker genérico para mercancías / vehículos / operadores ── */

function TemplatePicker<T extends { id: string }>({
  title, color, fetchFn, renderItem, onClose, onSelect,
}: {
  title: string;
  color: 'rose' | 'amber' | 'sky';
  fetchFn: (q: string) => Promise<T[]>;
  renderItem: (item: T) => React.ReactNode;
  onClose: () => void;
  onSelect: (item: T) => void;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try { setItems(await fetchFn(q)); } finally { setLoading(false); }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const ringColor = color === 'rose' ? 'focus:ring-rose-500' : color === 'amber' ? 'focus:ring-amber-500' : 'focus:ring-sky-500';
  const hoverBg   = color === 'rose' ? 'hover:bg-rose-50' : color === 'amber' ? 'hover:bg-amber-50' : 'hover:bg-sky-50';
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-16" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[720px] max-w-[92vw] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="px-4 py-3 border-b border-slate-200">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar…"
              className={`w-full pl-9 pr-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 ${ringColor}`}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-center text-sm text-slate-400">Buscando…</p>
          ) : items.length === 0 ? (
            <p className="p-4 text-center text-sm text-slate-400">
              {q ? 'Sin resultados' : 'Aún no hay plantillas guardadas. Impórtalas con el Super Lector XML.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map(it => (
                <li key={it.id}>
                  <button onClick={() => onSelect(it)} className={`w-full text-left px-4 py-3 ${hoverBg}`}>
                    {renderItem(it)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── UI helpers ───────────────────────────────────────────────────── */

/**
 * CPGeoBlock — bloque de captura geográfica dependiente del CP.
 *
 * Al escribir CP de 5 dígitos, consulta /carta-porte/cp/:CP y precarga:
 *   · lista de colonias del CP → dropdown
 *   · estado inferido (por rango de CP oficial SAT) → auto-set
 *   · municipios del estado → dropdown
 *   · localidades del estado → dropdown
 * El usuario elige de listas en lugar de teclear claves. Si el CP no está
 * en catálogo, cae a captura manual (text input).
 */
function CPGeoBlock({ ubi, onChange }: {
  ubi: UbicacionRow;
  onChange: (patch: Partial<UbicacionRow>) => void;
}) {
  const [data, setData] = useState<{
    colonias: Array<{ clave: string; descripcion: string }>;
    municipios: Array<{ clave: string; descripcion: string }>;
    localidades: Array<{ clave: string; descripcion: string }>;
    estado: string | null;
    estadoDescripcion: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const cp = String(ubi.codigoPostal || '').trim();
    if (!/^\d{5}$/.test(cp)) { setData(null); setNotFound(false); return; }
    let cancelled = false;
    setLoading(true); setNotFound(false);
    api.resolveCP(cp).then(r => {
      if (cancelled) return;
      setData(r);
      // Auto-set estado si viene vacío o distinto
      if (r.estado && r.estado !== ubi.estado) onChange({ estado: r.estado });
      if ((!r.colonias || r.colonias.length === 0)) setNotFound(true);
    }).catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ubi.codigoPostal]);

  return (
    <>
      <Field label="CP (5)">
        <input
          value={ubi.codigoPostal}
          onChange={e => onChange({ codigoPostal: e.target.value.replace(/\D/g, '').slice(0, 5) })}
          maxLength={5}
          className="input font-mono"
          placeholder="20126"
        />
      </Field>
      {/* Colonia — combo con descripción; clave SAT en badge chiquito abajo */}
      <Field label={`Colonia ${loading ? '(cargando…)' : data?.colonias?.length ? `(${data.colonias.length})` : ''}`} span={2}>
        {data?.colonias && data.colonias.length > 0 ? (
          <div>
            <select
              value={data.colonias.some(c => c.clave === ubi.colonia) ? ubi.colonia : (ubi.colonia ? '__OTRA__' : '')}
              onChange={e => onChange({ colonia: e.target.value === '__OTRA__' ? ' ' : e.target.value })}
              className="input"
            >
              <option value="">— elige colonia —</option>
              {data.colonias.map(c => (
                <option key={c.clave} value={c.clave}>{c.descripcion}</option>
              ))}
              <option value="__OTRA__">✎ Otra no especificada…</option>
            </select>
            {ubi.colonia && data.colonias.some(c => c.clave === ubi.colonia) && (
              <p className="text-[10px] text-red-600 mt-0.5 font-mono">Clave SAT: {ubi.colonia}</p>
            )}
          </div>
        ) : (
          <input
            value={ubi.colonia}
            onChange={e => onChange({ colonia: e.target.value })}
            maxLength={60}
            className={`input ${notFound ? 'bg-emerald-50 border-emerald-300' : ''}`}
            placeholder={notFound ? 'CP no en catálogo — captura manual' : 'Colonia'}
          />
        )}
      </Field>
      {/* Municipio */}
      <Field label={`Municipio ${data?.estado ? `de ${data.estado}` : ''}`}>
        {data?.municipios && data.municipios.length > 0 ? (
          <div>
            <select
              value={data.municipios.some(m => m.clave === ubi.municipio) ? ubi.municipio : (ubi.municipio ? '__OTRO__' : '')}
              onChange={e => onChange({ municipio: e.target.value === '__OTRO__' ? ' ' : e.target.value })}
              className="input"
            >
              <option value="">— municipio —</option>
              {data.municipios.map(m => (
                <option key={m.clave} value={m.clave}>{m.descripcion}</option>
              ))}
              <option value="__OTRO__">✎ Otro…</option>
            </select>
            {ubi.municipio && data.municipios.some(m => m.clave === ubi.municipio) && (
              <p className="text-[10px] text-red-600 mt-0.5 font-mono">Clave SAT: {ubi.municipio}</p>
            )}
          </div>
        ) : (
          <input value={ubi.municipio} onChange={e => onChange({ municipio: e.target.value })} maxLength={60} className="input" />
        )}
      </Field>
      {/* Localidad */}
      <Field label="Localidad">
        {data?.localidades && data.localidades.length > 0 ? (
          <div>
            <select
              value={data.localidades.some(l => l.clave === ubi.localidad) ? ubi.localidad : (ubi.localidad ? '__OTRA__' : '')}
              onChange={e => onChange({ localidad: e.target.value === '__OTRA__' ? ' ' : e.target.value })}
              className="input"
            >
              <option value="">— localidad —</option>
              {data.localidades.map(l => (
                <option key={l.clave} value={l.clave}>{l.descripcion}</option>
              ))}
              <option value="__OTRA__">✎ Otra…</option>
            </select>
            {ubi.localidad && data.localidades.some(l => l.clave === ubi.localidad) && (
              <p className="text-[10px] text-red-600 mt-0.5 font-mono">Clave SAT: {ubi.localidad}</p>
            )}
          </div>
        ) : (
          <input value={ubi.localidad} onChange={e => onChange({ localidad: e.target.value })} maxLength={60} className="input" />
        )}
      </Field>
      <Field label="Estado">
        <div>
          {data?.estadoDescripcion ? (
            <input
              value={data.estadoDescripcion}
              readOnly
              className="input bg-slate-50 text-slate-700"
              title={`Auto-inferido del CP · Clave SAT ${ubi.estado}`}
            />
          ) : (
            <input
              value={ubi.estado}
              onChange={e => onChange({ estado: e.target.value.toUpperCase() })}
              maxLength={3}
              className="input font-mono"
              placeholder="AGU"
            />
          )}
          {ubi.estado && (
            <p className="text-[10px] text-red-600 mt-0.5 font-mono">Clave SAT: {ubi.estado}</p>
          )}
        </div>
      </Field>
    </>
  );
}

/**
 * Buscador de estación para una ubicación. Va con typeahead y no con un
 * `<select>` porque el catálogo del SAT trae 2 346 aeropuertos y 2 811
 * estaciones ferroviarias: desplegarlos todos es inservible.
 *
 * Guarda las dos cosas que pide el SAT — NumEstacion y NombreEstacion — de un
 * solo golpe, para que no puedan quedar desparejados.
 */
function EstacionPicker({ medio, clave, nombre, onSelect }: {
  medio: string;
  clave: string;
  nombre: string;
  onSelect: (clave: string, nombre: string) => void;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Array<{ clave: string; descripcion: string }>>([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    let vigente = true;
    setBuscando(true);
    const t = setTimeout(() => {
      api.searchCPEstaciones(medio, q, 30)
        .then(r => { if (vigente) setItems(r.items || []); })
        .catch(() => { if (vigente) setItems([]); })
        .finally(() => { if (vigente) setBuscando(false); });
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [q, medio, abierto]);

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)}
              className="w-full px-3 py-2 text-left border border-slate-300 rounded text-sm hover:bg-slate-50">
        {clave
          ? <span>{nombre} <span className="ml-1 text-[11px] font-mono text-red-600">{clave}</span></span>
          : <span className="text-slate-400">Buscar…</span>}
      </button>
    );
  }

  return (
    <div className="relative">
      <input
        autoFocus
        value={q}
        onChange={e => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        placeholder="Escribe para buscar…"
        className="input"
      />
      <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg">
        {buscando && <div className="px-3 py-2 text-xs text-slate-400">Buscando…</div>}
        {!buscando && !items.length && (
          <div className="px-3 py-2 text-xs text-slate-400">Sin coincidencias</div>
        )}
        {items.map(it => (
          <button
            key={it.clave}
            type="button"
            onMouseDown={() => { onSelect(it.clave, it.descripcion); setAbierto(false); setQ(''); }}
            className="block w-full text-left px-3 py-1.5 text-sm hover:bg-sky-50"
          >
            {it.descripcion}
            <span className="ml-2 text-[11px] font-mono text-slate-400">{it.clave}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ title, icon, action, children }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-6 bg-white rounded-lg shadow-sm border border-slate-200">
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 rounded-t-lg">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">{icon}{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Field({ label, children, span = 1 }: { label: string; children: React.ReactNode; span?: number }) {
  const cls = span === 2 ? 'col-span-2' : span === 3 ? 'col-span-3' : span === 4 ? 'col-span-4' : '';
  return (
    <label className={`block ${cls}`}>
      <span className="block text-xs text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function PickerButton({ value, onClick, placeholder }: { value: string; onClick: () => void; placeholder: string }) {
  return (
    <button type="button" onClick={onClick} className="input text-left flex items-center justify-between hover:border-sky-400">
      <span className={value ? 'font-mono' : 'text-slate-400'}>{value || placeholder}</span>
      <Search size={14} className="text-slate-400" />
    </button>
  );
}

function medioLabel(m: Medio) { return { auto: 'Autotransporte federal', maritimo: 'Marítimo', aereo: 'Aéreo', ferroviario: 'Ferroviario' }[m]; }
function medioIcon(m: Medio) { return { auto: <Truck size={16} />, maritimo: <Ship size={16} />, aereo: <Plane size={16} />, ferroviario: <Train size={16} /> }[m]; }
