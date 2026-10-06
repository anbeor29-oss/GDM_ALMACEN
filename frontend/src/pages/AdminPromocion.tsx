/**
 * Promoción y cobros — pantalla del SUPER_ADMIN.
 *
 * La "Prueba de cortesía" (prueba gratis) se QUITÓ: las pruebas van por el
 * onboarding de 72 h (/registro), no por timbres de cortesía. "Contratar un
 * paquete" (prepago) también se quitó antes (el cobro es por usuario, en
 * Facturación). Queda sólo "Por cobrar" (prepagos pendientes históricos).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Receipt, Check, AlertTriangle, Mail, FileText } from 'lucide-react';
import api from '@/services/api';

const money = (n: any) =>
  Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AdminPromocionPage() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [ocupado, setOcupado] = useState('');

  const cobros = useQuery({ queryKey: ['promo-cobros'], queryFn: () => api.promoCobros('PENDING') });
  const listaCobros: any[] = (cobros.data as any)?.data?.cobros ?? [];

  const refrescar = () => { qc.invalidateQueries({ queryKey: ['promo-cobros'] }); };

  /** Envuelve una acción para no repetir el manejo de aviso/error en cada botón. */
  const correr = async (clave: string, fn: () => Promise<any>, exito: string) => {
    setError(''); setOk(''); setOcupado(clave);
    try { await fn(); if (exito) setOk(exito); refrescar(); }
    catch (e: any) { setError(e?.response?.data?.message || e?.message || 'No se pudo completar'); }
    finally { setOcupado(''); }
  };

  return (
    <div className="mx-auto max-w-[1100px] p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Promoción y cobros</h1>
        <p className="text-sm text-slate-500">Registro de pagos pendientes.</p>
      </div>

      {error && (
        <div className="flex gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}
      {ok && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded text-sm">{ok}</div>
      )}

      {/* ── Por cobrar ── */}
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
