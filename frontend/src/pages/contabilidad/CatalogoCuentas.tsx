/**
 * Catálogo de cuentas — el árbol, su clasificación y el empate con otros catálogos.
 *
 * ── POR QUÉ ÁRBOL Y NO TABLA ──
 * Un catálogo contable ES una jerarquía: '102.01 Bancos nacionales' sólo
 * significa algo colgando de '102 Bancos'. En una tabla plana de 679 renglones
 * esa relación se pierde, y con ella la única forma de ver que una subcuenta
 * quedó bajo el padre equivocado —que es el error que descuadra el balance sin
 * que ninguna póliza esté mal capturada.
 *
 * ── LAS DOS COLUMNAS DE CÓDIGO, A LA VISTA ──
 * Hoy valen lo mismo en casi todas las cuentas. Se muestran las dos de todos
 * modos: el día que se re-numere el catálogo propio, ver el agrupador al lado
 * es lo que permite comprobar que la equivalencia con el SAT no se movió.
 */
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, ChevronDown, Search, Plus, AlertTriangle, CheckCircle2,
  Link2, BookOpen, X, Info, Layers, Upload, Loader2, Scale, Pencil, Trash2,
  Users, Tag, Download,
} from 'lucide-react';
import api from '@/services/api';
import { useCapacidades, CAP } from '@/utils/capacidades';
import { formatCuenta, useMascara } from '@/utils/cuenta';
import { aniosContables } from '@/utils/anios';

const TIPO_COLOR: Record<string, string> = {
  ACTIVO:  'bg-sky-100 text-sky-800',
  PASIVO:  'bg-amber-100 text-amber-800',
  CAPITAL: 'bg-violet-100 text-violet-800',
  INGRESO: 'bg-emerald-100 text-emerald-800',
  COSTO:   'bg-orange-100 text-orange-800',
  GASTO:   'bg-rose-100 text-rose-800',
  RIF:     'bg-indigo-100 text-indigo-800',
  ORDEN:   'bg-gray-200 text-gray-700',
};

/* Anchos FIJOS de las columnas de la derecha del árbol. El nombre es flexible y
 * absorbe la sangría del árbol; estas columnas quedan pegadas al borde derecho con
 * ancho fijo, así el agrupador SAT y la naturaleza SIEMPRE caen en la misma posición
 * vertical y se escanean de un vistazo (lo pidió el usuario). El encabezado del
 * árbol usa exactamente estas mismas clases para alinear. */
const COL_SAT = 'w-24 shrink-0';
const COL_NAT = 'w-7 shrink-0 text-center';
const COL_TIPO = 'w-20 shrink-0';
const COL_ACC = 'w-12 shrink-0';

