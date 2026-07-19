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
 *      · Marítimo/Aéreo/Ferroviario: se dejan como placeholder informativo
 *        hasta que HCGM confirme el primer caso real
 *   5. Figuras de transporte — mínimo 1 operador
 *
 * Nota: este form es el primer entregable del CP. Las 110 reglas del SAT
 * (Matriz de Errores) se validan en el Bloque 7 antes del timbrado.
 */

import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Route as RouteIcon, Plus, Trash2, Save, ArrowLeft, MapPin, Package2, Truck, UserCog, Ship, Plane, Train, Search, BookMarked } from 'lucide-react';
import api from '@/services/api';
import { CatalogPicker, type CatalogItem } from '@/components/CatalogPicker';
import { LugarPicker } from '@/components/LugarPicker';

type Medio = 'auto' | 'maritimo' | 'aereo' | 'ferroviario';

interface UbicacionRow {
  tipoUbicacion: 'Origen' | 'Destino';
  idUbicacion: string;
  rfcRemitenteDestinatario: string;
  nombreRemitenteDestinatario: string;
  fechaHoraSalidaLlegada: string;
  distanciaRecorrida?: string;
  calle: string;
  numExterior: string;
  estado: string;
  codigoPostal: string;
  guardarEnCatalogo?: boolean;   // ← el usuario marca para guardar como plantilla
  aliasCatalogo?: string;         // ← alias opcional; si vacío se autogenera
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
}
interface RemolqueRow { subTipoRem: string; placa: string; }
interface FiguraRow {
  tipoFigura: string;
  rfcFigura: string;
  numLicencia: string;
  nombreFigura: string;
}

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
    estado: '',
    codigoPostal: '',
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
    estado: l.estado || '',
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

  // ─── Ubicaciones / mercancías / figuras ────────────────────────────
  const [ubicaciones, setUbicaciones] = useState<UbicacionRow[]>(() => {
    const or = blankUbicacion('Origen', []);
    return [or, blankUbicacion('Destino', [or])];
  });
  // Picker de lugares frecuentes: {ubicIndex, tipo} para saber a qué fila se aplica
  const [lugarPicker, setLugarPicker] = useState<{ index: number; tipo: 'Origen' | 'Destino' } | null>(null);
  const [mercancias, setMercancias] = useState<MercanciaRow[]>([blankMercancia()]);
  const [figuras, setFiguras] = useState<FiguraRow[]>([blankFigura()]);

  // ─── Autotransporte (aplica si medio='auto') ───────────────────────
  const [auto, setAuto] = useState({
    permSct: '', numPermisoSct: '', configVehicular: '',
    pesoBrutoVehicular: '', placaVm: '', anioModeloVm: String(new Date().getFullYear()),
    aseguraRespCivil: '', polizaRespCivil: '',
  });
  const [remolques, setRemolques] = useState<RemolqueRow[]>([]);

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
    if (existing.ubicaciones?.length) {
      setUbicaciones(existing.ubicaciones.map((u: any) => ({
        tipoUbicacion: u.tipo_ubicacion, idUbicacion: u.id_ubicacion,
        rfcRemitenteDestinatario: u.rfc_remitente_destinatario,
        nombreRemitenteDestinatario: u.nombre_remitente_destinatario || '',
        fechaHoraSalidaLlegada: u.fecha_hora_salida_llegada?.slice(0, 16) || '',
        distanciaRecorrida: u.distancia_recorrida != null ? String(u.distancia_recorrida) : '',
        calle: u.calle || '', numExterior: u.num_exterior || '',
        estado: u.estado, codigoPostal: u.codigo_postal,
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
    if (existing.figuras?.length) {
      setFiguras(existing.figuras.map((f: any) => ({
        tipoFigura: f.tipo_figura, rfcFigura: f.rfc_figura,
        numLicencia: f.num_licencia || '', nombreFigura: f.nombre_figura || '',
      })));
    }
  }, [existing]);

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
          estado: u.estado,
          codigoPostal: u.codigoPostal,
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
        })),
        figuras: figuras.map(f => ({
          tipoFigura: f.tipoFigura,
          rfcFigura: f.rfcFigura.toUpperCase(),
          numLicencia: f.numLicencia || undefined,
          nombreFigura: f.nombreFigura || undefined,
        })),
      };
      if (transpInternac === 'Si') {
        payload.entradaSalidaMerc = entradaSalidaMerc || undefined;
        payload.paisOrigenDestino = paisOrigenDestino || undefined;
        payload.viaEntradaSalida = '01';
      }
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
          {transpInternac === 'Si' && (
            <>
              <Field label="Entrada / Salida">
                <select value={entradaSalidaMerc} onChange={e => setEntradaSalidaMerc(e.target.value as any)} className="input">
                  <option value="">Elegir…</option><option>Entrada</option><option>Salida</option>
                </select>
              </Field>
              <Field label="País origen/destino (3 letras)">
                <input value={paisOrigenDestino} onChange={e => setPaisOrigenDestino(e.target.value.toUpperCase())} maxLength={3} className="input" />
              </Field>
            </>
          )}
        </div>
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
                <Field label="Fecha/hora salida-llegada">
                  <input type="datetime-local" value={u.fechaHoraSalidaLlegada} onChange={e => updateUbi(i, { fechaHoraSalidaLlegada: e.target.value })} className="input" />
                </Field>
                <Field label="Calle" span={2}>
                  <input value={u.calle} onChange={e => updateUbi(i, { calle: e.target.value })} className="input" />
                </Field>
                <Field label="No. exterior">
                  <input value={u.numExterior} onChange={e => updateUbi(i, { numExterior: e.target.value })} className="input" />
                </Field>
                <Field label="Estado (3)">
                  <input value={u.estado} onChange={e => updateUbi(i, { estado: e.target.value.toUpperCase() })} maxLength={3} className="input font-mono" />
                </Field>
                <Field label="CP">
                  <input value={u.codigoPostal} onChange={e => updateUbi(i, { codigoPostal: e.target.value })} maxLength={5} className="input font-mono" />
                </Field>
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
              </div>
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
              <Field label="Aseguradora resp. civil" span={2}>
                <input value={auto.aseguraRespCivil} onChange={e => setAuto({ ...auto, aseguraRespCivil: e.target.value })} className="input" />
              </Field>
              <Field label="Póliza resp. civil">
                <input value={auto.polizaRespCivil} onChange={e => setAuto({ ...auto, polizaRespCivil: e.target.value })} className="input" />
              </Field>
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
        ) : (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
            La captura completa para transporte <b>{medioLabel(medio)}</b> se habilitará cuando HCGM
            confirme el primer caso real. Los catálogos ya están cargados; solo falta el layout específico
            del medio. Por ahora se guarda como "sin detalle de medio" y el timbrado usará solo autotransporte.
          </div>
        )}
      </Section>

      {/* 5. Figuras */}
      <Section title="5. Figuras de transporte" icon={<UserCog size={16} />}
               action={<button onClick={() => setFiguras([...figuras, blankFigura()])} className="btn-add"><Plus size={14} /> Figura</button>}>
        <div className="space-y-3">
          {figuras.map((f, i) => (
            <div key={i} className="border border-slate-200 rounded p-3 relative">
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
    </div>
  );

  function updateUbi(i: number, patch: Partial<UbicacionRow>) {
    setUbicaciones(ubicaciones.map((u, j) => j === i ? { ...u, ...patch } : u));
  }
  function updateMer(i: number, patch: Partial<MercanciaRow>) {
    setMercancias(mercancias.map((m, j) => j === i ? { ...m, ...patch } : m));
  }
}

/* ─── UI helpers ───────────────────────────────────────────────────── */

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
