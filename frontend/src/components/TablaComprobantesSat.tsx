/**
 * TablaComprobantesSat — la vista de los submenús Emitidos / Recibidos.
 *
 * Es la tabla del Anexo 20 como la mira contabilidad: fecha (de menor a mayor),
 * folio, la contraparte (cliente en emitidos, proveedor en recibidos), RFC,
 * total, ESTATUS con iconos y la cuenta contable (CC).
 *
 * LOS DOS LADOS NO TRAEN LO MISMO
 * De EMITIDOS tenemos el XML: el folio va en verde y al hacer clic se abre la
 * representación del comprobante. De RECIBIDOS el SAT sólo entrega metadatos
 * (no deja bajar su XML si hay cancelados): por eso su folio lleva un punto rojo
 * y el clic abre la ficha con lo que sí hay.
 *
 * ICONOS DE ESTATUS (los estándar del sistema, lucide)
 *   Wallet verde  = pagado  → clic: el timbre de pago que la liquida.
 *   Ban rojo      = cancelado → clic: la cancelación (fecha y datos).
 * La columna deja aire a propósito: van a entrar más estatus.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, Ban, FileText, X, RefreshCw, Search, Circle, Check, Pencil } from 'lucide-react';
import { api } from '@/services/api';

type Direccion = 'emitidos' | 'recibidos';
type Modo = 'representacion' | 'pago' | 'cancelacion' | 'ficha';

const money = (n: any, moneda = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: moneda || 'MXN' })
    .format(Number(n) || 0);

const fechaCorta = (s?: string) =>
  s ? new Date(s).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

const fechaLarga = (s?: string) =>
  s ? new Date(s).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const folioDe = (c: any) => [c.serie, c.folio].filter(Boolean).join('-');

export function TablaComprobantesSat({ direccion, anio, mes }: {
  direccion: Direccion; anio?: number; mes?: number;
}) {
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

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg shadow border p-4 flex flex-wrap items-center gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <FileText className="text-emerald-600" size={20} />
          {emitidos ? 'Emitidos' : 'Recibidos'}
          <span className="text-sm font-normal text-gray-500">
            {visibles.length} comprobante(s)
          </span>
        </h2>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder={emitidos ? 'Cliente, RFC, folio…' : 'Proveedor, RFC, UUID…'}
              className="input pl-8 py-1.5 text-sm w-56"
            />
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
              {/* Ancho generoso: van a entrar más estatus. */}
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
                Sin comprobantes. Pídelos al SAT arriba: conforme lleguen aparecen aquí, ordenados por fecha.
              </td></tr>
            )}
            {visibles.map((c) => {
              const cancelado = c.estado_sat === 'Cancelado';
              const folio = folioDe(c);
              return (
                <tr key={c.id} className={cancelado ? 'bg-rose-50/40' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-2 text-sm whitespace-nowrap">{fechaCorta(c.fecha_emision)}</td>

                  {/* Folio: verde+representación (emitidos con XML) o punto rojo+ficha (recibidos) */}
                  <td className="px-4 py-2 text-sm whitespace-nowrap">
                    {c.tiene_xml ? (
                      <button
                        onClick={() => setDetalle({ id: c.id, modo: 'representacion' })}
                        className="font-semibold text-emerald-600 hover:text-emerald-700 hover:underline"
                        title="Ver la representación de la factura"
                      >
                        {folio || 'Ver factura'}
                      </button>
                    ) : (
                      <button
                        onClick={() => setDetalle({ id: c.id, modo: 'ficha' })}
                        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 hover:underline"
                        title="Sólo metadatos: ver la ficha"
                      >
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                        {folio || 'Ver ficha'}
                      </button>
                    )}
                  </td>

                  <td className="px-4 py-2 text-sm">
                    <p className="truncate max-w-xs">{c.contraparte_nombre || '—'}</p>
                  </td>
                  <td className="px-4 py-2 text-xs font-mono text-gray-600 whitespace-nowrap">{c.contraparte_rfc || '—'}</td>
                  <td className="px-4 py-2 text-right font-semibold whitespace-nowrap">{money(c.total, c.moneda)}</td>

                  {/* Estatus: iconos estándar, con aire para los que faltan */}
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-center gap-4">
                      <EstatusIconos
                        cancelado={cancelado}
                        pagado={!!c.pagado}
                        emitido={emitidos}
                        onCancelacion={() => setDetalle({ id: c.id, modo: 'cancelacion' })}
                        onPago={() => setDetalle({ id: c.id, modo: 'pago' })}
                      />
                    </div>
                  </td>

                  <td className="px-4 py-2">
                    <CeldaCuenta id={c.id} valor={c.cuenta_contable} direccion={direccion} anio={anio} mes={mes} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detalle && (
        <ComprobanteModal
          id={detalle.id}
          modo={detalle.modo}
          emitido={emitidos}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  );
}

/* ── Los iconos de estatus ────────────────────────────────────────────────
 * Wallet verde = pagado; Ban rojo = cancelado; y un círculo hueco para lo
 * vigente-no-pagado (por cobrar/pagar), que deja ver que hay más por venir. */
function EstatusIconos({ cancelado, pagado, emitido, onCancelacion, onPago }: {
  cancelado: boolean; pagado: boolean; emitido: boolean;
  onCancelacion: () => void; onPago: () => void;
}) {
  if (cancelado) {
    return (
      <button onClick={onCancelacion} title="Cancelado — ver la cancelación"
        className="text-rose-600 hover:text-rose-700">
        <Ban size={20} />
      </button>
    );
  }
  if (pagado) {
    return (
      <button onClick={onPago} title="Pagado — ver el timbre de pago"
        className="text-emerald-600 hover:text-emerald-700">
        <Wallet size={20} />
      </button>
    );
  }
  return (
    <span title={emitido ? 'Vigente · por cobrar' : 'Vigente · por pagar'} className="text-gray-300">
      <Circle size={18} />
    </span>
  );
}

/* ── La celda de cuenta contable (CC): se edita en el mismo lugar ─────────── */
function CeldaCuenta({ id, valor, direccion, anio, mes }: {
  id: string; valor?: string | null; direccion: Direccion; anio?: number; mes?: number;
}) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(valor || '');
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setGuardando(true);
    try {
      await api.setSatCuentaContable(id, texto.trim() || null);
      qc.invalidateQueries({ queryKey: ['sat-vista', direccion, anio, mes] });
      setEditando(false);
    } finally { setGuardando(false); }
  };

  if (editando) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(false); }}
          placeholder="Cuenta" className="input py-1 text-xs w-24" />
        <button onClick={guardar} disabled={guardando} className="text-emerald-600 hover:text-emerald-700">
          <Check size={15} />
        </button>
      </div>
    );
  }
  return (
    <button onClick={() => { setTexto(valor || ''); setEditando(true); }}
      className="group flex items-center gap-1 text-sm text-gray-700 hover:text-gray-900"
      title="Asignar cuenta contable">
      {valor
        ? <span className="font-mono">{valor}</span>
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

  const titulo =
    modo === 'representacion' ? 'Representación de la factura'
    : modo === 'pago'         ? 'Timbre(s) de pago'
    : modo === 'cancelacion'  ? 'Cancelación'
    : 'Ficha del comprobante';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white rounded-t-xl">
          <h3 className="font-semibold flex items-center gap-2">
            <FileText size={18} className="text-emerald-600" /> {titulo}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>

        <div className="p-5">
          {q.isLoading && <p className="text-center text-gray-500 py-8">Cargando…</p>}
          {!q.isLoading && !c && <p className="text-center text-gray-500 py-8">No se encontró el comprobante.</p>}

          {c && modo === 'representacion' && <Representacion xml={c.xml} cuenta={c.cuenta_contable} />}
          {c && modo === 'pago' && <VistaPagos pagos={pagos} factura={c} />}
          {c && modo === 'cancelacion' && <VistaCancelacion c={c} />}
          {c && modo === 'ficha' && <VistaFicha c={c} emitido={emitido} />}
        </div>
      </div>
    </div>
  );
}