export function CatalogoCuentasPage() {
  const qc = useQueryClient();
  const { puede } = useCapacidades();
  const puedeEditar = puede(CAP.ctaCatalogo);
  const [mascara, setMascara] = useState('');
  const [guardandoMascara, setGuardandoMascara] = useState(false);
  useEffect(() => { api.getMascaraCuenta().then(setMascara).catch(() => {}); }, []);
  const guardarMascara = async () => {
    setGuardandoMascara(true);
    try { setMascara(await api.setMascaraCuenta(mascara)); } catch { /* noop */ }
    finally { setGuardandoMascara(false); }
  };

  const [busqueda, setBusqueda] = useState('');
  const [tipo, setTipo] = useState('');
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [detalle, setDetalle] = useState<any>(null);
  const [alta, setAlta] = useState<any>(null);
  /* Colapsa TODO el catálogo a un solo renglón, para dejar la pantalla entera
     al panel de análisis (respaldo del cliente, catálogos). */
  const [arbolColapsado, setArbolColapsado] = useState(false);
  const [msg, setMsg] = useState('');
  const [soloSinAgrupador, setSoloSinAgrupador] = useState(false);
  const [soloMalCapturadas, setSoloMalCapturadas] = useState(false);
  const [herr, setHerr] = useState('');   // herramienta de mantenimiento en curso
  const [proponer, setProponer] = useState(false);   // modal de propuesta de agrupador

  const arbolQ = useQuery({
    queryKey: ['cuentas-arbol'],
    queryFn: () => api.getArbolDeCuentas(),
  });
  const revisionQ = useQuery({
    queryKey: ['cuentas-revision'],
    queryFn: () => api.getRevisionCatalogo(),
  });
  const agrupQ = useQuery({ queryKey: ['agrupadores-sat'], queryFn: () => api.getAgrupadoresSat() });
  const agrupadores: any[] = agrupQ.data?.data?.agrupadores || [];

  const arbol: any[] = arbolQ.data?.data?.arbol || [];
  const revision: any = revisionQ.data?.data;

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['cuentas-arbol'] });
    qc.invalidateQueries({ queryKey: ['cuentas-revision'] });
  };

  /* Al buscar, el árbol se filtra pero se conservan los padres de lo que
   * coincide: una cuenta sin su rama encima no dice de qué cuelga. */
  const filtrado = useMemo(() => {
    const b = busqueda.trim().toLowerCase();
    if (!b && !tipo && !soloSinAgrupador && !soloMalCapturadas) return arbol;

    // "Mal capturada": el rubro del código no coincide con el del agrupador SAT
    // (código de activo 1… con agrupador de pasivo 2…, como «Uber» 201.01).
    const mal = (n: any): boolean => {
      const cod = String(n.codigo || ''); const agr = String(n.codigo_agrupador || '');
      return /^\d/.test(cod) && /^\d/.test(agr) && cod[0] !== agr[0];
    };
    const coincide = (n: any): boolean =>
      (!tipo || n.tipo === tipo) &&
      (!soloSinAgrupador || (!n.codigo_agrupador && n.permite_movimientos)) &&
      (!soloMalCapturadas || mal(n)) &&
      (!b || n.codigo.toLowerCase().includes(b) || n.nombre.toLowerCase().includes(b));

    const podar = (n: any): any | null => {
      const hijos = (n.hijosLista || []).map(podar).filter(Boolean);
      if (coincide(n) || hijos.length) return { ...n, hijosLista: hijos };
      return null;
    };
    return arbol.map(podar).filter(Boolean);
  }, [arbol, busqueda, tipo, soloSinAgrupador, soloMalCapturadas]);

  const buscando = !!busqueda.trim() || !!tipo || soloSinAgrupador || soloMalCapturadas;

  /* Los id de las ramas que TIENEN hijos: es lo que "Expandir todo" abre. */
  const idsConHijos = useMemo(() => {
    const ids: string[] = [];
    const rec = (n: any) => {
      if ((n.hijosLista || []).length) { ids.push(n.id); (n.hijosLista as any[]).forEach(rec); }
    };
    arbol.forEach(rec);
    return ids;
  }, [arbol]);

  const alternar = (id: string) => {
    const s = new Set(abiertos);
    s.has(id) ? s.delete(id) : s.add(id);
    setAbiertos(s);
  };

  /* Borrar de verdad (limpieza del catálogo importado). El backend rechaza si la
     cuenta tiene subcuentas o movimientos; ahí se avisa y no pasa nada. */
  const eliminar = async (nodo: any) => {
    if ((nodo.hijosLista || []).length) { setMsg(`«${nodo.codigo}» tiene subcuentas: bórralas primero.`); return; }
    if (!window.confirm(`¿Borrar la cuenta ${nodo.codigo} — ${nodo.nombre}?\n\nSi tiene partidas, se pasan a MIG-TEMPORAL para reasignarlas luego. Al reimportar el respaldo NO volverá a aparecer.`)) return;
    setMsg('');
    try {
      const r: any = await api.eliminarCuentaContable(nodo.id);
      const mov = r?.data?.cuenta?.partidasMovidas || 0;
      setMsg((r?.message || `Cuenta ${nodo.codigo} borrada.`) + (mov ? ` ${mov} partida(s) pasaron a MIG-TEMPORAL.` : ''));
      refrescar();
    } catch (e: any) {
      setMsg(e?.response?.data?.message || 'No se pudo borrar la cuenta.');
    }
  };

  /* Mueve los terceros mal colocados (mezclados) a su control correcto. */
  const reorganizar = async () => {
    if (!window.confirm('¿Reorganizar los terceros?\n\nLos clientes/proveedores que quedaron bajo un control equivocado se mueven a su control correcto (105 cliente / 201 proveedor) y se renumeran. Sus partidas los siguen (misma cuenta).')) return;
    setHerr('reorg'); setMsg('');
    try { const r: any = await api.reorganizarTerceros(); setMsg(r?.message || 'Terceros reorganizados.'); refrescar(); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo reorganizar.'); }
    finally { setHerr(''); }
  };
  /* Rellena el agrupador SAT que falta, heredándolo del padre. */
  const asignarAgrupador = async () => {
    setHerr('agrup'); setMsg('');
    try { const r: any = await api.asignarAgrupadorFaltante(); setMsg(r?.message || 'Agrupadores asignados.'); refrescar(); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo asignar el agrupador.'); }
    finally { setHerr(''); }
  };
  /* Exporta el catálogo a Excel para revisarlo/corregirlo fuera. */
  const exportarExcel = async () => {
    setHerr('excel'); setMsg('');
    try { await api.descargarCatalogoExcel(); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo exportar el catálogo.'); }
    finally { setHerr(''); }
  };
  /* Plantilla en blanco (para armar el catálogo desde cero e importarlo). */
  const descargarPlantilla = async () => {
    setHerr('plantilla'); setMsg('');
    try { await api.descargarPlantillaCatalogo(); }
    catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo descargar la plantilla.'); }
    finally { setHerr(''); }
  };
  /* Importa el catálogo desde el TXT de CONTPAQi (crea las cuentas con su jerarquía). */
  const importarTxt = async (file: File) => {
    setHerr('txt'); setMsg('');
    try {
      const fd = new FormData(); fd.append('archivo', file);
      const r: any = await api.importarCatalogoTxt(fd);
      let m = r?.message || 'Catálogo importado.';
      if (r?.data?.errores?.length) m += ` Errores: ${r.data.errores.slice(0, 3).join(' · ')}${r.data.errores.length > 3 ? '…' : ''}.`;
      setMsg(m);
      refrescar();
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo importar el TXT.'); }
    finally { setHerr(''); }
  };
  /* Reimporta el Excel editado: casa por código y actualiza nombre + agrupador. */
  const importarExcel = async (file: File) => {
    setHerr('import'); setMsg('');
    try {
      const fd = new FormData(); fd.append('archivo', file);
      const r: any = await api.importarCatalogoExcel(fd);
      const d = r?.data || {};
      let m = r?.message || 'Catálogo importado.';
      if (d.errores?.length) m += ` Errores: ${d.errores.slice(0, 3).join(' · ')}${d.errores.length > 3 ? '…' : ''}.`;
      setMsg(m);
      refrescar();
    } catch (e: any) { setMsg(e?.response?.data?.message || 'No se pudo importar el Excel.'); }
    finally { setHerr(''); }
  };

  if (arbolQ.isLoading) {
    return <div className="p-6 text-gray-500">Cargando el catálogo…</div>;
  }

  if (!arbol.length) {
    return <SinCatalogo onListo={refrescar} />;
  }

  return (
    <div className="p-6 space-y-4 max-w-[1500px]">
      {/* Desplegable de agrupadores del Anexo 24 (lo usan el alta y la edición). */}
      <datalist id="agrup-sat">
        {agrupadores.map((a) => (
          <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nombre}</option>
        ))}
      </datalist>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen size={22} className="text-primary" /> Catálogo de cuentas
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {revision?.total} cuentas · {revision?.movimiento} admiten movimientos
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Exportar Excel y Plantilla: disponibles para todos (son descargas). */}
          <button onClick={descargarPlantilla} disabled={!!herr}
            title="Descarga una plantilla en blanco para armar el catálogo desde cero e importarlo"
            className="border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5">
            <Download size={14} /> {herr === 'plantilla' ? 'Bajando…' : 'Plantilla'}
          </button>
          <button onClick={exportarExcel} disabled={!!herr}
            title="Descarga todo el catálogo a Excel para revisar/corregir los agrupadores"
            className="border border-emerald-300 text-emerald-700 px-3 py-1.5 rounded-lg text-sm hover:bg-emerald-50 disabled:opacity-50 flex items-center gap-1.5">
            <Download size={14} /> {herr === 'excel' ? 'Exportando…' : 'Exportar Excel'}
          </button>
          {puedeEditar && (
            <>
              <label
                title="Reimporta el catálogo editado en Excel: casa por CÓDIGO y actualiza nombre y agrupador SAT (no crea ni borra cuentas)"
                className={`border border-sky-300 text-sky-700 px-3 py-1.5 rounded-lg text-sm hover:bg-sky-50 flex items-center gap-1.5 cursor-pointer ${herr ? 'opacity-50 pointer-events-none' : ''}`}>
                <Upload size={14} /> {herr === 'import' ? 'Importando…' : 'Importar Excel'}
                <input type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) importarExcel(f); e.currentTarget.value = ''; }} />
              </label>
              <label
                title="Importa el catálogo desde el TXT de CONTPAQi: crea las cuentas con su jerarquía, naturaleza y agrupador del SAT"
                className={`border border-violet-300 text-violet-700 px-3 py-1.5 rounded-lg text-sm hover:bg-violet-50 flex items-center gap-1.5 cursor-pointer ${herr ? 'opacity-50 pointer-events-none' : ''}`}>
                <Upload size={14} /> {herr === 'txt' ? 'Importando…' : 'Importar CONTPAQi (.txt)'}
                <input type="file" accept=".txt" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) importarTxt(f); e.currentTarget.value = ''; }} />
              </label>
              <button onClick={reorganizar} disabled={!!herr}
                title="Mueve los terceros mezclados (bajo un control equivocado) a su control correcto: clientes a 105, proveedores a 201, renumerados. Las partidas los siguen."
                className="border border-indigo-300 text-indigo-700 px-3 py-1.5 rounded-lg text-sm hover:bg-indigo-50 disabled:opacity-50 flex items-center gap-1.5">
                <Users size={14} /> {herr === 'reorg' ? 'Reorganizando…' : 'Reorganizar terceros'}
              </button>
              <button onClick={asignarAgrupador} disabled={!!herr}
                title="Rellena el agrupador del SAT de las cuentas que no lo tienen, heredándolo del padre"
                className="border border-amber-300 text-amber-700 px-3 py-1.5 rounded-lg text-sm hover:bg-amber-50 disabled:opacity-50 flex items-center gap-1.5">
                <Tag size={14} /> {herr === 'agrup' ? 'Asignando…' : 'Asignar agrupador'}
              </button>
              <button onClick={() => setProponer(true)} disabled={!!herr}
                title="Compara el catálogo con el Anexo 24 (por nombre y herencia del padre) y PROPONE el agrupador de las cuentas que no lo tienen, para que lo confirmes"
                className="border border-teal-300 text-teal-700 px-3 py-1.5 rounded-lg text-sm hover:bg-teal-50 disabled:opacity-50 flex items-center gap-1.5">
                <Layers size={14} /> Proponer agrupador (SAT)
              </button>
              <button onClick={() => setAlta({ parentId: null })}
                className="btn-primary flex items-center gap-1.5 text-sm">
                <Plus size={15} /> Nueva cuenta
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Lo que está mal, arriba y antes de que importe ── */}
      {revision?.avisos?.map((a: any, i: number) => (
        <div key={i} className={`rounded border px-3 py-2 text-sm flex items-start gap-2 ${
          a.nivel === 'ERROR'
            ? 'bg-rose-50 border-rose-200 text-rose-800'
            : 'bg-amber-50 border-amber-200 text-amber-900'
        }`}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p>{a.mensaje}</p>
            {a.cuentas?.length > 0 && (
              <p className="text-xs mt-1 opacity-80 break-words">
                {a.cuentas.slice(0, 8).join(' · ')}
                {a.cuentas.length > 8 && ` … y ${a.cuentas.length - 8} más`}
              </p>
            )}
          </div>
        </div>
      ))}

      {revision && revision.errores === 0 && !revision.avisos?.length && (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 flex items-center gap-2">
          <CheckCircle2 size={15} /> El catálogo no tiene errores de estructura.
        </p>
      )}

      {msg && (
        <p className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded px-3 py-2 flex items-center justify-between gap-2">
          <span>{msg}</span>
          <button onClick={() => setMsg('')} className="text-sky-400 hover:text-sky-700"><X size={14} /></button>
        </p>
      )}

      {/* ── Dos paneles: el catálogo (colapsable a un solo renglón) y el análisis ──
          Al colapsar el catálogo, el panel de análisis ocupa toda la pantalla. */}
      <div className={`grid gap-4 items-start ${
        arbolColapsado ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-[1.15fr_0.85fr]'}`}>
        <div className="space-y-3 min-w-0">
          {/* Encabezado: colapsa/expande TODO el catálogo a un solo renglón. */}
          <button
            onClick={() => setArbolColapsado((v) => !v)}
            className="w-full flex items-center gap-2 bg-white border rounded-lg px-3 py-2 text-sm hover:bg-gray-50">
            {arbolColapsado ? <ChevronRight size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
            <BookOpen size={15} className="text-primary" />
            <span className="font-medium text-gray-800">Catálogo de cuentas</span>
            <span className="text-xs text-gray-400">{revision?.total} cuentas</span>
            <span className="ml-auto text-xs text-gray-400">{arbolColapsado ? 'mostrar' : 'ocultar'}</span>
          </button>

          {!arbolColapsado && (
            <>
              {/* ── Buscador ── */}
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Código o nombre…"
                    className="input w-full pl-8"
                  />
                </div>
                <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="input">
                  <option value="">Todos los tipos</option>
                  {Object.keys(TIPO_COLOR).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {/* El import HEREDA el agrupador del padre para las cuentas que no
                    lo traen; esto lista las que quedaron de movimiento SIN agrupador
                    del SAT, para revisarlas o borrarlas. */}
                <button
                  onClick={() => setSoloSinAgrupador((v) => !v)}
                  title="Sólo cuentas de movimiento sin código agrupador del SAT"
                  className={`border px-3 rounded-lg text-sm flex items-center gap-1.5 ${
                    soloSinAgrupador ? 'bg-amber-100 border-amber-300 text-amber-800' : 'hover:bg-gray-50 text-gray-600'}`}>
                  <AlertTriangle size={14} /> Sin agrupador
                </button>
                {/* Rubro del código ≠ rubro del agrupador (mal capturadas, como
                    «Uber» código 1… con agrupador 201.01). Para hallarlas y borrarlas. */}
                <button
                  onClick={() => setSoloMalCapturadas((v) => !v)}
                  title="Cuentas cuyo rubro del código no coincide con el del agrupador del SAT"
                  className={`border px-3 rounded-lg text-sm flex items-center gap-1.5 ${
                    soloMalCapturadas ? 'bg-rose-100 border-rose-300 text-rose-800' : 'hover:bg-gray-50 text-gray-600'}`}>
                  <AlertTriangle size={14} /> Mal capturadas
                </button>
                {/* Toggle real: el árbol arranca compactado, así que estando colapsado el
                    botón OFRECE expandir; ya expandido, re-colapsa para liberar la pantalla
                    —útil cuando un respaldo trae cientos de subcuentas por cliente. Con una
                    búsqueda activa el árbol se abre solo, así que el toggle se inhabilita. */}
                <button
                  onClick={() => setAbiertos(abiertos.size ? new Set() : new Set(idsConHijos))}
                  disabled={buscando}
                  title={buscando ? 'La búsqueda ya muestra todo abierto' : (abiertos.size ? 'Colapsar todo el catálogo' : 'Expandir todo el catálogo')}
                  className="border px-3 rounded-lg hover:bg-gray-50 text-sm text-gray-600 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                  {abiertos.size ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {abiertos.size ? 'Colapsar todo' : 'Expandir todo'}
                </button>
              </div>

              {puedeEditar && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-gray-500">Formato del código:</span>
                  <input
                    value={mascara}
                    onChange={(e) => setMascara(e.target.value)}
                    placeholder="sin máscara (ej. ##-##-##-##)"
                    className="input w-52 font-mono"
                  />
                  <button onClick={guardarMascara} disabled={guardandoMascara}
                    className="border px-3 py-1 rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-40">
                    {guardandoMascara ? 'Guardando…' : 'Guardar'}
                  </button>
                  <span className="text-gray-400">
                    Ejemplo: <span className="font-mono text-gray-600">{formatCuenta('21030026', mascara)}</span>
                  </span>
                </div>
              )}

              {/* ── El árbol ── */}
              <div className="bg-white rounded-lg shadow border divide-y">
                {filtrado.length > 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50/80 text-[10px] uppercase tracking-wide text-gray-400">
                    <span className="w-[14px] shrink-0" />
                    <span className="flex-1 min-w-0">Cuenta</span>
                    <span className={COL_SAT}>Agrupador</span>
                    <span className={COL_NAT}>Nat</span>
                    <span className={COL_TIPO}>Tipo</span>
                    <span className={COL_ACC} />
                  </div>
                )}
                {filtrado.length === 0 && (
                  <p className="p-6 text-center text-gray-500 text-sm">
                    Ninguna cuenta coincide con la búsqueda.
                  </p>
                )}
                {filtrado.map((n: any) => (
                  <Rama key={n.id} nodo={n} nivel={0} mascara={mascara}
                    abiertos={abiertos} buscando={buscando}
                    onAlternar={alternar} onDetalle={setDetalle}
                    onAgregar={puedeEditar ? (p: any) => setAlta({ parentId: p.id, padre: p }) : undefined}
                    onEliminar={puedeEditar ? eliminar : undefined} />
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── El área de análisis (pestañas) ── */}
        <PanelAnalisis />
      </div>

      {detalle && (
        <PanelCuenta id={detalle} onCerrar={() => setDetalle(null)}
          puedeEditar={puedeEditar} onListo={refrescar}
          onAgregarHija={(padre: any) => { setDetalle(null); setAlta({ parentId: padre.id, padre }); }} />
      )}
      {alta && (
        <ModalNuevaCuenta datos={alta} onCerrar={() => setAlta(null)}
          onListo={() => { setAlta(null); refrescar(); }} />
      )}
      {proponer && (
        <ModalProponerAgrupador mascara={mascara}
          onCerrar={() => setProponer(false)} onListo={refrescar} />
      )}
    </div>
  );
}

/* ═══════════ ÁREA DE ANÁLISIS (RESPALDO + CATÁLOGOS) ═══════════ */

const money = (n: any) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);

const CONF_COLOR: Record<string, string> = {
  ALTA:      'bg-emerald-100 text-emerald-800',
  MEDIA:     'bg-sky-100 text-sky-800',
  BAJA:      'bg-amber-100 text-amber-800',
  CONFLICTO: 'bg-rose-100 text-rose-800',
  NINGUNA:   'bg-gray-200 text-gray-700',
};

/**
 * El área de análisis del catálogo. UNA sola subida —la balanza / respaldo
 * contable de un cliente— alimenta las dos pestañas: al leerla, el backend ya
 * devuelve tanto su revisión (cuadre, niveles, avisos) como el acomodo de cada
 * cuenta ajena sobre el Anexo 24. No guarda nada: es el paso previo a decidir.
 * Pensado para crecer: una pestaña más es una entrada más en `PESTANAS`.
 */
function PanelAnalisis() {
  const [pestana, setPestana] = useState<'respaldo' | 'catalogos'>('respaldo');
  const [res, setRes] = useState<any>(null);
  const [nombre, setNombre] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  const analizar = async (file: File) => {
    setError(''); setCargando(true); setNombre(file.name); setRes(null);
    try {
      const fd = new FormData();
      fd.append('archivo', file);
      const r: any = await api.analizarBalanzaRespaldo(fd);
      setRes(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || 'No se pudo leer el archivo.');
    } finally { setCargando(false); }
  };

  const PESTANAS: Array<{ id: 'respaldo' | 'catalogos'; nombre: string; icono: any }> = [
    { id: 'respaldo',  nombre: 'Respaldo de balanza', icono: Scale },
    { id: 'catalogos', nombre: 'Catálogos',           icono: Layers },
  ];

  return (
    <div className="bg-white rounded-lg shadow border flex flex-col xl:sticky xl:top-4 min-h-[420px]">
      <div className="flex border-b text-sm">
        {PESTANAS.map((p) => {
          const Ico = p.icono;
          return (
            <button key={p.id} onClick={() => setPestana(p.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 border-b-2 -mb-px ${
                pestana === p.id
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              <Ico size={14} /> {p.nombre}
            </button>
          );
        })}
      </div>

      {/* Una subida sirve a las dos pestañas. */}
      <div className="p-3 border-b bg-gray-50/60">
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
          <input type="file" accept=".xlsx,.xls,.pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) analizar(f); e.currentTarget.value = ''; }} />
          <span className="inline-flex items-center gap-1.5 border rounded-lg px-3 py-1.5 bg-white hover:bg-gray-50 hover:text-primary">
            <Upload size={14} /> Subir balanza / respaldo
          </span>
          <span className="text-xs text-gray-400 truncate min-w-0">{nombre || '.xlsx o .pdf — no se guarda nada'}</span>
        </label>
      </div>

      <div className="p-4 flex-1 overflow-auto max-h-[72vh]">
        {cargando && (
          <p className="text-sm text-gray-500 flex items-center gap-2">
            <Loader2 size={15} className="animate-spin" /> Leyendo y revisando…
          </p>
        )}
        {error && (
          <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</p>
        )}
        {!res && !cargando && !error && <Vacio pestana={pestana} />}
        {res && !cargando && pestana === 'respaldo'  && <VistaRespaldo res={res} />}
        {res && !cargando && pestana === 'catalogos' && <VistaCatalogos res={res} />}
      </div>
    </div>
  );
}

function Vacio({ pestana }: any) {
  const Ico = pestana === 'respaldo' ? Scale : Layers;
  return (
    <div className="text-center text-gray-500 text-sm py-10 px-4">
      <Ico size={28} className="mx-auto text-gray-300 mb-2" />
      {pestana === 'respaldo' ? (
        <>
          <p className="font-medium text-gray-600">Análisis del respaldo de un cliente</p>
          <p className="mt-1">Sube la balanza (Excel o PDF) de la historia contable del cliente:
          te dice si <b>cuadra</b>, cuántas cuentas y niveles trae y qué revisar — sin guardar nada.
          Es el paso previo a la póliza de apertura.</p>
        </>
      ) : (
        <>
          <p className="font-medium text-gray-600">Empatar su catálogo con el SAT</p>
          <p className="mt-1">De la misma balanza se propone dónde cae cada cuenta ajena sobre el
          catálogo del Anexo 24, marcando lo dudoso para confirmarlo a mano.</p>
        </>
      )}
    </div>
  );
}

function VistaRespaldo({ res }: any) {
  const a = res.analisis || {};
  const enc = res.encabezado || {};
  return (
    <div className="space-y-4 text-sm">
      {(enc.razonSocial || enc.rfc || enc.periodo) && (
        <div className="text-xs text-gray-500">
          {enc.razonSocial && <span className="font-medium text-gray-700">{enc.razonSocial}</span>}
          {enc.rfc && <span className="ml-2 font-mono">{enc.rfc}</span>}
          {enc.periodo && <span className="ml-2">· {enc.periodo}</span>}
          <span className="ml-2 uppercase">· {res.origen}</span>
        </div>
      )}

      <div className={`rounded-lg border px-3 py-2 flex items-center gap-2 ${
        a.cuadra ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                 : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
        {a.cuadra ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
        <span className="font-medium">{a.cuadra ? 'La balanza cuadra' : 'La balanza NO cuadra'}</span>
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <Mini r="Cuentas de detalle" v={a.hojas} />
        <Mini r="Cuentas sumarias" v={a.sumarias} />
        <Mini r="Suma debe" v={money(a.sumaDebe)} />
        <Mini r="Suma haber" v={money(a.sumaHaber)} />
        <Mini r="Activo" v={money(a.activo)} />
        <Mini r="Pasivo + Cap. + Res." v={money(a.pasivoCapitalResultado)} />
      </dl>
      {Math.abs(Number(a.diferenciaEcuacion)) > 0.005 && (
        <p className="text-xs text-rose-700">Diferencia en la ecuación contable: {money(a.diferenciaEcuacion)}</p>
      )}

      {(a.porTipo || []).length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Por tipo</h4>
          <table className="w-full text-xs">
            <tbody>
              {a.porTipo.map((t: any) => (
                <tr key={t.tipo} className="border-b last:border-0">
                  <td className="py-1"><span className={`px-1.5 py-0.5 rounded ${TIPO_COLOR[t.tipo] || ''}`}>{t.tipo}</span></td>
                  <td className="py-1 text-right text-gray-500">{t.cuentas} ctas</td>
                  <td className="py-1 text-right font-mono">{money(t.saldoFinal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(a.avisos || []).length > 0 && (
        <div className="space-y-1.5">
          {a.avisos.map((av: any, i: number) => (
            <div key={i} className={`rounded border px-2.5 py-1.5 text-xs flex items-start gap-1.5 ${
              av.nivel === 'ERROR' ? 'bg-rose-50 border-rose-200 text-rose-800'
                                   : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p>{av.mensaje}</p>
                {av.detalle?.length > 0 && (
                  <p className="opacity-75 mt-0.5 break-words">
                    {av.detalle.slice(0, 6).join(' · ')}{av.detalle.length > 6 ? ' …' : ''}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {res.filasOmitidas > 0 && (
        <p className="text-xs text-gray-400">Balanza grande: {res.filasOmitidas} renglones; se muestra el resumen.</p>
      )}
    </div>
  );
}

function VistaCatalogos({ res }: any) {
  const mascara = useMascara();
  const rm = res.resumenMapeo || {};
  const filas: any[] = res.mapeo || res.porRevisar || [];
  if (!filas.length && !rm.total) {
    return <p className="text-sm text-gray-500">La balanza no trae cuentas que empatar.</p>;
  }
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Chip n={rm.mapeadas} t={`de ${rm.total} acomodadas`} c="bg-gray-100 text-gray-700" />
        {rm.alta > 0 && <Chip n={rm.alta} t="alta" c={CONF_COLOR.ALTA} />}
        {rm.media > 0 && <Chip n={rm.media} t="media" c={CONF_COLOR.MEDIA} />}
        {rm.baja > 0 && <Chip n={rm.baja} t="baja" c={CONF_COLOR.BAJA} />}
        {rm.conflicto > 0 && <Chip n={rm.conflicto} t="conflicto" c={CONF_COLOR.CONFLICTO} />}
        {rm.ninguna > 0 && <Chip n={rm.ninguna} t="sin empate" c={CONF_COLOR.NINGUNA} />}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 text-[10px] uppercase">
              <th className="text-left font-medium py-1">Cuenta del cliente</th>
              <th className="text-left font-medium py-1">→ SAT</th>
              <th className="text-left font-medium py-1">Conf.</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((p: any, i: number) => (
              <tr key={i} className="border-b last:border-0 align-top">
                <td className="py-1 pr-2">
                  <span className="font-mono text-gray-800">{formatCuenta(p.cuenta, mascara)}</span>
                  <span className="text-gray-500 ml-1.5">{p.nombre}</span>
                </td>
                <td className="py-1 pr-2">
                  {p.agrupador
                    ? <span className="font-mono text-gray-700">{p.agrupador}{p.agrupadorNombre ? ` · ${p.agrupadorNombre}` : ''}</span>
                    : <span className="text-gray-400">—</span>}
                </td>
                <td className="py-1">
                  <span className={`px-1.5 py-0.5 rounded ${CONF_COLOR[p.confianza] || ''}`} title={p.razon}>
                    {p.confianza}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {res.filasOmitidas > 0 && (
        <p className="text-xs text-gray-400">
          La balanza es grande: se listan las {(res.porRevisar || []).length} cuentas por revisar.
        </p>
      )}
      <p className="text-[11px] text-gray-400">
        El empate es una propuesta; cada cuenta se confirma en su detalle (Equivalencias).
      </p>
    </div>
  );
}

function Mini({ r, v }: any) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-gray-500">{r}</dt>
      <dd className="text-gray-900 font-medium">{v}</dd>
    </div>
  );
}

function Chip({ n, t, c }: any) {
  return <span className={`px-1.5 py-0.5 rounded ${c}`}><b>{n}</b> {t}</span>;
}

/* ═══════════ UNA RAMA DEL ÁRBOL ═══════════ */

function Rama({ nodo, nivel, abiertos, buscando, onAlternar, onDetalle, onAgregar, onEliminar, mascara }: any) {
  const hijos = nodo.hijosLista || [];
  /* Al buscar se abre todo: si el resultado quedara colapsado habría que ir
     destapando ramas para ver lo que ya se encontró. */
  const abierto = buscando || abiertos.has(nodo.id);

  return (
    <>
      <div
        className={`flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 ${
          !nodo.activa ? 'opacity-50' : ''
        }`}
        style={{ paddingLeft: 12 + nivel * 18 }}
      >
        {hijos.length > 0 ? (
          <button onClick={() => onAlternar(nodo.id)} className="text-gray-400 hover:text-gray-700">
            {abierto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : <span className="w-[14px]" />}

        <button onClick={() => onDetalle(nodo.id)}
          className="flex-1 min-w-0 flex items-baseline gap-2 text-left">
          <span className="font-mono text-xs text-gray-900 shrink-0">{formatCuenta(nodo.codigo, mascara)}</span>
          <span className="text-sm text-gray-700 truncate">{nodo.nombre}</span>
          {/* Distintivos que describen a la cuenta (raros): van con el nombre, no en
              las columnas, para no romper la alineación del agrupador y la naturaleza. */}
          {nodo.es_complementaria && (
            <span title="Cuenta complementaria: RESTA del rubro que corrige"
              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 shrink-0">−</span>
          )}
          {nodo.nif_norma && (
            <span title={nodo.nif_titulo}
              className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 font-medium shrink-0">
              {nodo.nif_norma}
            </span>
          )}
        </button>

        {/* ── Columnas FIJAS: agrupador SAT y naturaleza siempre en la misma posición ── */}
        <span className={`${COL_SAT} font-mono text-[10px]`}>
          {nodo.codigo_agrupador ? (
            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{nodo.codigo_agrupador}</span>
          ) : nodo.permite_movimientos ? (
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">sin</span>
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </span>
        <span className={`${COL_NAT} text-[11px] font-medium`}
          title={nodo.naturaleza === 'DEUDORA' ? 'Deudora' : 'Acreedora'}>
          <span className={nodo.naturaleza === 'DEUDORA' ? 'text-sky-600' : 'text-violet-600'}>
            {nodo.naturaleza === 'DEUDORA' ? 'D' : 'A'}
          </span>
        </span>
        <span className={COL_TIPO}>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${TIPO_COLOR[nodo.tipo] || ''}`}>
            {nodo.tipo}
          </span>
        </span>
        <div className={`${COL_ACC} flex items-center justify-end gap-1`}>
          {onAgregar && (
            <button onClick={() => onAgregar(nodo)} title="Agregar subcuenta"
              className="text-gray-300 hover:text-primary">
              <Plus size={13} />
            </button>
          )}
          {/* Borrar sólo en hojas: una cuenta con subcuentas se limpia de abajo
              hacia arriba, para no tirar un grupo entero por error. */}
          {onEliminar && hijos.length === 0 && (
            <button onClick={() => onEliminar(nodo)} title="Borrar cuenta"
              className="text-gray-300 hover:text-rose-600">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {abierto && hijos.map((h: any) => (
        <Rama key={h.id} nodo={h} nivel={nivel + 1} mascara={mascara}
          abiertos={abiertos} buscando={buscando}
          onAlternar={onAlternar} onDetalle={onDetalle} onAgregar={onAgregar} onEliminar={onEliminar} />
      ))}
    </>
  );
}

/* ═══════════ PANEL DE UNA CUENTA ═══════════ */

function PanelCuenta({ id, onCerrar, puedeEditar, onListo, onAgregarHija }: any) {
  const qc = useQueryClient();
  const [cat, setCat] = useState('');
  const [cod, setCod] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ codigo: '', nombre: '', moneda: 'MXN', codigoAgrupador: '' });

  const q = useQuery({ queryKey: ['cuenta', id], queryFn: () => api.getCuentaContable(id) });
  const cuenta = q.data?.data?.cuenta;
  const equivalencias: any[] = q.data?.data?.equivalencias || [];

  const abrirEdicion = () => {
    setForm({
      codigo: cuenta?.codigo || '',
      nombre: cuenta?.nombre || '',
      moneda: cuenta?.moneda || 'MXN',
      codigoAgrupador: cuenta?.codigo_agrupador || '',
    });
    setError(''); setEditando(true);
  };
  const guardarCambios = async () => {
    setError(''); setBusy(true);
    try {
      await api.actualizarCuentaContable(id, {
        codigo: form.codigo.trim(),
        nombre: form.nombre.trim(),
        moneda: form.moneda.trim() || 'MXN',
        codigoAgrupador: form.codigoAgrupador.trim() || null,
      });
      qc.invalidateQueries({ queryKey: ['cuenta', id] });
      setEditando(false);
      onListo();
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  const guardarEquivalencia = async () => {
    setError(''); setBusy(true);
    try {
      await api.fijarEquivalenciaCuenta(id, { catalogo: cat, codigoExterno: cod });
      setCat(''); setCod('');
      qc.invalidateQueries({ queryKey: ['cuenta', id] });
      onListo();
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex justify-end z-50" onClick={onCerrar}>
      <div className="bg-white w-full max-w-md h-full overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-4 border-b sticky top-0 bg-white">
          <div className="min-w-0">
            <p className="font-mono text-xs text-gray-500">{cuenta?.codigo}</p>
            <h3 className="font-semibold text-gray-900">{cuenta?.nombre}</h3>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        {q.isLoading && <p className="p-4 text-gray-500">Cargando…</p>}

        {cuenta && (
          <div className="p-4 space-y-5">
            {puedeEditar && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => onAgregarHija?.(cuenta)}
                  className="flex items-center gap-1.5 text-sm border rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50">
                  <Plus size={14} className="text-primary" /> Agregar subcuenta
                </button>
                {!editando && (
                  <button onClick={abrirEdicion}
                    className="flex items-center gap-1.5 text-sm border rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50">
                    <Pencil size={14} /> Editar
                  </button>
                )}
              </div>
            )}

            {editando ? (
              <div className="space-y-3 border rounded-lg p-3 bg-gray-50">
                <label className="block">
                  <span className="text-[11px] text-gray-600">Número de cuenta</span>
                  <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                    className="input w-full text-sm font-mono" placeholder="1-10-25-076" />
                  <span className="text-[10px] text-gray-400">Cambia el número de ESTA cuenta (no renumera sus subcuentas). Las pólizas la siguen.</span>
                </label>
                <label className="block">
                  <span className="text-[11px] text-gray-600">Nombre</span>
                  <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                    className="input w-full text-sm" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[11px] text-gray-600">Moneda</span>
                    <input value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value.toUpperCase().slice(0, 3) })}
                      className="input w-full text-sm font-mono" placeholder="MXN" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-gray-600">Agrupador SAT</span>
                    <input list="agrup-sat" value={form.codigoAgrupador} onChange={(e) => setForm({ ...form, codigoAgrupador: e.target.value })}
                      className="input w-full text-sm font-mono" placeholder="opcional" />
                  </label>
                </div>
                <p className="text-[11px] text-gray-500">El tipo y la naturaleza no se editan: los hereda del padre y cambiarlos descuadraría la balanza.</p>
                <div className="flex gap-2">
                  <button onClick={guardarCambios} disabled={busy || !form.nombre.trim()}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm px-4 py-1.5 rounded-lg disabled:opacity-50">{busy ? 'Guardando…' : 'Guardar'}</button>
                  <button onClick={() => setEditando(false)}
                    className="border border-sky-300 text-sky-700 hover:bg-sky-50 font-medium text-sm px-4 py-1.5 rounded-lg">Cancelar</button>
                </div>
                {error && <p className="text-xs text-rose-700">{error}</p>}
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Dato r="Tipo" v={cuenta.tipo} />
                <Dato r="Naturaleza" v={cuenta.naturaleza} />
                <Dato r="Nivel" v={cuenta.nivel} />
                <Dato r="Movimientos" v={cuenta.permite_movimientos ? 'Sí' : 'No (tiene subcuentas)'} />
                <Dato r="Código agrupador SAT" v={cuenta.codigo_agrupador || '— sin mapear —'} />
                <Dato r="Moneda" v={cuenta.moneda} />
              </dl>
            )}

            {cuenta.es_complementaria && (
              <p className="text-xs text-slate-700 bg-slate-100 rounded px-3 py-2">
                <b>Cuenta complementaria.</b> Resta del rubro que corrige — por eso su
                naturaleza es contraria a la de su tipo, y no es un error.
              </p>
            )}

            {cuenta.nif_norma && (
              <div className="bg-teal-50 border border-teal-200 rounded px-3 py-2">
                <p className="text-xs font-semibold text-teal-900 flex items-center gap-1.5">
                  <Info size={13} /> NIF {cuenta.nif_norma} — {cuenta.nif_titulo}
                </p>
                {cuenta.nif_resumen && (
                  <p className="text-xs text-teal-800 mt-1">{cuenta.nif_resumen}</p>
                )}
              </div>
            )}

            {/* ── El empate con otros catálogos ── */}
            <div>
              <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5 mb-2">
                <Link2 size={14} /> Equivalencias
              </h4>
              {equivalencias.length === 0 && (
                <p className="text-xs text-gray-500 mb-2">
                  Sin equivalencias. Aquí se registra cómo se llama esta cuenta en el
                  catálogo del despacho o de otra empresa, sin re-numerar nada.
                </p>
              )}
              <ul className="space-y-1 mb-2">
                {equivalencias.map((e) => (
                  <li key={e.id} className="text-xs flex items-baseline gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-medium">
                      {e.catalogo}
                    </span>
                    <span className="font-mono">{e.codigo_externo}</span>
                    {e.descripcion_externa && (
                      <span className="text-gray-500 truncate">{e.descripcion_externa}</span>
                    )}
                  </li>
                ))}
              </ul>

              {puedeEditar && (
                <div className="flex gap-1.5">
                  <input value={cat} onChange={(e) => setCat(e.target.value)}
                    placeholder="Catálogo" className="input text-xs flex-1" />
                  <input value={cod} onChange={(e) => setCod(e.target.value)}
                    placeholder="Código" className="input text-xs flex-1 font-mono" />
                  <button onClick={guardarEquivalencia}
                    disabled={busy || !cat.trim() || !cod.trim()}
                    className="btn-primary text-xs px-3 disabled:opacity-50">
                    Fijar
                  </button>
                </div>
              )}
              {error && <p className="text-xs text-rose-700 mt-1.5">{error}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Dato({ r, v }: any) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-gray-500">{r}</dt>
      <dd className="text-gray-900">{v}</dd>
    </div>
  );
}

/* ═══════════ PROPONER AGRUPADOR (comparar con el SAT) ═══════════ */

const CONF_PROP: Record<string, string> = {
  ALTA: 'bg-emerald-100 text-emerald-800',
  MEDIA: 'bg-sky-100 text-sky-800',
  BAJA: 'bg-amber-100 text-amber-800',
};

function ModalProponerAgrupador({ mascara, onCerrar, onListo }: any) {
  const [cargando, setCargando] = useState(true);
  const [resumen, setResumen] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [aplicando, setAplicando] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setCargando(true); setError('');
      try {
        const r: any = await api.proponerAgrupadores();
        const d = r?.data || {};
        setResumen(d.resumen || null);
        // ALTA y MEDIA vienen marcadas; BAJA se deja para que la revise el usuario.
        setRows((d.propuestas || []).map((p: any) => ({
          ...p, sel: p.confianza === 'ALTA' || p.confianza === 'MEDIA', agr: p.agrupador || '',
        })));
      } catch (e: any) {
        setError(e?.response?.data?.message || 'No se pudieron generar las propuestas.');
      } finally { setCargando(false); }
    })();
  }, []);

  const seleccionadas = rows.filter((r) => r.sel && r.agr.trim());
  const toggle = (i: number) => setRows((rs) => rs.map((r, k) => k === i ? { ...r, sel: !r.sel } : r));
  const editar = (i: number, v: string) => setRows((rs) => rs.map((r, k) => k === i ? { ...r, agr: v } : r));
  const marcarTodas = (v: boolean) => setRows((rs) => rs.map((r) => ({ ...r, sel: v })));

  const aplicar = async () => {
    setAplicando(true); setMsg(''); setError('');
    try {
      const items = seleccionadas.map((r) => ({ id: r.id, codigo: r.codigo, agrupador: r.agr.trim() }));
      const r: any = await api.aplicarAgrupadores(items);
      const errs: string[] = r?.data?.errores || [];
      setMsg(r?.message || 'Agrupadores aplicados.');
      if (errs.length) setError('Errores: ' + errs.slice(0, 5).join(' · '));
      // Quita de la lista las aplicadas sin error (para ver lo que queda).
      const conError = new Set(errs.map((e) => e.split(':')[0]));
      const idsMandados = new Set(items.map((x) => x.id));
      setRows((rs) => rs.filter((r) => !idsMandados.has(r.id) || conError.has(r.codigo)));
      onListo?.();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo aplicar.');
    } finally { setAplicando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCerrar}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Layers size={16} className="text-teal-600" /> Proponer agrupador SAT
            </h3>
            <p className="text-xs text-gray-500 mt-0.5 max-w-xl">
              Compara el catálogo con el Anexo 24: resuelve las cuentas de agrupación por su
              nombre y las subcuentas heredan de su padre. Revisa, corrige y aplica lo que confirmes.
            </p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        {cargando ? (
          <p className="p-6 text-sm text-gray-500 flex items-center gap-2">
            <Loader2 size={15} className="animate-spin" /> Analizando el catálogo…
          </p>
        ) : (
          <>
            {resumen && (
              <div className="px-4 py-2 border-b text-xs flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-600">
                <span><b>{resumen.sinAgrupador}</b> sin agrupador</span>
                <span className="text-emerald-700">{resumen.alta} alta</span>
                <span className="text-sky-700">{resumen.media} media</span>
                <span className="text-amber-700">{resumen.baja} baja</span>
                {resumen.sinPropuesta > 0 && <span className="text-gray-400">{resumen.sinPropuesta} sin propuesta (a mano)</span>}
                <span className="ml-auto flex gap-2">
                  <button onClick={() => marcarTodas(true)} className="underline hover:text-gray-800">Todas</button>
                  <button onClick={() => marcarTodas(false)} className="underline hover:text-gray-800">Ninguna</button>
                </span>
              </div>
            )}
            {error && <p className="mx-4 mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</p>}
            {msg && <p className="mx-4 mt-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">{msg}</p>}

            <div className="overflow-auto flex-1 p-4">
              {rows.length === 0 ? (
                <p className="text-sm text-gray-500">
                  {msg ? 'No queda ninguna propuesta pendiente.' : 'No hay propuestas: ninguna cuenta sin agrupador pudo empatarse por nombre/herencia.'}
                  {resumen?.sinPropuesta ? ' Las que quedan sin propuesta hay que revisarlas a mano.' : ''}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-2 py-2 w-8"></th>
                      <th className="px-2 py-2 text-left text-xs font-semibold">Cuenta</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold">Nombre</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold">Agrupador propuesto</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold">Conf.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r, i) => (
                      <tr key={r.id} className={`hover:bg-gray-50 ${r.sel ? '' : 'opacity-60'}`}>
                        <td className="px-2 py-1.5 text-center">
                          <input type="checkbox" checked={r.sel} onChange={() => toggle(i)} />
                        </td>
                        <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">{formatCuenta(r.codigo, mascara)}</td>
                        <td className="px-2 py-1.5 text-xs">{r.nombre}</td>
                        <td className="px-2 py-1.5">
                          <input list="agrup-sat" value={r.agr} onChange={(e) => editar(i, e.target.value)}
                            className="input text-xs font-mono w-28" />
                          {r.agrupadorNombre && <span className="text-[10px] text-gray-400 ml-1.5">{r.agrupadorNombre}</span>}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${CONF_PROP[r.confianza] || ''}`} title={r.razon}>
                            {r.confianza}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="p-4 border-t flex items-center justify-end gap-2">
              <button onClick={onCerrar} className="btn-secondary text-sm">Cerrar</button>
              <button onClick={aplicar} disabled={aplicando || seleccionadas.length === 0}
                className="btn-primary text-sm disabled:opacity-50">
                {aplicando ? 'Aplicando…' : `Aplicar seleccionadas (${seleccionadas.length})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════ ALTA ═══════════ */

function ModalNuevaCuenta({ datos, onCerrar, onListo }: any) {
  const [f, setF] = useState({
    codigo: datos.padre ? `${datos.padre.codigo}.` : '',
    nombre: '',
    tipo: datos.padre?.tipo || 'ACTIVO',
    naturaleza: datos.padre?.naturaleza || 'DEUDORA',
    codigoAgrupador: '',
    moneda: datos.padre?.moneda || 'MXN',
    requiereTercero: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const guardar = async () => {
    setError(''); setBusy(true);
    try {
      await api.crearCuentaContable({ ...f, parentId: datos.parentId });
      onListo();
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-gray-900">
            {datos.padre ? `Subcuenta de ${datos.padre.codigo}` : 'Nueva cuenta'}
          </h3>
          {datos.padre && (
            <p className="text-xs text-gray-500 mt-0.5">
              Hereda tipo y naturaleza de {datos.padre.nombre}.
            </p>
          )}
        </div>

        <div className="p-4 space-y-3">
          <label className="block">
            <span className="text-xs text-gray-600">Código *</span>
            <input value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })}
              className="input w-full font-mono" placeholder="102.03" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-600">Nombre *</span>
            <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })}
              className="input w-full" />
          </label>

          {!datos.padre && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-gray-600">Tipo</span>
                <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}
                  className="input w-full">
                  {Object.keys(TIPO_COLOR).map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-gray-600">Naturaleza</span>
                <select value={f.naturaleza}
                  onChange={(e) => setF({ ...f, naturaleza: e.target.value })}
                  className="input w-full">
                  <option>DEUDORA</option><option>ACREEDORA</option>
                </select>
              </label>
            </div>
          )}

          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <label className="block">
              <span className="text-xs text-gray-600">Código agrupador SAT</span>
              <input list="agrup-sat" value={f.codigoAgrupador}
                onChange={(e) => setF({ ...f, codigoAgrupador: e.target.value })}
                className="input w-full font-mono" placeholder="102.01" />
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">Moneda</span>
              <input value={f.moneda}
                onChange={(e) => setF({ ...f, moneda: e.target.value.toUpperCase().slice(0, 3) })}
                className="input w-full font-mono" placeholder="MXN" />
            </label>
          </div>
          <span className="text-[11px] text-gray-500 -mt-2 block">
            El agrupador se valida contra el Anexo 24 al guardar. La subcuenta hereda
            tipo y naturaleza del padre.
          </span>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.requiereTercero}
              onChange={(e) => setF({ ...f, requiereTercero: e.target.checked })} />
            Exigir cliente/proveedor en cada movimiento
          </label>

          {error && (
            <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onCerrar}
            className="border border-sky-300 text-sky-700 hover:bg-sky-50 font-medium text-sm px-4 py-1.5 rounded-lg">Cancelar</button>
          <button onClick={guardar} disabled={busy || !f.codigo.trim() || !f.nombre.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm px-4 py-1.5 rounded-lg disabled:opacity-50">
            {busy ? 'Guardando…' : 'Crear cuenta'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════ SIN CATÁLOGO TODAVÍA ═══════════ */

function SinCatalogo({ onListo }: any) {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState<'' | 'semilla' | 'txt'>('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const arrancar = async () => {
    setError(''); setMsg(''); setBusy('semilla');
    try {
      await api.sembrarReferenciasContables();
      const r = await api.activarContabilidad({ anio });
      setMsg(r.message || 'Listo.');
      onListo();
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message);
    } finally { setBusy(''); }
  };

  /* Arranca la contabilidad con el catálogo REAL de CONTPAQi (TXT):
     crea el ejercicio y los doce periodos SIN catálogo semilla, y luego
     importa las cuentas del archivo con su jerarquía y agrupador del SAT. */
  const importarTxt = async (file: File) => {
    setError(''); setMsg(''); setBusy('txt');
    try {
      await api.sembrarReferenciasContables();
      await api.activarContabilidad({ anio, sembrarCatalogo: false });
      const fd = new FormData(); fd.append('archivo', file);
      const r: any = await api.importarCatalogoTxt(fd);
      let m = r?.message || 'Catálogo importado.';
      if (r?.data?.errores?.length) m += ` Errores: ${r.data.errores.slice(0, 3).join(' · ')}${r.data.errores.length > 3 ? '…' : ''}.`;
      setMsg(m);
      onListo();
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message);
    } finally { setBusy(''); }
  };

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Contabilidad</h1>
      <p className="text-sm text-gray-600 mb-4">
        Esta empresa todavía no tiene catálogo de cuentas. Al arrancar se crea el
        ejercicio con sus doce periodos y el catálogo semilla con la numeración
        del Anexo 24 — que después se puede re-numerar sin perder la equivalencia
        con el SAT.
      </p>

      <label className="block mb-3">
        <span className="text-xs text-gray-600">Ejercicio</span>
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="input w-32">
          {aniosContables().map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>

      {error && (
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 mb-3">
          {error}
        </p>
      )}
      {msg && (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 mb-3">
          {msg}
        </p>
      )}

      <label
        title="Importa el catálogo del SAT desde el TXT de CONTPAQi: crea el ejercicio, los doce periodos y las cuentas con su jerarquía, naturaleza y agrupador del SAT"
        className={`block mb-4 border-2 border-dashed border-violet-300 bg-violet-50 rounded-lg px-4 py-3 cursor-pointer hover:bg-violet-100 ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center gap-2 text-violet-800 font-medium text-sm">
          <Upload size={16} /> {busy === 'txt' ? 'Importando catálogo…' : 'Importar catálogo CONTPAQi (.txt)'}
        </div>
        <p className="text-xs text-violet-700 mt-1">
          Recomendado si vienes de CONTPAQi. Arranca la contabilidad del ejercicio {anio} con
          TU catálogo (no el semilla) y su agrupador del SAT.
        </p>
        <input type="file" accept=".txt" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importarTxt(f); e.currentTarget.value = ''; }} />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={arrancar} disabled={!!busy} className="btn-primary disabled:opacity-50">
          {busy === 'semilla' ? 'Preparando…' : 'Arrancar con catálogo semilla'}
        </button>
        <button onClick={() => api.descargarPlantillaCatalogo().catch(() => {})}
          title="Descarga una plantilla en blanco para armar tu catálogo desde cero en Excel"
          className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1.5">
          <Download size={15} /> Descargar plantilla
        </button>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        ¿Vienes de otro sistema? Importa el catálogo en TXT (arriba), tu respaldo en <a href="/contabilidad/importar-contpaqi" className="text-primary hover:underline">Importar respaldo</a>,
        o arma el catálogo con la plantilla y luego asígnale el agrupador SAT.
      </p>
    </div>
  );
}

export default CatalogoCuentasPage;
