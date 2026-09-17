/**
 * Reportes fiscales — DIOT (clientes y proveedores) y Contabilidad Electrónica
 * (Anexo 24: catálogo de cuentas y balanza de comprobación en XML).
 *
 * Ambos se ALIMENTAN de los XML descargados/subidos: sin descargas del SAT no hay
 * DIOT ni contabilidad electrónica que valga. El catálogo/balanza XML son planos
 * (sin sello): la e.firma se usa al enviarlos por el buzón, no se incrusta aquí.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Download, ScrollText, AlertCircle } from 'lucide-react';
import { api } from '@/services/api';
import { aniosContables } from '@/utils/anios';

const money = (n: any) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function ReportesFiscalesPage() {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [tab, setTab] = useState<'diot' | 'electronica'>('diot');

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileText size={22} className="text-violet-600" /> SAT
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          DIOT (clientes y proveedores) y Contabilidad Electrónica del Anexo 24. Se arman
          con los CFDI que ya bajaste; revisa que el mes tenga descargas completas.
        </p>
      </div>

      <div className="bg-white rounded-lg border shadow-sm p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[11px] text-gray-600 block">Año</label>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input text-sm">
            {aniosContables().map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-gray-600 block">Mes</label>
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className="input text-sm">
            {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="ml-auto flex gap-1 border rounded-lg p-0.5 bg-gray-50">
          {([['diot', 'DIOT'], ['electronica', 'Contabilidad Electrónica']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-md text-sm ${tab === k ? 'bg-white shadow font-medium text-violet-700' : 'text-gray-600'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'diot'
        ? <Diot anio={anio} mes={mes} />
        : <Electronica anio={anio} mes={mes} />}
    </div>
  );
}

/* ── DIOT: compras del mes por proveedor, IVA por tasa e IVA retenido ── */
function Diot({ anio, mes }: { anio: number; mes: number }) {
  const q = useQuery({ queryKey: ['diot', anio, mes], queryFn: () => api.getDiot(anio, mes) });
  const d: any = q.data?.data;

  // Decisiones fiscales que el CFDI no trae (las fija el usuario, no se inventan).
  const [tipoOp, setTipoOp] = useState('85');
  const [region, setRegion] = useState<'none' | 'norte' | 'sur'>('none');
  const [prop, setProp] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [errTxt, setErrTxt] = useState('');

  const bajarTxt = async () => {
    setBajando(true); setErrTxt('');
    try {
      await api.descargarDiotBatch(anio, mes, { tipoOperacion: tipoOp, region, proporcion: prop });
    } catch (e: any) {
      setErrTxt(e?.message || 'No se pudo generar el archivo .txt.');
    } finally { setBajando(false); }
  };

  const bajarCsv = () => {
    if (!d?.proveedores?.length) return;
    const enc = ['Tipo tercero', 'RFC', 'Nombre', 'Comprobantes', 'Base 16%', 'IVA 16%',
      'Base 8%', 'IVA 8%', 'Base 0%', 'Exento', 'IVA retenido'];
    const linea = (p: any) => [p.tipoTercero, p.rfc, `"${String(p.nombre || '').replace(/"/g, '""')}"`,
      p.comprobantes, p.base16, p.iva16, p.base8, p.iva8, p.base0, p.exento, p.ivaRet].join(',');
    const csv = [enc.join(','), ...d.proveedores.map(linea)].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `DIOT_${anio}-${String(mes).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (q.isLoading) return <p className="text-sm text-gray-500">Cargando…</p>;
  if (!d) return <p className="text-sm text-gray-500 italic bg-white border rounded-lg p-4 text-center">No se pudo cargar la DIOT.</p>;

  const t = d.totales || {};
  const extranjeros = (d.proveedores || []).filter((p: any) => p.tipoTercero === '05').length;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-violet-50 border-violet-200 px-4 py-2 text-sm flex flex-wrap items-center gap-x-6 gap-y-1">
        <span className="font-medium text-violet-900">{d.cuantos} proveedor(es)</span>
        {extranjeros > 0 && <span className="text-amber-700">{extranjeros} extranjero(s)</span>}
        <span>Base 16% {money(t.base16)}</span>
        <span>IVA 16% {money(t.iva16)}</span>
        {(t.base8 > 0 || t.iva8 > 0) && <span>IVA 8% {money(t.iva8)}</span>}
        {t.base0 > 0 && <span>Base 0% {money(t.base0)}</span>}
        {t.exento > 0 && <span>Exento {money(t.exento)}</span>}
        {t.ivaRet > 0 && <span>IVA retenido {money(t.ivaRet)}</span>}
        <button onClick={bajarCsv} disabled={!d.proveedores.length} className="btn-export ml-auto">
          <Download size={14} /> CSV
        </button>
      </div>

      {/* Archivo .txt de carga masiva del SAT + las decisiones fiscales que lo afectan */}
      <div className="bg-white rounded-lg border p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[11px] text-gray-600 block">Tipo de operación (por defecto)</label>
            <select value={tipoOp} onChange={(e) => setTipoOp(e.target.value)} className="input text-sm">
              <option value="85">85 · Otros</option>
              <option value="03">03 · Servicios profesionales</option>
              <option value="06">06 · Uso o goce (arrendamiento)</option>
              <option value="02">02 · Enajenación de bienes</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] text-gray-600 block">Región fronteriza (para el 8%)</label>
            <select value={region} onChange={(e) => setRegion(e.target.value as any)} className="input text-sm">
              <option value="none">No aplica</option>
              <option value="norte">Frontera norte</option>
              <option value="sur">Frontera sur</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 pb-1.5">
            <input type="checkbox" checked={prop} onChange={(e) => setProp(e.target.checked)} />
            Aplico proporción de acreditamiento (tengo actividades exentas)
          </label>
          <button onClick={bajarTxt} disabled={bajando || !d.proveedores.length}
            className="btn-export ml-auto">
            <Download size={14} /> {bajando ? 'Generando…' : '.txt carga masiva SAT'}
          </button>
        </div>

        {errTxt && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-800 flex gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" /> {errTxt}
          </div>
        )}

        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex gap-2">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <span>
            El <b>.txt</b> sigue el layout del instructivo de <b>carga masiva DIOT 2025</b> (53 campos,
            separados por «|», montos enteros). Lo que el CFDI <b>no</b> dice —tipo de operación,
            proporción y región— lo tomas de los controles de arriba; el <b>manifiesto de efectos
            fiscales</b> va en «Sí». <b>Valida el archivo en el propio aplicativo del SAT</b> antes de
            enviarlo, y ajusta lo que tu caso requiera. Los <b>proveedores extranjeros</b> salen sin
            país ni ID fiscal (el CFDI no los trae): captúralos a mano en esos renglones.
          </span>
        </div>
      </div>

      {d.proveedores.length === 0 ? (
        <p className="text-sm text-gray-500 italic bg-white border rounded-lg p-4 text-center">
          {MESES[mes]} {anio} no tiene compras (CFDI recibidos tipo I) con XML.
        </p>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold">Tercero</th>
                  <th className="px-3 py-1.5 text-left font-semibold">RFC</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Nombre</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Comp.</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Base 16%</th>
                  <th className="px-3 py-1.5 text-right font-semibold">IVA 16%</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Base 8%</th>
                  <th className="px-3 py-1.5 text-right font-semibold">IVA 8%</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Base 0%</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Exento</th>
                  <th className="px-3 py-1.5 text-right font-semibold">IVA ret.</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {d.proveedores.map((p: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-2 py-1 text-center">
                      <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono text-[10px]">{p.tipoTercero}</span>
                    </td>
                    <td className="px-3 py-1 font-mono whitespace-nowrap">{p.rfc}</td>
                    <td className="px-2 py-1 max-w-[220px] truncate" title={p.nombre}>{p.nombre}</td>
                    <td className="px-2 py-1 text-right">{p.comprobantes}</td>
                    <td className="px-3 py-1 text-right font-mono">{p.base16 ? money(p.base16) : ''}</td>
                    <td className="px-3 py-1 text-right font-mono">{p.iva16 ? money(p.iva16) : ''}</td>
                    <td className="px-3 py-1 text-right font-mono">{p.base8 ? money(p.base8) : ''}</td>
                    <td className="px-3 py-1 text-right font-mono">{p.iva8 ? money(p.iva8) : ''}</td>
                    <td className="px-3 py-1 text-right font-mono">{p.base0 ? money(p.base0) : ''}</td>
                    <td className="px-3 py-1 text-right font-mono">{p.exento ? money(p.exento) : ''}</td>
                    <td className="px-3 py-1 text-right font-mono">{p.ivaRet ? money(p.ivaRet) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold text-gray-700">
                <tr className="border-t-2">
                  <td className="px-2 py-1.5" colSpan={4}>Totales</td>
                  <td className="px-3 py-1.5 text-right font-mono">{money(t.base16)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{money(t.iva16)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{money(t.base8)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{money(t.iva8)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{money(t.base0)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{money(t.exento)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{money(t.ivaRet)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="px-3 py-2 text-[11px] text-gray-400 border-t">
            Tipo tercero: <b>04</b> proveedor nacional, <b>05</b> extranjero. IVA desglosado del
            comprobante (no de conceptos) para no contarlo doble.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Contabilidad Electrónica: descarga de catálogo y balanza en XML ── */
function Electronica({ anio, mes }: { anio: number; mes: number }) {
  const [bajando, setBajando] = useState<string>('');
  const [tipoEnvio, setTipoEnvio] = useState<'N' | 'C'>('N');
  const [error, setError] = useState<string>('');

  const bajar = async (que: 'catalogo' | 'balanza') => {
    setBajando(que); setError('');
    try {
      if (que === 'catalogo') await api.descargarCatalogoElectronico(anio, mes);
      else await api.descargarBalanzaElectronica(anio, mes, tipoEnvio);
    } catch (e: any) {
      setError(e?.message || 'No se pudo generar el XML.');
    } finally { setBajando(''); }
  };

  const per = `${MESES[mes]} ${anio}`;
  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800 flex gap-2">
          <AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Catálogo de cuentas */}
        <div className="bg-white border rounded-lg p-4 flex flex-col">
          <div className="flex items-center gap-2 text-gray-800 font-medium">
            <ScrollText size={18} className="text-violet-600" /> Catálogo de cuentas
          </div>
          <p className="text-xs text-gray-500 mt-1 flex-1">
            Las cuentas con su código agrupador del Anexo 24. Se envía cuando cambia el catálogo
            (al menos una vez, y cada que agregues o modifiques cuentas).
          </p>
          <button onClick={() => bajar('catalogo')} disabled={!!bajando} className="btn-export mt-3 self-start">
            <Download size={14} /> {bajando === 'catalogo' ? 'Generando…' : `Catálogo XML · ${per}`}
          </button>
        </div>

        {/* Balanza de comprobación */}
        <div className="bg-white border rounded-lg p-4 flex flex-col">
          <div className="flex items-center gap-2 text-gray-800 font-medium">
            <ScrollText size={18} className="text-violet-600" /> Balanza de comprobación
          </div>
          <p className="text-xs text-gray-500 mt-1 flex-1">
            Saldos iniciales, cargos, abonos y saldo final del mes. Se envía mensualmente. Sale de
            la balanza del periodo: si está vacía, actualízala desde pólizas primero.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <select value={tipoEnvio} onChange={(e) => setTipoEnvio(e.target.value as 'N' | 'C')} className="input text-sm">
              <option value="N">Normal</option>
              <option value="C">Complementaria</option>
            </select>
            <button onClick={() => bajar('balanza')} disabled={!!bajando} className="btn-export">
              <Download size={14} /> {bajando === 'balanza' ? 'Generando…' : `Balanza XML · ${per}`}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-600 flex gap-2">
        <AlertCircle size={15} className="shrink-0 mt-0.5 text-gray-400" />
        <span>
          Los XML salen <b>sin sello</b>: son planos y validan contra el XSD del SAT. La e.firma
          (FIEL) se usa al <b>enviarlos por el Buzón Tributario</b>, no se incrusta en el archivo.
          Sólo entran las cuentas que tienen código agrupador del Anexo 24.
        </span>
      </div>

      <PreviewContabElec anio={anio} mes={mes} />
    </div>
  );
}

/* ── Vista previa de la Contabilidad Electrónica (lo que va en el XML) ── */
function PreviewContabElec({ anio, mes }: { anio: number; mes: number }) {
  const [ver, setVer] = useState<'balanza' | 'catalogo'>('balanza');
  const qBal = useQuery({ queryKey: ['ce-bal', anio, mes], queryFn: () => api.getBalanzaElectronicaPreview(anio, mes), enabled: ver === 'balanza' });
  const qCat = useQuery({ queryKey: ['ce-cat', anio, mes], queryFn: () => api.getCatalogoElectronicoPreview(anio, mes), enabled: ver === 'catalogo' });
  const bal: any = qBal.data?.data;
  const cat: any = qCat.data?.data;
  const cargando = ver === 'balanza' ? qBal.isLoading : qCat.isLoading;

  return (
    <div className="bg-white border rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-gray-700">Vista previa</span>
        <div className="flex gap-1 border rounded-lg p-0.5 bg-gray-50 text-xs">
          {(['balanza', 'catalogo'] as const).map((k) => (
            <button key={k} onClick={() => setVer(k)}
              className={`px-2.5 py-1 rounded-md ${ver === k ? 'bg-white shadow font-medium text-violet-700' : 'text-gray-600'}`}>
              {k === 'balanza' ? 'Balanza' : 'Catálogo'}
            </button>
          ))}
        </div>
        {ver === 'balanza' && bal && !bal.vacia && (
          <span className={`ml-auto text-xs ${bal.cuadra ? 'text-emerald-600' : 'text-rose-600'}`}>
            {bal.cuadra ? '✓ cuadra' : 'no cuadra'} · {bal.cuantos} cuenta(s)
          </span>
        )}
        {ver === 'catalogo' && cat && <span className="ml-auto text-xs text-gray-500">{cat.cuantos} cuenta(s)</span>}
      </div>
      <div className="overflow-auto max-h-[55vh]">
        {cargando ? (
          <p className="p-4 text-sm text-gray-500">Cargando…</p>
        ) : ver === 'balanza' ? (
          bal?.vacia ? (
            <p className="p-4 text-sm text-gray-500 italic">
              La balanza de {MESES[mes]} {anio} está vacía. Actualízala desde pólizas primero
              (Balanza de comprobación → «Actualizar desde pólizas» / «Reconstruir año»).
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500 sticky top-0">
                <tr>
                  <th className="px-3 py-1.5 text-left font-semibold">Cuenta</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Descripción</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Saldo ini.</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Debe</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Haber</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Saldo fin.</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(bal?.cuentas || []).map((c: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-1 font-mono whitespace-nowrap">{c.numCta}</td>
                    <td className="px-2 py-1 max-w-[240px] truncate" title={c.desc}>{c.desc}</td>
                    <td className="px-3 py-1 text-right font-mono">{money(c.saldoIni)}</td>
                    <td className="px-3 py-1 text-right font-mono">{c.debe ? money(c.debe) : ''}</td>
                    <td className="px-3 py-1 text-right font-mono">{c.haber ? money(c.haber) : ''}</td>
                    <td className="px-3 py-1 text-right font-mono">{money(c.saldoFin)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold text-gray-700">
                <tr className="border-t-2">
                  <td className="px-3 py-1.5" colSpan={3}>Totales</td>
                  <td className="px-3 py-1.5 text-right font-mono">{money(bal?.totales?.debe)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{money(bal?.totales?.haber)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 sticky top-0">
              <tr>
                <th className="px-3 py-1.5 text-left font-semibold">Agrup.</th>
                <th className="px-3 py-1.5 text-left font-semibold">Cuenta</th>
                <th className="px-2 py-1.5 text-left font-semibold">Descripción</th>
                <th className="px-2 py-1.5 text-left font-semibold">SubCta de</th>
                <th className="px-2 py-1.5 text-center font-semibold">Nivel</th>
                <th className="px-2 py-1.5 text-center font-semibold">Natur</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(cat?.cuentas || []).map((c: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-1 font-mono">{c.codAgrup}</td>
                  <td className="px-3 py-1 font-mono whitespace-nowrap">{c.numCta}</td>
                  <td className="px-2 py-1 max-w-[240px] truncate" title={c.desc}>{c.desc}</td>
                  <td className="px-2 py-1 font-mono text-gray-500">{c.subCtaDe}</td>
                  <td className="px-2 py-1 text-center">{c.nivel}</td>
                  <td className="px-2 py-1 text-center">{c.natur}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default ReportesFiscalesPage;
