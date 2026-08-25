/**
 * TablaComprobantesSat — la vista de los submenús Emitidos / Recibidos.
 *
 * Tabla del Anexo 20 (fecha de menor a mayor, folio, contraparte, RFC, total,
 * ESTATUS con iconos, cuenta contable) con filtro por mes y año.
 *
 * EL FOLIO ABRE UNA PREVISUALIZACIÓN EN PANTALLA (se ve, se revisa, se cierra):
 *   - factura (tipo I)        → formato azul,
 *   - nota de crédito (tipo E) → formato rojo,
 *   - complemento de pago (P)  → formato verde, al dar clic en la cartera.
 * Los datos salen del propio XML. De recibidos sólo hay metadatos: su folio
 * lleva un punto rojo y abre la ficha.
 *
 * Iconos estándar (lucide): Wallet verde = pagado; Ban rojo = cancelado.
 */
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, Ban, FileText, X, RefreshCw, Search, Circle, Check, Pencil } from 'lucide-react';
import { api } from '@/services/api';

type Direccion = 'emitidos' | 'recibidos';
type Modo = 'representacion' | 'pago' | 'cancelacion' | 'ficha';

const money = (n: any, moneda = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: (moneda || 'MXN').trim() || 'MXN' })
    .format(Number(n) || 0);

const fechaCorta = (s?: string) =>
  s ? new Date(s).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

const fechaLarga = (s?: string) =>
  s ? new Date(s).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const folioDe = (c: any) => [c.serie, c.folio].filter(Boolean).join('-');

