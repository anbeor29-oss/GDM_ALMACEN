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
import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, ChevronDown, Search, Plus, AlertTriangle, CheckCircle2,
  Link2, BookOpen, X, Info,
} from 'lucide-react';
import api from '@/services/api';
import { useCapacidades, CAP } from '@/utils/capacidades';

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

export function CatalogoCuentasPage() {
  const qc = useQueryClient();
  const { puede } = useCapacidades();
  const puedeEditar = puede(CAP.ctaCatalogo);

  const [busqueda, setBusqueda] = useState('');
  const [tipo, setTipo] = useState('');
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [detalle, setDetalle] = useState<any>(null);
  const [alta, setAlta] = useState<any>(null);

  const arbolQ = useQuery({
    queryKey: ['cuentas-arbol'],
    queryFn: () => api.getArbolDeCuentas(),
  });
  const revisionQ = useQuery({
    queryKey: ['cuentas-revision'],
    queryFn: () => api.getRevisionCatalogo(),
  });

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
    if (!b && !tipo) return arbol;

    const coincide = (n: any): boolean =>
      (!tipo || n.tipo === tipo) &&
      (!b || n.codigo.toLowerCase().includes(b) || n.nombre.toLowerCase().includes(b));

    const podar = (n: any): any | null => {
      const hijos = (n.hijosLista || []).map(podar).filter(Boolean);
      if (coincide(n) || hijos.length) return { ...n, hijosLista: hijos };
      return null;
    };
    return arbol.map(podar).filter(Boolean);
  }, [arbol, busqueda, tipo]);

  const buscando = !!busqueda.trim() || !!tipo;

  const alternar = (id: string) => {
    const s = new Set(abiertos);
    s.has(id) ? s.delete(id) : s.add(id);
    setAbiertos(s);
  };

  if (arbolQ.isLoading) {
    return <div className="p-6 text-gray-500">Cargando el catálogo…</div>;
  }

  if (!arbol.length) {
    return <SinCatalogo onListo={refrescar} />;
  }

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen size={22} className="text-primary" /> Catálogo de cuentas
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {revision?.total} cuentas · {revision?.movimiento} admiten movimientos
          </p>
        </div>
        {puedeEditar && (
          <button onClick={() => setAlta({ parentId: null })}
            className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus size={15} /> Nueva cuenta
          </button>
        )}
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

      {/* ── Buscador ── */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
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
        {/* El árbol arranca compactado; esto lo re-colapsa tras explorarlo —útil
            cuando un respaldo trae cientos de subcuentas por cliente. */}
        <button onClick={() => setAbiertos(new Set())} title="Colapsar todo el catálogo"
          className="border px-3 rounded-lg hover:bg-gray-50 text-sm text-gray-600 flex items-center gap-1.5">
          <ChevronRight size={14} /> Colapsar todo
        </button>
      </div>

      {/* ── El árbol ── */}
      <div className="bg-white rounded-lg shadow border divide-y">
        {filtrado.length === 0 && (
          <p className="p-6 text-center text-gray-500 text-sm">
            Ninguna cuenta coincide con la búsqueda.
          </p>
        )}
        {filtrado.map((n: any) => (
          <Rama key={n.id} nodo={n} nivel={0}
            abiertos={abiertos} buscando={buscando}
            onAlternar={alternar} onDetalle={setDetalle}
            onAgregar={puedeEditar ? (p: any) => setAlta({ parentId: p.id, padre: p }) : undefined} />
        ))}
      </div>

      {detalle && (
        <PanelCuenta id={detalle} onCerrar={() => setDetalle(null)}
          puedeEditar={puedeEditar} onListo={refrescar} />
      )}
      {alta && (
        <ModalNuevaCuenta datos={alta} onCerrar={() => setAlta(null)}
          onListo={() => { setAlta(null); refrescar(); }} />
      )}
    </div>
  );
}

/* ═══════════ UNA RAMA DEL ÁRBOL ═══════════ */

