/**
 * Captura de Nueva Factura — CFDI 4.0
 *
 * - Header con datos del emisor (mi empresa) y del receptor (cliente)
 * - 10 líneas editables por defecto (se agregan más con un botón)
 * - Cantidad + Clave Unidad + Descripción + Clave SAT + Precio Unit. + Subtotal
 * - Totales abajo a la izquierda con desglose IVA / retenciones según el preset
 *   de impuesto seleccionado por línea (matriz cliente×impuesto del wiki)
 * - Formato es-MX: miles `,`, decimales `.`, 2 decimales en montos y cantidades.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft, Trash2, Search, Save, Building2, User, X } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import api from '@/services/api';

/* ─────────────── formatos es-MX ─────────────── */

function fmtMoney(n: number): string {
  if (!isFinite(n)) return '0.00';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtQty(n: number): string {
  if (!isFinite(n)) return '0.000';
  // Hasta 6 enteros + 3 decimales (999,999.999 — miles de kg, piezas, gramaje, etc.)
  return n.toLocaleString('es-MX', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
function parseNum(s: string): number {
  if (!s) return 0;
  // Aceptamos "1,234.56" o "1234.56"
  const cleaned = s.replace(/[^\d.-]/g, '');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

/* ─────────────── presets de impuesto (espejo del modal de productos) ─────────────── */

interface TaxPreset {
  id: string;
  short: string;     // etiqueta corta para el select de cada línea
  long: string;      // descripción completa (tooltip)
  rateIva: number;   // ej. 0.16
  retIva: number;    // ej. 0.106667 (2/3 IVA)
  retIsr: number;    // ej. 0.10 o 0.0125
}

const TAX_PRESETS: TaxPreset[] = [
  { id: 'iva16',        short: 'IVA 16%',                  long: 'IVA 16% trasladado (general)',                                                       rateIva: 0.16, retIva: 0,        retIsr: 0 },
  { id: 'iva8',         short: 'IVA 8% frontera',          long: 'IVA 8% trasladado (zona fronteriza)',                                                rateIva: 0.08, retIva: 0,        retIsr: 0 },
  { id: 'iva0',         short: 'IVA 0%',                   long: 'IVA 0% trasladado (alimentos básicos, medicinas, libros)',                            rateIva: 0,    retIva: 0,        retIsr: 0 },
  { id: 'ivaex',        short: 'IVA Exento',               long: 'Operación exenta de IVA',                                                            rateIva: 0,    retIva: 0,        retIsr: 0 },
  { id: 'hon_pf_pm',    short: 'Honorarios PF→PM',         long: 'PF (612) → PM. IVA 16% trasladado + Ret. IVA 10.6667% + Ret. ISR 10%',                rateIva: 0.16, retIva: 0.106667, retIsr: 0.10 },
  { id: 'resico_pf_pm', short: 'RESICO PF→PM',             long: 'PF RESICO (626) → PM. IVA 16% + Ret. IVA 10.6667% + Ret. ISR 1.25%',                  rateIva: 0.16, retIva: 0.106667, retIsr: 0.0125 },
  { id: 'arr_pf_pm',    short: 'Arrendamiento PF→PM',      long: 'Arrendamiento PF (606) → PM. IVA 16% + Ret. IVA 10.6667% + Ret. ISR 10%',             rateIva: 0.16, retIva: 0.106667, retIsr: 0.10 },
  { id: 'auto_carga',   short: 'Autotransporte (Ret. 4%)', long: 'Servicio de autotransporte de carga — Ret. IVA 4%',                                  rateIva: 0.16, retIva: 0.04,     retIsr: 0 },
  { id: 'desperdicios', short: 'Desperdicios (Ret. 16%)',  long: 'Compra de desperdicios — Ret. IVA 100%',                                             rateIva: 0.16, retIva: 0.16,     retIsr: 0 },
];

function inferPresetFromProduct(p: any): string {
  if (!p) return 'iva16';
  if (p.tax_type === 'EXENTO') return 'ivaex';
  const r = Number(p.tax_rate);
  if (r === 0.08) return 'iva8';
  if (r === 0)    return 'iva0';
  return 'iva16';
}

/** Si el cliente es PF con régimen que típicamente lleva retenciones (PM compradora),
 *  el sistema sugiere el preset adecuado por régimen fiscal SAT del cliente.
 *  c_RegimenFiscal:
 *    605 Sueldos y Salarios          → (no aplica facturación al cliente)
 *    606 Arrendamiento               → arr_pf_pm
 *    612 Honorarios PF               → hon_pf_pm
 *    621 Incorporación Fiscal        → iva16
 *    625 Plataformas tecnológicas    → iva16
 *    626 RESICO PF                   → resico_pf_pm
 *    Otros / PM (601, 603, etc.)     → iva16
 */
function inferPresetFromCustomer(customer: any): string | null {
  if (!customer) return null;
  switch (String(customer.fiscal_regime || '')) {
    case '606': return 'arr_pf_pm';
    case '612': return 'hon_pf_pm';
    case '626': return 'resico_pf_pm';
    default:    return null;
  }
}

function pickLinePreset(product: any, customer: any): string {
  // 1) Si el producto YA tiene un preset persistido (RESICO/honorarios/IEPS…), respétalo
  //    — el usuario lo eligió expresamente en el catálogo de productos.
  if (product?.tax_preset_id) return product.tax_preset_id;

  // 2) Si el cliente tiene régimen con retención (RESICO/honorarios/arrendamiento),
  //    aplica ese preset salvo que el producto sea estructuralmente exento o tasa 0.
  const fromCust = inferPresetFromCustomer(customer);
  const fromProd = inferPresetFromProduct(product);
  if (fromProd === 'ivaex' || fromProd === 'iva0') return fromProd;
  if (fromCust) return fromCust;
  return fromProd;
}

/* ─────────────── modelo de línea ─────────────── */

interface InvoiceLine {
  uid: number;
  productId: string;
  sku: string;
  claveSat: string;
  unitCode: string;
  unitLabel: string;
  description: string;
  cantidad: number;
  precioUnit: number;
  taxPresetId: string;
}

const emptyLine = (): InvoiceLine => ({
  uid: Math.random(),
  productId: '',
  sku: '',
  claveSat: '',
  unitCode: '',
  unitLabel: '',
  description: '',
  cantidad: 0,
  precioUnit: 0,
  taxPresetId: 'iva16',
});

/* ─────────────── página ─────────────── */

export function NewInvoicePage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  // Cuando la ruta es /invoices/:id/edit venimos a editar una DRAFT existente
  // (misma UI, misma validación). El :id ausente = alta nueva.
  const { id: editingInvoiceId } = useParams<{ id: string }>();
  const isEditing = !!editingInvoiceId;

  // Máximo de líneas por factura (regla del sistema).
  const MAX_LINES = 10;

  const [customerId, setCustomerId] = useState('');
  // Empezamos con UNA sola línea. Cada vez que la última está "completa",
  // aparece la siguiente, hasta llegar a MAX_LINES.
  const [lines, setLines] = useState<InvoiceLine[]>(() => [emptyLine()]);
  const [cfdiUse, setCfdiUse] = useState('G03');
  // Defaults recomendados por contabilidad HCGM:
  //   · Forma de pago: 99 (Por definir) — se ajusta al cobrar
  //   · Método:        PPD (Parcialidades o diferido) — obliga complemento de pago
  const [paymentForm, setPaymentForm] = useState('99');
  const [paymentMethod, setPaymentMethod] = useState('PPD');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  // Catálogos / datos
  const { data: company } = useQuery({
    queryKey: ['company', user?.companyId],
    queryFn: () => api.getCompany(user!.companyId!),
    enabled: !!user?.companyId,
  });
  const { data: customers } = useQuery({
    queryKey: ['customers-all'],
    queryFn: () => api.getCustomers(1, 200, { sortBy: 'name', sortOrder: 'ASC' }),
  });
  const customer = (customers?.data?.customers || []).find((c: any) => c.id === customerId);

  const { data: usosCFDI } = useQuery({
    queryKey: ['catalog', 'usoCfdi'],
    queryFn: () => api.getCatalog('usoCfdi'),
    staleTime: Infinity,
  });

  // Precarga en modo edición: trae la factura y llena cliente, líneas y campos
  // fiscales. Solo se dispara una vez cuando ya cargaron productos + catálogos
  // (así los presets y unidades quedan resueltos).
  const { data: editingInvoiceResp } = useQuery({
    queryKey: ['invoice', editingInvoiceId],
    queryFn: () => api.getInvoice(editingInvoiceId!),
    enabled: isEditing,
  });
  const [hydratedEditing, setHydratedEditing] = useState(false);
  useEffect(() => {
    if (!isEditing || hydratedEditing) return;
    const inv = (editingInvoiceResp as any)?.data;
    if (!inv) return;
    if (inv.status !== 'DRAFT' || inv.is_stamped) {
      alert('Esta factura ya fue timbrada, no se puede editar.');
      navigate('/invoices', { replace: true });
      return;
    }
    setCustomerId(inv.customer_id || '');
    setPaymentForm(inv.payment_form || '99');
    setPaymentMethod(inv.payment_method || 'PPD');
    setCfdiUse(inv.cfdi_use || 'G03');
    setNotes(inv.notes || '');
    const items = Array.isArray(inv.items) ? inv.items : [];
    if (items.length > 0) {
      setLines(
        items.map((it: any) => ({
          uid: Math.random(),
          productId: it.product_id,
          sku: it.sku || '',
          claveSat: it.clave_sat || '',
          unitCode: it.unit_code || '',
          unitLabel: it.unit_code || '',
          description: it.description || '',
          cantidad: Number(it.quantity) || 0,
          precioUnit: Number(it.unit_price) || 0,
          taxPresetId: it.tax_preset_id || 'iva16',
        }))
      );
    }
    setHydratedEditing(true);
  }, [isEditing, editingInvoiceResp, hydratedEditing, navigate]);

  // Aplicar uso CFDI por defecto del cliente cuando se selecciona
  useEffect(() => {
    if (customer?.default_cfdi_use) {
      setCfdiUse(customer.default_cfdi_use);
    }
  }, [customer]);

  // Cambio de cliente: solo re-evalúa las líneas que NO tienen producto seleccionado,
  // o las que tengan productos sin preset propio. Si el producto trae taxPresetId
  // persistido, ese gana siempre (decisión explícita del usuario en el catálogo).
  useEffect(() => {
    const fromCust = inferPresetFromCustomer(customer);
    if (!fromCust) return;
    setLines((prev) =>
      prev.map((l) => {
        // Líneas vacías o con preset genérico iva16/iva8 → adoptan el del cliente.
        // Líneas con producto y preset específico → no se tocan.
        if (l.taxPresetId === 'iva16' || l.taxPresetId === 'iva8' || !l.productId) {
          return { ...l, taxPresetId: fromCust };
        }
        return l;
      })
    );
  }, [customer?.id, customer?.fiscal_regime]);

  // Cálculos en tiempo real
  const calc = useMemo(() => {
    let subtotal = 0;
    let ivaTrasladado = 0;
    let ivaRetenido = 0;
    let isrRetenido = 0;
    for (const l of lines) {
      const linea = l.cantidad * l.precioUnit;
      if (linea <= 0) continue;
      subtotal += linea;
      const p = TAX_PRESETS.find((x) => x.id === l.taxPresetId)!;
      ivaTrasladado += linea * (p.rateIva || 0);
      ivaRetenido   += linea * (p.retIva || 0);
      isrRetenido   += linea * (p.retIsr || 0);
    }
    const total = subtotal + ivaTrasladado - ivaRetenido - isrRetenido;
    return { subtotal, ivaTrasladado, ivaRetenido, isrRetenido, total };
  }, [lines]);

  // Una línea se considera "completa" cuando tiene cantidad > 0
  // y al menos descripción o producto seleccionado.
  const isComplete = (l: InvoiceLine) =>
    l.cantidad > 0 && l.precioUnit > 0 && (!!l.description || !!l.productId);

  const updateLine = (uid: number, patch: Partial<InvoiceLine>) => {
    setLines((prev) => {
      const next = prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l));
      // Si la ÚLTIMA línea de la lista ya está completa y caben más, abrimos otra.
      const last = next[next.length - 1];
      if (last && isComplete(last) && next.length < MAX_LINES) {
        return [...next, emptyLine()];
      }
      return next;
    });
  };

  const removeLine = (uid: number) =>
    setLines((prev) => {
      if (prev.length <= 1) return prev;
      const filtered = prev.filter((l) => l.uid !== uid);
      // Si después de borrar la última línea es completa y no hay vacía al final,
      // dejamos una vacía para seguir capturando.
      const last = filtered[filtered.length - 1];
      if (last && isComplete(last) && filtered.length < MAX_LINES) {
        return [...filtered, emptyLine()];
      }
      return filtered;
    });

  // Estado para el aviso "ya no hay más líneas — cierra esta factura"
  const reachedMax = lines.length >= MAX_LINES && lines.every(isComplete);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        customerId,
        cfdiType: 'I' as const,
        paymentForm,
        paymentMethod,
        cfdiUse,
        notes,
        items: lines
          .filter((l) => l.productId && l.cantidad > 0)
          .map((l) => ({
            productId: l.productId,
            quantity: l.cantidad,
            unitPrice: l.precioUnit,
            taxPresetId: l.taxPresetId,
            // Descripción custom para esta línea — el usuario puede haber cambiado
            // el texto respecto al catálogo (ej. clave SAT 01010101 genérica pero
            // descripción específica por factura). El backend la usa en el XML.
            description: (l.description || '').trim() || undefined,
          })),
      };
      return isEditing
        ? api.updateInvoice(editingInvoiceId!, payload)
        : api.createInvoice(payload);
    },
    onSuccess: (res: any) => {
      alert(
        isEditing
          ? `Factura actualizada: ${res.data?.serie || 'FAC'}-${res.data?.folio}`
          : `Factura creada: ${res.data?.serie || 'FAC'}-${res.data?.folio}`
      );
      navigate('/invoices');
    },
    onError: (e: any) => setError(e.response?.data?.message || e.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!customerId) { setError('Selecciona un cliente'); return; }
    const hasLines = lines.some((l) => l.productId && l.cantidad > 0);
    if (!hasLines) { setError('Captura al menos una línea con producto y cantidad'); return; }
    saveMutation.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-5 pb-12">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate('/invoices')}
          className="p-2 rounded-lg hover:bg-gray-200">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {isEditing ? 'Editar Factura' : 'Nueva Factura'}
          </h1>
          <p className="text-sm text-gray-600">
            {isEditing ? 'Comprobante en DRAFT — se puede modificar antes de timbrar' : 'Comprobante de Ingreso'}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Emisor + Receptor */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Emisor */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500 mb-2">
            <Building2 size={14} /> Emisor
          </div>
          {company?.data ? (
            <div className="space-y-0.5">
              <p className="font-semibold text-gray-900 uppercase">{company.data.business_name}</p>
              <p className="text-sm text-gray-600">RFC: <span className="font-mono">{company.data.rfc}</span></p>
              <p className="text-sm text-gray-600">Régimen: <span className="font-mono">{company.data.fiscal_regime}</span></p>
              <p className="text-sm text-gray-600">CP: <span className="font-mono">{company.data.postal_code || '—'}</span></p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Cargando…</p>
          )}
        </div>

        {/* Receptor */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500 mb-2">
            <User size={14} /> Receptor
          </div>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="input mb-2"
            required
          >
            <option value="">— seleccionar cliente —</option>
            {(customers?.data?.customers || []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.business_name} ({c.rfc})</option>
            ))}
          </select>
          {customer && (
            <div className="space-y-0.5">
              <p className="font-semibold text-gray-900 uppercase">{customer.business_name}</p>
              <p className="text-sm text-gray-600">RFC: <span className="font-mono">{customer.rfc}</span></p>
              <p className="text-sm text-gray-600">Régimen: <span className="font-mono">{customer.fiscal_regime || '—'}</span></p>
              <p className="text-sm text-gray-600">CP: <span className="font-mono">{customer.postal_code || '—'}</span></p>
            </div>
          )}
        </div>
      </div>

      {/* Configuración CFDI */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-5 grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-gray-500">Uso CFDI</span>
          <select value={cfdiUse} onChange={(e) => setCfdiUse(e.target.value)} className="input mt-1">
            {(usosCFDI?.data?.entries || []).map((u: any) => (
              <option key={u.catalog_key} value={u.catalog_key}>{u.catalog_key} — {u.description}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-gray-500">Forma de Pago</span>
          <select value={paymentForm} onChange={(e) => setPaymentForm(e.target.value)} className="input mt-1">
            <option value="01">01 — Efectivo</option>
            <option value="02">02 — Cheque nominativo</option>
            <option value="03">03 — Transferencia</option>
            <option value="04">04 — Tarjeta de crédito</option>
            <option value="28">28 — Tarjeta de débito</option>
            <option value="99">99 — Por definir</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-gray-500">Método</span>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="input mt-1">
            <option value="PUE">PUE — Una sola exhibición</option>
            <option value="PPD">PPD — Parcialidades o diferido</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-gray-500">Notas</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input mt-1" placeholder="(opcional)" />
        </label>
      </div>

      {/* Líneas */}
      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Conceptos</h3>
          <span className="text-xs text-gray-500">
            Línea {lines.length} de {MAX_LINES} — la siguiente aparece al completar la actual
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="w-10 px-2 py-2 text-center text-xs text-gray-500">#</th>
                <th className="px-2 py-2 text-right text-xs text-gray-500">Cantidad</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500" style={{ minWidth: 320 }}>Producto / Descripción</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500">Clave SAT</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500">Unidad</th>
                <th className="px-2 py-2 text-right text-xs text-gray-500">Precio Unit.</th>
                <th className="px-2 py-2 text-left text-xs text-gray-500" style={{ minWidth: 160 }}>Impuesto</th>
                <th className="px-2 py-2 text-right text-xs text-gray-500">Subtotal</th>
                <th className="w-10 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {lines.map((l, idx) => (
                <LineRow
                  key={l.uid}
                  index={idx + 1}
                  line={l}
                  customer={customer}
                  onChange={(patch) => updateLine(l.uid, patch)}
                  onRemove={() => removeLine(l.uid)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {reachedMax && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-start gap-3">
          <div className="text-amber-600 text-2xl leading-none">⚠️</div>
          <div className="flex-1">
            <p className="font-semibold text-amber-900">Llegaste al máximo de {MAX_LINES} líneas</p>
            <p className="text-sm text-amber-800">
              Esta factura ya tiene todos los renglones permitidos. Por favor cierra esta factura
              dándole <span className="font-semibold">"Crear factura"</span> y, si necesitas más
              productos para este cliente, crea otra factura adicional.
            </p>
          </div>
        </div>
      )}

      {/* Totales — abajo a la izquierda */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
          <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-3">Totales</h3>
          <Row label="Subtotal" value={calc.subtotal} />
          <Row label="IVA trasladado" value={calc.ivaTrasladado} sign="+" />
          {calc.ivaRetenido > 0 && (
            <Row label="IVA retenido" value={calc.ivaRetenido} sign="−" color="text-red-600" />
          )}
          {calc.isrRetenido > 0 && (
            <Row label="ISR retenido" value={calc.isrRetenido} sign="−" color="text-red-600" />
          )}
          <div className="border-t border-gray-200 mt-2 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-gray-900">TOTAL</span>
              <span className="text-2xl font-bold text-gray-900">$ {fmtMoney(calc.total)}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">MXN</p>
          </div>
        </div>

        {/* Acciones a la derecha */}
        <div className="bg-white rounded-lg shadow border border-gray-200 p-5 flex flex-col justify-end gap-3">
          <button type="button" onClick={() => navigate('/invoices')}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancelar
          </button>
          <button type="submit" disabled={saveMutation.isPending}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg shadow">
            <Save size={18} />
            {saveMutation.isPending
              ? 'Guardando…'
              : isEditing ? 'Guardar cambios' : 'Crear factura (borrador)'}
          </button>
          <p className="text-xs text-gray-500">
            Se guardará en estado <b>DRAFT</b>. Después puedes timbrarla (modo simulación con PAC MOCK).
          </p>
        </div>
      </div>
    </form>
  );
}

/* ─────────────── fila de línea ─────────────── */

function LineRow({
  index,
  line,
  customer,
  onChange,
  onRemove,
}: {
  index: number;
  line: InvoiceLine;
  customer?: any;
  onChange: (p: Partial<InvoiceLine>) => void;
  onRemove: () => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const subtotal = (line.cantidad || 0) * (line.precioUnit || 0);
  const customerForLines = customer;

  /* ── Inputs numéricos con buffer de texto local ──
   * Si bindeáramos el value al fmtQty del número, cada keystroke re-formatea
   * (1 → "1.000") y el usuario no puede seguir escribiendo dígitos enteros.
   * Buffer = lo que el usuario teclea; sincronizamos al state numérico al blur.
   */
  const [cantBuf, setCantBuf] = useState<string>(() =>
    line.cantidad === 0 ? '' : String(line.cantidad)
  );
  const [precioBuf, setPrecioBuf] = useState<string>(() =>
    line.precioUnit === 0 ? '' : String(line.precioUnit)
  );
  // Si la línea fue cargada desde el picker de productos (cambia desde fuera), sincroniza
  useEffect(() => { setCantBuf(line.cantidad === 0 ? '' : String(line.cantidad)); }, [line.productId]);
  useEffect(() => { setPrecioBuf(line.precioUnit === 0 ? '' : String(line.precioUnit)); }, [line.productId]);

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-2 py-2 text-center text-gray-400 text-xs">{index}</td>

      <td className="px-2 py-2 align-top pt-3">
        <input
          type="text"
          value={cantBuf}
          // Permitimos: dígitos, una coma o punto (decimales). Al escribir NO formateamos.
          onChange={(e) => {
            // sanitiza pero conserva lo tipeado (sin reescribir con miles)
            const raw = e.target.value.replace(/[^\d.,-]/g, '').replace(',', '.');
            setCantBuf(raw);
            const v = parseNum(raw);
            const max = 999999.999;
            onChange({ cantidad: v < 0 ? 0 : (v > max ? max : v) });
          }}
          // Al perder foco, mostramos el número formateado bonito (con miles + 3 dec.)
          onBlur={() => {
            if (line.cantidad > 0) setCantBuf(fmtQty(line.cantidad));
            else setCantBuf('');
          }}
          onFocus={(e) => {
            // En foco mostramos crudo para editar cómodamente sin separadores
            if (line.cantidad > 0) setCantBuf(String(line.cantidad));
            e.target.select();
          }}
          placeholder="0.000"
          className="w-32 px-2 py-1 border border-gray-300 rounded text-right"
          inputMode="decimal"
        />
      </td>

      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={line.description}
            onChange={(e) => onChange({ description: e.target.value.toUpperCase() })}
            placeholder="Descripción"
            className="flex-1 px-2 py-1 border border-gray-300 rounded uppercase text-sm"
          />
          <button type="button" onClick={() => setShowPicker(true)}
            className="p-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100" title="Buscar producto">
            <Search size={14} />
          </button>
        </div>
        {showPicker && (
          <ProductPickerModal
            onSelect={(p) => {
              onChange({
                productId: p.id,
                sku: p.sku,
                claveSat: p.clave_sat,
                unitCode: p.unit_code,
                unitLabel: p.unit_name,
                description: (p.name || '').toUpperCase(),
                precioUnit: Math.max(0, Number(p.base_price) || line.precioUnit),
                cantidad: line.cantidad || 1,
                taxPresetId: pickLinePreset(p, customerForLines),
              });
              setShowPicker(false);
            }}
            onClose={() => setShowPicker(false)}
          />
        )}
      </td>

      <td className="px-2 py-2">
        <input
          type="text"
          value={line.claveSat}
          onChange={(e) => onChange({ claveSat: e.target.value })}
          placeholder="00000000"
          className="w-24 px-2 py-1 border border-gray-300 rounded font-mono text-xs"
        />
      </td>

      <td className="px-2 py-2">
        <input
          type="text"
          value={line.unitCode}
          onChange={(e) => onChange({ unitCode: e.target.value.toUpperCase() })}
          placeholder="H87"
          className="w-16 px-2 py-1 border border-gray-300 rounded font-mono text-xs uppercase"
          title={line.unitLabel}
        />
      </td>

      <td className="px-2 py-2">
        <input
          type="text"
          value={precioBuf}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d.,-]/g, '').replace(',', '.');
            setPrecioBuf(raw);
            const v = parseNum(raw);
            onChange({ precioUnit: v < 0 ? 0 : v });
          }}
          onBlur={() => setPrecioBuf(line.precioUnit > 0 ? fmtMoney(line.precioUnit) : '')}
          onFocus={(e) => {
            if (line.precioUnit > 0) setPrecioBuf(String(line.precioUnit));
            e.target.select();
          }}
          placeholder="0.00"
          className="w-28 px-2 py-1 border border-gray-300 rounded text-right"
          inputMode="decimal"
        />
      </td>

      <td className="px-2 py-2">
        <select
          value={line.taxPresetId}
          onChange={(e) => onChange({ taxPresetId: e.target.value })}
          className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
          title={TAX_PRESETS.find((p) => p.id === line.taxPresetId)?.long}
        >
          {TAX_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.short}</option>
          ))}
        </select>
      </td>

      <td className="px-2 py-2 text-right font-semibold text-gray-900">
        $ {fmtMoney(subtotal)}
      </td>

      <td className="px-2 py-2 text-right">
        <button type="button" onClick={onRemove}
          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Eliminar línea">
          <Trash2 size={14} />
        </button>
      </td>

    </tr>
  );
}

