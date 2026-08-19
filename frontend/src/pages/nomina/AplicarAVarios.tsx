/**
 * AplicarAVarios — el mismo concepto a media plantilla, de un jalón.
 *
 * POR QUÉ EXISTE
 * Un bono de fin de año, el día del 16 de septiembre, un descuento acordado con
 * el sindicato: le tocan a muchos a la vez. Capturarlos de uno en uno en cien
 * renglones no sólo es lento — es donde se cuelan los errores, porque a la
 * mitad uno pierde la cuenta de a quién ya le tocó.
 *
 * SE ABRE CON CLIC DERECHO sobre la rejilla, que es donde ya está la mano.
 *
 * REEMPLAZA, NO SUMA
 * Si el trabajador ya tenía ese concepto, el importe se sustituye. Aplicarlo
 * dos veces por error dejaría el doble sin que se note; así el resultado es el
 * mismo se aplique una vez o tres.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Users, Check } from 'lucide-react';
import api from '@/services/api';

const money = (v: any) =>
  Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

interface Props {
  periodoId: string;
  /** Los renglones que están en pantalla: es a quienes se les puede aplicar. */
  renglones: any[];
  /** Con quién se abrió el menú, para dejarlo marcado de entrada. */
  empleadoInicial?: string;
  lado: 'ingresos' | 'egresos';
  onCerrar: () => void;
  onAplicado: () => void;
}