/* Parseo del CFDI sin depender del prefijo de namespace (cfdi:, tfd:, …). */
function parseCfdi(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const first = (n: string) => doc.getElementsByTagNameNS('*', n)[0] || null;
  const all = (n: string) => Array.from(doc.getElementsByTagNameNS('*', n));
  const at = (el: Element | null, a: string) => (el?.getAttribute(a) ?? '');
  const comp = first('Comprobante');
  const em = first('Emisor');
  const re = first('Receptor');
  const tfd = first('TimbreFiscalDigital');
  return {
    serie: at(comp, 'Serie'), folio: at(comp, 'Folio'), fecha: at(comp, 'Fecha'),
    subtotal: at(comp, 'SubTotal'), descuento: at(comp, 'Descuento'), total: at(comp, 'Total'),
    moneda: at(comp, 'Moneda') || 'MXN', tipoCambio: at(comp, 'TipoCambio'),
    metodoPago: at(comp, 'MetodoPago'), formaPago: at(comp, 'FormaPago'), tipo: at(comp, 'TipoDeComprobante'),
    emisorRfc: at(em, 'Rfc'), emisorNombre: at(em, 'Nombre'), emisorRegimen: at(em, 'RegimenFiscal'),
    receptorRfc: at(re, 'Rfc'), receptorNombre: at(re, 'Nombre'), receptorUso: at(re, 'UsoCFDI'),
    receptorDomicilio: at(re, 'DomicilioFiscalReceptor'), receptorRegimen: at(re, 'RegimenFiscalReceptor'),
    uuid: at(tfd, 'UUID'), fechaTimbrado: at(tfd, 'FechaTimbrado'),
    selloCfd: at(tfd, 'SelloCFD'), selloSat: at(tfd, 'SelloSAT'), noCertSat: at(tfd, 'NoCertificadoSAT'),
    conceptos: all('Concepto').map((x) => ({
      clave: at(x, 'ClaveProdServ'), cantidad: at(x, 'Cantidad'),
      unidad: at(x, 'ClaveUnidad') || at(x, 'Unidad'), descripcion: at(x, 'Descripcion'),
      valorUnitario: at(x, 'ValorUnitario'), importe: at(x, 'Importe'),
    })),
  };
}