const MESES = ['Todo el año', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function TablaComprobantesSat({ direccion }: { direccion: Direccion }) {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState<number | undefined>(hoy.getMonth() + 1);
  const [buscar, setBuscar] = useState('');
  const [detalle, setDetalle] = useState<{ id: string; modo: Modo } | null>(null);

  const q = useQuery({
    queryKey: ['sat-vista', direccion, anio, mes],
    queryFn: () => api.getSatComprobantesVista({ direccion, anio, mes }),
  });
  const filas: any[] = q.data?.data?.comprobantes || [];

  const t = buscar.toLowerCase();
  const visibles = t
    ? filas.filter((c) =>
        [c.contraparte_nombre, c.contraparte_rfc, c.folio, c.uuid, c.cuenta_contable]
          .some((v) => String(v || '').toLowerCase().includes(t)))
    : filas;

  const emitidos = direccion === 'emitidos';
  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg shadow border p-4 flex flex-wrap items-center gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <FileText className="text-emerald-600" size={20} />
          {emitidos ? 'Emitidos' : 'Recibidos'}
          <span className="text-sm font-normal text-gray-500">{visibles.length} comprobante(s)</span>
        </h2>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select value={mes ?? 0} onChange={(e) => setMes(Number(e.target.value) || undefined)}
            className="input py-1.5 text-sm">
            {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}
            className="input py-1.5 text-sm w-24">
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)}
              placeholder={emitidos ? 'Cliente, RFC, folio…' : 'Proveedor, RFC, UUID…'}
              className="input pl-8 py-1.5 text-sm w-48" />
          </div>
          <button onClick={() => q.refetch()} className="text-gray-500 hover:text-gray-700" title="Actualizar">
            <RefreshCw size={16} className={q.isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Fecha</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Folio</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">{emitidos ? 'Cliente' : 'Proveedor'}</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">RFC</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Total</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600 w-40">Estatus</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">CC</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && visibles.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 italic">
                Sin comprobantes en {mes ? MESES[mes] : ''} {anio}. Pídelos desde «XML del SAT».
              </td></tr>
            )}
            {visibles.map((c) => {
              const cancelado = c.estado_sat === 'Cancelado';
              const folio = folioDe(c);
              return (
                <tr key={c.id} className={cancelado ? 'bg-rose-50/40' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-2 text-sm whitespace-nowrap">{fechaCorta(c.fecha_emision)}</td>
                  <td className="px-4 py-2 text-sm whitespace-nowrap">
                    {c.tiene_xml ? (
                      <button onClick={() => setDetalle({ id: c.id, modo: 'representacion' })}
                        className="font-semibold text-emerald-600 hover:text-emerald-700 hover:underline"
                        title="Ver la representación del comprobante">
                        {folio || 'Ver'}
                      </button>
                    ) : (
                      <button onClick={() => setDetalle({ id: c.id, modo: 'ficha' })}
                        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 hover:underline"
                        title="Sólo metadatos: ver la ficha">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                        {folio || 'Ver ficha'}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm"><p className="truncate max-w-xs">{c.contraparte_nombre || '—'}</p></td>
                  <td className="px-4 py-2 text-xs font-mono text-gray-600 whitespace-nowrap">{c.contraparte_rfc || '—'}</td>
                  <td className="px-4 py-2 text-right font-semibold whitespace-nowrap">{money(c.total, c.moneda)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-center gap-4">
                      <EstatusIconos cancelado={cancelado} pagado={!!c.pagado} emitido={emitidos}
                        onCancelacion={() => setDetalle({ id: c.id, modo: 'cancelacion' })}
                        onPago={() => setDetalle({ id: c.id, modo: 'pago' })} />
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <CeldaCuenta id={c.id} valor={c.cuenta_contable} claveVista={['sat-vista', direccion, anio, mes]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detalle && (
        <ComprobanteModal id={detalle.id} modo={detalle.modo} emitido={emitidos}
          onClose={() => setDetalle(null)} />
      )}
    </div>
  );
}

function EstatusIconos({ cancelado, pagado, emitido, onCancelacion, onPago }: {
  cancelado: boolean; pagado: boolean; emitido: boolean;
  onCancelacion: () => void; onPago: () => void;
}) {
  if (cancelado) {
    return (
      <button onClick={onCancelacion} title="Cancelado — ver la cancelación"
        className="text-rose-600 hover:text-rose-700"><Ban size={20} /></button>
    );
  }
  if (pagado) {
    return (
      <button onClick={onPago} title="Pagado — ver el timbre de pago"
        className="text-emerald-600 hover:text-emerald-700"><Wallet size={20} /></button>
    );
  }
  return (
    <span title={emitido ? 'Vigente · por cobrar' : 'Vigente · por pagar'} className="text-gray-300">
      <Circle size={18} />
    </span>
  );
}

function CeldaCuenta({ id, valor, claveVista }: {
  id: string; valor?: string | null; claveVista: any[];
}) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(valor || '');
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setGuardando(true);
    try {
      await api.setSatCuentaContable(id, texto.trim() || null);
      qc.invalidateQueries({ queryKey: claveVista });
      setEditando(false);
    } finally { setGuardando(false); }
  };

  if (editando) {
    return (
      <div className="flex items-center gap-1">
        <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(false); }}
          placeholder="Cuenta" className="input py-1 text-xs w-24" />
        <button onClick={guardar} disabled={guardando} className="text-emerald-600 hover:text-emerald-700"><Check size={15} /></button>
      </div>
    );
  }
  return (
    <button onClick={() => { setTexto(valor || ''); setEditando(true); }}
      className="group flex items-center gap-1 text-sm text-gray-700 hover:text-gray-900"
      title="Asignar cuenta contable">
      {valor ? <span className="font-mono">{valor}</span>
             : <span className="text-gray-300 group-hover:text-gray-500">— asignar</span>}
      <Pencil size={12} className="opacity-0 group-hover:opacity-100 text-gray-400" />
    </button>
  );
}

/* ── El detalle en pantalla del sistema ───────────────────────────────────── */
function ComprobanteModal({ id, modo, emitido, onClose }: {
  id: string; modo: Modo; emitido: boolean; onClose: () => void;
}) {
  const q = useQuery({ queryKey: ['sat-comprobante', id], queryFn: () => api.getSatComprobante(id) });
  const d: any = q.data?.data;
  const c = d?.comprobante;
  const pagos: any[] = d?.pagos || [];
  const f = c?.xml ? parseCfdi(c.xml) : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-2.5 border-b sticky top-0 bg-white rounded-t-xl z-10">
          <span className="text-xs text-gray-500">Previsualización — se revisa y se cierra</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>
        <div className="p-6">
          {q.isLoading && <p className="text-center text-gray-500 py-8">Cargando…</p>}
          {!q.isLoading && !c && <p className="text-center text-gray-500 py-8">No se encontró el comprobante.</p>}

          {c && modo === 'representacion' && f && (
            f.tipo === 'E' ? <PreviewNotaCredito f={f} /> : <PreviewFactura f={f} />
          )}
          {c && modo === 'pago' && <VistaPagos pagos={pagos} factura={c} />}
          {c && modo === 'cancelacion' && <VistaCancelacion c={c} />}
          {c && modo === 'ficha' && <VistaFicha c={c} emitido={emitido} />}
        </div>
      </div>
    </div>
  );
}

/* ── Parseo del CFDI (sin depender del prefijo de namespace) ───────────────── */
function parseCfdi(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const first = (n: string) => doc.getElementsByTagNameNS('*', n)[0] || null;
  const all = (n: string) => Array.from(doc.getElementsByTagNameNS('*', n));
  const at = (el: Element | null, a: string) => (el?.getAttribute(a) ?? '');
  const hijo = (el: Element | null, local: string) =>
    el ? Array.from(el.children).find((x) => x.localName === local) || null : null;

  const comp = first('Comprobante');
  const em = first('Emisor');
  const re = first('Receptor');
  const tfd = first('TimbreFiscalDigital');
  const impC = hijo(comp, 'Impuestos');
  const pago = first('Pago');                 // complemento de pago (tipo P)
  const cfdiRel = first('CfdiRelacionados');  // nota de crédito (tipo E)

  const tasaConcepto = (cn: Element): string => {
    const tr = cn.getElementsByTagNameNS('*', 'Traslado')[0];
    const t = tr?.getAttribute('TasaOCuota');
    return t ? `${(Number(t) * 100).toFixed(0)}%` : '';
  };

  return {
    serie: at(comp, 'Serie'), folio: at(comp, 'Folio'), fecha: at(comp, 'Fecha'),
    subtotal: at(comp, 'SubTotal'), descuento: at(comp, 'Descuento'), total: at(comp, 'Total'),
    moneda: at(comp, 'Moneda') || 'MXN', tipoCambio: at(comp, 'TipoCambio'),
    metodoPago: at(comp, 'MetodoPago'), formaPago: at(comp, 'FormaPago'), tipo: at(comp, 'TipoDeComprobante'),
    totalTraslados: at(impC, 'TotalImpuestosTrasladados'),
    totalRetenciones: at(impC, 'TotalImpuestosRetenidos'),
    emisorRfc: at(em, 'Rfc'), emisorNombre: at(em, 'Nombre'), emisorRegimen: at(em, 'RegimenFiscal'),
    receptorRfc: at(re, 'Rfc'), receptorNombre: at(re, 'Nombre'), receptorUso: at(re, 'UsoCFDI'),
    receptorDomicilio: at(re, 'DomicilioFiscalReceptor'), receptorRegimen: at(re, 'RegimenFiscalReceptor'),
    uuid: at(tfd, 'UUID'), fechaTimbrado: at(tfd, 'FechaTimbrado'),
    selloCfd: at(tfd, 'SelloCFD'), selloSat: at(tfd, 'SelloSAT'), noCertSat: at(tfd, 'NoCertificadoSAT'),
    conceptos: all('Concepto').map((x) => ({
      clave: at(x, 'ClaveProdServ'), cantidad: at(x, 'Cantidad'),
      unidad: at(x, 'ClaveUnidad') || at(x, 'Unidad'), descripcion: at(x, 'Descripcion'),
      valorUnitario: at(x, 'ValorUnitario'), importe: at(x, 'Importe'), iva: tasaConcepto(x),
    })),
    // Complemento de pago
    pago: pago ? {
      fecha: at(pago, 'FechaPago'), forma: at(pago, 'FormaDePagoP'), moneda: at(pago, 'MonedaP') || 'MXN',
      tipoCambio: at(pago, 'TipoCambioP'), monto: at(pago, 'Monto'),
      docs: all('DoctoRelacionado').map((x) => ({
        idDoc: at(x, 'IdDocumento'), serie: at(x, 'Serie'), folio: at(x, 'Folio'),
        moneda: at(x, 'MonedaDR') || 'MXN', parcialidad: at(x, 'NumParcialidad'),
        saldoAnt: at(x, 'ImpSaldoAnt'), pagado: at(x, 'ImpPagado'), saldoInsoluto: at(x, 'ImpSaldoInsoluto'),
      })),
    } : null,
    // CFDI relacionado (nota de crédito)
    relacion: cfdiRel ? {
      tipo: at(cfdiRel, 'TipoRelacion'),
      uuids: all('CfdiRelacionado').map((x) => at(x, 'UUID')),
    } : null,
  };
}

type Cfdi = ReturnType<typeof parseCfdi>;

const FORMA_PAGO: Record<string, string> = {
  '01': 'Efectivo', '02': 'Cheque nominativo', '03': 'Transferencia electrónica',
  '04': 'Tarjeta de crédito', '28': 'Tarjeta de débito', '99': 'Por definir',
};
const METODO_PAGO: Record<string, string> = {
  PUE: 'Pago en una sola exhibición', PPD: 'Pago en parcialidades o diferido',
};
const TIPO_RELACION: Record<string, string> = {
  '01': 'Nota de crédito de los documentos relacionados',
  '02': 'Nota de débito de los documentos relacionados',
  '03': 'Devolución de mercancía',
  '04': 'Sustitución de los CFDI previos', '07': 'CFDI por aplicación de anticipo',
};
const formaTxt = (c?: string) => c ? `${String(c).padStart(2, '0')} — ${FORMA_PAGO[String(c).padStart(2, '0')] || 'Otro'}` : '—';
const metodoTxt = (c?: string) => c ? `${c} — ${METODO_PAGO[c] || ''}` : '—';

/* Número a letras (pesos MXN) para la "importe con letra" de los formatos. */
function numeroALetras(num: number): string {
  const U = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
  const D10 = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
  const D = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
  const dec = (n: number): string => {
    if (n < 10) return U[n];
    if (n < 20) return D10[n - 10];
    if (n < 30) return n === 20 ? 'VEINTE' : 'VEINTI' + U[n - 20];
    const d = Math.floor(n / 10), r = n % 10;
    return D[d] + (r ? ' Y ' + U[r] : '');
  };
  const cen = (n: number): string => {
    if (n === 100) return 'CIEN';
    const c = Math.floor(n / 100), r = n % 100;
    return (C[c] + (r ? ' ' + dec(r) : '')).trim();
  };
  const mil = (n: number): string => {
    if (n < 1000) return cen(n);
    const m = Math.floor(n / 1000), r = n % 1000;
    return ((m === 1 ? 'MIL' : cen(m) + ' MIL') + (r ? ' ' + cen(r) : '')).trim();
  };
  const mill = (n: number): string => {
    if (n < 1_000_000) return mil(n);
    const m = Math.floor(n / 1_000_000), r = n % 1_000_000;
    return ((m === 1 ? 'UN MILLÓN' : mil(m) + ' MILLONES') + (r ? ' ' + mil(r) : '')).trim();
  };
  const ent = Math.floor(Math.abs(num));
  const cent = String(Math.round((Math.abs(num) - ent) * 100)).padStart(2, '0');
  return `${ent === 0 ? 'CERO' : mill(ent)} PESOS ${cent}/100 M.N.`;
}

/* ── El marco común de los tres formatos ──────────────────────────────────── */
function MarcoFormato({ f, titulo, color, children }: {
  f: Cfdi; titulo: string; color: string; children: ReactNode;
}) {
  return (
    <div className="text-sm">
      {/* Encabezado: título + emisor a la izquierda; caja de datos a la derecha */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-3 border-b-2" style={{ borderColor: color }}>
        <div className="min-w-[16rem]">
          <p className="text-2xl font-extrabold" style={{ color }}>{titulo}</p>
          <p className="font-bold mt-1">{f.emisorNombre || '—'}</p>
          <p className="text-xs text-gray-600">RFC: {f.emisorRfc}</p>
          {f.emisorRegimen && <p className="text-xs text-gray-500">Régimen {f.emisorRegimen}</p>}
        </div>
        <div className="rounded-lg border px-4 py-3 text-xs bg-gray-50/70 min-w-[15rem]">
          <Fila k="FOLIO" v={<b>{[f.serie, f.folio].filter(Boolean).join('-') || '—'}</b>} />
          <Fila k="FECHA" v={fechaLarga(f.fecha)} />
          {f.formaPago && <Fila k="FORMA PAGO" v={formaTxt(f.formaPago)} />}
          {f.metodoPago && <Fila k="MÉTODO" v={metodoTxt(f.metodoPago)} />}
          <Fila k="MONEDA" v={f.moneda} />
          <div className="mt-1 pt-1 border-t">
            <p className="text-gray-500">UUID (FOLIO FISCAL)</p>
            <p className="font-mono break-all">{f.uuid || '—'}</p>
          </div>
        </div>
      </div>

      {/* Receptor */}
      <div className="py-3 border-b">
        <p className="text-xs font-semibold text-gray-500">RECEPTOR</p>
        <p className="font-bold">{f.receptorNombre || '—'}</p>
        <p className="text-xs text-gray-600">
          RFC: {f.receptorRfc}{f.receptorDomicilio && ` · CP: ${f.receptorDomicilio}`}
          {f.receptorUso && ` · Uso ${f.receptorUso}`}
        </p>
      </div>

      {children}

      {/* Timbre */}
      <div className="mt-4 pt-2 border-t text-[10px] text-gray-500">
        <p className="font-semibold" style={{ color }}>TIMBRE FISCAL DIGITAL DEL SAT (representación impresa)</p>
        <p>UUID: <span className="font-mono">{f.uuid}</span> · Timbrado: {fechaLarga(f.fechaTimbrado)} · Cert. SAT: {f.noCertSat}</p>
        {(f.selloCfd || f.selloSat) && (
          <details className="mt-1">
            <summary className="cursor-pointer">Sellos</summary>
            <p className="mt-1 break-all"><b>Sello CFD:</b> {f.selloCfd}</p>
            <p className="mt-1 break-all"><b>Sello SAT:</b> {f.selloSat}</p>
          </details>
        )}
      </div>
    </div>
  );
}

function Fila({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="text-gray-500 w-24 shrink-0">{k}</span>
      <span className="flex-1">{v}</span>
    </div>
  );
}

/* ── Formato 2: FACTURA (azul) / también sirve de base para tipo I ─────────── */
function PreviewFactura({ f }: { f: Cfdi }) {
  const azul = '#1e40af';
  return (
    <MarcoFormato f={f} titulo="FACTURA" color={azul}>
      <div className="overflow-x-auto my-3">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ backgroundColor: azul }} className="text-white">
              <th className="px-2 py-1.5 text-right">Cant.</th>
              <th className="px-2 py-1.5 text-left">Descripción</th>
              <th className="px-2 py-1.5 text-left">Unidad</th>
              <th className="px-2 py-1.5 text-left">Clave SAT</th>
              <th className="px-2 py-1.5 text-right">P. Unit.</th>
              <th className="px-2 py-1.5 text-right">IVA</th>
              <th className="px-2 py-1.5 text-right">Importe</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {f.conceptos.map((x, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5 text-right">{x.cantidad}</td>
                <td className="px-2 py-1.5">{x.descripcion}</td>
                <td className="px-2 py-1.5 font-mono text-gray-500">{x.unidad}</td>
                <td className="px-2 py-1.5 font-mono text-gray-500">{x.clave}</td>
                <td className="px-2 py-1.5 text-right">{money(x.valorUnitario, f.moneda)}</td>
                <td className="px-2 py-1.5 text-right">{x.iva}</td>
                <td className="px-2 py-1.5 text-right">{money(x.importe, f.moneda)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Totales f={f} color={azul} etiquetaTotal="TOTAL" />
    </MarcoFormato>
  );
}

/* ── Formato 3: NOTA DE CRÉDITO (rojo) ────────────────────────────────────── */
function PreviewNotaCredito({ f }: { f: Cfdi }) {
  const rojo = '#be123c';
  return (
    <MarcoFormato f={f} titulo="NOTA DE CRÉDITO" color={rojo}>
      {f.relacion && (
        <div className="my-3 rounded-lg border p-3" style={{ borderColor: rojo, backgroundColor: '#fff1f2' }}>
          <p className="text-xs font-semibold" style={{ color: rojo }}>CFDI RELACIONADO (Anexo 20)</p>
          <Fila k="TIPO RELACIÓN" v={`${f.relacion.tipo} — ${TIPO_RELACION[f.relacion.tipo] || 'Otro'}`} />
          {f.relacion.uuids.map((u, i) => <Fila key={i} k="UUID FACTURA" v={<span className="font-mono">{u}</span>} />)}
        </div>
      )}
      <div className="overflow-x-auto my-3">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ backgroundColor: rojo }} className="text-white">
              <th className="px-2 py-1.5 text-right">Cant.</th>
              <th className="px-2 py-1.5 text-left">Descripción</th>
              <th className="px-2 py-1.5 text-right">Importe</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {f.conceptos.map((x, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5 text-right">{x.cantidad}</td>
                <td className="px-2 py-1.5">{x.descripcion}</td>
                <td className="px-2 py-1.5 text-right">{money(x.importe, f.moneda)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Totales f={f} color={rojo} etiquetaTotal="TOTAL NC" />
    </MarcoFormato>
  );
}

function Totales({ f, color, etiquetaTotal }: { f: Cfdi; color: string; etiquetaTotal: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mt-2">
      <p className="text-xs italic text-gray-600 max-w-sm">
        Importe con letra: <b>{numeroALetras(Number(f.total))}</b>
      </p>
      <div className="text-sm min-w-[13rem]">
        <div className="flex justify-between gap-6"><span className="text-gray-500">Subtotal</span><span>{money(f.subtotal, f.moneda)}</span></div>
        {Number(f.descuento) > 0 && (
          <div className="flex justify-between gap-6"><span className="text-gray-500">Descuento</span><span>-{money(f.descuento, f.moneda)}</span></div>
        )}
        {Number(f.totalTraslados) > 0 && (
          <div className="flex justify-between gap-6"><span className="text-gray-500">IVA trasladado</span><span>{money(f.totalTraslados, f.moneda)}</span></div>
        )}
        {Number(f.totalRetenciones) > 0 && (
          <div className="flex justify-between gap-6"><span className="text-gray-500">Retenciones</span><span>-{money(f.totalRetenciones, f.moneda)}</span></div>
        )}
        <div className="flex justify-between gap-6 text-white font-bold px-2 py-1 mt-1 rounded" style={{ backgroundColor: color }}>
          <span>{etiquetaTotal}</span><span>{money(f.total, f.moneda)} {f.moneda}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Formato 1: COMPLEMENTO DE PAGO (verde) — al clic en la cartera ────────── */
function VistaPagos({ pagos, factura }: { pagos: any[]; factura: any }) {
  if (pagos.length === 0) {
    return (
      <div className="text-center text-gray-600 py-6 text-sm">
        Marcada como pagada por método <b>PUE</b> (pago en una sola exhibición): se liquida en la
        emisión, sin complemento de pago aparte.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {pagos.map((p, i) => p.xml
        ? <PreviewComplemento key={i} f={parseCfdi(p.xml)} />
        : (
          <div key={i} className="border rounded-lg p-3 text-sm">
            <p className="font-medium">Pago {p.parcialidad ? `· parcialidad ${p.parcialidad}` : ''} — {money(p.imp_pagado ?? p.total, p.moneda)}</p>
            <p className="text-xs text-gray-500">{fechaLarga(p.fecha_emision)} · {p.uuid}</p>
          </div>
        ))}
      <p className="text-xs text-gray-400 text-center">
        Factura {folioDe(factura) || factura.uuid?.slice(0, 8)} · total {money(factura.total, factura.moneda)}
      </p>
    </div>
  );
}

function PreviewComplemento({ f }: { f: Cfdi }) {
  const verde = '#047857';
  const p = f.pago;
  return (
    <MarcoFormato f={f} titulo="COMPLEMENTO DE PAGO" color={verde}>
      {p && (
        <>
          <div className="my-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
            <p className="text-xs font-semibold text-gray-500 col-span-2">DATOS DEL PAGO</p>
            <Fila k="Fecha" v={fechaLarga(p.fecha)} />
            <Fila k="Forma" v={formaTxt(p.forma)} />
            <Fila k="Moneda" v={p.moneda} />
            <Fila k="Tipo de cambio" v={p.tipoCambio || '1.0000'} />
            <div className="col-span-2 flex gap-2 pt-1">
              <span className="text-gray-500 w-24 shrink-0">Monto pagado</span>
              <span className="font-bold text-base" style={{ color: verde }}>{money(p.monto, p.moneda)}</span>
            </div>
            <p className="col-span-2 text-xs italic text-gray-600">Importe con letra: <b>{numeroALetras(Number(p.monto))}</b></p>
          </div>

          <p className="text-xs font-semibold text-gray-500 mt-2">DOCUMENTOS RELACIONADOS</p>
          <div className="overflow-x-auto mt-1">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: verde }} className="text-white">
                  <th className="px-2 py-1.5 text-left">Folio</th>
                  <th className="px-2 py-1.5 text-left">UUID</th>
                  <th className="px-2 py-1.5 text-center">Moneda</th>
                  <th className="px-2 py-1.5 text-center">Parc.</th>
                  <th className="px-2 py-1.5 text-right">Saldo ant.</th>
                  <th className="px-2 py-1.5 text-right">Imp. pagado</th>
                  <th className="px-2 py-1.5 text-right">Saldo insoluto</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {p.docs.map((x, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5">{[x.serie, x.folio].filter(Boolean).join('-') || '—'}</td>
                    <td className="px-2 py-1.5 font-mono text-gray-500">{x.idDoc}</td>
                    <td className="px-2 py-1.5 text-center">{x.moneda}</td>
                    <td className="px-2 py-1.5 text-center">{x.parcialidad}</td>
                    <td className="px-2 py-1.5 text-right">{money(x.saldoAnt, x.moneda)}</td>
                    <td className="px-2 py-1.5 text-right font-medium" style={{ color: verde }}>{money(x.pagado, x.moneda)}</td>
                    <td className="px-2 py-1.5 text-right">{money(x.saldoInsoluto, x.moneda)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </MarcoFormato>
  );
}

/* ── Cancelación y ficha (recibidos, sólo metadatos) ──────────────────────── */
function VistaCancelacion({ c }: { c: any }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2 text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">
        <Ban size={20} />
        <div>
          <p className="font-semibold">Comprobante cancelado ante el SAT</p>
          {c.fecha_cancelacion
            ? <p className="text-xs">Cancelado el {fechaLarga(c.fecha_cancelacion)}</p>
            : <p className="text-xs">Fecha de cancelación no informada en el metadato.</p>}
        </div>
      </div>
      <Datos filas={[
        ['UUID', c.uuid],
        ['Emisor', `${c.nombre_emisor || '—'} · ${c.rfc_emisor || ''}`],
        ['Receptor', `${c.nombre_receptor || '—'} · ${c.rfc_receptor || ''}`],
        ['Fecha de emisión', fechaLarga(c.fecha_emision)],
        ['Total', money(c.total, c.moneda)],
      ]} />
    </div>
  );
}

function VistaFicha({ c, emitido }: { c: any; emitido: boolean }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
        De los recibidos el SAT sólo entrega metadatos (no su XML). Esto es lo que hay para cuadrar la cuenta por pagar.
      </p>
      <Datos filas={[
        ['UUID', c.uuid],
        [emitido ? 'Cliente' : 'Proveedor', c.nombre_emisor || '—'],
        ['RFC', c.rfc_emisor || '—'],
        ['Fecha de emisión', fechaCorta(c.fecha_emision)],
        ['Total', money(c.total, c.moneda)],
        ['Estatus', c.estado_sat || 'Vigente'],
        ...(c.fecha_cancelacion ? [['Cancelado el', fechaLarga(c.fecha_cancelacion)] as [string, string]] : []),
        ...(c.cuenta_contable ? [['Cuenta contable (CC)', c.cuenta_contable] as [string, string]] : []),
      ]} />
    </div>
  );
}

function Datos({ filas }: { filas: [string, any][] }) {
  return (
    <dl className="divide-y border rounded-lg">
      {filas.map(([k, v], i) => (
        <div key={i} className="flex gap-3 px-3 py-2">
          <dt className="w-40 shrink-0 text-xs text-gray-500">{k}</dt>
          <dd className="text-sm break-all">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export default TablaComprobantesSat;
