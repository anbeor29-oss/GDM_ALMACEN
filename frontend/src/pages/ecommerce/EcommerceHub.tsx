/**
 * Comercio Electrónico — hub del módulo (rebanada 1: base + aislamiento).
 *
 * Es la cara del módulo nuevo. Por ahora muestra las secciones planeadas (plan en
 * docs/ECOMMERCE_PLAN.md) como tarjetas; la operación real llega en las siguientes
 * rebanadas. El módulo ya está AISLADO: una empresa con modulos_habilitados=['ecommerce']
 * ve sólo esta pantalla; el despacho (SUPER_ADMIN) ve todo.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ShoppingCart, Store, Package, Boxes, Globe, ClipboardList,
  CreditCard, Tag, Truck, Users, BarChart3, Sparkles,
} from 'lucide-react';
import api from '@/services/api';

type Seccion = {
  icon: any; titulo: string; desc: string;
  color: string;    // clases de acento del ícono
  listo?: boolean;  // true cuando la sección ya opere
  to?: string;      // ruta si la sección ya es navegable
};

const SECCIONES: Seccion[] = [
  { icon: Store,         titulo: 'Tiendas',       desc: 'Alta de tienda, subdominio, moneda, branding y políticas.',          color: 'bg-emerald-100 text-emerald-700', listo: true, to: '/ecommerce/tiendas' },
  { icon: Package,       titulo: 'Productos',     desc: 'Catálogo maestro (SKU, precio, impuestos) sobre los datos del ERP.', color: 'bg-blue-100 text-blue-700' },
  { icon: Boxes,         titulo: 'Inventario',    desc: 'Existencias por almacén y disponibilidad para venta.',               color: 'bg-indigo-100 text-indigo-700' },
  { icon: Globe,         titulo: 'Catálogo web',  desc: 'Qué productos salen a la tienda, fotos, SEO y precio web.',           color: 'bg-cyan-100 text-cyan-700' },
  { icon: ClipboardList, titulo: 'Pedidos',       desc: 'Tablero de pedidos, estados, historial y guía de envío.',            color: 'bg-amber-100 text-amber-700' },
  { icon: CreditCard,    titulo: 'Pagos',         desc: 'Mercado Pago: tarjeta, OXXO, SPEI y meses sin intereses.',           color: 'bg-rose-100 text-rose-700' },
  { icon: Tag,           titulo: 'Promociones',   desc: 'Cupones, ofertas con vigencia y envío gratis.',                      color: 'bg-fuchsia-100 text-fuchsia-700' },
  { icon: Truck,         titulo: 'Envíos',        desc: 'Método y costo, captura de guía y recoger en sucursal.',             color: 'bg-orange-100 text-orange-700' },
  { icon: Users,         titulo: 'Clientes web',  desc: 'Cuentas de compradores, ligadas a los clientes del ERP.',            color: 'bg-teal-100 text-teal-700' },
  { icon: BarChart3,     titulo: 'Reportes',      desc: 'Ventas, conversión, carrito abandonado y stock bajo.',               color: 'bg-violet-100 text-violet-700' },
];

export function EcommerceHubPage() {
  const q = useQuery({ queryKey: ['ecommerce-estado'], queryFn: () => api.getEcommerceEstado() });
  const estado = (q.data as any)?.data;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Encabezado moderno */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-600 text-white p-6 sm:p-8 shadow-lg">
        <div className="absolute -right-6 -top-6 opacity-20">
          <ShoppingCart size={160} strokeWidth={1.2} />
        </div>
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-white/20 rounded-full px-2.5 py-1 mb-2">
            <Sparkles size={12} /> Nuevo módulo
          </span>
          <h1 className="text-3xl sm:text-4xl font-bold flex items-center gap-3">
            <ShoppingCart size={30} /> Comercio Electrónico
          </h1>
          <p className="mt-1 text-emerald-50 max-w-2xl">
            Tu tienda en línea conectada al ERP: publica tu catálogo, cobra con Mercado Pago y
            lleva los pedidos a ventas, inventario y facturación sin recapturar.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="bg-white/15 rounded-full px-3 py-1">
              {q.isLoading ? 'Conectando…' : estado ? 'Módulo activo' : 'Sin conexión'}
            </span>
            <span className="bg-white/15 rounded-full px-3 py-1">{estado?.tiendas ?? 0} tienda(s)</span>
            <span className="bg-white/15 rounded-full px-3 py-1">{estado?.pedidos ?? 0} pedido(s)</span>
          </div>
        </div>
      </div>

      {/* Aviso de etapa */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
        <b>En construcción</b> — esta es la base del módulo (rebanada 1). Las secciones se van
        habilitando por fases; el plan completo está en <code>docs/ECOMMERCE_PLAN.md</code>.
      </div>

      {/* Secciones */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECCIONES.map((s) => {
          const contenido = (
            <>
              <span className={`absolute top-3 right-3 text-[10px] font-semibold rounded-full px-2 py-0.5 ${
                s.listo ? 'text-emerald-700 bg-emerald-50' : 'text-gray-400 bg-gray-100'}`}>
                {s.listo ? 'Disponible' : 'Próximamente'}
              </span>
              <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${s.color}`}>
                <s.icon size={22} />
              </div>
              <h3 className="mt-3 font-semibold text-gray-900">{s.titulo}</h3>
              <p className="mt-1 text-sm text-gray-500 leading-snug">{s.desc}</p>
            </>
          );
          const clase = 'group relative block bg-white border border-gray-200 rounded-xl p-5 transition-all hover:shadow-md hover:-translate-y-0.5';
          return s.to
            ? <Link key={s.titulo} to={s.to} className={clase}>{contenido}</Link>
            : <div key={s.titulo} className={`${clase} cursor-default`}>{contenido}</div>;
        })}
      </div>
    </div>
  );
}

export default EcommerceHubPage;
