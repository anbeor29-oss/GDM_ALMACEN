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
import { ShoppingCart, Plus, Minus, X, Loader2, CheckCircle, Store, PackageX, User, LogOut, Receipt } from 'lucide-react';

const SF_BASE = (import.meta.env.VITE_API_BASE
  ? String(import.meta.env.VITE_API_BASE).replace(/\/+$/, '') + '/api/v1'
  : '/api/v1') + '/storefront';

type Producto = {
  productId: string; sku: string | null; nombre: string; descripcion: string | null;
  precio: number; tasaIva: number; precioConIva: number;
  destacado: boolean; rastreado: boolean; disponible: number | null;
  imagenId: string | null;
  categoriaId: string | null; categoriaSlug: string | null; categoriaNombre: string | null;
};
type Categoria = { id: string; nombre: string; slug: string; productos: number };
type Metodo = { id: string; nombre: string; costo: number; costoConIva: number; gratisDesde: number | null };
type Tienda = {
  nombre: string; slug: string; moneda: string; logoUrl: string | null;
  colorPrimario: string; colorSecundario: string;
};

const fmt = (n: number) => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function StorefrontPage() {
  const { slug = '' } = useParams();
  const [tienda, setTienda] = useState<Tienda | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [catSel, setCatSel] = useState<string | null>(null);  // slug de la categoría filtrada
  const [metodos, setMetodos] = useState<Metodo[]>([]);
  const [envioSel, setEnvioSel] = useState<string>('');       // id del método de envío elegido
  const [cupon, setCupon] = useState('');                     // código que escribe el comprador
  const [cuponAplicado, setCuponAplicado] = useState<{ codigo: string; descuento: number } | null>(null);
  const [cuponMsg, setCuponMsg] = useState('');
  const [aplicandoCupon, setAplicandoCupon] = useState(false);
  // Cuenta del comprador (opcional): token en localStorage por tienda.
  const [token, setToken] = useState<string | null>(null);
  const [buyer, setBuyer] = useState<{ id: string; email: string; nombre: string; telefono: string; direccion: string; cp: string } | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'registro'>('login');
  const [authForm, setAuthForm] = useState({ email: '', password: '', nombre: '', telefono: '', direccion: '', cp: '' });
  const [authErr, setAuthErr] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [cuentaOpen, setCuentaOpen] = useState(false);        // panel de cuenta (con sesión)
  const [misPedidos, setMisPedidos] = useState<any[]>([]);
  const [pedidosLoading, setPedidosLoading] = useState(false);
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
        const [tRes, pRes, cRes, eRes] = await Promise.all([
          fetch(`${SF_BASE}/${encodeURIComponent(slug)}`),
          fetch(`${SF_BASE}/${encodeURIComponent(slug)}/productos`),
          fetch(`${SF_BASE}/${encodeURIComponent(slug)}/categorias`),
          fetch(`${SF_BASE}/${encodeURIComponent(slug)}/envios`),
        ]);
        if (!tRes.ok) throw new Error('Tienda no encontrada.');
        const t = (await tRes.json())?.data;
        const p = (await pRes.json())?.data?.productos || [];
        const c = cRes.ok ? ((await cRes.json())?.data?.categorias || []) : [];
        const e = eRes.ok ? ((await eRes.json())?.data?.metodos || []) : [];
        if (!vivo) return;
        setTienda(t); setProductos(p); setCategorias(c); setMetodos(e);
        if (e.length) setEnvioSel(e[0].id);   // preselecciona el primer método
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
  const total = subtotal + iva;                         // productos con IVA (sin cupón)
  const descuento = cuponAplicado ? Math.min(cuponAplicado.descuento, total) : 0;
  const productosConDesc = Math.max(0, total - descuento);
  // Envío: el método elegido, con IVA; gratis si el total de productos (YA con cupón,
  // como lo calcula el backend) alcanza su umbral.
  const envioMetodo = metodos.find((m) => m.id === envioSel) || null;
  const envioGratis = !!(envioMetodo && envioMetodo.gratisDesde != null && productosConDesc >= envioMetodo.gratisDesde);
  const envioCosto = envioMetodo ? (envioGratis ? 0 : envioMetodo.costoConIva) : 0;
  const totalFinal = productosConDesc + envioCosto;
  const nItems = lineas.reduce((a, x) => a + x.q, 0);

  // Re-valida el cupón aplicado contra el total actual (si el carrito cambia, el
  // descuento se recalcula o se retira si ya no aplica). El pedido lo re-valida al crearse.
  useEffect(() => {
    const codigo = cuponAplicado?.codigo;
    if (!codigo) return;
    let vivo = true;
    (async () => {
      try {
        const r = await fetch(`${SF_BASE}/${encodeURIComponent(slug)}/cupon`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codigo, total }),
        });
        const d = (await r.json())?.data;
        if (!vivo) return;
        if (d?.valido) { if (d.descuento !== cuponAplicado?.descuento) setCuponAplicado({ codigo: d.codigo, descuento: d.descuento }); }
        else { setCuponAplicado(null); setCuponMsg(d?.mensaje || 'El cupón ya no aplica al carrito.'); }
      } catch { /* se ignora: el pedido re-valida igual */ }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, cuponAplicado?.codigo, slug]);

  const aplicarCupon = async () => {
    const codigo = cupon.trim().toUpperCase();
    if (!codigo) return;
    setCuponMsg(''); setAplicandoCupon(true);
    try {
      const r = await fetch(`${SF_BASE}/${encodeURIComponent(slug)}/cupon`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, total }),
      });
      const d = (await r.json())?.data;
      if (d?.valido) { setCuponAplicado({ codigo: d.codigo, descuento: d.descuento }); setCupon(''); setCuponMsg(''); }
      else { setCuponAplicado(null); setCuponMsg(d?.mensaje || 'Cupón no válido.'); }
    } catch { setCuponMsg('No se pudo validar el cupón.'); }
    finally { setAplicandoCupon(false); }
  };
  const quitarCupon = () => { setCuponAplicado(null); setCuponMsg(''); setCupon(''); };

  // ── Cuenta del comprador ──────────────────────────────────────────────────
  const tokenKey = `ec_buyer_${slug}`;
  const prefill = (b: { nombre: string; email: string; telefono: string; direccion: string; cp: string }) =>
    setCliente((c) => ({
      nombre: b.nombre || c.nombre, email: b.email || c.email, telefono: b.telefono || c.telefono,
      direccion: b.direccion || c.direccion, cp: b.cp || c.cp,
    }));

  // Restaura la sesión guardada si el token sigue siendo válido.
  useEffect(() => {
    let vivo = true, tk: string | null = null;
    try { tk = localStorage.getItem(tokenKey); } catch { /* sin storage */ }
    if (!tk) return;
    (async () => {
      try {
        const r = await fetch(`${SF_BASE}/${encodeURIComponent(slug)}/cuenta/perfil`, { headers: { Authorization: `Bearer ${tk}` } });
        const j = await r.json();
        if (!vivo) return;
        if (r.ok && j?.data?.comprador) { setToken(tk); setBuyer(j.data.comprador); prefill(j.data.comprador); }
        else { try { localStorage.removeItem(tokenKey); } catch { /* */ } }
      } catch { /* red: se reintenta al interactuar */ }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const guardarSesion = (tk: string, b: any) => {
    setToken(tk); setBuyer(b);
    try { localStorage.setItem(tokenKey, tk); } catch { /* */ }
    prefill(b);
  };
  const cerrarSesion = () => {
    setToken(null); setBuyer(null); setCuentaOpen(false); setMisPedidos([]);
    try { localStorage.removeItem(tokenKey); } catch { /* */ }
  };
  const enviarAuth = async () => {
    setAuthErr('');
    if (!authForm.email.trim() || !authForm.password) { setAuthErr('Captura tu correo y contraseña.'); return; }
    if (authMode === 'registro' && !authForm.nombre.trim()) { setAuthErr('Captura tu nombre.'); return; }
    setAuthBusy(true);
    try {
      const url = `${SF_BASE}/${encodeURIComponent(slug)}/cuenta/${authMode === 'registro' ? 'registro' : 'login'}`;
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(authForm) });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.message || 'No se pudo continuar.');
      guardarSesion(j.data.token, j.data.comprador);
      setAuthOpen(false);
      setAuthForm({ email: '', password: '', nombre: '', telefono: '', direccion: '', cp: '' });
    } catch (e: any) { setAuthErr(e?.message || 'No se pudo continuar.'); }
    finally { setAuthBusy(false); }
  };
  const abrirCuenta = async () => {
    setCuentaOpen(true); setPedidosLoading(true);
    try {
      const r = await fetch(`${SF_BASE}/${encodeURIComponent(slug)}/cuenta/pedidos`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      setMisPedidos(j?.data?.pedidos || []);
    } catch { /* */ } finally { setPedidosLoading(false); }
  };
  // Filtro por categoría del lado del cliente (el catálogo ya viene con su categoría).
  const productosVisibles = catSel ? productos.filter((p) => p.categoriaSlug === catSel) : productos;

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
        headers: token
          ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
          : { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente,
          items: lineas.map((x) => ({ productId: x.p.productId, cantidad: x.q })),
          envioMetodoId: envioSel || undefined,
          cuponCodigo: cuponAplicado?.codigo || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.message || 'No se pudo crear el pedido.');
      // Si hay pasarela (Mercado Pago), se redirige al checkout alojado.
      if (j.data?.checkoutUrl) { window.location.href = j.data.checkoutUrl; return; }
      setConfirmado(j.data);
      setCarrito({}); setCheckout(false); setAbierto(false);
      setCuponAplicado(null); setCupon(''); setCuponMsg('');
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
          <button onClick={() => (buyer ? abrirCuenta() : (setAuthMode('login'), setAuthErr(''), setAuthOpen(true)))}
            className="flex items-center gap-1.5 p-2 rounded-lg hover:bg-white/15 text-sm" aria-label="Mi cuenta">
            <User size={20} />
            {buyer && <span className="hidden sm:inline max-w-[8rem] truncate">{buyer.nombre.split(' ')[0]}</span>}
          </button>
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
        {/* Filtro por categoría (secciones de la tienda) */}
        {categorias.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-3 mb-1 -mx-1 px-1">
            <button onClick={() => setCatSel(null)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${catSel === null ? 'text-white' : 'bg-white text-gray-600 border-gray-200'}`}
              style={catSel === null ? { backgroundColor: marca, borderColor: marca } : undefined}>Todo</button>
            {categorias.map((c) => (
              <button key={c.id} onClick={() => setCatSel(c.slug)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${catSel === c.slug ? 'text-white' : 'bg-white text-gray-600 border-gray-200'}`}
                style={catSel === c.slug ? { backgroundColor: marca, borderColor: marca } : undefined}>{c.nombre}</button>
            ))}
          </div>
        )}
        {productos.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <PackageX size={36} className="mx-auto mb-2 text-gray-300" />
            Esta tienda aún no tiene productos publicados.
          </div>
        ) : productosVisibles.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <PackageX size={32} className="mx-auto mb-2 text-gray-300" />
            No hay productos en esta categoría.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {productosVisibles.map((p) => {
              const enCarrito = carrito[p.productId] || 0;
              const agotado = p.rastreado && (p.disponible || 0) <= 0;
              return (
                <div key={p.productId} className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
                  <div className="aspect-square bg-gray-100 flex items-center justify-center text-gray-300 overflow-hidden">
                    {p.imagenId
                      ? <img src={`${SF_BASE}/img/${p.imagenId}`} alt={p.nombre} loading="lazy" className="w-full h-full object-cover" />
                      : <Store size={34} />}
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
                  {metodos.length > 0 && (
                    <div>
                      <span className="text-xs font-medium text-gray-600">Método de envío</span>
                      <div className="mt-1 space-y-1.5">
                        {metodos.map((m) => {
                          const gratis = m.gratisDesde != null && total >= m.gratisDesde;
                          return (
                            <label key={m.id} className="flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer"
                              style={{ borderColor: envioSel === m.id ? marca : '#e5e7eb' }}>
                              <input type="radio" name="envio" checked={envioSel === m.id} onChange={() => setEnvioSel(m.id)} />
                              <span className="flex-1">{m.nombre}</span>
                              <span className="font-medium">{gratis ? 'Gratis' : `$${fmt(m.costoConIva)}`}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div>
                    <span className="text-xs font-medium text-gray-600">Cupón de descuento</span>
                    {cuponAplicado ? (
                      <div className="mt-1 flex items-center justify-between border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2 text-sm">
                        <span className="text-emerald-800">Cupón <b>{cuponAplicado.codigo}</b> aplicado · −${fmt(descuento)}</span>
                        <button type="button" onClick={quitarCupon} className="text-emerald-700 hover:text-emerald-900" aria-label="Quitar cupón"><X size={16} /></button>
                      </div>
                    ) : (
                      <div className="mt-1 flex gap-2">
                        <input value={cupon} onChange={(e) => setCupon(e.target.value.toUpperCase())}
                          placeholder="CÓDIGO" className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase" />
                        <button type="button" onClick={aplicarCupon} disabled={aplicandoCupon || !cupon.trim()}
                          className="px-3 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50" style={{ backgroundColor: marca }}>
                          {aplicandoCupon ? '…' : 'Aplicar'}
                        </button>
                      </div>
                    )}
                    {cuponMsg && <p className="text-xs text-rose-600 mt-1">{cuponMsg}</p>}
                  </div>
                  {errorPedido && <p className="text-sm text-rose-600">{errorPedido}</p>}
                </div>
              )}
            </div>

            {lineas.length > 0 && (
              <div className="border-t border-gray-200 p-4 space-y-2">
                <div className="flex justify-between text-sm text-gray-600"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
                <div className="flex justify-between text-sm text-gray-600"><span>IVA</span><span>${fmt(iva)}</span></div>
                {descuento > 0 && (
                  <div className="flex justify-between text-sm text-emerald-700">
                    <span>Descuento{cuponAplicado ? ` (${cuponAplicado.codigo})` : ''}</span><span>−${fmt(descuento)}</span>
                  </div>
                )}
                {envioMetodo && (
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Envío{envioGratis ? ' (gratis)' : ''}</span><span>${fmt(envioCosto)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-gray-900"><span>Total</span><span>${fmt(totalFinal)} {tienda.moneda}</span></div>
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

      {/* Entrar / Crear cuenta */}
      {authOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={() => setAuthOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-gray-900">{authMode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h3>
              <button onClick={() => setAuthOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="space-y-2.5">
              {authMode === 'registro' && (
                <input value={authForm.nombre} onChange={(e) => setAuthForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Nombre completo" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              )}
              <input type="email" value={authForm.email} onChange={(e) => setAuthForm((f) => ({ ...f, email: e.target.value }))} placeholder="Correo" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <input type="password" value={authForm.password} onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))} placeholder="Contraseña" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              {authMode === 'registro' && (<>
                <input value={authForm.telefono} onChange={(e) => setAuthForm((f) => ({ ...f, telefono: e.target.value }))} placeholder="Teléfono (opcional)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                <input value={authForm.direccion} onChange={(e) => setAuthForm((f) => ({ ...f, direccion: e.target.value }))} placeholder="Dirección (opcional)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                <input value={authForm.cp} onChange={(e) => setAuthForm((f) => ({ ...f, cp: e.target.value }))} placeholder="Código postal (opcional)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </>)}
              {authErr && <p className="text-xs text-rose-600">{authErr}</p>}
              <button onClick={enviarAuth} disabled={authBusy} className="w-full py-2.5 rounded-lg text-white font-medium disabled:opacity-60 flex items-center justify-center gap-2" style={{ backgroundColor: marca }}>
                {authBusy && <Loader2 size={18} className="animate-spin" />}
                {authMode === 'login' ? 'Entrar' : 'Crear cuenta'}
              </button>
              <p className="text-center text-xs text-gray-500">
                {authMode === 'login' ? '¿No tienes cuenta? ' : '¿Ya tienes cuenta? '}
                <button onClick={() => { setAuthMode(authMode === 'login' ? 'registro' : 'login'); setAuthErr(''); }} className="font-medium" style={{ color: marca }}>
                  {authMode === 'login' ? 'Regístrate' : 'Inicia sesión'}
                </button>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Panel de cuenta (con sesión) */}
      {cuentaOpen && buyer && (
        <div className="fixed inset-0 z-40 flex">
          <div className="flex-1 bg-black/40" onClick={() => setCuentaOpen(false)} />
          <div className="w-full max-w-md bg-white h-full flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Mi cuenta</h2>
              <button onClick={() => setCuentaOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={20} /></button>
            </div>
            <div className="p-4 border-b border-gray-100">
              <p className="font-medium text-gray-900">{buyer.nombre}</p>
              <p className="text-sm text-gray-500">{buyer.email}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><Receipt size={15} /> Mis pedidos</h3>
              {pedidosLoading ? (
                <p className="text-sm text-gray-400 py-6 text-center"><Loader2 size={18} className="animate-spin inline" /></p>
              ) : misPedidos.length === 0 ? (
                <p className="text-sm text-gray-400 italic py-6 text-center">Aún no tienes pedidos.</p>
              ) : (
                <div className="space-y-2">
                  {misPedidos.map((p) => (
                    <div key={p.id} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-medium">{p.numero}</span>
                        <span className="font-semibold">${fmt(Number(p.total))} {p.moneda}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-500 mt-0.5">
                        <span>{new Date(p.created_at).toLocaleDateString('es-MX')}</span>
                        <span>{p.estado}{p.cfdi_uuid ? ' · facturado' : ''}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-gray-200 p-4">
              <button onClick={cerrarSesion} className="w-full py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium flex items-center justify-center gap-2 hover:bg-gray-50">
                <LogOut size={16} /> Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