/* ─────────────── picker de producto en modal centrado ───────────────
 * Antes era un popover absolute:top-full que ocultaba las filas siguientes
 * de la tabla — al buscar con >2 renglones, el usuario no las veía.
 * Ahora es un modal centrado con overlay que deja intacta la tabla.
 */

function ProductPickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (p: any) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['products-all'],
    queryFn: () => api.getProducts(1, 200),
    staleTime: 1000 * 30,
  });
  const all = (data?.data?.products || []) as any[];
  const filtered = q
    ? all.filter((p) =>
        `${p.sku} ${p.name} ${p.clave_sat}`.toLowerCase().includes(q.toLowerCase())
      )
    : all;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-6 pt-24"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-blue-600" />
            <span className="text-sm font-semibold text-gray-900">Buscar producto en catálogo</span>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-900">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Busca por SKU, nombre o clave SAT…"
            className="input mb-3"
          />
          <div className="max-h-[420px] overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
            {isLoading && <p className="text-sm text-gray-500 p-4">Cargando catálogo…</p>}
            {!isLoading && filtered.length === 0 && (
              <p className="text-sm text-gray-500 p-4">Sin coincidencias.</p>
            )}
            {filtered.slice(0, 50).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p)}
                className="w-full text-left px-4 py-3 hover:bg-blue-50 flex items-center justify-between gap-3 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[11px] text-gray-500 mb-0.5">
                    {p.sku} · SAT {p.clave_sat} · {p.unit_code}
                  </p>
                  <p className="text-sm font-medium text-gray-900 uppercase truncate">{p.name}</p>
                </div>
                <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                  $ {fmtMoney(Number(p.base_price) || 0)}
                </span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">Presiona <kbd className="px-1.5 py-0.5 border border-gray-300 rounded text-[10px]">Esc</kbd> para cerrar</p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── helpers UI ─────────────── */

function Row({
  label,
  value,
  sign = '',
  color = 'text-gray-900',
}: { label: string; value: number; sign?: string; color?: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={`text-sm font-semibold ${color}`}>{sign}$ {fmtMoney(value)}</span>
    </div>
  );
}
