/**
 * SuperXMLImport — wizard unificado que lee CUALQUIER XML del SAT y permite
 * decidir qué guardar: cliente/proveedor, productos (viajes), Carta Porte
 * (lugares/vehículo/aseguradoras/operadores) y Nómina.
 *
 * Aplica las 8 reglas del cliente:
 *   1. Skip duplicados (backend dedup por RFC/alias/UUID)
 *   2. Nueva entidad → checkbox cliente/proveedor
 *   3. Productos siempre viajes con impuestos configurables
 *   4. Origen/destino dedup, permite alta si nuevo
 *   5. Operadores solo dedup
 *   6. Mercancías preservan código + descripción + SAT
 *   7. Vehículos dedup + update
 *   8. Aseguradoras dedup con plantillas
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FileUp, Upload, X, Check, ArrowLeft, Users, Truck, UserCog, DollarSign, AlertTriangle } from 'lucide-react';
import api from '@/services/api';
import { PropuestaDeExpediente } from '@/pages/nomina/PropuestaDeExpediente';

const TYPE_LABEL: Record<string, { label: string; color: string; icon: string }> = {
  CFDI:            { label: 'Factura CFDI 4.0',      color: 'sky',     icon: '📄' },
  CFDI_CARTAPORTE: { label: 'Factura + Carta Porte 3.1', color: 'amber', icon: '🚚' },
  CFDI_NOMINA:    { label: 'Recibo de Nómina 1.2',   color: 'violet',  icon: '💰' },
  CFDI_PAGOS:     { label: 'Complemento de Pago 2.0', color: 'emerald', icon: '💳' },
  CFDI_NC:        { label: 'Nota de Crédito',        color: 'rose',    icon: '📉' },
  DESCONOCIDO:    { label: 'Tipo no reconocido',     color: 'gray',    icon: '❓' },
};

export function SuperXMLImportPage() {
  const navigate = useNavigate();
  const [xml, setXml] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [detection, setDetection] = useState<any>(null);
  const [dups, setDups] = useState<any>(null);
  const [applied, setApplied] = useState<any>(null);
  const [err, setErr] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);

  // Modo lote: hasta 5 XMLs procesados en serie
  const [batchQueue, setBatchQueue] = useState<Array<{ file: File; status: 'pending' | 'processing' | 'done' | 'error'; summary?: any; error?: string }>>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchPreview, setBatchPreview] = useState<any | null>(null); // { parties, productos, mercancias, lugares, vehiculos, aseguradoras, operadores }
  const [batchSel, setBatchSel] = useState<any>({}); // { parties: Set<key>, ... }
  const [batchApplied, setBatchApplied] = useState<any | null>(null);
  const [batchApplying, setBatchApplying] = useState(false);
  /* Recibos de nómina del lote: se revisan y SE DAN DE ALTA desde aquí.
   *
   * Antes sólo se informaba de ellos y se mandaba a abrir cada recibo por
   * separado. Con cinco archivos eso ya era absurdo, y el resultado del lote
   * salía "creados 0, omitidos 0, errores 0" sin explicar por qué: los
   * trabajadores no entraban en ninguna de las listas de arriba, y no había
   * dónde marcarlos. */
  const [batchNominas, setBatchNominas] = useState<Array<{ rfc?: string; nombre?: string; archivo: string }>>([]);
  const [nominaRevision, setNominaRevision] = useState<any | null>(null);
  const [nominaSel, setNominaSel] = useState<Record<string, boolean>>({});
  const [nominaError, setNominaError] = useState('');

  // Decisiones del usuario en la fase de preview
  const [decisions, setDecisions] = useState({
    emisorAs: '' as '' | 'CUSTOMER' | 'SUPPLIER',
    receptorAs: '' as '' | 'CUSTOMER' | 'SUPPLIER',
    saveConceptsAsViajes: true,
    saveCartaPorte: true,
    saveMercancias: true,
    saveNomina: false,
  });

  /* Recibo de nómina → expediente. Dos pasos a propósito: éste sólo LEE. */
  const [propuesta, setPropuesta] = useState<any | null>(null);
  const [errNomina, setErrNomina] = useState('');
  const proponerNomina = useMutation({
    mutationFn: () => api.proponerEmpleadoDesdeXml(xml),
    onSuccess: (r: any) => { setPropuesta(r.data); setErrNomina(''); },
    onError: (e: any) =>
      setErrNomina(e?.response?.data?.message || 'No se pudo leer el expediente del recibo'),
  });

  const detectMut = useMutation({
    mutationFn: (xmlContent: string) => api.xmlSuperDetect(xmlContent),
    onSuccess: (data) => {
      setDetection(data.detection);
      setDups(data.duplicates);
      /* Preselecciones sensatas por regla 2:
       *   · Si el emisor NO existe → sugerir SUPPLIER (compra)
       *   · Si el receptor NO existe → sugerir CUSTOMER (venta)
       *
       * SALVO EN UN RECIBO DE NÓMINA. Ahí el receptor es el TRABAJADOR, y esta
       * preselección lo estaba dando de alta como cliente: la plantilla entera
       * terminaba en el catálogo de clientes, con su RFC y su nombre, mezclada
       * con quien de verdad compra. El emisor tampoco es un proveedor: es la
       * propia empresa.
       *
       * Un recibo de nómina no crea terceros. Lo que crea —si alguien lo
       * confirma— es un expediente de personal, y eso va por su propio camino. */
      const esNomina = data.detection.type === 'CFDI_NOMINA';
      setDecisions((d) => ({
        ...d,
        emisorAs:   esNomina || data.duplicates.emisor?.exists   ? '' : 'SUPPLIER',
        receptorAs: esNomina || data.duplicates.receptor?.exists ? '' : 'CUSTOMER',
        saveNomina: esNomina,
        saveCartaPorte: data.detection.hasCartaPorte,
      }));
      setErr('');
    },
    onError: (e: any) => setErr(e?.response?.data?.message || e?.message || 'No se pudo leer el XML'),
  });

  const applyMut = useMutation({
    mutationFn: () => api.xmlSuperApply({
      xml,
      emisorAs:   decisions.emisorAs   || null,
      receptorAs: decisions.receptorAs || null,
      saveConceptsAsViajes: decisions.saveConceptsAsViajes,
      saveCartaPorte: decisions.saveCartaPorte,
      saveMercancias: decisions.saveMercancias,
      saveNomina: decisions.saveNomina,
    }),
    onSuccess: (data) => setApplied(data),
    onError: (e: any) => setErr(e?.response?.data?.message || e?.message || 'Error al importar'),
  });

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      setErr('El archivo debe ser .xml');
      return;
    }
    const text = await file.text();
    setXml(text);
    setFileName(file.name);
    setApplied(null);
    setErr('');
    detectMut.mutate(text);
  };

  /** Modo lote: cola de hasta 5 archivos con defaults sensatos (dedup + guardar
   *  emisor como proveedor / receptor como cliente / mercancías + CP + viajes).
   *  Se procesan en serie: cada apply usa dedup contra la BD ya poblada por
   *  los anteriores, así evitas duplicar catálogos entre archivos del mismo
   *  lote. */
  const handleFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.xml')).slice(0, 5);
    if (arr.length === 0) { setErr('Los archivos deben ser .xml'); return; }
    if (arr.length === 1) { handleFile(arr[0]); return; }
    setBatchQueue(arr.map(f => ({ file: f, status: 'pending' })));
    setDetection(null); setDups(null); setApplied(null); setErr(''); setXml(''); setFileName('');
  };

  /** Analiza los 2-5 XMLs, extrae todas las entidades, dedup ENTRE archivos
   *  por clave natural y consulta al backend cuáles ya existen. NO importa. */
  const runBatch = async () => {
    setBatchRunning(true);
    const q = [...batchQueue];
    // Acumuladores dedup por clave natural (Map key → payload)
    const parties      = new Map<string, any>();  // key: RFC
    const productos    = new Map<string, any>();  // key: claveSat|UPPER(name)
    const mercancias   = new Map<string, any>();  // key: claveSat|descNorm|clienteRfc
    const lugares      = new Map<string, any>();  // key: alias
    const vehiculos    = new Map<string, any>();  // key: placa
    const aseguradoras = new Map<string, any>();  // key: numPoliza
    const operadores   = new Map<string, any>();  // key: RFC
    /* Los recibos de nómina del lote no crean terceros: se listan aparte para
     * decir cuántos venían y a dónde hay que ir a darlos de alta. */
    const nominasDelLote: Array<{ rfc?: string; nombre?: string; archivo: string }> = [];
    /* El texto de los recibos, para pedir la revisión de expedientes en bloque. */
    const xmlsDeNomina: Array<{ nombre: string; xml: string }> = [];

    const norm = (s: string) => String(s || '').toUpperCase().trim().replace(/\s+/g, ' ');

    for (let i = 0; i < q.length; i++) {
      q[i] = { ...q[i], status: 'processing' };
      setBatchQueue([...q]);
      try {
        const xmlText = await q[i].file.text();
        const res = await api.xmlSuperDetect(xmlText);
        const d = res.detection;
        /* parties — SALVO en recibos de nómina.
         *
         * Aquí es donde de verdad entraron los empleados al catálogo de
         * clientes: al soltar varios recibos de nómina juntos, el lote metía a
         * cada receptor como cliente sugerido sin mirar el tipo de comprobante.
         * En un recibo de nómina el receptor es el trabajador y el emisor es
         * esta misma empresa: ninguno de los dos es un tercero. */
        const dEsNomina = d.type === 'CFDI_NOMINA';
        if (dEsNomina) {
          nominasDelLote.push({
            rfc: d.receptor?.rfc, nombre: d.receptor?.nombre, archivo: q[i].file.name,
          });
          xmlsDeNomina.push({ nombre: q[i].file.name, xml: xmlText });
        }
        // parties
        if (!dEsNomina && d.emisor?.rfc && !parties.has(d.emisor.rfc)) {
          parties.set(d.emisor.rfc, { rfc: d.emisor.rfc, nombre: d.emisor.nombre, role: 'emisor', suggestedAs: 'SUPPLIER', sourceXmls: [q[i].file.name] });
        } else if (!dEsNomina && d.emisor?.rfc && parties.has(d.emisor.rfc)) { parties.get(d.emisor.rfc).sourceXmls.push(q[i].file.name); }
        if (!dEsNomina && d.receptor?.rfc && !parties.has(d.receptor.rfc)) {
          parties.set(d.receptor.rfc, { rfc: d.receptor.rfc, nombre: d.receptor.nombre, role: 'receptor', suggestedAs: 'CUSTOMER', sourceXmls: [q[i].file.name] });
        } else if (!dEsNomina && d.receptor?.rfc && parties.has(d.receptor.rfc)) { parties.get(d.receptor.rfc).sourceXmls.push(q[i].file.name); }
        // productos (conceptos)
        for (const c of d.conceptos || []) {
          const k = `${c.claveSat}|${norm(c.descripcion).slice(0, 200)}`;
          if (!productos.has(k)) {
            const imp = c.impuestos || {};
            const ivaTasa = c.importe > 0 && imp.iva ? imp.iva / c.importe : 0.16;
            productos.set(k, { descripcion: c.descripcion, claveSat: c.claveSat, claveUnidad: c.claveUnidad, valorUnitario: c.valorUnitario, ivaTasa, retIva: imp.retIva || 0, sourceXmls: [q[i].file.name] });
          } else { productos.get(k).sourceXmls.push(q[i].file.name); }
        }
        // Si hay CP, hago un preview específico
        if (d.hasCartaPorte) {
          for (const m of d.mercancias || []) {
            // Usar remitente/destinatario del XML — el detect no los trae aún, lo obtendremos del apply
            const k = `${m.claveSat}|${norm(m.descripcion)}|`;
            if (!mercancias.has(k)) {
              mercancias.set(k, { ...m, uuidCfdi: d.uuid, sourceXmls: [q[i].file.name] });
            } else { mercancias.get(k).sourceXmls.push(q[i].file.name); }
          }
          // Lugares, vehículo, aseguradoras y operadores requieren el importar-xml completo.
          // Como el detect no los expone, hago una llamada dedicada:
          try {
            const preview = await api.cpImportPreview(xmlText);
            for (const l of preview.lugares || []) {
              if (!lugares.has(l.alias)) lugares.set(l.alias, { ...l, sourceXmls: [q[i].file.name] });
              else lugares.get(l.alias).sourceXmls.push(q[i].file.name);
            }
            if (preview.vehiculo) {
              const k = preview.vehiculo.placaVm;
              if (k && !vehiculos.has(k)) {
                const alias = `${preview.vehiculo.configVehicular}-${k}`;
                vehiculos.set(k, { ...preview.vehiculo, alias, sourceXmls: [q[i].file.name] });
              } else if (k) { vehiculos.get(k).sourceXmls.push(q[i].file.name); }
            }
            for (const a of preview.aseguradoras || []) {
              if (!aseguradoras.has(a.numPoliza)) aseguradoras.set(a.numPoliza, { ...a, sourceXmls: [q[i].file.name] });
              else aseguradoras.get(a.numPoliza).sourceXmls.push(q[i].file.name);
            }
            for (const o of preview.operadores || []) {
              if (!operadores.has(o.rfc)) operadores.set(o.rfc, { ...o, sourceXmls: [q[i].file.name] });
              else operadores.get(o.rfc).sourceXmls.push(q[i].file.name);
            }
          } catch { /* si falla el CP preview, seguimos con lo demás */ }
        }
        q[i] = { ...q[i], status: 'done', summary: { creados: 0, omitidos: 0, errores: 0 } };
      } catch (e: any) {
        q[i] = { ...q[i], status: 'error', error: e?.response?.data?.message || e?.message || 'Error' };
      }
      setBatchQueue([...q]);
    }

    // Consulta al backend qué ya existe (para pintar los checkmarks)
    const partiesArr      = Array.from(parties.values());
    const productosArr    = Array.from(productos.values());
    const mercanciasArr   = Array.from(mercancias.values());
    const lugaresArr      = Array.from(lugares.values());
    const vehiculosArr    = Array.from(vehiculos.values());
    const aseguradorasArr = Array.from(aseguradoras.values());
    const operadoresArr   = Array.from(operadores.values());

    let existing: any = {};
    try {
      existing = await api.xmlSuperCheckExisting({
        parties:      partiesArr.map(p => p.rfc),
        productos:    productosArr.map(p => ({ claveSat: p.claveSat, name: p.descripcion })),
        mercancias:   mercanciasArr.map(m => ({ claveSat: m.claveSat, descNorm: norm(m.descripcion), clienteRfc: '' })),
        lugares:      lugaresArr.map(l => l.alias),
        vehiculos:    vehiculosArr.map(v => v.placaVm),
        aseguradoras: aseguradorasArr.map(a => a.numPoliza),
        operadores:   operadoresArr.map(o => o.rfc),
      });
    } catch { /* si falla, todo se marca como nuevo */ }

    // Marcado + selección inicial: NO seleccionar los que ya existen
    const mark = (arr: any[], key: (x: any) => string, existMap: any) =>
      arr.map(x => ({ ...x, _key: key(x), existsInDb: !!existMap?.[key(x)] }));

    const preview = {
      parties:      mark(partiesArr,      p => p.rfc, existing.parties),
      productos:    mark(productosArr,    p => `${p.claveSat}|${norm(p.descripcion).slice(0, 200)}`, existing.productos),
      mercancias:   mark(mercanciasArr,   m => `${m.claveSat}|${norm(m.descripcion)}|`, existing.mercancias),
      lugares:      mark(lugaresArr,      l => l.alias, existing.lugares),
      vehiculos:    mark(vehiculosArr,    v => v.placaVm, existing.vehiculos),
      aseguradoras: mark(aseguradorasArr, a => a.numPoliza, existing.aseguradoras),
      operadores:   mark(operadoresArr,   o => o.rfc, existing.operadores),
    };

    // Selección inicial: solo los que NO existen (para que el usuario no re-suba)
    const initSel: any = {};
    for (const k of Object.keys(preview)) {
      initSel[k] = new Set(preview[k as keyof typeof preview].filter((x: any) => !x.existsInDb).map((x: any) => x._key));
    }
    /* Los recibos de nómina viajan aparte del preview: no hay nada que
     * seleccionar ni que crear desde aquí, sólo hay que decir que venían y a
     * dónde ir. Meterlos en `preview` los volvería a convertir en casillas
     * marcables, que es el error que se está corrigiendo. */
    setBatchNominas(nominasDelLote);

    /* Lo que trae cada recibo, listo para revisar y dar de alta sin salir de
     * aquí. Sólo LEE: agrupa por persona, se queda con el recibo más reciente y
     * reparte números de empleado sin que choquen. */
    if (xmlsDeNomina.length > 0) {
      try {
        const rev = await api.revisarEmpleadosDeNomina(xmlsDeNomina);
        const d: any = rev.data;
        setNominaRevision(d);
        const m: Record<string, boolean> = {};
        for (const t of d.trabajadores) if (t.estado === 'nuevo') m[t.archivo] = true;
        setNominaSel(m);
        setNominaError('');
      } catch (e: any) {
        setNominaRevision(null);
        setNominaError(
          e?.response?.data?.message ||
          'No se pudieron leer los expedientes de los recibos de nómina.'
        );
      }
    } else {
      setNominaRevision(null);
      setNominaSel({});
      setNominaError('');
    }

    setBatchPreview(preview);
    setBatchSel(initSel);
    setBatchRunning(false);
  };

  const toggleSel = (kind: string, key: string) => {
    const cur = new Set(batchSel[kind] as Set<string>);
    if (cur.has(key)) cur.delete(key); else cur.add(key);
    setBatchSel({ ...batchSel, [kind]: cur });
  };

  const applyBatchSelected = async () => {
    if (!batchPreview) return;
    setBatchApplying(true);
    try {
      const pick = (kind: string, transform: (x: any) => any = (x) => x) =>
        (batchPreview[kind] as any[])
          .filter(x => (batchSel[kind] as Set<string>).has(x._key))
          .map(transform);
      const payload = {
        parties:      pick('parties',      p => ({ rfc: p.rfc, nombre: p.nombre, as: p.suggestedAs })),
        productos:    pick('productos'),
        mercancias:   pick('mercancias'),
        lugares:      pick('lugares'),
        vehiculos:    pick('vehiculos'),
        aseguradoras: pick('aseguradoras'),
        operadores:   pick('operadores'),
      };
      const res = await api.xmlSuperApplySelected(payload);

      /* Los trabajadores marcados se dan de alta en la misma pasada y su
       * resultado se suma al del lote. Si se reportaran aparte, el resumen
       * volvería a decir "creados 0" con cinco expedientes recién creados. */
      const elegidos = (nominaRevision?.trabajadores || [])
        .filter((t: any) => t.estado === 'nuevo' && nominaSel[t.archivo]);
      let altaNomina: any = null;
      if (elegidos.length > 0) {
        try {
          const r = await api.altaDeEmpleadosEnBloque(
            elegidos.map((t: any) => ({ archivo: t.archivo, datos: t.propuesta.datos }))
          );
          altaNomina = r.data;
        } catch (e: any) {
          altaNomina = {
            creados: 0, fallidos: elegidos.length,
            altas: elegidos.map((t: any) => ({
              ok: false,
              nombre: [t.propuesta.datos.nombre, t.propuesta.datos.apellido_pat].filter(Boolean).join(' '),
              rfc: t.propuesta.datos.rfc,
              motivo: e?.response?.data?.message || 'No se pudo dar de alta',
            })),
          };
        }
      }
      setBatchApplied({ ...res, altaNomina });
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Error al importar');
    } finally {
      setBatchApplying(false);
    }
  };

  const removeBatchItem = (idx: number) => setBatchQueue(batchQueue.filter((_, j) => j !== idx));

  const restart = () => {
    setXml(''); setFileName(''); setDetection(null); setDups(null); setApplied(null); setErr('');
    detectMut.reset(); applyMut.reset();
  };

  const typeInfo = detection ? (TYPE_LABEL[detection.type] || TYPE_LABEL.DESCONOCIDO) : null;

  return (
    <div className="mx-auto max-w-[1200px] p-6">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-100 rounded"><ArrowLeft size={20} /></button>
        <div className="p-2 bg-indigo-100 rounded-lg"><FileUp size={26} className="text-indigo-700" /></div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Super Lector XML</h1>
          <p className="text-sm text-slate-500">Sube CUALQUIER XML del SAT — CFDI, Carta Porte 3.1, Nómina 1.2, Pagos, NC. Detecta y guarda automáticamente en tus catálogos con deduplicación.</p>
        </div>
      </div>

      {err && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>{err}</span>
          <button onClick={() => setErr('')} className="ml-auto text-red-400 hover:text-red-600"><X size={16} /></button>
        </div>
      )}

      {/* Paso 1: subir (drop-zone) */}
      {!detection && !applied && batchQueue.length === 0 && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
          className={`border-2 border-dashed rounded-lg p-16 text-center transition-colors ${dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white'}`}
        >
          <Upload size={48} className="mx-auto mb-4 text-slate-400" />
          <h3 className="text-lg font-semibold text-slate-700 mb-2">Arrastra 1 XML o hasta 5 para procesar en lote</h3>
          <p className="text-sm text-slate-500 mb-4">O</p>
          <label className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium cursor-pointer">
            <FileUp size={16} /> Elegir archivo(s)
            <input type="file" multiple accept=".xml,text/xml,application/xml" className="hidden" onChange={e => e.target.files?.length && handleFiles(e.target.files)} />
          </label>
          <p className="text-xs text-slate-400 mt-4">
            <b>1 archivo</b>: preview con checkboxes (control fino). <b>2–5 archivos</b>: modo lote, dedup automática entre archivos y contra la BD.
          </p>
        </div>
      )}

      {/* Panel de lote (2-5 archivos) */}
      {batchQueue.length > 0 && !batchApplied && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h3 className="font-semibold text-slate-700">Lote de {batchQueue.length} XMLs</h3>
            {!batchRunning && batchQueue.every(q => q.status === 'pending') && (
              <button onClick={() => { setBatchQueue([]); setBatchPreview(null); }} className="text-xs text-slate-500 hover:text-slate-700">Cancelar lote</button>
            )}
          </div>
          <ul className="divide-y divide-slate-100">
            {batchQueue.map((q, i) => (
              <li key={i} className="px-4 py-3 flex items-center gap-3 text-sm">
                <span className="text-slate-400 font-mono w-6">{i + 1}.</span>
                <span className="flex-1 truncate">{q.file.name}</span>
                {q.status === 'pending'    && <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">pendiente</span>}
                {q.status === 'processing' && <span className="text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 animate-pulse">analizando…</span>}
                {q.status === 'done'       && <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">✓ analizado</span>}
                {q.status === 'error'      && <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 truncate max-w-[240px]" title={q.error}>error: {q.error?.slice(0, 40)}</span>}
                {q.status === 'pending' && !batchRunning && (
                  <button onClick={() => removeBatchItem(i)} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
                )}
              </li>
            ))}
          </ul>
          {!batchPreview && (
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button onClick={runBatch} disabled={batchRunning} className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg">
                <Check size={14} /> {batchRunning ? 'Analizando…' : `Analizar los ${batchQueue.length} XMLs`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Preview consolidado con checkboxes por entidad */}
      {batchPreview && !batchApplied && (
        <div className="mt-4 space-y-4">
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-sm text-indigo-900">
            <b>Preview consolidado</b> — los ítems marcados en verde <span className="text-emerald-700">✓ ya existen</span> en tu BD y NO se re-importan por default. Marca/desmarca los checkboxes para elegir qué subir.
          </div>

          {/* ── TRABAJADORES DE LOS RECIBOS DE NÓMINA ──
              Se revisan y se dan de alta AQUÍ. No entran en las listas de
              abajo: el receptor de un recibo de nómina es el trabajador, no un
              cliente, y el emisor es esta misma empresa. */}
          {nominaError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">
              <p className="font-semibold">
                Se leyeron {batchNominas.length} recibo(s) de nómina, pero no se pudo armar el expediente:
              </p>
              <p className="mt-1">{nominaError}</p>
            </div>
          )}

          {nominaRevision && nominaRevision.trabajadores.length > 0 && (
            <div className="bg-white border border-violet-200 rounded-lg overflow-hidden">
              <div className="bg-violet-50 px-4 py-2.5 border-b border-violet-200">
                <p className="font-semibold text-sm text-violet-900 flex items-center gap-2">
                  <UserCog size={16} /> Trabajadores de los recibos de nómina
                  <span className="ml-auto font-normal text-xs">
                    {nominaRevision.resumen.archivos} recibo(s) ·{' '}
                    {nominaRevision.resumen.personas} persona(s) ·{' '}
                    {nominaRevision.resumen.nuevos} por dar de alta
                    {nominaRevision.resumen.yaExisten > 0 && ` · ${nominaRevision.resumen.yaExisten} ya estaban`}
                  </span>
                </p>
                <p className="text-[11px] text-violet-700 mt-0.5">
                  Si la misma persona viene en varios recibos se cuenta una vez, con los datos
                  del más reciente. Nada se guarda hasta que le des a importar.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr className="text-left text-xs text-slate-500">
                    <th className="px-3 py-1.5 w-8"></th>
                    <th className="px-3 py-1.5">Trabajador</th>
                    <th className="px-3 py-1.5">Núm.</th>
                    <th className="px-3 py-1.5">Puesto</th>
                    <th className="px-3 py-1.5 text-right">Salario diario</th>
                    <th className="px-3 py-1.5 text-right">SDI</th>
                    <th className="px-3 py-1.5">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {nominaRevision.trabajadores.map((t: any) => {
                    const d = t.propuesta?.datos || {};
                    const nombre = [d.nombre, d.apellido_pat, d.apellido_mat].filter(Boolean).join(' ');
                    const dedujo = t.propuesta?.origen?.apellido_pat === 'deducido';
                    const dinero = (v: any) =>
                      v === undefined || v === null || v === ''
                        ? '—'
                        : Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
                    return (
                      <tr key={t.archivo} className={
                        t.estado === 'error' ? 'bg-amber-50/50'
                          : t.estado === 'existe' ? 'bg-slate-50/60 text-slate-500'
                          : nominaSel[t.archivo] ? 'bg-emerald-50/40' : ''
                      }>
                        <td className="px-3 py-1.5">
                          {t.estado === 'nuevo' && (
                            <input type="checkbox" checked={!!nominaSel[t.archivo]}
                              onChange={(e) => setNominaSel({ ...nominaSel, [t.archivo]: e.target.checked })}
                              className="rounded border-slate-300" />
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {t.estado === 'error' ? (
                            <span className="text-slate-500 italic text-xs">{t.archivo}</span>
                          ) : (
                            <>
                              <p className="font-medium text-slate-900">
                                {nombre || t.propuesta?.yaExiste?.nombre_completo}
                              </p>
                              <p className="text-[11px] text-slate-500 font-mono">{d.rfc || ''}</p>
                              {dedujo && (
                                <p className="text-[11px] text-amber-700">
                                  el reparto del nombre se dedujo — revísalo después
                                </p>
                              )}
                              {t.recibos > 1 && (
                                <p className="text-[11px] text-slate-400">
                                  {t.recibos} recibos · se usa el más reciente
                                </p>
                              )}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs">{d.num_empleado || '—'}</td>
                        <td className="px-3 py-1.5 text-xs">{d.puesto || '—'}</td>
                        <td className="px-3 py-1.5 text-right text-xs">{dinero(d.salario_diario)}</td>
                        <td className="px-3 py-1.5 text-right text-xs">{dinero(d.salario_diario_integrado)}</td>
                        <td className="px-3 py-1.5 text-xs">
                          {t.estado === 'nuevo' && (
                            t.propuesta?.faltantes?.length
                              ? <span className="text-amber-700">falta: {t.propuesta.faltantes.join(', ')}</span>
                              : <span className="text-emerald-700">completo</span>
                          )}
                          {t.estado === 'existe' && <span>ya estaba en la plantilla</span>}
                          {t.estado === 'error' && <span className="text-amber-800">{t.motivo}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {(() => {
                const todos = new Set<string>();
                for (const t of nominaRevision.trabajadores) {
                  for (const a of t.propuesta?.avisos || []) todos.add(a);
                }
                if (todos.size === 0) return null;
                return (
                  <div className="px-4 py-2 bg-amber-50 border-t border-amber-200 space-y-1">
                    {[...todos].map((a, i2) => (
                      <p key={i2} className="text-[11px] text-amber-900 flex items-start gap-1.5">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {a}
                      </p>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          <BatchSection title="👥 Emisores / Receptores → clientes/proveedores" items={batchPreview.parties} sel={batchSel.parties} onToggle={(k) => toggleSel('parties', k)} renderItem={(p: any) => (
            <>
              <div className="text-sm"><b>{p.nombre || '—'}</b> <span className="text-xs font-mono text-slate-500">{p.rfc}</span></div>
              <div className="text-[11px] text-slate-500">Sugerido: {p.suggestedAs === 'SUPPLIER' ? 'Proveedor' : 'Cliente'} · {p.sourceXmls.length} XML(s)</div>
            </>
          )} />
          <BatchSection title="📄 Productos (viajes/servicios facturados)" items={batchPreview.productos} sel={batchSel.productos} onToggle={(k) => toggleSel('productos', k)} renderItem={(p: any) => (
            <>
              <div className="text-sm truncate max-w-[500px]">{p.descripcion}</div>
              <div className="text-[11px] text-slate-500 font-mono">SAT {p.claveSat} · {p.claveUnidad} · ${Number(p.valorUnitario).toFixed(2)}</div>
            </>
          )} />
          <BatchSection title="📦 Mercancías transportadas" items={batchPreview.mercancias} sel={batchSel.mercancias} onToggle={(k) => toggleSel('mercancias', k)} renderItem={(m: any) => (
            <>
              <div className="text-sm truncate max-w-[500px]">{m.descripcion}</div>
              <div className="text-[11px] text-slate-500 font-mono">SAT {m.claveSat} · {m.cantidad} {m.claveUnidad} · {m.pesoKg || 0} kg</div>
            </>
          )} />
          <BatchSection title="📍 Lugares (Origen / Destino)" items={batchPreview.lugares} sel={batchSel.lugares} onToggle={(k) => toggleSel('lugares', k)} renderItem={(l: any) => (
            <>
              <div className="text-sm"><b>{l.alias}</b> · <span className="text-xs">{l.tipoDefault}</span></div>
              <div className="text-[11px] text-slate-500">{l.nombre} · {l.estado} · CP {l.codigoPostal}</div>
            </>
          )} />
          <BatchSection title="🚚 Vehículos" items={batchPreview.vehiculos} sel={batchSel.vehiculos} onToggle={(k) => toggleSel('vehiculos', k)} renderItem={(v: any) => (
            <>
              <div className="text-sm"><b>Placa {v.placaVm}</b> · {v.configVehicular} · {v.anioModeloVm}</div>
              <div className="text-[11px] text-slate-500">Peso {v.pesoBrutoVehicular}t · Permiso {v.permSct}</div>
            </>
          )} />
          <BatchSection title="🛡️ Aseguradoras" items={batchPreview.aseguradoras} sel={batchSel.aseguradoras} onToggle={(k) => toggleSel('aseguradoras', k)} renderItem={(a: any) => (
            <>
              <div className="text-sm"><b>{a.nombreAseguradora}</b></div>
              <div className="text-[11px] text-slate-500">{a.tipo} · Póliza {a.numPoliza}</div>
            </>
          )} />
          <BatchSection title="👤 Operadores / Figuras" items={batchPreview.operadores} sel={batchSel.operadores} onToggle={(k) => toggleSel('operadores', k)} renderItem={(o: any) => (
            <>
              <div className="text-sm"><b>{o.nombre}</b> · <span className="text-xs font-mono">{o.rfc}</span></div>
              <div className="text-[11px] text-slate-500">Tipo {o.tipoFigura} · Lic {o.numLicencia || '—'}</div>
            </>
          )} />
          <div className="flex justify-end gap-3">
            <button onClick={() => { setBatchQueue([]); setBatchPreview(null); setBatchSel({}); }} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancelar</button>
            <button onClick={applyBatchSelected} disabled={batchApplying} className="inline-flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg font-medium">
              <Check size={16} /> {batchApplying ? 'Importando…' : 'Importar lo seleccionado'}
            </button>
          </div>
        </div>
      )}

      {/* Resultado del lote */}
      {batchApplied && (
        <div className="mt-4 bg-white border border-slate-200 rounded-lg p-6">
          <h3 className="font-semibold text-emerald-700 mb-3">✓ Importación completada</h3>
          <div className="grid grid-cols-3 gap-3 text-sm mb-4">
            <div className="p-3 bg-emerald-50 rounded border border-emerald-200"><div className="text-xs text-emerald-600">CREADOS</div><div className="text-2xl font-bold text-emerald-700">{batchApplied.summary.creados}</div></div>
            <div className="p-3 bg-slate-50 rounded border border-slate-200"><div className="text-xs text-slate-500">OMITIDOS (dedup)</div><div className="text-2xl font-bold text-slate-700">{batchApplied.summary.omitidos}</div></div>
            <div className="p-3 bg-red-50 rounded border border-red-200"><div className="text-xs text-red-600">ERRORES</div><div className="text-2xl font-bold text-red-700">{batchApplied.summary.errores}</div></div>
          </div>
          {(batchApplied.errors || []).map((e: string, i: number) => <p key={i} className="text-xs text-red-600">⚠ {e}</p>)}

          {/* LOS TRABAJADORES, UNO POR UNO.
              Los contadores de arriba son de catálogos; sin este bloque, un lote
              de puros recibos de nómina terminaba en "creados 0, omitidos 0,
              errores 0" aunque se hubieran dado de alta cinco expedientes — o
              aunque hubieran fallado los cinco, sin decir por qué. */}
          {batchApplied.altaNomina && (
            <div className="mt-4 border border-violet-200 rounded-lg overflow-hidden">
              <div className="bg-violet-50 px-4 py-2 border-b border-violet-200">
                <p className="text-sm font-semibold text-violet-900 flex items-center gap-2">
                  <UserCog size={15} />
                  {batchApplied.altaNomina.creados} trabajador(es) dados de alta
                  {batchApplied.altaNomina.fallidos > 0 &&
                    ` · ${batchApplied.altaNomina.fallidos} no se pudieron`}
                </p>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {batchApplied.altaNomina.altas.map((a: any, i: number) => (
                    <tr key={i} className={a.ok ? '' : 'bg-rose-50/50'}>
                      <td className="px-3 py-1.5 w-8">
                        {a.ok
                          ? <Check size={15} className="text-emerald-600" />
                          : <AlertTriangle size={15} className="text-rose-600" />}
                      </td>
                      <td className="px-3 py-1.5 font-medium">{a.nombre || '—'}</td>
                      <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{a.rfc}</td>
                      <td className="px-3 py-1.5 text-xs">
                        {a.ok
                          ? <span className="text-emerald-700">empleado {a.num_empleado}</span>
                          : <span className="text-rose-700">{a.motivo}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {batchApplied.altaNomina.creados > 0 && (
                <div className="px-4 py-2 bg-slate-50 border-t text-xs text-slate-600">
                  Quedan en <button onClick={() => navigate('/nomina/empleados')}
                    className="text-primary underline">Nómina → Empleados</button>.
                  Ahí se completa lo que el recibo no traía.
                </div>
              )}
            </div>
          )}

          {/* Cuando el lote era de puros recibos y no se marcó a nadie, decirlo:
              un resumen en ceros sin explicación es lo que hubo antes. */}
          {!batchApplied.altaNomina && batchNominas.length > 0 && (
            <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              El lote traía {batchNominas.length} recibo(s) de nómina y no se marcó a ningún
              trabajador, así que no se dio de alta a nadie.
            </p>
          )}

          <div className="mt-4 flex justify-end">
            <button onClick={() => { setBatchQueue([]); setBatchPreview(null); setBatchSel({}); setBatchApplied(null); setNominaRevision(null); setNominaSel({}); setBatchNominas([]); }} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
              Nuevo lote
            </button>
          </div>
        </div>
      )}

      {detectMut.isPending && <div className="p-8 text-center text-slate-500">Analizando XML…</div>}

      {/* Paso 2: preview con decisiones */}
      {detection && !applied && (
        <div className="space-y-4">
          {/* Header con tipo detectado */}
          <div className={`bg-white rounded-lg border-2 border-${typeInfo?.color}-200 p-4`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{typeInfo?.icon}</span>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider">Detectado</p>
                  <h3 className="text-lg font-semibold text-slate-800">{typeInfo?.label}</h3>
                </div>
              </div>
              <button onClick={restart} className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"><X size={14} /> Cambiar archivo</button>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-3 text-xs">
              <Info label="Archivo" value={fileName} />
              <Info label="UUID" value={detection.uuid ? detection.uuid.slice(0, 8) + '…' : '—'} mono />
              <Info label="Total" value={detection.total ? `$${Number(detection.total).toFixed(2)}` : '—'} />
              <Info label="Complementos" value={detection.complementos.length ? detection.complementos.join(', ') : '(ninguno)'} />
            </div>
          </div>

          {/* Emisor + Receptor con dedup y decisión.
              En un recibo de nómina NO se ofrecen: el receptor es el trabajador
              y el emisor es esta misma empresa. Ofrecer la opción es invitar al
              error que ya ocurrió — la plantilla dada de alta como clientes. */}
          {detection.type !== 'CFDI_NOMINA' && (
          <div className="grid grid-cols-2 gap-4">
            <PartyCard
              title="Emisor"
              rfc={detection.emisor?.rfc}
              nombre={detection.emisor?.nombre}
              exists={dups?.emisor?.exists}
              decision={decisions.emisorAs}
              onDecision={(v) => setDecisions({ ...decisions, emisorAs: v })}
            />
            <PartyCard
              title="Receptor"
              rfc={detection.receptor?.rfc}
              nombre={detection.receptor?.nombre}
              exists={dups?.receptor?.exists}
              decision={decisions.receptorAs}
              onDecision={(v) => setDecisions({ ...decisions, receptorAs: v })}
            />
          </div>
          )}

          {/* Conceptos → productos */}
          {detection.conceptos && detection.conceptos.length > 0 && (
            <Card icon={<DollarSign size={16} className="text-fuchsia-700" />} title={`Conceptos (${detection.conceptos.length})`} color="fuchsia">
              <div className="mb-3">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={decisions.saveConceptsAsViajes}
                    onChange={(e) => setDecisions({ ...decisions, saveConceptsAsViajes: e.target.checked })}
                  />
                  <span>Crear cada concepto como <b>producto tipo viaje</b> con impuestos del XML</span>
                </label>
              </div>
              <div className="space-y-2">
                {detection.conceptos.slice(0, 5).map((c: any, i: number) => (
                  <div key={i} className="text-xs border-l-2 border-fuchsia-200 pl-3">
                    <p className="font-medium text-slate-800">{c.descripcion.slice(0, 80)}</p>
                    <p className="text-slate-500 font-mono">
                      SAT {c.claveSat} · {c.claveUnidad} · Cant {c.cantidad} · ${Number(c.importe).toFixed(2)}
                      {c.impuestos?.iva ? ` · IVA $${Number(c.impuestos.iva).toFixed(2)}` : ''}
                      {c.impuestos?.retIva ? ` · Ret IVA $${Number(c.impuestos.retIva).toFixed(2)}` : ''}
                    </p>
                  </div>
                ))}
                {detection.conceptos.length > 5 && (
                  <p className="text-xs text-slate-400 italic">+{detection.conceptos.length - 5} conceptos más</p>
                )}
              </div>
            </Card>
          )}

          {/* Carta Porte */}
          {detection.hasCartaPorte && (
            <Card icon={<Truck size={16} className="text-amber-700" />} title="Complemento Carta Porte 3.1 detectado" color="amber">
              <label className="inline-flex items-center gap-2 text-sm mb-2">
                <input
                  type="checkbox"
                  checked={decisions.saveCartaPorte}
                  onChange={(e) => setDecisions({ ...decisions, saveCartaPorte: e.target.checked })}
                />
                <span>Extraer y guardar <b>lugares, vehículo, aseguradoras y operadores</b> (dedup automático)</span>
              </label>
              <p className="text-xs text-slate-500 mt-1">Se ejecutan las reglas 4-8: lugares por alias, operadores por RFC, vehículos por placa, aseguradoras por póliza.</p>
            </Card>
          )}

          {/* Mercancías transportadas — plantilla + bitácora para inspecciones SAT */}
          {detection.hasCartaPorte && detection.mercancias && detection.mercancias.length > 0 && (
            <Card icon={<span className="text-base">📦</span>} title={`Mercancías transportadas (${detection.mercancias.length})`} color="rose">
              <label className="inline-flex items-center gap-2 text-sm mb-2">
                <input
                  type="checkbox"
                  checked={decisions.saveMercancias}
                  onChange={(e) => setDecisions({ ...decisions, saveMercancias: e.target.checked })}
                />
                <span>Guardar en <b>catálogo de mercancías</b> (plantilla) + <b>bitácora</b> por viaje</span>
              </label>
              <p className="text-xs text-slate-500 mb-3">
                Separadas de <i>Productos</i> — no son inventario propio. Necesarias para inspecciones SAT (faltar datos = multa).
              </p>
              <div className="space-y-1.5">
                {detection.mercancias.map((m: any, i: number) => (
                  <div key={i} className="flex items-start justify-between gap-3 p-2 bg-white rounded border border-rose-100 text-xs">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-800 truncate">{m.descripcion}</div>
                      <div className="text-slate-500 font-mono">SAT {m.claveSat} · {m.cantidad} {m.claveUnidad || ''} · {m.pesoKg || 0} kg</div>
                    </div>
                    <div className="text-right whitespace-nowrap text-slate-700">
                      ${Number(m.valorMercancia || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} {m.moneda}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Nómina */}
          {detection.type === 'CFDI_NOMINA' && (
            <Card icon={<UserCog size={16} className="text-violet-700" />} title="Recibo de Nómina 1.2 detectado" color="violet">
              <label className="inline-flex items-center gap-2 text-sm mb-2">
                <input
                  type="checkbox"
                  checked={decisions.saveNomina}
                  onChange={(e) => setDecisions({ ...decisions, saveNomina: e.target.checked })}
                />
                <span>Guardar <b>metadata + XML íntegro</b> para procesamiento posterior</span>
              </label>
              {detection.nomina && (
                <div className="text-xs text-slate-600 grid grid-cols-3 gap-2 mt-2 p-2 bg-slate-50 rounded">
                  <div>Tipo: <b>{detection.nomina.tipoNomina}</b></div>
                  <div>Fecha pago: <b>{detection.nomina.fechaPago || '—'}</b></div>
                  <div>Días: <b>{detection.nomina.numDiasPagados || '—'}</b></div>
                  <div>Percepciones: <b>${Number(detection.nomina.totalPercepciones || 0).toFixed(2)}</b></div>
                  <div>Deducciones: <b>${Number(detection.nomina.totalDeducciones || 0).toFixed(2)}</b></div>
                  <div>Otros pagos: <b>${Number(detection.nomina.totalOtrosPagos || 0).toFixed(2)}</b></div>
                </div>
              )}
              <p className="text-xs text-slate-500 mt-2 italic">
                El detalle de percepciones/deducciones no se procesa todavía; solo se guarda para consulta futura.
              </p>

              {/* ── Del recibo al expediente del personal ──────────────────
                  Un recibo timbrado ya pasó por el SAT: el RFC, la CURP y el
                  NSS que trae están bien escritos. Recapturarlos a mano es la
                  forma más fácil de meter el error que después rechaza el
                  timbrado. Pero NO se da de alta a nadie desde aquí: se abre el
                  expediente con lo rescatado y alguien confirma. */}
              <div className="mt-4 border-t pt-3">
                <button
                  onClick={() => proponerNomina.mutate()}
                  disabled={proponerNomina.isPending}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium"
                >
                  <UserCog size={15} />
                  {proponerNomina.isPending ? 'Leyendo el recibo…' : 'Importar al expediente del personal'}
                </button>
                <p className="text-xs text-slate-500 mt-2">
                  Rescata del XML todo lo que sirva para el expediente y lo muestra antes de
                  guardar nada. El alta del trabajador la confirmas tú.
                </p>
                {errNomina && (
                  <p className="text-xs text-rose-600 mt-2">{errNomina}</p>
                )}
              </div>
            </Card>
          )}

          {/* Lo que se rescató del recibo, para revisarlo antes de dar de alta */}
          {propuesta && (
            <PropuestaDeExpediente
              propuesta={propuesta}
              onCerrar={() => setPropuesta(null)}
              onAlta={() => { setPropuesta(null); navigate('/nomina/empleados'); }}
            />
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button onClick={restart} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancelar</button>
            <button
              onClick={() => applyMut.mutate()}
              disabled={applyMut.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg text-sm font-medium"
            >
              <Check size={16} /> {applyMut.isPending ? 'Importando…' : 'Importar todo'}
            </button>
          </div>
        </div>
      )}

      {/* Paso 3: resultado */}
      {applied && (
        <div className="space-y-4">
          <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-emerald-100 rounded-lg"><Check size={24} className="text-emerald-700" /></div>
              <div>
                <h3 className="text-lg font-semibold text-emerald-900">Importación completada</h3>
                <p className="text-sm text-emerald-700">
                  {applied.summary.creados} creado(s) · {applied.summary.omitidos} omitido(s) por duplicado · {applied.summary.errores} error(es)
                </p>
              </div>
            </div>
            {applied.created.length > 0 && (
              <details className="mt-3" open>
                <summary className="text-sm font-medium text-emerald-800 cursor-pointer">Creado</summary>
                <ul className="mt-2 space-y-1 text-xs text-slate-700 list-disc list-inside">
                  {applied.created.map((c: any, i: number) => <li key={i}><b>{c.kind}</b>: {c.label}</li>)}
                </ul>
              </details>
            )}
            {applied.skipped.length > 0 && (
              <details className="mt-3">
                <summary className="text-sm font-medium text-amber-800 cursor-pointer">Omitido por deduplicación</summary>
                <ul className="mt-2 space-y-1 text-xs text-slate-600 list-disc list-inside">
                  {applied.skipped.map((s: any, i: number) => <li key={i}><b>{s.kind}</b>: {s.label} — {s.reason}</li>)}
                </ul>
              </details>
            )}
            {applied.errors.length > 0 && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                <p className="font-medium">Errores:</p>
                <ul className="list-disc list-inside">
                  {applied.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={restart} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm">Importar otro XML</button>
            <button onClick={() => navigate('/carta-porte/lugares')} className="px-4 py-2 border border-slate-300 hover:bg-slate-50 rounded text-sm">Ver Lugares</button>
            <button onClick={() => navigate('/customers')} className="px-4 py-2 border border-slate-300 hover:bg-slate-50 rounded text-sm">Ver Clientes</button>
            <button onClick={() => navigate('/products')} className="px-4 py-2 border border-slate-300 hover:bg-slate-50 rounded text-sm">Ver Productos</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="block text-slate-500 uppercase tracking-wider text-[10px] font-medium">{label}</span>
      <span className={`block ${mono ? 'font-mono' : ''} text-slate-800 truncate`} title={value}>{value}</span>
    </div>
  );
}

/** Sección colapsable del preview de lote — muestra items con checkbox y
 *  marca los que ya existen en la BD. Ítems que ya existen se pre-desmarcan. */
function BatchSection({ title, items, sel, onToggle, renderItem }: {
  title: string;
  items: any[];
  sel: Set<string> | undefined;
  onToggle: (key: string) => void;
  renderItem: (item: any) => React.ReactNode;
}) {
  if (!items || items.length === 0) return null;
  const selSet = sel || new Set<string>();
  const nuevos = items.filter(i => !i.existsInDb).length;
  const existentes = items.filter(i => i.existsInDb).length;
  const allSelected = items.filter(i => !i.existsInDb).every(i => selSet.has(i._key));
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-700 flex-1">
          {title} <span className="text-xs font-normal text-slate-500">— {nuevos} nuevo(s){existentes > 0 ? `, ${existentes} ya existen` : ''}</span>
        </h3>
        {nuevos > 0 && (
          <button
            onClick={() => {
              const newSet = new Set(selSet);
              if (allSelected) items.filter(i => !i.existsInDb).forEach(i => newSet.delete(i._key));
              else items.filter(i => !i.existsInDb).forEach(i => newSet.add(i._key));
              // toggle uno a uno para que suba al parent — hack simple
              items.filter(i => !i.existsInDb).forEach(i => {
                if (allSelected && selSet.has(i._key)) onToggle(i._key);
                else if (!allSelected && !selSet.has(i._key)) onToggle(i._key);
              });
            }}
            className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-100"
          >
            {allSelected ? 'Deseleccionar nuevos' : 'Seleccionar todos los nuevos'}
          </button>
        )}
      </header>
      <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
        {items.map((it) => (
          <li key={it._key} className={`px-4 py-2.5 flex items-start gap-3 text-sm ${it.existsInDb ? 'bg-emerald-50/40' : ''}`}>
            <input
              type="checkbox"
              className="mt-1"
              checked={selSet.has(it._key)}
              onChange={() => onToggle(it._key)}
              disabled={it.existsInDb}
              title={it.existsInDb ? 'Ya existe en tu BD' : 'Marca para importar'}
            />
            <div className="flex-1 min-w-0">{renderItem(it)}</div>
            {it.existsInDb && <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">✓ ya existe</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Card({ icon, title, color, children }: { icon: React.ReactNode; title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <header className={`px-4 py-2 border-b border-slate-200 bg-${color}-50 rounded-t-lg flex items-center gap-2`}>
        {icon}
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </header>
      <div className="p-4">{children}</div>
    </div>
  );
}

function PartyCard({ title, rfc, nombre, exists, decision, onDecision }:
  { title: string; rfc?: string; nombre?: string; exists?: boolean;
    decision: '' | 'CUSTOMER' | 'SUPPLIER'; onDecision: (v: '' | 'CUSTOMER' | 'SUPPLIER') => void; }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        </div>
        {exists ? (
          <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded">✓ ya existe</span>
        ) : (
          <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded">nuevo</span>
        )}
      </div>
      <p className="text-xs font-mono text-slate-800">{rfc || '—'}</p>
      <p className="text-xs text-slate-500 mb-3">{nombre || '(sin nombre)'}</p>
      {!exists && (
        <div className="pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-600 mb-2">Guardar como:</p>
          <div className="flex gap-2">
            {(['', 'CUSTOMER', 'SUPPLIER'] as const).map((v) => (
              <label key={v} className={`flex-1 text-center text-xs px-2 py-1.5 border rounded cursor-pointer ${decision === v ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="radio" checked={decision === v} onChange={() => onDecision(v)} className="hidden" />
                {v === '' ? 'No guardar' : v === 'CUSTOMER' ? 'Cliente' : 'Proveedor'}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