const TIPO_CFDI: Record<string, string> = { I: 'Ingreso', E: 'Egreso', P: 'Pago', N: 'Nómina', T: 'Traslado' };

function Representacion({ xml, cuenta }: { xml?: string | null; cuenta?: string | null }) {
  if (!xml) return <p className="text-center text-gray-500 py-6">Este comprobante no tiene XML guardado.</p>;
  const f = parseCfdi(xml);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold">{[f.serie, f.folio].filter(Boolean).join('-') || 'Sin folio'}</p>
          <p className="text-gray-500">{TIPO_CFDI[f.tipo] || f.tipo} · {fechaLarga(f.fecha)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">UUID</p>
          <p className="font-mono text-xs">{f.uuid || '—'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="border rounded-lg p-3 bg-gray-50/60">
          <p className="text-xs font-semibold text-gray-500 mb-1">Emisor</p>
          <p className="font-medium">{f.emisorNombre || '—'}</p>
          <p className="font-mono text-xs text-gray-600">{f.emisorRfc}</p>
          {f.emisorRegimen && <p className="text-xs text-gray-500">Régimen {f.emisorRegimen}</p>}
        </div>
        <div className="border rounded-lg p-3 bg-gray-50/60">
          <p className="text-xs font-semibold text-gray-500 mb-1">Receptor</p>
          <p className="font-medium">{f.receptorNombre || '—'}</p>
          <p className="font-mono text-xs text-gray-600">{f.receptorRfc}</p>
          <p className="text-xs text-gray-500">
            {f.receptorUso && `Uso ${f.receptorUso}`}
            {f.receptorDomicilio && ` · CP ${f.receptorDomicilio}`}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Clave</th>
              <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Cant.</th>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Descripción</th>
              <th className="px-2 py-1.5 text-right font-semibold text-gray-600">V. unitario</th>
              <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Importe</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {f.conceptos.map((x, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5 font-mono text-gray-600">{x.clave}</td>
                <td className="px-2 py-1.5 text-right">{x.cantidad} {x.unidad}</td>
                <td className="px-2 py-1.5">{x.descripcion}</td>
                <td className="px-2 py-1.5 text-right">{money(x.valorUnitario, f.moneda)}</td>
                <td className="px-2 py-1.5 text-right">{money(x.importe, f.moneda)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-xs text-gray-500 space-y-0.5">
          <p>Método de pago: <b>{f.metodoPago || '—'}</b> · Forma: {f.formaPago || '—'} · Moneda: {f.moneda}</p>
          {cuenta && <p>Cuenta contable (CC): <b className="font-mono">{cuenta}</b></p>}
          <p>Timbrado: {fechaLarga(f.fechaTimbrado)} · Cert. SAT {f.noCertSat}</p>
        </div>
        <div className="text-sm text-right min-w-[10rem]">
          <div className="flex justify-between gap-6"><span className="text-gray-500">Subtotal</span><span>{money(f.subtotal, f.moneda)}</span></div>
          {Number(f.descuento) > 0 && (
            <div className="flex justify-between gap-6"><span className="text-gray-500">Descuento</span><span>-{money(f.descuento, f.moneda)}</span></div>
          )}
          <div className="flex justify-between gap-6 font-bold text-base border-t mt-1 pt-1"><span>Total</span><span>{money(f.total, f.moneda)}</span></div>
        </div>
      </div>

      {(f.selloCfd || f.selloSat) && (
        <details className="text-[10px] text-gray-400">
          <summary className="cursor-pointer text-gray-500">Sellos del timbre</summary>
          <p className="mt-1 break-all"><b>Sello CFD:</b> {f.selloCfd}</p>
          <p className="mt-1 break-all"><b>Sello SAT:</b> {f.selloSat}</p>
        </details>
      )}
    </div>
  );
}

function VistaPagos({ pagos, factura }: { pagos: any[]; factura: any }) {
  if (pagos.length === 0) {
    return (
      <div className="text-center text-gray-500 py-6">
        Marcada como pagada por método <b>PUE</b> (pago en una exhibición): se liquida en la
        emisión, sin complemento de pago aparte.
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-gray-600">
        La factura <b>{folioDe(factura) || factura.uuid?.slice(0, 8)}</b> por {money(factura.total, factura.moneda)} se
        liquida con {pagos.length} timbre(s) de pago:
      </p>
      {pagos.map((p, i) => {
        const f = p.xml ? parseCfdi(p.xml) : null;
        return (
          <div key={i} className="border rounded-lg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">Pago {p.parcialidad ? `· parcialidad ${p.parcialidad}` : ''}</p>
                <p className="text-xs text-gray-500">{fechaLarga(p.fecha_emision)}</p>
                <p className="font-mono text-[11px] text-gray-500">{p.uuid}</p>
              </div>
              <p className="text-lg font-bold text-emerald-600">{money(p.imp_pagado ?? p.total, p.moneda || 'MXN')}</p>
            </div>
            {f && (
              <p className="text-xs text-gray-500 mt-1">
                Forma de pago {f.formaPago || '—'} · timbrado {fechaLarga(f.fechaTimbrado)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
        De los recibidos el SAT sólo entrega metadatos (no su XML). Esto es lo que hay para
        cuadrar la cuenta por pagar.
      </p>
      <Datos filas={[
        ['UUID', c.uuid],
        [emitido ? 'Cliente' : 'Proveedor', `${c.nombre_emisor || '—'}`],
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
