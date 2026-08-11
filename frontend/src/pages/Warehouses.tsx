/**
 * Almacenes — CRUD del catálogo de almacenes (§7 ALMACEN.MD).
 *
 *  · El primer almacén creado se vuelve default automáticamente.
 *  · El default no puede desactivarse ni eliminarse (reasignar primero).
 *  · Eliminar exige almacén sin existencias (el backend lo bloquea).
 */
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Warehouse, Plus, Pencil, Trash2, Star, MapPin, Loader2 } from 'lucide-react';
import api from '@/services/api';

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  address?: string;
  postal_code?: string;
  street?: string;
  ext_number?: string;
  int_number?: string;
  colonia?: string;
  municipio?: string;
  estado?: string;
  is_default: boolean;
  is_active: boolean;
  products_with_stock: number;
  total_units: number;
  total_value: number;
  created_at?: string;
}

const money = (n: number) =>
  Number(n ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export function WarehousesPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<WarehouseRow | null>(null);
  const [error, setError] = useState('');

  const q = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.getWarehouses(true),
  });
  const rows: WarehouseRow[] = q.data?.data?.warehouses || [];

  const refresh = () => qc.invalidateQueries({ queryKey: ['warehouses'] });

  const handleDelete = async (w: WarehouseRow) => {
    if (!window.confirm(`¿Eliminar el almacén ${w.code} — ${w.name}?`)) return;
    setError('');
    try {
      await api.deleteWarehouse(w.id);
      refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo eliminar el almacén');
    }
  };

  const handleSetDefault = async (w: WarehouseRow) => {
    setError('');
    try {
      await api.updateWarehouse(w.id, { isDefault: true });
      refresh();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo cambiar el default');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 flex items-center gap-3">
            <Warehouse className="text-sky-600" size={36} /> Almacenes
          </h1>
          <p className="text-gray-600 mt-1">
            Existencias separadas por almacén · traspasos · mínimos y máximos por ubicación
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
        >
          <Plus size={18} /> Nuevo almacén
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Código</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Nombre</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600">Dirección</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Productos</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Unidades</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600">Valuación</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Estado</th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500">Cargando…</td></tr>
            )}
            {!q.isLoading && rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500 italic">
                Sin almacenes. Crea el primero — será el almacén default de la empresa.
              </td></tr>
            )}
            {rows.map((w) => (
              <tr key={w.id} className={`hover:bg-gray-50 ${!w.is_active ? 'opacity-50' : ''}`}>
                <td className="px-4 py-2 font-mono font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {w.is_default && <Star size={14} className="text-amber-500 fill-amber-400" />}
                    {w.code}
                  </span>
                </td>
                <td className="px-4 py-2 font-medium">{w.name}</td>
                <td className="px-4 py-2 text-sm text-gray-600">
                  {w.address ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={12} className="text-gray-400" />{w.address}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-2 text-center text-sm">{w.products_with_stock}</td>
                <td className="px-4 py-2 text-right text-sm">{Number(w.total_units).toLocaleString('es-MX')}</td>
                <td className="px-4 py-2 text-right text-sm font-medium">{money(w.total_value)}</td>
                <td className="px-4 py-2 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    w.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'
                  }`}>
                    {w.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-center gap-1">
                    {!w.is_default && w.is_active && (
                      <button title="Hacer default"
                        onClick={() => handleSetDefault(w)}
                        className="p-1.5 text-amber-500 hover:bg-amber-50 rounded">
                        <Star size={16} />
                      </button>
                    )}
                    <button title="Editar"
                      onClick={() => setEditing(w)}
                      className="p-1.5 text-sky-600 hover:bg-sky-50 rounded">
                      <Pencil size={16} />
                    </button>
                    {!w.is_default && (
                      <button title="Eliminar"
                        onClick={() => handleDelete(w)}
                        className="p-1.5 text-rose-600 hover:bg-rose-50 rounded">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <WarehouseModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refresh(); }}
        />
      )}
      {editing && (
        <WarehouseModal
          warehouse={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

function WarehouseModal({
  warehouse,
  onClose,
  onSaved,
}: {
  warehouse?: WarehouseRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!warehouse;
  const [code, setCode] = useState(warehouse?.code || '');
  const [name, setName] = useState(warehouse?.name || '');
  const [isActive, setIsActive] = useState(warehouse?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /** Cajero recién creado: se enseña su acceso y el modal deja de guardar. */
  const [cajero, setCajero] = useState<any>(null);

  // ── Domicilio ────────────────────────────────────────────────────────────
  const [cp, setCp] = useState(warehouse?.postal_code || '');
  const [street, setStreet] = useState(warehouse?.street || '');
  const [extNumber, setExtNumber] = useState(warehouse?.ext_number || '');
  const [intNumber, setIntNumber] = useState(warehouse?.int_number || '');
  const [colonia, setColonia] = useState(warehouse?.colonia || '');
  const [municipio, setMunicipio] = useState(warehouse?.municipio || '');
  const [estado, setEstado] = useState(warehouse?.estado || '');
  const [estadoNombre, setEstadoNombre] = useState('');
  const [colonias, setColonias] = useState<Array<{ clave: string; descripcion: string }>>([]);
  const [municipios, setMunicipios] = useState<Array<{ clave: string; descripcion: string }>>([]);
  const [buscandoCp, setBuscandoCp] = useState(false);
  const [avisoCp, setAvisoCp] = useState('');

  /* Con 5 dígitos se consulta el catálogo SAT y se llenan colonia, municipio y
   * estado. El almacenista termina escribiendo calle y número.
   *
   * `cancelado` evita que una respuesta lenta de un CP ya borrado pise las
   * listas del CP nuevo: al teclear, este efecto se dispara una vez por
   * dígito, y las respuestas no vuelven necesariamente en orden. */
  useEffect(() => {
    const limpio = cp.trim();
    if (!/^\d{5}$/.test(limpio)) { setColonias([]); setMunicipios([]); setAvisoCp(''); return; }
    let cancelado = false;
    setBuscandoCp(true); setAvisoCp('');
    api.resolveCP(limpio).then(r => {
      if (cancelado) return;
      setColonias(r.colonias || []);
      setMunicipios(r.municipios || []);
      if (r.estado) setEstado(r.estado);
      setEstadoNombre(r.estadoDescripcion || '');
      if (!r.colonias?.length) {
        setAvisoCp('Ese CP no está en el catálogo SAT — captura la colonia a mano.');
      } else if (r.colonias.length === 1) {
        // Una sola colonia: no tiene caso hacer elegir de una lista de uno.
        setColonia(r.colonias[0].descripcion);
      }
    }).catch(() => {
      if (!cancelado) setAvisoCp('No se pudo consultar el CP — captura el domicilio a mano.');
    }).finally(() => { if (!cancelado) setBuscandoCp(false); });
    return () => { cancelado = true; };
  }, [cp]);

  /* El código que de verdad se manda. Los espacios se vuelven guiones -"BODEGA
   * CENTRO" es lo que cualquiera escribe- en lugar de rechazar la captura con
   * un mensaje que enuncia la regla sin decir qué sobra. */
  const codeLimpio = code.trim().toUpperCase().replace(/\s+/g, '-');
  const codeInvalido = codeLimpio !== '' && !/^[A-Z0-9_-]{1,20}$/.test(codeLimpio);

  const handleSave = async () => {
    setError('');
    if (!isEdit && !codeLimpio) { setError('El código es obligatorio'); return; }
    if (!isEdit && codeInvalido) {
      setError('El código solo admite letras sin acentos, números y guiones.');
      return;
    }
    if (!name.trim()) { setError('El nombre es obligatorio'); return; }
    setSaving(true);
    try {
      const domicilio = {
        postalCode: cp.trim() || undefined,
        street: street.trim() || undefined,
        extNumber: extNumber.trim() || undefined,
        intNumber: intNumber.trim() || undefined,
        colonia: colonia.trim() || undefined,
        municipio: municipio.trim() || undefined,
        estado: estado.trim() || undefined,
        // Va solo para armar el domicilio legible; lo que se guarda es la clave.
        estadoNombre: estadoNombre || undefined,
      };
      if (isEdit) {
        await api.updateWarehouse(warehouse.id, { name: name.trim(), isActive, ...domicilio });
      } else {
        const r: any = await api.createWarehouse({ code: codeLimpio, name: name.trim(), ...domicilio });
        /* Al crear un almacén se crea también su cajero, con contraseña
         * temporal. Se muestra UNA vez y no se cierra el modal: si se cerrara
         * como en un alta normal, la clave se perdería y habría que
         * restablecerla antes de que el cajero pueda siquiera entrar. */
        const cajero = (r?.data ?? r)?.cajero;
        if (cajero) { setCajero(cajero); return; }
      }
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'No se pudo guardar el almacén');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-sky-100 rounded-lg flex items-center justify-center">
              <Warehouse className="text-sky-700" size={20} />
            </div>
            <h2 className="font-bold">{isEdit ? `Editar ${warehouse.code}` : 'Nuevo almacén'}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}
          {cajero && (
            <div className={`px-3 py-3 rounded text-sm border ${
              cajero.creado ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
              {cajero.creado ? (
                <>
                  <p className="font-semibold mb-1">Almacén creado, con su punto de venta.</p>
                  <p className="mb-2 text-xs">
                    Entrégale estos datos al cajero. La contraseña <b>no se vuelve a mostrar</b>:
                    si se pierde, hay que restablecerla desde Usuarios.
                  </p>
                  <div className="bg-white/70 rounded p-2 font-mono text-sm">
                    <div>Usuario: <b>{cajero.email}</b></div>
                    <div>Contraseña temporal: <b>{cajero.passwordTemporal}</b></div>
                  </div>
                  <p className="mt-2 text-xs">
                    Se le pedirá cambiarla al entrar. Sólo ve el Punto de Venta, y vende
                    desde este almacén.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold mb-1">El almacén se creó, pero sin su cajero.</p>
                  <p className="text-xs">{cajero.motivo}</p>
                </>
              )}
            </div>
          )}
          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Código *</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Ej. BODEGA1, SUC-NORTE" maxLength={24} className="input" />
              {codeLimpio !== code.trim().toUpperCase() && !codeInvalido && (
                <p className="mt-1 text-xs text-slate-500">
                  Se guardará como <b>{codeLimpio}</b> — los espacios se vuelven guiones.
                </p>
              )}
              {codeInvalido && (
                <p className="mt-1 text-xs text-rose-600">
                  Solo letras sin acentos, números y guiones. Hasta 20 caracteres.
                </p>
              )}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Bodega principal" className="input" />
          </div>
          {/* Domicilio. El CP va primero a proposito: con el, el catalogo SAT
              resuelve colonia, municipio y estado, y solo queda calle y numero. */}
          <div className="pt-2 border-t">
            <div className="flex items-center gap-2 mb-2">
              <MapPin size={14} className="text-slate-400" />
              <span className="text-sm font-medium text-gray-700">Domicilio</span>
              {buscandoCp && <Loader2 size={13} className="animate-spin text-slate-400" />}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="block text-xs text-slate-500 mb-1">Código postal</span>
                <input
                  value={cp}
                  onChange={(e) => setCp(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  inputMode="numeric" placeholder="20000" className="input font-mono"
                />
              </label>
              <label className="block col-span-2">
                <span className="block text-xs text-slate-500 mb-1">Colonia</span>
                {colonias.length > 0 ? (
                  <select value={colonia} onChange={(e) => setColonia(e.target.value)} className="input">
                    <option value="">— elige la colonia —</option>
                    {colonias.map(c => (
                      <option key={c.clave} value={c.descripcion}>{c.descripcion}</option>
                    ))}
                  </select>
                ) : (
                  /* Sin catalogo se deja escribir: hay CP que no estan, y no
                     poder dar de alta el almacen por eso seria peor. */
                  <input value={colonia} onChange={(e) => setColonia(e.target.value)}
                    placeholder="Captura el CP para elegirla" className="input" />
                )}
              </label>
            </div>

            {avisoCp && <p className="mt-1 text-xs text-amber-700">{avisoCp}</p>}

            <div className="grid grid-cols-3 gap-3 mt-3">
              <label className="block col-span-2">
                <span className="block text-xs text-slate-500 mb-1">Municipio</span>
                {municipios.length > 0 ? (
                  <select value={municipio} onChange={(e) => setMunicipio(e.target.value)} className="input">
                    <option value="">— elige el municipio —</option>
                    {municipios.map(m => (
                      <option key={m.clave} value={m.descripcion}>{m.descripcion}</option>
                    ))}
                  </select>
                ) : (
                  <input value={municipio} onChange={(e) => setMunicipio(e.target.value)} className="input" />
                )}
              </label>
              <label className="block">
                <span className="block text-xs text-slate-500 mb-1">Estado</span>
                {/* Se muestra el nombre y se guarda la clave SAT: el Anexo 20
                    pide AGU, no "Aguascalientes". */}
                <input value={estadoNombre || estado} readOnly
                  className="input bg-slate-50 text-slate-600" placeholder="del CP" />
              </label>
            </div>

            <div className="grid grid-cols-4 gap-3 mt-3">
              <label className="block col-span-2">
                <span className="block text-xs text-slate-500 mb-1">Calle</span>
                <input value={street} onChange={(e) => setStreet(e.target.value)}
                  placeholder="Av. de los Agustinos" className="input" />
              </label>
              <label className="block">
                <span className="block text-xs text-slate-500 mb-1">Núm. ext.</span>
                <input value={extNumber} onChange={(e) => setExtNumber(e.target.value)}
                  placeholder="120" className="input" />
              </label>
              <label className="block">
                <span className="block text-xs text-slate-500 mb-1">Núm. int.</span>
                <input value={intNumber} onChange={(e) => setIntNumber(e.target.value)}
                  placeholder="opcional" className="input" />
              </label>
            </div>
          </div>
          {isEdit && !warehouse.is_default && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Almacén activo
            </label>
          )}
        </div>

        <div className="flex justify-end gap-3 p-5 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
            Cancelar
          </button>
          {/* Con el acceso en pantalla, el único movimiento sensato es cerrar:
              volver a guardar chocaría contra el código duplicado y taparía el
              aviso con un error. */}
          <button onClick={cajero ? onSaved : handleSave} disabled={saving}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 disabled:opacity-50">
            {cajero ? 'Listo' : saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
