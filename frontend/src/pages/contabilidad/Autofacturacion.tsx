/**
 * Autofacturación (Anexo 20 / RMF Sección 2.7.3).
 *
 * El ADQUIRENTE (nuestra empresa) captura y previsualiza el CFDI que emitiría POR
 * CUENTA del ENAJENANTE que no factura (sector primario, arrendador, minero,
 * artesano, vehículos usados, desperdicios, arte, antigüedades). En el CFDI el
 * emisor es el enajenante (régimen 622 AGAPES para primario) y el receptor es la
 * empresa — al revés de una factura normal.
 *
 * El TIMBRADO está gated: requiere el «rol de facturación a través del adquirente»
 * ante el SAT + un PAC con servicio de adquirentes. Hoy se captura/previsualiza.
 */
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sprout, Users, FileText, Plus, Trash2, Save, X, Eye, AlertTriangle, Info } from 'lucide-react';
import api from '@/services/api';
import { CampoFecha, aTextoMx } from '@/components/CampoFecha';
import { claseOpcion } from '@/utils/coloresOpciones';

const money = (n: any) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);

const SECTORES: Array<[string, string]> = [
  ['primario', 'Sector primario (agrícola/ganadero/pesca/silvícola)'],
  ['arrendamiento', 'Arrendamiento de inmuebles'],
  ['minero', 'Minero'],
  ['artesano', 'Artesano'],
  ['vehiculos', 'Vehículos usados'],
  ['desperdicios', 'Desperdicios industrializables'],
  ['arte', 'Obras de arte plásticas'],
  ['antiguedades', 'Antigüedades'],
];
const SECTOR_LABEL = Object.fromEntries(SECTORES);

