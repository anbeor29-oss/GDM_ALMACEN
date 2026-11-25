/**
 * Comercio Electrónico — VISTA PREVIA de la tienda.
 *
 * Antes esta pantalla era un folleto: un encabezado grande y diez tarjetas que
 * repetían el menú. Las secciones ahora viven en el sidebar (como en el resto
 * de NEXO), así que el cuerpo se dedica a lo único que esta pantalla puede
 * hacer y ninguna otra: ENSEÑAR LA TIENDA COMO LA VE EL COMPRADOR, sin salir
 * del sistema y sin publicar nada para averiguarlo.
 *
 * Al lado, una revisión de la vitrina calculada sobre los datos REALES de la
 * tienda (no una lista de deseos): lo que le falta para que un desconocido se
 * anime a dejar su dinero.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ShoppingCart, Store, ExternalLink, Link2, RefreshCw, Monitor, Smartphone,
  Check, AlertTriangle, Loader2, Plus,
} from 'lucide-react';
import api from '@/services/api';

/** URL pública de la tienda. `BASE_URL` es `/` en desarrollo y `/erp/` en el
 *  hosting: es el único dato fiable para armar una liga desde el código. */
function urlTienda(slug: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}t/${slug}`;
}

export function EcommerceHubPage() {
  const qEstado = useQuery({ queryKey: ['ecommerce-estado'], queryFn: () => api.getEcommerceEstado() });
  const qTiendas = useQuery({ queryKey: ['ec-tiendas'], queryFn: () => api.listTiendas() });

  const estado = (qEstado.data as any)?.data;
  const tiendas: any[] = (qTiendas.data as any)?.data?.tiendas || [];

  const [sel, setSel] = useState<string>('');
  const [movil, setMovil] = useState(false);
  const [recarga, setRecarga] = useState(0);     // cambia la key del iframe
  const [copiado, setCopiado] = useState(false);

  // Primera tienda activa en cuanto carga la lista (o la primera que haya).
  useEffect(() => {
    if (sel || !tiendas.length) return;
    setSel((tiendas.find((t) => t.activa) || tiendas[0]).id);
  }, [tiendas, sel]);

  const tienda = useMemo(() => tiendas.find((t) => t.id === sel) || null, [tiendas, sel]);

  // Métodos de envío de la tienda elegida: entran en la revisión de la vitrina.
  const qEnvios = useQuery({
    queryKey: ['ec-envios', tienda?.id],
    queryFn: () => api.getEnviosEc(tienda!.id),
    enabled: !!tienda?.id,
  });
  const metodos: any[] = (qEnvios.data as any)?.data?.metodos || [];

  const copiar = async () => {
    if (!tienda) return;
    try {
      await navigator.clipboard.writeText(urlTienda(tienda.slug));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* sin portapapeles: la liga está a la vista para copiarla a mano */ }
  };

  /* ── Revisión de la vitrina ──────────────────────────────────────────────
   * Cada punto se calcula de lo que hay en la base, no de una plantilla. Un
   * «falta» aquí es una razón concreta por la que un comprador se va. */
  const revision = tienda ? [
    {
      ok: !!tienda.activa,
      titulo: 'Tienda activa',
      bien: 'La liga pública responde.',
      mal: 'Está desactivada: la liga no abre para nadie.',
      to: '/ecommerce/tiendas',
    },
    {
      ok: (estado?.publicados ?? 0) > 0,
      titulo: 'Productos publicados',
      bien: `${estado?.publicados ?? 0} producto(s) a la venta.`,
      mal: 'Sin productos publicados: la tienda se ve vacía.',
      to: '/ecommerce/catalogo',
    },
    {
      ok: !!tienda.logo_url,
      titulo: 'Logotipo',
      bien: 'La tienda se identifica con su marca.',
      mal: 'Sin logo: el encabezado sale con un ícono genérico.',
      to: '/ecommerce/tiendas',
    },
    {
      ok: !!(tienda.politica_envio && tienda.politica_devolucion),
      titulo: 'Políticas de envío y devolución',
      bien: 'El comprador sabe cuándo le llega y qué pasa si lo devuelve.',
      mal: 'Sin políticas escritas. Es lo primero que busca quien no te conoce.',
      to: '/ecommerce/tiendas',
    },
    {
      ok: !!(tienda.politica_privacidad && tienda.terminos),
      titulo: 'Aviso de privacidad y términos',
      bien: 'Publicados al pie de la tienda.',
      mal: 'Faltan. Además de confianza, la LFPDPPP pide el aviso de privacidad.',
      to: '/ecommerce/tiendas',
    },
    {
      ok: metodos.length > 0,
      titulo: 'Métodos de envío',
      bien: `${metodos.length} método(s) con costo a la vista.`,
      mal: 'Sin métodos: el comprador no sabe cuánto va a pagar de envío.',
      to: '/ecommerce/tiendas',
    },
  ] : [];

  const faltan = revision.filter((r) => !r.ok).length;

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto space-y-4">
      {/* Encabezado compacto: el menú ya está en el sidebar, aquí sobra el folleto */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
          <ShoppingCart size={20} />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <h1 className="text-xl font-bold text-gray-900 leading-tight">Comercio Electrónico</h1>
          <p className="text-sm text-gray-500">Así ve tu tienda quien entra desde fuera.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="bg-emerald-50 text-emerald-700 rounded-full px-3 py-1 font-medium">
            {estado?.tiendas ?? 0} tienda(s)
          </span>
          <span className="bg-blue-50 text-blue-700 rounded-full px-3 py-1 font-medium">
            {estado?.publicados ?? 0} publicado(s)
          </span>
          <Link to="/ecommerce/pedidos" className="bg-amber-50 text-amber-700 rounded-full px-3 py-1 font-medium hover:bg-amber-100">
            {estado?.pedidos ?? 0} pedido(s)
          </Link>
        </div>
      </div>

      {qTiendas.isLoading ? (
        <div className="flex items-center gap-2 text-gray-500 py-20 justify-center">
          <Loader2 className="animate-spin" size={18} /> Cargando tus tiendas…
        </div>
      ) : !tiendas.length ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
          <Store size={38} className="mx-auto mb-3 text-gray-300" />
          <h2 className="font-semibold text-gray-900">Todavía no hay ninguna tienda</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            Una tienda es el nombre, la liga pública, la moneda y el branding. En cuanto exista,
            aquí vas a ver su vitrina tal como la verá el comprador.
          </p>
          <Link to="/ecommerce/tiendas"
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">
            <Plus size={15} /> Crear la primera tienda
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* ── Vista previa ── */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col">
            {/* Barra de herramientas */}
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50">
              {tiendas.length > 1 && (
                <select value={sel} onChange={(e) => setSel(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                  {tiendas.map((t) => (
                    <option key={t.id} value={t.id}>{t.nombre}{t.activa ? '' : ' (inactiva)'}</option>
                  ))}
                </select>
              )}

              {/* La liga REAL, la que se puede pegar en WhatsApp */}
              {tienda && (
                <code className="flex-1 min-w-[10rem] text-[11px] text-gray-500 truncate" title={urlTienda(tienda.slug)}>
                  {urlTienda(tienda.slug)}
                </code>
              )}

              <div className="flex items-center rounded-lg border border-gray-200 bg-white overflow-hidden">
                <button onClick={() => setMovil(false)} title="Escritorio"
                  className={`px-2 py-1.5 ${!movil ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                  <Monitor size={14} />
                </button>
                <button onClick={() => setMovil(true)} title="Teléfono"
                  className={`px-2 py-1.5 ${movil ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                  <Smartphone size={14} />
                </button>
              </div>

              <button onClick={() => setRecarga((n) => n + 1)} title="Actualizar"
                className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50">
                <RefreshCw size={14} />
              </button>
              <button onClick={copiar} title="Copiar la liga"
                className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50">
                {copiado ? <Check size={14} className="text-emerald-600" /> : <Link2 size={14} />}
              </button>
              {tienda && (
                <a href={urlTienda(tienda.slug)} target="_blank" rel="noreferrer" title="Abrir en una pestaña"
                  className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>

            {/* El marco */}
            <div className={`bg-gray-100 p-3 ${movil ? 'flex flex-col items-center' : ''}`}>
              {tienda && !tienda.activa && (
                <div className="mb-3 w-full flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} className="mt-px shrink-0" />
                  <span>
                    Esta tienda está <b>desactivada</b>: aquí se ve, pero la liga pública no abre
                    para el comprador.
                  </span>
                </div>
              )}
              {tienda && (
                <iframe
                  key={`${tienda.slug}-${recarga}-${movil ? 'm' : 'd'}`}
                  src={`${import.meta.env.BASE_URL}t/${tienda.slug}`}
                  title={`Vista previa de ${tienda.nombre}`}
                  className={`bg-white rounded-lg border border-gray-300 shadow-sm ${movil ? 'w-[390px]' : 'w-full'}`}
                  style={{ height: '72vh', minHeight: 460 }}
                />
              )}
            </div>
          </div>

          {/* ── Revisión de la vitrina ── */}
          <aside className="space-y-3">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="font-semibold text-gray-900 text-sm">Revisión de la vitrina</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {faltan === 0
                  ? 'Todo lo que genera confianza está puesto.'
                  : `${faltan} cosa(s) que un comprador nuevo va a echar de menos.`}
              </p>

              <ul className="mt-3 space-y-2.5">
                {revision.map((r) => (
                  <li key={r.titulo} className="flex items-start gap-2">
                    <span className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                      r.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {r.ok ? <Check size={11} /> : <AlertTriangle size={10} />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-800">{r.titulo}</p>
                      <p className="text-[11px] text-gray-500 leading-snug">{r.ok ? r.bien : r.mal}</p>
                      {!r.ok && (
                        <Link to={r.to} className="text-[11px] font-medium text-emerald-700 hover:underline">
                          Arreglarlo →
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="font-semibold text-gray-900 text-sm">Cobro en línea</h2>
              <p className="text-xs text-gray-500 mt-1 leading-snug">
                La pasarela (Mercado Pago) todavía no está conectada. Mientras tanto el pedido entra
                igual y se cobra fuera de línea: en <Link to="/ecommerce/pedidos" className="text-emerald-700 font-medium hover:underline">Pedidos</Link>,
                «Pagar y facturar» genera el CFDI y su póliza.
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

export default EcommerceHubPage;