function Rama({ nodo, nivel, abiertos, buscando, onAlternar, onDetalle, onAgregar }: any) {
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
          <span className="font-mono text-xs text-gray-900 shrink-0">{nodo.codigo}</span>
          <span className="text-sm text-gray-700 truncate">{nodo.nombre}</span>

          {/* El agrupador, sólo cuando difiere del código propio: mientras sean
              iguales repetirlo en cada renglón es ruido. */}
          {nodo.codigo_agrupador && nodo.codigo_agrupador !== nodo.codigo && (
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0">
              SAT {nodo.codigo_agrupador}
            </span>
          )}
          {!nodo.codigo_agrupador && nodo.permite_movimientos && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">
              sin agrupador
            </span>
          )}
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          {nodo.es_complementaria && (
            <span title="Cuenta complementaria: RESTA del rubro que corrige"
              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">−</span>
          )}
          {nodo.nif_norma && (
            <span title={nodo.nif_titulo}
              className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 font-medium">
              {nodo.nif_norma}
            </span>
          )}
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${TIPO_COLOR[nodo.tipo] || ''}`}>
            {nodo.tipo}
          </span>
          <span className="text-[10px] text-gray-400 w-4 text-center"
            title={nodo.naturaleza === 'DEUDORA' ? 'Deudora' : 'Acreedora'}>
            {nodo.naturaleza === 'DEUDORA' ? 'D' : 'A'}
          </span>
          {onAgregar && (
            <button onClick={() => onAgregar(nodo)} title="Agregar subcuenta"
              className="text-gray-300 hover:text-primary">
              <Plus size={13} />
            </button>
          )}
        </div>
      </div>

      {abierto && hijos.map((h: any) => (
        <Rama key={h.id} nodo={h} nivel={nivel + 1}
          abiertos={abiertos} buscando={buscando}
          onAlternar={onAlternar} onDetalle={onDetalle} onAgregar={onAgregar} />
      ))}
    </>
  );
}

/* ═══════════ PANEL DE UNA CUENTA ═══════════ */

function PanelCuenta({ id, onCerrar, puedeEditar, onListo }: any) {
  const qc = useQueryClient();
  const [cat, setCat] = useState('');
  const [cod, setCod] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const q = useQuery({ queryKey: ['cuenta', id], queryFn: () => api.getCuentaContable(id) });
  const cuenta = q.data?.data?.cuenta;
  const equivalencias: any[] = q.data?.data?.equivalencias || [];

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
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Dato r="Tipo" v={cuenta.tipo} />
              <Dato r="Naturaleza" v={cuenta.naturaleza} />
              <Dato r="Nivel" v={cuenta.nivel} />
              <Dato r="Movimientos" v={cuenta.permite_movimientos ? 'Sí' : 'No (tiene subcuentas)'} />
              <Dato r="Código agrupador SAT" v={cuenta.codigo_agrupador || '— sin mapear —'} />
              <Dato r="Moneda" v={cuenta.moneda} />
            </dl>

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

/* ═══════════ ALTA ═══════════ */

function ModalNuevaCuenta({ datos, onCerrar, onListo }: any) {
  const [f, setF] = useState({
    codigo: datos.padre ? `${datos.padre.codigo}.` : '',
    nombre: '',
    tipo: datos.padre?.tipo || 'ACTIVO',
    naturaleza: datos.padre?.naturaleza || 'DEUDORA',
    codigoAgrupador: '',
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

          <label className="block">
            <span className="text-xs text-gray-600">Código agrupador SAT</span>
            <input value={f.codigoAgrupador}
              onChange={(e) => setF({ ...f, codigoAgrupador: e.target.value })}
              className="input w-full font-mono" placeholder="102.01" />
            <span className="text-[11px] text-gray-500">
              Se valida contra el Anexo 24 al guardar. Hoy la contabilidad es interna,
              pero mapear después —con movimientos encima— cuesta mucho más.
            </span>
          </label>

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
          <button onClick={onCerrar} className="btn-secondary text-sm">Cancelar</button>
          <button onClick={guardar} disabled={busy || !f.codigo.trim() || !f.nombre.trim()}
            className="btn-primary text-sm disabled:opacity-50">
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const arrancar = async () => {
    setError(''); setBusy(true);
    try {
      await api.sembrarReferenciasContables();
      const r = await api.activarContabilidad({ anio });
      setMsg(r.message || 'Listo.');
      onListo();
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message);
    } finally { setBusy(false); }
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
        <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))}
          className="input w-32" />
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

      <button onClick={arrancar} disabled={busy} className="btn-primary disabled:opacity-50">
        {busy ? 'Preparando…' : 'Arrancar contabilidad'}
      </button>
    </div>
  );
}

export default CatalogoCuentasPage;
