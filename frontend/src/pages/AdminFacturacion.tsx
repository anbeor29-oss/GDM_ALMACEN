/**
 * Super-Admin → Facturación (cobro POR USUARIO, modelo único — sin paquetes).
 *
 * Una sola pantalla que une la antigua «Facturación mensual» y «Facturación y
 * consumo». Orden: (1) ambientes de PRUEBA (sin cobro), (2) usuarios REALES
 * (cobro $precio × usuarios + excedente de timbres), (3) consumo de timbres.
 * Prepago: generar la lista del día 30, marcar pagado / suspender por falta de pago.
 */
import { confirmar } from '@/utils/avisos';
import { useState, useMemo, useEffect, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, RefreshCw, Check, Ban, RotateCcw, Settings, Loader2, AlertTriangle, FlaskConical, Users, Stamp, ChevronRight, ChevronDown, FileText, X, Receipt } from 'lucide-react';
import api from '@/services/api';
import { useAuthStore } from '@/store/auth';
import { aTextoMx } from '@/components/CampoFecha';

const money = (n: any) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const mesActual = () => new Date().toISOString().slice(0, 7);

export function AdminFacturacionPage() {
  const { user } = useAuthStore();
  const [periodo, setPeriodo] = useState(mesActual());
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [cfgOpen, setCfgOpen] = useState(false);

  const q = useQuery({ queryKey: ['facturacion-consolidado', periodo], queryFn: () => api.getFacturacionConsolidado(periodo) });
  const cfgQ = useQuery({ queryKey: ['facturacion-config'], queryFn: () => api.getFacturacionConfig() });
  const emisorasQ = useQuery({ queryKey: ['admin-emisores'], queryFn: () => api.adminListEmisores() });
  const emisoras: any[] = ((emisorasQ.data as any)?.data?.emisores || []).filter((e: any) => e.es_emisor);
  const [emitir, setEmitir] = useState<any>(null);   // cargo a facturar (abre el modal de emisora)
  // Generar factura de SERVICIOS (renta de software + servicios contables) en la
  // pantalla flotante: `facturar` es la fila elegida. El `check` por fila habilita el
  // botón: NO es automático, se factura «cuando ya se cobró». El igualado contable es un
  // valor editable por empresa; se guarda en caliente y se refleja aquí sin recargar.
  const [facturar, setFacturar] = useState<any>(null);
  const [cobrar, setCobrar] = useState<any>(null);     // fila cuyo COBRO se registra
  /* EL CHECK DE CONTROL VIVE EN EL CARGO DEL PERIODO, NO EN EL NAVEGADOR.
   * Así se conserva al recargar y queda LIMPIO solo al cambiar de mes, porque
   * el mes nuevo es otro renglón. Esto de aquí es sólo el reflejo optimista:
   * la verdad llega con los datos. */
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [costoLocal, setCostoLocal] = useState<Record<string, number>>({});
  const [rentaLocal, setRentaLocal] = useState<Record<string, number>>({});
  const toggleCheck = async (id: string) => {
    const quiero = !checked.has(id);
    setChecked((s) => { const n = new Set(s); quiero ? n.add(id) : n.delete(id); return n; });
    try { await api.setListoParaFacturar(id, periodo, quiero); }
    catch (e: any) {
      // Se revierte: dejar el check prendido sin que el servidor lo sepa haría
      // creer que el cobro quedó asentado cuando no quedó.
      setChecked((s) => { const n = new Set(s); quiero ? n.delete(id) : n.add(id); return n; });
      setMsg(e?.response?.data?.message || 'No se pudo guardar la marca.');
    }
  };
  const costoDe = (f: any) => (costoLocal[f.company_id] ?? Number(f.costo_contable || 0));
  // Renta de software editable (override). Si no se ha tocado, se muestra la renta por
  // usuario calculada; al editarla se guarda como override y manda en la factura.
  const rentaOverrideDe = (f: any) => (rentaLocal[f.company_id] ?? Number(f.renta_servicio || 0));
  const rentaMostradaDe = (f: any) => { const o = rentaOverrideDe(f); return o > 0 ? o : Number(f.renta_mxn || 0); };
  const guardarCosto = async (companyId: string, monto: number) => {
    await api.setCostoContable(companyId, monto);
    setCostoLocal((m) => ({ ...m, [companyId]: monto }));
  };
  const guardarRenta = async (companyId: string, monto: number) => {
    await api.setRentaServicio(companyId, monto);
    setRentaLocal((m) => ({ ...m, [companyId]: monto }));
  };
  const data = q.data?.data;
  const prueba: any[] = data?.prueba || [];
  const reales: any[] = data?.reales || [];
  /* La marca la manda el servidor. Al cambiar de periodo se vuelve a sembrar y,
   * como el mes nuevo no tiene marcas, la lista aparece limpia sola. */
  useEffect(() => {
    const s = new Set<string>();
    for (const f of [...reales, ...prueba]) if (f.listo_para_facturar) s.add(f.company_id);
    setChecked(s);
  }, [data]);
  const cfg = cfgQ.data?.data;
  // Dos paneles por producto contratado: NEXO (ERP) e IVA (servicio IVA.HTML, su CFDI
  // lo emite NEXO). 'AMBOS' aparece en los dos. Las listas y los totales se filtran.
  // Tercer panel: E-COMMERCE (empresas de la tienda en línea, producto ECOMMERCE).
  const [panel, setPanel] = useState<'NEXO' | 'IVA' | 'ECOMMERCE'>(() => {
    const p = (new URLSearchParams(window.location.search).get('panel') || '').toUpperCase();
    return p === 'IVA' || p === 'ECOMMERCE' ? p : 'NEXO';
  });
  const enPanel = (f: any) => {
    const p = String(f?.producto || 'NEXO').toUpperCase();
    if (panel === 'ECOMMERCE') return p === 'ECOMMERCE';
    return panel === 'NEXO' ? (p === 'NEXO' || p === 'AMBOS') : (p === 'IVA' || p === 'AMBOS');
  };
  const pruebaF = prueba.filter(enPanel);
  const realesF = reales.filter(enPanel);

  /* Árbol por despacho (encabezados colapsables): las empresas se agrupan por su
   * emisora de cobro (empresa_cobro_id) y, si no la tienen, por la emisora
   * PREDETERMINADA (GRUPO HCGM). El encabezado es el nombre del despacho. Por
   * omisión TODO abierto; se colapsa por grupo. */
  const emisoraPred: any = data?.emisoraPredeterminada || null;
  const [colapsado, setColapsado] = useState<Set<string>>(new Set());
  const alternarGrupo = (id: string) => setColapsado((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const gruposReales = useMemo(() => {
    const nombrePorId = new Map<string, string>(realesF.map((f) => [f.company_id, f.business_name]));
    if (emisoraPred?.id) nombrePorId.set(emisoraPred.id, emisoraPred.business_name);
    const m = new Map<string, { nombre: string; rows: any[] }>();
    for (const f of realesF) {
      // El despacho contable manda; si la empresa aún no tiene despacho, se cae al
      // agrupamiento viejo por emisora de cobro / predeterminada (compatibilidad).
      let key: string | null = f.despacho_id || null;
      let nombre = f.despacho_nombre || '';
      if (!key) {
        key = f.empresa_cobro_id;
        if (!key && !f.emisor_predeterminado && emisoraPred?.id && emisoraPred.id !== f.company_id) key = emisoraPred.id;
        nombre = key ? (nombrePorId.get(key) || 'Despacho') : '';
      }
      const k = key || '__none__';
      if (!nombre) nombre = k === '__none__' ? 'Sin despacho' : 'Despacho';
      if (!m.has(k)) m.set(k, { nombre, rows: [] });
      m.get(k)!.rows.push(f);
    }
    return [...m.entries()].sort((a, b) => a[0] === '__none__' ? 1 : b[0] === '__none__' ? -1 : a[1].nombre.localeCompare(b[1].nombre));
  }, [realesF, data]);
  const acum: any = data?.totales || null;
  const totPanel = {
    empresasReales: realesF.length,
    usuariosReales: realesF.reduce((a, f) => a + Number(f.usuarios || 0), 0),
    renta: realesF.reduce((a, f) => a + Number(f.renta_mxn || 0), 0),
    extra: realesF.reduce((a, f) => a + Number(f.extra_mxn || 0), 0),
    total: realesF.reduce((a, f) => a + Number(f.total_mxn || 0), 0),
  };

  if (user?.role !== 'SUPER_ADMIN') {
    return <div className="bg-amber-50 border border-amber-200 text-amber-900 p-6 rounded-lg">
      <p className="font-semibold">Acceso restringido</p><p className="text-sm">Requiere rol SUPER_ADMIN.</p></div>;
  }

  const generar = async () => {
    setBusy('generar'); setMsg('');
    try { await api.generarFacturacion(periodo); await q.refetch(); setMsg('Lista generada.'); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo generar.'); }
    finally { setBusy(''); }
  };
  const accion = async (fn: () => Promise<any>, id: string, ok: string) => {
    setBusy(id); setMsg('');
    try { await fn(); await q.refetch(); setMsg(ok); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo aplicar.'); }
    finally { setBusy(''); }
  };

  const badge = (s: string) =>
    s === 'PAGADO' ? 'bg-emerald-100 text-emerald-700'
      : s === 'SUSPENDIDO' ? 'bg-rose-100 text-rose-700'
      : s === 'SIN_GENERAR' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <DollarSign size={28} className="text-emerald-600" /> Facturación
          </h1>
          <p className="text-gray-600 mt-1">
            Cobro <b>por usuario</b> (sin paquetes). Genera la lista del periodo (día 30):
            $precio × usuarios facturables (sin checador) + excedente de timbres. Prepago.
          </p>
        </div>
        <button onClick={() => setCfgOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 border px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          <Settings size={15} /> Precios
        </button>
      </div>

      {cfgOpen && cfg && <PanelConfig cfg={cfg} onGuardado={() => cfgQ.refetch()} />}

      {/* Dos paneles por producto contratado */}
      <div className="flex gap-2">
        <button onClick={() => setPanel('NEXO')}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${panel === 'NEXO' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>NEXO (ERP)</button>
        <button onClick={() => setPanel('IVA')}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${panel === 'IVA' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>IVA (servicio)</button>
        <button onClick={() => setPanel('ECOMMERCE')}
          className={`px-4 py-2 rounded-lg text-sm font-medium border ${panel === 'ECOMMERCE' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>E-COMMERCE</button>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-white border rounded-lg p-3">
        <label className="text-sm text-gray-600">Periodo:
          <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="input ml-2 py-1.5 text-sm w-40" />
        </label>
        <button onClick={generar} disabled={busy === 'generar'}
          className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm">
          {busy === 'generar' ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} Generar lista del día 30
        </button>
        {cfg && <span className="text-xs text-gray-400">${cfg.precioUsuario}/usuario · {cfg.timbresIncluidos}+{cfg.timbresPorUsuario}/usr timbres · extra ${cfg.timbreExtra}+${cfg.timbreExtraPorUsuario}/usr</span>}
        {msg && <span className="text-sm text-gray-700">{msg}</span>}
      </div>

      {/* Totales del panel activo (solo reales) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Tarjeta label={`Empresas ${panel}`} valor={totPanel.empresasReales} />
        <Tarjeta label="Usuarios" valor={totPanel.usuariosReales} />
        <Tarjeta label="Renta" valor={money(totPanel.renta)} />
        <Tarjeta label="Timbres extra" valor={money(totPanel.extra)} />
        <Tarjeta label="Total a cobrar" valor={money(totPanel.total)} destacado />
      </div>

      {/* ACUMULADO DEL MES. Lo de arriba es la estimación —renta por usuario—; esto
          son hechos: cuánto se facturó de verdad (con IVA, con los conceptos que se
          editaron), cuánto entró y qué falta por cobrar. Es lo que hay que mirar
          para saber cómo va el mes. */}
      {acum && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tarjeta label={`Facturado (${acum.facturas} CFDI)`} valor={money(acum.facturado)} />
          <Tarjeta label="Cobrado" valor={money(acum.cobrado)} />
          <Tarjeta label="Por cobrar" valor={money(acum.porCobrar)} destacado />
          <Tarjeta label="Marcados sin facturar" valor={acum.marcados} />
        </div>
      )}
      {acum && acum.sinComplemento > 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            <b>{acum.sinComplemento}</b> cobro(s) de este mes todavía <b>sin complemento de pago</b>.
            Toda factura PPD lo necesita: sin él la operación sigue abierta ante el SAT aunque aquí diga «pagado».
          </span>
        </p>
      )}

      {q.isLoading && <p className="text-gray-500">Cargando…</p>}

      {/* 1) Ambientes de PRUEBA — sin cobro */}
      <Seccion icon={<FlaskConical size={16} className="text-sky-600" />} titulo="Solicitudes en prueba (72 h)"
        nota="Altas nuevas de IVA/NEXO en su prueba de 72 h sin firmar — aquí se concentran las solicitudes de servicio. Las exentas y propias ya NO salen aquí: aparecen en «Usuarios reales» marcadas «sin cobro».">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Empresa</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Motivo</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Usuarios</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Timbres</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Cobro</th>
          </tr></thead>
          <tbody className="divide-y">
            {pruebaF.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400 italic">Sin solicitudes en prueba por ahora. Aquí aparecen las altas nuevas (IVA/NEXO) en su prueba de 72 h.</td></tr>}
            {pruebaF.map((f) => (
              <tr key={f.company_id} className="hover:bg-gray-50">
                <td className="px-3 py-2"><p className="font-medium text-gray-800">{f.business_name}</p><p className="text-[11px] text-gray-500 font-mono">{f.rfc}</p></td>
                <td className="px-3 py-2"><span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">{f.motivo}</span></td>
                <td className="px-3 py-2 text-center">{f.usuarios}</td>
                <td className="px-3 py-2 text-center text-xs">{f.timbres_usados}<span className="text-gray-400">/{f.timbres_incluidos}</span></td>
                <td className="px-3 py-2 text-right">
                  {/* Clientes del servicio IVA: se facturan desde aquí (monto + emisora). */}
                  {panel === 'IVA' && (f.producto === 'IVA' || f.producto === 'AMBOS')
                    ? (f.facturado
                        ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Facturado {money(f.cargo_total)}</span>
                        : <button onClick={() => setEmitir([{ ...f, iva: true }])}
                            className="px-2.5 py-1 text-xs rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-700 inline-flex items-center gap-1">
                            <FileText size={13} /> Facturar (elegir emisora)</button>)
                    : <span className="text-gray-400 italic">sin cobro</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Seccion>

      {/* 2) Usuarios REALES — cobro por usuario */}
      <Seccion icon={<Users size={16} className="text-emerald-600" />} titulo="Usuarios reales (cobro por usuario)"
        nota="Clientes de pago. Genera la lista para crear el cargo; luego marca pagado o suspende por falta de pago.">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Empresa</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Usuarios</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Renta</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600" title="Igualado mensual de servicios contables (editable). Se factura como 2.º concepto del CFDI.">Costo contable</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Timbres</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Extra</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Total</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Estado</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600" title="El consecutivo del CFDI emitido, lo que entró y su complemento de pago.">CFDI y cobro</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600" title="Marca el check cuando ya cobraste; eso habilita generar la factura. Se guarda y se limpia solo al cambiar de mes.">Factura</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
          </tr></thead>
          <tbody className="divide-y">
            {realesF.length === 0 && <tr><td colSpan={11} className="px-3 py-4 text-center text-gray-400 italic">Sin clientes de pago todavía.</td></tr>}
            {gruposReales.map(([key, g]) => (
              <Fragment key={key}>
                <tr className="bg-indigo-50/70 border-y border-indigo-100">
                  <td colSpan={11} className="px-3 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <button onClick={() => alternarGrupo(key)} className="flex items-center gap-1.5 text-sm font-semibold text-indigo-800 hover:text-indigo-900">
                        {colapsado.has(key) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        {g.nombre}
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">{g.rows.length} empresa(s)</span>
                      </button>
                      {(() => {
                        const emitibles = g.rows.filter((r: any) => r.cargo_id && r.status !== 'PAGADO' && !r.exenta && r.usuarios > 0);
                        return emitibles.length > 0 ? (
                          <button onClick={() => setEmitir(emitibles)}
                            title="Emitir las facturas del despacho (elige la emisora)"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 border border-violet-200 bg-violet-50 hover:bg-violet-100 rounded px-2 py-1">
                            <FileText size={13} /> Emitir facturas del grupo ({emitibles.length})
                          </button>
                        ) : null;
                      })()}
                    </div>
                  </td>
                </tr>
                {!colapsado.has(key) && g.rows.map((f: any) => (
              <tr key={f.company_id} className={`hover:bg-gray-50 ${f.status === 'SUSPENDIDO' ? 'bg-rose-50/40' : f.exenta ? 'bg-slate-50/40' : ''}`}>
                <td className="px-3 py-2 pl-8">
                  <p className="font-medium text-gray-800">{f.business_name}
                    {f.exenta && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">{f.motivo || 'exenta'}</span>}
                  </p>
                  <p className="text-[11px] text-gray-500 font-mono">{f.rfc}</p>
                  {f.iva_vigencia_fin && (
                    <p className="text-[11px] text-emerald-700">Alta IVA {aTextoMx(f.iva_pagado_desde)} · Próximo cobro <b>{aTextoMx(f.iva_vigencia_fin)}</b></p>
                  )}
                </td>
                <td className="px-3 py-2 text-center">{f.usuarios}</td>
                <td className="px-3 py-2 text-right">
                  {/* Renta de software EDITABLE (override), en TODOS los paneles (NEXO/IVA/
                      e-commerce). Para clientes sin cobro por usuario se captura a mano; para
                      los de usuarios muestra el cálculo y permite ajustarlo. No cambia el Total. */}
                  <CeldaCosto valor={rentaMostradaDe(f)} onSave={(m) => guardarRenta(f.company_id, m)} />
                </td>
                <td className="px-3 py-2 text-right">
                  {/* Igualado contable editable por empresa (todos los paneles). No entra al
                      Total por usuario; es el 2.º concepto del CFDI de servicios. */}
                  <CeldaCosto valor={costoDe(f)} onSave={(m) => guardarCosto(f.company_id, m)} />
                </td>
                <td className="px-3 py-2 text-center text-xs">{f.timbres_usados}<span className="text-gray-400">/{f.timbres_incluidos}</span>{f.timbres_extra > 0 && <span className="block text-[10px] text-rose-600">+{f.timbres_extra} extra</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">{money(f.extra_mxn)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{money(f.total_mxn)}</td>
                <td className="px-3 py-2 text-center">{panel === 'IVA' && f.iva_vigencia_fin
                  ? <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">anualidad al {aTextoMx(f.iva_vigencia_fin)}</span>
                  : f.exenta
                  ? <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">sin cobro</span>
                  : f.usuarios === 0
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500">sin usuarios</span>
                    : <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badge(f.status)}`}>{f.status === 'SIN_GENERAR' ? 'sin generar' : f.status}</span>}</td>
                {/* CFDI Y COBRO: el consecutivo de lo emitido, lo que entró y el
                    complemento. «Facturado» a secas obliga a ir a otra pantalla a
                    averiguar CUÁL factura fue y si ya se cobró. */}
                <td className="px-3 py-2 text-xs">
                  {f.factura_folio ? (
                    <>
                      <span className="font-semibold text-gray-800 tabular-nums" title={f.factura_uuid || ''}>{f.factura_folio}</span>
                      {f.factura_total != null && <span className="text-gray-500"> · {money(f.factura_total)}</span>}
                      {Number(f.cobrado_mxn) > 0
                        ? <span className="block text-emerald-700">Cobrado {money(f.cobrado_mxn)}{f.pago_fecha ? ` · ${aTextoMx(f.pago_fecha)}` : ''}</span>
                        : <span className="block text-amber-700">Sin cobrar</span>}
                      {f.rep_folio
                        ? <span className="block text-violet-700" title={f.rep_uuid || ''}>Complemento {f.rep_folio}</span>
                        : (Number(f.cobrado_mxn) > 0 && String(f.factura_metodo || '').toUpperCase() !== 'PUE'
                            ? <span className="block text-rose-600">Falta complemento de pago</span> : null)}
                    </>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                {/* FACTURA: la que emites tú. Si ya se emitió, su marca; si no, el CHECK
                    que —al marcarlo— habilita el botón «Generar factura». No es automático:
                    se marca cuando ya cobraste. (El servicio IVA tiene su propio flujo.) */}
                <td className="px-3 py-2 text-center">
                  {(() => {
                    // Hay algo que facturar si tiene usuarios (renta por uso), una renta de
                    // software capturada, o un igualado contable. Vale en TODOS los paneles
                    // (NEXO/IVA/e-commerce) y sin importar que sea «sin cobro» por usuario.
                    const hayQueFacturar = f.usuarios > 0 || costoDe(f) > 0 || rentaOverrideDe(f) > 0;
                    if (f.facturado) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700" title="CFDI ya emitido a este cliente">Facturado</span>;
                    if (!hayQueFacturar) return <span className="text-gray-300">—</span>;
                    return (
                      <input type="checkbox" checked={checked.has(f.company_id)} onChange={() => toggleCheck(f.company_id)}
                        title="Márcalo cuando ya cobraste: habilita «Generar factura»"
                        className="w-4 h-4 accent-emerald-600 cursor-pointer" />
                    );
                  })()}
                </td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  {/* Sólo se factura a quien TIENE usuarios (cobro por usuario). Las
                      exentas y las de 0 usuarios no llevan cobro. */}
                  {/* Servicio IVA (anualidad): se factura con monto + emisora elegida. */}
                  {panel === 'IVA' && f.iva_vigencia_fin && (f.facturado
                    ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Facturado {money(f.cargo_total)}</span>
                    : <button onClick={() => setEmitir([{ ...f, iva: true }])} className="p-1.5 text-violet-600 hover:bg-violet-50 rounded" title="Facturar anualidad IVA (elige la emisora)"><FileText size={15} /></button>)}
                  {/* Generar la factura de SERVICIOS (renta de software 81112218 + servicios
                      contables 84111500) en la pantalla FLOTANTE: editar y timbrar. En TODOS los
                      paneles (NEXO/IVA/e-commerce). Aparece cuando hay ALGO que facturar (usuarios,
                      renta o igualado contable), AUNQUE la empresa sea «sin cobro». Habilitado sólo
                      con el check marcado (ya se cobró). Es un CFDI de servicio, sin carta porte. */}
                  {!f.facturado && (() => {
                    const hayQueFacturar = f.usuarios > 0 || costoDe(f) > 0 || rentaOverrideDe(f) > 0;
                    if (!hayQueFacturar) return <span className="text-[11px] text-gray-400" title="Captura una renta o un costo contable para facturar">—</span>;
                    return (
                      <button onClick={() => setFacturar(f)} disabled={!checked.has(f.company_id)}
                        className="p-1.5 text-violet-600 hover:bg-violet-50 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                        title={checked.has(f.company_id) ? 'Generar factura (editar y timbrar)' : 'Marca el check «Factura» para habilitar'}>
                        <Receipt size={15} />
                      </button>
                    );
                  })()}
                  {f.cargo_id && f.status !== 'PAGADO' && (
                    <button onClick={() => setCobrar(f)}
                      disabled={busy === f.cargo_id} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded"
                      title="Registrar el cobro (importe, fecha y forma de pago)">
                      {busy === f.cargo_id ? <Loader2 className="animate-spin" size={14} /> : <Check size={15} />}
                    </button>
                  )}
                  {/* El complemento de pago de un cobro que ya quedó asentado: el
                      SAT lo pide para toda factura PPD y aquí no había por dónde. */}
                  {f.cargo_id && f.factura_folio && !f.rep_folio && Number(f.cobrado_mxn) > 0
                    && String(f.factura_metodo || '').toUpperCase() !== 'PUE' && (
                    <button onClick={() => setCobrar({ ...f, soloComplemento: true })}
                      className="p-1.5 text-violet-600 hover:bg-violet-50 rounded" title="Emitir el complemento de pago (CFDI tipo P)">
                      <Receipt size={15} />
                    </button>
                  )}
                  {f.cargo_id && f.status === 'PENDIENTE' && (
                    <button onClick={async () => { if (await confirmar(`¿Suspender el servicio de ${f.business_name} por falta de pago?`)) accion(() => api.suspenderFacturacion(f.cargo_id), f.cargo_id, 'Servicio suspendido.'); }}
                      disabled={busy === f.cargo_id} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded" title="Suspender servicio"><Ban size={15} /></button>
                  )}
                  {f.cargo_id && f.status === 'SUSPENDIDO' && (
                    <button onClick={() => accion(() => api.reactivarFacturacion(f.cargo_id), f.cargo_id, 'Servicio reactivado.')}
                      disabled={busy === f.cargo_id} className="p-1.5 text-sky-600 hover:bg-sky-50 rounded" title="Reactivar"><RotateCcw size={15} /></button>
                  )}
                </td>
              </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Seccion>

      {/* 3) Consumo de timbres — colapsable (arranca cerrado) y ordenado por USADOS. */}
      <Seccion colapsable defaultColapsado icon={<Stamp size={16} className="text-violet-600" />} titulo="Consumo de timbres del periodo"
        nota="Timbres timbrados vía SW (stamp_usage), de mayor a menor consumo. Los incluidos crecen con los usuarios; el excedente se cobra a los reales.">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Empresa</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Usados</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Incluidos</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">Excedente</th>
          </tr></thead>
          <tbody className="divide-y">
            {[...realesF, ...pruebaF].sort((a, b) => (b.timbres_usados || 0) - (a.timbres_usados || 0)).map((f) => (
              <tr key={f.company_id} className="hover:bg-gray-50">
                <td className="px-3 py-2"><span className="text-gray-800">{f.business_name}</span> <span className="text-[11px] text-gray-400 font-mono">{f.rfc}</span></td>
                <td className="px-3 py-2 text-center tabular-nums font-medium">{f.timbres_usados}</td>
                <td className="px-3 py-2 text-center tabular-nums text-gray-500">{f.timbres_incluidos}</td>
                <td className="px-3 py-2 text-center tabular-nums">{f.timbres_extra > 0 ? <span className="text-rose-600 font-medium">+{f.timbres_extra}</span> : <span className="text-gray-300">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Seccion>

      <p className="text-xs text-gray-500 flex items-start gap-1.5">
        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
        Prepago: se cobra por adelantado. Suspender bloquea el login de la empresa; al marcar pagado se reactiva sola.
        Los ambientes de prueba no se cobran hasta que se eliminen.
      </p>

      {emitir && emitir.length > 0 && (
        <ModalEmitir cargos={emitir} emisoras={emisoras}
          onClose={() => setEmitir(null)}
          onDone={(m: string) => { setEmitir(null); setMsg(m); q.refetch(); }} />
      )}

      {/* Registro del COBRO y, si procede, su complemento de pago. */}
      {cobrar && (
        <ModalCobro fila={cobrar}
          onClose={() => setCobrar(null)}
          onDone={(m: string) => { setCobrar(null); setMsg(m); q.refetch(); }} />
      )}

      {/* Pantalla FLOTANTE para generar la factura de servicios (2 conceptos), editar y timbrar. */}
      {facturar && (
        <ModalFacturaServicios fila={facturar} periodo={periodo} emisoras={emisoras}
          costoContable={costoDe(facturar)} rentaServicio={rentaMostradaDe(facturar)}
          onClose={() => setFacturar(null)}
          onDone={(m: string) => { setFacturar(null); setMsg(m); setChecked((s) => { const n = new Set(s); n.delete(facturar.company_id); return n; }); q.refetch(); }} />
      )}
    </div>
  );
}

/** Celda editable del igualado contable: guarda al salir del campo (blur) o con Enter. */
function CeldaCosto({ valor, onSave }: { valor: number; onSave: (m: number) => Promise<void> }) {
  const [v, setV] = useState(String(valor ?? 0));
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  useEffect(() => { setV(String(valor ?? 0)); }, [valor]);
  const guardar = async () => {
    const m = Number(v);
    if (!isFinite(m) || m < 0) { setV(String(valor ?? 0)); return; }
    if (m === Number(valor ?? 0)) return;           // sin cambios: no molestar al backend
    setSaving(true); setOk(false);
    try { await onSave(m); setOk(true); setTimeout(() => setOk(false), 1500); }
    catch { setV(String(valor ?? 0)); }
    finally { setSaving(false); }
  };
  return (
    <div className="inline-flex items-center gap-1 justify-end">
      <span className="text-gray-400 text-xs">$</span>
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={guardar}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        inputMode="decimal"
        className="w-24 border border-slate-300 rounded px-2 py-1 text-sm text-right tabular-nums focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400" />
      {saving ? <Loader2 size={12} className="animate-spin text-gray-400" /> : ok ? <Check size={12} className="text-emerald-500" /> : <span className="w-3" />}
    </div>
  );
}

const MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
/** 'YYYY-MM' → 'Septiembre 2026'. */
function mesLargo(periodo: string): string {
  const [a, m] = String(periodo || '').split('-').map(Number);
  if (!a || !m || m < 1 || m > 12) return periodo || '';
  return `${MESES_ES[m - 1]} ${a}`;
}

/**
 * Pantalla FLOTANTE para generar la factura de SERVICIOS a un cliente: dos conceptos
 * editables —Renta de Software en línea (81112218) y Servicios Contables (84111500)—,
 * emisora, uso/forma/método, y timbrar. Es un CFDI de servicio (sin carta porte); sigue
 * las reglas de la pantalla de facturación (preset de IVA por concepto, texto libre).
 */
function ModalFacturaServicios({ fila, periodo, emisoras, costoContable, rentaServicio, onClose, onDone }:
  { fila: any; periodo: string; emisoras: any[]; costoContable: number; rentaServicio: number; onClose: () => void; onDone: (m: string) => void }) {
  const [emisoraId, setEmisoraId] = useState<string>(emisoras.find((e) => e.predeterminado)?.id || emisoras[0]?.id || '');
  const [usoCfdi, setUsoCfdi] = useState('G03');
  const [formaPago, setFormaPago] = useState('99');
  const [metodoPago, setMetodoPago] = useState('PPD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Conceptos: renta de software (todo el cargo por usuario) + servicios contables (igualado).
  const [conceptos, setConceptos] = useState(() => [
    { clave: '81112218', descripcion: 'Renta de Software en línea', cantidad: 1, precio: Number(rentaServicio || 0), preset: 'iva16', incluir: Number(rentaServicio || 0) > 0 },
    { clave: '84111500', descripcion: `Servicios Contables de ${mesLargo(periodo)}`, cantidad: 1, precio: Number(costoContable || 0), preset: 'iva16', incluir: Number(costoContable || 0) > 0 },
  ]);
  const setC = (i: number, campo: string, val: any) => setConceptos((cs) => cs.map((c, j) => j === i ? { ...c, [campo]: val } : c));
  const activos = conceptos.filter((c) => c.incluir && Number(c.precio) > 0 && c.clave.trim() && c.descripcion.trim());
  const subtotal = activos.reduce((a, c) => a + Number(c.precio) * Number(c.cantidad || 1), 0);
  const ivaAprox = activos.reduce((a, c) => a + (c.preset === 'iva16' ? Number(c.precio) * Number(c.cantidad || 1) * 0.16 : 0), 0);

  const emitir = async () => {
    if (!emisoraId) { setError('Elige la emisora.'); return; }
    if (activos.length === 0) { setError('Incluye al menos un concepto con importe.'); return; }
    setBusy(true); setError('');
    try {
      const r: any = await api.emitirFacturaServicios(fila.company_id, periodo, emisoraId,
        activos.map((c) => ({ clave: c.clave.trim(), descripcion: c.descripcion.trim(), cantidad: Number(c.cantidad) || 1, precio: Number(c.precio), preset: c.preset })),
        { usoCfdi, formaPago, metodoPago });
      onDone(r?.message || `Factura ${r?.data?.folio || ''} emitida.`);
    } catch (e: any) { setError(e?.response?.data?.message || 'No se pudo emitir.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><Receipt size={18} className="text-violet-600" /> Generar factura de servicios</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="text-gray-600">Cliente: <b>{fila.business_name}</b> <span className="font-mono text-gray-400">{fila.rfc}</span><br />
              <span className="text-xs text-gray-500">Periodo {mesLargo(periodo)} · CFDI de servicio (sin carta porte)</span></p>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600 block mb-1">¿Desde cuál emisora?</span>
              <select value={emisoraId} onChange={(e) => setEmisoraId(e.target.value)} className="border border-slate-300 rounded px-3 py-2 text-sm min-w-[14rem]">
                {emisoras.length === 0 && <option value="">No hay emisoras marcadas</option>}
                {emisoras.map((e) => (<option key={e.id} value={e.id}>{e.business_name} · {e.rfc}{e.predeterminado ? ' (predeterminada)' : ''}</option>))}
              </select>
            </label>
          </div>

          {/* Conceptos editables */}
          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[auto_6rem_1fr_7rem_6rem] gap-2 bg-gray-50 border-b px-3 py-2 text-[11px] font-semibold text-gray-500">
              <span>Incluir</span><span>Clave SAT</span><span>Descripción</span><span className="text-right">Importe</span><span>IVA</span>
            </div>
            {conceptos.map((c, i) => (
              <div key={i} className="grid grid-cols-[auto_6rem_1fr_7rem_6rem] gap-2 items-center px-3 py-2 border-b last:border-b-0">
                <input type="checkbox" checked={c.incluir} onChange={(e) => setC(i, 'incluir', e.target.checked)} className="w-4 h-4 accent-violet-600" />
                <input value={c.clave} onChange={(e) => setC(i, 'clave', e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-xs font-mono w-full" />
                <input value={c.descripcion} onChange={(e) => setC(i, 'descripcion', e.target.value)} className="border border-slate-300 rounded px-2 py-1 text-sm w-full" />
                <input value={String(c.precio)} onChange={(e) => setC(i, 'precio', e.target.value)} inputMode="decimal" className="border border-slate-300 rounded px-2 py-1 text-sm text-right tabular-nums w-full" />
                <select value={c.preset} onChange={(e) => setC(i, 'preset', e.target.value)} className="border border-slate-300 rounded px-1 py-1 text-xs">
                  <option value="iva16">16%</option><option value="iva0">0%</option><option value="ivaex">Exento</option>
                </select>
              </div>
            ))}
          </div>

          {/* Uso / forma / método — reglas de la pantalla de facturación */}
          <div className="grid grid-cols-3 gap-3">
            <label className="block"><span className="text-xs font-semibold text-gray-600 block mb-1">Uso CFDI</span>
              <select value={usoCfdi} onChange={(e) => setUsoCfdi(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-2 text-sm">
                <option value="G03">G03 · Gastos en general</option><option value="G01">G01 · Adquisición mercancías</option><option value="P01">P01 · Por definir</option>
              </select></label>
            <label className="block"><span className="text-xs font-semibold text-gray-600 block mb-1">Forma de pago</span>
              <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-2 text-sm">
                <option value="99">99 · Por definir</option><option value="03">03 · Transferencia</option><option value="01">01 · Efectivo</option><option value="04">04 · Tarjeta crédito</option><option value="28">28 · Tarjeta débito</option>
              </select></label>
            <label className="block"><span className="text-xs font-semibold text-gray-600 block mb-1">Método de pago</span>
              <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-2 text-sm">
                <option value="PPD">PPD · Parcialidades/diferido</option><option value="PUE">PUE · Una exhibición</option>
              </select></label>
          </div>

          <div className="flex items-center justify-end gap-6 text-sm">
            <span className="text-gray-500">Subtotal <b className="text-gray-800 tabular-nums">{money(subtotal)}</b></span>
            <span className="text-gray-500">IVA aprox. <b className="text-gray-800 tabular-nums">{money(ivaAprox)}</b></span>
            <span className="text-gray-700">Total aprox. <b className="text-emerald-700 tabular-nums">{money(subtotal + ivaAprox)}</b></span>
          </div>

          {error && <p className="text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</p>}
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">Se timbrará un CFDI real desde la emisora elegida. Verifica RFC, régimen y CP del cliente. El total final lo recalcula el timbrado (retenciones/redondeo del Anexo 20).</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border text-gray-700 hover:bg-gray-100">Cancelar</button>
          <button onClick={emitir} disabled={busy || !emisoraId || activos.length === 0}
            className="px-4 py-2 text-sm rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            <Stamp size={15} /> {busy ? 'Timbrando…' : 'Timbrar CFDI'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Pregunta DESDE CUÁL emisora (GHC/SAJ) se emite el CFDI del cargo, y lo timbra. */
/**
 * ModalCobro — registrar el cobro de un cargo y, si procede, su complemento.
 *
 * POR QUÉ NO BASTA UN BOTÓN DE «PAGADO»
 * Marcar pagado era una bandera: no decía cuánto entró, cuándo ni por dónde. Sin
 * esos tres datos no se puede emitir el complemento de pago, y el SAT lo exige
 * para toda factura PPD — que es como se emiten éstas, porque al facturar el
 * cliente todavía no ha pagado. Sin complemento la operación queda abierta ante
 * el SAT aunque la lista diga «pagado».
 *
 * El importe por omisión es el TOTAL DEL CFDI (con IVA), que es lo que el cliente
 * deposita. Si abonó otra cantidad se captura y manda la capturada.
 */
function ModalCobro({ fila, onClose, onDone }: { fila: any; onClose: () => void; onDone: (m: string) => void }) {
  const soloComplemento = fila.soloComplemento === true;
  const esperado = Number(fila.factura_total || 0) > 0
    ? Number(fila.factura_total)
    : Math.round(Number(fila.total_mxn || 0) * 1.16 * 100) / 100;
  const [monto, setMonto] = useState(String(soloComplemento && Number(fila.cobrado_mxn) > 0 ? fila.cobrado_mxn : esperado));
  const [fecha, setFecha] = useState(fila.pago_fecha || new Date().toISOString().slice(0, 10));
  const [forma, setForma] = useState(fila.pago_forma || '03');
  const [nota, setNota] = useState('');
  // El complemento sólo cabe si hay factura timbrada y es PPD.
  const puedeComplemento = !!fila.factura_folio && String(fila.factura_metodo || '').toUpperCase() !== 'PUE' && !fila.rep_folio;
  const [conComplemento, setConComplemento] = useState(puedeComplemento);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const guardar = async () => {
    setBusy(true); setError('');
    const datos = { monto: Number(monto), fecha, forma, nota: nota.trim() || undefined };
    try {
      if (soloComplemento || (conComplemento && puedeComplemento)) {
        const r: any = await api.emitirComplementoFacturacion(fila.cargo_id, datos);
        onDone(r?.message || `Complemento de pago ${r?.data?.folio} timbrado.`);
      } else {
        await api.pagarFacturacion(fila.cargo_id, datos);
        onDone(`Cobro de ${fila.business_name} registrado por ${money(datos.monto)}.`);
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo registrar el cobro.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="font-bold flex items-center gap-2">
              <Receipt size={18} className="text-emerald-600" />
              {soloComplemento ? 'Complemento de pago' : 'Registrar el cobro'}
            </h2>
            <p className="text-xs text-gray-500">{fila.business_name} · {fila.rfc}{fila.factura_folio ? ` · ${fila.factura_folio}` : ''}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium block mb-1">Importe cobrado</span>
              <input type="number" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} className="input w-full tabular-nums" />
              <span className="text-[11px] text-gray-500">Total del CFDI con IVA: {money(esperado)}</span>
            </label>
            <label className="block">
              <span className="text-sm font-medium block mb-1">Fecha del cobro</span>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="input w-full" />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium block mb-1">Forma de pago (Anexo 20)</span>
            <select value={forma} onChange={(e) => setForma(e.target.value)} className="input w-full">
              <option value="03">03 — Transferencia electrónica de fondos</option>
              <option value="01">01 — Efectivo</option>
              <option value="02">02 — Cheque nominativo</option>
              <option value="04">04 — Tarjeta de crédito</option>
              <option value="28">28 — Tarjeta de débito</option>
              <option value="99">99 — Por definir</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium block mb-1">Nota <span className="font-normal text-gray-500">(opcional)</span></span>
            <input value={nota} onChange={(e) => setNota(e.target.value)} className="input w-full" placeholder="Referencia del depósito, banco…" />
          </label>

          {soloComplemento ? (
            <p className="text-xs text-violet-800 bg-violet-50 border border-violet-200 rounded px-3 py-2">
              Se va a timbrar el <b>CFDI tipo P</b> de este cobro, desde la misma emisora que timbró la factura.
            </p>
          ) : puedeComplemento ? (
            <label className="flex items-start gap-2.5 cursor-pointer rounded border border-violet-200 bg-violet-50 px-3 py-2">
              <input type="checkbox" checked={conComplemento} onChange={(e) => setConComplemento(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-violet-600" />
              <span className="text-sm">
                <b>Emitir también el complemento de pago</b>
                <span className="block text-xs text-gray-600 mt-0.5">
                  La factura es PPD: el SAT pide el CFDI tipo P cuando entra el dinero. Gasta un timbre.
                </span>
              </span>
            </label>
          ) : fila.factura_folio ? null : (
            <p className="text-xs text-gray-500">
              Este cargo todavía no tiene factura: se registra el cobro y el complemento se emite después de facturar.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-white">Cancelar</button>
          <button onClick={guardar} disabled={busy || !(Number(monto) > 0)}
            className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
            {soloComplemento ? 'Timbrar complemento' : conComplemento && puedeComplemento ? 'Cobrar y timbrar complemento' : 'Registrar cobro'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalEmitir({ cargos, emisoras, onClose, onDone }: { cargos: any[]; emisoras: any[]; onClose: () => void; onDone: (m: string) => void }) {
  const [emisoraId, setEmisoraId] = useState<string>(emisoras.find((e) => e.predeterminado)?.id || emisoras[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const uno = cargos.length === 1;
  const esIva = uno && cargos[0].iva === true;
  const [monto, setMonto] = useState<string>(String(cargos[0]?.cargo_total || 500));
  const [concepto, setConcepto] = useState('Servicio de consulta y cálculo de IVA mensual (IVA GDM)');
  const totalGrupo = cargos.reduce((a, c) => a + Number(c.total_mxn || 0), 0);
  const emitir = async () => {
    if (!emisoraId) { setError('Elige la emisora.'); return; }
    setBusy(true); setError('');
    try {
      if (esIva) {
        const r: any = await api.cobrarIva(cargos[0].company_id, Number(monto), emisoraId, concepto);
        onDone(r?.message || `Factura ${r?.data?.folio || ''} emitida.`);
        return;
      }
      if (uno) {
        const r: any = await api.emitirFacturaMensual(cargos[0].cargo_id, emisoraId);
        onDone(r?.message || `Factura ${r?.data?.folio || ''} emitida.`);
        return;
      }
      // Grupo: emite una por una; una falla no detiene al resto.
      let ok = 0; const fallos: string[] = [];
      for (const c of cargos) {
        try { await api.emitirFacturaMensual(c.cargo_id, emisoraId); ok++; }
        catch (e: any) { fallos.push(`${c.business_name}: ${e?.response?.data?.message || 'error'}`); }
      }
      if (fallos.length && !ok) { setError(`No se emitió ninguna. ${fallos.slice(0, 2).join(' · ')}`); return; }
      onDone(`${ok} factura(s) emitida(s)${fallos.length ? `, ${fallos.length} con error` : ''}.`);
    } catch (e: any) { setError(e?.response?.data?.message || 'No se pudo emitir.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><FileText size={18} className="text-violet-600" /> {uno ? 'Emitir factura' : 'Emitir facturas del grupo'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          {uno ? (
            <>
              <p className="text-gray-600">Cliente: <b>{cargos[0].business_name}</b> <span className="font-mono text-gray-400">{cargos[0].rfc}</span></p>
              {esIva ? (
                <>
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-600 block mb-1">Monto a cobrar (sin IVA)</span>
                    <input type="number" min="1" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)}
                      className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
                    <span className="text-[11px] text-gray-500">Anualidad $500 o el paquete de créditos que pagó. El CFDI suma el 16 %.</span>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-600 block mb-1">Concepto</span>
                    <input value={concepto} onChange={(e) => setConcepto(e.target.value)}
                      className="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
                  </label>
                </>
              ) : (
                <p className="text-gray-600">Total: <b>{money(cargos[0].total_mxn)}</b> + IVA · periodo del cargo.</p>
              )}
            </>
          ) : (
            <p className="text-gray-600">Se emitirán <b>{cargos.length}</b> factura(s) del despacho, total <b>{money(totalGrupo)}</b> + IVA, <b>todas desde la misma emisora</b>.</p>
          )}
          <label className="block">
            <span className="text-xs font-semibold text-gray-600 block mb-1">¿Desde cuál emisora se factura?</span>
            <select value={emisoraId} onChange={(e) => setEmisoraId(e.target.value)} className="w-full border border-slate-300 rounded px-3 py-2 text-sm">
              {emisoras.length === 0 && <option value="">No hay emisoras marcadas</option>}
              {emisoras.map((e) => (
                <option key={e.id} value={e.id}>{e.business_name} · {e.rfc}{e.predeterminado ? ' (predeterminada)' : ''}</option>
              ))}
            </select>
          </label>
          {error && <p className="text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</p>}
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">Se timbrará un CFDI real desde la emisora elegida. Asegúrate de que el cliente tenga RFC, régimen y CP correctos.</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border text-gray-700 hover:bg-gray-100">Cancelar</button>
          <button onClick={emitir} disabled={busy || !emisoraId || (esIva && !(Number(monto) > 0))}
            className="px-4 py-2 text-sm rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            <FileText size={15} /> {busy ? 'Emitiendo…' : 'Emitir CFDI'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Seccion({ icon, titulo, nota, children, colapsable, defaultColapsado }: { icon: React.ReactNode; titulo: string; nota?: string; children: React.ReactNode; colapsable?: boolean; defaultColapsado?: boolean }) {
  const [abierto, setAbierto] = useState(!defaultColapsado);
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
        {colapsable ? (
          <button onClick={() => setAbierto((a) => !a)} className="flex items-center gap-1.5 hover:text-gray-900">
            {abierto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}{icon} {titulo}
          </button>
        ) : <>{icon} {titulo}</>}
      </h2>
      {nota && abierto && <p className="text-xs text-gray-400 mb-1.5">{nota}</p>}
      {(!colapsable || abierto) && <div className="bg-white rounded-lg shadow overflow-x-auto">{children}</div>}
    </section>
  );
}

function Tarjeta({ label, valor, destacado }: { label: string; valor: any; destacado?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${destacado ? 'bg-emerald-50 border-emerald-200' : 'bg-white'}`}>
      <p className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold ${destacado ? 'text-emerald-700' : 'text-gray-800'}`}>{valor}</p>
    </div>
  );
}

function PanelConfig({ cfg, onGuardado }: { cfg: any; onGuardado: () => void }) {
  const [precio, setPrecio] = useState(String(cfg.precioUsuario));
  const [incl, setIncl] = useState(String(cfg.timbresIncluidos));
  const [extra, setExtra] = useState(String(cfg.timbreExtra));
  const [inclPU, setInclPU] = useState(String(cfg.timbresPorUsuario ?? 500));
  const [extraPU, setExtraPU] = useState(String(cfg.timbreExtraPorUsuario ?? 0.2));
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState('');

  const guardar = async () => {
    setBusy(true); setOk('');
    try {
      await api.setFacturacionConfig({
        precioUsuario: Number(precio), timbresIncluidos: Number(incl), timbreExtra: Number(extra),
        timbresPorUsuario: Number(inclPU), timbreExtraPorUsuario: Number(extraPU),
      });
      setOk('Guardado.'); onGuardado();
    } catch (e: any) { setOk(e?.response?.data?.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };

  const inc10 = Number(incl) + Number(inclPU) * 9;
  const ext10 = (Number(extra) + Number(extraPU) * 9).toFixed(2);

  return (
    <div className="bg-white border rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block"><span className="text-xs text-gray-600 block mb-1">Precio por usuario — introducción (MXN)</span>
          <input value={precio} onChange={(e) => setPrecio(e.target.value)} className="input py-1.5 text-sm w-32" /></label>
        <label className="block"><span className="text-xs text-gray-600 block mb-1">Timbres incluidos base (1 usr)</span>
          <input value={incl} onChange={(e) => setIncl(e.target.value)} className="input py-1.5 text-sm w-32" /></label>
        <label className="block"><span className="text-xs text-gray-600 block mb-1">+ Timbres por usuario</span>
          <input value={inclPU} onChange={(e) => setInclPU(e.target.value)} className="input py-1.5 text-sm w-32" /></label>
        <label className="block"><span className="text-xs text-gray-600 block mb-1">Timbre extra base (MXN)</span>
          <input value={extra} onChange={(e) => setExtra(e.target.value)} className="input py-1.5 text-sm w-32" /></label>
        <label className="block"><span className="text-xs text-gray-600 block mb-1">+ Timbre extra por usuario (MXN)</span>
          <input value={extraPU} onChange={(e) => setExtraPU(e.target.value)} className="input py-1.5 text-sm w-32" /></label>
        <button onClick={guardar} disabled={busy} className="bg-primary text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm">{busy ? 'Guardando…' : 'Guardar'}</button>
        {ok && <span className="text-sm text-emerald-700">{ok}</span>}
      </div>
      <p className="text-[11px] text-gray-400">
        Escalonado: incluidos = base + (por usuario) × (usuarios − 1); timbre extra = base + (por usuario) × (usuarios − 1).
        Con estos valores: <b>1 usuario</b> = {incl} timbres / ${extra} · <b>10 usuarios</b> = {inc10} timbres / ${ext10}. Cobro mensual, sin plazo forzoso.
      </p>
      <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
        <b>Calendario del precio por usuario:</b> el valor de arriba es el de <b>introducción</b> (contrataciones de oct–dic 2026).
        Las que contraten desde el <b>01/01/2027</b> pagan <b>$1,000</b>, y el <b>01/04/2027</b> <b>todas</b> las empresas saltan a <b>$1,000</b>
        (y así queda en 2027). El salto es automático por fecha; aquí solo se ajusta el precio de introducción.
      </p>
    </div>
  );
}

export default AdminFacturacionPage;