export function AutofacturacionPage() {
  const [tab, setTab] = useState<'comprobantes' | 'enajenantes'>('comprobantes');

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Sprout size={22} className="text-lime-600" /> Autofacturación
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Comprobación de erogaciones a quien no factura (RMF 2.7.3): la empresa emite el CFDI por
          cuenta del enajenante. El emisor es el enajenante; el receptor, la empresa.
        </p>
      </div>

      {/* Aviso de timbrado gated. */}
      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
        <p>
          <b>Timbrado pendiente de activar.</b> Emitir por cuenta del adquirente requiere el
          <b> «rol de facturación a través del adquirente»</b> ante el SAT y un <b>PAC con servicio de
          adquirentes</b> (el sellado no usa el CSD del emisor). Por ahora se <b>captura y previsualiza</b>
          {' '}el CFDI (BORRADOR). Cuando tengas el rol y el PAC, se conecta el timbrado.
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {([['comprobantes', 'Comprobantes'], ['enajenantes', 'Enajenantes']] as const).map(([k, label], i) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 ${claseOpcion(i, tab === k)}`}>
            {k === 'comprobantes' ? <FileText size={14} /> : <Users size={14} />} {label}
          </button>
        ))}
      </div>

      {tab === 'enajenantes' ? <TabEnajenantes /> : <TabComprobantes />}
    </div>
  );
}

/* ─────────────────────────── ENAJENANTES ─────────────────────────── */
const ENAJ_VACIO = { nombre: '', curp: '', rfc: '', regimenFiscal: '622', cpFiscal: '', sector: 'primario', clabe: '' };

function TabEnajenantes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['autofact-enaj'], queryFn: () => api.getEnajenantes() });
  const enajenantes: any[] = q.data?.data || [];
  const [form, setForm] = useState<any | null>(null);
  const [msg, setMsg] = useState('');

  const editar = (e: any) => setForm({
    id: e.id, nombre: e.nombre, curp: e.curp || '', rfc: e.rfc || '',
    regimenFiscal: e.regimen_fiscal || '622', cpFiscal: e.cp_fiscal || '', sector: e.sector || 'primario', clabe: e.clabe || '',
  });

  const guardar = async () => {
    setMsg('');
    try {
      if (form.id) await api.actualizarEnajenante(form.id, form);
      else await api.crearEnajenante(form);
      setForm(null);
      qc.invalidateQueries({ queryKey: ['autofact-enaj'] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo guardar.'); }
  };
  const borrar = async (e: any) => {
    if (!window.confirm(`¿Quitar a ${e.nombre}?`)) return;
    try { await api.borrarEnajenante(e.id); qc.invalidateQueries({ queryKey: ['autofact-enaj'] }); }
    catch (err: any) { setMsg(err?.response?.data?.message || 'No se pudo.'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">Quienes te venden sin factura. Sin RFC se usa el genérico y la CURP identifica a la persona.</p>
        <button onClick={() => setForm({ ...ENAJ_VACIO })}
          className="flex items-center gap-1.5 bg-lime-600 text-white px-3 py-1.5 rounded-lg hover:bg-lime-700 text-sm">
          <Plus size={15} /> Nuevo enajenante
        </button>
      </div>
      {msg && <p className="text-sm text-rose-700">{msg}</p>}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Nombre</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">RFC / CURP</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Sector</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Régimen</th>
              <th className="px-4 py-2 w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {!q.isLoading && enajenantes.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500 italic">Aún no hay enajenantes. Agrega el primero.</td></tr>
            )}
            {enajenantes.map((e) => (
              <tr key={e.id} className={`hover:bg-gray-50 ${!e.activo ? 'opacity-50' : ''}`}>
                <td className="px-4 py-2 text-sm">{e.nombre}{!e.activo && <span className="ml-1 text-[10px] text-gray-400">(inactivo)</span>}</td>
                <td className="px-4 py-2 text-xs font-mono text-gray-600">{e.rfc || <span className="text-amber-600">genérico</span>}{e.curp ? ` · ${e.curp}` : ''}</td>
                <td className="px-4 py-2 text-xs text-gray-600">{SECTOR_LABEL[e.sector] || e.sector}</td>
                <td className="px-4 py-2 text-xs text-gray-500">{e.regimen_fiscal}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button onClick={() => editar(e)} className="text-gray-400 hover:text-lime-600 mr-2" title="Editar">✎</button>
                  <button onClick={() => borrar(e)} className="text-gray-400 hover:text-rose-500" title="Quitar"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && <ModalEnajenante form={form} setForm={setForm} onGuardar={guardar} onCerrar={() => setForm(null)} msg={msg} />}
    </div>
  );
}

function ModalEnajenante({ form, setForm, onGuardar, onCerrar, msg }: any) {
  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-900">{form.id ? 'Editar' : 'Nuevo'} enajenante</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="text-xs text-gray-600">Nombre completo *</span>
            <input value={form.nombre} onChange={(e) => set('nombre', e.target.value)} className="input w-full" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-600">RFC (opcional)</span>
              <input value={form.rfc} onChange={(e) => set('rfc', e.target.value.toUpperCase())} placeholder="genérico si vacío" className="input w-full font-mono" />
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">CURP (si no hay RFC) *</span>
              <input value={form.curp} onChange={(e) => set('curp', e.target.value.toUpperCase())} className="input w-full font-mono" />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block col-span-2">
              <span className="text-xs text-gray-600">Sector (RMF 2.7.3)</span>
              <select value={form.sector} onChange={(e) => set('sector', e.target.value)} className="input w-full">
                {SECTORES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">Régimen</span>
              <input value={form.regimenFiscal} onChange={(e) => set('regimenFiscal', e.target.value)} className="input w-full font-mono" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-600">CP fiscal</span>
              <input value={form.cpFiscal} onChange={(e) => set('cpFiscal', e.target.value)} className="input w-full font-mono" />
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">CLABE (pago, opcional)</span>
              <input value={form.clabe} onChange={(e) => set('clabe', e.target.value)} className="input w-full font-mono" />
            </label>
          </div>
          {msg && <p className="text-sm text-rose-700">{msg}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onCerrar} className="px-3 py-1.5 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button onClick={onGuardar} className="flex items-center gap-1.5 bg-lime-600 text-white px-4 py-1.5 rounded-lg hover:bg-lime-700 text-sm">
              <Save size={15} /> Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── COMPROBANTES ─────────────────────────── */
const IVA_OPC: Array<[string, number]> = [['Exento', -1], ['0%', 0], ['16%', 0.16]];
const CONCEPTO_VACIO = { claveProdServ: '', cantidad: 1, claveUnidad: 'H87', descripcion: '', valorUnitario: 0, ivaTasa: -1, retIvaTasa: 0, retIsrTasa: 0 };

function TabComprobantes() {
  const qc = useQueryClient();
  const enajQ = useQuery({ queryKey: ['autofact-enaj'], queryFn: () => api.getEnajenantes() });
  const enajenantes: any[] = (enajQ.data?.data || []).filter((e: any) => e.activo);
  const listaQ = useQuery({ queryKey: ['autofact-comp'], queryFn: () => api.getComprobantesAutofactura() });
  const comprobantes: any[] = listaQ.data?.data || [];

  const [captura, setCaptura] = useState(false);
  const [previa, setPrevia] = useState<any | null>(null);
  const [msg, setMsg] = useState('');

  const borrar = async (c: any) => {
    if (!window.confirm(`¿Borrar el comprobante de ${c.enajenante} por ${money(c.total)}?`)) return;
    try { await api.borrarComprobanteAutofactura(c.id); qc.invalidateQueries({ queryKey: ['autofact-comp'] }); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo.'); }
  };
  const timbrar = async (c: any) => {
    setMsg('');
    try {
      await api.timbrarComprobanteAutofactura(c.id);
      qc.invalidateQueries({ queryKey: ['autofact-comp'] });
    } catch (e: any) { setMsg(e?.response?.data?.message || 'Timbrado no disponible todavía.'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">Cada erogación es un CFDI (BORRADOR) listo para previsualizar.</p>
        <button onClick={() => setCaptura(true)} disabled={enajenantes.length === 0}
          className="flex items-center gap-1.5 bg-lime-600 text-white px-3 py-1.5 rounded-lg hover:bg-lime-700 text-sm disabled:opacity-50"
          title={enajenantes.length === 0 ? 'Primero da de alta un enajenante' : ''}>
          <Plus size={15} /> Nueva erogación
        </button>
      </div>
      {enajenantes.length === 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-center gap-1.5">
          <Info size={14} /> Da de alta un enajenante en la pestaña «Enajenantes» antes de capturar.
        </p>
      )}
      {msg && <p className="text-sm text-rose-700">{msg}</p>}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Fecha</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Enajenante</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Subtotal</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Total</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Estado</th>
              <th className="px-4 py-2 w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {!listaQ.isLoading && comprobantes.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500 italic">Sin comprobantes. Captura la primera erogación.</td></tr>
            )}
            {comprobantes.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm">{aTextoMx(c.fecha)}</td>
                <td className="px-4 py-2 text-sm">{c.enajenante} <span className="text-xs text-gray-400">· {c.enajenante_rfc || 'genérico'}</span></td>
                <td className="px-4 py-2 text-right text-sm">{money(c.subtotal)}</td>
                <td className="px-4 py-2 text-right text-sm font-medium">{money(c.total)}</td>
                <td className="px-4 py-2 text-center">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.estado === 'TIMBRADO' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>{c.estado}</span>
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button onClick={() => setPrevia(c)} className="text-gray-400 hover:text-sky-600 mr-2" title="Previsualizar"><Eye size={15} /></button>
                  <button onClick={() => timbrar(c)} className="text-gray-400 hover:text-amber-600 mr-2 text-xs" title="Intentar timbrar (gated)">Timbrar</button>
                  {c.estado !== 'TIMBRADO' && <button onClick={() => borrar(c)} className="text-gray-400 hover:text-rose-500" title="Borrar"><Trash2 size={14} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {captura && (
        <ModalCaptura enajenantes={enajenantes}
          onCerrar={() => setCaptura(false)}
          onGuardado={() => { setCaptura(false); qc.invalidateQueries({ queryKey: ['autofact-comp'] }); }} />
      )}
      {previa && <ModalPrevia comprobante={previa} onCerrar={() => setPrevia(null)} />}
    </div>
  );
}

function ModalCaptura({ enajenantes, onCerrar, onGuardado }: any) {
  const [enajenanteId, setEnajenanteId] = useState(enajenantes[0]?.id || '');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [serie, setSerie] = useState('');
  const [folio, setFolio] = useState('');
  const [conceptos, setConceptos] = useState<any[]>([{ ...CONCEPTO_VACIO }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setConcepto = (i: number, patch: any) => setConceptos((cs) => cs.map((c, k) => k === i ? { ...c, ...patch } : c));
  const agregar = () => setConceptos((cs) => [...cs, { ...CONCEPTO_VACIO }]);
  const quitar = (i: number) => setConceptos((cs) => cs.length > 1 ? cs.filter((_, k) => k !== i) : cs);

  // Totales en vivo (misma lógica que el backend).
  const tot = useMemo(() => {
    let subtotal = 0, iva = 0, retIva = 0, retIsr = 0;
    for (const c of conceptos) {
      const importe = (Number(c.cantidad) || 0) * (Number(c.valorUnitario) || 0);
      subtotal += importe;
      if (c.ivaTasa > 0) iva += importe * Number(c.ivaTasa);
      retIva += importe * (Number(c.retIvaTasa) || 0);
      retIsr += importe * (Number(c.retIsrTasa) || 0);
    }
    return { subtotal, iva, retIva, retIsr, total: subtotal + iva - retIva - retIsr };
  }, [conceptos]);

  const guardar = async () => {
    setBusy(true); setError('');
    try {
      await api.crearComprobanteAutofactura({ enajenanteId, fecha, serie, folio, conceptos });
      onGuardado();
    } catch (e: any) { setError(e?.response?.data?.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white">
          <h3 className="font-semibold text-gray-900">Nueva erogación</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid sm:grid-cols-4 gap-3">
            <label className="block sm:col-span-2">
              <span className="text-xs text-gray-600">Enajenante</span>
              <select value={enajenanteId} onChange={(e) => setEnajenanteId(e.target.value)} className="input w-full">
                {enajenantes.map((e: any) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">Fecha</span>
              <CampoFecha value={fecha} onChange={setFecha} className="input w-full" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="text-xs text-gray-600">Serie</span>
                <input value={serie} onChange={(e) => setSerie(e.target.value)} className="input w-full" /></label>
              <label className="block"><span className="text-xs text-gray-600">Folio</span>
                <input value={folio} onChange={(e) => setFolio(e.target.value)} className="input w-full" /></label>
            </div>
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b text-gray-600">
                <tr>
                  <th className="px-2 py-1.5 text-left">ClaveProdServ</th>
                  <th className="px-2 py-1.5 text-left">Descripción</th>
                  <th className="px-2 py-1.5 text-right w-16">Cant.</th>
                  <th className="px-2 py-1.5 text-left w-20">Unidad</th>
                  <th className="px-2 py-1.5 text-right w-28">V. unit.</th>
                  <th className="px-2 py-1.5 text-left w-24">IVA</th>
                  <th className="px-2 py-1.5 text-right w-24">Importe</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {conceptos.map((c, i) => (
                  <tr key={i}>
                    <td className="px-1 py-1"><input value={c.claveProdServ} onChange={(e) => setConcepto(i, { claveProdServ: e.target.value })} placeholder="01010101" className="input py-1 text-xs w-28 font-mono" /></td>
                    <td className="px-1 py-1"><input value={c.descripcion} onChange={(e) => setConcepto(i, { descripcion: e.target.value })} className="input py-1 text-xs w-full" /></td>
                    <td className="px-1 py-1"><input type="number" value={c.cantidad} onChange={(e) => setConcepto(i, { cantidad: e.target.value })} className="input py-1 text-xs w-16 text-right" /></td>
                    <td className="px-1 py-1"><input value={c.claveUnidad} onChange={(e) => setConcepto(i, { claveUnidad: e.target.value })} className="input py-1 text-xs w-20 font-mono" /></td>
                    <td className="px-1 py-1"><input type="number" value={c.valorUnitario} onChange={(e) => setConcepto(i, { valorUnitario: e.target.value })} className="input py-1 text-xs w-28 text-right" /></td>
                    <td className="px-1 py-1">
                      <select value={c.ivaTasa} onChange={(e) => setConcepto(i, { ivaTasa: Number(e.target.value) })} className="input py-1 text-xs w-24">
                        {IVA_OPC.map(([l, v]) => <option key={l} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{money((Number(c.cantidad) || 0) * (Number(c.valorUnitario) || 0))}</td>
                    <td className="px-1 py-1 text-center"><button onClick={() => quitar(i)} className="text-gray-300 hover:text-rose-500"><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={agregar} className="flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"><Plus size={14} /> Agregar concepto</button>

          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm border-t pt-3">
            <span className="text-gray-600">Subtotal: <b>{money(tot.subtotal)}</b></span>
            {tot.iva > 0 && <span className="text-gray-600">IVA: <b>{money(tot.iva)}</b></span>}
            {tot.retIva > 0 && <span className="text-gray-600">Ret. IVA: <b>−{money(tot.retIva)}</b></span>}
            {tot.retIsr > 0 && <span className="text-gray-600">Ret. ISR: <b>−{money(tot.retIsr)}</b></span>}
            <span className="text-gray-900">Total: <b>{money(tot.total)}</b></span>
          </div>
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onCerrar} className="px-3 py-1.5 rounded-lg border text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button onClick={guardar} disabled={busy}
              className="flex items-center gap-1.5 bg-lime-600 text-white px-4 py-1.5 rounded-lg hover:bg-lime-700 text-sm disabled:opacity-50">
              <Save size={15} /> {busy ? 'Guardando…' : 'Guardar borrador'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalPrevia({ comprobante, onCerrar }: any) {
  const q = useQuery({ queryKey: ['autofact-comp', comprobante.id], queryFn: () => api.getComprobanteAutofactura(comprobante.id) });
  const c: any = q.data?.data;
  const json = c?.json_cfdi;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white">
          <h3 className="font-semibold text-gray-900">Previsualización CFDI (BORRADOR)</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          {q.isLoading && <p className="text-gray-500">Cargando…</p>}
          {json && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-lime-50 border border-lime-200 rounded-lg p-3">
                  <p className="text-[10px] uppercase text-lime-700 font-semibold">Emisor (enajenante)</p>
                  <p className="font-medium">{json.Emisor?.Nombre}</p>
                  <p className="text-xs font-mono text-gray-600">{json.Emisor?.Rfc} · Rég. {json.Emisor?.RegimenFiscal}</p>
                </div>
                <div className="bg-sky-50 border border-sky-200 rounded-lg p-3">
                  <p className="text-[10px] uppercase text-sky-700 font-semibold">Receptor (adquirente)</p>
                  <p className="font-medium">{json.Receptor?.Nombre}</p>
                  <p className="text-xs font-mono text-gray-600">{json.Receptor?.Rfc} · Uso {json.Receptor?.UsoCFDI}</p>
                </div>
              </div>
              <table className="w-full text-xs border rounded">
                <thead className="bg-gray-50 text-gray-500">
                  <tr><th className="px-2 py-1 text-left">Clave</th><th className="px-2 py-1 text-left">Descripción</th><th className="px-2 py-1 text-right">Cant.</th><th className="px-2 py-1 text-right">V.Unit</th><th className="px-2 py-1 text-right">Importe</th></tr>
                </thead>
                <tbody className="divide-y">
                  {(json.Conceptos || []).map((cp: any, i: number) => (
                    <tr key={i}>
                      <td className="px-2 py-1 font-mono">{cp.ClaveProdServ}</td>
                      <td className="px-2 py-1">{cp.Descripcion}</td>
                      <td className="px-2 py-1 text-right">{cp.Cantidad}</td>
                      <td className="px-2 py-1 text-right">{money(cp.ValorUnitario)}</td>
                      <td className="px-2 py-1 text-right">{money(cp.Importe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex justify-end gap-x-6 text-sm">
                <span className="text-gray-600">Subtotal: <b>{money(json.SubTotal)}</b></span>
                <span className="text-gray-900">Total: <b>{money(json.Total)}</b></span>
              </div>
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" /> Es una previsualización. El timbrado real requiere el rol SAT de adquirente + PAC de adquirentes.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AutofacturacionPage;