export function AplicarAVarios({
  periodoId, renglones, empleadoInicial, lado, onCerrar, onAplicado,
}: Props) {
  const [clave, setClave] = useState('');
  const [importe, setImporte] = useState('');
  const [dias, setDias] = useState('1');
  const [busca, setBusca] = useState('');
  const [elegidos, setElegidos] = useState<Record<string, boolean>>(
    empleadoInicial ? { [empleadoInicial]: true } : {}
  );
  const [aplicando, setAplicando] = useState(false);
  const [error, setError] = useState('');

  /* Las faltas se capturan en DÍAS, no en pesos.
   *
   * Es la única forma correcta de aplicarlas a varios: el mismo día de
   * ausencia le cuesta distinto a cada quien, y un importe fijo le descontaría
   * lo mismo al de $315 diarios que al de $600. El servidor lo convierte con
   * el salario de cada trabajador. */
  const POR_DIAS = new Set(['020']);
  const enDias = lado === 'egresos' && POR_DIAS.has(clave);

  const cat = useQuery({ queryKey: ['nomina-catalogos'], queryFn: () => api.getNominaCatalogos() });
  const catalogo: any[] = lado === 'ingresos'
    ? (cat.data?.data?.percepciones || [])
    : (cat.data?.data?.deducciones || []);

  /* El filtro no toca lo ya marcado: quien elige a tres, escribe para buscar al
   * cuarto y ve desaparecer a los tres pierde el trabajo hecho. */
  const visibles = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return renglones;
    return renglones.filter((r) =>
      `${r.nombre} ${r.num_empleado} ${r.puesto || ''}`.toLowerCase().includes(t)
    );
  }, [renglones, busca]);

  const cuantos = Object.values(elegidos).filter(Boolean).length;
  const total = cuantos * (Number(importe) || 0);

  const marcarVisibles = (v: boolean) => {
    const s = { ...elegidos };
    for (const r of visibles) s[r.empleado_id] = v;
    setElegidos(s);
  };

  const aplicar = async () => {
    setError('');
    const ids = Object.entries(elegidos).filter(([, v]) => v).map(([k]) => k);
    if (!clave) { setError('Elige el concepto'); return; }
    if (!enDias && !(Number(importe) > 0)) {
      setError('El importe tiene que ser mayor que cero'); return;
    }
    if (enDias && !(Number(dias) > 0)) {
      setError('Elige cuántos días faltó'); return;
    }
    if (ids.length === 0) { setError('No marcaste a nadie'); return; }

    setAplicando(true);
    try {
      await api.aplicarConceptoAVarios(periodoId, {
        lado, clave, empleadoIds: ids,
        ...(enDias ? { dias: Number(dias) } : { importe: Number(importe) }),
      });
      onAplicado();
      onCerrar();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo aplicar');
    } finally {
      setAplicando(false);
    }
  };

  const esIngreso = lado === 'ingresos';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl my-8">
        <div className="flex items-start justify-between p-5 border-b">
          <div>
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <Users size={18} className={esIngreso ? 'text-emerald-600' : 'text-rose-600'} />
              Aplicar {esIngreso ? 'un ingreso' : 'un descuento'} a varios
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Si alguien ya tenía este concepto, el importe se reemplaza — aplicarlo
              dos veces no paga doble.
            </p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Concepto</label>
              <select value={clave} onChange={(e) => setClave(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">— Elige —</option>
                {catalogo.map((c: any) => (
                  <option key={c.clave} value={c.clave}>{c.clave} · {c.nombre}</option>
                ))}
              </select>
            </div>
            {enDias ? (
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Días que faltó
                </label>
                <select value={dias} onChange={(e) => setDias(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} día{n > 1 ? 's' : ''}
                      {n === 6 ? ' — la semana completa' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Se descuentan {dias} día(s) <b>más {(Number(dias) / 6).toFixed(2)}</b> del
                  séptimo (Art. 69 LFT): por cada seis de trabajo, uno de descanso.
                  {Number(dias) === 6 && ' Con las seis, no se paga el séptimo día.'}
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-gray-600 mb-1">Importe por trabajador</label>
                <input type="number" min="0" step="0.01" value={importe}
                  onChange={(e) => setImporte(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="0.00" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nombre, número o puesto…"
              className="flex-1 border rounded-lg px-3 py-2 text-sm" />
            <button onClick={() => marcarVisibles(true)}
              className="text-sm text-primary hover:underline whitespace-nowrap">
              Marcar {busca ? 'los filtrados' : 'todos'}
            </button>
            <button onClick={() => marcarVisibles(false)}
              className="text-sm text-gray-500 hover:underline whitespace-nowrap">
              Ninguno
            </button>
          </div>

          <div className="border rounded-lg max-h-72 overflow-y-auto divide-y">
            {visibles.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-gray-500 italic">
                Nadie coincide con esa búsqueda.
              </p>
            )}
            {visibles.map((r) => (
              <label key={r.empleado_id}
                className="flex items-center gap-3 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                <input type="checkbox"
                  checked={!!elegidos[r.empleado_id]}
                  onChange={(e) =>
                    setElegidos({ ...elegidos, [r.empleado_id]: e.target.checked })}
                  className="rounded" />
                <span className="text-sm text-gray-900 flex-1">{r.nombre}</span>
                <span className="text-xs text-gray-400">{r.num_empleado}</span>
                <span className="text-xs text-gray-400 w-32 truncate text-right">
                  {r.puesto || ''}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between p-5 border-t bg-gray-50 rounded-b-lg">
          <span className="text-sm text-gray-700">
            <b>{cuantos}</b> trabajador(es)
            {enDias ? (
              /* El total no se puede anticipar: depende del salario de cada
                 quien. Decirlo es mejor que enseñar una cifra que va a cambiar. */
              <> · {dias} día(s) c/u ·{' '}
                <span className="text-gray-500">
                  el importe sale con el salario de cada trabajador
                </span>
              </>
            ) : Number(importe) > 0 ? (
              <> · {money(importe)} c/u · <b>{money(total)}</b> en total</>
            ) : null}
          </span>
          <div className="flex gap-2">
            <button onClick={onCerrar}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
              Cancelar
            </button>
            <button onClick={aplicar} disabled={aplicando}
              className={`px-5 py-2 text-sm text-white rounded-lg flex items-center gap-1.5 disabled:opacity-50 ${
                esIngreso ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
              }`}>
              <Check size={15} /> {aplicando ? 'Aplicando…' : `Aplicar a ${cuantos}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AplicarAVarios;
