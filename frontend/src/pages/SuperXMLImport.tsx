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

  // Decisiones del usuario en la fase de preview
  const [decisions, setDecisions] = useState({
    emisorAs: '' as '' | 'CUSTOMER' | 'SUPPLIER',
    receptorAs: '' as '' | 'CUSTOMER' | 'SUPPLIER',
    saveConceptsAsViajes: true,
    saveCartaPorte: true,
    saveMercancias: true,
    saveNomina: false,
  });

  const detectMut = useMutation({
    mutationFn: (xmlContent: string) => api.xmlSuperDetect(xmlContent),
    onSuccess: (data) => {
      setDetection(data.detection);
      setDups(data.duplicates);
      // Preselecciones sensatas por regla 2:
      // · Si emisor NO existe → sugerir SUPPLIER (compra) por default
      // · Si receptor NO existe → sugerir CUSTOMER (venta) por default
      setDecisions((d) => ({
        ...d,
        emisorAs:   data.duplicates.emisor?.exists   ? '' : 'SUPPLIER',
        receptorAs: data.duplicates.receptor?.exists ? '' : 'CUSTOMER',
        saveNomina: data.detection.type === 'CFDI_NOMINA',
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

      {/* Paso 1: subir */}
      {!detection && !applied && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          className={`border-2 border-dashed rounded-lg p-16 text-center transition-colors ${dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white'}`}
        >
          <Upload size={48} className="mx-auto mb-4 text-slate-400" />
          <h3 className="text-lg font-semibold text-slate-700 mb-2">Arrastra el XML aquí</h3>
          <p className="text-sm text-slate-500 mb-4">O</p>
          <label className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium cursor-pointer">
            <FileUp size={16} /> Elegir archivo
            <input type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
          <p className="text-xs text-slate-400 mt-4">Acepta cualquier CFDI 4.0 timbrado por cualquier PAC. Detecta el tipo automáticamente.</p>
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

          {/* Emisor + Receptor con dedup y decisión */}
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
            </Card>
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
