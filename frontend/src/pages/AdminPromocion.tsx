/**
 * Promoción y cobros — pantalla del SUPER_ADMIN para la oferta de lanzamiento.
 *
 * Tres bloques que son los tres momentos del recorrido comercial:
 *   1. Prueba      — dar los 10 timbres de cortesía (3 lugares).
 *   2. Contratar   — cotizar el prorrateo y generar el cobro prepago.
 *   3. Por cobrar  — registrar el pago, que es lo que libera el servicio.
 *
 * El orden en pantalla es ese a propósito: es el orden en que ocurren, y quien
 * atiende a un prospecto avanza de arriba hacia abajo sin buscar en menús.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Calculator, Receipt, Check, Loader2, AlertTriangle, Mail, FileText } from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AdminPromocionPage() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [ocupado, setOcupado] = useState('');

  const prueba = useQuery({ queryKey: ['promo-prueba'], queryFn: () => api.promoEstadoPrueba() });
  const cobros = useQuery({ queryKey: ['promo-cobros'], queryFn: () => api.promoCobros('PENDING') });

  const p: any = (prueba.data as any)?.data ?? {};
  const listaCobros: any[] = (cobros.data as any)?.data?.cobros ?? [];

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['promo-prueba'] });
    qc.invalidateQueries({ queryKey: ['promo-cobros'] });
  };

  /** Envuelve una acción para no repetir el manejo de aviso/error en cada botón. */
  const correr = async (clave: string, fn: () => Promise<any>, exito: string) => {
    setError(''); setOk(''); setOcupado(clave);
    /* `exito` sólo se aplica si trae texto. Las acciones que arman su propio
     * mensaje —las que reportan si salió el correo o si se timbró la factura—
     * pasan cadena vacía, y sin esta condición el setOk de aquí borraría lo
     * que acaban de escribir: la pantalla quedaría muda justo en los casos en
     * que hay algo que decir. */
    try { await fn(); if (exito) setOk(exito); refrescar(); }
    catch (e: any) { setError(e?.response?.data?.message || e?.message || 'No se pudo completar'); }
    finally { setOcupado(''); }
  };

  /* ── Contratación ── */
  const [empresaSel, setEmpresaSel] = useState('');
  const [paqueteSel, setPaqueteSel] = useState('PKG_100');
  const [cotiza, setCotiza] = useState<any>(null);

  const cotizar = () => correr('cotizar', async () => {
    const r: any = await api.promoCotizar(paqueteSel);
    setCotiza(r.data ?? r);
  }, '');

  return (
    <div className="mx-auto max-w-[1100px] p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Promoción y cobros</h1>
        <p className="text-sm text-slate-500">
          Prueba de cortesía, contratación prorrateada y registro de pagos.
        </p>
      </div>

      {error && (
        <div className="flex gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}
      {ok && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded text-sm">{ok}</div>
      )}

      {/* ── 1. Prueba de cortesía ── */}
      <section className="bg-white rounded-lg border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-1">
          <Gift size={18} className="text-fuchsia-600" />
          <h2 className="font-bold text-slate-900">Prueba de cortesía</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          {p.timbresPorEmpresa ?? 10} timbres, una sola vez por empresa.{' '}
          <b className={p.lugaresLibres === 0 ? 'text-amber-700' : 'text-emerald-700'}>
            {p.lugaresLibres ?? 0} de {p.maximo ?? 3} lugares libres
          </b>
          {/* Cuando la promoción se llena hay que decir cómo se destraba, o el
              único camino visible es aumentar el máximo en el código. */}
          {p.lugaresLibres === 0 && ' — se libera un lugar cuando una de esas empresas contrata un paquete.'}
        </p>

        {(p.empresas ?? []).length > 0 && (
          <div className="mb-4 space-y-1">
            {p.empresas.map((e: any) => (
              <div key={e.id} className="flex items-center justify-between text-sm border-b border-slate-100 py-1.5">
                <span className="text-slate-700">
                  <span className="font-mono text-xs text-slate-500 mr-2">{e.rfc}</span>{e.business_name}
                </span>
                <span className={`font-mono ${Number(e.trial_stamps_left) === 0 ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>
                  {e.trial_stamps_left} timbres
                  {Number(e.trial_stamps_left) === 0 && ' · agotados'}
                </span>
              </div>
            ))}
          </div>
        )}

        {p.lugaresLibres > 0 && (
          <div className="flex gap-2">
            <select value={empresaSel} onChange={(e) => setEmpresaSel(e.target.value)} className="input flex-1">
              <option value="">— elige la empresa que va a probar —</option>
              {(p.candidatas ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.rfc} · {c.business_name}</option>
              ))}
            </select>
            <button
              disabled={!empresaSel || ocupado === 'prueba'}
              onClick={() => correr('prueba', () => api.promoActivarPrueba(empresaSel), 'Prueba activada.')}
              className="px-4 py-2 bg-fuchsia-600 text-white rounded-lg disabled:opacity-40"
            >
              {ocupado === 'prueba' ? <Loader2 size={16} className="animate-spin" /> : 'Dar los timbres'}
            </button>
          </div>
        )}
      </section>

      {/* ── 2. Contratar con prorrateo ── */}
      <section className="bg-white rounded-lg border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-1">
          <Calculator size={18} className="text-indigo-600" />
          <h2 className="font-bold text-slate-900">Contratar un paquete</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Es prepago: se cobra la parte proporcional a los días que faltan del mes, y el
          servicio se libera cuando registras el pago.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select value={empresaSel} onChange={(e) => setEmpresaSel(e.target.value)} className="input">
            <option value="">— empresa —</option>
            {(p.candidatas ?? []).concat(p.empresas ?? []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.rfc} · {c.business_name}</option>
            ))}
          </select>
          <select value={paqueteSel} onChange={(e) => { setPaqueteSel(e.target.value); setCotiza(null); }} className="input">
            {/* Sin precios escritos aquí: los tuve puestos a mano y quedaron
                en $1,399 el mismo día que Empresarial subió a $1,800. El
                importe real lo dice el servidor en "Ver cuánto paga hoy", que
                lee stamp_packages — que es lo que de verdad se cobra. */}
            <option value="PKG_100">Esencial — 100 timbres</option>
            <option value="PKG_200">Pyme — 200 timbres</option>
            <option value="PKG_500">Empresarial — 500 timbres</option>
          </select>
          <button onClick={cotizar} disabled={ocupado === 'cotizar'}
            className="px-4 py-2 border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-50">
            {ocupado === 'cotizar' ? '…' : 'Ver cuánto paga hoy'}
          </button>
        </div>

        {cotiza && (
          <div className="mt-4 bg-indigo-50 border border-indigo-200 rounded p-4">
            <div className="text-sm text-slate-700">
              Del <b>{cotiza.startsOn}</b> al <b>{cotiza.endsOn}</b> — {cotiza.daysCharged} de {cotiza.daysInMonth} días
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-2xl font-bold text-indigo-700">${money(cotiza.amount)}</span>
              <span className="text-sm text-slate-500 line-through">${money(cotiza.fullPrice)}</span>
              <span className="text-sm text-slate-700">
                y <b>{cotiza.stampsGranted}</b> timbres <span className="text-slate-500">(de {cotiza.fullStamps})</span>
              </span>
            </div>
            {/* Se explica el prorrateo de los timbres aquí porque es la
                pregunta que el cliente va a hacer, y quien atiende tiene que
                poder contestarla sin llamar a nadie. */}
            <p className="text-xs text-slate-600 mt-2">
              Se prorratean el precio y los timbres. El mes que entra ya recibe el paquete completo.
            </p>
            <button
              disabled={!empresaSel || ocupado === 'cobro'}
              onClick={() => correr('cobro', async () => {
                const r: any = await api.promoGenerarCobro(empresaSel, paqueteSel);
                const aviso = (r.data ?? r)?.aviso;
                /* Se dice explicitamente si el correo salio o no. Un "cobro
                   generado" a secas deja creyendo que al cliente ya le
                   avisaron, y nadie vuelve a mirar hasta que no paga. */
                setOk(aviso?.enviado
                  ? `Cobro generado y ${String(aviso.detalle).toLowerCase()}.`
                  : `Cobro generado, PERO el aviso no salió: ${aviso?.detalle ?? 'sin detalle'}. Avísale por otra vía.`);
              }, '')}
              className="mt-3 px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-40"
            >
              {ocupado === 'cobro' ? 'Generando…' : 'Generar el cobro'}
            </button>
          </div>
        )}
      </section>

      {/* ── 3. Por cobrar ── */}
      <section className="bg-white rounded-lg border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-1">
          <Receipt size={18} className="text-amber-600" />
          <h2 className="font-bold text-slate-900">Por cobrar</h2>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Estas empresas ya contrataron pero <b>no pueden timbrar todavía</b>: el paquete se
          asigna cuando entra el pago.
        </p>

        {listaCobros.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">Nada pendiente de cobro.</p>
        ) : (
          <div className="space-y-2">
            {listaCobros.map((c) => (
              <div key={c.id} className="flex items-center justify-between border border-slate-200 rounded p-3">
                <div>
                  <div className="text-sm font-medium text-slate-800">
                    <span className="font-mono text-xs text-slate-500 mr-2">{c.rfc}</span>{c.business_name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.package_name} · {c.days_charged}/{c.days_in_month} días · {c.stamps_granted} timbres
                    · desde {String(c.starts_on).slice(0, 10)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 mr-1">${money(c.amount_mxn)}</span>
                  {/* Dos botones y no uno: el correo puede no haber salido
                      aunque la factura esté timbrada, y al revés. Un
                      "reintentar todo" volvería a timbrar un CFDI que ya
                      existe y le mandaría dos facturas al cliente. */}
                  <button
                    title={c.notified_at ? `Avisado el ${String(c.notified_at).slice(0, 10)}` : 'Todavía no se le avisa'}
                    disabled={ocupado === `av-${c.id}`}
                    onClick={() => correr(`av-${c.id}`, async () => {
                      const r: any = await api.promoReavisar(c.id);
                      const d = r.data ?? r;
                      setOk(d?.detalle ?? 'Aviso reenviado');
                    }, '')}
                    className={`flex items-center gap-1 px-2 py-1.5 text-xs rounded border ${
                      c.notified_at
                        ? 'border-slate-200 text-slate-500 hover:bg-slate-50'
                        : 'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100'
                    }`}
                  >
                    <Mail size={13} /> {c.notified_at ? 'Reenviar' : 'Avisar'}
                  </button>
                  {c.invoice_id && (
                    <span title="Ya tiene su CFDI" className="flex items-center gap-1 px-2 py-1.5 text-xs text-emerald-700">
                      <FileText size={13} /> facturado
                    </span>
                  )}
                  <button
                    disabled={ocupado === c.id}
                    onClick={() => correr(c.id, async () => {
                      const r: any = await api.promoRegistrarPago(c.id);
                      const cfdi = (r.data ?? r)?.cfdi;
                      setOk(cfdi?.status === 'INVOICED'
                        ? `Pago registrado, la empresa ya puede timbrar, y ${String(cfdi.detail).toLowerCase()}.`
                        : `Pago registrado y la empresa ya puede timbrar. La factura NO se emitió: ` +
                          `${cfdi?.detail ?? 'sin detalle'} — usa "Facturar" cuando se resuelva.`);
                    }, '')}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg disabled:opacity-40"
                  >
                    <Check size={14} /> {ocupado === c.id ? 'Registrando…' : 'Registrar pago'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default AdminPromocionPage;
