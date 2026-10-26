/**
 * Storefront público (rebanada 4) — la tienda que ve el COMPRADOR, SIN login.
 *
 * Ruta pública /t/:slug. Lee la tienda y su catálogo del API público
 * (/storefront/:slug), arma el carrito del lado del cliente y crea el pedido
 * (reserva de stock en el backend). El cobro con pasarela llega en la rebanada 5.
 * Mobile-first y con los colores de marca de la tienda.
 */
import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { ShoppingCart, Plus, Minus, X, Loader2, CheckCircle, Store, PackageX } from 'lucide-react';

const SF_BASE = (import.meta.env.VITE_API_BASE
  ? String(import.meta.env.VITE_API_BASE).replace(/\/+$/, '') + '/api/v1'
  : '/api/v1') + '/storefront';

type Producto = {
  productId: string; sku: string | null; nombre: string; descripcion: string | null;
  precio: number; tasaIva: number; precioConIva: number;
  destacado: boolean; rastreado: boolean; disponible: number | null;
};
type Tienda = {
  nombre: string; slug: string; moneda: string; logoUrl: string | null;
  colorPrimario: string; colorSecundario: string;
};

const fmt = (n: number) => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function StorefrontPage() {
  const { slug = '' } = useParams();
  const [tienda, setTienda] = useState<Tienda | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');

  const [carrito, setCarrito] = useState<Record<string, number>>({});
  const [abierto, setAbierto] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [cliente, setCliente] = useState({ nombre: '', email: '', telefono: '', direccion: '', cp: '' });
  const [enviando, setEnviando] = useState(false);
  const [errorPedido, setErrorPedido] = useState('');
  const [confirmado, setConfirmado] = useState<{ numero: string; total: number; moneda: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCargando(true); setErrorCarga('');
      try {
        const [tRes, pRes] = await Promise.all([
          fetch(`${SF_BASE}/${encodeURIComponent(slug)}`),
          fetch(`${SF_BASE}/${encodeURIComponent(slug)}/productos`),
        ]);
        if (!tRes.ok) throw new Error('Tienda no encontrada.');
        const t = (await tRes.json())?.data;
        const p = (await pRes.json())?.data?.productos || [];
        if (!vivo) return;
        setTienda(t); setProductos(p);
      } catch (e: any) {
        if (vivo) setErrorCarga(e?.message || 'No se pudo cargar la tienda.');
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [slug]);

  const marca = tienda?.colorPrimario || '#059669';
  const prodById = useMemo(() => {
    const m: Record<string, Producto> = {};
    for (const p of productos) m[p.productId] = p;
    return m;
  }, [productos]);
  const lineas = Object.entries(carrito)
    .map(([id, q]) => ({ p: prodById[id], q }))
    .filter((x) => x.p);
  const subtotal = lineas.reduce((a, x) => a + x.p.precio * x.q, 0);
  const iva = lineas.reduce((a, x) => a + x.p.precio * x.q * x.p.tasaIva, 0);
  const total = subtotal + iva;
  const nItems = lineas.reduce((a, x) => a + x.q, 0);

  const topeDe = (p: Producto) => (p.rastreado && p.disponible != null ? p.disponible : Infinity);
  const agregar = (p: Producto) =>
    setCarrito((c) => {
      const q = (c[p.productId] || 0) + 1;
      if (q > topeDe(p)) return c;
      return { ...c, [p.productId]: q };
    });
  const quitar = (id: string) =>
    setCarrito((c) => {
      const q = (c[id] || 0) - 1;
      const n = { ...c };
      if (q <= 0) delete n[id]; else n[id] = q;
      return n;
    });

  const hacerPedido = async () => {
    setErrorPedido('');
    if (!cliente.nombre.trim()) { setErrorPedido('Captura tu nombre.'); return; }
    if (!lineas.length) { setErrorPedido('Tu carrito está vacío.'); return; }
    setEnviando(true);
    try {
      const res = await fetch(`${SF_BASE}/${encodeURIComponent(slug)}/pedido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente,
          items: lineas.map((x) => ({ productId: x.p.productId, cantidad: x.q })),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.message || 'No se pudo crear el pedido.');
      // Si hay pasarela (Mercado Pago), se redirige al checkout alojado.
      if (j.data?.checkoutUrl) { window.location.href = j.data.checkoutUrl; return; }
      setConfirmado(j.data);
      setCarrito({}); setCheckout(false); setAbierto(false);
    } catch (e: any) {
      setErrorPedido(e?.message || 'No se pudo crear el pedido.');
    } finally {
      setEnviando(false);
    }
  };

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }
  if (errorCarga || !tienda) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-6">
        <Store size={40} className="text-gray-300" />
        <p className="text-lg font-semibold text-gray-700">Tienda no disponible</p>
        <p className="text-sm text-gray-500">{errorCarga || 'Revisa la dirección de la tienda.'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Encabezado de marca */}
      <header className="sticky top-0 z-20 text-white shadow" style={{ backgroundColor: marca }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          {tienda.logoUrl
            ? <img src={tienda.logoUrl} alt={tienda.nombre} className="w-9 h-9 rounded-lg object-cover bg-white/20" />
            : <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center"><Store size={18} /></div>}
          <h1 className="font-semibold text-lg flex-1 truncate">{tienda.nombre}</h1>
          <button onClick={() => setAbierto(true)} className="relative p-2 rounded-lg hover:bg-white/15" aria-label="Carrito">
            <ShoppingCart size={22} />
            {nItems > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-white text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center" style={{ color: marca }}>
                {nItems}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Catálogo */}
      <main className="max-w-5xl mx-auto px-4 py-5">
        {productos.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <PackageX size={36} className="mx-auto mb-2 text-gray-300" />
            Esta tienda aún no tiene productos publicados.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {productos.map((p) => {
              const enCarrito = carrito[p.productId] || 0;
              const agotado = p.rastreado && (p.disponible || 0) <= 0;
              return (
                <div key={p.productId} className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
                  <div className="aspect-square bg-gray-100 flex items-center justify-center text-gray-300">
                    <Store size={34} />
                  </div>
                  <div className="p-3 flex flex-col flex-1">
                    <p className="text-sm font-medium text-gray-900 leading-tight line-clamp-2">{p.nombre}</p>
                    {p.descripcion && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{p.descripcion}</p>}
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-base font-bold text-gray-900">${fmt(p.precioConIva)}</span>
                      {p.tasaIva > 0 && <span className="text-[10px] text-gray-400">IVA incl.</span>}
                    </div>
                    {p.rastreado && (
                      <p className={`text-[11px] mt-0.5 ${agotado ? 'text-rose-600' : 'text-gray-500'}`}>
                        {agotado ? 'Agotado' : `${p.disponible} disponibles`}
                      </p>
                    )}
                    <div className="mt-auto pt-2">
                      {enCarrito > 0 ? (
                        <div className="flex items-center justify-between rounded-lg border border-gray-200">
                          <button onClick={() => quitar(p.productId)} className="p-2 text-gray-600 hover:bg-gray-50 rounded-l-lg"><Minus size={16} /></button>
                          <span className="text-sm font-semibold">{enCarrito}</span>
                          <button onClick={() => agregar(p)} disabled={enCarrito >= topeDe(p)}
                            className="p-2 text-gray-600 hover:bg-gray-50 rounded-r-lg disabled:opacity-30"><Plus size={16} /></button>
                        </div>
                      ) : (
                        <button onClick={() => agregar(p)} disabled={agotado}
                          className="w-full py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40"
                          style={{ backgroundColor: marca }}>
                          Agregar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Carrito / Checkout (panel lateral) */}
      {abierto && (
        <div className="fixed inset-0 z-30 flex">
          <div className="flex-1 bg-black/40" onClick={() => { setAbierto(false); setCheckout(false); }} />
          <div className="w-full max-w-md bg-white h-full flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">{checkout ? 'Finalizar pedido' : 'Tu carrito'}</h2>
              <button onClick={() => { setAbierto(false); setCheckout(false); }} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={20} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {lineas.length === 0 ? (
                <p className="text-center text-gray-500 py-16">Tu carrito está vacío.</p>
              ) : !checkout ? (
                lineas.map((x) => (
                  <div key={x.p.productId} className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300 shrink-0"><Store size={18} /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{x.p.nombre}</p>
                      <p className="text-xs text-gray-500">${fmt(x.p.precioConIva)} c/u</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => quitar(x.p.productId)} className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50"><Minus size={14} /></button>
                      <span className="text-sm font-semibold w-5 text-center">{x.q}</span>
                      <button onClick={() => agregar(x.p)} disabled={x.q >= topeDe(x.p)} className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-30"><Plus size={14} /></button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="space-y-3">
                  {[
                    { k: 'nombre', l: 'Nombre completo *', t: 'text' },
                    { k: 'email', l: 'Correo', t: 'email' },
                    { k: 'telefono', l: 'Teléfono', t: 'tel' },
                    { k: 'direccion', l: 'Dirección de envío', t: 'text' },
                    { k: 'cp', l: 'Código postal', t: 'text' },
                  ].map((f) => (
                    <label key={f.k} className="block">
                      <span className="text-xs font-medium text-gray-600">{f.l}</span>
                      <input type={f.t} value={(cliente as any)[f.k]}
                        onChange={(e) => setCliente((c) => ({ ...c, [f.k]: e.target.value }))}
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                        style={{ outlineColor: marca }} />
                    </label>
                  ))}
                  {errorPedido && <p className="text-sm text-rose-600">{errorPedido}</p>}
                </div>
              )}
            </div>

            {lineas.length > 0 && (
              <div className="border-t border-gray-200 p-4 space-y-2">
                <div className="flex justify-between text-sm text-gray-600"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
                <div className="flex justify-between text-sm text-gray-600"><span>IVA</span><span>${fmt(iva)}</span></div>
                <div className="flex justify-between text-base font-bold text-gray-900"><span>Total</span><span>${fmt(total)} {tienda.moneda}</span></div>
                {!checkout ? (
                  <button onClick={() => setCheckout(true)} className="w-full py-2.5 rounded-lg text-white font-medium" style={{ backgroundColor: marca }}>
                    Continuar
                  </button>
                ) : (
                  <button onClick={hacerPedido} disabled={enviando}
                    className="w-full py-2.5 rounded-lg text-white font-medium flex items-center justify-center gap-2 disabled:opacity-60" style={{ backgroundColor: marca }}>
                    {enviando ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
                    {enviando ? 'Enviando…' : 'Confirmar pedido'}
                  </button>
                )}
                <p className="text-[11px] text-gray-400 text-center">El pago se coordina al confirmar (próximamente en línea).</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmación */}
      {confirmado && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-6" onClick={() => setConfirmado(null)}>
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <CheckCircle size={44} className="mx-auto mb-3" style={{ color: marca }} />
            <h3 className="text-lg font-bold text-gray-900">¡Pedido recibido!</h3>
            <p className="text-sm text-gray-600 mt-1">Tu número de pedido es</p>
            <p className="text-2xl font-mono font-bold text-gray-900 my-1">{confirmado.numero}</p>
            <p className="text-sm text-gray-600">Total: <b>${fmt(confirmado.total)} {confirmado.moneda}</b></p>
            <p className="text-xs text-gray-500 mt-3">La tienda se pondrá en contacto para coordinar el pago y el envío.</p>
            <button onClick={() => setConfirmado(null)} className="mt-4 w-full py-2.5 rounded-lg text-white font-medium" style={{ backgroundColor: marca }}>
              Seguir comprando
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
